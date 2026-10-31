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
    tip:
      '希望无论劳动者还是企业，都可以走到良性发展的道路上，让我们一起推动这件事，' +
      '在此广纳贤言并期待听到你的声音；对，别回头，说的就是你！',
    // 站长新站外链（2026-11-01 站长要求「这里挂一下 url，推我的新网站」）：
    // 挂在弹窗底部提示小字里，单独一行、同字号，不抢主按钮的视觉重量。
    siteLink: 'https://dujeongil-galaxy.github.io/dating-data-factcheck/',
    siteLinkText: '顺便推荐站长的新站「婚恋数据核查台」：给相亲数据做溯源核查 ↗',
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
          '<a class="dyp__later" href="./notes.html">站长随笔</a>' +
        '</div>' +
        '<p class="dyp__tip"></p>' +
        '<div class="dyp__count" aria-live="polite">' +
          '<span class="dyp__count__num">8</span>' +
          '<span class="dyp__count__label">秒后可关闭</span>' +
          '<span class="dyp__count__bar"><i></i></span>' +
        '</div>' +
      '</div>';

    box.querySelector('.dyp__title').textContent = CONFIG.title;
    box.querySelector('.dyp__summary').textContent = CONFIG.summary;
    box.querySelector('.dyp__go').textContent = CONFIG.linkText;
    box.querySelector('.dyp__go').href = CONFIG.link;
    box.querySelector('.dyp__points').innerHTML = CONFIG.points
      .map(function (t) { return '<li>' + t + '</li>'; })
      .join('');

    // 底部小字：正文 + 站长新站外链（同一个 <p>，不新增段落元素，字体跟随 .dyp__tip）
    var tipEl = box.querySelector('.dyp__tip');
    tipEl.appendChild(document.createTextNode(CONFIG.tip));
    if (CONFIG.siteLink) {
      var sl = document.createElement('a');
      sl.className = 'dyp__sitelink';
      sl.href = CONFIG.siteLink;
      sl.target = '_blank';
      sl.rel = 'noopener noreferrer';
      sl.textContent = CONFIG.siteLinkText;
      tipEl.appendChild(sl);
    }

    // 关闭方式：遮罩、✕、Esc
    // 「站长随笔」直接跳 notes.html（该页保留密码锁，robots noindex）
    // 2026-10-25 站长要求：按钮文字还原为「站长随笔」
    // （此前沿革：「站长随笔」→「解锁菜单」→「解锁彩蛋」→「站长随笔」，跳转目标不变）
    box.querySelector('.dyp__mask').onclick = close;
    box.querySelector('.dyp__x').onclick = close;
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      close();
    });

    document.body.appendChild(box);
  }

  function open() {
    if (!box) build();
    markShown();          // 打开即计时：即便用户马上刷新，也不会再次自动弹
    box.classList.add('is-open');
    startCountdown();     // 8 秒倒计时：未到则关闭按钮/遮罩/Esc 不生效
  }

  // 关闭锁定：弹出后 8 秒内，点击关闭（× / 遮罩 / Esc）不生效
  var unlockAt = 0;
  var countTimer = null;
  function close() {
    if (Date.now() < unlockAt) {
      // 未到 8 秒：点击关闭不生效，给一个轻提示（抖动）
      if (box) {
        var c = box.querySelector('.dyp__count');
        if (c) {
          c.classList.remove('dyp__count--shake');
          void c.offsetWidth; // 触发重排以重启动画
          c.classList.add('dyp__count--shake');
        }
      }
      return;
    }
    if (box) box.classList.remove('is-open');
  }

  // 8 秒滚动倒计时：数字递减 + 进度条收缩；到点后放行关闭
  function startCountdown() {
    unlockAt = Date.now() + 8000;
    var numEl = box.querySelector('.dyp__count__num');
    var barEl = box.querySelector('.dyp__count__bar > i');
    var labelEl = box.querySelector('.dyp__count__label');
    if (countTimer) clearInterval(countTimer);
    function tick() {
      var left = unlockAt - Date.now();
      if (left <= 0) {
        clearInterval(countTimer);
        countTimer = null;
        if (numEl) numEl.textContent = '0';
        if (labelEl) labelEl.textContent = '现在可以关闭了';
        if (barEl) barEl.style.width = '0%';
        if (box) {
          var rd = box.querySelector('.dyp__count');
          if (rd) rd.classList.add('dyp__count--ready');
        }
        return;
      }
      if (numEl) numEl.textContent = String(Math.ceil(left / 1000));
      if (barEl) barEl.style.width = (left / 8000 * 100) + '%';
    }
    tick();
    countTimer = setInterval(tick, 100);
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
