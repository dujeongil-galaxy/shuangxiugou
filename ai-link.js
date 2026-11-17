/* ==========================================================================
   ai-link.js —— AI 图标改为「跳转劳动法小助手独立页」
   --------------------------------------------------------------------------
   2026-11-17 站长指令：撤掉内嵌对话挂件（ai-chat.js），点左下角 AI 图标直接
   跳 labor-ai.html。本脚本只做两件事：
     ① 复刻原 ai-chat.js 的 AI 圆钮外观与位置（含左下角/移动端避让/safe-area），
        让用户看到的图标和以前一模一样；
     ② 点击 → location.href = './labor-ai.html'（品牌页用 '../labor-ai.html'）。

   纪律：
     · 不碰压缩 bundle；纯 DOM 下游补丁，幂等（同 id 只插一次）。
     · 不加载 ai-config.js / ai-chat.js 的对话逻辑；那两个文件保留在仓库但本页不再引用。
     · 路径按当前页所在目录自动推断：根目录页用 ./，brand/ 下的页用 ../。
   ========================================================================== */
(function () {
  'use strict';

  var BTN_ID = 'sxg-ai-fab';
  var STYLE_ID = 'sxg-ai-link-style';

  function targetHref() {
    var path = (window.location && window.location.pathname) || '';
    return /\/(brand|brand-jobs|pages)\//i.test(path) ? '../labor-ai.html' : './labor-ai.html';
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = [
      '#' + BTN_ID + '{position:fixed;left:14px;',
      'bottom:calc(var(--sxg-bar-h, 0px) + 14px + env(safe-area-inset-bottom, 0px));width:52px;height:52px;border-radius:50%;',
      'background:#0F766E;color:#fff;border:none;cursor:pointer;font-size:24px;line-height:1;',
      'box-shadow:0 4px 14px rgba(15,118,110,.35);z-index:9000;',
      'display:flex;align-items:center;justify-content:center;transition:transform .15s ease;',
      '-webkit-tap-highlight-color:transparent;text-decoration:none}',
      '#' + BTN_ID + ':hover{transform:scale(1.08)}',
      '@media (max-width:640px){',
      '#' + BTN_ID + '{left:14px;bottom:calc(var(--sxg-bar-h, 0px) + 104px + env(safe-area-inset-bottom, 0px));width:56px;height:56px}',
      '}',
      '@media (prefers-reduced-motion:reduce){#' + BTN_ID + '{transition:none}}'
    ].join('');
    (document.head || document.documentElement).appendChild(s);
  }

  function build() {
    if (document.getElementById(BTN_ID)) return;
    injectStyle();
    var a = document.createElement('a');
    a.id = BTN_ID;
    a.href = targetHref();
    a.setAttribute('aria-label', '劳动法小助手');
    a.title = '劳动法小助手';
    a.textContent = 'AI';
  /* 跳转由 <a href> 原生完成，无 JS 拦截，稳。 */
    (document.body || document.documentElement).appendChild(a);
  }

  function boot() {
    try { build(); } catch (e) { /* 下游补丁不因宿主异常抛错 */ }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
  setTimeout(boot, 800);
  setTimeout(boot, 1800);

  window.SXG_AI_LINK = { targetHref: targetHref };
})();
