/* ==========================================================================
   良配 · 限时推广广告位 —— 渲染与交互
   --------------------------------------------------------------------------
   ⚠️ 关键点：推广链接是微信小程序 scheme（#小程序://良配/B1ZcfI0N4ii3skj）。
      这种链接只在微信内置浏览器里点击才唤起小程序，在普通浏览器 / 桌面
      Safari / Chrome 里点击会毫无反应（表现为「点了没反应」）。
      因此这里做了环境分支：
        · 微信内 → 直接跳转 scheme，唤起小程序
        · 微信外 → 复制 scheme 口令 + 弹提示，引导用户到微信里打开
   ========================================================================== */
(function () {
  'use strict';

  var CONFIG = {
    brand: '良配',
    badge: '限时推广',
    title: '注册即送<br><b>喜茶 20 元</b><br>无门槛红包',
    cta: '立即注册',
    note: '微信小程序 · 推广合作',
    scheme: '#小程序://良配/B1ZcfI0N4ii3skj',    // 活动截止时间（本地时间）。过期后自动隐藏广告位。
    expireAt: '2026-12-31T23:59:59+08:00',
    storageKey: 'lp_ad_dismissed_at',
    // 关闭后多久再展示（毫秒），7 天
    reappearAfter: 7 * 24 * 60 * 60 * 1000
  };

  var LOGO_TEXT = '良';

  function isExpired() {
    var end = new Date(CONFIG.expireAt).getTime();
    return isNaN(end) ? false : Date.now() > end;
  }

  function isDismissedRecently() {
    try {
      var at = Number(localStorage.getItem(CONFIG.storageKey) || 0);
      if (!at) return false;
      return Date.now() - at < CONFIG.reappearAfter;
    } catch (e) {
      // 隐私模式下 localStorage 可能抛错，忽略即可
      return false;
    }
  }

  function markDismissed() {
    try {
      localStorage.setItem(CONFIG.storageKey, String(Date.now()));
    } catch (e) {}
  }

  function isWeChat() {
    return /MicroMessenger/i.test(navigator.userAgent);
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    // 回退方案：非安全上下文（HTTPS 之外的 http）没有 clipboard API
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      var ok = false;
      try {
        ok = document.execCommand('copy');
      } catch (e) {
        ok = false;
      }
      document.body.removeChild(ta);
      ok ? resolve() : reject(new Error('copy failed'));
    });
  }

  var toastEl = null;
  var toastTimer = null;

  function showToast(html) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'lp-ad-toast';
      toastEl.setAttribute('role', 'status');
      toastEl.setAttribute('aria-live', 'polite');
      document.body.appendChild(toastEl);
    }
    toastEl.innerHTML = html;
    // 强制回流，保证连续调用时 transition 能重新触发
    void toastEl.offsetWidth;
    toastEl.classList.add('is-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.classList.remove('is-show');
    }, 4200);
  }

  function pad(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function renderCountdown(box, endAt) {
    function tick() {
      var diff = endAt - Date.now();
      if (diff <= 0) {
        box.textContent = '活动已结束';
        box.classList.add('is-over');
        clearInterval(timer);
        return;
      }
      var d = Math.floor(diff / 86400000);
      var h = Math.floor((diff % 86400000) / 3600000);
      var m = Math.floor((diff % 3600000) / 60000);
      var s = Math.floor((diff % 60000) / 1000);
      box.textContent =
        d > 0 ? '剩 ' + d + ' 天 ' + pad(h) + ':' + pad(m) + ':' + pad(s)
              : '剩 ' + pad(h) + ':' + pad(m) + ':' + pad(s);
    }
    tick();
    var timer = setInterval(tick, 1000);
    return timer;
  }

  function build() {
    var endAt = new Date(CONFIG.expireAt).getTime();

    var aside = document.createElement('aside');
    aside.className = 'lp-ad is-hidden';
    aside.setAttribute('aria-label', '限时推广：' + CONFIG.brand);

    // 无障碍：整块可读屏朗读，关闭按钮单独可聚焦
    aside.innerHTML =
      '<button class="lp-ad__close" type="button" aria-label="关闭广告">&times;</button>' +
      '<span class="lp-ad__badge">' + CONFIG.badge + '</span>' +
      '<div class="lp-ad__body">' +
        '<div class="lp-ad__logo" aria-hidden="true">' + LOGO_TEXT + '</div>' +
        '<div class="lp-ad__text">' +
          '<div class="lp-ad__brand">' + CONFIG.brand + '</div>' +
          '<div class="lp-ad__title">' + CONFIG.title + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="lp-ad__count" aria-live="off"></div>' +
      '<a class="lp-ad__cta" role="button"></a>' +
      '<div class="lp-ad__note">' + CONFIG.note + '</div>';

    var cta = aside.querySelector('.lp-ad__cta');
    // 微信外点击会被 JS 拦下改成「复制口令」，href 只在微信内真正生效
    cta.href = CONFIG.scheme;
    cta.textContent = CONFIG.cta;
    cta.addEventListener('click', function (e) {
      if (isWeChat()) return; // 微信内放行默认行为，唤起小程序

      e.preventDefault();
      copyText(CONFIG.scheme).then(
        function () {
          showToast(
            '推广口令已复制<br>请打开微信「扫一扫 / 文件传输助手」粘贴，或直接搜索小程序<strong>' +
              CONFIG.brand +
            '</strong>'
          );
        },
        function () {
          showToast(
            '复制失败，请手动复制：<br><code style="font-size:12px">' +
              CONFIG.scheme +
            '</code><br>再打开微信搜索小程序「' +
              CONFIG.brand +
            '」'
          );
        }
      );
    });

    aside.querySelector('.lp-ad__close').addEventListener('click', function () {
      markDismissed();
      aside.classList.add('is-hidden');
      clearInterval(timer);
    });

    document.body.appendChild(aside);

    // 竖排（≥1440px）靠 <br> 手动断行；窄屏横排时 <br> 会把文案截断，
    // 这里按当前视口宽度移除 <br>，交由 CSS 的 -webkit-line-clamp 控制行数。
    // 用 matchMedia 而非 resize 监听：只随断点切换时执行，无需频繁重排。
    var wideQuery = window.matchMedia('(min-width: 1440px)');

    function syncBreaks(mq) {
      var titleEl = aside.querySelector('.lp-ad__title');
      if (!titleEl) return;
      if (mq.matches) {
        if (!titleEl.querySelector('br')) {
          titleEl.innerHTML = CONFIG.title;
        }
      } else if (titleEl.querySelector('br')) {
        // 用空格替换掉 <br>，语义不变但可自然折行
        titleEl.innerHTML = titleEl.innerHTML.replace(/<br\s*\/?>/gi, ' ');
      }
    }

    syncBreaks(wideQuery);
    if (typeof wideQuery.addEventListener === 'function') {
      wideQuery.addEventListener('change', syncBreaks);
    } else if (typeof wideQuery.addListener === 'function') {
      // 旧版 Safari
      wideQuery.addListener(syncBreaks);
    }

    // 先让浏览器完成一次布局，再显示，避免位置闪跳
    requestAnimationFrame(function () {
      aside.classList.remove('is-hidden');
    });

    var timer = renderCountdown(aside.querySelector('.lp-ad__count'), endAt);
  }

  function init() {
    if (isExpired()) return;      // 活动已结束：不展示，也不占位
    if (isDismissedRecently()) return; // 用户刚关闭过：7 天内不再打扰

    var endAt = new Date(CONFIG.expireAt).getTime();
    // 倒计时归零后收掉广告位
    setTimeout(function () {
      var box = document.querySelector('.lp-ad .lp-ad__count');
      if (box) box.textContent = '活动已结束';
    }, Math.max(0, endAt - Date.now()));

    build();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
