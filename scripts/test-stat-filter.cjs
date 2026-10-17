// stat-filter 端到端 DOM 测试：真渲染整页 → 真点四格 → 断言筛选结果
// 跑法：node scripts/test-stat-filter.cjs（需 jsdom，同 CI 其他测试）
//
// 预期数字（2026-10-17 实测）：jsdom 整页渲染后自定义卡（4C+1B）也会插入，
// badge 卡共 58 张（53 内置含 1 虚拟 + 5 自定义）。筛选结果与顶部四格显示一致：
// 红榜(S/A)=16、观察(B)=8、避雷(C，不含虚拟卡)=16；「全部」=44（含虚拟卡，
// 收录品牌盒显示的 43 = 44 − 虚拟卡，虚拟卡不进任何分档）。
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

function tierOf(card) {
  if ((card.textContent || '').indexOf('虚拟对比黑榜') !== -1) return 'V';
  const nodes = card.querySelectorAll('span,div');
  for (const n of nodes) {
    const s = (n.textContent || '').trim();
    const m = /^(S|A|B|C)\s*级/.exec(s);
    if (m) return m[1];
    if (s.indexOf('待核实') === 0) return 'U';
  }
  return null;
}
function snapshot() {
  const doc = window.document;
  const cards = [...doc.querySelectorAll('div.bg-white.rounded-2xl.border')];
  const badgeCards = cards.filter((c) => tierOf(c) !== null);
  const visible = badgeCards.filter((c) => c.style.display !== 'none');
  return { total: badgeCards.length, visible, hidden: badgeCards.length - visible.length };
}
function boxOf(label) {
  const doc = window.document;
  const leaf = [...doc.querySelectorAll('div')].find(
    (d) => d.children.length === 0 && d.textContent.trim() === label);
  if (!leaf) return null;
  const box = leaf.parentElement;
  return box && box.getAttribute('data-sxg-stat') ? box : null;
}
function click(box) {
  box.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
}

setTimeout(() => {
  console.log('=== stat-filter：四格点击筛选 ===\n');

  const red = boxOf('双休红榜');
  const zhou = boxOf('大小周观察');
  const lei = boxOf('避雷预警');
  const all = boxOf('收录品牌');
  check('四个统计盒都已绑定筛选（data-sxg-stat）', !!red && !!zhou && !!lei && !!all
    && red.getAttribute('data-sxg-stat') === 'red'
    && zhou.getAttribute('data-sxg-stat') === 'zhou'
    && lei.getAttribute('data-sxg-stat') === 'lei'
    && all.getAttribute('data-sxg-stat') === 'all');

  const base = snapshot();
  check('初始全部可见（badge 卡 ' + base.total + ' 张）', base.visible.length === base.total && base.total === 58,
    { total: base.total, visible: base.visible.length });

  // —— 双休红榜：只显示 S/A ——
  click(red);
  let s = snapshot();
  const okRed = s.visible.length === 19
    && s.visible.every((c) => { const t = tierOf(c); return t === 'S' || t === 'A'; })
    && s.hidden === s.total - 19;
  check('点「双休红榜」→ 仅 S/A 级可见（19 张）', okRed,
    { visible: s.visible.length, hidden: s.hidden,
      tiers: [...new Set(s.visible.map((c) => tierOf(c)))] });
  check('红榜激活态写上 data-sxg-active', red.getAttribute('data-sxg-active') === '1');
  const catlCard = s.visible.find((c) => (c.textContent || '').includes('宁德时代'));
  check('C 级的宁德时代在红榜下被隐藏', catlCard === undefined);
  const virtHidden = [...window.document.querySelectorAll('div.bg-white.rounded-2xl.border')]
    .filter((c) => (c.textContent || '').includes('虚拟对比黑榜'))
    .every((c) => c.style.display === 'none');
  check('虚拟对比黑榜卡不进任何分档（被隐藏）', virtHidden);

  // —— 大小周观察：只显示 B ——
  click(zhou);
  s = snapshot();
  check('点「大小周观察」→ 仅 B 级可见（14 张，与四格「大小周观察 14」一致）',
    s.visible.length === 14 && s.visible.every((c) => tierOf(c) === 'B'),
    { visible: s.visible.length, tiers: [...new Set(s.visible.map((c) => tierOf(c)))] });

  // —— 避雷预警：只显示 C（虚拟卡除外）——
  click(lei);
  s = snapshot();
  check('点「避雷预警」→ 仅 C 级可见（19 张，与四格「避雷预警 19」一致，虚拟卡除外）',
    s.visible.length === 19 && s.visible.every((c) => tierOf(c) === 'C'),
    { visible: s.visible.length, tiers: [...new Set(s.visible.map((c) => tierOf(c)))] });

  // —— 收录品牌：清除筛选 ——
  click(all);
  s = snapshot();
  check('点「收录品牌」→ 清除筛选恢复全部', s.visible.length === s.total,
    { visible: s.visible.length, total: s.total });
  check('清除后无激活态', ['双休红榜', '大小周观察', '避雷预警'].every((lbl) => {
    const b = boxOf(lbl);
    return b && !b.hasAttribute('data-sxg-active');
  }));

  // —— 再点一次同按钮 = 取消 ——
  click(red);
  click(red);
  s = snapshot();
  check('再点一次「双休红榜」= 取消筛选', s.visible.length === s.total,
    { visible: s.visible.length, total: s.total });

  console.log('\n' + '='.repeat(54));
  console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  if (fail) console.log('失败项：\n  - ' + fails.join('\n  - '));
  process.exit(fail ? 1 : 0);
}, 1500);
