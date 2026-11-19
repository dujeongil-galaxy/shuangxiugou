// 【本机专用 · 不挂 CI】问界消歧义 + 搜「华为汽车」真渲染验收（2026-11-20）
// 验证：① 华为终端卡/问界卡各有踏板支架备注框；② 搜「华为汽车」问界卡仍可见；
//       ③ 拼音联想能出问界；④ 无 JS 异常。产物落 D:/WorkBuddy-Cache/shots/
const { cacheRoot, cacheDir } = require('./_cache-dir.cjs');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const ROOT = path.resolve(__dirname, '..');
const HTTP_PORT = 8765;
const DBG_PORT = 9265;
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
  const edge=spawn(EDGE,['--headless=new',`--remote-debugging-port=${DBG_PORT}`,'--user-data-dir='+path.join(cacheRoot(),'edge-profiles/wenjie-search'),'--no-proxy-server','--disable-gpu','about:blank'],{stdio:'ignore'});
  let targets;
  for(let i=0;i<30;i++){ try{ targets=await new Promise((res,rej)=>{http.get(`http://127.0.0.1:${DBG_PORT}/json/list`,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)));}).on('error',rej);}); break;}catch(e){await sleep(500);} }
  const pt=(targets||[]).find(t=>t.type==='page'&&t.webSocketDebuggerUrl)||(targets||[]).find(t=>t.webSocketDebuggerUrl);
  if(!pt){console.error('NO TARGET');process.exit(1);}
  const ws=await wsConnect(pt.webSocketDebuggerUrl);
  const errors=[]; ws.addEventListener('message',ev=>{try{const m=JSON.parse(ev.data);if(m.method==='Runtime.exceptionThrown')errors.push(JSON.stringify(m.params.exceptionDetails).slice(0,180));}catch(e){}});
  await cdp(ws,'Page.enable'); await cdp(ws,'Runtime.enable');
  await cdp(ws,'Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false,screenWidth:1440,screenHeight:900});
  await cdp(ws,'Page.navigate',{url:BASE+'/index.html'});
  await sleep(6000); // 等 bundle + 注入脚本 + MutationObserver 全部跑完
  await evalExpr(ws,`var s=document.createElement('style');s.textContent='.dyp{display:none!important}';document.head.appendChild(s);`);

  // 1. 两张卡的备注框（先清空搜索确保全量渲染）
  const boxes = await evalExpr(ws, `(function(){
    function findCard(id){var e=document.getElementById(id);return e;}
    var hwCard=null; [].slice.call(document.querySelectorAll('h2,h3')).forEach(function(h){if(/^华为终端/.test(h.textContent.trim())){var c=h;while(c&&c!==document.body){if(c.classList&&c.classList.contains('bg-white')&&c.classList.contains('rounded-2xl')&&c.classList.contains('border')){hwCard=c;break;}c=c.parentElement;}}});
    var wj=findCard('wenjie-card');
    return {
      huaweiBox: hwCard?hwCard.querySelectorAll('[data-sxg-news]').length:-1,
      huaweiText: hwCard&&hwCard.querySelector('[data-sxg-news]')?hwCard.querySelector('[data-sxg-news]').innerText.slice(0,90):null,
      wenjieBox: wj?wj.querySelectorAll('[data-sxg-news]').length:-1,
      wenjieText: wj&&wj.querySelector('[data-sxg-news]')?wj.querySelector('[data-sxg-news]').innerText.slice(0,90):null
    };
  })()`);

  // 2. 搜「华为汽车」后问界卡是否可见
  const search = await evalExpr(ws, `(function(){
    var inp=document.getElementById('site-search-input');
    if(!inp) return {error:'no input'};
    inp.value='华为汽车';
    inp.dispatchEvent(new Event('input',{bubbles:true}));
    return {value:inp.value};
  })()`);
  await sleep(1600);
  const afterSearch = await evalExpr(ws, `(function(){
    var wj=document.getElementById('wenjie-card');
    var inp=document.getElementById('site-search-input');
    // 统计可见卡片标题
    var vis=[]; [].slice.call(document.querySelectorAll('h3')).forEach(function(h){
      var c=h; while(c&&c!==document.body){ if(c.style&&c.style.display==='none') return; if(c.classList&&c.classList.contains('bg-white')&&c.classList.contains('rounded-2xl')){break;} c=c.parentElement;}
      if(c&&c!==document.body) vis.push(h.textContent.trim().slice(0,20));
    });
    return {
      wenjieVisible: wj ? (wj.style.display!=='none') : null,
      wenjieBoxStillThere: wj ? wj.querySelectorAll('[data-sxg-news]').length : null,
      visibleTitles: vis.slice(0,12),
      suggestExists: !!document.getElementById('pinyin-suggest'),
      suggestText: (document.getElementById('pinyin-suggest')||{}).innerText ? document.getElementById('pinyin-suggest').innerText.slice(0,120):null
    };
  })()`);
  // 滚动到问界卡截图
  await evalExpr(ws,`(function(){var w=document.getElementById(wenjie-card);if(w)w.scrollIntoView({block:center});})()`);
  await sleep(400);
  const shot=path.join(shotsDir,'wenjie-search.png');
  const r=await cdp(ws,'Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(shot,Buffer.from(r.result.data,'base64'));

  // 3. 拼音联想「hwqc」
  await evalExpr(ws,`(function(){var i=document.getElementById('site-search-input');i.value='hwqc';i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await sleep(900);
  const suggest = await evalExpr(ws,`(function(){var s=document.getElementById('pinyin-suggest');return {exists:!!s,text:s?s.innerText.slice(0,200):null};})()`);

  console.log(JSON.stringify({boxes,search,afterSearch,suggest,shot,errors},null,2));
  ws.close(); edge.kill(); server.close(); process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
