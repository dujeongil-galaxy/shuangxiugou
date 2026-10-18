// 拼音联想搜索的真实 DOM 行为测试
// 跑法：npm install --no-save jsdom && node scripts/test-pinyin-search.cjs
//
// ⚠️ 不要硬编码仓库绝对路径 —— 那样在 CI（Linux runner）和别人的机器上
//    必然读不到文件。必须从 __dirname 推导仓库根。
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const idx = read('pinyin-index.js');
const lib = read('pinyin-search.js');

const dom = new JSDOM(
  `<!DOCTYPE html><html><body>
     <main><div><input type="text" placeholder="搜索"></div></main>
   </body></html>`,
  { runScripts: 'outside-only', pretendToBeVisual: true }
);
const { window } = dom;
window.eval(idx);
window.eval(lib);

const input = window.document.querySelector('main input[type="text"]');

function fire(val) {
  input.value = val;
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
}
const box = () => window.document.getElementById('pinyin-suggest');
const rows = () => {
  const b = box();
  if (!b || b.style.display === 'none') return [];
  return [...b.querySelectorAll('button[data-fill]')];
};
// [显示名, 回填词, 命中词条+类型]
const names = () => rows().map(x => [
  x.firstChild.textContent.trim(),
  x.getAttribute('data-fill'),
  x.lastChild.textContent.trim(),
]);

let pass = 0, fail = 0;
const failures = [];
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else {
    fail++; failures.push(label);
    console.log('  ✗', label, extra !== undefined ? JSON.stringify(extra) : '');
  }
}

