/* ==========================================================================
   手机端右上角按钮折叠成下拉菜单（2026-11-09 站长指令）
   --------------------------------------------------------------------------
   需求：
     1) PC 端：右上角 4 个按钮（提交数据/Star/赞助/Login）全部常显
     2) 手机端：右上角只显示一个「菜单▼」按钮，点开后下拉显示这 4 个按钮
   2026-11-12 §36s 补：断点切换要**双向**。以前只有「进窄屏折叠」这一半，
   手机端载入后把窗口拉宽，四个按钮仍留在下拉容器里，在顶栏右侧竖着堆成一列。
   现在记住每个按钮原来的父节点 / class / style，切回宽屏逐个还原；下拉容器
   在宽屏也强制 display:none，杜绝残留节点撑坏布局。
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

      /* 宽屏下拉容器一律不显示：断点切回桌面时菜单里残留的节点不能竖着堆在顶栏 */
      '#' + MENU_ID + '{display:none !important;}',

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
      '  #' + MENU_ID + '.is-open{display:flex !important;}',
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

  /* 每个按钮的原始归属；断点来回切换都靠它还原，绝不重新猜父节点。 */
  var records = [];
  var collapsed = false;

  function applyMenuStyle(btn) {
    btn.classList.remove('sxg-header-btn');
    btn.removeAttribute('class');
    btn.removeAttribute('style');
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
  }

  function collapse() {
    var menu = document.getElementById(MENU_ID);
    if (!menu) return false;
    var list;
    if (records.length) {
      list = records.map(function (r) { return r.el; });
    } else {
      list = [].slice.call(document.querySelectorAll('.sxg-header-btn'));
      if (!list.length) return false;
      list.forEach(function (el) {
        records.push({
          el: el,
          parent: el.parentNode,
          cls: el.getAttribute('class') || '',
          style: el.getAttribute('style') || ''
        });
      });
    }
    list.forEach(function (btn) {
      applyMenuStyle(btn);
      menu.appendChild(btn);
    });
    collapsed = true;
    return true;
  }

  function restore() {
    var toggle = document.getElementById(TOGGLE_ID);
    var menu = document.getElementById(MENU_ID);
    records.forEach(function (r) {
      if (!r.el || !r.parent) return;
      if (r.cls) r.el.setAttribute('class', r.cls);
      else r.el.removeAttribute('class');
      if (r.style) r.el.setAttribute('style', r.style);
      else r.el.removeAttribute('style');
      var before = (toggle && toggle.parentNode === r.parent) ? toggle : null;
      r.parent.insertBefore(r.el, before);
    });
    if (menu) menu.classList.remove('is-open');
    collapsed = false;
  }

  function build() {
    if (!isMobile()) return;
    if (document.getElementById(TOGGLE_ID)) {
      if (!collapsed) collapse();
      return;
    }

    buildStyle();

    var btns = document.querySelectorAll('.sxg-header-btn');
    if (btns.length === 0 && !records.length) return;
    var first = btns[0] || records[0].el;

    // 找到按钮组的共同父容器（顶栏里那个 position:relative 的容器）
    var container = first.parentElement;
    while (container && container.style.position !== 'relative') {
      container = container.parentElement;
    }
    if (!container || container.style.position !== 'relative') {
      container = first.parentElement;
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

    container.appendChild(toggle);
    container.appendChild(menu);
    collapse();

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

  /* 断点双向切换：进窄屏折叠、回宽屏还原。此前只有前半段，
     手机端载入后拉宽会留下一列竖排的顶栏按钮（§36s 真渲染实测）。 */
  if (window.matchMedia) {
    var mq = window.matchMedia('(max-width:640px)');
    var onBp = function () {
      if (mq.matches) {
        if (!collapsed) build();
      } else if (collapsed) {
        restore();
      }
    };
    if (mq.addEventListener) mq.addEventListener('change', onBp);
    else if (mq.addListener) mq.addListener(onBp);
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
    p.style.cssText = 'margin:0 0 20px 0;font-size:14px;line-height:1.6;color:#475569;white-space:pre-line;';
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

  // VPN 提示弹窗（点击 Login GitHub 时先弹这个）
  function showVpnWarningModal(loginUrl) {
    // 遮罩
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';
    
    // 弹窗卡片
    var modal = document.createElement('div');
    modal.style.cssText = 'background:#fff;border-radius:16px;max-width:400px;width:100%;padding:24px;box-shadow:0 20px 60px rgba(0,0,0,0.3);';
    
    // 标题
    var h3 = document.createElement('h3');
    h3.style.cssText = 'margin:0 0 12px 0;font-size:16px;font-weight:600;color:#1e293b;';
    h3.textContent = '⚠️ 提示';
    modal.appendChild(h3);
    
    // 内容
    var p = document.createElement('p');
    p.style.cssText = 'margin:0 0 20px 0;font-size:14px;line-height:1.6;color:#475569;white-space:pre-line;';
    p.innerHTML = 'GitHub 在大陆可能无法直接访问，如遇打不开请先开启 VPN。\n\n站长推荐：<a href="https://47.112.97.173:8000/register?aff=v17mHNYv" target="_blank" style="color:#0F766E;">点此购买</a>';
    modal.appendChild(p);
    
    // 按钮容器
    var btnContainer = document.createElement('div');
    btnContainer.style.cssText = 'display:flex;gap:10px;';
    
    // 仍然登录按钮
    var continueBtn = document.createElement('button');
    continueBtn.style.cssText = 'flex:1;padding:12px;background:#0F766E;color:#fff;border:none;border-radius:12px;font-size:15px;font-weight:500;cursor:pointer;';
    continueBtn.textContent = '仍然登录';
    continueBtn.onclick = function() {
      document.body.removeChild(overlay);
      window.location.href = loginUrl;
    };
    btnContainer.appendChild(continueBtn);
    
    // 取消按钮
    var cancelBtn = document.createElement('button');
    cancelBtn.style.cssText = 'flex:1;padding:12px;background:#f1f5f9;color:#64748b;border:none;border-radius:12px;font-size:15px;font-weight:500;cursor:pointer;';
    cancelBtn.textContent = '取消';
    cancelBtn.onclick = function() {
      document.body.removeChild(overlay);
    };
    btnContainer.appendChild(cancelBtn);
    
    modal.appendChild(btnContainer);
    
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
    const starDays = parseInt(urlParams.get('star_days') || '0');
    const starDate = urlParams.get('star_date') || '未知';
    
    if (starCheck) {
      let title = '';
      let message = '';
      const remainingDays = Math.max(0, 7 - starDays);
      
      if (starCheck === 'success') {
        title = '✅ GitHub 登录成功';
        message = `你给本仓库点的 Star 已经满 ${starDays} 天啦，解锁条件达成 ✅\nStar 日期：${starDate}\n\n国内的高速 AI 服务已经为你开通，直接去用就好。`;
        localStorage.setItem('sxg_github_logged_in', '1');
        localStorage.setItem('sxg_github_has_star', '1');
        localStorage.setItem('sxg_star_days', starDays.toString());
        localStorage.setItem('sxg_star_date', starDate);
      } else {
        title = '⏳ 等待解锁';
        if (starDays > 0) {
          message = `你给本仓库点的 Star 到第 ${starDays} 天了，还差 ${remainingDays} 天满 7 天就能解锁国内高速 AI 服务。\nStar 日期：${starDate}`;
        } else {
          message = '你 GitHub 已经登录了，但还没给本仓库点 Star。\n点完 Star、攒满 7 天，就能解锁国内的高速 AI 服务。';
        }
        localStorage.setItem('sxg_github_logged_in', '1');
        localStorage.setItem('sxg_github_has_star', '0');
        localStorage.setItem('sxg_star_days', starDays.toString());
        localStorage.setItem('sxg_star_date', starDate);
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
          const starDays = parseInt(localStorage.getItem('sxg_star_days') || '0');
          const starDate = localStorage.getItem('sxg_star_date') || '未知';
          const remainingDays = Math.max(0, 7 - starDays);
          
          if (hasStar) {
            if (starDays >= 7) {
              showModal('✅ 已解锁', `你给本仓库点的 Star 已经满 ${starDays} 天啦，解锁条件达成 ✅\nStar 日期：${starDate}\n\n国内的高速 AI 服务已经为你开通，直接去用就好。`, '知道了');
            } else {
              showModal('⏳ 等待中', `你给本仓库点的 Star 到第 ${starDays} 天了，还差 ${remainingDays} 天满 7 天就能解锁国内高速 AI 服务。\nStar 日期：${starDate}`, '知道了');
            }
          } else {
            showModal('⚠️ 未 Starred 仓库', '你 GitHub 已经登录了，但还没给本仓库点 Star。\n点完 Star、攒满 7 天，就能解锁国内的高速 AI 服务。', '去 Starred');
          }
        } else {
          // 没登录的话，先弹 VPN 提示
          e.preventDefault();
          showVpnWarningModal(newBtn.href);
        }
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
