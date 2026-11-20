// 【本机专用 · 不挂 CI】长城卡登记框 + 视频区置顶真渲染验收（2026-11-20）
// 验证：① 长城卡有界面新闻视频登记框（书面化、只链站内）；② 点「视频」按钮弹窗第一条
//       是余淼杰「不守双休就降信用」；③ 无 JS 异常。产物落 D:/WorkBuddy-Cache/shots/
const { cacheRoot, cacheDir } = require('./_cache-dir.cjs');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const ROOT = path.resolve(__dirname, '..');
const HTTP_PORT = 8766;
const DBG_PORT = 9266;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = `http://127.0.0.1:${HTTP_PORT}`;
const MIME = { '.html':'text/html; charset=utf-8', '.js':'application/javascript', '.css':'text/css',
  '.json':'application/json', '.png':'image/png', '.svg':'image/svg+xml', '.ico':'image/x-icon',
  '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.enc':'application/octet-stream' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const fp = path.join(ROOT, p);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'text/plain' });
  fs.createReadStream(fp).pipe(res);
});
function wsConnect(url) { return new Promise((resolve,reject)=>{ const ws=new WebSocket(url); ws.addEventListener('open',()=>resolve(ws)); ws.addEventListener('error',()=>reject(new Error('ws '+url))); }); }
let msgId=0;
function cdp(ws,method,params={}) { return new Promise((resolve,reject)=>{ const id=++msgId; const h=(ev)=>{ let m; try{m=JSON.parse(ev.data);}catch(e){return;} if(m.id===id){ws.removeEventListener('message',h); if(m.error)console.error('CDP_ERR',method,JSON.stringify(m.error)); resolve(m);} }; ws.addEventListener('message',h); try{ws.send(JSON.stringify({id,method,params}));}catch(e){reject(e);} }); }
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const evalExpr=(ws,expr)=>cdp(ws,'Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true}).then(r=>r.result&&r.result.result?r.result.result.value:null);

(async () => {
  await new Promise(r=>server.listen(HTTP_PORT,r));
  const shotsDir=cacheDir('shots'); fs.mkdirSync(shotsDir,{recursive:true});
  const edge=spawn(EDGE,['--headless=new',`--remote-debugging-port=${DBG_PORT}`,'--user-data-dir='+path.join(cacheRoot(),'edge-profiles/gwm-video'),'--no-proxy-server','--disable-gpu','about:blank'],{stdio:'ignore'});
  let targets;
  for(let i=0;i<30;i++){ try{ targets=await new Promise((res,rej)=>{http.get(`http://127.0.0.1:${DBG_PORT}/json/list`,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)));}).on('error',rej);}); break;}catch(e){await sleep(500);} }
  const pt=(targets||[]).find(t=>t.type==='page'&&t.webSocketDebuggerUrl)||(targets||[]).find(t=>t.webSocketDebuggerUrl);
  if(!pt){console.error('NO TARGET');process.exit(1);}
  const ws=await wsConnect(pt.webSocketDebuggerUrl);
  const errors=[]; ws.addEventListener('message',ev=>{try{const m=JSON.parse(ev.data);if(m.method==='Runtime.exceptionThrown')errors.push(JSON.stringify(m.params.exceptionDetails).slice(0,180));}catch(e){}});
  await cdp(ws,'Page.enable'); await cdp(ws,'Runtime.enable');
  await cdp(ws,'Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false,screenWidth:1440,screenHeight:900});
  await cdp(ws,'Page.navigate',{url:BASE+'/index.html'});
  await sleep(6500); // 等 bundle + 注入脚本 + MutationObserver 全部跑完
  await evalExpr(ws,`var s=document.createElement('style');s.textContent='.dyp{display:none!important}';document.head.appendChild(s);`);

  // 1. 长城卡登记框
  const gwm = await evalExpr(ws, `(function(){
    var card=null; [].slice.call(document.querySelectorAll('h2,h3')).forEach(function(h){if(/^长城汽车/.test(h.textContent.trim())){var c=h;while(c&&c!==document.body){if(c.classList&&c.classList.contains('bg-white')&&c.classList.contains('rounded-2xl')&&c.classList.contains('border')){card=c;break;}c=c.parentElement;}}});
    if(!card) return {found:false};
    var box=card.querySelector('[data-sxg-news="gwm-douyin"]');
    var anchors=box?[].slice.call(box.querySelectorAll('a')).map(function(a){return a.getAttribute('href');}):[];
    return {
      found:true,
      boxCount:card.querySelectorAll('[data-sxg-news="gwm-douyin"]').length,
      text:box?box.innerText.slice(0,160):null,
      anchors:anchors,
      noExternal:anchors.every(function(h){return h && h.indexOf('./')===0;})
    };
  })()`);

  // 2. 视频弹窗：点按钮打开，读第一条
  await evalExpr(ws,`(function(){var b=document.getElementById('sxg-video-btn');if(b)b.click();})()`);
  await sleep(600);
  const video = await evalExpr(ws, `(function(){
    var modal=document.getElementById('sxg-video-modal');
    if(!modal) return {found:false};
    var items=modal.querySelectorAll('.sxg-vd-item');
    var first=items[0];
    return {
      found:true, hidden:modal.hidden, itemCount:items.length,
      firstTitle:first?first.querySelector('.sxg-vd-name').innerText:null,
      firstSub:first?first.querySelector('.sxg-vd-sub').innerText:null,
      firstHref:first?first.querySelector('.sxg-vd-open').getAttribute('href'):null
    };
  })()`);

  // 截图：视频弹窗（置顶第一条）
  const shotModal=path.join(shotsDir,'gwm-video-modal.png');
  const rM=await cdp(ws,'Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(shotModal,Buffer.from(rM.result.data,'base64'));

  // 关弹窗、滚到长城卡截图
  await evalExpr(ws,`(function(){var m=document.getElementById('sxg-video-modal');if(m){var o=m.querySelector('.sxg-vd-ok');if(o)o.click();}})()`);
  await sleep(300);
  const shotGwm=path.join(shotsDir,'gwm-card-box.png');
  const rG=await cdp(ws,'Page.captureScreenshot',{format:'png',captureBeyondViewport:true});
  fs.writeFileSync(shotGwm,Buffer.from(rG.result.data,'base64'));

  console.log(JSON.stringify({gwm,video,jsErrors:errors},null,2));
  server.close(); edge.kill(); process.exit(0);
})().catch(e=>{console.error('FATAL',e);server.close();process.exit(1);});
