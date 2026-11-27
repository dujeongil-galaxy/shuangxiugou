// 【本机专用 · 不挂 CI】公益广告位真渲染验收（站长 2026-11-10 晚批次）
// 本地起静态服务 + 无头 Edge CDP，桌面 / 手机双视口各把四张卡截一遍：
//   node scripts/cdp-pdl-adcheck.cjs
// 产物统一落 D:/WorkBuddy-Cache/shots/（见 _cache-dir.cjs）。
// 顺带机器可读断言：4 卡 4 圆点、胖东来 meta 备注在、品牌名链站内、
// 整图与 CTA 点击都触发弹窗、可见文案写「淘宝店 / 抖音」、
// 真点击后阻止跳转 + 弹出居中弹窗（含淘宝/抖音两条真链接）、
// 星巴克卡整图/CTA 直跳应用宝且卡面写明去向、
// 卡片/海报内零短视频单链。⑬ 2026-11-27 批次同步；⑭ 2026-11-28 恢复胖东来 + 新增星巴克。
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
// 站长 2026-11-27 指定：弹窗里两条真链接；淘宝只留裸店址、零参数
const PDL_TAOBAO = 'https://n3sf0tqhvhbw60ae2xdq4nodo2g4kxl.taobao.com/';
const PDL_DOUYIN = 'https://www.douyin.com/user/MS4wLjABAAAANjHa0B-e7JAX89HjRiCnSLRbFYYG3b0wrt7397e7IBA';
// ⑭ 2026-11-28：星巴克卡落地腾讯应用宝的星巴克 App 官方下载页
const SBX_APP = 'https://sj.qq.com/appdetail/com.starbucks.cn';

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
    var sbxCard=slot.querySelector('.sxg-adslot__card--sbx');
    var sbxBanner=sbxCard&&sbxCard.querySelector('.sxg-adslot__banner');
    var sbxCta=sbxCard&&sbxCard.querySelector('.sxg-adslot__cta');
    var sbxJump=sbxCard&&sbxCard.querySelector('.sxg-adslot__jump');
    var rankNote=slot.querySelector('.sxg-adslot__ranknote');
    var arts=[].map.call(slot.querySelectorAll('img.sxg-adslot__art'),function(x){return x.getAttribute('src');});
    return {
      slot:true, cards:cards.length, dots:dots.length,
      pdlName:pdlName?pdlName.textContent:null,
      pdlHref:pdlName?pdlName.getAttribute('href'):null,
      pdlBannerHref:pdlBanner?pdlBanner.getAttribute('href'):null,
      pdlCtaHref:pdlCta?pdlCta.getAttribute('href'):null,
      pdlCtaText:pdlCta?pdlCta.textContent:null,
      pdlCardMall:/tmall\.com|taobao\.com|jd\.com/i.test(pdlCard.innerHTML),
      pdlTag:pdlTag?pdlTag.textContent:null,
      // ⑭ 星巴克卡：整图/CTA 直跳应用宝（不走弹窗），卡面写明去向
      sbxPresent:!!sbxCard,
      sbxBannerHref:sbxBanner?sbxBanner.getAttribute('href'):null,
      sbxCtaHref:sbxCta?sbxCta.getAttribute('href'):null,
      sbxJumpText:sbxJump?sbxJump.textContent:null,
      sbxHasShare:!!(sbxCard&&sbxCard.querySelector('[data-sxg-share]')),
      rankNoteText:rankNote?rankNote.textContent:null,
      arts:arts,
      // 2026-11-27：抖音主页是站长明确要的弹窗出口，不算视频单链。
      // 红线收窄为 v.douyin.com / b23.tv；且卡片 DOM 里不该有任何抖音链接
      // （只在弹窗里）。
      videoLink:/v\.douyin\.com|b23\.tv/i.test(slot.innerHTML)
        || /douyin\.com/i.test(slot.innerHTML),
      head:slot.querySelector('.sxg-adslot__head')?slot.querySelector('.sxg-adslot__head').textContent:null
    };
  })()`);
  console.log(label + '_DIAG=' + JSON.stringify(diag));

  // 先锁帧再截：借「悬停暂停」停掉 5s 自动轮播（否则截到卡间过渡帧——已踩过），
  // 再用圆点精确跳到第 1/2/3/4 张，每张等 900ms 让 .45s 过渡落地。
  await evalVal(ws, `document.querySelector('.sxg-adslot__viewport')
    .dispatchEvent(new MouseEvent('mouseenter',{bubbles:true}));`);
  const cardTags = ['1-luxiyi', '2-pangdonglai', '3-starbucks', '4-recruit'];
  for (let i = 0; i < 4; i++) {
    await evalVal(ws, `document.querySelectorAll('.sxg-adslot__dot')[${i}].click();`);
    await new Promise(r => setTimeout(r, 900));
    await shotSlot(ws, cacheDir('shots/sxg-pdl-' + label + '-' + cardTags[i] + '.png'));
  }

  // ⑬ 真点击验收：点胖东来 CTA 应拦住跳转、弹出居中弹窗（含淘宝/抖音两条真链接）。
  // 放在四张截图之后，避免弹窗盖住海报。
  await evalVal(ws, `(function(){
    var cta=document.querySelector('.sxg-adslot__card--pdl .sxg-adslot__cta');
    if(!cta) return false;
    window.__sxgShareEvt=new MouseEvent('click',{bubbles:true,cancelable:true});
    cta.dispatchEvent(window.__sxgShareEvt);
    return true;
  })()`);
  await new Promise(r => setTimeout(r, 400));
  const share = await evalVal(ws, `(function(){
    var modal=document.querySelector('[data-sxg-pdl-modal]');
    var tb=modal&&modal.querySelector('.sxg-adslot__modal-taobao');
    var dy=modal&&modal.querySelector('.sxg-adslot__modal-douyin');
    return {
      prevented: !!window.__sxgShareEvt && window.__sxgShareEvt.defaultPrevented,
      modalShown: !!(modal && modal.classList.contains('is-show')),
      modalText: modal ? modal.textContent : '',
      taobaoHref: tb ? tb.getAttribute('href') : null,
      douyinHref: dy ? dy.getAttribute('href') : null,
      hasClose: !!(modal && modal.querySelector('.sxg-adslot__modal-close')),
      hasMask: !!(modal && modal.querySelector('.sxg-adslot__modal-mask'))
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
    const ok = g && g.slot && g.cards === 4 && g.dots === 4
      && g.pdlHref === './brand/pdl.html'
      && g.pdlBannerHref === '#' && g.pdlCtaHref === '#'
      && /淘宝店/.test(g.pdlCtaText || '') && /抖音/.test(g.pdlCtaText || '')
      && !/小程序|口令|微信|复制/.test(g.pdlCtaText || '')
      && g.pdlCardMall === false
      && /劳动者/.test(g.pdlTag || '') && /尊重/.test(g.pdlTag || '')
      && g.videoLink === false
      && Array.isArray(g.arts) && g.arts.length === 4
      // ⑭ 星巴克卡：整图与 CTA 都直跳应用宝（真链接，不进弹窗），卡面写明去向
      && g.sbxPresent === true
      && g.sbxBannerHref === SBX_APP && g.sbxCtaHref === SBX_APP
      && g.sbxHasShare === false
      && /腾讯应用宝/.test(g.sbxJumpText || '')
      && /星巴克 App 官方下载页/.test(g.sbxJumpText || '')
      && /sj\.qq\.com/.test(g.sbxJumpText || '')
      // ⑭ 卡面下方「排名不分先后」备注行
      && /排名不分先后/.test(g.rankNoteText || '')
      && !!s && s.prevented === true
      && s.modalShown === true
      && /淘宝店/.test(s.modalText || '') && /抖音/.test(s.modalText || '')
      && !/小程序|口令|微信|复制/.test(s.modalText || '')
      && s.taobaoHref === PDL_TAOBAO && s.douyinHref === PDL_DOUYIN
      && s.hasClose === true && s.hasMask === true;
    console.log('CHECK ' + label + ': ' + (ok ? 'PASS' : 'FAIL'));
    if (!ok) { fail++; console.log('  SHARE_DETAIL=' + JSON.stringify(s)); }
  }
  console.log('PAGEERRORS=' + JSON.stringify(errors.slice(0, 3)));
  try { ws.close(); } catch (e) {}
  edge.kill('SIGTERM'); server.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
