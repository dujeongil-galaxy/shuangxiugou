/* ==========================================================================
   evidence-jump-patch.js
   --------------------------------------------------------------------------
   站长 2026-11-10「大改」：每张品牌卡打开后的详情弹窗，底部「生成我的投票
   小票」那一排都要加一个「跳转到证据链公示」按钮，点下去要**完整跳到该品牌
   对应的证据链公示条目**——不是只打开公示区顶部，而是展开对应 <details>、
   滚到眼前、可见高亮。内置卡（压缩 bundle 里的 React 弹窗）与自定义卡
   （custom-card-actions.js 的 .sxg-layer 弹窗）一视同仁，不看清单值。

   技术红线：assets/index-YthXZ9eP.js 是 compressed bundle，不能改 bundle
   （多一个字符就可能白屏）；也不改 custom-card-actions.js：
   - 两类弹窗若各写一份逻辑，以后必然漂移。这里用**同一个独立 DOM 补丁**，
     靠「含『生成我的投票小票』按钮的底部按钮排」定位两种容器，运行时插按钮。

   真相源只有一处：首页 #evidence-board 里的
   <details id="ev-<slug>" data-b="<slug>">，由 scripts/gen-evidence-board.py
   从 brand/*.html 自动生成（请勿手改）。本脚本不硬编码任何品牌 URL / 品牌名
   清单，运行时读公示区 DOM 建索引，公示区怎么改，按钮就跟着怎么跳。

   匹配顺序（逐层放宽，命中即停）：
   ① 品牌名归一化精确匹配（去掉空白与分隔符、英文小写）：168/175 张卡靠这步命中；
      「赵一鸣/零食很忙」与公示区「赵一鸣 / 零食很忙」这类空格差异就是靠它对齐。
   ② 去括号后的品牌名匹配：公示区写「工商银行 (ICBC)」「一点点 (1点点)」，
      卡面只写「工商银行」「一点点」，靠这步对齐；
   ③ slug 兜底：customCardsConfig 的 id 去掉 -card 后缀查 ev-<slug> / data-b，
      防止以后卡名与公示名命名分叉；
   ④ 公司名归一化匹配。
   都没命中（例如「某代工烘焙食品 (虚拟对比黑榜)」这种虚拟卡）**不编造条目**：
   展开公示区总览 + 如实提示「暂无独立证据链公示条目」。

   幂等与重渲染：按钮带 data-sxg-ev-jump，容器带 data-sxg-ev-jump-root；
   MutationObserver + requestAnimationFrame 在 React / 自定义弹窗重渲染后补挂。
   ========================================================================== */
