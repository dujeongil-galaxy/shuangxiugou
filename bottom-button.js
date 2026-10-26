/* ==========================================================================
   首页悬浮「⤓」滑到底部按钮
   --------------------------------------------------------------------------
   需求（2026-10-25 站长）：首页右下角新增一个按钮，一键滑动到网页底部。

   实现约束（照抄 top-button.js 的既有纪律，见 AGENTS.md / PITFALLS.md）：
   - 不用 Tailwind 类，样式自带 <style>，选择器用 sxg- 前缀避免冲突；
   - 幂等：已存在 #sxg-bottom-btn 直接返回，防止重复注入；
   - 与良配吸底广告（liangpei-ad.css）避让：与 TOP 按钮同一套规则；
   - 与 TOP 按钮（#sxg-top-btn）避让：本按钮排在 TOP 下方，
     小屏时 TOP 因吸底广告抬到 96px，本按钮跟随加一档间距；
   - 近底部自动隐藏：已在底部时按钮无意义，opacity 0 + 不可点，
     滚回上方再恢复；prefers-reduced-motion 时不过渡。
   - 暗色适配与 TOP 按钮同款。
   ========================================================================== */
(function () {
  'use strict';

  var BTN_ID = 'sxg-bottom-btn';
  var STYLE_ID = 'sxg-bottom-btn-style';

  function build() {
    if (document.getElementById(BTN_ID)) return;

    if (!document.getElementById(STYLE_ID)) {
      var style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent =
        '#' + BTN_ID + '{' +
          'position:fixed;right:14px;' +
          'bottom:calc(154px + env(safe-area-inset-bottom, 0px));' +
          'width:44px;height:44px;padding:0;border-radius:50%;' +
          'background:#ffffff;color:#0F766E;border:1px solid #d1d5db;' +
          'font:700 17px/42px system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;' +
          'text-align:center;cursor:pointer;' +
          'box-shadow:0 4px 14px rgba(0,0,0,.16);z-index:9000;' +
          '-webkit-tap-highlight-color:transparent;' +
          'transition:background-color .18s,color .18s,border-color .18s,opacity .18s,visibility .18s;' +
        '}' +
        '#' + BTN_ID + ':hover{background:#0F766E;color:#fff;border-color:#0F766E}' +
        '#' + BTN_ID + ':active{transform:translateY(1px)}' +
        '#' + BTN_ID + ':focus-visible{outline:2px solid #0F766E;outline-offset:2px}' +
        /* 近底部隐藏：滑到底后按钮失去意义，淡出 + 禁点，滚回上方再恢复 */
        '#' + BTN_ID + '.sxg-at-bottom{opacity:0;visibility:hidden;pointer-events:none}' +
        '@media (min-width:1440px){' +
          '#' + BTN_ID + '{right:16px;bottom:86px}' +
        '}' +
        '@media (max-width:1439px) and (min-width:768px){' +
          '#' + BTN_ID + '{right:18px}' +
        '}' +
        '@media (prefers-color-scheme:dark){' +
          '#' + BTN_ID + '{background:#1e2429;color:#5eead4;border-color:#2f3a42;' +
            'box-shadow:0 4px 14px rgba(0,0,0,.45)}' +
          '#' + BTN_ID + ':hover{background:#5eead4;color:#10221f;border-color:#5eead4}' +
        '}' +
        '@media (prefers-reduced-motion:reduce){' +
          '#' + BTN_ID + '{transition:none}' +
        '}';
      document.head.appendChild(style);
    }

    var btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.type = 'button';
    btn.setAttribute('aria-label', '滑动到底部');
    btn.title = '滑动到底部';
    btn.textContent = '⤓';
    btn.addEventListener('click', function () {
      var reduce = window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      var target = document.documentElement.scrollHeight - window.innerHeight;
      try {
        window.scrollTo({ top: target, behavior: reduce ? 'auto' : 'smooth' });
      } catch (e) {
        window.scrollTo(0, target);
      }
    });
    document.body.appendChild(btn);

    /* 近底部隐藏判定：视口底边进入页面末尾 160px 范围内即视为「到底了」。
       监听 scroll + resize；rAF 节流避免滚动时高频触发。 */
    var ticking = false;
    function update() {
      ticking = false;
      var remain = document.documentElement.scrollHeight -
        (window.scrollY + window.innerHeight);
      if (remain < 160) {
        btn.classList.add('sxg-at-bottom');
      } else {
        btn.classList.remove('sxg-at-bottom');
      }
    }
    function onScroll() {
      if (!ticking) {
        ticking = true;
        window.requestAnimationFrame(update);
      }
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    update();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build);
  } else {
    build();
  }
})();
