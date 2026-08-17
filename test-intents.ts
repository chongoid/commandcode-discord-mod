import {Client, GatewayIntentBits} from 'discord.js';

async function main() {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) {
    console.error('DISCORD_BOT_TOKEN not set');
    process.exit(1);
  }

  console.log('Testing Discord connection...');

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  client.once('ready', () => {
    console.log('SUCCESS: Connected as', client.user?.tag);
    console.log('Intents are working correctly!');
    client.destroy();
    process.exit(0);
  });

  client.on('error', (err) => {
    console.error('Client error:', err.message);
  });

  try {
    await client.login(token);
  } catch (err: any) {
    console.error('FAILED:', err.message);

    if (err.message.includes('disallowed intents')) {
      console.error('\nThe MESSAGE CONTENT INTENT is still not enabled.');
      console.error('Make sure you:');
      console.error('1. Enabled MESSAGE CONTENT INTENT (not just SERVER MEMBERS)');
      console.error('2. Clicked "Save Changes" at the bottom of the page');
      console.error('3. Waited 1-2 minutes for changes to propagate');
    }

    process.exit(1);
  }

  // Timeout after 15 seconds
  setTimeout(() => {
    console.error('TIMEOUT: Connection took too long');
    client.destroy();
    process.exit(1);
}, 15000);
}

main();
