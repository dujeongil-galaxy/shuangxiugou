/* ==========================================================================
   test-search-scope-fix.cjs —— 搜索口径修正（summary 命中降级）行为测试
   --------------------------------------------------------------------------
   被测对象：search-scope-fix.js（浏览器 IIFE，挂 window.__SXGSearchScopeFix）

   覆盖路径：
     ① 提取器：从压缩 bundle 文本提取强字段（含模板字符串带 {} 的坑）
     ② 核心 bug：搜「瑞幸咖啡」→ 库迪收起、瑞幸保留
     ③ 强命中不误伤：咖啡 / 现磨咖啡（keyProducts 路）/ cotti（id 路）
     ④ summary 兜底：强字段零命中（六休一）→ 全显示，不空结果
     ⑤ 空搜索恢复 / 黑榜卡与识别不了的卡不动 / 最长名匹配
     ⑥ fetch 失败降级拼音索引 / !important 样式注入 / input 自动触发 / 幂等

   为什么用「执行在 jsdom 里的真实 IIFE」而不是 require：
   search-scope-fix.js 不是 UMD 模块，它靠 window 挂载。
   用 runScripts:'outside-only' + window.eval 执行源码，
   事件、classList、MutationObserver 全是真实 DOM 行为。
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const PATCH_SRC = fs.readFileSync(path.join(ROOT, 'search-scope-fix.js'), 'utf8');

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name + (detail !== undefined ? ' → ' + JSON.stringify(detail) : '')); }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// 轮询等条件成立。固定 wait 窗口会被后续同步构造 JSDOM 的耗时挤爆
// （2026-10-24 踩过：wait(40) 到期早于定时器执行，数出来永远是 0）。
function until(condFn, timeoutMs) {
  const start = Date.now();
  return new Promise((resolve) => {
    (function poll() {
      let ok = false;
      try { ok = condFn(); } catch (e) { ok = false; }
      if (ok) return resolve(true);
      if (Date.now() - start >= timeoutMs) return resolve(false);
      setTimeout(poll, 5);
    })();
  });
}

/* ---------------------------------------------------------------- 假数据 */
// 假 bundle：brands 数组 + 每个品牌的强字段。
// ⚠️ cotti 的 summary 里含「瑞幸咖啡」——这就是线上 bug 的根因，
//    必须原样进测试数据，否则测试抓不到这个 bug。
const BT = String.fromCharCode(96);
function q(s) { return BT + s + BT; }
const FAKE_BUNDLE = 'brands:[' + [
  '{id:' + q('luckin') + ',name:' + q('瑞幸咖啡 (Luckin Coffee)')
  + ',companyName:' + q('瑞幸咖啡（中国）有限公司')
  + ',summary:' + q('真实双休率 98%，{2026} 年核实。')
  + ',keyProducts:[' + q('生椰拿铁') + ',' + q('挂耳咖啡') + ']'
  + ',searchKeywords:[' + q('瑞幸') + ',' + q('咖啡') + ',' + q('奶茶') + ']}',
  '{id:' + q('cotti') + ',name:' + q('库迪咖啡 (COTTI COFFEE)')
  + ',companyName:' + q('库迪咖啡（天津）有限公司')
  + ',summary:' + q('由瑞幸咖啡创始团队于 2022 年创立，六休一（月休 4 天）{站长核实}。')
  + ',keyProducts:[' + q('现磨咖啡') + ',' + q('9.9 元系列') + ']'
  + ',searchKeywords:[' + q('库迪') + ',' + q('咖啡') + ',' + q('COTTI') + ']}',
  '{id:' + q('starbucks-coffee') + ',name:' + q('Starbucks (星巴克中国)')
  + ',companyName:' + q('上海星巴克咖啡经营有限公司')
  + ',summary:' + q('外企标准双休 965。')
  + ',keyProducts:[' + q('美式') + ']'
  + ',searchKeywords:[' + q('星巴克') + ',' + q('咖啡') + ']}',
  '{id:' + q('virtual-bakery') + ',name:' + q('某代工烘焙食品 (虚拟对比黑榜)')
  + ',companyName:' + q('某代工烘焙食品有限公司')
  + ',summary:' + q('虚拟对比样本，与瑞幸咖啡无任何关系。')
  + ',keyProducts:[' + q('烘焙') + ']'
  + ',searchKeywords:[' + q('烘焙') + ']}'
].join(',') + ']';

