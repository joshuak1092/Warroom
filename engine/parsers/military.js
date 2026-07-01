// engine/parsers/military.js — OUR OWN Military (train_army) page → intel.* via mergeIntel.
// Captures the full unit table, spec/elite/soldier counts, wizard/thief pops, draft rate,
// specialist credits, and total/military/peasant populations. EPA·OSPA·DSPA are derived
// downstream by mergeIntel from land.
const WR = require(`../intel-shape.js`);
module.exports = {
  name: `military`,
  match: u => ("" + u).indexOf(`/train_army`) >= 0,
  parse: (t, p, ctx) => {
    t = "" + (t || "");
    const g = rx => { const m = t.match(rx); return m ? Number(m[1].replace(/,/g, ``)) : null; };
    const mil = {};
    mil.totalPop = g(/Total population\s+([\d,]+)/);
    mil.milPop = g(/Military & Thief population\s+([\d,]+)/);
    mil.peasants = g(/Peasant population\s+([\d,]+)/);
    mil.soldiers = g(/Number of soldiers\s+([\d,]+)/);
    const wizPop = g(/Wizard population\s+([\d,]+)/);
    mil.credits = g(/Free specialist credits left\s+([\d,]+)/);
    const dr = t.match(/Draft rate:\s+([^\n]+)/); if (dr) mil.draftRate = dr[1].trim();

    const units = []; const rx = /([A-Za-z][^\n(]*)\((\d+)\/(\d+)\)\s+([\d,]+)\s+([\d,]+)/g; let m;
    while ((m = rx.exec(t)) !== null) {
      units.push({ name: m[1].replace(/[^A-Za-z ]/g, ``).trim(), off: Number(m[2]), def: Number(m[3]), own: Number(m[4].replace(/,/g, ``)), training: Number(m[5].replace(/,/g, ``)) });
    }
    let thieves = null;
    if (units.length) {
      let oS = 0, dS = 0, el = 0, th = 0;
      units.forEach(u => { if (/thie/i.test(u.name)) th += u.own; else if (u.off > 0 && u.def === 0) oS += u.own; else if (u.off === 0 && u.def > 0) dS += u.own; else if (u.off > 0 && u.def > 0) el += u.own; });
      mil.units = units; mil.offSpecs = oS; mil.defSpecs = dS; mil.elites = el; thieves = th;
    }

    WR.mergeIntel(p, {
      now: ctx && ctx.now, ts: ctx && ctx.ts, type: "military",
      thieves: thieves, wizards: wizPop,
      military: mil
    });
  }
};
