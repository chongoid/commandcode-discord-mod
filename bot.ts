import {
  Client,
  GatewayIntentBits,
  ChannelType,
  PermissionsBitField,
  SlashCommandBuilder,
  REST,
  Routes,
  type Message,
  type ThreadChannel,
  type TextChannel,
  type Guild,
  type Interaction,
  type DMChannel,
} from 'discord.js';
import type {DiscordModConfig, NdjsonEvent, NdjsonResult, UsageStats} from './types';
import {SessionBridge, type SessionCallbacks} from './session-bridge';
import {formatToolRunning, formatToolCompleted, formatToolErrored, formatResult, splitMessage} from './formatter';
import {isUserAllowed} from './config';

const REQUIRED_PERMISSIONS = [
  PermissionsBitField.Flags.ViewChannel,
  PermissionsBitField.Flags.SendMessages,
  PermissionsBitField.Flags.CreatePublicThreads,
  PermissionsBitField.Flags.SendMessagesInThreads,
  PermissionsBitField.Flags.ReadMessageHistory,
  PermissionsBitField.Flags.AddReactions,
  PermissionsBitField.Flags.ManageChannels,
];

export class DiscordBot {
  private client: Client;
  private bridge: SessionBridge;
  private config: DiscordModConfig;
  private trackedThreads = new Set<string>();
  private messageBuffers = new Map<string, {messages: string[]; timer?: ReturnType<typeof setTimeout>; lastMessage?: Message}>();
  private statusCallbacks: Array<(status: string) => void> = [];
  private messageQueue: Array<() => Promise<unknown>> = [];
  private queueProcessing = false;
  private maxRetries = 3;
  private stats: UsageStats;
  private archiveInterval?: ReturnType<typeof setInterval>;

