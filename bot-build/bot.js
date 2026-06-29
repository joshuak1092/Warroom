require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require('discord.js');
const { makeNewsParser } = require('./parser.js');
const http = require('http');
const fs = require('fs');
const SEEN_FILE = __dirname + '/seen.json';
let seenPosted = new Set();
try { seenPosted = new Set(JSON.parse(fs.readFileSync(SEEN_FILE,'utf8'))); } catch(e) {}
function markSeen(key){ seenPosted.add(key); if(seenPosted.size>8000){ const a=[...seenPosted]; seenPosted=new Set(a.slice(a.length-6000)); } try{ fs.writeFileSync(SEEN_FILE, JSON.stringify([...seenPosted])); }catch(e){} }
function alreadyPosted(key){ return seenPosted.has(key); }
const LINKS_FILE = __dirname + '/links.json';
let links = {};
try { links = JSON.parse(fs.readFileSync(LINKS_FILE,'utf8')); } catch(e) { links = {}; }
function saveLinks(){ try { fs.writeFileSync(LINKS_FILE, JSON.stringify(links,null,2)); } catch(e){} }
function provKey(name){ return (name||'').toLowerCase().trim(); }
function findLinkByUser(uid){ for(const k in links){ if(links[k].discord_id===uid) return {prov:links[k].prov, key:k}; } return null; }
function cleanProvName(s){ return (s||'').toLowerCase().replace(/^\d+\s*-\s*/,'').replace(/\s*\(\d+:\d+\)\s*$/,'').replace(/[~`*]+/g,'').trim(); }
function linkForTarget(target){
  const t = cleanProvName(target);
  for(const k in links){ if(cleanProvName(links[k].prov)===t) return links[k]; }
  return null;
}
// Parse armies-out from a throne page: returns [{days, land}]
function parseArmies(txt){
  const m=txt.match(/Armies\s*:([^\n]+)/); if(!m) return [];
  const out=[]; const re=/\(([\d.]+)\s*days left\)\s*\((\d[\d,]*)\)/g; let x;
  while((x=re.exec(m[1]))!==null){ out.push({days:parseFloat(x[1]), land:Number(x[2].replace(/,/g,''))}); }
  return out;
}
// Build the shared status card for one of OUR provinces, from the live feed
async function statusCard(provName){
  let feed=null; try{ feed=await httpGet('/feed?key='+KEY+'&since=0'); }catch(e){}
  if(!feed||!feed.entries) return null;
  const want=provName.toLowerCase().replace(/[~`*]/g,'').trim();
  const recent=feed.entries.slice().sort((a,b)=>(b.ts||0)-(a.ts||0));
  const find=(needle)=>recent.find(e=>(e.url||'').includes(needle) && (e.prov||'').toLowerCase().replace(/[~`*]/g,'').trim()===want);
  const findThroneFor=()=>recent.find(e=>{const t=e.data_simple||'';const pm=t.match(/The Province of ([^(]+?)\s*\(\d+:\d+\)/);return pm && pm[1].toLowerCase().replace(/[~`*]/g,'').trim()===want;});
  const th=findThroneFor();
  const N2=v=>(v!=null&&v!=='')?Number(String(v).replace(/,/g,'')).toLocaleString():'?';
  const L=[];
  // throne days (TOP)
  const cs=find('council_state');
  if(cs){const dm=cs.data_simple.match(/sat on our throne for (\d+) of \d+ days/); if(dm){const sat=Number(dm[1]); const MIN=12; const need=MIN-sat; L.push('**Throne:** '+sat+' of 24 days'+(need>0?' — need '+need+' more (min '+MIN+')':' \u2705 met '+MIN+' min'));}}
  // offense/defense home + total
  let offTotal='?',defTotal='?',offHome='?',defHome='?',gens='?';
  if(th){const t=th.data_simple;const g=re=>{const m=t.match(re);return m?m[1]:null;}; offTotal=g(/Off\. Points\s+([\d,]+)/)||'?'; defTotal=g(/Def\. Points\s+([\d,]+)/)||'?';}
  const cm=find('council_military');
  if(cm){const t=cm.data_simple;const g=re=>{const m=t.match(re);return m?m[1]:null;}; offHome=g(/Net Offensive Points at Home\s+([\d,]+)/)||'?'; defHome=g(/Net Defensive Points at Home\s+([\d,]+)/)||'?'; gens=g(/(\d+) generals available/)||'?';}
  L.push('**Offense:** '+N2(offHome)+' home / '+N2(offTotal)+' total');
  L.push('**Defense:** '+N2(defHome)+' home / '+N2(defTotal)+' total');
  // rTPA / rWPA
  let rtpa='?',rwpa='?';
  const tv=find('/thievery'); if(tv){const m=tv.data_simple.match(/\(([\d.]+)\s*per acre\)/); if(m) rtpa=m[1];}
  const sc=find('/sorcery')||find('/enchantment'); if(sc){const m=sc.data_simple.match(/\(([\d.]+)\s*Wizards Per Acre\)/i); if(m) rwpa=m[1];}
  L.push('rTPA '+rtpa+' · rWPA '+rwpa);
  // economy from throne
  if(th){const t=th.data_simple;const g=re=>{const m=t.match(re);return m?m[1]:'?';}; L.push('Money '+N2(g(/Money\s+([\d,]+)/))+' · Food '+N2(g(/Food\s+([\d,]+)/))+' · Runes '+N2(g(/Runes\s+([\d,]+)/)));}
  // generals: home + each out on its own line
  const armies = th ? parseArmies(th.data_simple) : [];
  const gensNum = (gens!=='?') ? Number(gens) : null;
  const sendable = gensNum!=null ? Math.max(0, gensNum-1) : '?';  // 1 must stay home to defend
  L.push('**Generals available to attack:** '+sendable+(armies.length?' · '+armies.length+' out':''));
  armies.forEach((a,idx)=>{ L.push('  \u2192 #'+(idx+1)+' returns in '+a.days.toFixed(2)+'h (+'+a.land.toLocaleString()+' land)'); });
  if(th) L.push('_live '+freshAge(th.ts)+'_');
  return L.join('\n');
}
const fs2=require('fs');
// ---- ARMY RETURN PING TRACKER ----
const ARMIES_FILE='./armies.json';
let armyState={}; try{ armyState=JSON.parse(fs2.readFileSync(ARMIES_FILE,'utf8')); }catch(e){ armyState={}; }
function saveArmyState(){ try{ fs2.writeFileSync(ARMIES_FILE, JSON.stringify(armyState)); }catch(e){} }
const TICK_MIN=60;
async function checkArmyReturns(client){
  let feed=null; try{ feed=await httpGet('/feed?key='+KEY+'&since=0'); }catch(e){ return; }
  if(!feed||!feed.entries) return;
  const recent=feed.entries.slice().sort((a,b)=>(b.ts||0)-(a.ts||0));
  const now=Date.now();
  for(const k in links){
    const lk=links[k]; if(!lk.discord_id) continue;
    const want=lk.prov.toLowerCase().replace(/[~`*]/g,'').trim();
    const th=recent.find(e=>{ const t=e.data_simple||''; const pm=t.match(/The Province of ([^(]+?)\s*\(\d+:\d+\)/); return pm && pm[1].toLowerCase().replace(/[~`*]/g,'').trim()===want; });
    if(!th) continue;
    const armies=parseArmies(th.data_simple);
    const capTs=th.ts||now;
    armies.forEach((a)=>{
      const returnAt=capTs + a.days*TICK_MIN*60000;
      const akey=want+'|'+a.land;
      const rec=armyState[akey] || { warned:false, home:false, prov:lk.prov, returnAt };
      const minsLeft=(rec.returnAt-now)/60000;
      if(!rec.warned && minsLeft<=30 && minsLeft>0){
        rec.warned=true; armyState[akey]=rec; saveArmyState();
        client.users.fetch(lk.discord_id).then(u=>u.send(':hourglass_flowing_sand: **Army returning soon** — general home in ~'+Math.max(1,Math.round(minsLeft))+' min with **'+a.land.toLocaleString()+' land**. ('+lk.prov+')')).catch(()=>{});
      }
      if(!rec.home && minsLeft<=0 && minsLeft>-90){
        rec.home=true; rec.warned=true; armyState[akey]=rec; saveArmyState();
        client.users.fetch(lk.discord_id).then(u=>u.send(':white_check_mark: **Army home!** General returned with **'+a.land.toLocaleString()+' land**. ('+lk.prov+')')).catch(()=>{});
      }
      if(!armyState[akey]) armyState[akey]=rec;
    });
  }
  for(const ak in armyState){ if(armyState[ak].home && armyState[ak].returnAt < now-7200000) delete armyState[ak]; }
  saveArmyState();
}
// ---- HOURLY TICK STATUS DM ----
let lastTickDmHour=(()=>{try{return JSON.parse(fs.readFileSync(__dirname+'/tickdm.json','utf8')).h;}catch(e){return -1;}})();
async function checkTickDM(client){
  let feed=null; try{ feed=await httpGet('/feed?key='+KEY+'&since=0'); }catch(e){ return; }
  if(!feed||!feed.entries) return;
  const recent=feed.entries.slice().sort((a,b)=>(b.ts||0)-(a.ts||0));
  let tickAt=null;
  for(const e of recent){ const m=(e.data_simple||'').match(/next tick:\s*(\d+)\s*minutes/); if(m){ tickAt=(e.ts||0)+Number(m[1])*60000; break; } }
  if(!tickAt) return;
  const now=Date.now();
  const tickHour=new Date(tickAt).getUTCHours();
  const mins=(now-tickAt)/60000;
  if(mins>=0 && mins<=1.5 && lastTickDmHour!==tickHour){
    lastTickDmHour=tickHour; try{fs.writeFileSync(__dirname+'/tickdm.json',JSON.stringify({h:tickHour}));}catch(e){}
    console.log('TICK DM firing for hour', tickHour);
    for(const k in links){
      const lk=links[k]; if(!lk.discord_id) continue;
      try{
        const card=await statusCard(lk.prov);
        if(card){ const u=await client.users.fetch(lk.discord_id); await u.send(':clock1: **New tick — your status**\n\n'+card); }
      }catch(e){ console.error('tick DM fail for', lk.handle, e.message); }
    }
  }
}
const KEY = process.env.INTEL_KEY || '';
const BASE = 'http://localhost:8108';
const parser = makeNewsParser();
let cursor = 0;

