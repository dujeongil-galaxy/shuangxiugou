/* ==========================================================================
   virtual-card-remove.js
   --------------------------------------------------------------------------
   需求（2026-10-26 站长指令）：「某代工烘焙食品 (虚拟对比黑榜)」虚拟卡
   「删了，不再保留」。此前它作为上游模板的匿名对比工具一直显示在
   首页（不计入统计口径但卡片可见、可被搜索）。

   实现方式（2026-10-26 第一版踩坑后改版）：
   - 第一版用 removeChild 真删节点 → React 协调崩溃（搜「瑞幸」时虚拟卡
     离开过滤结果触发 React 自己的 removeChild，对一个「已被外部删掉」
     的节点操作 → NotFoundError → 整个 tab 崩掉，搜索框都没了）。
     无头 Edge 实测：挂载补丁搜「瑞幸」0 张卡 + input 消失；
     摘挂载对照 13 张卡正常。教训：**外部脚本绝不能 removeChild
     React 管理的节点**——要下线只能从「视觉层」隐藏。
   - 本版改为 class 隐藏（sxg-vcard-gone，display:none !important），
     与 stat-filter / search-scope-fix 的隐藏机制同款，已被长期验证安全：
     React 重渲染重建节点时 MutationObserver 兜底补 class。

   其余约束（照本仓库既有纪律）：
   - 不能改 assets/index-YthXZ9eP.js（compressed bundle，技术红线）；
   - 同步清理 <noscript> 里的静态品牌清单行（SEO 降级视图不留——
     noscript 不是 React 管的，removeChild 安全）；
   - stat-filter / search-scope-fix 里既有的「虚拟对比黑榜不计入统计」
     防栏保留——bundle 数据还在，防线不拆（防口径回退）。
   ========================================================================== */
(function () {
  'use strict';

  var MARK = '虚拟对比黑榜';
  var DATA_ATTR = 'data-sxg-virtual-removed';
  var HIDE_CLASS = 'sxg-vcard-gone';
  var STYLE_ID = 'sxg-vcard-style';

  /* ------------------------------------------------------------- 样式 */

  if (!document.getElementById(STYLE_ID)) {
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = '.' + HIDE_CLASS + '{display:none !important}';
    (document.head || document.documentElement).appendChild(style);
  }

  /* ------------------------------------------------------------- 卡判定 */

  // 与 stat-filter.js / search-scope-fix.js 同口径：
  // 按 textContent 命中「虚拟对比黑榜」即虚拟卡。
  // 该字面串只出现在这张卡的名称里，品牌卡不会含它（注入测试已验证）。
  function isVirtualCard(node) {
    if (!node || node.nodeType !== 1) return false;
    var cls = node.className;
    if (typeof cls !== 'string' || cls.indexOf('bg-white') === -1
      || cls.indexOf('rounded-2xl') === -1) return false;
    return (node.textContent || '').indexOf(MARK) !== -1;
  }

  /* ------------------------------------------------------------- 隐藏 */

  function hideVirtualCards() {
    var hidden = 0;
    var cards = document.querySelectorAll('div.bg-white.rounded-2xl.border');
    for (var i = 0; i < cards.length; i++) {
      if (!isVirtualCard(cards[i])) continue;
      if (!cards[i].classList.contains(HIDE_CLASS)) {
        cards[i].classList.add(HIDE_CLASS);
        hidden++;
      }
    }
    return hidden;
  }

  function cleanNoscript() {
    // noscript 静态清单里的虚拟卡行（SEO 降级视图）：
    // <li><strong>某代工烘焙食品 (虚拟对比黑榜)</strong>：C 级 · …</li>
    // noscript 内容不是 React 管的，removeChild 安全。
    var nodes = document.querySelectorAll('noscript li');
    for (var i = 0; i < nodes.length; i++) {
      if ((nodes[i].textContent || '').indexOf(MARK) !== -1) {
        var p = nodes[i].parentNode;
        if (p) p.removeChild(nodes[i]);
      }
    }
  }

  /* ------------------------------------------------------------- 兜底观察 */

  function startObserver() {
    var root = document.getElementById('root');
    if (!root || typeof MutationObserver === 'undefined') return;

    var scheduled = false;
    var mo = new MutationObserver(function () {
      if (scheduled) return;
      scheduled = true;
      // 微批处理：脱离 observer 回调栈再动手，避免与 React 渲染互踩
      Promise.resolve().then(function () {
        scheduled = false;
        try { hideVirtualCards(); } catch (e) { /* 静默，下轮兜底 */ }
      });
    });
    mo.observe(root, { childList: true, subtree: true });
  }

  /* ------------------------------------------------------------- 启动 */

  function boot() {
    if (document.documentElement.getAttribute(DATA_ATTR) === '1') return;
    document.documentElement.setAttribute(DATA_ATTR, '1');

    hideVirtualCards();
    cleanNoscript();
    startObserver();

    // 首屏 React 渲染晚于本脚本（type=module）：轮询兜底首批卡片
    var tries = 0;
    var timer = setInterval(function () {
      var n = hideVirtualCards();
      if ((n === 0 && ++tries > 40) || tries > 80) clearInterval(timer);
      if (n > 0) tries = 0; // 又抓到一次重渲染，重置计数
    }, 250);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  /* ------------------------------------------------------------- 自测导出 */

  window.__SXGVirtualCardRemove = {
    isVirtualCard: isVirtualCard,
    hideVirtualCards: hideVirtualCards,
    cleanNoscript: cleanNoscript,
    HIDE_CLASS: HIDE_CLASS
  };
})();
