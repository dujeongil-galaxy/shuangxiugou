// 【本机专用 · 不挂 CI】胖东来广告卡真渲染验收（站长 2026-11-10 晚批次）
// 本地起静态服务 + 无头 Edge CDP，桌面 / 手机双视口各把三张卡截一遍：
//   node scripts/cdp-pdl-adcheck.cjs
// 产物统一落 D:/WorkBuddy-Cache/shots/（见 _cache-dir.cjs）。
// 顺带机器可读断言：3 卡 3 圆点、胖东来 meta 备注在、品牌名链站内、
// 整图与 CTA 都挂站长 01:48 指定的小程序口令、可见文案写「复制口令 / 去微信」、
// 真点击后阻止跳转 + 调用复制 + 弹出 toast（含口令本体与微信提示）、
// 广告位内零视频链接。⑫ 2026-11-11 01:48 批次同步。
// 注：CDP Runtime.evaluate 返回值真实路径是 result.result.value；WebSocket 用全局
//     + addEventListener + ev.data（require('ws') 的回调拿到 Buffer 会解析失败挂起）。
const { cacheRoot, cacheDir } = require('./_cache-dir.cjs');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const HTTP_PORT = 8801;
const DBG_PORT = 9294;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const URL = `http://127.0.0.1:${HTTP_PORT}/`;
// 站长 01:48 指定：微信小程序口令（不是 URL，粘贴到微信聊天窗口才会变成卡片）
const PDL_LINK = '#小程序://胖东来/zxlej7hK8bNv5Sj';

const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css',
  '.json':'application/json', '.png':'image/png', '.svg':'image/svg+xml', '.ico':'image/x-icon' };

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
      let m;
      try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.id === id) {
        ws.removeEventListener('message', handler);
        if (m.error) console.error('CDP_ERR', method, JSON.stringify(m.error));
        resolve(m);
      }
    };
    ws.addEventListener('message', handler);
    try { ws.send(JSON.stringify({ id, method, params })); }
    catch (e) { reject(e); }
  });
}

async function evalVal(ws, expression) {
  const r = await cdp(ws, 'Runtime.evaluate', { expression, returnByValue: true });
  if (!r) return null;
  // CDP 消息层是 {id, result:{result:{type,value}}}，真值在 result.result.value；
  // 兼容两种包装深度（cdp-adcheck.cjs 的 DIAGRAW 排查坑）。
  const inner = (r.result && r.result.result !== undefined) ? r.result.result : r.result;
  return inner ? inner.value : null;
}

// 截广告位区域：量出 [data-adslot-reserved] 的**页面坐标**矩形后按 clip 截
// （Page.captureScreenshot 的 clip 是页面坐标系，getBoundingClientRect 是视口坐标系，
//   必须加 scrollX/scrollY，否则滚动后裁到页顶——已踩过）
async function shotSlot(ws, file) {
  await cdp(ws, 'Runtime.evaluate', { expression:
    `document.querySelector('[data-adslot-reserved]').scrollIntoView({block:'center'});` });
  await new Promise(r => setTimeout(r, 400));
  const rect = await evalVal(ws, `(function(){
    var el=document.querySelector('[data-adslot-reserved]');
    var r=el.getBoundingClientRect();
    return {x:Math.max(0,r.x+window.scrollX-8),y:Math.max(0,r.y+window.scrollY-8),
      width:Math.min(r.width+16,1400),height:r.height+16};
  })()`);
  const shot = await cdp(ws, 'Page.captureScreenshot', {
    format: 'png', fromSurface: true, captureBeyondViewport: true,
    clip: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scale: 2 } : undefined,
  });
  if (shot && shot.result && shot.result.data) {
    fs.writeFileSync(file, Buffer.from(shot.result.data, 'base64'));
    console.log('SCREENSHOT=' + file);
    return true;
  }
  console.log('SCREENSHOT=SKIPPED ' + file);
  return false;
}

