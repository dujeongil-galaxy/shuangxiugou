// 【本机专用 · 不挂 CI，CI 无 Edge】公益广告位手机端真渲染审计
// 站长 2026-11-10 23:40：「手机端你检查了吗？新建的公益广告位，都穿模了」。
//
// 与旧 cdp-pdl-adcheck.cjs 的关键差别（旧脚本是假绿根源）：
//   ① 绝不屏蔽任何浮层 —— 旧的把 .dyp / dialog / overlay 全隐藏再截图，
//      等于把用户真机上会看到的东西删掉。本脚本只**点击弹窗的关闭按钮**
//      模拟用户操作，其余浮层一律保留、如实参与几何判定。
//   ② 不只查结构，量真实包围盒：横向溢出、海报溢出容器、meta 压海报、
//      当前可见卡文字遮挡、fixed 悬浮层与卡片相交是否已避让。
//   ③ 检查 <picture> 在窄屏真的切到 *-mobile.svg（currentSrc），并量海报高度，
//      防止「手机稿写了但没接上 / 接上了仍是 5px 小字」。
//   ④ 320 / 360 / 375 / 390 / 414 五档宽度，逐张卡切前台；任何异常判红退出 1。
// 跑法：node scripts/cdp-adslot-mobile-audit.cjs
const { cacheRoot, cacheDir } = require('./_cache-dir.cjs');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const HTTP_PORT = 8805;
const DBG_PORT = 9298;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const URL = `http://127.0.0.1:${HTTP_PORT}/`;
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
    ws.addEventListener('error', () => reject(new Error('ws connect error')));
  });
}
let msgId = 0;
function cdp(ws, method, params = {}) {
  return new Promise((resolve) => {
    const id = ++msgId;
    const h = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.id === id) { ws.removeEventListener('message', h); resolve(m); }
    };
    ws.addEventListener('message', h);
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evalVal(ws, expression) {
  const r = await cdp(ws, 'Runtime.evaluate', { expression, returnByValue: true });
  const inner = (r.result && r.result.result !== undefined) ? r.result.result : r.result;
  return inner ? inner.value : null;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const GEOM = `(function(){
  var slot=document.querySelector('[data-adslot-reserved]');
  if(!slot) return {err:'no slot'};
  function box(el){var r=el.getBoundingClientRect();return {x:Math.round(r.x),y:Math.round(r.y),
    w:Math.round(r.width),h:Math.round(r.height),right:Math.round(r.right),bottom:Math.round(r.bottom)};}
  var vw=window.innerWidth;
  var viewport=slot.querySelector('.sxg-adslot__viewport');
  var vr=viewport.getBoundingClientRect();
  var cards=[].slice.call(slot.querySelectorAll('.sxg-adslot__card'));
  var active=null,activeIdx=-1;
  cards.forEach(function(c,i){var r=c.getBoundingClientRect();
    if(r.left<vr.right-2&&r.right>vr.left+2&&active===null){active=c;activeIdx=i;}});
  var sr=box(slot);
  var out={vw:vw,slot:sr,activeIdx:activeIdx,issues:[],overlays:[]};
  if(sr.right>vw+1||sr.x<-1) out.issues.push('广告位横向溢出视口');
  if(cards.length!==3) out.issues.push('卡片数不是 3');
  if(slot.querySelectorAll('.sxg-adslot__dot').length!==3) out.issues.push('圆点数不是 3');

  // <picture> 是否真的切到手机稿 + 海报实际高度（400×240 在窄屏应有 ~190~250px）
  var imgs=[].slice.call(slot.querySelectorAll('img.sxg-adslot__art'));
  out.arts=imgs.map(function(im){
    return {src:(im.currentSrc||'').split('/').pop(),h:Math.round(im.getBoundingClientRect().height)};
  });
  if(out.arts.some(function(a){return a.src.indexOf('-mobile.svg')<0;}))
    out.issues.push('窄屏没切到手机专用稿 (currentSrc)');
  if(out.arts.some(function(a){return a.h<150;}))
    out.issues.push('海报高度 <150px（文字会糊成一片）');

  cards.forEach(function(c,i){
    var img=c.querySelector('img.sxg-adslot__art');
    var wrap=c.querySelector('.sxg-adslot__art-wrap');
    var meta=c.querySelector('.sxg-adslot__meta');
    if(img&&wrap&&img.getBoundingClientRect().bottom>wrap.getBoundingClientRect().bottom+2)
      out.issues.push('card'+i+':海报溢出 art-wrap');
    if(img&&meta&&meta.getBoundingClientRect().top<img.getBoundingClientRect().bottom-2)
      out.issues.push('card'+i+':meta 压住海报');
  });

  // 只测当前可见卡：屏幕外那两张的 elementFromPoint 必然返回别的元素，测了是误报
  if(active){
    var meta=active.querySelector('.sxg-adslot__meta');
    if(meta){
      [].slice.call(meta.querySelectorAll('a,span')).forEach(function(n){
        var r=n.getBoundingClientRect(); if(r.width<1||r.height<1) return;
        var pts=[[r.x+r.width*0.2,r.y+r.height/2],[r.x+r.width/2,r.y+r.height/2],
                 [r.x+r.width*0.8,r.y+r.height/2]];
        var blocked=0;
        pts.forEach(function(p){var e=document.elementFromPoint(p[0],p[1]);
          if(!e||!(e===n||n.contains(e)||e.contains(n))) blocked++;});
        if(blocked>0) out.issues.push('card'+activeIdx+':文字被遮挡 "'+
          (n.textContent||'').slice(0,16)+'" '+blocked+'/3');
      });
    }
  }

  // 与广告位相交的 fixed 悬浮圆钮：keepClear 生效后应带避让标记或已不可见
  [].slice.call(document.body.querySelectorAll('*')).forEach(function(n){
    var s=getComputedStyle(n); if(!s||s.position!=='fixed') return;
    var z=parseInt(s.zIndex,10); if(!(z>=1000&&z<9995)) return;
    var r=n.getBoundingClientRect(); if(r.width<2||r.height<2) return;
    var ox=Math.min(sr.right,r.right)-Math.max(sr.x,r.x);
    var oy=Math.min(sr.bottom,r.bottom)-Math.max(sr.y,r.y);
    if(ox>4&&oy>4){
      out.overlays.push({z:z,avoided:n.hasAttribute('data-sxg-adslot-avoid'),vis:s.visibility});
      if(!n.hasAttribute('data-sxg-adslot-avoid') && s.visibility!=='hidden')
        out.issues.push('悬浮层仍压在广告位上 z='+z);
    }
  });
  return out;
})()`;

(async () => {
  await new Promise((r) => server.listen(HTTP_PORT, r));
  const edge = spawn(EDGE, [
    '--headless=new', `--remote-debugging-port=${DBG_PORT}`,
    // 独立 profile：sw.js 对 ?v= 资源 cache-first，固定 profile 会截到旧海报
    '--user-data-dir=' + path.join(cacheRoot(), '.edge-adslot-mobile-' + Date.now()),
    '--no-proxy-server', '--disable-gpu', 'about:blank'
  ], { stdio: 'ignore' });

  let targets;
  for (let i = 0; i < 40; i++) {
    try {
      targets = await new Promise((res, rej) => {
        http.get(`http://127.0.0.1:${DBG_PORT}/json/list`, (r) => {
          let d = ''; r.on('data', (c) => d += c); r.on('end', () => res(JSON.parse(d)));
        }).on('error', rej);
      });
      if (targets && targets.length) break;
    } catch (e) {}
    await sleep(500);
  }
  const pt = (targets || []).find((t) => t.type === 'page' && t.webSocketDebuggerUrl) || (targets || [])[0];
  if (!pt) { console.log('NO PAGE TARGET'); edge.kill(); server.close(); process.exit(1); }
  const ws = await wsConnect(pt.webSocketDebuggerUrl);
  await cdp(ws, 'Page.enable'); await cdp(ws, 'Runtime.enable');

  let fail = 0;
  const widths = [320, 360, 375, 390, 414];
  for (const W of widths) {
    await cdp(ws, 'Emulation.setDeviceMetricsOverride',
      { width: W, height: 844, deviceScaleFactor: 1, mobile: true });
    await cdp(ws, 'Page.navigate', { url: URL });
    await sleep(12000);
    // 只点弹窗的 × 关闭（用户真实操作），其余浮层一个都不屏蔽
    await evalVal(ws, `(function(){var x=document.querySelector('.dyp__x');if(x)x.click();
      var s=document.querySelector('[data-adslot-reserved]');if(s)s.scrollIntoView({block:'center'});})()`);
    await sleep(700);
    for (let i = 0; i < 3; i++) {
      await evalVal(ws, `(function(){var v=document.querySelector('.sxg-adslot__viewport');
        if(v)v.dispatchEvent(new MouseEvent('mouseenter',{bubbles:true}));
        var d=document.querySelectorAll('.sxg-adslot__dot');if(d[${i}])d[${i}].click();})()`);
      await sleep(650);
      const g = await evalVal(ws, GEOM);
      const issues = (g && g.issues) || ['no slot / evaluate failed'];
      if (issues.length) fail += issues.length;
      console.log('AUDIT W=' + W + ' card=' + i + ' ' + JSON.stringify(g));
      if (W === 390 || (W === 320 && i === 2)) {
        const shot = await cdp(ws, 'Page.captureScreenshot', { format: 'png', fromSurface: true });
        if (shot && shot.result && shot.result.data) {
          const f = cacheDir('shots/adslot-mobile-' + W + '-card' + i + '.png');
          fs.writeFileSync(f, Buffer.from(shot.result.data, 'base64'));
          console.log('SHOT=' + f);
        }
      }
    }
  }
  console.log('MOBILE ' + (fail ? 'FAIL(' + fail + ')' : 'PASS'));
  try { ws.close(); } catch (e) {}
  edge.kill('SIGTERM'); server.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('ERR', e);
  try { server.close(); } catch (_) {}
  process.exit(1);
});