/* ---------------------------------------------------------------- DOM 基建 */
function mkDom(opts) {
  opts = opts || {};
  const html = '<!DOCTYPE html><html><head></head><body>'
    + '<div id="root">'
    + '<input id="site-search-input" type="text" value="' + (opts.inputValue || '') + '" />'
    // 卡片文本只放「页面上看得见的」内容（名称/公司名/产品标签），
    // 不放 summary —— 与线上真实 DOM 一致：summary 命中是 bundle 过滤
    // 层的事，卡片本身不显示 summary 全文。
    + '<div class="bg-white rounded-2xl border" id="card-luckin">'
    + '瑞幸咖啡 (Luckin Coffee) 瑞幸咖啡（中国）有限公司 生椰拿铁</div>'
    + '<div class="bg-white rounded-2xl border" id="card-cotti">'
    + '库迪咖啡 (COTTI COFFEE) 库迪咖啡（天津）有限公司 现磨咖啡</div>'
    + '<div class="bg-white rounded-2xl border" id="card-sbux">'
    + 'Starbucks (星巴克中国) 上海星巴克咖啡经营有限公司 美式</div>'
    + '<div class="bg-white rounded-2xl border" id="card-black">'
    + '某代工烘焙食品 (虚拟对比黑榜) 某代工烘焙食品有限公司 烘焙</div>'
    + '<div class="bg-white rounded-2xl border" id="card-unknown">没有品牌名的一个容器</div>'
    + '</div>'
    + '<script src="./assets/index-YthXZ9eP.js"></script>'
    + '</body></html>';
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/shuangxiugou/' });
  const w = dom.window;
  if (opts.fetch) w.fetch = opts.fetch;
  if (opts.pinyinIndex) w.__PINYIN_INDEX__ = opts.pinyinIndex;
  w.eval(PATCH_SRC);
  return w;
}

// 等 ensureFields 落地（桩 fetch 是同步 resolve，但 promise 链要几个微任务）
async function mkReady(opts) {
  const w = mkDom(opts);
  await w.__SXGSearchScopeFix.ensureFields();
  return w;
}

const HIDDEN = (w, id) => w.document.getElementById(id).classList.contains('sxg-scope-hidden');
const MSG = (w) => w.document.getElementById('site-search-input');

/* ================================================================ ① 提取器 */
console.log('\n① 提取器：从压缩文本提取强字段');
(function () {
  // extractFields 挂在导出对象上（不依赖 fieldsCache / DOM），可直接测
  const w = mkDom({ fetch: () => Promise.resolve({ ok: true, text: () => Promise.resolve(FAKE_BUNDLE) }) });
  const got = w.__SXGSearchScopeFix.extractFields(FAKE_BUNDLE);
  check('提取出 4 个品牌', got.length === 4, got.map((b) => b.name));
  const luckin = got.find((b) => b.name === '瑞幸咖啡 (Luckin Coffee)');
  check('瑞幸：name 入强字段', luckin.fields.indexOf('瑞幸咖啡 (Luckin Coffee)') !== -1);
  check('瑞幸：companyName 入强字段', luckin.fields.indexOf('瑞幸咖啡（中国）有限公司') !== -1);
  check('瑞幸：searchKeywords 入强字段', luckin.fields.indexOf('咖啡') !== -1);
  check('瑞幸：keyProducts 入强字段', luckin.fields.indexOf('生椰拿铁') !== -1);
  check('瑞幸：id 入强字段', luckin.fields.indexOf('luckin') !== -1);
  check('瑞幸：summary 不进强字段（这是修正的核心）',
    luckin.fields.every((f) => f.indexOf('真实双休率') === -1));
  check('模板字符串里的 { } 没有炸掉配平（库迪 summary 带 {站长核实}）',
    got.some((b) => b.name === '库迪咖啡 (COTTI COFFEE)'));
})();

