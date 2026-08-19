import {accessSync, constants} from 'node:fs';
import {join} from 'node:path';

export interface Config {botToken: string; allowedUsers: string[]; allowedRoles: string[]; guildId?: string; channelName: string; workingDir: string; yolo: boolean; maxTurns: number; timeoutMs: number; stateFile: string; legacyFile: string; lockFile: string; cmdPath: string; whisper: {enabled: boolean; binary: string; model: string; language: string; timeoutMs: number; ffmpegPath: string; minTokenProb: number}}

function positiveInt(value: string | undefined, fallback: number): number {const n = Number(value); return Number.isInteger(n) && n > 0 ? n : fallback;}
function executable(path: string): boolean {try {accessSync(path, constants.X_OK); return true;} catch {return false;}}

export function resolveCmdPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.CMD_PATH) return env.CMD_PATH;
  const local = join(env.HOME || '', '.local', 'bin', 'cmd');
  return executable(local) ? local : 'cmd';
}

function positiveFloat(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : fallback;
}

/** Resolve the self-contained whisper.cpp transcription settings. */
export function resolveWhisperConfig(env: NodeJS.ProcessEnv = process.env): Config['whisper'] {
  const home = env.HOME || '';
  const baseDir = env.WHISPER_DIR || join(home, '.commandcode', 'whisper');
  const binary = env.WHISPER_BINARY || join(baseDir, 'bin', 'whisper-cli');
  const model = env.WHISPER_MODEL || join(baseDir, 'models', 'ggml-base.bin');
  return {
    enabled: env.WHISPER_ENABLED !== 'false',
    binary,
    model,
    language: env.WHISPER_LANGUAGE || 'auto',
    timeoutMs: positiveInt(env.WHISPER_TIMEOUT_MS, 120_000),
    ffmpegPath: env.WHISPER_FFMPEG || 'ffmpeg',
    minTokenProb: positiveFloat(env.WHISPER_MIN_TOKEN_PROB, 0.4),
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const botToken = env.DISCORD_BOT_TOKEN;
  if (!botToken) throw new Error('DISCORD_BOT_TOKEN is required');
  const allowedRaw = env.DISCORD_ALLOWED_USERS?.trim();
  if (allowedRaw === '*' && env.DISCORD_ALLOW_ALL_USERS !== 'true') throw new Error('Wildcard access requires DISCORD_ALLOW_ALL_USERS=true');
  const allowedUsers = allowedRaw ? (allowedRaw === '*' ? ['*'] : allowedRaw.split(',').map(value => value.trim()).filter(Boolean)) : [];
  const allowedRoles = (env.DISCORD_ALLOWED_ROLES || '').split(',').map(value => value.trim()).filter(Boolean);
  const home = env.HOME || process.cwd();
  return {botToken, allowedUsers, allowedRoles, guildId: env.DISCORD_GUILD_ID || undefined, channelName: env.DISCORD_CHANNEL_NAME || 'command-code', workingDir: env.CMD_WORKING_DIR || process.cwd(), yolo: env.CMD_YOLO === 'true', maxTurns: positiveInt(env.CMD_MAX_TURNS, 100), timeoutMs: positiveInt(env.CMD_TIMEOUT_MS, 30 * 60_000), stateFile: env.DISCORD_STATE_FILE || join(home, '.commandcode', 'discord-runtime.json'), legacyFile: env.DISCORD_LEGACY_STATE_FILE || join(home, '.commandcode', 'discord-threads.json'), lockFile: env.DISCORD_LOCK_FILE || join(home, '.commandcode', 'discord-runtime.lock'), cmdPath: resolveCmdPath(env), whisper: resolveWhisperConfig(env)};
}

export function isUserAllowed(id: string, allowed: string[]): boolean {return allowed.includes('*') || allowed.includes(id);}

/** Role names/ids are matched by id first, then case-insensitive name. */
export function hasAllowedRole(memberRoles: Iterable<{id: string; name: string}>, allowedRoles: string[]): boolean {
  if (!allowedRoles.length) return false;
  for (const role of memberRoles) {
    if (allowedRoles.some(allowed => role.id === allowed || (role.name && role.name.toLowerCase() === allowed.toLowerCase()))) return true;
  }
  return false;
}

/**
 * Admission for a user. Explicit whitelists (users and/or roles) are OR'd together.
 * If neither is configured, the bot is open and replies to anyone, by default.
 */
export function isAuthorized(id: string, memberRoles: Iterable<{id: string; name: string}>, cfg: {allowedUsers: string[]; allowedRoles: string[]}): boolean {
  if (cfg.allowedUsers.includes('*')) return true;
  if (cfg.allowedUsers.includes(id)) return true;
  if (hasAllowedRole(memberRoles, cfg.allowedRoles)) return true;
  if (cfg.allowedUsers.length === 0 && cfg.allowedRoles.length === 0) return true; // open by default
  return false;
}
