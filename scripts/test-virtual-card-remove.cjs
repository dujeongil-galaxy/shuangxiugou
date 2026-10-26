// virtual-card-remove 行为测试：虚拟对比黑榜卡下线（class 隐藏方案）
// 跑法：node scripts/test-virtual-card-remove.cjs（需 jsdom，同 CI 其他测试）
//
// 覆盖场景：
// 1) 初始 DOM 里的虚拟卡被隐藏（display:none !important），品牌卡不误伤
// 2) noscript 静态清单行同步删除，其他行保留
// 3) React 重渲染挂回的虚拟卡被 MutationObserver 兜底隐藏
// 4) observer 对普通卡不误伤
// 5) 幂等：重复 eval 不重复启动
// 6) 故障注入：判定字面改错 → 卡不被隐藏 → 判红（防「测试永远绿」）
// 7) 隐藏样式必须存在（sxg-vcard-gone 有 display:none !important）
// 注：隐藏而非 removeChild 是刻意设计——React 协调层不许可外部
//     removeChild 它管理的节点（第一版实测整个 tab 崩掉）。
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'virtual-card-remove.js'), 'utf8');

let pass = 0, fail = 0;
const fails = [];
const check = (l, c, x) => {
  if (c) { pass++; console.log('  ✓', l); }
  else { fail++; fails.push(l); console.log('  ✗', l, x !== undefined ? JSON.stringify(x) : ''); }
};

const HTML = '<!DOCTYPE html><html><head></head><body>'
  + '<div id="root">'
  + '<div class="bg-white rounded-2xl border" id="card-luckin">瑞幸咖啡 (Luckin Coffee) 瑞幸咖啡（中国）有限公司 生椰拿铁</div>'
  + '<div class="bg-white rounded-2xl border" id="card-cotti">库迪咖啡 (COTTI COFFEE) 库迪咖啡（天津）有限公司 现磨咖啡</div>'
  + '<div class="bg-white rounded-2xl border" id="card-virtual">某代工烘焙食品 (虚拟对比黑榜) 某代工烘焙食品有限公司 烘焙</div>'
  + '</div>'
  + '<noscript><ul>'
  + '<li id="li-luckin"><strong>瑞幸咖啡</strong>：C 级</li>'
  + '<li id="li-virtual"><strong>某代工烘焙食品 (虚拟对比黑榜)</strong>：C 级 · 真实双休率 未核实</li>'
  + '<li id="li-cotti"><strong>库迪咖啡</strong>：C 级</li>'
  + '</ul></noscript>'
  + '</body></html>';

function mkDom(src) {
  const dom = new JSDOM(HTML, { runScripts: 'outside-only', url: 'http://localhost/' });
  dom.window.eval(src || SRC);
  return dom;
}

const until = (cond, timeout) => new Promise((resolve) => {
  const t0 = Date.now();
  const poll = () => {
    if (cond()) return resolve(true);
    if (Date.now() - t0 > (timeout || 3000)) return resolve(false);
    setTimeout(poll, 20);
  };
  poll();
});

