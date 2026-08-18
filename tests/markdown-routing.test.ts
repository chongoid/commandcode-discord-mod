import {describe, expect, it} from 'vitest';
import {chunkMarkdown, SAFE_MENTIONS} from '../src/formatting/markdown.js';
import {redact, toolContext} from '../src/formatting/tool-context.js';
import {routeIncoming, stripOwnMention} from '../src/discord/router.js';
import type {Conversation} from '../src/domain.js';

describe('markdown, mentions, and redaction', () => {
  for (const language of ['ts', '']) it(`balances ${language || 'unlabeled'} fenced code`, () => {const chunks = chunkMarkdown(`\`\`\`${language}\r\n${'😀 const x = 1;\r\n'.repeat(300)}\`\`\``, 200); expect(chunks.length).toBeGreaterThan(2); expect(chunks.every(chunk => [...chunk].length <= 200)).toBe(true); expect(chunks.every(chunk => (chunk.match(/```/g) || []).length % 2 === 0)).toBe(true);});
  it('disables mentions and removes only the bot mention', () => {expect(SAFE_MENTIONS).toEqual({parse: [], repliedUser: false}); expect(stripOwnMention('<@123> hi <@456> @everyone', '123')).toBe('hi <@456> @everyone');});
  it('does not expose raw shell commands and redacts recognized secrets', () => {expect(toolContext('shell_command', {description: 'Deploying safely', command: 'curl -H "Authorization: Bearer secret"'})).toBe('Deploying safely'); expect(redact('Authorization: Bearer abc token=xyz https://u:p@example.com?a=1&sig=wow')).not.toMatch(/abc|xyz|u:p|wow/);});
});

describe('routing', () => {
  const conversation: Conversation = {id: 'c', destination: {kind: 'guild', channelId: 't1', threadId: 't1', starterMessageId: 's1', guildId: 'g'}, sessionState: 'fresh', queue: [], paused: false, resetNoticePending: false, createdAt: 1, updatedAt: 1};
  it('routes exact tracked threads and rejects arbitrary siblings', () => {expect(routeIncoming({channelId: 't1', guildId: 'g', userId: 'u', isThread: true, mentionsBot: false}, {c: conversation}).conversationId).toBe('c'); expect(routeIncoming({channelId: 'other', guildId: 'g', userId: 'u', isThread: true, parentChannelId: 'parent', mentionsBot: false}, {c: conversation}).conversationId).toBeUndefined();});
  it('uses real DM channel ids', () => {expect(routeIncoming({channelId: 'real-dm', guildId: null, userId: 'u', isThread: false, mentionsBot: false}, {}).destination).toEqual({kind: 'dm', channelId: 'real-dm', userId: 'u'});});
});
