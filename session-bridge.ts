import {spawn, type ChildProcess} from 'child_process';
import {readFileSync, writeFileSync, existsSync, mkdirSync} from 'fs';
import {join} from 'path';
import type {DiscordModConfig, ThreadSession, NdjsonEvent, NdjsonResult} from './types';

const STATE_DIR = join(process.env.HOME || '~', '.commandcode');
const STATE_FILE = join(STATE_DIR, 'discord-threads.json');

// All logging goes to stderr — stdout is NDJSON when running inside cmd
function log(...args: unknown[]): void {
  const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
  process.stderr.write(`[SessionBridge] ${msg}\n`);
}

export interface SessionCallbacks {
  onEvent: (event: NdjsonEvent['event']) => void;
  onResult: (result: NdjsonResult) => void;
  onError: (error: string) => void;
  onSessionId: (sessionId: string) => void;
}

export class SessionBridge {
  private sessions = new Map<string, ThreadSession>();
  private activeProcesses = new Map<string, ChildProcess>();
  private config: DiscordModConfig;

  constructor(config: DiscordModConfig) {
    this.config = config;
    this.loadState();
  }

  getActiveSession(threadId: string): ThreadSession | undefined {
    return this.sessions.get(threadId);
  }

  presetSessionTitle(threadId: string, title: string): void {
    const session = this.sessions.get(threadId);
    if (session) {
      session.title = title;
    } else {
      this.sessions.set(threadId, {
        threadId,
        channelId: threadId,
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
        title,
        requestCount: 0,
      });
    }
    this.saveState();
  }

  setModel(threadId: string, model: string): void {
    const session = this.sessions.get(threadId);
    if (session) {
      session.model = model;
    } else {
      this.sessions.set(threadId, {
        threadId,
        channelId: threadId,
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
        requestCount: 0,
        model,
      });
    }
    this.saveState();
  }

  resetSession(threadId: string): void {
    this.stopProcess(threadId);
    this.sessions.delete(threadId);
    this.saveState();
  }

  stopProcess(threadId: string): boolean {
    const proc = this.activeProcesses.get(threadId);
    if (proc && !proc.killed) {
      proc.kill('SIGTERM');
      this.activeProcesses.delete(threadId);
      return true;
    }
    return false;
  }

  isProcessing(threadId: string): boolean {
    return this.activeProcesses.has(threadId);
  }

