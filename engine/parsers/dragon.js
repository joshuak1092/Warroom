// engine/parsers/dragon.js — dragon ravaging OUR kingdom (kingdom-scope).
// attack_dragon/info_dragon/fund_dragon/start_dragon pages → myKd.dragon
// {dtype, name, strength, status}. news.js logs dragon *events*; this captures the
// live remaining strength so the bot/site can show the current threat.
module.exports = {
  name: `dragon`,
  scope: `kingdom`,
  match: u => /_dragon\b/i.test("" + u),
  parse: (t, ctx) => {
    t = "" + (t || "");
    const d = ctx && ctx.d, mk = d && d.myKd; if (!mk) return;
    const now = (ctx && ctx.now) || 0, ts = (ctx && ctx.ts) || 0;
    const m = t.match(/The (\w+) Dragon,\s*(.+?),\s*is ravaging the lands of our kingdom!.*?estimate it to have ([\d,]+) points of strength/i);
    if (m) {
      mk.dragon = { dtype: m[1], name: m[2].trim(), strength: Number(m[3].replace(/,/g, ``)), status: "ravaging", ts: ts };
      mk._rev = now; d._rev = now; return;
    }
    // strength-only refresh if a dragon is already tracked
    const s = t.match(/([\d,]+) points of strength/i);
    if (s && mk.dragon) { mk.dragon.strength = Number(s[1].replace(/,/g, ``)); mk.dragon.ts = ts; mk._rev = now; d._rev = now; }
  }
};
