// 虚拟卡下线验收截图（class 隐藏版）：真实浏览器整页渲染
// 跑法：node scripts/shot-vcr.cjs（需 ws；输出到 ../Star门禁验收截图/）
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 18960;
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
  // 经验（2026-10-26）：Edge 在此环境忽略命令行 URL（渲染 about:blank），
  // 必须 Page.navigate；MIME 必须正确否则被当下载 ERR_ABORTED。
  const edge = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', [
    '--headless=new', `--remote-debugging-port=${PORT + 100}`, '--no-first-run',
    '--window-size=1672,918',
    '--user-data-dir=' + path.join(ROOT, 'scripts/edgeprof-v2'),
    'about:blank'
  ], { stdio: 'ignore' });

  await new Promise(r => setTimeout(r, 5000));
  const list = await (await fetch(`http://127.0.0.1:${PORT+100}/json/list`)).json();
  const page = list.find(t => t.type === 'page' && t.url === 'about:blank')
    || list.find(t => t.type === 'page' && !t.url.startsWith('edge://'));
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
  const nav = await call('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
  if (nav.result && nav.result.errorText) { console.log('导航失败:', nav.result.errorText); process.exit(1); }
  await new Promise(r => setTimeout(r, 7000));

  const ev = async (expr) => {
    const r = await call('Runtime.evaluate', { expression: expr, returnByValue: true });
    return r.result && r.result.result ? r.result.result.value : null;
  };

  // 清弹窗再截图
  await ev(`document.querySelectorAll('.dyp,.liangpei-float').forEach(e=>e.remove())`);

  // 断言采集
  const state = await ev(`(function(){
    const cards = [...document.querySelectorAll('div.bg-white.rounded-2xl.border')];
    const virt = cards.filter(c => (c.textContent||'').includes('虚拟对比黑榜'));
    return JSON.stringify({
      total: cards.length,
      virtInDom: virt.length,
      virtHidden: virt.filter(c => c.classList.contains('sxg-vcard-gone')).length,
      virtVisible: virt.filter(c => getComputedStyle(c).display !== 'none').length,
      hasInput: !!document.getElementById('site-search-input')
    });
  })()`);
  console.log('验收状态:', state);

  // 全页截图
  const shot = await call('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT_DIR, 'vcr-accept-final.png'), Buffer.from(shot.result.data, 'base64'));
  console.log('截图: vcr-accept-final.png');

  // 滚到虚拟卡原位置附近（页中段）截一张可视证据
  await ev(`window.scrollTo(0, 1400)`);
  await new Promise(r => setTimeout(r, 800));
  await ev(`document.querySelectorAll('.dyp,.liangpei-float').forEach(e=>e.remove())`);
  const shot2 = await call('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT_DIR, 'vcr-accept-mid.png'), Buffer.from(shot2.result.data, 'base64'));
  console.log('截图: vcr-accept-mid.png');

  ws.close(); edge.kill(); server.close(); process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