const zlib = require('zlib');
function httpGet(path) {
  return new Promise((resolve) => {
    http.get(BASE + path, { headers: { 'Accept-Encoding': 'gzip' } }, (res) => {
      const chunks = [];
      const src = (String(res.headers['content-encoding']||'').indexOf('gzip')>=0) ? res.pipe(zlib.createGunzip()) : res;
      src.on('data', c => chunks.push(c));
      src.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch(e) { resolve(null); } });
      src.on('error', () => resolve(null));
    }).on('error', () => resolve(null));
  });
}
const fetchFeed = () => httpGet('/feed?key=' + KEY + '&since=' + cursor);
// ---- LIVE FEED INTEL: find freshest data for a province from the feed ----
function parseBuildPage(txt){
  const g={};
  const acm=txt.match(/Total Land\s+([\d,]+)\s*acres/); if(acm) g.survAcres=Number(acm[1].replace(/,/g,''));
  // buildings are "Name\t<count>\t<inprog>" - match label then tab then number
  const b=(label,key)=>{
    const lab=label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    const re=new RegExp(lab+"\\t([\\d,]+)\\t");
    const m=txt.match(re);
    if(m) g[key]=Number(m[1].replace(/,/g,''));
  };
  b('Homes','bHome'); b('Farms','bFarm'); b('Mills','bMill'); b('Banks','bBank');
  b('Training Grounds','bTGs'); b('Armouries','bArms'); b('Military Barracks','bRax');
  b('Forts','bFort'); b('Castles','bCast'); b('Hospitals','bHosp'); b('Guilds','bGuil');
  b('Towers','bTowe'); b("Thieves' Dens",'bTDs'); b('Watch Towers','bWTs');
  b('Universities','bUniv'); b('Libraries','bLibs'); b('Stables','bStab'); b('Dungeons','bDung');
  const und=txt.match(/Total Undeveloped land\s+([\d,]+)/); if(und) g.bBarr=Number(und[1].replace(/,/g,''));
  const be=txt.match(/Building Eff[^\d]*([\d]+)%/); if(be) g.be=Number(be[1]);
  return g;
}
function parseThievPage(txt){
  const g={}; const m=txt.match(/Number of thieves\s+([\d,]+)\s*\(([\d.]+)\s*per acre\)/);
  if(m){ g.thieves=Number(m[1].replace(/,/g,'')); g.rtpa=parseFloat(m[2]); }
  return g;
}
function parseSorcPage(txt){
  const g={}; const m=txt.match(/Wizards\s+([\d,]+)\s*\(([\d.]+)\s*Wizards Per Acre\)/i);
  if(m){ g.wizards=Number(m[1].replace(/,/g,'')); g.rwpa=parseFloat(m[2]); }
  const rm=txt.match(/Runes\s+([\d,]+)/); if(rm) g.runes=Number(rm[1].replace(/,/g,''));
  return g;
}
// Find freshest feed entry whose URL matches a page type, for a province
/*SPELLS-THRONE-FALLBACK*/ function throneSpells(state, pname){
  var low=String(pname||``).toLowerCase();
  var all=(state&&state.myKd&&state.myKd.provinces||[]).slice();
  var en=(state&&state.enemies)||{};
  for(var k in en){ if(en[k]&&en[k].provinces) all=all.concat(en[k].provinces); }
  var prov=null;
  for(var z=0;z<all.length;z++){ if(String(all[z].name||``).toLowerCase()===low){ prov=all[z]; break; } }
  if(!prov||!prov.spells||!prov.spells.length) return [];
  var NB=[`meteor`,`greed`,`fool`,`gluttony`,`pitfall`,`explosion`,`amnesia`,`nightmare`,`vortex`,`tornado`,`lightning`,`fireball`,`land lust`,`storm`,`vermin`,`drought`,`chastity`];
  return prov.spells.map(function(sp){
    var nl=String(sp.name||``).toLowerCase(); var bad=false;
    for(var b=0;b<NB.length;b++){ if(nl.indexOf(NB[b])>=0){ bad=true; break; } }
    return {name:sp.name, dur:(sp.days?(sp.days+`d`):`today`), bad:bad};
  });
}
function spellsFromThrone(txt){
  var dm=String(txt||``).match(/Duration:\s*([^\n]+)/);
  if(!dm) return [];
  var rx=/([A-Za-z][A-Za-z'’\- ]*?)\s*\(\s*(\d+)\s*days?\s*\)/g;
  var out=[]; var m;
  while((m=rx.exec(dm[1]))!==null){ out.push({name:m[1].trim(), days:Number(m[2]), bad:false}); }
  return out;
}
function parseActiveSpells(txt){var out=[];var L=String(txt||``).split(String.fromCharCode(10));var NB=[`meteor`,`greed`,`fool`,`gluttony`,`pitfall`,`explosion`,`amnesia`,`nightmare`,`vortex`,`tornado`,`lightning`,`fireball`,`land lust`,`storm`,`vermin`,`drought`,`chastity`];for(var i=1;i<L.length;i++){var ln=L[i].split(String.fromCharCode(9)).join(` `).trim();var head=ln.split(` `)[0];var isDur=head===`-`||(head!==``&&!isNaN(Number(head)));if(!isDur)continue;var name=(L[i-1]||``).split(String.fromCharCode(9)).join(` `).trim();var low=name.toLowerCase();if(!name||low.indexOf(`spell name`)>=0||low.indexOf(`uniques`)>=0||low.indexOf(`activation`)>=0)continue;var dur=head===`-`?`today`:head+`d`;var bad=false;for(var b=0;b<NB.length;b++){if(low.indexOf(NB[b])>=0){bad=true;break;}}out.push({name:name,dur:dur,bad:bad});}return out;}
function freshestPage(feed, provName, urlNeedle){
  if(!feed||!feed.entries) return null;
  const want=(provName||'').toLowerCase().replace(/[~`*]/g,'').trim();
  let best=null;
  for(const e of feed.entries){
    if((e.url||'').toLowerCase().indexOf(urlNeedle)<0) continue;
    const pn=(e.prov||'').toLowerCase().replace(/[~`*]/g,'').trim();
    if(pn!==want) continue;
    if(!best||(e.ts||0)>(best.ts||0)) best=e;
  }
  return best;
}
function parseThronePage(txt){
  const g={}; const grab=(re)=>{ const m=txt.match(re); return m?m[1].replace(/,/g,''):null; };
  g.race=(txt.match(/Race\s+([A-Za-z ]+?)\s+Soldiers/)||[])[1];
  g.ruler=(txt.match(/Ruler\s+([^\t\n]+?)\s{2,}|Ruler\t([^\t\n]+)/)||[])[1];
  g.land=grab(/Land\s+([\d,]+)/);
  g.peasants=grab(/Peasants\s+([\d,]+)/);
  g.be=grab(/Building Eff\.\s+([\d]+)%/);
  g.money=grab(/Money\s+([\d,]+)/);
  g.food=grab(/Food\s+([\d,]+)/);
  g.runes=grab(/Runes\s+([\d,]+)/);
  g.tb=grab(/Trade Balance\s+(-?[\d,]+)/);
  g.nw=grab(/Networth\s+([\d,]+)\s*gold/);
  g.off=grab(/Off\. Points\s+([\d,]+)/);
  g.def=grab(/Def\. Points\s+([\d,]+)/);
  g.thieves=grab(/Thieves\s+([\d,]+)/);
  g.wizards=grab(/Wizards\s+([\d,]+)/);
  return g;
}
function freshestFor(feed, provName){
  if(!feed||!feed.entries) return null;
  const want=(provName||'').toLowerCase().replace(/[~`*]/g,'').trim();
  let best=null;
  for(const e of feed.entries){
    const t=e.data_simple||'';
    // throne page is the richest; match "The Province of NAME"
    const pm=t.match(/The Province of ([^(\n]+?)\s*\(\d+:\d+\)/);
    if(!pm) continue;
    const pname=pm[1].toLowerCase().replace(/[~`*]/g,'').trim();
    if(pname!==want) continue;
    if(!best || (e.ts||0)>(best.ts||0)) best=e;
  }
  if(!best) return null;
  return { ts: best.ts, data: parseThronePage(best.data_simple||'') };
}
function freshAge(ts){
  if(!ts) return 'unknown';
  const mins=Math.round((Date.now()-ts)/60000);
  if(mins<1) return 'just now';
  if(mins<60) return mins+'m ago';
  const hrs=Math.round(mins/60);
  if(hrs<24) return hrs+'h ago';
  return Math.round(hrs/24)+'d ago';
}
const fetchState = () => httpGet('/state?key=' + KEY);

function fmtAttack(ev) {
  const T = { captured:'CAPTURED', razed:'RAZED', conquered:'CONQUERED', massacre:'MASSACRE', plunder:'PLUNDER', ambush:'AMBUSH', bounce:'BOUNCE' };
  let d = '';
  if (ev.acres) d = '**' + ev.acres.toLocaleString() + ' acres**';
  else if (ev.killed) d = '**' + ev.killed.toLocaleString() + ' killed**';
  else if (ev.amount) d = '**' + ev.amount.toLocaleString() + '**';
  const loc = ev.local ? ' _(local strife)_' : '';
  return ':crossed_swords: **' + (T[ev.type]||ev.type.toUpperCase()) + '** · ' + ev.attacker + ' invaded ' + ev.target + (d ? ' — ' + d : '') + loc;
}
function fmtAid(ev) { return ':gift: **' + ev.from + '** sent aid to **' + ev.to + '**'; }
function fmtWar(ev) { return ':flag_white: Ceasefire proposed to **' + ev.target + '**'; }

