// 边界场景：B→U / S→U / U激活后再次点U取消回到全部 / 普通A级过滤仍正常
const http=require('http'),fs=require('fs'),path=require('path'),{spawn}=require('child_process');
const PORT=19491,DBG=19591,ROOT=path.resolve(__dirname,'..'),EDGE='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const server=http.createServer((req,res)=>{let p=path.join(ROOT,decodeURIComponent(req.url.split('?')[0]));if(p.endsWith('/')||p.endsWith('\\'))p=path.join(p,'index.html');fs.readFile(p,(e,d)=>{if(e){res.writeHead(404);res.end('nf');return;}const ext=path.extname(p);const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css'}[ext]||'application/octet-stream';res.writeHead(200,{'Content-Type':mime+'; charset=utf-8'});res.end(d);});});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function clickWaitExpr(txt, ms){const t=JSON.stringify(txt);return `(()=>{const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').trim()===${t}); if(!b) return JSON.stringify({err:'NOTFOUND:'+${t}}); b.click(); return new Promise(r=>setTimeout(()=>{let n=0; const cs=document.querySelectorAll('div.bg-white.rounded-2xl.border'); const vis={}; for(const c of cs){const h=c.querySelector('h2,h3'); if(!h) continue; const st=getComputedStyle(c); if(st.display!=='none'&&c.offsetParent!==null){n++; const tx=(h.textContent||''); if(tx.includes('三星'))vis.samsung=true; if(tx.includes('宏碁'))vis.acer=true;}} r(JSON.stringify({visible:n, samsung:!!vis.samsung, acer:!!vis.acer}));}, ${ms}));})()`;}
const STATE=`(()=>{let n=0; const cs=document.querySelectorAll('div.bg-white.rounded-2xl.border'); const vis={}; for(const c of cs){const h=c.querySelector('h2,h3'); if(!h) continue; const st=getComputedStyle(c); if(st.display!=='none'&&c.offsetParent!==null){n++; const tx=(h.textContent||''); if(tx.includes('三星'))vis.samsung=true; if(tx.includes('宏碁'))vis.acer=true;}} return JSON.stringify({visible:n, samsung:!!vis.samsung, acer:!!vis.acer});})()`;
(async()=>{
await new Promise(r=>server.listen(PORT,r));
const edge=spawn(EDGE,['--headless=new','--disk-cache-size=1',`--remote-debugging-port=${DBG}`,'--no-first-run','--window-size=1280,900','--user-data-dir='+path.join(__dirname,'edgeprof-gu2'+Date.now()),`http://127.0.0.1:${PORT}/?nocache=${Date.now()}`],{stdio:'ignore'});
await sleep(7000);
const list=await (await fetch(`http://127.0.0.1:${DBG}/json`)).json();
const page=list.find(t=>t.type==='page'&&/127\.0\.0\.1/.test(t.url))||list.find(t=>t.type==='page');
const WebSocket=require('ws');const ws=new WebSocket(page.webSocketDebuggerUrl,{maxPayload:64*1024*1024});await new Promise(r=>ws.on('open',r));
let mid=0;const pending=new Map();ws.on('message',raw=>{const m=JSON.parse(raw);if(m.id&&pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id);}});
const call=(method,params)=>new Promise(res=>{const i=++mid;pending.set(i,res);ws.send(JSON.stringify({id:i,method,params:params||{}}));});
const ev=async(expr)=>{const r=await call('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true});return r.result&&r.result.result&&r.result.result.value;};
await call('Runtime.enable');
for(let i=0;i<40;i++){const ready=await ev(`(()=>{const c=document.querySelector('div.bg-white.rounded-2xl.border');const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').trim()==='U 级');return !!(c&&b);})()`);if(ready)break;await sleep(500);}
await ev(`(()=>{const d=document.querySelector('.dyp'); if(d) d.remove(); return 'ok';})()`);
await sleep(300);
const reset=async()=>{await ev(clickWaitExpr('U 级',200));await sleep(150);await ev(clickWaitExpr('全部评级',500));await sleep(400);};
// B → U
await reset(); await ev(clickWaitExpr('B 级',600)); console.log('B 级基线:', await ev(STATE));
const b2u=await ev(clickWaitExpr('U 级',700)); console.log('B级→U:', b2u);
// S → U
await reset(); await ev(clickWaitExpr('S 级',600)); console.log('S 级基线:', await ev(STATE));
const s2u=await ev(clickWaitExpr('U 级',700)); console.log('S级→U:', s2u);
// U 激活后再点 U 取消 → 回到全部(173)
await reset(); await ev(clickWaitExpr('U 级',600)); console.log('U 激活:', await ev(STATE));
const off=await ev(clickWaitExpr('U 级',600)); console.log('U 取消→全部:', off);
// 普通 A 级过滤仍正常
await reset(); const a=await ev(clickWaitExpr('A 级',600)); console.log('A 级过滤:', a, '| samsung应false:', (()=>{try{return JSON.parse(a).samsung===false;}catch(e){return 'err';}})());

const p1=!!b2u&&JSON.parse(b2u).visible>=2&&JSON.parse(b2u).samsung===true;
const p2=!!s2u&&JSON.parse(s2u).visible>=2&&JSON.parse(s2u).samsung===true;
const p3=!!off&&JSON.parse(off).visible>=170;
const p4=!!a&&JSON.parse(a).visible>0&&JSON.parse(a).samsung===false;
console.log('\\n=== 边界结论 ===');
console.log('B→U:', p1?'PASS':'FAIL');
console.log('S→U:', p2?'PASS':'FAIL');
console.log('U取消→全部:', p3?'PASS':'FAIL');
console.log('普通A过滤:', p4?'PASS':'FAIL');
console.log('总体:', (p1&&p2&&p3&&p4)?'ALL PASS':'HAS FAIL');
ws.close();edge.kill();server.close();
try{fs.rmSync(path.join(__dirname,'edgeprof-gu2'),{recursive:true,force:true});}catch(e){}
process.exit((p1&&p2&&p3&&p4)?0:1);
})().catch(e=>{console.error('ERR',e);process.exit(1);});
