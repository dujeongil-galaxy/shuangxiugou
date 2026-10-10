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

    // 样式：与次要按钮一致但更低调，不抢主按钮的视觉重心
    a.style.cssText = [
      'flex:1 1 0',
      'min-width:0',
      'padding:10px 12px',
      'border:1px solid #cbd5e1',
      'border-radius:8px',
      'background:#fff',
      'color:#475569',
      'font-size:13.5px',
      'font-weight:600',
      'text-decoration:none',
      'text-align:center',
      'cursor:pointer',
      'transition:background .15s,border-color .15s',
      'white-space:nowrap',
    ].join(';');

    a.addEventListener('mouseenter', function () {
      a.style.background = '#f8fafc';
      a.style.borderColor = '#94a3b8';
    });
    a.addEventListener('mouseleave', function () {
      a.style.background = '#fff';
      a.style.borderColor = '#cbd5e1';
    });

    // 主按钮的 flex 值会随按钮数量变化，重新分配让三按钮均分
    [go, later].forEach(function (el) {
      el.style.flex = '1 1 0';
      el.style.minWidth = '0';
    });
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