(function () {
  'use strict';

  var BTN_TEXT = '跳转到证据链公示';
  var BTN_ATTR = 'data-sxg-ev-jump';
  var ROOT_ATTR = 'data-sxg-ev-jump-root';
  var FOCUS_ATTR = 'data-sxg-ev-focus';
  var NOTICE_ATTR = 'data-sxg-ev-notice';
  var STYLE_ID = 'sxg-ev-jump-style';
  var ANCHOR_TEXT = '生成我的投票小票';
  var FOCUS_MS = 4200;

  var focusTimer = null;
  var noticeTimer = null;
  var pending = false;

  function $$(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }
  function txt(el) { return String((el && el.textContent) || '').trim(); }

  /* 归一化：去掉所有空白与常见分隔符，英文转小写。
     不动汉字、英文字母与数字，避免误伤「1点点」「BOCD」这类品牌标识。 */
  function norm(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/[\s\u3000]/g, '')
      .replace(/[\/·・,，、（）()\-—_]/g, '');
  }
  /* 去掉中英文括号及其内容：「工商银行 (ICBC)」→「工商银行」 */
  function stripParen(s) {
    return String(s || '').replace(/[（(][^）)]*[）)]/g, '').trim();
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent =
      '.sxg-ev-jump-btn{display:inline-flex;align-items:center;justify-content:center;' +
        'gap:6px;flex:0 0 auto;white-space:nowrap;cursor:pointer;' +
        'background:#f0fdfa;color:#0f766e;border:1px solid #99f6e4;' +
        'border-radius:12px;font-size:12px;font-weight:700;line-height:1.2;' +
        'padding:10px 14px;transition:background .18s ease,border-color .18s ease}' +
      '.sxg-ev-jump-btn:hover{background:#ccfbf1;border-color:#5eead4}' +
      '.sxg-ev-jump-btn:focus-visible{outline:2px solid #0d9488;outline-offset:2px}' +
      '[' + ROOT_ATTR + ']{flex-wrap:wrap}' +
      '#evidence-board details[' + FOCUS_ATTR + ']{outline:3px solid #0d9488;' +
        'outline-offset:-3px;background:#f0fdfa;' +
        'box-shadow:0 0 0 6px rgba(13,148,136,.12);transition:background .2s ease}' +
      '#evidence-board details[' + FOCUS_ATTR + '] summary{background:#ccfbf1}' +
      '[' + NOTICE_ATTR + ']{margin:10px 0 14px;padding:10px 12px;' +
        'background:#fffbeb;border:1px solid #fde68a;border-left:4px solid #d97706;' +
        'border-radius:8px;color:#92400e;font-size:13px;line-height:1.6}';
    (document.head || document.documentElement).appendChild(s);
  }

  function boardDetails() {
    return $$('#evidence-board details[data-b]');
  }
  function bnOf(d) {
    var b = d.querySelector('summary .bn');
    return txt(b);
  }
  function coOf(d) {
    var c = d.querySelector('summary .co');
    return txt(c);
  }

  /* 从弹窗标题反查自定义卡 id（内置卡没有配置，返回空串即可，
     前两路品牌名匹配已经覆盖全部内置卡）。 */
  function cfgIdByName(title) {
    var list = window.customCardsConfig || [];
    var key = norm(title);
    for (var i = 0; i < list.length; i++) {
      if (norm(list[i] && list[i].name) === key ||
          norm(stripParen(list[i] && list[i].name)) === key) {
        return String((list[i] && list[i].id) || '');
      }
    }
    return '';
  }

  /* 卡片/弹窗标题 → 公示区 <details>。命中即返回，未命中返回 null。 */
  function resolveTarget(title, cfgId) {
    var list = boardDetails();
    if (!list.length) return null;
    var key = norm(title);
    var shortKey = norm(stripParen(title));
    var i, d;

    // ① 品牌名归一化精确匹配
    if (key) {
      for (i = 0; i < list.length; i++) {
        if (norm(bnOf(list[i])) === key) return list[i];
      }
    }
    // ② 去括号后的品牌名匹配（双向：卡面简称 / 公示名带括注）
    if (key || shortKey) {
      for (i = 0; i < list.length; i++) {
        var b = norm(stripParen(bnOf(list[i])));
        if (b && (b === key || b === shortKey)) return list[i];
      }
    }
    // ③ slug 兜底（customCardsConfig 的 id 去掉 -card）
    var slug = String(cfgId || '').replace(/-card$/, '');
    if (slug) {
      d = document.getElementById('ev-' + slug);
      if (d && d.getAttribute('data-b')) return d;
      for (i = 0; i < list.length; i++) {
        if (list[i].getAttribute('data-b') === slug) return list[i];
      }
    }
    // ④ 公司名归一化匹配
    if (key) {
      for (i = 0; i < list.length; i++) {
        if (norm(coOf(list[i])) === key) return list[i];
      }
    }
    return null;
  }

  /* 弹窗标题：优先 h2（两类弹窗都有 h2 品牌名），退回 h3。 */
  function modalTitle(modal) {
    if (!modal) return '';
    var h = modal.querySelector('h2') || modal.querySelector('h3');
    return txt(h);
  }

  /* 从底部按钮排往上找到弹窗根节点（.sxg-layer 或 fixed 覆盖层）。 */
  function modalRoot(foot) {
    var p = foot;
    for (var i = 0; i < 9 && p; i++) {
      var cls = String(p.className || '');
      if (/(^|\s)sxg-layer(\s|$)/.test(cls)) return p;
      if (/(^|\s)fixed(\s|$)/.test(cls) && /inset-0/.test(cls)) return p;
      p = p.parentElement;
    }
    return null;
  }

  /* 关闭弹窗：优先点它自己的关闭按钮（让 React / custom-card-actions.js
     自己走卸载流程，绝不外部 removeChild React 管理的节点），最后派 Escape。 */
  function closeModal(modal) {
    if (!modal) return;
    var bs = $$('button', modal);
    var i, t;
    for (i = 0; i < bs.length; i++) {
      t = txt(bs[i]);
      if (t === '关闭' || t === '✕' || t === '×' || bs[i].getAttribute('aria-label') === '关闭') {
        bs[i].click();
        return;
      }
    }
    try {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    } catch (e) { /* jsdom / 老浏览器忽略 */ }
  }

  /* 展开公示区（evidence-collapse.js 把内容收进了 .ev-body-wrap 并默认隐藏）。 */
  function expandBoard(board, target) {
    var wrap = board.querySelector('.ev-body-wrap');
    if (wrap) wrap.style.display = 'block';
    var h2 = board.querySelector('h2');
    if (h2) {
      h2.classList.add('is-open');
      h2.setAttribute('aria-expanded', 'true');
      var hint = h2.querySelector('.ev-hint');
      if (hint) hint.textContent = '点击收起';
    }
    if (target && target.tagName === 'DETAILS') target.setAttribute('open', '');
  }

  function focusTarget(target) {
    $$('[' + FOCUS_ATTR + ']').forEach(function (d) { d.removeAttribute(FOCUS_ATTR); });
    if (!target) return;
    target.setAttribute(FOCUS_ATTR, '1');
    if (focusTimer) clearTimeout(focusTimer);
    focusTimer = setTimeout(function () {
      target.removeAttribute(FOCUS_ATTR);
      focusTimer = null;
    }, FOCUS_MS);
  }

  /* 没有对应条目时如实说明，不假装命中、不编造证据。 */
  function showNotice(board, title) {
    $$('[' + NOTICE_ATTR + ']').forEach(function (n) {
      if (n.parentNode) n.parentNode.removeChild(n);
    });
    var box = document.createElement('div');
    box.setAttribute(NOTICE_ATTR, '1');
    box.setAttribute('role', 'status');
    box.textContent = '「' + (title || '该品牌') + '」暂无独立证据链公示条目，' +
      '已为你展开完整公示区总览；本站不编造证据，也不假装命中。';
    var anchor = board.querySelector('h2');
    if (anchor && anchor.nextSibling) anchor.parentNode.insertBefore(box, anchor.nextSibling);
    else board.appendChild(box);
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = setTimeout(function () {
      if (box.parentNode) box.parentNode.removeChild(box);
      noticeTimer = null;
    }, FOCUS_MS);
  }

  function setHash(id) {
    try { history.replaceState(null, '', '#' + id); } catch (e) { /* file:// 忽略 */ }
  }

  /* 完整跳转：关弹窗 → 展开公示区 → 展开目标 details → 滚动定位 → 高亮 → 可分享锚点。 */
  function openEvidence(target, title) {
    var board = document.getElementById('evidence-board');
    if (!board) {
      // 公示区只存在于首页；万一从别的页面打开弹窗，带锚点回首页。
      location.href = './index.html#' + (target ? target.id : 'evidence-board');
      return;
    }
    expandBoard(board, target);
    if (typeof window.__sxgOpenEvidenceBoard === 'function') {
      window.__sxgOpenEvidenceBoard(target ? target.id : null);
    } else {
      // evidence-collapse.js 未就绪时自行滚动，行为不降级
      requestAnimationFrame(function () {
        (target || board).scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
    if (target) {
      focusTarget(target);
      setHash(target.id);
    } else {
      focusTarget(null);
      showNotice(board, title);
      setHash('evidence-board');
    }
  }

  function makeButton() {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'sxg-ev-jump-btn';
    b.setAttribute(BTN_ATTR, '1');
    b.textContent = BTN_TEXT;
    b.setAttribute('title', '展开本站证据链公示区，并定位到该品牌的公示条目');
    b.setAttribute('aria-label', BTN_TEXT + '：展开并定位到该品牌的证据链公示条目');
    b.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      var foot = b.parentElement;
      var modal = modalRoot(foot);
      var title = modalTitle(modal);
      var target = resolveTarget(title, cfgIdByName(title));
      closeModal(modal);
      // 让弹窗自身的卸载流程先跑完，再滚公示区，避免遮罩还盖着。
      setTimeout(function () { openEvidence(target, title); }, 60);
    });
    return b;
  }

  /* 两类弹窗共用的定位口径：找到「生成我的投票小票」按钮所在的底部按钮排。
     内置 React 弹窗：div.pt-2.flex.justify-end.gap-2
     自定义卡弹窗：div.sxg-actions.right
     其它弹窗（小票 / 投票 / 致谢）没有这个锚点按钮，不会被误挂。 */
  function findFoot(btn) {
    var foot = btn && btn.parentElement;
    if (!foot) return null;
    var cls = String(foot.className || '');
    var isCustom = /(^|\s)sxg-actions(\s|$)/.test(cls);
    var isBuiltin = /(^|\s)pt-2(\s|$)/.test(cls) && /justify-end/.test(cls);
    if (!isCustom && !isBuiltin) return null;
    return foot;
  }

  function scan() {
    injectStyle();
    var btns = $$('button');
    for (var i = 0; i < btns.length; i++) {
      if (txt(btns[i]).indexOf(ANCHOR_TEXT) === -1) continue;
      var foot = findFoot(btns[i]);
      if (!foot) continue;
      // 幂等：容器上已有按钮就不重复插（React 重渲染重建容器时靠 Observer 补挂）
      if (foot.querySelector('[' + BTN_ATTR + ']')) continue;
      if (!foot.hasAttribute(ROOT_ATTR)) foot.setAttribute(ROOT_ATTR, '1');
      foot.insertBefore(makeButton(), btns[i]);
    }
  }

  function schedule() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(function () {
      pending = false;
      scan();
    });
  }

  /* 从分享链接 #ev-xxx 进来时，自动展开并定位（等 evidence-collapse.js 就绪）。 */
  function bootFromHash() {
    var m = /^#(ev-[a-z0-9-]+)$/i.exec(location.hash || '');
    if (!m) return;
    var d = document.getElementById(m[1]);
    if (!d) return;
    setTimeout(function () { openEvidence(d, bnOf(d)); }, 350);
  }

  // 测试钩子：scripts/test-evidence-jump.cjs 直接调，不必等整条弹窗事件链。
  window.__sxgEvidenceJump = {
    resolve: resolveTarget,
    open: openEvidence,
    scan: scan,
    norm: norm,
    stripParen: stripParen,
    cfgIdByName: cfgIdByName
  };

  function init() {
    injectStyle();
    scan();
    var mo = new MutationObserver(schedule);
    mo.observe(document.body || document.documentElement, { childList: true, subtree: true });
    document.addEventListener('click', schedule, true);
    bootFromHash();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
