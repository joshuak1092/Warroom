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
      const akey=want+'|'+Math.round(returnAt/600000)+'|'+a.land;
      const rec=armyState[akey] || { warned:false, home:false, prov:lk.prov, returnAt };
      const minsLeft=(returnAt-now)/60000;
      if(!rec.warned && minsLeft<=30 && minsLeft>0){
        rec.warned=true; armyState[akey]=rec; saveArmyState();
        client.users.fetch(lk.discord_id).then(u=>u.send(':hourglass_flowing_sand: **Army returning soon** — general home in ~'+Math.max(1,Math.round(minsLeft))+' min with **'+a.land.toLocaleString()+' land**. ('+lk.prov+')')).catch(()=>{});
      }
      if(!rec.home && minsLeft<=0){
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
let lastTickDmHour=-1;
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
    lastTickDmHour=tickHour;
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
async function dmAttacked(client, ev){
  const lk = linkForTarget(ev.target);
  if(!lk) return;
  try{
    const user = await client.users.fetch(lk.discord_id);
    const T = { captured:'captured', razed:'razed', conquered:'conquered', massacre:'massacred', plunder:'plundered', ambush:'ambushed', bounce:'bounced off' };
    let what = T[ev.type]||ev.type;
    let dt = '';
    if(ev.acres) dt = ' — ' + ev.acres.toLocaleString() + ' acres';
    else if(ev.killed) dt = ' — ' + ev.killed.toLocaleString() + ' killed';
    else if(ev.amount) dt = ' — ' + ev.amount.toLocaleString() + ' taken';
    const head = ':rotating_light: **' + lk.prov + ' was attacked!**\n' + (ev.attacker||'someone') + ' ' + what + ' you' + dt + '.';
    let card = await statusCard(lk.prov);
    await user.send(card ? head + '\n\n' + card : head);
  }catch(e){ console.error('DM fail:', e.message); }
}

const KEY = process.env.INTEL_KEY || '';
const BASE = 'http://localhost:8108';
const parser = makeNewsParser();
let cursor = 0;

function httpGet(path) {
  return new Promise((resolve) => {
    http.get(BASE + path, (res) => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { resolve(null); } });
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
  const L = [];
  L.push('__**' + p.name + '**__ · ' + (p.race||'?') + '/' + (p.pers||'?') + ' · ' + hit.loc + ' · ' + hit.kd);
  L.push('Land **' + N(g('land')||p.land) + '** · NW **' + N(p.nw) + '**' + (p.honor?' · '+p.honor:''));
  L.push('**Military**');
  L.push('  Off ' + N(g('offHome')) + ' · Def ' + N(g('defHome')) + (g('ome')?' · OME '+g('ome')+'%':'') + (g('dme')?' · DME '+g('dme')+'%':''));
  L.push('  OSPA ' + (g('opa')||'?') + ' · DSPA ' + (g('dpa')||'?') + ' · Army ' + N(g('military')));
  L.push('**Thievery / Magic**');
  L.push('  mTPA ' + (p.mdtpa||'?') + ' · oTPA ' + (g('otpa')||'?') + ' · dTPA ' + (g('dtpa')||'?') + ' · rTPA ' + (g('rtpa')||'?'));
  L.push('  mWPA ' + (p.mdwpa||'?') + ' · oWPA ' + (g('owpa')||'?') + ' · dWPA ' + (g('dwpa')||'?') + ' · rWPA ' + (g('rwpa')||'?'));
  L.push('  Thieves ' + N(g('thieves')) + ' · Wizards ' + N(g('wizards')) + (g('be')?' · BE '+g('be')+'%':''));
  L.push('**Economy**');
  L.push('  Gold ' + N(g('gcs')) + ' · Food ' + N(g('food')) + ' · Runes ' + N(g('runes')) + ' · Peons ' + N(g('peons')));
  const age = g('intelAge');
  if (age != null) L.push('_intel age: ' + age + ' ticks_');
  return L.join('\n');
}
function kdSummary(state, locOrName) {
  const q = (locOrName||'').toLowerCase();
  let kd = null;
  if (state.myKd && ((state.myKd.loc||'').toLowerCase()===q || (state.myKd.name||'').toLowerCase().includes(q))) kd = state.myKd;
  if (!kd) kd = Object.values(state.enemies||{}).find(e => (e.loc||'').toLowerCase()===q || (e.name||'').toLowerCase().includes(q));
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
  q=(q||'').toLowerCase();
  if(state.myKd && ((state.myKd.loc||'').toLowerCase()===q||(state.myKd.name||'').toLowerCase().includes(q))) return state.myKd;
  return Object.values(state.enemies||{}).find(e=>(e.loc||'').toLowerCase()===q||(e.name||'').toLowerCase().includes(q));
}
function breakLine(hit, off){
  const p=hit.p; const def=enemyDef(p);
  const ok = off>=def;
  const diff = Math.abs(off-def);
  return (ok?':white_check_mark: **BREAKS**':':x: cannot break')+' — '+p.name+' (def '+N(def)+')'+(ok?' by +'+N(diff):' short '+N(diff));
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
  new SlashCommandBuilder().setName('intel').setDescription('Whole-KD overview').addStringOption(o=>o.setName('kd').setDescription('KD location or name').setRequired(true)),
  new SlashCommandBuilder().setName('kds').setDescription('List tracked kingdoms'),
  new SlashCommandBuilder().setName('survey').setDescription('Building breakdown for a province').addStringOption(o=>o.setName('name').setDescription('province name').setRequired(true)),
  new SlashCommandBuilder().setName('tpa').setDescription('Thievery & magic for a province').addStringOption(o=>o.setName('name').setDescription('province name').setRequired(true)),
  new SlashCommandBuilder().setName('econ').setDescription('Economy for a province').addStringOption(o=>o.setName('name').setDescription('province name').setRequired(true)),
  new SlashCommandBuilder().setName('wpa').setDescription('Magic detail for a province').addStringOption(o=>o.setName('name').setDescription('province name').setRequired(true)),
  new SlashCommandBuilder().setName('break').setDescription('Can your offense break a province?').addStringOption(o=>o.setName('name').setDescription('province name').setRequired(true)).addIntegerOption(o=>o.setName('off').setDescription('your offense').setRequired(true)),
  new SlashCommandBuilder().setName('targets').setDescription('All breakable provinces in a KD').addStringOption(o=>o.setName('kd').setDescription('KD loc/name').setRequired(true)).addIntegerOption(o=>o.setName('off').setDescription('your offense').setRequired(true)),
  new SlashCommandBuilder().setName('weak').setDescription('Lowest-defense provinces in a KD').addStringOption(o=>o.setName('kd').setDescription('KD loc/name').setRequired(true)),
  new SlashCommandBuilder().setName('fat').setDescription('Biggest-land provinces in a KD').addStringOption(o=>o.setName('kd').setDescription('KD loc/name').setRequired(true)),
  new SlashCommandBuilder().setName('left').setDescription('My provinces leftover offense').addStringOption(o=>o.setName('name').setDescription('one province (optional)').setRequired(false)),
  new SlashCommandBuilder().setName('find').setDescription('Search provinces by name or ruler').addStringOption(o=>o.setName('text').setDescription('search text').setRequired(true)),
  new SlashCommandBuilder().setName('link').setDescription('Link your Discord to your province').addStringOption(o=>o.setName('province').setDescription('your province name').setRequired(true)),
  new SlashCommandBuilder().setName('unlink').setDescription('Remove your province link'),
  new SlashCommandBuilder().setName('links').setDescription('List all linked provinces'),
  new SlashCommandBuilder().setName('me').setDescription('Show my linked province + intel'),
  new SlashCommandBuilder().setName('status').setDescription('Full status: throne days, off/def, generals, army returns').addStringOption(o=>o.setName('name').setDescription('province, player, or blank for own').setRequired(false)),

  new SlashCommandBuilder().setName('help').setDescription('List everything the bot can do'),
  new SlashCommandBuilder().setName('live').setDescription('Freshest live intel for a province from the feed').addStringOption(o=>o.setName('name').setDescription('province name').setRequired(true))
].map(c=>c.toJSON());

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

client.once('clientReady', async () => {
  console.log('BOT online as ' + client.user.tag);
  try {
    const rest = new REST({version:'10'}).setToken(process.env.DISCORD_TOKEN);
    await rest.put(Routes.applicationGuildCommands(client.user.id, process.env.GUILD_ID), { body: cmds });
    console.log('slash commands registered');
  } catch(e) { console.error('cmd register fail:', e.message); }
  const ch = await client.channels.fetch(process.env.CH_BOTTEST);
  const prime = await fetchFeed();
  if (prime && prime.cursor) { cursor = prime.cursor; console.log('cursor primed at ' + cursor); }
  async function poll() {
    const feed = await fetchFeed();
    if (feed && feed.entries) {
      for (const en of feed.entries) {
        for (const ev of parser.parse(en.data_simple||'')) {
          let msg = null;
          if (ev.kind==='attack') msg = fmtAttack(ev);
          else if (ev.kind==='ceasefire') msg = fmtWar(ev);
          if (msg) {
            const key = (ev._date||'') + '|' + ev.kind + '|' + (ev.attacker||'') + '|' + (ev.target||'') + '|' + (ev.acres||ev.killed||ev.amount||'') + '|' + (ev.type||'');
            if (alreadyPosted(key)) continue;
            try { await ch.send(msg); markSeen(key); if(ev.kind==='attack') await dmAttacked(client, ev); } catch(e) { console.error('post fail:', e.message); }
          }
        }
      }
      if (feed.cursor) cursor = feed.cursor;
    }
  }
  setInterval(poll, 8000);
  setInterval(()=>{ checkArmyReturns(client).catch(e=>console.error('army check:', e.message)); }, 60000);
  setInterval(()=>{ checkTickDM(client).catch(e=>console.error('tick dm:', e.message)); }, 30000);
  console.log('feed polling started (8s)');
});

client.on('interactionCreate', async (i) => {
  if (!i.isChatInputCommand()) return;
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
  } else if (i.commandName === 'left') {
    await i.reply(leftCard(state, i.options.getString('name')));
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
  } else if (i.commandName === 'links') {
    const keys = Object.keys(links);
    if (!keys.length) { await i.reply('No provinces linked yet. Use /link <province>.'); return; }
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
