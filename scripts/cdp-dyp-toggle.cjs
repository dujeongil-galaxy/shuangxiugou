// 【本机专用 · 不挂 CI】真渲染验收：首页弹窗「新版/旧版 转换按钮」（2026-11-12 §36u）
// 本地起静态服务 + 无头 Edge CDP，桌面(1440)与手机(390)分别独立加载：
//   1) 转换按钮可见（桌面在顶栏 / 手机进 #sxg-fab-dock）
//   2) 默认 new 版：弹窗 acts = [比亚迪] [理想L8] [站长随笔]，事实核查隐藏
//   3) 点转换按钮 → old 版：acts = [在抖音中观看] [事实核查] [站长随笔]
//   4) 截弹窗图，肉眼复核按钮文案与顺序
// 产物落 D:/WorkBuddy-Cache/shots/dyp-*.png
const { cacheRoot, cacheDir } = require('./_cache-dir.cjs');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const ROOT = path.resolve(__dirname, '..');
const HTTP_PORT = 8742;          // 静态服务端口（与调试端口分离）
const DBG_PORT = 9242;           // CDP 远程调试端口
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
function evalJson(ws, expr) {
  return cdp(ws, 'Runtime.evaluate', { expression: `JSON.stringify((function(){try{${expr}}catch(e){return {error:String(e)}}})())`, returnByValue: true })
    .then(m => { try { return JSON.parse((m.result && (m.result.result || m.result).value) || 'null'); } catch (e) { return null; } });
}
async function pollActsNew(ws, ms) {
  const deadline = Date.now() + ms;
  let last = null;
  while (Date.now() < deadline) {
    last = await evalJson(ws, `
      var acts=document.querySelector('.dyp__acts'); if(!acts) return {acts:false};
      var go=acts.querySelector('.dyp__go'), d2=acts.querySelector('.dyp__douyin2'),
          fc=acts.querySelector('.dyp__factcheck'), later=acts.querySelector('.dyp__later');
      return {acts:true, goText:go?go.textContent:null, d2Text:d2?d2.textContent:null,
        fcDisplay:fc?(fc.style.display||getComputedStyle(fc).display):null, fcText:fc?fc.textContent:null,
        laterText:later?later.textContent:null};
    `);
    if (last && last.acts && last.goText === '比亚迪·抖音短片') return last;
    await sleep(500);
  }
  return last;
}
function shot(ws, name, w, h) {
  return cdp(ws, 'Page.captureScreenshot', { format:'png', fromSurface:true,
    captureBeyondViewport:false, clip:{ x:0, y:0, width:w, height:h, scale:1 } })
    .then(s => { if (s.result && s.result.data) { const o = cacheDir(name); fs.writeFileSync(o, Buffer.from(s.result.data,'base64')); return o; } });
}