(async () => {
  console.log('=== virtual-card-remove：虚拟对比黑榜卡下线（class 隐藏） ===\n');

  // ---- 场景 1+2：初始隐藏 + noscript 清理 ----
  const dom1 = mkDom();
  const w1 = dom1.window;
  await until(() => w1.document.documentElement.getAttribute('data-sxg-virtual-removed') === '1');
  check('幂等标记已写（boot 已执行）',
    w1.document.documentElement.getAttribute('data-sxg-virtual-removed') === '1');
  const vCard = w1.document.getElementById('card-virtual');
  check('虚拟卡已加隐藏 class（sxg-vcard-gone）',
    vCard && vCard.classList.contains('sxg-vcard-gone'));
  check('虚拟卡节点仍在 DOM（React 协调安全）', !!vCard);
  check('隐藏样式已注入（display:none !important）',
    !!w1.document.getElementById('sxg-vcard-style')
    && /sxg-vcard-gone\{display:none !important\}/.test(w1.document.getElementById('sxg-vcard-style').textContent));
  check('瑞幸卡不加隐藏 class', !w1.document.getElementById('card-luckin').classList.contains('sxg-vcard-gone'));
  check('库迪卡不加隐藏 class', !w1.document.getElementById('card-cotti').classList.contains('sxg-vcard-gone'));
  check('noscript 虚拟卡行已删（noscript 非 React 管，可安全 removeChild）',
    !w1.document.getElementById('li-virtual'));
  check('noscript 瑞幸行保留', !!w1.document.getElementById('li-luckin'));
  check('noscript 库迪行保留', !!w1.document.getElementById('li-cotti'));
  check('自测导出存在（isVirtualCard/hideVirtualCards/cleanNoscript/HIDE_CLASS）',
    typeof w1.__SXGVirtualCardRemove === 'object'
    && typeof w1.__SXGVirtualCardRemove.isVirtualCard === 'function'
    && typeof w1.__SXGVirtualCardRemove.hideVirtualCards === 'function'
    && typeof w1.__SXGVirtualCardRemove.cleanNoscript === 'function'
    && w1.__SXGVirtualCardRemove.HIDE_CLASS === 'sxg-vcard-gone');
  check('isVirtualCard 判定：null 安全 / 品牌卡 false',
    w1.__SXGVirtualCardRemove.isVirtualCard(null) === false
    && w1.__SXGVirtualCardRemove.isVirtualCard(w1.document.getElementById('card-luckin')) === false);

  // ---- 场景 3：React 重渲染（移除隐藏 class 模拟 React 重建节点）----
  vCard.classList.remove('sxg-vcard-gone');
  check('重渲染挂回（去掉 class）后被 MutationObserver 兜底重新隐藏',
    await until(() => vCard.classList.contains('sxg-vcard-gone')));

  // ---- 场景 3b：React 整节点重建（新节点无 class）----
  const root1 = w1.document.getElementById('root');
  const back1 = w1.document.createElement('div');
  back1.className = 'bg-white rounded-2xl border';
  back1.id = 'card-virtual-back';
  back1.textContent = '某代工烘焙食品 (虚拟对比黑榜) 某代工烘焙食品有限公司 烘焙';
  root1.appendChild(back1);
  check('React 重建的新虚拟卡节点被兜底隐藏',
    await until(() => back1.classList.contains('sxg-vcard-gone')));

  // ---- 场景 4：普通卡不误伤（observer 只隐藏虚拟卡）----
  const normal1 = w1.document.createElement('div');
  normal1.className = 'bg-white rounded-2xl border';
  normal1.id = 'card-normal-new';
  normal1.textContent = '蜜雪冰城 (MIXUE) 蜜雪冰城股份有限公司 冰淇淋';
  root1.appendChild(normal1);
  await new Promise((r) => setTimeout(r, 400));
  check('动态插入的普通品牌卡不加隐藏 class', !normal1.classList.contains('sxg-vcard-gone'));

  // ---- 场景 5：幂等（重复 eval 不二次启动）----
  w1.eval(SRC);
  check('重复 eval 幂等（标记仍为 1，无异常）',
    w1.document.documentElement.getAttribute('data-sxg-virtual-removed') === '1');

  // ---- 场景 6：故障注入——判定字面改错应判红 ----
  const BROKEN = SRC.replace("var MARK = '虚拟对比黑榜';", "var MARK = '不存在占位串XXXX';");
  const dom2 = mkDom(BROKEN);
  await until(() => dom2.window.document.documentElement.getAttribute('data-sxg-virtual-removed') === '1');
  check('故障注入成立：MARK 改错后虚拟卡不被隐藏（证明断言盯真效果）',
    !dom2.window.document.getElementById('card-virtual').classList.contains('sxg-vcard-gone'));

  // ---- 场景 7：故障注入——隐藏样式体被掏空应判红 ----
  // 注入：把样式体里的 display:none !important 换成无效值（模拟手滑改坏）。
  // 注意锚定 '{display:none !important}'（带花括号）——文件头注释里
  // 也出现过这个词，裸字符串会先命中注释（2026-10-25 注入纪律）。
  const BROKEN2 = SRC.replace("'{display:none !important}'", "'{color:red}'");
  const dom3 = mkDom(BROKEN2);
  await until(() => dom3.window.document.documentElement.getAttribute('data-sxg-virtual-removed') === '1');
  check('故障注入成立：样式体失效后 DOM 里是 color:red（证明注入锚对了代码行）',
    /sxg-vcard-gone\{color:red\}/.test(dom3.window.document.getElementById('sxg-vcard-style').textContent));

  console.log('\n----------------------------------------');
  console.log(`结果: ${pass} 通过, ${fail} 失败`);
  if (fail > 0) { console.log('失败项:', fails); process.exit(1); }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
