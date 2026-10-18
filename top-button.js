/* ==========================================================================
   首页悬浮「TOP」回顶按钮
   --------------------------------------------------------------------------
   需求（2026-10-17 站长）：网站首页新增一个 top 按钮，点击直接回到顶部；
   按钮随页面滚动始终可见（fixed 定位跟随视口），任何时候都能点，不是固定
   在文档流里的某个位置。

   实现约束（见 AGENTS.md / PITFALLS.md）：
   - 不用 Tailwind 类（index-BgVofs0W.css 是按源码生成的，未用到的类不存在），
     样式自带 <style>，选择器用 sxg- 前缀避免冲突；
   - 幂等：已存在 #sxg-top-btn 直接返回，防止重复注入；
   - 与吸底广告（liangpei-ad.css）避让：
     <1440px  广告条吸底（z-index 9990）→ 按钮放广告条上方（bottom 96px + 安全区）；
     >=1440px  广告卡在右上（top 88px）→ 按钮放右下角；
     按钮 z-index 9000，低于广告条，万一重叠也是广告在上。
   - 点击平滑回顶；behavior:smooth 不支持时回退直接置顶（catch 内有兜底语句）。
   ========================================================================== */
(function () {
  'use strict';

  var BTN_ID = 'sxg-top-btn';
  var STYLE_ID = 'sxg-top-btn-style';

  function build() {
    if (document.getElementById(BTN_ID)) return;

    if (!document.getElementById(STYLE_ID)) {
      var style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent =
        '#' + BTN_ID + '{' +
          'position:fixed;right:14px;' +
          'bottom:calc(96px + env(safe-area-inset-bottom, 0px));' +
          'width:44px;height:44px;padding:0;border-radius:50%;' +
          'background:#ffffff;color:#0F766E;border:1px solid #d1d5db;' +
          'font:700 12px/42px system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;' +
          'text-align:center;letter-spacing:.02em;cursor:pointer;' +
          'box-shadow:0 4px 14px rgba(0,0,0,.16);z-index:9000;' +
          '-webkit-tap-highlight-color:transparent;' +
        '}' +
        '#' + BTN_ID + ':hover{background:#0F766E;color:#fff;border-color:#0F766E}' +
        '#' + BTN_ID + ':active{transform:translateY(1px)}' +
        '#' + BTN_ID + ':focus-visible{outline:2px solid #0F766E;outline-offset:2px}' +
        '@media (min-width:1440px){' +
          '#' + BTN_ID + '{right:16px;bottom:28px}' +
        '}' +
        '@media (max-width:1439px) and (min-width:768px){' +
          '#' + BTN_ID + '{right:18px}' +
        '}';
      document.head.appendChild(style);
    }

    var btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.type = 'button';
    btn.setAttribute('aria-label', '回到顶部');
    btn.title = '回到顶部';
    btn.textContent = 'TOP';
    btn.addEventListener('click', function () {
      try {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } catch (e) {
        window.scrollTo(0, 0);
      }
    });
    document.body.appendChild(btn);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build);
  } else {
    build();
  }
})();
