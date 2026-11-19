// 【本机专用 · 不挂 CI】SW 旧缓存自愈实证（2026-11-19）
// 用户场景：浏览器里已激活旧 SW（sxg-static-v1，缓存着旧 ua-guard.js），
//          线上部署了新版（sw.js?v=2 + STATIC_CACHE v2 + ua-guard v10）。
//          验证：用户不清缓存、只刷新，能否靠 skipWaiting/activate清缓存/
//          controllerchange reload 自动拿到新脚本、弹出国产提示条。
// 手法：本地静态服务对 /sw.js 返回「旧版」（CACHE v1），先访问让它激活并缓存；
//      再把服务切到「新版」（CACHE v2 + 注册 ?v=2），重新导航，观察自愈。
const { cacheRoot, cacheDir } = require('./_cache-dir.cjs');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const ROOT = path.resolve(__dirname, '..');
const HTTP_PORT = 8752, DBG_PORT = 9252;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const URL = `http://127.0.0.1:${HTTP_PORT}/index.html`;
const MIME = { '.html':'text/html','.js':'application/javascript','.css':'text/css',
  '.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon',
  '.jpg':'image/jpeg','.jpeg':'image/jpeg','.enc':'application/octet-stream' };

const NEW_SW = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
// 旧版 sw.js：把缓存名换回 v1（其余一致），模拟用户浏览器里的旧 SW
const OLD_SW = NEW_SW.replace(/sxg-static-v2/g, 'sxg-static-v1').replace(/sxg-nav-v2/g, 'sxg-nav-v1');
let serveOldSw = true; // 第一阶段返回旧 SW

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  if (p === '/sw.js') {
    res.writeHead(200, { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-store' });
    return res.end(serveOldSw ? OLD_SW : NEW_SW);
  }
  // index.html 第一阶段的 SW 注册路径是 ./sw.js（无参数），第二阶段改成 ?v=2
  const fp = path.join(ROOT, p);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
    res.writeHead(404); return res.end('nf');
  }
  let body = fs.readFileSync(fp, 'utf8');
  if (serveOldSw && p === '/index.html') {
    body = body.replace("./sw.js?v=2", "./sw.js");
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'text/plain' });
  res.end(body);
});

function wsConnect(url) { return new Promise((res, rej) => {
  const ws = new WebSocket(url);
  ws.addEventListener('open', () => res(ws));
  ws.addEventListener('error', () => rej(new Error('ws ' + url)));
}); }
let msgId = 0;
function cdp(ws, method, params = {}) { return new Promise((resolve, reject) => {
  const id = ++msgId;
  const h = (ev) => { let m; try { m = JSON.parse(ev.data); } catch(e){return;}
    if (m.id === id) { ws.removeEventListener('message', h); resolve(m); } };
  ws.addEventListener('message', h);
  try { ws.send(JSON.stringify({ id, method, params })); } catch(e) { reject(e); }
}); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const evalExpr = (ws, expr) => cdp(ws, 'Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  .then(r => r.result && r.result.result ? r.result.result.value : null);

(async () => {
  await new Promise(r => server.listen(HTTP_PORT, r));
  const edge = spawn(EDGE, [
    '--headless=new', `--remote-debugging-port=${DBG_PORT}`,
    '--user-data-dir=' + path.join(cacheRoot(), 'edge-profiles/sw-selfheal'),
    '--no-proxy-server', '--disable-gpu', 'about:blank'
  ], { stdio:'ignore' });
  let targets;
  for (let i=0;i<30;i++){ try{ targets = await new Promise((res,rej)=>{
    http.get(`http://127.0.0.1:${DBG_PORT}/json/list`, r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)));}).on('error',rej);
  }); break; }catch(e){ await sleep(500);} }
  const t = (targets||[]).find(t=>t.type==='page'&&t.webSocketDebuggerUrl);
  if(!t){console.error('NO TARGET');process.exit(1);}
  const ws = await wsConnect(t.webSocketDebuggerUrl);
  await cdp(ws,'Page.enable'); await cdp(ws,'Runtime.enable');
  await cdp(ws,'Network.setUserAgentOverride',{ userAgent:
    'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36/13.0.10000.0' });

  // 阶段1：旧 SW 激活 + 缓存旧脚本（模拟用户现状）
  console.log('=== 阶段1：装旧 SW(v1) 并缓存旧脚本 ===');
  await cdp(ws,'Page.navigate',{url:URL+'?stage=1'});
  await sleep(2500);
  const stage1 = await evalExpr(ws, `(async function(){
    var ctrl = !!(navigator.serviceWorker && navigator.serviceWorker.controller);
    var reg = navigator.serviceWorker ? await navigator.serviceWorker.getRegistration() : null;
    var scriptUrl = reg && reg.active ? reg.active.scriptURL : null;
    var caches1 = await caches.keys();
    return { ctrl:ctrl, scriptUrl:scriptUrl, caches:caches1 };
  })()`);
  console.log('  旧SW状态:', JSON.stringify(stage1));

  // 阶段2：切到新版（服务返回新 SW + index.html 注册 ./sw.js?v=2），模拟部署
  console.log('\n=== 阶段2：部署新版，用户仅刷新（不清缓存）===');
  serveOldSw = false;
  await cdp(ws,'Page.navigate',{url:URL+'?stage=2'});
  await sleep(3500); // 等 install→skipWaiting→activate→controllerchange reload
  const stage2 = await evalExpr(ws, `(async function(){
    var n=document.getElementById('sxg-browser-notice');
    var reg = navigator.serviceWorker ? await navigator.serviceWorker.getRegistration() : null;
    var scriptUrl = reg && reg.active ? reg.active.scriptURL : null;
    return {
      notice: !!n,
      scriptUrl: scriptUrl,
      caches: await caches.keys(),
      reloaded: sessionStorage.getItem('sxg-sw-reloaded')
    };
  })()`);
  console.log('  自愈后状态:', JSON.stringify(stage2));
  const selfHealed = stage2.notice && /sw\.js\?v=2/.test(stage2.scriptUrl||'')
    && (stage2.caches||[]).some(k=>/v2/.test(k)) && !(stage2.caches||[]).some(k=>/v1/.test(k));
  console.log('\n' + '='.repeat(52));
  console.log(selfHealed ? '✓ 自愈成功：旧 SW 自动被新 SW 替换，提示条弹出，旧缓存已清' : '✗ 自愈失败');
  try{ws.close();}catch(e){}
  edge.kill('SIGTERM'); server.close();
  process.exit(selfHealed?0:1);
})().catch(e=>{console.error('ERR',e);process.exit(1);});
