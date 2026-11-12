/* ==========================================================================
   anon-mail.js —— 「匿名邮箱」入口 + 访问前告知弹窗（2026-11-12 §36s）
   --------------------------------------------------------------------------
   站长指令（口径）：右上角新增「匿名邮箱」按钮，指向 https://m.kuku.lu/cn.php；
   点击**先弹窗**明确告知「没有 VPN 就无法访问」，同时在弹窗里备注站长最新
   匿名邮箱 mantoopea@exdonuts.com。手机端落位由本文件按断点自行处理。

   纪律（沿用 §36q / §36r 的下游补丁思路）：
     · 不改压缩 bundle，不改六个悬浮脚本，不改 header-menu-patch.js。
     · 桌面：顶栏插一枚 .sxg-header-btn（贴在 Login GitHub 之后）。
     · ≤640px：不占顶栏、也不塞进「菜单▼」——直接挂进右侧那条已经隔离的
       #sxg-fab-dock（§36j 的 body padding-right:76px 留白列），与其余悬浮
       按钮一起被 mobile-fixes.css 撑成统一宽条。这样断点切换时入口不会
       被 .sxg-header-btn{display:none !important} 静默吃掉（第五十章 ①）。
     · fab-dock.js 的 disable() 会把本按钮先还给 body，本文件 resize / 观察器
       再把它安置回顶栏；桌面端不启用 dock，六枚原位不变。
     · 目标链接只在弹窗「仍要前往」这一个出口里，首次点击必须 preventDefault
       + 弹窗，绝不静默跳走。
   ========================================================================== */
