import type {AppState, OutboxItem} from '../domain.js';
import type {DiscordPort, StateStore} from '../ports.js';
import {renderStatus} from '../formatting/status.js';

export class OutboxWorker {
  private flushPromise?: Promise<void>;
  private timer?: NodeJS.Timeout;
  private deliveredListener?: (conversationId: string) => void;
  constructor(private readonly state: AppState, private readonly store: StateStore, readonly discord: DiscordPort, private readonly retryBaseMs = 1000) {}

  start(intervalMs = 1000): void {if (!this.timer) this.timer = setInterval(() => void this.flush(), intervalMs);}
  onDelivered(listener: (conversationId: string) => void): void {this.deliveredListener = listener;}
  async stop(): Promise<void> {if (this.timer) clearInterval(this.timer); this.timer = undefined; await this.flush();}

  async enqueue(item: OutboxItem): Promise<void> {
    const existing = item.kind === 'status' && item.requestId
      ? this.state.outbox.find(entry => entry.kind === 'status' && entry.requestId === item.requestId && entry.operation === item.operation && !['delivered', 'permanent_error', 'in_flight'].includes(entry.state))
      : undefined;
    if (existing) Object.assign(existing, item, {id: existing.id, attempts: existing.attempts, state: 'pending', nextAttemptAt: Date.now()});
    else if (!this.state.outbox.some(entry => entry.id === item.id)) this.state.outbox.push(item);
    await this.store.save(this.state);
  }

  async flush(): Promise<void> {
    if (this.flushPromise) return this.flushPromise;
    this.flushPromise = this.drain().finally(() => {this.flushPromise = undefined;});
    return this.flushPromise;
  }

  delivered(ids: string[]): boolean {return ids.every(id => this.state.outbox.find(item => item.id === id)?.state === 'delivered');}

  private async drain(): Promise<void> {
    let progressed = true;
    while (progressed) {
      progressed = false;
      const now = Date.now();
      const items = this.state.outbox
        .filter(item => !['delivered', 'permanent_error'].includes(item.state) && item.nextAttemptAt <= now)
        .sort((a, b) => a.createdAt - b.createdAt || (a.chunkIndex ?? 0) - (b.chunkIndex ?? 0));
      for (const item of items) {
        if (!this.valid(item)) {item.state = 'permanent_error'; item.lastError = 'Invalid outbox references'; await this.store.save(this.state); progressed = true; continue;}
        if (item.kind === 'final' && !this.priorFinalsDelivered(item)) continue;
        await this.deliver(item);
        progressed = true;
      }
    }
  }

  private valid(item: OutboxItem): boolean {
    if (!this.state.conversations[item.conversationId]) return false;
    if (item.requestId && !this.state.requests[item.requestId]) return false;
    if (item.operation === 'edit' && !item.messageId) return false;
    return true;
  }

  private priorFinalsDelivered(item: OutboxItem): boolean {
    return this.state.outbox.every(other => other.kind !== 'final' || other.requestId !== item.requestId || (other.chunkIndex ?? 0) >= (item.chunkIndex ?? 0) || other.state === 'delivered');
  }

  private allFinalsDelivered(requestId: string): boolean {
    const finals = this.state.outbox.filter(item => item.kind === 'final' && item.requestId === requestId);
    return finals.length > 0 && finals.every(item => item.state === 'delivered');
  }

  private async deliver(item: OutboxItem): Promise<void> {
    const conversation = this.state.conversations[item.conversationId]!;
    item.state = 'in_flight';
    item.attempts++;
    await this.store.save(this.state);
    try {
      if (item.operation === 'edit') await this.discord.edit(conversation.destination, item.messageId!, item.content);
      else if (item.kind === 'file') {
        const receipt = await this.discord.send(conversation.destination, item.content, item.id, item.files);
        item.messageId = receipt.messageId;
      }
      else {
        const receipt = await this.discord.send(conversation.destination, item.content, item.id);
        item.messageId = receipt.messageId;
        if (item.kind === 'status' && item.requestId) this.state.requests[item.requestId]!.statusMessageId = receipt.messageId;
      }
      item.state = 'delivered';
      item.deliveredAt = Date.now();
      delete item.lastError;
      if (item.kind === 'final' && item.requestId && this.allFinalsDelivered(item.requestId)) {
        const request = this.state.requests[item.requestId]!;
        if (request.state === 'completed') {
          request.state = 'delivered';
          const statusId = request.statusMessageId;
          if (statusId) this.state.outbox.push({id: `status-delivered:${request.id}`, conversationId: request.conversationId, requestId: request.id, kind: 'status', operation: 'edit', content: renderStatus(request, this.state.progress[request.id]!), messageId: statusId, state: 'pending', attempts: 0, nextAttemptAt: Date.now(), createdAt: Date.now()});
        }
      }
      this.deliveredListener?.(item.conversationId);
    } catch (error) {
      item.lastError = error instanceof Error ? error.message : String(error);
      const permanent = this.discord.isPermanentError?.(error) ?? false;
      if (item.operation === 'edit' && permanent && item.requestId) {
        item.operation = 'send';
        item.messageId = undefined;
        this.state.requests[item.requestId]!.statusMessageId = undefined;
        item.state = 'retryable_error';
        item.nextAttemptAt = Date.now();
      } else if (permanent) item.state = 'permanent_error';
      else {
        item.state = 'retryable_error';
        item.nextAttemptAt = Date.now() + Math.min(60_000, this.retryBaseMs * 2 ** Math.min(item.attempts - 1, 6));
      }
    }
    await this.store.save(this.state);
  }
}
