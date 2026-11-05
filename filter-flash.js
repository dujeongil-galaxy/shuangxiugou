/* 结果区切换的 0.5s 高度模糊闪屏（2026-11-04 评级切换 v2；2026-11-05 扩到搜索清空）
 * 问题 A（评级切换）：点任意评级按钮，bundle 先即时重渲染（画面第一下变化），
 *      100ms 后 filterCustomCards() 再补调自定义卡显隐（画面第二下变化），
 *      两次变化都在同一帧附近发生，肉眼可见「点一下画面变两下」；
 *      此外过滤过程中 bundle 还会出现加载动画（spinner），
 *      在 2026-11-04 实测中，单靠 blur(16px) 卡片模糊仍会让加载动画与卡片跳动透出来。
 * 问题 B（搜索清空，2026-11-05 站长报障）：把搜索框删空、保持空白时，
 *      不论原来搜的是什么词，都会肉眼可见一次新的预加载动画。
 *      真渲染复现（scripts/dbg-search-clear.cjs）：清空瞬间 React 把被过滤掉的
 *      52 张卡一次性插回（123 → 175 张），拼音联想面板同时收起，
 *      各 DOM 补丁再逐个重注入 —— 这段重渲染窗口就是站长看到的那一下。
 *      线上还叠加 bundle/图片请求的等待，比本地更易看见转圈。
 *      它不是一个稳定的、能按 class 抓死的 spinner 节点（CDP 采样 0~1400ms
 *      未捕获到恒定动画元素），所以修法不针对某个节点，而是整层遮住窗口。
 * 修法（覆盖式 frosted 遮罩，两种场景共用同一套 flash()）：
 *      捕获阶段立刻在结果区盖一层 fixed 遮罩
 *      （backdrop-filter: blur(36px) + 近页面底色半透明），
 *      把「卡片重渲染 + 100ms 二次调整 + 加载动画」整层一起糊掉；
 *      500ms 后撤掉遮罩，露出已是最终态的结果，肉眼看不到任何切换抖动。
 *      遮罩 z-index=8000，低于悬浮钮（9000+），故悬浮钮保持清晰；
 *      遮罩 top 取评级按钮底边 +4，过滤工具条本身仍在遮罩之上、保持清晰。
 *      另用 CSS 在闪屏期压住首屏预加载层（#sxg-loading / .sxg-boot），
 *      它的 z-index 是 2147483647，靠 z-8000 的遮罩盖不住，必须单独隐藏。
 * 边界：只在「搜索框非空 → 空」的边沿触发，打字过程中不闪；
 *      品类卡切换不在此列（站长 2026-11-05 明确「暂时先不改」），
 *      click 分支仍只认 RATING 文案的按钮，口径没有扩大。
 * 铁律：本文件只做 DOM 层补丁，绝不改动压缩产物 assets/index-YthXZ9eP.js。
 */
(function () {
  'use strict';

  // 卡片自身再加一层模糊，双保险（即便 backdrop-filter 支持不佳，卡片也糊）
  var STYLE_ID = 'sxg-filter-flash-style';
  if (!document.getElementById(STYLE_ID)) {
    var css = 'body.sxg-filter-flashing div.bg-white.rounded-2xl.border{'
            + 'filter:blur(20px);-webkit-filter:blur(20px);pointer-events:none;}'
            // 2026-11-05：首屏预加载层 z-index=2147483647，高过 frosted 遮罩，
            // 闪屏期必须单独压住，否则「页面加载中…」的转圈会浮在磨砂层之上。
            + 'body.sxg-filter-flashing #sxg-loading,'
            + 'body.sxg-filter-flashing .sxg-boot,'
            + 'body.sxg-filter-flashing .sxg-boot__spinner{visibility:hidden!important;}';
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

  // 搜索清空时沿用评级切换的同一几何：过滤工具条底边之下才糊，
  // 工具条本身保持清晰，体感与「切换评价卡」完全一致。
  function ratingBarBottom() {
    var btns = document.querySelectorAll('button');
    for (var i = 0; i < btns.length; i++) {
      if (isRatingButton(btns[i])) return btns[i].getBoundingClientRect().bottom + 4;
    }
    // 评级按钮尚未渲染（极早触发）时退回搜索框底边，不能让遮罩 top=0 糊住整页
    var input = document.getElementById('site-search-input');
    return input ? input.getBoundingClientRect().bottom + 4 : 0;
  }

  // 评级切换与搜索清空共用：同一遮罩、同一模糊、同一时长
  function flash(top) {
    document.body.classList.add('sxg-filter-flashing');
    var mask = getMask();
    mask.style.top = (top || 0) + 'px';
    mask.style.display = 'block';
    if (timer) clearTimeout(timer);
    timer = setTimeout(function () {
      document.body.classList.remove('sxg-filter-flashing');
      mask.style.display = 'none';
      timer = null;
    }, DURATION);
  }

  // 捕获阶段：先于 bundle 的 React onClick 与 filterCustomCards 的 setTimeout(100) 触发
  document.addEventListener('click', function (e) {
    var btn = e.target && e.target.closest ? e.target.closest('button') : e.target;
    if (!isRatingButton(btn)) return;
    // 即便点的是当前已激活档，也照常闪一下，保持「任何切换都闪」的一致体感
    flash(btn.getBoundingClientRect().bottom + 4);
  }, true);

  /* 搜索清空分支（2026-11-05）：只在「非空 → 空」的边沿闪一次。
   * 用 beforeinput 记住改动前的值最准（能覆盖页面初始就有词的场景），
   * 没有 beforeinput 的环境（老浏览器 / jsdom）退回上一次 input 的值。
   * 打字、删到一半、重复按 Backspace 都不会闪，避免每敲一个字糊一下。 */
  var lastValue = null;
  var oldValue = null;
  var SEARCH_ID = 'site-search-input';

  document.addEventListener('beforeinput', function (e) {
    var t = e.target;
    if (!t || t.id !== SEARCH_ID) return;
    oldValue = (t.value || '').trim();
  }, true);

  document.addEventListener('input', function (e) {
    var t = e.target;
    if (!t || t.id !== SEARCH_ID) return;
    var now = (t.value || '').trim();
    var was = oldValue !== null ? oldValue : lastValue;
    oldValue = null;
    lastValue = now;
    if (was !== null && was !== '' && now === '') flash(ratingBarBottom());
  }, true);
})();
