// 搜索框删空 → 与评级切换同一套 frosted 闪屏（2026-11-05 站长需求）
// 2026-11-07 17:45 扩：删空留白整屏糊 + 顺序复位回放期间挂起撤除 + 任意词一致
// 2026-11-10 站长批次：拼音搜索后删除的返回动画**强制 6 秒**，遮罩内显示每秒
//   递减的倒计时，提示词「正在加载缓存，请稍后x秒」；评级切换仍 500ms + 「加载中…」。
//   hold/release 契约仍在，但强制期内不得提前撤除；看门狗必须长于 6 秒 deadline。
//
// 背景：清空搜索框时 React 把被过滤的卡一次性插回，肉眼看得见一次新的预加载动画。
// 要求「和切换评价卡保持一致，高度模糊遮挡预加载动画」，且「品类卡切换暂时先不改」。
//
// 断言：
//   1. 打字 / 删到一半 / 已空后重复 Backspace → 都不闪、也不重置倒计时
//   2. 清空 → body.sxg-filter-flashing + #sxg-flash-mask 显示，top=0 整屏
//   3. ★ 初始倒计时 6 秒，1 秒后递减；遮罩规格仍是 z-index 8000 / blur(36px)
//   4. 闪屏期 CSS 压住 #sxg-loading / .sxg-boot / #pinyin-suggest
//   5. 评级按钮点击仍闪、仍是 500ms + 「加载中…」；品类按钮点击不闪
//   6. 其它输入框清空不误触发
//   7. ★ 任意词（中文 / 拼音 / 英文 / 首字母）删空一律 6 秒 + 倒计时
//   8. ★ hold 期间、release 之后都仍在强制期，绝不提前撤；6 秒整自动撤除
//   9. ★ release 丢失时看门狗不早于 6 秒 deadline，最终仍能撤除（不永久糊住）
// 故障注入红线：
//   a. 把边沿条件改成 `now === ''` → 断言「打字不闪」「已空不重复闪」判红
//   b. 删掉 `flash(0, 'search')` → 断言「清空会闪」判红
//   c. 删掉预加载层 CSS → 断言「压住 #sxg-loading」判红
//   d. 把 SEARCH_DURATION 改回 500 → 断言「强制 6 秒」判红
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
const fails = [];
const check = (label, cond, extra) => {
  if (cond) { pass++; console.log('  ✓', label); }
  else { fail++; fails.push(label); console.log('  ✗', label, extra !== undefined ? JSON.stringify(extra) : ''); }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  console.log('=== 搜索清空 frosted 闪屏：强制 6 秒 + 倒计时 ===\n');

  const dom = new JSDOM('<!doctype html><html><head></head><body>' +
    '<div id="sxg-loading"><div class="sxg-boot__spinner"></div></div>' +
    '<div id="root"><div class="sxg-boot"></div></div>' +
    '<input id="site-search-input">' +
    '<input id="some-other-input">' +
    '<button>全部评级</button><button>A 级</button>' +
    '<button>全部</button><button>数码外设</button>' +
    '<div class="bg-white rounded-2xl border">卡片</div>' +
    '</body></html>', { runScripts: 'outside-only', url: 'http://localhost/' });
  const w = dom.window;
  const { document } = w;

  // 让几何可断言：评级工具条底边 520，搜索框底边 400。
  // 若实现误用搜索框底边，top 会是 404 而不是 524。
  const ratingBtns = [...document.querySelectorAll('button')].filter(b => /全部评级|A 级/.test(b.textContent));
  ratingBtns.forEach(b => { b.getBoundingClientRect = () => ({ bottom: 520, top: 500, left: 0, right: 10, width: 10, height: 20 }); });
  const input = document.getElementById('site-search-input');
  input.getBoundingClientRect = () => ({ bottom: 400, top: 370, left: 0, right: 10, width: 10, height: 30 });

  w.eval(fs.readFileSync(path.join(ROOT, 'filter-flash.js'), 'utf8'));

  const mask = () => document.getElementById('sxg-flash-mask');
  const flashing = () => document.body.classList.contains('sxg-filter-flashing');
  const visible = () => { const m = mask(); return !!m && m.style.display === 'block'; };
  const tip = () => {
    const n = mask() && mask().querySelector('.sxg-flash-tip');
    return n ? n.textContent : '';
  };
  const secs = () => { const m = /请稍后(\d+)秒/.exec(tip()); return m ? Number(m[1]) : 0; };
  const setter = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value').set;

  function typeOn(el, val) {
    el.dispatchEvent(new w.Event('beforeinput', { bubbles: true, cancelable: true }));
    setter.call(el, val);
    el.dispatchEvent(new w.Event('input', { bubbles: true, cancelable: true }));
  }

  // --- 1. 打字过程不闪 ---
  typeOn(input, '银');
  check('输入第一个字不闪（打字过程不该糊）', !flashing() && !visible());
  typeOn(input, '银行');
  check('继续输入不闪', !flashing() && !visible());
  typeOn(input, '银');
  check('删到一半不闪（只在完全清空时触发）', !flashing() && !visible());

  // --- 2. 完全清空 → 闪 + 初始倒计时 ---
  typeOn(input, '');
  const t0 = Date.now();
  check('★ 搜索框「非空 → 空」触发闪屏', flashing());
  check('★ 遮罩显示（与评级切换同一个 #sxg-flash-mask）', visible(), mask() && mask().style.cssText);
  check('★ 搜索清空遮罩 top=0 整屏糊（搜索框与联想面板一起盖住，回放回填词不可见）',
    mask().style.top === '0px', mask().style.top);
  check('★ 提示词改为「正在加载缓存，请稍后6秒」（站长 2026-11-10 指定）',
    tip() === '正在加载缓存，请稍后6秒', tip());
  // jsdom 的 cssstyle 不认 backdrop-filter，会把它从 cssText 丢掉；
  // 模糊规格由 verify 静态断言 + CDP 真渲染 computed 断言共同守，
  // 这里只验 jsdom 能保留的层级/底色/穿透三项。
  const ffSrc = fs.readFileSync(path.join(ROOT, 'filter-flash.js'), 'utf8');
  check('遮罩层级 8000 / 0.9 底色 / 不挡点击',
    /z-index: ?8000/.test(mask().style.cssText || '') &&
    /rgba\(252, ?252, ?253, ?0\.9\)/.test(mask().style.cssText || '') &&
    /pointer-events: ?none/.test(mask().style.cssText || ''), mask().style.cssText);
  check('源码里仍有 backdrop-filter:blur(36px) saturate(0.7)（与评级切换同规格）',
    /backdrop-filter:blur\(36px\) saturate\(0\.7\)/.test(ffSrc));
  check('源码里 SEARCH_DURATION = 6000 / TICK_MS = 1000（强制 6 秒、每秒刷新）',
    /var SEARCH_DURATION = 6000/.test(ffSrc) && /var TICK_MS = 1000/.test(ffSrc));
  check('卡片区同时被 blur(20px) 样式规则覆盖',
    /body\.sxg-filter-flashing div\.bg-white\.rounded-2xl\.border/.test(document.getElementById('sxg-filter-flash-style').textContent));

  // --- 2b. 遮罩内加载动画（2026-11-08 站长：近白磨砂被当成白屏/卡死而退出） ---
  const flashBox = mask().querySelector('.sxg-flash-box');
  check('★ 闪屏遮罩内含加载动画容器（评级切换与搜索清空共用）', !!flashBox);
  check('★ 容器内是转圈节点 .sxg-flash-spin（明确的进行中状态）',
    !!flashBox && !!flashBox.querySelector('.sxg-flash-spin'));
  const ffCss = document.getElementById('sxg-filter-flash-style').textContent;
  check('加载动画 CSS 有旋转 keyframes 且尊重 prefers-reduced-motion',
    /@keyframes sxg-flash-spin/.test(ffCss) && /prefers-reduced-motion:reduce/.test(ffCss));

  // --- 3. 预加载层兜底 ---
  const css = document.getElementById('sxg-filter-flash-style').textContent;
  check('★ 闪屏期 CSS 压住 #sxg-loading（z-index 2147483647 那层）',
    /body\.sxg-filter-flashing #sxg-loading/.test(css) && /visibility:hidden!important/.test(css));
  check('首屏占位 .sxg-boot / spinner 同样被压住',
    /body\.sxg-filter-flashing \.sxg-boot/.test(css) && /\.sxg-boot__spinner/.test(css));
  check('★ 拼音联想面板 #pinyin-suggest 闪屏期一并压住（整屏糊不被高层联想条漏出）',
    /body\.sxg-filter-flashing #pinyin-suggest/.test(css));

  // --- 4. 倒计时每秒递减 + 强制期不提前撤 ---
  await sleep(1150);
  check('★ 1 秒后倒计时确实递减（不是静态文案）', secs() >= 1 && secs() < 6, { tip: tip(), secs: secs() });
  check('★ 1.15s 时遮罩仍在（旧版 500ms 早就撤了，现已强制 6 秒）',
    flashing() && visible(), { flashing: flashing(), display: mask().style.display });

  // --- 5. 已空后重复 Backspace 不重置倒计时 ---
  const beforeRepeat = secs();
  typeOn(input, '');   // 空 → 空，不该重新计时
  check('★ 已空后重复 Backspace 不重置 6 秒倒计时（边沿触发）',
    secs() === beforeRepeat && flashing() && visible(), { before: beforeRepeat, after: secs() });

  // --- 6. hold / release 都不得提前撤除强制期 ---
  document.dispatchEvent(new w.CustomEvent('sxg-scof-hold'));
  await sleep(620);
  check('★ hold 期间超过旧 500ms 仍保持高度模糊（1.2s 回放全程不裸露）',
    flashing() && visible(), { flashing: flashing(), display: mask().style.display });
  document.dispatchEvent(new w.CustomEvent('sxg-scof-release'));
  await sleep(250);
  check('★ release 之后仍保持模糊（强制 6 秒不被提前撤除）',
    flashing() && visible(), { tip: tip(), secs: secs() });

  // --- 7. 6 秒整自动撤除 ---
  await sleep(Math.max(0, 6250 - (Date.now() - t0)));
  check('★ 强制 6 秒到期自动撤除（不永久糊住页面）',
    !flashing() && !visible(), { flashing: flashing(), display: mask().style.display });

  // --- 8. 评级按钮点击回归（仍 500ms + 「加载中…」） ---
  ratingBtns[1].dispatchEvent(new w.Event('click', { bubbles: true, cancelable: true }));
  check('评级按钮「A 级」点击仍然闪（v2 行为未回归）', flashing() && visible());
  check('评级点击的遮罩 top = 按钮底边 520+4=524', mask().style.top === '524px', mask().style.top);
  check('评级切换提示词仍是「加载中…」（6 秒倒计时口径没有扩大）',
    tip() === '加载中…', tip());
  await sleep(560);
  check('评级闪屏 500ms 后自动撤除', !flashing() && !visible());

  // --- 9. 品类卡点击不闪（站长明确暂不改）---
  const catBtns = [...document.querySelectorAll('button')].filter(b => b.textContent === '全部' || b.textContent === '数码外设');
  catBtns.forEach(b => b.dispatchEvent(new w.Event('click', { bubbles: true, cancelable: true })));
  check('★ 品类卡「全部 / 数码外设」点击不闪（站长要求暂不接入）', !flashing() && !visible());

  // --- 10. 其它输入框清空不误触发 ---
  typeOn(document.getElementById('some-other-input'), 'x');
  typeOn(document.getElementById('some-other-input'), '');
  check('其它输入框清空不误触发闪屏', !flashing() && !visible());

  // --- 11. 无 beforeinput 的环境也能靠 lastValue 兜底 ---
  setter.call(input, '小米');
  input.dispatchEvent(new w.Event('input', { bubbles: true, cancelable: true }));
  setter.call(input, '');
  input.dispatchEvent(new w.Event('input', { bubbles: true, cancelable: true }));
  check('无 beforeinput 时靠上一次 input 值仍能判出清空（兼容兜底）', flashing() && visible());

  // --- 12. 任意搜索词一律同样处理（站长：无论搜的是什么） ---
  for (const word of ['小米', '腾讯', 'xiaomi', 'Patagonia', 'xm']) {
    typeOn(input, word);
    check(`输入「${word}」过程不重置倒计时`, secs() >= 1 && secs() <= 6, tip());
    typeOn(input, '');
    check(`★ 任意词「${word}」删空都触发 6 秒整屏模糊 + 倒计时`,
      flashing() && visible() && mask().style.top === '0px' && secs() === 6,
      { flashing: flashing(), top: mask().style.top, tip: tip() });
  }

  // --- 13. 看门狗：release 丢失也不早于 6 秒、最终仍能撤 ---
  const t1 = Date.now();
  document.dispatchEvent(new w.CustomEvent('sxg-scof-hold'));
  await sleep(3200);
  check('★ release 丢失后 3.2s 仍在强制期（看门狗不能早于 6 秒 deadline）',
    flashing() && visible(), { flashing: flashing(), secs: secs() });
  await sleep(Math.max(0, 6300 - (Date.now() - t1)));
  check('★ release 丢失时看门狗最终撤除遮罩（不永久糊住页面）',
    !flashing() && !visible(), { flashing: flashing(), display: mask().style.display });

  console.log(`\n${pass} 通过, ${fail} 失败`);
  if (fail) { console.log('FAIL:', fails.join(' | ')); process.exit(1); }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
