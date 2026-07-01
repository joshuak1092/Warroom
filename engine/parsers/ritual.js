// engine/parsers/ritual.js — OUR kingdom's ritual status (kingdom-scope).
// status_ritual → the active ritual (name, effectiveness left, days to lift, % destroyed);
// cast_ritual  → the ritual in development (casts done/needed, days left, start effectiveness).
// Stored on myKd (kingdom-level) and stamped onto each province's intel.ritual so the 📋 card
// shows coverage even before a throne page is captured.
module.exports = {
  name: `ritual`,
  scope: `kingdom`,
  match: u => /\/(cast_ritual|status_ritual)/i.test("" + u),
  parse: (t, ctx) => {
    t = "" + (t || "");
    const d = ctx && ctx.d, mk = d && d.myKd; if (!mk) return;
    const now = (ctx && ctx.now) || 0, ts = (ctx && ctx.ts) || 0;
    let touched = false;
    // active ritual
    let m = t.match(/covered by the (\w+) ritual\. It was started (\d+) days ago and will be lifted in (\d+) days/i);
    if (m) {
      const eff = (t.match(/([\d.]+)% effectiveness is left/i) || [])[1];
      const dest = (t.match(/([\d.]+)% destroyed/i) || [])[1];
      mk.ritual = { name: m[1], startedDaysAgo: +m[2], days: +m[3], eff: eff != null ? parseFloat(eff) : null, destroyed: dest != null ? parseFloat(dest) : null, ts: ts };
      (mk.provinces || []).forEach(p => { const it = p.intel || (p.intel = {}); it.ritual = { name: mk.ritual.name, eff: mk.ritual.eff, days: mk.ritual.days }; });
      touched = true;
    }
    // ritual in development
    let b = t.match(/begun the development of the (\w+) ritual\. It was started (\d+) days ago and we have (\d+) days to complete/i);
    if (b) {
      const casts = t.match(/(\d+) casts have been performed out of (\d+)/i);
      const se = t.match(/start at ([\d.]+)% effectiveness/i);
      mk.ritualBuilding = { name: b[1], startedDaysAgo: +b[2], daysLeft: +b[3], casts: casts ? +casts[1] : null, needed: casts ? +casts[2] : null, startEff: se ? parseFloat(se[1]) : null, ts: ts };
      touched = true;
    }
    if (touched) { mk._rev = now; d._rev = now; }
  }
};
