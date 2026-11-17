// 【本机专用 · 不挂 CI】依赖本机无头 Edge 绝对路径，CI runner 无此文件；真渲染验收只在本机跑（verify §21o 咬此标记）。
// 验收：AI 入口改版后的真渲染断言（2026-11-17 站长指令，15e8966）。
// 旧版验收对象是内嵌对话面板的锚定，已随 15e8966 撤掉内嵌挂件而整体作废，本文件按新架构重写：
// 覆盖：①AI 圆钮（ai-link.js 注入的 #sxg-ai-fab）在桌面/手机端真渲染且可见
//       ②圆钮是 <a>，href 指向 labor-ai.html（路径按所在目录自动推断）
//       ③点击真跳转 labor-ai.html（<a> 原生跳转，无 JS 拦截）
//       ④旧 ai-chat.js 内嵌面板（#sxg-ai-panel）不再注入
//       ⑤桌面端不与「回到顶部」钮重叠；手机端不与左下导航主按钮重叠
const { cacheRoot } = require('./_cache-dir.cjs');
const http = require('http'), fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const WS = require('ws');
const PORT = 19515, DBG = 19615, ROOT = path.resolve(__dirname, '..');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const server = http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/' || rel === '') rel = '/index.html';
  const p = path.join(ROOT, rel);
  fs.readFile(p, (e, d) => {
    if (e) { res.writeHead(404); res.end('nf'); return; }
    const ext = path.extname(p);
    const ct = ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }[ext] || 'application/octet-stream') + '; charset=utf-8';
    res.writeHead(200, { 'Content-Type': ct }); res.end(d);
  });
});
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 每个用例独立调试端口（Windows 上 edge.kill() 只杀主进程，端口复用会 ECONNREFUSED）
let caseSeq = 0;
async function runCase(w, h, label, mobileCheck) {
  const dbg = DBG + caseSeq++ * 2;
  const edge = spawn(EDGE, ['--headless=new', '--disk-cache-size=1', `--remote-debugging-port=${dbg}`,
    '--no-first-run', '--user-data-dir=' + path.join(cacheRoot(), 'edgeprof-anchor' + Date.now() + '-' + caseSeq)], { stdio: 'ignore' });
  let list = null;
  for (let i = 0; i < 60; i++) {
    try { list = await (await fetch(`http://127.0.0.1:${dbg}/json`)).json(); break; }
    catch (e) { await sleep(500); }
  }
  if (!list) throw new Error('Edge CDP 端口 30s 内未就绪');
  const page = list.find(t => t.type === 'page' && /127\.0\.0\.1/.test(t.url)) || list.find(t => t.type === 'page');
  const ws = new WS(page.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
  await new Promise(r => ws.on('open', r));
  let mid = 0; const pending = new Map();
  ws.on('message', raw => { const m = JSON.parse(raw); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
  const call = (m, p) => new Promise(res => { const i = ++mid; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p || {} })); });
  const ev = async x => { const r = await call('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); return r.result && r.result.result && r.result.result.value; };
  await call('Page.enable');
  await call('Runtime.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await call('Page.navigate', { url: `http://127.0.0.1:${PORT}/?nocache=${Date.now()}` });

  // 轮询等 ai-link.js 注入圆钮（boot 有 DOMContentLoaded + 800ms/1800ms 兜底）
  let ready = false;
  for (let i = 0; i < 40; i++) {
    const st = await ev(`(()=>{const b=document.getElementById('sxg-ai-fab');return b?getComputedStyle(b).display:'no'})()`);
    if (st && st !== 'no' && st !== 'none') { ready = true; break; }
    await sleep(200);
  }
  if (!ready) { console.log(`\n[${label}] ${w}x${h}`); console.log('  ⚠️ AI 圆钮未在超时内就绪'); ws.close(); edge.kill(); return ['AI 圆钮未渲染']; }

  // 面板作废确认：再等 2s，旧 ai-chat.js 若还在挂载 #sxg-ai-panel 也该出现了
  await sleep(2000);
  const state = JSON.parse(await ev(`(()=>{
    const vh=innerHeight;
    const fab=document.getElementById('sxg-ai-fab');
    const panel=document.getElementById('sxg-ai-panel');
    if(!fab) return JSON.stringify({missing:true});
    const fr=fab.getBoundingClientRect();
    const cs=getComputedStyle(fab);
    const rectOf=id=>{const e=document.getElementById(id);return e?(r=>({l:r.left,r:r.right,t:r.top,b:r.bottom}))(e.getBoundingClientRect()):null;};
    const hit=(a,b)=>a&&b&&a.l<b.r&&b.l<a.r&&a.t<b.b&&b.t<a.b;
    const nav=document.getElementById('sxg-nav-fab');
    const nr=nav?nav.getBoundingClientRect():null;
    return JSON.stringify({
      tag:fab.tagName, href:fab.getAttribute('href'),
      display:cs.display, visibility:cs.visibility, w:Math.round(fr.width), h:Math.round(fr.height),
      left:Math.round(fr.left), bottomDist:Math.round(vh-fr.bottom), top:Math.round(fr.top), bottom:Math.round(fr.bottom),
      panelPresent:!!panel,
      topHits:hit(rectOf('sxg-ai-fab'),rectOf('sxg-top-btn')),
      navPresent:!!nav, navTop:nr?Math.round(nr.top):null, navBot:nr?Math.round(nr.bottom):null
    });
  })()`));
  const fail = [];
  console.log(`\n[${label}] ${w}x${h}`);
  if (state.missing) { console.log('  ❌ AI 圆钮未渲染'); ws.close(); edge.kill(); return ['AI 圆钮未渲染']; }
  console.log('  tag =', state.tag, '| href =', state.href, '| display =', state.display, '/', state.visibility, '| 尺寸 =', state.w + 'x' + state.h);
  console.log('  left =', state.left, '| 距底 =', state.bottomDist + 'px', '| panel(#sxg-ai-panel) =', state.panelPresent ? '仍在(应已移除)' : '无(✓ 内嵌挂件已撤)');
  if (state.tag !== 'A') fail.push('AI 圆钮不是 <a>（ai-link.js 应注入原生链接）');
  if (!/labor-ai\.html$/.test(state.href || '')) fail.push('圆钮 href 未指向 labor-ai.html（实际 ' + state.href + '）');
  if (state.display === 'none' || state.visibility === 'hidden' || state.w <= 0 || state.h <= 0) fail.push('AI 圆钮不可见');
  if (state.panelPresent) fail.push('旧内嵌面板 #sxg-ai-panel 仍被注入（15e8966 已撤掉内嵌挂件）');
  if (!mobileCheck && state.left !== 14) fail.push('桌面 AI 钮不在左下角（left=' + state.left + '，应=14）');
  if (!mobileCheck && state.topHits) fail.push('AI 钮与「回到顶部」钮重叠');
  if (mobileCheck) {
    console.log('  手机端: 导航主按钮 =', state.navPresent, '(', state.navTop, '..', state.navBot, ') | AI 上下沿 =', state.top, '..', state.bottom);
    if (!state.navPresent) fail.push('手机端左下导航主按钮未找到（锚定参照缺失）');
    else if (state.top < state.navBot && state.bottom > state.navTop) fail.push('手机端 AI 钮与左下导航主按钮重叠（AI ' + state.top + '..' + state.bottom + '，导航 ' + state.navTop + '..' + state.navBot + '）');
  }

  // 点击 → <a> 原生跳转 labor-ai.html
  await ev(`(()=>{const b=document.getElementById('sxg-ai-fab');if(b)b.click();return 'clicked';})()`);
  let navigated = false;
  for (let i = 0; i < 20; i++) {
    const p = await ev(`location.pathname.split('/').pop()`);
    if (p === 'labor-ai.html') { navigated = true; break; }
    await sleep(250);
  }
  console.log('  点击后落点 =', navigated ? 'labor-ai.html ✓' : '未跳转');
  if (!navigated) fail.push('点击 AI 圆钮未跳转 labor-ai.html');

  ws.close(); edge.kill();
  return fail;
}

(async () => {
  await new Promise(r => server.listen(PORT, r));
  let allFail = [];
  allFail = allFail.concat(await runCase(1680, 950, '桌面（左下角圆钮）'));
  allFail = allFail.concat(await runCase(420, 800, '手机端（左下导航钮上方）', true));
  server.close();
  if (allFail.length) { console.log('\n❌ 断言失败:'); [...new Set(allFail)].forEach(f => console.log('  -', f)); process.exit(1); }
  console.log('\n✅ 全部断言通过：AI 圆钮真渲染、href 指向 labor-ai.html、点击真跳转、旧内嵌面板已移除、无按钮重叠');
  process.exit(0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
