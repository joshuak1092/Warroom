// engine/parsers/aid.js — OUR OWN Aid page → intel.econ (province-scope).
// The aid page is mostly instructions; when it lists sendable resource amounts we capture
// them (gold/food/runes) into intel.econ. Instruction-only variants no-op safely.
const N = x => { const m = ("" + x).match(/-?[\d,]+/); return m ? Number(m[0].replace(/,/g, ``)) : null; };
module.exports = {
  name: `aid`,
  match: u => ("" + u).indexOf(`/game/aid`) >= 0,
  parse: (t, p, ctx) => {
    t = "" + (t || ""); if (!p) return;
    const econ = {};
    let m;
    if ((m = t.match(/([\d,]+)\s*(?:gold coins|gc)\b[^\n]{0,20}(?:available|to send)/i))) econ.money = N(m[1]);
    if ((m = t.match(/([\d,]+)\s*bushels[^\n]{0,20}(?:available|to send)/i))) econ.food = N(m[1]);
    if ((m = t.match(/([\d,]+)\s*runes[^\n]{0,20}(?:available|to send)/i))) econ.runes = N(m[1]);
    if (!Object.keys(econ).length) return;
    const it = p.intel || (p.intel = {}); econ.ts = (ctx && ctx.ts) || 0;
    it.econ = Object.assign(it.econ || {}, econ);
    p.lastScout = Math.max(p.lastScout || 0, (ctx && ctx.now) || 0);
  }
};