  async runSession(
    threadId: string,
    channelId: string,
    prompt: string,
    callbacks: SessionCallbacks,
  ): Promise<void> {
    if (this.activeProcesses.has(threadId)) {
      callbacks.onError('A session is already running in this thread. Use /stop to cancel it.');
      return;
    }

    let session = this.sessions.get(threadId);

    if (!session) {
      session = {
        threadId,
        channelId,
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
        requestCount: 0,
      };
      this.sessions.set(threadId, session);
    }

    session.lastActiveAt = Date.now();
    session.requestCount = (session.requestCount || 0) + 1;
    session.isProcessing = true;
    session.lastPrompt = prompt;
    this.saveState();

    const args = this.buildArgs(prompt, session.sessionId, session.model);
    const cmdPath = this.findCmd();
    log(`Spawning: ${cmdPath} ${args.join(' ')}`);

    let proc: ChildProcess;
    try {
      proc = spawn(cmdPath, args, {
        cwd: this.config.workingDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          FORCE_COLOR: '0',
          PATH: `${process.env.HOME}/.local/bin:${process.env.PATH || '/usr/local/bin:/usr/bin:/bin'}`,
        },
      });
    } catch (err) {
      log(`Spawn failed: ${err}`);
      callbacks.onError(`Failed to start command: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    this.activeProcesses.set(threadId, proc);

    let stderrBuffer = '';
    let stdoutBuffer = '';

    proc.stderr?.on('data', (data: Buffer) => {
      const chunk = data.toString();
      stderrBuffer += chunk;
      this.parseSessionId(stderrBuffer, session!, callbacks);
    });

    proc.stdout?.on('data', (data: Buffer) => {
      const chunk = data.toString();
      stdoutBuffer += chunk;
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        this.processLine(line, session!, callbacks);
      }
    });

    proc.on('error', (err) => {
      log(`Process error: ${err.message}`);
      this.activeProcesses.delete(threadId);
      if (session) {
        session.isProcessing = false;
        delete session.lastPrompt;
        this.saveState();
      }
      callbacks.onError(`Process error: ${err.message}`);
    });

    proc.on('close', (code, signal) => {
      log(`Process closed: code=${code}, signal=${signal}`);
      this.activeProcesses.delete(threadId);

      if (session) {
        session.isProcessing = false;
        delete session.lastPrompt;
        this.saveState();
      }

      if (stdoutBuffer.trim()) {
        this.processLine(stdoutBuffer.trim(), session!, callbacks);
      }

      if (code !== 0 && code !== null) {
        const errorMatch = stderrBuffer.match(/Error:?\s*(.*)/i);
        if (errorMatch) {
          callbacks.onError(errorMatch[1]);
        } else if (stderrBuffer.trim()) {
          callbacks.onError(stderrBuffer.trim().slice(0, 500));
        }
      }
    });
  }

  getSessionList(): Array<{threadId: string; sessionId?: string; title?: string; lastActive: number}> {
    return Array.from(this.sessions.values()).map(s => ({
      threadId: s.threadId,
      sessionId: s.sessionId,
      title: s.title,
      lastActive: s.lastActiveAt,
    }));
  }

  getInterruptedSessions(): ThreadSession[] {
    return Array.from(this.sessions.values()).filter(
      s => s.isProcessing && s.sessionId
    );
  }

  markSessionNotProcessing(threadId: string): void {
    const session = this.sessions.get(threadId);
    if (session) {
      session.isProcessing = false;
      delete session.lastPrompt;
      this.saveState();
    }
  }

  private findCmd(): string {
    const candidates = [
      join(process.env.HOME || '', '.local/bin/cmd'),
      'cmd',
    ];
    for (const c of candidates) {
      try {
        if (existsSync(c)) return c;
      } catch {}
    }
    return 'cmd';
  }

  private buildArgs(prompt: string, sessionId?: string, model?: string): string[] {
    const args = ['-p', prompt, '--output-format', 'json', '--verbose'];
    if (sessionId) args.push('--resume', sessionId);
    if (model) args.push('--model', model);
    if (this.config.yolo) args.push('--yolo');
    if (this.config.maxTurns) args.push('--max-turns', String(this.config.maxTurns));
    return args;
  }

  private parseSessionId(stderr: string, session: ThreadSession, callbacks: SessionCallbacks): void {
    if (session.sessionId) return;
    const match = stderr.match(/session:\s*([a-f0-9-]+)/i);
    if (match) {
      log(`Session ID: ${match[1]}`);
      session.sessionId = match[1];
      this.saveState();
      callbacks.onSessionId(match[1]);
    }
  }

  private processLine(line: string, session: ThreadSession, callbacks: SessionCallbacks): void {
    let parsed: NdjsonEvent | NdjsonResult;
    try {
      parsed = JSON.parse(line);
    } catch {
      return; // Skip non-JSON lines silently
    }

    if (parsed.type === 'event') {
      callbacks.onEvent(parsed.event);
    } else if (parsed.type === 'result') {
      const result = parsed as NdjsonResult;
      if (result.sessionId && !session.sessionId) {
        session.sessionId = result.sessionId;
        this.saveState();
        callbacks.onSessionId(result.sessionId);
      }
      callbacks.onResult(result);
    }
  }

  private loadState(): void {
    try {
      if (existsSync(STATE_FILE)) {
        const data = JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
        if (Array.isArray(data)) {
          for (const session of data) {
            this.sessions.set(session.threadId, session);
          }
          log(`Loaded ${data.length} sessions`);
        }
      }
    } catch {
      // Ignore
    }
  }

  private saveState(): void {
    try {
      if (!existsSync(STATE_DIR)) {
        mkdirSync(STATE_DIR, {recursive: true});
      }
      writeFileSync(STATE_FILE, JSON.stringify(Array.from(this.sessions.values()), null, 2));
    } catch {
      // Ignore
    }
  }
}
