/* 结果区切换的 0.5s 高度模糊闪屏（2026-11-04 评级切换 v2；2026-11-05 扩到搜索清空；
 * 2026-11-07 17:45 再改：删空留白整屏糊 + 覆盖顺序复位回放）
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
 * 问题 C（2026-11-07 17:45 站长再报）：「删除搜索词之后，留空白，也做一个高度模糊
 *      的画面。准确的说，无论搜的是什么，只要有这个动作出现了，都要做高度模糊」。
 *      上一版只糊 500ms，之后 search-clear-order-fix.js 为复位 IME 排序残留会
 *      回放「回填最近搜过的词 → 1200ms → 清空」，那 1.2s 完全裸露：
 *      搜索框里重新冒出词、结果区又切回搜索态，肉眼就是「删空了又变回去」。
 *      CDP 时间线实测：t=217~334ms 有闪屏，t=543~1600ms 遮罩已撤而回放还在，
 *      t=1605ms 才回到全量 —— 中间整整 1 秒没有模糊。
 * 修法（覆盖式 frosted 遮罩，评级切换 / 搜索清空共用同一套 flash()）：
 *      捕获阶段立刻盖一层 fixed 遮罩（backdrop-filter: blur(36px) + 近页面底色
 *      半透明），把「卡片重渲染 + 100ms 二次调整 + 加载动画」整层一起糊掉。
 *      评级切换：遮罩 top 取评级按钮底边 +4，工具条保持清晰，500ms 后撤。
 *      搜索清空：**遮罩 top=0 整屏糊**，连搜索框和拼音联想面板一起盖住，
 *      这样回放期间回填的词也看不见，撤遮罩时搜索框已是空白、结果已是全量。
 *      若搜索清空同时触发顺序复位回放，search-clear-order-fix.js 会发
 *      sxg-scof-hold / sxg-scof-release：hold 期间不撤遮罩，release 后再留
 *      RELEASE_GRACE 让 React 空态重渲染落地才撤；无回放则仍按 500ms 自动撤除。
 *      HOLD_MAX 是看门狗，防止 release 因异常丢失把页面永久糊住。
 *      遮罩 z-index=8000，低于悬浮钮（9000+），故悬浮钮保持清晰。
 *      另用 CSS 在闪屏期压住首屏预加载层（#sxg-loading / .sxg-boot）与拼音联想层
 *      （#pinyin-suggest），前者 z-index 2147483647 靠 z-8000 的遮罩盖不住。
 * 边界：只在「搜索框非空 → 空」的边沿触发，打字过程中不闪；
 *      不认具体搜索词（任何词、中文 IME、拼音、全选删除都一视同仁）；
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
            + 'body.sxg-filter-flashing .sxg-boot__spinner,'
            // 2026-11-07：拼音联想面板 z-index 高过遮罩，回放回填词时会漏出联想条，
            // 整屏糊的口径要求它一起不可见。
            + 'body.sxg-filter-flashing #pinyin-suggest{visibility:hidden!important;}';
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

  var DURATION = 500;        // 评级切换 / 无回放的普通清空：0.5s 闪屏
  var RELEASE_GRACE = 450;   // 回放清空后再等 React 空态重渲染落地才撤遮罩
  var HOLD_MAX = 3000;       // 看门狗：release 丢失也绝不永久糊住页面
  var timer = null;
  var holdTimer = null;
  var held = false;

  function isRatingButton(btn) {
    if (!btn || btn.tagName !== 'BUTTON') return false;
    var t = (btn.textContent || '').trim();
    return RATING.indexOf(t) !== -1;
  }

  function dismiss() {
    if (held) return;
    document.body.classList.remove('sxg-filter-flashing');
    getMask().style.display = 'none';
    if (timer) { clearTimeout(timer); timer = null; }
  }

  // 评级切换与搜索清空共用：同一遮罩、同一模糊、同一时长。
  // top=0 即整屏（搜索清空用），传按钮底边+4 则工具条保持清晰（评级切换用）。
  function flash(top) {
    document.body.classList.add('sxg-filter-flashing');
    var mask = getMask();
    mask.style.top = (top || 0) + 'px';
    mask.style.display = 'block';
    if (timer) clearTimeout(timer);
    timer = setTimeout(dismiss, DURATION);
  }

  // 顺序复位回放开始时挂起自动撤除；回放结束解除。
  // 事件由 search-clear-order-fix.js 派发，两侧必须同改，勿单侧删除。
  function holdFlash() {
    held = true;
    if (timer) { clearTimeout(timer); timer = null; }
    if (holdTimer) clearTimeout(holdTimer);
    holdTimer = setTimeout(function () {
      held = false; holdTimer = null; dismiss();
    }, HOLD_MAX);
  }

  function releaseFlash() {
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
    held = false;
    if (timer) clearTimeout(timer);
    timer = setTimeout(dismiss, RELEASE_GRACE);
  }

  document.addEventListener('sxg-scof-hold', holdFlash, true);
  document.addEventListener('sxg-scof-release', releaseFlash, true);

  // 捕获阶段：先于 bundle 的 React onClick 与 filterCustomCards 的 setTimeout(100) 触发
  document.addEventListener('click', function (e) {
    var btn = e.target && e.target.closest ? e.target.closest('button') : e.target;
    if (!isRatingButton(btn)) return;
    // 即便点的是当前已激活档，也照常闪一下，保持「任何切换都闪」的一致体感
    flash(btn.getBoundingClientRect().bottom + 4);
  }, true);

  /* 搜索清空分支（2026-11-05 加，2026-11-07 改整屏 + 回放挂起）：
   * 只在「非空 → 空」的边沿闪一次，不看具体词，任何搜索词一律同样处理。
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
    // search-clear-order-fix.js 为复位 IME 排序残留，会合成「回填最近词 → 延时清空」
    // 两次 input（带 __sxgScofReplay 标记）。那是内部状态机重放、不是用户删空，
    // 必须跳过：否则 1.2s 后会多闪一次磨砂并打断撤除契约
    // （scripts/test-search-clear-render.cjs 会稳定判红）。契约另一侧见该脚本。
    if (e.__sxgScofReplay) return;
    var now = (t.value || '').trim();
    var was = oldValue !== null ? oldValue : lastValue;
    oldValue = null;
    lastValue = now;
    if (was !== null && was !== '' && now === '') flash(0);
  }, true);
})();
