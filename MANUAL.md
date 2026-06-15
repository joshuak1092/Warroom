# Utopia War Room — Complete Package & Manual

## The Files
| File | What it is |
|---|---|
| `warroom.html` | The War Room (desktop) — open in any browser |
| `warroom-mobile.html` | Dedicated mobile build (same data, phone-first UI) |
| `intel-server.js` | The hub server — receives game intel, syncs the site, feeds the bot |
| `discord-bot.js` | Discord bot — full read access + push intel from Discord |

## Quick Start
1. Open `warroom.html` → Data → Load sample data (25v25 demo) or import your CSVs.
2. (Live sync) On a PC/VPS with Node.js: `node intel-server.js 8108 yourkey`
3. War Room → Settings → Live Sync URL `http://your-host:8108`, key `yourkey`.
4. In game → Preferences → "Send intel to your own Intel site" → URL `http://your-host:8108/post`, key `yourkey`. Now every SoT/SoM/Infiltrate/news page you open auto-updates the site (~20s).
5. Discord bot: `npm install discord.js` then `node discord-bot.js DISCORD_TOKEN http://your-host:8108 yourkey`
   (Bot needs Message Content Intent ON; invite with View/Send/Read History perms.)

## Using the Planner
- Tap one of YOUR provinces → enemy cards fill GREEN (in range, RNW 85–135%) / RED (out). Pick attack type in the bar (Massacre/March/Ambush/...). Tap targets to assign — defaults: 1 general, 1% over their defense.
- Or tap a target in 📌 My Targets → YOUR provinces color by range; tap green provs to assign.
- Massacre → Mass wave; March → Chain wave automatically. ⇄ on a wave card moves it between Mass/Chain. ＋ opens full dialog (multi-check spells/thief ops with optional floors, e.g. Fireball "2000 peas").
- Drag enemy rows onto 📌 My Targets (page auto-scrolls while dragging) or tap ☆.
- All panels collapse via their headers. Sort/filter dropdowns: NW/off/def/land/TPA/WPA high-low, ⚔ Attackers only, 🔮 TMs only.
- 💾 Save Wave / ↩ Restore / 🗑 Clear (clears targets too). Everything auto-saves; both builds share data.
- Tabs: Wave · Targets (war board, EoWCF tick countdown) · My KD · Graphs (per-prov, KD totals, 💀 Kill Counter) · Intel (all stored intel, KD switcher) · Reference (full Age 115 wiki data) · Data (CSV auto-import incl. game exports) · Settings.

## Discord Bot Commands
- `!wave` current wave plan (Mass/Chain/TM) · `!targets` starred list · `!left` offense left per prov
- `!prov <name>` full stats any province · `!kd` totals mine vs enemy · `!tms` enemy TMs
- `!intel <name>` latest raw intel page · `!recent` last 10 received
- `!push <pasted SoT/SoM/news>` → applies to the site within ~20s · `!help`

## Data Flow
Game → intel server → War Room (auto-sync) → server (state upload on save) → Discord bot.

## Troubleshooting
- Bot silent → Message Content Intent off / wrong token. "Can't reach server" → URL/key mismatch or server down.
- `!wave` empty → set Live Sync URL in Settings and make any change so it saves once.
- CSV won't import → send the header row; aliases cover game/Angel-style exports, coords (x:y) stripped automatically.

## ⚡ Fast-Nav (new) — run a wave without the mouse
The War Room now has a quick-jump palette, keyboard shortcuts, and a live wave dock. All existing mechanics are unchanged; these only make navigation faster.

- **⌘K / Ctrl+K** (or **`/`**) — open the **Quick-Jump palette**. Type to jump to any tab, pick one of YOUR provinces (sets it as the attacker), pick an ENEMY province (sets it as the target), or run an action (Save / Copy / Export / Clear wave, Paste intel, Load sample, Export JSON). Arrow keys + Enter to choose.
- **1–8** — jump straight to Wave · Targets · My KD · Graphs · Intel · Reference · Data · Settings.
- **n** — select your **next province that still has offense left**, so you can chain through attackers without scrolling. Repeat to cycle.
- **s / c / x** — **S**ave wave · **C**opy wave · e**X**port spreadsheet.
- **Esc** — clear the current attacker/target selection (or close the palette/help).
- **?** — show the shortcut cheatsheet.
- **Wave dock** — a floating bar (on Wave/Targets) shows attacks, mass/chain split, offense sent, provinces still ready, and open targets, with one-tap Save/Copy/Next. The round **⌘ button** (bottom-right) opens the palette on phones too.

Keys are ignored while you're typing in a field, so they never interfere with data entry.

