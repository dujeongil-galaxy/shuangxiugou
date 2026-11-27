// 【本机专用 · 不挂 CI】诊断手机端 dock 滚动错位：模拟下滑/上滑 + 视口收放（写死本机 Edge 路径）
// 诊断手机端 dock 滚动后错位：模拟 下滑→上滑 序列
// 复制 cdp-pdl-adcheck.cjs 的启动/取 target 段，保证与已验证能加载首页的脚本一致。
const { cacheRoot } = require('./_cache-dir.cjs');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const HTTP_PORT = 8815, DBG_PORT = 9305;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const URL = `http://127.0.0.1:${HTTP_PORT}/`;
const MIME = { '.html':'text/html','.js':'application/javascript','.css':'text/css',
  '.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon' };
const server = http.createServer((req,res)=>{
  let p=decodeURIComponent(req.url.split('?')[0]); if(p==='/')p='/index.html';
  const fp=path.join(ROOT,p);
  if(!fp.startsWith(ROOT)||!fs.existsSync(fp)||fs.statSync(fp).isDirectory()){res.writeHead(404);return res.end('nf');}
  res.writeHead(200,{'Content-Type':MIME[path.extname(fp)]||'text/plain'});
  fs.createReadStream(fp).pipe(res);
});
function wsConnect(url){return new Promise((resolve,reject)=>{
  const ws=new WebSocket(url); ws.addEventListener('open',()=>resolve(ws));
  ws.addEventListener('error',()=>reject(new Error('ws err '+url)));
});}
let msgId=0;
function cdp(ws,method,params={}){return new Promise((resolve,reject)=>{
  const id=++msgId; const handler=(ev)=>{let m;try{m=JSON.parse(ev.data);}catch(e){return;}
    if(m.id===id){ws.removeEventListener('message',handler);resolve(m);}};
  ws.addEventListener('message',handler);
  try{ws.send(JSON.stringify({id,method,params}));}catch(e){reject(e);}
});}
async function evalVal(ws,expression){
  const r=await cdp(ws,'Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
  if(!r)return null;
  if(r.result&&r.result.exceptionDetails)return {ERR:JSON.stringify(r.result.exceptionDetails).slice(0,300)};
  const inner=(r.result&&r.result.result!==undefined)?r.result.result:r.result;
  return inner?inner.value:null;
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const PROBE=`(function(){
  var d=document.getElementById('sxg-fab-dock');
  if(!d)return {noDock:true};
  var cs=getComputedStyle(d),r=d.getBoundingClientRect(),vv=window.visualViewport;
  return {
    scrollY:Math.round(window.scrollY),innerH:window.innerHeight,
    vvTop:vv?Math.round(vv.offsetTop):null,vvH:vv?Math.round(vv.height):null,
    docH:document.documentElement.scrollHeight,
    pos:cs.position,top:cs.top,transform:cs.transform,bottom:cs.bottom,
    cssTop:getComputedStyle(document.documentElement).getPropertyValue("--sxg-dock-top"),
    cssBtnH:getComputedStyle(document.documentElement).getPropertyValue("--sxg-dock-btn-h"),
    rectTop:Math.round(r.top),rectBottom:Math.round(r.bottom),rectH:Math.round(r.height),
    children:d.children.length,
    bodyTransform:getComputedStyle(document.body).transform,
    htmlTransform:getComputedStyle(document.documentElement).transform
  };})()`;
(async()=>{
  await new Promise(r=>server.listen(HTTP_PORT,r));
  const edge=spawn(EDGE,[
    '--headless=new',`--remote-debugging-port=${DBG_PORT}`,
    '--user-data-dir='+path.join(cacheRoot(),'.edge-dock-diag-'+Date.now()),
    '--no-proxy-server','--disable-gpu','about:blank'
  ],{stdio:'ignore'});
  for(let i=0;i<30;i++){
    try{await new Promise((res,rej)=>{http.get(`http://127.0.0.1:${DBG_PORT}/json/version`,r=>{
      let d='';r.on('data',c=>d+=c);r.on('end',()=>res(d));}).on('error',rej);});break;
    }catch(e){await sleep(500);}
  }
  let targets;
  for(let i=0;i<30;i++){
    try{targets=await new Promise((res,rej)=>{http.get(`http://127.0.0.1:${DBG_PORT}/json/list`,r=>{
      let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)));}).on('error',rej);});break;
    }catch(e){await sleep(500);}
  }
  const page=targets.find(t=>t.type==='page'&&t.webSocketDebuggerUrl)||targets.find(t=>t.webSocketDebuggerUrl);
  const ws=await wsConnect(page.webSocketDebuggerUrl);
  const errors=[];
  ws.addEventListener('message',ev=>{try{const m=JSON.parse(ev.data);
    if(m.method==='Runtime.exceptionThrown')errors.push(JSON.stringify(m.params.exceptionDetails).slice(0,200));}catch(e){}});
  await cdp(ws,'Page.enable'); await cdp(ws,'Runtime.enable');
  await cdp(ws,'Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await cdp(ws,'Page.navigate',{url:URL});
  await sleep(16000);
  console.log('ENV='+JSON.stringify(await evalVal(ws,`(function(){return {
    href:location.href,ready:document.readyState,width:window.innerWidth,
    dockExists:!!document.getElementById('sxg-fab-dock'),
    bodyChildren:document.body?document.body.children.length:0};})()`)));
  console.log('ERRS='+JSON.stringify(errors.slice(0,3)));
  await evalVal(ws,"document.querySelectorAll('.dyp,[role=dialog],[class*=overlay]').forEach(function(n){n.style.display='none';});");
  console.log('0='+JSON.stringify(await evalVal(ws,PROBE)));
  var sh0=await cdp(ws,'Page.captureScreenshot',{format:'png',fromSurface:true}); if(sh0&&sh0.result&&sh0.result.data)fs.writeFileSync('D:/WorkBuddy-Cache/shots/dock-fix-844.png',Buffer.from(sh0.result.data,'base64'));
  await evalVal(ws,`window.scrollTo(0,document.documentElement.scrollHeight)`); await sleep(1000);
  console.log('1-bottom='+JSON.stringify(await evalVal(ws,PROBE)));
  await evalVal(ws,`window.scrollTo(0,0)`); await sleep(1000);
  console.log('2-top='+JSON.stringify(await evalVal(ws,PROBE)));
  await evalVal(ws,`window.scrollTo(0,500)`); await sleep(1000);
  console.log('3-500='+JSON.stringify(await evalVal(ws,PROBE)));

  // 模拟真机地址栏展开：可视高从 844 掉到 600（地址栏占 244px）
  await cdp(ws,'Emulation.setDeviceMetricsOverride',{width:390,height:600,deviceScaleFactor:1,mobile:true});
  await sleep(1200);
  console.log('4-vh600='+JSON.stringify(await evalVal(ws,PROBE)));
  var sh4=await cdp(ws,'Page.captureScreenshot',{format:'png',fromSurface:true}); if(sh4&&sh4.result&&sh4.result.data)fs.writeFileSync('D:/WorkBuddy-Cache/shots/dock-fix-600.png',Buffer.from(sh4.result.data,'base64'));
  // 模拟 vv.offsetTop 变化（地址栏收起时 visualViewport 顶部偏移）
  await evalVal(ws,`window.__vvBase=window.visualViewport.height`);
  // 模拟地址栏收起回到高视口
  await cdp(ws,'Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await sleep(1200);
  console.log('5-vh844-back='+JSON.stringify(await evalVal(ws,PROBE)));
  try{ws.close();}catch(e){} edge.kill('SIGKILL'); server.close(); process.exit(0);
})().catch(e=>{console.error('FATAL',e);process.exit(1);});
