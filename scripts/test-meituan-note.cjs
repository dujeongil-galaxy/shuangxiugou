// 美团「骑手休息口径」（#meituan-note）说明框回归测试
// 跑法：node scripts/test-meituan-note.cjs（需 jsdom，同 CI 其他测试）
//
// 背景（2026-10-30 站长指令）：站长曾任美团骑手，实际月休 4 天（周休一天），
// 与网传「月休 2 天算好的」严重不符；且休满 4 天被组长嘲讽「你真是公务员，
// 每周一定要固定休息一天」——月休 4 天在骑手里是异类，不是常态。
// 美团是 bundle 内置卡（cm-mt-1 评论口径不可改），按铁律走 DOM 补丁注入层。
//
// 结构与 test-apple-note.cjs 平行：浏览态在卡内 → 搜索命中保留 →
// 过滤摘除 → 不泄漏进别的卡 → 隐藏分支（display:none）摘除与恢复。
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

// ── 第一层：源码断言 ──
console.log('=== 第一层：index.html 源码断言 ===');
check('存在 insertMeituanNote 函数定义', /function insertMeituanNote\(\)/.test(html));
check('说明框 id 为 meituan-note', /getElementById\('meituan-note'\)/.test(html));
check('标题匹配用 Meituan 前缀（与 bundle 卡名 Meituan (美团) 一致）',
  /title\.indexOf\('Meituan'\) === 0/.test(html));
check('文案含站长亲历口径「实际月休 4 天」', /实际月休 4 天/.test(html));
check('文案含周休一天口径（单休形态）', /每周固定休一天|周休一天/.test(html));
check('文案含组长嘲讽原话「你真是公务员」', /你真是公务员/.test(html));
check('文案写明与网传口径不符', /网传/.test(html) && /严重不符/.test(html));
check('文案写明月休 4 天是异类不是常态', /异类/.test(html) && /并非行业常态/.test(html));
check('文案注明 bundle 评论区口径仅供对照参考', /仅供参考/.test(html));
check('init() 里挂载 insertMeituanNote',
  /insertAppleNote\(\);\s*\n\s*insertStarbucksNote\(\);\s*\n\s*insertMeiyijiaNote\(\);\s*\n\s*insertMolinaNote\(\);\s*\n\s*insertMeituanNote\(\);/.test(html));
check('input 触发点挂载 insertMeituanNote',
  /try \{ insertMeituanNote\(\); \} catch \(err\) \{ diagError\('insertMeituanNote 抛异常', err\); \}/.test(html));
const triggerCount = (html.match(/try \{ insertMeituanNote\(\); \}/g) || []).length;
check('click 与 input 两个异步触发点都挂载（共 2 处）', triggerCount === 2, { triggerCount });
check('隐藏判据沿祖先链找 display:none（sxgHiddenSubtree5）', /sxgHiddenSubtree5/.test(html));
check('幂等判据：已在正确位置则 return（noteInsideMt）', /noteInsideMt/.test(html));

// ── 第二层：详情页断言 ──
console.log('\n=== 第二层：brand/meituan.html 详情页断言 ===');
const mt = read('brand/meituan.html');
check('休息制度 kv 补站长亲历口径', /骑手月休 4 天·周休一天/.test(mt));
check('工时情况段含站长亲历补记', /站长亲历补记/.test(mt) && /曾任美团骑手/.test(mt));
check('详情页写明嘲讽原话「你真是公务员」', /你真是公务员/.test(mt));
check('详情页写明与网传不符、网传仅供对照参考', /与站长亲历不符/.test(mt));
check('评级理由新增站长亲历条目', /站长亲历（2026-10-30 补记）/.test(mt));

// ── 第三层：jsdom 行为断言 ──
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
const note = () => doc.getElementById('meituan-note');
const cardsOf = () => [...doc.querySelectorAll('div.bg-white.rounded-2xl.border')];
const titleOf = (c) => {
  const t = c.querySelector('h2,h3');
  return t ? t.textContent.trim() : '';
};
const mtCard = () => cardsOf().find((c) => titleOf(c).indexOf('Meituan') === 0) || null;
const noteInMt = () => {
  const n = note(); const a = mtCard();
  if (!n || !a) return false;
  return a.contains ? a.contains(n) : (n.parentNode === a);
};
const settle = (ms) => new Promise((r) => setTimeout(r, ms || 350));

