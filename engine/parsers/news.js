// engine/parsers/news.js — kingdom-scope war-log parser
const nm = s => ((s||``)+``).toLowerCase().split(/\s+/).join(` `).trim();
const N = x => parseInt((``+x).replace(/,/g,``),10)||0;
const W = require(`../war-util.js`);
const PP = t => { const m=(``+(t||``)).match(/(\d+)\s*-\s*(.+?)\s*\((\d+:\d+)\)\s*$/); return m?{num:+m[1],name:m[2].trim(),loc:m[3]}:null; };

const PATS = [
  [`ambush`,`land`,    /(?:(\d+\s*-\s*.+?\s*\(\d+:\d+\))\s+)?recaptured\s+([\d,]+)\s+acres of land from\s+(\d+\s*-\s*.+?\s*\(\d+:\d+\))/, [`atk`,`amt`,`def`]],
  [`trad march`,`land`,/(?:(\d+\s*-\s*.+?\s*\(\d+:\d+\))\s+)?captured\s+([\d,]+)\s+acres of land from\s+(\d+\s*-\s*.+?\s*\(\d+:\d+\))/, [`atk`,`amt`,`def`]],
  [`trad march`,`land`,/(?:(\d+\s*-\s*.+?\s*\(\d+:\d+\))\s+)?invaded\s+(\d+\s*-\s*.+?\s*\(\d+:\d+\))\s+and captured\s+([\d,]+)\s+acres/, [`atk`,`def`,`amt`]],
  [`conquest`,`land`,  /(?:(\d+\s*-\s*.+?\s*\(\d+:\d+\))\s+)?invaded\s+(\d+\s*-\s*.+?\s*\(\d+:\d+\))\s+and conquered\s+([\d,]+)\s+acres/, [`atk`,`def`,`amt`]],
  [`raze`,`land`,      /(?:(\d+\s*-\s*.+?\s*\(\d+:\d+\))\s+)?invaded\s+(\d+\s*-\s*.+?\s*\(\d+:\d+\))\s+and razed\s+([\d,]+)\s+acres/, [`atk`,`def`,`amt`]],
  [`ambush`,`land`,    /(?:(\d+\s*-\s*.+?\s*\(\d+:\d+\))\s+)?ambushed armies from\s+(\d+\s*-\s*.+?\s*\(\d+:\d+\))\s+and took\s+([\d,]+)\s+acres/, [`atk`,`def`,`amt`]],
  [`massacre`,`ppl`,   /(?:(\d+\s*-\s*.+?\s*\(\d+:\d+\))\s+)?killed\s+([\d,]+)\s+people within\s+(\d+\s*-\s*.+?\s*\(\d+:\d+\))/, [`atk`,`amt`,`def`]],
  [`failed`,`none`,    /(\d+\s*-\s*.+?\s*\(\d+:\d+\))\s+attempted an invasion of\s+(\d+\s*-\s*.+?\s*\(\d+:\d+\)),?\s+but was repelled/, [`atk`,`def`]],
];

function dragon(s, our){
  let m;
  if((m=s.match(/A\s+(\w+)\s+Dragon,\s*(.+?),\s*from\s+(.+?)\s*\((\d+:\d+)\)\s*has begun ravaging/))) return {type:`dragon`,dtype:m[1],dname:m[2].trim(),kd:m[3].trim(),status:`arrived`,dir:m[4]===our?`sent`:`received`};
  if((m=s.match(/(.+?)\s*\((\d+:\d+)\)\s*has begun the\s+(\w+)\s+Dragon project,\s*(.+?),\s*against/))) return {type:`dragon`,kd:m[1].trim(),dtype:m[3],dname:m[4].trim(),status:`project`,dir:m[2]===our?`sent`:`received`};
  if((m=s.match(/(.+?)\s+has slain the dragon,\s*(.+?)\s*,/))) return {type:`dragon`,prov:m[1].trim(),dname:m[2].trim(),status:`slain`,dir:/our land/i.test(s)?`received`:`sent`};
  return {type:`dragon`,status:`?`};
}

