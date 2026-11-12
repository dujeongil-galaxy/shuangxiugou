// 【本机专用 · 不挂 CI】真渲染验收（2026-11-12 15:48 站长两条指令）
//   ① 零跑卡备注栏：写入售后服务抖音短链、可点、同段有「内容真实性存疑，请注意甄别」，
//      且详情页/证据链不含该链接（页面侧只需确认卡面备注框里的 <a>）。
//   ② 视频区：新增「宁等网约车也不要坐出租车」，弹窗条目数 4、第 4 条文案正确。
// 产物落 D:/WorkBuddy-Cache/shots/leapmotor-note.png、video-modal-4.png
const { cacheRoot, cacheDir } = require('./_cache-dir.cjs');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const ROOT = path.resolve(__dirname, '..');
const HTTP_PORT = 8762;
const DBG_PORT = 9262;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const URL = `http://127.0.0.1:${HTTP_PORT}/`;
const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css',
  '.json':'application/json', '.png':'image/png', '.svg':'image/svg+xml', '.ico':'image/x-icon',
  '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.enc':'application/octet-stream' };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const fp = path.join(ROOT, p);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
    res.writeHead(404); return res.end('nf');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'text/plain' });
  fs.createReadStream(fp).pipe(res);
});

function wsConnect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.addEventListener('open', () => resolve(ws));
    ws.addEventListener('error', () => reject(new Error('ws err')));
  });
}
let msgId = 0;
function cdp(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    const handler = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.id === id) { ws.removeEventListener('message', handler); resolve(m); }
    };
    ws.addEventListener('message', handler);
    try { ws.send(JSON.stringify({ id, method, params })); } catch (e) { reject(e); }
  });
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function evalJson(ws, expr) {
  const m = await cdp(ws, 'Runtime.evaluate', {
    expression: `JSON.stringify((function(){try{${expr}}catch(e){return {error:String(e)}}})())`,
    returnByValue: true });
  try { return JSON.parse((m.result && (m.result.result || m.result).value) || 'null'); } catch (e) { return null; }
}
function shot(ws, name, clip) {
  return cdp(ws, 'Page.captureScreenshot', { format:'png', fromSurface:true,
    captureBeyondViewport: true, clip: Object.assign({ scale:1 }, clip) })
    .then(s => { if (s.result && s.result.data) {
      fs.writeFileSync(cacheDir(name), Buffer.from(s.result.data, 'base64')); } });
}

