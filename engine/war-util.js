// engine/war-util.js — war-boundary detection + saved war objects.
// Shared by parsers/news.js (kingdom_news declarations + withdrawal end)
// and parsers/throne.js (throne "concluded WAR" / "is at WAR" signals).
// All war records live at state-root d.wars = [ {war object} ].
//
// War object shape:
//   { id, enemyLoc, enemyName, dir, startTs, startDate,
//     endTs, endDate, eowcf, endReason,
//     stats:{ours,theirs}, attacks:[...] }
//
// Same enemy KD warred more than once => SEPARATE numbered records, because a
// new war is only opened when there is no currently-OPEN war for that location,
// and de-duped by (loc + startDate). War 2 vs 3:4 and War 6 vs 3:4 are distinct.

const N = x => { const v = parseFloat(("" + x).replace(/,/g, "")); return isFinite(v) ? v : 0; };

// Genesis is a SEPARATE game instance served under the "/gen/" path prefix (the
// real game is "/wol/"). Genesis news must NEVER create or affect real wars. Hard
// block at the source: any entry whose URL is Genesis (or literally "genesis") is
// ignored by detection. (The live /feed already filters to /wol/, this is belt-and-
// suspenders so detection is correct regardless of the caller.)
const isGenesis = url => /genesis|\/gen\//i.test("" + (url || ""));

// ---- boundary phrase patterns -------------------------------------------------
// START: capture group 1 = enemy KD name, group 2 = enemy loc (x:y).
const WAR_START_PATS = [
  { re: /We have declared WAR on (.+?) \((\d+:\d+)\)/i,            dir: "ours"   }, // we declared on them
  { re: /(.+?) \((\d+:\d+)\) has declared WAR with our kingdom/i, dir: "theirs" }, // they declared on us
];

// END: group 1 = enemy KD name, group 2 = enemy loc (x:y).
// HOOK: the victory-specific end phrase is still UNKNOWN (every war in the data so
// far ended in withdrawal). When you see the live "we won" wording, add it here as
// another { re, reason:"victory" } entry — no other code changes needed.
const WAR_END_PATS = [
  { re: /has concluded WAR with (.+?) \((\d+:\d+)\)/i,  reason: "concluded" }, // throne: fires win OR lose (the anchor)
  { re: /withdrawn from war with (.+?) \((\d+:\d+)\)/i, reason: "withdrawn" }, // kingdom_news: loss end
  // { re: /<VICTORY PHRASE HERE> \((\d+:\d+)\)/i,       reason: "victory"   }, // <-- ADD WHEN SEEN LIVE
];

// "is at WAR with X (x:y)" — not a transition, just current status; used only as a
// FALLBACK to open a war that was already ongoing before tracking began.
const WAR_ACTIVE_RE = /is at WAR with (.+?) \((\d+:\d+)\)/i;
// EoWCF expiry inside the concluded-WAR throne line.
const EOWCF_RE = /post war ceasefire state will expire on (.+?)[!.]/i;

function openWarsFor(d, loc) { return (d.wars || []).filter(w => w.enemyLoc === loc && !w.endTs); }

// Open a new numbered war unless one is already open for this loc, or this exact
// (loc + startDate) was already recorded. Returns the war (new or existing).
// `confirmed` = the signal came from THRONE (authoritative current-war status:
// "is at WAR with" / "concluded WAR with"). News declarations pass confirmed=false,
// so historical news echoes from prior ages don't masquerade as active wars; they
// still create a record (per spec) but stay unconfirmed until throne corroborates.
function openWar(d, { loc, name, ts, date, dir, confirmed }) {
  if (!loc) return null;
  if (!d.wars) d.wars = [];
  const already = openWarsFor(d, loc)[0];
  if (already) {                                   // already at war with this loc -> backfill it
    if (name && !already.enemyName) already.enemyName = name;
    if (dir && !already.dir) already.dir = dir;
    if (date && !already.startDate) already.startDate = date;          // news dates a throne-opened war
    if (date && ts && (!already.startTs || ts < already.startTs)) already.startTs = ts;
    if (confirmed) already.confirmed = true;
    return already;
  }
  // de-dupe re-seen declarations of the SAME war (the feed keeps replaying an old
  // declaration line in historical news long after the war ended). Match on
  // loc + in-game start date AND a nearby real timestamp (same sync era). A later-age
  // war that happens to reuse the same in-game date is seen at a far-apart real ts,
  // so it is NOT de-duped -> it gets its own record.
  const DUP_WINDOW = 7 * 24 * 3600 * 1000;
  const dup = (d.wars || []).find(w => w.enemyLoc === loc && w.startDate === date && date &&
    Math.abs((w.startTs || 0) - (ts || 0)) < DUP_WINDOW);
  if (dup) { if (confirmed) dup.confirmed = true; return dup; }
  const id = (d.wars.reduce((m, w) => Math.max(m, w.id || 0), 0)) + 1;
  const war = {
    id, enemyLoc: loc, enemyName: name || "", dir: dir || "",
    startTs: ts || 0, startDate: date || "",
    endTs: null, endDate: null, eowcf: null, endReason: null,
    confirmed: !!confirmed,
    stats: null, attacks: [],
  };
  d.wars.push(war);
  return war;
}

