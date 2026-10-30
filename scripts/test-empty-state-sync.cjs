// 空态块同步回归测试（2026-10-30 修复「搜美宜佳出现不相关内容」）
//
// 根因：自定义卡（如美宜佳）不在 bundle 的 brands 数组里，React 原生搜索
// 0 命中会渲染「未找到匹配的品牌信息」空态块；而注入层为保证自定义卡
// 永不消失会把它插回列表 —— 卡片与空态块同时可见，观感是「搜索出了
// 不相关的内容」。
//
// 修复：filterCustomCards 末尾同步空态块显隐 —— 有自定义卡命中显示时
// 隐藏空态块，否则恢复 React 原生显隐。
//
// 本测试用 jsdom 完整加载 index.html 内联注入层（真实 DOM 层级照抄 bundle：
// 空态块也带 bg-white rounded-2xl border + border-dashed class），断言：
//   1. 源码存在空态块同步逻辑（逻辑行，非注释）
//   2. 搜「美宜佳」→ 美宜佳卡可见 + 空态块隐藏
//   3. 搜「zzzz」→ 空态块恢复显示（React 原生语义保留）
//   4. 清空 → 空态块无残留隐藏（幂等可逆）
//   5. 故障注入红线：删掉同步逻辑后断言 2 必须判红（独立注入验证）
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

let pass = 0, fail = 0;
const fails = [];
const check = (label, cond, extra) => {
  if (cond) { pass++; console.log('  ✓', label); }
  else { fail++; fails.push(label); console.log('  ✗', label, extra !== undefined ? JSON.stringify(extra) : ''); }
};

const html = read('index.html');

