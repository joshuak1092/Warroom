# CLAUDE.md — Utopia War Room

War-planning toolkit for a kingdom in the browser game **Utopia: World of Legends** (currently
Age 115, kingdom "SavageDomain"). It tracks our provinces and enemy provinces, plans attack
"waves," and surfaces live intel scraped from the game — across **three display layers backed by
one data source**.

## Golden rule

**One data source, three display layers.** Every change must work on the **mobile site**, the
**desktop site**, AND the **Discord bot**. They all read the same `state.json` / intel feed. Never
fix one layer in a way that breaks the others.

## Live deployment

- Live site: **relentlesshz.duckdns.org**, served by `intel-server.js` on **port 8108**.
- Three **pm2** processes — keep all online:
  - `warroom-server` — `intel-server.js` (web server + data owner + intel feed API)
  - `warroom-bot` — `bot-build/bot.js` (Discord bot)
  - `warroom-engine` — `engine/index.js` (intel → `state.json` updater)
- **After editing `intel-server.js`:** run `node --check intel-server.js`, then `pm2 restart warroom-server`.
- **NEVER reboot the droplet.** Ignore any "restart required" banner. The droplet has 1 GB RAM +
  2 GB swap; what takes the server down is a **low-memory OOM kill**, not bugs. Reboot ≠ fix.
- The site is currently locked behind **HTTP Basic Auth** (a single site password).

## Architecture / data flow

```
 game pages ──(browser capture POSTs)──▶ intel-server  ──▶ intel-log.json   (raw feed entries)
                                              │                   │
                                              │            engine/index.js polls /feed,
                                              │            runs parsers, writes ──▶ state.json
                                              ▼                                        │
                          warroom.html / warroom-mobile.html  ◀── GET /state ──────────┤
                          (browser planner apps)              ── POST /save ───────────┤
                                                                                       │
                          bot-build/bot.js  ◀── GET /feed, reads state.json ───────────┘
                          (Discord slash commands + live posting)
```

- **`intel-server.js` owns the data.** Browsers never auto-push silently; they read `/state` and
  explicitly write via `/save` (the **"Save to Server"** button). Auto-push was deliberately disabled.
- **Intel ingestion:** game pages are captured (browser userscript/extension, external to this repo)
  and POSTed to the server, which appends `{id,ts,url,prov,data_simple}` rows to `intel-log.json`,
  served back via `/feed`. The **engine** polls `/feed` every 60 s, matches each row against a parser
  in `engine/parsers/`, and folds the result into `state.json` (our provinces, enemy stats, war log).
- **Two separate secrets:**
  - `INTEL_KEY` — auth for the data/feed API (used by the bot and engine). Distinct from the website
    password. Bot reads `INTEL_KEY` from `bot-build/.env`; engine has it hardcoded in `engine/index.js`.
  - the **site password** — HTTP Basic Auth gating the web pages.

## `intel-server.js` (warroom-server)

Single-file Node `http` server, no framework. Key endpoints:

- `GET /`, `/index.html`, `/mobile`, `/mobile.html` — serve `warroom.html` / `warroom-mobile.html`.
  Injects `window.__WR_ROLE`, `__WR_VERSION`, and `__WR_SYNC` (sync URL + key) into the page, plus an
  auto-reload poller (checks `/version` every 20 s and reloads on change) and the wiki nav script.
  Gated by Basic Auth: `WARROOM_ADMIN_PASS` (admin) / `WARROOM_VIEW_PASS` (viewer).
- `GET /state` — returns `state.json` (needs read key). `POST /save` — replaces it (needs `KEY`).
- `GET /feed?since=` — recent intel rows whose URL contains `/wol/` (read key). `POST /` (catch-all) —
  append an intel row, broadcasts `feed` SSE.
- `GET /events` — Server-Sent Events; broadcasts `state` / `feed` change pings (25 s heartbeat).
- `GET /health`, `GET /version` — status / cache-busting version string.
- `POST /restore` — restore a backup from `state-backups/`.
- `/wiki`, `/wiki/upload`, `POST /wiki/save` — an in-app WoL reference wiki (`wiki.html`), password
  `WIKI_PW`; uploads are run through `stripGenesis()` to remove out-of-age content.
- `GET /state` (POST variant) returns **410** — auto-push is intentionally disabled.

**Save firewalls** (`POST /save`, override with `?force=1`) — these exist because of real wipe
incidents; do not remove them casually:
- 409 if incoming state is empty (0 of our provs AND 0 enemies).
- 409 if our province count would drop by >50% from ≥8 (looks like a wipe).
- 422 if data fails validation (>25 provs, tilde/junk names, KD name as a province, dupes,
  malformed `loc`).
- `/restore` has the same anti-wipe guard.
- `sanitizeState()` dedupes provinces; the server **never** folds enemy provinces into our KD.

