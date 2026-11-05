// 搜索框删空 → 与评级切换同一套 frosted 闪屏（2026-11-05 站长需求）
//
// 背景：清空搜索框时 React 把被过滤的卡一次性插回，肉眼看得见一次新的预加载动画。
// 要求「和切换评价卡保持一致，高度模糊遮挡预加载动画」，且「品类卡切换暂时先不改」。
//
// 断言：
//   1. 打字 / 删到一半 / 已空后重复 Backspace → 都不闪（只在非空→空边沿触发）
//   2. 清空 → body.sxg-filter-flashing + #sxg-flash-mask 显示，top 取评级工具条底边+4
//   3. 遮罩规格 z-index/backdrop 与评级切换共用同一节点，500ms 后自动撤除
//   4. 闪屏期 CSS 压住 #sxg-loading / .sxg-boot（z-index 2147483647 盖不住的那层）
//   5. 评级按钮点击仍闪（回归）；品类按钮点击不闪（站长明确暂不改）
//   6. 其它输入框清空不误触发
// 故障注入红线：
//   a. 把边沿条件改成 `now === ''` → 断言「打字不闪」「已空不重复闪」判红
//   b. 删掉 `flash(ratingBarBottom())` → 断言「清空会闪」判红
//   c. 删掉预加载层 CSS → 断言「压住 #sxg-loading」判红
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
  console.log('=== 搜索清空 frosted 闪屏（与评级切换一致）===\n');

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

  // --- 2. 完全清空 → 闪 ---
  typeOn(input, '');
  check('★ 搜索框「非空 → 空」触发闪屏', flashing());
  check('★ 遮罩显示（与评级切换同一个 #sxg-flash-mask）', visible(), mask() && mask().style.cssText);
  check('遮罩 top 取评级工具条底边 520+4=524（不是搜索框底边 404）',
    mask().style.top === '524px', mask().style.top);
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
  check('卡片区同时被 blur(20px) 样式规则覆盖',
    /body\.sxg-filter-flashing div\.bg-white\.rounded-2xl\.border/.test(document.getElementById('sxg-filter-flash-style').textContent));

  // --- 3. 预加载层兜底 ---
  const css = document.getElementById('sxg-filter-flash-style').textContent;
  check('★ 闪屏期 CSS 压住 #sxg-loading（z-index 2147483647 那层）',
    /body\.sxg-filter-flashing #sxg-loading/.test(css) && /visibility:hidden!important/.test(css));
  check('首屏占位 .sxg-boot / spinner 同样被压住',
    /body\.sxg-filter-flashing \.sxg-boot/.test(css) && /\.sxg-boot__spinner/.test(css));

  // --- 4. 已空后重复 Backspace 不重置闪屏 ---
  await sleep(380);
  typeOn(input, '');   // 空 → 空，不该重新计时
  await sleep(180);    // 累计 560ms > 500ms
  check('★ 已空后重复 Backspace 不延长闪屏（边沿触发，非「值为空就闪」）',
    !flashing() && !visible(), { flashing: flashing(), display: mask().style.display });

  // --- 5. 评级按钮点击回归 ---
  ratingBtns[1].dispatchEvent(new w.Event('click', { bubbles: true, cancelable: true }));
  check('评级按钮「A 级」点击仍然闪（v2 行为未回归）', flashing() && visible());
  check('评级点击的遮罩 top = 按钮底边 520+4=524', mask().style.top === '524px', mask().style.top);
  await sleep(560);
  check('评级闪屏 500ms 后自动撤除', !flashing() && !visible());

  // --- 6. 品类卡点击不闪（站长明确暂不改）---
  // 必须精确匹配：正则 /全部/ 会把「全部评级」也算进来，那是评级按钮、本来就该闪
  const catBtns = [...document.querySelectorAll('button')].filter(b => b.textContent === '全部' || b.textContent === '数码外设');
  catBtns.forEach(b => b.dispatchEvent(new w.Event('click', { bubbles: true, cancelable: true })));
  check('★ 品类卡「全部 / 数码外设」点击不闪（站长要求暂不接入）', !flashing() && !visible());

  // --- 7. 其它输入框清空不误触发 ---
  typeOn(document.getElementById('some-other-input'), 'x');
  typeOn(document.getElementById('some-other-input'), '');
  check('其它输入框清空不误触发闪屏', !flashing() && !visible());

  // --- 8. 无 beforeinput 的环境也能靠 lastValue 兜底 ---
  setter.call(input, '小米');
  input.dispatchEvent(new w.Event('input', { bubbles: true, cancelable: true }));
  setter.call(input, '');
  input.dispatchEvent(new w.Event('input', { bubbles: true, cancelable: true }));
  check('无 beforeinput 时靠上一次 input 值仍能判出清空（兼容兜底）', flashing() && visible());

  console.log(`\n${pass} 通过, ${fail} 失败`);
  if (fail) { console.log('FAIL:', fails.join(' | ')); process.exit(1); }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
