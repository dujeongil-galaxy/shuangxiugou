// D/U 评级过滤误伤布局的回归测试（jsdom 真渲染整页 → 真点按钮 → 断言搜索框还在）
// 跑法：node scripts/test-gf-search.cjs
//
// 背景（2026-11-03 站长实测）：
//   首页评级过滤条上点「D 级」或「U 级」，拼音搜索框整块消失。
//   根因：u-grade-patch.js 的 CARD_SEL = 'div.bg-white.rounded-2xl.border' 是按
//   Tailwind 类名拼的，命中面比「品牌卡」宽 —— 「搜索 + 品类 + 评级过滤」那一整块
//   操作区容器（div.bg-white.p-4.rounded-2xl.border.border-slate-200.shadow-sm.space-y-4）
//   同样命中。它没有品牌标题、识别不到档位，旧代码 `tier !== gfActive` 一刀切
//   display:none，于是 174 个节点里夹着搜索区一起被藏了。
//   修法：gfApply 加两道闸 —— ① 只认带 h2/h3 品牌标题的节点为卡片；② 档位识别不到
//   就不动（与 stat-filter 的 `tier === null → return` 同口径）。
//
// 这个测试专门咬「症状」而不是「写法」：断言的是搜索框的可见性。
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const html = read('index.html');

let pass = 0, fail = 0;
const fails = [];
const check = (label, cond, extra) => {
  if (cond) { pass++; console.log('  ✓', label); }
  else { fail++; fails.push(label); console.log('  ✗', label, extra !== undefined ? JSON.stringify(extra) : ''); }
};

const CARD_SEL = 'div.bg-white.rounded-2xl.border';

const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'http://localhost/', pretendToBeVisual: true });
const { window } = dom;
const doc = window.document;
window.matchMedia = (q) => ({ matches: false, media: q, onchange: null,
  addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } });
if (!window.requestAnimationFrame) {
  window.requestAnimationFrame = (cb) => window.setTimeout(() => cb(Date.now()), 16);
  window.cancelAnimationFrame = (h) => window.clearTimeout(h);
}
window.HTMLElement.prototype.scrollIntoView = window.HTMLElement.prototype.scrollIntoView || function () {};

