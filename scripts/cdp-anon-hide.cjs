// 【本机专用 · 不挂 CI】真渲染验收：匿名邮箱入口是否已隐藏（2026-11-12 §36s 隐藏）
// 本地起静态服务 + 无头 Edge CDP，在手机(390)与桌面(1440)两种视口下：
//   1) #sxg-anon-mail-btn 仍存在于 DOM（代码未删除）
//   2) getComputedStyle(display)==='none' 且 offsetParent===null（不可见、不占布局）
//   3) 截顶栏区域图，肉眼复核相邻按钮已闭合、无空洞
// 产物落 D:/WorkBuddy-Cache/shots/anon-*.png
const { cacheRoot, cacheDir } = require('./_cache-dir.cjs');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const ROOT = path.resolve(__dirname, '..');
const HTTP_PORT = 8735;          // 静态服务端口（与调试端口分离）
const DBG_PORT = 9235;           // CDP 远程调试端口
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const URL = `http://127.0.0.1:${HTTP_PORT}/`;

const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css',
  '.json':'application/json', '.png':'image/png', '.svg':'image/svg+xml', '.ico':'image/x-icon',
  '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.enc':'application/octet-stream' };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const fp = path.join(ROOT, p);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
    res.writeHead(404); return res.end('nf');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'text/plain' });
  fs.createReadStream(fp).pipe(res);
});

function wsConnect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.addEventListener('open', () => resolve(ws));
    ws.addEventListener('error', () => reject(new Error('ws connect error ' + url)));
  });
}
let msgId = 0;
function cdp(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    const handler = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.id === id) {
        ws.removeEventListener('message', handler);
        if (m.error) console.error('CDP_ERR', method, JSON.stringify(m.error));
        resolve(m);
      }
    };
    ws.addEventListener('message', handler);
    try { ws.send(JSON.stringify({ id, method, params })); } catch (e) { reject(e); }
  });
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  await new Promise((r) => server.listen(HTTP_PORT, r));
  const edge = spawn(EDGE, [
    '--headless=new', `--remote-debugging-port=${DBG_PORT}`,
    '--user-data-dir=' + path.join(cacheRoot(), '.edge-anon-hide'),
    '--no-proxy-server', '--disable-gpu', 'about:blank'
  ], { stdio: 'ignore' });

  let ver;
  for (let i = 0; i < 30; i++) {
    try {
      ver = await new Promise((res, rej) => {
        http.get(`http://127.0.0.1:${DBG_PORT}/json/version`, (r) => {
          let d=''; r.on('data', c => d+=c); r.on('end', () => res(JSON.parse(d)));
        }).on('error', rej);
      }); break;
    } catch (e) { await sleep(500); }
  }
  let targets;
  for (let i = 0; i < 30; i++) {
    try {
      targets = await new Promise((res, rej) => {
        http.get(`http://127.0.0.1:${DBG_PORT}/json/list`, (r) => {
          let d=''; r.on('data', c => d+=c); r.on('end', () => res(JSON.parse(d)));
        }).on('error', rej);
      }); break;
    } catch (e) { await sleep(500); }
  }
  const pageTarget = (targets || []).find(t => t.type === 'page' && t.webSocketDebuggerUrl)
    || (targets || []).find(t => t.webSocketDebuggerUrl);
  if (!pageTarget) { console.error('NO PAGE TARGET'); process.exit(1); }
  const ws = await wsConnect(pageTarget.webSocketDebuggerUrl);
  const errors = [];
  ws.addEventListener('message', (ev) => {
    try { const m = JSON.parse(ev.data);
      if (m.method === 'Runtime.exceptionThrown') errors.push(JSON.stringify(m.params.exceptionDetails));
    } catch (e) {}
  });
  await cdp(ws, 'Page.enable');
  await cdp(ws, 'Runtime.enable');
  await cdp(ws, 'Page.navigate', { url: URL });
  await sleep(10000); // 等 bundle + 补丁 triple-fallback + 广告延迟淡入(6000ms)

  // 仅隐藏抖音弹窗（.dyp），不影响本验收
  await cdp(ws, 'Runtime.evaluate', { expression:
    `var s=document.createElement('style');s.textContent='.dyp{display:none!important}';document.head.appendChild(s);` });

  const viewports = [
    { name: 'mobile', w: 390, h: 844, mobile: true, shot: 'shots/anon-mobile.png' },
    { name: 'desktop', w: 1440, h: 900, mobile: false, shot: 'shots/anon-desktop.png' },
  ];

  let allPass = true;
  for (const vp of viewports) {
    await cdp(ws, 'Emulation.setDeviceMetricsOverride', {
      width: vp.w, height: vp.h, deviceScaleFactor: 1, mobile: vp.mobile,
      screenWidth: vp.w, screenHeight: vp.h
    });
    await sleep(1500);

    const info = await cdp(ws, 'Runtime.evaluate', { expression: `JSON.stringify((function(){
      try{
      var b=document.getElementById('sxg-anon-mail-btn');
      if(!b) return {present:false};
      var cs=getComputedStyle(b);
      var hdr=document.getElementById('hdr')||(b.closest?b.closest('header'):null)||null;
      var visHeaderBtns=0;
      if(hdr){
        hdr.querySelectorAll('a,button').forEach(function(el){
          if(getComputedStyle(el).display!=='none' && el.offsetParent!==null) visHeaderBtns++;
        });
      }
      return {
        present:true,
        display:cs.display,
        offsetParentNull:b.offsetParent===null,
        hiddenAttr:b.getAttribute('data-sxg-anon-hidden'),
        href:b.getAttribute('href'),
        slot:b.getAttribute('data-sxg-anon-slot'),
        visibleHeaderButtons:visHeaderBtns
      };
      }catch(e){return {error:String(e), stack:(e&&e.stack)||''};}
    })())`, returnByValue: true });
    let r = null;
    try { r = JSON.parse((info.result && (info.result.result || info.result).value) || 'null'); } catch (e) {}
    console.log(`[${vp.name}] ANON=` + JSON.stringify(r));
    const pass = r && r.present && r.display === 'none' && r.offsetParentNull === true;
    if (!pass) allPass = false;
    console.log(`[${vp.name}] HIDDEN_OK=${pass}`);

    try {
      const shot = await cdp(ws, 'Page.captureScreenshot', {
        format: 'png', fromSurface: true, captureBeyondViewport: false,
        clip: { x: 0, y: 0, width: vp.w, height: vp.h, scale: 1 }
      });
      if (shot.result && shot.result.data) {
        const out = cacheDir(vp.shot);
        fs.writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
        console.log(`[${vp.name}] SHOT=${out}`);
      }
    } catch (e) { console.log(`[${vp.name}] SHOT_ERR=` + e.message); }
  }

  console.log('PAGEERRORS=' + JSON.stringify(errors.slice(0, 10)));
  console.log('ALL_HIDDEN_OK=' + allPass);
  try { ws.close(); } catch (e) {}
  edge.kill('SIGTERM'); server.close();
  process.exit(allPass ? 0 : 1);
})().catch(e => { console.error('ERR', e); process.exit(1); });
