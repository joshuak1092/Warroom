// engine/parsers/enchantment.js — OUR OWN Mystics/Wizards (enchantment) page.
// Wizard count (+ WPA derived from land), mana %, and rune stockpile → intel.* via mergeIntel.
const WR = require(`../intel-shape.js`);
module.exports = {
  name: `enchantment`,
  match: u => ("" + u).indexOf(`/enchantment`) >= 0,
  parse: (t, p, ctx) => {
    t = "" + (t || "");
    const g = rx => { const m = t.match(rx); return m ? Number(m[1].replace(/,/g, ``)) : null; };
    const wiz = g(/Wizards\s+([\d,]+)/);
    const mana = g(/Mana\s+([\d,]+)%/);
    const runes = g(/Runes\s+([\d,]+)/);
    if (wiz == null && mana == null && runes == null) return;
    const patch = { now: ctx && ctx.now, ts: ctx && ctx.ts, type: "wizards" };
    if (wiz != null) patch.wizards = wiz;
    if (mana != null) patch.mana = mana;
    if (runes != null) patch.econ = { runes: runes };
    WR.mergeIntel(p, patch);
  }
};