(async () => {
  await new Promise((r) => server.listen(HTTP_PORT, r));
  const edge = spawn(EDGE, [
    '--headless=new', `--remote-debugging-port=${DBG_PORT}`,
    '--user-data-dir=' + path.join(cacheRoot(), '.edge-dyp-toggle-' + Date.now()),
    '--no-proxy-server', '--disable-gpu', 'about:blank'
  ], { stdio: 'ignore' });

  let targets;
  for (let i = 0; i < 40; i++) {
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

  // ============ ① 桌面（先加载，>640 dock 不建，toggle 进顶栏） ============
  await cdp(ws, 'Emulation.setDeviceMetricsOverride', {
    width: 1440, height: 900, deviceScaleFactor: 1, mobile: false, screenWidth: 1440, screenHeight: 900
  });
  await cdp(ws, 'Page.navigate', { url: URL });
  await sleep(2500);
  const dToggle = await evalJson(ws, `
    var b=document.getElementById('sxg-dyp-toggle-btn'); if(!b) return {present:false};
    var cs=getComputedStyle(b); var hdr=b.closest && b.closest('header');
    return {present:true, text:b.textContent, display:cs.display, inHeader:!!hdr,
      prevId:b.previousSibling?b.previousSibling.id:null};
  `);
  console.log('[desktop] TOGGLE(new)=' + JSON.stringify(dToggle));
  const dActs = await pollActsNew(ws, 6000);
  console.log('[desktop] ACTS(new)=' + JSON.stringify(dActs));
  await shot(ws, 'shots/dyp-desktop-new.png', 1440, 900);
  // 点转换 → old 版
  const clickRes = await evalJson(ws, `
    var b=document.getElementById('sxg-dyp-toggle-btn'); if(!b) return {clicked:false};
    b.click();
    return {clicked:true, newText:b.textContent, version:window.localStorage.getItem('dyp_version_toggle_v1')};
  `);
  console.log('[desktop] CLICK=' + JSON.stringify(clickRes));
  await sleep(700);
  const dActsOld = await evalJson(ws, `
    var acts=document.querySelector('.dyp__acts'); if(!acts) return {acts:false};
    var go=acts.querySelector('.dyp__go'), d2=acts.querySelector('.dyp__douyin2'),
        fc=acts.querySelector('.dyp__factcheck'), later=acts.querySelector('.dyp__later');
    return {goText:go?go.textContent:null, d2Present:!!d2,
      fcDisplay:fc?(fc.style.display||getComputedStyle(fc).display):null, fcText:fc?fc.textContent:null,
      laterText:later?later.textContent:null};
  `);
  console.log('[desktop] ACTS(old)=' + JSON.stringify(dActsOld));
  await shot(ws, 'shots/dyp-desktop-old.png', 1440, 900);

  // ============ ② 手机（清 localStorage 重新加载，≤640 dock 建，toggle 进 dock） ============
  await evalJson(ws, `try{localStorage.removeItem('dyp_version_toggle_v1');localStorage.removeItem('dy_video_prompt_at');}catch(e){}`);
  await cdp(ws, 'Emulation.setDeviceMetricsOverride', {
    width: 390, height: 844, deviceScaleFactor: 1, mobile: true, screenWidth: 390, screenHeight: 844
  });
  await cdp(ws, 'Page.navigate', { url: URL });
  await sleep(2500);
  const mToggle = await evalJson(ws, `
    var b=document.getElementById('sxg-dyp-toggle-btn'); if(!b) return {present:false};
    var cs=getComputedStyle(b); var dock=document.getElementById('sxg-fab-dock');
    return {present:true, text:b.textContent, display:cs.display, offsetParentNull:b.offsetParent===null,
      inDock:!!(dock&&dock.contains(b)), inHeader:!!(b.closest&&b.closest('header'))};
  `);
  console.log('[mobile] TOGGLE(new)=' + JSON.stringify(mToggle));
  const mActs = await pollActsNew(ws, 6000);
  console.log('[mobile] ACTS(new)=' + JSON.stringify(mActs));
  await shot(ws, 'shots/dyp-mobile-new.png', 390, 844);

  const mOk = mToggle && mToggle.present && mToggle.display !== 'none' && mToggle.inDock === true
    && mToggle.text === '替换旧版'
    && mActs && mActs.goText === '比亚迪·抖音短片' && mActs.d2Text === '理想L8·抖音短片'
    && mActs.fcDisplay === 'none' && mActs.laterText === '站长随笔';
  const dOk = dToggle && dToggle.present && dToggle.text === '替换旧版' && dToggle.inHeader === true
    && dActs && dActs.goText === '比亚迪·抖音短片' && dActs.d2Text === '理想L8·抖音短片'
    && dActs.fcDisplay === 'none' && dActs.laterText === '站长随笔'
    && clickRes && clickRes.version === 'old' && clickRes.newText === '新版本'
    && dActsOld && dActsOld.goText === '在抖音中观看' && dActsOld.d2Present === false
    && dActsOld.fcDisplay !== 'none' && dActsOld.fcText === '事实核查';
  console.log('PAGEERRORS=' + JSON.stringify(errors.slice(0, 10)));
  console.log('MOBILE_OK=' + mOk);
  console.log('DESKTOP_OK=' + dOk);
  try { ws.close(); } catch (e) {}
  edge.kill('SIGTERM'); server.close();
  process.exit((mOk && dOk && errors.length === 0) ? 0 : 1);
})().catch(e => { console.error('ERR', e); process.exit(1); });
