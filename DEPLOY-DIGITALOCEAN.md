# 🌊 War Room on DigitalOcean — everything on one Droplet

One small Droplet runs **all of it**: the desktop site, the mobile site, the intel/sync server (real‑time + multi‑admin), **and** the Discord bot — with storage that survives restarts. ~**$6/mo**, and new DigitalOcean accounts get **$200 free for 60 days**.

You'll do everything in the **browser console** DigitalOcean gives you — no SSH app to install. Commands are copy‑paste.

---

## Part 0 — Put the files on GitHub (once)
1. https://github.com/new → name `warroom` → **Private** → **Create**.
2. **uploading an existing file** → drag in all of these → **Commit**:
   `warroom.html`, `warroom-mobile.html`, `intel-server.js`, `discord-bot.js`, `package.json`, `ecosystem.config.js`, `.gitignore`, `MANUAL.md`, `DEPLOY.md`, `DEPLOY-DIGITALOCEAN.md`.
3. Copy your repo URL (looks like `https://github.com/YOURNAME/warroom.git`).

---

## Part 1 — Create the Droplet
1. https://www.digitalocean.com → sign up / log in → **Create → Droplets**.
2. **Region:** closest to your kingdom. **OS:** **Ubuntu 24.04 (LTS)**.
3. **Size:** Basic → Regular → the **$6/mo** option (1 GB RAM) is plenty.
4. **Authentication:** choose **Password**, set a strong root password (simplest), or add an SSH key if you have one.
5. **Create Droplet.** When it's ready, note its **IP address** (e.g. `203.0.113.45`).

---

## Part 2 — Open the console and install everything
1. On the Droplet page: **Access → Launch Droplet Console** (a black terminal opens in your browser).
2. Paste these one block at a time (press Enter after each):

Install Node 22, git, and PM2:
```
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git
sudo npm install -g pm2
```

Get your files (replace YOURNAME):
```
git clone https://github.com/YOURNAME/warroom.git
cd warroom
npm install
```

---

## Part 3 — Put in your passwords/keys
Open the config:
```
nano ecosystem.config.js
```
Fill in the `CHANGE_ME` values:
- `INTEL_KEY` — a long random string (must be the **same** in both the server and the bot section)
- `WARROOM_ADMIN_PASS` — your admin login
- `WARROOM_VIEW_PASS` — your viewer login
- `DISCORD_BOT_TOKEN` — leave for now if you haven't made the bot yet (Part 6)
- `WARROOM_WEBHOOK` — leave blank for now (Part 5)

Save and exit: **Ctrl+O**, **Enter**, then **Ctrl+X**.

---

## Part 4 — Start it (and keep it running forever)
```
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```
`pm2 startup` prints **one command** — copy that exact line, paste it, press Enter (this makes everything auto‑start after a reboot).

Check it's alive:
```
pm2 status
```
Both `warroom-server` and `warroom-bot` should say **online**. (The bot will show errors until you add its token in Part 6 — that's fine.)

**✅ It's live now:**
- Desktop: `http://YOUR_DROPLET_IP:8108`
- Mobile: `http://YOUR_DROPLET_IP:8108/mobile`

Open it, log in with your admin password (full edit) or viewer password (read‑only). You'll see a green **● LIVE** dot — real‑time sync is on automatically.

---

## Part 5 — Discord auto‑push (wave posts with @pings)
1. Discord → **Server Settings → Integrations → Webhooks → New Webhook** → pick a channel → **Copy Webhook URL**.
2. Back in the console:
```
nano ecosystem.config.js
```
   Paste the URL into `WARROOM_WEBHOOK`. Save (Ctrl+O, Enter, Ctrl+X).
3. Apply it:
```
pm2 restart warroom-server
```

---

## Part 6 — The Discord bot
**Make it:**
1. https://discord.com/developers/applications → **New Application** → name it → **Create**.
2. **Bot** (left menu) → **Reset Token** → **Copy** it.
3. Same page → turn **ON** **MESSAGE CONTENT INTENT** → **Save**.

**Invite it:**
4. **OAuth2 → URL Generator** → Scopes: **bot** → Bot Permissions: **Send Messages**, **Read Message History**.
5. Open the generated URL → pick your server → **Authorize**.

**Plug the token in:**
6. Console:
```
nano ecosystem.config.js
```
   Paste the token into `DISCORD_BOT_TOKEN`. Save. Then:
```
pm2 restart warroom-bot
```
7. In Discord, type `!help` → the bot replies. Try `!assign`, `!chains`, `!intel <prov>`.

---

## Part 7 — Link provinces to people (the @pings)
In the War Room → **My Kingdom** → ✎ a province → **Discord** field → paste their **numeric user ID**
(Discord → User Settings → Advanced → **Developer Mode ON**, then right‑click a person → **Copy User ID**).
Now `!assign`, `!left`, and the auto‑push @mention each province's owner.

---

## ✅ You now have, all on one Droplet
- Desktop **and** mobile sites, served live.
- Admin + viewer logins, real‑time updates (no lag), multi‑admin per‑enemy merge (no clobbering).
- Discord wave posts with pings, and the `!command` bot — all linked through the same server.

---

## Optional but recommended — a real domain + HTTPS (no "Not secure" warning)
Right now it's `http://IP:8108`. For a clean `https://yourwar.com`, after you own a domain and point its **A record** to the Droplet IP:
```
sudo apt-get install -y nginx
sudo tee /etc/nginx/sites-available/warroom >/dev/null <<'NGINX'
server {
  listen 80;
  server_name yourdomain.com;
  location / {
    proxy_pass http://localhost:8108;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header Connection '';
    proxy_buffering off;        # keeps live updates (SSE) instant
    proxy_read_timeout 1h;
  }
}
NGINX
sudo ln -s /etc/nginx/sites-available/warroom /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com
```
certbot sets up free auto‑renewing HTTPS. Then use `https://yourdomain.com` (and `/mobile`). Until you do this, note that logins on plain `http://IP` are sent unencrypted — fine for a quick test, but switch to HTTPS for real use.

---

## Handy commands (console)
- `pm2 status` — are both running?
- `pm2 logs` — live logs (Ctrl+C to exit). `pm2 logs warroom-bot` for just the bot.
- `pm2 restart all` — after editing config.
- To update after you change files on GitHub: `cd warroom && git pull && npm install && pm2 restart all`
- Your shared data lives in `warroom/state.json` (persists across restarts).
