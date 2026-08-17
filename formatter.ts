import type {NdjsonEvent, NdjsonResult, FormattedOutput} from './types';

const MAX_MESSAGE_LENGTH = 2000;
const MAX_EMBED_FIELD_LENGTH = 1024;
const MAX_CODE_BLOCK_LENGTH = 1900;

export function formatToolRunning(event: NdjsonEvent['event'], input?: unknown): FormattedOutput {
  const toolName = String(event.toolName || 'unknown');
  const description = event.description ? String(event.description) : '';
  const inputPreview = formatInputCompact(toolName, input);

  let text: string;
  if (description && inputPreview) {
    text = `_⏳ ${description} · ${inputPreview}_`;
  } else if (description) {
    text = `_⏳ ${description}_`;
  } else if (inputPreview) {
    text = `_⏳ ${toolName} · ${inputPreview}_`;
  } else {
    text = `_⏳ ${toolName}_`;
  }

  return {toolName, content: text};
}

export function formatToolCompleted(event: NdjsonEvent['event']): FormattedOutput {
  const toolName = String(event.toolName || 'unknown');
  return {toolName, content: `_✅ ${toolName} complete_`};
}

export function formatToolErrored(event: NdjsonEvent['event']): FormattedOutput {
  const toolName = String(event.toolName || 'unknown');
  const error = event.error ? ` · ${truncate(String(event.error), 100)}` : '';
  return {toolName, content: `_❌ ${toolName} failed${error}_`};
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

export function formatResult(result: NdjsonResult): FormattedOutput[] {
  const outputs: FormattedOutput[] = [];

  if (result.subtype === 'error') {
    outputs.push({
      embed: {
        title: 'Session Error',
        description: truncate(result.error || 'Unknown error', 4096),
        color: 0xED4245,
      },
    });
  }

  if (result.finalText) {
    const chunks = splitMessage(result.finalText);
    for (const chunk of chunks) {
      outputs.push({content: chunk});
    }
  }

  if (result.usage) {
    const usage = result.usage as Record<string, unknown>;
    const duration = result.durationMs ? `${(result.durationMs / 1000).toFixed(1)}s` : 'unknown';
    outputs.push({
      embed: {
        title: 'Session Complete',
        color: 0x57F287,
        fields: [
          {name: 'Duration', value: duration, inline: true},
          {name: 'Stop Reason', value: result.stopReason || 'unknown', inline: true},
          {name: 'Tokens', value: formatTokens(usage), inline: true},
        ],
      },
    });
  }

  return outputs;
}

export function formatEvent(event: NdjsonEvent['event']): FormattedOutput | null {
  switch (event.type) {
    case 'tool_running':
      return formatToolRunning(event);
    case 'tool_completed':
      return formatToolCompleted(event);
    case 'tool_errored':
      return formatToolErrored(event);
    default:
      return null;
  }
}

export function splitMessage(text: string): string[] {
  if (text.length <= MAX_MESSAGE_LENGTH) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= MAX_MESSAGE_LENGTH) {
      chunks.push(remaining);
      break;
    }

    // Try to split at paragraph boundary
    let splitIndex = remaining.lastIndexOf('\n\n', MAX_MESSAGE_LENGTH);
    
    // Try line boundary
    if (splitIndex === -1 || splitIndex < MAX_MESSAGE_LENGTH / 2) {
      splitIndex = remaining.lastIndexOf('\n', MAX_MESSAGE_LENGTH);
    }
    
    // Try space boundary
    if (splitIndex === -1 || splitIndex < MAX_MESSAGE_LENGTH / 2) {
      splitIndex = remaining.lastIndexOf(' ', MAX_MESSAGE_LENGTH);
    }

    // Hard cut
    if (splitIndex === -1 || splitIndex < MAX_MESSAGE_LENGTH / 2) {
      splitIndex = MAX_MESSAGE_LENGTH;
    }

    chunks.push(remaining.slice(0, splitIndex));
    remaining = remaining.slice(splitIndex).trimStart();
  }

  return chunks;
}

