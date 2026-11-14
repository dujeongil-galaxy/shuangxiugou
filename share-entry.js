/* ==========================================================================
   「分享本站」顶栏入口（2026-11-12 站长要求，§36w）
   --------------------------------------------------------------------------
   · 桌面端：顶栏第 6 枚按钮，插在「匿名邮箱」之后（既有五枚顺序一根不动，
     只在最右追加），带图标（内联 SVG 分享符号）+ 文字「分享本站」。
   · 点击：直接调 share-modal.js 暴露的 window.SXGShare.open()；弹窗脚本
     还没就绪（慢网 / 被拦）时退化为「复制当前地址 + 按钮文字临时反馈」，
     绝不做成死按钮。
   · ≤640px：与「匿名邮箱」同口径挂进 #sxg-fab-dock（顶栏第二行已铺满，
     再塞一枚会挤成第三行），短标签由 mobile-fixes.css 的
     `content: attr(data-sxg-dock-label)` 读取；dock 内 svg 由同一份 CSS 隐藏。
   · 不许隐藏：不提供删除路径，只留 ENABLED 一键互切（与 anon-mail.js 一致）。
   ========================================================================== */
(function () {
  'use strict';

  var BTN_ID   = 'sxg-share-entry-btn';
  var STYLE_ID = 'sxg-share-entry-style';
  var DOCK_ID  = 'sxg-fab-dock';
  var ANON_ID  = 'sxg-anon-mail-btn';
  var MQ       = '(max-width: 640px)';
  /* 站长要求「加一个带 LOGO 的分享入口」：开关留着，只隐藏不删本体。 */
  var ENABLED  = true;

  /* 顶栏按钮外观基线：与 Star / Login / 匿名邮箱同一套 class（不能现场读
     Star，手机端 header-menu-patch 会把它的 class 整个摘掉，§36s 实测）。 */
  var HEADER_CLASS = 'inline-flex items-center gap-1.5 text-xs sm:text-sm '
    + 'bg-slate-900 hover:bg-slate-800 text-white px-3 py-1.5 rounded-lg '
    + 'font-medium shadow-sm transition sxg-header-btn';

  /* 分享图标（内联 SVG，currentColor 描边，不依赖任何外部图片/字体）。
     用 SVG 而不是 emoji：emoji 在 Win/安卓/iOS 三端字形不一致，且无法跟随
     按钮前景色；SVG 是文本节点之外的子元素，按钮 textContent 仍是「分享本站」。 */
  var ICON = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" '
    + 'stroke="currentColor" stroke-width="2" stroke-linecap="round" '
    + 'stroke-linejoin="round" aria-hidden="true" focusable="false">'
    + '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/>'
    + '<circle cx="18" cy="19" r="3"/>'
    + '<line x1="8.6" y1="10.6" x2="15.4" y2="6.4"/>'
    + '<line x1="8.6" y1="13.4" x2="15.4" y2="17.6"/></svg>';

  /* 悬停图标：链环（link）——与静止态的「分享节点」图标明显不同，悬停时由
     JS 把图标换成它，做出「鼠标放上去变成另一个图标」的效果（2026-11-14 站长要求，
     与顶栏其余带图标按钮保持一致的 hover 反馈）。同为内联 SVG、currentColor 描边。 */
  var ICON_HOVER = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" '
    + 'stroke="currentColor" stroke-width="2" stroke-linecap="round" '
    + 'stroke-linejoin="round" aria-hidden="true" focusable="false">'
    + '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>'
    + '<path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';

  function isNarrow() {
    if (window.matchMedia) return window.matchMedia(MQ).matches;
    return window.innerWidth <= 640;
  }

  /* ------------------------------------------------------------ 样式 */
  function buildStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = [
      /* 窄屏断点刚切进来、dock 还没建好：先挂 body 藏住，sweep 再搬进 dock，
         绝不把裸按钮留在页面上乱飘（§36s 同款口径）。 */
      '#sxg-share-entry-btn[data-sxg-share-slot="pending"]{display:none !important}',
      /* 临时隐藏（ENABLED=false）：!important 压过手机 dock 的
         `#sxg-fab-dock > *{display:flex !important}`（mobile-fixes.css §36s）。 */
      '#sxg-share-entry-btn[data-sxg-share-hidden="1"]{display:none !important}',
      /* 兜底：任何脚本都不许把顶栏按钮藏起来（§36t）。 */
      '.sxg-share-entry-btn{display:inline-flex !important}',
      /* 复制兜底时的一次性提示气泡（不引入第二套弹窗，只在按钮下方浮一条）。 */
      '#sxg-share-entry-toast{position:fixed;left:50%;bottom:96px;transform:translateX(-50%);'
      + 'z-index:2147483000;background:#0F172A;color:#fff;font-size:13px;line-height:1.6;'
      + 'padding:8px 14px;border-radius:10px;box-shadow:0 8px 24px rgba(15,23,42,.24);'
      + 'opacity:0;transition:opacity .18s ease;pointer-events:none;white-space:nowrap}',
      '#sxg-share-entry-toast[data-show="1"]{opacity:1}'
    ].join('\n');
    (document.head || document.documentElement).appendChild(s);
  }

  function toast(msg) {
    var el = document.getElementById('sxg-share-entry-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'sxg-share-entry-toast';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.setAttribute('data-show', '1');
    window.clearTimeout(toast._t);
    toast._t = window.setTimeout(function () { el.setAttribute('data-show', '0'); }, 2000);
  }

  /* 复制兜底：clipboard 不可用（旧内核 / 非安全上下文）时走 textarea 老路。 */
  function copyText(text, done) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
      return;
    }
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      done(ok);
    } catch (e) { done(false); }
  }

  function openShare() {
    var api = window.SXGShare;
    if (api && typeof api.open === 'function') { api.open(); return; }
    /* 弹窗脚本没就绪：退化为复制地址，用户仍能拿到链接去粘贴。 */
    var url = (api && typeof api.shareUrl === 'function') ? api.shareUrl() : location.href;
    copyText(url, function (ok) { toast(ok ? '链接已复制，可粘贴分享' : '复制失败，请手动复制地址栏链接'); });
  }

  /* ------------------------------------------------------------ 按钮落位 */
  function ensureButton() {
    var btn = document.getElementById(BTN_ID);
    if (btn) return btn;
    btn = document.createElement('a');
    btn.id = BTN_ID;
    btn.className = HEADER_CLASS + ' sxg-share-entry-btn';
    /* 用 button 语义仍留 a 标签？不行：a 无 href 会被键盘跳过。这里给 href="#"
       只为可聚焦与右键复制，真正跳转由 click 拦下（同 appeal 入口口径）。 */
    btn.setAttribute('role', 'button');
    btn.setAttribute('tabindex', '0');
    btn.setAttribute('aria-label', '分享本站（打开分享卡片）');
    /* 窄屏撑开的宽条只有 68px，短标签由 mobile-fixes.css 的 ::after 读取 */
    btn.setAttribute('data-sxg-dock-label', '分享本站');
    /* SVG 是子元素、不产生文本节点 → btn.textContent 仍是「分享本站」 */
    btn.innerHTML = '<span class="sxg-share-ico">' + ICON + '</span>'
      + '<span class="sxg-share-entry-txt">分享本站</span>';
    /* 悬停换图标：静止态展示「分享节点」图标，鼠标移入换成「链环」图标，
       移出还原。用 mouseenter/mouseleave（只在进入/离开时触发一次，不随
       鼠标在按钮内移动重复触发）。静止态仍是 1 枚 svg，不破坏既有断言。 */
    var ico = btn.querySelector('.sxg-share-ico');
    btn.addEventListener('mouseenter', function () { if (ico) ico.innerHTML = ICON_HOVER; });
    btn.addEventListener('mouseleave', function () { if (ico) ico.innerHTML = ICON; });
    btn.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      openShare();
    });
    btn.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openShare(); }
    });
    document.body.appendChild(btn);
    return btn;
  }

  function place() {
    var btn = ensureButton();
    if (ENABLED) {
      btn.style.display = '';
      btn.removeAttribute('data-sxg-share-hidden');
    } else {
      btn.style.display = 'none';
      btn.setAttribute('data-sxg-share-hidden', '1');
    }

    /* 桌面与手机端同口径：分享本站都留在顶栏（2026-11-13 站长口径：手机端
       顶栏四枚 = 提交数据申诉 / Star / 赞助 / 分享本站；其余才收进 dock）。
       桌面紧跟「匿名邮箱」之后；手机端匿名 / Login 已在 dock，锚点退到赞助之后。 */
    var inDock = function (el) { return !!el && !!document.getElementById(DOCK_ID) && el.parentNode === document.getElementById(DOCK_ID); };
    var anchor = document.getElementById(ANON_ID);
    if (isNarrow() || inDock(anchor)) {
      anchor = document.getElementById('sponsor-entry-btn')
        || document.getElementById('login-github-btn');
    }
    /* 桌面兜底：匿名缺失时退 Login → 赞助；与旧逐级兜底口径一致。 */
    if (!anchor) anchor = document.getElementById('login-github-btn')
      || document.getElementById('sponsor-entry-btn');
    if (!anchor) anchor = document.getElementById(ANON_ID);
    if (!anchor || !anchor.parentNode) return false;
    btn.className = HEADER_CLASS + ' sxg-share-entry-btn';
    btn.style.whiteSpace = 'nowrap';
    var targetParent = anchor.parentNode;
    var wantNext = anchor.nextSibling;
    if (targetParent === btn) return true;
    if (wantNext === btn) wantNext = btn.nextSibling;
    if (btn.parentNode !== targetParent || btn.nextSibling !== wantNext) {
      targetParent.insertBefore(btn, wantNext || null);
    }
    btn.setAttribute('data-sxg-share-slot', 'header');
    return true;
  }

  function sweep() {
    try {
      buildStyle();
      place();
    } catch (e) { /* 下游补丁不许因宿主状态异常抛错（第五十章 ④） */ }
  }

  window.addEventListener('resize', sweep);
  var mq = window.matchMedia ? window.matchMedia(MQ) : null;
  if (mq) {
    if (mq.addEventListener) mq.addEventListener('change', sweep);
    else if (mq.addListener) mq.addListener(sweep);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', sweep);
  } else {
    sweep();
  }
  /* 顶栏由 React 渲染、dock 由 fab-dock.js 建，都要等 */
  window.setTimeout(sweep, 600);
  window.setTimeout(sweep, 1500);
  window.setTimeout(sweep, 3000);
  if (window.MutationObserver) {
    var tries = 0;
    var obs = new MutationObserver(function () {
      sweep();
      if (++tries > 80) obs.disconnect();
    });
    try { obs.observe(document.body, { childList: true, subtree: true }); } catch (e) {}
  }

  /* ------------------------------------------------------------ 自测导出 */
  window.SXGShareEntry = {
    BTN_ID: BTN_ID,
    ICON: ICON,
    ICON_HOVER: ICON_HOVER,
    ENABLED: ENABLED,
    openShare: openShare,
    place: place,
    sweep: sweep
  };
})();