const N = n => (n||0).toLocaleString();
// Resolve a command target into a province name (async: can read server nicknames).
// Priority: @mention > linked handle > server nickname/displayname > linked-self (blank) > province name
async function resolveProvName(i, typed){
  if(typed){
    // 1) @mention
    const mm = typed.match(/<@!?(\d+)>/);
    if(mm){ const L=findLinkByUser(mm[1]); if(L) return L.prov; }
    const h = typed.toLowerCase().replace(/^@/,'').trim();
    // 2) exact handle, then partial handle
    for(const k in links){ if((links[k].handle||'').toLowerCase()===h) return links[k].prov; }
    for(const k in links){ const hd=(links[k].handle||'').toLowerCase(); if(hd && (hd.includes(h)||h.includes(hd))) return links[k].prov; }
    // 3) match against SERVER NICKNAME / display name of each linked user
    try{
      const g = i.guild;
      if(g){
        for(const k in links){
          const id = links[k].discord_id; if(!id) continue;
          let m=null; try{ m = await g.members.fetch(id); }catch(e){}
          if(!m) continue;
          const nick=(m.nickname||'').toLowerCase();
          const disp=(m.displayName||'').toLowerCase();
          const uname=(m.user&&m.user.username||'').toLowerCase();
          if([nick,disp,uname].some(n=>n && (n===h || n.includes(h) || h.includes(n)))) return links[k].prov;
        }
      }
    }catch(e){}
  }
  // 4) blank -> own linked province
  if(!typed || !typed.trim()){
    const L=findLinkByUser(i.user.id);
    if(L) return L.prov;
  }
  // 5) fall back to province name as typed
  return typed;
}
function findProv(state, name) {
  const all = [];
  if (state.myKd) (state.myKd.provinces||[]).forEach(p => all.push({p, kd: state.myKd.name, loc: state.myKd.loc}));
  for (const e of Object.values(state.enemies||{})) (e.provinces||[]).forEach(p => all.push({p, kd: e.name, loc: e.loc}));
  const q = name.toLowerCase();
  return all.find(x => (x.p.name||'').toLowerCase() === q) || all.find(x => (x.p.name||'').toLowerCase().includes(q));
}
function provCard(hit) {
  const p = hit.p, i = p.intel || {};
  const g = (k) => (i[k] != null ? i[k] : p[k]);
  const _land = Number(g('land')||p.land)||0;
  const _pa = (v,dec) => { const n=Number(v); return (_land>0 && isFinite(n) && n>0) ? (n/_land).toFixed(dec) : null; };
  const _opa = (g('opa')!=null?g('opa'):_pa(g('offHome'),0));
  const _dpa = (g('dpa')!=null?g('dpa'):_pa(g('defHome'),0));
  const _rtpa = (g('rtpa')!=null?g('rtpa'):_pa(g('thieves'),1));
  const _rwpa = (g('rwpa')!=null?g('rwpa'):_pa(g('wizards'),1));
  const L = [];
  L.push('__**' + p.name + '**__ · ' + (p.race||'?') + '/' + (p.pers||'?') + ' · ' + hit.loc + ' · ' + hit.kd);
  L.push('Land **' + N(g('land')||p.land) + '** · NW **' + N(p.nw) + '**' + (p.honor?' · '+p.honor:''));
  L.push('**Military**');
  L.push('  Off ' + N(g('offHome')) + ' · Def ' + N(g('defHome')) + (g('ome')?' · OME '+g('ome')+'%':'') + (g('dme')?' · DME '+g('dme')+'%':''));
  L.push('  OSPA ' + (_opa||'?') + ' · DSPA ' + (_dpa||'?'));
  L.push('**Thievery / Magic**');
  L.push('  mTPA ' + (p.mdtpa||'?') + ' · oTPA ' + (g('otpa')||'?') + ' · dTPA ' + (g('dtpa')||'?') + ' · rTPA ' + (_rtpa||'?'));
  L.push('  mWPA ' + (p.mdwpa||'?') + ' · oWPA ' + (g('owpa')||'?') + ' · dWPA ' + (g('dwpa')||'?') + ' · rWPA ' + (_rwpa||'?'));
  L.push('  Thieves ' + N(g('thieves')) + ' · Wizards ' + N(g('wizards')) + (g('be')?' · BE '+g('be')+'%':''));
  L.push('**Economy**');
  L.push('  Gold ' + N(g('gcs')) + ' · Food ' + N(g('food')) + ' · Runes ' + N(g('runes')) + ' · Peons ' + N(g('peons')));
  const age = g('intelAge');
  if (age != null) L.push('_intel age: ' + age + ' ticks_');
  return L.join('\n');
}
function kdSummary(state, locOrName) {
  const kd = findKd(state, locOrName);
  if (!kd) return null;
  const ps = kd.provinces||[];
  const gi = (p,k) => { const i=p.intel||{}; return i[k]!=null?i[k]:p[k]; };
  const sum = f => ps.reduce((a,p)=>a+(Number(gi(p,f))||0),0);
  const avg = f => Math.round(sum(f)/Math.max(1,ps.length));
  const L = [];
  L.push('__**' + kd.name + '**__ · ' + (kd.loc||'?') + ' · ' + ps.length + ' provinces');
  L.push('Land **' + N(sum('land')) + '** · NW **' + N(sum('nw')) + '** · Avg NW ' + N(avg('nw')));
  L.push('Off ' + N(sum('offHome')) + ' · Def ' + N(sum('defHome')) + ' · Avg OSPA ' + avg('opa') + ' · Avg DSPA ' + avg('dpa'));
  L.push('Avg TPA ' + (avg('rtpa')||'?') + ' · Avg WPA ' + (avg('rwpa')||'?'));
  L.push('');
  ps.slice(0,25).forEach((p,idx) => {
    const o = N(gi(p,'offHome')), d = N(gi(p,'defHome'));
    const os = gi(p,'opa')||'?', ds = gi(p,'dpa')||'?';
    L.push('`'+String(idx+1).padStart(2)+'` **'+(p.name||'?')+'** '+N(gi(p,'land')||p.land)+'a | O '+o+' D '+d+' | '+os+'/'+ds);
  });
  L.push('');
  L.push('_use /prov <name> for full intel on any province_');
  return L.join('\n');
}

