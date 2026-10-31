// 首页「全站证据链公示」区块渲染验收截图（2026-10-31）
// 跑法：node scripts/shot-evboard.cjs（需 ws；输出到 D:/WebArchive/_shots/evboard/）
//
// 为什么必须有这一步：verify 的 37 项断言全是源码层字符串/DOM 结构比对，
// 抓不到「结构对但渲染崩了」——本项目的标准动作是无头 Edge 真渲染截图。
// 本区块是纯静态 HTML（无 script），理论上不会崩，但 CSS 类名写错、
// <details> 折叠失效、公告栏锚点跳不过去这类问题只有真渲染能看出来。
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 18975;
// 路径守卫用 path.resolve 两侧归一：Windows 下 path.join 产出反斜杠，
// 与正斜杠写的 ROOT 永远不相等 → 全部请求 404、页面空白（2026-10-25 踩过）
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = 'D:/WebArchive/_shots/evboard';

const server = http.createServer((req, res) => {
  let p = path.resolve(ROOT, '.' + decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(ROOT)) { res.writeHead(403); res.end('forbidden'); return; }
  if (p.endsWith('/') || p.endsWith('\\')) p = path.join(p, 'index.html');
  fs.readFile(p, (err, data) => {
    if (err) { res.writeHead(404); res.end('nf'); return; }
    const ext = path.extname(p).toLowerCase();
    const mime = {
      '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
      '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
      '.json': 'application/json', '.enc': 'application/octet-stream',
    }[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime + '; charset=utf-8' });
    res.end(data);
  });
});

