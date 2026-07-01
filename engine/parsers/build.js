// engine/parsers/build.js — OUR OWN Buildings (build) page → intel.survey via mergeIntel.
// Full building distribution (qty + % of land), in-progress construction, plus land/
// undeveloped/cost/time/credits stats — the same intel.survey shape the enemy Survey op
// produces, so one renderer draws both.
const WR = require(`../intel-shape.js`);
module.exports = {
  name: `build`,
  match: u => ("" + u).indexOf(`/build`) >= 0,
  parse: (t, p, ctx) => {
    t = "" + (t || "");
    const g = rx => { const m = t.match(rx); return m ? Number(m[1].replace(/,/g, ``)) : null; };
    const totalLand = g(/Total Land\s+([\d,]+)/);
    const stats = {};
    if (totalLand != null) stats.total = totalLand;
    const ud = g(/Total Undeveloped land\s+([\d,]+)/); if (ud != null) stats.undeveloped = ud;
    const cc = g(/Construction Cost\s+([\d,]+)/); if (cc != null) stats.cost = cc;
    const ct = g(/Construction Time\s+([\d,]+)/); if (ct != null) stats.time = ct;
    const fc = g(/Free Building Credits\s+([\d,]+)/); if (fc != null) stats.credits = fc;

    const i1 = t.indexOf(`In Progress`), i2 = t.indexOf(`Accelerated`);
    const seg = (i1 >= 0 && i2 > i1) ? t.slice(i1, i2) : t;
    const buildings = [], underConstruction = [];
    const rx = /([A-Za-z][^\t\n0-9]*?)\s+(\d+)\s+(\d+)/g; let m;
    const L = totalLand || Number(p.land) || 0;
    while ((m = rx.exec(seg)) !== null) {
      const nm = m[1].trim(); if (/^building$|^you own$/i.test(nm)) continue;
      const own = Number(m[2]), prog = Number(m[3]);
      buildings.push({ name: nm, qty: own, prog: prog, pct: L ? Math.round(own / L * 1000) / 10 : 0 });
      if (prog > 0) underConstruction.push({ name: nm, qty: prog });
    }
    if (!buildings.length && totalLand == null) return; // nothing recognized

    WR.mergeIntel(p, {
      now: ctx && ctx.now, ts: ctx && ctx.ts, type: "survey",
      survey: { total: totalLand, buildings: buildings, underConstruction: underConstruction, stats: stats }
    });
  }
};
