import type {Destination} from '../domain.js';
import type {DiscordPort, StreamHandle} from '../ports.js';
import {toolContext} from '../formatting/tool-context.js';

const MAX_CHARS = 1900;        // under Discord's 2000-char message limit
const EDIT_INTERVAL_MS = 600;  // throttle edits so streaming can't hammer the REST API

export interface LiveEvent {type: string; [key: string]: unknown}

// Raw string WITHOUT trimming: text_delta tokens carry a leading space, so trimming
// would fuse words together ("Docker" + " is" -> "Dockeris"). Never trim stream deltas.
const rawString = (v: unknown, fb = ''): string => (typeof v === 'string' ? v : fb);
const asString = (v: unknown, fb = ''): string => (typeof v === 'string' && v.trim() ? v.trim() : fb);

interface ChatChunk {handle: StreamHandle | null; text: string; dirty: boolean; timer?: NodeJS.Timeout}

/**
 * Streams a run's full conversation to Discord the way the TUI shows it:
 *
 *  - the assistant's reply streams in live, split into multiple messages only when a
 *    single message would exceed Discord's 2000-char limit (never truncated, never
 *    "…"-ed),
 *  - each tool call gets its own labeled message,
 *  - retries/notices go to a small log,
 *  - NOTHING is ever deleted, and a run is never reported failed if content already
 *    reached the channel (no false failures).
 */
export class LiveStream {
  private chain: Promise<void> = Promise.resolve();
  private closed = false;
  private chunks: ChatChunk[] = [];
  private tools = new Map<string, {handle: StreamHandle | null; icon: string; label: string}>();
  private log: {handle: StreamHandle | null; lines: string[]; dirty: boolean; timer?: NodeJS.Timeout} = {handle: null, lines: [], dirty: false};
  private assistantChars = 0;

  constructor(private readonly discord: DiscordPort, private readonly destination: Destination) {}

  /** True once any assistant text has been streamed to the channel. */
  get hasContent(): boolean {return this.assistantChars > 0;}

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn);
    this.chain = run.then(() => undefined, () => undefined);
    return run;
  }

  push(event: LiveEvent): void {
    if (this.closed) return;
    switch (event.type) {
      case 'run_start': case 'message_start': case 'turn_start': this.newAssistantMessage(); break;
      case 'text_delta': this.appendText(rawString(event.delta)); break;
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

  async finalize(_status?: string, _detail?: string): Promise<void> {
    for (const chunk of this.chunks) this.flush(chunk);
    this.flushLog();
    await this.chain;
    this.closed = true;
  }

  private newAssistantMessage(): void {
    this.chunks.push({handle: null, text: '', dirty: false});
  }

  private appendText(delta: string): void {
    if (!delta) return;
    this.assistantChars += delta.length;
    let chunk = this.chunks[this.chunks.length - 1];
    if (!chunk) {chunk = {handle: null, text: '', dirty: false}; this.chunks.push(chunk);}
    chunk.text += delta;
    if (chunk.text.length > MAX_CHARS) {
      const overflow = chunk.text.slice(MAX_CHARS);
      chunk.text = chunk.text.slice(0, MAX_CHARS);
      this.flush(chunk);
      const next: ChatChunk = {handle: null, text: overflow, dirty: true};
      this.chunks.push(next);
      this.flush(next);
      return;
    }
    this.schedule(chunk);
  }

  private schedule(chunk: ChatChunk): void {
    chunk.dirty = true;
    if (chunk.timer || this.closed) return;
    chunk.timer = setTimeout(() => {chunk.timer = undefined; this.flush(chunk);}, EDIT_INTERVAL_MS);
  }

  private flush(chunk: ChatChunk): void {
    if (!chunk.dirty) return;
    chunk.dirty = false;
    if (chunk.timer) {clearTimeout(chunk.timer); chunk.timer = undefined;}
    void this.enqueue(async () => {
      if (!chunk.handle) {chunk.handle = await this.discord.streamSend(this.destination);}
      await chunk.handle.edit(chunk.text);
    }).catch(() => {chunk.dirty = true;});
  }

  private showTool(event: LiveEvent, icon: string): void {
    const id = asString(event.toolCallId, `t${Date.now()}`);
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
    if (this.log.timer || this.closed) return;
    this.log.timer = setTimeout(() => {this.log.timer = undefined; void this.flushLog();}, EDIT_INTERVAL_MS);
  }

  private flushLog(): void {
    if (!this.log.dirty) return;
    this.log.dirty = false;
    if (this.log.timer) {clearTimeout(this.log.timer); this.log.timer = undefined;}
    void this.enqueue(async () => {
      if (!this.log.handle) {this.log.handle = await this.discord.streamSend(this.destination);}
      await this.log.handle.edit(this.log.lines.map(line => `> ${line}`).join('\n'));
    }).catch(() => {this.log.dirty = true;});
  }
}

function truncate(value: string, max = 90): string {return [...value].length <= max ? value : `${[...value].slice(0, max - 1).join('')}…`;}
