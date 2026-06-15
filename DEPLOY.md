# 🚀 War Room — Go Live (step by step)

You have **three** pieces:

| Piece | File | What it gives you | Needs |
|---|---|---|---|
| **The site** | `warroom.html`, `warroom-mobile.html` | the planner UI | nothing (works alone) |
| **The server** | `intel-server.js` | admin/viewer logins, sync between people, intel feed, Discord auto-push | a Node host, always-on |
| **The bot** | `discord-bot.js` | `!assign` `!chains` `!intel` …, @pings | a Node host + a Discord bot token |

The site alone works with no server (data stays in each browser). But the logins + Discord + sync you asked for **need the server running**. This guide gets all of it live.

**Recommended host:** **Railway** (~$5/mo, always-on, runs the server *and* the bot in one project, no Dockerfiles). A **free** alternative (Render) is at the bottom — good for testing, with caveats.

Accounts you'll need (all free to create):
- GitHub — https://github.com
- Railway — https://railway.com
- Discord Developer Portal — https://discord.com/developers/applications

---

## Part 1 — Put the files on GitHub (no tools needed)
1. Go to https://github.com/new → name it `warroom` → **Private** → **Create repository**.
2. Click **uploading an existing file**.
3. Drag in **all of these**: `warroom.html`, `warroom-mobile.html`, `intel-server.js`, `discord-bot.js`, `package.json`, `.gitignore`, `MANUAL.md`, `DEPLOY.md`.
4. **Commit changes**.

---

## Part 2 — Deploy the SERVER on Railway
1. Go to https://railway.com → **Login with GitHub** → **New Project** → **Deploy from GitHub repo** → pick `warroom`.
2. Railway builds it. Open the service → **Settings**:
   - **Start Command:** `node intel-server.js`
   - **Networking → Generate Domain** (gives you `https://something.up.railway.app`). Copy it — this is **YOUR SITE URL**.