(function () {
  'use strict';

  var SITE_URL  = 'https://m.kuku.lu/cn.php';
  var MAIL      = 'mantoopea@exdonuts.com';
  var BTN_ID    = 'sxg-anon-mail-btn';
  var MODAL_ID  = 'sxg-anon-mail-modal';
  var STYLE_ID  = 'sxg-anon-mail-style';
  var DOCK_ID   = 'sxg-fab-dock';
  var MQ        = '(max-width: 640px)';
  /* 2026-11-12 站长要求临时隐藏「匿名邮箱」入口：保留全部代码与落位逻辑不删除，
     仅设为不可见、不可点击。需恢复时把 ENABLED 改为 true 即可（一处改动）。 */
  var ENABLED   = false;
  /* 顶栏按钮的外观基线（取自 Star 按钮真实 class）。不能现场读 Star：
     手机端 header-menu-patch 会把它的 class 整个摘掉，断点切回桌面时现场
     读到的是空串，按钮就退化成 14px 裸链接（§36s 真渲染实测）。 */
  var HEADER_CLASS = 'inline-flex items-center gap-1.5 text-xs sm:text-sm '
    + 'bg-slate-900 hover:bg-slate-800 text-white px-3 py-1.5 rounded-lg '
    + 'font-medium shadow-sm transition sxg-header-btn';

  function isNarrow() {
    if (window.matchMedia) return window.matchMedia(MQ).matches;
    return window.innerWidth <= 640;
  }

  function findStar() {
    var list = document.querySelectorAll('a');
    for (var i = 0; i < list.length; i++) {
      if ((list[i].textContent || '').indexOf('Star on GitHub') >= 0) return list[i];
    }
    return null;
  }

  /* ------------------------------------------------------------ 样式 */
  function buildStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = [
      '#sxg-anon-mail-btn[data-sxg-anon-slot="pending"]{display:none !important}',
      /* 临时隐藏（ENABLED=false）：用 !important 压过手机 dock 的
         `#sxg-fab-dock > *{display:flex !important}`（mobile-fixes.css §36s），
         否则手机端按钮仍会被 dock 规则显示出来。桌面顶栏无此规则，inline 即可。 */
      '#sxg-anon-mail-btn[data-sxg-anon-hidden="1"]{display:none !important}',
      '#' + MODAL_ID + '{position:fixed;inset:0;z-index:10050;box-sizing:border-box;',
      '  background:rgba(15,23,42,.48);display:flex;align-items:center;',
      '  justify-content:center;padding:16px;}',
      '#' + MODAL_ID + ' .sxg-am-card{box-sizing:border-box;width:min(420px,100%);',
      '  max-height:86vh;overflow-y:auto;background:#fff;border-radius:16px;',
      '  padding:20px;box-shadow:0 20px 60px rgba(15,23,42,.3);',
      '  font:14px/1.6 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;}',
      '#' + MODAL_ID + ' .sxg-am-hd{display:flex;align-items:center;',
      '  justify-content:space-between;gap:10px;margin-bottom:12px;}',
      '#' + MODAL_ID + ' .sxg-am-hd h3{margin:0;font-size:17px;color:#0f172a;}',
      '#' + MODAL_ID + ' .sxg-am-x{border:none;background:#f1f5f9;color:#64748b;',
      '  width:30px;height:30px;border-radius:8px;font-size:20px;line-height:1;cursor:pointer;}',
      '#' + MODAL_ID + ' .sxg-am-warn{margin:0 0 14px;padding:11px 12px;',
      '  border:1px solid #fecaca;border-left:3px solid #dc2626;border-radius:10px;',
      '  background:#fef2f2;color:#7f1d1d;font-size:13px;line-height:1.7;}',
      '#' + MODAL_ID + ' .sxg-am-warn b{display:block;font-size:14px;margin-bottom:3px;}',
      '#' + MODAL_ID + ' .sxg-am-label{display:block;margin-bottom:6px;',
      '  font-size:12px;color:#64748b;}',
      '#' + MODAL_ID + ' .sxg-am-mail{display:flex;align-items:center;gap:8px;',
      '  flex-wrap:wrap;background:#f8fafc;border:1px solid #e2e8f0;',
      '  border-radius:10px;padding:10px 12px;}',
      '#' + MODAL_ID + ' .sxg-am-mail code{flex:1 1 auto;min-width:0;',
      '  word-break:break-all;color:#0F766E;',
      '  font:600 13.5px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;}',
      '#' + MODAL_ID + ' .sxg-am-copy{flex:none;border:1px solid #0F766E;',
      '  background:#fff;color:#0F766E;border-radius:8px;padding:6px 10px;',
      '  font-size:12.5px;cursor:pointer;}',
      '#' + MODAL_ID + ' .sxg-am-note{margin:10px 0 16px;font-size:12px;',
      '  color:#94a3b8;line-height:1.6;}',
      '#' + MODAL_ID + ' .sxg-am-acts{display:flex;gap:10px;}',
      '#' + MODAL_ID + ' .sxg-am-acts > *{flex:1;display:inline-flex;',
      '  align-items:center;justify-content:center;padding:11px 8px;',
      '  border-radius:10px;font-size:14px;font-weight:600;',
      '  text-decoration:none;cursor:pointer;box-sizing:border-box;}',
      '#' + MODAL_ID + ' .sxg-am-cancel{background:#f1f5f9;color:#475569;',
      '  border:1px solid #e2e8f0;}',
      '#' + MODAL_ID + ' .sxg-am-go{background:#0F766E;color:#fff;',
      '  border:1px solid #0F766E;}',
      '@media (max-width:360px){#' + MODAL_ID + ' .sxg-am-acts{flex-direction:column;}}'
    ].join('');
    (document.head || document.documentElement).appendChild(s);
  }

  /* ------------------------------------------------------------ 弹窗 */
  function closeModal() {
    var m = document.getElementById(MODAL_ID);
    if (m && m.parentNode) m.parentNode.removeChild(m);
  }

  function fallbackCopy(btn, done) {
    var ok = false;
    try {
      var ta = document.createElement('textarea');
      ta.value = MAIL;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;left:-9999px;top:0;';
      document.body.appendChild(ta);
      ta.select();
      ok = document.execCommand && document.execCommand('copy');
      document.body.removeChild(ta);
    } catch (e) { ok = false; }
    done(!!ok);
  }

  function copyMail(btn) {
    function done(ok) {
      var old = btn.textContent;
      btn.textContent = ok ? '已复制' : '复制失败';
      if (window.setTimeout) {
        window.setTimeout(function () { btn.textContent = old; }, 1600);
      }
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(MAIL).then(
          function () { done(true); },
          function () { fallbackCopy(btn, done); }
        );
        return;
      }
    } catch (e) { /* 落到兜底 */ }
    fallbackCopy(btn, done);
  }

  function openModal() {
    closeModal();
    var wrap = document.createElement('div');
    wrap.id = MODAL_ID;
    wrap.setAttribute('data-sxg-anon-modal', '1');

    var card = document.createElement('div');
    card.className = 'sxg-am-card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-label', '匿名邮箱访问提示');
    card.innerHTML =
      '<div class="sxg-am-hd"><h3>匿名邮箱</h3>'
      + '<button type="button" class="sxg-am-x" aria-label="关闭">×</button></div>'
      + '<div class="sxg-am-warn"><b>没有 VPN（或代理）就无法访问</b>'
      + '这个临时邮箱站点在境外，大陆网络直接点开通常只会一直转圈或显示连接失败。'
      + '请先确认自己有可用的网络环境，再决定要不要过去。</div>'
      + '<span class="sxg-am-label">站长最新匿名邮箱</span>'
      + '<div class="sxg-am-mail"><code data-sxg-anon-mail="' + MAIL + '">' + MAIL + '</code>'
      + '<button type="button" class="sxg-am-copy">复制邮箱</button></div>'
      + '<p class="sxg-am-note">目标站点 m.kuku.lu 是境外临时邮箱服务；'
      + '若以后更换地址，以这里显示为准。</p>'
      + '<div class="sxg-am-acts">'
      + '<button type="button" class="sxg-am-cancel">先不去</button>'
      + '<a class="sxg-am-go" href="' + SITE_URL + '" target="_blank" '
      + 'rel="noopener noreferrer">仍要前往 ↗</a>'
      + '</div>';

    card.querySelector('.sxg-am-x').addEventListener('click', closeModal);
    card.querySelector('.sxg-am-cancel').addEventListener('click', closeModal);
    card.querySelector('.sxg-am-go').addEventListener('click', function () { closeModal(); });
    card.querySelector('.sxg-am-copy').addEventListener('click', function () { copyMail(this); });

    wrap.appendChild(card);
    wrap.addEventListener('click', function (ev) { if (ev.target === wrap) closeModal(); });
    document.body.appendChild(wrap);
  }

  /* ------------------------------------------------------------ 按钮落位 */
  function ensureButton() {
    var btn = document.getElementById(BTN_ID);
    if (btn) return btn;
    btn = document.createElement('a');
    btn.id = BTN_ID;
    btn.href = SITE_URL;
    btn.target = '_blank';
    btn.rel = 'noopener noreferrer';
    btn.setAttribute('aria-label', '匿名邮箱（先阅读访问提示）');
    /* 窄屏撑开的宽条只有 68px，短标签由 mobile-fixes.css 的 ::after 读取 */
    btn.setAttribute('data-sxg-dock-label', '匿名邮箱');
    btn.textContent = '匿名邮箱';
    /* 首次点击一律拦下来先弹窗；目标链接只在「仍要前往」出口放行。 */
    btn.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      var menu = document.getElementById('sxg-header-menu');
      if (menu) menu.classList.remove('is-open');
      openModal();
    });
    document.body.appendChild(btn);
    return btn;
  }

  function place() {
    var btn = ensureButton();
    /* 隐藏模式：仍执行下方落位逻辑，保持 DOM 结构与上游架构层不变
       （test-anon-mail.cjs 的落位断言依赖 slot / class / 相邻节点，不能跳过）。
       仅把按钮设为不可见、不可点击；ENABLED=false 时生效。 */
    if (ENABLED) {
      btn.style.display = '';
      btn.removeAttribute('data-sxg-anon-hidden');
    } else {
      btn.style.display = 'none';
      btn.setAttribute('data-sxg-anon-hidden', '1');
    }
    if (isNarrow()) {
      var dock = document.getElementById(DOCK_ID);
      btn.classList.remove('sxg-header-btn');
      btn.className = 'sxg-anon-mail-entry';
      if (dock) {
        /* 插在最上：新入口在撑开的宽条列里排第一，其余六枚由 fab-dock.js 排好。 */
        if (btn.parentNode !== dock) dock.insertBefore(btn, dock.firstChild);
        btn.setAttribute('data-sxg-anon-slot', 'dock');
      } else {
        /* dock 还没建好（断点刚切进窄屏）：先挂 body 藏起来，
           下一轮 sweep 在 dock 出现后立刻搬进去，不留在顶栏被隐藏规则吃掉。 */
        if (btn.parentNode !== document.body) document.body.appendChild(btn);
        btn.setAttribute('data-sxg-anon-slot', 'pending');
      }
      return true;
    }

    var anchor = document.getElementById('login-github-btn') || findStar();
    if (!anchor || !anchor.parentNode) return false;
    btn.className = HEADER_CLASS;
    btn.style.backgroundColor = '#0F766E';
    btn.style.color = '#ffffff';
    btn.style.borderColor = '#0F766E';
    /* 中等宽度顶栏会把四个字折成两行，本按钮保持单行避免挤坏整排 */
    btn.style.whiteSpace = 'nowrap';

    /* 正常桌面载入：插在 Login GitHub 之后。若页面是手机端载入后拉宽、
       上游还没把按钮还原出下拉容器，就退到下拉容器的父级（顶栏本体），
       插在「菜单▼」之前，绝不跟着一起竖排。 */
    var menu = document.getElementById('sxg-header-menu');
    var toggle = document.getElementById('sxg-header-menu-toggle');
    var targetParent = anchor.parentNode;
    var wantNext = anchor.nextSibling;
    if (menu && anchor.parentNode === menu && menu.parentNode) {
      targetParent = menu.parentNode;
      wantNext = (toggle && toggle.parentNode === targetParent) ? toggle : null;
    }
    if (wantNext === btn) wantNext = btn.nextSibling;
    if (btn.parentNode !== targetParent || btn.nextSibling !== wantNext) {
      targetParent.insertBefore(btn, wantNext || null);
    }
    btn.setAttribute('data-sxg-anon-slot', 'header');
    return true;
  }

  function sweep() {
    try {
      buildStyle();
      place();
    } catch (e) { /* 下游补丁不许因宿主状态异常抛错（第五十章 ④） */ }
  }

  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') closeModal();
  });
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
  window.SXGAnonMail = {
    SITE_URL: SITE_URL,
    MAIL: MAIL,
    BTN_ID: BTN_ID,
    MODAL_ID: MODAL_ID,
    openModal: openModal,
    closeModal: closeModal,
    place: place,
    sweep: sweep
  };
})();
