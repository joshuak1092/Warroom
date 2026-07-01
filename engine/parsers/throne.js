// engine/parsers/throne.js — OUR OWN throne page → full intel.* via WRIntel.mergeIntel.
// Same richness as an enemy Spy-on-Throne: the whole throne grid is captured into
// intel.throne, plus offense/defense/land/nw/pop, thieves/wizards (+ stealth/mana %),
// war horses, prisoners, ritual, plague, war status, self-spells, and army-out timing.
const W = require(`../war-util.js`);
const WR = require(`../intel-shape.js`);
const N = x => { const m = ("" + x).match(/-?[\d,]+(?:\.\d+)?/); return m ? Number(m[0].replace(/,/g, ``)) : null; };

// Tab-separated throne grid → {key: rawValue}. Rows are 4-col (key\tval\tkey\tval).
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
  name: `throne`,
  match: u => ("" + u).indexOf(`/throne`) >= 0,
  provName: t => { const m = ("" + t).match(/The Province of (.+?)\s*\((\d+:\d+)\)/); return m ? m[1].trim() : ``; },
  parse: (t, p, ctx) => {
    t = "" + (t || "");
    // keep war-boundary detection (unchanged behavior)
    if (ctx && ctx.d) { try { W.detectInThrone(t, { d: ctx.d, ts: ctx.ts, url: ctx.url }); if (ctx.d.wars && ctx.d.wars.length) W.retag(ctx.d, (ctx.d.myKd && ctx.d.myKd.loc) || `3:4`); } catch (_) {} }

    // isolate the throne grid block
    let i0 = t.indexOf("The Province of"); if (i0 < 0) i0 = 0;
    let i1 = t.length;
    ["We are covered", "Notices", "\nInfo", "Duration:", "Early indications", "Number of thieves"].forEach(mrk => { const j = t.indexOf(mrk, i0); if (j >= 0 && j < i1) i1 = j; });
    const block = t.slice(i0, i1);
    const map = kvMap(block);
    const gn = k => (map[k] != null ? N(map[k]) : null);

    const patch = { now: ctx && ctx.now, ts: ctx && ctx.ts, type: "throne", throne: map };
    patch.race = map["Race"]; patch.ruler = map["Ruler"];
    patch.land = gn("Land"); patch.nw = gn("Networth"); patch.pop = gn("Peasants");
    patch.offense = gn("Off. Points"); patch.defense = gn("Def. Points");
    patch.thieves = gn("Thieves"); patch.wizards = gn("Wizards");
    patch.warHorses = gn("War Horses"); patch.prisoners = gn("Prisoners");
    // stealth / mana % ride inside the Thieves / Wizards cells as "(NN%)"
    const stl = (map["Thieves"] || "").match(/\((\d+)%\)/); if (stl) patch.stealth = +stl[1];
    const mn = (map["Wizards"] || "").match(/\((\d+)%\)/); if (mn) patch.mana = +mn[1];
    patch.throneDate = (block.match(/(\w+ \d+ of YR\d+)/) || [])[1];

    // ritual / plague / war status (same signals the enemy card shows)
    const rit = t.match(/covered by the (\w+) ritual with ([\d.]+)% effectiveness[^.]*?lifted in (\d+) days/i);
    if (rit) patch.ritual = { name: rit[1], eff: parseFloat(rit[2]), days: +rit[3] };
    patch.plague = /Plague has spread/i.test(t);
    const war = t.match(/is at WAR with (.+?) \((\d+:\d+)\)/i);
    if (war) patch.warWith = { name: war[1].trim(), loc: war[2] };

    // self-spells: "Duration: Name ( N days ) ..."
    const dur = t.match(/Duration:\s*([^\n]+)/);
    if (dur) {
      const sp = []; const srx = /([A-Za-z][A-Za-z'’\- ]*?)\s*\(\s*(\d+)\s*days?\s*\)/g; let sm;
      while ((sm = srx.exec(dur[1])) !== null) sp.push({ name: sm[1].trim(), days: Number(sm[2]) });
      if (sp.length) patch.spells = sp;
    }

    // army-out timing: "Armies :  ... (N days left) (land) ..."
    let ts = ctx && ctx.ts; if (ts > 0 && ts < 1e12) ts = ts * 1000;
    const ageH = ts ? ((ctx.now - ts) / 3.6e6) : 0;
    const arm = t.match(/Armies\s*:([^\n]*)/);
    let days = [], lands = [];
    if (arm) { const rx = /\(([\d.]+)\s*days? left\)\s*\((\d[\d,]*)\)/g; let mm; while ((mm = rx.exec(arm[1])) !== null) { days.push(parseFloat(mm[1])); lands.push(Number(mm[2].replace(/,/g, ``))); } }
    const soon = days.length ? Math.min(...days) - ageH : 0;
    if (days.length && soon > 0) {
      patch.military = { armyReturnDays: days, armyOut: true, returnTick: Math.ceil(soon), incomingLand: lands.reduce((a, b) => a + b, 0) };
    } else {
      patch.military = { armyOut: false, returnTick: 0, incomingLand: 0 };
    }

    WR.mergeIntel(p, patch);
  }
};
