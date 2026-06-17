function makeNewsParser(opts){
  opts=opts||{};
  const CAP=opts.cap||5000;
  const ROSTER=(opts.roster||[]).map(s=>s.toLowerCase());
  const seen=new Set(); const order=[];
  function remember(h){ if(seen.has(h))return false; seen.add(h);order.push(h); if(order.length>CAP){seen.delete(order.shift());} return true; }
  function num(s){ const n=parseInt(String(s).replace(/[,.\u00a0\u202f\s]/g,''),10); return isNaN(n)?0:n; }
  function clean(s){ return s.replace(/^An unknown province from\s+/i,'').trim(); }
  function hash(e,d){ return d+'|'+JSON.stringify(e); }
  function known(name){ return ROSTER.includes(name.toLowerCase().replace(/^\d+\s*-\s*/,'').replace(/\s*\(\d+:\d+\)\s*$/,'').trim()); }
  function stripDate(line){
    const m=line.match(/^([A-Z][a-z]{2,8}\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:\s+of)?,?\s+YR\d+)\s+/i);
    return { date:m?m[1].trim():"", rest:m?line.slice(m[0].length).trim():line.trim() };
  }
  function splitInvaded(s){
    const lower=s.toLowerCase(); const positions=[];
    let i=lower.indexOf(' invaded '); while(i>=0){ positions.push(i); i=lower.indexOf(' invaded ', i+1); }
    if(positions.length===0) return null;
    if(positions.length===1) return { attacker:s.slice(0,positions[0]).trim(), target:s.slice(positions[0]+9).trim() };
    if(ROSTER.length){
      for(const p of positions){ const a=s.slice(0,p).trim(), t=s.slice(p+9).trim(); if(known(a)&&known(t)) return {attacker:a,target:t}; }
      for(const p of positions){ const t=s.slice(p+9).trim(); if(known(t)) return {attacker:s.slice(0,p).trim(),target:t}; }
    }
    const last=positions[positions.length-1];
    return { attacker:s.slice(0,last).trim(), target:s.slice(last+9).trim() };
  }
  function parse(text, popts){
    popts=popts||{}; const out=[];
    if(typeof text!=='string') return out;
    const lines=text.split(/\r?\n/).map(l=>l.replace(/^[\s\u00a0\u202f]+|[\s\u00a0\u202f]+$/g,'')).filter(Boolean);
    for(let raw of lines){
      if(raw.length>2000) raw=raw.slice(0,2000);
      const dd=stripDate(raw); const date=dd.date; let line=dd.rest;
      const local=/^In local kingdom strife/i.test(line);
      line=line.replace(/^In local kingdom strife\s+/i,'').trim();
      let ev=null;
      let m=line.match(/^(.+?)\s+and\s+(captured|razed|conquered)\s+([\d,.\u00a0\u202f]+)\s+acres\b/i);
      if(m && / invaded /i.test(m[1])){ const sp=splitInvaded(m[1]); if(sp) ev={kind:'attack', attacker:clean(sp.attacker), target:sp.target, type:m[2].toLowerCase(), acres:num(m[3]), local}; }
      if(!ev){ m=line.match(/^(.+?)\s+and\s+massacred\s+([\d,.\u00a0\u202f]+)\s+(?:peasants|people)\b/i);
        if(m && / invaded /i.test(m[1])){ const sp=splitInvaded(m[1]); if(sp) ev={kind:'attack', attacker:clean(sp.attacker), target:sp.target, type:'massacre', killed:num(m[2]), local}; } }
      if(!ev){ m=line.match(/^(.+?)\s+and\s+plundered\s+([\d,.\u00a0\u202f]+)\s+(?:gold|runes|money)\b/i);
        if(m && / invaded /i.test(m[1])){ const sp=splitInvaded(m[1]); if(sp) ev={kind:'attack', attacker:clean(sp.attacker), target:sp.target, type:'plunder', amount:num(m[2]), local}; } }
      if(!ev){ m=line.match(/^(.+?)\s+ambushed\s+(.+?)\s+and\s+recovered\s+([\d,.\u00a0\u202f]+)\s+acres\b/i);
        if(m) ev={kind:'attack', attacker:clean(m[1]), target:m[2].trim(), type:'ambush', acres:num(m[3]), local}; }
      if(!ev){ m=line.match(/^(.+?)\s+attempted to invade\s+(.+?)\s+but\b/i);
        if(m) ev={kind:'attack', attacker:clean(m[1]), target:m[2].trim(), type:'bounce', local}; }
      if(!ev){ m=line.match(/^(.+?)\s+has sent an aid shipment to\s+(.+?)\.?$/i);
        if(m) ev={kind:'aid', from:m[1].trim(), to:m[2].trim()}; }
      if(!ev){ m=line.match(/proposed a ceasefire offer to\s+(.+?)[\.!]/i);
        if(m) ev={kind:'ceasefire', target:m[1].trim()}; }
      if(ev){ if(popts.dedup!==false){ const h=hash(ev,date); if(!remember(h)) continue; } ev._date=date; out.push(ev); }
    }
    return out;
  }
  return {parse, size:function(){return seen.size;}};
}
module.exports={makeNewsParser};