function classify(s, our){
  for(const row of PATS){
    const typ=row[0],unit=row[1],rx=row[2],roles=row[3];
    const m = s.match(rx); if(!m) continue;
    const d = {type:typ,unit:unit,amt:0,atk:null,def:null,anon:false};
    roles.forEach((role,i)=>{ const v=m[i+1]; if(role===`atk`) d.atk=PP(v); else if(role===`def`) d.def=PP(v); else if(role===`amt`) d.amt=N(v); });
    if(!d.atk){ d.atk={name:`(anonymous)`,loc:`?`,num:0}; d.anon=true; }
    return d;
  }
  if(/has begun ravaging|Dragon project|slain the dragon|ravaging our land/.test(s)) return dragon(s, our);
  return null;
}

module.exports = {
  name: `news`,
  scope: `kingdom`,
  match: u => (``+u).indexOf(`/kingdom_news`) >= 0,
  parse: (text, ctx) => {
    const our = (ctx && ctx.ourLoc) || `3:4`;
    const d = ctx && ctx.d, byn = (ctx && ctx.byn) || {}, ts = (ctx && ctx.ts) || 0;
    if(!d) return;
    const wl = d.warlog || (d.warlog = {});
    if(!wl.ev) wl.ev = {};
    if(!wl.dragons) wl.dragons = {};
    const lines = (``+(text||``)).split(/\n/);
    for(const line of lines){
      if(line.indexOf(`\t`) < 0) continue;
      const parts = line.split(`\t`); if(parts.length < 2) continue;
      const body = parts[parts.length-1].trim();
      const e = classify(body, our); if(!e) continue;
      e.date = parts[0].trim();
      if(e.type === `dragon`){
        const k = e.dname || (`?`+e.date);
        const g = wl.dragons[k] || (wl.dragons[k] = {name:e.dname,dtype:null,dir:null,status:[],slayer:null,kd:null});
        if(e.dtype) g.dtype=e.dtype; if(e.dir) g.dir=e.dir;
        if(e.status && g.status.indexOf(e.status)<0) g.status.push(e.status);
        if(e.prov) g.slayer=e.prov; if(e.kd) g.kd=e.kd;
      } else {
        const sig = e.date+`|`+(e.atk?e.atk.name:`?`)+`|`+(e.def?e.def.name:`?`)+`|`+e.type+`|`+e.amt;
        e.ts = (wl.ev[sig] && wl.ev[sig].ts) || ts;
        wl.ev[sig] = e;
      }
    }
    let keys = Object.keys(wl.ev);
    if(keys.length > 1500){ keys.slice(0, keys.length-1500).forEach(k=>delete wl.ev[k]); }
    for(const k in byn){ if(byn[k]) byn[k].attacks = {out:{},in:{}}; }
    const GAIN = {"trad march":1,conquest:1,ambush:1};
    const tot = {capOut:0,capIn:0,razeOut:0,razeIn:0,killOut:0,killIn:0};
    const bump = (b,t,a)=>{ b[t]=b[t]||[0,0]; b[t][0]++; b[t][1]+=a; };
    for(const sig in wl.ev){
      const e = wl.ev[sig]; const a=e.atk, df=e.def, amt=e.amt||0, land=(e.unit===`land`)?amt:0;
      if(a && a.loc===our){ const p=byn[nm(a.name)]; if(p) bump(p.attacks.out,e.type,amt); if(GAIN[e.type]) tot.capOut+=land; else if(e.type===`raze`) tot.razeOut+=amt; else if(e.type===`massacre`) tot.killOut+=amt; }
      if(df && df.loc===our){ const p=byn[nm(df.name)]; if(p) bump(p.attacks.in,e.type,amt); if(GAIN[e.type]) tot.capIn+=land; else if(e.type===`raze`) tot.razeIn+=amt; else if(e.type===`massacre`) tot.killIn+=amt; }
    }
    wl.totals = tot; wl.events = Object.keys(wl.ev).length; wl.updated = ts;
    try{ W.detectInNews(text, ctx); W.retag(d, our); }catch(_){}
  }
};
