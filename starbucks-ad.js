/* ==========================================================================
   星巴克 × WorkBuddy 联名推广 —— 渲染与交互（临时替换「良配」，2026-11-12）
   --------------------------------------------------------------------------
   架构与 liangpei-ad.js 完全一致：独立 IIFE，经 index.html 引用，不碰压缩 bundle。
   复用 --sxg-bar-h 避让语义（≥1440px 写 0，吸底条写实测高度，隐藏写 0）。

   ⚠️ 真实二维码：把活动海报（含二维码）放到 ./assets/starbucks-poster.jpg，
      弹窗会自动改用该图（含真二维码）。否则显示 CSS 复原版海报 + 占位「扫码参与」。
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
    // 真实海报图（含二维码）：放在 ./assets/starbucks-poster.jpg 后自动启用
    posterImg: '',

    storageKey: 'sb_ad_dismissed_at',
    reappearAfter: 7 * 24 * 60 * 60 * 1000,
    // 延迟淡入，先让用户看清首页内容（与良配一致，避免加载即弹）
    showAfter: 6000
  };

  var LOGO_TEXT = '星巴克';

  // 点关闭只隐藏本次页面，刷新后重新出现（与良配一致，不做 7 天记忆）
  function isDismissedRecently() { return false; }
  function markDismissed() {}

  function build() {
    var aside = document.createElement('aside');
    aside.className = 'sb-ad is-hidden';
    aside.setAttribute('aria-label', '推广：星巴克 × WorkBuddy 联名活动');

    aside.innerHTML =
      '<button class="sb-ad__close" type="button" aria-label="关闭广告">&times;</button>' +
      '<div class="sb-ad__body">' +
        '<div class="sb-ad__logo" aria-hidden="true">' + LOGO_TEXT + '</div>' +
        '<div class="sb-ad__text">' +
          '<div class="sb-ad__brand">' + CONFIG.brand + ' × WorkBuddy</div>' +
          '<div class="sb-ad__title">' + CONFIG.title + '</div>' +
        '</div>' +
      '</div>' +
      '<a class="sb-ad__cta" role="button" tabindex="0">' + CONFIG.cta + '</a>' +
      '<div class="sb-ad__note">' + CONFIG.note + '</div>';

    var cta = aside.querySelector('.sb-ad__cta');
    cta.addEventListener('click', function (e) {
      e.preventDefault();
      openModal();
    });

    aside.querySelector('.sb-ad__close').addEventListener('click', function () {
      markDismissed();
      aside.classList.add('is-hidden');
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

    setTimeout(function () {
      aside.classList.remove('is-hidden');
      updateBarVar();
    }, CONFIG.showAfter);
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
        '" alt="星巴克 × WorkBuddy 联名活动海报（含二维码）">';
    } else {
      // CSS 复原版海报（未放入真实图片时的兜底）
      posterInner =
        '<div class="sb-poster">' +
          '<div class="sb-poster__head">' +
            '<span class="sb-poster__sb">星巴克</span>' +
            '<span class="sb-poster__x">×</span>' +
            '<span class="sb-poster__wb">WorkBuddy</span>' +
          '</div>' +
          '<div class="sb-poster__date">' + CONFIG.activityDateFull + '</div>' +
          '<div class="sb-poster__line">上 WorkBuddy</div>' +
          '<div class="sb-poster__line">完成指定 AI 任务</div>' +
          '<div class="sb-poster__reward">' + CONFIG.reward + '</div>' +
          '<div class="sb-poster__qty">' + CONFIG.qty + '</div>' +
          '<div class="sb-poster__qr">' +
            '<div class="sb-poster__qrbox" aria-hidden="true"></div>' +
            '<div class="sb-poster__scan">扫码参与</div>' +
          '</div>' +
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
