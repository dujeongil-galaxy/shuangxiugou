/* 评级过滤切换的 0.5s 高度模糊闪屏（2026-11-04 站长要求，v2 强化）
 * 问题：点任意评级按钮，bundle 先即时重渲染（画面第一下变化），
 *      100ms 后 filterCustomCards() 再补调自定义卡显隐（画面第二下变化），
 *      两次变化都在同一帧附近发生，肉眼可见「点一下画面变两下」；
 *      此外过滤过程中 bundle 还会出现加载动画（spinner），
 *      在 2026-11-04 实测中，单靠 blur(16px) 卡片模糊仍会让加载动画与卡片跳动透出来。
 * 修法（v2，覆盖式 frosted 遮罩）：
 *      在捕获阶段拦截评级按钮点击，立刻在结果区盖一层 fixed 遮罩
 *      （backdrop-filter: blur(36px) + 近页面底色半透明），
 *      把「卡片重渲染 + 100ms 二次调整 + 加载动画」整层一起糊掉；
 *      500ms 后撤掉遮罩，露出已是最终态的结果，肉眼看不到任何切换抖动。
 *      遮罩 z-index=8000，低于悬浮钮（9000+），故悬浮钮保持清晰；
 *      遮罩 top 取所点按钮底边，过滤工具条本身仍在遮罩之上、保持清晰。
 * 铁律：本文件只做 DOM 层补丁，绝不改动压缩产物 assets/index-YthXZ9eP.js。
 */
(function () {
  'use strict';

  // 卡片自身再加一层模糊，双保险（即便 backdrop-filter 支持不佳，卡片也糊）
  var STYLE_ID = 'sxg-filter-flash-style';
  if (!document.getElementById(STYLE_ID)) {
    var css = 'body.sxg-filter-flashing div.bg-white.rounded-2xl.border{'
            + 'filter:blur(20px);-webkit-filter:blur(20px);pointer-events:none;}';
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = css;
    (document.head || document.documentElement).appendChild(s);
  }

  var MASK_ID = 'sxg-flash-mask';
  function getMask() {
    var m = document.getElementById(MASK_ID);
    if (!m) {
      m = document.createElement('div');
      m.id = MASK_ID;
      // 近页面底色 #fcfcfd + 强 backdrop 模糊：整层糊掉，加载动画/卡片跳动全不可见
      m.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:8000;'
        + 'background:rgba(252,252,253,0.9);'
        + 'backdrop-filter:blur(36px) saturate(0.7);'
        + '-webkit-backdrop-filter:blur(36px) saturate(0.7);'
        + 'pointer-events:none;display:none;';
      (document.body || document.documentElement).appendChild(m);
    }
    return m;
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
    // 整层 frosted 遮罩盖住结果区（含加载动画）
    var mask = getMask();
    var r = btn.getBoundingClientRect();
    mask.style.top = (r.bottom + 4) + 'px';
    mask.style.display = 'block';
    if (timer) clearTimeout(timer);
    timer = setTimeout(function () {
      document.body.classList.remove('sxg-filter-flashing');
      mask.style.display = 'none';
      timer = null;
    }, DURATION);
  }, true);
})();
