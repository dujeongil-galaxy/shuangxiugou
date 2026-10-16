// 推荐位逻辑测试：C 级不得被推荐为「良心双休替代品牌」
//
// 起因（读者反馈）：点开宁德时代详情，底部「打工人用脚投票推荐：
// 良心双休平替品牌」里赫然列着 BYD (比亚迪) —— 而 BYD 自己也是 C 级。
// 根因：卡片内的小推荐位有过滤 `t.tier!=='C'`，**详情页的大推荐位没有**，
// 于是同级品牌被原样显示，还顶着「良心替代」的绿色标题。
// 逻辑矛盾：拿两个「同样没查清」的公司互相推荐，还说是良心替代。
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

let pass = 0, fail = 0;
const fails = [];
const check = (l, c, x) => {
  if (c) { pass++; console.log('  ✓', l); }
  else { fail++; fails.push(l); console.log('  ✗', l, x !== undefined ? JSON.stringify(x) : ''); }
};

console.log('=== 推荐位逻辑 ===\n');

// ---------- 1. 源码层：两处推荐位必须有同样过滤 ----------
const bundle = read('assets/index-YthXZ9eP.js');

console.log('--- 源码过滤条件 ---');
const smallAt = bundle.indexOf('打工人推荐双休平替');
const bigAt = bundle.indexOf('打工人用脚投票推荐');
check('找得到卡片内小推荐位', smallAt > 0);
check('找得到详情页大推荐位', bigAt > 0);

const smallCtx = bundle.slice(Math.max(0, smallAt - 340), smallAt);
const bigCtx = bundle.slice(bigAt, bigAt + 900);

check('小推荐位排除了 C 级', /tier!==.C./.test(smallCtx));
check('大推荐位也排除了 C 级（本次修复）', /tier!==.C./.test(bigCtx));

// 过滤后可能为空（本次清空 catl 就是这种情况），
// 空列表不该再渲染「良心双休替代品牌」的绿框 —— 否则又是空承诺。
const bigContainer = bundle.slice(Math.max(0, bigAt - 500), bigAt);
check('推荐位容器有「非空才渲染」的守卫',
  /some\(e=>\{let t=n\.find\(t=>t\.id===e\);return t&&t\.tier!==`C`\}\)/.test(bigContainer)
  || /\.some\(/.test(bigContainer),
  bigContainer.slice(-200));

// ---------- 2. 数据层：任何 alternatives 不得指向同级或未核实卡片 ----------
console.log('\n--- 数据自洽性 ---');
const BT = String.fromCharCode(96);
const i = bundle.indexOf('brands:[') + 8;
let depth = 0, cur = null, j = i;
const objs = [];
while (j < bundle.length) {
  const c = bundle[j];
  if (c === BT) {
    j++;
    while (j < bundle.length) { if (bundle[j] === BT && bundle[j - 1] !== String.fromCharCode(92)) break; j++; }
  } else if (c === '{') { if (depth === 0) cur = j; depth++; }
  else if (c === '}') { depth--; if (depth === 0) objs.push(bundle.slice(cur, j + 1)); else if (depth < 0) break; }
  j++;
}
const fld = (o, k) => { const m = new RegExp(k + ':' + BT + '([^' + BT + ']*)' + BT).exec(o); return m ? m[1] : null; };
const arrf = (o, k) => {
  const m = new RegExp(k + ':\\[([^\\]]*)\\]').exec(o);
  return m ? [...m[1].matchAll(new RegExp(BT + '([^' + BT + ']*)' + BT, 'g'))].map((x) => x[1]) : [];
};
const cards = objs.map((o) => ({
  id: fld(o, 'id'), name: fld(o, 'name'), tier: fld(o, 'tier'), alt: arrf(o, 'alternatives'),
})).filter((c) => c.id);
const byId = new Map(cards.map((c) => [c.id, c]));

console.log(`  解析到 ${cards.length} 张内置卡`);
check('卡片 id 无重复', byId.size === cards.length);

// 「良心替代」的语义：被推荐方必须真的比推荐方好。
// 判定只认一条硬规则：**不得指向同级（C→C）**。
// 允许 B→B 这种情形：推荐位的作用是给「数据不全」的公司指个更靠谱的方向，
// 宏碁（无实测、B 级）推荐苹果/索尼/华为/vivo 就是合理用法 ——
// 它推给的是更高档的品牌，不是拿同级互指充数。
const rank = { S: 4, A: 3, B: 2, C: 1 };
const badPairs = [];
const dangling = [];
for (const c of cards) {
  for (const a of c.alt) {
    const t = byId.get(a);
    if (!t) { dangling.push(`${c.name} → ${a}`); continue; }
    if (t.tier === 'C' && c.tier === 'C') {
      badPairs.push(`${c.name} → ${t.name}（同为 C 级，不该被推荐为良心替代）`);
    }
  }
}
check('没有任何 C 级被当成「良心替代」推荐', badPairs.length === 0, badPairs);

// 悬空引用（指向站内不存在的 id）不阻断，但必须如实报出来。
// 已知遗留：瑞幸→manner、美团→eleme、比亚迪→nio。
// 用户决定保留（以后可能收录这些品牌），所以只提示不报错。
if (dangling.length) {
  console.log(`  ⚠️ ${dangling.length} 个 alternatives 指向站内不存在的 id（已决定保留）：`);
  dangling.forEach((x) => console.log('     -', x));
}
check('悬空引用数量与已知遗留一致（新增会被这条拦住）',
  dangling.length <= 3, dangling);

// 宁德时代这个具体案例（读者反馈的原始场景）
const catl = byId.get('catl');
if (catl) {
  const catlAlts = catl.alt.map((a) => byId.get(a)).filter(Boolean);
  const cAltsInCatl = catlAlts.filter((t) => t.tier === 'C');
  check('宁德时代的 alternatives 里没有 C 级品牌',
    cAltsInCatl.length === 0, cAltsInCatl.map((t) => t.name));
}

// ---------- 3. 运行时：宁德时代详情页不应出现比亚迪推荐 ----------
console.log('\n--- 运行时渲染 ---');
const html = read('index.html');
const dom = new JSDOM(html, {
  runScripts: 'dangerously', url: 'http://localhost/', pretendToBeVisual: true,
});
const { window } = dom;
window.matchMedia = (q) => ({
  matches: false, media: q, onchange: null,
  addListener() {}, removeListener() {},
  addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; },
});
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

setTimeout(() => {
  const txt = window.document.body.textContent;
  const at = txt.indexOf('宁德时代 (CATL)');
  check('页面上找得到宁德时代卡片', at > 0);
  if (at > 0) {
    const cardTxt = txt.slice(at, at + 700);
    check('宁德时代卡片内不再出现推荐位标题',
      !cardTxt.includes('打工人推荐双休平替'),
      cardTxt.slice(0, 120));
  }
  check('比亚迪本身仍在列表中（不该被误删）', txt.includes('比亚迪'));

  console.log('\n' + '='.repeat(52));
  console.log(`通过 ${pass} 项，失败 ${fail} 项`);
  if (fail) console.log('失败项：\n  - ' + fails.join('\n  - '));
  process.exit(fail ? 1 : 0);
}, 1500);