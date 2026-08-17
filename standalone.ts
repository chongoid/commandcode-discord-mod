#!/usr/bin/env node

/**
 * Standalone Discord bot entry point.
 * Runs independently of Command Code — spawns `cmd -p` for each request.
 *
 * Usage:
 *   DISCORD_BOT_TOKEN=xxx npx tsx standalone.ts
 *   # or build and run:
 *   npx tsc && node dist/standalone.js
 */

import {DiscordBot} from './bot';
import {loadConfig} from './config';

async function main() {
  console.log('Starting Command Code Discord bot (standalone mode)...');

  let config;
  try {
    config = loadConfig();
  } catch (err) {
    console.error('Configuration error:', err instanceof Error ? err.message : err);
    console.error('\nRequired environment variables:');
    console.error('  DISCORD_BOT_TOKEN — Discord bot token');
    console.error('\nOptional:');
    console.error('  DISCORD_ALLOWED_USERS — Comma-separated user IDs, or * (default: *)');
    console.error('  DISCORD_GUILD_ID — Specific guild ID (default: all guilds)');
    console.error('  CMD_WORKING_DIR — Working directory for sessions (default: cwd)');
    console.error('  CMD_YOLO — Enable all tools: true/false (default: true)');
    console.error('  CMD_MAX_TURNS — Max turns per session (default: 100)');
    process.exit(1);
  }

  const bot = new DiscordBot(config);

  bot.onStatusChange((status) => {
    console.log(`[Status] ${status}`);
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\nShutting down...');
    await bot.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  try {
    await bot.start();
    console.log('Bot is running. Press Ctrl+C to stop.');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    if (message.includes('disallowed intents')) {
      console.error('\n╔══════════════════════════════════════════════════════════════════╗');
      console.error('║  PRIVILEGED INTENTS REQUIRED                                     ║');
      console.error('╠══════════════════════════════════════════════════════════════════╣');
      console.error('║                                                                  ║');
      console.error('║  Your bot needs privileged intents enabled.                      ║');
      console.error('║                                                                  ║');
      console.error('║  1. Go to: https://discord.com/developers/applications           ║');
      console.error('║  2. Select your bot application                                  ║');
      console.error('║  3. Go to "Bot" section (left sidebar)                           ║');
      console.error('║  4. Scroll to "Privileged Gateway Intents"                       ║');
      console.error('║  5. Enable BOTH toggles:                                         ║');
      console.error('║     ✓ SERVER MEMBERS INTENT                                      ║');
      console.error('║     ✓ MESSAGE CONTENT INTENT  ← Most important!                 ║');
      console.error('║  6. Click "Save Changes" at the bottom                           ║');
      console.error('║                                                                  ║');
      console.error('║  IMPORTANT: Changes may take a few minutes to propagate.         ║');
      console.error('║  Try again in 1-2 minutes if you just saved.                    ║');
      console.error('║                                                                  ║');
      console.error('╚══════════════════════════════════════════════════════════════════╝');
    } else {
      console.error('Failed to start bot:', message);
    }
    process.exit(1);
  }
}

main();
