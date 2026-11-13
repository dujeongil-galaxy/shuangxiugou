// 【本机专用 · 不挂 CI】真渲染验收（2026-11-14 站长指令）
//   站长：「还是放理想的证据链吧，备注那一栏也加入，文案你写」（抖音短链 nHGcAwzSXOU，
//   理想 L8 高速「方向盘突然拉不动」线索）。
//   ① 首页理想汽车卡的备注栏（data-sxg-news="lixiang-douyin"）真出现登记框；
//   ② 框内只有一条外链 = 白名单抖音短链，rel="nofollow noopener" + target="_blank"，
//      并写明「不作推广」「未核实」；卡面其余链接仍是站内详情页；
//   ③ 详情页 /brand/lixiang.html 的「证据来源」与「证据链」同步登记同一条链接。
// 桌面 1440 + 手机 390 双档各验一遍；产物落 <cache>/shots/lixiang-douyin-*.png
const { cacheRoot, cacheDir } = require('./_cache-dir.cjs');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const ROOT = path.resolve(__dirname, '..');
const HTTP_PORT = 8767;
const DBG_PORT = 9267;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = `http://127.0.0.1:${HTTP_PORT}`;
const NEW_LINK = 'https://v.douyin.com/nHGcAwzSXOU/';
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

// 首页理想卡探针：卡根 → 登记框 → 框内外链 / 卡内其它外链
const PROBE = `
  function rootOf(el){ var c=el; for(var i=0;i<10&&c;i++){
    if(c.classList&&c.classList.contains('bg-white')&&c.classList.contains('rounded-2xl')) return c;
    c=c.parentElement;} return null; }
  var hs=[].slice.call(document.querySelectorAll('h2,h3'));
  var h=hs.filter(function(x){return /^理想汽车/.test((x.textContent||'').trim());})[0];
  if(!h) return {found:false};
  var card=rootOf(h);
  if(!card) return {found:false, why:'no card root'};
  var box=card.querySelector('[data-sxg-news="lixiang-douyin"]');
  var exts= box? [].slice.call(box.querySelectorAll('a[href^="http"]')) : [];
  var r=card.getBoundingClientRect();
  return {found:true, hasBox:!!box,
    head: box? (box.querySelector('div,h3,h4,p')? (box.querySelector('div,h3,h4,p').textContent||''):''):null,
    boxText: box? (box.textContent||''):null,
    exts: exts.map(function(a){return {href:a.getAttribute('href'), target:a.getAttribute('target'),
      rel:a.getAttribute('rel'), text:(a.textContent||'')};}),
    cardOutLinks: [].slice.call(card.querySelectorAll('a[href^="http"]')).map(function(x){return x.getAttribute('href');}),
    backToDetail: !!card.querySelector('a[href="./brand/lixiang.html"]'),
    rect:{x:Math.round(r.left+window.scrollX), y:Math.round(r.top+window.scrollY),
      w:Math.round(r.width), h:Math.round(r.height)}};
`;

