// 验证：notes.html 的「TOP」回顶按钮存在，且真实鼠标点击后页面滚回顶部
const { execFile } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');

const REPO = 'C:/Users/dujeo/WorkBuddy/2026-10-13-03-23-38/shuangxiugou';
const PORT = 8943, DBG = 9224;

const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const srv = http.createServer((req, res) => {
  let p = req.url.split('?')[0];
  if (p === '/') p = '/notes.html';
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
    const onMsg = (m) => { try { const o = JSON.parse(m); if (o.id === id) { ws.off('message', onMsg); o.error ? rej(new Error(JSON.stringify(o.error))) : res(o.result); } } catch (e) {} };
    ws.on('message', onMsg);
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });
}
function evalJs(ws, id, expr) { return cdp(ws, id, 'Runtime.evaluate', { expression: expr, returnByValue: true }).then(r => r.result.value); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function realClick(ws, sel) {
  const rect = await evalJs(ws, 10, `(()=>{const el=document.querySelector(${JSON.stringify(sel)});if(!el)return null;const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  if (!rect) throw new Error('no rect for ' + sel);
  for (const type of ['mousePressed', 'mouseReleased']) {
    await cdp(ws, 11, 'Input.dispatchMouseEvent', { type, x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
  }
}

async function main() {
  execFile('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    ['--headless=new', '--disk-cache-size=1', `--remote-debugging-port=${DBG}`, '--user-data-dir=' + path.join(__dirname, 'edgeprof-' + Date.now()), '--window-size=1280,900', `http://127.0.0.1:${PORT}/?nocache=${Date.now()}`]);
  await sleep(5000);
  const list = await (await fetch(`http://127.0.0.1:${DBG}/json`)).json();
  const page = list.find(t => t.type === 'page' && /127\.0\.0\.1/.test(t.url)) || list.find(t => t.type === 'page');
  console.log('page url:', page.url);
  const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
  await new Promise(r => ws.on('open', r));
  await cdp(ws, 11, 'Runtime.enable', {});
  await cdp(ws, 12, 'Page.enable', {});
  await sleep(2000);

  let ok = true;
  const exists = await evalJs(ws, 20, `!!document.getElementById('sxg-top-btn')`);
  console.log('btnExists:', exists);
  if (!exists) ok = false;

  const bottom = await evalJs(ws, 21, `(()=>{const b=document.getElementById('sxg-top-btn');if(!b)return null;const s=getComputedStyle(b);return {bottom:s.bottom,right:s.right,pos:s.position,z:s.zIndex,txt:b.textContent};})()`);
  console.log('style:', JSON.stringify(bottom));

  await evalJs(ws, 22, `window.scrollTo({top:600,behavior:'auto'}); 'ok'`);
  await sleep(600);
  const before = await evalJs(ws, 23, `Math.round(window.scrollY)`);
  console.log('scrollY before click:', before);

  await realClick(ws, '#sxg-top-btn');
  await sleep(1500);
  const after = await evalJs(ws, 24, `Math.round(window.scrollY)`);
  console.log('scrollY after click:', after);

  if (before < 100) { console.log('FAIL: 页面没能滚动下去，测试无效'); ok = false; }
  if (after > 5) { console.log('FAIL: 点击后没有回到顶部'); ok = false; }

  console.log(ok ? 'ALL-PASS' : 'FAIL');
  ws.close(); srv.close(); process.exit(ok ? 0 : 1);
}
main().catch(e => { console.error('ERR', e.message); process.exit(1); });
