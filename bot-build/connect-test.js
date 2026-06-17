require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ]
});
client.once('clientReady', () => {
  console.log('BOT ONLINE as ' + client.user.tag);
  console.log('In ' + client.guilds.cache.size + ' server(s):');
  client.guilds.cache.forEach(g => console.log('  - ' + g.name + ' (id ' + g.id + ')'));
  console.log('--- listing channels in each server ---');
  client.guilds.cache.forEach(g => {
    g.channels.cache.filter(c => c.type === 0).forEach(c => {
      console.log('  #' + c.name + '  ->  ' + c.id);
    });
  });
  console.log('=== connection works. exiting in 3s ===');
  setTimeout(() => process.exit(0), 3000);
});
client.on('error', e => console.error('ERROR:', e.message));
client.login(process.env.DISCORD_TOKEN).catch(e => {
  console.error('LOGIN FAILED:', e.message);
  process.exit(1);
});
