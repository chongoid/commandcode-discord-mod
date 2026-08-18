import type {ProgressSnapshot, RequestRecord} from '../domain.js';
const icon: Record<string,string> = {queued:'○',running:'↻',completed:'✓',errored:'✗',denied:'⊘',hook_blocked:'⊘'};

export function renderStatus(request: RequestRecord, progress: ProgressSnapshot, now = Date.now()): string {
  const duration = Math.max(0, Math.round((now - (request.startedAt || request.acceptedAt)) / 1000));
  const terminal = ['completed','errored','cancelled','interrupted_unknown','delivered'].includes(request.state);
  const heading = request.state === 'delivered' ? '🟢 Completed' : request.state === 'completed' ? '🟢 Completed · delivering response' : request.state === 'errored' ? '🔴 Failed' : request.state === 'cancelled' ? '⚫ Cancelled' : request.state === 'interrupted_unknown' ? '🟠 Interrupted · outcome unknown' : request.state === 'queued' ? '🟡 Queued' : request.state === 'cancelling' ? '🟠 Cancelling' : '🔵 Working';
  const running = [...Object.values(progress.tools), ...Object.values(progress.subagents)].filter(item => item.state === 'running').sort((a,b) => b.updatedAt-a.updatedAt)[0];
  const lines = [`${heading} · ${duration}s${request.state === 'queued' && request.queuePosition ? ` · position ${request.queuePosition}` : ''}`];
  if (!terminal) {
    if (running) lines.push(`Now: ${running.name}${running.context ? ` · ${running.context}` : ''}`);
    else lines.push(`Now: ${phaseText(progress)}`);
    const context = [progress.turn ? `turn ${progress.turn}` : '', progress.model ? `model ${progress.model}` : ''].filter(Boolean).join(' · ');
    if (context) lines.push(`Context: ${context}`);
    const activityAge = progress.lastActivityAt ? Math.max(0, Math.round((now - progress.lastActivityAt) / 1000)) : duration;
    lines.push(`Last activity: ${progress.lastActivity || 'Agent started'} · ${activityAge}s ago`);
    if (activityAge >= 30 && progress.phase === 'requesting_model') lines.push('Still connected — model responses can take several minutes for complex work.');
    else if (activityAge >= 30) lines.push('Still connected — waiting for the next agent event.');
  }
  if (progress.recent.length) {lines.push('Recent:'); for (const item of progress.recent.slice(-4)) lines.push(`• ${icon[item.state]} ${item.name}${item.context ? ` · ${item.context}` : ''}`);}
  const tools = Object.values(progress.tools); const subagents = Object.values(progress.subagents); const count = (items: typeof tools, states: string[]) => items.filter(item => states.includes(item.state)).length;
  if (tools.length) lines.push(`Tools: ${count(tools,['running','queued'])} active · ${count(tools,['completed'])} complete · ${count(tools,['errored','denied','hook_blocked'])} failed/blocked`);
  if (subagents.length) lines.push(`Subagents: ${count(subagents,['running','queued'])} active · ${count(subagents,['completed'])} complete`);
  if (request.state === 'delivered') lines.push('Final response posted below.');
  else if (request.state === 'completed') lines.push('Final response is pending delivery.');
  else if (terminal && request.error) lines.push(request.error);
  return lines.join('\n').slice(0, 2000);
}

function phaseText(progress: ProgressSnapshot): string {
  if (progress.phase === 'requesting_model') return `Waiting for ${progress.model || 'the model'} to respond`;
  if (progress.phase === 'receiving_response') return 'Receiving the model response';
  if (progress.phase === 'running_tools') return 'Waiting for tool activity';
  if (progress.phase === 'between_turns') return 'Processing results and choosing the next step';
  return 'Starting the coding agent';
}