async function runViewport(ws, label, width, height) {
  await cdp(ws, 'Emulation.setDeviceMetricsOverride',
    { width, height, deviceScaleFactor: 1, mobile: width < 500 });
  await cdp(ws, 'Page.navigate', { url: URL });
  await new Promise(r => setTimeout(r, 15000)); // 等 bundle + 补丁 triple-fallback

  // 关掉劳动提醒弹窗 / 任何 dialog 遮挡（不影响广告位本体）
  await cdp(ws, 'Runtime.evaluate', { expression:
    `document.querySelectorAll('.dyp,[role=dialog],[class*=overlay]').forEach(function(n){n.style.display='none';});` });

  const diag = await evalVal(ws, `(function(){
    var slot=document.querySelector('[data-adslot-reserved]');
    if(!slot) return {slot:false};
    var cards=slot.querySelectorAll('.sxg-adslot__card');
    var dots=slot.querySelectorAll('.sxg-adslot__dot');
    var pdlName=slot.querySelector('.sxg-adslot__card--pdl .sxg-adslot__name');
    var pdlTag=slot.querySelector('.sxg-adslot__card--pdl .sxg-adslot__tag');
    var pdlBanner=slot.querySelector('.sxg-adslot__card--pdl .sxg-adslot__banner');
    var pdlCard=slot.querySelector('.sxg-adslot__card--pdl');
    var pdlCta=pdlCard.querySelector('.sxg-adslot__cta');
    var arts=[].map.call(slot.querySelectorAll('img.sxg-adslot__art'),function(x){return x.getAttribute('src');});
    return {
      slot:true, cards:cards.length, dots:dots.length,
      pdlName:pdlName?pdlName.textContent:null,
      pdlHref:pdlName?pdlName.getAttribute('href'):null,
      pdlBannerHref:pdlBanner?pdlBanner.getAttribute('href'):null,
      pdlCtaHref:pdlCta?pdlCta.getAttribute('href'):null,
      pdlCtaText:pdlCta?pdlCta.textContent:null,
      pdlCardMall:/tmall|taobao|天猫|淘宝|京东|jd\.com/i.test(pdlCard.innerHTML),
      pdlTag:pdlTag?pdlTag.textContent:null,
      arts:arts,
      // 红线范围是「广告位不得挂视频链接」：只查广告位 DOM（整页其它位置的抖音
      // 引流弹窗是既有设计，不在本条红线内）
      videoLink:/douyin\\.com|b23\\.tv/i.test(slot.innerHTML),
      head:slot.querySelector('.sxg-adslot__head')?slot.querySelector('.sxg-adslot__head').textContent:null
    };
  })()`);
  console.log(label + '_DIAG=' + JSON.stringify(diag));

  // 先锁帧再截：借「悬停暂停」停掉 5s 自动轮播（否则截到卡间过渡帧——已踩过），
  // 再用圆点精确跳到第 1/2/3 张，每张等 900ms 让 .45s 过渡落地。
  await evalVal(ws, `document.querySelector('.sxg-adslot__viewport')
    .dispatchEvent(new MouseEvent('mouseenter',{bubbles:true}));`);
  const cardTags = ['1-luxiyi', '2-pangdonglai', '3-recruit'];
  for (let i = 0; i < 3; i++) {
    await evalVal(ws, `document.querySelectorAll('.sxg-adslot__dot')[${i}].click();`);
    await new Promise(r => setTimeout(r, 900));
    await shotSlot(ws, cacheDir('shots/sxg-pdl-' + label + '-' + cardTags[i] + '.png'));
  }

  // ⑪ 真点击验收：点胖东来 CTA 应拦住跳转、同步调用复制、弹出 toast 提醒去微信。
  // 放在三张截图之后，避免 toast 盖住海报。
  await evalVal(ws, `(function(){
    var cta=document.querySelector('.sxg-adslot__card--pdl .sxg-adslot__cta');
    if(!cta) return false;
    window.__sxgCopyCalls=[];
    var orig=document.execCommand;
    document.execCommand=function(cmd){window.__sxgCopyCalls.push(cmd);return orig?orig.apply(document,arguments):true;};
    window.__sxgShareEvt=new MouseEvent('click',{bubbles:true,cancelable:true});
    cta.dispatchEvent(window.__sxgShareEvt);
    return true;
  })()`);
  await new Promise(r => setTimeout(r, 500));
  const share = await evalVal(ws, `(function(){
    var toast=document.querySelector('[data-sxg-share-toast]');
    var code=toast&&toast.querySelector('.sxg-adslot__toast-code');
    return {
      prevented: !!window.__sxgShareEvt && window.__sxgShareEvt.defaultPrevented,
      copyCalls: window.__sxgCopyCalls || [],
      toastShown: !!(toast && toast.classList.contains('is-show')),
      toastText: toast ? toast.textContent : '',
      codeText: code ? code.textContent : ''
    };
  })()`);
  console.log(label + '_SHARE=' + JSON.stringify(share));
  return Object.assign({}, diag, { share: share });
}

