import type {ProgressItem, ProgressSnapshot, ProgressState} from '../domain.js';
import {toolContext} from '../formatting/tool-context.js';

const terminal = new Set(['tool_completed', 'tool_errored', 'tool_denied', 'tool_hook_blocked']);
function state(type: string): ProgressState {if (type === 'tool_completed' || type === 'subagent_stop') return 'completed'; if (type === 'tool_errored') return 'errored'; if (type === 'tool_denied') return 'denied'; if (type === 'tool_hook_blocked') return 'hook_blocked'; if (type === 'tool_queued') return 'queued'; return 'running';}

export function reduceProgress(snapshot: ProgressSnapshot, event: {type: string; [key: string]: unknown}, now = Date.now()): ProgressSnapshot {
  const next = structuredClone(snapshot);
  next.lastActivityAt = now;
  if (event.type === 'run_start') {next.phase = 'starting'; next.lastActivity = 'Starting the coding agent';}
  else if (event.type === 'turn_start') {next.phase = 'requesting_model'; next.turn = numeric(event.turnNumber) ?? next.turn; next.lastActivity = `Starting model turn${next.turn ? ` ${next.turn}` : ''}`;}
  else if (event.type === 'model_request_start') {next.phase = 'requesting_model'; next.model = string(event.model) ?? next.model; next.lastActivity = `Waiting for ${next.model || 'the model'} to respond`;}
  else if (event.type === 'text_delta' || event.type === 'message_update') {next.phase = 'receiving_response'; next.lastActivity = 'Receiving the model response';}
  else if (event.type === 'model_request_end' || event.type === 'message_end') {next.phase = 'between_turns'; next.lastActivity = 'Processing the model response';}
  else if (event.type === 'turn_end') {next.phase = 'between_turns'; next.lastActivity = 'Preparing the next step';}
  else if (event.type.startsWith('tool_')) {
    const id = String(event.toolCallId || ''); if (!id) return next;
    const old = next.tools[id];
    const item: ProgressItem = {id, kind: 'tool', name: String(event.toolName || old?.name || 'tool'), context: toolContext(String(event.toolName || old?.name || ''), event.input) || old?.context, state: state(event.type), updatedAt: now};
    next.tools[id] = item; next.phase = event.type === 'tool_completed' || event.type === 'tool_errored' ? 'between_turns' : 'running_tools'; next.lastActivity = `${item.state === 'completed' ? 'Completed' : item.state === 'running' ? 'Running' : 'Updated'} ${item.name}`;
    if (terminal.has(event.type) || event.type === 'tool_running') addRecent(next, item);
  } else if (event.type.startsWith('subagent_')) {
    const id = String(event.subagentId || event.agentId || event.toolCallId || 'agent'); const old = next.subagents[id];
    const item: ProgressItem = {id, kind: 'subagent', name: String(event.name || event.description || old?.name || 'agent'), context: typeof event.message === 'string' ? event.message : old?.context, state: state(event.type), updatedAt: now};
    next.subagents[id] = item; next.phase = item.state === 'completed' ? 'between_turns' : 'running_tools'; next.lastActivity = `${item.state === 'completed' ? 'Completed' : 'Running'} subagent ${item.name}`; addRecent(next, item);
  } else if (event.type === 'api_retry') {
    const attempt = numeric(event.attempt); const delay = numeric(event.delayMs); const notice = `Model request retry${attempt ? ` ${attempt}` : ''}${delay ? ` in ${Math.ceil(delay / 1000)}s` : ''}`; next.notices = [...next.notices, notice].slice(-3); next.phase = 'requesting_model'; next.lastActivity = notice; addRecent(next, {id: `retry-${attempt || now}`, kind: 'notice', name: notice, state: 'running', updatedAt: now});
  } else if (event.type === 'compaction_start') {next.lastActivity = 'Compacting conversation context'; addRecent(next, {id: `compaction-${now}`, kind: 'notice', name: 'Compacting conversation context', state: 'running', updatedAt: now});}
  else if (event.type === 'compaction_done') {next.lastActivity = 'Conversation context compacted'; addRecent(next, {id: 'compaction-done', kind: 'notice', name: 'Conversation context compacted', state: 'completed', updatedAt: now});}
  else if (event.type === 'continuation_recovery') {next.phase = 'requesting_model'; next.lastActivity = 'Recovering an incomplete model response';}
  else if (event.type === 'notice') {const notice = String(event.message || 'Runtime notice').slice(0, 120); next.notices = [...next.notices, notice].slice(-3); next.lastActivity = notice; addRecent(next, {id: `notice-${now}`, kind: 'notice', name: notice, state: 'running', updatedAt: now});}
  return next;
}

function addRecent(snapshot: ProgressSnapshot, item: ProgressItem): void {snapshot.recent = [...snapshot.recent.filter(entry => entry.id !== item.id), item].slice(-5);}
function numeric(value: unknown): number | undefined {return typeof value === 'number' && Number.isFinite(value) ? value : undefined;}
function string(value: unknown): string | undefined {return typeof value === 'string' && value.trim() ? value.trim().slice(0, 60) : undefined;}
