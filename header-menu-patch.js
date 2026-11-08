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
      /* 手机端先隐藏原来的 4 个按钮，避免加载时闪烁 */
      '@media (max-width:640px){',
      '  .sxg-header-btn{display:none !important;}',
      '}',

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
      '    box-shadow:0 8px 24px rgba(0,0,0,.18);overflow:hidden;z-index:1000;min-width:200px;}',
      '  #' + MENU_ID + '.is-open{display:flex;}',
      '  #' + MENU_ID + ' a{display:block !important;width:100% !important;',
      '    padding:12px 16px !important;margin:0 !important;',
      '    color:#1f2937 !important;background:#fff !important;',
      '    text-decoration:none !important;text-align:left !important;',
      '    font:500 14px/1.4 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif !important;',
      '    border-bottom:1px solid #f3f4f6 !important;border-radius:0 !important;',
      '    box-shadow:none !important;box-sizing:border-box !important;',
      '    white-space:nowrap !important;}',
      '  #' + MENU_ID + ' a:last-child{border-bottom:none !important;}',
      '  #' + MENU_ID + ' a:active{background:#f9fafb !important;}',
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
      // 清空所有原有样式，直接用 JS 强制设置统一样式（比 CSS 更可靠）
      btn.removeAttribute('class');
      btn.removeAttribute('style');
      // 直接内联设置样式，确保万无一失
      btn.style.display = 'block';
      btn.style.width = '100%';
      btn.style.padding = '12px 16px';
      btn.style.margin = '0';
      btn.style.color = '#1f2937';
      btn.style.background = '#fff';
      btn.style.textDecoration = 'none';
      btn.style.textAlign = 'left';
      btn.style.font = '500 14px/1.4 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
      btn.style.borderBottom = '1px solid #f3f4f6';
      btn.style.borderRadius = '0';
      btn.style.boxShadow = 'none';
      btn.style.boxSizing = 'border-box';
      btn.style.whiteSpace = 'nowrap';
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

  // ---------- GitHub 登录状态提示 ----------
  // 自定义 modal 弹窗
  function showModal(title, content, btnText) {
    // 遮罩
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';
    
    // 弹窗卡片
    var modal = document.createElement('div');
    modal.style.cssText = 'background:#fff;border-radius:16px;max-width:400px;width:100%;padding:24px;box-shadow:0 20px 60px rgba(0,0,0,0.3);';
    
    // 标题
    var h3 = document.createElement('h3');
    h3.style.cssText = 'margin:0 0 12px 0;font-size:16px;font-weight:600;color:#1e293b;';
    h3.textContent = title;
    modal.appendChild(h3);
    
    // 内容
    var p = document.createElement('p');
    p.style.cssText = 'margin:0 0 20px 0;font-size:14px;line-height:1.6;color:#475569;';
    p.textContent = content;
    modal.appendChild(p);
    
    // 按钮
    var btn = document.createElement('button');
    btn.style.cssText = 'width:100%;padding:12px;background:#0F766E;color:#fff;border:none;border-radius:12px;font-size:15px;font-weight:500;cursor:pointer;';
    btn.textContent = btnText || '知道了';
    btn.onclick = function() {
      document.body.removeChild(overlay);
    };
    modal.appendChild(btn);
    
    overlay.appendChild(modal);
    overlay.onclick = function(e) {
      if (e.target === overlay) {
        document.body.removeChild(overlay);
      }
    };
    document.body.appendChild(overlay);
  }

  function checkLoginStatusOnLoad() {
    // 检查 URL 参数里的 star_check
    const urlParams = new URLSearchParams(window.location.search);
    const starCheck = urlParams.get('star_check');
    if (starCheck) {
      let title = '';
      let message = '';
      if (starCheck === 'success') {
        title = '✅ GitHub 登录成功';
        message = '已检测到你 Star 本仓库。Star 满 7 天后即可解锁国内高速 AI 服务。';
        localStorage.setItem('sxg_github_logged_in', '1');
        localStorage.setItem('sxg_github_has_star', '1');
      } else {
        title = '⚠️ 已登录，未检测到 Star';
        message = '你已成功登录 GitHub，但还没 Star 本仓库。Star 后即可解锁国内高速 AI 服务。';
        localStorage.setItem('sxg_github_logged_in', '1');
        localStorage.setItem('sxg_github_has_star', '0');
      }
      showModal(title, message, '知道了');
      // 清除 URL 参数，避免刷新重复提示
      history.replaceState({}, document.title, window.location.pathname);
    }
  }

  // 拦截 Login GitHub 按钮点击
  function interceptLoginButton() {
    const loginBtn = document.querySelector('a[href*="/auth/github"]');
    if (loginBtn) {
      // 先移除之前的监听，避免重复
      const newBtn = loginBtn.cloneNode(true);
      loginBtn.parentNode.replaceChild(newBtn, loginBtn);
      
      newBtn.addEventListener('click', function(e) {
        const isLoggedIn = localStorage.getItem('sxg_github_logged_in');
        if (isLoggedIn === '1') {
          e.preventDefault();
          const hasStar = localStorage.getItem('sxg_github_has_star') === '1';
          if (hasStar) {
            showModal('✅ 已登录', '你已登录 GitHub，且已 Star 本仓库。Star 满 7 天后自动解锁国内高速 AI 服务。', '知道了');
          } else {
            showModal('⚠️ 未 Star 仓库', '你已登录 GitHub，但还没 Star 本仓库。Star 后即可解锁国内高速 AI 服务。', '去 Star');
          }
        }
        // 没登录的话，正常跳转到授权页
      });
    }
  }

  // 页面加载时检查登录状态
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkLoginStatusOnLoad);
  } else {
    checkLoginStatusOnLoad();
  }

  // 等按钮加载出来后拦截点击
  setTimeout(interceptLoginButton, 1000);
  setTimeout(interceptLoginButton, 2000);
})();