## 🏠🔍 War-Room tools (new) — returns, bounce-check, undo
- **Return Board** — press **r** (or 🏠 in the wave dock): every province with an army out, yours and the enemy's, sorted by soonest home, with the tick countdown and land coming back. Useful for chaining and for knowing when an enemy's defense returns. Data comes from your stored intel (SoM/news).
- **Wave Inspector** — press **i** (or 🔍 in the dock): checks every attack in the current wave and flags **✓ break / ⚠ thin (<2% over) / ✕ bounce (won't break)**, with RNW% and attack time. For any target with 2+ chain hits it shows a **send-order timeline** (slowest-travel first) so the hits land in sequence before they re-layer.
- **Undo / Redo** — **⌘Z / Ctrl+Z** to undo a wave edit, **⌘⇧Z / Ctrl+Y** to redo (up to 40 steps). Doesn't interfere with typing in fields.

*Coming next:* intel diffing + staleness flags (needs the app to start timestamping intel, so it works going forward), and Discord push of assignments (lives in discord-bot.js / intel-server.js).

## 📡 Intel diffing + 📋 Discord push (new)
**Intel changes board (War Room)** — press **d** (or 📡 in the wave dock). The site now stamps every province when its intel changes and keeps a short history, so this board shows:
- **Recent changes** — defense/offense/land/NW/TPA/WPA deltas with % and how many ticks ago. Defense **up** = re-layer (🔁, red); defense **down** = dropped wall (⤵, green/opportunity).
- **Stale intel** — provinces whose intel is ≥ `staleTicks` old (default 24; set `settings.staleTicks` to change). Tracking starts from now on — re-import or sync and changes appear.

**Discord assignment commands (bot)**
- `!assign` — who-hits-what, grouped by your attacker, each hit marked ✅ break / ❌ bounce.
- `!chains` — per-target chain **send order** (slowest-travel province first) so hits land in sequence.

**Auto-push (server)** — start the server with a Discord webhook to have the wave posted automatically whenever it changes:
`node intel-server.js 8108 yourkey "" https://discord.com/api/webhooks/XXXX/YYYY`
(or set `WARROOM_WEBHOOK`). It waits ~12s after the last edit so it posts once per finished wave, not on every keystroke. Needs Node 18+.

## 🔘 Filter chips (new) — stack filters on any sort
Each list header (My Kingdom / Enemy Kingdom) now has toggle chips next to the sort dropdown. They combine, and they layer on top of whatever sort you pick — so you can do "⚔ Attackers" + sort "NW · highest", or "🟢 Off left" + "Offense · highest", etc.
- **My Kingdom:** ⚔ Attackers · 🔮 TMs · 🟢 Off left
- **Enemy Kingdom:** ⚔ Attackers · 🔮 TMs · 📍 In range (NW within your range window)
Tap to toggle (multiple at once); the sort dropdown still controls the metric (NW / off / def / land / TPA / WPA, high–low). The ⭐ starred-only button is unchanged.

## 🎮 Per-province Discord links + 🔐 Admin / Viewer logins (new)
**Link a province to Discord** — My Kingdom → ✎ edit a province → fill the **Discord** field with the player's numeric user ID (best — enables real @pings) or an @handle. Linked provinces show a 🎮 in the My Kingdom table (hover for the handle).
This flows through everything:
- Bot `!assign` and `!left` now @mention each province's owner.
- The server's auto wave-push @mentions owners too, so people get pinged for their hits.

**Two logins (server)** — run the server with two passcodes:
`WARROOM_ADMIN_PASS=secret1 WARROOM_VIEW_PASS=secret2 node intel-server.js 8108 yourkey`
- **Admin** passcode → full edit access.
- **Viewer** passcode → the site loads in read-only mode: a "👁 VIEW ONLY" badge shows, and all editing (assign, gens, import, save/clear, settings, add/edit/delete) is hidden and blocked. Viewers can still browse every tab, switch enemy KDs, see ranges, and use the Return Board / Inspector / Intel boards.
- (The old single 4th-arg passcode still works as the admin login. With no passcodes set, the site stays open as admin.)
Note: read-only is enforced in the browser for a clean experience; the real safety is that viewers don't have the sync key, so they can't push changes to the shared server regardless.

## 👥 Multiple admins, no clobbering (new)
The server now merges saves **per enemy KD** instead of overwriting the whole shared state. So several admins can build waves at the same time as long as they're on **different enemy kingdoms** — nobody overwrites anyone. Each admin keeps their own view and in‑progress edits; everyone else's changes merge in live (~1s). The only case to coordinate is two admins on the *same* enemy KD at once (last save wins there) — so: one caller per enemy KD. Keep device clocks on automatic time (the merge uses timestamps).
