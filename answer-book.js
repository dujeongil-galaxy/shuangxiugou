// ============================================================
// 《答案之书》随机占位文案
//
// 做什么
// ------
// 把搜索框的 placeholder 从原来那句功能说明，换成每次刷新随机抽一条的
// 《答案之书》答案。原那句「消费前，先了解这个品牌是否双休；
// 用订单（消费力），反向考核企业」太长太重，压在搜索框里像广告语。
//
// 为什么走 DOM 层
// --------------
// placeholder 写死在压缩产物 assets/index-YthXZ9eP.js 里：
//   (0,A.jsx)(`input`,{type:`text`,
//     placeholder:`消费前，先了解这个品牌是否双休；用订单（消费力），反向考核企业`, ...})
// 手改压缩包是项目红线（多一个字符就可能白屏且控制台无报错）。
// 所以跟拼音搜索一样：等 React 渲染出来后，在 DOM 上覆盖属性。
//
// 与拼音搜索的关系
// ----------------
// 两个脚本绑同一个 input，但各写各的：拼音搜索挂联想框，
// 本脚本只写 placeholder。不碰对方的属性，事件互不干扰。
//
// ⚠️ React 重挂载会把 placeholder 冲回 bundle 的原值
//    （切换标签时 input 会被重新创建）。所以每次 bind 都要复核，
//    但不能每次都重抽 —— 否则用户点一下换的答案会被 observer 冲掉。
//    解法见 applyTo() 里的 lastPick 比对。
// ============================================================
(function () {
  'use strict';

  var BOOK = window.__ANSWER_BOOK__;
  if (!BOOK || !BOOK.length) return;

  function diag(msg) {
    if (window.console && console.warn) console.warn('[答案之书] ' + msg);
  }

  // ---------- 随机抽取 ----------
  function pick() {
    return BOOK[Math.floor(Math.random() * BOOK.length)];
  }

  // ---------- 覆盖一个 input 的 placeholder ----------
  // 返回 true 表示这个 input 已处理
  function applyTo(input) {
    if (!input || input.tagName !== 'INPUT') return false;
    if (input.type !== 'search' && input.type !== 'text') return false;

    if (input.dataset.answerBookBound !== '1') {
      input.dataset.answerBookBound = '1';
      // 首次接管：抽一条，并记住抽到的是哪条
      input.setAttribute('data-answer-book-pick', pick());
      input.setAttribute('placeholder', input.getAttribute('data-answer-book-pick'));

      // 点一下换一条。只在搜索框为空时换 ——
      // 用户正在打字时把 placeholder 换掉没有意义，也容易让人困惑。
      input.addEventListener('click', function () {
        if (input.value) return;
        var next = pick();
        input.setAttribute('data-answer-book-pick', next);
        input.setAttribute('placeholder', next);
      });
      return true;
    }

    // 已接管过：只有当 placeholder 被 React 冲回原值时才补写。
    // 这样「用户点出来的新答案」不会被 observer 覆盖成另一条，
    // 而「React 重挂载丢掉了」又能恢复。
    var want = input.getAttribute('data-answer-book-pick');
    if (want && input.getAttribute('placeholder') !== want) {
      input.setAttribute('placeholder', want);
    }
    return true;
  }

  // 定位搜索框。与 pinyin-search.js 用同一套选择器，
  // 保证两个脚本看到的是同一个元素。
  function findInputs() {
    var list = [];
    var byId = document.getElementById('site-search-input');
    if (byId) list.push(byId);
    var inMain = document.querySelectorAll('main input[type="text"]');
    for (var i = 0; i < inMain.length; i++) {
      if (list.indexOf(inMain[i]) === -1) list.push(inMain[i]);
    }
    return list;
  }

  function sweep() {
    var inputs = findInputs();
    var n = 0;
    for (var i = 0; i < inputs.length; i++) {
      if (applyTo(inputs[i])) n++;
    }
    return n;
  }

  // 1) 轮询：bundle 是 type=module，加载与渲染都晚于本脚本
  var tries = 0;
  var timer = setInterval(function () {
    if (sweep() > 0 || ++tries > 80) clearInterval(timer);
  }, 250);

  // 2) 观察 DOM：切到「企业真双休检索」标签时搜索框才挂载，
  //    React 重挂载后 placeholder 也要补回来
  function startObserver() {
    var root = document.getElementById('root') || document.body;
    if (!root || typeof MutationObserver === 'undefined') return;
    var scheduled = false;
    var mo = new MutationObserver(function () {
      if (scheduled) return;
      scheduled = true;
      // 用微批处理脱离 observer 回调栈，避免与 React 渲染互相干扰
      Promise.resolve().then(function () {
        scheduled = false;
        try { sweep(); } catch (e) {
          diag('sweep 抛异常 ' + e);
        }
      });
    });
    mo.observe(root, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startObserver);
  } else {
    startObserver();
  }

  window.addEventListener('popstate', function () { setTimeout(sweep, 300); });
  window.addEventListener('load', sweep);
})();