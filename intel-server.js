#!/usr/bin/env node
/* War Room Intel Server — receives live intel from utopia-game.com
   Protocol (cmunk/utopiaintel): game POSTs form fields data_html, data_simple, url, prov, key.
   Run:  node intel-server.js [port] [key] [sitePasscode] [discordWebhookUrl]   — also serves the site: /  (desktop) and /mobile
   (Optional 5th arg or WARROOM_WEBHOOK env = Discord webhook URL → auto-posts the wave when it changes.)
   Then in game Preferences → "Send intel to your own Intel site" → URL: http://YOUR-HOST:8108/post  Key: yourkey
   War Room Settings → Live Sync URL: http://YOUR-HOST:8108   Key: yourkey
*/
const http=require("http"), fs=require("fs"), qs=require("querystring");
const PORT=process.env.PORT||process.argv[2]||8108, KEY=process.env.INTEL_KEY||process.argv[3]||"", SITEPASS=process.argv[4]||"";  // PORT/INTEL_KEY env work on Render/Railway; 4th arg = legacy single passcode
const WEBHOOK=process.argv[5]||process.env.WARROOM_WEBHOOK||"";  // 5th arg / env = Discord webhook URL → auto-push wave when it changes
const LOG="intel-log.json";

// ── optional Discord auto-push: posts the wave to a webhook ~12s after it stops changing ──
const fkn=n=>{n=+n||0;return Math.abs(n)>=1e6?(n/1e6).toFixed(1)+"M":Math.abs(n)>=1e3?Math.round(n/1e3)+"k":""+Math.round(n);};
function waveSummaryFor(s,e){
  try{
    if(!e||!e.wave||!e.wave.length) return null;
    const nm=id=>(s.myKd.provinces.find(p=>p.id===id)||{}).name||"?";
    const pa=id=>(s.myKd.provinces.find(p=>p.id===id)||{});
    const ment=p=>{const d=((p&&p.discord)||"").trim();if(!d)return"";const idn=d.replace(/[<@!>]/g,"");return /^\d{5,}$/.test(idn)?" <@"+idn+">":" "+(d.startsWith("@")?d:"@"+d);};
    const tn=id=>(e.provinces.find(p=>p.id===id)||{}).name||"?";
    const byA={}; e.wave.forEach(w=>{(byA[w.attacker]=byA[w.attacker]||[]).push(w);});
    const lines=Object.keys(byA).map(aid=>"• **"+nm(aid)+"**"+ment(pa(aid))+" → "+byA[aid].map(w=>{
      const tp=e.provinces.find(p=>p.id===w.target)||{};
      if(w.cat==="tm") return tn(w.target)+" (TM)";
      const mod=(+w.off||0)*(1+0.05*Math.max(0,(+w.gens||1)-1));
      const need=w.type==="conquest"?(+tp.defense||0)*0.51:(+tp.defense||0);
      return tn(w.target)+" ("+w.type+" "+fkn(w.off)+(mod>need?"":" ⚠")+")";
    }).join(", "));
    const sig=JSON.stringify(e.wave.map(w=>[w.attacker,w.target,w.type,w.cat,w.off,w.gens]));
    return {text:"📋 **Wave vs "+e.name+"** ("+e.wave.length+" attacks)\n"+lines.join("\n"), sig};
  }catch(err){ return null; }
}
let lastSigByEnemy={}, pushTimer=null;
function schedulePush(){                                    // debounced; pushes every enemy whose wave changed
  if(!WEBHOOK) return;
  if(typeof fetch!=="function"){ console.log("⚠ webhook set but Node fetch unavailable (needs Node 18+)"); return; }
  clearTimeout(pushTimer);
  pushTimer=setTimeout(()=>{
    let s; try{ s=JSON.parse(fs.readFileSync("state.json","utf8")); }catch(e){ return; }
    const enemies=(s&&s.enemies)||{};
    for(const id in enemies){
      const sum=waveSummaryFor(s,enemies[id]); if(!sum) continue;
      if(lastSigByEnemy[id]===sum.sig) continue; lastSigByEnemy[id]=sum.sig;
      fetch(WEBHOOK,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({content:sum.text.slice(0,1900)})})
        .then(()=>console.log(new Date().toISOString(),"→ pushed wave vs",enemies[id].name))
        .catch(err=>console.log("webhook push failed:",err.message));
    }
  }, 12000);
}
let entries=[]; let nextId=1;
try{ entries=JSON.parse(fs.readFileSync(LOG,"utf8")); nextId=(entries[entries.length-1]?.id||0)+1; }catch(e){}
const persist=()=>{ try{ fs.writeFileSync(LOG,JSON.stringify(entries)); }catch(e){} };
const cors=(res)=>{ res.setHeader("Access-Control-Allow-Origin","*"); res.setHeader("Access-Control-Allow-Methods","POST, GET, OPTIONS"); res.setHeader("Access-Control-Allow-Headers","*"); res.setHeader("Access-Control-Max-Age","1000"); };
// ── live updates: read-only key for viewers + Server-Sent-Events push ──
const READKEY=process.env.WARROOM_READ_KEY||(KEY?KEY+"-ro":"");   // grants GET feed/state/events but NOT writes
function authRead(q){ return !KEY || q===KEY || (READKEY && q===READKEY); }
let sseClients=[];
function broadcast(type){
  const line="event: "+type+"\ndata: "+Date.now()+"\n\n";
  sseClients=sseClients.filter(r=>{ try{ r.write(line); return true; }catch(e){ return false; } });
}
setInterval(()=>{ sseClients=sseClients.filter(r=>{ try{ r.write(":hb\n\n"); return true; }catch(e){ return false; } }); }, 25000); // heartbeat keeps connections alive

