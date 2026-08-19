import {randomUUID} from 'node:crypto';
import {newProgress, type AppState, type Conversation, type Destination, type OutboxItem, type RequestRecord} from '../domain.js';
import type {AttachmentInfo} from '../attachments.js';
import {cleanupAttachments} from '../attachments.js';
import type {RunnerPort, StateStore} from '../ports.js';
import {OutboxWorker} from '../delivery/outbox-worker.js';
import {chunkMarkdown} from '../formatting/markdown.js';
import {renderStatus} from '../formatting/status.js';
import {reduceProgress} from './progress-reducer.js';
import {TypingLease} from './typing-lease.js';
import {LiveStream} from '../streaming/live-stream.js';

export interface CoordinatorOptions {workingDir: string; yolo: boolean; maxTurns: number; timeoutMs: number}

export class RequestCoordinator {
  private pumps = new Map<string, Promise<void>>();
  private leases = new Map<string, TypingLease>();
  private statusChains = new Map<string, Promise<void>>();
  private statusRefreshers = new Map<string, NodeJS.Timeout>();
  private acceptChain = Promise.resolve();
  private stopping = false;
  constructor(private readonly state: AppState, private readonly store: StateStore, private readonly runner: RunnerPort, private readonly outbox: OutboxWorker, private readonly options: CoordinatorOptions) {}

  async recoverState(): Promise<void> {
    const now = Date.now();
    for (const request of Object.values(this.state.requests)) {
      if (!['starting', 'running', 'cancelling', 'interrupted_unknown'].includes(request.state)) continue;
      request.state = 'interrupted_unknown'; request.finishedAt ||= now; request.error ||= 'Service restarted during execution; outcome unknown and work was not repeated.';
      const conversation = this.state.conversations[request.conversationId];
      if (!conversation) continue;
      if (conversation.activeRequestId === request.id) delete conversation.activeRequestId;
      // Preserve the conversation's session: do NOT pause or mark it reset-pending, so a
      // message after restart resumes the same command-code session (prior context intact)
      // instead of starting fresh.
      for (const queuedId of conversation.queue) {const queued = this.state.requests[queuedId]; if (queued) {queued.state = 'cancelled'; queued.finishedAt = now; queued.error = 'Cancelled because the prior request was interrupted.'; await this.queueStatus(queued);}}
      conversation.queue = [];
      await this.outbox.enqueue(this.item(conversation.id, request.id, 'notice', '⚠️ A request was interrupted by a service restart; its outcome is unknown and was not repeated. Send a new message to continue — prior context is preserved.', `recovery:${request.id}`));
    }
    for (const request of Object.values(this.state.requests)) {if (request.attachments?.length) await cleanupAttachments(request.attachments, this.options.workingDir).catch(() => undefined);}
    this.updateCounts(); await this.store.save(this.state);
  }

  async resumeDeliveryAndQueues(): Promise<void> {await this.outbox.flush(); await this.resumeQueues();}
  async resumeConversation(conversationId: string): Promise<void> {if (!this.stopping && !this.state.conversations[conversationId]?.paused) await this.pump(conversationId);}
  async resumeQueues(): Promise<void> {if (this.stopping) return; for (const conversation of Object.values(this.state.conversations)) if (!conversation.paused) void this.pump(conversation.id);}

  accept(input: {conversationId: string; destination: Destination; sourceMessageId: string; prompt: string; title?: string; attachments?: AttachmentInfo[]}): Promise<string> {
    const operation = this.acceptChain.then(async () => {
      if (this.stopping) {if (input.attachments?.length) await cleanupAttachments(input.attachments, this.options.workingDir).catch(() => undefined); throw new Error('Discord runtime is stopping');}
      const duplicate = Object.values(this.state.requests).find(request => request.conversationId === input.conversationId && request.sourceMessageId === input.sourceMessageId);
      if (duplicate) {if (input.attachments?.length) await cleanupAttachments(input.attachments, this.options.workingDir).catch(() => undefined); return duplicate.id;}
      const now = Date.now();
      let conversation = this.state.conversations[input.conversationId];
      if (!conversation) conversation = this.state.conversations[input.conversationId] = {id: input.conversationId, destination: input.destination, title: input.title, sessionState: 'fresh', queue: [], paused: false, resetNoticePending: false, createdAt: now, updatedAt: now};
      else conversation.destination = input.destination;
      if (conversation.paused || conversation.resetNoticePending) {conversation.paused = false; conversation.resetNoticePending = false; conversation.sessionId = undefined; conversation.sessionState = 'fresh'; await this.outbox.enqueue(this.item(conversation.id, undefined, 'notice', 'ℹ️ Previous context was reset. This new request starts fresh.', `reset:${conversation.id}:${input.sourceMessageId}`));}
      const id = randomUUID();
      const request: RequestRecord = {id, conversationId: conversation.id, sourceMessageId: input.sourceMessageId, prompt: input.prompt, attachments: input.attachments, state: 'queued', queuePosition: conversation.activeRequestId || conversation.queue.length ? conversation.queue.length + 1 : undefined, acceptedAt: now};
      this.state.requests[id] = request; this.state.progress[id] = newProgress(); conversation.queue.push(id); conversation.updatedAt = now; this.state.runtime.totalRequests++; this.updateCounts();
      await this.store.save(this.state); await this.queueStatus(request); await this.outbox.flush(); void this.pump(conversation.id); return id;
    });
    this.acceptChain = operation.then(() => undefined, () => undefined);
    return operation;
  }

