const {makeNewsParser}=require('./parser.js');
let P=0,F=0,fails=[];
function t(n,fn){ try{ const r=fn(); if(r===true)P++; else {F++; fails.push(n+' -> '+r);} }catch(e){F++;fails.push(n+' THREW '+e.message);} }
const real=`July 1 of YR6   We have proposed a ceasefire offer to Poke-men (4:2). If accepted it will be unbreakable until March 1 of YR7!
July 1 of YR6   An unknown province from Unnamed kingdom (2:3) invaded 7 - xLDrag00n (3:4) and captured 297 acres of land.
July 2 of YR6   In local kingdom strife 8 - LubelessEntry (3:4) invaded 25 - Hebe (3:4) and razed 349 acres of land.
July 2 of YR6   Bad Choices has sent an aid shipment to Hebe.
July 2 of YR6   500 peasants in a trench coat has sent an aid shipment to Hebe.`;
const p=makeNewsParser();
const ev=p.parse(real);
t('real: 5 events',()=>ev.length===5||'got '+ev.length);
t('real: 2 attacks',()=>ev.filter(x=>x.kind==='attack').length===2||'got '+ev.filter(x=>x.kind==='attack').length);
t('real: 2 aid',()=>ev.filter(x=>x.kind==='aid').length===2||'got '+ev.filter(x=>x.kind==='aid').length);
t('real: 1 ceasefire',()=>ev.filter(x=>x.kind==='ceasefire').length===1||'wrong');
t('real: name cleaned',()=>!ev.some(x=>x.attacker&&x.attacker.includes('unknown'))||'leaked');
t('real: 297 acres',()=>ev.some(x=>x.acres===297)||'missing');
t('real: razed 349',()=>ev.some(x=>x.acres===349&&x.type==='razed')||'missing');
t('real: local flagged',()=>ev.some(x=>x.local===true)||'local missing');
t('real: aid Bad Choices',()=>ev.some(x=>x.kind==='aid'&&x.from==='Bad Choices')||'wrong');
t('real: trenchcoat aid',()=>ev.some(x=>x.from==='500 peasants in a trench coat')||'broke');
t('dedup: reparse 0 new',()=>p.parse(real).length===0||'DUP LEAK');
t('null safe',()=>makeNewsParser().parse(null).length===0||'crash');
t('undefined safe',()=>makeNewsParser().parse(undefined).length===0||'crash');
t('number input safe',()=>makeNewsParser().parse(12345).length===0||'crash');
t('array input safe',()=>makeNewsParser().parse([1,2,3]).length===0||'crash');
t('object input safe',()=>makeNewsParser().parse({}).length===0||'crash');
t('empty string',()=>makeNewsParser().parse('').length===0||'crash');
t('whitespace only',()=>makeNewsParser().parse('   \n\t\n  ').length===0||'crash');
t('garbage line',()=>makeNewsParser().parse('$%^&*garbage!!!').length===0||'false positive');
t('ReDoS 1000 invaded <1s',()=>{const s='A'+(' invaded x'.repeat(1000))+' and razed 1 acres of land.';const t0=Date.now();makeNewsParser().parse('July 1 of YR6   '+s);return (Date.now()-t0)<1000||'SLOW';});
t('ReDoS 10k char <500ms',()=>{const s='July 1 of YR6   '+'A'.repeat(10000)+' invaded Bar and razed 1 acres of land.';const t0=Date.now();makeNewsParser().parse(s);return (Date.now()-t0)<500||'SLOW';});
t('50k lines <3s',()=>{let f='';for(let i=0;i<50000;i++)f+='July 1 of YR6   Foo'+i+' invaded Bar and razed '+(i%200)+' acres of land.\n';const t0=Date.now();makeNewsParser().parse(f);return (Date.now()-t0)<3000||'SLOW';});
t('captured',()=>{const e=makeNewsParser().parse('July 1 of YR6   Foo invaded Bar and captured 100 acres of land.');return e[0]&&e[0].type==='captured'&&e[0].acres===100||'miss';});
t('razed',()=>{const e=makeNewsParser().parse('July 1 of YR6   Foo invaded Bar and razed 100 acres of land.');return e[0]&&e[0].type==='razed'||'miss';});
t('conquered',()=>{const e=makeNewsParser().parse('July 1 of YR6   Foo invaded Bar and conquered 100 acres of land.');return e[0]&&e[0].type==='conquered'||'miss';});
t('massacre',()=>{const e=makeNewsParser().parse('July 1 of YR6   Foo invaded Bar and massacred 5000 peasants.');return e[0]&&e[0].type==='massacre'&&e[0].killed===5000||'miss';});
t('plunder gold',()=>{const e=makeNewsParser().parse('July 1 of YR6   Foo invaded Bar and plundered 9999 gold.');return e[0]&&e[0].type==='plunder'||'miss';});
t('ambush',()=>{const e=makeNewsParser().parse('July 1 of YR6   Foo ambushed Bar and recovered 50 acres of land.');return e[0]&&e[0].type==='ambush'||'miss';});
t('bounce',()=>{const e=makeNewsParser().parse('July 1 of YR6   Foo attempted to invade Bar but was repelled.');return e[0]&&e[0].type==='bounce'||'miss';});
t('commas',()=>{const e=makeNewsParser().parse('July 1 of YR6   Foo invaded Bar and captured 1,234 acres of land.');return e[0]&&e[0].acres===1234||'got '+(e[0]&&e[0].acres);});
t('big number',()=>{const e=makeNewsParser().parse('July 1 of YR6   Foo invaded Bar and captured 1,234,567 acres of land.');return e[0]&&e[0].acres===1234567||'miss';});
t('nbsp number',()=>{const e=makeNewsParser().parse('July 1 of YR6   Foo invaded Bar and razed 1\u00a0234 acres of land.');return e[0]&&e[0].acres===1234||'got '+(e[0]&&e[0].acres);});
t('comma date format',()=>{const e=makeNewsParser().parse('July 4, YR6   Foo invaded Bar and razed 100 acres of land.');return e.length===1||'miss';});
t('date not in name',()=>{const e=makeNewsParser().parse('July 4 of YR6   Foo invaded Bar and razed 100 acres of land.');return e[0]&&!/(YR|July)/.test(e[0].attacker)||'leaked';});
t('prose no event',()=>makeNewsParser().parse('July 1 of YR6   Doubt invaded their hearts.').length===0||'FALSE POS');
t('obituary no event',()=>makeNewsParser().parse('July 1 of YR6   Bar has fallen and been removed.').length===0||'FALSE POS');
console.log('RESULT: '+P+' passed, '+F+' failed');
if(fails.length){ console.log('FAILURES:'); fails.forEach(f=>console.log('  - '+f)); } else console.log('ALL PASS');
