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
   - 与良配吸底广告（liangpei-ad.css）避让：
     <1440px  广告条吸底（z-index 9990）→ 按钮放广告条上方（bottom 96px + 安全区）；
     >=1440px  广告卡在右上（top 88px）→ 按钮放右下角；
     按钮 z-index 9000，低于广告条，万一重叠也是广告在上。
   - 点击平滑回顶；behavior:smooth 不支持时回退直接置顶（catch 内有兜底语句）。
   - 2026-10-19：随笔页（notes.html）也要用。该页没有吸底广告，96px 的避让
     高度是多余的，所以支持 <script data-bottom="28"> 覆盖底距；同时补暗色适配
     （随笔页有 prefers-color-scheme: dark，白底按钮在暗色下会突兀）。
     ⚠️ currentScript 只在同步执行时有效，必须在 IIFE 顶层先取出来存着，
        不能在 DOMContentLoaded 回调里取（那时已经是 null）。
   ========================================================================== */
(function () {
  'use strict';

  var BTN_ID = 'sxg-top-btn';
  var STYLE_ID = 'sxg-top-btn-style';

  // 默认底距 96px：给首页吸底广告条让位。
  // 无广告的页面（随笔页）用 data-bottom 覆盖成 28px。
  var cs = document.currentScript;
  var bottom = (cs && cs.getAttribute('data-bottom')) || '96';

  function build() {
    if (document.getElementById(BTN_ID)) return;

    if (!document.getElementById(STYLE_ID)) {
      var style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent =
        '#' + BTN_ID + '{' +
          'position:fixed;right:14px;' +
          'bottom:calc(' + bottom + 'px + env(safe-area-inset-bottom, 0px));' +
          'width:44px;height:44px;padding:0;border-radius:50%;' +
          'background:#ffffff;color:#0F766E;border:1px solid #d1d5db;' +
          'font:700 12px/42px system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;' +
          'text-align:center;letter-spacing:.02em;cursor:pointer;' +
          'box-shadow:0 4px 14px rgba(0,0,0,.16);z-index:9000;' +
          '-webkit-tap-highlight-color:transparent;' +
          'transition:background-color .18s,color .18s,border-color .18s,opacity .18s;' +
        '}' +
        '#' + BTN_ID + ':hover{background:#0F766E;color:#fff;border-color:#0F766E}' +
        '#' + BTN_ID + ':active{transform:translateY(1px)}' +
        '#' + BTN_ID + ':focus-visible{outline:2px solid #0F766E;outline-offset:2px}' +
        /* 2026-11-01：右侧悬浮组加「视频」钮（featured-douyin.js），
           桌面端把 TOP / ⤓ 各下移一档腾出位置（28→6），否则新钮会被
           AI 对话面板（bottom 270px 起）盖住、或与 ⤓ 重叠。 */
        '@media (min-width:1440px){' +
          '#' + BTN_ID + '{right:16px;bottom:6px}' +
        '}' +
        '@media (max-width:1439px) and (min-width:768px){' +
          '#' + BTN_ID + '{right:18px}' +
        '}' +
        /* 暗色适配：随笔页有深色模式，白底按钮会像一块补丁 */
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
    btn.setAttribute('aria-label', '回到顶部');
    btn.title = '回到顶部';
    btn.textContent = 'TOP';
    btn.addEventListener('click', function () {
      var reduce = window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      try {
        window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
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