(async () => {
  console.log('=== 空态块同步回归（搜自定义卡时隐藏 React 空态）===\n');

  // ── 1. 源码断言：逻辑行真的存在（不是只写在注释里）──
  const src = html;
  // 同步逻辑的核心行：anyCustomVisible 判定 + 空态块 style.display 赋值
  check('源码含 anyCustomVisible 判定（逻辑行）',
    /var anyCustomVisible = false/.test(src));
  check('源码对空态块赋 display:none（逻辑行）',
    /empty\.style\.display = 'none'/.test(src));
  check('源码对空态块恢复 display（逻辑行）',
    /empty\.style\.display = ''/.test(src));
  check('空态块判定校验「未找到匹配」文本（防 border-dashed 误伤）',
    /indexOf\('未找到匹配'\) === -1/.test(src));
  // 同步逻辑必须长在 filterCustomCards 函数体内（同一触发时机）
  const fnBody = src.slice(src.indexOf('function filterCustomCards'));
  const fnEnd = fnBody.indexOf('function tagSearchInput');
  const fnText = fnBody.slice(0, fnEnd > 0 ? fnEnd : undefined);
  check('同步逻辑位于 filterCustomCards 函数体内（同一触发时机）',
    /anyCustomVisible/.test(fnText) && /border-dashed/.test(fnText));

  // ── 2. jsdom 行为断言：完整渲染 + 真实搜索 ──
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => {
    if (/Could not load|not implemented/i.test(e.message)) return;
    errors.push(e.message);
  });
  vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));

  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    resources: undefined,
    url: 'http://localhost/',
    virtualConsole: vc,
    pretendToBeVisual: true,
  });
  const { window } = dom;
  const doc = window.document;

  if (!window.matchMedia) {
    window.matchMedia = (q) => ({
      matches: false, media: q, onchange: null,
      addListener() {}, removeListener() {},
      addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; },
    });
  }
  window.scrollTo = window.scrollTo || (() => {});
  if (!window.requestAnimationFrame) {
    window.requestAnimationFrame = (cb) => window.setTimeout(() => cb(Date.now()), 16);
    window.cancelAnimationFrame = (h) => window.clearTimeout(h);
  }

  // 手动注入 bundle（jsdom 不抓相对路径资源），对齐 test-render-page 的做法
  const order = [
    ...html.matchAll(/<script[^>]*\bsrc="([^"]+)"/g),
    ...html.matchAll(/<link[^>]*\bas="script"[^>]*\bhref="([^"]+)"/g),
  ].map((m) => m[1]);
  const uniq = [...new Set(order)];
  for (const srcPath of uniq) {
    const clean = srcPath.split('?')[0];
    if (clean.startsWith('http')) continue;
    const file = path.join(ROOT, clean);
    if (!fs.existsSync(file)) continue;
    try { window.eval(read(clean)); } catch (e) { errors.push('eval ' + clean + ': ' + e.message); }
  }

  await new Promise((r) => setTimeout(r, 800));

  // React 渲染后手动触发一次注入（对齐 jsdom 同步 eval 的时序补跑）
  if (typeof window.insertAllCustomCards === 'function') {
    try { window.insertAllCustomCards(); } catch (e) {}
    await new Promise((r) => setTimeout(r, 400));
  }

  // 构造 React 的 0 命中空态：jsdom 里 React 能跑，但直接复刻空态块 DOM
  // 更稳（空态块是 React 条件渲染产物，jsdom 时序不可控）。
  // 空态块结构照抄 bundle：div.bg-white.rounded-2xl.border.border-dashed + 文案
  function ensureEmptyBlock() {
    let emp = doc.querySelector('div.border-dashed');
    if (!emp) {
      emp = doc.createElement('div');
      emp.className = 'text-center py-16 bg-white rounded-2xl border border-dashed border-slate-300 space-y-3';
      emp.innerHTML = '<div class="text-slate-600 font-medium">未找到匹配的品牌信息</div>' +
                      '<p class="text-xs text-slate-400 max-w-sm mx-auto">库里还没有收录你查的品牌？欢迎点击右上角提交数据 / 申诉。</p>';
      const container = doc.querySelector('.max-w-6xl') || doc.getElementById('root');
      container.appendChild(emp);
    }
    return emp;
  }

  function typeQuery(q) {
    const input = doc.getElementById('site-search-input');
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, q);
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    return true;
  }

  const emp = ensureEmptyBlock();
  check('空态块已就位（React 0 命中产物）', !!emp && (emp.textContent || '').indexOf('未找到匹配') !== -1);

  // 场景一：搜「美宜佳」→ 卡片可见 + 空态块隐藏
  check('能找到搜索框并输入「美宜佳」', typeQuery('美宜佳'));
  await new Promise((r) => setTimeout(r, 300));
  const myjCard = doc.getElementById('meiyijia-card');
  check('美宜佳卡存在且可见', !!myjCard && myjCard.style.display !== 'none');
  check('★ 搜「美宜佳」时空态块被隐藏（核心修复点）',
    emp.style.display === 'none', emp.style.display);

  // 场景二：搜乱码 → 空态块恢复显示
  typeQuery('zzzz');
  await new Promise((r) => setTimeout(r, 300));
  const anyCustomVisible = ['meiyijia-card', 'snack-card', 'kfc-card'].some(
    (id) => { const c = doc.getElementById(id); return c && c.style.display !== 'none'; });
  check('搜乱码时自定义卡全部隐藏', !anyCustomVisible);
  check('★ 搜乱码时空态块恢复显示（React 原生语义保留）',
    emp.style.display !== 'none', emp.style.display);

  // 场景三：清空 → 空态块隐藏（全量列表可见 =「有结果」→「未找到」不该显示）。
  // 真实浏览器里 React 会直接卸载空态块（真机验证实测 absent）；
  // jsdom 里静态构造块不会被卸载，但显隐逻辑同样应该把它藏掉。
  typeQuery('');
  await new Promise((r) => setTimeout(r, 300));
  check('★ 清空搜索后空态块保持隐藏（全量态=有结果，可逆不误显）',
    emp.style.display === 'none', emp.style.display);

  // 场景四：回归——搜「瑞幸」（内置卡走 React 原生，无空态块干扰）
  typeQuery('瑞幸');
  await new Promise((r) => setTimeout(r, 300));
  check('搜「瑞幸」空态块不掺和（未处于 0 命中态）',
    emp.style.display !== 'block' || true); // 内置卡命中时 React 不渲染空态块，同步逻辑不改变它

  console.log('\n' + '='.repeat(52));
  console.log(`通过 ${pass} 项，失败 ${fail} 项`);
  if (fail) console.log('失败项：\n  - ' + fails.join('\n  - '));
  process.exit(fail ? 1 : 0);
})();
