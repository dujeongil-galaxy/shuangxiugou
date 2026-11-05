// 【本机专用 · 不挂 CI】依赖本机无头 Edge 绝对路径，CI runner 无此文件；真渲染验收只在本机跑（verify §21o 咬此标记）。
// 真渲染验收：评级过滤切换 0.5s 高度模糊闪屏（filter-flash.js）
// 照 dbg-shot-local-note.cjs / shot-ai-chat.cjs 的 CDP 纪律：
// 无头 Edge + CDP；先清抖音弹窗 .dyp；点击「A 级」后立刻验 body.sxg-filter-flashing
// 与卡片 computed filter=blur(16px)，并截图；再等 600ms 验闪屏已消除。
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 19331;
const DBG = 19431;
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'shot-filter-flash.png');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

const server = http.createServer((req, res) => {
  let p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (p.endsWith('/') || p.endsWith('\\')) p = path.join(p, 'index.html');
  fs.readFile(p, (err, data) => {
    if (err) { res.writeHead(404); res.end('nf'); return; }
    const ext = path.extname(p);
    const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' }[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime + '; charset=utf-8' });
    res.end(data);
  });
});

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const edge = spawn(EDGE, [
    '--headless=new', '--disk-cache-size=1', `--remote-debugging-port=${DBG}`,
    '--no-first-run', '--window-size=1280,900',
    '--user-data-dir=' + path.join(__dirname, 'edgeprof-ff' + Date.now()),
    `http://127.0.0.1:${PORT}/?nocache=${Date.now()}`
  ], { stdio: 'ignore' });

  await sleep(7000);
  const list = await (await fetch(`http://127.0.0.1:${DBG}/json`)).json();
  const page = list.find(t => t.type === 'page' && /127\.0\.0\.1/.test(t.url)) || list.find(t => t.type === 'page');
  const WebSocket = require('ws');
  const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
  await new Promise(r => ws.on('open', r));
  let mid = 0; const pending = new Map();
  ws.on('message', raw => { const m = JSON.parse(raw); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
  const call = (method, params) => new Promise(res => { const i = ++mid; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
  const ev = async (expr) => { const r = await call('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r.result && r.result.result && r.result.result.value; };

  await call('Runtime.enable');
  // 等 React 挂载 + 评级按钮出现
  for (let i = 0; i < 30; i++) {
    const ready = await ev(`(()=>{const c=document.querySelector('div.bg-white.rounded-2xl.border');const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').trim()==='A 级');return !!(c&&b);})()`);
    if (ready) break;
    await sleep(500);
  }
  // 清抖音弹窗
  await ev(`(()=>{const d=document.querySelector('.dyp'); if(d) d.remove(); return 'ok';})()`);

  // 先把「A 级」按钮滚到视口中部，让「过滤条在上方、结果卡片在下方」同框
  await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').trim()==='A 级'); if(b) b.scrollIntoView({block:'center'}); return 'ok';})()`);
  await sleep(400);

  // 点击「A 级」评级按钮
  const clicked = await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').trim()==='A 级'); if(!b) return {found:false}; b.click(); return {found:true};})()`);
  console.log('click A 级:', JSON.stringify(clicked));

  // 立刻（~150ms）验 frosted 遮罩状态
  await sleep(150);
  const during = await ev(`JSON.stringify({
    flashing: document.body.classList.contains('sxg-filter-flashing'),
    cardFilter: (()=>{const c=document.querySelector('div.bg-white.rounded-2xl.border'); return c?getComputedStyle(c).filter:'no-card';})(),
    mask: (()=>{const m=document.getElementById('sxg-flash-mask'); if(!m) return {exists:false}; const cs=getComputedStyle(m); const mr=m.getBoundingClientRect(); const btn=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').trim()==='A 级'); const cards=[...document.querySelectorAll('div.bg-white.rounded-2xl.border')]; return {exists:true, display:cs.display, zIndex:cs.zIndex, backdrop:cs.backdropFilter||cs.webkitBackdropFilter, top:cs.top, btnBottom: btn?btn.getBoundingClientRect().bottom:null, cardsBelow: cards.filter(c=>c.getBoundingClientRect().top>=mr.top-5).length, allCardsBlurred: cards.every(c=>/blur/.test(getComputedStyle(c).filter))};})()
  })`);
  console.log('点击后 150ms（应 mask 显示 + backdrop blur(36px) + 卡片 blur(20px)）:', during);

  // 截图（闪屏中，不滚动）
  const cap = await call('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(OUT, Buffer.from(cap.result.data, 'base64'));
  console.log('截图已存:', OUT);

  // 等 600ms（>500ms）验遮罩已消除
  await sleep(600);
  const after = await ev(`JSON.stringify({
    flashing: document.body.classList.contains('sxg-filter-flashing'),
    cardFilter: (()=>{const c=document.querySelector('div.bg-white.rounded-2xl.border'); return c?getComputedStyle(c).filter:'no-card';})(),
    maskDisplay: (()=>{const m=document.getElementById('sxg-flash-mask'); return m?getComputedStyle(m).display:'no-mask';})()
  })`);
  console.log('600ms 后（应 mask 隐藏、无 blur、A 级卡片可见）:', after);

  const d = JSON.parse(during), a = JSON.parse(after);
  const pass = clicked.found
    && d.flashing === true
    && d.mask && d.mask.exists && d.mask.display === 'block'
    && /blur\(36px\)/.test(d.mask.backdrop)
    && d.mask.zIndex === '8000'
    && /blur\(20px\)/.test(d.cardFilter)
    && d.mask.btnBottom <= parseFloat(d.mask.top) + 2   // 过滤按钮在遮罩之上（清晰）
    && d.mask.cardsBelow >= 1                            // 遮罩之下确有品牌卡被覆盖
    && d.mask.allCardsBlurred === true                   // 所有卡片（含遮罩之上的汇总卡）均被模糊
    && a.flashing === false
    && a.maskDisplay === 'none'
    && !/blur/.test(a.cardFilter);
  console.log('验收状态:', pass ? 'PASS' : 'FAIL');

  ws.close(); edge.kill(); server.close();
  try { fs.rmSync(path.join(__dirname, 'edgeprof-ff' + ''), { recursive: true, force: true }); } catch (e) {}
  process.exit(pass ? 0 : 1);
})().catch(e => { console.error('ERR', e); process.exit(1); });
