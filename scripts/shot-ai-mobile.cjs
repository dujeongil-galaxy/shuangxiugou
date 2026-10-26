// AI 挂件手机端真渲染验收：无头 Edge + CDP
// 视口 390x844（iPhone 14 尺寸级）：
//   ① 首页（React）注入 endpoint 后：按钮可见、不与 ⤓/TOP 叠位
//   ② 品牌页：按钮可见、面板展开后两侧贴合 14px、输入 16px
//   ③ 截图两张（手机视口首页浮钮群 + 品牌页面板展开）
// 跑法：node scripts/shot-ai-mobile.cjs（需 ws；输出到 ../Star门禁验收截图/）
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 18974;
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
    '--window-size=390,844', // 手机视口（手机端可见性验收的核心）
    '--user-data-dir=' + path.join(ROOT, 'scripts/edgeprof-aimob'),
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
  const enableAI = `(async () => {
    window.SXG_AI_CONFIG = { endpoint: 'https://ai.example.workers.dev' };
    const src = await (await fetch('/ai-chat.js')).text();
    (0, eval)(src);
    await new Promise(r => setTimeout(r, 250));
    return true;
  })()`;

  // ---- 场景①：首页（React 页）手机视口 ----
  await call('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
  await new Promise(r => setTimeout(r, 7000)); // React 渲染 + 各补丁挂载
  await ev(enableAI);
  const s1 = await ev(`(() => {
    const fab = document.getElementById('sxg-ai-fab');
    if (!fab) return { ok: false, why: 'no-fab' };
    const r = fab.getBoundingClientRect();
    const top = document.getElementById('sxg-top-btn');
    const bot = document.getElementById('sxg-bottom-btn');
    const overlap = (a, b) => a && b && !(a.right < b.left || b.right < a.left || a.bottom < b.top || b.bottom < a.top);
    // 抖音弹窗 .dyp 会盖截图——验收时移除
    document.querySelectorAll('.dyp').forEach(n => n.remove());
    return {
      ok: true,
      inViewport: r.right <= window.innerWidth && r.bottom <= window.innerHeight && r.left >= 0 && r.top >= 0,
      size: Math.round(r.width) + 'x' + Math.round(r.height),
      zIndex: getComputedStyle(fab).zIndex,
      noOverlapTop: !overlap(r, top && top.getBoundingClientRect()),
      noOverlapBottom: !overlap(r, bot && bot.getBoundingClientRect()),
      hasAvatar: !!fab.querySelector('img'),
      rootIntact: !!document.querySelector('#root')
    };
  })()`);
  console.log('① 首页手机视口:', JSON.stringify(s1));
  await shot('ai-mobile-home.png');

  // ---- 场景②：品牌页手机视口（面板展开）----
  await call('Page.navigate', { url: `http://127.0.0.1:${PORT}/brand/acer.html` });
  await new Promise(r => setTimeout(r, 3500));
  await ev(enableAI);
  const s2 = await ev(`(() => {
    const fab = document.getElementById('sxg-ai-fab');
    if (!fab) return { ok: false, why: 'no-fab' };
    fab.click();
    const panel = document.getElementById('sxg-ai-panel');
    const pr = panel.getBoundingClientRect();
    const input = document.querySelector('.sxg-ai-in');
    return {
      ok: true,
      panelOpen: !panel.hidden,
      panelFitsWidth: pr.left >= 12 && pr.right <= window.innerWidth - 12,
      inputFontSize: getComputedStyle(input).fontSize,
      headAvatar: !!document.querySelector('.sxg-ai-head img'),
      fabSize: Math.round(fab.getBoundingClientRect().width),
      bodyIntact: !!document.querySelector('.wrap h1')
    };
  })()`);
  console.log('② 品牌页面板展开:', JSON.stringify(s2));
  await shot('ai-mobile-brand.png');

  const pass = s1.ok && s1.inViewport && s1.noOverlapTop && s1.noOverlapBottom && s1.hasAvatar && s1.rootIntact
    && s2.ok && s2.panelOpen && s2.panelFitsWidth && s2.headAvatar && s2.bodyIntact;
  console.log('验收状态:', pass ? 'PASS' : 'FAIL');
  ws.close(); edge.kill(); server.close();
  try { fs.rmSync(path.join(ROOT, 'scripts/edgeprof-aimob'), { recursive: true, force: true }); } catch (e) { /* ignore */ }
  process.exit(pass ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
