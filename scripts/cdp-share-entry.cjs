// 【本机专用 · 不挂 CI】真渲染验收：顶栏「分享本站」入口 + 匿名邮箱 LOGO（§36w）
// 背景：2026-11-12 站长要求右上角加一枚带 LOGO 的「分享本站」，并给「匿名邮箱」
//       文字前补一个 LOGO。本脚本在真 Edge（无头）里逐档验收：
//   1) 五档宽度 1440 / 900 / 660 / 390 / 360 各加载一次，六枚顺序、宽度、可见性
//   2) 分享按钮内联 SVG 真渲染可见（display/尺寸），中心点 elementFromPoint 命中自身
//      （防「按钮在但被别的浮层盖住」这类假通过）
//   3) 点一下分享按钮，分享卡片必须真的弹出来（.sxg-share-mask.on）、平台 14 项
//   4) ≤640px 分享本站留顶栏（四枚之一）；匿名邮箱 + Login GitHub 进 #sxg-fab-dock
//   5) 无横向溢出、无按钮重叠、无页面异常
// 产物落 cacheDir：share-entry-*.png
const { cacheRoot, cacheDir } = require('./_cache-dir.cjs');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const ROOT = path.resolve(__dirname, '..');
const HTTP_PORT = 8745;
const DBG_PORT = 9245;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const URL = `http://127.0.0.1:${HTTP_PORT}/`;

const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css',
  '.json':'application/json', '.png':'image/png', '.svg':'image/svg+xml', '.ico':'image/x-icon',
  '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.enc':'application/octet-stream' };

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
  return cdp(ws, 'Runtime.evaluate', {
    expression: `JSON.stringify((function(){try{${expr}}catch(e){return {error:String(e)}}})())`,
    returnByValue: true, awaitPromise: true
  }).then(m => {
    const raw = (m.result && (m.result.result || m.result).value);
    try { return JSON.parse(raw || 'null'); } catch (e) { return null; }
  });
}
function shotClip(ws, name, x, y, w, h, scale) {
  return cdp(ws, 'Page.captureScreenshot', { format:'png', fromSurface:true, captureBeyondViewport:false,
    clip:{ x, y, width:w, height:h, scale: scale || 1 } })
    .then(s => { if (s.result && s.result.data) { const o = cacheDir(name);
      fs.writeFileSync(o, Buffer.from(s.result.data,'base64')); return o; } return null; });
}

// 采集顶栏 / dock 的结构事实
const PROBE = `
  function rectOf(el){ if(!el) return null; var r=el.getBoundingClientRect();
    return {x:Math.round(r.left),y:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height),
            right:Math.round(r.right),bottom:Math.round(r.bottom)}; }
  function txt(el){ return el ? (el.innerText||'').trim().replace(/\\s+/g,' ') : null; }
  var out = {vw: window.innerWidth, vh: window.innerHeight, narrow: window.innerWidth<=640};
  var hdr = document.querySelector('header');
  var share = document.getElementById('sxg-share-entry-btn');
  var anon  = document.getElementById('sxg-anon-mail-btn');

  // 顶栏按钮顺序（DOM 序，只取真有文字的）
  out.headerOrder = hdr ? [].map.call(hdr.querySelectorAll('a,button'), function(el){
    return txt(el); }).filter(Boolean) : null;

  out.share = share ? {
    slot: share.getAttribute('data-sxg-share-slot'),
    rect: rectOf(share),
    txt: txt(share),
    hidden: getComputedStyle(share).display === 'none',
    svgCount: share.querySelectorAll('svg').length,
    svgVisible: (function(){ var s=share.querySelector('svg'); if(!s) return false;
      var cs=getComputedStyle(s); var r=s.getBoundingClientRect();
      return cs.display!=='none' && cs.visibility!=='hidden' && r.width>=8 && r.height>=8; })(),
    // 中心点命中自身：防被浮层盖住 / 被裁到视口外
    hit: (function(){ var r=share.getBoundingClientRect();
      if (r.width<1||r.height<1) return false;
      var el=document.elementFromPoint(r.left+r.width/2, r.top+r.height/2);
      return !!el && (el===share || share.contains(el)); })(),
    inViewport: (function(){ var r=share.getBoundingClientRect();
      return r.left>=-1 && r.right<=window.innerWidth+1 && r.top>=-1 && r.bottom<=window.innerHeight+1; })()
  } : null;

  out.anon = anon ? {
    slot: anon.getAttribute('data-sxg-anon-slot'),
    rect: rectOf(anon),
    txt: txt(anon),
    hidden: getComputedStyle(anon).display === 'none',
    svgCount: anon.querySelectorAll('svg').length,
    svgVisible: (function(){ var s=anon.querySelector('svg'); if(!s) return false;
      var cs=getComputedStyle(s); var r=s.getBoundingClientRect();
      return cs.display!=='none' && cs.visibility!=='hidden' && r.width>=8 && r.height>=8; })()
  } : null;

  // 桌面：两者在顶栏内的相对位置（分享必须紧跟在匿名邮箱之后）
  if (hdr && share && anon && hdr.contains(share) && hdr.contains(anon)) {
    out.afterAnon = !!(anon.compareDocumentPosition(share) & Node.DOCUMENT_POSITION_FOLLOWING);
    var between = [].filter.call(hdr.querySelectorAll('a,button'), function(el){
      if (!txt(el)) return false;
      return (anon.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)
          && (el.compareDocumentPosition(share) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    out.betweenAnonAndShare = between.map(txt);
  }

  // 重叠检测：顶栏 + dock 内所有可见按钮两两求交
  function boxesOf(box){ return box ? [].filter.call(box.querySelectorAll('a,button'), function(el){
    var r=el.getBoundingClientRect(); var cs=getComputedStyle(el);
    return r.width>8 && r.height>8 && cs.display!=='none' && cs.visibility!=='hidden';
  }).map(function(el){ return {t:txt(el), r:el.getBoundingClientRect()}; }) : []; }
  var all = boxesOf(hdr).concat(boxesOf(document.getElementById('sxg-fab-dock')));
  var ov=[];
  for (var i=0;i<all.length;i++) for (var j=i+1;j<all.length;j++){
    var a=all[i].r, b=all[j].r;
    var ox=Math.min(a.right,b.right)-Math.max(a.left,b.left);
    var oy=Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top);
    if (ox>2 && oy>2) ov.push(all[i].t + ' x ' + all[j].t);
  }
  out.overlaps = ov;

  var dock = document.getElementById('sxg-fab-dock');
  out.dock = dock ? {
    rect: rectOf(dock),
    items: [].map.call(dock.children, function(el){
      var r=el.getBoundingClientRect();
      return {id: el.id||'', label: el.getAttribute('data-sxg-dock-label')||'', txt: txt(el),
        w: Math.round(r.width), h: Math.round(r.height), shown: getComputedStyle(el).display!=='none'};
    })
  } : null;

  out.docOverflowX = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
  out.shareApi = !!(window.SXGShare && typeof window.SXGShare.open === 'function');
  return out;
`;

