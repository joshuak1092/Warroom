/* PM2 process file — runs BOTH the War Room server and the Discord bot on one box.
   Edit the CHANGE_ME values on your server (nano ecosystem.config.js), then:
     pm2 start ecosystem.config.js   &&   pm2 save
   Keep INTEL_KEY identical in both apps. */
module.exports = {
  apps: [
    {
      name: "warroom-server",
      script: "intel-server.js",
      env: {
        PORT: "8108",
        INTEL_KEY: "CHANGE_ME_long_random_sync_key",   // sync password (server + bot must match)
        WARROOM_ADMIN_PASS: "CHANGE_ME_admin_login",    // full edit login
        WARROOM_VIEW_PASS: "CHANGE_ME_viewer_login",    // read-only login
        WARROOM_WEBHOOK: ""                             // paste a Discord webhook URL for auto wave posts (optional)
      }
    },
    {
      name: "warroom-bot",
      script: "discord-bot.js",
      env: {
        DISCORD_BOT_TOKEN: "CHANGE_ME_discord_bot_token",
        INTEL_SERVER_URL: "http://localhost:8108",      // the server on this same droplet
        INTEL_KEY: "CHANGE_ME_long_random_sync_key"     // same key as the server above
      }
    }
  ]
};