/* ================================================================ ② 核心 bug */
console.log('\n② 核心 bug：搜「瑞幸咖啡」不该出库迪');
(async function () {
  const w = await mkReady({ fetch: () => Promise.resolve({ ok: true, text: () => Promise.resolve(FAKE_BUNDLE) }) });
  w.__SXGSearchScopeFix.applyScope('瑞幸咖啡');
  check('瑞幸卡保留（name 强命中）', HIDDEN(w, 'card-luckin') === false);
  check('库迪卡收起（仅 summary 命中）', HIDDEN(w, 'card-cotti') === true);
  check('星巴克卡保留（searchKeywords「咖啡」？—— 不含「瑞幸咖啡」，应为收起）',
    HIDDEN(w, 'card-sbux') === true, HIDDEN(w, 'card-sbux'));
  check('黑榜卡不动（与 stat-filter 口径一致）', HIDDEN(w, 'card-black') === false);
  check('识别不了的容器不动', HIDDEN(w, 'card-unknown') === false);

  /* ③ 强命中不误伤 */
  w.__SXGSearchScopeFix.applyScope('咖啡');
  check('搜「咖啡」：瑞幸显示（searchKeywords 强命中）', HIDDEN(w, 'card-luckin') === false);
  check('搜「咖啡」：库迪显示（name 含「咖啡」强命中）', HIDDEN(w, 'card-cotti') === false);
  check('搜「咖啡」：星巴克显示', HIDDEN(w, 'card-sbux') === false);

  w.__SXGSearchScopeFix.applyScope('现磨咖啡');
  check('搜「现磨咖啡」：库迪显示（keyProducts 强命中，不是误伤）', HIDDEN(w, 'card-cotti') === false);

  w.__SXGSearchScopeFix.applyScope('cotti');
  check('搜「cotti」：库迪显示（id/别名强命中）', HIDDEN(w, 'card-cotti') === false);

  w.__SXGSearchScopeFix.applyScope('瑞幸');
  check('搜「瑞幸」：瑞幸显示、库迪收起（summary 是「瑞幸咖啡」子串无关）',
    HIDDEN(w, 'card-luckin') === false && HIDDEN(w, 'card-cotti') === true);

  /* ④ summary 兜底 */
  w.__SXGSearchScopeFix.applyScope('六休一');
  check('搜「六休一」：强字段零命中 → summary 兜底全显示（不空结果）',
    HIDDEN(w, 'card-luckin') === false && HIDDEN(w, 'card-cotti') === false
    && HIDDEN(w, 'card-sbux') === false && HIDDEN(w, 'card-black') === false);

  /* ⑤ 恢复与幂等 */
  w.__SXGSearchScopeFix.applyScope('');
  check('空搜索 → 全部恢复', HIDDEN(w, 'card-luckin') === false && HIDDEN(w, 'card-cotti') === false);
  w.__SXGSearchScopeFix.applyScope('瑞幸咖啡');
  w.__SXGSearchScopeFix.applyScope('瑞幸咖啡');
  check('重复 applyScope 幂等（连打两次结果一致）',
    HIDDEN(w, 'card-cotti') === true && HIDDEN(w, 'card-luckin') === false);

  /* ⑥ !important 样式（与 stat-filter 的 inline display 共存） */
  const style = w.document.getElementById('sxg-scope-fix-style');
  check('注入 !important 隐藏样式', !!style && style.textContent.indexOf('display:none !important') !== -1,
    style && style.textContent);
  // 模拟 stat-filter 之后把卡片 inline display 设回 ''，隐藏必须仍然有效
  w.document.getElementById('card-cotti').style.display = '';
  w.__SXGSearchScopeFix.applyScope('瑞幸咖啡');
  check('stat-filter 重设 inline display 后，class 隐藏仍生效（选择器语义）',
    w.document.getElementById('card-cotti').classList.contains('sxg-scope-hidden'));
})();

