import {accessSync, constants} from 'node:fs';
import {join} from 'node:path';

export interface Config {botToken: string; allowedUsers: string[]; guildId?: string; channelName: string; workingDir: string; yolo: boolean; maxTurns: number; timeoutMs: number; stateFile: string; legacyFile: string; lockFile: string; cmdPath: string}

function positiveInt(value: string | undefined, fallback: number): number {const n = Number(value); return Number.isInteger(n) && n > 0 ? n : fallback;}
function executable(path: string): boolean {try {accessSync(path, constants.X_OK); return true;} catch {return false;}}

export function resolveCmdPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.CMD_PATH) return env.CMD_PATH;
  const local = join(env.HOME || '', '.local', 'bin', 'cmd');
  return executable(local) ? local : 'cmd';
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const botToken = env.DISCORD_BOT_TOKEN;
  if (!botToken) throw new Error('DISCORD_BOT_TOKEN is required');
  const allowedRaw = env.DISCORD_ALLOWED_USERS?.trim();
  if (!allowedRaw) throw new Error('DISCORD_ALLOWED_USERS must explicitly list authorized Discord user IDs');
  if (allowedRaw === '*' && env.DISCORD_ALLOW_ALL_USERS !== 'true') throw new Error('Wildcard access requires DISCORD_ALLOW_ALL_USERS=true');
  const allowedUsers = allowedRaw === '*' ? ['*'] : allowedRaw.split(',').map(value => value.trim()).filter(Boolean);
  if (!allowedUsers.length) throw new Error('DISCORD_ALLOWED_USERS must not be empty');
  const home = env.HOME || process.cwd();
  return {botToken, allowedUsers, guildId: env.DISCORD_GUILD_ID || undefined, channelName: env.DISCORD_CHANNEL_NAME || 'command-code', workingDir: env.CMD_WORKING_DIR || process.cwd(), yolo: env.CMD_YOLO === 'true', maxTurns: positiveInt(env.CMD_MAX_TURNS, 100), timeoutMs: positiveInt(env.CMD_TIMEOUT_MS, 30 * 60_000), stateFile: env.DISCORD_STATE_FILE || join(home, '.commandcode', 'discord-runtime.json'), legacyFile: env.DISCORD_LEGACY_STATE_FILE || join(home, '.commandcode', 'discord-threads.json'), lockFile: env.DISCORD_LOCK_FILE || join(home, '.commandcode', 'discord-runtime.lock'), cmdPath: resolveCmdPath(env)};
}

export function isUserAllowed(id: string, allowed: string[]): boolean {return allowed.includes('*') || allowed.includes(id);}
