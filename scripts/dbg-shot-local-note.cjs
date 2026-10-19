// 截图：首页一张品牌卡，肉眼确认「本地存储说明」的实际渲染位置与观感
const { execFile } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');

const REPO = 'C:/Users/dujeo/WorkBuddy/2026-10-13-03-23-38/shuangxiugou';
const PORT = 8953, DBG = 9233;
const OUT = path.join(REPO, 'scripts', 'shot-local-note.png');

const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const srv = http.createServer((req, res) => {
  let p = req.url.split('?')[0]; if (p === '/') p = '/index.html';
  const f = path.join(REPO, decodeURIComponent(p));
  fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); res.end('nf'); return; } res.writeHead(200, { 'Content-Type': mime[path.extname(f)] || 'application/octet-stream' }); res.end(d); });
});
srv.listen(PORT, '127.0.0.1', () => console.log('up', PORT));

function cdp(ws, id, method, params) {
  return new Promise((res, rej) => {
    const onMsg = (m) => { try { const o = JSON.parse(m); if (o.id === id) { ws.off('message', onMsg); o.error ? rej(new Error(JSON.stringify(o.error))) : res(o.result); } } catch (e) {} };
    ws.on('message', onMsg); ws.send(JSON.stringify({ id, method, params: params || {} }));
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
  const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
  await new Promise(r => ws.on('open', r));
  await cdp(ws, 1, 'Runtime.enable', {});
  await sleep(2500);

  // 移除可能遮挡的抖音弹窗
  await evalJs(ws, 2, `(()=>{const d=document.querySelector('.dyp'); if(d) d.remove(); return 'ok';})()`);

  // 滚到第一张卡底部，让说明露出来
  await evalJs(ws, 3, `(()=>{const n=document.querySelector('.sxg-localnote'); if(!n) return 'none'; n.scrollIntoView({block:'center'}); return 'ok';})()`);
  await sleep(1200);

  const shot = await cdp(ws, 4, 'Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
  console.log('screenshot saved:', OUT);

  ws.close(); srv.close(); process.exit(0);
}
main().catch(e => { console.error('ERR', e.message); process.exit(1); });
