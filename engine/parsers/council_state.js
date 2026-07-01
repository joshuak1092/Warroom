// engine/parsers/council_state.js — OUR OWN State (council_state) page → intel.* via mergeIntel.
// Population, army/thieves/wizards, networth/land/honor, and the economy (daily income/wages,
// unfilled jobs, employment, max pop). Fills intel.econ so the 📋 card + bot show live economy.
const WR = require(`../intel-shape.js`);
module.exports = {
  name: `state`,
  match: u => ("" + u).indexOf(`/council_state`) >= 0,
  parse: (t, p, ctx) => {
    t = "" + (t || "");
    const g = rx => { const m = t.match(rx); return m ? Number(m[1].replace(/,/g, ``)) : null; };
    const patch = { now: ctx && ctx.now, ts: ctx && ctx.ts, type: "econ" };
    patch.pop = g(/Peasants\s+([\d,]+)/);
    patch.nw = g(/Current Networth\s+([\d,]+)/);
    patch.land = g(/Current Land\s+([\d,]+)/);
    patch.honor = g(/Current Honor\s+([\d,]+)/);
    patch.thieves = g(/\bThieves\s+([\d,]+)/);
    patch.wizards = g(/\bWizards\s+([\d,]+)/);
    const econ = {};
    const inc = g(/Daily Income\s+([\d,]+)/); if (inc != null) econ.income = inc;
    const wag = g(/Daily Wages\s+([\d,]+)/); if (wag != null) econ.wages = wag;
    const jobs = g(/Unfilled Jobs\s+([\d,]+)/); if (jobs != null) econ.jobs = jobs;
    const emp = g(/Employment\s+([\d,]+)%/); if (emp != null) econ.employment = emp;
    const mx = g(/Max Population\s+([\d,]+)/); if (mx != null) econ.maxPop = mx;
    const army = g(/\bArmy\s+([\d,]+)/); if (army != null) econ.army = army;
    if (Object.keys(econ).length) patch.econ = econ;
    WR.mergeIntel(p, patch);
  }
};
