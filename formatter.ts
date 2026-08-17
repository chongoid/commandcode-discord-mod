import type {NdjsonEvent, NdjsonResult, FormattedOutput} from './types';

const MAX_MESSAGE_LENGTH = 2000;
const MAX_EMBED_FIELD_LENGTH = 1024;
const MAX_CODE_BLOCK_LENGTH = 1900;

export function formatToolRunning(event: NdjsonEvent['event']): FormattedOutput {
  const toolName = event.toolName || 'unknown';
  const description = event.description || '';
  const input = event.input ? formatInput(event.input) : '';

  return {
    embed: {
      title: `Running \`${toolName}\``,
      description: description || undefined,
      color: 0x5865F2, // Discord blurple
      fields: input ? [{name: 'Input', value: truncate(input, MAX_EMBED_FIELD_LENGTH)}] : undefined,
    },
  };
}

export function formatToolCompleted(event: NdjsonEvent['event']): FormattedOutput {
  const toolName = event.toolName || 'unknown';
  const result = event.result;
  const resultText = extractResultText(result);

  return {
    embed: {
      title: `\`${toolName}\` complete`,
      color: 0x57F287,
      fields: resultText ? [{name: 'Result', value: truncate(resultText, MAX_EMBED_FIELD_LENGTH)}] : undefined,
    },
  };
}

export function formatToolErrored(event: NdjsonEvent['event']): FormattedOutput {
  const toolName = event.toolName || 'unknown';
  const error = event.error || 'Unknown error';

  return {
    embed: {
      title: `\`${toolName}\` failed`,
      description: truncate(String(error), 4096),
      color: 0xED4245, // Red
    },
  };
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

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}
