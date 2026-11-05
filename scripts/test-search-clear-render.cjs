// 真渲染验收：搜索框删空 → 与评级切换同一套 frosted 闪屏（2026-11-05）
// 无头 Edge + CDP；照 test-filter-flash.cjs / dbg-search-clear.cjs 的纪律：
// 先清抖音弹窗 .dyp；真实键盘事件输入/删除；清空后 120ms 验遮罩规格与层级，
// 并插一个模拟「首屏预加载层」（z-index 2147483647）确认它被压住、看不见转圈。
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
  const prof = path.join(__dirname, 'edgeprof-scf' + Date.now());
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
  await sleep(60);
  const during = await snap();
  console.log('清空后 ~130ms 采样:', JSON.stringify(during));

  check('★ 清空触发 body.sxg-filter-flashing', during.flashing === true, during);
  check('★ #sxg-flash-mask 显示（与评级切换同一节点）', during.mask && during.mask.display === 'block', during.mask);
  check('★ computed backdrop-filter = blur(36px) saturate(0.7)',
    !!during.mask && /blur\(36px\) saturate\(0\.7\)/.test(during.mask.backdrop), during.mask);
  check('遮罩 z-index=8000 / 0.9 底色 / pointer-events:none',
    !!during.mask && during.mask.z === '8000' && /252, 252, 253/.test(during.mask.bg) && during.mask.pe === 'none', during.mask);
  check('★ 遮罩 top 取评级工具条底边+4（与切评价卡同一几何）',
    during.ratingBottom !== null && Math.abs(parseFloat(during.mask.top) - (during.ratingBottom + 4)) <= 2,
    { top: during.mask.top, ratingBottom: during.ratingBottom });
  check('★ 卡片区 computed filter=blur(20px)', /blur\(20px\)/.test(during.cardFilter), during.cardFilter);
  check('★★ 高 z-index 预加载层被压成 visibility:hidden（转圈肉眼不可见）',
    during.loadingVisibility === 'hidden', during.loadingVisibility);
  check('★ 闪屏期没有可见的加载动画元素（.dyp 弹窗除外）', during.visibleAnimations === 0, during.visibleAnimations);

  // 截图专用：重新触发一次清空，中间不做任何 CDP 采样，
  // 保证 Page.captureScreenshot 落在 500ms 闪屏窗口内
  // （否则拍到的是遮罩已撤、模拟加载层重新露出来的画面）。
  await ev(`(()=>{document.getElementById('site-search-input').focus();return 'ok';})()`);
  await call('Input.insertText', { text: '茶' });
  await sleep(260);
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 });
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 });
  const cap = await call('Page.captureScreenshot', { format: 'png' });
  let shot = cap.result.data;
  const shotState = await snap();
  const realFrame = shotState.flashing && shotState.mask.display === 'block';
  if (!realFrame) {
    // 截图仍慢于 500ms 时，补一张「闪屏态摆拍」用于肉眼确认 CSS 磨砂效果。
    // 真实触发是否生效由上方 17 项 DOM/computed 断言负责，摆拍只管看得见。
    await ev(`(()=>{document.body.classList.add('sxg-filter-flashing');` +
      `var rb=[...document.querySelectorAll('button')].find(b=>['全部评级','S 级','A 级','B 级','C 级','D 级','U 级'].indexOf((b.textContent||'').trim())!==-1);` +
      `var m=document.getElementById('sxg-flash-mask');` +
      `if(m){m.style.top=((rb?rb.getBoundingClientRect().bottom:0)+4)+'px';m.style.display='block';}return 'ok';})()`);
    const held = await snap();
    check('★ 闪屏态真渲染：computed backdrop-filter 仍是 blur(36px)（磨砂确实生效）',
      /blur\(36px\) saturate\(0\.7\)/.test(held.mask.backdrop) && held.loadingVisibility === 'hidden',
      { backdrop: held.mask.backdrop, loading: held.loadingVisibility });
    const cap2 = await call('Page.captureScreenshot', { format: 'png' });
    shot = cap2.result.data;
    await ev(`(()=>{document.body.classList.remove('sxg-filter-flashing');var m=document.getElementById('sxg-flash-mask');if(m)m.style.display='none';return 'ok';})()`);
  }
  fs.writeFileSync(OUT, Buffer.from(shot, 'base64'));
  console.log('截图来源:', realFrame ? '真实清空触发帧' : '闪屏态摆拍（真实触发由上方 DOM 断言验证）');
  console.log('闪屏中截图:', OUT);

  await sleep(650);
  const after = await snap();
  check('★ 500ms 后闪屏自动撤除（class / mask / 卡片模糊全清）',
    !after.flashing && after.mask.display === 'none' && !/blur/.test(after.cardFilter), after);
  check('撤遮罩后结果已是全量最终态（>170 张卡）', after.cards > 170, after.cards);
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
