// 「富士康补充说明」（#apple-note）注入位置回归测试
// 跑法：node scripts/test-apple-note.cjs（需 jsdom，同 CI 其他测试）
//
// 覆盖 PITFALLS 1.10 的三个变体：
//   bug ① 错位：搜索过滤掉苹果卡后，说明框泄漏进华为卡
//   bug ③ 空面板残留：搜索无匹配词（「啊」），所有卡被卸载，说明框孤零零挂空面板
//   bug ④（2026-10-22 站长实测，本次修复）：搜索**命中苹果卡**的词（如「苹果」），
//            苹果卡明明在结果列表里，说明框却被摘掉了。
//
// bug ④ 根因：修 bug ③ 时加的「搜索框一有输入就无条件摘除说明框」这道闸，
// 把「说明框只属浏览态」当成硬规则。正确判据是「苹果卡在不在当前可见列表」。
//
// ⚠️ 本测试必须**自己模拟 React 搜索过滤**（真实移除不匹配的卡片节点）。
//    早期版本依赖 jsdom 里的 bundle 自己过滤，但 jsdom 无布局、React 受控组件
//    的 value tracker 也不吃直接赋 .value 的 input 事件，结果「搜索命中苹果卡」
//    这条路径根本没被走到 —— 注入故障后测试仍然全绿，等于摆设。
//    教训见README「第 5 条最容易踩坑的事」。
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const html = read('index.html');

let pass = 0, fail = 0;
const fails = [];
const check = (l, c, x) => {
  if (c) { pass++; console.log('  ✓', l); }
  else { fail++; fails.push(l); console.log('  ✗', l, x !== undefined ? JSON.stringify(x) : ''); }
};

const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'http://localhost/', pretendToBeVisual: true });
const { window } = dom;
window.matchMedia = (q) => ({ matches: false, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } });
if (!window.requestAnimationFrame) {
  window.requestAnimationFrame = (cb) => window.setTimeout(() => cb(Date.now()), 16);
  window.cancelAnimationFrame = (h) => window.clearTimeout(h);
}
for (const m of html.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)) {
  const clean = m[1].split('?')[0];
  const file = path.join(ROOT, clean);
  if (!fs.existsSync(file)) continue;
  try { window.eval(read(clean)); } catch (e) { /* 脚手架限制 */ }
}

const doc = window.document;
const note = () => doc.getElementById('apple-note');
const cardsOf = () => [...doc.querySelectorAll('div.bg-white.rounded-2xl.border')];
const titleOf = (c) => {
  const t = c.querySelector('h2,h3');
  return t ? t.textContent.trim() : '';
};
const appleCard = () => cardsOf().find((c) => titleOf(c).indexOf('Apple') === 0) || null;
const noteInApple = () => {
  const n = note(); const a = appleCard();
  if (!n || !a) return false;
  return a.contains ? a.contains(n) : (n.parentNode === a);
};
const settle = (ms) => new Promise((r) => setTimeout(r, ms || 350));

/**
 * 模拟 React 搜索：命中 Apple 的查询 → 苹果卡留在DOM；
 * 不命中 / 过滤 → 把苹果卡整棵摘出 DOM（= React 卸载该卡节点）。
 * 无论哪种都派发 input 事件，让 index.html 的同步清理与 rAF 重定位真正跑到。
 * ⚠️ 走原生value setter 绕开 React 受控组件的 value tracker。
 *
 * ⚠️⚠️ 「命中」场景必须在 **input 派发后立刻**取样（syncSample=true），
 *    不能等rAF 重定位跑完 —— 重定位会把说明框重新插回来，掩盖掉同步清理阶段的错误。
 *    bug ④ 的本质就发生在「同步清理」这一瞬：它把框摘了，之后才被异步补回。
 */
function reactSearch(q, syncSample) {
  const i = doc.getElementById('site-search-input');
  if (i) {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value').set;
    setter.call(i, q);
  }
  // 模拟 React 完成过滤后的 DOM 结果
  const keepApple = q.indexOf('苹果') >= 0 || q.indexOf('Apple') >= 0 || q === '';
  const a = appleCard();
  if (!keepApple && a && a.parentNode) a.parentNode.removeChild(a);
  if (i) i.dispatchEvent(new window.Event('input', { bubbles: true }));
  // 同步清理监听器是捕获阶段，dispatchEvent 返回时它已跑完 —— 此刻取样才能抓到它
  if (syncSample) return { hasNote: !!note(), noteInApple: noteInApple() };
  return null;
}

