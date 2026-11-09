// 调试：清空搜索框后「肉眼可见的新加载动画」到底是什么（2026-11-05 站长报障）
const { cacheRoot, cacheDir } = require('./_cache-dir.cjs');
// v2：改用 CDP 真实键盘事件（focus / insertText / Backspace），并把探针放宽到
//     attributes + 全部新增节点 + 所有 computed animation 非 none 的元素。
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 19361;
const DBG = 19461;
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'shot-search-clear-before.png');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const ONLINE = process.argv.indexOf('--online') !== -1;
const URL = ONLINE ? 'https://dujeongil-galaxy.github.io/shuangxiugou/' : `http://127.0.0.1:${PORT}/?nocache=${Date.now()}`;

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
  if (!ONLINE) await new Promise(r => server.listen(PORT, r));
  const prof = path.join(cacheRoot(), 'edgeprof-scdbg' + Date.now());
  const edge = spawn(EDGE, [
    '--headless=new', '--disk-cache-size=1', `--remote-debugging-port=${DBG}`,
    '--no-first-run', '--window-size=1280,900', '--force-device-scale-factor=1',
    '--user-data-dir=' + prof, URL
  ], { stdio: 'ignore' });

  await sleep(ONLINE ? 11000 : 7000);
  const list = await (await fetch(`http://127.0.0.1:${DBG}/json`)).json();
  const page = list.find(t => t.type === 'page' && /shuangxiugou|127\.0\.0\.1/.test(t.url)) || list.find(t => t.type === 'page');
  const WebSocket = require('ws');
  const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
  await new Promise(r => ws.on('open', r));
  let mid = 0; const pending = new Map();
  ws.on('message', raw => { const m = JSON.parse(raw); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
  const call = (method, params) => new Promise(res => { const i = ++mid; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
  const ev = async (expr) => { const r = await call('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r.result && r.result.result && r.result.result.value; };

  await call('Runtime.enable');
  for (let i = 0; i < 50; i++) {
    const ready = await ev(`(()=>{const i=document.getElementById('site-search-input');const c=document.querySelector('div.bg-white.rounded-2xl.border');return !!(i&&c);})()`);
    if (ready) break;
    await sleep(500);
  }
  await ev(`(()=>{const d=document.querySelector('.dyp'); if(d) d.remove(); return 'ok';})()`);
  await ev(`(()=>{const i=document.getElementById('site-search-input'); if(i) i.scrollIntoView({block:'center'}); return 'ok';})()`);
  await sleep(400);

  // 探针：全部新增节点（不过滤，前 60）+ 属性变化 + 动画元素
  await ev(`(()=>{window.__dbgAdd=[];window.__dbgAttr=[];` +
    `var t0=performance.now();` +
    `var describe=function(n){if(n.nodeType!==1)return null;var cs=getComputedStyle(n);var r=n.getBoundingClientRect();` +
    `return {tag:n.tagName,id:n.id||'',cls:(n.className&&n.className.toString?n.className.toString():'').slice(0,110),` +
    `txt:(n.textContent||'').trim().slice(0,30),anim:cs.animationName,z:cs.zIndex,pos:cs.position,disp:cs.display,top:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height)};};` +
    `var o1=new MutationObserver(function(recs){recs.forEach(function(r){(r.addedNodes||[]).forEach(function(n){` +
    `var d=describe(n);if(d&&window.__dbgAdd.length<60)window.__dbgAdd.push(Object.assign({t:Math.round(performance.now()-t0)},d));});});});` +
    `o1.observe(document.body,{childList:true,subtree:true});` +
    `var o2=new MutationObserver(function(recs){recs.forEach(function(r){if(r.type!=='attributes')return;` +
    `var d=describe(r.target);if(d&&(/class|style/.test(r.attributeName))&&window.__dbgAttr.length<40)` +
    `window.__dbgAttr.push(Object.assign({t:Math.round(performance.now()-t0),attr:r.attributeName},d));});});` +
    `o2.observe(document.body,{attributes:true,subtree:true,attributeFilter:['class','style']});` +
    `window.__dbgObs=[o1,o2];return 'probe-on';})()`);

  // 真实 focus + 输入
  console.log('focus:', await ev(`(()=>{const i=document.getElementById('site-search-input'); if(!i)return 'no-input';i.focus();return document.activeElement===i;})()`));
  await call('Input.insertText', { text: '银行' });
  await sleep(900);
  console.log('搜索态:', await ev(`JSON.stringify({val:document.getElementById('site-search-input').value,cards:document.querySelectorAll('div.bg-white.rounded-2xl.border').length})`));

  const snap = `(function(){var out=[];` +
    `document.querySelectorAll('body *').forEach(function(e){var cs=getComputedStyle(e);` +
    `if(!cs.animationName||cs.animationName==='none')return;var r=e.getBoundingClientRect();` +
    `if(cs.display==='none'||cs.visibility==='hidden'||r.width===0||r.height===0)return;` +
    `if(out.length<20)out.push({tag:e.tagName,id:e.id,cls:(e.className&&e.className.toString?e.className.toString():'').slice(0,90),` +
    `txt:(e.textContent||'').trim().slice(0,24),anim:cs.animationName,z:cs.zIndex,pos:cs.position,top:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height)});});` +
    `var m=document.getElementById('sxg-flash-mask');var boot=document.querySelector('.sxg-boot');var ov=document.getElementById('sxg-loading');` +
    `return JSON.stringify({t:Math.round(performance.now()),animated:out,cards:document.querySelectorAll('div.bg-white.rounded-2xl.border').length,` +
    `boot:!!boot,overlay:!!ov,mask:m?{display:getComputedStyle(m).display,top:getComputedStyle(m).top}:null,flashing:document.body.classList.contains('sxg-filter-flashing')});})()`;

  // 真实键盘删除两字符（Backspace × 2）
  for (let k = 0; k < 2; k++) {
    await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 });
    await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 });
    await sleep(60);
  }
  console.log('删后输入框:', await ev(`document.getElementById('site-search-input').value`));

  const frames = [];
  const marks = [0, 30, 70, 120, 200, 350, 550, 900];
  let prev = 0;
  for (const ms of marks) {
    await sleep(ms - prev); prev = ms;
    frames.push(JSON.parse(await ev(snap)));
    if (ms === 70) {
      const cap = await call('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(OUT, Buffer.from(cap.result.data, 'base64'));
    }
  }
  frames.forEach(f => console.log('@', JSON.stringify(f)));
  console.log('新增节点:', JSON.stringify(await ev(`JSON.stringify(window.__dbgAdd)`)));
  console.log('属性变化:', JSON.stringify(await ev(`JSON.stringify(window.__dbgAttr)`)));

  ws.close(); edge.kill(); if (!ONLINE) server.close();
  try { fs.rmSync(prof, { recursive: true, force: true }); } catch (e) {}
  process.exit(0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