  constructor(config: DiscordModConfig) {
    this.config = config;
    this.bridge = new SessionBridge(config);
    this.stats = {
      totalRequests: 0,
      totalSessions: 0,
      requestsByGuild: {},
      requestsByUser: {},
      errors: 0,
      startTime: Date.now(),
      totalTokensInput: 0,
      totalTokensOutput: 0,
      totalDurationMs: 0,
    };

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.DirectMessages,
      ],
    });

    this.setupEventHandlers();
  }

  onStatusChange(callback: (status: string) => void): void {
    this.statusCallbacks.push(callback);
  }

  getStatus(): string {
    const ready = this.client.isReady();
    const guilds = this.client.guilds.cache.size;
    const threads = this.trackedThreads.size;
    return ready
      ? `Connected (${guilds} guilds, ${threads} threads, ${this.stats.totalRequests} requests)`
      : 'Disconnected';
  }

  getStats(): UsageStats {
    return {...this.stats};
  }

  async start(): Promise<void> {
    await this.client.login(this.config.botToken);
  }

  async stop(): Promise<void> {
    if (this.archiveInterval) clearInterval(this.archiveInterval);
    this.client.destroy();
  }

  private updateStatus(status: string): void {
    for (const cb of this.statusCallbacks) {
      cb(status);
    }
  }

  // ── Rate Limit Handling ──────────────────────────────────────────────
  private async enqueueMessage(fn: () => Promise<unknown>): Promise<void> {
    this.messageQueue.push(fn);
    if (!this.queueProcessing) {
      this.processQueue();
    }
  }

  private async processQueue(): Promise<void> {
    this.queueProcessing = true;
    while (this.messageQueue.length > 0) {
      const fn = this.messageQueue.shift();
      if (fn) {
        let retries = 0;
        while (retries < this.maxRetries) {
          try {
            await fn();
            break;
          } catch (err) {
            if ((err as any)?.code === 50013 || (err as any)?.status === 429) {
              retries++;
              const retryAfter = (err as any)?.retryAfter || 1000;
              await new Promise(r => setTimeout(r, retryAfter * retries));
            } else {
              break; // Non-rate-limit error, don't retry
            }
          }
        }
        await new Promise(r => setTimeout(r, 100));
      }
    }
    this.queueProcessing = false;
  }

  private async sendQueued(channel: {send: Function}, content: any): Promise<void> {
    await this.enqueueMessage(() => channel.send(content) as Promise<unknown>);
  }

  // ── Event Handlers ──────────────────────────────────────────────────
  private setupEventHandlers(): void {
    this.client.once('ready', async () => {
      console.log(`Discord bot ready as ${this.client.user?.tag}`);
      this.updateStatus(`Connected as ${this.client.user?.tag}`);

      await this.registerSlashCommands();
      await this.ensureCommandCodeChannels();
      this.checkBotPermissions();
      this.startThreadArchival();
    });

    this.client.on('guildCreate', async (guild) => {
      await this.handleGuildJoin(guild);
    });

    this.client.on('messageCreate', async (message) => {
      await this.handleMessage(message);
    });

    this.client.on('interactionCreate', async (interaction) => {
      await this.handleInteraction(interaction);
    });

    this.client.on('error', (err) => {
      console.error('[Discord Error]', err.message);
    });
  }

  // ── Guild Join & Welcome ─────────────────────────────────────────────
  private async handleGuildJoin(guild: Guild): Promise<void> {
    console.log(`Joined guild: ${guild.name} (${guild.id})`);
    this.stats.requestsByGuild[guild.id] = 0;

    // Create channel and send welcome message
    try {
      const channel = await guild.channels.create({
        name: this.config.channelName,
        type: ChannelType.GuildText,
        reason: 'Command Code Discord integration',
      });

      const welcome = [
        '**👋 Command Code is ready!**',
        '',
        'Mention me in this channel to start a coding session.',
        'Each @mention creates a new thread with its own session.',
        '',
        '**Quick Start:**',
        '• `@Command Code` + your question to start',
        '• Reply in threads to continue conversations',
        '• `/help` for all commands',
        '',
        'Sessions are full coding agents — they can read/write files, run commands, and more.',
      ].join('\n');

      await channel.send(welcome);
      console.log(`Created #${this.config.channelName} in ${guild.name} with welcome message`);
    } catch (error) {
      console.error(`Failed to create channel in ${guild.name}:`, error);
    }
  }

  // ── Permission Check ─────────────────────────────────────────────────
  private checkBotPermissions(): void {
    for (const [, guild] of this.client.guilds.cache) {
      const botMember = guild.members.me;
      if (!botMember) continue;

      const missing: string[] = [];
      for (const perm of REQUIRED_PERMISSIONS) {
        if (!botMember.permissions.has(perm)) {
          missing.push(new PermissionsBitField(perm).toArray().join(', '));
        }
      }

      if (missing.length > 0) {
        console.warn(`[Permissions] Missing in ${guild.name}: ${missing.join(', ')}`);
        // Try to notify the command-code channel
        const channel = guild.channels.cache.find(
          ch => ch.name === this.config.channelName && ch.type === ChannelType.GuildText
        ) as TextChannel;
        if (channel) {
          channel.send(
            `⚠️ **Missing Permissions:** I need the following to work properly:\n${missing.map(m => `• ${m}`).join('\n')}\n\nPlease update my role permissions in Server Settings → Roles.`
          ).catch(() => {});
        }
      }
    }
  }

  // ── Thread Archival ──────────────────────────────────────────────────
  private startThreadArchival(): void {
    // Check every hour for inactive threads
    this.archiveInterval = setInterval(async () => {
      const now = Date.now();
      const ARCHIVE_AFTER = 24 * 60 * 60 * 1000; // 24 hours

      for (const threadId of this.trackedThreads) {
        const session = this.bridge.getActiveSession(threadId);
        if (!session || (now - session.lastActiveAt > ARCHIVE_AFTER)) {
          try {
            const thread = await this.client.channels.fetch(threadId) as ThreadChannel;
            if (thread && !thread.archived) {
              await thread.setArchived(true, 'Inactive for 24 hours');
              console.log(`[Archive] Archived thread ${threadId}`);
            }
            this.trackedThreads.delete(threadId);
          } catch {
            // Thread may already be deleted
            this.trackedThreads.delete(threadId);
          }
        }
      }
    }, 60 * 60 * 1000); // Every hour
  }

  // ── Channel Setup ────────────────────────────────────────────────────
  private async ensureCommandCodeChannels(): Promise<void> {
    for (const [, guild] of this.client.guilds.cache) {
      await this.ensureCommandCodeChannel(guild);
    }
  }

  private async ensureCommandCodeChannel(guild: Guild): Promise<void> {
    const existing = guild.channels.cache.find(
      ch => ch.name === this.config.channelName && ch.type === ChannelType.GuildText
    );

    if (existing) {
      console.log(`Found #${this.config.channelName} in ${guild.name}`);
      return;
    }

    try {
      const channel = await guild.channels.create({
        name: this.config.channelName,
        type: ChannelType.GuildText,
        reason: 'Command Code Discord integration',
      });
      console.log(`Created #${this.config.channelName} in ${guild.name}`);
      await channel.send('Command Code is ready. Mention me in a message to start a thread!');
    } catch (error) {
      console.error(`Failed to create channel in ${guild.name}:`, error);
    }
  }

  // ── Slash Commands ───────────────────────────────────────────────────
  private async registerSlashCommands(): Promise<void> {
    const commands = [
      new SlashCommandBuilder()
        .setName('help')
        .setDescription('Show available commands and how to use the bot'),
      new SlashCommandBuilder()
        .setName('reset')
        .setDescription('Reset the session for this thread'),
      new SlashCommandBuilder()
        .setName('status')
        .setDescription('Show current session status'),
      new SlashCommandBuilder()
        .setName('stop')
        .setDescription('Stop the current running process'),
      new SlashCommandBuilder()
        .setName('model')
        .setDescription('Set the model for this session')
        .addStringOption(option =>
          option.setName('name').setDescription('Model name').setRequired(true)
        ),
      new SlashCommandBuilder()
        .setName('sessions')
        .setDescription('List all active sessions'),
      new SlashCommandBuilder()
        .setName('stats')
        .setDescription('Show usage statistics'),
    ];

    const rest = new REST().setToken(this.config.botToken);

    try {
      const appId = this.client.user?.id;
      if (!appId) return;

      if (this.config.guildId) {
        await rest.put(Routes.applicationGuildCommands(appId, this.config.guildId), {
          body: commands.map(c => c.toJSON()),
        });
      } else {
        await rest.put(Routes.applicationCommands(appId), {
          body: commands.map(c => c.toJSON()),
        });
      }
      console.log('Registered slash commands');
    } catch (error) {
      console.error('Failed to register slash commands:', error);
    }
  }

  // ── Message Handling ─────────────────────────────────────────────────
  private async handleMessage(message: Message): Promise<void> {
    if (message.author.id === this.client.user?.id) return;
    if (message.author.bot) return;
    if (!isUserAllowed(message.author.id, this.config.allowedUsers)) return;

    const isDM = !message.guild;
    const isThread = message.channel.isThread();
    const isCommandCodeChannel = message.channel.name === this.config.channelName;

    // DM support — treat DMs like a thread
    if (isDM) {
      await this.handleDM(message);
      return;
    }

    // In a tracked thread — no @mention needed
    if (isThread && this.trackedThreads.has(message.channel.id)) {
      await this.handleThreadMessage(message);
      return;
    }

    // In #command-code channel with @mention — create thread
    if (isCommandCodeChannel && message.mentions.has(this.client.user!)) {
      await this.handleChannelMention(message);
      return;
    }

    // In any thread started by the bot (even if not tracked yet)
    if (isThread) {
      const thread = message.channel as ThreadChannel;
      const parent = thread.parent;
      if (parent?.name === this.config.channelName) {
        this.trackedThreads.add(thread.id);
        await this.handleThreadMessage(message);
        return;
      }
    }
  }

  private async handleDM(message: Message): Promise<void> {
    const content = message.content.trim();
    if (!content) return;

    // Use DM channel ID as thread ID for session tracking
    const dmThreadId = `dm-${message.author.id}`;

    // React with 👀
    await this.reactSafe(message, '👀');

    // Track stats
    this.stats.totalRequests++;
    this.stats.totalSessions++;
    this.stats.requestsByUser[message.author.id] = (this.stats.requestsByUser[message.author.id] || 0) + 1;

    // Process in DM channel
    await this.processInChannel(message.channel as DMChannel, message, content, dmThreadId);
  }

  private async handleChannelMention(message: Message): Promise<void> {
    const content = message.content.replace(/<@!?\d+>/g, '').trim();
    if (!content) return;

    // React with 👀 immediately
    await this.reactSafe(message, '👀');

    // Track stats
    this.stats.totalRequests++;
    this.stats.totalSessions++;
    if (message.guildId) {
      this.stats.requestsByGuild[message.guildId] = (this.stats.requestsByGuild[message.guildId] || 0) + 1;
    }
    this.stats.requestsByUser[message.author.id] = (this.stats.requestsByUser[message.author.id] || 0) + 1;

    // Create thread
    const threadName = this.deriveThreadName(content);
    let thread: ThreadChannel;

    try {
      thread = await message.startThread({
        name: threadName,
        autoArchiveDuration: 1440,
      });
    } catch (error) {
      console.error('[ChannelMention] Failed to create thread:', error);
      await message.reply('Failed to create thread. Please try again.');
      return;
    }

    this.trackedThreads.add(thread.id);
    this.bridge.presetSessionTitle(thread.id, threadName);
    await this.processInThread(thread, message, content);
  }

  private async handleThreadMessage(message: Message): Promise<void> {
    if (!message.channel.isThread()) return;

    const thread = message.channel;
    const content = message.content.replace(/<@!?\d+>/g, '').trim();
    if (!content) return;

    // Track stats
    this.stats.totalRequests++;
    if (message.guildId) {
      this.stats.requestsByGuild[message.guildId] = (this.stats.requestsByGuild[message.guildId] || 0) + 1;
    }

    await this.reactSafe(message, '👀');
    await this.bufferMessage(thread.id, content, message, thread);
  }

  private async bufferMessage(
    threadId: string,
    content: string,
    message: Message,
    thread: ThreadChannel,
  ): Promise<void> {
    let buffer = this.messageBuffers.get(threadId);
    if (!buffer) {
      buffer = {messages: [], lastMessage: message};
      this.messageBuffers.set(threadId, buffer);
    }

    buffer.messages.push(content);
    buffer.lastMessage = message;

    if (buffer.timer) clearTimeout(buffer.timer);

    buffer.timer = setTimeout(async () => {
      const merged = buffer!.messages.join('\n');
      const lastMsg = buffer!.lastMessage || message;
      buffer!.messages = [];
      this.messageBuffers.delete(threadId);
      await this.processInThread(thread, lastMsg, merged);
    }, this.config.batchDelayMs);
  }

  // ── Processing ───────────────────────────────────────────────────────
  private async processInThread(
    thread: ThreadChannel,
    userMessage: Message,
    prompt: string,
  ): Promise<void> {
    await this.processInChannel(thread, userMessage, prompt, thread.id);
  }

  private async processInChannel(
    channel: ThreadChannel | DMChannel,
    userMessage: Message,
    prompt: string,
    sessionId: string,
  ): Promise<void> {
    const channelName = 'isThread' in channel && channel.isThread() ? (channel as ThreadChannel).name : 'DM';
    console.log(`[Process] Starting session in ${channelName}`);

    // Typing indicator
    const typingInterval = setInterval(async () => {
      try { await channel.sendTyping(); } catch {}
    }, 5000);
    await channel.sendTyping();

    let errorCount = 0;
    const queuedInputs = new Map<string, unknown>();
    const toolMessageQueues = new Map<string, Message[]>();

    const callbacks: SessionCallbacks = {
      onEvent: (event: NdjsonEvent['event']) => {
        const toolCallId = String(event.toolCallId || '');
        const toolName = String(event.toolName || 'unknown');

        switch (event.type) {
          case 'tool_queued': {
            // Cache input by toolCallId for later matching with tool_running
            if (toolCallId && event.input) {
              queuedInputs.set(toolCallId, event.input);
            }
            break;
          }

          case 'tool_running': {
            const cachedInput = toolCallId ? queuedInputs.get(toolCallId) : undefined;
            if (toolCallId) queuedInputs.delete(toolCallId);

            const formatted = formatToolRunning(event, cachedInput);
            if (!formatted.content) return;

            this.enqueueMessage(async () => {
              try {
                const msg = await channel.send(formatted.content!) as Message;
                const queue = toolMessageQueues.get(toolName) || [];
                queue.push(msg);
                toolMessageQueues.set(toolName, queue);
              } catch {}
            });
            break;
          }

          case 'tool_completed':
          case 'tool_errored': {
            const formatted = event.type === 'tool_completed'
              ? formatToolCompleted(event)
              : formatToolErrored(event);
            if (!formatted.content) return;

            const queue = toolMessageQueues.get(toolName);
            if (queue && queue.length > 0) {
              const existing = queue.shift()!;
              this.enqueueMessage(async () => {
                try { await existing.edit(formatted.content!); } catch {}
              });
            } else {
              this.enqueueMessage(() => channel.send(formatted.content!));
            }
            break;
          }
        }
      },
      onResult: (result: NdjsonResult) => {
        clearInterval(typingInterval);

        // Track token usage
        if (result.usage) {
          const u = result.usage as Record<string, unknown>;
          this.stats.totalTokensInput += Number(u.inputTokens ?? u.input_tokens ?? 0);
          this.stats.totalTokensOutput += Number(u.outputTokens ?? u.output_tokens ?? 0);
        }
        if (result.durationMs) {
          this.stats.totalDurationMs += result.durationMs;
        }

        const outputs = formatResult(result);
        for (const output of outputs) {
          if (output.content) {
            for (const chunk of splitMessage(output.content)) {
              this.enqueueMessage(() => channel.send(chunk));
            }
          } else if (output.embed) {
            this.enqueueMessage(() => channel.send({embeds: [output.embed!]}));
          }
        }

        // Resume command
        const session = this.bridge.getActiveSession(sessionId);
        if (session?.sessionId) {
          this.enqueueMessage(() => channel.send(`📌 Resume in terminal: \`cmd --resume ${session.sessionId}\``));
        }

        // Reaction on bot's last message
        setTimeout(async () => {
          try {
            const messages = await channel.messages.fetch({limit: 5});
            const botMessage = messages.find(m => m.author.id === this.client.user?.id);
            if (botMessage) {
              await this.reactSafe(botMessage, result.subtype === 'error' ? '❌' : '✅');
            }
          } catch {}
        }, 500);
      },
      onError: (error: string) => {
        clearInterval(typingInterval);
        errorCount++;
        this.stats.errors++;
        console.error(`[Process] Error (${errorCount}): ${error}`);

        // Friendly error messages
        let friendlyError = error;
        if (error.includes('ENOENT') || error.includes('not found')) {
          friendlyError = 'Could not start the coding agent. Please check that Command Code is installed.';
        } else if (error.includes('ECONNREFUSED') || error.includes('network')) {
          friendlyError = 'Network error. Please check your connection and try again.';
        } else if (error.includes('timeout')) {
          friendlyError = 'The request timed out. Try a simpler prompt or try again later.';
        }

        this.enqueueMessage(() => channel.send(`❌ ${friendlyError}`));
      },
      onSessionId: (sid: string) => {
        console.log(`[Process] Session ID: ${sid}`);
      },
    };

    try {
      await this.bridge.runSession(sessionId, sessionId, prompt, callbacks);
    } catch (err) {
      clearInterval(typingInterval);
      this.stats.errors++;
      console.error('[Process] Fatal error:', err);
      const msg = err instanceof Error ? err.message : String(err);
      await channel.send(`❌ Something went wrong: ${msg}`).catch(() => {});
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────
  private async reactSafe(message: Message, emoji: string): Promise<void> {
    try { await message.react(emoji); } catch {}
  }

  private deriveThreadName(content: string): string {
    let name = content
      .replace(/<@!?\d+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (name.length > 100) name = name.slice(0, 97) + '...';
    return name || 'New Thread';
  }

  // ── Slash Command Handlers ───────────────────────────────────────────
  private async handleInteraction(interaction: Interaction): Promise<void> {
    if (!interaction.isChatInputCommand()) return;

    const threadId = interaction.channelId;
    const isThread = interaction.channel?.isThread();

    switch (interaction.commandName) {
      case 'help': {
        const helpText = [
          '**Command Code Discord Bot**',
          '',
          '**How to use:**',
          '1. Mention me in `#command-code` to start a new thread',
          '2. I\'ll create a thread and start working on your request',
          '3. Reply in the thread to continue the conversation (no @mention needed)',
          '4. You can also DM me directly',
          '',
          '**Slash Commands:**',
          '`/help` — Show this message',
          '`/status` — Show current session info and resume command',
          '`/sessions` — List all active sessions',
          '`/stop` — Stop the current running process',
          '`/reset` — Reset the session for this thread',
          '`/model <name>` — Set the model for new sessions',
          '`/stats` — Show usage statistics',
          '',
          '**Session Parity:**',
          'Every Discord session can be resumed in the terminal:',
          '`cmd --resume <session-id>`',
          '',
          '**Reactions:**',
          '👀 = I saw your message',
          '⏳ = Working on it',
          '✅ = Done',
          '❌ = Error',
          '',
          '**Tips:**',
          '• Send multiple messages quickly — I\'ll batch them together',
          '• Threads auto-archive after 24 hours of inactivity',
        ].join('\n');
        await interaction.reply({content: helpText, ephemeral: true});
        break;
      }

      case 'stats': {
        const uptime = Date.now() - this.stats.startTime;
        const days = Math.floor(uptime / 86400000);
        const hours = Math.floor((uptime % 86400000) / 3600000);
        const mins = Math.floor((uptime % 3600000) / 60000);
        const uptimeStr = days > 0 ? `${days}d ${hours}h ${mins}m` : `${hours}h ${mins}m`;

        const totalTokens = this.stats.totalTokensInput + this.stats.totalTokensOutput;
        const durationSec = (this.stats.totalDurationMs / 1000).toFixed(1);
        const avgTokens = this.stats.totalRequests > 0
          ? Math.round(totalTokens / this.stats.totalRequests)
          : 0;
        const errorRate = this.stats.totalRequests > 0
          ? ((this.stats.errors / this.stats.totalRequests) * 100).toFixed(1)
          : '0';

        // Top guilds
        const topGuilds = Object.entries(this.stats.requestsByGuild)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 3)
          .map(([id, count]) => {
            const guild = this.client.guilds.cache.get(id);
            return `${guild?.name || id}: **${count}**`;
          })
          .join('\n') || 'None';

        const embed = {
          title: '📊 Command Code Discord Stats',
          color: 0x5865F2,
          fields: [
            {
              name: '⏱️ Uptime',
              value: uptimeStr,
              inline: true,
            },
            {
              name: '📨 Requests',
              value: String(this.stats.totalRequests),
              inline: true,
            },
            {
              name: '🧵 Sessions',
              value: String(this.stats.totalSessions),
              inline: true,
            },
            {
              name: '🪙 Tokens',
              value: `${totalTokens.toLocaleString()} total\n${this.stats.totalTokensInput.toLocaleString()} in / ${this.stats.totalTokensOutput.toLocaleString()} out\n~${avgTokens} avg/request`,
              inline: true,
            },
            {
              name: '⏱️ Processing',
              value: `${durationSec}s total`,
              inline: true,
            },
            {
              name: '❌ Errors',
              value: `${this.stats.errors} (${errorRate}%)`,
              inline: true,
            },
            {
              name: '🏠 Top Guilds',
              value: topGuilds,
              inline: false,
            },
          ],
          footer: {
            text: `Active threads: ${this.trackedThreads.size} • Guilds: ${this.client.guilds.cache.size}`,
          },
          timestamp: new Date().toISOString(),
        };

        await interaction.reply({embeds: [embed], ephemeral: true});
        break;
      }

      case 'reset': {
        if (!isThread) {
          await interaction.reply({content: 'This command only works in threads.', ephemeral: true});
          return;
        }
        this.bridge.resetSession(threadId);
        this.trackedThreads.delete(threadId);
        await interaction.reply('Session reset. Send a new message to start fresh.');
        break;
      }

      case 'status': {
        if (!isThread) {
          await interaction.reply({content: 'This command only works in threads.', ephemeral: true});
          return;
        }
        const session = this.bridge.getActiveSession(threadId);
        const isProc = this.bridge.isProcessing(threadId);
        const status = session
          ? [
              `**Session:** \`${session.sessionId || 'pending'}\``,
              `**Title:** ${session.title || 'untitled'}`,
              `**Processing:** ${isProc ? 'Yes' : 'No'}`,
              `**Requests:** ${session.requestCount || 0}`,
              `**Last Active:** ${new Date(session.lastActiveAt).toLocaleString()}`,
              session.sessionId ? `\n📌 Resume: \`cmd --resume ${session.sessionId}\`` : '',
            ].filter(Boolean).join('\n')
          : 'No active session in this thread.';
        await interaction.reply({content: status, ephemeral: true});
        break;
      }

      case 'stop': {
        if (!isThread) {
          await interaction.reply({content: 'This command only works in threads.', ephemeral: true});
          return;
        }
        const stopped = this.bridge.stopProcess(threadId);
        await interaction.reply(stopped ? 'Process stopped.' : 'No active process to stop.');
        break;
      }

      case 'model': {
        if (!isThread) {
          await interaction.reply({content: 'This command only works in threads.', ephemeral: true});
          return;
        }
        const modelName = interaction.options.getString('name', true);
        this.bridge.setModel(threadId, modelName);
        await interaction.reply(`Model set to **${modelName}**. This will apply to new sessions in this thread.`);
        break;
      }

      case 'sessions': {
        const sessions = this.bridge.getSessionList();
        if (sessions.length === 0) {
          await interaction.reply({content: 'No active sessions.', ephemeral: true});
          return;
        }
        const list = sessions.map(s => {
          const resume = s.sessionId ? ` → \`cmd --resume ${s.sessionId}\`` : '';
          return `- **${s.title || 'untitled'}** (session: \`${s.sessionId || 'pending'}\`)\n  Last active: ${new Date(s.lastActive).toLocaleString()}${resume}`;
        }).join('\n');
        await interaction.reply({content: `**Discord Sessions:**\n${list}`, ephemeral: true});
        break;
      }
    }
  }
}
