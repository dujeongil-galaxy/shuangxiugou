// 【本机专用 · 不挂 CI】UA 伪装自助兜底真渲染实证（2026-11-20）
// 新版 360 v13+ 把 UA 伪装成纯 Chrome（无任何 360 标识），且 UA/platform/vendor/
// external/documentMode/chrome/uad.brands 全部与真 Chrome 一致，无法自动区分。
// 方案：?force-domestic=1 写 localStorage 永久自检。本脚本覆盖纯 Chrome UA，验证：
//   ① 无参数首页 → 不弹（国际浏览器默认放行口径不变）
//   ② ?force-domestic=1 → 弹 + localStorage 已写入
//   ③ 再访问无参数首页（关键：持久化）→ 仍弹，撤销前一直生效
//   ④ ?force-domestic=0 → 不弹 + localStorage 已清除
//   ⑤ 再访问无参数首页 → 不弹（撤销彻底）
//   ⑥ ua-check.html → 判定「无法区分」+ 双按钮 + 完整 UA + 运行时指纹
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
  const notice = `(function(){var n=document.getElementById('sxg-browser-notice');return {
    present:!!n,text:n?n.textContent.slice(0,50):null,
    ls:(function(){try{return localStorage.getItem('sxg-force-domestic')}catch(e){return 'ERR'}})(),
    ss:(function(){try{return sessionStorage.getItem('sxg-force-domestic')}catch(e){return 'ERR'}})()
  }})()`;

  // ① 纯 Chrome UA + 无参数首页 → 不弹
  await cdp(ws, 'Page.navigate', { url: BASE + '/index.html' });
  await sleep(2200);
  const r1 = await evalExpr(ws, notice);
  console.log('① 无参数首页:', JSON.stringify(r1));
  await shot('ua-diag-1-no-param.png');

  // ② ?force-domestic=1 → 弹 + localStorage 写入
  await cdp(ws, 'Page.navigate', { url: BASE + '/index.html?force-domestic=1' });
  await sleep(2200);
  const r2 = await evalExpr(ws, notice);
  console.log('② 永久开启:', JSON.stringify(r2));
  await shot('ua-diag-2-force.png');

  // ③ 关键：再访问无参数首页 → 仍弹（持久化生效，关标签页重开也一样）
  await cdp(ws, 'Page.navigate', { url: BASE + '/index.html?nocache=' + Date.now() });
  await sleep(2200);
  const r3 = await evalExpr(ws, notice);
  console.log('③ 无参数再访问（持久化）:', JSON.stringify(r3));

  // ④ ?force-domestic=0 → 不弹 + localStorage 清除
  await cdp(ws, 'Page.navigate', { url: BASE + '/index.html?force-domestic=0' });
  await sleep(2200);
  const r4 = await evalExpr(ws, notice);
  console.log('④ 撤销:', JSON.stringify(r4));

  // ⑤ 再访问无参数首页 → 不弹（撤销彻底）
  await cdp(ws, 'Page.navigate', { url: BASE + '/index.html?nocache=' + (Date.now()+1) });
  await sleep(2200);
  const r5 = await evalExpr(ws, notice);
  console.log('⑤ 撤销后无参数:', JSON.stringify(r5));

  // ⑥ 自检页 → 判定信息 + 双按钮
  await cdp(ws, 'Page.navigate', { url: BASE + '/ua-check.html' });
  await sleep(1200);
  const r6 = await evalExpr(ws, `(function(){
    var v=document.getElementById('verdict');
    var ua=document.getElementById('uaBox');
    var rows=document.querySelectorAll('#detail tr');
    var btns=[].map.call(document.querySelectorAll('button'),function(b){return b.textContent.trim()});
    return {
      verdict: v?v.textContent.trim():null,
      ua: ua?ua.value:null,
      rows: rows.length,
      hasOpen: btns.some(function(t){return /永久显示提示条/.test(t)}),
      hasRevoke: btns.some(function(t){return /撤销永久显示/.test(t)})
    };
  })()`);
  console.log('⑥ 自检页:', JSON.stringify(r6));
  await shot('ua-diag-3-check.png');

  const ok = r1 && r1.present === false
    && r2 && r2.present === true && r2.ls === '1' && /当前浏览器环境/.test(r2.text || '')
    && r3 && r3.present === true && r3.ls === '1'
    && r4 && r4.present === false && r4.ls === null
    && r5 && r5.present === false && r5.ls === null
    && r6 && /无法区分/.test(r6.verdict || '') && r6.ua === PURE_CHROME_UA && r6.rows >= 10
    && r6.hasOpen === true && r6.hasRevoke === true;
  console.log(ok ? 'PASS 持久化全链路符合预期' : 'FAIL 存在不符项');
  try { ws.close(); } catch (e) {}
  edge.kill('SIGTERM');
  server.close();
  process.exit(ok ? 0 : 1);
})().catch((e) => {
  console.error('FATAL', e.stack || e);
  process.exit(1);
});
