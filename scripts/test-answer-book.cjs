// 《答案之书》随机占位的 DOM 测试
// 跑法：npm install --no-save jsdom && node scripts/test-answer-book.cjs
//
// 测的是真实会跑的那份源码（从 answer-book.js 里抠函数），
// 搭一个和 bundle 渲染结果结构一致的 DOM，验证：
//   1. 能覆盖 React 写死的 placeholder
//   2. 点击换一条，且换的是真答案
//   3. React 重挂载把 placeholder 冲回原值后能补回来
//   4. 不影响搜索框的 value 与其他属性（不干扰拼音搜索层）
//   5. 答案数据本身完整、无重复、无空串
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const DATA = fs.readFileSync(path.join(ROOT, 'answer-book-data.js'), 'utf8');
const LIB = fs.readFileSync(path.join(ROOT, 'answer-book.js'), 'utf8');
const BUNDLE = fs.readFileSync(
  path.join(ROOT, 'assets', 'index-YthXZ9eP.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let pass = 0, fail = 0;
const failures = [];
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else {
    fail++; failures.push(label);
    console.log('  ✗', label, extra !== undefined ? JSON.stringify(extra) : '');
  }
}

// =====================================================================
// 第 1 段：答案数据
// =====================================================================
console.log('=== 1. 答案数据完整性 ===');

const items = (function () {
  const dom = new JSDOM('<!DOCTYPE html><body></body>', { runScripts: 'outside-only' });
  dom.window.eval(DATA);
  return dom.window.__ANSWER_BOOK__;
})();

check('答案数组存在且非空', Array.isArray(items) && items.length > 0, items && items.length);
check('条数不少于 300（知乎原版 319 条，去重后 318）', items.length >= 300, items.length);
check('全部是字符串', items.every((x) => typeof x === 'string'));
check('无空串', items.every((x) => x.trim().length > 0));
check('无首尾空白', items.every((x) => x === x.trim()),
  items.filter((x) => x !== x.trim()));
check('无重复项', new Set(items).size === items.length,
  items.length - new Set(items).size);
check('全部不超过 20 字（placeholder 装得下）',
  items.every((x) => x.length <= 20),
  items.filter((x) => x.length > 20).slice(0, 3));
check('含原版首条「别失望」', items.includes('别失望'));
check('含原版末条「空想」', items.includes('空想'));
check('含 17 字长句（原版最长）',
  items.includes('你失去的某天会以不同的方式归还于你'));

// =====================================================================
// 第 2 段：bundle 里的原始 placeholder
// =====================================================================
console.log('\n=== 2. 压缩包里的原始 placeholder ===');

const ORIG = '消费前，先了解这个品牌是否双休；用订单（消费力），反向考核企业';
check('压缩包里确实写死了原 placeholder', BUNDLE.includes(ORIG));
check('它是 input 的 placeholder 属性',
  /placeholder:`消费前，先了解这个品牌是否双休/.test(BUNDLE));

// =====================================================================
// 第 3 段：真 DOM 行为
// =====================================================================
console.log('\n=== 3. DOM 行为（真跑源码）');

// 搭一个和 bundle 渲染结构一致的搜索框
function mount(opts) {
  const opts2 = opts || {};
  const html = `<!DOCTYPE html><html><body>
    <div id="root" class="max-w-7xl">
      <main>
        <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-4">
          <div class="relative">
            <svg></svg>
            <input type="text" placeholder="${ORIG}"
              class="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:bg-white transition text-sm" />
          </div>
        </div>
      </main>
    </div>
  </body></html>`;
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.__ANSWER_BOOK__ = opts2.book || items;

  // 从真实源码里抠出 applyTo / sweep，测真正会跑的那份
  const applySrc = LIB.match(
    /function applyTo\(input\) \{[\s\S]*?\n  \}/)[0];
  const sweepSrc = LIB.match(
    /function sweep\(\) \{[\s\S]*?\n  \}/)[0];
  const pickSrc = LIB.match(
    /function pick\(\) \{[\s\S]*?\n  \}/)[0];
  const findSrc = LIB.match(
    /function findInputs\(\) \{[\s\S]*?\n  \}/)[0];

  const fn = new Function('window', 'document', [
    'function diag(m){ if(window.__diag) window.__diag.push(m); }',
    'var BOOK = window.__ANSWER_BOOK__;',   // 逻辑层的模块级变量
    pickSrc, applySrc, findSrc, sweepSrc,
  ].join('\n') + '\nreturn {pick, applyTo, findInputs, sweep};');
  const api = fn(w, w.document);
  api.window = w;
  api.input = w.document.querySelector('main input[type="text"]');
  return api;
}

{
  const E = mount();
  const before = E.input.getAttribute('placeholder');
  check('初始 placeholder 是 bundle 的原句', before === ORIG, before);

  E.sweep();
  const after = E.input.getAttribute('placeholder');
  check('sweep 后 placeholder 被改写', after !== ORIG, after);
  check('改写后是答案之书里的一条', items.includes(after), after);
  check('被打上绑定标记', E.input.dataset.answerBookBound === '1');
  check('抽中的那条被记录在 data 上',
    E.input.getAttribute('data-answer-book-pick') === after);
}

console.log('\n=== 4. 随机性 ===');
{
  // 连抽 200 次，应当覆盖到相当多条目
  const E = mount({ book: items });
  const seen = {};
  for (let i = 0; i < 200; i++) seen[E.pick()] = 1;
  const distinct = Object.keys(seen).length;
  check('200 次抽取出至少 100 条不同答案（真随机，不是固定一条）',
    distinct >= 100, distinct);
  check('抽出的都在答案库内', Object.keys(seen).every((x) => items.includes(x)));
}

console.log('\n=== 5. 点击换一条 ===');
{
  const E = mount();
  E.sweep();
  const first = E.input.getAttribute('placeholder');

  // 反复点击直到出现不同的答案（318/318 概率极低，20 次内必然出现）
  let changed = false;
  let after = first;
  for (let i = 0; i < 20 && !changed; i++) {
    E.input.dispatchEvent(new E.window.MouseEvent('click', { bubbles: true }));
    after = E.input.getAttribute('placeholder');
    if (after !== first) changed = true;
  }
  check('点击后能换到另一条', changed, { first, after });
  check('换后的仍是答案库里的条目', items.includes(after), after);
  check('data 上同步更新为新抽到的那条',
    E.input.getAttribute('data-answer-book-pick') === after);
}

console.log('\n=== 6. 有输入内容时点击不换 ===');
{
  const E = mount();
  E.sweep();
  const before = E.input.getAttribute('placeholder');
  E.input.value = '宁德';
  E.input.dispatchEvent(new E.window.MouseEvent('click', { bubbles: true }));
  check('正在打字时点击不抽新答案',
    E.input.getAttribute('placeholder') === before,
    E.input.getAttribute('placeholder'));
  check('value 未被本脚本改动', E.input.value === '宁德', E.input.value);
}

console.log('\n=== 7. React 重挂载后能补回来 ===');
{
  const E = mount();
  E.sweep();
  const want = E.input.getAttribute('placeholder');

  // 模拟 React 重建 input：placeholder 被打回原值
  E.input.setAttribute('placeholder', ORIG);
  check('模拟重挂载后 placeholder 已被冲回原值',
    E.input.getAttribute('placeholder') === ORIG);

  E.sweep();
  check('再次 sweep 后恢复成抽中的那条',
    E.input.getAttribute('placeholder') === want,
    E.input.getAttribute('placeholder'));
}

console.log('\n=== 8. 幂等：重复 sweep 不会一直换 ===');
{
  const E = mount();
  E.sweep();
  const first = E.input.getAttribute('placeholder');
  E.sweep(); E.sweep(); E.sweep();
  check('连续 sweep 后 placeholder 不变',
    E.input.getAttribute('placeholder') === first,
    E.input.getAttribute('placeholder'));
}

console.log('\n=== 9. 不干扰搜索框其他行为 ===');
{
  const E = mount();
  E.sweep();
  const i = E.input;
  check('type 未被改（仍是 text）', i.type === 'text');
  check('class 未被改', i.className.indexOf('rounded-xl') !== -1);
  check('value 未被写（仍为空）', i.value === '');
  check('没有插入任何新元素到搜索框附近',
    i.parentNode.children.length === 2,
    i.parentNode.children.length);
}

console.log('\n=== 10. 定位不到搜索框时不报错 ===');
{
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="root"></div></body></html>',
    { runScripts: 'outside-only' });
  const w = dom.window;
  w.__ANSWER_BOOK__ = items;
  const fn = new Function('window', 'document', [
    'function diag(m){ if(window.__diag) window.__diag.push(m); }',
    'var BOOK = window.__ANSWER_BOOK__;',
    LIB.match(/function pick\(\) \{[\s\S]*?\n  \}/)[0],
    LIB.match(/function applyTo\(input\) \{[\s\S]*?\n  \}/)[0],
    LIB.match(/function findInputs\(\) \{[\s\S]*?\n  \}/)[0],
    LIB.match(/function sweep\(\) \{[\s\S]*?\n  \}/)[0],
  ].join('\n') + '\nreturn {sweep};');
  const api = fn(w, w.document);
  let threw = null;
  try { api.sweep(); } catch (e) { threw = e; }
  check('页面还没有搜索框时 sweep 不抛异常', threw === null, threw && threw.message);
}

console.log('\n=== 11. 答案库缺失时安全退出 ===');
{
  // 逻辑层开头就是 `if (!BOOK || !BOOK.length) return;`
  // 数据文件没加载 / 加载失败时必须安静退出，而不是抛异常把后面全打断
  const dom = new JSDOM('<!DOCTYPE html><html><body></body>', { runScripts: 'outside-only' });
  const w = dom.window;
  let threw = null;
  try { w.eval(LIB); } catch (e) { threw = e; }
  check('答案库未加载时整个脚本不抛异常', threw === null, threw && threw.message);
  check('答案库未加载时没往 DOM 里插任何东西', w.document.body.children.length === 0);

  // 反向验证：断言真的有效。塞一个空数组进去，也应当安静退出
  const dom2 = new JSDOM('<!DOCTYPE html><html><body></body>', { runScripts: 'outside-only' });
  let threw2 = null;
  try {
    dom2.window.eval('window.__ANSWER_BOOK__ = [];');
    dom2.window.eval(LIB);
  } catch (e) { threw2 = e; }
  check('答案为空数组时同样安静退出', threw2 === null, threw2 && threw2.message);
}

console.log('\n=== 12. index.html 引入顺序 ===');
{
  // ⚠️ 数据文件必须排在逻辑文件之前。
  //    反了的话逻辑层开头 `if (!BOOK) return` 直接退出，
  //    页面不会报错、placeholder 也不会变 —— 又是一次静默失效。
  const lines = HTML.split('\n');
  const dataLine = lines.findIndex((l) => /answer-book-data\.js\?v=\d+/.test(l));
  const logicLine = lines.findIndex((l) =>
    /answer-book\.js\?v=\d+/.test(l) && l.indexOf('data') === -1);
  check('引入了数据文件 answer-book-data.js', dataLine !== -1);
  check('引入了逻辑文件 answer-book.js', logicLine !== -1);
  check('数据文件先于逻辑文件加载',
    dataLine !== -1 && logicLine !== -1 && dataLine < logicLine,
    { dataLine, logicLine });
  check('两个文件都有 ?v= 缓存版本号',
    /answer-book-data\.js\?v=\d+/.test(HTML)
    && /answer-book\.js\?v=\d+/.test(HTML));
  check('pinyin-index 在 pinyin-search 之前（同一条纪律）',
    HTML.indexOf('pinyin-index.js') < HTML.indexOf('pinyin-search.js'));
}

console.log('\n' + '='.repeat(54));
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
if (fail) console.log('失败项：\n  - ' + failures.join('\n  - '));
process.exit(fail ? 1 : 0);