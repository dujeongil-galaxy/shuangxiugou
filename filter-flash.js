/* 评级过滤切换的 0.5s 高度模糊闪屏（2026-11-04 站长要求）
 * 问题：点任意评级按钮，bundle 先即时重渲染（画面第一下变化），
 *      100ms 后 filterCustomCards() 再补调自定义卡显隐（画面第二下变化），
 *      两次变化都在同一帧附近发生，肉眼可见「点一下画面变两下」。
 * 修法：在捕获阶段拦截评级按钮点击，先给卡片区施加 blur(16px) 覆盖 500ms，
 *      期间 bundle 重渲染 + 100ms 二次调整都在模糊下完成；
 *      500ms 后取消模糊，已是最终态，肉眼看不到切换抖动。
 * 只模糊卡片（div.bg-white.rounded-2xl.border），过滤条按钮保持清晰，
 * 让用户看清自己点的是哪个档。布局不变（filter 不改变盒模型），
 * 因此不会因卡片数量变化产生高度跳动。
 * 铁律：本文件只做 DOM 层补丁，绝不改动压缩产物 assets/index-YthXZ9eP.js。
 */
(function () {
  'use strict';

  var STYLE_ID = 'sxg-filter-flash-style';
  if (!document.getElementById(STYLE_ID)) {
    var css = 'body.sxg-filter-flashing div.bg-white.rounded-2xl.border{'
            + 'filter:blur(16px);-webkit-filter:blur(16px);pointer-events:none;}';
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = css;
    (document.head || document.documentElement).appendChild(s);
  }

  // 与 filterCustomCards() / u-grade-patch.js 保持同一套文案（含空格）
  var RATING = ['全部评级', 'S 级', 'A 级', 'B 级', 'C 级', 'D 级', 'U 级'];

  var DURATION = 500;
  var timer = null;

  function isRatingButton(btn) {
    if (!btn || btn.tagName !== 'BUTTON') return false;
    var t = (btn.textContent || '').trim();
    return RATING.indexOf(t) !== -1;
  }

  // 捕获阶段：先于 bundle 的 React onClick 与 filterCustomCards 的 setTimeout(100) 触发
  document.addEventListener('click', function (e) {
    var btn = e.target && e.target.closest ? e.target.closest('button') : e.target;
    if (!isRatingButton(btn)) return;
    // 即便点的是当前已激活档，也照常闪一下，保持「任何切换都闪」的一致体感
    document.body.classList.add('sxg-filter-flashing');
    if (timer) clearTimeout(timer);
    timer = setTimeout(function () {
      document.body.classList.remove('sxg-filter-flashing');
      timer = null;
    }, DURATION);
  }, true);
})();
