/* ==========================================================================
   顶栏按钮手机端全收进右侧 dock（2026-11-18 站长指令）
   --------------------------------------------------------------------------
   站长看手机端截图（393px 视口）反馈：顶栏四枚按钮排成两行，
   「分享本站」孤零零掉在第三行，排版凌乱 →「要不行的话就全部丢右边去吧」。

   分工（避免多个 MutationObserver 互搬打架）：
     · 本脚本管三枚原生顶栏按钮：提交数据 / 申诉、Star on GitHub、打赏赞助；
     · 第四枚「分享本站」由 share-entry.js 自己安置（另改其窄屏落位进 dock）；
     · Login / 匿名邮箱本来就归 fab-dock.js + 各自脚本管，本脚本不碰。

   行为：
     · ≤640px：把三枚从 header 移到 #sxg-fab-dock，打中文短标签
       （dock 的 CSS 靠 data-sxg-dock-label 的 ::after 显示文字）；
     · >640px：按记录的原位置还原回 header，短标签移除；
     · 断点来回切反复搬，幂等；dock 尚未建好时下一轮 sweep 再搬。

   技术红线：只搬 DOM、不动压缩 bundle、不改任何按钮的 class / 行为。
   ========================================================================== */
(function () {
  'use strict';

  var DOCK_ID  = 'sxg-fab-dock';
  var MQ       = '(max-width: 640px)';
  var ATTR     = 'data-hdr-acts';
  var SHARE_ID = 'sxg-share-entry-btn';

  /* 三枚原生按钮按文字识别（bundle 压缩产物没有稳定 class / id） */
  var TARGETS = [
    { re: /提交数据/,            label: '提交' },
    { re: /Star on GitHub/,      label: 'Star' },
    { re: /打赏赞助|赞助本项目/, label: '打赏' }
  ];

  /* homes：{el, parent, index}，只记一次，供切回桌面时原位还原 */
  var homes = [];

  function isNarrow() {
    if (window.matchMedia) return window.matchMedia(MQ).matches;
    return window.innerWidth <= 640;
  }

  function actsBox() {
    return document.querySelector('header [' + ATTR + ']');
  }

  function labelOf(text) {
    for (var i = 0; i < TARGETS.length; i++) {
      if (TARGETS[i].re.test(text)) return TARGETS[i].label;
    }
    return null;
  }

  function moveIn(dock, box) {
    var kids = Array.prototype.slice.call(box.children);
    var moved = 0;
    for (var i = 0; i < kids.length; i++) {
      var el = kids[i];
      if (el.id === SHARE_ID) continue;              // 分享由 share-entry.js 自己安置
      var lab = labelOf(el.textContent || '');
      if (!lab) continue;
      var known = false;
      for (var k = 0; k < homes.length; k++) {
        if (homes[k].el === el) { known = true; break; }
      }
      if (!known) homes.push({ el: el, parent: box, index: i });
      el.setAttribute('data-sxg-dock-label', lab);
      if (el.parentNode !== dock) dock.appendChild(el);
      moved++;
    }
    return moved;
  }

  function moveOut(box) {
    if (!box) return 0;
    var back = 0;
    homes.sort(function (a, b) { return a.index - b.index; });
    for (var i = 0; i < homes.length; i++) {
      var h = homes[i];
      if (h.parent !== box) h.parent = box;
      if (h.el.parentNode && h.el.parentNode.id !== DOCK_ID) continue;
      var ref = box.children[h.index] || null;
      if (ref === h.el) ref = h.el.nextSibling;
      box.insertBefore(h.el, ref);
      h.el.removeAttribute('data-sxg-dock-label');
      back++;
    }
    return back;
  }

  function sweep() {
    try {
      var box = actsBox();
      if (!box) return;
      var dock = document.getElementById(DOCK_ID);
      if (isNarrow()) {
        if (dock) moveIn(dock, box);
      } else {
        moveOut(box);
      }
    } catch (e) { /* 下游补丁不许因宿主状态异常抛错 */ }
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
  /* 顶栏 React 渲染 + dock 由 fab-dock.js 建，都要等；与 share-entry.js 同批重试 */
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

  window.SXGHeaderToDock = { sweep: sweep, homes: homes, MQ: MQ, DOCK_ID: DOCK_ID };
})();