/** 造一张最小苹果卡放进 DOM（供复原用） */
function makeAppleCard() {
  const a = doc.createElement('div');
  a.className = 'bg-white rounded-2xl border';
  a.innerHTML = '<h2>Apple (苹果中国)</h2><div class="flex-wrap"><span>iPhone</span></div>';
  const root = doc.getElementById('root') || doc.body;
  root.appendChild(a);
  return a;
}

setTimeout(async () => {
  console.log('=== apple-note 注入位置回归测试 ===\n');

  // ── 基准：浏览态说明框在苹果卡内 ──
  check('前置：浏览态说明框存在于苹果卡内',
    noteInApple(), { hasNote: !!note(), appleCard: !!appleCard() });

  // ── bug ④ 修复点：搜索命中苹果卡 → 说明框必须保留 ──
  // 关键断言取「同步清理那一瞬」： buggy 版本会在这一瞬误摘说明框，
  // 但随后被 rAF 重定位补回，只看稳定态是抓不到的。
  const syncHit = reactSearch('苹果', true);
  check('前置：搜索「苹果」后苹果卡仍在结果列表', !!appleCard());
  check('★ 同步清理阶段未误摘说明框（bug ④ 核心判据）',
    syncHit && syncHit.noteInApple, syncHit);
  await settle();
  check('★ 搜索「苹果」（命中苹果卡）后说明框仍在苹果卡内（稳定态）',
    noteInApple(), { hasNote: !!note(), appleCard: !!appleCard() });

  // ── bug ③ 未回归：搜索把苹果卡过滤掉 → 说明框必须跟着摘除 ──
  reactSearch('华为');
  await settle();
  check('搜索「华为」后苹果卡已被过滤出列表', !appleCard());
  check('搜索「华为」后说明框不残留（PITFALLS 1.10 bug ③ 未回归）',
    !note(), { hasNote: !!note() });

  // ── bug ① 未回归：不得泄漏进别的卡 ──
  const huawei = doc.createElement('div');
  huawei.className = 'bg-white rounded-2xl border';
  huawei.innerHTML = '<h2>华为终端 (Huawei)</h2><div class="flex-wrap"><span>Mate</span></div>';
  (doc.getElementById('root') || doc.body).appendChild(huawei);
  const leaked = huawei.contains ? huawei.contains(note()) : false;
  check('说明框不泄漏进华为卡（PITFALLS 1.10 bug ① 未回归）', !leaked);

  // ── 复原：放回苹果卡并清空搜索 → 说明框重新插回 ──
  if (!appleCard()) makeAppleCard();
  reactSearch('');
  await settle();
  check('清空搜索后说明框重新插回苹果卡（复原）',
    noteInApple(), { hasNote: !!note(), appleCard: !!appleCard() });

  // ── bug ③ 另一分支：苹果卡「在 DOM 但整棵子树被隐藏」（四格筛选/评级过滤）──
  // 这条走的是 appleHidden 判据，与「苹果卡被卸载」(!appleCard) 是两条不同分支，
  // 必须分别覆盖 —— 少一条，那道闸删掉时测试就抓不到。
  //
  // ⚠️ 隐藏状态是「四格筛选点按钮」造成的，真实页面靠 click 监听器
  //    （setTimeout 100ms 后调 insertAppleNote）驱动重定位。所以这里派发
  //    一次 click 事件来触发，否则 insertAppleNote 根本不会被调用，
  //    note 会原地留在 DOM 里 —— 那是测试没驱动到，不是代码错。
  if (!appleCard()) makeAppleCard();
  const hidCard = appleCard();
  if (hidCard) {
    const btn = doc.createElement('button');
    btn.textContent = '触发筛选';
    (doc.getElementById('root') || doc.body).appendChild(btn);
    hidCard.style.display = 'none';
    btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    await settle(500);
    check('苹果卡整棵子树被隐藏时说明框被摘除（四格筛选场景）',
      !note(), { hasNote: !!note() });
    hidCard.style.display = '';
    btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    await settle(500);
    check('苹果卡恢复显示后说明框重新插回',
      noteInApple(), { hasNote: !!note(), appleCard: !!appleCard() });
  } else {
    check('前置：复原苹果卡失败（无法测隐藏分支）', false);
  }

  console.log('\n' + '='.repeat(54));
  console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  if (fail) console.log('失败项：\n  - ' + fails.join('\n  - '));
  process.exit(fail ? 1 : 0);
}, 1500);