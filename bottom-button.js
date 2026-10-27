/* ==========================================================================
   首页悬浮「滑到底部」按钮（全新 UI）
   --------------------------------------------------------------------------
   需求（2026-10-25 站长）：首页右下角新增一个按钮，一键滑动到网页底部。

   原图标用的是 Unicode 字符「⤓」，偏简陋。本次重做：
   - 用一支「向下箭头落到底线」的内联 SVG 替换字符图标，语义清晰、矢量清晰、
     在任意分辨率/暗色下都干净；
   - 按钮观感升级：圆润描边、悬停渐变填充 + 轻微上浮、按压回弹、聚焦光圈；
   - 默认白底青描边青图标，悬停翻转成青渐变底白图标，和「回到顶部」按钮同族但更精致。

   实现约束（照抄 top-button.js 的既有纪律，见 AGENTS.md / PITFALLS.md）：
   - 不用 Tailwind 类，样式自带 <style>，选择器用 sxg- 前缀避免冲突；
   - 幂等：已存在 #sxg-bottom-btn 直接返回，防止重复注入；
   - 与良配吸底广告（liangpei-ad.css）避让：与 TOP 按钮同一套规则；
   - 与 TOP 按钮（#sxg-top-btn）避让：本按钮排在 TOP 下方，
     小屏时 TOP 因吸底广告抬到 96px，本按钮跟随加一档间距；
   - 近底部自动隐藏：已在底部时按钮无意义，opacity 0 + 不可点，
     滚回上方再恢复；prefers-reduced-motion 时不过渡、不位移。
   - 暗色适配：深色下用深色圆底 + 青图标，悬停翻转成青底白图标。
   ========================================================================== */
(function () {
  'use strict';

  var BTN_ID = 'sxg-bottom-btn';
  var STYLE_ID = 'sxg-bottom-btn-style';

  /* 全新 SVG 图标：一支向下箭头落到底线，一眼即知「滑到页面最底部」。
     用 currentColor 跟随按钮文字色，hover/暗色时自动反色。 */
  var ICON_SVG =
    '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false" style="display:block">' +
      '<g fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
        '<line x1="12" y1="3" x2="12" y2="13"/>' +
        '<polyline points="6 8 12 14 18 8"/>' +
        '<line x1="5" y1="20" x2="19" y2="20"/>' +
      '</g>' +
    '</svg>';

  function build() {
    if (document.getElementById(BTN_ID)) return;

    if (!document.getElementById(STYLE_ID)) {
      var style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent =
        '#' + BTN_ID + '{' +
          'position:fixed;right:14px;' +
          'bottom:calc(154px + env(safe-area-inset-bottom, 0px));' +
          'width:46px;height:46px;padding:0;border-radius:50%;' +
          'display:flex;align-items:center;justify-content:center;' +
          'background:#ffffff;color:#0F766E;border:1.5px solid #0F766E;' +
          'cursor:pointer;' +
          'box-shadow:0 6px 18px rgba(15,118,110,.22);z-index:9000;' +
          '-webkit-tap-highlight-color:transparent;' +
          'transition:background .2s ease,color .2s ease,border-color .2s ease,' +
            'box-shadow .2s ease,transform .2s ease,opacity .2s ease,visibility .2s ease;' +
        '}' +
        /* 悬停：青绿渐变填充 + 白图标 + 轻微上浮，呼应「回到顶部」的同族风格但更精致 */
        '#' + BTN_ID + ':hover{' +
          'background:linear-gradient(135deg,#0F766E,#0d9488);' +
          'color:#fff;border-color:#0d9488;' +
          'box-shadow:0 10px 24px rgba(13,148,136,.36);' +
          'transform:translateY(-2px)' +
        '}' +
        '#' + BTN_ID + ':active{transform:translateY(0) scale(.94)}' +
        '#' + BTN_ID + ':focus-visible{outline:2px solid #0F766E;outline-offset:3px}' +
        /* 近底部隐藏：滑到底后按钮失去意义，淡出 + 禁点，滚回上方再恢复 */
        '#' + BTN_ID + '.sxg-at-bottom{opacity:0;visibility:hidden;pointer-events:none}' +
        '@media (min-width:1440px){' +
          '#' + BTN_ID + '{right:16px;bottom:88px}' +
        '}' +
        '@media (max-width:1439px) and (min-width:768px){' +
          '#' + BTN_ID + '{right:18px}' +
        '}' +
        '@media (prefers-color-scheme:dark){' +
          '#' + BTN_ID + '{background:#1e2429;color:#5eead4;border-color:#3aa68c;' +
            'box-shadow:0 6px 18px rgba(0,0,0,.5)}' +
          '#' + BTN_ID + ':hover{background:linear-gradient(135deg,#0F766E,#0d9488);' +
            'color:#fff;border-color:#0d9488}' +
        '}' +
        '@media (prefers-reduced-motion:reduce){' +
          '#' + BTN_ID + '{transition:opacity .2s ease,visibility .2s ease;transform:none!important}' +
        '}';
      document.head.appendChild(style);
    }

    var btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.type = 'button';
    btn.setAttribute('aria-label', '滑动到底部');
    btn.title = '滑动到底部';
    btn.innerHTML = ICON_SVG;
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
    // 监听 body 变化：首页品牌卡片是 JS 动态插入的，插入后页面变高，
    // 需要重新评估「是否到底」以免按钮被误藏。
    var mo = ('MutationObserver' in window) ? new MutationObserver(onScroll) : null;
    function update() {
      // 评估期间断开自身观察，避免按钮 class 变化触发回环
      if (mo) mo.disconnect();
      ticking = false;
      var remain = document.documentElement.scrollHeight -
        (window.scrollY + window.innerHeight);
      if (remain < 160) {
        btn.classList.add('sxg-at-bottom');
      } else {
        btn.classList.remove('sxg-at-bottom');
      }
      // 下一帧重新观察
      window.requestAnimationFrame(function () {
        if (mo) mo.observe(document.body, { childList: true, subtree: true });
      });
    }
    function onScroll() {
      if (!ticking) {
        ticking = true;
        window.requestAnimationFrame(update);
      }
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    window.addEventListener('load', onScroll);
    /* 关键修复：首屏长内容 / 动态卡片可能尚未撑开，若此刻同步判定会误把
       按钮当成「已在底部」而隐藏，且之后没有 scroll/resize 事件来纠正。
       改在首帧绘制后、load 完成后再评估，并监听 body 变化兜底。 */
    window.requestAnimationFrame(update);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build);
  } else {
    build();
  }
})();