// 点分享按钮，验弹窗真的出来（不改动页面其它状态）
const CLICK = `
  var btn = document.getElementById('sxg-share-entry-btn');
  if (!btn) return {ok:false, why:'no-button'};
  btn.click();
  var mask = document.getElementById('sxg-share-mask');
  var on = !!mask && mask.classList.contains('on');
  var sd = mask ? mask.querySelectorAll('.sxg-sd').length : 0;
  var sf = mask ? mask.querySelectorAll('.sxg-sf').length : 0;
  var total = sd + sf;
  var close = mask ? mask.querySelector('.sxg-share-x') : null;
  if (close) close.click();
  return {ok:true, opened:on, sd:sd, sf:sf, total:total, closed: !mask || !mask.classList.contains('on')};
`;

(async () => {
  await new Promise((r) => server.listen(HTTP_PORT, r));
  const edge = spawn(EDGE, [
    '--headless=new', `--remote-debugging-port=${DBG_PORT}`,
    '--user-data-dir=' + path.join(cacheRoot(), '.edge-share-entry-' + Date.now()),
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

  const VIEWPORTS = [
    { name:'1440', w:1440, h:900, mobile:false },
    { name:'900',  w:900,  h:800, mobile:false },
    { name:'660',  w:660,  h:900, mobile:true  },
    { name:'390',  w:390,  h:844, mobile:true  },
    { name:'360',  w:360,  h:800, mobile:true  }
  ];

  const report = [];
  for (const vp of VIEWPORTS) {
    await cdp(ws, 'Emulation.setDeviceMetricsOverride', {
      width: vp.w, height: vp.h, deviceScaleFactor: 1, mobile: vp.mobile,
      screenWidth: vp.w, screenHeight: vp.h
    });
    await cdp(ws, 'Page.navigate', { url: URL });
    await sleep(3200);
    const p = await evalJson(ws, PROBE);
    const c = await evalJson(ws, CLICK);
    await sleep(300);
    const out = { vp: vp.name, probe: p, click: c };
    if (vp.w > 640) {
      await shotClip(ws, 'share-entry-desktop-' + vp.name + '.png', Math.max(0, vp.w - 640), 24, 640, 72, 2);
    } else {
      await shotClip(ws, 'share-entry-mobile-' + vp.name + '.png', 0, 0, vp.w, vp.h, 1);
    }
    report.push(out);
    console.log('[' + vp.name + '] ' + JSON.stringify(out));
  }

  // ---------------- 判红 ----------------
  const EXPECT_DESKTOP = ['+ 提交数据 / 申诉','★ Star on GitHub','☕ 打赏赞助','🔑 Login GitHub','匿名邮箱','分享本站'];
  const fails = [];
  const need = (cond, msg) => { if (!cond) fails.push(msg); };

  for (const r of report) {
    const p = r.probe || {}, c = r.click || {}, w = parseInt(r.vp, 10);
    need(!p.error, r.vp + ': probe error ' + p.error);
    need(p.shareApi === true, r.vp + ': window.SXGShare.open 未就绪');
    need(!!p.share, r.vp + ': 找不到 #sxg-share-entry-btn');
    need(p.docOverflowX === false, r.vp + ': 页面横向溢出');
    need(Array.isArray(p.overlaps) && p.overlaps.length === 0, r.vp + ': 按钮重叠 ' + JSON.stringify(p.overlaps));
    need(c.ok === true && c.opened === true, r.vp + ': 点分享按钮没弹出分享卡片');
    need(c.total === 14 && c.sd === 5 && c.sf === 9,
      r.vp + ': 分享平台数不是 5+9=14（实为 ' + c.sd + '+' + c.sf + '=' + c.total + '）');
    if (!p.share) continue;

    if (w > 640) {
      // 桌面：六枚顺序、位置、LOGO
      need(JSON.stringify(p.headerOrder) === JSON.stringify(EXPECT_DESKTOP),
        r.vp + ': 顶栏六枚顺序不对 ' + JSON.stringify(p.headerOrder));
      need(p.share.slot === 'header', r.vp + ': 分享按钮 slot≠header（' + p.share.slot + '）');
      need(p.share.svgCount === 1 && p.share.svgVisible === true, r.vp + ': 分享按钮 LOGO 没渲染出来');
      need(p.share.hit === true, r.vp + ': 分享按钮中心点没命中自身（被遮挡或出界）');
      need(p.share.inViewport === true, r.vp + ': 分享按钮超出视口 ' + JSON.stringify(p.share.rect));
      need(p.share.rect.w >= 60 && p.share.rect.w <= 200, r.vp + ': 分享按钮宽度异常 ' + p.share.rect.w);
      need(p.afterAnon === true, r.vp + ': 分享按钮没排在匿名邮箱之后');
      need(Array.isArray(p.betweenAnonAndShare) && p.betweenAnonAndShare.length === 0,
        r.vp + ': 匿名邮箱与分享之间夹了别的按钮 ' + JSON.stringify(p.betweenAnonAndShare));
      need(!!p.anon && p.anon.svgCount === 1 && p.anon.svgVisible === true, r.vp + ': 匿名邮箱 LOGO 没渲染出来');
      need(!!p.anon && p.anon.slot === 'header' && p.anon.hidden === false, r.vp + ': 匿名邮箱不在顶栏');
    } else {
      // 手机（2026-11-13 口径）：顶栏四枚 = 申诉 / Star / 赞助 / 分享；Login、匿名进 dock。
      need(p.share.slot === 'header', r.vp + ': 窄屏分享按钮应留顶栏（' + p.share.slot + '）');
      need(p.share.hidden === false, r.vp + ': 窄屏分享按钮被隐藏');
      need(!!p.dock && p.dock.items.some(i => i.id === 'sxg-anon-mail-btn' && i.shown),
        r.vp + ': fab-dock 里没有匿名邮箱');
      need(!!p.dock && p.dock.items.some(i => i.id === 'login-github-btn' && i.shown),
        r.vp + ': fab-dock 里没有 Login GitHub');
      need(!!p.dock && !p.dock.items.some(i => i.id === 'sxg-share-entry-btn'),
        r.vp + ': 分享本站不该再进 fab-dock');
      need(!!p.anon && p.anon.svgVisible === false, r.vp + ': 窄屏 dock 内不该显示邮箱 LOGO（应换成短标签）');
      // 顶栏四枚既有按钮仍要露出
      need(Array.isArray(p.headerOrder) && p.headerOrder.length === 4,
        r.vp + ': 窄屏顶栏应为 4 枚 ' + JSON.stringify(p.headerOrder));
      need(Array.isArray(p.headerOrder)
        && p.headerOrder[0].indexOf('提交数据') >= 0
        && p.headerOrder[1].indexOf('Star') >= 0
        && p.headerOrder[2].indexOf('赞助') >= 0
        && p.headerOrder[3].indexOf('分享') >= 0,
        r.vp + ': 窄屏顶栏四枚顺序不对 ' + JSON.stringify(p.headerOrder));
    }
  }

  console.log('PAGEERRORS=' + JSON.stringify(errors.slice(0, 10)));
  console.log('FAILS=' + JSON.stringify(fails));
  const allOk = fails.length === 0 && errors.length === 0;
  console.log('ALL_OK=' + allOk);
  try { ws.close(); } catch (e) {}
  edge.kill('SIGTERM'); server.close();
  process.exit(allOk ? 0 : 1);
})().catch(e => { console.error('ERR', e); process.exit(1); });
