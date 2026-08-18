import type {AppState, Destination} from './domain.js';
import type {RunnerEvent, RunnerOutcome, RunOptions} from './agent/cmd-runner.js';

export interface StateStore {load(): Promise<AppState>; save(state: AppState): Promise<void>}
export interface DeliveryReceipt {messageId: string}
export interface DiscordPort {
  send(destination: Destination, content: string, nonce: string): Promise<DeliveryReceipt>;
  edit(destination: Destination, messageId: string, content: string): Promise<void>;
  typing(destination: Destination): Promise<void>;
  isPermanentError?(error: unknown): boolean;
}
export interface RunnerPort {run(options: RunOptions, onEvent: (event: RunnerEvent) => void): Promise<RunnerOutcome>; cancel(attemptId: string): Promise<boolean>; shutdown(): Promise<void>}