/* ================================================================ ⑦ input 自动触发 */
console.log('\n⑦ input 事件自动触发（不只靠手动调 applyScope）');
(async function () {
  const w = await mkReady({ fetch: () => Promise.resolve({ ok: true, text: () => Promise.resolve(FAKE_BUNDLE) }) });
  const input = w.document.getElementById('site-search-input');
  const setter = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value');
  setter.set.call(input, '瑞幸咖啡');
  input.dispatchEvent(new w.Event('input', { bubbles: true }));
  const ok = await until(() => HIDDEN(w, 'card-cotti'), 1000);
  check('输入「瑞幸咖啡」→ 自动收起库迪', ok, HIDDEN(w, 'card-cotti'));
  check('输入「瑞幸咖啡」→ 瑞幸仍显示', HIDDEN(w, 'card-luckin') === false);

  setter.set.call(input, '');
  input.dispatchEvent(new w.Event('input', { bubbles: true }));
  const ok2 = await until(() => !HIDDEN(w, 'card-cotti'), 1000);
  check('清空搜索 → 自动恢复', ok2);
})();

/* ================================================================ ⑧ 降级路径 */
console.log('\n⑧ fetch 失败 → 降级拼音索引，不崩且仍修正');
(async function () {
  const pinyinIndex = [
    { id: 'luckin', name: '瑞幸咖啡 (Luckin Coffee)', cn: '瑞幸咖啡', custom: 0,
      t: [['瑞幸咖啡', 'ruixingkafei', 'rxkf', 0], ['瑞幸', 'ruixing', 'rx', 3], ['咖啡', 'kafei', 'kf', 3]] },
    { id: 'cotti', name: '库迪咖啡 (COTTI COFFEE)', cn: '库迪咖啡', custom: 0,
      t: [['库迪咖啡', 'kudikafei', 'kdkf', 0], ['咖啡', 'kafei', 'kf', 3], ['现磨咖啡', 'xianmokafei', 'xmkf', 4]] }
  ];
  const w = await mkReady({
    fetch: () => Promise.reject(new Error('offline')),
    pinyinIndex: pinyinIndex
  });
  w.__SXGSearchScopeFix.applyScope('瑞幸咖啡');
  check('降级后仍修正：库迪收起', HIDDEN(w, 'card-cotti') === true);
  check('降级后仍修正：瑞幸保留', HIDDEN(w, 'card-luckin') === false);
  w.__SXGSearchScopeFix.applyScope('咖啡');
  check('降级后搜「咖啡」不误伤', HIDDEN(w, 'card-cotti') === false);
})();

