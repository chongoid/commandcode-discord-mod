import type {Destination} from '../domain.js';
import type {DiscordPort, StreamHandle} from '../ports.js';
import {toolContext} from '../formatting/tool-context.js';

const MAX_CHARS = 1900;        // under Discord's 2000-char limit
const EDIT_INTERVAL_MS = 600;  // throttle edits so streaming can't hammer the REST API

export interface LiveEvent {type: string; [key: string]: unknown}

const asString = (v: unknown, fb = ''): string => (typeof v === 'string' && v.trim() ? v.trim() : fb);
// Raw string without trimming: text_delta tokens carry a leading space, so trimming would
// fuse words together ("Docker" + " is" -> "Dockeris"). Never trim streaming deltas.
const rawString = (v: unknown, fb = ''): string => (typeof v === 'string' ? v : fb);

/**
 * Mirrors the TUI in Discord: the assistant's reply streams into its own message
 * (one per turn, edited in place as tokens arrive), each tool call gets its own
 * labeled message, and retries/notices go to a small sticky log.
 * On completion all of these live streamed messages are deleted, so the user is
 * left with a single clean, non-edited final answer instead of duplicates.
 */
export class LiveStream {
  private chain: Promise<void> = Promise.resolve();
  private closed = false;

  // References to every message this stream created, so finalize() can remove them.
  private created: StreamHandle[] = [];

  // Current assistant message (per turn)
  private turnHandle: StreamHandle | null = null;
  private turnText = '';
  private turnSeq = 0;
  private turnDirty = false;
  private turnTimer?: NodeJS.Timeout;

  // Tool messages keyed by toolCallId
  private tools = new Map<string, {handle: StreamHandle | null; icon: string; label: string}>();

  // Sticky log message for notices
  private log: {handle: StreamHandle | null; lines: string[]; dirty: boolean; timer?: NodeJS.Timeout} = {handle: null, lines: [], dirty: false};

  constructor(private readonly discord: DiscordPort, private readonly destination: Destination) {}

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn);
    this.chain = run.then(() => undefined, () => undefined);
    return run;
  }

  push(event: LiveEvent): void {
    if (this.closed) return;
    switch (event.type) {
      case 'run_start': case 'message_start': this.beginTurn(); break;
      case 'text_delta': this.appendTurn(rawString(event.delta)); break;
      case 'message_end': case 'turn_end': this.endTurn(); break;
      case 'tool_running': case 'tool_queued': this.showTool(event, '🔧'); break;
      case 'tool_completed': this.showTool(event, '✅'); break;
      case 'tool_errored': this.showTool(event, '❌'); break;
      case 'tool_denied': case 'tool_hook_blocked': this.showTool(event, '⛔'); break;
      case 'subagent_start': case 'subagent_running': this.notice(`>>> subagent ${asString(event.name, asString(event.description, ''))}`); break;
      case 'subagent_stop': case 'subagent_completed': this.notice(`✓ subagent ${asString(event.name, asString(event.description, ''))}`); break;
      case 'api_retry': this.notice(`↻ model retry ${event.attempt ?? ''} · waiting ${Math.ceil((Number(event.delayMs) || 0) / 1000)}s`); break;
      case 'compaction_start': this.notice('↻ compacting context'); break;
    }
  }

  async finalize(status: 'completed' | 'errored' | 'cancelled', _detail?: string): Promise<void> {
    this.endTurn();
    this.flushLog();
    await this.chain;
    this.closed = true;
    // Remove the live streamed messages. The canonical final answer (or error) is
    // posted via the outbox, so the user is left with one clean message, not duplicates.
    await this.cleanup();
    if (status === 'cancelled') {
      await this.enqueue(() => this.discord.send(this.destination, '🚫 Cancelled.', `cancel:${this.turnSeq}`).then(() => undefined)).catch(() => undefined);
    }
  }

  private async cleanup(): Promise<void> {
    const created = this.created;
    this.created = [];
    await Promise.allSettled(created.map(handle => handle.delete().catch(() => undefined)));
  }

  private beginTurn(): void {
    this.endTurn();
    this.turnSeq++;
    this.turnHandle = null;
    this.turnText = '';
    this.turnDirty = false;
    if (this.turnTimer) {clearTimeout(this.turnTimer); this.turnTimer = undefined;}
  }

  private appendTurn(delta: string): void {
    if (!delta) return;
    this.turnText += delta;
    this.turnDirty = true;
    if (!this.turnTimer && !this.closed) {
      this.turnTimer = setTimeout(() => {this.turnTimer = undefined; void this.flushTurn();}, EDIT_INTERVAL_MS);
    }
  }

  private endTurn(): void {
    if (this.turnTimer) {clearTimeout(this.turnTimer); this.turnTimer = undefined;}
    if (this.turnDirty) void this.flushTurn();
  }

  private flushTurn(): Promise<void> {
    if (this.closed || !this.turnDirty) return Promise.resolve();
    const body = this.renderTurn();
    this.turnDirty = false;
    return this.enqueue(async () => {
      if (!this.turnHandle) {this.turnHandle = await this.discord.streamSend(this.destination); this.created.push(this.turnHandle);}
      await this.turnHandle.edit(body);
    }).catch(() => {this.turnDirty = true;});
  }

  private renderTurn(): string {
    const t = this.turnText;
    if (t.length <= MAX_CHARS) return t;
    return `…${t.slice(t.length - MAX_CHARS)}`;
  }

  private showTool(event: LiveEvent, icon: string): void {
    const id = asString(event.toolCallId, `t${this.turnSeq}-${Date.now()}`);
    const name = asString(event.toolName, 'tool').replace(/[\s>]+$/, '');
    const ctx = asString(event.description) || toolContext(name, event.input) || '';
    const label = `\`${name}\`${ctx ? ` · ${truncate(ctx)}` : ''}`;
    const existing = this.tools.get(id);
    if (existing) {
      if (icon !== existing.icon) {
        existing.icon = icon;
        void this.enqueue(async () => {if (existing.handle) await existing.handle.edit(`${icon} ${existing.label}`);}).catch(() => undefined);
      }
      return;
    }
    this.tools.set(id, {handle: null, icon, label});
    void this.enqueue(async () => {
      const handle = await this.discord.streamSend(this.destination);
      this.created.push(handle);
      const rec = this.tools.get(id);
      if (rec) rec.handle = handle;
      await handle.edit(`${icon} ${label}`);
    }).catch(() => undefined);
  }

  private notice(line: string): void {
    if (!line) return;
    this.log.lines.push(line);
    if (this.log.lines.length > 5) this.log.lines.shift();
    this.log.dirty = true;
    if (!this.log.timer && !this.closed) {
      this.log.timer = setTimeout(() => {this.log.timer = undefined; void this.flushLog();}, EDIT_INTERVAL_MS);
    }
  }

  private flushLog(): void {
    if (this.closed || !this.log.dirty) return;
    this.log.dirty = false;
    void this.enqueue(async () => {
      if (!this.log.handle) {this.log.handle = await this.discord.streamSend(this.destination); this.created.push(this.log.handle);}
      await this.log.handle.edit(this.log.lines.map(line => `> ${line}`).join('\n'));
    }).catch(() => {this.log.dirty = true;});
  }
}

function truncate(value: string, max = 90): string {return [...value].length <= max ? value : `${[...value].slice(0, max - 1).join('')}…`;}
