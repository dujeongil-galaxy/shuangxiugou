/* ==========================================================================
   stat-filter.js —— 顶部四格统计 → 点击筛选品牌卡
   --------------------------------------------------------------------------
   需求（2026-10-17 站长）：四格统计做成按钮——
     · 点「双休红榜」→ 只显示 S/A 级（B 级是存疑，不算红榜）
     · 点「大小周观察」→ 只显示 B 级
     · 点「避雷预警」→ 只显示 C 级
     · 点「收录品牌」→ 清除筛选、显示全部（含待核实 U 级）
     再点一次同一个按钮 = 取消筛选。

   实现约束（AGENTS.md / PITFALLS.md）：
   · 只做 DOM 层补丁，不改压缩包渲染逻辑；
   · 盒子定位用叶子标签文本（收录品牌/双休红榜/大小周观察/避雷预警），
     不依赖 Tailwind class（index-BgVofs0W.css 是按需生成的）；
   · 卡片档位识别读卡内第一个「S级/A级/B级/C级/待核实」徽章文本，
     兼容空格差异；「虚拟对比黑榜」卡不计入任何分档（与顶部四格口径一致）；
   · 幂等：盒子与卡片都打 data-* 标记，observer 重复触发不会重复绑事件；
   · 与品类筛选/搜索共存：React 重渲染后由 MutationObserver 重新套用
     当前筛选（display 状态跟着新节点走）。
   ========================================================================== */
