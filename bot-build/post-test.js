require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.once('clientReady', async () => {
  console.log('online as ' + client.user.tag);
  try {
    const ch = await client.channels.fetch(process.env.CH_BOTTEST);
    await ch.send('War Room bot online. Connection test successful at ' + new Date().toLocaleTimeString());
    console.log('MESSAGE POSTED to #' + ch.name);
  } catch (e) {
    console.error('POST FAILED:', e.message);
  }
  setTimeout(() => process.exit(0), 1500);
});
client.login(process.env.DISCORD_TOKEN).catch(e => { console.error('LOGIN FAILED:', e.message); process.exit(1); });
