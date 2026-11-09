// 【本机专用 · 不挂 CI】真渲染验收：本地起静态服务 + 无头 Edge CDP，
// 确认首页黑卡原位已被替换为「滚动式广告位轮播」（陆喜依品牌卡 + 招商占位卡）。
// 依赖本机 Edge 绝对路径与 CDP 端口，CI runner 无此文件，故有意只在本机手动跑：
//   node scripts/cdp-adcheck.cjs
// 产物 scripts/sxg-adcheck.png 与 scripts/.edge-adcheck/ 已在 .gitignore 屏蔽。
// 注：CDP Runtime.evaluate 返回值真实路径是 result.result.value；WebSocket 用全局
//     + addEventListener + ev.data（require('ws') 的回调拿到 Buffer 会解析失败挂起）。
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const HTTP_PORT = 8799;
const DBG_PORT = 9292;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const URL = `http://127.0.0.1:${HTTP_PORT}/`;
const OUT = path.join(ROOT, 'scripts', 'sxg-adcheck.png');

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

(async () => {
  await new Promise((r) => server.listen(HTTP_PORT, r));
  const edge = spawn(EDGE, [
    '--headless=new', `--remote-debugging-port=${DBG_PORT}`,
    '--user-data-dir=' + path.join(ROOT, 'scripts', '.edge-adcheck'),
    '--no-proxy-server', '--disable-gpu', 'about:blank'
  ], { stdio: 'ignore' });

  // 等 DevTools 就绪
  let ver;
  for (let i = 0; i < 30; i++) {
    try { ver = await new Promise((res, rej) => {
      http.get(`http://127.0.0.1:${DBG_PORT}/json/version`, (r) => {
        let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d)));
      }).on('error', rej);
    }); break; } catch (e) { await new Promise(r => setTimeout(r, 500)); }
  }
  // 取页面级 target（浏览器级 ws 只支持 Browser.*/Target.*，必须连 page target）
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
  await cdp(ws, 'Page.navigate', { url: URL });
  await new Promise(r => setTimeout(r, 15000)); // 等 bundle + 补丁 triple-fallback

  // 关掉劳动提醒弹窗，避免遮挡（不影响正文/广告）
  await cdp(ws, 'Runtime.evaluate', { expression:
    `var s=document.createElement('style');s.textContent='[role=dialog],[class*=overlay]{display:none!important}';document.head.appendChild(s);` });

  const diag = await cdp(ws, 'Runtime.evaluate', { expression: `(function(){
    var body=document.body?document.body.innerText:'';
    var slot=document.querySelector('[data-adslot-reserved]');
    var r={};
    r.blackCardVisible=body.indexOf('全网打工人已转移消费额')!==-1;
    r.reservedSlotPresent=!!slot;
    r.reservedText=slot?slot.innerText.replace(/\\s+/g,' ').trim():null;
    r.stats174=body.indexOf('174')!==-1;
    r.stats84=body.indexOf('84')!==-1;
    r.haibiyou=body.indexOf('海比优')!==-1;
    r.liangpei=!!document.querySelector('.lp-ad');
    r.nav=document.querySelector('nav')?true:false;
    r.filterBar=(body.indexOf('筛选')!==-1)||!!document.querySelector('[class*=filter]');
    r.href=location.href;
    r.title=document.title;
    r.bodyLen=document.body?document.body.innerHTML.length:-1;
    r.docLen=document.documentElement?document.documentElement.innerHTML.length:-1;
    r.docHtml=document.documentElement?document.documentElement.outerHTML.slice(0,400):null;
    r.scripts=document.scripts.length;
    return r;
  })()`, returnByValue: true });

  const diagVal = (diag && diag.result) ? diag.result.value : null;
  console.log('DIAGRAW=' + JSON.stringify(diag));
  console.log('DIAG=' + JSON.stringify(diagVal, null, 2));
  console.log('PAGEERRORS=' + JSON.stringify(errors, null, 2));

  try {
    const vp = await cdp(ws, 'Page.getLayoutMetrics', {});
    const cs = (vp && vp.result && vp.result.cssContentSize) ? vp.result.cssContentSize : null;
    const shot = await cdp(ws, 'Page.captureScreenshot', {
      format: 'png', fromSurface: true, captureBeyondViewport: true,
      clip: cs ? { x: 0, y: 0, width: cs.width, height: Math.min(cs.height, 4000), scale: 1 }
              : undefined
    });
    if (shot && shot.result && shot.result.data) {
      fs.writeFileSync(OUT, Buffer.from(shot.result.data, 'base64'));
      console.log('SCREENSHOT=' + OUT);
    } else {
      console.log('SCREENSHOT=SKIPPED(no data)');
    }
  } catch (e) {
    console.log('SCREENSHOT=ERR ' + e.message);
  }
  try { ws.close(); } catch (e) {}
  edge.kill('SIGTERM'); server.close();
  process.exit(0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
