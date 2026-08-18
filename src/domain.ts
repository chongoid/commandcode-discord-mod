export const STATE_VERSION = 2 as const;

export type RequestState = 'queued' | 'starting' | 'running' | 'cancelling' | 'completed' | 'errored' | 'cancelled' | 'interrupted_unknown' | 'delivered';
export type SessionState = 'fresh' | 'usable' | 'reset_required';
export type Destination =
  | {kind: 'guild'; channelId: string; threadId: string; starterMessageId: string; guildId: string}
  | {kind: 'dm'; channelId: string; userId: string};
export type ProgressState = 'queued' | 'running' | 'completed' | 'errored' | 'denied' | 'hook_blocked';
export type OutboxState = 'pending' | 'in_flight' | 'delivered' | 'retryable_error' | 'permanent_error';

export interface ProgressItem {id: string; kind: 'tool' | 'subagent' | 'notice'; name: string; context?: string; state: ProgressState; updatedAt: number}
export type RunPhase = 'starting' | 'requesting_model' | 'receiving_response' | 'running_tools' | 'between_turns';
export interface ProgressSnapshot {tools: Record<string, ProgressItem>; subagents: Record<string, ProgressItem>; recent: ProgressItem[]; notices: string[]; phase?: RunPhase; turn?: number; model?: string; lastActivityAt?: number; lastActivity?: string}
export interface RequestRecord {id: string; conversationId: string; sourceMessageId: string; prompt: string; state: RequestState; queuePosition?: number; acceptedAt: number; startedAt?: number; finishedAt?: number; attemptId?: string; statusMessageId?: string; finalText?: string; error?: string; sessionIdAtStart?: string}
export interface Conversation {id: string; destination: Destination; title?: string; model?: string; sessionId?: string; sessionState: SessionState; activeRequestId?: string; queue: string[]; paused: boolean; resetNoticePending: boolean; createdAt: number; updatedAt: number}
export type OutboxKind = 'status' | 'final' | 'notice';
export interface OutboxItem {id: string; conversationId: string; requestId?: string; kind: OutboxKind; operation: 'send' | 'edit'; content: string; messageId?: string; chunkIndex?: number; state: OutboxState; deliveredAt?: number; attempts: number; nextAttemptAt: number; lastError?: string; createdAt: number}
export interface RuntimeSnapshot {instanceId?: string; pid?: number; ready: boolean; heartbeatAt: number; startedAt: number; activeCount: number; queuedCount: number; lastError?: string; totalRequests: number; totalCompleted: number; totalErrors: number}
export interface AppState {version: typeof STATE_VERSION; conversations: Record<string, Conversation>; requests: Record<string, RequestRecord>; progress: Record<string, ProgressSnapshot>; outbox: OutboxItem[]; runtime: RuntimeSnapshot; migratedLegacy: boolean}

export function emptyState(now = Date.now()): AppState {
  return {version: STATE_VERSION, conversations: {}, requests: {}, progress: {}, outbox: [], runtime: {ready: false, heartbeatAt: now, startedAt: now, activeCount: 0, queuedCount: 0, totalRequests: 0, totalCompleted: 0, totalErrors: 0}, migratedLegacy: false};
}

export function newProgress(): ProgressSnapshot {return {tools: {}, subagents: {}, recent: [], notices: [], phase: 'starting'};}
