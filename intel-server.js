#!/usr/bin/env node
/* War Room Intel Server — HARDENED. Server owns data. Browser never auto-pushes. */
const http=require("http"), fs=require("fs"), qs=require("querystring"), path=require("path");
const PORT=process.env.PORT||process.argv[2]||8108, KEY=process.env.INTEL_KEY||process.argv[3]||"", SITEPASS=process.argv[4]||"";
const LOG="intel-log.json", STATE_FILE="state.json", BACKUP_DIR="state-backups";
const SERVER_VERSION=/*VER-MTIME*/"3.5-nosync-"+new Date().toISOString().slice(0,10)+"-"+(function(){try{var _f=require("fs");return Math.round(Math.max(_f.statSync(__dirname+"/warroom.html").mtimeMs,_f.statSync(__dirname+"/warroom-mobile.html").mtimeMs)).toString(36);}catch(_e){return Date.now().toString(36);}})();
if(!fs.existsSync(BACKUP_DIR)){ try{ fs.mkdirSync(BACKUP_DIR); }catch(e){} }
function readState(){ try{ return JSON.parse(fs.readFileSync(STATE_FILE,"utf8")); }catch(e){ return {myKd:{name:"",loc:"",provinces:[]},enemies:{},activeEnemy:null,settings:{}}; } }
function backupState(){ try{ if(!fs.existsSync(STATE_FILE)) return; const stamp=new Date().toISOString().replace(/[:.]/g,"-"); fs.copyFileSync(STATE_FILE, path.join(BACKUP_DIR,"state-"+stamp+".json")); const files=fs.readdirSync(BACKUP_DIR).filter(f=>f.startsWith("state-")).sort(); while(files.length>10){ try{ fs.unlinkSync(path.join(BACKUP_DIR,files.shift())); }catch(e){} } }catch(e){} }
function cleanName(n){ return ((n||"")+"").replace(/[~¬`*]+/g,"").replace(/\s*\(\d{1,2}:\d{1,2}\)\s*$/,"").trim(); }
function dedupeProvs(provs){ if(!Array.isArray(provs)) return []; const by={}; const out=[]; for(const p of provs){ const nm=cleanName(p&&p.name); if(!nm) continue; const k=nm.toLowerCase(); if(by[k]){ const keep=by[k]; for(const f in p){ if(p[f]!=null && p[f]!=="" && p[f]!==0) keep[f]=p[f]; } } else if(typeof p.race==="string" && p.race.trim() && +p.land>0){ p.name=nm; by[k]=p; out.push(p); } } return out; }
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
/* ===== WoL Reference Wiki (added) ===== */
const WIKI_FILE=__dirname+"/wiki.html";
const WIKI_PW="Kriminal51!";
const WIKI_NAV_SCRIPT=`<script>(function(){function add(){if(document.getElementById("wr-wiki-nav"))return true;var b=document.querySelectorAll('[data-act^="nav:"]');if(!b.length)return false;var counts=new Map();for(var i=0;i<b.length;i++){var p=b[i].parentNode;counts.set(p,(counts.get(p)||0)+1);}var navC=null,max=0;counts.forEach(function(n,p){if(n>max){max=n;navC=p;}});if(!navC)return false;var cls="navlink";for(var j=0;j<b.length;j++){if(b[j].parentNode===navC){cls=((b[j].className||"navlink").split(" ").filter(function(x){return x&&x!=="on";}).join(" "))||"navlink";break;}}function mk(id,ic,lb,hr){var w=document.createElement("button");w.id=id;w.className=cls;w.innerHTML='<span class="i">'+ic+'</span> '+lb;w.onclick=function(){location.href=hr;};navC.appendChild(w);}mk("wr-wiki-nav","\u{1F4DA}","Wiki","/wiki");mk("wr-wikiup-nav","\u{270F}\u{FE0F}","Update Wiki","/wiki/upload");return true;}if(!add()){document.addEventListener("DOMContentLoaded",add);var t=setInterval(function(){if(add())clearInterval(t);},400);setTimeout(function(){clearInterval(t);},10000);}})();</script>`;
function stripGenesis(s){
  s=s.replace(/<div class="nav-section">\s*<div class="nav-section-title">Genesis<\/div>(?:\s*<button[^>]*>[\s\S]*?<\/button>)*\s*<\/div>/,"");
  s=s.replace(/<button class="nav-card" onclick="showPage\('genesis'\)">[\s\S]*?<\/button>/,"");
  s=s.replace(/<!--\s*[^>]*GENESIS[^>]*-->\s*<div id="page-genesis"[\s\S]*?<\/div><!-- \/page-genesis -->/,"");
  s=s.replace(/'All Formulas',\s*\n\s*genesis: 'Genesis Reference'/,"'All Formulas'");
  s=s.replace(/Forgotten \/ Genesis Spells/g,"Forgotten Spells");
  s=s.replace(/<div class="spell-card">\s*<h4>Righteous Defender<\/h4>[\s\S]*?recast to maintain<\/div>\s*<\/div>/,"");
  s=s.replace(/<div class="spell-card">\s*<h4>Soul Blight<\/h4>[\s\S]*?adds to own soldiers<\/div>\s*<\/div>/,"");
  s=s.replace(/\s*In Genesis castable on kingdom mates as a support spell\./g,"");
  s=s.replace(/<span class="badge badge-genesis">[^<]*<\/span>/g,"");
  s=s.replace(/\s*\.badge-genesis\s*\{[^}]*\}/g,"");
  return s;
}
const WIKI_UPLOAD_PAGE=`<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>Publish</title><body style="background:#0a0c11;color:#e6e9f0;font-family:sans-serif;max-width:520px;margin:0 auto;padding:20px"><h2>Publish WoL Reference</h2><p style="color:#888;font-size:13px">Pick the new age file and tap Publish. Genesis is auto-stripped. View at <a style="color:#6f8cff" href="/wiki">/wiki</a>.</p><input id=k type=password placeholder="Password" style="width:100%;box-sizing:border-box;padding:11px;margin:6px 0;background:#13161d;color:#e6e9f0;border:1px solid #343b49;border-radius:6px"><input id=f type=file accept=".html,.htm" style="width:100%;box-sizing:border-box;padding:11px;margin:6px 0;color:#e6e9f0"><button onclick=pub() style="width:100%;padding:13px;margin-top:10px;background:#6f8cff;color:#fff;border:0;border-radius:6px;font-size:16px;font-weight:700">Publish to site</button><pre id=m style="color:#6ee7b7;white-space:pre-wrap;font-size:13px"></pre><script>k.value=localStorage.getItem("wk")||"";function pub(){var key=k.value.trim(),fl=f.files[0];if(!key)return m.textContent="Enter your password.";if(!fl)return m.textContent="Choose a file.";localStorage.setItem("wk",key);m.textContent="Publishing...";var r=new FileReader();r.onload=function(){fetch("/wiki/save",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:"key="+encodeURIComponent(key)+"&html="+encodeURIComponent(r.result)}).then(function(x){return x.json()}).then(function(j){m.textContent=j&&j.success?"Published "+(j.bytes||0)+" chars. Open /wiki.":"Error: "+((j&&j.error)||"failed")}).catch(function(e){m.textContent="Network error: "+e})};r.readAsText(fl)}</script>`;

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
      if(KEY && (p.key||"")!==KEY && !((p.key||"")===WIKI_PW && u.pathname==="/wiki/save")){ res.writeHead(403,{"Content-Type":"application/json"}); return res.end(JSON.stringify({success:false,error:"bad key"})); }
      if(u.pathname==="/save"){
        let inc; try{ inc=JSON.parse(p.state||"{}"); }catch(e){ res.writeHead(400,{"Content-Type":"application/json"}); return res.end('{"error":"bad json"}'); }
        if(!inc||typeof inc!=="object"){ res.writeHead(400,{"Content-Type":"application/json"}); return res.end('{"error":"not an object"}'); }
        if(!("myKd" in inc)&&!("enemies" in inc)){ res.writeHead(400,{"Content-Type":"application/json"}); return res.end('{"error":"missing myKd/enemies"}'); }
        const myN=(inc.myKd&&inc.myKd.provinces||[]).length, enN=Object.keys(inc.enemies||{}).length;
        if(myN===0 && enN===0 && u.searchParams.get("force")!=="1"){ res.writeHead(409,{"Content-Type":"application/json"}); return res.end('{"error":"empty save blocked — add ?force=1 to wipe on purpose"}'); }
        // FIREWALL: block a catastrophic drop in myKd province count (the wipe bug)
        if(u.searchParams.get("force")!=="1" && inc.myKd){
          let curN=0; try{ const cs=readState(); curN=(cs.myKd&&cs.myKd.provinces||[]).length; }catch(e){}
          if(curN>=8 && myN<=Math.floor(curN*0.5)){
            res.writeHead(409,{"Content-Type":"application/json"});
            return res.end(JSON.stringify({error:"save blocked — myKd provinces would drop from "+curN+" to "+myN+" (looks like a wipe). Add ?force=1 to override on purpose.", current:curN, incoming:myN}));
          }
        }
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
          backupState(); /*RESTORE-FIREWALL*/ if(u.searchParams.get("force")!=="1"){ let _cur=-1; try{ _cur=(readState().myKd.provinces||[]).length; }catch(_){ } if(_cur>=8){ let _bak=-1; try{ _bak=(JSON.parse(fs.readFileSync(path.join(BACKUP_DIR,which),"utf8")).myKd.provinces||[]).length; }catch(_){ } if(_bak<0||_bak<=Math.floor(_cur*0.5)){ res.writeHead(409,{"Content-Type":"application/json"}); return res.end(JSON.stringify({error:"restore blocked — backup "+which+" has "+(_bak<0?"unreadable":_bak)+" provinces vs current "+_cur+" (looks like a wipe). Add ?force=1 to override.",backup:which})); } } } fs.copyFileSync(path.join(BACKUP_DIR,which), STATE_FILE); broadcast("state"); const d=readState();
          res.writeHead(200,{"Content-Type":"application/json"}); return res.end(JSON.stringify({success:true,restored:which,myprovs:(d.myKd&&d.myKd.provinces||[]).length,enemies:Object.keys(d.enemies||{}).length}));
        }catch(e){ res.writeHead(500,{"Content-Type":"application/json"}); return res.end(JSON.stringify({error:e.message})); }
      }
      if(u.pathname==="/wiki/save"){
        let html=(p.html||"")+"";
        if(html.length<200){ res.writeHead(400,{"Content-Type":"application/json"}); return res.end('{"error":"no html / too small"}'); }
        try{ html=stripGenesis(html); fs.writeFileSync(WIKI_FILE,html); }
        catch(e){ res.writeHead(500,{"Content-Type":"application/json"}); return res.end(JSON.stringify({error:e.message})); }
        res.writeHead(200,{"Content-Type":"application/json"}); return res.end(JSON.stringify({success:true,bytes:html.length}));
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
    const since=parseInt(u.searchParams.get("since")||"0",10)||0; const out=entries.filter(e=>e.id>since && String(e.url||"").indexOf("/wol/")>=0).slice(-200);
    res.writeHead(200,{"Content-Type":"application/json"}); return res.end(JSON.stringify({cursor: out.length?out[out.length-1].id:since, entries: out}));
  }
  if(req.method==="GET" && u.pathname==="/version"){ res.writeHead(200,{"Content-Type":"text/plain","Cache-Control":"no-cache, no-store, must-revalidate"}); return res.end(SERVER_VERSION); }
  if(req.method==="GET" && u.pathname==="/wiki"){
    try{ const w=fs.readFileSync(WIKI_FILE,"utf8");
      res.writeHead(200,{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-cache, no-store, must-revalidate"}); return res.end(w);
    }catch(e){
      res.writeHead(200,{"Content-Type":"text/html; charset=utf-8"});
      return res.end('<body style="background:#0a0c11;color:#e6e9f0;font-family:system-ui,sans-serif;padding:40px;text-align:center"><h2>No World of Legends reference published yet</h2><p>Go to <a style="color:#6f8cff" href="/wiki/upload">/wiki/upload</a> to publish it.</p></body>');
    }
  }
  if(req.method==="GET" && u.pathname==="/wiki/upload"){
    res.writeHead(200,{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-cache, no-store, must-revalidate"});
    return res.end(WIKI_UPLOAD_PAGE);
  }
  const pages={"/":"warroom.html","/index.html":"warroom.html","/mobile":"warroom-mobile.html","/mobile.html":"warroom-mobile.html"};
  if(req.method==="GET" && pages[u.pathname]){
    const ADMINPASS=process.env.WARROOM_ADMIN_PASS||SITEPASS||"Kriminal51!", VIEWPASS=process.env.WARROOM_VIEW_PASS||"";
    let role="admin";
    if(ADMINPASS||VIEWPASS){ const auth=req.headers.authorization||""; const pass=auth.startsWith("Basic ")?Buffer.from(auth.slice(6),"base64").toString().split(":").pop():"";
      if(ADMINPASS && pass===ADMINPASS) role="admin"; else if(VIEWPASS && pass===VIEWPASS) role="viewer";
      else { res.writeHead(401,{"WWW-Authenticate":'Basic realm="War Room"'}); return res.end("Passcode required"); } }
    try{ let f=fs.readFileSync(pages[u.pathname],"utf8"); const synckey=(role==="admin")?KEY:READKEY;
      f=f.replace("<body>", '<body>\n<script>window.__WR_ROLE='+JSON.stringify(role)+';window.__WR_VERSION='+JSON.stringify(SERVER_VERSION)+';window.__WR_SYNC={url:"",syncUrl:"",key:'+JSON.stringify(synckey||"")+',syncKey:'+JSON.stringify(synckey||"")+'};(function(){var v='+JSON.stringify(SERVER_VERSION)+';setInterval(function(){fetch("/version",{cache:"no-store"}).then(function(r){return r.text();}).then(function(sv){if(sv&&sv.trim()&&sv.trim()!==v){console.log("New version detected, reloading...");location.reload(true);}}).catch(function(){});},20000);})();</script>'+WIKI_NAV_SCRIPT);
      res.writeHead(200,{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-cache, no-store, must-revalidate","Pragma":"no-cache","Expires":"0"}); return res.end(f);
    }catch(e){ res.writeHead(404); return res.end("Put warroom.html next to intel-server.js"); }
  }
  res.writeHead(200,{"Content-Type":"application/json"});
  res.end(JSON.stringify({ok:true, name:"warroom-intel-server", version:SERVER_VERSION, entries:entries.length}));
}).listen(PORT,()=>console.log("War Room SAFE server "+SERVER_VERSION+" on http://0.0.0.0:"+PORT+(KEY?"  key required":"  ⚠ no key set")));
