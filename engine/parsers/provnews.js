// engine/parsers/provnews.js — OUR OWN Province Reporter (province_news) → intel.provNews.
// Per-province monthly log lines ("Month day of YRn <TAB> event text"). Kept to the last 20.
// Distinct from news.js, which handles the kingdom-wide war log (kingdom_news).
module.exports = {
  name: `provnews`,
  match: u => ("" + u).indexOf(`province_news`) >= 0,
  parse: (t, p, ctx) => {
    t = "" + (t || ""); if (!p) return;
    const log = []; const rx = /^([A-Z][a-z]+ \d+ of YR\d+)\t([^\n]+)/gm; let m;
    while ((m = rx.exec(t)) !== null) log.push({ date: m[1], text: m[2].trim() });
    if (!log.length) return;
    const it = p.intel || (p.intel = {}); it.provNews = log.slice(-20);
    p.lastScout = Math.max(p.lastScout || 0, (ctx && ctx.now) || 0);
  }
};