function gget(hit,k){ const p=hit.p,i=p.intel||{}; return i[k]!=null?i[k]:p[k]; }
function surveyCard(hit){
  const p=hit.p; const g=k=>gget(hit,k);
  const acres=g('survAcres')||g('land')||p.land||0;
  const B=[['bHome','Homes'],['bFarm','Farms'],['bMill','Mills'],['bBank','Banks'],['bTGs','TGs'],['bArms','Armouries'],['bRax','Barracks'],['bFort','Forts'],['bCast','Castles'],['bHosp','Hospitals'],['bGuil','Guilds'],['bTowe','Towers'],['bTDs','TDs'],['bWTs','WTs'],['bUniv','Univs'],['bLibs','Libs'],['bStab','Stables'],['bDung','Dungeons'],['bBarr','Barren']];
  const L=['__**'+p.name+'** — Survey__ · '+N(acres)+' acres'];
  let any=false;
  B.forEach(([k,lbl])=>{ const v=g(k); if(v!=null&&v!==''){ const pct=acres?((Number(v)/acres*100).toFixed(1)):'?'; L.push('  '+lbl+' '+N(v)+' ('+pct+'%)'); any=true; } });
  if(!any) L.push('_no survey data scouted_');
  if(g('be')) L.push('BE '+g('be')+'%');
  return L.join('\n');
}
function tpaCard(hit){
  const p=hit.p; const g=k=>gget(hit,k);
  const f=v=>(v!=null&&v!=='')?v:'?';
  const L=['__**'+p.name+'** — Thievery & Magic__'];
  L.push('**TPA**  mTPA '+f(p.mdtpa)+' · oTPA '+f(g('otpa'))+' · dTPA '+f(g('dtpa'))+' · rTPA '+f(g('rtpa')));
  L.push('**WPA**  mWPA '+f(p.mdwpa)+' · oWPA '+f(g('owpa'))+' · dWPA '+f(g('dwpa'))+' · rWPA '+f(g('rwpa')));
  L.push('Thieves '+N(g('thieves'))+' · Wizards '+N(g('wizards'))+(g('be')?' · BE '+g('be')+'%':''));
  if(g('intelAge')!=null) L.push('_intel age: '+g('intelAge')+' ticks_');
  return L.join('\n');
}
function econCard(hit){
  const p=hit.p; const g=k=>gget(hit,k);
  const L=['__**'+p.name+'** — Economy__'];
  L.push('Gold '+N(g('gcs'))+(g('gcpa')?' · GCPA '+g('gcpa'):''));
  L.push('Food '+N(g('food'))+' · Runes '+N(g('runes')));
  L.push('Peasants '+N(g('peons'))+(g('ppa')?' · PPA '+g('ppa'):''));
  if(g('tb')) L.push('Trade Balance '+N(g('tb')));
  if(g('intelAge')!=null) L.push('_intel age: '+g('intelAge')+' ticks_');
  return L.join('\n');
}
function wpaCard(hit){
  const p=hit.p; const g=k=>gget(hit,k);
  const L=['__**'+p.name+'** — Magic__'];
  L.push('WPA: raw '+(g('rwpa')||'?')+' · off '+(g('owpa')||'?')+' · def '+(g('dwpa')||'?')+' · mod '+(p.mdwpa||'?'));
  L.push('Wizards '+N(g('wizards'))+(g('be')?' · BE '+g('be')+'%':''));
  if(g('intelAge')!=null) L.push('_intel age: '+g('intelAge')+' ticks_');
  return L.join('\n');
}
function enemyDef(p){ const i=p.intel||{}; return Number(i.defHome||i.def||p.defense||0); }
function findKd(state, q){
  q=(q||'').trim().toLowerCase();
  if(!q) return null;
  if(state.myKd && (state.myKd.loc||'').trim().toLowerCase()===q) return state.myKd;
  return Object.values(state.enemies||{}).find(e=>(e.loc||'').trim().toLowerCase()===q) || null;
}
function breakLine(hit, off){
  const p=hit.p; const def=enemyDef(p);
  const ok = off>=def;
  const diff = Math.abs(off-def);
  return (ok?':white_check_mark: **BREAKS**':':x: cannot break')+' — '+p.name+' (def '+N(def)+')'+(ok?' by +'+N(diff):' short '+N(diff));
}
function boardCard(state, off, q){
  const ens=Object.values(state.enemies||{});
  const kd = q ? findKd(state,q) : (ens[0]||null);
  if(!kd) return null;
  const gland=p=>Number((p.intel||{}).land||p.land||0);
  const rows=(kd.provinces||[]).map(p=>({p,def:enemyDef(p),land:gland(p),out:!!p.armyOut,inc:Number(p.incomingLand||0)>0}));
  const haveOff = off && off>0;
  const scryed=rows.filter(x=>x.def>0);
  const unscryed=rows.filter(x=>!(x.def>0));
  const flag=x=>(x.out?' :crossed_swords:out':'')+(x.inc?' :dart:inc':'');
  const L=[':dart: **Target Board \u2014 '+kd.name+' ('+(kd.loc||'?')+')**'+(haveOff?'   _your off '+N(off)+'_':'')];
  if(haveOff){
    const breakable=scryed.filter(x=>off>=x.def).sort((a,b)=>b.land-a.land);
    const tough=scryed.filter(x=>off<x.def).sort((a,b)=>a.def-b.def);
    L.push('');
    L.push(':white_check_mark: **Breakable** ('+breakable.length+'/'+scryed.length+' scryed)');
    if(breakable.length) breakable.slice(0,15).forEach((x,i)=>L.push('`'+String(i+1).padStart(2)+'` '+x.p.name+' \u2014 '+N(x.land)+'a \u00b7 def '+N(x.def)+' (+'+N(off-x.def)+')'+flag(x)));
    else L.push('_none breakable with '+N(off)+'_');
    if(tough.length){ L.push(''); L.push(':red_circle: **Too tough** ('+tough.length+')'); tough.slice(0,5).forEach((x,i)=>L.push('`'+String(i+1).padStart(2)+'` '+x.p.name+' \u2014 '+N(x.land)+'a \u00b7 def '+N(x.def)+' ('+N(off-x.def)+')'+flag(x))); }
  } else {
    L.push('');
    L.push('**Scryed \u2014 weakest first** ('+scryed.length+')');
    if(scryed.length) scryed.sort((a,b)=>a.def-b.def).slice(0,15).forEach((x,i)=>L.push('`'+String(i+1).padStart(2)+'` '+x.p.name+' \u2014 '+N(x.land)+'a \u00b7 def '+N(x.def)+flag(x)));
    else L.push('_no defense scryed yet \u2014 spy the kingdom_');
    L.push('_tip: /board off:NNNNN to see what you can break_');
  }
  if(unscryed.length){ L.push(''); L.push(':white_circle: **Unscryed** ('+unscryed.length+') \u2014 spy these'); unscryed.sort((a,b)=>b.land-a.land).slice(0,8).forEach((x,i)=>L.push('`'+String(i+1).padStart(2)+'` '+x.p.name+' \u2014 '+N(x.land)+'a \u00b7 NW '+N(x.p.nw)+flag(x))); }
  return L.join('\n');
}
function kdMagicCard(state, q, metric){
  const kd = q ? findKd(state,q) : (Object.values(state.enemies||{})[0]||null);
  if(!kd) return null;
  const num=v=>{const n=Number(v); return isFinite(n)&&n>0?n:0;};
  const rows=(kd.provinces||[]).map(p=>({p,tpa:num(p.tpa),wpa:num(p.wpa),mdt:num(p.mdtpa),mdw:num(p.mdwpa)}));
  const isW = metric==='wpa';
  const raw=x=>isW?x.wpa:x.tpa, mod=x=>isW?x.mdw:x.mdt, eff=x=>mod(x)>0?mod(x):raw(x);
  const scryed=rows.filter(x=>raw(x)>0||mod(x)>0).sort((a,b)=>eff(a)-eff(b));
  const unscryed=rows.filter(x=>!(raw(x)>0||mod(x)>0));
  const f=v=>v>0?v.toFixed(1):'?';
  const cell=(r,m)=>f(r)+(m>0?'\u2192'+f(m):'');
  const label = isW?'Magic / WPA':'Thievery / TPA';
  const L=[':crystal_ball: **'+label+' \u2014 '+kd.name+' ('+(kd.loc||'?')+')**  _softest first \u00b7 raw\u2192mod_'];
  scryed.slice(0,20).forEach((x,i)=>L.push('`'+String(i+1).padStart(2)+'` '+x.p.name+' \u2014 T '+cell(x.tpa,x.mdt)+' \u00b7 W '+cell(x.wpa,x.mdw)));
  if(!scryed.length) L.push('_none scryed for '+(isW?'WPA':'TPA')+' yet \u2014 run survey + infiltrate + spy science + spy throne_');
  if(unscryed.length){ L.push(''); L.push(':white_circle: **No '+(isW?'WPA':'TPA')+' intel** ('+unscryed.length+'): '+unscryed.slice(0,16).map(x=>x.p.name).join(', ')); }
  return L.join('\n');
}
function myResourceCard(state, metric){
  const kd = state.myKd;
  if(!kd || !(kd.provinces||[]).length) return null;
  const isM = metric==='mana';
  const key = isM?'mana':'stealth';
  const rows=(kd.provinces||[]).map(p=>{const n=Number(p[key]); const v=(p[key]!=null&&p[key]!==''&&isFinite(n))?n:null; return {p,v};});
  const have=rows.filter(x=>x.v!=null).sort((a,b)=>a.v-b.v);
  const missing=rows.filter(x=>x.v==null);
  const label = isM?'Mana':'Stealth';
  const emoji = isM?':magic_wand:':':detective:';
  const L=[emoji+' **'+label+' \u2014 '+(kd.name||'My KD')+'**  _lowest first_'];
  have.slice(0,30).forEach((x,i)=>L.push('`'+String(i+1).padStart(2)+'` '+x.p.name+' \u2014 '+x.v+'%'));
  if(!have.length) L.push('_no '+label.toLowerCase()+' captured yet \u2014 visit each throne page_');
  if(missing.length){ L.push(''); L.push(':white_circle: **No '+label.toLowerCase()+' intel** ('+missing.length+'): '+missing.slice(0,16).map(x=>x.p.name).join(', ')); }
  return L.join('\n');
}
function targetsCard(state, q, off){
  const kd=findKd(state,q); if(!kd) return null;
  const ps=(kd.provinces||[]).map(p=>({p,def:enemyDef(p)})).filter(x=>x.def>0);
  const breakable=ps.filter(x=>off>=x.def).sort((a,b)=>a.def-b.def);
  const L=['__**Targets in '+kd.name+'**__ with '+N(off)+' offense — '+breakable.length+'/'+ps.length+' breakable'];
  breakable.slice(0,25).forEach(x=>L.push(':white_check_mark: '+x.p.name+' — def '+N(x.def)+' (+'+N(off-x.def)+')'));
  if(!breakable.length) L.push('_none breakable with that offense_');
  return L.join('\n');
}
function weakCard(state, q){
  const kd=findKd(state,q); if(!kd) return null;
  const ps=(kd.provinces||[]).map(p=>({p,def:enemyDef(p)})).filter(x=>x.def>0).sort((a,b)=>a.def-b.def);
  const L=['__**Weakest defense in '+kd.name+'**__'];
  ps.slice(0,15).forEach((x,i)=>L.push('`'+String(i+1).padStart(2)+'` '+x.p.name+' — def '+N(x.def)+' · '+N(x.p.land||(x.p.intel||{}).land)+'a'));
  return L.join('\n');
}
function fatCard(state, q){
  const kd=findKd(state,q); if(!kd) return null;
  const gland=p=>Number((p.intel||{}).land||p.land||0);
  const ps=(kd.provinces||[]).slice().sort((a,b)=>gland(b)-gland(a));
  const L=['__**Fattest (most land) in '+kd.name+'**__'];
  ps.slice(0,15).forEach((p,i)=>L.push('`'+String(i+1).padStart(2)+'` '+p.name+' — '+N(gland(p))+'a · NW '+N(p.nw)+' · def '+N(enemyDef(p))));
  return L.join('\n');
}
function leftCard(state, name){
  const my=state.myKd||{}; const ps=my.provinces||[];
  const off=p=>Number(p.offense||(p.intel||{}).offHome||0);
  if(name){
    const q=name.toLowerCase();
    const p=ps.find(x=>(x.name||'').toLowerCase()===q)||ps.find(x=>(x.name||'').toLowerCase().includes(q));
    if(!p) return 'Province not found in your KD.';
    return '__**'+p.name+'**__ — offense available: **'+N(off(p))+'** ('+(p.generals||'?')+' generals)';
  }
  const L=['__**Leftover offense — '+my.name+'**__'];
  ps.forEach(p=>L.push(p.name+' — **'+N(off(p))+'** ('+(p.generals||'?')+'g)'));
  L.push('');
  L.push('_total: '+N(ps.reduce((a,p)=>a+off(p),0))+'_');
  return L.join('\n');
}
function findCard(state, q){
  q=(q||'').toLowerCase().trim();
  if(!q) return 'Give me text to search for.';
  const hits=[];
  const scan=(p,kd,loc)=>{
    const name=(p.name||'').toLowerCase();
    const ruler=(p.ruler||(p.intel||{}).ruler||'').toLowerCase();
    if(name.includes(q)||ruler.includes(q)) hits.push({p,kd,loc});
  };
  if(state.myKd)(state.myKd.provinces||[]).forEach(p=>scan(p,state.myKd.name,state.myKd.loc));
  Object.values(state.enemies||{}).forEach(e=>(e.provinces||[]).forEach(p=>scan(p,e.name,e.loc)));
  if(!hits.length) return 'No provinces match "'+q+'".';
  const L=['__**Found '+hits.length+'**__ matching "'+q+'":'];
  hits.slice(0,25).forEach(h=>{
    const p=h.p;
    L.push('**'+p.name+'** ('+h.kd+' '+(h.loc||'?')+') — '+(p.race||'?')+'/'+(p.pers||'?')+' · '+N(p.land||(p.intel||{}).land)+'a · NW '+N(p.nw));
  });
  return L.join('\n');
}
const cmds = [
  new SlashCommandBuilder().setName('prov').setDescription('Full intel on a province').addStringOption(o=>o.setName('name').setDescription('province name').setRequired(true)),
  new SlashCommandBuilder().setName('intel').setDescription('Whole-KD overview').addStringOption(o=>o.setName('kd').setDescription('KD location e.g. 6:4').setRequired(true)),
  new SlashCommandBuilder().setName('kds').setDescription('List tracked kingdoms'),
  new SlashCommandBuilder().setName('survey').setDescription('Building breakdown for a province').addStringOption(o=>o.setName('name').setDescription('province name').setRequired(true)),
  new SlashCommandBuilder().setName('tpa').setDescription('Thievery & magic for a province').addStringOption(o=>o.setName('name').setDescription('province name').setRequired(true)),
  new SlashCommandBuilder().setName('econ').setDescription('Economy for a province').addStringOption(o=>o.setName('name').setDescription('province name').setRequired(true)),
  new SlashCommandBuilder().setName('wpa').setDescription('Magic detail for a province').addStringOption(o=>o.setName('name').setDescription('province name').setRequired(true)),
  new SlashCommandBuilder().setName('break').setDescription('Can your offense break a province?').addStringOption(o=>o.setName('name').setDescription('province name').setRequired(true)).addIntegerOption(o=>o.setName('off').setDescription('your offense').setRequired(true)),
  new SlashCommandBuilder().setName('targets').setDescription('All breakable provinces in a KD').addStringOption(o=>o.setName('kd').setDescription('KD location e.g. 6:4').setRequired(true)).addIntegerOption(o=>o.setName('off').setDescription('your offense').setRequired(true)),
  new SlashCommandBuilder().setName('board').setDescription('Enemy target board: breakable / unscryed / army-out').addIntegerOption(o=>o.setName('off').setDescription('your offense (optional - else your linked province)').setRequired(false)).addStringOption(o=>o.setName('kd').setDescription('enemy KD loc (optional)').setRequired(false)),
  new SlashCommandBuilder().setName('kdtpa').setDescription('Thievery (TPA) for every province in a KD').addStringOption(o=>o.setName('kd').setDescription('KD loc (default: your enemy)').setRequired(false)),
  new SlashCommandBuilder().setName('kdwpa').setDescription('Magic (WPA) for every province in a KD').addStringOption(o=>o.setName('kd').setDescription('KD loc (default: your enemy)').setRequired(false)),
  /*STEALTH-MANA-CMD*/ new SlashCommandBuilder().setName('stealth').setDescription('Stealth % for every province in my KD'),
  new SlashCommandBuilder().setName('mana').setDescription('Mana % for every province in my KD'),
  new SlashCommandBuilder().setName('weak').setDescription('Lowest-defense provinces in a KD').addStringOption(o=>o.setName('kd').setDescription('KD location e.g. 6:4').setRequired(true)),
  new SlashCommandBuilder().setName('fat').setDescription('Biggest-land provinces in a KD').addStringOption(o=>o.setName('kd').setDescription('KD location e.g. 6:4').setRequired(true)),
  new SlashCommandBuilder().setName('left').setDescription('My provinces leftover offense').addStringOption(o=>o.setName('name').setDescription('one province (optional)').setRequired(false)),
  new SlashCommandBuilder().setName('find').setDescription('Search provinces by name or ruler').addStringOption(o=>o.setName('text').setDescription('search text').setRequired(true)),
  new SlashCommandBuilder().setName('link').setDescription('Link your Discord to your province').addStringOption(o=>o.setName('province').setDescription('your province name').setRequired(true)),
  new SlashCommandBuilder().setName('unlink').setDescription('Remove your province link'),
  new SlashCommandBuilder().setName('links').setDescription('List all linked provinces'),
  new SlashCommandBuilder().setName('me').setDescription('Show my linked province + intel'),
  new SlashCommandBuilder().setName('status').setDescription('Full status: throne days, off/def, generals, army returns').addStringOption(o=>o.setName('name').setDescription('province, player, or blank for own').setRequired(false)),

  new SlashCommandBuilder().setName('help').setDescription('List everything the bot can do'),
  new SlashCommandBuilder().setName('live').setDescription('Freshest live intel for a province from the feed').addStringOption(o=>o.setName('name').setDescription('province name').setRequired(true))
, new SlashCommandBuilder().setName(`spells`).setDescription(`Active spells up + hostile on a province`).addStringOption(o=>o.setName(`name`).setDescription(`province or blank for yours`).setRequired(false))].map(c=>c.toJSON());


