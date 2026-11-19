// 【本机专用 · 不挂 CI】UA 伪装自助兜底真渲染实证（2026-11-20）
// 新版 360 v13+ 把 UA 伪装成纯 Chrome（无任何 360 标识），纯特征匹配分不出来。
// 本脚本覆盖纯 Chrome UA，验证：
//   ① 访问首页（无参数）→ 不弹国产提示条（国际浏览器放行口径不变）
//   ② 访问 /?force-domestic=1 → 弹 #sxg-browser-notice（自助开关生效）
//   ③ 访问 ua-check.html → 判定「国际/伪装」+ 摊出完整 UA + 运行时指纹
// 产物落 D:/WorkBuddy-Cache/shots/
const { cacheRoot, cacheDir } = require('./_cache-dir.cjs');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const ROOT = path.resolve(__dirname, '..');
const HTTP_PORT = 8753;
const DBG_PORT = 9253;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PURE_CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36';
const SHOTS = cacheDir('shots');
const BASE = `http://127.0.0.1:${HTTP_PORT}`;

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
    ws.addEventListener('error', () => reject(new Error('ws ' + url)));
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
  fs.mkdirSync(SHOTS, { recursive: true });
  await new Promise((r) => server.listen(HTTP_PORT, '127.0.0.1', r));
  const edge = spawn(EDGE, [
    '--headless=new', `--remote-debugging-port=${DBG_PORT}`,
    '--user-data-dir=' + path.join(cacheRoot(), 'edge-profiles/ua-diag-' + Date.now()),
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
  if (!pageTarget) { console.error('NO PAGE TARGET'); edge.kill('SIGTERM'); server.close(); process.exit(1); }
  const ws = await wsConnect(pageTarget.webSocketDebuggerUrl);
  await cdp(ws, 'Page.enable');
  await cdp(ws, 'Runtime.enable');
  await cdp(ws, 'Network.enable');
  await cdp(ws, 'Network.setUserAgentOverride', { userAgent: PURE_CHROME_UA });

  const shot = async (name) => {
    const r = await cdp(ws, 'Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(SHOTS, name), Buffer.from(r.result.data, 'base64'));
  };
  const notice = `(function(){var n=document.getElementById('sxg-browser-notice');return {present:!!n,text:n?n.textContent.slice(0,50):null}})()`;

  // ① 纯 Chrome UA + 无参数首页 → 不弹
  await cdp(ws, 'Page.navigate', { url: BASE + '/index.html' });
  await sleep(2200);
  const r1 = await evalExpr(ws, notice);
  console.log('① 伪装Chrome无参数:', JSON.stringify(r1));
  await shot('ua-diag-1-no-param.png');

  // ② 纯 Chrome UA + ?force-domestic=1 → 弹（sessionStorage 生效）
  await cdp(ws, 'Page.navigate', { url: BASE + '/index.html?force-domestic=1' });
  await sleep(2200);
  const r2 = await evalExpr(ws, notice);
  console.log('② 伪装Chrome强制开关:', JSON.stringify(r2));
  await shot('ua-diag-2-force.png');

  // ③ 自检页 → 判定信息
  await cdp(ws, 'Page.navigate', { url: BASE + '/ua-check.html' });
  await sleep(1200);
  const r3 = await evalExpr(ws, `(function(){
    var v=document.getElementById('verdict');
    var ua=document.getElementById('uaBox');
    var rows=document.querySelectorAll('#detail tr');
    return {
      verdict: v?v.textContent.trim():null,
      ua: ua?ua.value:null,
      rows: rows.length
    };
  })()`);
  console.log('③ 自检页:', JSON.stringify(r3));
  await shot('ua-diag-3-check.png');

  const ok = r1 && r1.present === false
    && r2 && r2.present === true && /当前浏览器环境/.test(r2.text || '')
    && r3 && /伪装|国际/.test(r3.verdict || '') && r3.ua === PURE_CHROME_UA && r3.rows >= 10;
  console.log(ok ? 'PASS 全部符合预期' : 'FAIL 存在不符项');
  try { ws.close(); } catch (e) {}
  edge.kill('SIGTERM');
  server.close();
  process.exit(ok ? 0 : 1);
})().catch((e) => {
  console.error('FATAL', e.stack || e);
  process.exit(1);
});
