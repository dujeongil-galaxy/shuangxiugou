/* ==========================================================================
   stat-filter.js —— 顶部四格统计 → 点击筛选品牌卡
   --------------------------------------------------------------------------
   需求（2026-10-17 站长）：四格统计做成按钮——
     · 点「双休红榜」→ 只显示 S/A 级（B 级是存疑，不算红榜）
     · 点「大小周观察」→ 只显示 B 级
     · 点「避雷预警」→ 只显示 C / D 级
     · 点「收录品牌」→ 清除筛选、显示全部
     再点一次同一个按钮 = 取消筛选。
  U 级（证据不足）为合法档位，但单独列示、不并入四格统计（硬规则见 verify §2d）；
  四格统计保持 4 列，卡片按 S/A/B/C/D/U 识别，U/D 卡由 u-grade-patch.js 补徽标
  （bundle 的 switch 只有 S/A/B/C 四个分支）。
  D 级（站长人工降级）**计入**避雷预警格：它是 C 的加重版（管理层指令性规避法律风险加班），
  不是另一类，所以点「避雷预警」必须同时出 C 和 D，否则格子写 58 却只出 57 家。
  U 卡的行为：只在「收录品牌（全部）」视图可见；点 S/A/B/C 任何一格都隐藏它
  （它不是红榜也不是避雷，混进任何一格都是错误归类）。
  坑（2026-11-02）：原来的 tierMatches 先判 `tier === null → false`，而 U 卡识别
  返回 null，结果连「全部」也把它藏了——U 卡会凭空消失，读者以为数据丢了。

   实现约束（AGENTS.md / PITFALLS.md）：
   · 只做 DOM 层补丁，不改压缩包渲染逻辑；
   · 盒子定位用叶子标签文本（收录品牌/双休红榜/大小周观察/避雷预警），
     不依赖 Tailwind class（index-BgVofs0W.css 是按需生成的）；
   · 卡片档位识别读卡内第一个「S级/A级/B级/C级」徽章文本，
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
    all: { tiers: null, title: '显示全部收录品牌；点击可清除筛选' },
    red: { tiers: ['S', 'A'], title: '仅显示 S/A 级（模范标杆与合规双休）' },
    zhou: { tiers: ['B'], title: '仅显示 B 级（大小周或数据存疑）' },
    // 避雷预警含 D：D 级（站长人工降级，管理层指令性规避法律风险加班）是 C 的加重版，
    // 不是另一类，所以在避雷格里；否则「避雷预警 58」点了只出 57 家。
    lei: { tiers: ['C', 'D'], title: '仅显示 C/D 级（避雷预警；D 为站长强制降级）' }
  };

  var active = null; // null = 全部；'red' | 'zhou' | 'lei'

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
        '.sxg-stat-box:focus-visible{outline:2px solid #059669;outline-offset:2px}';
    document.head.appendChild(style);
  }

  /* ---------------------------------------------------------- 档位识别 */
  // 读卡内第一个档位徽章：S级/A级/B级/C级/D级/U级（兼容空格差异）。
  // 2026-11-02 起 U 级重新合法（三星/宏碁证据不足），必须识别，否则 U 卡在
  // 「全部」视图下被 tierMatches 当成 null 隐藏。
  // 2026-11-02 起 D 级（站长人工降级，奇瑞）同理：bundle 没有 D 分支，
  // 徽标由 u-grade-patch.js 异步注入 —— 而本脚本可能在徽标注入之前跑，
  // 读不到徽标就会把 D 卡当 null 放过。所以优先读补丁打在卡上的 data-sxg-tier。
  function cardTier(card) {
    if ((card.textContent || '').indexOf('虚拟对比黑榜') !== -1) return 'V';
    var flagged = card.getAttribute('data-sxg-tier');
    if (flagged) return flagged;
    var nodes = card.querySelectorAll('span,div');
    for (var i = 0; i < nodes.length; i++) {
      var s = (nodes[i].textContent || '').trim();
      var m = /^(S|A|B|C|D|U)\s*级/.exec(s);
      if (m) return m[1];
    }
    return null;
  }

  function tierMatches(tier, key) {
    var conf = FILTERS[key];
    if (!conf) return true;
    // 全部：除虚拟对比黑榜外一律显示（**含 U**——U 卡也是收录品牌，只是不进四格）
    if (!conf.tiers) return tier !== 'V';
    // 分档筛选：U 不属于任何一格，null（识别不到档位）同样不匹配
    if (tier === 'V' || tier === null || tier === 'U') return false;
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
    refreshActiveMarks();
  }

  /* --------------------------------------------- 评级行（无 U 按钮） */
  // 下方「评级过滤」行由 bundle 渲染：全部评级/S 级/A 级/B 级/C 级，
  // 「D 级」「U 级」由 u-grade-patch.js 注入（bundle 数组写死只有 S/A/B/C）。
  // 本清单必须与注入按钮文案一致：点 D/U 按钮时同样要清五格筛选（互斥协调）。
  var ROW_RATING_TEXTS = ['全部评级', 'S 级', 'A 级', 'B 级', 'C 级', 'D 级', 'U 级'];

  // 两套筛选互斥：点 React 评级行（S/A/B/C/全部）时清掉五格筛选，
  // 避免 React 重渲染后 observer 又把 u/red 等 display 状态套回去出现空面板。
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || t.tagName !== 'BUTTON') return;
    var text = (t.textContent || '').trim();
    if (ROW_RATING_TEXTS.indexOf(text) === -1) return;
    if (active) {
      active = null;
      applyTierFilter();
    }
  }, true);

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
