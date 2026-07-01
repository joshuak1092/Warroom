# BOT-INTEL-BATCH — fix & test, in order

Working rules (agreed with user):
- Work tasks **in order**. Commit after each numbered task; update this file as each completes.
- **Fix-and-test**, not read-only.
- **Back up** each file before editing (`*.bak-<tag>-<ts>`); run `node --check` after editing JS.
- **Pause and show a summary before applying** each task (wait for OK).
- **Do NOT restart pm2 processes** without explicit OK.
- After each task: show what changed + how to test, then commit.

Golden rule: one data source, three layers — mobile + desktop + Discord bot must all keep working.

---

## TASK 1 — Commit already-applied fixes
Survey parser + SoS positive-sign regex fixes are applied but uncommitted. Verify still in place, commit with a clear message.

Status: ✅ DONE — verified survey parser (scout.js:175) + SoS optional-sign regex `([+-]?[\d.]+)%` (scout.js:146) are present AND already committed in `6b84a63` (ancestor of HEAD). No new commit needed (user chose "commit nothing").
Uncommitted-for-later (per user): Group A firewall+combo (intel-server.js, warroom.html, warroom-mobile.html) and Group B intel WIP (scout.js +Generals, bot.js +op registration) — to be committed within their relevant tasks (B = TASK 2).

## TASK 2 — Intel-tab pipeline (all spy ops render + bot registers)
Every spy op (SoS, SoM, Infiltrate, SoT, Survey) must fully appear on the Intel tab for that enemy province (desktop AND mobile), and the bot must register every one. For each op: confirm scout.js parses it → writes fields `enemyIntelHtml` renders → shows. Fix broken ones in scout.js + both HTML + bot.js. Commit.

Status: ✅ DONE (2026-07-01) — spy ops render + bot registers.
- scout.js: parse `Generals` into `intel.generals`.
- bot.js provCard: military detail line (Gens/Sol/OSpec/DSpec/Elite/WH) + army-out/returns line; **Science** line; **Buildings** (survey) line.
- bot.js vpParseOp: resolve target province across ALL op types (SoM/SoS/Infiltrate/Survey/SoT/Exploration + foiled fallback) and emit a per-op headline datum so every op registers.
- warroom.html + warroom-mobile.html enemyIntelHtml: SoM `intelType==="military"` → "Spy on Military" label; render generals in mil row, army-out line, science books, survey worker/jobs stats.
- Verified `node --check` on bot.js, scout.js, intel-server.js (all pass). NOT restarted pm2 (needs OK).
- Committed in two commits: Group A firewalls/combo first, then this Task 2 commit.

## TASK 3 — CSV → server → bot
CSV import (my KD AND enemy KD) must push to `/save` so state.json updates and the bot sees it. Check current behavior; add push if missing. Commit.

Status: ✅ DONE (2026-07-01) — push existed but was silent; made it explicit + surfaced.
- Finding: imports already pushed via mutate→scheduleSave→pushToServer (400ms debounce), but pushToServer is fire-and-forget — swallows errors, no toast. With the new Group A /save firewalls, a rejected import looked successful locally yet never reached state.json → bot never saw it (silent failure).
- Fix: added `importSave(what)` helper in BOTH warroom.html + warroom-mobile.html — cancels the debounce, writes localStorage, then AWAITs the /save POST and toasts the real result (✅ saved to server / ⚠ SERVER REJECTED it: <error> — bot NOT updated). Routed all 4 import paths (my KD + enemy by-location/merge/create) through it; doImportMy/doImportEnemy are now async.
- No server change. Inline JS syntax-checked via vm.Script (both files, 0 errors). NOT restarted (HTML change → warroom-server restart to serve new files; awaiting OK).
- Manual test: import a CSV → expect a ✅/⚠ server-result toast; feed a wrong-KD CSV → expect the ⚠ rejection toast.

## TASK 4 — Four bot commands (kd arg = ours OR enemy x:y, aligned monospace tables)
- `/kdtpa` and `/kdwpa` — per-prov Raw + Mod, KD avg (raw+mod), total thieves/wizards, high/low prov. Enemy: real where scouted, "?" where not.
- `/econ prov:<name>` — single-prov economy: income breakdown, wages, net, peasants, employment, science econ.
- `/kdecon` — per-prov Income/Wages/Net table + KD total row + grand production footer (Gold net, Runes, Food net per tick). Enemy = estimated w/ note.

Status: ⏳ IN PROGRESS (2026-07-01) — split into 2 commits (tables first).
- [x] `/kdtpa` + `/kdwpa` — rewrote kdMagicCard into an aligned monospace table: per-prov Raw+Mod cols, thieves/wizards col, KD-avg row (raw+mod) + total thieves/wizards, high/low line, unscryed list. KD arg = ours or enemy loc; enemy shows real where scryed, '?' where not. node --check pass; transplant-tested against live state.json.
- [ ] `/econ prov:<name>` — expand to income breakdown / wages / net / peasants / employment / science econ. Per user: SCOUTED RAW VALUES ONLY, '?' where not scouted — no modeled formulas.
- [ ] `/kdecon` — NEW command: per-prov Income/Wages/Net table + KD total + production footer. Raw-values-only per user; estimates noted where unavoidable.
- Bot NOT restarted yet (handlers changed but commands already registered; will restart after econ commit, awaiting OK).

---

## Progress log
- 2026-07-01 — TASK 4 (1/2) — /kdtpa + /kdwpa rewritten as aligned monospace tables (Raw+Mod, KD avg, thief/wiz totals, high/low, unscryed list). kdMagicCard replaced; node --check pass; transplant-tested on live state.json. Econ pair (/econ, /kdecon) next, raw-values-only. Bot not yet restarted.
- 2026-07-01 — TASK 3 complete. CSV import push made explicit + result-surfaced: added importSave() to both HTML files, routed all 4 my/enemy import paths through it (async). Push already existed (silent debounce) but rejections were invisible; now toasted. vm.Script syntax check clean. warroom-server NOT restarted (awaiting OK to serve new HTML).
- 2026-07-01 — TASK 2 complete. scout.js +generals; bot.js provCard military/army-out/science/survey + vpParseOp op-registration; both HTML SoM label + intel render. Group A firewalls/combo split into its own prior commit. bot.js/scout.js/intel-server.js pass node --check. pm2 not restarted (awaiting OK).
