// ============================================================
// 搜索框清空后卡片顺序残留修复
//
// 现象（站长 2026-11-06 报障）：
//   中文输入法（IME）在搜索框输入「小米」后清空，企业卡片列表的顺序会
//   残留错乱（首屏不再是默认的 Patagonia 序，而是某种与搜索词相关的残留序），
//   总卡数仍是全量、无报错。
//
// 根因：
//   bundle 在 IME 路径下，搜索框「有词」→「空」时排序 state 未复位，
//   且有一个延迟 effect（约数百 ms）会用这份残留 state 重新排列表。
//   DOM 层无法改 bundle 内部 state，一次性触发 / DOM 重排都会被该
//   延迟 effect 二次覆盖，因此必须在「干净状态」下让 effect 重新跑一遍。
//
// 修复（不依赖 composition 事件，检测真实残留现象）：
//   1. 缓存首次加载的卡片顺序作为基准（baseline）。
//   2. 搜索框每输入一次非空词，记录为 data-scof-last（最近搜过的词）。
//   3. 当搜索框变为空且当前卡片顺序偏离 baseline（说明残留）时，
//      用原生 setter（非 IME 路径）回放「最近词 → 空」完整转换：
//      先回填最近词触发 React 进入干净的「非空」态（延迟 effect 在此态
//      用正确排序跑完），再延时清空触发干净的「空」态（延迟 effect 在
//      干净态跑完），顺序复位为默认序。
//
//   代价：清空瞬间会闪现约 1.2s 的「最近搜过的词」搜索结果，随后回到全量。
//   这是目前不碰 bundle 红线前提下唯一能稳定复位顺序的方案。
//
// 与 filter-flash.js 的契约（2026-11-07）：
//   filter-flash.js 在 document 捕获阶段监听 input 的「非空 → 空」边沿，
//   据此放 0.5s 磨砂遮罩。若本脚本回放的第二次合成清空被当成真实清空，
//   会在 1.2s 后多闪一次并打断「500ms 自动撤除」契约
//   （scripts/test-search-clear-render.cjs 曾稳定判红）。因此两次回放事件
//   都带 __sxgScofReplay 标记，flash 侧显式跳过。两侧必须同改，勿单侧删除。
// ============================================================
(function () {
  'use strict';

  var SEARCH_ID = 'site-search-input';
  var RESET_DELAY = 1200; // 略大于典型 debounce，确保「非空」态的延迟 effect 跑完（v4 同值验证可复位）

  var baseline = null;    // 首次加载的卡片顺序（基准）
  var fixing = false;     // 防重入：修复过程里自己触发的 input 不再处理

  function cardTitles() {
    return [].slice.call(document.querySelectorAll('div.bg-white.rounded-2xl.border'))
      .filter(function (c) { return c.offsetParent !== null; })
      .map(function (c) {
        var h = c.querySelector('h3') || c.querySelector('h2') || c.querySelector('.font-bold');
        return h ? h.textContent.trim() : '';
      });
  }
  function sameOrder(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  function valueSetter() {
    return Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  }

  // 回放用的合成 input 事件：打标记让 filter-flash.js 跳过，避免额外闪屏
  function replayInput(inp) {
    var ev = new Event('input', { bubbles: true });
    ev.__sxgScofReplay = true;
    inp.dispatchEvent(ev);
  }

  function captureBaseline() {
    if (baseline) return;
    var o = cardTitles();
    if (o.length > 10) baseline = o; // 等卡片全量加载后再取基准
  }

  function bind(inp) {
    if (!inp || inp.dataset.scofBound === '1') return;
    inp.dataset.scofBound = '1';

    // 页面全量加载后取一次基准顺序
    captureBaseline();

    inp.addEventListener('input', function () {
      if (fixing) return;
      captureBaseline();
      if (inp.value) {
        inp.setAttribute('data-scof-last', inp.value);
        return;
      }
      // 搜索框为空：若顺序偏离基准，说明残留，回放「最近词 → 空」复位
      if (!baseline) return;
      var now = cardTitles();
      if (sameOrder(now, baseline)) return; // 正常空态，无需修复
      var word = inp.getAttribute('data-scof-last') || '';
      if (!word) return;
      fixing = true;
      // 必须在事件栈外执行回放：事件处理函数内同步 dispatch 的 input 会被 React 合并忽略
      setTimeout(function () {
        var s = valueSetter();
        s.call(inp, word);                     // 第一步：非 IME 路径回填最近词
        replayInput(inp);
        setTimeout(function () {               // 等「非空」态的延迟 effect 跑完
          s.call(inp, '');                     // 第二步：干净的「空」态
          replayInput(inp);
          fixing = false;
        }, RESET_DELAY);
      }, 0);
    });
  }

  // 轮询挂载（bundle 是 type=module，搜索框晚于本脚本渲染）
  var tries = 0;
  var timer = setInterval(function () {
    var inp = document.getElementById(SEARCH_ID);
    if (inp) { bind(inp); clearInterval(timer); }
    else if (++tries > 80) clearInterval(timer);
  }, 250);

  // 切 tab 时搜索框会被 React 重挂载，重新绑定；load 后补抓基准
  var root = document.getElementById('root') || document.body;
  if (root && typeof MutationObserver !== 'undefined') {
    new MutationObserver(function () {
      var inp = document.getElementById(SEARCH_ID);
      if (inp) bind(inp);
    }).observe(root, { childList: true, subtree: true });
  }
  window.addEventListener('load', function () { setTimeout(captureBaseline, 3000); });
})();
