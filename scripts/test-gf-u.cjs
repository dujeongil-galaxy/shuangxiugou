// 真渲染复现：U 级过滤按钮在多条切换路径下的可见性（修正版 v2）
// 关键：按钮文案以 JSON 字符串字面量内嵌进 IIFE，避免箭头函数立即调用解析歧义
const http=require('http'),fs=require('fs'),path=require('path'),{spawn}=require('child_process');
const PORT=19481,DBG=19581,ROOT=path.resolve(__dirname,'..'),EDGE='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const server=http.createServer((req,res)=>{let p=path.join(ROOT,decodeURIComponent(req.url.split('?')[0]));if(p.endsWith('/')||p.endsWith('\\'))p=path.join(p,'index.html');fs.readFile(p,(e,d)=>{if(e){res.writeHead(404);res.end('nf');return;}const ext=path.extname(p);const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css'}[ext]||'application/octet-stream';res.writeHead(200,{'Content-Type':mime+'; charset=utf-8'});res.end(d);});});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
// 构造：点击文案为 TXT 的按钮，等待 MS 毫秒，返回 {visible,samsung,acer}
function clickWaitExpr(txt, ms){
  const t=JSON.stringify(txt);
  return `(()=>{const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').trim()===${t}); if(!b) return JSON.stringify({err:'NOTFOUND:'+${t}}); b.click(); return new Promise(r=>setTimeout(()=>{let n=0; const cs=document.querySelectorAll('div.bg-white.rounded-2xl.border'); const vis={}; for(const c of cs){const h=c.querySelector('h2,h3'); if(!h) continue; const st=getComputedStyle(c); if(st.display!=='none'&&c.offsetParent!==null){n++; const tx=(h.textContent||''); if(tx.includes('三星'))vis.samsung=true; if(tx.includes('宏碁'))vis.acer=true;}} r(JSON.stringify({visible:n, samsung:!!vis.samsung, acer:!!vis.acer}));}, ${ms}));})()`;
}
const STATE=`(()=>{let n=0; const cs=document.querySelectorAll('div.bg-white.rounded-2xl.border'); const vis={}; for(const c of cs){const h=c.querySelector('h2,h3'); if(!h) continue; const st=getComputedStyle(c); if(st.display!=='none'&&c.offsetParent!==null){n++; const tx=(h.textContent||''); if(tx.includes('三星'))vis.samsung=true; if(tx.includes('宏碁'))vis.acer=true;}} return JSON.stringify({visible:n, samsung:!!vis.samsung, acer:!!vis.acer});})()`;
(async()=>{
await new Promise(r=>server.listen(PORT,r));
const edge=spawn(EDGE,['--headless=new','--disk-cache-size=1',`--remote-debugging-port=${DBG}`,'--no-first-run','--window-size=1280,900','--user-data-dir='+path.join(__dirname,'edgeprof-gfu'+Date.now()),`http://127.0.0.1:${PORT}/?nocache=${Date.now()}`],{stdio:'ignore'});
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
console.log('reset→全部评级:', await ev(clickWaitExpr('全部评级',600)));
console.log('全部评级基线:', await ev(STATE));

// 路径①：全部 → U
const r1=await ev(clickWaitExpr('U 级',600));
console.log('路径① 全部→U:', r1);

// 取消 U，回全部
await ev(clickWaitExpr('U 级',300)); await sleep(200);
await ev(clickWaitExpr('全部评级',600));

// 路径②：A 级 → U
console.log('先点 A 级:', await ev(clickWaitExpr('A 级',600)));
console.log('A 级后基线:', await ev(STATE));
const r2=await ev(clickWaitExpr('U 级',700));
console.log('路径② A级→U:', r2);

// 取消 U，回全部
await ev(clickWaitExpr('U 级',300)); await sleep(200);
await ev(clickWaitExpr('全部评级',600));

// 路径③：搜三星 + 全部 → U
await ev(`(()=>{const inp=document.getElementById('site-search-input'); if(!inp) return 'no-input'; inp.value='三星'; inp.dispatchEvent(new Event('input',{bubbles:true})); return 'ok';})()`);
await sleep(700);
console.log('搜三星基线:', await ev(STATE));
const r3=await ev(clickWaitExpr('U 级',700));
console.log('路径③ 搜三星+全部→U:', r3);

const p1=!!r1&&JSON.parse(r1).visible>=2&&JSON.parse(r1).samsung===true;
const p2=!!r2&&JSON.parse(r2).visible>=2&&JSON.parse(r2).samsung===true;
const p3=!!r3&&JSON.parse(r3).visible>=1&&JSON.parse(r3).samsung===true;
console.log('\\n=== 结论 ===');
console.log('路径① 全部→U :', p1?'PASS':'FAIL');
console.log('路径② A级→U  :', p2?'PASS':'FAIL  ← 用户报的 bug');
console.log('路径③ 搜三星→U:', p3?'PASS':'FAIL  ← 用户报的 bug');
console.log('总体:', (p1&&p2&&p3)?'ALL PASS':'HAS FAIL');
ws.close();edge.kill();server.close();
try{fs.rmSync(path.join(__dirname,'edgeprof-gfu'),{recursive:true,force:true});}catch(e){}
process.exit((p1&&p2&&p3)?0:1);
})().catch(e=>{console.error('ERR',e);process.exit(1);});
