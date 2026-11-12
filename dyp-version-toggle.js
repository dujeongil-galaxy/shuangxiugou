/* ==========================================================================
   dyp-version-toggle.js —— 首页「劳工友好提醒」弹窗 新版 / 旧版 转换按钮
   --------------------------------------------------------------------------
   站长指令（2026-11-12）：首页弹窗（douyin-prompt.js 的 .dyp）当前是「旧版」
   （在抖音中观看 + 事实核查 + 站长随笔）。站长要在顶栏「Star on GitHub」与
   「赞助」之间的位置（此前匿名邮箱按钮的落点）放一枚「转换按钮」，用来在
   「新版」与「旧版」之间切换：

     默认（新版）：2 个抖音链接 + 站长随笔
       [比亚迪·抖音短片] [理想L8·抖音短片] [站长随笔]
       —— 第二按钮不再显示「事实核查」（事实核查入口隐藏，不删除）。
     旧版：在抖音中观看 + 事实核查 + 站长随笔（恢复原样）。

   转换按钮文案随当前版本翻转：
     显示新版（默认）→ 按钮写「替换旧版」（点它切到旧版）
     显示旧版        → 按钮写「新版本」（点它切到新版）

   实现纪律（沿用 anon-mail.js 的下游补丁思路）：
     · 不改压缩 bundle、不改 douyin-prompt.js / factcheck-button.js 本体；
       本文件只「补丁」.dyp__acts：切 display / 改文本与 href / 增删一枚
       自有锚点 .dyp__douyin2；绝不删除 factcheck-button.js 注入的 .dyp__factcheck。
     · 顶栏落位照抄 anon-mail.js（贴在 Login GitHub 之后；≤640px 进 #sxg-fab-dock）。
     · 版本记忆在 localStorage（默认 new）；弹窗 2.5s 才 build，用 MutationObserver
       + 定时 sweep + 500ms 轮询三重兜底抓取插入时机，幂等可重入。
   ========================================================================== */
