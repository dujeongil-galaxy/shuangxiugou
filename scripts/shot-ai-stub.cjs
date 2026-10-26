// stub 模式（endpoint 空）真渲染验收：按钮显示 + 「开通中」提示 + 禁用表单
// 跑法：node scripts/shot-ai-stub.cjs（需 ws；输出到 ../Star门禁验收截图/）
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 18976;
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
    '--window-size=390,844',
    '--user-data-dir=' + path.join(ROOT, 'scripts/edgeprof-aistub'),
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

  // 首页（真实线上形态：ai-config.js 原样 endpoint 空）
  await call('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
  await new Promise(r => setTimeout(r, 7000));
  const s1 = await ev(`(() => {
    const fab = document.getElementById('sxg-ai-fab');
    if (!fab) return { ok: false };
    const r = fab.getBoundingClientRect();
    document.querySelectorAll('.dyp').forEach(n => n.remove());
    fab.click();
    const input = document.querySelector('.sxg-ai-in');
    const send = document.querySelector('.sxg-ai-send');
    const hello = document.querySelector('.sxg-ai-log .sxg-ai-msg.bot');
    return {
      ok: true,
      fabVisible: r.width > 0 && r.right <= window.innerWidth,
      hasAvatar: !!fab.querySelector('img'),
      panelOpen: !document.getElementById('sxg-ai-panel').hidden,
      stubHello: hello && hello.textContent.includes('开通中'),
      inputDisabled: input.disabled,
      sendDisabled: send.disabled,
      placeholder: input.placeholder
    };
  })()`);
  console.log('① 首页 stub 模式:', JSON.stringify(s1));
  await shot('ai-stub-mobile.png');

  const pass = s1.ok && s1.fabVisible && s1.hasAvatar && s1.panelOpen && s1.stubHello && s1.inputDisabled && s1.sendDisabled;
  console.log('验收状态:', pass ? 'PASS' : 'FAIL');
  ws.close(); edge.kill(); server.close();
  try { fs.rmSync(path.join(ROOT, 'scripts/edgeprof-aistub'), { recursive: true, force: true }); } catch (e) { /* ignore */ }
  process.exit(pass ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
