/*
 * fab-dock.js —— 窄屏悬浮层统一容器（2026-11-12 §36q）
 *
 * 背景（站长「底层架构还是规则没写死」）：
 *   提醒 / 视频 / TOP / ↓到底 / AI 对话 / 悬浮导航，历史上是 6 个互不相干的
 *   脚本各自 appendChild 到 body，各自注入一段
 *     position:fixed; right:14px; bottom:calc(var(--sxg-bar-h) + Npx)
 *   N 各写各的（+48 / +96 / +154 / +210 / +272 / +335），靠人手错开。
 *   于是每加一个功能、换一个屏高、吸底条变高，都要重算六个数，然后大概率
 *   再穿模一次；这些天 §35 → §36g → §36h → §36j → §36p 全是逐点打补丁。
 *
 * 收口方式（本文件）：
 *   1) 不改任何源脚本、不碰压缩 bundle。本脚本 defer 排在所有悬浮脚本之后，
 *      在 DOMContentLoaded 时把已创建的 6 枚按钮「搬」进唯一容器
 *      #sxg-fab-dock；桌面端（>640px）完全不启用，六枚仍按原脚本定位。
 *   2) 容器自己只写一次 right / bottom / gap；子项由 mobile-fixes.css
 *      用「#sxg-fab-dock > *」把各自的 fixed + bottom 硬编码整体清成 relative。
 *      以后加第 7 枚：只需往下方 PRIMARY 或 EXTRA 数组里加一个 id，
 *      纵向由 flex 自动排开，永远不用再算 bottom。
 *   3) 低频的 4 枚（导航 / 提醒 / 视频 / ↓到底）收进「更多」折叠层，
 *      常驻只留 AI 对话、回顶部两枚 + 切换钮。功能一个没删，只是换入口。
 *   4) 容器实时高度写进 --sxg-dock-h，AI 面板 bottom 引用这个变量，
 *      展开 / 折叠 / 换屏高时面板自动跟随，不再写死 +276px。
 *
 * 断点切换（resize 跨 640px）会双向搬迁：进入窄屏收编，离开窄屏把按钮
 * 原样放回 body —— 源脚本注入的 <style> 从未被修改，移出容器即自动还原。
 */
