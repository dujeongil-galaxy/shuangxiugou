// 内置卡小票金额的端到端 DOM 测试
// 跑法：npm install --no-save jsdom && node scripts/test-builtin-ticket-dom.cjs
//
// ⚠️ 这个文件存在的唯一理由：
//   上一版「小票金额改累计」只写了源码字符串断言就推送上线，
//   而那些断言检查的是「代码里有没有这个字符串」，
//   不是「真实 DOM 能不能被定位到」。实际上内置小票的金额标签
//   根本不是「已转移/支持消费:」，定位恒为 null，界面纹丝不动。
//   用户实测发现并批评。所以这里必须做真 DOM 端到端验证。
//
// 本测试的两段证据链，缺一不可：
//   1. 从压缩包源码里抠出内置小票真实使用的标签文案
//      （防止 bundle 升级后标签变了、定位逻辑悄悄失效）
//   2. 用这些真实文案搭一个与 bundle 结构一致的 DOM，
//      在 jsdom 里真跑 custom-card-actions.js，断言纸面金额被改写
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'custom-card-actions.js'), 'utf8');
const BUNDLE = fs.readFileSync(
  path.join(ROOT, 'assets', 'index-YthXZ9eP.js'), 'utf8');

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
// 第 1 段：压缩包里的真实文案
// =====================================================================
console.log('=== 1. 压缩包里内置小票的真实标签 ===');

// 纸面金额标签按是否违规避雷二选一，两个都要在
check('压缩包含「转移撤销消费金额:」',
  BUNDLE.includes('转移撤销消费金额:'));
check('压缩包含「注入良心企业预算:」',
  BUNDLE.includes('注入良心企业预算:'));
check('压缩包含「本次投票消费金额:」（bundle 自带输入行的标签）',
  BUNDLE.includes('本次投票消费金额:'));
check('压缩包含「考核执行官:」', BUNDLE.includes('考核执行官:'));
check('压缩包含「工时健康评级:」', BUNDLE.includes('工时健康评级:'));

// 关键否定断言：「已转移/支持消费」只在复制文本模板里，不在纸面 DOM 上。
const consumedIdx = BUNDLE.indexOf('已转移/支持消费');
const receiptStart = BUNDLE.indexOf('receipt-tear-top');
const receiptEnd = BUNDLE.indexOf('本次投票消费金额:');
check('「已转移/支持消费」确实存在于压缩包（复制文本用）',
  consumedIdx !== -1);
check('「已转移/支持消费」不在小票纸面渲染区间内',
  consumedIdx < receiptStart || consumedIdx > receiptEnd,
  { consumedIdx, receiptStart, receiptEnd });
