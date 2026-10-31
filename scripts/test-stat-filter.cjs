// stat-filter 端到端 DOM 测试：真渲染整页 → 真点四格 → 断言筛选结果
// 跑法：node scripts/test-stat-filter.cjs（需 jsdom，同 CI 其他测试）
//
// 预期数字（2026-10-31 U 级废除后口径）：
//   U 级（待核实·不评级）已废除；2026-10-31 站长按月休口径复核改判：
//   工/建/中/成都 4 家银行网点轮休制周休 2 天（≈月休 8.6 天）→ A 级；
//   农行官方口径单休网点占 61%（主体月休 4-5 天）→ 维持 C 级。
//   badge 卡共 68 张（54 内置 - 1 虚拟 + 15 自定义），可见 67 张（虚拟卡 class 隐藏）。
//   红榜(S/A) 23 + 大小周(B) 14 + 避雷(C) 30 = 67；四格无第五格「待核实」；
//   评级行无「待核实」按钮。
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
// jsdom 未实现 scrollIntoView：stat-filter 的 scrollToArchive() 会调它，
// 点四格时抛 TypeError 打断 click 回调（此前测试一直冻结跑不到这步）。
window.HTMLElement.prototype.scrollIntoView = window.HTMLElement.prototype.scrollIntoView || function () {};
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
  }
  return null;
}
function isHidden(card) {
  // 可见性两层：内联 display（stat-filter 的隐藏方式）
  // + sxg-vcard-gone class（virtual-card-remove 的隐藏方式）。
  return card.style.display === 'none' || card.classList.contains('sxg-vcard-gone');
}
function snapshot() {
  const doc = window.document;
  const cards = [...doc.querySelectorAll('div.bg-white.rounded-2xl.border')];
  const badgeCards = cards.filter((c) => tierOf(c) !== null);
  const visible = badgeCards.filter((c) => !isHidden(c));
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
  console.log('=== stat-filter：四格点击筛选（U 级废除后口径）===\n');

  const red = boxOf('双休红榜');
  const zhou = boxOf('大小周观察');
  const lei = boxOf('避雷预警');
  const all = boxOf('收录品牌');
  check('四个统计盒都已绑定筛选（data-sxg-stat）',
    !!red && !!zhou && !!lei && !!all
    && red.getAttribute('data-sxg-stat') === 'red'
    && zhou.getAttribute('data-sxg-stat') === 'zhou'
    && lei.getAttribute('data-sxg-stat') === 'lei'
    && all.getAttribute('data-sxg-stat') === 'all');
  // ── U 级废除断言：第五格与 U 按钮必须不复存在 ──
  check('★ U 级废除：无第五格「待核实」统计盒',
    boxOf('待核实') === null,
    boxOf('待核实') ? '仍然存在，stat-filter 未清理干净' : '已移除');
  check('★ U 级废除：评级行无「待核实」按钮',
    [...window.document.querySelectorAll('button')]
      .every((b) => (b.textContent || '').trim() !== '待核实'),
    '仍存在 data-sxg-row-u 按钮或残留按钮文本');
  check('★ U 级废除：卡内无「待核实」徽章（tierOf 不再返回 U）',
    [...window.document.querySelectorAll('div.bg-white.rounded-2xl.border')]
      .every((c) => (c.textContent || '').indexOf('待核实 · 无证据不作评级') === -1));

  const base = snapshot();
  check('初始可见 67 张（badge 卡 68 张，虚拟卡被 class 隐藏）',
    base.visible.length === 67 && base.total === 68,
    { total: base.total, visible: base.visible.length });

  // —— 双休红榜：只显示 S/A ——
  click(red);
  let s = snapshot();
  const okRed = s.visible.length === 23
    && s.visible.every((c) => { const t = tierOf(c); return t === 'S' || t === 'A'; })
    && s.hidden === s.total - 23;
  check('点「双休红榜」→ 仅 S/A 级可见（23 张，含 2026-10-31 改判 A 的 4 家银行）', okRed,
    { visible: s.visible.length, hidden: s.hidden,
      tiers: [...new Set(s.visible.map((c) => tierOf(c)))] });
  check('红榜激活态写上 data-sxg-active', red.getAttribute('data-sxg-active') === '1');
  const catlCard = s.visible.find((c) => (c.textContent || '').includes('宁德时代'));
  check('C 级的宁德时代在红榜下被隐藏', catlCard === undefined);
  const virtHidden = [...window.document.querySelectorAll('div.bg-white.rounded-2xl.border')]
    .filter((c) => (c.textContent || '').includes('虚拟对比黑榜'))
    .every((c) => c.classList.contains('sxg-vcard-gone'));
  check('虚拟对比黑榜卡被 class 隐藏（virtual-card-remove.js，节点保留 React 协调安全）', virtHidden);

  // —— 大小周观察：只显示 B ——
  click(zhou);
  s = snapshot();
  check('点「大小周观察」→ 仅 B 级可见（14 张，与四格「大小周观察 14」一致）',
    s.visible.length === 14 && s.visible.every((c) => tierOf(c) === 'B'),
    { visible: s.visible.length, tiers: [...new Set(s.visible.map((c) => tierOf(c)))] });

  // —— 避雷预警：只显示 C（虚拟卡除外）——
  click(lei);
  s = snapshot();
  check('点「避雷预警」→ 仅 C 级可见（30 张，含农行/宏碁/三星/霸王茶姬/淘宝闪购；23+14+30=67 对账）',
    s.visible.length === 30 && s.visible.every((c) => tierOf(c) === 'C'),
    { visible: s.visible.length, tiers: [...new Set(s.visible.map((c) => tierOf(c)))] });
  const bankInLei = s.visible.filter((c) =>
    ['农业银行', '淘宝闪购'].some((k) => (c.textContent || '').includes(k)));
  check('★ C 级锁定卡在避雷档可见（农行 + 淘宝闪购 = 2 张）', bankInLei.length === 2,
    { found: bankInLei.length });
  const bankGoneFromLei = s.visible.filter((c) =>
    ['工商银行', '建设银行', '中国银行', '成都银行'].some((k) => (c.textContent || '').includes(k)));
  check('★ 改判 A 级的 4 家银行不在避雷档（不得回退 C）', bankGoneFromLei.length === 0,
    { found: bankGoneFromLei.map((c) => (c.textContent || '').slice(0, 12)) });
  const builtinInLei = s.visible.filter((c) =>
    ['宏碁', '三星', '霸王茶姬'].some((k) => (c.textContent || '').includes(k)));
  check('★ 改判内置卡在避雷档可见（宏碁/三星/霸王茶姬 = 3 张）', builtinInLei.length === 3,
    { found: builtinInLei.length });

  // —— 收录品牌：清除筛选 ——
  click(all);
  s = snapshot();
  check('点「收录品牌」→ 清除筛选恢复可见 67 张（虚拟卡仍隐藏）', s.visible.length === 67,
    { visible: s.visible.length, total: s.total });
  check('清除后无激活态', ['双休红榜', '大小周观察', '避雷预警'].every((lbl) => {
    const b = boxOf(lbl);
    return b && !b.hasAttribute('data-sxg-active');
  }));

  // —— 再点一次同按钮 = 取消 ——
  click(red);
  click(red);
  s = snapshot();
  check('再点一次「双休红榜」= 取消筛选（可见 67 张）', s.visible.length === 67,
    { visible: s.visible.length, total: s.total });

  // —— 评级过滤行（U 级废除后不再注入按钮）——
  const rowBtn = (txt) => [...window.document.querySelectorAll('button')]
    .find((b) => (b.textContent || '').trim() === txt);
  check('评级过滤行原生按钮在（全部评级/S/A/B/C 五个）',
    ['全部评级', 'S 级', 'A 级', 'B 级', 'C 级'].every((t) => !!rowBtn(t)));
  // 互斥：点 React 评级按钮应清掉四格筛选（否则 observer 把旧 display 套回去出空面板）
  click(red);
  s = snapshot();
  check('互斥前置：点红榜后隐藏 ' + (s.total - s.visible.length) + ' 张（含 class 隐藏的虚拟卡）',
    s.hidden === 45, s.hidden); // total 68（含虚拟卡）- 可见 23 = 45
  const allBtn = rowBtn('全部评级');
  if (allBtn) click(allBtn);
  s = snapshot();
  check('再点 React「全部评级」→ 四格筛选被清空（仅剩虚拟卡的 class 隐藏）',
    s.hidden === 1, s.hidden);

  // —— 回归（2026-10-18）：搜索过滤会卸载卡，四格数字是手写常数不受影响 ——
  (async () => {
    const cCards = [...window.document.querySelectorAll('div.bg-white.rounded-2xl.border')]
      .filter((c) => tierOf(c) === 'C');
    check('前置：DOM 中 C 级卡 30 张（2026-10-31 月休口径改判后）', cCards.length === 30, cCards.length);
    const removed = cCards.map((c) => {
      const p = c.parentNode; const nx = c.nextSibling;
      p.removeChild(c); return { c, p, nx };
    });
    await new Promise((r) => setTimeout(r, 450));
    const lei2 = boxOf('避雷预警');
    // 四格避雷数字是 bundle 手写常数（30），搜索卸载卡不改变盒子数字
    check('搜索过滤（C 卡被卸载）后避雷盒仍是手写常数 30',
      lei2 && lei2.children[0].textContent === '30', lei2 && lei2.children[0].textContent);
    // ⚠️ 恢复前先清掉「MO 自愈在卸载窗口期重建的同 id 新卡」：
    // removeChild 后 MutationObserver 会触发 insertAllCustomCards 重建自定义卡
    //（降级插列表末）。若直接把旧节点插回原位，DOM 里会出现同 id 两张卡。
    // 真实浏览器语义：React 卸载后重挂载的是**新节点**，旧节点已被丢弃——
    // 这里模拟「重挂载完成」：保留自愈重建的新卡，放弃旧节点（只用于移除阶段）。
    removed.forEach(({ c }) => {
      if (c.id && c.parentNode) { /* 旧节点仍在 DOM 外，直接放弃 */ }
      const dup = c.id && window.document.getElementById(c.id);
      if (dup && dup !== c) { /* 同 id 新卡已由自愈注入，无需恢复旧节点 */ }
    });
    // 非自定义卡（React 原生卡）没有自愈逻辑，必须恢复
    removed.forEach(({ c, p, nx }) => {
      if (c.id) return; // 自定义卡已被自愈重建，恢复旧节点会造成双卡
      try { nx ? p.insertBefore(c, nx) : p.appendChild(c); }
      catch (e) { try { p.appendChild(c); } catch (e2) { /* 容器已被替换则放弃恢复 */ } }
    });
    await new Promise((r) => setTimeout(r, 450));
    const s2 = snapshot();
    check('恢复全部卡片后可见回到 67 张（无卡丢失、无同 id 双卡）',
      s2.visible.length === 67, { visible: s2.visible.length, total: s2.total });
    const ids = [...window.document.querySelectorAll('div.bg-white.rounded-2xl.border')]
      .filter((c) => c.id).map((c) => c.id);
    check('自定义卡 id 无重复（自愈重建未造成双卡）',
      new Set(ids).size === ids.length, { ids });

    // —— 回归（2026-10-18）：搜索过滤时「富士康补充说明」框残留（PITFALLS 1.10 第二变体）——
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
    type('啊'); // 无匹配：真实浏览器里 React 会卸载全部卡
    await new Promise((r) => setTimeout(r, 500));
    {
      const host = ancestorCardOf(note());
      if (host && host.parentNode) host.parentNode.removeChild(host); // 模拟卸载
    }
    await new Promise((r) => setTimeout(r, 500));
    check('苹果卡被搜索过滤掉（模拟卸载）后 note 不在 DOM', !note());
    // 复原一张 Apple 卡（模拟清空搜索后 React 重新挂载），note 应重新插回。
    {
      const re = window.document.createElement('div');
      re.className = 'bg-white rounded-2xl border';
      re.innerHTML = '<h2>Apple (苹果中国)</h2><div class="flex-wrap"><span>iPhone</span></div>';
      window.document.getElementById('root').appendChild(re);
    }
    type(''); // 清空搜索
    await new Promise((r) => setTimeout(r, 500));
    check('清空搜索后 note 重新插回 Apple 卡', noteInApple(),
      { hasNote: !!note() });
    // React 按位置复用节点（原 bug①）：把持有 note 的 Apple 卡标题改成华为
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
