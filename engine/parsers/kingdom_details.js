// engine/parsers/kingdom_details.js — KD roster page → build/enrich rosters SERVER-SIDE.
// Ports the browser's parseKingdomProvinces so enemy rosters build with zero browsers open.
//
// SAFETY: the engine writes state.json directly, bypassing the server's /save anti-wipe
// firewalls, and myKd wipes have a painful history. So:
//   • OUR OWN kingdom (loc === ourLoc) is ENRICH-ONLY (updateOnly): update race/land/nw of
//     provinces that already exist, NEVER add, remove, or reduce the roster. myKd is created
//     by CSV import, exactly as before. Identity is the KD NUMBER (loc), never the name.
//   • ENEMY kingdoms are created/updated freely (matched by loc, never duplicated).
// Only ever adds/updates — never deletes.
const RACES = ["Avian", "Dark Elf", "Dwarf", "Elf", "Faery", "Halfling", "Human", "Orc", "Undead"];

function cleanProvName(n) {
  let s = ((n || "") + "");
  s = s.replace(/[~¬`*™]+/g, "");
  s = s.replace(/\s*\(\d{1,2}:\d{1,2}\)\s*$/, "");
  s = s.replace(/(?:TM)?\d[\d.,]*%.*$/i, "");
  s = s.replace(/\s+(?:TM|\(M\)|\(S\))\s*$/i, "");
  return s.trim();
}
function findProvByName(list, name) {
  if (!Array.isArray(list) || name == null) return null;
  const c = cleanProvName(name).toLowerCase().trim();
  let p = list.find(x => cleanProvName(x.name).toLowerCase().trim() === c); if (p) return p;
  const strip = s => cleanProvName(s).toLowerCase().replace(/^\d+\s+/, "").trim();
  const hasNum = s => /^\d+\s+/.test(cleanProvName(s).toLowerCase().trim());
  const base = strip(name); if (!base) return null;
  return list.find(x => strip(x.name) === base && !(hasNum(x.name) && hasNum(name))) || null;
}
function parseKingdomProvinces(txt, kd, updateOnly, now) {
  if (!txt || !kd) return 0;
  kd.provinces = kd.provinces || [];
  let body = txt;
  const pi = txt.search(/\bProvinces\b/); if (pi >= 0) body = txt.slice(pi);
  const we = body.search(/War Doctrines/i); if (we >= 0) body = body.slice(0, we);
  const lines = body.split(/\n+/);
  let added = 0, touched = 0;
  for (const raw of lines) {
    const line = raw.replace(/ /g, " ").replace(/\t+/g, "\t").trim();
    if (!line) continue;
    let cols = line.split(/\t|\s{2,}/).map(c => c.trim()).filter(c => c !== "");
    if (cols.length < 4) continue;
    if (!/^\d{1,3}$/.test(cols[0])) continue;                 // first col must be a slot number
    if (cols.slice(1).every(c => c === "-")) continue;         // empty slot row
    let name = (cols[1] || "").replace(/\*/g, "").replace(/\((?:M|S)\)/g, "").trim();
    if (!name || name === "-") continue;
    let race = ""; for (const c of cols) { for (const r of RACES) { if (c.toLowerCase() === r.toLowerCase()) { race = r; break; } } if (race) break; }
    if (!race) { for (const r of RACES) { const rx = new RegExp("\\s+" + r.replace(/ /g, "\\s+") + "$", "i"); if (rx.test(name)) { race = r; name = name.replace(rx, "").trim(); break; } } }
    let land = 0; const lm = line.match(/([\d,]+)\s*a(?:cres)?\b/i); if (lm) land = parseInt(lm[1].replace(/,/g, ""), 10) || 0;
    let nw = 0; const nwm = line.match(/([\d,]+)\s*gc/i); if (nwm) nw = parseInt(nwm[1].replace(/,/g, ""), 10) || 0;
    name = cleanProvName(name);
    let p = findProvByName(kd.provinces, name);
    if (!p) { if (updateOnly) continue; p = { id: (now || 0).toString(36) + Math.abs(name.charCodeAt(0) || 65).toString(36) + kd.provinces.length.toString(36), name: name, race: "", pers: "", land: 0, nw: 0, honor: 0, defense: 0, offense: 0, tpa: "", wpa: "", mdtpa: "", mdwpa: "", armyOut: false, returnTick: 0, incomingLand: 0, generalsUsed: 0, pop: 0, maxpop: 0 }; kd.provinces.push(p); added++; }
    if (race) p.race = race;
    if (land) p.land = land;
    if (nw) p.nw = nw;
    touched++;
  }
  if (added || touched) kd._rev = now || 0;
  return added;
}

module.exports = {
  name: `kingdom_details`,
  scope: `kingdom`,
  match: u => ("" + u).indexOf(`kingdom_details`) >= 0,
  parse: (t, ctx) => {
    t = "" + (t || "");
    const d = ctx && ctx.d; if (!d) return;
    const now = (ctx && ctx.now) || 0;
    const url = ("" + ((ctx && ctx.url) || ""));
    const ourLoc = ((ctx && ctx.ourLoc) || (d.myKd && d.myKd.loc) || "").trim();

    // KD number (loc): from the URL first, else the kingdom header in the body.
    let loc = null;
    const mu = url.match(/kingdom_details\/(\d{1,3})\/(\d{1,3})/); if (mu) loc = mu[1] + ":" + mu[2];
    if (!loc) { const mh = t.match(/kingdom\s+of\s+[^()\n|]+?\s*\((\d{1,3}):(\d{1,3})\)/i); if (mh) loc = mh[1] + ":" + mh[2]; }
    if (!loc) { const mt = t.match(/\((\d{1,3}):(\d{1,3})\)/); if (mt) loc = mt[1] + ":" + mt[2]; }
    if (!loc) return;

    // KD name from the header ("The ... kingdom of NAME (x:y)").
    let name = null;
    const mn = t.match(/kingdom\s+of\s+([^()\n|]+?)\s*\(\d+:\d+\)/i);
    if (mn) name = mn[1].trim();

    // OUR OWN kingdom — enrich only, identity by number.
    if (ourLoc && /^\d{1,2}:\d{1,2}$/.test(ourLoc) && loc === ourLoc) {
      const mk = d.myKd; if (!mk) return;
      if (name) mk.name = name;                    // current-age name; identity stays the number
      parseKingdomProvinces(t, mk, true, now);     // updateOnly: never add/remove our provinces
      mk._rev = now; d._rev = now;
      return;
    }

    // ENEMY kingdom — match by loc, create the shell if new, then load its roster.
    d.enemies = d.enemies || {};
    let e = null; for (const id in d.enemies) { if (d.enemies[id] && (d.enemies[id].loc || "") === loc) { e = d.enemies[id]; break; } }
    if (!e) {
      const nid = now.toString(36) + Math.abs((loc.charCodeAt(0) || 65)).toString(36) + Object.keys(d.enemies).length.toString(36);
      e = { id: nid, name: name || ("KD " + loc), loc: loc, status: "available", warMode: "out", eowcfExit: "", note: "", wave: [], targets: [], provinces: [], _rev: now };
      d.enemies[nid] = e;
    } else if (name && name !== e.name && !/^KD /.test(name)) {
      e.name = name;
    }
    parseKingdomProvinces(t, e, false, now);
    e._rev = now; d._rev = now;
  }
};
