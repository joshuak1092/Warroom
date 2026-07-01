// engine/parsers/science.js — OUR OWN Science page → intel.science via mergeIntel.
// Books + effect% + bonus text per category, plus scientist generation and next category.
// Same intel.science array shape the enemy Spy-on-Science op produces.
const WR = require(`../intel-shape.js`);
module.exports = {
  name: `science`,
  match: u => ("" + u).indexOf(`/science`) >= 0,
  parse: (t, p, ctx) => {
    t = "" + (t || "");
    const patch = { now: ctx && ctx.now, ts: ctx && ctx.ts, type: "science" };
    const sg = t.match(/Current scientist generation\s+([\d.]+)%/); if (sg) patch.scientistGen = parseFloat(sg[1]);
    const nc = t.match(/Category for next scientist:\s+([^\n]+)/); if (nc) patch.nextCat = nc[1].trim();
    const list = []; const rx = /([A-Za-z]+)\s+([\d,]+)\s+(-?[\d.]+)%\s*([^\n]*)/g; let m;
    while ((m = rx.exec(t)) !== null) {
      const desc = m[4].trim();
      if (!desc || /scientist|generation|available|per tick/i.test(desc)) continue;
      list.push({ name: m[1], books: Number(m[2].replace(/,/g, ``)), effect: parseFloat(m[3]), desc: desc });
    }
    if (list.length) patch.science = list;
    if (patch.science || patch.scientistGen != null || patch.nextCat) WR.mergeIntel(p, patch);
  }
};