(function () {
  'use strict';

  var STYLE_ID = 'sxg-stat-filter-style';
  var CARD_SEL = 'div.bg-white.rounded-2xl.border';
  var LABELS = {
    '收录品牌': 'all',
    '双休红榜': 'red',
    '大小周观察': 'zhou',
    '避雷预警': 'lei'
  };
  var FILTERS = {
    all: { tiers: null, title: '显示全部收录品牌（含待核实）；点击可清除筛选' },
    red: { tiers: ['S', 'A'], title: '仅显示 S/A 级（模范标杆与合规双休）' },
    zhou: { tiers: ['B'], title: '仅显示 B 级（大小周或数据存疑）' },
    lei: { tiers: ['C'], title: '仅显示 C 级（避雷预警）' },
    u: { tiers: ['U'], title: '仅显示待核实（U 级 · 不评级）' }
  };

  var active = null; // null = 全部；'red' | 'zhou' | 'lei' | 'u'

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }
  function diag(m) {
    if (window.console && console.warn) console.warn('[双休购] ' + m);
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent =
      '.sxg-stat-box{cursor:pointer;user-select:none;' +
        'transition:transform .15s ease,box-shadow .15s ease}' +
      '.sxg-stat-box:hover{transform:translateY(-1px);' +
        'box-shadow:0 6px 16px rgba(0,0,0,.08)}' +
      '.sxg-stat-box[data-sxg-active="1"]{outline:2px solid #059669;outline-offset:2px}' +
      '.sxg-stat-box:focus-visible{outline:2px solid #059669;outline-offset:2px}' +
      // 第五格「待核实」加入后，容器原为固定 grid-cols-4 会把第五格挤到第二行；
      // 注入 5 列覆盖，让五格始终横排（2026-10-18 站长要求）
      '[data-sxg-stat-grid="1"]{grid-template-columns:repeat(5,minmax(0,1fr))!important}';
    document.head.appendChild(style);
  }

  /* ---------------------------------------------------------- 档位识别 */
  // 读卡内第一个档位徽章：S级/A级/B级/C级/待核实（兼容空格差异）。
  // 识别不到返回 null：这类节点不动（可能是非卡片容器），只在控制台计数。
  function cardTier(card) {
    if ((card.textContent || '').indexOf('虚拟对比黑榜') !== -1) return 'V';
    var nodes = card.querySelectorAll('span,div');
    for (var i = 0; i < nodes.length; i++) {
      var s = (nodes[i].textContent || '').trim();
      var m = /^(S|A|B|C)\s*级/.exec(s);
      if (m) return m[1];
      if (s.indexOf('待核实') === 0) return 'U';
    }
    return null;
  }

  function tierMatches(tier, key) {
    var conf = FILTERS[key];
    if (!conf || !conf.tiers) return true; // all
    if (tier === 'V' || tier === null) return false;
    return conf.tiers.indexOf(tier) !== -1;
  }

  function applyTierFilter() {
    var cards = $$(CARD_SEL);
    var unknown = 0;
    cards.forEach(function (card) {
      var tier = cardTier(card);
      if (tier === null) {
        if (active) unknown += 1;
        return; // 识别不了档位的节点不动，避免误伤布局
      }
      var show = tierMatches(tier, active);
      card.style.display = show ? '' : 'none';
    });
    if (unknown > 0) {
      diag('stat-filter：有 ' + unknown + ' 个卡片容器未识别到档位徽章，筛选时未做隐藏');
    }
    refreshActiveMarks();
  }

  function refreshActiveMarks() {
    $$('[data-sxg-stat]').forEach(function (box) {
      var key = box.getAttribute('data-sxg-stat');
      var isActive = key !== 'all' && active === key;
      if (isActive) {
        box.setAttribute('data-sxg-active', '1');
        box.setAttribute('aria-pressed', 'true');
      } else {
        box.removeAttribute('data-sxg-active');
        box.setAttribute('aria-pressed', 'false');
      }
    });
  }

  function scrollToArchive() {
    var input = document.getElementById('site-search-input');
    if (input) {
      input.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    var cards = $$(CARD_SEL);
    if (cards.length) cards[0].scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------------------------------------------------------- 绑定盒子 */
  function bindBox(box, key) {
    box.setAttribute('data-sxg-stat-bound', '1');
    box.setAttribute('data-sxg-stat', key);
    box.classList.add('sxg-stat-box');
    box.setAttribute('role', 'button');
    box.setAttribute('tabindex', '0');
    box.setAttribute('aria-pressed', 'false');
    box.title = FILTERS[key].title;
    box.addEventListener('click', function (k) {
      return function (ev) {
        ev.stopPropagation();
        active = (k === 'all' || active === k) ? null : k;
        applyTierFilter();
        scrollToArchive();
      };
    }(key));
    box.addEventListener('keydown', function (k) {
      return function (ev) {
        if (ev.key !== 'Enter' && ev.key !== ' ') return;
        ev.preventDefault();
        ev.stopPropagation();
        active = (k === 'all' || active === k) ? null : k;
        applyTierFilter();
        scrollToArchive();
      };
    }(key));
  }

  // 第五格「待核实」（2026-10-18 站长）：19+14+19 只覆盖 S/A、B、C 三档，
  // U 级（待核实·不评级）不在任何分档里 —— 加一格让 19+14+19+5=57 对上。
  // 结构用「避雷预警」盒克隆（含配色改为中性灰），数字实时数卡，
  // React 重渲染后由 observer 幂等重建。
  function countUCards() {
    var n = 0;
    $$(CARD_SEL).forEach(function (card) {
      if (cardTier(card) === 'U') n += 1;
    });
    return n;
  }

  // 第五格数字推导（2026-10-18 bug 修复）：搜索/品类筛选会「卸载」不匹配
  // 卡片（React 条件渲染，节点不在 DOM），按可见 U 卡计数会在输入任意
  // 字符时清零。改为从四个手写常数盒推导：
  //   待核实 = 收录品牌 − 双休红榜 − 大小周观察 − 避雷预警
  // 与卡片显隐完全解耦；四格常数调整时第五格自动跟随。
  function uCountFromBoxes() {
    function num(key) {
      var b = $('[data-sxg-stat="' + key + '"]');
      if (!b || !b.children || !b.children[0]) return null;
      var v = parseInt((b.children[0].textContent || ''), 10);
      return isNaN(v) ? null : v;
    }
    var all = num('all'), red = num('red'), zhou = num('zhou'), lei = num('lei');
    if (all === null || red === null || zhou === null || lei === null) return null;
    var u = all - red - zhou - lei;
    return u >= 0 ? u : null;
  }

  function ensureUBox() {
    var lei = $('[data-sxg-stat="lei"]');
    if (!lei || !lei.parentNode) return;
    var gridBox = lei.parentElement;
    if (gridBox && gridBox.getAttribute('data-sxg-stat-grid') !== '1') {
      gridBox.setAttribute('data-sxg-stat-grid', '1');
    }
    var uN = uCountFromBoxes();
    var want = String(uN != null ? uN : countUCards());
    var existing = lei.parentNode.querySelector('[data-sxg-stat="u"]');
    if (existing) {
      var num = existing.children && existing.children[0];
      if (num && (num.textContent || '') !== want) num.textContent = want;
      return;
    }
    var box = lei.cloneNode(true);
    box.removeAttribute('data-sxg-stat-bound');
    box.removeAttribute('data-sxg-stat');
    box.removeAttribute('data-sxg-active');
    box.removeAttribute('aria-pressed');
    box.removeAttribute('title');
    // 克隆源是避雷盒：rose 系（底色/边框/数字）全部换 slate 中性灰，
    // 避免「待核实」看起来像避雷预警（2026-10-18 bug 修复）
    box.className = (box.className || '').replace(/rose/g, 'slate');
    var kids = box.children;
    if (kids.length >= 2) {
      kids[0].textContent = want;
      kids[0].className = 'font-bold text-slate-900 text-base';
      kids[1].textContent = '待核实';
    }
    if (lei.nextSibling) lei.parentNode.insertBefore(box, lei.nextSibling);
    else lei.parentNode.appendChild(box);
    bindBox(box, 'u');
  }

  function bindStatBoxes() {
    var divs = $$('div');
    for (var i = 0; i < divs.length; i++) {
      var d = divs[i];
      if (d.children.length !== 0) continue;
      var key = LABELS[(d.textContent || '').trim()];
      if (!key) continue;
      var box = d.parentElement;
      if (!box || box.getAttribute('data-sxg-stat-bound') === '1') continue;
      bindBox(box, key);
    }
    ensureUBox();
    refreshActiveMarks();
  }

  /* ------------------------------------------------------------- 启动 */
  function init() {
    injectStyle();
    try { bindStatBoxes(); } catch (e) { diag('stat-filter 绑定四格按钮出错: ' + e); }
    try { if (active) applyTierFilter(); } catch (e) { diag('stat-filter 套用筛选出错: ' + e); }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // 品类筛选/搜索会触发 React 重渲染，节点重建后由 observer 重新套用当前筛选
  var pending = null;
  var observer = new MutationObserver(function () {
    if (pending) return;
    pending = setTimeout(function () {
      pending = null;
      init();
    }, 200);
  });
  observer.observe(document.getElementById('root') || document.body, {
    childList: true,
    subtree: true
  });
  window.addEventListener('load', init);
})();
