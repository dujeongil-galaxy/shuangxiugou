// 「车外费用备注」(etc-fee-note-patch) 注入位置回归测试
// 跑法：node scripts/test-etc-fee-note.cjs（需 jsdom，同 CI 其他测试）
//
// 本测试是 scripts/test-starbucks-note.cjs 的平行版本：星巴克/苹果公告框与本备注
// 共用同一套「往品牌卡里插东西」的机制，因此 PITFALLS 1.10 的三个坑在它身上同样成立：
//   bug ① 错位：搜索过滤掉目标卡后，备注泄漏进别的卡
//   bug ③ 空面板残留：搜索无匹配词，所有卡被卸载，备注孤零零挂空面板
//   bug ④：搜索**命中**目标卡的词时，备注却被摘掉
//
// ⚠️ 本测试必须**自己模拟 React 搜索过滤**（真实移除不匹配的卡片节点），
//    理由与教训见 test-starbucks-note.cjs 头部注释。
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
const TARGET_TITLES = [
  '小米汽车', '问界（赛力斯）', '极氪', 'BYD (比亚迪)',
  '理想汽车', '蔚来', '小鹏汽车', '零跑汽车'
];
const cardsOf = () => [...doc.querySelectorAll('div.bg-white.rounded-2xl.border')];
const titleOf = (c) => {
  const t = c.querySelector('h2, h3');
  return t ? t.textContent.trim() : '';
};
const notesOf = (c) => c.querySelectorAll('[data-sxg-etc-fee-note]').length;
const settle = (ms) => new Promise((r) => setTimeout(r, ms || 350));

/** 造一张最小品牌卡放进 DOM（自定义卡与内置卡同结构） */
function makeCard(title) {
  const c = doc.createElement('div');
  c.className = 'bg-white rounded-2xl border';
  c.innerHTML =
    '<div class="p-5 space-y-3.5">' +
    '<h3>' + title + '</h3>' +
    '<div class="flex flex-wrap gap-1.5"><span>新能源车</span></div>' +
    '</div>';
  c.setAttribute('data-test-card', title);
  (doc.getElementById('root') || doc.body).appendChild(c);
  return c;
}

