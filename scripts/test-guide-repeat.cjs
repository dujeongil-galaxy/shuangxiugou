// 顶部「打卡并生成小票」引导弹窗 · 第二次及以后点击行为（2026-11-05 站长需求）
//
// 背景：原实现 guideShown 是布尔，首弹「知道了」关闭后再点按钮 = 静默吞掉，毫无响应。
// 现要求第二次及以后弹一则轻量提醒，口径与首弹不同，仍然友好、仍把人往档案卡引。
//
// 断言：
//   1. 首次点击 → 弹长说明（标题含「打卡要对具体品牌」，按钮「去下面看看/知道了」）
//   2. 「知道了」→ 弹层关闭
//   3. 第二次点击 → 再弹轻量提醒（不是无响应），标题/按钮文案与首弹不同
//   4. 第三次点击 → 仍弹（第三次起按钮文案「又来啦？带我去」）
//   5. 重复提醒的「这次带我去」也能关层并滚到档案区
//   6. sessionStorage 标记写入且随弹次更新
// 故障注入红线：把 openGuideModal 退回布尔短路 → 断言 3/4 判红（镜像 verify）。
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

(async () => {
  console.log('=== 顶部打卡按钮：第二次及以后点击提醒 ===\n');

  // 最小真实结构：顶部按钮 + 档案区锚点。脚本通过 IIFE init 自绑
  const dom = new JSDOM('<!doctype html><html><body>' +
    '<button>打卡并生成小票</button>' +
    '<p>引导文案占位</p>' +
    '<input id="site-search-input">' +
    '</body></html>', { runScripts: 'outside-only', url: 'http://localhost/' });
  const { document } = dom.window;
  const w = dom.window;
  // jsdom 不实现 scrollIntoView；带上路按钮的弹窗会调它，
  // 不 stub 会往 stderr 抛一串未捕获异常（退出码虽为 0，日志很脏）。
  w.HTMLElement.prototype.scrollIntoView = function () {};

  // 注入脚本源码并在 JSDOM 环境求值（custom-card-actions.js 是无导出 IIFE，
  // 需要拼一层 window 挂钩：脚本内部 init 自带 setTimeout 触发）
  const src = fs.readFileSync(path.join(ROOT, 'custom-card-actions.js'), 'utf8');
  w.eval(src);

  // 等脚本自身 init setTimeout 跑完并完成绑定
  await new Promise((r) => setTimeout(r, 120));
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent === '打卡并生成小票');
  check('脚本能独立运行并绑定顶部按钮（data-sxg-guide-bound=1）',
    btn && btn.getAttribute('data-sxg-guide-bound') === '1');

  // 弹层是 class="sxg-layer"，没有 id（ensureLayer 只给 class）。
  // 旧写法 [id^="sxg-"] 恒为 null，会把「弹窗已弹出」误判成失败。
  const layer = () => document.querySelector('.sxg-layer');
  const layerHtml = () => { const l = layer(); return l ? l.textContent : ''; };
  const visibleBox = () => { const l = layer(); return l && l.lastElementChild ? l.lastElementChild : null; };

  // 1. 首次点击 → 长说明弹窗
  btn.dispatchEvent(new w.Event('click', { bubbles: true, cancelable: true }));
  let box = visibleBox();
  check('首次点击 → 弹出引导说明', !!box && /打卡要对具体品牌/.test(box.textContent));
  check('首弹文案含「去下面看看 / 知道了」双按钮', !!box && /去下面看看/.test(box.textContent) && /知道了/.test(box.textContent));

  // 2. 点「知道了」→ 关闭
  const closeBtn = [...box.querySelectorAll('button')].find((b) => b.textContent === '知道了');
  check('首弹含「知道了」按钮', !!closeBtn);
  closeBtn.dispatchEvent(new w.Event('click', { bubbles: true }));
  check('点「知道了」→ 弹层关闭', !layer() || layer().childElementCount === 0 || !visibleBox());

  // 3. 第二次点击 → 轻量提醒（口径不同）
  btn.dispatchEvent(new w.Event('click', { bubbles: true, cancelable: true }));
  box = visibleBox();
  check('★ 第二次点击 → 仍有提示弹出（不再是毫无响应）', !!box);
  check('★ 第二弹口径与首弹不同（标题/正文均非首弹文案）',
    !!box && !/打卡要对具体品牌/.test(box.textContent) && !/怎么打卡：/.test(box.textContent));
  check('第二弹按钮文案与首弹不同（我自己翻，非「知道了」）',
    !!box && !/知道了/.test(box.textContent) && /我自己翻/.test(box.textContent));
  check('第二弹带路按钮存在（这次带我去）', !!box && /这次带我去/.test(box.textContent));

  const goBtn = [...box.querySelectorAll('button')].find((b) => b.textContent === '这次带我去');
  goBtn.dispatchEvent(new w.Event('click', { bubbles: true }));
  check('重复弹「带我去」→ 关层', !visibleBox());

  // 4. 第三次点击 → 仍然弹 + 玩味文案区分
  btn.dispatchEvent(new w.Event('click', { bubbles: true, cancelable: true }));
  box = visibleBox();
  check('★ 第三次点击 → 弹出（第 N 次也不静默）', !!box);
  check('第三次起按钮文案改为「又来啦？带我去」（随弹次变化）', !!box && /又来啦？带我去/.test(box.textContent));

  const closeBtn2 = [...box.querySelectorAll('button')].find((b) => b.textContent === '我自己翻');
  closeBtn2.dispatchEvent(new w.Event('click', { bubbles: true }));

  // 6. sessionStorage 标记
  check('sessionStorage 写入 sxg-guide-checkin 且随弹次更新（=3）',
    w.sessionStorage.getItem('sxg-guide-checkin') === '3',
    w.sessionStorage.getItem('sxg-guide-checkin'));

  console.log(`\n${pass} 通过, ${fail} 失败`);
  if (fail) { console.log('FAIL:', fails.join(' | ')); process.exit(1); }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