// ===== WARLOG ATTACK POSTING (reads engine state.json - correct types, real dates) =====
// /*PLOG-V1*/ province-log war-news feed (isolated; reuses KEY, alreadyPosted, markSeen, ch)
function plogShortDate(d){ return String(d||'').replace(/ of YR/,' YR'); }
function plogEvents(txt){
  var s=String(txt||'');
  var rx=/([A-Z][a-z]+ \d{1,2} of YR\d+)[\t ]+/g, marks=[], m;
  while((m=rx.exec(s))!==null){ marks.push({date:m[1], start:m.index, ts:rx.lastIndex}); }
  var out=[];
  for(var i=0;i<marks.length;i++){
    var end=(i+1<marks.length)?marks[i+1].start:s.length;
    var body=s.slice(marks[i].ts,end).replace(/\s+/g,' ').trim();
    if(body) out.push({date:marks[i].date, text:body});
  }
  return out;
}
function plogClassify(prov, date, text){
  var t=text, SD=plogShortDate(date);
  var tgt=(t.match(/\(([^()]*\([\d:]+\)),\s*sent\s+[\d,]+\)/)||[])[1];
  var am=t.match(/Your forces arrive at (.+?)\.\s/);
  if(am){
    var target=am[1].trim();
    var acres=(t.match(/taken ([\d,]+) acres/)||[])[1];
    var killed=(t.match(/killed about ([\d,]+) enemy/)||[])[1];
    var lossM=t.match(/We lost ([\d,]+) (\w+) and [\d,]+ horses/);
    var pris=(t.match(/imprisoned ([\d,]+) additional/)||[])[1];
    var sig='plog:'+prov+'|'+date+'|atk|'+target+'|'+(acres||'0');
    var msg;
    if(acres){ var p=[':crossed_swords: **'+prov+'** \u2192 '+target+' \u2014 took **'+acres+'** acres'];
      if(killed)p.push('killed '+killed); if(lossM)p.push('lost '+lossM[1]+' '+lossM[2]); if(pris)p.push(pris+' prisoners');
      msg=p.join(' \u00b7 ')+'  _'+SD+'_';
    } else { msg=':crossed_swords: **'+prov+'** \u2192 '+target+' \u2014 attack repelled  _'+SD+'_'; }
    return {kind:'atk', msg:msg, sig:sig};
  }
  var aid=t.match(/We have sent ([\d,]+) (runes|gold coins|bushels|soldiers|acres|food) to (.+?)\./);
  if(aid){ return {kind:'aid',
    msg:':handshake: **'+prov+'** sent '+aid[1]+' '+aid[2]+' \u2192 '+aid[3].trim()+'  _'+SD+'_',
    sig:'plog:'+prov+'|'+date+'|aid|'+aid[3].trim()+'|'+aid[1]+aid[2]}; }
  var foil=t.match(/the mission was foiled\. We lost ([\d,]+) thieves/);
  if(foil){ return {kind:'op',
    msg:':dagger: **'+prov+'** op'+(tgt?' \u2192 '+tgt:'')+' \u2014 **foiled**, lost '+foil[1]+' thieves  _'+SD+'_',
    sig:'plog:'+prov+'|'+date+'|op|'+(tgt||'?')+'|foiled|'+foil[1]}; }
  if(/our operation was a success|Our thieves have/.test(t)){
    var what=/infiltrated the military ranks/.test(t)?'military intel':
             /bribed an enemy general/.test(t)?'bribed a general':
             /Military Elders/.test(t)?'survey of military':
             /been attacked .* in the last month/.test(t)?'recon':'success';
    return {kind:'op',
      msg:':dagger: **'+prov+'** op'+(tgt?' \u2192 '+tgt:'')+' \u2014 '+what+'  _'+SD+'_',
      sig:'plog:'+prov+'|'+date+'|op|'+(tgt||'?')+'|'+what}; }
  var lostT=t.match(/^We lost ([\d,]+) thie(?:f|ves) in the operation/);
  if(lostT){ return {kind:'op',
    msg:':dagger: **'+prov+'** op \u2014 lost '+lostT[1]+' thieves  _'+SD+'_',
    sig:'plog:'+prov+'|'+date+'|op|lost|'+lostT[1]}; }
  var sp=t.match(/Your wizards gather [\d,]+ runes and begin casting, and the spell succeeds\. (.+)$/);
  if(sp){ var eff=sp[1].trim(); var dm=eff.match(/for (\d+) days?/);
    var clean=eff.replace(/\s*for \d+ days?[.!]?\s*$/,'').replace(/[.!]+$/,'').trim();
    return {kind:'spell',
      msg:':sparkles: **'+prov+'** cast: '+clean+(dm?' ('+dm[1]+'d)':'')+'  _'+SD+'_',
      sig:'plog:'+prov+'|'+date+'|spell|'+clean.slice(0,42)}; }
  return null;
}
function plogFetchFeed(){
  return httpGet('/feed?key='+KEY+'&since=0').then(function(j){ return j ? (j.entries||(Array.isArray(j)?j:[])) : []; });
}
async function pollProvinceLogs(ch, _feed){
  var entries=_feed||await plogFetchFeed();
  var logs=entries.filter(function(e){ return /province_log/.test(String(e.url||'')); });
  if(!logs.length) return;
  var byProv={};
  logs.forEach(function(e){ var p=e.prov||'?'; if(!byProv[p]||(e.ts||0)>(byProv[p].ts||0)) byProv[p]=e; });
  for(var p in byProv){
    var e=byProv[p];
    var evs=plogEvents(e.data_simple||'');
    var primeKey='plog:primed:'+p, primed=alreadyPosted(primeKey), batch=[];
    for(var k=0;k<evs.length;k++){
      var c=plogClassify(p, evs[k].date, evs[k].text);
      if(!c) continue;
      if(alreadyPosted(c.sig)) continue;
      if(!primed){ markSeen(c.sig); continue; }
      batch.push(c);
    }
    if(!primed){ markSeen(primeKey); continue; }
    for(var b=0;b<batch.length;b++){
      try{ await (CH.attacks||ch).send(batch[b].msg); markSeen(batch[b].sig); }catch(err){ console.error('plog post:', err.message); }
    }
  }
}

