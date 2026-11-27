/*
 * fab-dock.js —— 窄屏悬浮层统一容器（2026-11-12 §36q，§36s 改为全部撑开）
 *
 * 背景（站长「底层架构还是规则没写死」）：
 *   提醒 / 视频 / TOP / ↓到底 / AI 对话 / 悬浮导航，历史上是 6 个互不相干的
 *   脚本各自 appendChild 到 body，各自注入一段
 *     position:fixed; right:14px; bottom:calc(var(--sxg-bar-h) + Npx)
 *   N 各写各的（+48 / +96 / +154 / +210 / +272 / +335），靠人手错开。
 *   于是每加一个功能、换一个屏高、吸底条变高，都要重算六个数，然后大概率
 *   再穿模一次；这些天 §35 → §36g → §36h → §36j → §36p 全是逐点打补丁。
 *
 * 收口方式（本文件，一行源脚本都不改、不碰压缩 bundle）：
 *   1) 本脚本 defer 排在所有悬浮脚本之后，DOMContentLoaded 时把已创建的按钮
 *      「搬」进唯一容器 #sxg-fab-dock；桌面端（>640px）完全不启用。
 *   2) 容器自己只写一次 right / bottom / gap；子项由 mobile-fixes.css
 *      用「#sxg-fab-dock > *」把各自的 fixed + bottom 硬编码整体清成 relative。
 *      以后加第 8 枚：只往下方 ORDER 数组里加一个 id，纵向由 flex 自动排开。
 *   3) §36s：撤掉「更多」折叠层。右列 76px 已经由 §36j 整页隔离（内容不会
 *      进这一列），再藏按钮就是白留一列——现在六枚全部常显，并被 CSS 撑成
 *      带文字的统一宽条。功能一个没删，入口一个没折叠。
 *   4) 容器实时高度写进 --sxg-dock-h，AI 面板 bottom 引用这个变量，
 *      换屏高时面板自动跟随，不再写死 +276px。
 *
 * 断点切换（resize 跨 640px）会双向搬迁：进入窄屏收编，离开窄屏把按钮
 * 原样放回 body —— 源脚本注入的 <style> 从未被修改，移出容器即自动还原。
 * GUESTS 里的 #sxg-anon-mail-btn 由 anon-mail.js 自己安置到顶栏，本文件只在
 * 退出窄屏时先把它还给 body，避免 dock.remove() 把别人的按钮一起删掉。
 */
