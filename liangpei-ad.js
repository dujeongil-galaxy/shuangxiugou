/* ==========================================================================
   双休购 · 站点推广广告位 —— 渲染与交互
   --------------------------------------------------------------------------
   2026-10-18 站长指示：原「良配」商业推广位改为本站自我推广，
   文案「必应搜索，雙休購996」——「双休购」简体为输入拦截词，改用繁体。
   点击 CTA 直接跳必应搜索「雙休購996」，不做微信口令复制。

   ⚠️ 关闭规则（2026-10-18 变更）：不再写 localStorage「关闭后 7 天
   不再显示」的记忆——点关闭只隐藏本次页面，刷新后广告重新出现。
   ========================================================================== */
(function () {
  'use strict';

  var CONFIG = {
    // aria-label 与 LOGO 用的短名
    brand: '雙休購',
    // 品牌行（LOGO 下方的第一行文字）。
    // 2026-10-18 站长要求这一行写「必应搜索，雙休購996」，
    // 且**必须完整显示在一行内**，不允许折行。
    // 为此 CSS 里给 .lp-ad__brand 加了 white-space:nowrap。
    brandLine: '必应搜索，雙休購996',
    // 正文
    title: '查公司双休评级，<br>避雷单休大小周 996',
    cta: '去必应搜索',
    note: '搜「雙休購996」直达双休购',
    // 点击 CTA 跳必应搜索繁体词（简体「双休购」为输入拦截词，不直接用）
    link: 'https://www.bing.com/search?q=' + encodeURIComponent('雙休購996')
  };

  var LOGO_TEXT = '雙休購';

  function build() {
    var aside = document.createElement('aside');
    aside.className = 'lp-ad is-hidden';
    aside.setAttribute('aria-label', '推广：' + CONFIG.brand);

    // 无障碍：整块可读屏朗读，关闭按钮单独可聚焦
    aside.innerHTML =
      '<button class="lp-ad__close" type="button" aria-label="关闭广告">&times;</button>' +
      '<div class="lp-ad__body">' +
        '<div class="lp-ad__logo" aria-hidden="true">' + LOGO_TEXT + '</div>' +
        '<div class="lp-ad__text">' +
          '<div class="lp-ad__brand">' + CONFIG.brandLine + '</div>' +
          '<div class="lp-ad__title">' + CONFIG.title + '</div>' +
        '</div>' +
      '</div>' +
      '<a class="lp-ad__cta" role="button"></a>' +
      '<div class="lp-ad__note">' + CONFIG.note + '</div>';

    var cta = aside.querySelector('.lp-ad__cta');
    cta.href = CONFIG.link;
    cta.target = '_blank';
    cta.rel = 'noopener noreferrer';
    cta.textContent = CONFIG.cta;

    // 关闭：仅本次会话隐藏。2026-10-18 起不再写 localStorage，
    // 刷新页面广告即重新出现（原「关闭后 7 天不再显示」规则已删除）。
    aside.querySelector('.lp-ad__close').addEventListener('click', function () {
      aside.classList.add('is-hidden');
    });

    document.body.appendChild(aside);

    // 竖排（≥1440px）靠 <br> 手动断行；窄屏横排时 <br> 会把文案截断，
    // 这里按当前视口宽度移除 <br>，交由 CSS 控制行数。
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
    // 2026-10-18：不再判断「关闭后 N 天不再显示」，每次进入页面都展示
    build();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