(async () => {
  await new Promise(r => server.listen(HTTP_PORT, r));
  const edge = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${DBG_PORT}`,
    '--user-data-dir=' + path.join(cacheRoot(), '.edge-lmnote-' + Date.now()),
    '--no-proxy-server', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });

  let targets;
  for (let i = 0; i < 40; i++) {
    try {
      targets = await new Promise((res, rej) => {
        http.get(`http://127.0.0.1:${DBG_PORT}/json/list`, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>res(JSON.parse(d))); }).on('error', rej);
      }); break;
    } catch (e) { await sleep(500); }
  }
  const t = (targets||[]).find(x => x.type === 'page' && x.webSocketDebuggerUrl) || (targets||[])[0];
  if (!t) { console.error('NO PAGE'); process.exit(1); }
  const ws = await wsConnect(t.webSocketDebuggerUrl);
  const errors = [];
  ws.addEventListener('message', (ev) => {
    try { const m = JSON.parse(ev.data);
      if (m.method === 'Runtime.exceptionThrown') errors.push(JSON.stringify(m.params.exceptionDetails));
    } catch (e) {}
  });
  await cdp(ws, 'Page.enable'); await cdp(ws, 'Runtime.enable');
  await cdp(ws, 'Emulation.setDeviceMetricsOverride', {
    width: 1440, height: 900, deviceScaleFactor: 1, mobile: false, screenWidth: 1440, screenHeight: 900 });
  await cdp(ws, 'Page.navigate', { url: URL });
  await sleep(2500);

  // 关掉首次访问的抖音弹窗，避免遮住卡片（老坑：.dyp 会接走真点击）
  await evalJson(ws, `var d=document.querySelector('.dyp'); if(d&&d.parentNode) d.parentNode.removeChild(d); return 1;`);

  // ---------- ① 零跑卡备注栏 ----------
  const noteProbe = `
    function root(el){ var c=el; for(var i=0;i<8&&c;i++){ if(c.classList&&c.classList.contains('bg-white')&&c.classList.contains('rounded-2xl')) return c; c=c.parentElement;} return null; }
    var hs=[].slice.call(document.querySelectorAll('h2,h3'));
    var h=hs.filter(function(x){return /^零跑汽车/.test((x.textContent||'').trim());})[0];
    if(!h) return {found:false};
    var card=root(h);
    if(!card) return {found:false, why:'no card root'};
    var box=card.querySelector('[data-sxg-cardnote]');
    var a=box?box.querySelector('a') : null;
    var r=card.getBoundingClientRect();
    return {found:true, hasBox:!!box,
      title: box ? (box.firstElementChild||{}).textContent : null,
      body: box ? box.textContent : null,
      anchor: a ? {href:a.getAttribute('href'), target:a.getAttribute('target'), rel:a.getAttribute('rel'), text:a.textContent} : null,
      anchorCount: box ? box.querySelectorAll('a').length : 0,
      rect:{x:Math.round(r.left+window.scrollX), y:Math.round(r.top+window.scrollY),
        w:Math.round(r.width), h:Math.round(r.height)},
      outLinks: card.querySelectorAll('a[href^="http"]').length};
  `;
  let note = null;
  for (let i = 0; i < 20; i++) {
    note = await evalJson(ws, noteProbe);
    if (note && note.found && note.hasBox) break;
    await sleep(500);
  }
  console.log('[零跑备注] ' + JSON.stringify(note));

  if (note && note.found && note.rect) {
    await evalJson(ws, `
      var hs=[].slice.call(document.querySelectorAll('h2,h3'));
      var h=hs.filter(function(x){return /^零跑汽车/.test((x.textContent||'').trim());})[0];
      if(h) h.scrollIntoView({block:'center'});
      return 1;`);
    await sleep(600);
    const n2 = await evalJson(ws, noteProbe);
    if (n2 && n2.rect) {
      await shot(ws, 'shots/leapmotor-note.png', {
        x: Math.max(0, n2.rect.x - 8), y: Math.max(0, n2.rect.y - 8),
        width: Math.min(1200, n2.rect.w + 16), height: Math.min(1000, n2.rect.h + 16) });
      note = n2;
    }
  }

  // ---------- ② 视频弹窗条目 ----------
  // 抖音弹窗 2.5s 会重新 build，截视频弹窗前再摘一次，否则它盖住视频弹窗
  await evalJson(ws, `window.scrollTo(0,0);
    var d=document.querySelector('.dyp'); if(d&&d.parentNode) d.parentNode.removeChild(d);
    var b=document.getElementById('sxg-video-btn'); if(b) b.click(); return 1;`);
  await sleep(600);
  const vid = await evalJson(ws, `
    var m=document.getElementById('sxg-video-modal'); if(!m) return {modal:false};
    var items=[].slice.call(m.querySelectorAll('.sxg-vd-item'));
    return {modal:true, hidden:m.hidden, count:items.length,
      names:items.map(function(it){return (it.querySelector('.sxg-vd-name')||{}).textContent;}),
      hrefs:items.map(function(it){return (it.querySelector('.sxg-vd-open')||{}).getAttribute && (it.querySelector('.sxg-vd-open')||{}).getAttribute('href');}),
      dead:items.map(function(it){return it.classList.contains('sxg-vd-item--dead');})};
  `);
  console.log('[视频弹窗] ' + JSON.stringify(vid));
  const cardRect = await evalJson(ws, `
    var c=document.querySelector('#sxg-video-modal .sxg-vd-card'); if(!c) return null;
    var r=c.getBoundingClientRect();
    return {x:Math.round(r.left), y:Math.round(r.top), w:Math.round(r.width), h:Math.round(r.height)};
  `);
  console.log('[弹窗卡片] ' + JSON.stringify(cardRect));
  // 模态层是 position:fixed，整屏截一张最稳（元素 clip 对 fixed 元素易裁空）
  await cdp(ws, 'Page.captureScreenshot', { format:'png', fromSurface:true,
    clip:{ x:0, y:0, width:1440, height:900, scale:1 } })
    .then(s => { if (s.result && s.result.data) {
      fs.writeFileSync(cacheDir('shots/video-modal-4.png'), Buffer.from(s.result.data, 'base64')); } });

  const noteOk = !!note && note.found && note.hasBox
    && note.anchor && note.anchor.href === 'https://v.douyin.com/n-xv654_mrI/'
    && note.anchor.target === '_blank' && /noopener/.test(note.anchor.rel || '')
    && /内容真实性存疑/.test(note.title || '')
    && /请注意甄别/.test(note.body || '') && /未点名品牌/.test(note.body || '');
  const vidOk = !!vid && vid.modal && vid.count === 4
    && vid.names[3] === '为什么说宁等网约车也不要坐出租车？'
    && vid.hrefs[3] === 'https://v.douyin.com/asAmGiTjrAU/'
    && vid.dead[1] === true && vid.dead[3] === false;
  console.log('PAGEERRORS=' + JSON.stringify(errors.slice(0, 8)));
  console.log('NOTE_OK=' + noteOk);
  console.log('VIDEO_OK=' + vidOk);
  try { ws.close(); } catch (e) {}
  edge.kill('SIGTERM'); server.close();
  process.exit((noteOk && vidOk && errors.length === 0) ? 0 : 1);
})().catch(e => { console.error('ERR', e); process.exit(1); });