/* ================================================================ ⑨ 搜索容器防护栏（2026-10-25 bug） */
console.log('\n⑨ 搜索容器防护栏：含输入框的容器永远不被口径判定隐藏');
(async function () {
  // 复刻线上 DOM 结构（无头 Edge 复现的真实拓扑）：
  // 搜索容器 div.bg-white.p-4.rounded-2xl.border 内含 #site-search-input、
  // 残留联想框（内容「BYD (比亚迪)」）、品类/评级筛选按钮。
  // IME 组合中间态 q='a' 时：容器 text 含「比亚迪」→ findBrandFor 命中
  // BYD → BYD 强字段全无字母 a → 判弱命中；其他卡（如 Starbucks）强命中
  // → strongCount>0 → 容器被加 HIDE_CLASS，搜索框整片消失。
  //
  // ⚠️ BYD 必须在 bundle 数据里：它是 findBrandFor 在容器上命中的前提，
  //    缺了它容器会被当成「识别不了的卡」跳过，注入防护栏删除
  //    也照样绿——救绿形态：断言被「数据里根本没有该品牌」救活
  //    （2026-10-25 注入实测抓到）。
  const BYD_BUNDLE = FAKE_BUNDLE.slice(0, -1) + ','
    + '{id:' + q('byd') + ',name:' + q('BYD (比亚迪)')
    + ',companyName:' + q('比亚迪股份有限公司')
    + ',summary:' + q('新能源车龙头。')
    + ',keyProducts:[' + q('电动车') + ']'
    + ',searchKeywords:[' + q('比亚迪') + ',' + q('BYD') + ']}'
    + ']';
  const html = '<!DOCTYPE html><html><head></head><body><div id="root">'
    // 品牌卡（对照组：必须照常参与判定）
    + '<div class="bg-white rounded-2xl border" id="card-luckin">'
    + '瑞幸咖啡 (Luckin Coffee) 瑞幸咖啡（中国）有限公司 生椰拿铁</div>'
    + '<div class="bg-white rounded-2xl border" id="card-sbux">'
    + 'Starbucks (星巴克中国) 上海星巴克咖啡经营有限公司 美式</div>'
    // 搜索容器（与线上同 class 签名：bg-white p-4 rounded-2xl border）
    + '<div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-4" id="search-cont">'
    + '<div class="relative">'
    + '<input id="site-search-input" type="text" value="" />'
    + '<div id="pinyin-suggest" style="display:none">'
    + '拼音联想 · 点选或按 Enter 回填BYD (比亚迪)「比亚迪股份有限公司」名称匹配</div>'
    + '</div>'
    + '<div class="flex flex-wrap"><button>全部</button><button>数码外设</button></div>'
    + '<div class="flex flex-wrap"><button>全部评级</button><button>S 级</button></div>'
    + '</div>'
    + '</div>'
    // bundleUrl() 靠 script[src*=index-YthXZ9eP] 定位 bundle；
    // 缺了它 ensureFields 拿不到 URL，fieldsCache 空、口径判定全跳过
    + '<script src="./assets/index-YthXZ9eP.js"></script>'
    + '</body></html>';
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/shuangxiugou/' });
  const w = dom.window;
  w.fetch = () => Promise.resolve({ ok: true, text: () => Promise.resolve(BYD_BUNDLE) });
  w.eval(PATCH_SRC);
  await w.__SXGSearchScopeFix.ensureFields();

  const cont = w.document.getElementById('search-cont');
  check('isSearchContainer 认得搜索容器', w.__SXGSearchScopeFix.isSearchContainer(cont) === true);
  check('isSearchContainer 不认错品牌卡', w.__SXGSearchScopeFix.isSearchContainer(w.document.getElementById('card-luckin')) === false);

  // bug 场景：q='a'（IME 组合中间态）——Starbucks 强命中（名字含 a），
  // 搜索容器含「比亚迪」被误判弱命中
  w.__SXGSearchScopeFix.applyScope('a');
  check('q=a：搜索容器不被隐藏（bug 修复点）', cont.classList.contains('sxg-scope-hidden') === false,
    cont.className);
  check('q=a：强字段无 a 的瑞幸卡照常收起（口径修正仍工作）',
    w.document.getElementById('card-luckin').classList.contains('sxg-scope-hidden') === true);
  check('q=a：强字段含 a 的星巴克卡照常显示（口径修正仍工作）',
    w.document.getElementById('card-sbux').classList.contains('sxg-scope-hidden') === false);

  // 常规查询也必须不误伤容器
  w.__SXGSearchScopeFix.applyScope('瑞幸咖啡');
  check('q=瑞幸咖啡：搜索容器不被隐藏', cont.classList.contains('sxg-scope-hidden') === false);

  // 空搜索恢复
  w.__SXGSearchScopeFix.applyScope('');
  check('空搜索：容器无隐藏 class（全清）', cont.classList.contains('sxg-scope-hidden') === false);
})();

/* ---------------------------------------------------------------- 汇总 */
setTimeout(function () {
  console.log('\n========== 结果：' + passed + ' 项通过，' + failed + ' 项失败 ==========');
  process.exit(failed ? 1 : 0);
}, 3000);
