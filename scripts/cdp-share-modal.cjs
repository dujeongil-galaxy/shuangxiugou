// 【本机专用 · 不挂 CI】真渲染验收：分享弹窗加固（2026-11-12 §36v）
// 背景：站长看到分享平台「变少」，根因是外链平台用 <a href="…service.weibo.com/share…">
//       渲染，被扩展 / 手机浏览器跟踪防护整块移除。加固后外链改 <button data-share> + window.open。
// 本脚本在真 Edge（无头）里验收，不依赖 jsdom 的桩：
//   1) 桌面 1440 / 手机 390 各加载一次，打开分享弹窗
//   2) 平台恒 14 项；弹窗内 <a> 恒 0 个、无 href、无 target=_blank
//   3) 8 个外链按钮点击后确实走到 window.open（hook 掉以免真开窗）；被拦场景模拟返回 null
//   4) 卡片不溢出容器宽度（平台不因排版被裁掉），截图落盘肉眼复核
// 产物落 D:/WorkBuddy-Cache/shots/share-*.png
const { cacheRoot, cacheDir } = require('./_cache-dir.cjs');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const ROOT = path.resolve(__dirname, '..');
const HTTP_PORT = 8743;
const DBG_PORT = 9243;
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
function shot(ws, name, w, h) {
  return cdp(ws, 'Page.captureScreenshot', { format:'png', fromSurface:true,
    captureBeyondViewport:false, clip:{ x:0, y:0, width:w, height:h, scale:1 } })
    .then(s => { if (s.result && s.result.data) { const o = cacheDir(name); fs.writeFileSync(o, Buffer.from(s.result.data,'base64')); return o; } });
}

// 打开弹窗 + 采集结构性事实（不点按钮）
function probe(ws) {
  return evalJson(ws, `
    if (!window.SXGShare || !window.SXGShare.open) return {ready:false};
    window.SXGShare.open();
    var mask=document.getElementById('sxg-share-mask'); if(!mask) return {ready:false, noMask:true};
    var card=mask.querySelector('.sxg-share-card');
    var dom=mask.querySelectorAll('.sxg-share-domestic .sxg-sd').length;
    var frn=mask.querySelectorAll('.sxg-share-foreign .sxg-sf').length;
    var shares=mask.querySelectorAll('[data-share]');
    var keys=[]; for (var i=0;i<shares.length;i++) keys.push(shares[i].getAttribute('data-share'));
    var html=mask.innerHTML;
    var leak=['service.weibo.com/share','facebook.com/sharer','twitter.com/intent','linkedin.com/sharing',
      'reddit.com/submit','t.me/share','social-plugins.line.me','wa.me/?text']
      .filter(function(s){return html.indexOf(s)!==-1 || html.indexOf(encodeURIComponent(s))!==-1;});
    // 排版：卡片不横向溢出，平台按钮都在卡片框内且可见
    var cardR=card?card.getBoundingClientRect():null;
    var off=[];
    if (cardR) {
      var items=mask.querySelectorAll('.sxg-sd, .sxg-sf');
      for (var j=0;j<items.length;j++){
        var r=items[j].getBoundingClientRect();
        if (r.width<20 || r.height<20) off.push({k:items[j].getAttribute('data-share')||items[j].getAttribute('data-copy'),w:Math.round(r.width),h:Math.round(r.height)});
        if (r.right > cardR.right+1 || r.left < cardR.left-1) off.push({k:items[j].getAttribute('data-share')||items[j].getAttribute('data-copy'),outOfCard:true});
      }
    }
    // 圆形 + 「上 5 下 10」排版：按 top 归行，逐枚核对图标为正圆（宽高相等且圆角 >= 半径）
    var rndBad=[];
    function rowsOf(sel){
      var els=mask.querySelectorAll(sel), map={}, tops=[];
      for (var i=0;i<els.length;i++){
        var el=els[i], r=el.getBoundingClientRect();
        var key=Math.round(r.top/6)*6;
        if(!map[key]){ map[key]=0; tops.push(key); }
        map[key]++;
        var ico=el.querySelector('.sxg-sd-ico, .sxg-sf-ico');
        if(!ico){ rndBad.push({k:el.getAttribute('data-share')||'copy',why:'noIco'}); continue; }
        var cs=getComputedStyle(ico);
        var w=parseFloat(cs.width)||0, h=parseFloat(cs.height)||0;
        var br=parseFloat(cs.borderTopLeftRadius)||0;
        var svg=ico.querySelector('svg');
        // 圆形判定：容器必须正圆（宽高相等 + 圆角达半径），底面要么由容器背景色填满，要么 svg 自绘圆 / rx≈11 圆角矩形，要么被圆形裁切
        var shapeOk=false;
        var bg=getComputedStyle(ico).backgroundColor;
        var hasBg = !!bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent';
        var baseRound=false;
        if(svg){
          var maxR=0, cs2=svg.querySelectorAll('circle');
          for(var q=0;q<cs2.length;q++){ maxR=Math.max(maxR, parseFloat(cs2[q].getAttribute('r'))||0); }
          var rc=svg.querySelector('rect');
          var rx=rc?parseFloat(rc.getAttribute('rx'))||0:0;
          var sbr=parseFloat(getComputedStyle(svg).borderTopLeftRadius)||0;
          baseRound = maxR>=10.5 || rx>=10.9 || sbr>=w/2-1.5;
        }
        shapeOk = hasBg || baseRound;
        if(!(Math.abs(w-h)<=1 && br>=w/2-1.5 && shapeOk))
          rndBad.push({k:el.getAttribute('data-share')||'copy',w:w,h:h,br:br,shapeOk:shapeOk});
      }
      tops.sort(function(a,b){return a-b;});
      return {rows:tops.length, per:tops.map(function(t){return map[t];})};
    }
    var domRows=rowsOf('.sxg-share-domestic .sxg-sd');
    var frnRows=rowsOf('.sxg-share-foreign .sxg-sf');
    return {ready:true, dom:dom, frn:frn, total:dom+frn, aTags:mask.querySelectorAll('a').length,
      hasHref:/href\\s*=/.test(html), hasBlank:/target\\s*=\\s*["']?_blank/.test(html),
      leak:leak, keys:keys, copyBtn:!!mask.querySelector('.sxg-share-copy[data-copy="link"]'),
      domRows:domRows, frnRows:frnRows, roundBad:rndBad,
      cardW:cardR?Math.round(cardR.width):null, docW:document.documentElement.clientWidth,
      off:off, cardOverflow: cardR ? Math.round(cardR.width) > document.documentElement.clientWidth : null};
  `);
}