(function () {
  'use strict';

  var DOCK_ID = 'sxg-fab-dock';
  var MQ      = '(max-width: 640px)';

  /* 从上到下的顺序即 dock 内的排列顺序；全部常显，不再分 PRIMARY / EXTRA。
     2026-11-27 站长打乱手机端顺序：顶部最上、滑到底部最下、版本号垫在它下面。
     视觉顺序由 mobile-fixes.css 的 flex order 决定，本数组保持历史顺序不变
     （PC 端原样还原、既有校验都依赖它），只是新增末尾的版本号节点。 */
  var ORDER  = [
    'sxg-nav',            // 导航容器（手机端隐藏，四项已提升为一级）
    'sxg-remind-btn',     // 提醒
    'sxg-video-btn',      // 视频
    'sxg-bottom-btn',     // 滑到底部
    'sxg-ai-fab',         // AI 劳动法小助手
    'sxg-top-btn'         // 回顶部
  ];
  /* 2026-11-27 站长：手机端取消 ☰ 折叠，导航面板里的项提升为 dock 一级按钮。 */
  var NAV_ITEMS = [
    'sxg-nav-evidence',   // 证据链公示
    'sxg-nav-projects',   // 同类项目导航
    'sxg-nav-stories',    // 成功案例
    'sxg-nav-notes'       // 手气不错
  ];
  var VER_ID   = 'sxg-nav-ver';  // 版本号节点，从面板提升到 dock 最底
  /* 外部组件挂进 dock 的入口：不归本文件 fill() 管，但退出窄屏时要还给 body。
     2026-11-13 站长口径：手机端顶栏只留 提交数据/Star/赞助/分享本站 四枚，
     Login GitHub 与匿名邮箱一起收进右侧 dock（桌面端六枚顺序不动）。 */
  var GUESTS = ['sxg-anon-mail-btn', 'login-github-btn'];
  var ALL    = ORDER.concat(GUESTS);

  /* 撑开的宽条只有 68px，统一用中文短标签；标签是 CSS ::after 的唯一真相源，
     源脚本里的「TOP」/「AI」/ 纯 SVG 一律由 mobile-fixes.css 收起。 */
  var LABELS = {
    'sxg-nav':            '☰ 导航',
    'sxg-remind-btn':     '提醒',
    'sxg-video-btn':      '▶ 视频',
    'sxg-bottom-btn':     '↓ 到底',
    'sxg-ai-fab':         'AI 对话',
    'sxg-top-btn':        '↑ 顶部',
    'sxg-nav-evidence':   '证据链',
    'sxg-nav-projects':   '同类项目',
    'sxg-nav-stories':    '成功案例',
    'sxg-nav-notes':      '手气不错',
    'sxg-nav-ver':        '当前版本',
    'login-github-btn':   '登录'
  };

  var dock = null;
  var observer = null, ro = null, listening = false;

  function isMobile() {
    if (window.matchMedia) return window.matchMedia(MQ).matches;
    return window.innerWidth <= 640;
  }

  function syncHeight() {
    if (!dock) return;
    /* dock 的 bottom 是 bar+14；面板要落在 dock 顶边之上 10px，
       所以把整个 dock 高度交给 CSS var，别再写死「+276px」这类魔数。 */
    var h = Math.round(dock.getBoundingClientRect().height);
    document.documentElement.style.setProperty('--sxg-dock-h', h + 'px');
  }

  /* 2026-11-27 滚动错位修复（站长连报多次，真机复现）：
     现象——首屏打开 dock 整列溢出屏幕（要先下滑才看得全）；下滑后再上滑，
     dock 整体上移并「锁死」，再下滑也不跟随。
     根因——① 17 枚按钮×36px + 16×6px gap = 666px，真机地址栏展开时可视高
     常只有 ~600px，整列放不下；② CSS 的 top:50% 参照 layout viewport（innerHeight
     在地址栏收放时不变），而用户看到的是 visualViewport（会随地址栏收放变化），
     两者脱节导致 fixed 的 dock 相对可视区错位、且上滑后不再跟随。
     修法——用 visualViewport 的 offsetTop + height/2 实时算可视区中线写进
     --sxg-dock-top（CSS top 从 50% 切到这个变量；translateY(-50%) 不变）；
     再按可视高度压缩 --sxg-dock-btn-h，保证整列 + 上下留白永远装得下。
     监听 visualViewport 的 scroll/resize + window scroll/resize，rAF 节流。 */
  var vpTicking = false;
  function syncViewport() {
    if (!dock || !isMobile()) return;
    var vv = window.visualViewport;
    var vh = vv ? vv.height : window.innerHeight;
    var vtop = vv ? vv.offsetTop : 0;
    if (!vh || vh <= 0) return;
    var root = document.documentElement;
    /* 中线：可视区顶部偏移 + 一半高度（像素），覆盖 CSS 的 50% 回退值 */
    root.style.setProperty('--sxg-dock-top', Math.round(vtop + vh / 2) + 'px');

    /* 自适应按钮高度：整列要装进可视高，上下各留 12px。
       N 枚 × h + (N-1) × 6px gap <= vh - 24 → h = floor((vh-24-(N-1)*6)/N)
       限制在 [26,36]：低于 26 单行 12px 文字会挤，高于 36 保持原设计。 */
    /* 数真正显示的一级按钮：#sxg-nav 容器 display:none 不占 flex 空间也不占 gap，
       必须从计数里排除，否则 h 会偏小、留白过多。 */
    var n = 0;
    for (var ci = 0; ci < dock.children.length; ci++) {
      var child = dock.children[ci];
      if (child.id !== 'sxg-nav' && window.getComputedStyle(child).display !== 'none') n++;
    }
    if (!n) n = 16; // 空集兜底（防空集恒真）
    var gap = 6, margin = 12;
    var h = Math.floor((vh - 2 * margin - (n - 1) * gap) / n);
    h = Math.max(26, Math.min(36, h));
    root.style.setProperty('--sxg-dock-btn-h', h + 'px');
  }
  function onViewportChange() {
    if (vpTicking) return;
    vpTicking = true;
    window.requestAnimationFrame(function () {
      vpTicking = false;
      syncViewport();
      syncHeight();
    });
  }

  /* 2026-11-27 站长：手机端取消 ☰ 折叠，把导航面板里的四项 + 版本号提升到
     dock 当一级按钮。它们原本是 #sxg-nav-panel 的子节点，这里连同容器一起搬；
     disable() 时原样还回面板，PC 端布局逐像素不变。 */
  var NAV_ALL = NAV_ITEMS.concat([VER_ID]);

  function liftNavItems() {
    if (!dock) return;
    var panel = document.getElementById('sxg-nav-panel');
    NAV_ALL.forEach(function (id) {
      var el = document.getElementById(id);
      if (!el || !panel) return;
      el.setAttribute('data-sxg-dock-label', LABELS[id]);
      if (el.parentNode !== dock) dock.appendChild(el);
    });
  }

  /* 把清单里已存在的按钮补进容器；返回仍缺失的个数。
     源脚本有的在 DOMContentLoaded 里同步建、有的点开才建子项，
     所以这里既在挂载时调一次，也由 MutationObserver 反复调。 */
  function fill() {
    if (!dock) return ORDER.length;
    var missing = 0, i, el;
    for (i = 0; i < ORDER.length; i++) {
      el = document.getElementById(ORDER[i]);
      if (!el) { missing++; continue; }
      /* #sxg-nav 是容器，真正显示的是里面的 #sxg-nav-fab */
      var labelEl = (ORDER[i] === 'sxg-nav')
        ? (document.getElementById('sxg-nav-fab') || el)
        : el;
      labelEl.setAttribute('data-sxg-dock-label', LABELS[ORDER[i]]);
      if (el.parentNode !== dock) dock.appendChild(el);
    }
    // 手机端：四项 + 版本号提升为 dock 一级（顺序由 CSS flex order 决定）
    liftNavItems();
    /* 客居入口（匿名邮箱 / Login GitHub）：归属不归本文件，但短标签同样由
       LABELS 补齐；只打标签，不主动搬入（它们自己的脚本会安置进 dock）。 */
    for (i = 0; i < GUESTS.length; i++) {
      var guest = document.getElementById(GUESTS[i]);
      if (guest && LABELS[GUESTS[i]]) {
        guest.setAttribute('data-sxg-dock-label', LABELS[GUESTS[i]]);
      }
    }
    syncHeight();
    syncViewport();
    return missing;
  }

  function watch() {
    if (observer || typeof MutationObserver === 'undefined') return;
    observer = new MutationObserver(function () {
      if (!dock) return;
      if (fill() === 0) { observer.disconnect(); observer = null; }
    });
    observer.observe(document.body, { childList: true, subtree: false });
  }

  function bindGlobal() {
    if (listening) return;
    listening = true;
    window.addEventListener('resize', onViewportChange);
    /* 真机「下滑→上滑锁死」核心：地址栏收放只改 visualViewport，不触发 innerHeight
       resize，必须单独监听 visualViewport 的 scroll / resize 才能纠正位置。 */
    window.addEventListener('scroll', onViewportChange, { passive: true });
    var vv = window.visualViewport;
    if (vv) {
      vv.addEventListener('scroll', onViewportChange, { passive: true });
      vv.addEventListener('resize', onViewportChange, { passive: true });
    }
    var m = window.matchMedia ? window.matchMedia(MQ) : null;
    if (m) {
      var onBp = function () { if (isMobile()) enable(); else disable(); };
      if (m.addEventListener) m.addEventListener('change', onBp);
      else if (m.addListener) m.addListener(onBp);
    }
  }

  function enable() {
    if (dock || !isMobile() || !document.body) return;
    dock = document.createElement('div');
    dock.id = DOCK_ID;
    document.body.appendChild(dock);

    var missing = fill();
    if (missing) watch();

    if (window.ResizeObserver) {
      ro = new ResizeObserver(onViewportChange);
      ro.observe(dock);
    }
    bindGlobal();
  }

  function disable() {
    if (!dock) return;
    /* 原样放回 body：源脚本 <style> 没被改过，移出容器后各自的
       position:fixed / bottom 立即恢复，桌面端布局与改造前逐像素一致。 */
    for (var i = 0; i < ORDER.length; i++) {
      var el = document.getElementById(ORDER[i]);
      if (!el) continue;
      var labelEl = (ORDER[i] === 'sxg-nav')
        ? (document.getElementById('sxg-nav-fab') || el)
        : el;
      labelEl.removeAttribute('data-sxg-dock-label');
      if (dock.contains(el)) document.body.appendChild(el);
    }
    /* 客居按钮只还给 body，标签留着无妨（桌面端不显示 dock）。 */
    for (var j = 0; j < GUESTS.length; j++) {
      var guest = document.getElementById(GUESTS[j]);
      if (guest && dock.contains(guest)) document.body.appendChild(guest);
    }
    /* 2026-11-27：提升为一级的四项 + 版本号还原回导航面板，PC 端折叠原样。 */
    var panel = document.getElementById('sxg-nav-panel');
    NAV_ALL.forEach(function (id) {
      var el = document.getElementById(id);
      if (el && panel && dock.contains(el)) {
        el.removeAttribute('data-sxg-dock-label');
        panel.appendChild(el);
      }
    });
    if (observer) { observer.disconnect(); observer = null; }
    if (ro) { ro.disconnect(); ro = null; }
    dock.remove();
    dock = null;
    document.documentElement.style.removeProperty('--sxg-dock-h');
    document.documentElement.style.removeProperty('--sxg-dock-top');
    document.documentElement.style.removeProperty('--sxg-dock-btn-h');
  }

  function boot() {
    bindGlobal();
    if (isMobile()) enable();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
