/* ==========================================================================
   github-access-help.js —— GitHub 访问帮助（设备分流 + Star 二级菜单）
   --------------------------------------------------------------------------
   背景（2026-11-12 站长指令）：申诉、Star、Login 都走 GitHub，部分网络环境下
   打不开。参考 Login GitHub 已有的提示弹窗，把「打不开怎么办」补到两个新入口：
     · 申诉政策确认弹窗（appeal-policy.js 留一个 [data-sxg-gh-help] 容器）
     · Star on GitHub 按钮的二级菜单（本文件挂触发入口 + 浮层）
   设备判定代码仍保留（站长 2026-11-12「加入判定代码，判定用户设备是 PC 还是
   手机平板」），但 2026-11-12 §36t 站长把口径改了：
     「我再说一次，手机端，全部展开，按钮不再做隐藏。」
   → 两条办法（电脑 / 手机平板）**同时常显**，判定结果只用来给当前设备那一条
     打「当前设备 · 推荐」标记，不再用它把另一条藏起来。
   → Star on GitHub 的 🌐 触发入口两端都直接贴在 Star 按钮右侧常显（与桌面
     截图一致），不再挂进任何下拉菜单、不做断点隐藏。

   设备判定口径：UA 为主（Android / iPhone / iPad / Mobile / Tablet ... 一律算
   移动端），再修 iPadOS 13+ 伪装成 Macintosh（多点触控 + Mac → 判平板），
   触屏笔记本因 UA 仍报桌面平台且无移动标识，按 PC 处理。

   纪律：
     · 纯 DOM 下游补丁，不改压缩 bundle、不改六个悬浮脚本、不改 Login 弹窗。
     · 顶栏按钮由 header-menu-patch.js 撤掉折叠后全部常显；本文件不再依赖
       旧的下拉菜单容器，触发入口统一贴 Star，宽屏窄屏同一份代码。
     · 二级菜单用 position:fixed 浮层（不插进顶栏按钮组里），避免继承
       顶栏按钮的 nowrap 规则把长 URL 撑爆。
   ========================================================================== */
