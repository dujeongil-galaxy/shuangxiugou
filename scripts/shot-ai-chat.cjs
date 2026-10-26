// AI 挂件真渲染验收：无头 Edge + CDP（照 shot-vcr.cjs 纪律）
// 场景：① 品牌页默认（endpoint 空）→ 挂件不渲染；
//       ② 模拟已配置（页面注入 endpoint）→ 按钮在、面板开合正常；
//       ③ 截图两张（未配置 / 已配置面板展开）。
// 跑法：node scripts/shot-ai-chat.cjs（需 ws；输出到 ../Star门禁验收截图/）
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 18970;
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
    '--user-data-dir=' + path.join(ROOT, 'scripts/edgeprof-aichat'),
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
    // awaitPromise: true——场景②是 async IIFE，不等待会拿到空对象
    // （2026-10-26 实测：缺它时 returnByValue 序列化 Promise 为 {}）
    const r = await call('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    return r.result && r.result.result && r.result.result.value;
  };
  const shot = async (fname) => {
    const cap = await call('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT_DIR, fname), Buffer.from(cap.result.data, 'base64'));
    console.log('截图:', fname);
  };

  // ---- 场景①：品牌页默认（ai-config.js 原样，endpoint 空）----
  await call('Page.navigate', { url: `http://127.0.0.1:${PORT}/brand/acer.html` });
  await new Promise(r => setTimeout(r, 3500));
  const s1 = await ev(`JSON.stringify({
    fab: !!document.getElementById('sxg-ai-fab'),
    panel: !!document.getElementById('sxg-ai-panel'),
    bodyIntact: !!document.querySelector('.wrap h1')
  })`);
  console.log('① 默认（endpoint 空）:', s1);
  await shot('ai-chat-off.png');

  // ---- 场景②：模拟已配置（页面注入 endpoint 后重载 chat 脚本）----
  const s2raw = await ev(`(async () => {
    window.SXG_AI_CONFIG = { endpoint: 'https://ai.example.workers.dev' };
    const src = await (await fetch('/ai-chat.js')).text();
    (0, eval)(src);
    await new Promise(r => setTimeout(r, 200));
    const fab = document.getElementById('sxg-ai-fab');
    const panel = document.getElementById('sxg-ai-panel');
    if (!fab || !panel) return { ok: false, fab: !!fab, panel: !!panel };
    fab.click();
    await new Promise(r => setTimeout(r, 100));
    return {
      ok: true,
      fabVisible: fab.getBoundingClientRect().width > 0,
      panelOpen: !panel.hidden,
      welcomeShown: !!document.querySelector('.sxg-ai-msg.bot'),
      inputReady: !!document.querySelector('.sxg-ai-in'),
      sendBtn: !!document.querySelector('.sxg-ai-send'),
      bodyIntact: !!document.querySelector('.wrap h1'),
      singleFab: document.querySelectorAll('#sxg-ai-fab').length === 1
    };
  })()`);
  const ok2 = (s2raw && typeof s2raw === 'object') ? s2raw : {};
  console.log('② 已配置 + 面板展开:', JSON.stringify(ok2));
  await shot('ai-chat-open.png');

  const ok1 = JSON.parse(s1);
  const pass = !ok1.fab && !ok1.panel && ok1.bodyIntact && ok2.ok && ok2.panelOpen && ok2.welcomeShown && ok2.singleFab && ok2.bodyIntact;
  console.log('验收状态:', pass ? 'PASS' : 'FAIL');
  ws.close(); edge.kill(); server.close();
  // Edge 进程 kill 后瞬时仍锁 profile 目录，删失败不影响验收结果
  try { fs.rmSync(path.join(ROOT, 'scripts/edgeprof-aichat'), { recursive: true, force: true }); } catch (e) { /* ignore */ }
  process.exit(pass ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
