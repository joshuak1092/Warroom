// engine/parsers/explore.js — OUR OWN Explore/Growth page → intel.explore (province-scope).
// Uncharted acres available, max explorable now, currently exploring, and per-acre costs.
const N = x => { const m = ("" + x).match(/-?[\d,]+/); return m ? Number(m[0].replace(/,/g, ``)) : null; };
module.exports = {
  name: `explore`,
  match: u => ("" + u).indexOf(`/explore`) >= 0,
  parse: (t, p, ctx) => {
    t = "" + (t || ""); if (!p) return;
    const g = rx => { const m = t.match(rx); return m ? N(m[1]) : null; };
    const ex = {};
    const un = g(/Available Uncharted Acres\s+([\d,]+)/i); if (un != null) ex.uncharted = un;
    const mx = g(/Maximum Explorable Now\s+([\d,]+)/i); if (mx != null) ex.maxExplore = mx;
    const cur = g(/Currently Exploring\s+([\d,]+)/i); if (cur != null) ex.exploring = cur;
    const cs = g(/Exploration Costs \(Soldiers\)\s+([\d,]+)/i); if (cs != null) ex.costSoldiers = cs;
    const cg = g(/Exploration Costs \(Gold\)\s+([\d,]+)/i); if (cg != null) ex.costGold = cg;
    if (!Object.keys(ex).length) return;
    const it = p.intel || (p.intel = {}); ex.ts = (ctx && ctx.ts) || 0; it.explore = ex;
    p.lastScout = Math.max(p.lastScout || 0, (ctx && ctx.now) || 0);
  }
};
