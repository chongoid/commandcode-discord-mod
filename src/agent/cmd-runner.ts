import {spawn, type ChildProcess, type SpawnOptions} from 'node:child_process';
import {NdjsonParser} from './ndjson-parser.js';
import {friendlyRunnerError, isStaleSession} from './error-classifier.js';

export interface RunOptions {attemptId: string; prompt: string; sessionId?: string; model?: string; cwd: string; yolo: boolean; maxTurns: number; timeoutMs: number}
export type RunnerEvent = {type: string; [key: string]: unknown};
export type RunnerOutcome =
  | {kind: 'success'; finalText: string; sessionId?: string; durationMs?: number; usage?: Record<string, unknown>}
  | {kind: 'error'; error: string}
  | {kind: 'stale_session'; error: string}
  | {kind: 'cancelled'}
  | {kind: 'timeout'};
type SpawnFn = (command: string, args: string[], options: SpawnOptions) => ChildProcess;
interface ActiveChild {done: Promise<RunnerOutcome>; terminate: (outcome: RunnerOutcome) => Promise<boolean>}

export class CmdRunner {
  private children = new Map<string, ActiveChild>();
  constructor(private readonly spawnFn: SpawnFn = spawn, private readonly cmdPath = 'cmd', private readonly killGraceMs = 5000, private readonly closeGraceMs = 2000) {}

  async run(options: RunOptions, onEvent: (event: RunnerEvent) => void): Promise<RunnerOutcome> {
    if (this.children.has(options.attemptId)) throw new Error('Attempt already active');
    const args = ['-p', options.prompt, '--output-format', 'json', '--verbose'];
    if (options.sessionId?.trim()) args.push('--resume', options.sessionId.trim());
    if (options.model) args.push('--model', options.model);
    if (options.yolo) args.push('--yolo');
    args.push('--max-turns', String(options.maxTurns));
    let child: ChildProcess;
    try {child = this.spawnFn(this.cmdPath, args, {cwd: options.cwd, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32', env: {...process.env, FORCE_COLOR: '0'}});}
    catch (error) {return {kind: 'error', error: error instanceof Error ? error.message : String(error)};}

    let resolveDone!: (outcome: RunnerOutcome) => void;
    const done = new Promise<RunnerOutcome>(resolve => {resolveDone = resolve;});
    let candidate: RunnerOutcome | undefined;
    let settled = false;
    let closed = false;
    let stderr = '';
    let malformed = 0;
    let executionTimer: NodeJS.Timeout | undefined;
    let closeTimer: NodeJS.Timeout | undefined;

    const settle = (outcome: RunnerOutcome) => {
      if (settled) return;
      settled = true;
      if (executionTimer) clearTimeout(executionTimer);
      if (closeTimer) clearTimeout(closeTimer);
      this.children.delete(options.attemptId);
      resolveDone(outcome);
    };
    const choose = (outcome: RunnerOutcome) => {
      if (candidate) return;
      candidate = outcome;
      if (executionTimer) clearTimeout(executionTimer);
      executionTimer = undefined;
      if (!closed) closeTimer = setTimeout(() => {signal(child, 'SIGKILL'); settle(candidate!);}, this.closeGraceMs);
    };
    const terminate = async (outcome: RunnerOutcome): Promise<boolean> => {
      if (settled || candidate) return false;
      candidate = outcome;
      if (executionTimer) clearTimeout(executionTimer);
      signal(child, 'SIGTERM');
      await Promise.race([done.then(() => undefined), wait(this.killGraceMs)]);
      if (!closed && !settled) signal(child, 'SIGKILL');
      await Promise.race([done.then(() => undefined), wait(this.closeGraceMs)]);
      if (!settled) settle(outcome);
      return true;
    };

    const parser = new NdjsonParser<Record<string, unknown>>(value => {
      if (value.type === 'event' && value.event && typeof value.event === 'object') onEvent(value.event as RunnerEvent);
      if (value.type !== 'result') return;
      const subtype = String(value.subtype || 'success');
      const finalText = typeof value.finalText === 'string' ? value.finalText : typeof value.result === 'string' ? value.result : '';
      if (subtype === 'error') choose({kind: 'error', error: String(value.error || 'Agent returned an error')});
      else choose({kind: 'success', finalText, sessionId: typeof value.sessionId === 'string' ? value.sessionId : undefined, durationMs: typeof value.durationMs === 'number' ? value.durationMs : undefined, usage: value.usage && typeof value.usage === 'object' ? value.usage as Record<string, unknown> : undefined});
    }, () => {malformed++;});

    child.stdout?.on('data', chunk => parser.push(String(chunk)));
    child.stderr?.on('data', chunk => {stderr = `${stderr}${String(chunk)}`.slice(-16_384);});
    child.once('error', error => choose({kind: 'error', error: error.message}));
    child.once('close', code => {
      closed = true;
      parser.end();
      if (!candidate) {
        if (isStaleSession(stderr)) candidate = {kind: 'stale_session', error: friendlyRunnerError(stderr)};
        else if (malformed) candidate = {kind: 'error', error: `Agent emitted ${malformed} malformed output line(s) and no result.`};
        else candidate = {kind: 'error', error: code === 0 ? 'The coding agent exited without a result.' : friendlyRunnerError(stderr)};
      }
      settle(candidate);
    });

    this.children.set(options.attemptId, {done, terminate});
    executionTimer = setTimeout(() => void terminate({kind: 'timeout'}), options.timeoutMs);
    return done;
  }

  async cancel(attemptId: string): Promise<boolean> {
    const active = this.children.get(attemptId);
    if (!active) return false;
    const cancelled = await active.terminate({kind: 'cancelled'});
    if (cancelled) await active.done;
    return cancelled;
  }

  async shutdown(): Promise<void> {
    await Promise.all([...this.children.values()].map(async active => {await active.terminate({kind: 'cancelled'}); await active.done;}));
  }
}

function signal(child: ChildProcess, name: NodeJS.Signals): void {try {if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, name); else child.kill(name);} catch {try {child.kill(name);} catch {}}}
function wait(ms: number): Promise<void> {return new Promise(resolve => setTimeout(resolve, ms));}
