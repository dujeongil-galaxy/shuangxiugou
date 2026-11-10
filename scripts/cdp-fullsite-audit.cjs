// 【全站检查 · 本机专用】品牌专属 DOM 补丁有没有「串卡 / 乱飞」
// 站长 2026-11-10 20:44 指令：常州星宇、罗技的登记框出现在了无关卡片上，做一次全站检查。
// 起本地静态服务 + 无头 Edge CDP，加载首页后把所有「品牌专属注入节点」连同它所在的
// 卡片标题一起抓出来，按预期归属表核对；再模拟一次搜索过滤，看节点会不会跟着 React
// 复用的卡片 DOM 漂到别的品牌上。
//   node scripts/cdp-fullsite-audit.cjs
// 产物：stdout 的 AUDIT= JSON，另存 D:/WorkBuddy-Cache/shots/fullsite-audit.json。
const { cacheRoot, cacheDir } = require('./_cache-dir.cjs');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const HTTP_PORT = 8803;
const DBG_PORT = 9296;
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
        resolve(m);
      }
    };
    ws.addEventListener('message', handler);
    try { ws.send(JSON.stringify({ id, method, params })); } catch (e) { reject(e); }
  });
}
async function evalVal(ws, expression) {
  const r = await cdp(ws, 'Runtime.evaluate', { expression, returnByValue: true });
  if (!r) return null;
  const inner = (r.result && r.result.result !== undefined) ? r.result.result : r.result;
  return inner ? inner.value : null;
}

// 在页面里跑的采集器：所有品牌专属注入节点 → 最近的卡片根 → 卡片标题
const COLLECT = `(function(){
  var marks = ['data-sxg-news','data-byd-expose','data-luckin-note','data-luckin-policy',
    'data-rate-note','data-luxiyi-alt','data-ai-notice','data-sxg-reason','data-sxg-localnote'];
  var cards = [].slice.call(document.querySelectorAll('div.bg-white.rounded-2xl.border'));
  function titleOf(card){
    var h = card && card.querySelector('h2, h3');
    return h ? (h.textContent||'').trim().slice(0, 40) : '(no title)';
  }
  var rows = [];
  for (var mi=0; mi<marks.length; mi++){
    var attr = marks[mi];
    var nodes = [].slice.call(document.querySelectorAll('['+attr+']'));
    for (var ni=0; ni<nodes.length; ni++){
      var n = nodes[ni];
      var card = n.closest ? n.closest('div.bg-white.rounded-2xl.border') : null;
      rows.push({mark:attr, value:n.getAttribute(attr), card:titleOf(card),
        head:(n.textContent||'').trim().slice(0,42)});
    }
  }
  return {cards:cards.length, titles:cards.map(titleOf), rows:rows,
    dupLocalNotes:cards.filter(function(c){return c.querySelectorAll('.sxg-localnote').length>1;})
      .map(titleOf),
    inputs:[].slice.call(document.querySelectorAll('input')).slice(0,8)
      .map(function(x){return {id:x.id,ph:x.placeholder,type:x.type};})};
})()`;

// 预期归属：mark/value → 卡片标题正则（只列能明确判归属的）
const EXPECT = [
  { mark: 'data-sxg-news', value: 'logitech', re: /Logitech|罗技/ },
  { mark: 'data-sxg-news', value: 'xingyu', re: /常州星宇/ },
  { mark: 'data-byd-expose', value: '1', re: /BYD|比亚迪/ },
  { mark: 'data-luckin-note', value: '1', re: /瑞幸/ },
  { mark: 'data-luckin-policy', value: '1', re: /瑞幸/ },
  { mark: 'data-luxiyi-alt', value: '1', re: /茶百道|一点点|茉莉奶白|喜茶|蜜雪冰城|霸王茶姬|兵立王/ }
];

function analyze(snap) {
  const mis = [];
  const seen = {};
  for (const r of snap.rows) {
    const key = r.mark + '=' + r.value;
    seen[key] = (seen[key] || 0) + 1;
    const rule = EXPECT.find((x) => x.mark === r.mark && x.value === r.value);
    if (rule && !rule.re.test(r.card)) {
      mis.push({ mark: key, card: r.card, head: r.head });
    }
  }
  return { cards: snap.cards, marks: seen, mismatches: mis,
    mismatchCount: mis.length, dupLocalNotes: snap.dupLocalNotes || [],
    sampleTitles: (snap.titles || []).slice(0, 12),
    inputs: snap.inputs || [] };
}

// 搜索框定位：bundle 里的 placeholder 带「搜索商品或品类」，但 SEO/其它补丁可能
// 改写，退而求其次取第一个 placeholder 含「搜索」或 type=search 的输入框。
const FIND_INPUT = `(function(){
  var all=[].slice.call(document.querySelectorAll('input'));
  return all.find(function(x){return /搜索/.test(x.placeholder||'');})
      || all.find(function(x){return (x.type||'')==='search';})
      || all.find(function(x){return (x.type||'')==='text';}) || null;
})()`;
const SET_INPUT = `(function(v){
  var all=[].slice.call(document.querySelectorAll('input'));
  var el=all.find(function(x){return /搜索/.test(x.placeholder||'');})
      || all.find(function(x){return (x.type||'')==='search';})
      || all.find(function(x){return (x.type||'')==='text';});
  if(!el) return false;
  var setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
  setter.call(el,v);
  el.dispatchEvent(new Event('input',{bubbles:true}));
  return true;
})`;

