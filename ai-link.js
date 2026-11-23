/* ==========================================================================
   ai-link.js —— AI 图标改为「跳转劳动法小助手独立页」
  --------------------------------------------------------------------------
   2026-11-17 站长指令：撤掉内嵌对话挂件（ai-chat.js），点左下角 AI 图标直接
   跳 labor-ai.html。本脚本只做两件事：
     ① 复刻原 ai-chat.js 的 AI 圆钮外观与位置（含左下角/移动端避让/safe-area），
        让用户看到的图标和以前一模一样；
     ② 点击 → location.href = './labor-ai.html'（品牌页用 '../labor-ai.html'）。

   2026-11-18 全局化 + 阅读态守卫：
     · 全站所有正常页面都挂本脚本（含原 6 个残留旧挂件的页与原本没有按钮的页）。
     · 站长随笔 notes.html 解锁后用 document.write 整页换成正文（#toc 目录），
       正文里不要再出现 AI 按钮 → 检测到 #toc（阅读态）就移除按钮并跳过构建。
       实测 document.write 不会清掉已 append 的按钮、兜底定时器仍可能复活，
       故必须在 boot 里显式判断，不能指望换页自然清场。
     · 几个特例页不挂：labor-ai.html（自身即终点）、404.html、discussion-closed.html、
       notes-plaintext-preview.html、google 站点验证文件。

   纪律：
     · 不碰压缩 bundle；纯 DOM 下游补丁，幂等（同 id 只插一次）。
     · 不加载任何旧对话逻辑——ai-chat.js / ai-config.js 已于 2026-11-18 彻底删除
       （文件、引用、头像、专属测试全清），本脚本是本页唯一的 AI 入口实现。
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
    a.setAttribute('aria-label', '休休查');
    a.title = '休休查（原劳动法小助手）· 劳动法与双休 AI 查询';
    a.textContent = 'AI';
  /* 跳转由 <a href> 原生完成，无 JS 拦截，稳。 */
    (document.body || document.documentElement).appendChild(a);
  }

  /* 阅读态守卫：站长随笔解锁后的正文里有 #toc（目录树），锁屏页没有。
     document.write 换页不会清掉已插入的按钮，兜底定时器也可能在其后触发，
     所以每次 boot 都先判断：是正文就移除按钮并停手，绝不复活。 */
  function isReaderMode() {
    return !!document.getElementById('toc');
  }

  function boot() {
    try {
      if (isReaderMode()) {
        var stale = document.getElementById(BTN_ID);
        if (stale && stale.parentNode) stale.parentNode.removeChild(stale);
        return;
      }
      build();
    } catch (e) { /* 下游补丁不因宿主异常抛错 */ }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
  setTimeout(boot, 800);
  setTimeout(boot, 1800);

  window.SXG_AI_LINK = { targetHref: targetHref, isReaderMode: isReaderMode, BTN_ID: BTN_ID };
})();
