/* 结果区切换的 0.5s 高度模糊闪屏（2026-11-04 评级切换 v2；2026-11-05 扩到搜索清空；
 * 2026-11-07 17:45 再改：删空留白整屏糊 + 覆盖顺序复位回放）
 * 2026-11-10 站长批次：拼音搜索后删除的「返回动画」强制 6 秒、显示倒计时，
 *   提示词改为「正在加载缓存，请稍后x秒」；评级切换仍 500ms 保持原样。
 *
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
 *      回放「回填最近搜过的词 → 1200ms → 清空」，那 1.2s 完全裸露。
 * 问题 D（2026-11-10 站长）：「拼音搜索，然后删除，返回动画，现在强制设置为 6 秒
 *      （并显示倒计时，提示词优化为『正在加载缓存，请稍后x秒』）」。
 *      因此搜索清空不再沿用 500ms，也不再被 hold/release 提前撤除：
 *      forcedUntil 是硬 deadline，dismiss() 在到期前一律重新排队；
 *      遮罩内每秒把 x 从 6 递减到 1，6 秒整撤除。
 *
 * 修法（覆盖式 frosted 遮罩，评级切换 / 搜索清空共用同一套 flash()）：
 *      捕获阶段立刻盖一层 fixed 遮罩（backdrop-filter: blur(36px) + 近页面底色
 *      半透明），把「卡片重渲染 + 100ms 二次调整 + 加载动画」整层一起糊掉。
 *      评级切换：遮罩 top 取评级按钮底边 +4，工具条保持清晰，500ms 后撤，
 *      提示词「加载中…」。
 *      搜索清空：遮罩 top=0 整屏糊，连搜索框和拼音联想面板一起盖住；
 *      强制 6000ms + 倒计时「正在加载缓存，请稍后x秒」，期间即使
 *      search-clear-order-fix.js 派发 sxg-scof-release 也不提前撤除。
 *      若搜索清空同时触发顺序复位回放，hold 期间不撤遮罩；无强制期时
 *      release 后再留 RELEASE_GRACE 让 React 空态重渲染落地才撤。
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
            + 'body.sxg-filter-flashing #pinyin-suggest{visibility:hidden!important;}'
            // 遮罩内加载动画（转圈 + 文案）：把「近白空白」变成明确的「加载中」，
            // 避免用户把搜索清空/评级切换时的近白磨砂当成卡死而退出网页。
            + '#sxg-flash-mask .sxg-flash-box{position:absolute;top:50%;left:50%;'
            + 'transform:translate(-50%,-50%);display:flex;flex-direction:column;'
            + 'align-items:center;padding:18px 24px;background:rgba(255,255,255,.94);'
            + 'border-radius:16px;box-shadow:0 12px 36px rgba(15,23,42,.2)}'
            + '#sxg-flash-mask .sxg-flash-spin{width:38px;height:38px;margin:0 auto 12px;'
            + 'border:3px solid rgba(15,118,110,.18);border-top-color:#0F766E;'
            + 'border-radius:50%;animation:sxg-flash-spin .8s linear infinite}'
            + '#sxg-flash-mask .sxg-flash-tip{color:#0F766E;font:600 14px/1.4 system-ui,'
            + '-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;text-align:center;'
            + 'letter-spacing:.04em}'
            + '@keyframes sxg-flash-spin{to{transform:rotate(360deg)}}'
            + '@media (prefers-reduced-motion:reduce){#sxg-flash-mask .sxg-flash-spin{animation-duration:2s}}';
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = css;
    (document.head || document.documentElement).appendChild(s);
  }

  var MASK_ID = 'sxg-flash-mask';
  var RATING_TIP = '加载中…';
  var SEARCH_TIP_HEAD = '正在加载缓存，请稍后';
  var SEARCH_TIP_TAIL = '秒';

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
      // 遮罩内的加载动画（转圈 + 文案），让「近白磨砂」呈现为明确的「加载中」
      var box = document.createElement('div');
      box.className = 'sxg-flash-box';
      box.innerHTML = '<div class="sxg-flash-spin" aria-hidden="true"></div>'
        + '<div class="sxg-flash-tip">' + RATING_TIP + '</div>';
      m.appendChild(box);
      (document.body || document.documentElement).appendChild(m);
    }
    return m;
  }

  function tipNode() {
    return getMask().querySelector('.sxg-flash-tip');
  }

  // 与 filterCustomCards() / u-grade-patch.js 保持同一套文案（含空格）
  var RATING = ['全部评级', 'S 级', 'A 级', 'B 级', 'C 级', 'D 级', 'U 级'];

  var DURATION = 500;          // 评级切换：0.5s 闪屏
  var SEARCH_DURATION = 6000;  // 搜索清空：站长 2026-11-10 强制 6 秒，硬 deadline
  var TICK_MS = 1000;          // 倒计时每秒刷新
  var RELEASE_GRACE = 450;     // 非强制期：回放清空后再等 React 空态重渲染落地才撤遮罩
  var HOLD_MAX = 3000;         // 非强制期看门狗：release 丢失也绝不永久糊住页面
  var timer = null;
  var holdTimer = null;
  var tickTimer = null;
  var held = false;
  var forcedUntil = 0;         // 搜索清空的硬 deadline（毫秒时间戳）
  var countdown = 0;

  function isRatingButton(btn) {
    if (!btn || btn.tagName !== 'BUTTON') return false;
    var t = (btn.textContent || '').trim();
    return RATING.indexOf(t) !== -1;
  }

  function stopCountdown() {
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
  }

  function renderCountdown() {
    var tip = tipNode();
    if (tip) tip.textContent = SEARCH_TIP_HEAD + countdown + SEARCH_TIP_TAIL;
  }

  function startCountdown() {
    stopCountdown();
    countdown = Math.ceil(SEARCH_DURATION / TICK_MS);
    renderCountdown();
    tickTimer = setInterval(function () {
      countdown -= 1;
      if (countdown <= 0) { stopCountdown(); return; }
      renderCountdown();
    }, TICK_MS);
  }

  function dismiss() {
    if (held) return;
    // 强制 6 秒是硬 deadline：任何提前撤除请求都只是把定时器重排到到期之后。
    var left = forcedUntil - Date.now();
    if (left > 0) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(dismiss, left + 20);
      return;
    }
    forcedUntil = 0;
    stopCountdown();
    document.body.classList.remove('sxg-filter-flashing');
    getMask().style.display = 'none';
    if (timer) { clearTimeout(timer); timer = null; }
  }

  // 评级切换与搜索清空共用：同一遮罩、同一模糊。
  // top=0 即整屏（搜索清空用），传按钮底边+4 则工具条保持清晰（评级切换用）。
  // mode='search' 走强制 6 秒 + 倒计时；其余走 500ms + 「加载中…」。
  function flash(top, mode) {
    var isSearch = mode === 'search';
    // 强制期内不打断搜索倒计时（用户此时也看不清页面，没必要响应评级点击）
    if (!isSearch && Date.now() < forcedUntil) return;
    var mask = getMask();
    if (isSearch) {
      // 新的搜索清空要清掉上一次回放遗留的 held 状态与看门狗，
      // 否则旧 holdTimer 清 held 前 dismiss() 会一直被挡住，页面永久糊住。
      held = false;
      if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
      forcedUntil = Date.now() + SEARCH_DURATION;
      startCountdown();
    } else {
      forcedUntil = 0;
      stopCountdown();
      var tip = tipNode();
      if (tip) tip.textContent = RATING_TIP;
    }
    document.body.classList.add('sxg-filter-flashing');
    mask.style.top = (top || 0) + 'px';
    mask.style.display = 'block';
    if (timer) clearTimeout(timer);
    timer = setTimeout(dismiss, isSearch ? SEARCH_DURATION : DURATION);
  }

  // 顺序复位回放开始时挂起自动撤除；回放结束解除。
  // 事件由 search-clear-order-fix.js 派发，两侧必须同改，勿单侧删除。
  function holdFlash() {
    held = true;
    if (timer) { clearTimeout(timer); timer = null; }
    if (holdTimer) clearTimeout(holdTimer);
    // 强制期内看门狗不能早于 6 秒 deadline，否则会把倒计时掐断
    var wait = Math.max(HOLD_MAX, forcedUntil - Date.now() + 200);
    holdTimer = setTimeout(function () {
      held = false; holdTimer = null; dismiss();
    }, wait);
  }

  function releaseFlash() {
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
    held = false;
    if (Date.now() < forcedUntil) {
      // holdFlash 清掉过 flash 的 6 秒定时器，这里必须重排到硬 deadline，
      // 否则「回放提前结束」会让遮罩再也没有定时器来撤除（永久糊住）。
      if (timer) clearTimeout(timer);
      timer = setTimeout(dismiss, forcedUntil - Date.now() + 20);
      return;
    }
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

  /* 搜索清空分支（2026-11-05 加，2026-11-07 改整屏 + 回放挂起，
   * 2026-11-10 改强制 6 秒 + 倒计时）：
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
    // 必须跳过：否则会多闪一次磨砂并打断撤除契约
    // （scripts/test-search-clear-render.cjs 会稳定判红）。契约另一侧见该脚本。
    if (e.__sxgScofReplay) return;
    var now = (t.value || '').trim();
    var was = oldValue !== null ? oldValue : lastValue;
    oldValue = null;
    lastValue = now;
    if (was !== null && was !== '' && now === '') flash(0, 'search');
  }, true);
})();
