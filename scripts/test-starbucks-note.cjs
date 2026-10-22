// 「星巴克消费入座公告」(#starbucks-note) 注入位置回归测试
// 跑法：node scripts/test-starbucks-note.cjs（需 jsdom，同 CI 其他测试）
//
// 本测试是 scripts/test-apple-note.cjs 的平行版本（2026-10-22 新增）。
// 星巴克公告框与苹果补充说明共用同一套注入机制与判据
// （insertStarbucksNote 是 insertAppleNote 的平行实现），
// 因此 PITFALLS 1.10 的三个坑在它身上同样成立，必须逐条覆盖：
//   bug ① 错位：搜索过滤掉星巴克卡后，公告框泄漏进别的卡
//   bug ③ 空面板残留：搜索无匹配词，所有卡被卸载，公告框孤零零挂空面板
//   bug ④（站长实测）：搜索**命中星巴克卡**的词（如「星巴克」），
//            卡明明在结果列表里，公告框却被摘掉了。
//
// ⚠️ 本测试同样必须**自己模拟 React 搜索过滤**（真实移除不匹配的卡片节点），
//    理由与教训见 test-apple-note.cjs 头部注释与 README「第 5 条最容易踩坑的事」。
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
const note = () => doc.getElementById('starbucks-note');
const cardsOf = () => [...doc.querySelectorAll('div.bg-white.rounded-2xl.border')];
const titleOf = (c) => {
  const t = c.querySelector('h2,h3');
  return t ? t.textContent.trim() : '';
};
const sbuxCard = () => cardsOf().find((c) => titleOf(c).indexOf('Starbucks') === 0) || null;
const noteInSbux = () => {
  const n = note(); const a = sbuxCard();
  if (!n || !a) return false;
  return a.contains ? a.contains(n) : (n.parentNode === a);
};
const settle = (ms) => new Promise((r) => setTimeout(r, ms || 350));

/**
 * 模拟 React 搜索：命中星巴克的查询 → 星巴克卡留在DOM；
 * 不命中 / 过滤 → 把星巴克卡整棵摘出 DOM（= React 卸载该卡节点）。
 * 无论哪种都派发 input 事件，让 index.html 的同步清理与 rAF 重定位真正跑到。
 * ⚠️ 走原生value setter 绕开 React 受控组件的 value tracker。
 *
 * ⚠️⚠️ 「命中」场景必须在 **input 派发后立刻**取样（syncSample=true），
 *    不能等rAF 重定位跑完 —— 重定位会把公告框重新插回来，掩盖掉同步清理阶段的错误。
 */
function reactSearch(q, syncSample) {
  const i = doc.getElementById('site-search-input');
  if (i) {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value').set;
    setter.call(i, q);
  }
  // 模拟 React 完成过滤后的 DOM 结果
  const keepSbux = q.indexOf('星巴克') >= 0 || q.indexOf('Starbucks') >= 0 || q === '';
  const a = sbuxCard();
  if (!keepSbux && a && a.parentNode) a.parentNode.removeChild(a);
  if (i) i.dispatchEvent(new window.Event('input', { bubbles: true }));
  // 同步清理监听器是捕获阶段，dispatchEvent 返回时它已跑完 —— 此刻取样才能抓到它
  if (syncSample) return { hasNote: !!note(), noteInSbux: noteInSbux() };
  return null;
}

/** 造一张最小星巴克卡放进 DOM（供复原用） */
function makeSbuxCard() {
  const a = doc.createElement('div');
  a.className = 'bg-white rounded-2xl border';
  a.innerHTML = '<h2>Starbucks (星巴克中国)</h2><div class="flex-wrap"><span>咖啡</span></div>';
  const root = doc.getElementById('root') || doc.body;
  root.appendChild(a);
  return a;
}

setTimeout(async () => {
  console.log('=== starbucks-note 注入位置回归测试 ===\n');

  // ── 基准：浏览态公告框在星巴克卡内 ──
  check('前置：浏览态公告框存在于星巴克卡内',
    noteInSbux(), { hasNote: !!note(), sbuxCard: !!sbuxCard() });

  // ── bug ④ 修复点：搜索命中星巴克卡 → 公告框必须保留 ──
  const syncHit = reactSearch('星巴克', true);
  check('前置：搜索「星巴克」后星巴克卡仍在结果列表', !!sbuxCard());
  check('★ 同步清理阶段未误摘公告框（bug ④ 核心判据）',
    syncHit && syncHit.noteInSbux, syncHit);
  await settle();
  check('★ 搜索「星巴克」（命中星巴克卡）后公告框仍在星巴克卡内（稳定态）',
    noteInSbux(), { hasNote: !!note(), sbuxCard: !!sbuxCard() });

  // ── bug ③ 未回归：搜索把星巴克卡过滤掉 → 公告框必须跟着摘除 ──
  reactSearch('苹果');
  await settle();
  check('搜索「苹果」后星巴克卡已被过滤出列表', !sbuxCard());
  check('搜索「苹果」后公告框不残留（PITFALLS 1.10 bug ③ 未回归）',
    !note(), { hasNote: !!note() });

  // ── bug ① 未回归：不得泄漏进别的卡 ──
  const apple = doc.createElement('div');
  apple.className = 'bg-white rounded-2xl border';
  apple.innerHTML = '<h2>Apple (苹果中国)</h2><div class="flex-wrap"><span>iPhone</span></div>';
  (doc.getElementById('root') || doc.body).appendChild(apple);
  const leaked = apple.contains ? apple.contains(note()) : false;
  check('公告框不泄漏进苹果卡（PITFALLS 1.10 bug ① 未回归）', !leaked);

  // ── 复原：放回星巴克卡并清空搜索 → 公告框重新插回 ──
  if (!sbuxCard()) makeSbuxCard();
  reactSearch('');
  await settle();
  check('清空搜索后公告框重新插回星巴克卡（复原）',
    noteInSbux(), { hasNote: !!note(), sbuxCard: !!sbuxCard() });

  // ── bug ③ 另一分支：星巴克卡「在 DOM 但整棵子树被隐藏」（四格筛选/评级过滤）──
  // 与「卡被卸载」(!sbuxCard) 是两条不同分支，必须分别覆盖。
  // ⚠️ 隐藏状态由「四格筛选点按钮」造成，真实页面靠 click 监听器
  //    （setTimeout 100ms 后调 insertStarbucksNote）驱动重定位，
  //    所以这里派发 click 事件来触发，否则函数根本不会被调用。
  if (!sbuxCard()) makeSbuxCard();
  const hidCard = sbuxCard();
  if (hidCard) {
    const btn = doc.createElement('button');
    btn.textContent = '触发筛选';
    (doc.getElementById('root') || doc.body).appendChild(btn);
    hidCard.style.display = 'none';
    btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    await settle(500);
    check('星巴克卡整棵子树被隐藏时公告框被摘除（四格筛选场景）',
      !note(), { hasNote: !!note() });
    hidCard.style.display = '';
    btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    await settle(500);
    check('星巴克卡恢复显示后公告框重新插回',
      noteInSbux(), { hasNote: !!note(), sbuxCard: !!sbuxCard() });
  } else {
    check('前置：复原星巴克卡失败（无法测隐藏分支）', false);
  }

  console.log('\n' + '='.repeat(54));
  console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  if (fail) console.log('失败项：\n  - ' + fails.join('\n  - '));
  process.exit(fail ? 1 : 0);
}, 1500);
