import {STATE_VERSION, type AppState, type Conversation, type OutboxItem, type ProgressItem, type RequestRecord} from '../domain.js';

const requestStates = new Set(['queued','starting','running','cancelling','completed','errored','cancelled','interrupted_unknown','delivered']);
const sessionStates = new Set(['fresh','usable','reset_required']);
const progressStates = new Set(['queued','running','completed','errored','denied','hook_blocked']);
const outboxStates = new Set(['pending','in_flight','delivered','retryable_error','permanent_error']);
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const number = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;

export function validateState(value: unknown): AppState {
  if (!object(value) || value.version !== STATE_VERSION || !object(value.conversations) || !object(value.requests) || !object(value.progress) || !Array.isArray(value.outbox) || !object(value.runtime)) throw new Error('Invalid state root');
  const state = value as unknown as AppState;
  for (const [id, conversation] of Object.entries(state.conversations)) validateConversation(id, conversation);
  for (const [id, request] of Object.entries(state.requests)) validateRequest(id, request, state);
  for (const [id, progress] of Object.entries(state.progress)) {
    if (!state.requests[id] || !object(progress) || !object(progress.tools) || !object(progress.subagents) || !Array.isArray(progress.recent) || !Array.isArray(progress.notices)) throw new Error('Invalid progress');
    for (const item of [...Object.values(progress.tools), ...Object.values(progress.subagents), ...progress.recent]) validateProgress(item);
  }
  const outboxIds = new Set<string>();
  for (const item of state.outbox) {validateOutbox(item, state); if (outboxIds.has(item.id)) throw new Error('Duplicate outbox id'); outboxIds.add(item.id);}
  const runtime = state.runtime;
  for (const key of ['heartbeatAt','startedAt','activeCount','queuedCount','totalRequests','totalCompleted','totalErrors'] as const) if (!number(runtime[key])) throw new Error(`Invalid runtime ${key}`);
  if (typeof runtime.ready !== 'boolean' || typeof state.migratedLegacy !== 'boolean') throw new Error('Invalid runtime flags');
  return state;
}

function validateConversation(id: string, conversation: Conversation): void {
  if (!text(id) || conversation.id !== id || !sessionStates.has(conversation.sessionState) || !Array.isArray(conversation.queue) || typeof conversation.paused !== 'boolean' || typeof conversation.resetNoticePending !== 'boolean' || !number(conversation.createdAt) || !number(conversation.updatedAt)) throw new Error('Invalid conversation');
  const destination = conversation.destination;
  if (!destination || !text(destination.channelId) || (destination.kind === 'guild' ? !text(destination.threadId) || !text(destination.starterMessageId) || !text(destination.guildId) : destination.kind !== 'dm' || !text(destination.userId))) throw new Error('Invalid destination');
  if (new Set(conversation.queue).size !== conversation.queue.length) throw new Error('Duplicate queue request');
}

function validateRequest(id: string, request: RequestRecord, state: AppState): void {
  if (!text(id) || request.id !== id || !text(request.conversationId) || !state.conversations[request.conversationId] || !text(request.sourceMessageId) || typeof request.prompt !== 'string' || !requestStates.has(request.state) || !number(request.acceptedAt)) throw new Error('Invalid request');
  const conversation = state.conversations[request.conversationId];
  if (conversation.activeRequestId === id && conversation.queue.includes(id)) throw new Error('Active request also queued');
}

function validateProgress(item: ProgressItem): void {if (!text(item.id) || !['tool','subagent','notice'].includes(item.kind) || !text(item.name) || !progressStates.has(item.state) || !number(item.updatedAt)) throw new Error('Invalid progress item');}

function validateOutbox(item: OutboxItem, state: AppState): void {
  if (!text(item.id) || !state.conversations[item.conversationId] || (item.requestId && !state.requests[item.requestId]) || !['status','final','notice','file'].includes(item.kind) || !['send','edit'].includes(item.operation) || typeof item.content !== 'string' || !outboxStates.has(item.state) || !number(item.attempts) || !number(item.nextAttemptAt) || !number(item.createdAt)) throw new Error('Invalid outbox item');
  if (item.operation === 'edit' && !text(item.messageId)) throw new Error('Edit missing message id');
  if (item.kind === 'file' && (!Array.isArray(item.files) || item.files.length === 0 || !item.files.every(text))) throw new Error('File item missing files');
}
