/* ==========================================================================
   手机端右上角按钮折叠成下拉菜单（2026-11-09 站长指令）
   --------------------------------------------------------------------------
   需求：
     1) PC 端：右上角 4 个按钮（提交数据/Star/赞助/Login）全部常显
     2) 手机端：右上角只显示一个「菜单▼」按钮，点开后下拉显示这 4 个按钮
   ========================================================================== */
(function () {
  'use strict';

  var STYLE_ID = 'sxg-header-menu-style';
  var TOGGLE_ID = 'sxg-header-menu-toggle';
  var MENU_ID = 'sxg-header-menu';

  function buildStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var css = [
      /* 手机端才显示这个折叠按钮 */
      '#' + TOGGLE_ID + '{display:none;}',

      /* 手机端：隐藏原来的 4 个按钮，只显示折叠按钮 */
      '@media (max-width:640px){',
      '  .sxg-header-btn{display:none !important;}',
      '  #' + TOGGLE_ID + '{display:inline-flex;align-items:center;gap:4px;',
      '    padding:8px 14px;background:#0F766E;color:#fff;border:none;border-radius:19px;',
      '    font:600 13px/1 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;',
      '    cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.15);}',
      '  #' + TOGGLE_ID + ':active{transform:translateY(1px);}',

      /* 下拉菜单 */
      '  #' + MENU_ID + '{display:none;position:absolute;top:calc(100% + 8px);right:0;',
      '    flex-direction:column;gap:0;background:#fff;border-radius:14px;',
      '    box-shadow:0 8px 24px rgba(0,0,0,.18);overflow:hidden;z-index:1000;min-width:180px;}',
      '  #' + MENU_ID + '.is-open{display:flex;}',
      '  #' + MENU_ID + ' a{display:block;padding:12px 16px;color:#1f2937;text-decoration:none;',
      '    font:500 14px/1.4 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;',
      '    border-bottom:1px solid #f3f4f6;}',
      '  #' + MENU_ID + ' a:last-child{border-bottom:none;}',
      '  #' + MENU_ID + ' a:active{background:#f9fafb;}',
      '}'
    ].join('');
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = css;
    document.head.appendChild(style);
  }

  function isMobile() {
    return window.matchMedia && window.matchMedia('(max-width:640px)').matches;
  }

  function build() {
    if (!isMobile()) return;
    if (document.getElementById(TOGGLE_ID)) return;

    buildStyle();

    // 找到所有带 sxg-header-btn class 的按钮
    var btns = document.querySelectorAll('.sxg-header-btn');
    if (btns.length === 0) return;

    // 找到它们的共同父容器
    var container = btns[0].parentElement;
    while (container && container.style.position !== 'relative') {
      container = container.parentElement;
    }
    // 如果没找到 relative 的父容器，就给按钮的父容器加上 relative
    if (!container || container.style.position !== 'relative') {
      container = btns[0].parentElement;
      container.style.position = 'relative';
    }

    // 创建折叠按钮
    var toggle = document.createElement('button');
    toggle.id = TOGGLE_ID;
    toggle.type = 'button';
    toggle.setAttribute('aria-label', '展开站点菜单');
    toggle.innerHTML = '菜单 <span style="font-size:10px;">▼</span>';

    // 创建下拉菜单容器
    var menu = document.createElement('div');
    menu.id = MENU_ID;

    // 把原来的 4 个按钮移到下拉菜单里
    btns.forEach(function(btn) {
      // 先取消隐藏（CSS 里隐藏了它们）
      btn.style.display = '';
      btn.classList.remove('sxg-header-btn'); // 从这个 class 里去掉，不再被 CSS 隐藏
      menu.appendChild(btn);
    });

    // 把折叠按钮和下拉菜单加到父容器里
    container.appendChild(toggle);
    container.appendChild(menu);

    // 点击折叠按钮切换下拉菜单
    toggle.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      menu.classList.toggle('is-open');
    });

    // 点空白处收起
    document.addEventListener('click', function(e) {
      if (!menu.contains(e.target) && e.target !== toggle) {
        menu.classList.remove('is-open');
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build);
  } else {
    build();
  }

  // 等 MutationObserver 把按钮都插进来后再执行（因为按钮是运行时补丁插入的）
  setTimeout(build, 1000);
  setTimeout(build, 2000);
})();