(function () {
  'use strict';

  var BTN_ID     = 'sxg-dyp-toggle-btn';
  var STYLE_ID   = 'sxg-dyp-toggle-style';
  var DOCK_ID    = 'sxg-fab-dock';
  var MQ         = '(max-width: 640px)';
  var STORAGE_KEY = 'dyp_version_toggle_v1';

  // 新版两个抖音链接（取自站长提供的分享短链）
  var BYD = 'https://v.douyin.com/_n2cFrXIRec/';   // 比亚迪·前后轮辋装反了
  var L8  = 'https://v.douyin.com/EHOOH9INCMk/';   // 理想L8·高速方向盘拉不动
  // 旧版「在抖音中观看」链接（恢复用，取自 douyin-prompt.js CONFIG.link）
  var OLD_GO_HREF = 'https://v.douyin.com/37pbo6qxUbs/';
  var OLD_GO_TEXT = '在抖音中观看';

  // 顶栏按钮外观基线（照抄 anon-mail.js：不可现场读 Star，断点切回会退化）
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

  function getVersion() {
    var v = null;
    try { v = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    return v === 'old' ? 'old' : 'new';
  }

  function setVersion(v) {
    try { localStorage.setItem(STORAGE_KEY, v); } catch (e) {}
  }

  function labelFor(v) { return v === 'new' ? '替换旧版' : '新版本'; }

  function titleFor(v) {
    return v === 'new'
      ? '当前：新版弹窗（2 个抖音链接 + 站长随笔）。点击切换回旧版（含事实核查）'
      : '当前：旧版弹窗（在抖音中观看 + 事实核查 + 站长随笔）。点击切换到新版';
  }

  /* ---- 注入样式：仅 .dyp__douyin2 配色 + 窄屏顺序；尺寸沿用 .dyp__acts > * ---- */
  function buildStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent =
      '.dyp__douyin2{' +
        'border:1px solid #4fb389;background:#d9efe5;color:#175e48;' +
        'text-decoration:none;' +
        'transition:background .15s ease,color .15s ease,border-color .15s ease;' +
      '}' +
      '.dyp__douyin2:hover{background:#c9e8db;border-color:#3ea87c;color:#0f4a37}' +
      '.dyp__douyin2:active{transform:scale(.98)}' +
      '@media (max-width:520px){.dyp__douyin2{order:1}}';
    (document.head || document.documentElement).appendChild(s);
  }

  /* ---- 核心：把 .dyp__acts 调成目标版本（幂等可重入）---- */
  var appliedVersion = null;
  function applyDyp(version) {
    var acts = document.querySelector('.dyp__acts');
    if (!acts) return false;
    var go = acts.querySelector('.dyp__go');
    var later = acts.querySelector('.dyp__later');
    var fact = acts.querySelector('.dyp__factcheck');
    var d2 = acts.querySelector('.dyp__douyin2');

    if (version === 'new') {
      if (go) { go.textContent = '比亚迪·抖音短片'; go.href = BYD; }
      // 事实核查入口：隐藏而非删除（factcheck-button.js 注入的节点保留在 DOM）
      if (fact) fact.style.display = 'none';
      if (!d2 && later) {
        d2 = document.createElement('a');
        d2.className = 'dyp__douyin2';
        d2.href = L8;
        d2.target = '_blank';
        d2.rel = 'noopener noreferrer';
        d2.textContent = '理想L8·抖音短片';
        acts.insertBefore(d2, later);
      } else if (d2) {
        d2.href = L8;
        d2.textContent = '理想L8·抖音短片';
      }
    } else {
      if (go) { go.textContent = OLD_GO_TEXT; go.href = OLD_GO_HREF; }
      if (fact) fact.style.display = '';
      if (d2 && d2.parentNode) d2.parentNode.removeChild(d2);
    }
    appliedVersion = version;
    return true;
  }

  /* ---- 转换按钮 ---- */
  function ensureButton() {
    var btn = document.getElementById(BTN_ID);
    if (btn) return btn;
    btn = document.createElement('a');
    btn.id = BTN_ID;
    btn.href = '#';
    btn.setAttribute('role', 'button');
    btn.setAttribute('aria-label', '切换首页视频弹窗版本（新版 / 旧版）');
    btn.setAttribute('data-sxg-dock-label', labelFor(getVersion()));
    btn.addEventListener('click', function (ev) {
      ev.preventDefault();
      var v = getVersion() === 'new' ? 'old' : 'new';
      setVersion(v);
      updateBtn(btn, v);
      applyDyp(v);
      // 若弹窗还没 build（2.5s 延迟），applyDyp 返回 false 也无妨，
      // 定时轮询与 observer 会在弹窗出现后自动按当前版本应用。
    });
    document.body.appendChild(btn);
    return btn;
  }

  function updateBtn(btn, v) {
    btn.textContent = labelFor(v);
    btn.setAttribute('title', titleFor(v));
    btn.setAttribute('data-sxg-dock-label', labelFor(v));
  }

  function place() {
    var btn = ensureButton();
    updateBtn(btn, getVersion());
    if (isNarrow()) {
      var dock = document.getElementById(DOCK_ID);
      btn.classList.remove('sxg-header-btn');
      if (dock) {
        if (btn.parentNode !== dock) dock.insertBefore(btn, dock.firstChild);
      } else {
        if (btn.parentNode !== document.body) document.body.appendChild(btn);
      }
      return true;
    }
    var anchor = document.getElementById('login-github-btn') || findStar();
    if (!anchor || !anchor.parentNode) return false;
    btn.className = HEADER_CLASS;
    btn.style.backgroundColor = '#0F766E';
    btn.style.color = '#ffffff';
    btn.style.borderColor = '#0F766E';
    btn.style.whiteSpace = 'nowrap';
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
    return true;
  }

  function sweep() {
    try { buildStyle(); place(); } catch (e) { /* 下游补丁不许因宿主异常抛错 */ }
  }

  /* ---- 启动：落位 + 三重兜底观察弹窗 build / factcheck 注入 ---- */
  function boot() {
    sweep();
    try { applyDyp(getVersion()); } catch (e) {}
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
  window.setTimeout(sweep, 600);
  window.setTimeout(sweep, 1500);
  window.setTimeout(sweep, 3000);

  // 弹窗 2.5s 才 build，factcheck 也在之后注入；用 observer 即时（同帧）应用，
  // 避免事实核查闪一下才被隐藏。MutationObserver 回调在下一帧绘制前作为微任务
  // 一次性 flush，所以「factcheck 注入 + 我隐藏它」会落在同一帧前，无闪烁。
  if (window.MutationObserver) {
    var obsTries = 0;
    var obs = new MutationObserver(function () {
      try { applyDyp(getVersion()); } catch (e) {}
      sweep();
      if (++obsTries > 400) obs.disconnect();
    });
    try { obs.observe(document.body, { childList: true, subtree: true }); } catch (e) {}
  }

  // 保险：500ms 轮询，直到弹窗出现并稳定 30 拍（约 15s）后停。
  // 即使 observer 在 React 首屏渲染期把次数耗尽，这条也能兜住 2.5s 后的弹窗。
  var stableCount = 0;
  var applyTimer = window.setInterval(function () {
    try {
      if (applyDyp(getVersion())) {
        stableCount += 1;
        if (stableCount > 30) { window.clearInterval(applyTimer); applyTimer = null; }
      }
    } catch (e) {}
  }, 500);
  window.setTimeout(function () {
    if (applyTimer) { window.clearInterval(applyTimer); applyTimer = null; }
  }, 15000);

  /* ---- 自测导出 ---- */
  window.SXGDypToggle = {
    BTN_ID: BTN_ID,
    STORAGE_KEY: STORAGE_KEY,
    BYD: BYD, L8: L8, OLD_GO_HREF: OLD_GO_HREF, OLD_GO_TEXT: OLD_GO_TEXT,
    getVersion: getVersion,
    setVersion: setVersion,
    labelFor: labelFor,
    applyDyp: applyDyp,
    updateBtn: updateBtn,
    place: place,
    sweep: sweep,
    ensureButton: ensureButton
  };
})();
