# TOTAL CAPTURE — spec & progress (survives disconnects)

**Goal:** every game page is captured, parsed into ONE shared `intel.*` shape, stored, and
auto-pushed the instant it's captured — to the Discord bot AND both sites (`warroom.html` +
`warroom-mobile.html`) — with **zero browsers open**. One source of truth, three feeds.

## Decisions (locked in by owner, 2026-07-01)

1. **Instant push scope:** broadcast on **EVERY** state write (including the flat parsers), once
   the shape is unified. Engine emits SSE `state`; both HTML pages open `/events` and refetch.
   Must work with no browser open; bot reads `state.json` live.
2. **Completeness:** build **ALL** missing parsers. Order:
   1. wizards/mystics (`enchantment`) **+** state/generals (`council_state` / `council_military`)
   2. rituals (`cast_ritual` / `status_ritual`) + dragons (`attack_dragon` / `*_dragon`)
   3. aid, explore, uniques, province_news
3. **Own-KD 📋 = MAXIMUM detail** — everything an enemy card shows and more: full military
   (EPA/OSPA/DSPA, generals, soldiers, all specialists, elites, war horses, army-out + return
   time + incoming land), full throne econ, all science, full buildings with % +
   under-construction. Real generals/army-out come from `council_military`.
4. **Consolidate the two pipelines:** engine + browser + CSV all write ONE shared `intel.*`
   shape via a single helper (`WRIntel.mergeIntel`). Canonical source: `engine/intel-shape.js`,
   mirrored inline in both HTML files (no build step in this repo).

## Canonical `intel.*` shape (what the 📋 card, `enemyIntelHtml`, renders)

Flat on province `p`: `race pers ruler land nw pop honor offense defense tpa wpa mdtpa mdwpa
stealth mana prisoners warHorses armyOut incomingLand returnTick spells[] ops[] intelType lastScout`.

`p.intel`:
- `throne` — map of the throne grid (`Building Eff.`, `Money`, `Food`, `Runes`, `Trade Balance`,
  `War Horses`, `Prisoners`, unit rows, …) + `throneDate`, `throneTs`
- `thieves`, `wizards`
- military: `ome dme generals generalsAvail soldiers offSpecs defSpecs elites warHorses
  ospa dspa epa offHome defHome armyReturnDays[] units[] milTs`
- `science[]` = `{name, books, effect, desc}`
- `survey` = `{buildings:[{name,qty,pct}], total, stats:{workers,jobs,buildEff,workersNeeded},
  underConstruction:[{name,qty,days}], ts}`
- `econ` = discrete economy numbers (`money food runes tradeBalance income wages ...`) + `econTs`
- `ritual` = `{name, eff, days}`, `plague` bool, `warWith` = `{name, loc}`

## Page → parser plan

| page | url | status before | plan |
|------|-----|---------------|------|
| throne (own) | `/game/throne` | flat only | route into `intel.throne`+mil via mergeIntel |
| throne (enemy) | `thievery?o=SPY_ON_THRONE` | rich (scout) | keep, via mergeIntel |
| kingdom/enemy roster | `/game/kingdom_details` | browser-only | keep; engine parser optional |
| news | `/game/kingdom_news` | warlog | keep |
| province_news | `/game/province_news` | dropped | NEW parser |
| explore | `/game/explore` | dropped | NEW parser |
| sciences (own) | `/game/science` | flat | into `intel.science` |
| military (own) | `/game/train_army` | flat | into `intel` military |
| generals/army | `/game/council_military` | dropped | NEW parser (generals, army-out) |
| wizards/mystics | `/game/enchantment` | dropped | NEW parser |
| sorcery/thievery | `/game/{sorcery,thievery}` | rich (scout) | keep |
| state | `/game/council_state` | dropped | NEW parser (econ) |
| buildings (own) | `/game/build` | flat | into `intel.survey` + underConstruction |
| uniques | `/game/uniques` | dropped | NEW parser |
| aid | `/game/aid` | dropped | NEW parser |
| dragons | `/game/{attack,fund,info,start}_dragon` | dropped | NEW parser |
| rituals | `/game/{cast,status}_ritual` | dropped | NEW parser |

## Steps (commit + backup + `node --check` + diff before applying each)

- [x] **1. Unified `intel.*` shape helper** — `engine/intel-shape.js` (`mergeIntel`, `numI`),
      mirrored inline as `WRIntel` in both HTMLs. Pure add, zero behavior change. (commit a404a1d)
- [x] **2. My-own capture into my provinces** — throne/science/military/build engine parsers now
      emit the unified `intel.*` via mergeIntel; renderers (enemyIntelHtml/sciSection/buildSection/
      provDetail/intelTabsModal) migrated to read `intel.*`; bot already reads it; CSV feeds the
      flat fields the card reads + raw view appended below live intel. Verified by replay of real
      intel-log samples (throne 20 keys+ritual+spells, mil EPA/DSPA+units, build 18+stats, sci 18)
      and by running the migrated renderers → 10KB max card. `council_military` generals moved to
      step 4 (it's a new parser).
- [x] **3. Instant push** — server watches `state.json` (fs.watchFile, 1s) and broadcasts a
      `state` SSE ping on every write (engine writes bypass /save, so this is what makes them
      instant); both HTMLs open an `EventSource` on `/events` and refetch on `state`/`feed`.
      Proven end-to-end: an engine-style atomic write triggered a `state` broadcast with no
      browser involved. ⚠️ needs `pm2 restart warroom-server` to take effect (HTML changes are
      live on reload — server reads them fresh per request).
- [x] **4. New parsers, batch 1** — enchantment (wizards/mana/runes), council_state (pop +
      networth/land/honor + intel.econ: income/wages/jobs/employment/maxpop/army), council_military
      (OME/DME, net off/def @home, generals-available, war horses, army-out). All route via
      mergeIntel; no URL-match collisions (verified). council_military's net-at-home is DISPLAY
      only — decoupled `offHome→p.offense` in mergeIntel so effOffense() base stays the throne
      Off. Points (no double-count); card shows a "Net@home OFF/DEF" line. Verified by replay +
      render of real samples.
- [x] **5. New parsers, batch 2** — ritual.js (kingdom-scope: active ritual eff/days + ritual in
      development, stamped onto each province's intel.ritual), dragon.js (kingdom-scope: ravaging
      dragon type/name/strength → myKd.dragon), explore.js (uncharted/max/costs → intel.explore),
      uniques.js (intel.uniques[]), aid.js (sendable resources → intel.econ when present),
      provnews.js (intel.provNews[] last 20). Card renders uniques/explore/recent-province-news.
      Kingdom ritual-in-development + dragon stored on myKd for the bot/header. All 15 parsers load
      with match+parse; routing verified collision-free. Verified by replaying real samples →
      full own-KD card renders every page (explore + recent news + ritual + wizards + buildings +
      military + net@home + econ).

## Ground rules
- Every step: back up touched files, `node --check`, show diff, apply to BOTH HTMLs + engine.
- **Never restart pm2 / reboot droplet without explicit OK.**
- Firewalls in `intel-server.js` stay (real wipe history).
