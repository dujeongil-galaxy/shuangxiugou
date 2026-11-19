// 【本机专用 · 不挂 CI】良配广告弹窗真渲染验收（2026-11-19）
// 验证：点击 CTA → 弹窗出现 → 复制口令 → 关闭按钮 / 遮罩 / ESC 三种关闭路径
// 产物落 D:/WorkBuddy-Cache/shots/
const { cacheRoot, cacheDir } = require('./_cache-dir.cjs');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const ROOT = path.resolve(__dirname, '..');
const HTTP_PORT = 8742;
const DBG_PORT = 9242;
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
    ws.addEventListener('error', () => reject(new Error('ws connect error ' + url)));
  });
}
let msgId = 0;
function cdp(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    const handler = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.id === id) {
        ws.removeEventListener('message', handler);
        if (m.error) console.error('CDP_ERR', method, JSON.stringify(m.error));
        resolve(m);
      }
    };
    ws.addEventListener('message', handler);
    try { ws.send(JSON.stringify({ id, method, params })); } catch (e) { reject(e); }
  });
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const evalExpr = (ws, expr) => cdp(ws, 'Runtime.evaluate', { expression: expr, returnByValue: true })
  .then(r => r.result && r.result.result ? r.result.result.value : null);

(async () => {
  await new Promise((r) => server.listen(HTTP_PORT, r));
  const edge = spawn(EDGE, [
    '--headless=new', `--remote-debugging-port=${DBG_PORT}`,
    '--user-data-dir=' + path.join(cacheRoot(), 'edge-profiles/lp-modal'),
    '--no-proxy-server', '--disable-gpu', 'about:blank'
  ], { stdio: 'ignore' });

  let ver;
  for (let i = 0; i < 30; i++) {
    try {
      ver = await new Promise((res, rej) => {
        http.get(`http://127.0.0.1:${DBG_PORT}/json/version`, (r) => {
          let d=''; r.on('data', c => d+=c); r.on('end', () => res(JSON.parse(d)));
        }).on('error', rej);
      }); break;
    } catch (e) { await sleep(500); }
  }
  let targets;
  for (let i = 0; i < 30; i++) {
    try {
      targets = await new Promise((res, rej) => {
        http.get(`http://127.0.0.1:${DBG_PORT}/json/list`, (r) => {
          let d=''; r.on('data', c => d+=c); r.on('end', () => res(JSON.parse(d)));
        }).on('error', rej);
      }); break;
    } catch (e) { await sleep(500); }
  }
  const pageTarget = (targets || []).find(t => t.type === 'page' && t.webSocketDebuggerUrl)
    || (targets || []).find(t => t.webSocketDebuggerUrl);
  if (!pageTarget) { console.error('NO PAGE TARGET'); process.exit(1); }
  const ws = await wsConnect(pageTarget.webSocketDebuggerUrl);
  const errors = [];
  ws.addEventListener('message', (ev) => {
    try { const m = JSON.parse(ev.data);
      if (m.method === 'Runtime.exceptionThrown') errors.push(JSON.stringify(m.params.exceptionDetails));
    } catch (e) {}
  });
  await cdp(ws, 'Page.enable');
  await cdp(ws, 'Runtime.enable');

  await cdp(ws, 'Page.navigate', { url: URL });
  await sleep(1500);
  // 隐藏抖音弹窗
  await evalExpr(ws, `var s=document.createElement('style');s.textContent='.dyp{display:none!important}';document.head.appendChild(s);`);

  // 桌面视口
  await cdp(ws, 'Emulation.setDeviceMetricsOverride', {
    width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
    screenWidth: 1440, screenHeight: 900
  });
  await sleep(800);

  // 1) 点击 CTA → 弹窗出现（copyText 内部是异步链，等微任务跑完）
  await evalExpr(ws, `(function(){
    var cta=document.querySelector('.lp-ad__cta');
    if(!cta) return {step:'no-cta'};
    cta.click();
    return {step:'clicked'};
  })()`);
  await sleep(300);
  const clickRes = await evalExpr(ws, `(function(){
    var mask=document.querySelector('.lp-modal__mask');
    var modal=document.querySelector('.lp-modal');
    return {
      mask:!!mask, modal:!!modal,
      maskVisible: mask?getComputedStyle(mask).display:null,
      modalVisible: modal?getComputedStyle(modal).display:null,
      stepsText: (modal && modal.querySelector('.lp-modal__steps')) ? modal.querySelector('.lp-modal__steps').innerText.replace(/\\s+/g,' ') : null,
      codeText: (modal && modal.querySelector('.lp-modal__code')) ? modal.querySelector('.lp-modal__code').innerText : null,
      copyBtn: !!(modal && modal.querySelector('.lp-modal__copy')),
      closeBtn: !!(modal && modal.querySelector('.lp-modal__close')),
    };
  })()`);
  console.log('CLICK_CTA=' + JSON.stringify(clickRes));

  // 截图：弹窗打开状态
  const shot1 = await cdp(ws, 'Page.captureScreenshot', {
    format: 'png', fromSurface: true, captureBeyondViewport: false,
    clip: { x: 0, y: 0, width: 1440, height: 900, scale: 1 }
  });
  if (shot1.result && shot1.result.data) {
    const out1 = cacheDir('shots/lp-modal-open.png');
    fs.writeFileSync(out1, Buffer.from(shot1.result.data, 'base64'));
    console.log('SHOT_OPEN=' + out1);
  }

  // 2) 复制口令按钮
  const copyRes = await evalExpr(ws, `(function(){
    var btn=document.querySelector('.lp-modal__copy');
    if(!btn) return {step:'no-copy-btn'};
    btn.click();
    var btn2=document.querySelector('.lp-modal__copy');
    return { step:'copied', text: btn2?btn2.textContent:null,
      feedback: !!(document.querySelector('.lp-modal__copy-done') || (btn2 && btn2.textContent.indexOf('已复制')>=0)) };
  })()`);
  console.log('COPY=' + JSON.stringify(copyRes));

  // 3) 关闭按钮（实际关闭机制：移除 .lp-modal 的 is-show 类 → display:none）
  const closeRes = await evalExpr(ws, `(function(){
    var b=document.querySelector('.lp-modal__close');
    if(!b) return {step:'no-close-btn'};
    b.click();
    var m=document.querySelector('.lp-modal');
    return { step:'closed-btn',
      modalDisplay: m?getComputedStyle(m).display:null,
      hasShow: m?m.classList.contains('is-show'):null };
  })()`);
  console.log('CLOSE_BTN=' + JSON.stringify(closeRes));

  // 4) 再次打开 → 遮罩关闭（copyText 异步链，等 300ms）
  await evalExpr(ws, `(function(){
    var cta=document.querySelector('.lp-ad__cta');
    if(!cta) return {step:'no-cta'};
    cta.click();
    return {step:'reopened'};
  })()`);
  await sleep(300);
  const open2 = await evalExpr(ws, `(function(){
    var m=document.querySelector('.lp-modal');
    return {step:'reopened',
      mask:!!document.querySelector('.lp-modal__mask'),
      modalDisplay: m?getComputedStyle(m).display:null,
      hasShow: m?m.classList.contains('is-show'):null};
  })()`);
  console.log('REOPEN=' + JSON.stringify(open2));

  const maskClose = await evalExpr(ws, `(function(){
    var mask=document.querySelector('.lp-modal__mask');
    if(!mask) return {step:'no-mask'};
    mask.dispatchEvent(new MouseEvent('click',{bubbles:true}));
    var m=document.querySelector('.lp-modal');
    return {step:'mask-click',
      modalDisplay: m?getComputedStyle(m).display:null,
      hasShow: m?m.classList.contains('is-show'):null};
  })()`);
  console.log('MASK_CLOSE=' + JSON.stringify(maskClose));

  // 5) 再次打开 → ESC 关闭
  await evalExpr(ws, `(function(){
    var cta=document.querySelector('.lp-ad__cta');
    if(!cta) return {step:'no-cta'};
    cta.click();
    return {step:'reopened2'};
  })()`);
  await sleep(300);
  const open3 = await evalExpr(ws, `(function(){
    var m=document.querySelector('.lp-modal');
    return {step:'reopened2',
      mask:!!document.querySelector('.lp-modal__mask'),
      modalDisplay: m?getComputedStyle(m).display:null,
      hasShow: m?m.classList.contains('is-show'):null};
  })()`);
  console.log('REOPEN2=' + JSON.stringify(open3));

  const escClose = await evalExpr(ws, `(function(){
    var m=document.querySelector('.lp-modal');
    if(!m) return {step:'no-modal'};
    var ev=new KeyboardEvent('keydown',{key:'Escape',bubbles:true});
    document.dispatchEvent(ev);
    return {step:'esc-key',
      modalDisplay: m?getComputedStyle(m).display:null,
      hasShow: m?m.classList.contains('is-show'):null};
  })()`);
  console.log('ESC_CLOSE=' + JSON.stringify(escClose));

  console.log('PAGEERRORS=' + JSON.stringify(errors.slice(0, 5)));
  try { ws.close(); } catch (e) {}
  edge.kill('SIGTERM'); server.close();
  process.exit(0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