for (const m of html.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)) {
  const clean = m[1].split('?')[0];
  if (!fs.existsSync(path.join(ROOT, clean))) continue;
  try { window.eval(read(clean)); } catch (e) { /* 脚手架限制：个别脚本依赖真实浏览器 API */ }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ⚠️ 一律用轮询，不用固定 sleep 等「异步注入/异步过滤」完成：
//    2026-11-03 实测用 sleep(400) 等按钮注入，本地稳定过、CI（机器慢/负载高）
//    判红 —— 固定等待在快的机器上富余、在慢的机器上不够。
//    超时只影响「等不到就按现状断言」，不会提前退出，判红交给断言本身。
const until = async (fn, timeout = 6000) => {
  for (let t = 0; t < timeout; t += 25) {
    if (fn()) return true;
    await sleep(25);
  }
  return false;
};
const gfMarked = () => doc.querySelectorAll('[data-sxg-gf]').length;

// 等「可见档位集合」达到期望（点 D 期望 [D]，点 U 期望 [U,U]），超时就按现状断言。
// 为什么不数标记、也不固定 sleep：
//   ① 数标记 —— 打第一个标记时就 >0，拿到半完成状态（实测 U 分支少算卡）；
//   ② 固定 sleep —— 本地 50ms 够、CI 机器慢时不够（2026-11-03 CI 判红）；
//   ③ 等标记数稳定 —— 两次采样恰好相同也可能停在半完成态（同样判红）。
// 直接轮询**断言关心的那个事实**最可靠：快机器立即返回，慢机器能等到，
// 等不到就超时按现状交给断言判红。
// 等卡片渲染到稳定张数：自定义卡是异步注入的，拍初始快照太早会少算卡，
// 导致后面「取消过滤后张数回到初始值」永远不等（实测判红）。
// 连续 3 次采样相同才认定稳定 —— 只采 2 次会停在半完成态。
const untilCardsStable = async (timeout = 8000) => {
  let prev = -1;
  let same = 0;
  for (let t = 0; t < timeout; t += 50) {
    const n = snapshot().visibleTiers.length;
    if (n > 0 && n === prev) { same++; if (same >= 3) return true; } else { same = 0; }
    prev = n;
    await sleep(50);
  }
  return false;
};

const untilTiers = async (wantLen, wantTier, timeout = 6000) => {
  for (let t = 0; t < timeout; t += 25) {
    const v = snapshot().visibleTiers;
    if (v.length === wantLen && v.every((x) => x === wantTier)) return true;
    await sleep(25);
  }
  return false;
};

// 过滤是逐节点打标记的：「marked > 0」在刚打完第一个标记时就成立，
// 立刻快照拿到的是半完成状态（实测 U 分支因此少算卡）。
// 所以激活态要等**标记数稳定**（连采两次一致）再快照；
// 取消态的终态是 0，起始值 >0，不会误满足，直接等 0 即可。
const stable = async (timeout = 6000) => {
  let prev = -1;
  for (let t = 0; t < timeout; t += 50) {
    const cur = gfMarked();
    if (cur > 0 && cur === prev) return true;
    prev = cur;
    await sleep(50);
  }
  return false;
};

// 卡片档位识别：与生产代码同口径（先看 data-sxg-tier，再看徽标文本）
function tierOf(card) {
  const attr = card.getAttribute('data-sxg-tier');
  if (attr) return attr;
  if ((card.textContent || '').indexOf('虚拟对比黑榜') !== -1) return 'V';
  for (const n of card.querySelectorAll('span,div')) {
    const mm = /^(S|A|B|C|D|U)\s*级/.exec((n.textContent || '').trim());
    if (mm) return mm[1];
  }
  return null;
}

// 搜索框被隐藏的判据：自己或任一祖先 display:none（生产代码正是这么藏的）
function searchHiddenBy(input) {
  const hits = [];
  let n = input;
  while (n && n !== doc.body) {
    if (n.style && n.style.display === 'none') {
      hits.push(n.tagName + '.' + String(n.className || '').replace(/\s+/g, '.').slice(0, 56));
    }
    n = n.parentElement;
  }
  return hits;
}

function clickBtn(letter) {
  const b = doc.querySelector('[data-sxg-gf-letter="' + letter + '"]');
  b.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
}

function snapshot() {
  const cards = [...doc.querySelectorAll(CARD_SEL)];
  const real = cards.filter((c) => tierOf(c) !== null);
  const hiddenAll = cards.filter((c) => c.style.display === 'none');
  const hiddenNoTier = hiddenAll.filter((c) => tierOf(c) === null);
  return {
    visibleIds: real.filter((c) => c.style.display !== 'none').map((c) => c.id || ''),
    totalNodes: cards.length,
    realCards: real.length,
    visibleTiers: real.filter((c) => c.style.display !== 'none').map(tierOf),
    hiddenAll: hiddenAll.length,
    hiddenNoTier: hiddenNoTier.map((c) => String(c.className || '').slice(0, 50)),
    marked: doc.querySelectorAll('[data-sxg-gf]').length,
  };
}

(async () => {
  // 等首轮 scan（setTimeout 0）把 D/U 按钮注入过滤条
  await until(() => doc.querySelector('[data-sxg-gf-letter="D"]') && doc.querySelector('[data-sxg-gf-letter="U"]'));

  const input = doc.getElementById('site-search-input');
  const dBtn = doc.querySelector('[data-sxg-gf-letter="D"]');
  const uBtn = doc.querySelector('[data-sxg-gf-letter="U"]');

  console.log('前置');
  check('搜索框 #site-search-input 存在', !!input);
  check('评级过滤条已注入「D 级」按钮', !!dBtn);
  check('评级过滤条已注入「U 级」按钮', !!uBtn);
  if (!input || !dBtn || !uBtn) {
    console.log('\n前置不成立，后续断言无法执行');
    process.exit(1);
  }

  await untilCardsStable();   // 自定义卡异步注入，等渲染完再拍初始快照
  const s0 = snapshot();
  check('页面渲染出 ≥150 个 CARD_SEL 节点（真渲染，不是空壳）', s0.totalNodes >= 150, s0.totalNodes);
  check('其中存在「无档位、含输入框」的操作区容器（本 bug 的受害者）',
    [...doc.querySelectorAll(CARD_SEL)].some((c) => !tierOf(c) && c.querySelector('input,textarea')));
  check('初始态：搜索框可见', searchHiddenBy(input).length === 0, searchHiddenBy(input));

  console.log('点「D 级」');
  clickBtn('D');
  await untilTiers(1, 'D');
  let s = snapshot();
  check('搜索框仍可见（核心回归：2026-11-03 bug）',
    searchHiddenBy(input).length === 0, searchHiddenBy(input));
  check('过滤确实生效（有节点被打上隐藏标记，否则上一条恒真）', s.marked > 0, s.marked);
  check('被隐藏的节点里没有「无档位容器」（布局容器不许被碰）',
    s.hiddenNoTier.length === 0, s.hiddenNoTier);
  // D 级当前唯一一家 BOSS直聘 是自定义卡（bosszhipin-card），由 index.html
  // 的 filterCustomCards 负责显示；bundle 内没有 D 卡。两件事都要成立。
  check('D 级视图只剩 BOSS直聘 一张卡（自定义卡，bundle 无 D 卡）',
    s.visibleTiers.length === 1 && s.visibleTiers[0] === 'D' && s.visibleIds[0] === 'bosszhipin-card',
    { tiers: s.visibleTiers, ids: s.visibleIds });

  console.log('取消「D 级」');
  clickBtn('D');
  await until(() => gfMarked() === 0);
  await untilCardsStable();
  s = snapshot();
  check('标记清零', s.marked === 0, s.marked);
  check('搜索框仍可见', searchHiddenBy(input).length === 0, searchHiddenBy(input));
  check('卡片全量恢复（可见档位张数回到初始值）',
    s.visibleTiers.length === s0.visibleTiers.length, [s.visibleTiers.length, s0.visibleTiers.length]);

  console.log('点「U 级」');
  clickBtn('U');
  await untilTiers(3, 'U');
  s = snapshot();
  check('搜索框仍可见（U 分支同样不许误伤）',
    searchHiddenBy(input).length === 0, searchHiddenBy(input));
  check('U 级视图只剩 U 卡（三星/宏碁/腾势 3 张，2026-11-13 新增腾势 U 级）',
    s.visibleTiers.length === 3 && s.visibleTiers.every((t) => t === 'U'), s.visibleTiers);
  check('U 级视图下被隐藏的节点里也没有无档位容器',
    s.hiddenNoTier.length === 0, s.hiddenNoTier);

  console.log('再点「U 级」取消');
  clickBtn('U');
  await until(() => gfMarked() === 0);
  s = snapshot();
  check('标记清零且搜索框可见', s.marked === 0 && searchHiddenBy(input).length === 0, s);

  console.log('\n' + '='.repeat(56));
  console.log(fail === 0 ? `全部通过：${pass} 项` : `失败 ${fail} 项 / 共 ${pass + fail} 项`);
  if (fail) { fails.forEach((f) => console.log('  ✗', f)); }
  // 不调 window.close()：jsdom 已排队的 rAF 回调会打到已关闭的 window 上抛
  // TypeError（Node 22 + jsdom），把退出码搅成 1，掩盖真实结果。
  process.exit(fail === 0 ? 0 : 1);
})();