// Close the currently-open war for this loc (idempotent).
function closeWar(d, { loc, ts, date, eowcf, reason }) {
  if (!loc || !d.wars) return null;
  const war = openWarsFor(d, loc)[0];
  if (!war) return null;                           // nothing open for this loc
  war.endTs = ts || war.startTs || 0;
  war.endDate = date || null;
  if (eowcf) war.eowcf = eowcf;
  war.endReason = reason || "ended";
  war.confirmed = true;                            // a war we saw end is unquestionably real
  return war;
}

// Scan kingdom_news text (tab-separated "date\tbody" lines) for declarations + ends.
function detectInNews(text, ctx) {
  const d = ctx && ctx.d; if (!d) return;
  if (ctx && isGenesis(ctx.url)) return;           // hard block: never detect wars from Genesis news
  const ourLoc = ctx && ctx.ourLoc;
  const lines = ("" + (text || "")).split(/\n/);
  for (const line of lines) {
    if (line.indexOf("\t") < 0) continue;
    const parts = line.split("\t");
    const date = parts[0].trim();
    const body = parts[parts.length - 1].trim();
    for (const p of WAR_START_PATS) {
      const m = body.match(p.re);
      if (m) { if (m[2] !== ourLoc) openWar(d, { loc: m[2], name: m[1].trim(), ts: ctx.ts || 0, date, dir: p.dir }); break; }
    }
    for (const p of WAR_END_PATS) {
      const m = body.match(p.re);
      if (m) { if (m[2] !== ourLoc) closeWar(d, { loc: m[2], ts: ctx.ts || 0, date, reason: p.reason }); break; }
    }
  }
}

// Scan throne text for "concluded WAR" (universal end + EoWCF) and "is at WAR"
// (fallback opener). Throne text is not tab-dated, so no in-game date here.
function detectInThrone(text, ctx) {
  const d = ctx && ctx.d; if (!d) return;
  if (ctx && isGenesis(ctx.url)) return;           // hard block: never detect wars from Genesis throne
  const t = "" + (text || "");
  for (const p of WAR_END_PATS) {
    const m = t.match(p.re);
    if (m) {
      const ew = t.match(EOWCF_RE);
      closeWar(d, { loc: m[2], ts: ctx.ts || 0, eowcf: ew ? ew[1].trim() : null, reason: p.reason });
    }
  }
  const a = t.match(WAR_ACTIVE_RE);
  if (a) openWar(d, { loc: a[2], name: a[1].trim(), ts: ctx.ts || 0, date: "", confirmed: true }); // throne = authoritative
}

// Recompute every war's attack list + tallies from the engine's warlog.ev.
// Idempotent: produces identical output for unchanged input. Tags each attack to
// the war whose enemyLoc matches AND whose [startTs,endTs] window contains it;
// when an attack has no ts (legacy events), falls back to the single war for that
// loc (the historical wars have unique locations).
function retag(d, ourLoc) {
  if (!d.wars || !d.wars.length) return;
  const ev = (d.warlog && d.warlog.ev) || {};
  const GAIN = { "trad march": 1, conquest: 1, ambush: 1 };
  const MAP = { "trad march": "traditional", raze: "raze", conquest: "conquest", plunder: "plunder", massacre: "massacre", ambush: "ambush" };
  const blank = () => ({ attacks: 0, traditional: 0, raze: 0, conquest: 0, plunder: 0, massacre: 0, ambush: 0, land: 0, killed: 0 });

  const buckets = {};
  for (const w of d.wars) { w.attacks = []; w.stats = { ours: blank(), theirs: blank() }; buckets[w.id] = w; }

  const pick = (loc, ts) => {
    const cands = d.wars.filter(w => w.enemyLoc === loc);
    if (!cands.length) return null;
    if (ts) { const hit = cands.find(w => ts >= (w.startTs || 0) && ts <= (w.endTs || Infinity)); if (hit) return hit; }
    return cands.length === 1 ? cands[0] : cands[cands.length - 1]; // legacy/no-ts -> latest for that loc
  };

  for (const sig in ev) {
    const e = ev[sig]; const a = e.atk, df = e.def;
    let enemyLoc = null, dir = null;
    if (a && a.loc === ourLoc) { enemyLoc = df && df.loc; dir = "ours"; }
    else if (df && df.loc === ourLoc) { enemyLoc = a && a.loc; dir = "theirs"; }
    if (!enemyLoc || enemyLoc === "?") continue;
    const w = pick(enemyLoc, e.ts || 0);
    if (!w) continue;
    const amt = e.amt || 0, land = (e.unit === "land") ? amt : 0;
    const side = dir === "ours" ? w.stats.ours : w.stats.theirs;
    side.attacks++; const k = MAP[e.type]; if (k) side[k]++;
    if (GAIN[e.type]) side.land += land; if (e.type === "massacre") side.killed += amt;
    w.attacks.push({ ts: e.ts || 0, date: e.date || "", type: e.type, dir,
      atkName: a ? a.name : "", atkLoc: a ? a.loc : "", defName: df ? df.name : "", defLoc: df ? df.loc : "",
      amt, unit: e.unit });
  }
  for (const w of d.wars) w.attacks.sort((x, y) => (x.ts || 0) - (y.ts || 0));
}

module.exports = {
  WAR_START_PATS, WAR_END_PATS, WAR_ACTIVE_RE, EOWCF_RE,
  openWar, closeWar, detectInNews, detectInThrone, retag, N, isGenesis,
};