(function () {
  'use strict';

  var DOCK_ID   = 'sxg-fab-dock';
  var MORE_ID   = 'sxg-fab-more';
  var EXTRA_ID  = 'sxg-fab-dock-extra';
  var MQ        = '(max-width: 640px)';

  /* 常驻：主推功能 + 高频操作。顺序即 dock 内从下往上的排布顺序。 */
  var PRIMARY = ['sxg-ai-fab', 'sxg-top-btn'];
  /* 折叠：低频 / 有其它入口的功能，收进「更多」层，不删除、不隐藏功能。 */
  var EXTRA   = ['sxg-nav', 'sxg-remind-btn', 'sxg-video-btn', 'sxg-bottom-btn'];
  var ALL     = PRIMARY.concat(EXTRA);

  var dock = null, moreBtn = null, extra = null;
  var observer = null, ro = null, listening = false;

  function isMobile() {
    if (window.matchMedia) return window.matchMedia(MQ).matches;
    return window.innerWidth <= 640;
  }

  function makeMore() {
    var b = document.createElement('button');
    b.id = MORE_ID;
    b.type = 'button';
    b.className = 'sxg-fab-dock__more-btn';
    b.setAttribute('aria-label', '展开更多悬浮功能');
    b.setAttribute('aria-expanded', 'false');
    b.setAttribute('aria-controls', EXTRA_ID);
    b.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">' +
      '<circle cx="5" cy="12" r="2" fill="currentColor"/>' +
      '<circle cx="12" cy="12" r="2" fill="currentColor"/>' +
      '<circle cx="19" cy="12" r="2" fill="currentColor"/></svg>';
    b.addEventListener('click', function (e) {
      e.stopPropagation();
      toggle();
    });
    return b;
  }

  function syncHeight() {
    if (!dock) return;
    /* dock 的 bottom 是 bar+14；面板要落在 dock 顶边之上 10px，
       所以把整个 dock 高度交给 CSS var，别再写死「+276px」这类魔数。 */
    var h = Math.round(dock.getBoundingClientRect().height);
    document.documentElement.style.setProperty('--sxg-dock-h', h + 'px');
  }

  function toggle(force) {
    if (!dock || !extra) return;
    var open = typeof force === 'boolean'
      ? force
      : !dock.classList.contains('is-expanded');
    dock.classList.toggle('is-expanded', open);
    extra.hidden = !open;
    moreBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    moreBtn.setAttribute('aria-label', open ? '收起更多悬浮功能' : '展开更多悬浮功能');
    /* hidden 切换后布局要下一帧才定，双保险：立即量一次 + rAF 再量一次 */
    syncHeight();
    if (window.requestAnimationFrame) window.requestAnimationFrame(syncHeight);
  }

  /* 把清单里已存在的按钮补进各自容器；返回仍缺失的个数。
     源脚本有的在 DOMContentLoaded 里同步建、有的点开才建子项，
     所以这里既在挂载时调一次，也由 MutationObserver 反复调。 */
  function fill() {
    if (!dock) return ALL.length;
    var missing = 0, i, el;

    for (i = 0; i < EXTRA.length; i++) {
      el = document.getElementById(EXTRA[i]);
      if (!el) { missing++; continue; }
      if (el.parentNode !== extra) extra.appendChild(el);
    }
    for (i = 0; i < PRIMARY.length; i++) {
      el = document.getElementById(PRIMARY[i]);
      if (!el) { missing++; continue; }
      if (el.parentNode !== dock) dock.appendChild(el);
    }
    syncHeight();
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
    /* 点空白处收起，避免展开层一直盖着内容 */
    document.addEventListener('click', function (e) {
      if (dock && dock.classList.contains('is-expanded') && !dock.contains(e.target)) {
        toggle(false);
      }
    }, true);
    window.addEventListener('resize', syncHeight);
    var m = window.matchMedia ? window.matchMedia(MQ) : null;
    if (m) {
      var onBp = function () { if (isMobile()) enable(); else disable(); };
      if (m.addEventListener) m.addEventListener('change', onBp);
      else if (m.addListener) m.addListener(onBp);
    }
  }

  function enable() {
    if (dock || !isMobile() || !document.body) return;
    /* 一个都没建好也先把容器摆上，剩下的交给 MutationObserver 补 */
    dock = document.createElement('div');
    dock.id = DOCK_ID;

    moreBtn = makeMore();
    dock.appendChild(moreBtn);

    extra = document.createElement('div');
    extra.id = EXTRA_ID;
    extra.className = 'sxg-fab-dock__extra';
    extra.hidden = true;
    dock.appendChild(extra);

    document.body.appendChild(dock);

    /* children 顺序固定为 [更多, 折叠组, AI, TOP]。
       dock 底边固定 → 高度变化时只有顶部往上长，常驻两枚位置永不跳动。 */
    var missing = fill();
    if (missing) watch();

    if (window.ResizeObserver) {
      ro = new ResizeObserver(syncHeight);
      ro.observe(dock);
    }
    bindGlobal();
  }

  function disable() {
    if (!dock) return;
    /* 原样放回 body：源脚本 <style> 没被改过，移出容器后各自的
       position:fixed / bottom 立即恢复，桌面端布局与改造前逐像素一致。 */
    for (var i = 0; i < ALL.length; i++) {
      var el = document.getElementById(ALL[i]);
      if (el && dock.contains(el)) document.body.appendChild(el);
    }
    if (observer) { observer.disconnect(); observer = null; }
    if (ro) { ro.disconnect(); ro = null; }
    dock.remove();
    dock = null; moreBtn = null; extra = null;
    document.documentElement.style.removeProperty('--sxg-dock-h');
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
