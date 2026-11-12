// 【本机专用 · 不挂 CI】真渲染验收：星巴克 × WorkBuddy 联名活动位
// 本地起静态服务 + 无头 Edge CDP，在手机(390)与桌面(1440)两种视口下：
//   1) 确认小悬浮卡出现（LOGO「星巴克」、CTA「查看活动」、活动日期）
//   2) 点击 CTA 打开活动海报弹窗，确认弹窗含完整日期、星巴克、扫码参与
// 产物落 D:/WorkBuddy-Cache/shots/（见 _cache-dir.cjs）。
const { cacheRoot, cacheDir } = require('./_cache-dir.cjs');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const ROOT = path.resolve(__dirname, '..');
const HTTP_PORT = 8731;          // 静态服务端口（与调试端口分离）
const DBG_PORT = 9231;           // CDP 远程调试端口
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
    '--user-data-dir=' + path.join(cacheRoot(), '.edge-sb-adcheck'),
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

  // 仅隐藏抖音弹窗（.dyp），不要隐藏本活动的 dialog/modal
  await cdp(ws, 'Runtime.evaluate', { expression:
    `var s=document.createElement('style');s.textContent='.dyp{display:none!important}';document.head.appendChild(s);` });

  const viewports = [
    { name: 'mobile', w: 390, h: 844, mobile: true, bar: 'shots/sb-mobile-bar.png', modal: 'shots/sb-mobile-modal.png' },
    { name: 'desktop', w: 1440, h: 900, mobile: false, bar: 'shots/sb-desktop-card.png', modal: 'shots/sb-desktop-modal.png' },
  ];

  for (const vp of viewports) {
    await cdp(ws, 'Emulation.setDeviceMetricsOverride', {
      width: vp.w, height: vp.h, deviceScaleFactor: 1, mobile: vp.mobile,
      screenWidth: vp.w, screenHeight: vp.h
    });
    await sleep(1200);

    const barInfo = await cdp(ws, 'Runtime.evaluate', { expression: `(function(){
      var a=document.querySelector('.sb-ad');
      if(!a) return {present:false};
      var r={present:true, hidden:a.classList.contains('is-hidden'),
        logo:(a.querySelector('.sb-ad__logo')||{}).textContent,
        brand:(a.querySelector('.sb-ad__brand')||{}).textContent,
        cta:(a.querySelector('.sb-ad__cta')||{}).textContent,
        title:(a.querySelector('.sb-ad__title')||{}).innerText};
      var lp=document.querySelector('.lp-ad');
      r.liangpeiStillActive=!!lp;
      return r;
    })()`, returnByValue: true });
    const bi = barInfo.result ? barInfo.result.value : null;
    console.log(`[${vp.name}] BAR=` + JSON.stringify(bi));

    try {
      const vp2 = await cdp(ws, 'Page.getLayoutMetrics', {});
      const cs = (vp2.result && vp2.result.cssContentSize) ? vp2.result.cssContentSize : { width: vp.w, height: vp.h };
      const shot = await cdp(ws, 'Page.captureScreenshot', {
        format: 'png', fromSurface: true, captureBeyondViewport: false,
        clip: { x: 0, y: 0, width: vp.w, height: vp.h, scale: 1 }
      });
      if (shot.result && shot.result.data) {
        const out = cacheDir(vp.bar);
        fs.writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
        console.log(`[${vp.name}] BAR_SHOT=${out}`);
      }
    } catch (e) { console.log(`[${vp.name}] BAR_SHOT_ERR=` + e.message); }

    // 打开弹窗
    const opened = await cdp(ws, 'Runtime.evaluate', { expression: `(function(){
      var c=document.querySelector('.sb-ad__cta');
      if(!c) return {clicked:false};
      c.click();
      var m=document.getElementById('sb-modal');
      return {clicked:true, modalOpen: m?m.classList.contains('is-open'):false};
    })()`, returnByValue: true });
    const op = opened.result ? opened.result.value : null;
    console.log(`[${vp.name}] OPEN=` + JSON.stringify(op));
    await sleep(900);

    const modalInfo = await cdp(ws, 'Runtime.evaluate', { expression: `(function(){
      var m=document.getElementById('sb-modal');
      if(!m) return {present:false};
      var t=m.innerText.replace(/\\s+/g,' ').trim();
      return {present:true, open:m.classList.contains('is-open'),
        text:t,
        hasDate:/11月12日\\s*8:00[\\s\\S]*11月16日\\s*23:59/.test(t),
        hasStarbucks:t.indexOf('星巴克')!==-1,
        hasWorkBuddy:t.indexOf('WorkBuddy')!==-1,
        hasScan:t.indexOf('扫码参与')!==-1,
        hasFree:t.indexOf('完全免费')!==-1,
        hasReward:t.indexOf('美式咖啡券')!==-1};
    })()`, returnByValue: true });
    const mi = modalInfo.result ? modalInfo.result.value : null;
    console.log(`[${vp.name}] MODAL=` + JSON.stringify(mi));

    try {
      const shot2 = await cdp(ws, 'Page.captureScreenshot', {
        format: 'png', fromSurface: true, captureBeyondViewport: false,
        clip: { x: 0, y: 0, width: vp.w, height: vp.h, scale: 1 }
      });
      if (shot2.result && shot2.result.data) {
        const out = cacheDir(vp.modal);
        fs.writeFileSync(out, Buffer.from(shot2.result.data, 'base64'));
        console.log(`[${vp.name}] MODAL_SHOT=${out}`);
      }
    } catch (e) { console.log(`[${vp.name}] MODAL_SHOT_ERR=` + e.message); }

    // 关闭弹窗，准备下一个视口
    await cdp(ws, 'Runtime.evaluate', { expression:
      `var m=document.getElementById('sb-modal');if(m)m.classList.remove('is-open');` });
    await sleep(300);
  }

  console.log('PAGEERRORS=' + JSON.stringify(errors.slice(0, 10)));
  try { ws.close(); } catch (e) {}
  edge.kill('SIGTERM'); server.close();
  process.exit(0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