setTimeout(() => {
  console.log('索引加载:', Array.isArray(window.__PINYIN_INDEX__),
              window.__PINYIN_INDEX__ && window.__PINYIN_INDEX__.length, '品牌\n');

  console.log('--- 拼音联想（本例的核心诉求）---');
  fire('ning');
  let n = names();
  check('ning → 宁德时代', n.length && n[0][0].includes('宁德时代'), n);
  check('回填词是中文名，bundle 能原生命中', n[0] && /[一-鿿]/.test(n[0][1]), n[0] && n[0][1]);
  check('显示命中词条（可解释）', n[0] && /宁德时代/.test(n[0][2]), n[0] && n[0][2]);

  fire('ndsd');
  n = names();
  check('ndsd（首字母）→ 宁德时代', n.length && n[0][0].includes('宁德时代'), n);

  fire('ningde');
  n = names();
  check('ningde（全拼）→ 宁德时代', n.length && n[0][0].includes('宁德时代'), n);

  console.log('\n--- 排序正确性（这是最容易出 bug 的地方）---');
  fire('byd');
  n = names();
  check('byd → BYD 第一，不是迪卡侬', n[0] && /BYD/.test(n[0][0]), n.map(x => x[0]));

  fire('hw');
  n = names();
  check('hw → 华为第一，压过巴塔哥尼亚「户外」', n[0] && /华为/.test(n[0][0]), n.map(x => x[0]));

  fire('ping');
  n = names();
  check('ping → 苹果第一（主名命中）', n[0] && /Apple/.test(n[0][0]), n.map(x => x[0]));

  fire('mt');
  n = names();
  check('mt → 美团第一（主名「美团」全拼首字母）', n[0] && /美团/.test(n[0][0]), n.map(x => x[0]));

  fire('sf');
  n = names();
  check('sf → 顺丰第一', n[0] && /顺丰/.test(n[0][0]), n.map(x => x[0]));

  // ms 的正确行为：微软首字母是 wr，不是 ms。
  // 2026-10-17 三星 (Samsung) 入驻后，"samsung" 含子串 ms（L0），排序在 L2「美式」之前；
  // 断言拆成两条：首位是三星（子串命中），星巴克（拼音词条「美式」）仍在候选中。
  fire('ms');
  n = names();
  check('ms 首位命中三星（Samsung 子串，非微软）',
        n.length && /三星/.test(n[0][0]) && /Samsung/i.test(n[0][2]), n);
  check('ms 候选中仍有星巴克并标出命中词条「美式」',
        n.some((x) => /星巴克/.test(x[0]) && /美式/.test(x[2])), n);

  fire('苹果');
  n = names();
  check('中文「苹果」仍能联想（不破坏原生中文搜索）', n.length && /Apple/.test(n[0][0]), n.map(x => x[0]));

  fire('logi');
  n = names();
  check('logi → 罗技（英文名前缀）', n.length && /罗技/.test(n[0][0]), n.map(x => x[0]));

  console.log('\n--- 边界与防抖 ---');
  fire('n');
  check('单字符不弹联想（防刷屏）', names().length === 0);
  fire('');
  check('清空输入收起联想', names().length === 0);
  fire('zzzzzz');
  check('无匹配时不弹框', names().length === 0);
  fire('宁德时代');
  check('完整中文名不报错、不异常', names().length >= 0);

  console.log('\n--- 回填行为 ---');
  fire('ning');
  const before = input.value;
  rows()[0].dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }));
  check('mousedown 回填搜索框', input.value !== before && /宁德时代/.test(input.value), input.value);
  check('回填后联想收起', box().style.display === 'none');

  console.log('\n--- Enter 选中第一项 ---');
  fire('ndsd');
  const ev = new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
  input.dispatchEvent(ev);
  check('Enter 回填首个候选', /宁德时代/.test(input.value), input.value);
  check('Enter 被 preventDefault（不误触发表单提交）', ev.defaultPrevented);

  console.log('\n--- React 受控输入兼容 ---');
  fire('ndsd');
  let observed = null;
  input.addEventListener('input', () => { observed = input.value; });
  rows()[0].dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }));
  check('回填后 React 能读到新值（input 事件已派发）', observed && /宁德时代/.test(observed), observed);

  console.log('\n--- 幂等与重复绑定 ---');
  window.eval(lib);
  fire('ning');
  check('重复执行脚本不产生第二个联想框',
        window.document.querySelectorAll('#pinyin-suggest').length === 1);
  check('重复执行后仍能联想', names().length > 0);

  console.log('\n--- 索引与 bundle / customCardsConfig 的一致性 ---');
  const bundle = fs.readFileSync(path.join(ROOT, 'assets/index-YthXZ9eP.js'), 'utf8');
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  // 自定义卡（肯德基/小米/兵立王/茶百道/赵一鸣/一点点/零食有鸣）不在 bundle，
  // 但 gen-pinyin-index.py 已把它们并入索引，校验时一并放行（2026-10-18 修复）
  const cfgM = html.match(/var customCardsConfig = \[([\s\S]*?)\n      \];/);
  const customIds = new Set(
    cfgM ? [...cfgM[1].matchAll(/id:\s*'([^']+)'/g)].map((m) => m[1]) : []
  );
  const missing = window.__PINYIN_INDEX__.filter(
    (e) => bundle.indexOf('id:`' + e.id + '`') === -1 && !customIds.has(e.id)
  );
  check('索引里的每个品牌都真实存在于 bundle 或 customCardsConfig（无幽灵条目）',
        missing.length === 0, missing.map(m => m.id));
  // 品牌数从 bundle 动态推导，不要写死—— 否则每次加卡都要改测试，
  // 忘了改就会变成一个长期报错的假警报，或者更糟：被忽略而失去意义。
  const BT = String.fromCharCode(96);
  // 只统计 brands 主数组里的卡片， 与 verify.mjs 口径一致。
  // 不能用全文正则：那会连 recommendedAlternatives 里的重复引用一起数进来
  // （实测 pepsi-drinks 就只出现在推荐位，导致 35 ≠ 34 的假警报）。
  const brandsStart = bundle.indexOf('brands:[') + 'brands:['.length;
  let depth = 0, cardStart = null, j = brandsStart;
  const cards = [];
  while (j < bundle.length) {
    const ch = bundle[j];
    if (ch === BT) {
      j++;
      while (j < bundle.length) {
        if (bundle[j] === BT && bundle[j - 1] !== '\\') break;
        j++;
      }
    } else if (ch === '{') {
      if (depth === 0) cardStart = j;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) cards.push(bundle.slice(cardStart, j + 1));
      else if (depth < 0) break;
    }
    j++;
  }
  const bundleIds = new Set(cards
    .map((o) => /\{id:`([a-z0-9-]+)`,name:`/.exec(o))
    .filter(Boolean).map((m) => m[1]));
  check('索引品牌数与 brands 主数组 + 自定义卡一致（动态推导，不写死）',
        window.__PINYIN_INDEX__.length === bundleIds.size + customIds.size,
        { 索引: window.__PINYIN_INDEX__.length, brands数组: bundleIds.size, 自定义卡: customIds.size });

  console.log('\n--- 标签页延迟渲染（真实场景）---');
  // bundle 里搜索框是 `brands&&...` 条件渲染：页面初始在别的标签时
  // 输入框根本不存在。必须验证「之后才挂载」也能绑上。
  {
    const dom2 = new JSDOM(
      `<!DOCTYPE html><html><body><div id="root"></div>
         <main><div id="slot"></div></main></body></html>`,
      { runScripts: 'outside-only', pretendToBeVisual: true }
    );
    const w2 = dom2.window;
    w2.eval(idx);
    w2.eval(lib);
    // 初始：#slot 里什么都没有
    setTimeout(() => {
      const i2 = w2.document.getElementById('site-search-input');
      if (i2) {
        check('初始无搜索框时不报错', false, '不该绑上');
      } else {
        check('初始无搜索框时不报错、不误绑', true);
      }
      // 模拟用户切到「企业真双休检索」标签，React 挂载搜索框
      const inp = w2.document.createElement('input');
      inp.type = 'text';
      inp.id = 'site-search-input';
      w2.document.getElementById('slot').appendChild(inp);

      setTimeout(() => {
        const i3 = w2.document.getElementById('site-search-input');
        check('切换标签后搜索框已被 observer 绑上',
          !!i3 && i3.dataset.pinyinBound === '1',
          i3 ? { bound: i3.dataset.pinyinBound } : 'no input');
        if (!i3) return;
        i3.value = 'ning';
        i3.dispatchEvent(new w2.Event('input', { bubbles: true }));
        const b2 = w2.document.getElementById('pinyin-suggest');
        const rows2 = b2 ? [...b2.querySelectorAll('button[data-fill]')] : [];
        check('标签切换后新挂载的搜索框也能联想',
          rows2.length > 0 && /宁德时代/.test(rows2[0].textContent),
          rows2.map(r => r.textContent));
        check('联想框挂在正确父容器（未污染 body）',
          !!b2 && b2.parentNode !== w2.document.body);
      }, 500);
    }, 400);
  }

  console.log('\n' + '='.repeat(52));
  setTimeout(() => {
    console.log(`通过 ${pass} 项，失败 ${fail} 项`);
    if (fail) console.log('失败项：\n  - ' + failures.join('\n  - '));
    process.exit(fail ? 1 : 0);
  }, 1200);
}, 400);