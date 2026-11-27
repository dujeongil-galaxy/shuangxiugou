#!/usr/bin/env node
/**
 * topic-page-button.js —— 有独立专题页的品牌，卡片底部加一枚「专题报道」按钮
 *
 * 2026-11-27 站长要求：比亚迪 / 华为 / 星巴克三家有独立专题页，
 * 品牌卡**底部**（卡片最下面那条底栏）加一枚按钮，最左侧，点进去就是那篇专题报道。
 *
 * 为什么单独写脚本：品牌卡是压缩 bundle（assets/index-YthXZ9eP.js）里的 React 组件，
 * 按仓库铁律**不能改 bundle**；只能像 luckin-note-patch.js / news-incident-patch.js
 * 那样，在渲染后的 DOM 上自己挂。
 *
 * 真相源只有一处（与 evidence-jump-patch.js 同一条纪律）：
 *   brand/<slug>.html 里的 <meta name="sxg-topic-page" content="../xxx-report.html">
 *   → gen-evidence-board.py 搬进公示区 <details data-topic="./xxx-report.html">
 *   → 本脚本运行时读公示区 DOM 取这个属性。
 * **本脚本不硬编码品牌清单**：以后哪个品牌要加专题页，只在它的详情页加一行标记，
 * 公示区与按钮自动跟上；反过来，详情页删掉标记，按钮自动消失。
 *
 * 落位口径：卡片底栏 = bundle 里 `px-5 py-3 bg-slate-50/70 border-t …` 那一排，
 * 其第一个子元素是左侧组（我支持 / 我抵制），按钮插在**左侧组的最前面**——
 * 即站长说的「加在底部，最左侧」。右侧组（员工投票 / 打卡 / 详情证据）不动。
 *
 * 幂等与自愈：
 *   ① 每轮先清后插——挂错卡、位置不对、href 不符的按钮一律摘掉（PITFALLS 1.10
 *      提到的「React 复用 DOM 节点导致补丁跑到别的品牌下」在本脚本同样成立）；
 *   ② 按钮插在卡片内部，卡被搜索/筛选摘掉时按钮跟着走，不会残留在别的卡上；
 *   ③ MutationObserver + requestAnimationFrame 在 React 重渲染后自动补挂。
 */
