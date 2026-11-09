/* ==========================================================================
   移除首页黑色「全网打工人已转移消费额」卡片补丁（2026-11-09 站长指令）
   --------------------------------------------------------------------------
   站长原意：只删掉那张黑色打卡统计卡片（含 ¥268,490 数字与「打卡并生成小票」按钮），
   其余页面架构（横幅 / 统计卡片 174·84·31·57 / 导航 / 筛选 / 品牌列表 / 海比优广告块）
   一律原样保留，绝不动。

   定位锚点：全站唯一文案「全网打工人已转移消费额」。
   该卡片由主站压缩 bundle 异步渲染，且 React 可能在挂载后重渲染/回填文字，
   故采用三重兜底：① 渲染后多次 setTimeout；② setInterval 每秒扫一次（限 60 秒）；
   ③ MutationObserver 监听 DOM 增删与文字回填，发现锚点立即再删。
   （注意：主站 bundle assets/index-*.js 不可改，所有页面微调一律走独立补丁脚本。）
   ========================================================================== */
(function () {
  'use strict';

  var SIG = '全网打工人已转移消费额';

  function removeCard() {
    var nodes = document.querySelectorAll('div');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var cls = (el.className || '');
      if (typeof cls === 'string' &&
          cls.indexOf('bg-slate-900') !== -1 &&
          el.textContent &&
          el.textContent.indexOf(SIG) !== -1) {
        var parent = el.parentElement;
        el.remove();
        // 外层包裹（data-ad-width-fixed 等）若因此变空，一并移除，避免留空隙
        if (parent && parent.children.length === 0) parent.remove();
        return true;
      }
    }
    return false;
  }

  // 廉价守卫：整页还含锚点时才动手，避免每次 mutation 都全量扫描
  function maybeRemove() {
    if (document.body && document.body.innerHTML.indexOf(SIG) !== -1) {
      removeCard();
    }
  }

  // ① 立即试一次 + 异步渲染后多次兜底
  removeCard();
  setTimeout(removeCard, 500);
  setTimeout(removeCard, 1500);
  setTimeout(removeCard, 3000);
  setTimeout(removeCard, 5000);

  // ② 持续 60 秒每秒兜底，覆盖任何延迟渲染 / 重渲染
  var iv = setInterval(maybeRemove, 1000);
  setTimeout(function () { clearInterval(iv); }, 60000);

  // ③ MutationObserver：DOM 增删或文字回填（characterData）出现锚点立即再删
  if (typeof MutationObserver !== 'undefined') {
    var mo = new MutationObserver(maybeRemove);
    mo.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }
})();
