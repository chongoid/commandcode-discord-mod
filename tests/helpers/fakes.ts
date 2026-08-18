import type {Destination} from '../../src/domain.js';
import type {DiscordPort, RunnerPort} from '../../src/ports.js';
import type {RunOptions, RunnerEvent, RunnerOutcome} from '../../src/agent/cmd-runner.js';

export class FakeDiscord implements DiscordPort {
  sent: Array<{destination: Destination; content: string; id: string; nonce: string}> = [];
  edits: Array<{messageId: string; content: string}> = [];
  typingCount = 0;
  failEdits = false;
  failSends = false;
  failSendNonces = new Set<string>();
  private nonces = new Map<string, string>();
  async send(destination: Destination, content: string, nonce: string) {
    if (this.failSends || this.failSendNonces.has(nonce)) throw new Error('send failed');
    const prior = this.nonces.get(nonce); if (prior) return {messageId: prior};
    const id = `m${this.sent.length + 1}`; this.nonces.set(nonce, id); this.sent.push({destination, content, id, nonce}); return {messageId: id};
  }
  async edit(_destination: Destination, messageId: string, content: string) {if (this.failEdits) {const error = new Error('Unknown Message') as Error & {code: number}; error.code = 10008; throw error;} this.edits.push({messageId, content});}
  async typing() {this.typingCount++;}
  isPermanentError(error: unknown): boolean {return Number((error as {code?: unknown})?.code) === 10008;}
}

export class FakeRunner implements RunnerPort {
  runs: RunOptions[] = [];
  outcomes: RunnerOutcome[] = [];
  events: RunnerEvent[][] = [];
  active = new Map<string, (value: RunnerOutcome) => void>();
  async run(options: RunOptions, onEvent: (event: RunnerEvent) => void): Promise<RunnerOutcome> {this.runs.push(options); for (const event of this.events.shift() || []) onEvent(event); const next = this.outcomes.shift(); if (next) return next; return new Promise(resolve => this.active.set(options.attemptId, resolve));}
  async cancel(attemptId: string) {const resolve = this.active.get(attemptId); if (!resolve) return false; resolve({kind: 'cancelled'}); this.active.delete(attemptId); return true;}
  async shutdown() {for (const resolve of this.active.values()) resolve({kind: 'cancelled'}); this.active.clear();}
}

export const dm = (id = 'dm1'): Destination => ({kind: 'dm', channelId: id, userId: 'u1'});
export async function eventually(check: () => boolean, timeout = 1000): Promise<void> {const end = Date.now() + timeout; while (Date.now() < end) {if (check()) return; await new Promise(resolve => setTimeout(resolve, 5));} throw new Error('condition not met');}