check('内置卡不再用「已转移/支持消费」做纸面定位',
  !/findValueNode\(\s*receipt\s*,\s*'已转移\/支持消费/.test(SRC));

// 纸面金额是 span 而非 input —— 决定必须用 textContent 改写
const amountZone = BUNDLE.slice(receiptStart, receiptEnd);
check('纸面金额值是 span（不是 input）',
  amountZone.includes('text-xl font-black font-mono'));

// =====================================================================
// 第 2 段：真 DOM 端到端
// =====================================================================

// 搭一个与 bundle 渲染结果结构一致的 DOM。
// 结构来源是压缩包里那段 JSX 的 className 与 children 顺序，逐条照抄。
function buildReceiptDom(opts) {
  const tier = opts.tier || 'S';
  const amountLabel = opts.violation ? '转移撤销消费金额:' : '注入良心企业预算:';
  const sign = opts.violation ? '-' : '+';
  return `
<div id="root" class="max-w-sm">
  <div class="receipt-tear-top receipt-tear-bottom bg-[#faf8f5] p-6">
    <div class="py-4 space-y-2 text-xs">
      <div class="flex justify-between items-start">
        <span class="text-slate-500">考核执行官:</span>
        <span class="font-bold text-slate-800">清醒打工人 #7709</span>
      </div>
      <div class="flex justify-between items-start gap-2">
        <span class="text-slate-500 whitespace-nowrap">考核品牌:</span>
        <span class="font-bold text-slate-900 text-right truncate max-w-[180px]">${opts.brand || '测试品牌'}</span>
      </div>
      <div class="flex justify-between items-center pt-1">
        <span class="text-slate-500">工时健康评级:</span>
        <span class="font-black px-1.5 py-0.5 rounded text-xs bg-emerald-100 text-emerald-800">${tier} 级 · 双休</span>
      </div>
    </div>
    <div class="py-4 space-y-2 text-xs">
      <div class="flex justify-between items-baseline">
        <span class="text-slate-600 font-semibold">${amountLabel}</span>
        <span class="text-xl font-black font-mono ${opts.violation ? 'text-rose-600' : 'text-emerald-700'}">${sign} ¥ 199</span>
      </div>
    </div>
  </div>
  <div class="bg-white/95 rounded-2xl p-4">
    <div class="flex items-center justify-between text-xs">
      <span class="text-slate-500 font-medium">本次投票消费金额:</span>
      <div class="flex items-center gap-1.5">
        <span class="text-slate-400">¥</span>
        <input type="number" value="199" class="w-24 bg-slate-100" />
      </div>
    </div>
    <div class="grid grid-cols-2 gap-2">
      <button><span>复制文本</span></button>
      <button><span>保存高清图</span></button>
    </div>
    <button><span>确认打卡并计入全网总额</span></button>
  </div>
</div>`;
}

// 从真实源码里抠出要测的函数，避免测一份「行为应该一样」的副本。
function extractFn(name) {
  const re = new RegExp(
    'function\\s+' + name + '\\s*\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n  \\}'
  );
  const m = SRC.match(re);
  if (!m) throw new Error('抠不出函数 ' + name);
  return m[0];
}

const harnessSrc = [
  // 2026-10-17 回归测试需要：syncBuiltin 引用的模块级状态与存档桩。
  // builtinAnonId 用固定值，断言「同一次弹窗内 #号稳定」才可复现。
  'var builtinPreview = null;',
  'var builtinBrandPreview = null;',
  'var builtinAnonId = 7163;',
  'function loadProfile(){ return { name: "", total: 0, lastDelta: 0, reason: "" }; }',
  'var MAX_TOTAL = 99999999;',
  // 2026-10-22 起金额支持两位小数，桩必须与真代码同语义，
  // 否则测的是被改掉的旧行为（假测试比没测试更危险）。
  'function round2(n){ return Math.round(n*100)/100; }',
  'function fmtMoney(n){ return round2(n).toFixed(2); }',
  'function clampTotal(v){var n=parseFloat(v); if(isNaN(n)||n<0) n=0;',
  '  return Math.min(round2(n), MAX_TOTAL);}',
  'function clampDelta(v){var s=String(v==null?"":v).trim(); if(!s) return 0;',
  '  var n=parseFloat(s); if(isNaN(n)||n<=0) return 0;',
  '  return Math.min(round2(n), MAX_TOTAL);}',
  'function migrateLegacy(p){p=p||{};',
  '  if(typeof p.total==="number"&&isFinite(p.total)) return p;',
  '  if(typeof p.amount==="number"&&isFinite(p.amount)&&p.amount>0)',
  '    return {name:p.name,total:Math.min(round2(p.amount),MAX_TOTAL),lastDelta:0,reason:p.reason};',
  '  return p;}',
  extractFn('displayName'),
  'function $(sel,root){return (root||document).querySelector(sel);}',
  'function $$(sel,root){return Array.prototype.slice.call((root||document).querySelectorAll(sel));}',
  'function el(tag,cls,html){var n=document.createElement(tag); if(cls)n.className=cls;',
  '  if(html!=null)n.innerHTML=html; return n;}',
  'function diag(m){ if(window.__diag) window.__diag.push(m); }',
  // 被测函数依赖的模块级常量，必须一并带上
  extractFn('findValueNode'),
  extractFn('findLabelNode'),
  extractFn('findBuiltinAmountSpan'),
  extractFn('paintBuiltinAmount'),
  extractFn('paintBuiltinName'),
  extractFn('paintBuiltinBrandRow'),
  extractFn('hideBuiltinAmountInput'),
  extractFn('paintBuiltinReason'),
  extractFn('syncBuiltin'),
].join('\n') + `
var AMOUNT_LABELS = ['转移撤销消费金额:', '注入良心企业预算:'];
var RATING_LABEL = '工时健康评级:';
var BUILTIN_INPUT_LABEL = '本次投票消费金额:';
var TOTAL_LABEL = '全站累计已转移/支持消费:';`;

// 装一个含真实 DOM + 真实定位逻辑的环境
function mount(opts, storageData) {
  const dom = new JSDOM(
    `<!DOCTYPE html><html><body>${buildReceiptDom(opts || {})}</body></html>`,
    { runScripts: 'outside-only', pretendToBeVisual: true }
  );
  const w = dom.window;
  const data = Object.assign({}, storageData || {});
  w.localStorage = {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: (k) => { delete data[k]; },
  };
  w.__diag = [];
  const fn = new Function('window', 'document', harnessSrc
    + '\nreturn {findValueNode,findLabelNode,findBuiltinAmountSpan,'
    + 'paintBuiltinAmount,paintBuiltinName,paintBuiltinBrandRow,hideBuiltinAmountInput,paintBuiltinReason,syncBuiltin};');
  const api = fn(w, w.document);
  api.window = w;
  api.storage = data;
  api.receipt = w.document.querySelector('.receipt-tear-top');
  return api;
}

// 抓纸面金额值节点的文本
function paperAmount(E) {
  const spans = E.receipt.querySelectorAll('span');
  for (const s of spans) {
    if ((s.className || '').indexOf('font-black font-mono') !== -1) {
      return (s.textContent || '').trim();
    }
  }
  return null;
}
function paperAmountLabel(E) {
  const spans = E.receipt.querySelectorAll('span');
  for (const s of spans) {
    const t = (s.textContent || '').trim();
    if (t === '转移撤销消费金额:' || t === '注入良心企业预算:'
        || t === '累计已转移/支持消费:' || t === '全站累计已转移/支持消费:') return t;
  }
  return null;
}

console.log('\n=== 2. 纸面金额定位（合规企业）===');
{
  const E = mount({ violation: false });
  const span = E.findBuiltinAmountSpan(E.receipt);
  check('能定位到合规企业的金额行', !!span);
  check('定位到的就是那个 span', span && span.tagName === 'SPAN');
  check('改写前文本是 bundle 写死的「+ ¥ 199」', paperAmount(E) === '+ ¥ 199',
    paperAmount(E));

  E.paintBuiltinAmount(E.receipt, 498);
  check('改写后纸面显示 ￥498.00（两位小数）', paperAmount(E) === '￥498.00', paperAmount(E));
  check('标签已改为「全站累计已转移/支持消费:」',
    paperAmountLabel(E) === '全站累计已转移/支持消费:', paperAmountLabel(E));
}

console.log('\n=== 3. 纸面金额定位（违规避雷企业，标签是另一个）===');
{
  const E = mount({ violation: true });
  check('违规小票也能定位到金额行', !!E.findBuiltinAmountSpan(E.receipt));
  check('改写前是「- ¥ 199」', paperAmount(E) === '- ¥ 199', paperAmount(E));
  E.paintBuiltinAmount(E.receipt, 498);
  check('违规小票改写后显示 ￥498.00（两位小数）', paperAmount(E) === '￥498.00', paperAmount(E));
  check('违规小票标签也被改掉',
    paperAmountLabel(E) === '全站累计已转移/支持消费:', paperAmountLabel(E));
}

console.log('\n=== 4. 幂等：重复重绘不会让 observer 自激 ===');
{
  const E = mount({ violation: false });
  E.paintBuiltinAmount(E.receipt, 498);
  const first = paperAmount(E);
  E.paintBuiltinAmount(E.receipt, 498);
  E.paintBuiltinAmount(E.receipt, 498);
  check('重复重绘文本不变', paperAmount(E) === first, paperAmount(E));

  // 若实现是无条件写入，第二次 textContent 赋值仍会触发 MutationObserver，
  // 这里用 MutationObserver 实际计数来兜住这个回归
  const w = E.window;
  let mutations = 0;
  const mo = new w.MutationObserver((recs) => {
    mutations += recs.length;
  });
  mo.observe(E.receipt, { childList: true, subtree: true, characterData: true });
  E.paintBuiltinAmount(E.receipt, 498);
  E.paintBuiltinAmount(E.receipt, 498);
  return (async () => {
    await new Promise((r) => setTimeout(r, 30));
    check('同值重绘不产生 DOM 变更（observer 不会自激）', mutations === 0, mutations);

    console.log('\n=== 5. 隐藏 bundle 自带金额输入行 ===');
    const E2 = mount({ violation: false });
    const hidden = E2.hideBuiltinAmountInput(E2.window.document);
    check('能定位并隐藏「本次投票消费金额」行', hidden);
    const label = E2.window.document.querySelector('span');
    const spans = E2.window.document.querySelectorAll('span');
    let row = null;
    for (const s of spans) {
      if ((s.textContent || '').trim() === '本次投票消费金额:') {
        row = s.closest('.flex.items-center.justify-between') || s.parentNode;
      }
    }
    check('该行 display 被置为 none', row && row.style.display === 'none',
      row && row.style.display);
    check('隐藏标记只打一次（重复调用幂等）',
      E2.hideBuiltinAmountInput(E2.window.document) === true
      && row.getAttribute('data-sxg-hidden') === '1');
    check('隐藏后 bundle 那个 input 不再可见', !!row.querySelector('input'));

    console.log('\n=== 6. 理由行挂载位置 ===');
    const E3 = mount({ violation: false });
    E3.paintBuiltinReason(E3.receipt, '双休落实不错');
    const rrow = E3.receipt.querySelector('[data-sxg-reason]');
    check('理由行被插入', !!rrow);
    check('理由文本正确', rrow && rrow.lastChild.textContent === '双休落实不错',
      rrow && rrow.lastChild.textContent);
    const children = Array.prototype.slice.call(E3.receipt.children[0].children);
    const ratingIdx = children.findIndex((n) =>
      (n.textContent || '').indexOf('工时健康评级') !== -1);
    const reasonIdx = children.indexOf(rrow);
    check('理由行紧跟在「工时健康评级」所在分组之后',
      reasonIdx === ratingIdx + 1, { ratingIdx, reasonIdx });

    // 清空理由应移除该行
    E3.paintBuiltinReason(E3.receipt, '');
    check('清空理由后该行被移除',
      !E3.receipt.querySelector('[data-sxg-reason]'));

    console.log('\n=== 7. 找不到金额行时必须出声（不许静默失败）===');
    {
      const dom = new JSDOM(
        '<!DOCTYPE html><html><body><div id="root"></div></body></html>',
        { runScripts: 'outside-only', pretendToBeVisual: true });
      const w = dom.window;
      w.__diag = [];
      const fn = new Function('window', 'document', harnessSrc
        + '\nreturn {findBuiltinAmountSpan,paintBuiltinAmount};');
      const api = fn(w, w.document);
      const root = w.document.getElementById('root');
      const ok = api.paintBuiltinAmount(root, 498);
      check('空 DOM 下 paintBuiltinAmount 返回 false（供上层报警）',
        ok === false, ok);
      check('源码里有「未找到金额行」的告警文案',
        SRC.includes('内置小票未找到金额行'));
    }

    console.log('\n=== 8. 署名行 #号不得自激滚动（2026-10-17 回归）===');
    {
      const E5 = mount({ violation: false });
      E5.syncBuiltin(E5.receipt);
      const nameEl = E5.receipt.querySelector('#sxg-t-name');
      check('syncBuiltin 把署名行改成「匿名打工人 #编号」',
        !!nameEl && /^匿名打工人 #\d+$/.test((nameEl.textContent || '').trim()),
        nameEl && nameEl.textContent);
      const first = (nameEl.textContent || '').trim();
      const w5 = E5.window;
      let nameMutations = 0;
      const mo5 = new w5.MutationObserver((recs) => { nameMutations += recs.length; });
      mo5.observe(E5.receipt, { childList: true, subtree: true, characterData: true });
      E5.syncBuiltin(E5.receipt);
      E5.syncBuiltin(E5.receipt);
      check('重复 sync 后署名不变（同一次弹窗内 #号稳定）',
        (nameEl.textContent || '').trim() === first,
        (nameEl.textContent || '') + ' vs ' + first);
      await new Promise((r) => setTimeout(r, 30));
      check('署名行同值重绘不产生 DOM 变更（observer 不会自激）',
        nameMutations === 0, nameMutations);
    }

    console.log('\n=== 8b. 首次接管必须改写署名行（2026-10-22 站长截图 bug）===');
    {
      // 现象：昵称框输入「test」，小票上的「考核执行官」纹丝不动。
      // 根因：首次接管只画金额不画名字，署名 span 的 id 只在
      //       syncBuiltin（第二次进入）里才设，实时联动的
      //       $('#sxg-t-name') 首次进入时永远是 null → 静默跳过。
      const E7 = mount({ violation: false });
      const okName = E7.paintBuiltinName(E7.receipt, 'test');
      check('paintBuiltinName 能定位署名行并改写', okName === true, okName);
      const nameEl = E7.receipt.querySelector('#sxg-t-name');
      check('★ 首次接管后署名即显示访客输入（修复前输入毫无反应）',
        !!nameEl && (nameEl.textContent || '').trim() === 'test',
        nameEl && nameEl.textContent);

      // 没填昵称 → 稳定匿名编号（builtinAnonId 在 harness 里固定为 7163）
      E7.paintBuiltinName(E7.receipt, '');
      check('留空时回退到稳定匿名编号',
        (nameEl.textContent || '').trim() === '匿名打工人 #7163',
        nameEl.textContent);

      // 同值重绘不得产生 DOM 变更（observer 自激防线）。
      // ⚠️ 必须先把状态稳定到目标值再挂 observer：挂上后再从别的值改过来，
      //    那次「值变化」的合法写入会被计入，测的就不是幂等性了。
      E7.paintBuiltinName(E7.receipt, 'test');
      let nm = 0;
      const mo7 = new E7.window.MutationObserver((recs) => { nm += recs.length; });
      mo7.observe(E7.receipt, { childList: true, subtree: true, characterData: true });
      E7.paintBuiltinName(E7.receipt, 'test');
      E7.paintBuiltinName(E7.receipt, 'test');
      await new Promise((r) => setTimeout(r, 30));
      check('署名行同值重绘不产生 DOM 变更', nm === 0, nm);

      // 源码级防线：首次接管必须调用；实时联动必须按标签文字定位
      check('源码中首次接管调用 paintBuiltinName（不只画金额）',
        SRC.includes('var okName = paintBuiltinName'));
      check('实时联动按标签文字定位署名行，不依赖 id（React 重建后 id 会丢）',
        SRC.includes("var nameEl = findValueNode(receipt, '考核执行官:')"));

      // 空 DOM 下必须返回 false 供上层报警，不许静默失败
      const dom8 = new JSDOM(
        '<!DOCTYPE html><html><body><div id="root"></div></body></html>',
        { runScripts: 'outside-only', pretendToBeVisual: true });
      const w8 = dom8.window;
      const api8 = new Function('window', 'document', harnessSrc
        + '\nreturn {paintBuiltinName};')(w8, w8.document);
      check('空 DOM 下 paintBuiltinName 返回 false（供上层报警）',
        api8.paintBuiltinName(w8.document.getElementById('root'), 'x') === false);
    }

    console.log('\n=== 9. 本品牌累计行（2026-10-18 两级显示）===');
    {
      const E6 = mount({ violation: false });
      E6.paintBuiltinAmount(E6.receipt, 498);
      const ok = E6.paintBuiltinBrandRow(E6.receipt, '测试品牌', 66);
      check('本品牌行插入成功', ok);
      const row = E6.receipt.querySelector('[data-sxg-brand-row]');
      check('行存在且带 data 标记', !!row);
      check('标签为「本品牌累计:」',
        row.children[0].textContent === '本品牌累计:', row.children[0].textContent);
      check('值为 ￥66.00（两位小数）', row.children[1].textContent === '￥66.00', row.children[1].textContent);
      check('值节点带 id 供预览联动', !!E6.receipt.querySelector('#sxg-t-amount-brand'));
      const before = row.innerHTML;
      E6.paintBuiltinBrandRow(E6.receipt, '测试品牌', 66);
      check('同值重绘不改动 DOM（幂等）', row.innerHTML === before);
      E6.paintBuiltinBrandRow(E6.receipt, '测试品牌', 99);
      check('数值变化时更新为 ￥99.00', row.children[1].textContent === '￥99.00');
      check('本品牌行在「全站累计」行之前（上下行：本品牌在上）',
        row.nextSibling && (row.nextSibling.textContent || '').indexOf('全站累计') !== -1);
    }

    console.log('\n' + '='.repeat(54));
    console.log(`通过 ${pass} 项，失败 ${fail} 项`);
    if (fail) console.log('失败项：\n  - ' + failures.join('\n  - '));
    process.exit(fail ? 1 : 0);
  })();
}