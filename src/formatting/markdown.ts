import type {MessageMentionOptions} from 'discord.js';

export const SAFE_MENTIONS: MessageMentionOptions = {parse: [], repliedUser: false};

function length(value: string): number {return [...value].length;}
function slice(value: string, start: number, end?: number): string {return [...value].slice(start, end).join('');}

export function chunkMarkdown(text: string, limit = 2000): string[] {
  if (!text) return [''];
  const chunks: string[] = [];
  let rest = text.replace(/\r\n/g, '\n');
  let fence: {language: string} | undefined;
  while (rest) {
    const prefix = fence ? `\`\`\`${fence.language}\n` : '';
    const suffix = fence ? '\n```' : '';
    const room = limit - length(prefix) - Math.max(length(suffix), 4);
    let take = Math.min(length(rest), room);
    if (take < length(rest)) {
      const candidate = slice(rest, 0, take);
      const boundaries = [candidate.lastIndexOf('\n\n'), candidate.lastIndexOf('\n'), candidate.lastIndexOf(' ')].filter(index => index > room / 2);
      if (boundaries.length) take = length(candidate.slice(0, boundaries[0]));
    }
    const body = slice(rest, 0, take);
    rest = slice(rest, take).replace(/^\s+/, match => match.includes('\n') ? '\n' : '');
    for (const match of body.matchAll(/```([^\n`]*)/g)) fence = fence ? undefined : {language: match[1] || ''};
    chunks.push(`${prefix}${body}${fence ? '\n```' : ''}`);
  }
  return chunks;
}
