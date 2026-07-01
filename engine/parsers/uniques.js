// engine/parsers/uniques.js — OUR OWN Unique Abilities page → intel.uniques (province-scope).
// Captures each ability the province holds: "Name<TAB>Category(Passive/Active/…)<TAB>effect".
module.exports = {
  name: `uniques`,
  match: u => ("" + u).indexOf(`/uniques`) >= 0,
  parse: (t, p, ctx) => {
    t = "" + (t || ""); if (!p) return;
    const list = []; const rx = /^(.{2,48}?)\t\s*(Passive|Active|Triggered|Aura|Conditional)\b([^\n]*)/gmi; let m;
    while ((m = rx.exec(t)) !== null) {
      const nmv = m[1].trim();
      if (!nmv || /unique|category|ability|effect/i.test(nmv)) continue;
      list.push({ name: nmv, type: m[2], effect: (m[3] || "").replace(/^\t+/, "").trim() });
    }
    if (!list.length) return;
    const it = p.intel || (p.intel = {}); it.uniques = list;
    p.lastScout = Math.max(p.lastScout || 0, (ctx && ctx.now) || 0);
  }
};
