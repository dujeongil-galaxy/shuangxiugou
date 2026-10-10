/* ==========================================================================
   为「劳工友好提醒」弹窗追加第三个按钮：事实核查
   --------------------------------------------------------------------------
   为什么要单独的脚本，而不是改douyin-prompt.js：
     弹窗本体是可独立维护的组件，加一个第三方按钮属于「额外能力」，
     单独成文件后：原组件不用动、这个功能删掉也只需删一个文件。

   加了什么：
     原有两个按钮（在抖中喊醒 / 以后再说）中间，插入「事实核查」
     → 指向 jiahua-fact-check.html

   为什么这个位置合理：
     弹窗本身是「消费决策引导」，与「事实核查」是并列关系 ——
     前者给行动，后者给依据。用户先被鼓动，再看到「有些事还没查清」，
     不矛盾。

   幂等：用 data 属性标记，重复注入不会产生第二个按钮。
   ========================================================================== */
(function () {
  'use strict';

  var BTN_ID = 'dyp__factcheck';
  var TARGET = './jiahua-fact-check.html';

  function inject() {
    if (document.getElementById(BTN_ID)) return;

    // 弹窗尚未 build（.dyp__acts 不存在）—— 等 MutationObserver 再触发
    var acts = document.querySelector('.dyp__acts');
    if (!acts) return;

    var go = acts.querySelector('.dyp__go');
    var later = acts.querySelector('.dyp__later');
    if (!go || !later) return;

    var a = document.createElement('a');
    a.id = BTN_ID;
    a.href = TARGET;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.className = 'dyp__factcheck';
    a.textContent = '事实核查';
    a.setAttribute('aria-label', '查看云南嘉华事件的官方核查进展');
    a.setAttribute('title', '网传「实习生吐痰」已被警方定性为谣言；用工薪资部分官方仍在核查');

    // 插到两个按钮中间
    acts.insertBefore(a, later);

    // 尺寸（内边距 / 字号 / 行高 / 圆角 / 触摸高度）由 CSS 统一给：
    //   .dyp__acts > * 一条规则覆盖全部按钮。
    //
    // ⚠️ 这里曾内联写过一整套 padding/font-size/border-radius，
    //   结果三个按钮三套规格，截图中主按钮折行后比旁边两个明显高一截。
    //   **新增按钮不要在这里写尺寸**，只写配色（或干脆全部交给 CSS）。
    //   加按钮只需：给 .dyp__acts 下的子元素命名 + 在 CSS 里配颜色。
    //
    // 窄屏纵向排列时的顺序也在 CSS 里给（见 @media (max-width: 520px)），
    // 不在 JS 里判断 —— 那样窗口尺寸变化时不会跟着更新。
  }

  var scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(function () {
      scheduled = false;
      inject();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', schedule);
  } else {
    schedule();
  }

  // 弹窗是延迟 2.5s 才 build 的，必须持续观察才能抓到插入时机
  var obs = new MutationObserver(schedule);
  try {
    obs.observe(document.body, { childList: true, subtree: true });
  } catch (e) {
    console.error('[双休购] 事实核查按钮注入失败：', e);
  }
})();