function reactSearch(q, syncSample) {
  const i = doc.getElementById('site-search-input');
  if (i) {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value').set;
    setter.call(i, q);
  }
  // 模拟 React 完成过滤后的 DOM 结果（美团是内置卡，搜「美团」命中、搜其他词卸载）
  const keepMt = q.indexOf('美团') >= 0 || q.indexOf('Meituan') >= 0 || q === '';
  const a = mtCard();
  if (!keepMt && a && a.parentNode) a.parentNode.removeChild(a);
  if (i) i.dispatchEvent(new window.Event('input', { bubbles: true }));
  if (syncSample) return { hasNote: !!note(), noteInMt: noteInMt() };
  return null;
}

function makeMtCard() {
  const a = doc.createElement('div');
  a.className = 'bg-white rounded-2xl border';
  a.innerHTML = '<h2>Meituan (美团)</h2><div class="flex-wrap"><span>美团外卖</span></div>';
  const root = doc.getElementById('root') || doc.body;
  root.appendChild(a);
  return a;
}

setTimeout(async () => {
  console.log('\n=== 第三层：jsdom 行为断言 ===');
  console.log('=== meituan-note 注入位置回归测试 ===\n');

  check('前置：美团卡由 bundle 渲染在场', !!mtCard());
  check('基准：浏览态说明框存在于美团卡内',
    noteInMt(), { hasNote: !!note(), mtCard: !!mtCard() });

  // ── 搜索命中美团 → 说明框保留 ──
  const syncHit = reactSearch('美团', true);
  check('前置：搜索「美团」后美团卡仍在结果列表', !!mtCard());
  check('★ 同步清理阶段未误摘说明框（搜索命中场景）',
    syncHit && syncHit.noteInMt, syncHit);
  await settle();
  check('★ 搜索「美团」（命中美团卡）后说明框仍在美团卡内（稳定态）',
    noteInMt(), { hasNote: !!note(), mtCard: !!mtCard() });

  // ── 搜索过滤掉美团 → 说明框摘除 ──
  reactSearch('华为');
  await settle();
  check('搜索「华为」后美团卡已被过滤出列表', !mtCard());
  check('搜索「华为」后说明框不残留', !note(), { hasNote: !!note() });

  // ── 不泄漏进别的卡 ──
  const huawei = doc.createElement('div');
  huawei.className = 'bg-white rounded-2xl border';
  huawei.innerHTML = '<h2>华为终端 (Huawei)</h2><div class="flex-wrap"><span>Mate</span></div>';
  (doc.getElementById('root') || doc.body).appendChild(huawei);
  const leaked = note() ? (huawei.contains ? huawei.contains(note()) : false) : false;
  check('说明框不泄漏进华为卡', !leaked);

  // ── 复原 ──
  if (!mtCard()) makeMtCard();
  reactSearch('');
  await settle();
  check('清空搜索后说明框重新插回美团卡（复原）',
    noteInMt(), { hasNote: !!note(), mtCard: !!mtCard() });

  // ── 隐藏分支：卡在 DOM 但 display:none（四格筛选）──
  if (!mtCard()) makeMtCard();
  const hidCard = mtCard();
  if (hidCard) {
    const btn = doc.createElement('button');
    btn.textContent = '触发筛选';
    (doc.getElementById('root') || doc.body).appendChild(btn);
    hidCard.style.display = 'none';
    btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    await settle(500);
    check('美团卡整棵子树被隐藏时说明框被摘除（四格筛选场景）',
      !note(), { hasNote: !!note() });
    hidCard.style.display = '';
    btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    await settle(500);
    check('美团卡恢复显示后说明框重新插回',
      noteInMt(), { hasNote: !!note(), mtCard: !!mtCard() });
  } else {
    check('前置：复原美团卡失败（无法测隐藏分支）', false);
  }

  console.log('\n' + '='.repeat(54));
  console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  if (fail) console.log('失败项：\n  - ' + fails.join('\n  - '));
  process.exit(fail ? 1 : 0);
}, 1500);