// ── multi-admin merge: a save only replaces the sections it actually changed (by _rev) ──
function readStateObj(){ try{ return JSON.parse(fs.readFileSync("state.json","utf8")); }catch(e){ return {}; } }
function mergeIncoming(incomingStr){
  let inc; try{ inc=JSON.parse(incomingStr); }catch(e){ return incomingStr; }
  if(!inc||typeof inc!=="object") return incomingStr;
  let cur=readStateObj(); if(!cur||typeof cur!=="object") cur={};
  if(!cur.enemies && !cur.myKd) return JSON.stringify(inc);          // first/empty store → take wholesale
  // myKd: newer revision wins
  if(inc.myKd){ if(!cur.myKd || (inc.myKd._rev||0) >= (cur.myKd._rev||0)) cur.myKd=inc.myKd; }
  // enemies: each enemy KD merged independently by its own revision
  cur.enemies=cur.enemies||{};
  if(inc.enemies){ for(const id in inc.enemies){ const ie=inc.enemies[id], ce=cur.enemies[id];
    if(!ce || (ie._rev||0) >= (ce._rev||0)) cur.enemies[id]=ie; } }
  if(inc.tick!=null) cur.tick=inc.tick;
  if(inc.settings) cur.settings=inc.settings;                        // for the bot/webhook (range etc.)
  if(inc.activeEnemy!=null) cur.activeEnemy=inc.activeEnemy;
  return JSON.stringify(cur);
}