> ⚠️ **KNOWN BUG to investigate before touching save/wipe logic:** `POST /save` with a *valid admin
> key* returned **409 on a near-empty state** — most likely one of the anti-wipe guards above firing.
> Confirm which guard and why before building new save logic or wiping data.

## Browser apps — `warroom.html` (desktop) & `warroom-mobile.html` (mobile)

Two large standalone HTML files (CSS + JS inline, no build step). They are **the same app** with
different layout/CSS; the desktop build has a few extra functions (full intel tabs modal, war
scoreboard, etc.). **Edits to app logic usually need to be applied to both files** (see the `apply_*.js`
helper scripts at repo root, which patch both).

- **State:** single `STATE` object — `{settings, myKd:{provinces[]}, enemies:{id:{provinces[],wave[],targets[]...}}, activeEnemy}`. Persisted to `localStorage` (`utopia_warroom_v2`) AND the server.
- **Load order:** server `/state` first (shared), else localStorage, else `defaultState()`.
- **Save:** `mutate(fn)` → render → `scheduleSave()` (400 ms debounce) → localStorage + `pushToServer`.
  Visiting `?reset` hard-wipes local storage.
- **Views** (router in `render()`): Wave Planner, War Targets, My Kingdom, Graphs, Intel, Reference
  (wiki), Import/Export, Settings.
- **Wave planner math** is in the DOMAIN CONSTANTS section (~line 693+): Age-115 attack types,
  effective offense (Warrior +15%, Fanaticism +5%, Bloodlust +10%), RPNW/RKNW gains factors, land
  gain/removal, casualties, attack time by race/persona, and overpopulation levels (L1–L4). These are
  **estimates** modeled on the WoL wiki — if game mechanics change by age, this is what to update.

## `engine/` (warroom-engine)

`engine/index.js` polls `/feed` every 60 s and runs each parser in `engine/parsers/`
(`build.js`, `military.js`, `news.js`, `science.js`, `throne.js`) against matching intel rows to
update province stats and the war log in `state.json`. Writes atomically (`.tmp` → rename) and keeps
a `state.json.engine-bak`. Parsers are hot-reloaded each tick (require cache cleared), so you can edit
a parser without restarting — but restart `warroom-engine` after editing `index.js` itself.

## `bot-build/bot.js` (warroom-bot)

Discord bot (discord.js v14). Reads the feed/state via `INTEL_KEY` (from `bot-build/.env`).
- **Slash commands:** `/prov /intel /kds /survey /tpa /econ /wpa /break /targets /board /kdtpa /kdwpa
  /stealth /mana /weak /fat /left /find /link /unlink /links /me /status /help /live /spells`.
- **Live posting:** polls `/feed` (8 s) and visited-pages (2 s) and posts attacks, ceasefires, ops,
  spells, etc. into named channels (`bot-attacks`, `bot-thieve-ops`, `bot-ritual`, `bot-aid`,
  `bot-selfspells`, …). Dedup via `seen.json`. Player↔province links in `links.json`.
- Some loops (army-return pings, tick DMs, the old war-attack poster) are `if(false)`-disabled —
  they flooded; the province-log poster handles attacks now.

## Data files (gitignored — never commit)

- `state.json` — the kingdoms (our KD + enemies, waves, war log). The source of truth for planning.
- `intel-log.json` — raw intel feed rows.
- `state-backups/` — rolling timestamped backups (server keeps last ~10).
- `bot-build/{.env, links.json, armies.json, seen.json}` — bot secrets + runtime state.
- Secrets are also in `bot-launch.js` / `discord-bot.js` and `engine/index.js` (hardcoded key).

The repo root is littered with `*.bak-*` snapshots and one-off `*-fix.js` / `apply_*.js` patch
scripts from past edits — these are **not** the live app. The live files are `intel-server.js`,
`warroom.html`, `warroom-mobile.html`, `bot-build/bot.js`, and `engine/`.

## Roadmap — TO BUILD NEXT: real accounts system

Replace the single shared password / single shared state with proper accounts.

- **Registration:** people register with **email + password**, and start with **NO access** until the
  **owner approves** them. No verification emails — **owner approval is the only gate**.
- **Owner admin panel:** approve/revoke users, set each person's level/role, and assign a display name.
- **Roles (two + owner):**
  - **MEMBER** — view-only. Sees all intel/feed; cannot edit, import, or plan on the site.
  - **WAVE LEADER** — can edit/import intel AND build/save wave plans.
  - **OWNER** — a wave leader who also has the admin panel.
- **Shared vs private data split** (the core architectural change):
  - **Intel is SHARED** — everyone sees the same latest intel/feed.
  - **Each wave leader's wave plan is PRIVATE** — their wave, targets, saved waves, and generals — so
    leaders don't overwrite each other.
  - This means splitting today's single shared `state.json` into a **shared-intel layer** + a
    **per-user planning layer**.
- Remember the golden rule while building this: it must work on mobile, desktop, and the bot.