setTimeout(async () => {
  console.log('=== etc-fee-note 注入位置回归测试 ===\n');

  // ── 前置：脚本已挂载 ──
  check('前置：index.html 挂了 etc-fee-note-patch.js',
    /etc-fee-note-patch\.js\?v=\d+/.test(html));

  // ── 造卡：8 个目标 + 2 个非目标 ──
  const made = TARGET_TITLES.map(makeCard);
  const xiaomiGroup = makeCard('小米');
  const apple = makeCard('Apple (苹果中国)');
  await settle(500);

  // ── 目标卡全部注入 ──
  TARGET_TITLES.forEach((t) => {
    const c = cardsOf().find((x) => x.getAttribute('data-test-card') === t);
    check(`目标卡「${t}」注入了 1 条备注`, c && notesOf(c) === 1, c ? notesOf(c) : 'no card');
  });

  // ── 非目标卡不注入 ──
  check('非目标卡「小米」（集团卡）未注入', notesOf(xiaomiGroup) === 0, notesOf(xiaomiGroup));
  check('非目标卡「Apple」未注入', notesOf(apple) === 0, notesOf(apple));

  // ── 备注内容与链接 ──
  const nioCard = cardsOf().find((x) => x.getAttribute('data-test-card') === '蔚来');
  const note = nioCard ? nioCard.querySelector('[data-sxg-etc-fee-note]') : null;
  const noteText = note ? note.textContent : '';
  check('备注文案写明车外要掏的钱（ETC 开通费 / 城市 NOA 买断还是订阅 / 座椅加热）',
    /内置 ETC 开通费/.test(noteText) && /买断还是按月订阅/.test(noteText) && /座椅加热/.test(noteText),
    noteText.slice(0, 60));
  const a = note ? note.querySelector('a') : null;
  check('备注挂了费用对比站外链（target=_blank + rel=noopener）',
    !!a && a.getAttribute('href') === 'https://dujeongil-galaxy.github.io/etc-fee-comparison/'
    && a.getAttribute('target') === '_blank' && /noopener/.test(a.getAttribute('rel') || ''),
    a ? { href: a.getAttribute('href'), rel: a.getAttribute('rel') } : null);

  // ── 结构：备注必须落在卡面内容区，不能挤进卡面网格/strong ──
  // （实测各卡标签行的父容器并不一致，有的是两列 grid、有的是 strong，
  //   按「标签行之后」插入会把备注塞进网格里，破坏卡面布局）
  const noteParent = note ? note.parentElement : null;
  check('备注挂在卡面内容区（div.p-5.space-y-3.5）末尾',
    !!noteParent && /p-5/.test(noteParent.className || ''),
    noteParent ? noteParent.className : null);
  check('备注没有被塞进 strong / grid 等卡面内部容器',
    !!noteParent && !/strong|grid/.test(noteParent.className || ''),
    noteParent ? noteParent.className : null);
  check('备注内只有文案与链接两个子节点（没有混入卡面元素）',
    !!note && note.children.length === 2
    && note.children[0].tagName === 'SPAN' && note.children[1].tagName === 'A',
    note ? [...note.children].map((c) => c.tagName).join(',') : null);

  // ── 幂等：再触发一次注入不应重复插入 ──
  const trigger = doc.createElement('div');
  (doc.getElementById('root') || doc.body).appendChild(trigger);
  await settle(500);
  check('幂等：重复触发后目标卡仍只有 1 条备注',
    nioCard && notesOf(nioCard) === 1, nioCard ? notesOf(nioCard) : null);

  // ── bug ③ 未回归：目标卡被卸载 → 备注随之消失，不留孤儿 ──
  // 判据说明：备注是目标卡的**子节点**，卡一旦从 DOM 消失，备注必然跟着走。
  //
  // ⚠️ 这里用**脱离 React 管理的独立容器**（挂在 body 下，不放 #root）：
  //    jsdom 里 React 是活的，直接 removeChild 掉 #root 里的卡，React 会在
  //    下一次渲染把它重新挂回来，「卸载」根本没发生，断言就不成立
  //    （与 test-starbucks-note.cjs 头部关于模拟 React 过滤的注释同源）。
  const sandbox = doc.createElement('div');
  doc.body.appendChild(sandbox);
  const sandboxCard = doc.createElement('div');
  sandboxCard.className = 'bg-white rounded-2xl border';
  sandboxCard.innerHTML =
    '<div class="p-5 space-y-3.5"><h3>零跑汽车</h3>' +
    '<div class="flex flex-wrap gap-1.5"><span>新能源车</span></div></div>';
  sandbox.appendChild(sandboxCard);
  await settle(400);
  check('沙盒目标卡注入了 1 条备注', notesOf(sandboxCard) === 1, notesOf(sandboxCard));
  const sandboxNote = sandboxCard.querySelector('[data-sxg-etc-fee-note]');

  // 真实卸载：把卡从 DOM 摘掉（同步摘，React 不接管这个容器）
  sandboxCard.parentNode.removeChild(sandboxCard);
  // 判据用**节点引用**而不是全局计数：全局备注数会随 React 渲染此消彼长，
  // 只有「这条备注是否还挂在 DOM 里」才是「子节点随卡卸载」的准确判据。
  check('目标卡卸载后其备注节点随之从 DOM 消失（PITFALLS 1.10 bug ③ 未回归）',
    !!sandboxNote && !doc.contains(sandboxNote),
    { stillThere: sandboxNote ? doc.contains(sandboxNote) : null });
  const orphans = [...doc.querySelectorAll('[data-sxg-etc-fee-note="1"]')].filter(
    (n) => !n.closest('div.bg-white.rounded-2xl.border')
  );
  check('没有任何游离在卡片之外的备注（空面板残留未回归）',
    orphans.length === 0, { orphan: orphans.length });
  check('每张目标卡最多 1 条备注（无重复注入）',
    cardsOf().every((c) => notesOf(c) <= 1));
  if (sandbox.parentNode) sandbox.parentNode.removeChild(sandbox);

  // ── bug ① 未回归：不得泄漏进别的卡 ──
  const leaked = apple.contains
    ? apple.contains(doc.querySelector('[data-sxg-etc-fee-note="1"]'))
    : false;
  check('备注不泄漏进非目标卡（PITFALLS 1.10 bug ① 未回归）', !leaked);

  // ── 复原：放回目标卡 → 备注重新插回（bug ④ 命中场景）──
  const keep = nioCard;
  if (keep && !keep.parentNode) (doc.getElementById('root') || doc.body).appendChild(keep);
  await settle(500);
  check('目标卡回到列表后备注重新插回（搜索命中场景，bug ④ 未回归）',
    notesOf(keep) === 1, notesOf(keep));

  console.log('\n' + '='.repeat(54));
  console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  if (fail) console.log('失败项：\n  - ' + fails.join('\n  - '));
  process.exit(fail ? 1 : 0);
}, 1500);
