/* ==========================================================================
   search-scope-fix.js —— 搜索口径修正：summary 命中降级为兜底
   --------------------------------------------------------------------------
   解决的问题（2026-10-24 站长截图）：搜索「瑞幸咖啡」，结果里同时出现
   库迪咖啡。

   根因：bundle 的主过滤器（useMemo 里的 ln）是纯 includes，共 7 路：
     name / companyName / category / searchKeywords / keyProducts
     / summary / id —— 任一含查询词即命中。
   而 summary 是**叙述性长文本**，不是检索字段。库迪的 summary 写着
   「由瑞幸咖啡创始团队于 2022 年创立」，于是「瑞幸咖啡」四字在
   summary 里整串命中，库迪被筛了出来。
   同类问题早有先例：block-numeric-search.js 处理的「输 1 出宁德
   时代」（年份 2011/2025 在 summary 里）——同一个病根：summary
   参与检索。

   为什么不在输入层拦（block-numeric-search.js 的做法）：
   这次查询词「瑞幸咖啡」是完全合法的文本，输入层无从判断该不该拦。
   要修的是「哪些字段算命中」这个口径，只能在结果层修正。

   修法：React 过滤完之后，在注入层重算一遍「强口径」——
     强字段 = name / companyName / searchKeywords / keyProducts / id
     （即 bundle 里除 summary / category 外的命中路）
     · 强字段有命中 → 仅靠 summary / category 命中的卡片隐藏
       （搜「瑞幸咖啡」→ 只剩瑞幸，库迪收起）
     · 强字段零命中 → 全部显示，summary 兜底
       （搜「六休一」→ 没有品牌名对得上，summary 命中照常展示，
         否则这类检索会直接空结果）
   判定数据来自 bundle 自身：启动时 fetch  bundle 文本，用与
   scripts/gen-pinyin-index.py 完全相同的「括号配平」法提取 brands
   数组（正则会跨对象误匹配，踩过坑），取每个品牌的强字段。
   fetch 失败时降级用 window.__PINYIN_INDEX__（拼音索引，覆盖
   50/53，总比不修正强）。

   为什么隐藏用 class + !important 而不是 inline style：
   stat-filter.js（顶部四格筛选）用 inline display 控制卡片显隐，
   两者都操作同一批卡片；!important 保证档位筛选重新套用时
   不会把口径修正的隐藏状态冲掉。

   实现约束（AGENTS.md / PITFALLS.md）：
   · 只做 DOM 层补丁，不改压缩包；
   · 「虚拟对比黑榜」卡不计入（与 stat-filter 口径一致）；
   · 识别不了品牌的卡片容器不动，避免误伤布局；
   · 幂等：class 增删天然幂等，重复触发无副作用；
   · 与搜索/品类/档位筛选共存：MutationObserver 防抖重算，
     display 状态跟着新节点走（stat-filter 同款节奏）。

   自测导出：window.__SXGSearchScopeFix = { extractFields, applyScope,
   findBrandFor, isStrongHit, ensureFields }，供 test-search-scope-fix.cjs
   ========================================================================== */
