import {describe, expect, it} from 'vitest';
import {emptyState, newProgress, type OutboxItem} from '../src/domain.js';
import {MemoryStore} from '../src/persistence/json-store.js';
import {OutboxWorker} from '../src/delivery/outbox-worker.js';
import {FakeDiscord, dm} from './helpers/fakes.js';

function setup() {
  const state = emptyState(1);
  state.conversations.c = {id: 'c', destination: dm(), sessionState: 'fresh', queue: [], paused: false, resetNoticePending: false, createdAt: 1, updatedAt: 1};
  state.requests.r = {id: 'r', conversationId: 'c', sourceMessageId: 'm', prompt: 'p', state: 'completed', acceptedAt: 1, statusMessageId: 'status'};
  state.progress.r = newProgress();
  const store = new MemoryStore(state); const discord = new FakeDiscord(); const worker = new OutboxWorker(state, store, discord, 1);
  const item = (id: string, kind: 'status'|'final'|'notice', content: string, operation: 'send'|'edit' = 'send'): OutboxItem => ({id, conversationId: 'c', requestId: 'r', kind, operation, content, messageId: operation === 'edit' ? 'status' : undefined, state: 'pending', attempts: 0, nextAttemptAt: 0, createdAt: Date.now()});
  return {state, store, discord, worker, item};
}

describe('outbox', () => {
  it('uses stable nonce idempotency and delivers independent items after a failure', async () => {const x = setup(); x.discord.failSendNonces.add('bad'); await x.worker.enqueue(x.item('bad', 'notice', 'bad')); await x.worker.enqueue(x.item('good', 'final', 'good')); await x.worker.flush(); expect(x.discord.sent.some(message => message.content === 'good')).toBe(true); expect(x.state.outbox.find(item => item.id === 'bad')?.state).toBe('retryable_error'); x.discord.failSendNonces.clear(); x.state.outbox.find(item => item.id === 'bad')!.nextAttemptAt = 0; await x.worker.flush(); await x.worker.flush(); expect(x.discord.sent.filter(message => message.content === 'bad')).toHaveLength(1);});
  it('recreates a deleted status without blocking finals', async () => {const x = setup(); x.discord.failEdits = true; await x.worker.enqueue(x.item('edit', 'status', 'status', 'edit')); await x.worker.enqueue(x.item('final', 'final', 'answer')); await x.worker.flush(); expect(x.discord.sent.some(message => message.content === 'answer')).toBe(true); expect(x.state.outbox.find(item => item.id === 'edit')?.operation).toBe('send');});
  it('promotes only successful requests to delivered', async () => {const x = setup(); await x.worker.enqueue(x.item('final', 'final', 'answer')); await x.worker.flush(); expect(x.state.requests.r.state).toBe('delivered'); expect(x.state.outbox.some(item => item.id === 'status-delivered:r')).toBe(true); const y = setup(); y.state.requests.r.state = 'errored'; await y.worker.enqueue(y.item('error-final', 'final', 'failed')); await y.worker.flush(); expect(y.state.requests.r.state).toBe('errored');});
  it('delivers a file outbox item with the file attached', async () => {const x = setup(); const fileItem: OutboxItem = {id: 'file1', conversationId: 'c', requestId: 'r', kind: 'file', operation: 'send', content: 'Edited image', files: ['/tmp/out/edited.jpg'], state: 'pending', attempts: 0, nextAttemptAt: 0, createdAt: Date.now()}; await x.worker.enqueue(fileItem); await x.worker.flush(); const sent = x.discord.sent.find(message => message.content === 'Edited image'); expect(sent?.files).toEqual(['/tmp/out/edited.jpg']);});
});
