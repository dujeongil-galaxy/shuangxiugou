// 【本机专用 · 不挂 CI】国产浏览器提示条真渲染实证（2026-11-19）
// 站长 PC 360 看不到国产提示条的实证排查：用 CDP 覆盖三版 UA，验证
//   - 新版 360（Safari/537.36/<ver> 双段尾缀，无 QIHU）→ 必须弹 #sxg-browser-notice
//   - 老版 360（QIHU 360SE）→ 必须弹
//   - 普通 Chrome → 不许弹（但乌克兰公告 #sxg-policy-notice 对所有 UA 都挂）
// 同时清 Cache Storage + 强刷，模拟「旧 SW 缓存已清」后的真实取新文件行为。
// 产物落 D:/WorkBuddy-Cache/shots/
const { cacheRoot, cacheDir } = require('./_cache-dir.cjs');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const ROOT = path.resolve(__dirname, '..');
const HTTP_PORT = 8751;
const DBG_PORT = 9251;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const URL = `http://127.0.0.1:${HTTP_PORT}/index.html`;

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
const evalExpr = (ws, expr) => cdp(ws, 'Runtime.evaluate', { expression: expr, returnByValue: true })
  .then(r => r.result && r.result.result ? r.result.result.value : null);

const UAS = [
  { key: '360-new', wantNotice: true,
    ua: 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36/13.0.10000.0' },
  { key: '360-old', wantNotice: true,
    ua: 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/86.0.4240.198 Safari/537.36 QIHU 360SE' },
  { key: 'chrome', wantNotice: false,
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' },
];

(async () => {
  await new Promise((r) => server.listen(HTTP_PORT, r));
  const edge = spawn(EDGE, [
    '--headless=new', `--remote-debugging-port=${DBG_PORT}`,
    '--user-data-dir=' + path.join(cacheRoot(), 'edge-profiles/ua-notice'),
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
  await cdp(ws, 'Page.enable');
  await cdp(ws, 'Runtime.enable');
  await cdp(ws, 'Network.enable');

  let fail = 0;
  for (const u of UAS) {
    await cdp(ws, 'Network.setUserAgentOverride', { userAgent: u.ua });
    // 清 SW 注册 + 缓存，确保拿到最新脚本（实证「升级后能生效」）
    await cdp(ws, 'Page.navigate', { url: URL + '?no-sw=1' });
    await sleep(600);
    await evalExpr(ws, `(function(){
      if(window.caches) caches.keys().then(ks=>Promise.all(ks.map(k=>caches.delete(k))));
      if(navigator.serviceWorker) navigator.serviceWorker.getRegistrations().then(rs=>rs.forEach(r=>r.unregister()));
      return true;
    })()`);
    await sleep(300);
    await cdp(ws, 'Page.navigate', { url: URL + '?v=' + Date.now() });
    await sleep(1800);
    const res = await evalExpr(ws, `(function(){
      var n=document.getElementById('sxg-browser-notice');
      var p=document.getElementById('sxg-policy-notice');
      var g=document.querySelector('script[src*="ua-guard"]');
      return {
        notice: !!n, noticeDisplay: n?getComputedStyle(n).display:null,
        noticeText: n?n.innerText.replace(/\\s+/g,' ').slice(0,60):null,
        policy: !!p, policyText: p?p.innerText.replace(/\\s+/g,' ').slice(0,40):null,
        guardSrc: g?g.getAttribute('src'):null,
        ua: navigator.userAgent.slice(-46)
      };
    })()`);
    const noticeOk = !!res.notice === u.wantNotice;
    const policyOk = !!res.policy; // 乌克兰公告对所有 UA 无条件显示
    const guardOk = /ua-guard\.js\?v=10/.test(res.guardSrc || '');
    if (!noticeOk || !policyOk || !guardOk) fail++;
    console.log(`\n[${u.key}] 期望提示条=${u.wantNotice ? '有' : '无'}`);
    console.log('  提示条:', noticeOk ? '✓' : '✗', JSON.stringify({notice:res.notice, display:res.noticeDisplay, text:res.noticeText}));
    console.log('  乌克兰公告:', policyOk ? '✓' : '✗', JSON.stringify(res.policyText));
    console.log('  ua-guard 版本:', guardOk ? '✓ v10' : '✗ ' + res.guardSrc);
    console.log('  实际 UA 尾段:', res.ua);
    if (u.key === '360-new' && res.notice) {
      const shot = await cdp(ws, 'Page.captureScreenshot', {
        format: 'png', fromSurface: true, captureBeyondViewport: false,
        clip: { x:0, y:0, width:1440, height:760, scale:1 }
      });
      if (shot.result && shot.result.data) {
        const out = cacheDir('shots/360-notice-new.png');
        fs.writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
        console.log('  SHOT=' + out);
      }
    }
  }
  console.log('\n' + '='.repeat(52));
  console.log(fail ? `失败 ${fail} 组` : '三组 UA 真渲染全部符合预期');
  try { ws.close(); } catch (e) {}
  edge.kill('SIGTERM'); server.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
