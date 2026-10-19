// 验证：点击投票弹窗右上角 ✕ 能关闭弹窗（真实鼠标事件）
const { execFile } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');

const REPO = 'C:/Users/dujeo/WorkBuddy/2026-10-13-03-23-38/shuangxiugou';
const PORT = 8941, DBG = 9222;

// 静态服务器
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
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
  const page = list.find(t => t.type === 'page' && /localhost|127\.0\.0\.1/.test(t.url)) || list.find(t => t.type === 'page');
  console.log('page url:', page.url);
  const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 });
  await new Promise(r => ws.on('open', r));
  await cdp(ws, 11, 'Runtime.enable', {});
  await cdp(ws, 12, 'Page.enable', {});
  await sleep(2500);

  const diag0 = await evalJs(ws, 19, `({bound: [...document.querySelectorAll('[data-sxg-bound]')].length, cfg: (window.customCardsConfig||[]).map(c=>c.id), voteBtns: [...document.querySelectorAll('button,a')].filter(b=>/员工投票/.test(b.textContent)).length})`);
  console.log('diag:', JSON.stringify(diag0));

  // 打开第一张自定义卡的投票弹窗（点击「员工投票」按钮）
  ws.on('message', (m) => { try { const o = JSON.parse(m); if (o.method === 'Runtime.consoleAPICalled') { const t = (o.params.args||[]).map(a=>a.value||a.description||'').join(' '); if (t) console.log('[console]', t); } } catch(e){} });

  await evalJs(ws, 14, `(()=>{const s=[];const o=Error.prepareStackTrace;try{const e=new Error();Error.captureStackTrace(e);e.stack;}catch(_){} return null;})()`);
  async function evalAwait(ws, id, expr) {
    const r = await cdp(ws, id, 'Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    return r.result.value;
  }
  const srcChk = await evalAwait(ws, 13, `(async () => { try { const t = await (await fetch('/custom-card-actions.js?v=' + Date.now())).text(); return {len: t.length, hasBox: t.indexOf("box.querySelectorAll('[data-vote-close]')") !== -1, hasBody: t.indexOf("body.querySelectorAll('[data-vote-close]')") !== -1}; } catch(e) { return {err: String(e)}; } })()`);
  console.log('srcCheck:', JSON.stringify(srcChk));
  await evalJs(ws, 15, `(()=>{const m=document.querySelector('.dyp.is-open .dyp__mask');if(m)m.click();const n=document.querySelector('.dyp--notice.is-open .dyp__mask');if(n)n.click();return !!document.querySelector('.dyp.is-open');})()`);
  await sleep(400);

  const voteBtnInfo = await evalJs(ws, 20, `(()=>{
    const card=document.getElementById('snack-card');
    const b=[...card.querySelectorAll('button,a')].filter(e=>/员工投票/.test(e.textContent))[0];
    if(!b) return 'no-btn';
    b.scrollIntoView({block:'center'});
    const r=b.getBoundingClientRect();
    const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
    return {tag:b.tagName,x:r.x+r.width/2,y:r.y+r.height/2,hit:hit?hit.tagName+'.'+(hit.className||'').toString().slice(0,40):null};
  })()`);
  if (voteBtnInfo === 'no-btn' || !voteBtnInfo) { console.log('FAIL: 找不到员工投票按钮', JSON.stringify(voteBtnInfo)); process.exit(1); }
  console.log('voteBtn:', JSON.stringify(voteBtnInfo));
  for (const type of ['mousePressed', 'mouseReleased']) {
    await cdp(ws, 21, 'Input.dispatchMouseEvent', { type, x: voteBtnInfo.x, y: voteBtnInfo.y, button: 'left', clickCount: 1 });
  }
  await sleep(1200);
  const opened = await evalJs(ws, 22, `({voteClose: !!document.querySelector('.sxg-vote-head [data-vote-close]'), layer: !!document.querySelector('.sxg-layer'), over: (()=>{const b=document.querySelector('.sxg-vote-head [data-vote-close]');if(!b)return null;const r=b.getBoundingClientRect();const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return hit?hit.tagName+'.'+(hit.className||''):null})(), sxgLayers: [...document.querySelectorAll('.sxg-layer')].map(l=>l.style.zIndex||getComputedStyle(l).zIndex), otherFixed: [...document.querySelectorAll('body>*')].filter(e=>{const s=getComputedStyle(e);return s.position==='fixed'&&Number(s.zIndex)>=9999}).map(e=>e.className+'@'+getComputedStyle(e).zIndex)})`);
  console.log('弹窗状态:', JSON.stringify(opened, null, 1));

  // 真实鼠标点击 ✕
  const hitDiag = await evalJs(ws, 28, `(()=>{const b=document.querySelector('.sxg-vote-head [data-vote-close]');const r=b.getBoundingClientRect();const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {rect:{x:r.x,y:r.y,w:r.width,h:r.height},hit:hit?hit.tagName+'.'+(hit.className||'').toString().slice(0,50):null};})()`);
  console.log('✕ hit-test:', JSON.stringify(hitDiag));
  await realClick(ws, '.sxg-vote-head [data-vote-close]');
  await sleep(800);
  const afterCloseRaw = await evalJs(ws, 123, `JSON.stringify({layerGone: !document.querySelector('.sxg-layer'), voteHeadGone: !document.querySelector('.sxg-vote-head')})`);
  const afterClose = { parsed: JSON.parse(afterCloseRaw) };
  console.log('点击✕后弹窗已关闭:', afterClose.parsed);

  // 再测：重开一次，验证「取消」仍能关（回归）
  const reopen = await evalJs(ws, 124, `(()=>{const card=document.getElementById('snack-card');const b=[...card.querySelectorAll('button,a')].filter(e=>/员工投票/.test(e.textContent))[0];if(!b)return null;b.scrollIntoView({block:'center'});const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  if (!reopen) { console.log('重开失败：找不到按钮'); process.exit(1); }
  for (const type of ['mousePressed', 'mouseReleased']) await cdp(ws, 25, 'Input.dispatchMouseEvent', { type, x: reopen.x, y: reopen.y, button: 'left', clickCount: 1 });
  await sleep(900);
  await realClick(ws, '.sxg-vote-body [data-vote-close]');
  await sleep(700);
  const afterCancel = await evalJs(ws, 126, `JSON.stringify({layerGone: !document.querySelector('.sxg-layer'), voteHeadGone: !document.querySelector('.sxg-vote-head')})`);
  console.log('回归-取消按钮仍可关闭:', afterCancel);

  const pass = opened.voteClose && opened.layer && afterClose.parsed.layerGone && afterClose.parsed.voteHeadGone && JSON.parse(afterCancel).layerGone;
  console.log('FINAL:', pass ? 'ALL-PASS' : 'HAS-FAIL');
  process.exit(0);
}
main().catch(e => { console.error('ERR', e.message); process.exit(1); });
