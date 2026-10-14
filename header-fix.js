/* ==========================================================================
   顶栏按钮容器标记
   --------------------------------------------------------------------------
   用途：给包住三个顶栏按钮的容器打上 data-hdr-acts="1"，
   让 mobile-fixes.css 能用属性选择器定位它。

   为什么需要这个（真实踩坑）：
     CSS 里定位这个容器最直观的写法是 `:has(> a[href*="sponsor.html"])`，
     但实测在用户那台真机浏览器上 **:has() 没有生效** ——
     结果 flex-wrap: wrap 没应用，三个按钮在 393px 视口上横向重叠
     （三按钮总宽 408px，而按钮区只有 229px）。

     :has() 在部分国产 Android 浏览器与 WebView 里支持参差，
     不能作为唯一手段。改用 JS 打属性 + 属性选择器，
     兼容性等同普通 class。

   幂等：已有 data-hdr-acts 则跳过，重复注入不会出问题。
   ========================================================================== */
(function () {
  'use strict';

  var ATTR = 'data-hdr-acts';

  function mark() {
    var btn = document.querySelector('header a[href*="github.com"] > span');
    if (!btn) return false;

    // span 的父级就是「★ Star on GitHub」按钮，再上一级才是按钮区容器
    var starBtn = btn.parentNode;
    var box = starBtn && starBtn.parentNode;
    if (!box || box.getAttribute(ATTR)) return false;

    box.setAttribute(ATTR, '1');
    return true;
  }

  if (mark()) return;

  // 顶栏由 React 渲染，可能还没挂载 —— 观察后重试
  var tries = 0;
  var obs = new MutationObserver(function () {
    if (mark() || ++tries > 60) obs.disconnect();   // 最多观察约 3 秒
  });
  try {
    obs.observe(document.body, { childList: true, subtree: true });
  } catch (e) {
    console.error('[双休购] 顶栏按钮容器标记失败：', e);
  }
})();