async function verifyViewport(ws, label, w, h, mobile) {
  await cdp(ws, 'Emulation.setDeviceMetricsOverride', {
    width: w, height: h, deviceScaleFactor: 1, mobile: mobile, screenWidth: w, screenHeight: h });
  await cdp(ws, 'Page.navigate', { url: BASE + '/' });
  await sleep(2600);
  // 关掉首次访问的抖音弹窗（老坑：.dyp 会接走真点击、遮住卡片）
  await evalJson(ws, `var d=document.querySelector('.dyp'); if(d&&d.parentNode) d.parentNode.removeChild(d); return 1;`);

  let info = null;
  for (let i = 0; i < 16; i++) {
    info = await evalJson(ws, PROBE);
    if (info && info.found && info.hasBox) break;
    if (i === 4) {
      await evalJson(ws, `
        var inp=document.querySelector('input[type="search"],input[placeholder*="搜索"],#sxg-search');
        if(!inp) return 0;
        inp.focus(); inp.value='理想';
        inp.dispatchEvent(new Event('input',{bubbles:true}));
        inp.dispatchEvent(new KeyboardEvent('keyup',{bubbles:true,key:'想'}));
        return 1;`);
    }
    await sleep(500);
  }
  console.log(`[${label}] ` + JSON.stringify(info && {found:info.found, hasBox:info.hasBox,
    exts:info.exts, cardOutLinks:info.cardOutLinks, backToDetail:info.backToDetail}));

  if (info && info.found && info.rect) {
    await evalJson(ws, `
      var hs=[].slice.call(document.querySelectorAll('h2,h3'));
      var h=hs.filter(function(x){return /^理想汽车/.test((x.textContent||'').trim());})[0];
      if(h) h.scrollIntoView({block:'center'});
      return 1;`);
    await sleep(600);
    const n2 = await evalJson(ws, PROBE);
    if (n2 && n2.rect) {
      await shot(ws, `shots/lixiang-douyin-card-${label}.png`, {
        x: Math.max(0, n2.rect.x - 8), y: Math.max(0, n2.rect.y - 8),
        width: Math.min(w - 10, n2.rect.w + 16), height: Math.min(1400, n2.rect.h + 16) });
      info = n2;
    }
  }
  const boxText = (info && info.boxText) || '';
  const exts = (info && info.exts) || [];
  const structOk = !!info && info.found && info.hasBox && info.backToDetail === true;
  const linkOk = exts.length === 1 && exts[0].href === NEW_LINK
    && exts[0].target === '_blank' && /nofollow/.test(exts[0].rel || '')
    && /noopener/.test(exts[0].rel || '');
  const copyOk = /不作推广/.test(boxText) && /未核实/.test(boxText)
    && /方向盘/.test(boxText) && /不作事实认定/.test(boxText) && /B 级/.test(boxText);
  const noOther = (info && info.cardOutLinks || []).every((u) => u === NEW_LINK);
  return { structOk, linkOk, copyOk, noOther };
}

async function verifyDetail(ws) {
  await cdp(ws, 'Page.navigate', { url: BASE + '/brand/lixiang.html' });
  await sleep(1500);
  const d = await evalJson(ws, `
    var t=document.body.textContent||'';
    var as=[].slice.call(document.querySelectorAll('a[href^="http"]'))
      .filter(function(a){return /nHGcAwzSXOU/.test(a.getAttribute('href'));});
    var hit=as.filter(function(a){return a.getAttribute('href')==='https://v.douyin.com/nHGcAwzSXOU/';});
    return {count:hit.length,
      rel: hit[0]? hit[0].getAttribute('rel'):null,
      target: hit[0]? hit[0].getAttribute('target'):null,
      hasSource: /抖音媒体原创/.test(t),
      hasChain: /线索登记（不计入评级）/.test(t),
      hasBoundary: /不作事实认定/.test(t)};`);
  console.log('[详情页] ' + JSON.stringify(d));
  return !!d && d.count === 1 && d.rel === 'nofollow noopener' && d.target === '_blank'
    && d.hasSource && d.hasChain && d.hasBoundary;
}

(async () => {
  fs.mkdirSync(cacheDir('shots'), { recursive: true });
  await new Promise(r => server.listen(HTTP_PORT, r));
  const edge = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${DBG_PORT}`,
    '--user-data-dir=' + path.join(cacheRoot(), '.edge-lixiangdouyin-' + Date.now()),
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

  const desk = await verifyViewport(ws, 'desktop', 1440, 900, false);
  const mob = await verifyViewport(ws, 'mobile', 390, 844, true);
  const detailOk = await verifyDetail(ws);

  const ALL = desk.structOk && desk.linkOk && desk.copyOk && desk.noOther
    && mob.structOk && mob.linkOk && mob.copyOk && mob.noOther && detailOk;
  console.log('DESKTOP_STRUCT_OK=' + desk.structOk + ' DESKTOP_LINK_OK=' + desk.linkOk
    + ' DESKTOP_COPY_OK=' + desk.copyOk + ' DESKTOP_NO_OTHER_LINK=' + desk.noOther);
  console.log('MOBILE_STRUCT_OK=' + mob.structOk + ' MOBILE_LINK_OK=' + mob.linkOk
    + ' MOBILE_COPY_OK=' + mob.copyOk + ' MOBILE_NO_OTHER_LINK=' + mob.noOther);
  console.log('DETAIL_OK=' + detailOk);
  console.log('PAGEERRORS=' + JSON.stringify(errors.slice(0, 8)));
  console.log('ALL_OK=' + ALL);
  try { ws.close(); } catch (e) {}
  edge.kill('SIGTERM'); server.close();
  process.exit(ALL && errors.length === 0 ? 0 : 1);
})().catch(e => { console.error('ERR', e); process.exit(1); });
