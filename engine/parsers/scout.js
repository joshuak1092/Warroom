// engine/parsers/scout.js — folds ENEMY scout/op results onto enemy provinces.
// Thievery + sorcery op result pages carry the TARGET enemy province's intel in
// the body. The other parsers only write to our own KD (engine builds its lookup
// from myKd); this one is kingdom-scope so it gets full `d` and writes enemies.
//
//   SPY_ON_THRONE      -> FULL throne (off/def/land/nw/pop/race/ruler/econ/units/
//                          trade balance/rituals/plague/war status) — everything
//                          the throne page shows, captured into p.intel.throne.
//   SPY_ON_DEFENSE     -> defense points
//   SPY_ON_EXPLORATION -> incoming/exploration land
//   SPY_ON_MILITARY / SPY_ON_SCIENCES / SURVEY / INFILTRATE_* -> raw result stashed
//                          in p.intel.pending[op] until a real sample is parsed
//                          (formats not yet captured — see report).
//   ROB_*/BRIBE_*/KIDNAP/SNATCH_NEWS -> recorded in p.ops[] (sabotage/op log).
//
// Never creates/affects OUR provinces. Updates an enemy province that already
// exists in its KD; for SPY ops that name the province in prose it adds it if new.

const N = x => { const v = parseFloat(("" + x).replace(/[, ]/g, "")); return isFinite(v) ? v : null; };
const nm = s => ((s || "") + "").toLowerCase().replace(/\s+/g, " ").trim();
const baseName = s => nm(s).replace(/^\d+\s+/, "");

