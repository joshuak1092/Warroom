// engine/parsers/council_military.js — OUR OWN Military Council page → intel.* via mergeIntel.
// The authoritative own-military source: OME/DME, net off/def points at home, generals
// available, war horses, and army-out (returning armies + incoming captured land). Complements
// train_army (which supplies the per-unit off/def spec breakdown) — both merge into one card.
const WR = require(`../intel-shape.js`);
module.exports = {
  name: `council_military`,
  match: u => ("" + u).indexOf(`/council_military`) >= 0,
  parse: (t, p, ctx) => {
    t = "" + (t || "");
    const g = rx => { const m = t.match(rx); return m ? Number(m[1].replace(/,/g, ``)) : null; };
    const gf = rx => { const m = t.match(rx); return m ? parseFloat(m[1]) : null; };
    const mil = {};
    const ga = g(/(\d[\d,]*)\s+generals available/i); if (ga != null) mil.generalsAvail = ga;
    const ome = gf(/Offensive Military Effectiveness\s+([\d.]+)%/i); if (ome != null) mil.ome = ome;
    const dme = gf(/Defensive Military Effectiveness\s+([\d.]+)%/i); if (dme != null) mil.dme = dme;
    const oh = g(/Net Offensive Points at Home\s+([\d,]+)/i); if (oh != null) mil.offHome = oh;
    const dh = g(/Net Defensive Points at Home\s+([\d,]+)/i); if (dh != null) mil.defHome = dh;
    const wh = g(/War Horses\s+([\d,]+)/i); if (wh != null) mil.warHorses = wh;
    // army-out: "Captured Land" row lists incoming acres per returning army ("-" when home)
    const cl = t.match(/Captured Land\s+([-\d,\t ]+)/i);
    let inc = 0, anyOut = false;
    if (cl) (cl[1].match(/[\d,]+/g) || []).forEach(x => { const n = Number(x.replace(/,/g, ``)); if (n > 0) { inc += n; anyOut = true; } });
    const days = []; let dm, drx = /\(([\d.]+)\s*days?\s*left\)/gi; while ((dm = drx.exec(t)) !== null) days.push(parseFloat(dm[1]));
    if (days.length) { mil.armyReturnDays = days; mil.armyOut = true; }
    if (anyOut) { mil.incomingLand = inc; mil.armyOut = true; }
    if (Object.keys(mil).length) WR.mergeIntel(p, { now: ctx && ctx.now, ts: ctx && ctx.ts, type: "military", military: mil });
  }
};