let notFound = [];

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  await new Promise(r => server.listen(PORT, r));

  const edge = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', [
    '--headless=new', `--remote-debugging-port=${PORT + 100}`, '--no-first-run',
    '--window-size=1500,1000',
    '--user-data-dir=' + path.join(ROOT, 'scripts/edgeprof-evboard'),
    'about:blank',
  ], { stdio: 'ignore' });

  await new Promise(r => setTimeout(r, 5000));
  const list = await (await fetch(`http://127.0.0.1:${PORT + 100}/json/list`)).json();
  const page = list.find(t => t.type === 'page' && t.url === 'about:blank')
    || list.find(t => t.type === 'page' && !t.url.startsWith('edge://'));
  if (!page) { console.log('NO PAGE'); process.exit(1); }

  const WebSocket = require('ws');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.on('open', r));
  let mid = 0;
  const pending = new Map();
  ws.on('message', raw => {
    const m = JSON.parse(raw);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  const call = (method, params) => new Promise(res => {
    const i = ++mid;
    pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params: params || {} }));
  });

  const errors = [];
  await call('Runtime.enable');
  await call('Log.enable');
  ws.on('message', raw => {
    const m = JSON.parse(raw);
    if (m.method === 'Runtime.exceptionThrown') {
      errors.push('EXCEPTION: ' + JSON.stringify(m.params.exceptionDetails.exception?.description
        || m.params.exceptionDetails.text).slice(0, 200));
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      errors.push('CONSOLE: ' + (m.params.args.map(a => a.value || a.description || '').join(' ')).slice(0, 200));
    }
  });

  await call('Page.enable');
  const nav = await call('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
  if (nav.result && nav.result.errorText) { console.log('导航失败:', nav.result.errorText); process.exit(1); }
  await new Promise(r => setTimeout(r, 8000));

  const ev = async (expr) => {
    const r = await call('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) return 'EVAL_ERR: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 300);
    return r.result && r.result.result ? r.result.result.value : undefined;
  };

  // 抖音弹窗 .dyp 是延迟弹出的，每次截图前都要再清一次（同 liangpei 浮窗）
  const CLEAN = `document.querySelectorAll('.dyp,[id^="liangpei"],.lp-ad').forEach(n=>n.remove());'cleaned'`;
  const shot = async (name, expr) => {
    await ev(CLEAN);
    if (expr) await ev(expr);
    await new Promise(r => setTimeout(r, 700));
    const s = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    if (s.result && s.result.data) {
      fs.writeFileSync(path.join(OUT_DIR, name + '.png'), Buffer.from(s.result.data, 'base64'));
      console.log('  截图 →', name + '.png');
    } else {
      console.log('  截图失败', name, JSON.stringify(s).slice(0, 200));
    }
  };

  console.log('\n=== 渲染实况断言（真浏览器，非源码字符串）===');
  const results = [];
  const T = (label, val, want) => {
    const ok = String(val) === String(want);
    results.push({ label, val, want, ok });
    console.log(`  ${ok ? '✓' : '✗'} ${label}：实得 ${JSON.stringify(val)}${ok ? '' : ' / 期望 ' + JSON.stringify(want)}`);
  };

  await ev(CLEAN);

  // 1. 区块真渲染出来了，且不在 #root 里（React 管不到 = 不会被重渲染清掉）
  T('公示区块存在', await ev(`!!document.getElementById('evidence-board')`), true);
  T('区块不在 #root 内', await ev(
    `!document.getElementById('root').contains(document.getElementById('evidence-board'))`), true);
  T('区块在 #root 之后（文档顺序）', await ev(
    `!!(document.getElementById('root').compareDocumentPosition(document.getElementById('evidence-board')) & Node.DOCUMENT_POSITION_FOLLOWING)`), true);

  // 2. 67 家 details 真在 DOM 里，且默认可见（不是被 CSS 藏了）
  T('details 数量', await ev(`document.querySelectorAll('#evidence-board details').length`), 67);
  T('区块可见（offsetHeight>0）', await ev(
    `document.getElementById('evidence-board').offsetHeight > 100`), true);
  T('details 默认为折叠态', await ev(
    `[...document.querySelectorAll('#evidence-board details')].filter(d=>d.open).length`), 0);

  // 3. 展开一家（工行）→ 4 条证据、4 个可点链接真能看见
  const openRes = await ev(`(()=>{
    const d=document.getElementById('ev-icbc');
    d.open=true;
    d.scrollIntoView({block:'start'});
    const items=d.querySelectorAll('ol.ev-items > li');
    const links=d.querySelectorAll('div.u > a');
    return JSON.stringify({items:items.length,links:links.length,
      visible:items[0] && items[0].offsetHeight>0,
      linkText:(links[0]||{}).textContent||'',
      href:(links[0]||{}).href||''});
  })()`);
  let o = {};
  try { o = JSON.parse(openRes); } catch (e) { o = { raw: openRes }; }
  T('工行展开后证据条数', o.items, 4);
  T('工行展开后可点链接数', o.links, 4);
  T('展开后条目真可见（非隐藏）', o.visible, true);
  T('链接 href 是真 URL', /^https?:\/\//.test(o.href || ''), true);
  console.log(`    首条链接：${o.linkText} → ${o.href}`);

  // 4. 薄弱清单：6 家零证据企业真在警示块里，且判据可见
  const weakRes = await ev(`(()=>{
    const w=document.querySelector('#evidence-board .ev-weak');
    if(!w) return JSON.stringify({exists:false});
    const li=[...w.querySelectorAll('li')].map(x=>x.querySelector('strong')?.textContent||'');
    const reasons=w.querySelectorAll('.r').length;
    return JSON.stringify({exists:true,n:li.length,names:li,reasons,visible:w.offsetHeight>50});
  })()`);
  let wk = {};
  try { wk = JSON.parse(weakRes); } catch (e) { wk = { raw: weakRes }; }
  T('薄弱清单存在', wk.exists, true);
  T('薄弱清单列 6 家', wk.n, 6);
  T('薄弱清单可见', wk.visible, true);
  console.log(`    名单：${(wk.names || []).join(' / ')}；判据行 ${wk.reasons} 条`);

  // 5. 零证据企业展开后给出判据（不是空壳）
  const kfcRes = await ev(`(()=>{
    const d=document.getElementById('ev-kfc'); d.open=true;
    return JSON.stringify({
      nolink:!!d.querySelector('.ev-nolink'),
      reasons:d.querySelectorAll('.ev-reasons li').length,
      items:d.querySelectorAll('ol.ev-items > li').length});
  })()`);
  let kf = {};
  try { kf = JSON.parse(kfcRes); } catch (e) { kf = { raw: kfcRes }; }
  T('肯德基（零证据）有如实标注块', kf.nolink, true);
  T('肯德基给出判据条数>0', (kf.reasons || 0) > 0, true);
  T('肯德基无伪造证据条目', kf.items, 0);

  // 6. 公告栏锚点真能跳到公示区（「可点入口」不是死链）
  const anchorRes = await ev(`(()=>{
    const a=document.querySelector('#evidence-notice a[href="#evidence-board"]');
    if(!a) return JSON.stringify({exists:false});
    const t=document.getElementById(a.getAttribute('href').slice(1));
    return JSON.stringify({exists:true,targetFound:!!t,text:a.textContent});
  })()`);
  let an = {};
  try { an = JSON.parse(anchorRes); } catch (e) { an = { raw: anchorRes }; }
  T('公告栏入口链接存在', an.exists, true);
  T('公告栏锚点能命中目标区块', an.targetFound, true);
  console.log(`    公告栏文案：${an.text}`);

  // 7. 强度徽章真渲染（174 个），统计条数字对
  T('强度大类徽章数', await ev(
    `document.querySelectorAll('#evidence-board .ev-items .k').length`), 174);
  T('统计条格数', await ev(`document.querySelectorAll('#evidence-board .ev-stat').length`), 5);
  T('图例药丸数', await ev(`document.querySelectorAll('#evidence-board .ev-pill').length`), 10);

  // ---- 截图 ----
  console.log('\n=== 截图 ===');
  await shot('01-公告栏与首屏', `window.scrollTo(0,0);document.querySelectorAll('#evidence-board details').forEach(d=>d.open=false);'ok'`);
  await shot('02-公示区顶部（标题+统计条+图例）',
    `document.getElementById('evidence-board').scrollIntoView({block:'start'});'ok'`);
  await shot('03-薄弱清单', `document.querySelector('#evidence-board .ev-weak').scrollIntoView({block:'center'});'ok'`);
  await shot('04-品牌折叠列表', `document.querySelector('#evidence-board .ev-list').scrollIntoView({block:'start'});'ok'`);
  await shot('05-工行展开4条证据', `(()=>{document.querySelectorAll('#evidence-board details').forEach(d=>d.open=false);const d=document.getElementById('ev-icbc');d.open=true;d.scrollIntoView({block:'start'});return 'ok'})()`);
  await shot('06-肯德基零证据如实标注', `(()=>{document.querySelectorAll('#evidence-board details').forEach(d=>d.open=false);const d=document.getElementById('ev-kfc');d.open=true;d.scrollIntoView({block:'start'});return 'ok'})()`);
  await shot('07-农行C级展开（维持C的硬证据）', `(()=>{document.querySelectorAll('#evidence-board details').forEach(d=>d.open=false);const d=document.getElementById('ev-abc');d.open=true;d.scrollIntoView({block:'start'});return 'ok'})()`);

  // 8. 移动端窄屏（390px）不溢出
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await new Promise(r => setTimeout(r, 1200));
  T('窄屏 390px 无横向溢出', await ev(
    `document.documentElement.scrollWidth <= window.innerWidth + 2`), true);
  T('窄屏公示区仍可见', await ev(
    `document.getElementById('evidence-board').offsetHeight > 100`), true);
  await shot('08-移动端390px公示区',
    `document.getElementById('evidence-board').scrollIntoView({block:'start'});'ok'`);
  await shot('09-移动端390px展开证据',
    `(()=>{const d=document.getElementById('ev-icbc');d.open=true;d.scrollIntoView({block:'start'});return 'ok'})()`);
  await call('Emulation.clearDeviceMetricsOverride');

  // 9. 控制台无致命错误
  // 白名单：custom-card-actions.js 的「找不到任何可插入位置」是**既有时序噪音**——
  // 注入脚本首轮跑在 React 渲染完成之前，报错后有重试机制，重试即成功。
  // 2026-10-31 排查记录（三步取证，不是拍脑袋放行）：
  //   ① 对照实验：把 index.html 换回 HEAD 原版（无公示区）跑本脚本，
  //      同样 15 条错误 → 与公示区无关，是既有行为；
  //   ② 真渲染核查：67 家品牌卡全部渲染为 H2，15 张自定义卡全在
  //      （⚠️ 品牌卡名是 H2 不是 H3，按 h3 探测会误判「没渲染」）；
  //   ③ 插入位置逐个核对正确：赵一鸣在 IKEA 后、零食有鸣在赵一鸣后、
  //      兵立王在 SAP 后、茶百道在农夫山泉后、肯德基在瑞幸后、
  //      工/建/中/农/成都银行依次成链、小米在腾讯后、一点点在喜茶后、
  //      淘宝闪购在美团后。
  // 所以这里只过滤这一条已知噪音；其他任何 error 一律判红，不许扩大白名单。
  const NOISE = [
    /找不到任何可插入位置/,   // custom-card-actions 首轮时序噪音（见上，重试后成功）
    /liangpei|lp-ad|抖音/,    // 广告位/弹窗（截图前已移除，加载期仍可能报）
    /favicon/,
    /Failed to load resource/,
  ];
  const fatal = errors.filter(e => !NOISE.some(re => re.test(e)));
  T('无未预期 JS 异常', fatal.length, 0);
  if (fatal.length) fatal.slice(0, 5).forEach(e => console.log('    ' + e));
  if (errors.length) console.log(`    （已忽略 ${errors.length - fatal.length} 条已知噪音，白名单理由见脚本注释）`);

  // 10. 品牌卡真渲染（本轮踩过口径坑：卡名是 H2 不是 H3）
  //     公示区挂在 #root 之后，若 React 渲染被公示区影响，这里会先炸。
  const h2Names = await ev(
    `JSON.stringify([...document.querySelectorAll('#root h2')].map(h=>h.textContent.trim()))`);
  let names = [];
  try { names = JSON.parse(h2Names); } catch (e) { names = []; }
  T('#root 内品牌卡 H2 数量 ≥ 67', names.length >= 67, true);
  const missingCards = ['赵一鸣/零食很忙', '工商银行', '农业银行', '成都银行', '淘宝闪购 (饿了么)']
    .filter(n => !names.some(x => x.includes(n)));
  T('自定义卡真渲染到页面（含本轮改判的银行）', missingCards.length, 0);
  if (missingCards.length) console.log('    缺：' + missingCards.join(', '));

  // ---- 汇总 ----
  const bad = results.filter(r => !r.ok);
  console.log('\n' + '='.repeat(58));
  console.log(`渲染断言通过 ${results.length - bad.length}/${results.length} 项`);
  if (bad.length) {
    console.log('失败项：');
    bad.forEach(r => console.log(`  ✗ ${r.label}：实得 ${JSON.stringify(r.val)} / 期望 ${JSON.stringify(r.want)}`));
  }
  console.log('截图目录：' + OUT_DIR);
  ws.close();
  edge.kill();
  server.close();
  process.exit(bad.length ? 1 : 0);
})();