(function () {
  'use strict';

  var CARD_SEL = 'div.bg-white.rounded-2xl.border';
  var HIDE_CLASS = 'sxg-scope-hidden';
  var STYLE_ID = 'sxg-scope-fix-style';
  var INPUT_SEL = '#site-search-input';
  var BT = String.fromCharCode(96); // 反引号，模板字符串定界符

  /* ---------------------------------------------------------- 样式 */
  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent =
      '.' + HIDE_CLASS + '{display:none !important}';
    document.head.appendChild(style);
  }

  /* ---------------------------------------------------------- 提取器 */
  // 从 bundle 文本提取 brands 数组的强字段。
  // 必须括号配平 + 跳过模板字符串：词条间距不固定，正则前瞻会跨对象
  // 误匹配（gen-pinyin-index.py 注释记载：patagonia 被安上 pair-vehicles
  // 的关键词）；模板字符串里也可能含 `{` `}`（summary 常见），不跳过
  // 配平立刻错乱。
  function extractFields(src) {
    var marker = 'brands:[';
    var start = src.indexOf(marker);
    if (start === -1) return [];
    start += marker.length;

    var objs = [];
    var depth = 0, cur = -1, j = start;
    while (j < src.length) {
      var ch = src[j];
      if (ch === BT) {
        j += 1;
        while (j < src.length) {
          if (src[j] === BT && src[j - 1] !== '\\') break;
          j += 1;
        }
      } else if (ch === '{') {
        if (depth === 0) cur = j;
        depth += 1;
      } else if (ch === '}') {
        depth -= 1;
        if (depth === 0) objs.push(src.slice(cur, j + 1));
        else if (depth < 0) break;
      }
      j += 1;
    }

    function field(obj, key) {
      var m = obj.match(new RegExp(key + ':' + BT + '([^' + BT + ']*)' + BT));
      return m ? m[1] : null;
    }
    function arrField(obj, key) {
      var m = obj.match(new RegExp(key + ':\\[([^\\]]*)\\]'));
      if (!m) return [];
      var out = [];
      var re = new RegExp(BT + '([^' + BT + ']*)' + BT, 'g');
      var mm;
      while ((mm = re.exec(m[1])) !== null) out.push(mm[1]);
      return out;
    }

    return objs.map(function (obj) {
      var fields = [];
      var name = field(obj, 'name');
      var companyName = field(obj, 'companyName');
      var id = field(obj, 'id');
      if (name) fields.push(name);
      if (companyName) fields.push(companyName);
      fields = fields.concat(arrField(obj, 'searchKeywords'), arrField(obj, 'keyProducts'));
      if (id) fields.push(id);
      return { name: name || '', fields: fields };
    }).filter(function (b) { return b.name; });
  }

  /* 拼音索引降级：entry.t 的每个词条 [原文,...] 都算强字段。
     （注意不能筛 w<4：索引里 w=4 是产品名，而 keyProducts 在 bundle
     里正是强字段；筛选条件只属于拼音联想的排序规则，不属于口径。） */
  function fieldsFromPinyinIndex() {
    var INDEX = window.__PINYIN_INDEX__;
    if (!INDEX || !INDEX.length) return [];
    return INDEX.map(function (e) {
      var fields = (e.t || []).map(function (t) { return t[0]; });
      if (e.cn) fields.push(e.cn);
      return { name: e.name || e.cn || '', fields: fields };
    }).filter(function (b) { return b.name; });
  }

  /* ---------------------------------------------------------- 数据加载 */
  var fieldsCache = null;
  var fieldsPromise = null;

  function bundleUrl() {
    var s = document.querySelector('script[src*="index-YthXZ9eP"]');
    return s ? s.src : '';
  }

  function ensureFields() {
    if (fieldsCache) return Promise.resolve(fieldsCache);
    if (fieldsPromise) return fieldsPromise;
    var url = bundleUrl();
    if (!url || !window.fetch) {
      fieldsCache = fieldsFromPinyinIndex();
      return Promise.resolve(fieldsCache);
    }
    fieldsPromise = window.fetch(url)
      .then(function (res) {
        if (!res.ok) throw new Error('bundle HTTP ' + res.status);
        return res.text();
      })
      .then(function (text) {
        var f = extractFields(text);
        // 提取失败（0 条）时不要静默吞掉，降级保底
        fieldsCache = f.length ? f : fieldsFromPinyinIndex();
        return fieldsCache;
      })
      .catch(function (e) {
        if (window.console && console.warn) {
          console.warn('[搜索口径修正] bundle 提取失败，降级拼音索引：' + e);
        }
        fieldsCache = fieldsFromPinyinIndex();
        return fieldsCache;
      });
    return fieldsPromise;
  }

  /* ---------------------------------------------------------- 判定 */
  function findBrandFor(cardText, fields) {
    // 卡片文本含 brand.name 即视为该品牌的卡；取最长匹配，
    // 避免「库迪」抢先匹配「库迪咖啡 (COTTI COFFEE)」的卡。
    var best = null;
    for (var i = 0; i < fields.length; i++) {
      var nm = fields[i].name;
      if (nm && cardText.indexOf(nm) !== -1) {
        if (!best || nm.length > best.name.length) best = fields[i];
      }
    }
    return best;
  }

  function isStrongHit(brand, q) {
    if (!brand) return false;
    for (var i = 0; i < brand.fields.length; i++) {
      var f = brand.fields[i];
      if (f && f.toLowerCase().indexOf(q) !== -1) return true;
    }
    return false;
  }

  /* ---------------------------------------------------------- 应用 */
  // q 必须与 bundle 口径一致：input.value.trim().toLowerCase()
  function applyScope(q) {
    if (!fieldsCache) return;
    var cards = document.querySelectorAll(CARD_SEL);
    if (!cards.length) return;

    var i, card, text;
    if (!q) {
      for (i = 0; i < cards.length; i++) cards[i].classList.remove(HIDE_CLASS);
      return;
    }

    // 第一遍：判定每张卡是不是强命中
    var verdicts = [];
    var strongCount = 0;
    for (i = 0; i < cards.length; i++) {
      card = cards[i];
      text = card.textContent || '';
      if (text.indexOf('虚拟对比黑榜') !== -1) { verdicts.push(null); continue; }
      var brand = findBrandFor(text, fieldsCache);
      if (!brand) { verdicts.push(null); continue; } // 识别不了的不动
      var strong = isStrongHit(brand, q);
      if (strong) strongCount += 1;
      verdicts.push({ card: card, strong: strong });
    }

    // 第二遍：有强命中就收起弱命中；全弱（强字段零命中）→ summary 兜底全显示
    for (i = 0; i < verdicts.length; i++) {
      var v = verdicts[i];
      if (!v) continue;
      if (strongCount > 0 && !v.strong) v.card.classList.add(HIDE_CLASS);
      else v.card.classList.remove(HIDE_CLASS);
    }
  }

  /* ---------------------------------------------------------- 触发 */
  function currentQuery() {
    var input = document.querySelector(INPUT_SEL);
    if (!input) return '';
    return (input.value || '').trim().toLowerCase();
  }

  function scheduleApply() {
    // React 的 setState 是异步的：input 事件里卡片还没重筛完。
    // 双保险：rAF 等一帧，再拖 50ms；剩下的交给 MutationObserver 兜底。
    if (window.requestAnimationFrame) {
      window.requestAnimationFrame(function () {
        setTimeout(function () { applyScope(currentQuery()); }, 50);
      });
    } else {
      setTimeout(function () { applyScope(currentQuery()); }, 50);
    }
  }

  function bindInput() {
    var input = document.querySelector(INPUT_SEL);
    if (!input || input.dataset.sxgScopeBound === '1') return;
    input.dataset.sxgScopeBound = '1';
    input.addEventListener('input', scheduleApply);
  }

  /* ---------------------------------------------------------- 启动 */
  function start() {
    injectStyle();
    bindInput();
    applyScope(currentQuery());
  }

  ensureFields().then(function () {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', start);
    } else {
      start();
    }
    // 搜索框是「企业真双休检索」标签的条件渲染，首次渲染/切 tab 都要能绑上
    var tries = 0;
    var timer = setInterval(function () {
      bindInput();
      applyScope(currentQuery());
      if (++tries > 80) clearInterval(timer);
    }, 500);
  });

  if (window.MutationObserver) {
    var pending = null;
    var observer = new MutationObserver(function () {
      if (pending) return;
      pending = setTimeout(function () {
        pending = null;
        bindInput();
        applyScope(currentQuery());
      }, 300); // 与 stat-filter 同款防抖节奏
    });
    var root = document.getElementById('root') || document.body;
    if (root) observer.observe(root, { childList: true, subtree: true });
  }

  window.addEventListener('load', function () {
    bindInput();
    applyScope(currentQuery());
  });

  /* ---------------------------------------------------------- 自测导出 */
  window.__SXGSearchScopeFix = {
    extractFields: extractFields,
    fieldsFromPinyinIndex: fieldsFromPinyinIndex,
    findBrandFor: findBrandFor,
    isStrongHit: isStrongHit,
    applyScope: applyScope,
    ensureFields: ensureFields,
    HIDE_CLASS: HIDE_CLASS
  };
})();
