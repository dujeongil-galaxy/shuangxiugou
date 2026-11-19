// 【本机专用 · 不挂 CI】踏板支架专题页真渲染验收（2026-11-20）
// 验证专题页桌面 / 移动渲染、原文与短链在 DOM、示意图无溢出、复制按钮在案。
// 产物落 D:/WorkBuddy-Cache/shots/
const { cacheRoot, cacheDir } = require('./_cache-dir.cjs');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const ROOT = path.resolve(__dirname, '..');
const HTTP_PORT = 8762;
const DBG_PORT = 9262;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = `http://127.0.0.1:${HTTP_PORT}`;

const MIME = { '.html':'text/html; charset=utf-8', '.js':'application/javascript', '.css':'text/css',
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
const evalExpr = (ws, expr) => cdp(ws, 'Runtime.evaluate', { expression: expr, returnByValue: true })
  .then(r => r.result && r.result.result ? r.result.result.value : null);

(async () => {
  await new Promise((r) => server.listen(HTTP_PORT, r));
  const shotsDir = cacheDir('shots');
  fs.mkdirSync(shotsDir, { recursive: true });
  const edge = spawn(EDGE, [
    '--headless=new', `--remote-debugging-port=${DBG_PORT}`,
    '--user-data-dir=' + path.join(cacheRoot(), 'edge-profiles/zunjie-report'),
    '--no-proxy-server', '--disable-gpu', 'about:blank'
  ], { stdio: 'ignore' });

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

  const results = [];
  const snap = async (w, h, mobile, name, url) => {
    await cdp(ws, 'Emulation.setDeviceMetricsOverride', {
      width: w, height: h, deviceScaleFactor: 1, mobile,
      screenWidth: w, screenHeight: h
    });
    await cdp(ws, 'Page.navigate', { url });
    await sleep(1200);
    await evalExpr(ws, `var s=document.createElement('style');s.textContent='.dyp{display:none!important}';document.head.appendChild(s);`);
    await sleep(200);
    const info = await evalExpr(ws, `(function(){
      var body=document.body;
      var svg=document.querySelector('.figbox svg');
      var b=body.getBoundingClientRect();
      var sv=svg?svg.getBoundingClientRect():null;
      return {
        title:document.title,
        h1:(document.querySelector('h1')||{}).innerText||null,
        scrollW:document.documentElement.scrollWidth,
        clientW:document.documentElement.clientWidth,
        svgW:sv?Math.round(sv.width):null,
        svgOverflow:sv?sv.width>b.width+2:null,
        hasShortLink:!!document.querySelector('#douyin-link'),
        hasCopyBtn:!!document.querySelector('#copy-btn'),
        hasWorkBuddy:/WorkBuddy/.test(body.innerText),
        titleQuoted:!!(document.querySelector('h1')||{}).querySelector?.('.quoted'),
        viewCards:document.querySelectorAll('.view').length,
        sourceLinks:document.querySelectorAll('a[href^="https://evil-huawei.github.io/"],a[href^="https://zh.wikipedia.org/wiki/"]').length,
        tableOverflow:(function(){var t=document.querySelector('.facts');if(!t)return null;var r=t.getBoundingClientRect();return r.right>b.right+2;})()
      };
    })()`);
    const shot = path.join(shotsDir, name + '.png');
    const r = await cdp(ws, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(shot, Buffer.from(r.result.data, 'base64'));
    results.push({ name, shot, info });
  };

  await snap(1440, 900, false, 'zunjie-report-desktop', BASE + '/zunjie-report.html');
  await snap(390, 844, true, 'zunjie-report-mobile', BASE + '/zunjie-report.html');

  // 首页：滚动到华为卡，确认登记框渲染
  await cdp(ws, 'Emulation.setDeviceMetricsOverride', {
    width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
    screenWidth: 1440, screenHeight: 900
  });
  await cdp(ws, 'Page.navigate', { url: BASE + '/index.html' });
  await sleep(2200);
  await evalExpr(ws, `var s=document.createElement('style');s.textContent='.dyp{display:none!important}';document.head.appendChild(s);`);
  const huawei = await evalExpr(ws, `(function(){
    var boxes=document.querySelectorAll('[data-sxg-news="huawei-zunjie"]');
    var inHuawei=0, linkOk=0;
    boxes.forEach(function(b){
      var c=b; while(c && c!==document.body){ if(c.querySelector && /华为终端/.test((c.querySelector('h2,h3')||{}).textContent||'')){inHuawei++;break;} c=c.parentElement; }
      if(b.querySelector('a[href="./zunjie-report.html"]')) linkOk++;
    });
    return { total:boxes.length, inHuawei:inHuawei, linkOk:linkOk };
  })()`);
  // 滚动到华为卡登记框，肉眼看挂载位置与文案
  await evalExpr(ws, `(function(){
    var b=document.querySelector('[data-sxg-news="huawei-zunjie"]');
    if(b) b.scrollIntoView({block:'center'});
  })()`);
  await sleep(400);
  const shotHome = path.join(shotsDir, 'zunjie-report-homepage.png');
  const rHome = await cdp(ws, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(shotHome, Buffer.from(rHome.result.data, 'base64'));

  console.log(JSON.stringify({ results, huawei, errors }, null, 2));
  ws.close();
  edge.kill();
  server.close();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
