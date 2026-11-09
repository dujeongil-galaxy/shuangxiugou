// 【本机专用 · 不挂 CI】依赖本机无头 Edge 绝对路径，CI runner 无此文件；真渲染验收只在本机跑（verify §21o 咬此标记）。
const { cacheRoot, cacheDir } = require('./_cache-dir.cjs');
// 真渲染验收：搜索框删空 → 整屏 frosted 闪屏并覆盖顺序复位回放（2026-11-05 / 11-07）
// 无头 Edge + CDP；照 test-filter-flash.cjs / dbg-search-clear.cjs 的纪律：
// 先清抖音弹窗 .dyp；真实键盘事件输入/删除；清空后 120ms 验遮罩规格与层级，
// 并插一个模拟「首屏预加载层」（z-index 2147483647）确认它被压住、看不见转圈。
// 2026-11-07 新增：页内 40ms 采样器记录整条时间线，断言 500ms 之后回放窗口
// 仍全程模糊、搜索框回填词时绝不裸露、撤遮罩时搜索框已是空白且结果已全量。
// CDP 逐次采样本身有几十毫秒延迟，靠页内日志才能稳定验住这条时间线。
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 19371;
const DBG = 19471;
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'shot-search-clear-flash.png');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const server = http.createServer((req, res) => {
  let p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (p.endsWith('/') || p.endsWith('\\')) p = path.join(p, 'index.html');
  fs.readFile(p, (err, data) => {
    if (err) { res.writeHead(404); res.end('nf'); return; }
    const ext = path.extname(p);
    const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' }[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime + '; charset=utf-8' });
    res.end(data);
  });
});

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const prof = path.join(cacheRoot(), 'edgeprof-scf' + Date.now());
  const edge = spawn(EDGE, [
    '--headless=new', '--disk-cache-size=1', `--remote-debugging-port=${DBG}`,
    '--no-first-run', '--window-size=1280,900', '--force-device-scale-factor=1',
    '--user-data-dir=' + prof,
    `http://127.0.0.1:${PORT}/?nocache=${Date.now()}`
  ], { stdio: 'ignore' });

  await sleep(7000);
  const list = await (await fetch(`http://127.0.0.1:${DBG}/json`)).json();
  const page = list.find(t => t.type === 'page' && /127\.0\.0\.1/.test(t.url)) || list.find(t => t.type === 'page');
  const WebSocket = require('ws');
  const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
  await new Promise(r => ws.on('open', r));
  let mid = 0; const pending = new Map();
  ws.on('message', raw => { const m = JSON.parse(raw); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
  const call = (method, params) => new Promise(res => { const i = ++mid; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
  const ev = async (expr) => { const r = await call('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r.result && r.result.result && r.result.result.value; };

  await call('Runtime.enable');
  for (let i = 0; i < 40; i++) {
    const ready = await ev(`(()=>{const i=document.getElementById('site-search-input');const c=document.querySelector('div.bg-white.rounded-2xl.border');return !!(i&&c);})()`);
    if (ready) break;
    await sleep(500);
  }
  await ev(`(()=>{const d=document.querySelector('.dyp'); if(d) d.remove(); return 'ok';})()`);
  await ev(`(()=>{const i=document.getElementById('site-search-input'); if(i) i.scrollIntoView({block:'center'}); return 'ok';})()`);
  await sleep(400);
  // 预热合成器：headless Edge 首次截图要几百 ms，会把 500ms 闪屏窗口耗掉。
  await call('Page.captureScreenshot', { format: 'png' });
  await call('Page.captureScreenshot', { format: 'png' });

  // 模拟「预加载动画又在清空瞬间冒出来」：复刻首屏层的 id / z-index / spinner。
  // 它比 frosted 遮罩（8000）高得多，只有 CSS 兜底能压住。
  await ev(`(()=>{if(document.getElementById('sxg-loading'))return 'exists';` +
    `var d=document.createElement('div');d.id='sxg-loading';` +
    `d.style.cssText='position:fixed;inset:0;z-index:2147483647;background:#fff;display:flex;align-items:center;justify-content:center';` +
    `d.innerHTML='<div class="sxg-boot__spinner"></div><p class="sxg-boot__text">页面加载中…</p>';` +
    `document.body.appendChild(d);return 'injected';})()`);

  const sample = `(function(){` +
    `var m=document.getElementById('sxg-flash-mask');` +
    `var cs=m?getComputedStyle(m):null;var mr=m?m.getBoundingClientRect():null;` +
    `var card=document.querySelector('div.bg-white.rounded-2xl.border');` +
    `var rb=[...document.querySelectorAll('button')].find(b=>['全部评级','S 级','A 级','B 级','C 级','D 级','U 级'].indexOf((b.textContent||'').trim())!==-1);` +
    `var ov=document.getElementById('sxg-loading');` +
    `/* 只查加载动画相关选择器：全 DOM 逐个 getComputedStyle 在 175 张卡的页面上会把 500ms 闪屏窗口耗光，截图会拍到「闪屏已撤」 */` +
    `var anim=0;['#sxg-loading .sxg-boot__spinner','.sxg-boot .sxg-boot__spinner','[class*=animate-spin]'].forEach(function(sel){` +
    `document.querySelectorAll(sel).forEach(function(e){var s=getComputedStyle(e);` +
    `if(s.animationName&&s.animationName!=='none'&&s.visibility!=='hidden'&&s.display!=='none')anim++;});});` +
    `return JSON.stringify({flashing:document.body.classList.contains('sxg-filter-flashing'),` +
    `mask:m?{display:cs.display,backdrop:cs.backdropFilter||cs.webkitBackdropFilter||'',z:cs.zIndex,top:cs.top,bg:cs.backgroundColor,pe:cs.pointerEvents,rectTop:Math.round(mr.top)}:null,` +
    `cardFilter:card?getComputedStyle(card).filter:'no-card',` +
    `cards:document.querySelectorAll('div.bg-white.rounded-2xl.border').length,` +
    `ratingBottom:rb?Math.round(rb.getBoundingClientRect().bottom):null,` +
    `loadingVisibility:ov?getComputedStyle(ov).visibility:'absent',` +
    `visibleAnimations:anim,value:document.getElementById('site-search-input').value});})()`;
  const snap = async () => JSON.parse(await ev(sample));

  const results = [];
  const check = (label, cond, extra) => {
    results.push({ label, ok: !!cond });
    console.log(cond ? '  ✓' : '  ✗', label, cond ? '' : JSON.stringify(extra));
  };

  const pre = await snap();
  check('模拟预加载层在闪屏前是可见的（对照组有效）', pre.loadingVisibility === 'visible', pre.loadingVisibility);

  // focus + 逐字输入中文词（分两次，验证打字过程不闪）
  await ev(`(()=>{document.getElementById('site-search-input').focus();return 'ok';})()`);
  await call('Input.insertText', { text: '银' });
  await sleep(120);
  const typing = await snap();
  check('★ 打字过程不闪（输入第一个字）', !typing.flashing && (!typing.mask || typing.mask.display === 'none'), typing);
  await call('Input.insertText', { text: '行' });
  await sleep(800);
  const searching = await snap();
  check('搜索态卡片确实被过滤（123 张左右，非全量）', searching.cards < 160, searching.cards);

  // 页内高频采样器：从删除动作前开始记录，避免 CDP 往返耗时掩盖时间线
  await ev(`(()=>{window.__t0=Date.now();window.__flashLog=[];
    window.__flashTimer=setInterval(function(){var m=document.getElementById('sxg-flash-mask');
      var i=document.getElementById('site-search-input');
      window.__flashLog.push({t:Date.now()-window.__t0,
        flashing:document.body.classList.contains('sxg-filter-flashing'),
        display:m?getComputedStyle(m).display:'absent',top:m?m.style.top:'',
        value:i?i.value:null,
        cards:[].slice.call(document.querySelectorAll('div.bg-white.rounded-2xl.border')).filter(function(c){return c.offsetParent!==null;}).length});},40);
    return 'started';})()`);

  // 逐字删除：第一次删到「银」不该闪，第二次删空才闪
  for (let k = 0; k < 2; k++) {
    await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 });
    await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 });
    if (k === 0) {
      await sleep(70);
      const half = await snap();
      check('★ 删到一半（还剩一个字）不闪', !half.flashing, half);
    }
  }
  await ev(`(()=>{window.__clearedAt=Date.now()-window.__t0;return window.__clearedAt;})()`);
  await sleep(60);
  const during = await snap();
  console.log('清空后 ~130ms 采样:', JSON.stringify(during));

  check('★ 清空触发 body.sxg-filter-flashing', during.flashing === true, during);
  check('★ #sxg-flash-mask 显示（与评级切换同一节点）', during.mask && during.mask.display === 'block', during.mask);
  check('★ computed backdrop-filter = blur(36px) saturate(0.7)',
    !!during.mask && /blur\(36px\) saturate\(0\.7\)/.test(during.mask.backdrop), during.mask);
  check('遮罩 z-index=8000 / 0.9 底色 / pointer-events:none',
    !!during.mask && during.mask.z === '8000' && /252, 252, 253/.test(during.mask.bg) && during.mask.pe === 'none', during.mask);
  check('★ 搜索清空遮罩 top=0（整屏糊，搜索框与拼音联想面板一起盖住）',
    during.mask.top === '0px', { top: during.mask.top });
  check('★ 卡片区 computed filter=blur(20px)', /blur\(20px\)/.test(during.cardFilter), during.cardFilter);
  check('★★ 高 z-index 预加载层被压成 visibility:hidden（转圈肉眼不可见）',
    during.loadingVisibility === 'hidden', during.loadingVisibility);
  check('★ 闪屏期没有可见的加载动画元素（.dyp 弹窗除外）', during.visibleAnimations === 0, during.visibleAnimations);

  // 截图：闪屏已挂起到回放结束（约 1.6s），窗口比旧版 500ms 宽得多，
  // 直接截当前帧即可；不再重新触发一次清空，避免叠加第二次 hold 打乱时间线。
  const cap = await call('Page.captureScreenshot', { format: 'png' });
  let shot = cap.result.data;
  const shotState = await snap();
  const realFrame = shotState.flashing && shotState.mask.display === 'block';
  if (!realFrame) {
    // 极端情况下截图慢于整个挂起窗口：补一张「闪屏态摆拍」肉眼确认磨砂效果。
    // 摆拍前后必须逐字段恢复现场，否则会污染页内时间线日志。
    const prev = await ev(`JSON.stringify({f:document.body.classList.contains('sxg-filter-flashing'),` +
      `top:(document.getElementById('sxg-flash-mask')||{style:{}}).style.top,` +
      `disp:(document.getElementById('sxg-flash-mask')||{style:{}}).style.display})`);
    await ev(`(()=>{document.body.classList.add('sxg-filter-flashing');` +
      `var m=document.getElementById('sxg-flash-mask');` +
      `if(m){m.style.top='0px';m.style.display='block';}return 'ok';})()`);
    const posed = await snap();
    check('★ 闪屏态真渲染：computed backdrop-filter 仍是 blur(36px)（磨砂确实生效）',
      /blur\(36px\) saturate\(0\.7\)/.test(posed.mask.backdrop) && posed.loadingVisibility === 'hidden',
      { backdrop: posed.mask.backdrop, loading: posed.loadingVisibility });
    const cap2 = await call('Page.captureScreenshot', { format: 'png' });
    shot = cap2.result.data;
    await ev(`(()=>{var o=JSON.parse(${JSON.stringify(prev)});var m=document.getElementById('sxg-flash-mask');` +
      `document.body.classList.toggle('sxg-filter-flashing',o.f);` +
      `if(m){m.style.top=o.top;m.style.display=o.disp;}return 'ok';})()`);
  }
  fs.writeFileSync(OUT, Buffer.from(shot, 'base64'));
  console.log('截图来源:', realFrame ? '真实清空触发帧' : '闪屏态摆拍（真实触发由上方 DOM 断言验证）');
  console.log('闪屏中截图:', OUT);

  // 回放（1200ms）+ release 宽限（450ms）之后收日志，取页内 40ms 时间线
  await sleep(2600);
  await ev(`(()=>{clearInterval(window.__flashTimer);return 'stopped';})()`);
  const tl = JSON.parse(await ev(`JSON.stringify({clearedAt:window.__clearedAt,log:window.__flashLog})`));
  const afterClear = tl.log.filter(x => x.t >= tl.clearedAt);
  const replayed = afterClear.some(x => x.value && x.value.trim() !== '');
  const leaked = afterClear.filter(x => x.value && x.value.trim() !== '' && !x.flashing);
  const visibleMasks = afterClear.filter(x => x.display === 'block');
  console.log('页内时间线:', JSON.stringify({
    clearedAt: tl.clearedAt, samples: afterClear.length, replayed,
    first: afterClear[0], at600: afterClear.find(x => x.t >= tl.clearedAt + 600),
    at1200: afterClear.find(x => x.t >= tl.clearedAt + 1200), last: afterClear[afterClear.length - 1]
  }));

  check('★ 清空后立刻进入高度模糊（页内时间线首个样本即 flashing）',
    afterClear.length > 10 && afterClear[0].flashing && afterClear[0].display === 'block', afterClear[0]);
  check('★ 整段时间线里遮罩 top 恒为 0px（整屏糊，不退回工具条以下）',
    visibleMasks.length > 0 && visibleMasks.every(x => x.top === '0px'), visibleMasks.slice(0, 3));
  check('★ 顺序复位回放确实发生过（搜索框回填过最近词，对照组有效）', replayed,
    { samples: afterClear.length });
  check('★★ 回放回填词的每一帧都被高度模糊盖住（删空后不会再看见词冒出来）',
    replayed && leaked.length === 0, { leaked: leaked.slice(0, 5) });
  check('★★ 旧版 500ms 就撤的窗口现在仍在模糊（t≥600ms / t≥1200ms 都还 flashing）',
    afterClear.some(x => x.t >= tl.clearedAt + 600 && x.flashing) &&
    afterClear.some(x => x.t >= tl.clearedAt + 1200 && x.flashing),
    { at600: afterClear.find(x => x.t >= tl.clearedAt + 600), at1200: afterClear.find(x => x.t >= tl.clearedAt + 1200) });

  const after = await snap();
  check('★ 回放结束 + 宽限期后闪屏自动撤除（class / mask / 卡片模糊全清）',
    !after.flashing && after.mask.display === 'none' && !/blur/.test(after.cardFilter), after);
  check('★ 撤遮罩时搜索框留空白（值已为空，不是回填态）', after.value === '', after.value);
  check('★ 撤遮罩后结果已是全量最终态（>170 张卡）', after.cards > 170, after.cards);
  check('闪屏结束后预加载层恢复可见（CSS 只在闪屏期生效，不永久隐藏）',
    after.loadingVisibility === 'visible', after.loadingVisibility);

  // 品类卡切换：站长明确「暂时先不改」
  const cat = await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').trim()==='数码外设');if(!b)return 'no-btn';b.click();return 'clicked';})()`);
  await sleep(90);
  const afterCat = await snap();
  check('★ 品类卡「数码外设」点击不闪（暂不接入）', cat === 'clicked' && !afterCat.flashing, { cat, flashing: afterCat.flashing });

  // 评级切换回归
  await sleep(200);
  const grade = await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').trim()==='A 级');if(!b)return 'no-btn';b.click();return 'clicked';})()`);
  await sleep(90);
  const afterGrade = await snap();
  check('评级按钮「A 级」点击仍然闪（v2 回归）', grade === 'clicked' && afterGrade.flashing && afterGrade.mask.display === 'block', { grade, flashing: afterGrade.flashing });

  await ev(`(()=>{const d=document.getElementById('sxg-loading'); if(d) d.remove(); return 'ok';})()`);

  const fail = results.filter(r => !r.ok);
  console.log(`\n${results.length - fail.length} 通过, ${fail.length} 失败`);
  console.log('验收状态:', fail.length ? 'FAIL（' + fail.map(f => f.label).join(' | ') + '）' : 'PASS');

  ws.close(); edge.kill(); server.close();
  try { fs.rmSync(prof, { recursive: true, force: true }); } catch (e) {}
  process.exit(fail.length ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
