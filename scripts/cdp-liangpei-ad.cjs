// 【本机专用 · 不挂 CI】真渲染验收：良配广告位恢复上线 + 喜茶 LOGO。
// 本地起静态服务 + 无头 Edge CDP，在桌面(1440)与手机(390)两种视口下确认：
//   1) .lp-ad 真的出现（良配 showAfter=6000ms，所以等 9 秒）
//   2) LOGO 是站内 assets/heytea.png 图片，且 naturalWidth > 0（真加载出来）
//   3) 容器白底、文案含「喜茶 20 元」、CTA「立即注册」
//   4) 页面无星巴克 × WorkBuddy 推广残留
// 产物落 D:/WorkBuddy-Cache/shots/（见 _cache-dir.cjs）。
const { cacheRoot, cacheDir } = require('./_cache-dir.cjs');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const ROOT = path.resolve(__dirname, '..');
const HTTP_PORT = 8741;
const DBG_PORT = 9241;
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
    '--user-data-dir=' + path.join(cacheRoot(), 'edge-profiles/liangpei-ad'),
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
  await sleep(9500); // bundle + 良配延迟淡入 6000ms + 余量

  // 只隐藏抖音弹窗（.dyp），它会遮住页面；不碰广告卡本身
  await cdp(ws, 'Runtime.evaluate', { expression:
    `var s=document.createElement('style');s.textContent='.dyp{display:none!important}';document.head.appendChild(s);` });

  const viewports = [
    { name: 'desktop', w: 1440, h: 900, mobile: false, shot: 'shots/liangpei-desktop.png' },
    { name: 'mobile', w: 390, h: 844, mobile: true, shot: 'shots/liangpei-mobile.png' },
  ];

  for (const vp of viewports) {
    await cdp(ws, 'Emulation.setDeviceMetricsOverride', {
      width: vp.w, height: vp.h, deviceScaleFactor: 1, mobile: vp.mobile,
      screenWidth: vp.w, screenHeight: vp.h
    });
    await sleep(1200);

    const info = await cdp(ws, 'Runtime.evaluate', { expression: `(function(){
      var a=document.querySelector('.lp-ad');
      if(!a) return {present:false};
      var img=a.querySelector('.lp-ad__logo__img');
      var cs=getComputedStyle(a.querySelector('.lp-ad__logo'));
      var r={present:true,
        hidden:a.classList.contains('is-hidden'),
        display:getComputedStyle(a).display,
        visibility:getComputedStyle(a).visibility,
        opacity:getComputedStyle(a).opacity,
        rect:{x:Math.round(a.getBoundingClientRect().x),y:Math.round(a.getBoundingClientRect().y),
              w:Math.round(a.getBoundingClientRect().width),h:Math.round(a.getBoundingClientRect().height)},
        logoImg:!!img,
        logoSrc:img?img.getAttribute('src'):null,
        logoNatural:img?[img.naturalWidth,img.naturalHeight]:null,
        logoBg:cs.backgroundColor,
        title:(a.querySelector('.lp-ad__title')||{}).innerText,
        cta:(a.querySelector('.lp-ad__cta')||{}).textContent,
        brand:(a.querySelector('.lp-ad__brand')||{}).textContent,
        barVar:getComputedStyle(document.documentElement).getPropertyValue('--sxg-bar-h').trim(),
        sbPromo:!!document.querySelector('.sxg-promo, .sb-ad, #sb-modal, .sb-modal')
      };
      return r;
    })()`, returnByValue: true });
    const rv = info.result && info.result.result ? info.result.result.value : null;
    console.log(`[${vp.name}] AD=` + JSON.stringify(rv));

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
  try { ws.close(); } catch (e) {}
  edge.kill('SIGTERM'); server.close();
  process.exit(0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
