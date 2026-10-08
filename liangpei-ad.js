/* ==========================================================================
   良配 · 限时推广广告位 —— 渲染与交互
   --------------------------------------------------------------------------
   ⚠️ 关键点：推广链接是微信小程序 scheme（#小程序://良配/B1ZcfI0N4ii3skj）。
      这种链接无法在网页里直接打开，微信的玩法是：
      复制口令 → 粘贴到任意聊天窗口并发送 → 点自己刚发出的那条消息，
      微信会把它识别成小程序卡片并唤起。
      所以按环境分支：
        · 微信内 → 直接跳转 scheme，唤起小程序
        · 微信外 → 复制口令，并提示上述发送步骤
   ========================================================================== */
(function () {
  'use strict';

  var CONFIG = {
    brand: '良配',
    // 官方未公布活动结束时间，故不设倒计时
    badge: '推广期限时活动',
    title: '注册即送<br>喜茶 20 元<br>无门槛消费红包',
    cta: '立即注册',
    note: '微信小程序 · 推广合作',
    scheme: '#小程序://良配/B1ZcfI0N4ii3skj',
    storageKey: 'lp_ad_dismissed_at',
    // 关闭后多久再展示（毫秒），7 天
    reappearAfter: 7 * 24 * 60 * 60 * 1000
  };

  var LOGO_TEXT = '良配';

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

  /* 把文本写入剪贴板。
     ⚠️ 这里有两个实测踩到的坑，顺序不能改：

     1) document.execCommand('copy') 的返回值不可信。选区为空、元素不可聚焦
        时它照样返回 true，但剪贴板里什么都没有。结果就是 UI 提示「已复制」，
        用户粘贴出来是空的。

     2) 用户手势只在「点击事件的同步执行栈」内有效。一旦写成
        promise.then(...) 或 setTimeout，浏览器就认为手势已结束，
        真正的复制会被静默拒绝。所以 execCommand 必须同步调用，
        不能放进 Promise 链里。

     因此这里的顺序是：同步 execCommand 打头（趁手势还在），
     异步 clipboard API 兜底（现代浏览器里最稳），最后手动复制提示。 */
  function copyText(text) {
    // 第 1 级：同步执行，必须留在点击回调的同步栈里
    var syncOk = copySync(text);

    // 第 2 级：clipboard API。已在异步阶段，只能作为补充。
    return tryClipboardApi(text)
      .then(function () { return true; })
      .catch(function () { return syncOk; });
  }

  /* 同步复制：接管 copy 事件用 setData 显式写入。
     这是本次实测中最可靠的一条——不依赖选区状态，
     clipboardData 在事件内可完整回读验证内容。 */
  function copySync(text) {
    try {
      var onCopy = function (e) {
        if (!e.clipboardData) return;
        e.clipboardData.setData('text/plain', text);
        e.preventDefault();
      };
      document.addEventListener('copy', onCopy);
      var ok = document.execCommand('copy');
      document.removeEventListener('copy', onCopy);
      return !!ok;
    } catch (err) {
      return false;
    }
  }

  // clipboard API 兜底（iOS Safari / 移动端 WebView 下 execCommand 常被禁）
  function tryClipboardApi(text) {
    if (!navigator.clipboard || !navigator.clipboard.writeText) {
      return Promise.reject(new Error('clipboard api unavailable'));
    }
    return navigator.clipboard.writeText(text);
  }

  var toastEl = null;
  var toastTimer = null;

  function showToast(html, keepOpen) {
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
    // 展示口令的提示不自动消失：用户可能需要时间切到微信
    toastTimer = setTimeout(function () {
      toastEl.classList.remove('is-show');
    }, keepOpen ? 15000 : 4200);

    // 口令支持点击再复制一次：自动复制万一没生效，用户点一下能立刻补上
    var code = toastEl.querySelector('code');
    if (code) {
      code.addEventListener('click', function () {
        copyText(CONFIG.scheme);
        code.textContent = CONFIG.scheme + ' ✓';
        setTimeout(function () {
          if (code.isConnected) code.textContent = CONFIG.scheme;
        }, 1400);
      });
    }
  }

  /* 把 toast 里的口令选中。
     user-select:all 已让用户点击时全选，这里再主动选中一次：
     部分移动端浏览器不会因为点击而弹出复制气泡，需要先有真实选区。 */
  function selectManualText() {
    if (!toastEl) return;
    var code = toastEl.querySelector('code');
    if (!code) return;
    try {
      var range = document.createRange();
      range.selectNodeContents(code);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (e) {}
  }

  function build() {
    var aside = document.createElement('aside');
    aside.className = 'lp-ad is-hidden';
    aside.setAttribute('aria-label', '推广：' + CONFIG.brand);

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
      '<a class="lp-ad__cta" role="button"></a>' +
      '<div class="lp-ad__note">' + CONFIG.note + '</div>';

    var cta = aside.querySelector('.lp-ad__cta');
    // 微信外点击会被 JS 拦下改成「复制口令」，href 只在微信内真正生效
    cta.href = CONFIG.scheme;
    cta.textContent = CONFIG.cta;
    cta.addEventListener('click', function (e) {
      if (isWeChat()) return; // 微信内放行默认行为，唤起小程序

      e.preventDefault();
      // copyText 统一 resolve 成布尔值：同步 execCommand 或 clipboard API 任一成功即为 true
      copyText(CONFIG.scheme).then(function (ok) {
        // 无论自动复制成功与否，都把口令本身显示出来。
        // 自动复制在各家浏览器的可用性差异很大（iOS WebView、部分国产浏览器、
        // 非安全上下文都可能静默失败），只提示「已复制」而把口令藏起来，
        // 一旦实际没复制成功，用户就彻底没有出路了。
        showToast(
          (ok ? '已复制，去微信里粘贴发送' : '请复制下方口令') +
            '<br><code>' + CONFIG.scheme + '</code>' +
            '<span class="lp-ad-toast__steps">在微信里发给任意聊天窗口 → 点自己刚发的那条链接</span>',
          true
        );
        selectManualText();
      });
    });

    aside.querySelector('.lp-ad__close').addEventListener('click', function () {
      markDismissed();
      aside.classList.add('is-hidden');
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
  }

  function init() {
    // 官方未公布活动结束时间，不做倒计时与过期隐藏
    if (isDismissedRecently()) return; // 用户刚关闭过：7 天内不再打扰
    build();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
