/* ==========================================================================
   星巴克 × WorkBuddy 联名推广 —— 渲染与交互（临时替换「良配」，2026-11-12）
   --------------------------------------------------------------------------
   架构与 liangpei-ad.js 完全一致：独立 IIFE，经 index.html 引用，不碰压缩 bundle。
   复用 --sxg-bar-h 避让语义（≥1440px 写 0，吸底条写实测高度，隐藏写 0）。

   2026-11-17 站长三点修正：
   ① 海报改**白底**（原来照抄了活动页深色截图，贴在本站浅色页面像块黑砖）；
   ② 撤掉我凭空画的绿黑棋盘格假码（扫不出来，纯属搞笑）——改用站长 11-12 给的
      原图里那个**真实微信小程序码**，已从原图裁出存 assets/workbuddy-mp-code.png。
      真码扫进「腾讯WorkBuddy」小程序即可领券；三张原图里没有可复制的口令文本，
      所以不做「复制口令」那套（免得编造不存在的口令）；
   ③ logo 不再用文字「星巴克」凑，直接借站内 `./assets/starbucks.svg`（首页品牌卡同一个）。
   ========================================================================== */
(function () {
  'use strict';

  var CONFIG = {
    // 顶部小悬浮卡
    brand: '星巴克',
    title: 'WorkBuddy 小程序<br>免费领星巴克咖啡',
    cta: '查看活动',
    note: '星巴克 × WorkBuddy 联名',

    // 弹窗里的完整活动信息（站长要求：活动日期必须完整显示）
    // 图三活动页原文：11月12日8:00-11月16日23:59
    activityDateFull: '11月12日 8:00 — 11月16日 23:59',
    reward: '领星巴克大杯美式咖啡券',
    qty: '共 10 万张',
    foot: '*活动详情及规则请至 AI 办公助手腾讯 WorkBuddy 相关活动页查看',
    copy: 'WorkBuddy 小程序免费领取星巴克咖啡啦！快来参与吧！完全免费哦～请你喝咖啡☕！',

    // 弹窗主行动按钮（可选）：填了真实活动链接才显示并跳转
    activityUrl: '',
    // 活动入口 = 站长 2026-11-12 给的原图里那个**真实微信小程序码**（圆形、带 WorkBuddy 图标，
    // 扫它进「腾讯WorkBuddy」小程序领券）。已从原图裁出存 assets/workbuddy-mp-code.png。
    // 2026-11-17 站长纠正：「何来扫码？」——指的是我之前凭空画的绿黑棋盘格假码，
    // 不是这张真码。真码可扫、是官方入口，保留「微信扫一扫」说明。
    mpCode: './assets/workbuddy-mp-code.png',
    mpName: '腾讯 WorkBuddy',
    // 真实海报图（可选）：放进 ./assets/starbucks-poster.jpg 后整块替换 CSS 复原版
    posterImg: '',
    // 站内现成 logo（首页品牌卡同一份），不自己画
    logoSrc: './assets/starbucks.svg',

    storageKey: 'sb_ad_dismissed_at',
    reappearAfter: 7 * 24 * 60 * 60 * 1000,
    // 2026-11-18 站长反馈「网页都出来一会了，底部广告才开始加载」：
    // 1500ms 在快网下等于页面渲染完还空 1.5 秒，观感就是「慢半拍」。
    // 降到 200ms —— 保留约一帧延迟 + CSS 的 opacity 淡入（不加载即弹），
    // 但基本与首屏同步出现。0ms 会撞回 2026-10-29 修掉的「加载即弹」老坑。
    showAfter: 200
  };

  var LOGO_TEXT = '星巴克';
  var LOGO_ALT = '星巴克';

  /* 品牌小圆标：优先用站内现成 SVG；图片加载失败才退回文字标（离线/换图不至于开天窗） */
  function logoHtml(cls) {
    return '<span class="' + cls + '" aria-hidden="true">' +
      '<img class="' + cls + '__img" src="' + CONFIG.logoSrc + '" alt="' + LOGO_ALT + '" ' +
        'onerror="this.style.display=\'none\';this.parentNode.classList.add(\'is-fallback\');this.parentNode.textContent=\'' + LOGO_TEXT + '\'">' +
    '</span>';
  }

  // 点关闭只隐藏本次页面，刷新后重新出现（与良配一致，不做 7 天记忆）
  function isDismissedRecently() { return false; }
  function markDismissed() {}

  function build() {
    var aside = document.createElement('aside');
    aside.className = 'sxg-promo is-hidden';
    aside.setAttribute('aria-label', '推广：星巴克 × WorkBuddy 联名活动');

    aside.innerHTML =
      '<button class="sxg-promo__close" type="button" aria-label="关闭广告">&times;</button>' +
      '<div class="sxg-promo__body">' +
        logoHtml('sxg-promo__logo') +
        '<div class="sxg-promo__text">' +
          '<div class="sxg-promo__brand">' + CONFIG.brand + ' × WorkBuddy</div>' +
          '<div class="sxg-promo__title">' + CONFIG.title + '</div>' +
        '</div>' +
      '</div>' +
      '<a class="sxg-promo__cta" role="button" tabindex="0">' + CONFIG.cta + '</a>' +
      '<div class="sxg-promo__note">' + CONFIG.note + '</div>';

    var cta = aside.querySelector('.sxg-promo__cta');
    cta.addEventListener('click', function (e) {
      e.preventDefault();
      openModal();
    });

    aside.querySelector('.sxg-promo__close').addEventListener('click', function () {
      markDismissed();
      aside.classList.add('is-hidden');
      aside.style.visibility = '';   // 清掉 reveal 写的内联值，让 is-hidden 生效
      updateBarVar();
    });

    document.body.appendChild(aside);

    // 复用良配同款 --sxg-bar-h 避让逻辑
    function updateBarVar() {
      var wide = !!(window.matchMedia && window.matchMedia('(min-width: 1440px)').matches);
      var h = (wide || aside.classList.contains('is-hidden')) ? 0 : aside.offsetHeight;
      document.documentElement.style.setProperty('--sxg-bar-h', h + 'px');
    }
    updateBarVar();
    var _sbResizeTimer = null;
    window.addEventListener('resize', function () {
      clearTimeout(_sbResizeTimer);
      _sbResizeTimer = setTimeout(updateBarVar, 150);
    });

    // ---- 活动海报弹窗 ----
    buildModal();

    function reveal() {
      aside.classList.remove('is-hidden');
      /* 真机实测（2026-11-18）：只改 class 时 visibility 过渡会卡在 hidden
         （opacity 已 1、DOM 已建好，但广告始终不可见 —— 站长反复反馈的
         「广告看不见 / 加载慢」就是这个）。强制重排一次打断过渡帧，
         再写内联 visible 兜底，两道一起才稳定放出来。 */
      void aside.offsetWidth;                    // 强制 reflow，打断卡住的过渡帧
      aside.style.setProperty('visibility', 'visible', 'important');
      updateBarVar();
    }
    setTimeout(reveal, CONFIG.showAfter);
    /* 兜底：万一 reveal 那帧被浏览器合并/延后，load 后再强制一次 */
    window.addEventListener('load', function () {
      if (aside.classList.contains('is-hidden')) reveal();
      else aside.style.visibility = 'visible';
    }, { once: true });
  }

  var modalEl = null;
  function buildModal() {
    if (document.getElementById('sb-modal')) return;
    var m = document.createElement('div');
    m.className = 'sb-modal';
    m.id = 'sb-modal';

    var posterInner;
    if (CONFIG.posterImg) {
      posterInner = '<img class="sb-modal__poster-img" src="' + CONFIG.posterImg +
        '" alt="星巴克 × WorkBuddy 联名活动海报">';
    } else {
      // CSS 复原版海报（白底；未放入真实图片时的兜底）
      // 入口 = 站长原图里的真·微信小程序码（不是我自己画的假棋盘格）。
      // 真码图片加载失败才退回纯文字说明，绝不摆假码冒充可扫。
      var entryInner = CONFIG.mpCode
        ? '<div class="sb-poster__qr">' +
            '<img class="sb-poster__qr-img" src="' + CONFIG.mpCode +
              '" alt="' + CONFIG.mpName + ' 微信小程序码，微信扫一扫参与领券">' +
            '<div class="sb-poster__scan">微信扫一扫 · 打开 ' + CONFIG.mpName + ' 小程序参与</div>' +
          '</div>'
        : '<div class="sb-poster__entry-tip sb-poster__entry-tip--plain">活动入口在微信小程序「' +
            CONFIG.mpName + '」内，进小程序后在活动页领取</div>';

      posterInner =
        '<div class="sb-poster">' +
          '<div class="sb-poster__head">' +
            logoHtml('sb-poster__sb') +
            '<span class="sb-poster__x">×</span>' +
            '<span class="sb-poster__wb">WorkBuddy</span>' +
          '</div>' +
          '<div class="sb-poster__date">' + CONFIG.activityDateFull + '</div>' +
          '<div class="sb-poster__line">上 WorkBuddy</div>' +
          '<div class="sb-poster__line">完成指定 AI 任务</div>' +
          '<div class="sb-poster__reward">' + CONFIG.reward + '</div>' +
          '<div class="sb-poster__qty">' + CONFIG.qty + '</div>' +
          '<div class="sb-poster__entry-wrap">' + entryInner + '</div>' +
          '<div class="sb-poster__foot">' + CONFIG.foot + '</div>' +
        '</div>';
    }

    var ctaHtml = CONFIG.activityUrl
      ? '<a class="sb-modal__cta" href="' + CONFIG.activityUrl + '" target="_blank" rel="noopener">前往 WorkBuddy 参与</a>'
      : '';

    m.innerHTML =
      '<div class="sb-modal__card" role="dialog" aria-modal="true" aria-label="星巴克 × WorkBuddy 联名活动">' +
        '<button class="sb-modal__close" type="button" aria-label="关闭弹窗">&times;</button>' +
        posterInner +
        '<div class="sb-modal__copy">' + CONFIG.copy + '</div>' +
        ctaHtml +
      '</div>';

    document.body.appendChild(m);
    modalEl = m;

    m.querySelector('.sb-modal__close').addEventListener('click', closeModal);
    // 点击遮罩（卡片以外）关闭
    m.addEventListener('click', function (e) {
      if (e.target === m) closeModal();
    });
    // ESC 关闭
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && m.classList.contains('is-open')) closeModal();
    });
  }

  function openModal() {
    if (modalEl) modalEl.classList.add('is-open');
  }
  function closeModal() {
    if (modalEl) modalEl.classList.remove('is-open');
  }

  function init() {
    if (isDismissedRecently()) return;
    build();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
