/* ==========================================================================
   block-numeric-search.js
   --------------------------------------------------------------------------
   解决的问题：搜索框输入数字会莫名其妙搜出品牌卡片。

   真实表现（2026-10-17 用户截图）：
     输入「1」→ 命中宁德时代（其双休率 15%、年份 2011/2025 在summary 里）
     输入「2」→ 命中常州星宇股份、某代工烘焙食品、宁德时代

   根因：bundle 的搜索是**纯子串匹配**，条件为
     name / companyName / category / searchKeywords / keyProducts / summary / id
     任一 .includes(查询词) 即命中。
     而 summary 与 keyProducts 里大量含数字（年份、百分比、产品型号），
     所以单个数字「1」「2」几乎必然命中一堆卡片。

   为什么这个功能「不该有」：
     站内没有「按数字检索品牌」的需求。企业名、品牌名、产品名里
     真正含独立数字的极少，而统计值里的数字却遍地都是。
     输入单个数字得到一堆无关卡片，对用户毫无意义 —— 这是噪声不是功能。

   做法：**从输入层彻底拦住**，让数字进不了搜索状态。
     1) input 事件捕获阶段：若查询词含数字，直接阻止并清空联想框
     2) 更彻底：一旦输入了数字，把输入框内容清回上一个「纯文本」值
        —— 这样 React 那边根本收不到含数字的查询词，卡片自然不会被筛出
     3) 已经处于含数字状态时（例如粘贴进来的），进页面立即纠正

   为什么用注入层而不是改 bundle：
     bundle 是压缩产物，改它风险高；而且这个规则只跟「输入」有关，
     在输入层拦截更干净，也不受 React 重挂载影响。

   幂等：靠 dataset.sxgNumericBlocked 标记，只绑一次；
         本文件不新增任何 DOM 节点，重复执行无副作用。
   ========================================================================== */
(function () {
  'use strict';

  var MARK = 'sxgNumericBlocked';
  var DIGIT = /[0-9０-９]/;   // 含全角数字

  /* ---------------------------------------------------------- 工具 */

  function $(sel, root) { return (root || document).querySelector(sel); }

  function findInput() {
    return document.getElementById('site-search-input')
        || document.querySelector('main input[type="text"]');
  }

  /* 只保留「可搜的字符」：汉字、字母、空格、连字符、点号。
     数字连全角的一律剔除 —— 站内没有任何需要靠数字检索的字段。 */
  function stripDigits(s) {
    return String(s == null ? '' : s).replace(/[0-9０-９]/g, '');
  }

  function hasDigit(s) {
    return DIGIT.test(String(s == null ? '' : s));
  }

  /* React 受控输入：必须走原生 setter，React 才感知得到 */
  function setNativeValue(input, value) {
    var setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value');
    if (setter && setter.set) setter.set.call(input, value);
    else input.value = value;
  }

  /* 把输入框内容纠正成「无数字」版本。
     keepCaret 尽量把光标留在原位，避免文字跳动。 */
  function sanitize(input) {
    var raw = input.value;
    if (!hasDigit(raw)) return false;

    var cleaned = stripDigits(raw);
    var pos = input.selectionStart;
    // 光标之前有几个数字，就往前挪几个字符
    var before = raw.slice(0, pos);
    var newPos = Math.max(0, before.length - (before.length - stripDigits(before).length));

    setNativeValue(input, cleaned);
    try { input.setSelectionRange(newPos, newPos); } catch (e) { /* 某些输入框不支持 */ }

    // 必须再派发一次 input，让 React 的受控值与 DOM 同步。
    // 注意：本次事件里数字已被剔除，React 收到的是纯文本查询词，
    //       所以它不会把卡片筛出来。
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }

  function hideSuggest() {
    var box = document.getElementById('pinyin-suggest');
    if (box) box.style.display = 'none';
  }

  /* ---------------------------------------------------------- 绑定 */

  function bind() {
    var input = findInput();
    if (!input) return false;
    if (input.dataset[MARK] === '1') return true;
    input.dataset[MARK] = '1';

    // 捕获阶段：抢在 React 的 onChange 之前。
    // React 的事件委托挂在 #root 上（冒泡阶段），
    // 在 document 上用捕获 + stopPropagation 就能让它的 onChange 收不到数字。
    input.addEventListener('keydown', function (ev) {
      // 数字键、小键盘数字、带 Ctrl/Alt 的组合键 —— 直接吞掉。
      // 这里不阻止退格/方向键等编辑键，那些不含数字。
      var isDigitKey = /^Digit[0-9]$/.test(ev.code)
        || /^Numpad[0-9]$/.test(ev.code);
      if (isDigitKey) {
        ev.preventDefault();
        ev.stopPropagation();
        return;
      }
      // 粘贴 / 输入法上屏也可能带数字，统一交给下面的 input 处理
    }, true);

    input.addEventListener('beforeinput', function (ev) {
      if (ev.data && hasDigit(ev.data)) {
        ev.preventDefault();
        ev.stopPropagation();
      }
    }, true);

    input.addEventListener('input', function (ev) {
      if (!hasDigit(input.value)) return;
      // React 的受控值已经可能带着数字进来了，这里把它改回纯文本。
      ev.stopPropagation();
      sanitize(input);
      hideSuggest();
    }, true);

    // 纠正初始值（粘贴后直接刷新、或浏览器自动填充的情况）
    if (hasDigit(input.value)) sanitize(input);

    return true;
  }

  /* ---------------------------------------------------------- 启动 */

  function sweep() {
    try { bind(); } catch (e) { /* 注入层绝不影响页面 */ }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', sweep);
  } else {
    sweep();
  }
  setInterval(sweep, 1000);

  if (window.MutationObserver) {
    new MutationObserver(sweep).observe(document, { childList: true, subtree: true });
  }

  window.__sxgNumericBlock = {
    stripDigits: stripDigits,
    hasDigit: hasDigit,
    sanitize: sanitize
  };
})();