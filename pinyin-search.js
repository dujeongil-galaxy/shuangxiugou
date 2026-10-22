// ============================================================
// 拼音 / 首字母模糊搜索联想
//
// 解决的问题
// ----------
// bundle 里的搜索是纯 includes 硬匹配，只认输入的字面串。
// 输「ning」搜不到「宁德时代」，输「ndsd」也搜不到。
//
// 为什么是「联想回填」而不是「直接改写搜索」
// ------------------------------------------
// 真正的模糊搜索要改 React 内部的 brands 数组，那只能手改压缩产物
// assets/index-YthXZ9eP.js —— 项目红线：多一个字符就可能白屏，
// 且控制台无报错。
//
// 所以走另一条路：输入拼音时在搜索框下方给出候选，用户点一下
// 回填中文名，之后的过滤完全交给 React 原生搜索。
// 渲染路径没变，零风险；回填的词保证是 bundle 能原生命中的名字。
//
// 两条链路（2026-10-22 起，自定义卡重新入联想）
// ------------------------------------------
// ① 回填（内置卡）：applyFill —— 把主名填进搜索框，交给 React 过滤。
// ② 定位（自定义卡）：locateCard —— 清空搜索让 React 恢复全量列表，
//    滚动到目标卡并高亮。**不能**走回填：自定义卡不在 bundle 的
//    brands 数组里，回填后 React 必然 0 结果，而 0 结果会把整片内容
//    替换成「未找到匹配的品牌信息」，注入的卡片随父节点一起销毁
//    （2026-10-19 的错误解法是把自定义卡全部踢出联想，导致输「ls」
//    永远搜不出零食品牌 —— 站长：「关于零食这个分类，修复过无数次」）。
//    点候选的意图是「我要看这家」，不是「我要用这个词搜索」，
//    所以定位才是对的语义。
//
// 排序规则
// --------
// 命中层级（越小越前）
//   0 原文命中      「宁德」→ 宁德时代
//   1 全拼（音节边界）ningde → 宁德时代
//   4 全拼（跨音节）  勉强命中，排最后
//   2 首字母全等    ndsd → 宁德时代
//   3 首字母包含    hw → 华为
// 同层再按「词条重要度」排：主名 > 英文名 > 公司全称 > 关键词 > 产品名。
// 这一层不是锦上添花：输「hw」时华为的「华为」(关键词) 必须压过
// 巴塔哥尼亚的「户外」(关键词)，否则用户会看到一堆户外品牌。
//
// ⚠️ 两字母缩写天然有歧义，且这不是排序能解决的问题。
//    输「ms」只会命中星巴克的「美式」（微软首字母是 wr，不该出现）。
//    这是数据决定的。因此 UI 必须显示命中词条，让用户看得懂为什么
//    命中这家 —— 靠排序去猜用户意图只会越猜越错。
// ============================================================
(function () {
  'use strict';

  var INDEX = window.__PINYIN_INDEX__;
  if (!INDEX || !INDEX.length) return;

  var BOX_ID = 'pinyin-suggest';
  var MAX_SHOW = 6;

  // ---------- 匹配 ----------
  function normalize(s) {
    return (s || '').toLowerCase().replace(/\s+/g, '');
  }

  // term = [原文, 全拼, 首字母, 重要度]
  // 返回 [层级, 重要度, 位置, 命中词条]；不命中返回 null
  function scoreTerm(q, term) {
    var t = term[0].toLowerCase();
    var f = term[1].toLowerCase();
    var i = term[2].toLowerCase();
    var w = term[3] || 3;
    // 纯英文词条的首字母索引没有意义（Microsoft 的首字母就是 Microsoft）
    var hasCjk = /[一-鿿]/.test(term[0]);
    // 重要度 4 = 产品名，不参与首字母匹配。
    // 原因见文件头注释：几乎每个品牌都有「X 系列」这类产品名，
    // 首字母天然以 xl 之类收尾，不排除的话搜「xl」会命中一堆产品线。
    var initialsOk = hasCjk && w < 4;
    var best = null;

    function take(c) {
      if (!best) { best = c; return; }
      // 只在前三维严格更小时才替换，保持先命中优先
      if (c[0] < best[0] ||
          (c[0] === best[0] && c[1] < best[1]) ||
          (c[0] === best[0] && c[1] === best[1] && c[2] < best[2])) {
        best = c;
      }
    }

    var p = t.indexOf(q);
    if (p !== -1) take([0, w, p, term[0]]);

    p = f.indexOf(q);
    if (p !== -1) {
      // 落在音节开头才算规范命中，否则排到末层
      var boundary = (p === 0) || 'aeiou'.indexOf(f.charAt(p - 1)) !== -1;
      take([boundary ? 1 : 4, w, p, term[0]]);
    }

    if (initialsOk) {
      if (i === q) take([2, w, 0, term[0]]);
      else {
        p = i.indexOf(q);
        if (p !== -1) take([3, w, p, term[0]]);
      }
    }
    return best;
  }

  function search(rawQuery) {
    var q = normalize(rawQuery);
    if (!q) return [];
    var hits = [];
    for (var n = 0; n < INDEX.length; n++) {
      var entry = INDEX[n];
      // 自定义卡走「定位」链路，不需要「可回填的主名」——
      // 「主名能被 React 原生命中」这个前提只对回填链路成立
      // （2026-10-22：自定义卡重新入联想，见 locateCard 注释）
      if (!entry.custom && !fillTerm(entry)) continue;
      var best = null;
      for (var k = 0; k < entry.t.length; k++) {
        var s = scoreTerm(q, entry.t[k]);
        if (s && (!best ||
            s[0] < best[0] ||
            (s[0] === best[0] && s[1] < best[1]) ||
            (s[0] === best[0] && s[1] === best[1] && s[2] < best[2]))) {
          best = s;
        }
      }
      if (best) hits.push({ entry: entry, lv: best[0], hitTerm: best[3] });
    }
    hits.sort(function (a, b) {
      if (a.lv !== b.lv) return a.lv - b.lv;
      var aw = weightOf(a.entry, a.hitTerm);
      var bw = weightOf(b.entry, b.hitTerm);
      if (aw !== bw) return aw - bw;
      return a.entry.name.length - b.entry.name.length;
    });
    return hits.slice(0, MAX_SHOW);
  }

  function weightOf(entry, hitTerm) {
    for (var k = 0; k < entry.t.length; k++) {
      if (entry.t[k][0] === hitTerm) return entry.t[k][3] || 3;
    }
    return 3;
  }

  // ---------- 回填用词 ----------
  // 必须是 React 原生搜索能命中的字面串，否则点了没反应。
  //
  // ⚠️ React 的真实过滤只查三个字段（bundle 里压缩后是）：
  //      ne = n.filter(e => e.name.toLowerCase().includes(kw)
  //        || e.companyName.toLowerCase().includes(kw)
  //        || e.keyProducts.some(p => p.toLowerCase().includes(kw)))
  //    searchKeywords / summary / category **都不参与**。
  //    所以「命中词条」不能直接拿去回填 —— 词条可能来自 searchKeywords
  //    （如「零售」「零食」）或产品名，回填后 React 一个都搜不到。
  //
  //    正确做法：一律回填 entry.cn（主名里的中文字），它必然命中 name。
  //    这条规则由 gen-pinyin-index.py 保证：生成时回查 bundle，
  //    主名不是原生可搜字面串的品牌直接不入索引（2026-10-19 修复）。
  function fillTerm(entry) {
    return entry.cn || entry.name || '';
  }

  function matchKind(lv) {
    if (lv === 0) return '名称匹配';
    if (lv === 1) return '全拼';
    if (lv === 2) return '首字母';
    if (lv === 4) return '近似';
    return '包含';
  }

  // ---------- UI ----------
  function mountBox(input) {
    var box = document.getElementById(BOX_ID);
    if (box) return box;
    box = document.createElement('div');
    box.id = BOX_ID;
    box.setAttribute('role', 'listbox');
    box.style.cssText = [
      'position:absolute', 'z-index:60', 'left:0', 'right:0', 'top:100%',
      'margin-top:6px', 'background:#fff', 'border:1px solid #e2e8f0',
      'border-radius:12px', 'box-shadow:0 10px 30px rgba(15,23,42,.14)',
      'overflow:hidden', 'display:none'
    ].join(';');
    return box;
  }

  function attach(input) {
    var box = mountBox(input);
    if (box.parentNode) return box;
    var p = input.parentNode;
    if (p) {
      var pos = window.getComputedStyle(p).position;
      if (!pos || pos === 'static') p.style.position = 'relative';
      p.appendChild(box);
    } else {
      document.body.appendChild(box);
    }
    return box;
  }

  function hide(box) { if (box) box.style.display = 'none'; }

  function render(input, box, hits) {
    box.innerHTML = '';
    if (!hits.length) { hide(box); return; }

    var label = document.createElement('div');
    label.textContent = '拼音联想 · 点选或按 Enter 回填';
    label.style.cssText = [
      'padding:7px 14px', 'font-size:11px', 'color:#64748b',
      'background:#f8fafc', 'border-bottom:1px solid #f1f5f9',
      'font-weight:600'
    ].join(';');
    box.appendChild(label);

      hits.forEach(function (h) {
        var row = document.createElement('button');
        row.type = 'button';
        row.setAttribute('role', 'option');
        row.setAttribute('data-fill', fillTerm(h.entry));
        // 自定义卡候选带 id 与 custom 标记：点击走定位而非回填
        row.setAttribute('data-entry-id', h.entry.id || '');
        row.setAttribute('data-custom', h.entry.custom ? '1' : '0');
        row.style.cssText = [
          'display:flex', 'align-items:center', 'gap:8px', 'width:100%',
          'padding:9px 14px', 'background:#fff', 'border:0', 'cursor:pointer',
          'text-align:left', 'font-size:13px', 'font-family:inherit', 'color:#0f172a'
        ].join(';');

        var nm = document.createElement('span');
        nm.textContent = h.entry.name;
        nm.style.cssText = 'font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';

        // 显示命中词条：让用户知道「凭什么匹配到这家」
        var why = document.createElement('span');
        why.textContent = '「' + h.hitTerm + '」' + matchKind(h.lv)
          + (h.entry.custom ? ' · 定位' : '');
        why.style.cssText = [
          'margin-left:auto', 'font-size:11px', 'color:#94a3b8',
          'flex-shrink:0', 'padding-left:8px', 'white-space:nowrap'
        ].join(';');

        row.appendChild(nm);
        row.appendChild(why);
        row.addEventListener('mouseenter', function () { row.style.background = '#f0fdf4'; });
        row.addEventListener('mouseleave', function () { row.style.background = '#fff'; });
        // mousedown 而非 click：click 在 input blur 之后才触发，
        // 那时联想框可能已隐藏，事件就丢了
        row.addEventListener('mousedown', function (ev) {
          ev.preventDefault();
          if (row.getAttribute('data-custom') === '1') {
            locateCard(input, box, row.getAttribute('data-entry-id'));
          } else {
            applyFill(input, box, row.getAttribute('data-fill'));
          }
        });
        box.appendChild(row);
      });

    box.style.display = 'block';
  }

  // ---------- 回填 ----------
  function applyFill(input, box, text) {
    if (!text) return;
    // React 受控输入：直接赋值 React 感知不到，必须走原生 setter
    // 再派发 input 事件，搜索才会重新过滤
    var setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value');
    if (setter && setter.set) setter.set.call(input, text);
    else input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    hide(box);
    input.focus();
  }

  // ---------- 定位（自定义卡专用，2026-10-22）----------
  // 见文件头「两条链路」：自定义卡不能走 applyFill 回填 ——
  // 它们不在 bundle 的 brands 数组里，回填后 React 0 结果，
  // 而 React 的 0 结果会把整片内容替换成空态、把注入的卡片一起销毁
  // （2026-10-19 站长截图 bug；当时的错误解法是把自定义卡踢出联想）。
  //
  // 定位语义：清空搜索 → React 恢复全量列表 → 注入层把卡片插回来
  // → 滚动到该卡并高亮一闪。轮询等待卡片出现（React 重渲染与
  // insertAllCustomCards 都是异步的，不可能同步拿到）。
  function locateCard(input, box, entryId) {
    hide(box);
    var setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value');
    if (setter && setter.set) setter.set.call(input, '');
    else input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();

    function scrollTo(card) {
      card.scrollIntoView({ block: 'center' });
    }

    var tries = 0;
    function subtreeHidden(node) {
      var w = node;
      while (w && w !== document.body) {
        if (w.style && w.style.display === 'none') return true;
        w = w.parentNode;
      }
      return false;
    }
    (function poll() {
      var card = entryId ? document.getElementById(entryId) : null;
      // 卡片必须在「当前可见列表」里：filterCustomCards 可能还处于
      // 上一轮搜索的过滤态，此时滚动到一个隐藏的卡是白滚
      var visible = !!card && !subtreeHidden(card);
      if (visible) {
        scrollTo(card);
        var oldShadow = card.style.boxShadow;
        card.style.transition = 'box-shadow .3s';
        card.style.boxShadow = '0 0 0 3px #fbbf24';
        setTimeout(function () { card.style.boxShadow = oldShadow; }, 1200);
        // ⚠️ 只滚一次不够（2026-10-22 实测）：点击候选时页面往往还停在
        // 「上一轮搜索的过滤态」，清空搜索后 React 会把被过滤掉的内置卡
        // 逐个插回列表，目标卡被挤到下方几千像素 —— 我们滚到的位置
        // 立刻就失效。所以滚动后再盯一小段窗口：目标跑出视口就再滚，
        // 最多补 5 次。这不是防御性编程，是页面真实时序。
        var guard = 0;
        (function watch() {
          if (guard++ >= 5) return;
          setTimeout(function () {
            var c = entryId ? document.getElementById(entryId) : null;
            if (!c || !c.parentNode) return; // 卡被卸载，放弃
            var r = c.getBoundingClientRect();
            var vh = window.innerHeight || document.documentElement.clientHeight || 800;
            if (r.top < -20 || r.bottom > vh + 20) scrollTo(c);
            watch();
          }, 250);
        })();
        return;
      }
      // 卡片还没插回来/还在过滤态：最多等 2 秒（20 × 100ms），超时就当没发生过
      if (++tries < 20) setTimeout(poll, 100);
    })();
  }

  // ---------- 绑定 ----------
  // ⚠️ 搜索框是「企业真双休检索」标签页的条件渲染（bundle 里 `brands&&...`），
  //    页面初始状态不在该标签时它根本不存在。所以这里不能只查一次：
  //    1) setInterval 轮询兜底首次渲染
  //    2) MutationObserver 兜底标签切换后的重新挂载
  //    两者都靠 dataset.pinyinBound 标记保证幂等，重复触发不会重复绑事件。
  function bind() {
    var input = document.getElementById('site-search-input')
             || document.querySelector('main input[type="text"]');
    if (!input) return false;
    if (input.dataset.pinyinBound === '1') return true;
    input.dataset.pinyinBound = '1';

    var box = attach(input);

    input.addEventListener('input', function () {
      var q = normalize(input.value);
      // 少于 2 字符不联想，避免单字母刷屏
      if (q.length < 2) { hide(box); return; }
      render(input, box, search(input.value));
    });

    input.addEventListener('blur', function () {
      setTimeout(function () { hide(box); }, 120);
    });

    input.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Enter') return;
      if (box.style.display === 'none') return;
      var first = box.querySelector('button[data-fill]');
      if (!first) return;
      ev.preventDefault();
      // 第一条是自定义卡 → 走定位链路（Enter 与点击必须同语义）
      if (first.getAttribute('data-custom') === '1') {
        locateCard(input, box, first.getAttribute('data-entry-id'));
        return;
      }
      applyFill(input, box, first.getAttribute('data-fill'));
    });

    return true;
  }

  // 1) 轮询：bundle 是 type=module，加载与渲染都晚于本脚本
  var tries = 0;
  var timer = setInterval(function () {
    if (bind() || ++tries > 80) clearInterval(timer);
  }, 250);

  // 2) 观察 DOM：切到「企业真双休检索」标签时搜索框才挂载
  function startObserver() {
    var root = document.getElementById('root') || document.body;
    if (!root || typeof MutationObserver === 'undefined') return;
    var scheduled = false;
    var mo = new MutationObserver(function () {
      // 用微批处理脱离 observer 回调栈，避免与 React 渲染互相干扰
      if (scheduled) return;
      scheduled = true;
      Promise.resolve().then(function () {
        scheduled = false;
        try { bind(); } catch (e) {
          if (window.console) console.warn('[拼音搜索] bind 抛异常', e);
        }
      });
    });
    mo.observe(root, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startObserver);
  } else {
    startObserver();
  }

  window.addEventListener('popstate', function () { setTimeout(bind, 300); });
})();