function findEnemyKd(d, loc) {
  const ens = d.enemies || {};
  for (const id in ens) { if (ens[id] && (ens[id].loc || "") === loc) return ens[id]; }
  return null;
}
function findProv(kd, name) {
  const list = kd.provinces || (kd.provinces = []);
  const b = baseName(name);
  return list.find(p => baseName(p.name) === b) || list.find(p => nm(p.name) === nm(name)) || null;
}
// Parse the tab-separated 2-column throne block into a flat {key: rawValue} map.
function kvMap(block) {
  const map = {};
  ("" + block).split(/\n/).forEach(line => {
    const cells = line.split(/\t/).map(c => c.trim()).filter(c => c !== "");
    for (let i = 0; i + 1 < cells.length; i += 2) {
      const k = cells[i], v = cells[i + 1];
      if (/^[A-Za-z][A-Za-z .'/&-]*$/.test(k)) map[k] = v;
    }
  });
  return map;
}

module.exports = {
  name: "scout",
  scope: "kingdom",
  match: u => /\/(thievery|sorcery)/i.test("" + u),
  parse: (t, ctx) => {
    const d = ctx && ctx.d; if (!d) return;
    t = "" + (t || "");
    if (!/operation was a success|100% confidence|have infiltrated|uncover the exploration|The Province of /i.test(t)) return;
    const op = (("" + ((ctx && ctx.url) || "")).match(/[?&]o=([A-Z_]+)/) || [])[1] || "";
    const now = (ctx && ctx.now) || 0, ts = (ctx && ctx.ts) || 0;

    // --- target kingdom loc ---
    let loc = null, m;
    if ((m = t.match(/Target kingdom is .+?\((\d+:\d+)\)/i))) loc = m[1];
    if (!loc && (m = t.match(/The Province of .+?\((\d+:\d+)\)/i))) loc = m[1];
    if (!loc && (m = t.match(/(?:military ranks of|exploration activities of|Thieves'? Guilds? of|research centers of|Military Elders of) .+?\((\d+:\d+)\)/i))) loc = m[1];
    if (!loc || loc === (ctx.ourLoc || "")) return;
    const kd = findEnemyKd(d, loc); if (!kd) return;

    // --- target province name ---
    let name = null;
    if ((m = t.match(/The Province of (.+?)\s*\(\d+:\d+\)/i))) name = m[1].trim();
    else if ((m = t.match(/military ranks of (.+?)\s*\(\d+:\d+\)/i))) name = m[1].trim();
    else if ((m = t.match(/exploration activities of (.+?)\s*\(\d+:\d+\)/i))) name = m[1].trim();
    else if ((m = t.match(/Thieves'? Guilds? of (.+?)\s*\(\d+:\d+\)/i))) name = m[1].trim();
    else if ((m = t.match(/research centers of (.+?)\s*\(\d+:\d+\)/i))) name = m[1].trim();
    else if ((m = t.match(/Military Elders of (.+?)\s*\(\d+:\d+\)/i))) name = m[1].trim();
    else if ((m = t.match(/Select province:\s*\d*\s*(.+?)\s*(?:---|\(|\n|\r|$)/))) name = m[1].trim();
    if (!name) return;

    let p = findProv(kd, name);
    const cleanProse = /The Province of|military ranks of|exploration activities of|Thieves'? Guilds? of|research centers of|Military Elders of/i.test(t);
    if (!p) {
      if (!cleanProse) return;
      p = { id: now.toString(36) + Math.abs(name.charCodeAt(0) || 65).toString(36), name: name, race: "", pers: "", land: 0, nw: 0 };
      kd.provinces.push(p);
    }
    const intel = p.intel || (p.intel = {});

    // SPY_ON_THRONE — full throne page
    if (/The Province of /i.test(t)) {
      const i0 = t.indexOf("The Province of");
      let i1 = t.indexOf("Number of thieves", i0);
      if (i1 < 0) i1 = t.indexOf("Uniques", i0);
      if (i1 < 0) i1 = t.indexOf("Early indications", i0);
      if (i1 < 0) i1 = t.length;
      const block = t.slice(i0, i1);
      const map = kvMap(block);
      const gn = k => (map[k] != null ? N(map[k]) : null);
      const land = gn("Land");
      if (land != null) p.land = land;
      const off = gn("Off. Points"), df = gn("Def. Points");
      if (off != null) { p.offense = off; intel.offHome = off; }
      if (df != null) { p.defense = df; intel.defHome = df; }
      if (gn("Networth") != null) p.nw = gn("Networth");
      if (gn("Peasants") != null) p.pop = gn("Peasants");
      if (map["Race"]) p.race = map["Race"];
      if (map["Ruler"]) p.ruler = map["Ruler"];
      const L = p.land || land || 0;
      const thv = gn("Thieves"); if (thv != null && L) { p.tpa = Math.round(thv / L * 100) / 100; intel.thieves = thv; }
      const wiz = gn("Wizards"); if (wiz != null && L) { p.wpa = Math.round(wiz / L * 100) / 100; intel.wizards = wiz; }
      intel.throne = map;                               // EVERYTHING the throne page lists
      intel.throneDate = (block.match(/(\w+ \d+ of YR\d+)/) || [])[1] || intel.throneDate;
      intel.plague = /Plague has spread/i.test(t);
      const rit = t.match(/covered by the (\w+) ritual with ([\d.]+)% effectiveness[^.]*?lifted in (\d+) days/i);
      if (rit) intel.ritual = { name: rit[1], eff: parseFloat(rit[2]), days: +rit[3] };
      const war = t.match(/is at WAR with (.+?) \((\d+:\d+)\)/i);
      if (war) intel.warWith = { name: war[1].trim(), loc: war[2] };
      p.intelType = "throne"; intel.throneTs = ts;
    }
    // SPY_ON_DEFENSE
    else if (/defense points/i.test(t)) {
      const dm = t.match(/([\d,]+)\s+defense points/i);
      if (dm) { p.defense = N(dm[1]); intel.defHome = N(dm[1]); }
      if (p.intelType !== "throne") p.intelType = "defense";
      intel.defTs = ts;
    }
    // SPY_ON_EXPLORATION
    else if (/exploration activities/i.test(t)) {
      const em = t.match(/exploring\s+([\d,]+)\s+acres/i) || t.match(/([\d,]+)\s+acres/i);
      if (em) p.incomingLand = N(em[1]);
      if (!p.intelType) p.intelType = "exploration";
    }
    // INFILTRATE THIEVES' GUILD -> enemy thieves count + TPA
    else if (/Thieves'? Guild/i.test(t)) {
      const thm = t.match(/about ([\d,]+) thieves/i) || t.match(/([\d,]+) thieves employed/i);
      if (thm) {
        const thieves = N(thm[1]);
        if (thieves != null) {
          intel.thieves = thieves;
          const L = p.land || 0;
          if (L) p.tpa = Math.round(thieves / L * 100) / 100;
        }
      }
      if (p.intelType !== "throne") p.intelType = "guild";
      intel.guildTs = ts;
    }
    // SPY ON SCIENCES -> enemy science (books + effect per category)
    else if (/research centers of|Current Effects of Science/i.test(t)) {
      const list = [], rx = /([A-Za-z]+)\s+([\d,]+)\s+([+-][\d.]+)%\s*([^\n\r]*)/g; let sm;
      while ((sm = rx.exec(t)) !== null) {
        const desc = (sm[4] || "").trim();
        if (/scientist|generation|available|per acre|book/i.test(desc)) continue;
        list.push({ name: sm[1], books: N(sm[2]), effect: parseFloat(sm[3]), desc: desc });
      }
      if (list.length) intel.science = list;
      if (p.intelType !== "throne") p.intelType = "science";
      intel.sciTs = ts;
    }
    // SPY ON MILITARY -> at-home off/def, effectiveness, specialist mix, armies out
    else if (/Military Elders of|Net (Offensive|Defensive) Points at Home/i.test(t)) {
      const off = (m = t.match(/Net Offensive Points at Home\s+([\d,]+)/i)) ? N(m[1]) : null;
      const df = (m = t.match(/Net Defensive Points at Home\s+([\d,]+)/i)) ? N(m[1]) : null;
      if (off != null) { p.offense = off; intel.offHome = off; }
      if (df != null) { p.defense = df; intel.defHome = df; }
      if ((m = t.match(/Offensive Military Effectiveness\s+(?:is\s+)?([\d.]+)%/i))) intel.ome = parseFloat(m[1]);
      if ((m = t.match(/Defensive Military Effectiveness\s+(?:is\s+)?([\d.]+)%/i))) intel.dme = parseFloat(m[1]);
      if ((m = t.match(/([\d,]+) soldiers, ([\d,]+) offensive specialists, ([\d,]+) defensive specialists, ([\d,]+) elites and ([\d,]+) war horses/i))) {
        intel.soldiers = N(m[1]); intel.offSpecs = N(m[2]); intel.defSpecs = N(m[3]); intel.elites = N(m[4]); intel.warHorses = N(m[5]);
      }
      const days = []; let dm2, drx = /\(([\d.]+)\s*days?\s*left\)/gi; while ((dm2 = drx.exec(t)) !== null) days.push(parseFloat(dm2[1]));
      const cl = t.match(/Captured Land\s+([-\d,\t ]+)/i);
      let inc = 0; if (cl) (cl[1].match(/[\d,]+/g) || []).forEach(x => inc += (N(x) || 0));
      if (days.length) { p.armyOut = true; p.incomingLand = inc; intel.armyReturnDays = days; }
      if (p.intelType !== "throne") p.intelType = "military";
      intel.milTs = ts;
    }
    // Ops we don't yet have a sample format for — stash the raw result so the data
    // is RECORDED (not lost) and can be parsed once a real page is captured.
    else if (/SURVEY/i.test(op)) {
      const pend = intel.pending || (intel.pending = {});
      pend[op] = { ts: ts, text: t.slice(0, 1500) };
    }
    // Sabotage / resource ops -> op log (future "ops" view, alongside spells)
    else {
      const ops = p.ops || (p.ops = []);
      let detail = "";
      if ((m = t.match(/steal ([\d,]+) runes/i))) detail = "stole " + m[1] + " runes";
      else if ((m = t.match(/returned with ([\d,]+) gold/i))) detail = "stole " + m[1] + " gold";
      else if (/bribed an enemy general/i.test(t)) detail = "bribed a general";
      else if (/bribed members of our enemies' guild/i.test(t)) detail = "bribed thieves";
      else if ((m = t.match(/return with ([\d,]+) of them/i))) detail = "kidnapped " + m[1];
      ops.push({ op: op || "op", ts: ts, detail: detail });
      if (ops.length > 50) p.ops = ops.slice(-50);
    }

    p.lastScout = now;
    if (op) p.lastScoutOp = op;
    kd._rev = now; d._rev = now;
  },
};
