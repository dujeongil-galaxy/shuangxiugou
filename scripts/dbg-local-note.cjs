// 验证：首页所有品牌卡（内置 + 自定义）底部都有「数据仅保存在本地」说明，
// 且重复渲染不会叠加、所有卡片都覆盖到。
const { execFile } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');

const REPO = 'C:/Users/dujeo/WorkBuddy/2026-10-13-03-23-38/shuangxiugou';
const PORT = 8952, DBG = 9232;

const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const srv = http.createServer((req, res) => {
  let p = req.url.split('?')[0];
  if (p === '/') p = '/index.html';
  const f = path.join(REPO, decodeURIComponent(p));
  fs.readFile(f, (e, d) => {
    if (e) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': mime[path.extname(f)] || 'application/octet-stream' });
    res.end(d);
  });
});
srv.listen(PORT, '127.0.0.1', () => console.log('static server up on', PORT));

function cdp(ws, id, method, params) {
  return new Promise((res, rej) => {
    const onMsg = (m) => {
      try { const o = JSON.parse(m); if (o.id === id) { ws.off('message', onMsg); o.error ? rej(new Error(JSON.stringify(o.error))) : res(o.result); } } catch (e) {}
    };
    ws.on('message', onMsg);
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });
}
function evalJs(ws, id, expr) { return cdp(ws, id, 'Runtime.evaluate', { expression: expr, returnByValue: true }).then(r => r.result.value); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  execFile('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    ['--headless=new', '--disk-cache-size=1', `--remote-debugging-port=${DBG}`, '--user-data-dir=' + path.join(__dirname, 'edgeprof-' + Date.now()), '--window-size=1280,900', `http://127.0.0.1:${PORT}/?nocache=${Date.now()}`]);
  await sleep(7000);
  const list = await (await fetch(`http://127.0.0.1:${DBG}/json`)).json();
  const page = list.find(t => t.type === 'page' && /127\.0\.0\.1/.test(t.url)) || list.find(t => t.type === 'page');
  console.log('page url:', page.url);
  const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
  await new Promise(r => ws.on('open', r));
  await cdp(ws, 1, 'Runtime.enable', {});
  await sleep(2500);

  let ok = true;

  // 1) 卡片总数 vs 已挂说明的卡片数
  const stat = await evalJs(ws, 10, `JSON.stringify((()=>{
    const btns=[...document.querySelectorAll('button,a')].filter(b=>/员工投票/.test(b.textContent||''));
    const cards=[...new Set(btns.map(b=>b.closest('.bg-white.rounded-2xl')).filter(Boolean))];
    const notes=document.querySelectorAll('.sxg-localnote');
    return {
      cardCount: cards.length,
      noteCount: notes.length,
      cardsWithNote: cards.filter(c=>c.querySelector('.sxg-localnote')).length,
      dupCard: cards.filter(c=>c.querySelectorAll('.sxg-localnote').length>1).length
    };
  })())`);
  console.log('stats:', stat);
  const s = JSON.parse(stat);
  if (s.cardCount === 0) { console.log('FAIL: 页面上一张卡都没找到'); ok = false; }
  if (s.cardsWithNote !== s.cardCount) {
    console.log(`FAIL: ${s.cardCount} 张卡里只有 ${s.cardsWithNote} 张挂了说明`); ok = false;
  }
  if (s.dupCard > 0) { console.log(`FAIL: ${s.dupCard} 张卡重复挂了说明`); ok = false; }

  // 2) 文案内容正确 + 实际渲染可见（computed style）
  const detail = await evalJs(ws, 11, `JSON.stringify((()=>{
    const n=document.querySelector('.sxg-localnote');
    if(!n) return {found:false};
    const cs=getComputedStyle(n);
    const b=n.querySelector('b');
    return {
      found:true,
      text: n.textContent.replace(/\\s+/g,''),
      display: cs.display,
      visible: n.getBoundingClientRect().height > 0,
      bColor: b ? getComputedStyle(b).color : null,
      font: cs.fontSize
    };
  })())`);
  console.log('detail:', detail);
  const d = JSON.parse(detail);
  if (!d.found) { console.log('FAIL: 找不到 .sxg-localnote 节点'); ok = false; }
  else {
    if (!/仅保存在本地/.test(d.text)) { console.log('FAIL: 文案缺少「仅保存在本地」'); ok = false; }
    if (!/不上传云端/.test(d.text)) { console.log('FAIL: 文案缺少「不上传云端」'); ok = false; }
    if (!d.visible) { console.log('FAIL: 提示不可见（高度为 0）'); ok = false; }
    if (d.display !== 'flex') { console.log('FAIL: display 不是 flex，可能被覆盖'); ok = false; }
  }

  // 3) 重渲染幂等：再跑一次 init（模拟 MutationObserver 触发），不许叠加
  const before = s.noteCount;
  await evalJs(ws, 12, `window.scrollTo(0, 400); 'ok'`);
  await sleep(1200);
  const after = await evalJs(ws, 13, `document.querySelectorAll('.sxg-localnote').length`);
  console.log('note count before/after scroll:', before, after);
  if (after > before) { console.log('FAIL: 滚动重渲染后说明数量增加（非幂等）'); ok = false; }

  console.log(ok ? 'ALL-PASS' : 'FAIL');
  ws.close(); srv.close(); process.exit(ok ? 0 : 1);
}
main().catch(e => { console.error('ERR', e.message); process.exit(1); });