3. Open the service → **Variables** → add:
   - `INTEL_KEY` = `pick-a-long-random-string` (your sync password)
   - `WARROOM_ADMIN_PASS` = `your-admin-login`
   - `WARROOM_VIEW_PASS` = `your-viewer-login`
   - *(leave `WARROOM_WEBHOOK` for Part 4)*
   - *(don't set `PORT` — Railway sets it automatically.)*
4. It redeploys. Visit your site URL → browser asks for a login:
   - **Username:** anything (e.g. `admin`) • **Password:** your `WARROOM_ADMIN_PASS` → full edit.
   - Viewers use the **viewer** password → read-only "👁 VIEW ONLY" mode.

✅ The site is live with logins.

---

## Part 3 — Connect the War Room to your server (sync)
**When you open the site from your server URL and log in, live sync turns on automatically** — no setup needed (a green "● LIVE" dot shows bottom-left). The steps below are only needed if you open the HTML file locally instead of from the server:
1. Open your live site, log in as admin → **Settings** (gear).
2. Set **Sync URL** = your Railway URL, **Sync key** = your `INTEL_KEY`.
3. Save. Now saves upload to the server and everyone pulls the same data.
   (Each teammate just opens the same URL and logs in — admin or viewer.)

---

## Part 4 — Discord auto-push (post the wave to a channel)
1. In Discord: **Server Settings → Integrations → Webhooks → New Webhook** → choose the channel → **Copy Webhook URL**.
2. Railway → server **Variables** → add `WARROOM_WEBHOOK` = that URL → it redeploys.
3. Edit a wave in the War Room. ~12s after you stop editing, the wave posts to that channel (with ⚠ on any hit that won't break).

---

## Part 5 — The Discord BOT (commands + @pings)
**5a. Create the bot**
1. https://discord.com/developers/applications → **New Application** → name it → **Create**.
2. Left menu **Bot** → **Reset Token** → **Copy** (this is `DISCORD_BOT_TOKEN`; keep it secret).
3. On the same Bot page, turn **ON**: **MESSAGE CONTENT INTENT** (required — the bot reads `!commands`). Save.

**5b. Invite it to your server**
1. Left menu **OAuth2 → URL Generator**.
2. Scopes: check **bot**. Bot Permissions: check **Send Messages**, **Read Message History**.
3. Copy the generated URL at the bottom, open it, pick your server, **Authorize**.

**5c. Run the bot on Railway (second service, same repo)**
1. Railway → your project → **New → GitHub Repo → `warroom`** (adds a second service).
2. That service → **Settings → Start Command:** `node discord-bot.js`
3. That service → **Variables**:
   - `DISCORD_BOT_TOKEN` = the token from 5a
   - `INTEL_SERVER_URL` = your Railway site URL (from Part 2)
   - `INTEL_KEY` = the same key as the server
4. It deploys. In Discord, type `!help` → the bot replies.

---

## Part 6 — Link provinces to people (for the @pings)
1. War Room → **My Kingdom** → ✎ a province → **Discord** field.
2. Best: paste their **numeric user ID** (Discord → User Settings → Advanced → Developer Mode ON; then right-click a user → **Copy User ID**). A plain `@handle` also works but won't hard-ping.
3. Now `!assign`, `!left`, and the auto-push @mention each province's owner.

---

## Part 7 — Test for real (checklist)
- [ ] Site URL loads and asks for a login.
- [ ] Admin password → can edit; Viewer password → "VIEW ONLY", edits blocked.
- [ ] Settings → Sync URL+key set; edit on one device shows on another after refresh.
- [ ] Import your KD CSV; build a small wave; Inspector (press `i`) shows break/bounce.
- [ ] `WARROOM_WEBHOOK` set → editing a wave posts it to the channel.
- [ ] Bot online: `!help`, `!assign`, `!chains`, `!intel <prov>`.
- [ ] A province with a Discord ID → `!assign` actually pings them.

---

## Free alternative — Render (no card, good for testing)
- https://render.com → **New → Web Service** → connect the GitHub repo.
- **Start Command:** `node intel-server.js` • add the same env vars (Render sets `PORT` for you).
- Caveat: the **free** web service **sleeps after ~15 min idle** (first hit takes 30–60s to wake). Fine for testing, not ideal mid-war.
- The **bot** needs an always-on worker (Render charges for Background Workers). For free testing you can run the bot on your own PC: `npm install` then `node discord-bot.js <TOKEN> <yourRenderURL> <INTEL_KEY>`.

## DigitalOcean (reliable, with persistent storage)
Great if you want it rock‑solid and your shared `state.json` to survive restarts. New accounts get **$200 free credit for 60 days**.
- **Droplet (~$4–6/mo, recommended):** a small Linux VPS with a **persistent disk**. Install Node 22+, `npm install`, run both with PM2 (`pm2 start intel-server.js` and `pm2 start discord-bot.js -- <TOKEN> <URL> <KEY>`, then `pm2 save`). Add a domain + free SSL. Always‑on, no sleeping. Needs basic command‑line comfort.
- **App Platform (~$5/mo):** git‑connected deploy like Railway (Start Command `node intel-server.js`, set the same env vars). Easiest, but storage is ephemeral — same `state.json`‑resets caveat as Render; fine since browsers keep their own copy and re‑seed on save.

## Cheapest always-on full power — a VPS
- A small VPS (e.g. Hetzner, or Oracle Cloud's free ARM tier) runs **both** for a few $/mo.
- Install Node 22+, `npm install`, then keep both alive with PM2:
  `npm i -g pm2` → `pm2 start intel-server.js` → `pm2 start discord-bot.js -- <TOKEN> <URL> <KEY>` → `pm2 save`.

## Notes
- **Node version:** use **Node 22.12+** (discord.js 14 requires it). On Railway/Render pick Node 22 if asked.
- **Data persistence:** the server writes `state.json` + `intel-log.json` to disk. On free/ephemeral hosts these reset on redeploy/restart — each person's browser keeps its own copy, and the next admin save re-seeds the server. For permanent shared storage use a Railway volume, Render disk, or a VPS.
- **Security:** viewer read-only is enforced in the browser for UX; the real protection is that viewers don't have `INTEL_KEY`, so they can't push to the server. Keep `INTEL_KEY` and the bot token secret.

---

## ⚡ Live updates (real-time, no lag)
The server pushes changes to every open browser instantly over Server-Sent Events (no more 20-second delay). You don't configure anything — it's automatic when served behind a login.

**How shared editing works (important):**
- **Intel** (SoT/SoM/news you paste or the game/bot sends) goes live to **everyone** within ~1 second.
- **The wave board** mirrors live to everyone. **Multiple admins can edit at the same time as long as they work different enemy KDs** — saves are merged per‑enemy on the server, so one admin's wave never overwrites another's. Each admin keeps their own view (active enemy, selection) while everyone else's changes merge in live. A green "● LIVE" dot = connected.
- The one case still not auto‑merged is **two admins editing the *same* enemy KD at the same instant** (last save wins for that one enemy). Simple rule: **one caller per enemy KD.** Viewers see everything read‑only.
- Tip: keep devices' clocks roughly correct (automatic time) — the per‑enemy merge uses timestamps.

**Reliability:** use an always-on host (Railway, below) so the live connection never sleeps. On Render's free tier the service sleeps when idle, which drops the live connection until the next visit — fine for testing, not for a live war.

**Read-only token:** viewers auto-receive a read-only key (your `INTEL_KEY` + `-ro`) that can read the feed/state but cannot write. To set your own, add env `WARROOM_READ_KEY`.
