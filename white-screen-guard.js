/* ==========================================================================
   白屏崩溃兜底（2026-11-08 新增）
   --------------------------------------------------------------------------
   背景：站点任何一处 React 渲染抛错（无错误边界时），React 18 会直接卸载
        整棵 #root，表现为「整站白屏」。用户看到白屏会以为卡死、直接退出网页。
        典型触发：拼音搜索框输入（含中文输入法 IME）后清空/删除，搜索态回放
        期间若渲染异常即整站白屏。

   本脚本是「最后一道防线」（纯 DOM 补丁，不碰压缩产物）：
   1) 监听 window error / unhandledrejection；
   2) 用 MutationObserver 盯 #root：一旦它从「已挂载」变成空（React 卸载），
      立刻在 body 注入一张恢复卡片（「页面出了一点问题 · 重新加载」），
      让用户无需误判为卡死、随手关掉网页。
   3) 只在「应用已挂载过」之后才生效——首屏 React 尚未挂载时 #root 本来就是
      空的，不能误报。

   设计约束（照抄其它 body 级补丁）：不用 Tailwind 类，样式自带 <style>，
   选择器 sxg- 前缀；幂等；挂 body。
   ========================================================================== */
(function () {
  'use strict';

  var GUARD_ID = 'sxg-white-guard';
  var STYLE_ID = 'sxg-white-guard-style';
  var booted = false;            // 应用是否已挂载过（#root 曾非空）
  var shown = false;             // 恢复卡片是否已显示，防重入

  function buildStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent =
      '#' + GUARD_ID + '{' +
        'position:fixed;inset:0;z-index:2147483646;' +
        'display:flex;align-items:center;justify-content:center;padding:24px;' +
        'background:rgba(252,252,253,.96);' +
        '-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px);' +
      '}' +
      '#' + GUARD_ID + ' .sxg-wg-card{' +
        'max-width:380px;width:100%;background:#fff;color:#1f2937;' +
        'border-radius:18px;padding:26px 24px;text-align:center;' +
        'box-shadow:0 24px 70px rgba(15,23,42,.28);' +
        'font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;' +
      '}' +
      '#' + GUARD_ID + ' .sxg-wg-icon{' +
        'width:46px;height:46px;margin:0 auto 12px;border-radius:50%;' +
        'display:flex;align-items:center;justify-content:center;' +
        'font-size:24px;font-weight:800;color:#0F766E;background:rgba(15,118,110,.1)' +
      '}' +
      '#' + GUARD_ID + ' .sxg-wg-title{margin:0 0 6px;font-size:18px;font-weight:800;color:#0F766E}' +
      '#' + GUARD_ID + ' .sxg-wg-text{margin:0 0 18px;font-size:13px;color:#64748b;line-height:1.6}' +
      '#' + GUARD_ID + ' .sxg-wg-btn{' +
        'display:inline-block;border:none;cursor:pointer;' +
        'background:linear-gradient(135deg,#0F766E,#0d9488);color:#fff;' +
        'font:700 14px/1 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;' +
        'padding:11px 22px;border-radius:999px;text-decoration:none;' +
      '}' +
      '#' + GUARD_ID + ' .sxg-wg-btn:hover{filter:brightness(1.06)}' +
      '@media (prefers-color-scheme:dark){' +
        '#' + GUARD_ID + '{background:rgba(15,23,42,.96)}' +
        '#' + GUARD_ID + ' .sxg-wg-card{background:#1e2429;color:#e2e8f0}' +
        '#' + GUARD_ID + ' .sxg-wg-text{color:#94a3b8}' +
      '}';
    (document.head || document.documentElement).appendChild(s);
  }

  function showRecovery() {
    if (shown) return;
    shown = true;
    buildStyle();
    var g = document.createElement('div');
    g.id = GUARD_ID;
    g.setAttribute('role', 'alert');
    g.innerHTML =
      '<div class="sxg-wg-card">' +
        '<div class="sxg-wg-icon" aria-hidden="true">!</div>' +
        '<h2 class="sxg-wg-title">页面出了一点问题</h2>' +
        '<p class="sxg-wg-text">页面渲染时发生了异常，已停止响应。' +
          '点击下方按钮重新加载即可恢复，无需关闭网页。</p>' +
        '<button type="button" class="sxg-wg-btn">重新加载页面</button>' +
      '</div>';
    g.querySelector('.sxg-wg-btn').addEventListener('click', function () {
      window.location.reload();
    });
    (document.body || document.documentElement).appendChild(g);
  }

  function rootEmpty() {
    var root = document.getElementById('root');
    // 没挂载过 / 根本没 #root 时不算崩溃
    if (!root) return false;
    return root.childElementCount === 0;
  }

  function init() {
    // 1) 错误监听：仅在已挂载后、且 #root 确实空了才恢复
    window.addEventListener('error', function () {
      if (booted && rootEmpty()) showRecovery();
    });
    window.addEventListener('unhandledrejection', function () {
      if (booted && rootEmpty()) showRecovery();
    });

    // 2) 直接盯 #root：从「非空」变「空」即视为 React 卸载 → 恢复卡片
    var root = document.getElementById('root');
    if (root && typeof MutationObserver !== 'undefined') {
      var mo = new MutationObserver(function () {
        if (root.childElementCount > 0) {
          booted = true;                 // 应用至少挂载过一次
          if (shown) {                   // 若此前已显示恢复卡片，现在恢复了就移除
            var g = document.getElementById(GUARD_ID);
            if (g) { g.parentNode && g.parentNode.removeChild(g); shown = false; }
          }
        } else if (booted && !shown) {
          showRecovery();                // 已挂载过却变空 → 崩溃
        }
      });
      mo.observe(root, { childList: true });
    }

    // 兜底：若应用从未挂载（脚本加载极早、#root 还没建），等 DOM 就绪后再观察一次
    if (!root) {
      document.addEventListener('DOMContentLoaded', function () {
        var r = document.getElementById('root');
        if (r && typeof MutationObserver !== 'undefined') {
          new MutationObserver(function () {
            if (r.childElementCount > 0) booted = true;
          }).observe(r, { childList: true });
        }
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
