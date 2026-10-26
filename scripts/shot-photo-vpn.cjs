// 照片彩蛋 VPN 提示真渲染验收：无头 Edge + CDP
// 场景：①锁定态可见 gate-vpn-tip 黄底提示卡；
//       ②限流错误文案里含 VPN 提示（桩 fetch 403 → 消息位）；
//       ③截图一张（锁定态含提示卡）。
// 跑法：node scripts/shot-photo-vpn.cjs（需 ws；输出到 ../Star门禁验收截图/）
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 18972;
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = 'C:/Users/dujeo/WorkBuddy/2026-10-20-02-34-17/Star门禁验收截图';

const server = http.createServer((req, res) => {
  let p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (p.endsWith('/') || p.endsWith('\\')) p = path.join(p, 'index.html');
  fs.readFile(p, (err, data) => {
    if (err) { res.writeHead(404); res.end('nf'); return; }
    const ext = path.extname(p);
    const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' }[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime + '; charset=utf-8' });
    res.end(data);
  });
});

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const edge = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', [
    '--headless=new', `--remote-debugging-port=${PORT + 100}`, '--no-first-run',
    '--window-size=1672,918',
    '--user-data-dir=' + path.join(ROOT, 'scripts/edgeprof-pvpn'),
    'about:blank'
  ], { stdio: 'ignore' });

  await new Promise(r => setTimeout(r, 5000));
  const list = await (await fetch(`http://127.0.0.1:${PORT + 100}/json/list`)).json();
  const page = list.find(t => t.type === 'page' && t.url === 'about:blank');
  if (!page) { console.log('NO PAGE'); process.exit(1); }
  const WebSocket = require('ws');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.on('open', r));
  let mid = 0;
  const pending = new Map();
  ws.on('message', raw => {
    const m = JSON.parse(raw);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  const call = (method, params) => new Promise(res => {
    const i = ++mid;
    pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params: params || {} }));
  });
  await call('Page.enable');

  const ev = async (expr) => {
    const r = await call('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    return r.result && r.result.result && r.result.result.value;
  };
  const shot = async (fname) => {
    const cap = await call('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT_DIR, fname), Buffer.from(cap.result.data, 'base64'));
    console.log('截图:', fname);
  };

  // ---- 场景①：锁定态的可见提示卡 ----
  await call('Page.navigate', { url: `http://127.0.0.1:${PORT}/why-shuangxiugou.html` });
  await new Promise(r => setTimeout(r, 4000));
  // 滚到门禁区让截图里可见
  await ev(`document.getElementById('sxg-photo-gate').scrollIntoView({block:'center'}); void 0`);
  await new Promise(r => setTimeout(r, 300));

  const s1 = await ev(`(() => {
    const tip = document.querySelector('.gate-vpn-tip');
    const msg = document.getElementById('sxg-gate-msg');
    return {
      tipVisible: !!tip && tip.getBoundingClientRect().height > 0,
      tipHasVPNText: !!tip && tip.textContent.includes('关闭 VPN / 代理'),
      tipWarnStyle: !!tip && getComputedStyle(tip).backgroundColor === 'rgb(255, 251, 235)',
      gateLocked: document.getElementById('sxg-photo-grid').hidden === true
    };
  })()`);
  console.log('① 锁定态提示卡:', JSON.stringify(s1));
  await shot('photo-vpn-tip.png');

  // ---- 场景②：限流错误文案含 VPN 提示（桩 403）----
  // ⚠️ 桩必须在导航前注入：photo-gate 的 mount 在脚本加载时 capture
  // root.fetch.bind(root) 的引用，页面加载后替换 window.fetch 不生效
  // （2026-10-26 实测：后注入时验证走真 GitHub API，结果不可控）。
  await call('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.fetch = function (url, opts) {
      return Promise.resolve(new Response('{"message":"rate limited"}', {
        status: 403, headers: { 'Content-Type': 'application/json' }
      }));
    }; void 0;`
  });
  await call('Page.navigate', { url: `http://127.0.0.1:${PORT}/why-shuangxiugou.html` });
  await new Promise(r => setTimeout(r, 4000));
  const s2 = await ev(`(async () => {
    const input = document.getElementById('sxg-gate-user');
    const msg = document.getElementById('sxg-gate-msg');
    input.value = 'starfan';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 1500));
    return {
      msgShown: !msg.hidden,
      msgHasRateLimit: msg.textContent.includes('限流'),
      msgHasVPNHint: msg.textContent.includes('VPN'),
      stillLocked: document.getElementById('sxg-photo-grid').hidden === true
    };
  })()`);
  console.log('② 限流文案含 VPN 提示:', JSON.stringify(s2));

  const pass = s1.tipVisible && s1.tipHasVPNText && s1.tipWarnStyle && s1.gateLocked
    && s2.msgShown && s2.msgHasRateLimit && s2.msgHasVPNHint && s2.stillLocked;
  console.log('验收状态:', pass ? 'PASS' : 'FAIL');
  ws.close(); edge.kill(); server.close();
  try { fs.rmSync(path.join(ROOT, 'scripts/edgeprof-pvpn'), { recursive: true, force: true }); } catch (e) { /* ignore */ }
  process.exit(pass ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
