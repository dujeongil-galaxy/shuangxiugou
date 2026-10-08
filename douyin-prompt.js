/* ==========================================================================
   首页视频推荐弹窗
   --------------------------------------------------------------------------
   用途：用户访问首页时自动弹出，推荐一条讲「压榨员工的产品，最终由消费者
   买单」的短视频，与本站劳工友好定位一致。

   ⚠️ 为什么不用 iframe 内嵌播放器：
      抖音 embed 页（www.douyin.com/embed/<vid>）实测返回 404，且响应头带
      X-Frame-Options: SAMEORIGIN，浏览器禁止跨域 iframe 嵌入。
      所以只能做「摘要 + 跳转观看」，不做站内播放。

   缓存需求：同一浏览器在 cooldownMs 内只弹一次，刷新页面也不再弹。
   实现上「自动弹」和「手动触发」都记时间戳，避免手动打开后刷新又自动弹。   ========================================================================== */
(function () {
  'use strict';

  var CONFIG = {
    title: '压榨员工的产品，最后买单的是谁？',
    summary:
      '一辆车有上千个零部件、上百道品控。当车企把员工压榨到连轴加班，' +
      '精力耗尽——松半圈的螺丝、漏查的瑕疵、走形式的检测——' +
      '最终都变成你行驶在路上的安全隐患。永远别买对员工刻薄的车企的产品。',
    points: [
      '连轴加班后，体力与精力耗尽，做不出高质量产品',
      '敷衍的品控，最终由消费者用安全买单',
      '越做越大的压榨型公司，可能就是你的下一个参照'
    ],
    link: 'https://v.douyin.com/37pbo6qxUbs/',
    linkText: '在抖音中观看',
    // 冷却时长：15 分钟内不再自动弹（毫秒）
    cooldownMs: 15 * 60 * 1000,
    // 首次访问延迟多少毫秒后自动弹出。
    // 别设太长：页面早已加载完成，再晚就变成「莫名其妙突然弹出来」。
    autoDelayMs: 2500,
    storageKey: 'dy_video_prompt_at'
  };

  function readLastShown() {
    try {
      return Number(localStorage.getItem(CONFIG.storageKey) || 0);
    } catch (e) {
      return 0;
    }
  }

  function markShown() {
    try {
      localStorage.setItem(CONFIG.storageKey, String(Date.now()));
    } catch (e) {}
  }

  function inCooldown() {
    var last = readLastShown();
    if (!last) return false;
    return Date.now() - last < CONFIG.cooldownMs;
  }

  var box = null;

  function build() {
    box = document.createElement('div');
    box.className = 'dyp';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'false');
    box.setAttribute('aria-labelledby', 'dyp-title');
    box.innerHTML =
      '<div class="dyp__mask"></div>' +
      '<div class="dyp__panel">' +
        '<button class="dyp__x" type="button" aria-label="关闭">&times;</button>' +
        '<div class="dyp__tag">劳工友好提醒</div>' +
        '<h2 class="dyp__title" id="dyp-title"></h2>' +
        '<p class="dyp__summary"></p>' +
        '<ul class="dyp__points"></ul>' +
        '<div class="dyp__acts">' +
          '<a class="dyp__go" target="_blank" rel="noopener noreferrer"></a>' +
          '<button class="dyp__later" type="button">以后再说</button>' +
        '</div>' +
        '<p class="dyp__tip">在抖音 App 或网页端观看更佳</p>' +
      '</div>';

    box.querySelector('.dyp__title').textContent = CONFIG.title;
    box.querySelector('.dyp__summary').textContent = CONFIG.summary;
    box.querySelector('.dyp__go').textContent = CONFIG.linkText;
    box.querySelector('.dyp__go').href = CONFIG.link;
    box.querySelector('.dyp__points').innerHTML = CONFIG.points
      .map(function (t) { return '<li>' + t + '</li>'; })
      .join('');

    // 三种关闭方式：遮罩、✕、以后再说
    box.querySelector('.dyp__mask').onclick = close;
    box.querySelector('.dyp__x').onclick = close;
    box.querySelector('.dyp__later').onclick = close;
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') close();
    });

    document.body.appendChild(box);
  }

  function open() {
    if (!box) build();
    markShown();          // 打开即计时：即便用户马上刷新，也不会再次自动弹
    box.classList.add('is-open');
  }

  function close() {
    if (box) box.classList.remove('is-open');
  }

  function init() {
    // 冷却期内直接不装DOM，省一次渲染
    if (inCooldown()) return;
    setTimeout(function () {
      // 延迟结束时再确认一次：期间用户可能已手动打开过
      if (inCooldown() && readLastShown()) return;
      open();
    }, CONFIG.autoDelayMs);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
