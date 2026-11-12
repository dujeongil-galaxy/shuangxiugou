/* ==========================================================================
   手机端顶栏按钮全部常显（2026-11-12 §36t 站长「我再说一次」指令）
   --------------------------------------------------------------------------
   历史：
     2026-11-09 起本文件做的是「手机端右上角 4 个按钮折叠成『菜单▼』下拉」；
     §36s 又补了断点双向还原。但站长 2026-11-12 明确推翻折叠口径：
       「既然右边已经隔离了，为什么不干脆按钮全部撑开？」
       「我再说一次，手机端，全部展开，按钮不再做隐藏。」
     右侧 76px 隔离列里的 dock 已经全部撑开，顶栏再留一个「菜单▼」，
     等于把 Star on GitHub 这类按钮继续藏着。本版彻底撤掉折叠。

   现在的行为（宽屏 / 窄屏一致，不再有断点差异）：
     · 不创建 #sxg-header-menu / #sxg-header-menu-toggle；
     · 不再注入按钮类的 display:none 隐藏规则；
     · 顶栏按钮组保持原位，由 mobile-fixes.css 在 ≤640px 换行铺满、全部常显；
     · 旧缓存 / 旧 DOM 残留的菜单节点会被清理，里面的按钮搬回按钮组，
       避免「页面看着展开了，按钮其实还留在 display:none 的容器里」；
     · GitHub 帮助触发入口由 github-access-help.js 统一贴 Star 常显。

   ⚠️ 本文件下半段（GitHub 登录状态提示 / Login 提示弹窗 / 登录按钮拦截）
      是另一套既有逻辑，与顶栏折叠无关，一律不动。
   ========================================================================== */
(function () {
  'use strict';

  var STYLE_ID = 'sxg-header-expand-style';
  var ACTS_SEL = 'header div[data-hdr-acts]';
  var MARK = 'data-sxg-hdr-expanded';
  var LEGACY_MENU = 'sxg-header-menu';
  var LEGACY_TOGGLE = 'sxg-header-menu-toggle';
  var GH_TRIGGER = 'sxg-gh-help-trigger';

  function buildStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    /* 只做「不许隐藏」这一条兜底。真正的换行铺满布局写在 mobile-fixes.css。
       两边都不写 display:none —— 这是 §36t 的硬约束。 */
    s.textContent = [
      '@media (max-width:640px){',
      '  header div[' + MARK + '="1"] > a,',
      '  header div[' + MARK + '="1"] > button{display:inline-flex !important;}',
      '}'
    ].join('');
    (document.head || document.documentElement).appendChild(s);
  }

  /* 把旧折叠残留的菜单里的按钮搬回按钮组，然后摘掉菜单 / 菜单按钮。
     幂等：没有残留时什么都不做。帮助入口不搬，交给下游脚本重建圆形按钮。 */
  function reclaim() {
    var acts = document.querySelector(ACTS_SEL);
    if (!acts) return;
    var menu = document.getElementById(LEGACY_MENU);
    if (menu) {
      var kids = [].slice.call(menu.children);
      kids.forEach(function (el) {
        if (el.id === GH_TRIGGER) return;
        acts.appendChild(el);
      });
      if (menu.parentNode) menu.parentNode.removeChild(menu);
    }
    var toggle = document.getElementById(LEGACY_TOGGLE);
    if (toggle && toggle.parentNode) toggle.parentNode.removeChild(toggle);
  }

  function build() {
    buildStyle();
    reclaim();
    var acts = document.querySelector(ACTS_SEL);
    if (!acts) return;
    if (acts.getAttribute(MARK) !== '1') acts.setAttribute(MARK, '1');
  }

  /* 断点切换不再折叠 / 还原，只重新确认一次「全部常显」标记仍在。
     保留监听是为了兜住 React 重渲染把按钮组换掉的情况。 */
  if (window.matchMedia) {
    var mq = window.matchMedia('(max-width: 640px)');
    var onBp = function () { build(); };
    if (mq.addEventListener) mq.addEventListener('change', onBp);
    else if (mq.addListener) mq.addListener(onBp);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build);
  } else {
    build();
  }

  // 等下游补丁（Star / 赞助 / Login / 提交数据 / 帮助入口）把按钮插进来后再确认
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