/*VISITED-PAGES-V1*/
var OUR_KD='3:4';
var vpRoster={};
var vpNicks={}; var vpNickTs=0;
function vpParseRoster(txt){ var ros=String(txt||''); var i=ros.indexOf('Nobility'); if(i>=0)ros=ros.slice(i+8); var re=/(\d+)\s+(.+?)\s+\S+\s+[\d,]+\s+acres/g,m,n=0; while((m=re.exec(ros))){ var nm=m[2].replace(/\s*\((?:M|S)\)/g,'').replace(/\*/g,'').trim(); if(nm){ vpRoster[nm.toLowerCase()]=m[1]; n++; } } return n; }
function vpSlot(prov){ return vpRoster[String(prov||'').toLowerCase().trim()]||''; }
function vpHandle(prov){ try{ var k=String(prov||'').toLowerCase().trim(); if(vpNicks[k]) return vpNicks[k]; var e=links[k]; return (e&&e.handle)?e.handle:''; }catch(x){ return ''; } }
function vpTag(prov){ prov=String(prov||'?'); var s=vpSlot(prov), h=vpHandle(prov); var b=(s?('#'+s+' '):'')+prov; return h?(h+' / '+b):b; }
function vpWho(prov){ try{ var k=String(prov||'?').toLowerCase().trim(); if(vpNicks[k]) return vpNicks[k]; }catch(x){} return String(prov||'?'); }
async function vpRefreshNicks(ch){
  try{
    if(vpNickTs && (Date.now()-vpNickTs)<300000) return;
    var g=ch&&ch.guild; if(g==null) return;
    var ks=Object.keys(links);
    for(var i=0;i<ks.length;i++){
      var e=links[ks[i]]; if(e==null||e.discord_id==null) continue;
      try{ var mem=await g.members.fetch(e.discord_id); if(mem){ var dn=mem.displayName||(mem.user&&mem.user.username)||''; if(dn) vpNicks[ks[i]]=dn; } }catch(x){}
    }
    vpNickTs=Date.now();
  }catch(x){}
}
var VPSPELLS=[[/extraordinarily fertile|made our lands.{0,20}fertile/i,'Fertile Lands'],[/drought and storms|blessed by nature/i,"Nature's Blessing"],[/unnatural speed|builders have been blessed/i,'Builders Boon'],[/dead will be awakened|awakened the next time/i,'Animate Dead'],[/shadowlight|identities will be revealed/i,'Shadow Light'],[/created \d+ acres more land|more land for us to use|acres more land/i,'Paradise'],[/smite attackers|magic will smite/i,'Wrath'],[/excited about the military|signup more quickly/i,'Patriotism'],[/inspired by our paladin|by our paladin/i,'Heroes Inspiration'],[/inspired to train/i,'Inspire Army'],[/surrounds our troops|reducing casualties/i,'Salvation'],[/holy shield|foul sorcery/i,'Divine Shield'],[/fanatical fervor/i,'Fanaticism'],[/auras within our province|black magic/i,'Magic Shield'],[/shades of anonymity|cloaked under the shades/i,'Anonymity'],[/magical calm|birth rates to be higher/i,'Love and Peace'],[/sphere of protection/i,'Minor Protection'],[/scientists are extraordinarily focused|science book generation/i,'Fountain of Knowledge'],[/drawn to the sciences/i,'Revelation']];
function vpSpellName(eff){ eff=String(eff||''); for(var i=0;i<VPSPELLS.length;i++){ if(VPSPELLS[i][0].test(eff)) return VPSPELLS[i][1]; } return ''; }
function vpCast(prov, txt){
  prov=String(prov||'?');
  var t=String(txt||'');
  var m=t.match(/Your wizards gather ([\d,]+) runes and begin casting,?\s*(?:(?:and|but)\s+)?the spell (succeeds|fails|failed|is unsuccessful)\.?\s*([\s\S]{0,130}?)(?:\s{2,}|[\t\n]|$)/);
  if(m==null) return null;
  var runes=m[1]; var ok=/succeed/i.test(m[2]); var eff=(m[3]||'').replace(/\s+/g,' ').trim();
  var seg=t.match(/Your wizards gather [\s\S]{0,280}?(?=\s*Select a spell|\s*Select your|\s*-{4,}|[\t\n]{2,}|$)/i);
  var game=seg?seg[0].replace(/\s+/g,' ').trim():('Your wizards gather '+runes+' runes and begin casting, '+(ok?('and the spell succeeds. '+eff):'but the spell fails')).trim();
  game=game.replace(/[\s.]+$/,'')+'.';
  if(/ritual project/i.test(eff)) return {kind:'ritual', sig:'vp:rit:'+prov+':'+runes, msg:vpWho(prov)+' \u2014 Ritual: '+game};
  var nm=vpSpellName(eff); var tag=nm?(' \u2014 '+nm):'';
  return {kind:'spell', sig:'vp:spell:'+prov+':'+runes+':'+eff.slice(0,40), msg:vpWho(prov)+tag+': '+game};
}
/*VPATK1*/
function vpParseOut(prov, body){
  prov=String(prov||'?'); body=String(body||'');
  var bounce=/driven back|unable to break through/i.test(body);
  var hasResult=/this battle/i.test(body)||bounce;
  if(hasResult===false) return null;
  var tgtM=body.match(/Your forces arrive at (.+?)[.!]/i); var tgt=tgtM?tgtM[1].trim():'';
  if(tgt===''){ var fM=body.match(/\(([^()]*\(\d+:\d+\)), sent/); if(fM) tgt=fM[1].trim(); }
  var tgtTxt=tgt||'enemy';
  var razed=(body.match(/razed ([\d,]+) acres of buildings/i)||[])[1];
  var tookM=body.match(/captured ([\d,]+) acres of land/i)||body.match(/took ([\d,]+) acres/i); var took=tookM?tookM[1]:'';
  if(bounce && razed==null && took===''){ return {kind:'atk', sig:'vp:o:'+prov+':'+tgtTxt+':bounce', msg:':crossed_swords: **'+vpTag(prov)+'** \u2192 '+tgtTxt+' \u2014 attack bounced, no land'}; }
  var kills=(body.match(/killed about ([\d,]+) enemy troops/i)||[])[1]||'0';
  var lossM=body.match(/We lost (.+?) in this battle/i); var loss=lossM?lossM[1].trim():'';
  var pris=(body.match(/imprisoned ([\d,]+)/i)||[])[1];
  var det=[];
  if(razed) det.push('razed '+razed+' acres'); else if(took) det.push('took '+took+' acres');
  det.push('killed '+kills);
  if(loss) det.push('lost '+loss);
  if(pris) det.push(pris+' prisoners');
  return {kind:'atk', sig:'vp:o:'+prov+':'+tgtTxt+':'+(razed||took||kills)+':'+(pris||'0'), msg:':crossed_swords: **'+vpTag(prov)+'** \u2192 '+tgtTxt+' \u2014 '+det.join(' \u00b7 ')};
}
function vpParseAid(prov, body, url){
  prov=String(prov||'?'); body=String(body||'');
  var m=body.match(/We have sent ([\d,]+) (.+?) to (.+?)\s*\((\d+:\d+)\)/i);
  if(m==null) return null;
  var amt=m[1], res=m[2].replace(/\s+/g,' ').trim(), tgt=m[3].trim();
  var seg=body.match(/We have sent [\s\S]{0,240}?(?=\s*Current trade|\s*Send Aid|\s*-{4,}|[\t\n]{2,}|$)/i);
  var game=seg?seg[0].replace(/\s+/g,' ').trim():('We have sent '+amt+' '+res+' to '+tgt+' ('+m[4]+')');
  game=game.replace(/[\s.]+$/,'')+'.';
  var aidc=''; var _u=String(url||''); var _i=_u.indexOf('c='); if(_i>=0){ var _j=_i+2; while(_j<_u.length){ var _c=_u.charCodeAt(_j); if(_c<48||_c>57)break; aidc+=_u.charAt(_j); _j++; } } return {kind:'aid', sig:'vp:aid:'+prov.toLowerCase()+':'+tgt.toLowerCase()+':'+amt+':'+res.replace(/[^a-z]/gi,'').slice(0,12)+(aidc?(':'+aidc):''), msg:vpWho(prov)+': '+game};
}
function vpParseOp(prov, body, url){
  prov=String(prov||'?'); body=String(body||''); url=String(url||'');
  var om=url.match(/[?&]o=([A-Za-z_]+)/); if(om==null) return null;
  var op=om[1].toLowerCase().split('_').map(function(w,wi){ if(wi>0 && /^(on|the|of|a|an|to|in|at|by|for|from)$/.test(w)) return w; return w?(w.charAt(0).toUpperCase()+w.slice(1)):w; }).join(' ');
  var tm=body.match(/The Province of (.+?)\s*\((\d+:\d+)\)/i);
  var tgt=tm?(tm[1].trim()+' ('+tm[2]+')'):'';
  var dm=body.match(/(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d+\s+of\s+YR\d+/);
  var dt=dm?dm[0].replace(/[^a-z0-9]/gi,''):'';
  var qm=url.match(/[?&]q=(\d+)/); var sent=qm?qm[1].replace(/(\d)(?=(\d{3})+$)/g,'$1,'):'';
  var fail=/unsuccessful|were caught|were captured|could not|failed to|we were unable|caught by|foiled|thwarted/i.test(body);
  var mark=fail?'\u274c':'\u2705';
  var lm=body.match(/we lost ([0-9,]+) thie/i); var lost=lm?lm[1]:''; var tail = fail ? (' \u00b7 foiled'+(lost?(' \u2014 lost '+lost+' thieves'):'')) : (sent?(' \u00b7 '+sent+' sent'):'');
  return {kind:'op', sig:'vp:op:'+prov.toLowerCase()+':'+om[1].toLowerCase()+':'+(tm?tm[2]:'')+':'+dt, msg:mark+' '+vpWho(prov)+' \u2014 '+op+(tgt?(' \u2192 '+tgt):'')+tail};
}
function vpParseKdNews(txt, maxYR){
  txt=String(txt||''); var out=[];
  var re=/(?:\d+\s*-\s*)?([^()\n]+?)\s*\((\d+:\d+)\)\s+invaded\s+(?:\d+\s*-\s*)?([^()\n]+?)\s*\((\d+:\d+)\)\s+and\s+([^.!]+)[.!]\s*(?:(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d+\s+of\s+YR(\d+))?/gi;
  var m;
  while((m=re.exec(txt))){
    var atk=m[1].replace(/^.*?\d+\s*-\s*/,'').trim(), atkloc=m[2], tgt=m[3].replace(/^.*?\d+\s*-\s*/,'').trim(), tgtloc=m[4], action=m[5].trim(), yr=parseInt(m[6]||'0',10);
    if(maxYR && yr && yr<maxYR) continue;
    if(tgtloc===OUR_KD && atkloc!==OUR_KD){
      out.push({kind:'atk', sig:'vp:kn:'+tgt.toLowerCase()+':'+atk.toLowerCase()+':'+action.replace(/[^0-9a-z]/gi,'').slice(0,24), msg:':shield: **'+vpTag(tgt)+'** \u2190 '+atk+' ('+atkloc+') \u2014 '+action});
    }
  }
  var lines=txt.split(/\n/);
  for(var li=0; li<lines.length; li++){
    var ln=lines[li];
    var ym=ln.match(/of YR(\d+)/); var yr2=ym?parseInt(ym[1],10):0;
    if(maxYR && yr2 && yr2<maxYR) continue;
    var dm=ln.match(/(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d+\s+of\s+YR\d+/); var dt=dm?dm[0].replace(/[^a-z0-9]/gi,''):'';
    var im=ln.match(/In intra-kingdom war\s+(?:\d+\s*-\s*)?(.+?)\s*\((\d+:\d+)\)\s+attempted to invade\s+(?:\d+\s*-\s*)?(.+?)\s*\((\d+:\d+)\),?\s*but failed/i);
    if(im){ var ia=im[1].trim(), it=im[3].trim(); out.push({kind:'intra', sig:'vp:intra:'+ia.toLowerCase()+':'+it.toLowerCase()+':'+dt, msg:':crossed_swords: '+vpTag(ia)+' \u2192 '+vpTag(it)+' \u00b7 intra bounce (failed)'}); continue; }
    var rm=ln.match(/(developing a ritual|ritual is covering)[^(]*\(([^)]+)\)/i);
    if(rm){ var rn=rm[2].trim(); var rs=/developing/i.test(rm[1])?'started':'active'; out.push({kind:'ritualn', sig:'vp:ritn:'+rn.toLowerCase()+':'+rs+':'+dt, msg:':crystal_ball: '+rn+' \u00b7 ritual '+rs}); continue; }
  }
  return out;
}
function vpAttackAll(prov, txt, url, maxYR){
  prov=String(prov||'?'); txt=String(txt||''); url=String(url||''); var out=[];
  if(/game\/aid/.test(url) || /We have sent [\d,]+ .+? to .+?\(\d+:\d+\)/i.test(txt)){ var ha=vpParseAid(prov, txt, url); if(ha) out.push(ha); return out; }
  if(/thievery/.test(url) && /[?&]o=/.test(url)){ var ho=vpParseOp(prov, txt, url); if(ho) out.push(ho); return out; }
  if(/send_armies/.test(url) || /You enter your War Room/i.test(txt)){ var h=vpParseOut(prov, txt); if(h) out.push(h); return out; }
  if(/kingdom_news|throne/.test(url)){ return vpParseKdNews(txt, maxYR); }
  return out;
}
function vpFetchFeed(){
  return httpGet('/feed?key='+KEY+'&since=0').then(function(j){ return j ? (j.entries||(Array.isArray(j)?j:[])) : []; });
}
async function pollVisitedPages(ch, _feed){
  var entries = _feed || await vpFetchFeed();
  await vpRefreshNicks(ch);
  var kd=entries.filter(function(e){return String(e.url||'').indexOf('kingdom_details')>=0;}).sort(function(a,b){return (b.ts||0)-(a.ts||0);})[0];
  if(kd) vpParseRoster(kd.data_simple);
  var maxYR=0; entries.forEach(function(e){ var mm=String(e.data_simple||'').match(/of YR(\d+)/g); if(mm) mm.forEach(function(x){ var y=parseInt(x.replace(/[^0-9]/g,''),10); if(y>maxYR) maxYR=y; }); });
  var seen={}, hits=[];
  entries.forEach(function(e){
    var arr=[]; var c=vpCast(e.prov||'?', e.data_simple||'');
    if(c){ c.sig=c.sig+':'+(e.ts||0); arr.push(c); } else arr=vpAttackAll(e.prov||'?', e.data_simple||'', e.url, maxYR);
    arr.forEach(function(x){ if(x && seen[x.sig]==null){ seen[x.sig]=1; x.ts=e.ts||0; hits.push(x); } });
  });
  hits.sort(function(a,b){return (a.ts||0)-(b.ts||0);});
  if(alreadyPosted('vp:atkprime2')===false){
    hits.forEach(function(h){ if(h.kind==='atk') markSeen(h.sig); });
    markSeen('vp:atkprime2');
  }
  if(alreadyPosted('vp:spellprime')===false){ hits.forEach(function(h){ if(h.kind==='spell'||h.kind==='ritual') markSeen(h.sig); }); markSeen('vp:spellprime'); }
  var fresh=hits.filter(function(c){ return alreadyPosted(c.sig)===false; });
  if(fresh.length===0) return;
  if(alreadyPosted('vp:primed')===false){
    markSeen('vp:primed');
    var drop=fresh.slice(0, Math.max(0, fresh.length-8)); drop.forEach(function(c){ markSeen(c.sig); });
    fresh=fresh.slice(-8);
  }
  if(alreadyPosted('vp:prime3')===false){
    markSeen('vp:prime3');
    if(fresh.length>12){ fresh.slice(0, fresh.length-12).forEach(function(c){ markSeen(c.sig); }); fresh=fresh.slice(-12); }
  }
  if(alreadyPosted('vp:prime4')===false){
    markSeen('vp:prime4');
    var opsF=fresh.filter(function(c){ return c.kind==='op'; }); var keepOps=opsF.slice(-6);
    fresh=fresh.filter(function(c){ if(c.kind!=='op') return true; if(keepOps.indexOf(c)>=0) return true; markSeen(c.sig); return false; });
  }
  for(var i=0;i<fresh.length;i++){
    var tgt = chFor(fresh[i].kind)||ch;
    try{ await tgt.send(fresh[i].msg); markSeen(fresh[i].sig); }
    catch(err){
      var permErr = (err&&err.code===50013) || /Missing Permissions/i.test((err&&err.message)||'');
      if(permErr){
        // Bot can see but not Send in this channel. Don't retry forever: warn once, fall back to default, then drop.
        var nm = (tgt&&tgt.name)||'?';
        if(!vpPermWarned.has(nm)){ console.error('vp: no Send permission in #'+nm+' (kind='+fresh[i].kind+') — grant the bot "Send Messages" there; falling back to default channel'); vpPermWarned.add(nm); }
        if(ch && ch!==tgt){ try{ await ch.send(fresh[i].msg); }catch(e2){} }
        markSeen(fresh[i].sig);
      } else { console.error('vp:', err.message); }
    }
  }
}


function readWarlogEv(){ try{ const d=JSON.parse(fs.readFileSync('/root/warroom/state.json','utf8')); return (d.warlog&&d.warlog.ev)||{}; }catch(e){ return {}; } }
const WL_MO={january:1,february:2,march:3,april:4,may:5,june:6,july:7};
function wlDateKey(x){ const m=String(x||'').match(/([A-Za-z]+)\s+(\d+)\s+of\s+YR(\d+)/i); if(!m) return 0; return Number(m[3])*10000+(WL_MO[m[1].toLowerCase()]||0)*40+Number(m[2]); }
const WL_LABEL={'trad march':'TRAD MARCH',conquest:'CONQUEST',ambush:'AMBUSH',raze:'RAZE',massacre:'MASSACRE',plunder:'PLUNDER',failed:'BOUNCE'};
function fmtWarAttack(e){ const lab=WL_LABEL[e.type]||String(e.type||'').toUpperCase(); const A=(e.atk&&e.atk.name)||'someone'; const D=(e.def&&e.def.name)||'someone'; let det=''; if(e.unit==='land'&&e.amt) det=Number(e.amt).toLocaleString()+' acres'; else if(e.unit==='ppl'&&e.amt) det=Number(e.amt).toLocaleString()+' killed'; return ':crossed_swords: **'+lab+'** \u00b7 '+A+' \u2192 '+D+(det?' \u2014 '+det:'')+(e.date?'  _'+String(e.date).replace(' of YR',' YR')+'_':''); }
const WL_PRIMED='__WARLOG_PRIMED__';
async function pollWarAttacks(ch){ const wl=readWarlogEv(); const sigs=Object.keys(wl); if(!sigs.length) return; if(!alreadyPosted(WL_PRIMED)){ sigs.forEach(function(x){markSeen(x);}); markSeen(WL_PRIMED); return; } const toPost=sigs.filter(function(x){return !alreadyPosted(x);}).map(function(x){return Object.assign({_sig:x},wl[x]);}); toPost.sort(function(a,b){return wlDateKey(a.date)-wlDateKey(b.date);}); for(const e of toPost){ const msg=fmtWarAttack(e); try{ await ch.send(msg); markSeen(e._sig); }catch(err){ console.error('waratk post:',err.message); } } }

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

let CH = {}; let chDefault = null; const vpPermWarned = new Set();
function chFor(kind){ if(kind==='op') return CH.ops||chDefault; if(kind==='ritual') return CH.ritual||chDefault; if(kind==='aid') return CH.aid||chDefault; if(kind==='spell') return CH.selfspells||chDefault; if(kind==='atk'||kind==='attack'||kind==='ceasefire') return CH.attacks||chDefault; return chDefault; }
client.once('clientReady', async () => {
  console.log('BOT online as ' + client.user.tag);
  try {
    const rest = new REST({version:'10'}).setToken(process.env.DISCORD_TOKEN);
    await rest.put(Routes.applicationGuildCommands(client.user.id, process.env.GUILD_ID), { body: cmds });
    console.log('slash commands registered');
  } catch(e) { console.error('cmd register fail:', e.message); }
  const ch = await client.channels.fetch(process.env.CH_BOTTEST);
  chDefault = ch;
  try { const g = await client.guilds.fetch(process.env.GUILD_ID); const allCh = await g.channels.fetch(); const byName = (nm)=>allCh.find(c=>c&&c.name===nm)||null; CH = { ops:byName('bot-thieve-ops'), ritual:byName('bot-ritual'), dragon:byName('bot-dragon'), spells:byName('bot-spells'), aid:byName('bot-aid'), selfspells:byName('bot-selfspells'), attacks:byName('bot-attacks') }; console.log('CHANNELS: '+Object.keys(CH).map(k=>k+'='+(CH[k]?'ok':'MISS')).join(' ')); } catch(e) { console.error('channel map fail:', e.message); }
  const prime = await fetchFeed();
  if (prime && prime.cursor) { cursor = prime.cursor; console.log('cursor primed at ' + cursor); }
  async function poll() {
    const feed = await fetchFeed();
    if (feed && feed.entries) {
      for (const en of feed.entries) {
        for (const ev of parser.parse(en.data_simple||'')) {
          let msg = null;
          if (ev.kind==='attack') continue;
          else if (ev.kind==='ceasefire') msg = fmtWar(ev);
          if (msg) {
            const key = (ev._date||'') + '|' + ev.kind + '|' + (ev.attacker||'') + '|' + (ev.target||'') + '|' + (ev.acres||ev.killed||ev.amount||'') + '|' + (ev.type||'');
            if (alreadyPosted(key)) continue;
            try { await (CH.attacks||ch).send(msg); markSeen(key);  } catch(e) { console.error('post fail:', e.message); }
          }
        }
      }
      if (feed.cursor) cursor = feed.cursor;
    }
  }
  setInterval(poll, 8000);
  var plogBusy=false; setInterval(function(){ if(plogBusy)return; plogBusy=true; pollVisitedPages(ch).catch(function(e){console.error('plog:',e.message);}).finally(function(){plogBusy=false;}); }, 2000);
  /* pollWarAttacks DISABLED - was flooding; province-log poster handles attacks now */
  setInterval(()=>{ if(false) checkArmyReturns(client).catch(e=>console.error('army check:', e.message)); }, 60000);
  setInterval(()=>{ if(false) checkTickDM(client).catch(e=>console.error('tick dm:', e.message)); }, 30000);
  console.log('feed polling started (8s)');
});

client.on('interactionCreate', async (i) => {
  if (!i.isChatInputCommand()) return;
  if (i.commandName === `spells`) { /*SPELLS-V4*/ await i.deferReply(); const pname = await resolveProvName(i, i.options.getString(`name`)); if(!pname){ await i.editReply(`Give a province name, or link one with /link.`); return; } const feed = await httpGet(`/feed?key=` + KEY + `&since=0`); const pg = freshestPage(feed, pname, `/throne`); if(!pg){ await i.editReply(`No throne page for ` + pname + ` yet. Open its throne page in-game.`); return; } const sp = spellsFromThrone(pg.data_simple || ``); if(!sp.length){ await i.editReply(`No active spells on ` + pname + `.`); return; } const NB=[`meteor`,`greed`,`fool`,`gluttony`,`pitfall`,`explosion`,`amnesia`,`nightmare`,`vortex`,`tornado`,`lightning`,`fireball`,`land lust`,`storm`,`drought`,`vermin`,`chastity`,`expose`,`exposure`]; sp.forEach(function(sx){ const nl=String(sx.name||``).toLowerCase(); sx.bad=false; for(let b=0;b<NB.length;b++){ if(nl.indexOf(NB[b])>=0){ sx.bad=true; break; } } }); const L = [`__**` + pname + `** - Active Spells__`]; const fmt=sx=>sx.name + ` (` + sx.days + `d)`; const up = sp.filter(sx=>!sx.bad).map(fmt); const bad = sp.filter(sx=>sx.bad).map(fmt); if(up.length) L.push(`:green_circle: **Up:** ` + up.join(`, `)); if(bad.length) L.push(`:red_circle: **Hostile:** ` + bad.join(`, `)); await i.editReply(L.join(String.fromCharCode(10))); return; }
  const state = await fetchState();
  if (!state) { await i.reply('Could not reach server.'); return; }
  if (i.commandName === 'prov') {
    await i.deferReply();
    const pname = await resolveProvName(i, i.options.getString('name'));
    const hit = findProv(state, pname);
    const feed = await httpGet('/feed?key=' + KEY + '&since=0');
    const live = freshestFor(feed, pname);
    if (!hit && !live) { await i.editReply('Province not found.'); return; }
    let useHit = hit || { p:{ name:pname, intel:{} }, loc:'?', kd:'?' };
    if (live && live.data) {
      const d = live.data, p = useHit.p; p.intel = p.intel || {};
      const setI=(k,v)=>{ if(v!=null) p.intel[k]=Number(v)||v; };
      setI('offHome', d.off); setI('defHome', d.def);
      setI('gcs', d.money); setI('food', d.food); setI('runes', d.runes);
      setI('peons', d.peasants); setI('thieves', d.thieves); setI('wizards', d.wizards);
      setI('be', d.be); setI('tb', d.tb);
      if(d.land) p.land=Number(d.land)||p.land; if(d.nw) p.nw=Number(d.nw)||p.nw;
      if(d.race && !p.race) p.race=d.race;
      useHit._liveAge = freshAge(live.ts);
    }
    let card = provCard(useHit);
    if (useHit._liveAge) card += '\n_live throne data: ' + useHit._liveAge + '_';
    await i.editReply(card);
  } else if (i.commandName === 'intel') {
    const s = kdSummary(state, i.options.getString('kd'));
    await i.reply(s || 'KD not found.');
  } else if (i.commandName === 'kds') {
    const L = [];
    if (state.myKd) L.push('**' + state.myKd.name + '** (' + (state.myKd.loc||'?') + ') — yours');
    for (const e of Object.values(state.enemies||{})) L.push('**' + e.name + '** (' + (e.loc||'?') + ') — ' + (e.provinces||[]).length + ' provs');
    await i.reply(L.length ? L.join('\n') : 'No kingdoms tracked.');
  } else if (i.commandName === 'survey') {
    await i.deferReply();
    const pname = await resolveProvName(i, i.options.getString('name'));
    const hit = findProv(state, pname);
    const feed = await httpGet('/feed?key=' + KEY + '&since=0');
    const pg = freshestPage(feed, pname, '/build');
    if (!hit && !pg) { await i.editReply('Province not found.'); return; }
    let useHit = hit || { p:{ name:pname, intel:{} }, loc:'?', kd:'?' };
    let age=null;
    if (pg) { const d=parseBuildPage(pg.data_simple||''); useHit.p.intel=useHit.p.intel||{}; for(const k in d) if(d[k]!=null) useHit.p.intel[k]=d[k]; age=freshAge(pg.ts); }
    let card = surveyCard(useHit); if(age) card += '\n_live survey: ' + age + '_';
    await i.editReply(card);
  } else if (i.commandName === 'tpa') {
    await i.deferReply();
    const pname = await resolveProvName(i, i.options.getString('name'));
    const hit = findProv(state, pname);
    const feed = await httpGet('/feed?key=' + KEY + '&since=0');
    const pgT = freshestPage(feed, pname, '/thievery');
    const pgS = freshestPage(feed, pname, '/sorcery') || freshestPage(feed, pname, '/enchantment');
    if (!hit && !pgT && !pgS) { await i.editReply('Province not found.'); return; }
    let useHit = hit || { p:{ name:pname, intel:{} }, loc:'?', kd:'?' };
    useHit.p.intel=useHit.p.intel||{}; let age=null;
    if (pgT) { const d=parseThievPage(pgT.data_simple||''); for(const k in d) if(d[k]!=null) useHit.p.intel[k]=d[k]; age=freshAge(pgT.ts); }
    if (pgS) { const d=parseSorcPage(pgS.data_simple||''); for(const k in d) if(d[k]!=null) useHit.p.intel[k]=d[k]; if(!age) age=freshAge(pgS.ts); }
    let card = tpaCard(useHit); if(age) card += '\n_live: ' + age + '_';
    await i.editReply(card);
  } else if (i.commandName === 'econ') {
    await i.deferReply();
    const pname = await resolveProvName(i, i.options.getString('name'));
    const hit = findProv(state, pname);
    const feed = await httpGet('/feed?key=' + KEY + '&since=0');
    const live = freshestFor(feed, pname);
    if (!hit && !live) { await i.editReply('Province not found.'); return; }
    let useHit = hit || { p:{ name:pname, intel:{} }, loc:'?', kd:'?' };
    let age=null;
    if (live && live.data) { const d=live.data, I=useHit.p.intel=useHit.p.intel||{}; const s=(k,v)=>{if(v!=null)I[k]=Number(v)||v;}; s('gcs',d.money); s('food',d.food); s('runes',d.runes); s('peons',d.peasants); s('tb',d.tb); age=freshAge(live.ts); }
    let card = econCard(useHit); if(age) card += '\n_live: ' + age + '_';
    await i.editReply(card);
  } else if (i.commandName === 'wpa') {
    await i.deferReply();
    const pname = await resolveProvName(i, i.options.getString('name'));
    const hit = findProv(state, pname);
    const feed = await httpGet('/feed?key=' + KEY + '&since=0');
    const pgS = freshestPage(feed, pname, '/sorcery') || freshestPage(feed, pname, '/enchantment');
    if (!hit && !pgS) { await i.editReply('Province not found.'); return; }
    let useHit = hit || { p:{ name:pname, intel:{} }, loc:'?', kd:'?' };
    let age=null;
    if (pgS) { const d=parseSorcPage(pgS.data_simple||''); useHit.p.intel=useHit.p.intel||{}; for(const k in d) if(d[k]!=null) useHit.p.intel[k]=d[k]; age=freshAge(pgS.ts); }
    let card = wpaCard(useHit); if(age) card += '\n_live: ' + age + '_';
    await i.editReply(card);
  } else if (i.commandName === 'break') {
    const hit = findProv(state, await resolveProvName(i, i.options.getString('name')));
    await i.reply(hit ? breakLine(hit, i.options.getInteger('off')) : 'Province not found.');
  } else if (i.commandName === 'targets') {
    const r = targetsCard(state, i.options.getString('kd'), i.options.getInteger('off'));
    await i.reply(r || 'KD not found.');
  } else if (i.commandName === 'weak') {
    const r = weakCard(state, i.options.getString('kd'));
    await i.reply(r || 'KD not found.');
  } else if (i.commandName === 'fat') {
    const r = fatCard(state, i.options.getString('kd'));
    await i.reply(r || 'KD not found.');
  } else if (i.commandName === 'board') {
    let off = i.options.getInteger('off');
    if(!off){ const lk=findLinkByUser(i.user.id); if(lk&&lk.prov){ const h=findProv(state, lk.prov); if(h) off = Number(h.p.offense||(h.p.intel||{}).offHome||0)||0; } }
    const r = boardCard(state, off, i.options.getString('kd'));
    await i.reply(r || 'No enemy KD found.');
  } else if (i.commandName === 'kdtpa') {
    await i.reply(kdMagicCard(state, i.options.getString('kd'), 'tpa') || 'No KD found.');
  } else if (i.commandName === 'kdwpa') {
    await i.reply(kdMagicCard(state, i.options.getString('kd'), 'wpa') || 'No KD found.');
  } else if (i.commandName === 'stealth') {
    await i.reply(myResourceCard(state, 'stealth') || 'No KD data.');
  } else if (i.commandName === 'mana') {
    await i.reply(myResourceCard(state, 'mana') || 'No KD data.');
  } else if (i.commandName === 'left') {
    await i.deferReply(); const typed = i.options.getString('name'); const pname = typed ? await resolveProvName(i, typed) : typed; await i.editReply(leftCard(state, pname));
  } else if (i.commandName === 'find') {
    await i.reply(findCard(state, i.options.getString('text')));
  } else if (i.commandName === 'link') {
    const pname = i.options.getString('province');
    const hit = findProv(state, pname);
    if (!hit) { await i.reply('Province "' + pname + '" not found in tracked data.'); return; }
    const k = provKey(hit.p.name);
    if (links[k] && links[k].discord_id !== i.user.id) { await i.reply(':warning: **' + hit.p.name + '** is already linked to <@' + links[k].discord_id + '>. Ask an admin to reassign.'); return; }
    const existing = findLinkByUser(i.user.id);
    if (existing && existing.key !== k) delete links[existing.key];
    links[k] = { prov: hit.p.name, discord_id: i.user.id, handle: i.user.username, ts: Date.now() };
    saveLinks();
    await i.reply(':white_check_mark: Linked you to **' + hit.p.name + '**. You will get a DM when it is attacked.');
  } else if (i.commandName === 'unlink') {
    const existing = findLinkByUser(i.user.id);
    if (!existing) { await i.reply('You have no linked province.'); return; }
    delete links[existing.key]; saveLinks();
    await i.reply(':white_check_mark: Unlinked you from **' + existing.prov + '**.');
  } else if (i.commandName === 'links') { await i.deferReply();
    const keys = Object.keys(links);
    if (!keys.length) { await i.editReply('No provinces linked yet. Use /link <province>.'); return; }
    const L = ['__**Linked provinces (' + keys.length + ')**__'];
    keys.forEach(k => L.push('**' + links[k].prov + '** → <@' + links[k].discord_id + '>'));
    await i.editReply(L.join('\n'));
  } else if (i.commandName === 'me') {
    const existing = findLinkByUser(i.user.id);
    if (!existing) { await i.reply('You have no linked province. Use /link <province>.'); return; }
    const hit = findProv(state, existing.prov);
    await i.reply(hit ? provCard(hit) : 'Linked to **' + existing.prov + '** (no intel data found).');
  } else if (i.commandName === 'live') {
    await i.deferReply();
    const nm = await resolveProvName(i, i.options.getString('name'));
    const feed = await httpGet('/feed?key=' + KEY + '&since=0');
    const r = freshestFor(feed, nm);
    if (!r) { await i.editReply('No live feed data found for "' + nm + '". Someone needs to view that province in-game.'); return; }
    const d = r.data; const N2 = v => v!=null ? Number(v).toLocaleString() : '?';
    const L = ['__**' + nm + '** — live intel · _' + freshAge(r.ts) + '_'];
    if (d.race) L.push('Race ' + d.race + (d.ruler?' · Ruler ' + d.ruler.trim():''));
    L.push('Land ' + N2(d.land) + ' · NW ' + N2(d.nw) + (d.be?' · BE ' + d.be + '%':''));
    L.push('**Money** ' + N2(d.money) + ' · **Food** ' + N2(d.food) + ' · **Runes** ' + N2(d.runes));
    if (d.tb) L.push('Trade Balance ' + N2(d.tb));
    L.push('**Off** ' + N2(d.off) + ' · **Def** ' + N2(d.def));
    L.push('Thieves ' + N2(d.thieves) + ' · Wizards ' + N2(d.wizards));
    await i.reply(L.join('\n'));
  } else if (i.commandName === 'status') {
    await i.deferReply();
    const pname = await resolveProvName(i, i.options.getString('name'));
    if (!pname) { await i.editReply('Link your province first with /link, or give a name.'); return; }
    const card = await statusCard(pname);
    if (!card) { await i.editReply('No live data for "' + pname + '". View that province in-game first.'); return; }
    await i.editReply('__**' + pname + '** — Status__\n' + card);
  } else if (i.commandName === 'status') {
    await i.deferReply();
    const pname = await resolveProvName(i, i.options.getString('name'));
    if (!pname) { await i.editReply('Link your province first with /link, or give a name.'); return; }
    const card = await statusCard(pname);
    if (!card) { await i.editReply('No live data for "' + pname + '". View that province in-game first.'); return; }
    await i.editReply('__**' + pname + '** — Status__\n' + card);
  } else if (i.commandName === 'help') {
    const h = [
      '__**War Room Bot — Commands**__',
      '',
      '**Intel**',
      '`/prov <name>` — full intel card for a province',
      '`/intel <kd>` — whole-KD overview + all provinces',
      '`/kds` — list tracked kingdoms',
      '`/survey <name>` — building breakdown',
      '`/tpa <name>` — thievery + magic detail',
      '`/wpa <name>` — magic detail',
      '`/econ <name>` — economy detail',
      '`/find <text>` — search provinces by name or ruler',
      '',
      '**Targeting**',
      '`/break <name> <off>` — can your offense break them?',
      '`/targets <kd> <off>` — all breakable provinces in a KD',
      '`/weak <kd>` — lowest-defense provinces',
      '`/fat <kd>` — biggest-land provinces',
      '`/left [name]` — my provinces leftover offense',
      '',
      '**Account & Alerts**',
      '`/link <province>` — link your Discord to your province',
      '`/unlink` — remove your link',
      '`/links` — list all linked provinces',
      '`/me` — show my linked province + intel',
      '`/help` — this list',
      '',
      '**Auto-posts** to this channel: attacks + ceasefires.',
      '**DM alerts**: you get a DM when your linked province is attacked.'
    ];
    await i.reply(h.join('\n'));
  }
});

client.login(process.env.DISCORD_TOKEN).catch(e => { console.error('LOGIN FAILED:', e.message); process.exit(1); });