function formatInputCompact(toolName: string, input: unknown): string {
  if (!input) return '';
  if (typeof input === 'string') return truncate(input, 80);
  try {
    const obj = input as Record<string, unknown>;

    // Agent tool — show description (the sub-agent label)
    if (toolName === 'agent' || toolName === 'explore' || toolName === 'plan') {
      if (obj.description) return truncate(String(obj.description), 80);
      if (obj.prompt) return truncate(String(obj.prompt).split('\n')[0], 80);
    }

    // File tools — show path(s)
    if (toolName === 'read_file' || toolName === 'edit_file' || toolName === 'write_file') {
      if (obj.file_path) return String(obj.file_path);
      if (obj.paths && Array.isArray(obj.paths)) {
        const paths = obj.paths as string[];
        if (paths.length === 1) return paths[0];
        return `${paths[0]} +${paths.length - 1} more`;
      }
    }

    // Shell — show command
    if (toolName === 'shell_command' || toolName === 'monitor_command') {
      if (obj.command) return truncate(String(obj.command), 80);
    }

    // Search tools — show pattern
    if (toolName === 'grep' || toolName === 'glob') {
      if (obj.pattern) return truncate(String(obj.pattern), 80);
    }

    // Web tools
    if (toolName === 'web_search') {
      if (obj.query) return truncate(String(obj.query), 80);
    }
    if (toolName === 'web_fetch') {
      if (obj.url) return truncate(String(obj.url), 80);
    }

    // Generic fallbacks — first meaningful field
    for (const key of ['description', 'command', 'file_path', 'pattern', 'query', 'question', 'content']) {
      if (obj[key] != null && typeof obj[key] === 'string') return truncate(obj[key] as string, 80);
    }

    return '';
  } catch {
    return '';
  }
}

function formatInput(input: unknown): string {
  if (typeof input === 'string') return input;
  try {
    const obj = input as Record<string, unknown>;
    const parts: string[] = [];
    for (const [key, value] of Object.entries(obj)) {
      if (key === 'command' || key === 'file_path' || key === 'pattern' || key === 'content' || key === 'question') {
        const str = typeof value === 'string' ? value : JSON.stringify(value);
        parts.push(`**${key}:** ${str.length > 200 ? str.slice(0, 200) + '...' : str}`);
      }
    }
    return parts.join('\n') || '';
  } catch {
    return '';
  }
}

function extractResultText(result: unknown): string {
  if (!result) return '';
  if (typeof result === 'string') return result;

  try {
    const obj = result as Record<string, unknown>;

    // Tool result format: {ok: true, content: [{type: 'text', text: '...'}]}
    if (Array.isArray(obj.content)) {
      return obj.content
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.text)
        .join('\n')
        .slice(0, MAX_EMBED_FIELD_LENGTH);
    }

    // Simple text field
    if (typeof obj.text === 'string') return obj.text;
    if (typeof obj.result === 'string') return obj.result;
    if (typeof obj.output === 'string') return obj.output;

    // Error format
    if (typeof obj.error === 'string') return `Error: ${obj.error}`;

    return '';
  } catch {
    return '';
  }
}

function formatTokens(usage: Record<string, unknown>): string {
  // Handle both camelCase (from cmd NDJSON) and snake_case formats
  const input = usage.inputTokens ?? usage.input_tokens ?? usage.prompt_tokens ?? 0;
  const output = usage.outputTokens ?? usage.output_tokens ?? usage.completion_tokens ?? 0;
  const cacheRead = usage.cacheReadTokens ?? usage.cache_read_tokens ?? 0;

  const parts = [`${Number(input).toLocaleString()} in`, `${Number(output).toLocaleString()} out`];
  if (cacheRead) parts.push(`${Number(cacheRead).toLocaleString()} cached`);
  return parts.join(' / ');
}