http.createServer((req,res)=>{
  cors(res);
  if(req.method==="OPTIONS"){ res.writeHead(204); return res.end(); }
  const u=new URL(req.url,"http://x");
  if(req.method==="POST"){                                   // game → here
    let body=""; req.on("data",c=>{ body+=c; if(body.length>5e6) req.destroy(); });
    req.on("end",()=>{
      let p={}; try{ p=body.trim().startsWith("{")?JSON.parse(body):qs.parse(body); }catch(e){}
      if(KEY && (p.key||"")!==KEY){ res.writeHead(403,{"Content-Type":"application/json"}); return res.end(JSON.stringify({success:false,error:"bad key"})); }
      if(u.pathname==="/state"){ const merged=mergeIncoming(p.state||"{}"); try{fs.writeFileSync("state.json",merged);}catch(e){} schedulePush(merged); broadcast("state"); res.writeHead(200,{"Content-Type":"application/json"}); return res.end('{"success":true}'); }
      entries.push({id:nextId++, ts:Date.now(), url:p.url||"", prov:p.prov||"", data_simple:p.data_simple||"", });
      if(entries.length>2000) entries=entries.slice(-1500);  // keep it bounded
      persist(); broadcast("feed");
      console.log(new Date().toISOString(),"intel from",p.prov||"?","→",(p.url||"").slice(0,80));
      res.writeHead(200,{"Content-Type":"application/json"});
      res.end(JSON.stringify({success:true}));               // game requires success:true
    });
    return;
  }
  if(req.method==="GET"&&u.pathname==="/events"){             // live push (SSE) → War Room
    if(!authRead(u.searchParams.get("key")||"")){ res.writeHead(403); return res.end("bad key"); }
    res.writeHead(200,{"Content-Type":"text/event-stream","Cache-Control":"no-cache, no-transform","Connection":"keep-alive","X-Accel-Buffering":"no"});
    res.write("retry: 3000\n\n"); res.write(":ok\n\n");
    sseClients.push(res);
    req.on("close",()=>{ sseClients=sseClients.filter(r=>r!==res); });
    return;
  }
  if(req.method==="GET"&&u.pathname==="/state"){
    if(!authRead(u.searchParams.get("key")||"")){res.writeHead(403);return res.end("{}");}
    res.writeHead(200,{"Content-Type":"application/json"});
    try{return res.end(fs.readFileSync("state.json","utf8"));}catch(e){return res.end("{}");}
  }
  if(u.pathname==="/feed"){                                  // War Room ← here
    if(!authRead(u.searchParams.get("key")||"")){ res.writeHead(403,{"Content-Type":"application/json"}); return res.end(JSON.stringify({error:"bad key"})); }
    const since=parseInt(u.searchParams.get("since")||"0",10)||0;
    const out=entries.filter(e=>e.id>since).slice(0,200);
    res.writeHead(200,{"Content-Type":"application/json"});
    return res.end(JSON.stringify({cursor: out.length?out[out.length-1].id:since, entries: out}));
  }
  // serve the War Room website itself
  const pages={"/":"warroom.html","/index.html":"warroom.html","/mobile":"warroom-mobile.html","/mobile.html":"warroom-mobile.html"};
  if(req.method==="GET" && pages[u.pathname]){
    // Two logins: ADMIN (full edit) and VIEWER (read-only). Env: WARROOM_ADMIN_PASS / WARROOM_VIEW_PASS.
    // Back-compat: the old 4th-arg SITEPASS acts as the admin passcode if no admin env is set.
    const ADMINPASS=process.env.WARROOM_ADMIN_PASS||SITEPASS||"";
    const VIEWPASS=process.env.WARROOM_VIEW_PASS||"";
    let role="admin";                                  // if no passes are set at all → open admin (unchanged behavior)
    if(ADMINPASS||VIEWPASS){
      const auth=req.headers.authorization||"";
      const pass=auth.startsWith("Basic ")?Buffer.from(auth.slice(6),"base64").toString().split(":").pop():"";
      if(ADMINPASS && pass===ADMINPASS) role="admin";
      else if(VIEWPASS && pass===VIEWPASS) role="viewer";
      else { res.writeHead(401,{"WWW-Authenticate":'Basic realm="War Room (admin or viewer passcode)"'}); return res.end("Passcode required (admin or viewer)"); }
    }
    try{ let f=fs.readFileSync(pages[u.pathname],"utf8");
      const synckey=(role==="admin")?KEY:READKEY;             // admin gets full key; viewer gets read-only key
      f=f.replace("<body>", '<body>\n<script>window.__WR_ROLE='+JSON.stringify(role)+';window.__WR_SYNC={url:"",key:'+JSON.stringify(synckey||"")+'};</script>');
      res.writeHead(200,{"Content-Type":"text/html; charset=utf-8"}); return res.end(f);
    }catch(e){ res.writeHead(404); return res.end("Put warroom.html next to intel-server.js"); }
  }
  res.writeHead(200,{"Content-Type":"application/json"});
  res.end(JSON.stringify({ok:true, name:"savagedomain-intel-server", entries:entries.length}));
}).listen(PORT,()=>console.log("War Room intel server on http://0.0.0.0:"+PORT+"  (POST endpoint: /post or /, feed: /feed)"+(KEY?"  key required":"  ⚠ no key set")));