// hook window.open 后逐个点 8 个外链按钮，确认都走到 window.open 而不是靠 <a> 跳转
function clickAll(ws, forceBlocked) {
  return evalJson(ws, `
    window.__opened=[];
    window.open=function(u,t){ window.__opened.push({url:u,target:t}); ${forceBlocked ? 'return null;' : "return {closed:false};"} };
    var mask=document.getElementById('sxg-share-mask');
    var ks=['weibo','facebook','x','linkedin','reddit','telegram','line','whatsapp','tumblr'];
    var miss=[]; ks.forEach(function(k){ var b=mask.querySelector('[data-share="'+k+'"]'); if(!b) miss.push(k); else b.click(); });
    return {opened:window.__opened, miss:miss,
      copySupported: !!(navigator.clipboard && navigator.clipboard.writeText)};
  `);
}
// toast 在 clipboard 的 Promise 里才写，点击当拍读不到，必须等一拍再取
function readToast(ws) {
  return evalJson(ws, `
    var t=document.getElementById('sxg-share-toast');
    return {toast: t?t.textContent:null};
  `);
}

(async () => {
  await new Promise((r) => server.listen(HTTP_PORT, r));
  const edge = spawn(EDGE, [
    '--headless=new', `--remote-debugging-port=${DBG_PORT}`,
    '--user-data-dir=' + path.join(cacheRoot(), '.edge-share-' + Date.now()),
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
  // 允许剪贴板写入，才能真实验证「被拦 → 自动复制」这条兜底路径
  await cdp(ws, 'Browser.grantPermissions', {
    permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'], origin: URL
  }).catch(() => {});

  // ============ ① 桌面 1440 ============
  await cdp(ws, 'Emulation.setDeviceMetricsOverride', {
    width: 1440, height: 900, deviceScaleFactor: 1, mobile: false, screenWidth: 1440, screenHeight: 900
  });
  await cdp(ws, 'Page.navigate', { url: URL });
  await sleep(3000);
  const dProbe = await probe(ws);
  console.log('[desktop] PROBE=' + JSON.stringify(dProbe));
  const dClick = await clickAll(ws, false);
  console.log('[desktop] CLICK=' + JSON.stringify(dClick));
  const dBlock = await clickAll(ws, true);
  await sleep(400);
  const dBlockToast = await readToast(ws);
  const dBlockAll = Object.assign({}, dBlock, dBlockToast);
  console.log('[desktop] BLOCKED=' + JSON.stringify(dBlockAll));
  // 点按钮会收起弹窗，截图前重新打开，保证截到的是弹窗真实排版
  await evalJson(ws, `
    if(window.SXGShare&&window.SXGShare.open) window.SXGShare.open();
    var m=document.getElementById('sxg-share-mask');
    if(m){ m.classList.add('on'); m.style.zIndex='2147483000'; }
    // 站点别的高层全屏遮罩（活动弹窗等）会盖住分享卡片，截图前先让位
    var els=document.querySelectorAll('body *');
    for(var i=0;i<els.length;i++){ var el=els[i]; if(!el || el.id==='sxg-share-mask') continue;
      var cs=getComputedStyle(el);
      if(cs.position==='fixed' && (parseInt(cs.zIndex||'0',10)>=9000)
        && el.offsetWidth>window.innerWidth*0.8 && el.offsetHeight>window.innerHeight*0.6){ el.style.display='none'; }
    }
    return 1;
  `);
  await sleep(400);
  await shot(ws, 'shots/share-desktop.png', 1440, 900);

  // ============ ② 手机 390 ============
  await cdp(ws, 'Emulation.setDeviceMetricsOverride', {
    width: 390, height: 844, deviceScaleFactor: 1, mobile: true, screenWidth: 390, screenHeight: 844
  });
  await cdp(ws, 'Page.navigate', { url: URL });
  await sleep(3000);
  const mProbe = await probe(ws);
  console.log('[mobile] PROBE=' + JSON.stringify(mProbe));
  const mClick = await clickAll(ws, false);
  console.log('[mobile] CLICK=' + JSON.stringify(mClick));
  await evalJson(ws, `
    if(window.SXGShare&&window.SXGShare.open) window.SXGShare.open();
    var m=document.getElementById('sxg-share-mask');
    if(m){ m.classList.add('on'); m.style.zIndex='2147483000'; }
    // 站点别的高层全屏遮罩（活动弹窗等）会盖住分享卡片，截图前先让位
    var els=document.querySelectorAll('body *');
    for(var i=0;i<els.length;i++){ var el=els[i]; if(!el || el.id==='sxg-share-mask') continue;
      var cs=getComputedStyle(el);
      if(cs.position==='fixed' && (parseInt(cs.zIndex||'0',10)>=9000)
        && el.offsetWidth>window.innerWidth*0.8 && el.offsetHeight>window.innerHeight*0.6){ el.style.display='none'; }
    }
    return 1;
  `);
  await sleep(400);
  await shot(ws, 'shots/share-mobile.png', 390, 844);

  const structOk = (p) => p && p.ready && p.dom === 5 && p.frn === 10 && p.total === 15
    && p.aTags === 0 && p.hasHref === false && p.hasBlank === false
    && Array.isArray(p.leak) && p.leak.length === 0 && p.copyBtn === true
    && p.domRows && p.domRows.rows === 1 && p.domRows.per[0] === 5
    && p.frnRows && p.frnRows.rows === 2 && p.frnRows.per[0] === 5 && p.frnRows.per[1] === 5
    && Array.isArray(p.roundBad) && p.roundBad.length === 0
    && Array.isArray(p.keys) && p.keys.indexOf('tumblr') !== -1
    && Array.isArray(p.off) && p.off.length === 0 && p.cardOverflow === false;
  const clickOk = (c) => c && c.miss.length === 0 && c.opened.length === 9
    && c.opened.every(o => o.target === '_blank' && /^https:\/\//.test(o.url))
    && /service\.weibo\.com/.test(c.opened[0].url)
    && c.opened.some(o => /^https:\/\/www\.tumblr\.com\/widgets\/share\/tool\?canonicalUrl=/.test(o.url));
  // 被拦：9 次 open 都返回 null，最后一条 toast 必须明说「拦截」且带「已复制」
  const blockOk = (b) => b && b.opened.length === 9 && !!b.toast
    && /拦截/.test(b.toast) && /已复制/.test(b.toast);

  console.log('PAGEERRORS=' + JSON.stringify(errors.slice(0, 10)));
  console.log('DESKTOP_STRUCT_OK=' + structOk(dProbe));
  console.log('MOBILE_STRUCT_OK=' + structOk(mProbe));
  console.log('DESKTOP_CLICK_OK=' + clickOk(dClick));
  console.log('MOBILE_CLICK_OK=' + clickOk(mClick));
  console.log('BLOCKED_FALLBACK_OK=' + blockOk(dBlockAll));
  const allOk = structOk(dProbe) && structOk(mProbe) && clickOk(dClick) && clickOk(mClick)
    && blockOk(dBlockAll) && errors.length === 0;
  console.log('ALL_OK=' + allOk);
  try { ws.close(); } catch (e) {}
  edge.kill('SIGTERM'); server.close();
  process.exit(allOk ? 0 : 1);
})().catch(e => { console.error('ERR', e); process.exit(1); });
