#!/usr/bin/env node
/* War Room Intel Server — HARDENED. Server owns data. Browser never auto-pushes. */
const http=require("http"), fs=require("fs"), qs=require("querystring"), path=require("path");
const PORT=process.env.PORT||process.argv[2]||8108, KEY=process.env.INTEL_KEY||process.argv[3]||"", SITEPASS=process.argv[4]||"";
const LOG="intel-log.json", STATE_FILE="state.json", BACKUP_DIR="state-backups";
const SERVER_VERSION="2.4-nosync-"+new Date().toISOString().slice(0,10);
if(!fs.existsSync(BACKUP_DIR)){ try{ fs.mkdirSync(BACKUP_DIR); }catch(e){} }
function readState(){ try{ return JSON.parse(fs.readFileSync(STATE_FILE,"utf8")); }catch(e){ return {myKd:{name:"",loc:"",provinces:[]},enemies:{},activeEnemy:null,settings:{}}; } }
function backupState(){ try{ if(!fs.existsSync(STATE_FILE)) return; const stamp=new Date().toISOString().replace(/[:.]/g,"-"); fs.copyFileSync(STATE_FILE, path.join(BACKUP_DIR,"state-"+stamp+".json")); const files=fs.readdirSync(BACKUP_DIR).filter(f=>f.startsWith("state-")).sort(); while(files.length>10){ try{ fs.unlinkSync(path.join(BACKUP_DIR,files.shift())); }catch(e){} } }catch(e){} }
function cleanName(n){ return ((n||"")+"").replace(/[~¬`*]+/g,"").replace(/\s*\(\d{1,2}:\d{1,2}\)\s*$/,"").trim(); }
function dedupeProvs(provs){ if(!Array.isArray(provs)) return []; const by={}; const out=[]; for(const p of provs){ const nm=cleanName(p&&p.name); if(!nm) continue; const k=nm.toLowerCase(); if(by[k]){ const keep=by[k]; for(const f in p){ if(p[f]!=null && p[f]!=="" && p[f]!==0) keep[f]=p[f]; } } else { p.name=nm; by[k]=p; out.push(p); } } return out; }
function sanitizeState(inc){ const homeLoc=((inc.myKd&&inc.myKd.loc)||"").trim(); if(inc.myKd) inc.myKd.provinces=dedupeProvs(inc.myKd.provinces); if(inc.enemies && typeof inc.enemies==="object"){ for(const id in inc.enemies){ const e=inc.enemies[id]; if(!e){ delete inc.enemies[id]; continue; } e.provinces=dedupeProvs(e.provinces); /* home-fold KILLED: server never folds enemy provs into myKd */ } } return inc; }
function writeState(obj){ backupState(); const tmp=STATE_FILE+".tmp"; fs.writeFileSync(tmp, JSON.stringify(obj)); fs.renameSync(tmp, STATE_FILE); }
let entries=[]; let nextId=1;
try{ entries=JSON.parse(fs.readFileSync(LOG,"utf8")); nextId=(entries[entries.length-1]?.id||0)+1; }catch(e){}
const persist=()=>{ try{ fs.writeFileSync(LOG,JSON.stringify(entries)); }catch(e){} };
const cors=(res)=>{ res.setHeader("Access-Control-Allow-Origin","*"); res.setHeader("Access-Control-Allow-Methods","POST, GET, OPTIONS"); res.setHeader("Access-Control-Allow-Headers","*"); res.setHeader("Access-Control-Max-Age","1000"); };
const READKEY=process.env.WARROOM_READ_KEY||(KEY?KEY+"-ro":"");
function authRead(q){ return !KEY || q===KEY || (READKEY && q===READKEY); }
let sseClients=[]; let lastSaveTime=null;
function broadcast(type){ const line="event: "+type+"\ndata: "+Date.now()+"\n\n"; sseClients=sseClients.filter(r=>{ try{ r.write(line); return true; }catch(e){ return false; } }); }
setInterval(()=>{ sseClients=sseClients.filter(r=>{ try{ r.write(":hb\n\n"); return true; }catch(e){ return false; } }); }, 25000);
http.createServer((req,res)=>{
  cors(res);
  if(req.method==="OPTIONS"){ res.writeHead(204); return res.end(); }
  const u=new URL(req.url,"http://x");
  if(req.method==="GET" && u.pathname==="/health"){
    const d=readState(); const backups=(()=>{ try{ return fs.readdirSync(BACKUP_DIR).filter(f=>f.startsWith("state-")).length; }catch(e){ return 0; } })();
    res.writeHead(200,{"Content-Type":"application/json"});
    return res.end(JSON.stringify({ok:true,version:SERVER_VERSION,myKd:(d.myKd&&d.myKd.name)||"",myLoc:(d.myKd&&d.myKd.loc)||"",myprovs:(d.myKd&&d.myKd.provinces||[]).length,enemies:Object.keys(d.enemies||{}).length,enemyKDs:Object.values(d.enemies||{}).map(e=>({name:e.name,loc:e.loc,provs:(e.provinces||[]).length})),lastSave:lastSaveTime,backups},null,2));
  }
  if(req.method==="POST"){
    let body=""; req.on("data",c=>{ body+=c; if(body.length>5e6) req.destroy(); });
    req.on("end",()=>{
      let p={}; try{ p=body.trim().startsWith("{")?JSON.parse(body):qs.parse(body); }catch(e){}
      if(KEY && (p.key||"")!==KEY){ res.writeHead(403,{"Content-Type":"application/json"}); return res.end(JSON.stringify({success:false,error:"bad key"})); }
      if(u.pathname==="/save"){
        let inc; try{ inc=JSON.parse(p.state||"{}"); }catch(e){ res.writeHead(400,{"Content-Type":"application/json"}); return res.end('{"error":"bad json"}'); }
        if(!inc||typeof inc!=="object"){ res.writeHead(400,{"Content-Type":"application/json"}); return res.end('{"error":"not an object"}'); }
        if(!("myKd" in inc)&&!("enemies" in inc)){ res.writeHead(400,{"Content-Type":"application/json"}); return res.end('{"error":"missing myKd/enemies"}'); }
        const myN=(inc.myKd&&inc.myKd.provinces||[]).length, enN=Object.keys(inc.enemies||{}).length;
        if(myN===0 && enN===0 && u.searchParams.get("force")!=="1"){ res.writeHead(409,{"Content-Type":"application/json"}); return res.end('{"error":"empty save blocked — add ?force=1 to wipe on purpose"}'); }
        // VALIDATION GUARD: block saving scattered/junk KD data
        if(u.searchParams.get("force")!=="1" && inc.myKd){
          const provs=inc.myKd.provinces||[];
          const kdName=(inc.myKd.name||"").toLowerCase().trim();
          const problems=[];
          if(provs.length>25) problems.push("myKd has "+provs.length+" provinces (max 25 — looks scattered)");
          const names=provs.map(p=>(p.name||"").trim());
          const junkTilde=names.filter(n=>/[~`*\u00ac]/.test(n));
          if(junkTilde.length) problems.push("junk/tilde provinces: "+junkTilde.slice(0,5).join(", "));
          const nameAsProv=names.filter(n=>n.toLowerCase()===kdName && kdName);
          if(nameAsProv.length) problems.push("KD name appears as a province: "+nameAsProv.join(", "));
          const seen={}, dupes=[];
          names.forEach(n=>{ const k=n.toLowerCase(); if(k){ if(seen[k]) dupes.push(n); seen[k]=1; } });
          if(dupes.length) problems.push("duplicate provinces: "+[...new Set(dupes)].slice(0,5).join(", "));
          const loc=(inc.myKd.loc||"").trim();
          if(loc && !/^\d{1,2}:\d{1,2}$/.test(loc)) problems.push("myKd location malformed: '"+loc+"'");
          if(problems.length){
            res.writeHead(422,{"Content-Type":"application/json"});
            return res.end(JSON.stringify({error:"save blocked — data failed validation", problems:problems, hint:"fix the data, or add ?force=1 to override"}));
          }
        }
        inc=sanitizeState(inc); writeState(inc); lastSaveTime=new Date().toISOString(); broadcast("state");
        res.writeHead(200,{"Content-Type":"application/json"});
        return res.end(JSON.stringify({success:true,saved:true,myprovs:(inc.myKd&&inc.myKd.provinces||[]).length,enemies:Object.keys(inc.enemies||{}).length}));
      }
      if(u.pathname==="/restore"){
        try{ const files=fs.readdirSync(BACKUP_DIR).filter(f=>f.startsWith("state-")).sort(); const which=p.backup||files[files.length-1];
          if(!which||!files.includes(which)){ res.writeHead(404,{"Content-Type":"application/json"}); return res.end(JSON.stringify({error:"backup not found",available:files})); }
          backupState(); fs.copyFileSync(path.join(BACKUP_DIR,which), STATE_FILE); broadcast("state"); const d=readState();
          res.writeHead(200,{"Content-Type":"application/json"}); return res.end(JSON.stringify({success:true,restored:which,myprovs:(d.myKd&&d.myKd.provinces||[]).length,enemies:Object.keys(d.enemies||{}).length}));
        }catch(e){ res.writeHead(500,{"Content-Type":"application/json"}); return res.end(JSON.stringify({error:e.message})); }
      }
      if(u.pathname==="/state"){ res.writeHead(410,{"Content-Type":"application/json"}); return res.end('{"error":"auto-push disabled — use Save to Server button (/save)"}'); }
      entries.push({id:nextId++, ts:Date.now(), url:p.url||"", prov:p.prov||"", data_simple:p.data_simple||"" });
      if(entries.length>2000) entries=entries.slice(-1500);
      persist(); broadcast("feed");
      res.writeHead(200,{"Content-Type":"application/json"}); res.end(JSON.stringify({success:true}));
    });
    return;
  }
  if(req.method==="GET"&&u.pathname==="/events"){
    if(!authRead(u.searchParams.get("key")||"")){ res.writeHead(403); return res.end("bad key"); }
    res.writeHead(200,{"Content-Type":"text/event-stream","Cache-Control":"no-cache, no-transform","Connection":"keep-alive","X-Accel-Buffering":"no"});
    res.write("retry: 3000\n\n"); res.write(":ok\n\n"); sseClients.push(res);
    req.on("close",()=>{ sseClients=sseClients.filter(r=>r!==res); }); return;
  }
  if(req.method==="GET"&&u.pathname==="/state"){
    if(!authRead(u.searchParams.get("key")||"")){res.writeHead(403);return res.end("{}");}
    res.writeHead(200,{"Content-Type":"application/json"});
    try{return res.end(fs.readFileSync(STATE_FILE,"utf8"));}catch(e){return res.end("{}");}
  }
  if(u.pathname==="/feed"){
    if(!authRead(u.searchParams.get("key")||"")){ res.writeHead(403,{"Content-Type":"application/json"}); return res.end(JSON.stringify({error:"bad key"})); }
    const since=parseInt(u.searchParams.get("since")||"0",10)||0; const out=entries.filter(e=>e.id>since).slice(-200);
    res.writeHead(200,{"Content-Type":"application/json"}); return res.end(JSON.stringify({cursor: out.length?out[out.length-1].id:since, entries: out}));
  }
  if(req.method==="GET" && u.pathname==="/version"){ res.writeHead(200,{"Content-Type":"text/plain","Cache-Control":"no-cache, no-store, must-revalidate"}); return res.end(SERVER_VERSION); }
  const pages={"/":"warroom.html","/index.html":"warroom.html","/mobile":"warroom-mobile.html","/mobile.html":"warroom-mobile.html"};
  if(req.method==="GET" && pages[u.pathname]){
    const ADMINPASS=process.env.WARROOM_ADMIN_PASS||SITEPASS||"", VIEWPASS=process.env.WARROOM_VIEW_PASS||"";
    let role="admin";
    if(ADMINPASS||VIEWPASS){ const auth=req.headers.authorization||""; const pass=auth.startsWith("Basic ")?Buffer.from(auth.slice(6),"base64").toString().split(":").pop():"";
      if(ADMINPASS && pass===ADMINPASS) role="admin"; else if(VIEWPASS && pass===VIEWPASS) role="viewer";
      else { res.writeHead(401,{"WWW-Authenticate":'Basic realm="War Room"'}); return res.end("Passcode required"); } }
    try{ let f=fs.readFileSync(pages[u.pathname],"utf8"); const synckey=(role==="admin")?KEY:READKEY;
      f=f.replace("<body>", '<body>\n<script>window.__WR_ROLE='+JSON.stringify(role)+';window.__WR_VERSION='+JSON.stringify(SERVER_VERSION)+';window.__WR_SYNC={url:"",syncUrl:"",key:'+JSON.stringify(synckey||"")+',syncKey:'+JSON.stringify(synckey||"")+'};(function(){var v='+JSON.stringify(SERVER_VERSION)+';setInterval(function(){fetch("/version",{cache:"no-store"}).then(function(r){return r.text();}).then(function(sv){if(sv&&sv.trim()&&sv.trim()!==v){console.log("New version detected, reloading...");location.reload(true);}}).catch(function(){});},20000);})();</script>');
      res.writeHead(200,{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-cache, no-store, must-revalidate","Pragma":"no-cache","Expires":"0"}); return res.end(f);
    }catch(e){ res.writeHead(404); return res.end("Put warroom.html next to intel-server.js"); }
  }
  res.writeHead(200,{"Content-Type":"application/json"});
  res.end(JSON.stringify({ok:true, name:"warroom-intel-server", version:SERVER_VERSION, entries:entries.length}));
}).listen(PORT,()=>console.log("War Room SAFE server "+SERVER_VERSION+" on http://0.0.0.0:"+PORT+(KEY?"  key required":"  ⚠ no key set")));