(function () {
  'use strict';

  var STEAMPP_URL = 'https://steampp.net/';
  /* 与 header-menu-patch.js 的 Login GitHub 提示同一个站点原有入口，
     不新造链接、不新写推广话术。 */
  var MOBILE_ENTRY = 'https://47.112.97.173:8000/register?aff=v17mHNYv';

  var STYLE_ID = 'sxg-gh-help-style';
  var FLY_ID = 'sxg-gh-help-flyout';
  var TRIGGER_ID = 'sxg-gh-help-trigger';
  /* 2026-11-12 站长要求删掉顶栏那颗蓝色 🌐 图标（位于「Star on GitHub」与
     「赞助本项目」之间）：只撤掉这个可见入口，浮层与其它宿主入口（申诉政策
     弹窗内的 [data-sxg-gh-help] 槽位）全部保留。需恢复时把 SHOW_TRIGGER
     改回 true 即可（一处改动）。 */
  var SHOW_TRIGGER = false;
  var SLOT_ATTR = 'data-sxg-gh-help';
  var SLOT_MARK = 'data-sxg-gh-help-filled';

  /* ---------------------------------------------------------- 设备判定 */
  function isDesktop() {
    var ua = (navigator.userAgent || '');
    if (/Android|iPhone|iPod|iPad|Windows Phone|Mobile|Tablet|Silk|Kindle|BlackBerry|Opera Mini|Mobi/i.test(ua)) {
      return false;
    }
    var touch = (navigator.maxTouchPoints || navigator.msMaxTouchPoints || 0) > 1;
    /* iPadOS 13+ 默认把自己报成 Macintosh，只能靠多点触控认出来 */
    if (/Macintosh/.test(ua) && touch) return false;
    return true;
  }

  function isNarrow() {
    return !!(window.matchMedia && window.matchMedia('(max-width: 640px)').matches);
  }

  /* ---------------------------------------------------------- 样式 */
  function buildStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = [
      '.sxg-gh-help{font-size:13px;line-height:1.7;color:#475569}',
      '.sxg-gh-help__hd{font-size:13.5px;font-weight:700;color:#0f172a;margin-bottom:8px}',
      '.sxg-gh-help__lead{margin:0 0 10px;color:#64748b;font-size:12.5px}',
      '.sxg-gh-help__row{padding:10px 12px;border-radius:10px;background:#f8fafc;',
      '  border:1px solid #e2e8f0;margin:0 0 8px;word-break:break-word}',
      '.sxg-gh-help__row a{color:#0F766E;font-weight:600;text-decoration:underline;',
      '  word-break:break-all}',
      '.sxg-gh-help__note{margin:0;color:#94a3b8;font-size:11.5px}',
      '.sxg-gh-help__rec{display:inline-block;margin-left:6px;padding:1px 7px;',
      '  border-radius:6px;background:#0F766E;color:#fff;font-size:11px;',
      '  font-weight:600;vertical-align:middle;white-space:nowrap}',
      '#' + FLY_ID + '{box-sizing:border-box;background:#fff;border-radius:14px;',
      '  box-shadow:0 14px 38px rgba(15,23,42,.22);padding:16px 18px;',
      '  border:1px solid #e2e8f0;z-index:10000;max-height:70vh;overflow-y:auto}',
      '#' + TRIGGER_ID + '[data-sxg-gh-desktop="1"]{display:inline-flex;',
      '  align-items:center;justify-content:center;margin-left:6px;',
      '  width:30px;height:30px;border-radius:50%;background:#f1f5f9;',
      '  color:#0F766E;font-size:14px;text-decoration:none;',
      '  border:1px solid #e2e8f0;vertical-align:middle;cursor:pointer}'
    ].join('');
    (document.head || document.documentElement).appendChild(s);
  }

  /* ---------------------------------------------------------- 内容（单一真相源） */
  /* §36t：两条办法都常显，设备判定只决定哪一条带「当前设备 · 推荐」。
     旧版 if/else 只拼一个 row，等于把另一半藏起来 —— 那正是站长要撤掉的做法。 */
  function helpHtml() {
    var pc = true;
    try { pc = isDesktop(); } catch (e) { pc = true; }
    var pcRow = '💻 <b>电脑</b>：装 Watt Toolkit（原 Steam++，开源免费），在「网络加速」里'
      + '勾选 <b>GitHub</b> 后重试。官网：<a href="' + STEAMPP_URL + '" '
      + 'target="_blank" rel="noopener noreferrer">' + STEAMPP_URL + '</a>';
    var mobRow = '📱 <b>手机 / 平板</b>：可沿用站点原有的网络访问入口（VPN）：'
      + '<a href="' + MOBILE_ENTRY + '" target="_blank" rel="noopener noreferrer">'
      + MOBILE_ENTRY + '</a>';
    var rec = '<span class="sxg-gh-help__rec">当前设备 · 推荐</span>';
    return '<div class="sxg-gh-help">'
      + '<div class="sxg-gh-help__hd">GitHub 访问帮助</div>'
      + '<p class="sxg-gh-help__lead">申诉、Star 与登录都走 GitHub；大陆部分网络环境下'
      + '可能无法直连。两种办法都列在下面，按自己设备选一种：</p>'
      + '<div class="sxg-gh-help__row">' + pcRow + (pc ? rec : '') + '</div>'
      + '<div class="sxg-gh-help__row">' + mobRow + (pc ? '' : rec) + '</div>'
      + '<p class="sxg-gh-help__note">两条都常显、不做隐藏；带「当前设备」标记的是按 UA 自动判断的建议。</p>'
      + '</div>';
  }

  /* 给申诉弹窗预留的容器填内容；幂等，重复调用不叠加 */
  function populate(el) {
    if (!el) return false;
    if (el.getAttribute(SLOT_MARK) === '1') return true;
    el.innerHTML = helpHtml();
    el.setAttribute(SLOT_MARK, '1');
    return true;
  }

  function sweepSlots() {
    var list = document.querySelectorAll('[' + SLOT_ATTR + ']');
    for (var i = 0; i < list.length; i++) populate(list[i]);
  }

  /* ---------------------------------------------------------- 二级菜单浮层 */
  function closeFlyout() {
    var f = document.getElementById(FLY_ID);
    if (f && f.parentNode) f.parentNode.removeChild(f);
  }

  function openFlyout(trigger) {
    closeFlyout();
    var f = document.createElement('div');
    f.id = FLY_ID;
    f.setAttribute('role', 'menu');
    f.setAttribute('aria-label', 'GitHub 访问帮助');
    f.style.cssText = 'position:fixed;width:min(340px, calc(100vw - 24px));';
    f.innerHTML = helpHtml();
    document.body.appendChild(f);
    var r = trigger.getBoundingClientRect();
    var w = f.getBoundingClientRect().width;
    var h = f.getBoundingClientRect().height;
    var left = Math.max(12, Math.min(r.right - w, window.innerWidth - w - 12));
    var top = r.bottom + 8;
    if (top + h > window.innerHeight - 12) top = Math.max(12, r.top - h - 8);
    f.style.left = Math.round(left) + 'px';
    f.style.top = Math.round(top) + 'px';
  }

  function onTrigger(ev) {
    ev.preventDefault();
    ev.stopPropagation();
    var f = document.getElementById(FLY_ID);
    if (f) { closeFlyout(); return; }
    openFlyout(this);
  }

  function bindTrigger(a) {
    a.addEventListener('click', onTrigger);
  }

  /* ---------------------------------------------------------- 触发入口 */
  function findStar() {
    var list = document.querySelectorAll('a');
    for (var i = 0; i < list.length; i++) {
      if ((list[i].textContent || '').indexOf('Star on GitHub') >= 0) return list[i];
    }
    return null;
  }

  function removeTrigger() {
    var old = document.getElementById(TRIGGER_ID);
    if (old && old.parentNode) old.parentNode.removeChild(old);
  }

  /* §36t：宽屏 / 窄屏同一分支 —— 🌐 圆形入口始终贴在 Star 按钮右侧常显。
     旧版窄屏塞进「菜单▼」，等于把入口藏起来；现在顶栏已全部展开，不需要它。 */
  function ensureTrigger() {
    if (!SHOW_TRIGGER) { removeTrigger(); return false; }
    if (document.getElementById(TRIGGER_ID)) return true;

    var star = findStar();
    if (!star || !star.parentNode) return false;
    var t = document.createElement('a');
    t.id = TRIGGER_ID;
    t.href = '#';
    t.textContent = '🌐';
    t.setAttribute('data-sxg-gh-desktop', '1');
    t.setAttribute('aria-label', 'GitHub 访问帮助（二级菜单）');
    t.setAttribute('title', 'GitHub 打不开？');
    star.parentNode.insertBefore(t, star.nextSibling);
    bindTrigger(t);
    return true;
  }

  function sweep() {
    /* 同 appeal-policy.js 的注入层纪律：DOM 补丁绝不能因为宿主状态异常而抛错。
       jsdom 在 w.close() 之后仍会派发一次 MutationObserver 回调，此时 document
       已销毁，buildStyle() 会读到 undefined —— 真浏览器不会，但测试输出要干净。 */
    try {
      buildStyle();
      sweepSlots();
      ensureTrigger();
    } catch (e) { /* 静默，下一轮 setInterval / observer 会重试 */ }
  }

  /* ---------------------------------------------------------- 生命周期 */
  document.addEventListener('click', function (ev) {
    var f = document.getElementById(FLY_ID);
    if (!f) return;
    var t = document.getElementById(TRIGGER_ID);
    if (f.contains(ev.target) || (t && t.contains(ev.target))) return;
    closeFlyout();
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') closeFlyout();
  });

  /* 断点来回切换：入口不重建（两端都在 Star 旁边），只把「当前设备 · 推荐」
     标记按新断点重刷一次。isNarrow() 仍保留，用来感知断点变化。 */
  var lastMode = null;
  function checkMode() {
    var mode = isNarrow() ? 'narrow' : 'wide';
    if (lastMode !== null && lastMode !== mode) {
      closeFlyout();
      var slots = document.querySelectorAll('[' + SLOT_ATTR + ']');
      for (var i = 0; i < slots.length; i++) {
        slots[i].removeAttribute(SLOT_MARK);
      }
      sweepSlots();
    }
    lastMode = mode;
  }
  window.addEventListener('resize', checkMode);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', sweep);
  } else {
    sweep();
  }
  /* 顶栏由 React 渲染 + header-menu-patch 延后建菜单，都要等 */
  setTimeout(sweep, 800);
  setTimeout(sweep, 1800);
  setTimeout(sweep, 3200);
  if (window.MutationObserver) {
    var tries = 0;
    var obs = new MutationObserver(function () {
      sweep();
      if (++tries > 80) obs.disconnect();
    });
    try { obs.observe(document.body, { childList: true, subtree: true }); } catch (e) {}
  }

  /* ---------------------------------------------------------- 自测导出 */
  window.SXGGitHubAccess = {
    isDesktop: isDesktop,
    isNarrow: isNarrow,
    helpHtml: helpHtml,
    populate: populate,
    STEAMPP_URL: STEAMPP_URL,
    MOBILE_ENTRY: MOBILE_ENTRY,
    TRIGGER_ID: TRIGGER_ID,
    FLY_ID: FLY_ID
  };
})();