(async () => {
  await new Promise((r) => server.listen(HTTP_PORT, r));
  const edge = spawn(EDGE, [
    '--headless=new', `--remote-debugging-port=${DBG_PORT}`,
    // 每次用独立 profile：sw.js 对带 ?v= 的 js 是 cache-first，固定 profile 会把
    // 上一次的补丁缓存住，故障注入时改了源码也加载不到（假绿）。
    '--user-data-dir=' + path.join(cacheRoot(), '.edge-fullsite-audit-' + Date.now()),
    '--no-proxy-server', '--disable-gpu', 'about:blank'
  ], { stdio: 'ignore' });

  let targets;
  for (let i = 0; i < 30; i++) {
    try {
      targets = await new Promise((res, rej) => {
        http.get(`http://127.0.0.1:${DBG_PORT}/json/list`, (r) => {
          let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d)));
        }).on('error', rej);
      });
      if (targets && targets.length) break;
    } catch (e) { /* retry */ }
    await new Promise(r => setTimeout(r, 500));
  }
  const pageTarget = (targets || []).find(t => t.type === 'page' && t.webSocketDebuggerUrl)
    || (targets || []).find(t => t.webSocketDebuggerUrl);
  if (!pageTarget) { console.error('NO PAGE TARGET'); process.exit(1); }
  const ws = await wsConnect(pageTarget.webSocketDebuggerUrl);
  await cdp(ws, 'Page.enable');
  await cdp(ws, 'Runtime.enable');
  await cdp(ws, 'Emulation.setDeviceMetricsOverride',
    { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp(ws, 'Page.navigate', { url: URL });
  await new Promise(r => setTimeout(r, 16000));

  const stages = {};
  const snap0 = (await evalVal(ws, COLLECT)) || { rows: [], titles: [] };
  stages.initial = analyze(snap0);
  stages.inputs = (await evalVal(ws, FIND_INPUT + ' ? true : false')) || false;

  // 模拟一次搜索过滤：React 会重建/复用卡片 DOM，串卡问题在这里最容易显形
  const inputOk = await evalVal(ws, SET_INPUT + '(' + JSON.stringify('罗技') + ')');
  await new Promise(r => setTimeout(r, 2500));
  stages.afterSearch = analyze((await evalVal(ws, COLLECT)) || { rows: [], titles: [] });
  stages.searchInputFound = !!inputOk;

  await evalVal(ws, SET_INPUT + '(' + JSON.stringify('') + ')');
  await new Promise(r => setTimeout(r, 2500));
  stages.afterClear = analyze((await evalVal(ws, COLLECT)) || { rows: [], titles: [] });

  console.log('AUDIT=' + JSON.stringify(stages));
  try { fs.writeFileSync(cacheDir('shots/fullsite-audit.json'), JSON.stringify(stages, null, 2)); } catch (e) {}
  // filter-flash 的「搜索删空」是整屏 filter:blur（不是可移除的遮罩节点），
  // 时长 6 秒 + 450ms 宽限；等满再看卡片，否则截到一片糊。
  await new Promise(r => setTimeout(r, 6800));
  // 肉眼验收：滚到卡片区截一张，确认剥离后卡片结构完整、没有被新标注挤乱
  await evalVal(ws, `(function(){
    // 搜索删空会触发 filter-flash 的 6 秒磨砂遮罩；抖音弹窗也会挡卡片，
    // 截图前一律移除，只看卡片本体。
    ['#sxg-flash-mask','.dyp','[role=dialog]','[class*=overlay]'].forEach(function(sel){
      document.querySelectorAll(sel).forEach(function(n){ n.style.display='none'; });
    });
    var cs=document.querySelectorAll('div.bg-white.rounded-2xl.border');
    var target=[].slice.call(cs).find(function(c){
      var h=c.querySelector('h2,h3'); return h && /阿里巴巴/.test(h.textContent||'');
    }) || (cs.length>2 ? cs[2] : null);
    if(target) target.scrollIntoView({block:'start'});
    return true;
  })()`);
  await new Promise(r => setTimeout(r, 600));
  const shot = await cdp(ws, 'Page.captureScreenshot', { format: 'png', fromSurface: true });
  if (shot && shot.result && shot.result.data) {
    const f = cacheDir('shots/fullsite-after-fix.png');
    fs.writeFileSync(f, Buffer.from(shot.result.data, 'base64'));
    console.log('SCREENSHOT=' + f);
  }
  // 真检查工具：任何阶段出现串卡 / 两条登记框没挂在自己的卡上，一律判红退出。
  let fail = 0;
  for (const [name, s] of Object.entries(stages)) {
    if (!s || typeof s !== 'object' || !('mismatchCount' in s)) continue;
    if (s.mismatchCount > 0) { console.log('FAIL ' + name + ': ' + s.mismatchCount + ' 处串卡'); fail++; }
    if ((s.dupLocalNotes || []).length > 0) {
      console.log('FAIL ' + name + ': ' + s.dupLocalNotes.length + ' 张卡重复挂了本地投票说明');
      fail++;
    }
    // 搜索阶段会按关键词过滤卡片，目标卡不在 DOM 时框自然为 0，不判红。
    if (name === 'afterSearch') continue;
    const news = s.marks || {};
    if (news['data-sxg-news=logitech'] !== 1 || news['data-sxg-news=xingyu'] !== 1) {
      console.log('FAIL ' + name + ': 罗技/星宇登记框应各恰好 1 份，实为 '
        + (news['data-sxg-news=logitech'] || 0) + '/' + (news['data-sxg-news=xingyu'] || 0));
      fail++;
    }
  }
  console.log('FULLSITE ' + (fail ? 'FAIL(' + fail + ')' : 'PASS'));
  try { ws.close(); } catch (e) {}
  edge.kill('SIGTERM'); server.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