(function () {
  'use strict';

  var MARK = 'data-sxg-topic-btn';
  var STYLE_ID = 'sxg-topic-btn-style';
  var BTN_TEXT = '专题报道';

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent =
      '.sxg-topic-btn{display:inline-flex;align-items:center;gap:4px;padding:4px 10px;' +
        'border-radius:8px;border:1px solid #99f6e4;background:#f0fdfa;color:#0f766e;' +
        'font-size:12px;font-weight:600;line-height:1.4;text-decoration:none;white-space:nowrap;' +
        'transition:background .18s ease,border-color .18s ease}' +
      '.sxg-topic-btn:hover{background:#ccfbf1;border-color:#5eead4;color:#115e59}' +
      '.sxg-topic-btn:focus-visible{outline:2px solid #0d9488;outline-offset:2px}';
    (document.head || document.documentElement).appendChild(s);
  }

  /* 归一化：去空白与常见分隔符、英文小写。不动汉字与数字，避免误伤标识。 */
  function norm(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/[\s\u3000]/g, '')
      .replace(/[\/·・,，、（）()\-—_]/g, '');
  }
  /* 去中英文括号及其内容：「华为终端 (Huawei)」→「华为终端」 */
  function stripParen(s) {
    return String(s || '').replace(/[（(][^）)]*[）)]/g, '').trim();
  }

  /** 公示区里与该品牌名对应的条目（没有就返回 null）。 */
  function boardDetails() {
    return Array.prototype.slice.call(document.querySelectorAll('#evidence-board details[data-b]'));
  }
  function bnOf(d) {
    var b = d.querySelector('summary .bn');
    return b ? String(b.textContent || '').trim() : '';
  }

  /** 卡片标题 → 该品牌专题页地址（公示区条目的 data-topic）；没有就返回空串。 */
  function topicOf(title) {
    if (!title) return '';
    var list = boardDetails();
    if (!list.length) return '';
    var key = norm(title);
    var shortKey = norm(stripParen(title));
    var i, d, bn;
    for (i = 0; i < list.length; i++) {          // ① 品牌名归一化精确匹配
      bn = bnOf(list[i]);
      if (bn && norm(bn) === key) return list[i].getAttribute('data-topic') || '';
    }
    for (i = 0; i < list.length; i++) {          // ② 去括号后匹配（卡面带括注、公示名不带）
      bn = bnOf(list[i]);
      if (bn && norm(stripParen(bn)) === shortKey) return list[i].getAttribute('data-topic') || '';
    }
    return '';
  }

  function isCardRoot(el) {
    return !!(el && el.classList && el.classList.contains('bg-white')
      && el.classList.contains('rounded-2xl') && el.classList.contains('border'));
  }
  function cardRootOf(el) {
    var cur = el && el.parentElement;
    for (var d = 0; cur && d < 8 && cur !== document.body; d++) {
      if (isCardRoot(cur)) return cur;
      cur = cur.parentElement;
    }
    return null;
  }
  function cardTitle(card) {
    var h = card && card.querySelector('h2, h3');
    return h ? String(h.textContent || '').trim() : '';
  }
  /* 卡片底栏（bundle 的 px-5 py-3 那一排） */
  function footOf(card) {
    return card ? card.querySelector('div[class*="px-5 py-3"]') : null;
  }
  /* 底栏左侧组（我支持 / 我抵制） */
  function leftGroupOf(foot) {
    return foot ? foot.firstElementChild : null;
  }

  function makeButton(href) {
    var a = document.createElement('a');
    a.setAttribute(MARK, '1');
    a.className = 'sxg-topic-btn';
    a.setAttribute('href', href);
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
    a.setAttribute('title', '打开该品牌的独立专题报道（新窗口）');
    a.setAttribute('aria-label', '打开该品牌的独立专题报道：' + href);
    a.textContent = BTN_TEXT;
    // 不让点击冒泡到卡片上的别的处理器；链接本身照常新窗口打开。
    a.addEventListener('click', function (ev) { ev.stopPropagation(); });
    return a;
  }

  /** 位置与 href 都对才算就位；否则摘掉重挂（自愈）。 */
  function isPlaced(node, left, href) {
    return !!node && node.parentElement === left && left.firstElementChild === node
      && node.getAttribute('href') === href;
  }

  function scan() {
    injectStyle();
    var cards = document.querySelectorAll('div.bg-white.rounded-2xl.border');
    var i, card, foot, left, title, href, existing;
    for (i = 0; i < cards.length; i++) {
      card = cards[i];
      foot = footOf(card);
      if (!foot) continue;
      left = leftGroupOf(foot);
      if (!left) continue;
      title = cardTitle(card);
      href = title ? topicOf(title) : '';
      existing = card.querySelector('[' + MARK + ']');
      if (!href) {
        // 这张卡没有专题页 → 不该有按钮；挂错的（跑到本卡上的旧节点）一并摘掉
        if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
        continue;
      }
      if (isPlaced(existing, left, href)) continue;
      if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
      left.insertBefore(makeButton(href), left.firstChild);
    }
    // 兜底：不在任何卡片底栏左侧组里的孤儿按钮（React 复用节点等）一律清掉
    var stray = document.querySelectorAll('[' + MARK + ']');
    for (i = 0; i < stray.length; i++) {
      var node = stray[i];
      var lg = node.parentElement;
      var ft = lg ? lg.parentElement : null;
      var cd = ft ? cardRootOf(ft) : null;
      var placed = !!cd && footOf(cd) === ft && leftGroupOf(ft) === lg
        && lg.firstElementChild === node;
      if (!placed && node.parentNode) node.parentNode.removeChild(node);
    }
  }

  var scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(function () {
      scheduled = false;
      scan();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', schedule);
  } else {
    schedule();
  }
  try {
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  } catch (e) {
    console.error('[双休购] 专题报道按钮补丁监听失败：', e);
  }

  // 测试钩子：scripts/test-topic-page-button.cjs 直接调，不必等整条事件链。
  window.__sxgTopicBtn = {
    scan: scan,
    topicOf: topicOf,
    norm: norm,
    stripParen: stripParen
  };
})();