(async () => {
  await new Promise((r) => server.listen(HTTP_PORT, r));
  const edge = spawn(EDGE, [
    '--headless=new', `--remote-debugging-port=${DBG_PORT}`,
    // 每次用独立 profile：sw.js 对 ?v= 资源是 cache-first，固定 profile 会缓存
    // 上一次的设计图，改了 SVG 也截到旧稿（全站审计脚本已踩过同款坑）。
    '--user-data-dir=' + path.join(cacheRoot(), '.edge-pdl-adcheck-' + Date.now()),
    '--no-proxy-server', '--disable-gpu', 'about:blank'
  ], { stdio: 'ignore' });

  let ver;
  for (let i = 0; i < 30; i++) {
    try { ver = await new Promise((res, rej) => {
      http.get(`http://127.0.0.1:${DBG_PORT}/json/version`, (r) => {
        let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d)));
      }).on('error', rej);
    }); break; } catch (e) { await new Promise(r => setTimeout(r, 500)); }
  }
  let targets;
  for (let i = 0; i < 30; i++) {
    try { targets = await new Promise((res, rej) => {
      http.get(`http://127.0.0.1:${DBG_PORT}/json/list`, (r) => {
        let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d)));
      }).on('error', rej);
    }); break; } catch (e) { await new Promise(r => setTimeout(r, 500)); }
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

  const d = await runViewport(ws, 'desktop', 1280, 800);
  const m = await runViewport(ws, 'mobile', 390, 844);

  let fail = 0;
  for (const [label, g] of [['desktop', d], ['mobile', m]]) {
    const s = g && g.share;
    const ok = g && g.slot && g.cards === 3 && g.dots === 3
      && g.pdlHref === './brand/pdl.html'
      && g.pdlBannerHref === PDL_LINK && g.pdlCtaHref === PDL_LINK
      && PDL_LINK.charAt(0) === '#'
      && /小程序口令/.test(g.pdlCtaText || '')
      && /复制/.test(g.pdlCtaText || '') && /微信/.test(g.pdlCtaText || '')
      && !/天猫|淘宝|京东/.test(g.pdlCtaText || '')
      && g.pdlCardMall === false
      && /劳动者/.test(g.pdlTag || '') && /尊重/.test(g.pdlTag || '')
      && g.videoLink === false
      && Array.isArray(g.arts) && g.arts.length === 3
      && !!s && s.prevented === true
      && s.copyCalls.indexOf('copy') !== -1
      && s.toastShown === true
      && /微信/.test(s.toastText || '')
      // element.click() 无真实手势时复制可能被拒，toast 走「请复制下方口令」
      // 兜底分支；两种分支都写「口令」与「小程序卡片」，都不许退回旧「链接」口径。
      && /口令/.test(s.toastText || '')
      && /小程序卡片/.test(s.toastText || '')
      && !/已复制链接/.test(s.toastText || '')
      && s.codeText === PDL_LINK;
    console.log('CHECK ' + label + ': ' + (ok ? 'PASS' : 'FAIL'));
    if (!ok) { fail++; console.log('  SHARE_DETAIL=' + JSON.stringify(s)); }
  }
  console.log('PAGEERRORS=' + JSON.stringify(errors.slice(0, 3)));
  try { ws.close(); } catch (e) {}
  edge.kill('SIGTERM'); server.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
