import type {ChildProcess} from 'child_process';

export interface DiscordModConfig {
  botToken: string;
  allowedUsers: string[];
  guildId?: string;
  workingDir: string;
  yolo: boolean;
  maxTurns: number;
  channelName: string;
  batchDelayMs: number;
}

export interface ThreadSession {
  threadId: string;
  sessionId?: string;
  channelId: string;
  createdAt: number;
  lastActiveAt: number;
  title?: string;
  requestCount: number;
  model?: string;
}

export interface UsageStats {
  totalRequests: number;
  totalSessions: number;
  requestsByGuild: Record<string, number>;
  requestsByUser: Record<string, number>;
  errors: number;
  startTime: number;
  totalTokensInput: number;
  totalTokensOutput: number;
  totalDurationMs: number;
}

export interface ThreadState {
  session: ThreadSession;
  process?: ChildProcess;
  pendingMessages: string[];
  batchTimer?: ReturnType<typeof setTimeout>;
  statusMessage?: string;
  isProcessing: boolean;
}

export interface NdjsonEvent {
  type: 'event';
  event: {
    type: string;
    [key: string]: unknown;
  };
}

export interface NdjsonResult {
  type: 'result';
  subtype: 'success' | 'error' | 'max_turns';
  sessionId?: string;
  stopReason?: string;
  usage?: Record<string, unknown>;
  durationMs?: number;
  finalText?: string;
  error?: string;
}

export interface FormattedOutput {
  content?: string;
  embed?: {
    title?: string;
    description?: string;
    color?: number;
    fields?: Array<{name: string; value: string; inline?: boolean}>;
  };
}
