import type {ModApi} from '@commandcode/harness';
import {DiscordBot} from './bot';
import {loadConfig} from './config';

let bot: DiscordBot | null = null;
let botStarted = false;

function isHeadless(): boolean {
  // Detect if we're running in headless/print mode (-p flag)
  return process.argv.includes('-p') || process.argv.includes('--print');
}

export default function(cmd: ModApi): void {
  // Don't start Discord bot in headless mode — it would create a recursive loop
  // and pollute stdout with non-NDJSON output
  if (isHeadless()) {
    return;
  }

  // Register configuration flags
  cmd.addFlag('discord-token', {
    type: 'string',
    description: 'Discord bot token (or set DISCORD_BOT_TOKEN env var)',
  });

  cmd.addFlag('discord-allowed-users', {
    type: 'string',
    description: 'Comma-separated user IDs, or * for all (or set DISCORD_ALLOWED_USERS env var)',
  });

  // Register slash commands for TUI
  cmd.addCommand({
    name: 'discord-status',
    description: 'Show Discord bot connection status',
    handler: () => ({
      message: bot ? bot.getStatus() : 'Discord bot not started',
    }),
  });

  cmd.addCommand({
    name: 'discord-sessions',
    description: 'List Discord sessions (resumable from terminal)',
    handler: () => {
      if (!bot) return {message: 'Discord bot not started'};
      const sessions = (bot as any).bridge?.getSessionList?.() || [];
      if (sessions.length === 0) return {message: 'No Discord sessions found'};
      const lines = sessions.map((s: any) =>
        `• ${s.title || 'untitled'} → cmd --resume ${s.sessionId || 'pending'}`
      );
      return {message: `Discord Sessions:\n${lines.join('\n')}`};
    },
  });

  // Register lifecycle hooks
  cmd.hooks({
    onSessionStart: ({source}) => {
      if (botStarted) return;

      try {
        const config = loadConfig();
        bot = new DiscordBot(config);

        // Update status in TUI
        bot.onStatusChange((status) => {
          cmd.ui.setStatus(`Discord: ${status}`);
        });

        // Start bot (fire-and-forget)
        bot.start().catch((err) => {
          cmd.ui.notify(`Discord bot failed to start: ${err.message}`, 'warning');
          bot = null;
          botStarted = false;
        });

        botStarted = true;
        cmd.ui.notify('Discord bot starting...', 'info');
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        cmd.ui.notify(`Discord config error: ${message}`, 'warning');
      }
    },

    onSessionEnd: ({reason}) => {
      if (reason === 'shutdown' && bot) {
        bot.stop().catch(() => {});
        bot = null;
        botStarted = false;
      }
    },
  });

  // Observe events for status updates
  cmd.on('session_start', () => {
    if (bot) {
      cmd.ui.setStatus(`Discord: ${bot.getStatus()}`);
    }
  });

  cmd.on('run_end', () => {
    if (bot) {
      cmd.ui.setStatus(`Discord: ${bot.getStatus()}`);
    }
  });
}