  async stop(conversationId: string): Promise<boolean> {
    const conversation = this.state.conversations[conversationId]; const request = conversation?.activeRequestId ? this.state.requests[conversation.activeRequestId] : undefined;
    if (!request?.attemptId) return false;
    request.state = 'cancelling'; await this.scheduleStatus(request);
    const cancelled = await this.runner.cancel(request.attemptId); if (!cancelled) return false;
    const deadline = Date.now() + 10_000; while (conversation.activeRequestId === request.id && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    return conversation.activeRequestId !== request.id;
  }

  async reset(conversationId: string): Promise<number> {
    const conversation = this.state.conversations[conversationId]; if (!conversation) return 0;
    const ids = [...conversation.queue]; conversation.queue = [];
    for (const id of ids) {const request = this.state.requests[id]; if (request) {request.state = 'cancelled'; request.finishedAt = Date.now(); request.error = 'Cleared by reset.'; await this.scheduleStatus(request);}}
    if (conversation.activeRequestId) await this.stop(conversationId);
    conversation.sessionId = undefined; conversation.sessionState = 'fresh'; conversation.paused = false; conversation.resetNoticePending = false; this.updateCounts(); await this.store.save(this.state); await this.drainStatuses(ids); return ids.length;
  }

  async shutdown(): Promise<void> {
    this.stopping = true;
    for (const lease of this.leases.values()) lease.stop(); this.leases.clear();
    for (const timer of this.statusRefreshers.values()) clearInterval(timer); this.statusRefreshers.clear();
    for (const conversation of Object.values(this.state.conversations)) {
      for (const queuedId of conversation.queue) {const queued = this.state.requests[queuedId]; if (queued) {queued.state = 'cancelled'; queued.finishedAt = Date.now(); queued.error = 'Cancelled because the service stopped.'; await this.scheduleStatus(queued);}}
      conversation.queue = [];
      if (!conversation.activeRequestId) continue;
      const request = this.state.requests[conversation.activeRequestId];
      if (request) {request.state = 'interrupted_unknown'; request.finishedAt = Date.now(); request.error = 'Service stopped during execution; outcome unknown.'; conversation.paused = true; conversation.resetNoticePending = true; await this.scheduleStatus(request);}
    }
    await this.runner.shutdown(); await Promise.all([...this.pumps.values()]);
    for (const request of Object.values(this.state.requests)) {if (request.attachments?.length) await cleanupAttachments(request.attachments, this.options.workingDir).catch(() => undefined);}
    await this.drainStatuses(); this.updateCounts(); await this.store.save(this.state);
  }

  private pump(conversationId: string): Promise<void> {const existing = this.pumps.get(conversationId); if (existing) return existing; const promise = this.runPump(conversationId).finally(() => this.pumps.delete(conversationId)); this.pumps.set(conversationId, promise); return promise;}
  private async runPump(conversationId: string): Promise<void> {const conversation = this.state.conversations[conversationId]; while (!this.stopping && conversation && !conversation.paused && !conversation.activeRequestId && conversation.queue.length) {const id = conversation.queue.shift()!; const request = this.state.requests[id]; if (!request || request.state !== 'queued') continue; conversation.activeRequestId = id; this.updateCounts(); await this.store.save(this.state); const ran = await this.execute(conversation, request); if (!ran) {conversation.queue.unshift(request.id); delete conversation.activeRequestId; this.updateCounts(); await this.store.save(this.state); break;}}}

  private async execute(conversation: Conversation, request: RequestRecord): Promise<boolean> {
    if (!request.statusMessageId) {await this.outbox.flush(); if (!request.statusMessageId) return false;}
    const attemptId = randomUUID(); request.attemptId = attemptId; request.queuePosition = undefined; request.sessionIdAtStart = conversation.sessionId; request.state = 'starting'; request.startedAt = Date.now(); await this.scheduleStatus(request);
    const lease = new TypingLease(this.outbox.discord, conversation.destination); this.leases.set(request.id, lease); lease.start(); request.state = 'running'; await this.scheduleStatus(request); this.startStatusRefresh(request);
    const stream = new LiveStream(this.outbox.discord, conversation.destination);
    let outcome;
    try {outcome = await this.runner.run({attemptId, prompt: request.prompt, sessionId: conversation.sessionState === 'usable' ? conversation.sessionId : undefined, model: conversation.model, cwd: this.options.workingDir, yolo: this.options.yolo, maxTurns: this.options.maxTurns, timeoutMs: this.options.timeoutMs}, event => {if (request.attemptId !== attemptId || !['running', 'cancelling'].includes(request.state)) return; this.state.progress[request.id] = reduceProgress(this.state.progress[request.id]!, event); stream.push(event);});}
    catch (error) {outcome = {kind: 'error' as const, error: error instanceof Error ? error.message : String(error)};}
    lease.stop(); this.leases.delete(request.id); this.stopStatusRefresh(request.id); await this.drainStatuses([request.id]); if (request.attemptId !== attemptId) {if (request.attachments?.length) await cleanupAttachments(request.attachments, this.options.workingDir).catch(() => undefined); void stream.finalize('cancelled'); return true;}
    if (this.stopping) {request.state = 'interrupted_unknown'; request.error = 'Service stopped during execution; outcome unknown.'; conversation.paused = true; conversation.resetNoticePending = true;}
    else if (outcome.kind === 'cancelled') {request.state = 'cancelled'; request.error = 'Request cancelled.'; await this.scheduleStatus(request);}
    else if (outcome.kind === 'success' || stream.hasContent) {
      // The answer is already streamed into Discord (live, chunked, not erased).
      // Mark delivered without a duplicate final post or a false failure.
      request.state = 'delivered';
      if (outcome.kind === 'success') request.finalText = outcome.finalText || 'Completed without a text response.';
      const sid = (outcome as {sessionId?: string}).sessionId?.trim();
      if (sid) {conversation.sessionId = sid; conversation.sessionState = 'usable';}
      this.state.runtime.totalCompleted++;
      await this.scheduleStatus(request);
      // Fallback: if a successful run emitted no streamed content, still deliver the
      // authoritative final text (chunked) so a completed answer is never lost.
      if (outcome.kind === 'success' && !stream.hasContent && request.finalText) {
        for (const [index, content] of chunkMarkdown(request.finalText).entries()) {
          await this.outbox.enqueue(this.item(conversation.id, request.id, 'final', content, `final:${request.id}:${index}`, index));
        }
      }
    }
    else if (outcome.kind === 'stale_session') {request.state = 'errored'; request.error = 'The previous Command Code session is unavailable. Send a new message to start fresh.'; conversation.sessionState = 'reset_required'; conversation.resetNoticePending = true; this.state.runtime.totalErrors++; await this.scheduleStatus(request); await this.outbox.enqueue(this.item(conversation.id, request.id, 'final', request.error, `final:${request.id}:0`, 0));}
    else {request.state = 'errored'; request.error = outcome.kind === 'timeout' ? 'The coding agent timed out.' : outcome.error; this.state.runtime.totalErrors++; await this.scheduleStatus(request); await this.outbox.enqueue(this.item(conversation.id, request.id, 'final', request.error, `final:${request.id}:0`, 0));}
    if (request.attachments?.length) await cleanupAttachments(request.attachments, this.options.workingDir).catch(() => undefined);
    await stream.finalize();
    request.finishedAt = Date.now(); delete conversation.activeRequestId; conversation.updatedAt = Date.now(); this.updateCounts(); await this.store.save(this.state); await this.drainStatuses([request.id]); await this.outbox.flush(); return true;
  }

  private startStatusRefresh(request: RequestRecord): void {this.stopStatusRefresh(request.id); const timer = setInterval(() => {if (['running', 'cancelling', 'starting'].includes(request.state)) void this.scheduleStatus(request); else this.stopStatusRefresh(request.id);}, 15_000); this.statusRefreshers.set(request.id, timer);}
  private stopStatusRefresh(requestId: string): void {const timer = this.statusRefreshers.get(requestId); if (timer) clearInterval(timer); this.statusRefreshers.delete(requestId);}
  private async queueStatus(request: RequestRecord): Promise<void> {await this.outbox.enqueue(this.item(request.conversationId, request.id, 'status', renderStatus(request, this.state.progress[request.id]!), `status:${request.id}`));}
  private scheduleStatus(request: RequestRecord): Promise<void> {const prior = this.statusChains.get(request.id) || Promise.resolve(); const next = prior.then(async () => {const item = this.item(request.conversationId, request.id, 'status', renderStatus(request, this.state.progress[request.id]!), `status-edit:${request.id}:${Date.now()}`); item.operation = request.statusMessageId ? 'edit' : 'send'; item.messageId = request.statusMessageId; await this.outbox.enqueue(item); await this.outbox.flush();}); this.statusChains.set(request.id, next.catch(() => undefined)); return next;}
  private async drainStatuses(ids?: string[]): Promise<void> {const values = ids ? ids.map(id => this.statusChains.get(id)).filter((value): value is Promise<void> => Boolean(value)) : [...this.statusChains.values()]; await Promise.all(values);}
  private item(conversationId: string, requestId: string | undefined, kind: 'status'|'final'|'notice', content: string, id: string, chunkIndex?: number): OutboxItem {return {id, conversationId, requestId, kind, operation: 'send', content, chunkIndex, state: 'pending', attempts: 0, nextAttemptAt: Date.now(), createdAt: Date.now()};}
  private updateCounts(): void {this.state.runtime.activeCount = Object.values(this.state.conversations).filter(conversation => conversation.activeRequestId).length; this.state.runtime.queuedCount = Object.values(this.state.conversations).reduce((sum, conversation) => sum + conversation.queue.length, 0); this.state.runtime.heartbeatAt = Date.now();}
}
