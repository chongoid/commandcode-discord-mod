import type {DiscordModConfig} from './types';

export function loadConfig(): DiscordModConfig {
  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!botToken) {
    throw new Error('DISCORD_BOT_TOKEN environment variable is required');
  }

  const allowedUsersRaw = process.env.DISCORD_ALLOWED_USERS || '*';
  const allowedUsers = allowedUsersRaw === '*'
    ? ['*']
    : allowedUsersRaw.split(',').map(id => id.trim()).filter(Boolean);

  return {
    botToken,
    allowedUsers,
    guildId: process.env.DISCORD_GUILD_ID || undefined,
    workingDir: process.env.CMD_WORKING_DIR || process.cwd(),
    yolo: process.env.CMD_YOLO !== 'false',
    maxTurns: parseInt(process.env.CMD_MAX_TURNS || '100', 10),
    channelName: process.env.DISCORD_CHANNEL_NAME || 'command-code',
    batchDelayMs: parseInt(process.env.DISCORD_BATCH_DELAY_MS || '600', 10),
  };
}

export function isUserAllowed(userId: string, allowedUsers: string[]): boolean {
  return allowedUsers.includes('*') || allowedUsers.includes(userId);
}
