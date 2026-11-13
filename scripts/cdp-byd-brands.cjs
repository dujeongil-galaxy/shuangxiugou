// 【本机专用 · 不挂 CI】真渲染验收（2026-11-13 站长两条指令）
//   ① BYD 卡面备注栏：外链换成 https://v.douyin.com/3oI-7tZ12R8/（旧 11-13 短链作废、不再链回 ./brand/byd.html），
//      rel="nofollow noopener" + target="_blank"，框内写明 5 秒短视频 / 不作推广 / 未核实。
//   ② 卡面标签区：把「秦/汉/海鸥电动车」扩成旗下子品牌全景，原有「车载储能」「汽车周边」不重复追加。
// 产物落 <cache>/shots/byd-card.png
const { cacheRoot, cacheDir } = require('./_cache-dir.cjs');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const ROOT = path.resolve(__dirname, '..');
const HTTP_PORT = 8765;
const DBG_PORT = 9265;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const URL = `http://127.0.0.1:${HTTP_PORT}/`;
const NEW_LINK = 'https://v.douyin.com/3oI-7tZ12R8/';
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
    '--user-data-dir=' + path.join(cacheRoot(), '.edge-bydbrands-' + Date.now()),
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
  await sleep(2600);

  // 关掉首次访问的抖音弹窗，避免遮住卡片（老坑：.dyp 会接走真点击）
  await evalJson(ws, `var d=document.querySelector('.dyp'); if(d&&d.parentNode) d.parentNode.removeChild(d); return 1;`);

  // BYD 可能被分页/筛选藏起来：先试直找，找不到就在搜索框里打「比亚迪」
  const probe = `
    function rootOf(el){ var c=el; for(var i=0;i<10&&c;i++){ if(c.classList&&c.classList.contains('bg-white')&&c.classList.contains('rounded-2xl')) return c; c=c.parentElement;} return null; }
    var hs=[].slice.call(document.querySelectorAll('h2,h3'));
    var h=hs.filter(function(x){return /BYD/.test((x.textContent||''))&&/比亚迪/.test((x.textContent||''));})[0];
    if(!h) return {found:false};
    var card=rootOf(h);
    if(!card) return {found:false, why:'no card root'};
    var boxes=[].slice.call(card.querySelectorAll('[data-byd-expose]'));
    var tagRow=null, rows=[].slice.call(card.querySelectorAll('div.flex.flex-wrap'));
    for(var i=0;i<rows.length;i++){ if(/王朝网|秦\\/汉\\/海鸥电动车/.test(rows[i].textContent||'')){ tagRow=rows[i]; break; } }
    var a=card.querySelector('[data-byd-legal] a') || (boxes[1]?boxes[1].querySelector('a'):null);
    var r=card.getBoundingClientRect();
    var spans=tagRow? [].slice.call(tagRow.children).map(function(s){return (s.textContent||'').trim();}) : [];
    return {found:true, boxCount:boxes.length,
      tags: spans, tagText: tagRow? (tagRow.textContent||'') : null,
      anchor: a? {href:a.getAttribute('href'), target:a.getAttribute('target'), rel:a.getAttribute('rel'), text:a.textContent} : null,
      cardOutLinks: [].slice.call(card.querySelectorAll('a[href^="http"]')).map(function(x){return x.getAttribute('href');}),
      backToBydPage: !!card.querySelector('a[href="./brand/byd.html"]'),
      rect:{x:Math.round(r.left+window.scrollX), y:Math.round(r.top+window.scrollY),
        w:Math.round(r.width), h:Math.round(r.height)}};
  `;

  let info = null;
  for (let i = 0; i < 16; i++) {
    info = await evalJson(ws, probe);
    if (info && info.found) break;
    if (i === 4) {
      // 搜索框兜底：输入「比亚迪」触发筛选
      await evalJson(ws, `
        var inp=document.querySelector('input[type="search"],input[placeholder*="搜索"],#sxg-search');
        if(!inp) return 0;
        inp.focus(); inp.value='比亚迪';
        inp.dispatchEvent(new Event('input',{bubbles:true}));
        inp.dispatchEvent(new KeyboardEvent('keyup',{bubbles:true,key:'能'}));
        return 1;`);
    }
    await sleep(500);
  }
  console.log('[BYD卡] ' + JSON.stringify(info));

  if (info && info.found && info.rect) {
    await evalJson(ws, `
      var hs=[].slice.call(document.querySelectorAll('h2,h3'));
      var h=hs.filter(function(x){return /BYD/.test(x.textContent||'')&&/比亚迪/.test(x.textContent||'');})[0];
      if(h) h.scrollIntoView({block:'center'});
      return 1;`);
    await sleep(600);
    const n2 = await evalJson(ws, probe);
    if (n2 && n2.rect) {
      await shot(ws, 'shots/byd-card.png', {
        x: Math.max(0, n2.rect.x - 8), y: Math.max(0, n2.rect.y - 8),
        width: Math.min(1300, n2.rect.w + 16), height: Math.min(1400, n2.rect.h + 16) });
      info = n2;
    }
  }

  const tags = (info && info.tags) || [];
  const need = ['王朝网 · 秦/汉/唐/宋/元', '海洋网 · 海鸥/海豚/海豹/驱逐舰/护卫舰',
    '腾势', '方程豹', '仰望', '弗迪电池', '比亚迪电子', '车载储能', '汽车周边'];
  const missing = need.filter(k => tags.join('|').indexOf(k) === -1);
  const dups = tags.filter((x, i) => tags.indexOf(x) !== i);
  const tagOk = missing.length === 0 && dups.length === 0 && tags.length === 9;

  const linkOk = !!info && !!info.anchor
    && info.anchor.href === NEW_LINK
    && info.anchor.target === '_blank' && /noopener/.test(info.anchor.rel || '')
    && info.backToBydPage === false
    && (info.cardOutLinks || []).length === 1
    && info.boxCount === 2;

  console.log('TAGS=' + JSON.stringify(tags));
  console.log('MISSING=' + JSON.stringify(missing) + ' DUPS=' + JSON.stringify(dups));
  console.log('PAGEERRORS=' + JSON.stringify(errors.slice(0, 8)));
  console.log('TAG_OK=' + tagOk + ' LINK_OK=' + linkOk);
  try { ws.close(); } catch (e) {}
  edge.kill('SIGTERM'); server.close();
  process.exit((tagOk && linkOk && errors.length === 0) ? 0 : 1);
})().catch(e => { console.error('ERR', e); process.exit(1); });
