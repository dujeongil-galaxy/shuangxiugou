/* ==========================================================================
   全站证据链公示区 · 折叠/展开
   --------------------------------------------------------------------------
   背景：站长 2026-10-31 反馈证据链公示区「太乱」，要求默认藏起、点击展开。

   重要约束：
   - 该区（#evidence-board）由 scripts/gen-evidence-board.py 自动生成，
     注释明确「请勿手改」，且有 verify.mjs 防漂移断言逐条比对。
   - 因此本脚本【不修改生成内容】，只在运行时用 DOM 操作把 h2 变成把手、
     其下全部内容收进一个容器默认隐藏，点击 h2 切换展开/收起。
   - 生成内容原样保留在 DOM（仅 CSS 视觉隐藏），verify 防漂移断言不受影响。
   ========================================================================== */
(function () {
  'use strict';

  function injectStyle() {
    if (document.getElementById('ev-collapse-style')) return;
    var s = document.createElement('style');
    s.id = 'ev-collapse-style';
    s.textContent =
      '#evidence-board .ev-toggle{cursor:pointer;user-select:none}' +
      '#evidence-board .ev-toggle:hover{color:#0f172a}' +
      '#evidence-board .ev-caret{display:inline-block;margin-left:6px;transition:transform .18s ease;font-size:14px;color:#64748b}' +
      '#evidence-board .ev-toggle.is-open .ev-caret{transform:rotate(90deg)}' +
      '#evidence-board .ev-hint{font-size:12px;font-weight:500;color:#94a3b8;margin-left:6px}' +
      '#evidence-board .ev-body-wrap{margin-top:0}';
    document.head.appendChild(s);
  }

  function init() {
    var board = document.getElementById('evidence-board');
    if (!board) return;
    // 已经处理过则跳过（防止重复绑定 / HMR 重跑）
    if (board.dataset.evCollapsed === '1') return;

    var h2 = board.querySelector('h2');
    if (!h2) return;

    injectStyle();

    // 把 h2 之后的所有兄弟节点收进一个容器，默认隐藏
    var wrap = document.createElement('div');
    wrap.className = 'ev-body-wrap';
    while (h2.nextSibling) wrap.appendChild(h2.nextSibling);
    board.appendChild(wrap);

    h2.classList.add('ev-toggle');
    h2.setAttribute('role', 'button');
    h2.setAttribute('tabindex', '0');
    h2.setAttribute('aria-expanded', 'false');
    h2.insertAdjacentHTML(
      'beforeend',
      ' <span class="ev-caret" aria-hidden="true">▸</span>' +
      '<span class="ev-hint">点击展开完整证据链</span>'
    );

    var collapsed = true;
    function apply() {
      wrap.style.display = collapsed ? 'none' : 'block';
      h2.classList.toggle('is-open', !collapsed);
      h2.setAttribute('aria-expanded', String(!collapsed));
      var hint = h2.querySelector('.ev-hint');
      if (hint) hint.textContent = collapsed ? '点击展开完整证据链' : '点击收起';
    }
    function toggle() { collapsed = !collapsed; apply(); }

    h2.addEventListener('click', toggle);
    h2.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
    });

    board.dataset.evCollapsed = '1';
    apply();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
