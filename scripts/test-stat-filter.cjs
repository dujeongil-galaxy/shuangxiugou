// stat-filter 端到端 DOM 测试：真渲染整页 → 真点四格 → 断言筛选结果
// 跑法：node scripts/test-stat-filter.cjs（需 jsdom，同 CI 其他测试）
//
// 预期数字（2026-10-18 实测）：jsdom 整页渲染后自定义卡（5C+1B）也会插入，
// badge 卡共 59 张（53 内置含 1 虚拟 + 6 自定义）。筛选结果与顶部五格显示一致：
// 红榜(S/A)=19、观察(B)=14、避雷(C，不含虚拟卡)=20、待核实(U)=5；
// 19+14+20+5 = 58 = 收录总数；「全部」=59（含虚拟卡，虚拟卡不进任何分档）。
// 末尾另有苹果「富士康补充说明」框回归（PITFALLS 1.10 第二变体）：
// 搜索「啊」→ 摘除；清空 → 插回；节点被复用为华为卡 → 不残留；隐藏子树 → 摘除。
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
  const u = boxOf('待核实');
  check('五个统计盒都已绑定筛选（data-sxg-stat，含新增「待核实」）',
    !!red && !!zhou && !!lei && !!all && !!u
    && red.getAttribute('data-sxg-stat') === 'red'
    && zhou.getAttribute('data-sxg-stat') === 'zhou'
    && lei.getAttribute('data-sxg-stat') === 'lei'
    && all.getAttribute('data-sxg-stat') === 'all'
    && u.getAttribute('data-sxg-stat') === 'u');
  check('第五格「待核实」数字 = 5（与 U 级卡数一致）',
    u.children[0].textContent === '5', u.children[0].textContent);

  const base = snapshot();
  check('初始全部可见（badge 卡 ' + base.total + ' 张）', base.visible.length === base.total && base.total === 59,
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
  check('点「避雷预警」→ 仅 C 级可见（20 张，与四格「避雷预警 20」一致，虚拟卡除外）',
    s.visible.length === 20 && s.visible.every((c) => tierOf(c) === 'C'),
    { visible: s.visible.length, tiers: [...new Set(s.visible.map((c) => tierOf(c)))] });

  // —— 待核实：只显示 U ——
  click(u);
  s = snapshot();
  check('点「待核实」→ 仅 U 级可见（5 张；19+14+20+5=58 对账）',
    s.visible.length === 5 && s.visible.every((c) => tierOf(c) === 'U'),
    { visible: s.visible.length, tiers: [...new Set(s.visible.map((c) => tierOf(c)))] });
  check('待核实激活态写上 data-sxg-active', u.getAttribute('data-sxg-active') === '1');

  // —— 收录品牌：清除筛选 ——
  click(all);
  s = snapshot();
  check('点「收录品牌」→ 清除筛选恢复全部', s.visible.length === s.total,
    { visible: s.visible.length, total: s.total });
  check('清除后无激活态', ['双休红榜', '大小周观察', '避雷预警', '待核实'].every((lbl) => {
    const b = boxOf(lbl);
    return b && !b.hasAttribute('data-sxg-active');
  }));

  // —— 再点一次同按钮 = 取消 ——
  click(red);
  click(red);
  s = snapshot();
  check('再点一次「双休红榜」= 取消筛选', s.visible.length === s.total,
    { visible: s.visible.length, total: s.total });

  // —— 评级过滤行补「待核实」入口（2026-10-18 站长：上面有待核实，下面到 C 级就没了）——
  const rowBtn = (txt) => [...window.document.querySelectorAll('button')]
    .find((b) => (b.textContent || '').trim() === txt);
  const rowU = rowBtn('待核实');
  check('评级过滤行末尾注入了「待核实」按钮（data-sxg-row-u）',
    !!rowU && rowU.getAttribute('data-sxg-row-u') === '1',
    !!rowU ? rowU.outerHTML.slice(0, 120) : '未找到按钮');
  if (rowU) {
    click(rowU);
    s = snapshot();
    check('点评级行「待核实」→ 仅 5 张 U 级卡可见',
      s.visible.length === 5 && s.visible.every((c) => tierOf(c) === 'U'),
      { visible: s.visible.length });
    check('行内「待核实」按钮激活态（bg-slate-900）',
      rowU.className.includes('bg-slate-900'), rowU.className);
    click(rowU);
    s = snapshot();
    check('再点行内「待核实」→ 恢复全部', s.visible.length === s.total,
      { visible: s.visible.length, total: s.total });
    // 互斥：点 React 评级按钮应清掉五格筛选（否则 observer 把旧 display 套回去出空面板）
    click(red);
    s = snapshot();
    check('互斥前置：点红榜后隐藏 ' + (s.total - s.visible.length) + ' 张', s.hidden === 40, s.hidden);
    const allBtn = rowBtn('全部评级');
    if (allBtn) click(allBtn);
    s = snapshot();
    check('再点 React「全部评级」→ 五格筛选被清空（无残留 display:none）',
      s.hidden === 0, s.hidden);
  }

  // —— 回归（2026-10-18）：搜索过滤会卸载 U 卡，第五格不得清零/变粉 ——
  (async () => {
    const uCards = [...window.document.querySelectorAll('div.bg-white.rounded-2xl.border')]
      .filter((c) => tierOf(c) === 'U');
    check('前置：DOM 中 U 级卡 5 张', uCards.length === 5, uCards.length);
    const removed = uCards.map((c) => {
      const p = c.parentNode; const nx = c.nextSibling;
      p.removeChild(c); return { c, p, nx };
    });
    await new Promise((r) => setTimeout(r, 450));
    const u2 = boxOf('待核实');
    check('搜索过滤（U 卡被卸载）后待核实数字仍为 5（不清零）',
      u2 && u2.children[0].textContent === '5', u2 && u2.children[0].textContent);
    removed.forEach(({ c, p, nx }) => {
      try { nx ? p.insertBefore(c, nx) : p.appendChild(c); }
      catch (e) { try { p.appendChild(c); } catch (e2) { /* 容器已被替换则放弃恢复 */ } }
    });
    await new Promise((r) => setTimeout(r, 450));
    const u3 = boxOf('待核实');
    check('恢复全部卡片后待核实数字仍为 5',
      u3 && u3.children[0].textContent === '5', u3 && u3.children[0].textContent);
    check('待核实盒不含避雷粉色系类名（rose）',
      u3 && !/rose/.test(u3.className), u3 && u3.className);
    check('待核实盒仍绑定筛选（data-sxg-stat=u）',
      u3 && u3.getAttribute('data-sxg-stat') === 'u');

    // —— 回归（2026-10-18）：搜索过滤时「富士康补充说明」框残留（PITFALLS 1.10 第二变体）——
    // 真实故障：搜索「啊」无匹配 → 所有卡消失，但 #apple-note 黄框孤零零留在搜索面板；
    // 或搜索后 React 按位置复用节点，note 泄漏进华为卡。
    // 修复：①搜索框有输入即摘除（捕获阶段同步）；②Apple 卡不在 DOM /
    // 整棵子树隐藏即摘除；③按卡片标题匹配品牌（华为卡替代推荐区也含
    // "Apple (苹果中国)"，全文子串匹配会误插进华为卡）。
    const note = () => window.document.getElementById('apple-note');
    const appleTextCards = () => [...window.document.querySelectorAll('div.bg-white.rounded-2xl.border')]
      .filter((c) => (c.textContent || '').includes('Apple (苹果中国)'));
    const ancestorCardOf = (n) => {
      let p = n && n.parentNode;
      while (p) { if (p.classList && p.classList.contains('bg-white')) return p; p = p.parentNode; }
      return null;
    };
    const noteInApple = () => {
      const n = note();
      if (!n) return false;
      return appleTextCards().some((a) => a.contains && a.contains(n));
    };
    const searchInput = () => window.document.getElementById('site-search-input');
    const type = (v) => {
      const i = searchInput();
      i.value = v;
      i.dispatchEvent(new window.Event('input', { bubbles: true }));
    };
    await new Promise((r) => setTimeout(r, 300)); // 等 React 挂载稳定
    check('前置：note 存在且在 Apple 卡内', !!note() && noteInApple());
    type('啊'); // 无匹配：React 会卸载全部卡
    await new Promise((r) => setTimeout(r, 500));
    check('搜索「啊」（无匹配）后 note 不在 DOM', !note());
    type(''); // 清空搜索
    await new Promise((r) => setTimeout(r, 500));
    check('清空搜索后 note 重新插回 Apple 卡', noteInApple());
    // React 按位置复用节点（原 bug①）：把持有 note 的 Apple 卡标题改成华为
    //（只改标题文本，保留卡内其他子节点——与 React 文本更新复用节点的行为一致）
    const host = ancestorCardOf(note());
    const hostTitle = host.querySelector('h2,h3');
    hostTitle.textContent = hostTitle.textContent.replace('Apple (苹果中国)', '华为 (HUAWEI)');
    await new Promise((r) => setTimeout(r, 500));
    check('节点被复用为华为卡：note 被摘除（不残留、不误插华为卡）', !note());
    hostTitle.textContent = hostTitle.textContent.replace('华为 (HUAWEI)', 'Apple (苹果中国)');
    await new Promise((r) => setTimeout(r, 500));
    check('恢复 Apple 标题后 note 重新插回且唯一',
      noteInApple() && window.document.querySelectorAll('#apple-note').length === 1);
    // 隐藏子树闸门（①之外的第二道闸）：Apple 卡被 display:none 隐藏时摘除
    const host2 = ancestorCardOf(note());
    host2.style.display = 'none';
    type(''); // 触发 input 监听器 → rAF → insertAppleNote 走隐藏子树闸门
    await new Promise((r) => setTimeout(r, 500));
    check('Apple 卡整棵子树隐藏后 note 被摘除', !note());
    host2.style.display = '';
    type('');
    await new Promise((r) => setTimeout(r, 500));
    check('Apple 卡恢复显示后 note 重新插回', noteInApple());

    console.log('\n' + '='.repeat(54));
    console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
    if (fail) console.log('失败项：\n  - ' + fails.join('\n  - '));
    process.exit(fail ? 1 : 0);
  })();
}, 1500);
