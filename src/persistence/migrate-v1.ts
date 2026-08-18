import {emptyState, newProgress, type AppState} from '../domain.js';
export interface LegacySession {threadId?: string; channelId?: string; sessionId?: string; title?: string; model?: string; createdAt?: number; lastActiveAt?: number; isProcessing?: boolean}
export function migrateLegacy(value: unknown, now = Date.now()): AppState {
  const state = emptyState(now); state.migratedLegacy = true;
  if (!Array.isArray(value)) return state;
  for (const item of value as LegacySession[]) {
    if (!item.threadId || !item.channelId || item.threadId.startsWith('dm-')) continue;
    const id = `thread:${item.threadId}`;
    state.conversations[id] = {id, destination: {kind: 'guild', channelId: item.channelId, threadId: item.threadId, starterMessageId: item.threadId, guildId: 'legacy'}, title: item.title, model: item.model, sessionId: item.sessionId, sessionState: item.sessionId ? 'usable' : 'fresh', queue: [], paused: Boolean(item.isProcessing), resetNoticePending: Boolean(item.isProcessing), createdAt: item.createdAt || now, updatedAt: item.lastActiveAt || now};
    if (item.isProcessing) {
      const requestId = `legacy-${item.threadId}`;
      state.requests[requestId] = {id: requestId, conversationId: id, sourceMessageId: 'legacy', prompt: '[legacy prompt withheld]', state: 'interrupted_unknown', acceptedAt: item.lastActiveAt || now, finishedAt: now, error: 'Service restarted while this request was active; outcome unknown and work was not repeated.'};
      state.progress[requestId] = newProgress();
      state.outbox.push({id: `recovery-${item.threadId}`, conversationId: id, requestId, kind: 'notice', operation: 'send', content: '⚠️ A request was interrupted by restart. Its outcome is unknown, so no work was repeated. Send a new message to continue with fresh context.', state: 'pending', attempts: 0, nextAttemptAt: now, createdAt: now});
    }
  }
  return state;
}
