/* ==========================================================================
   首页「劳工友好提醒」弹窗
   --------------------------------------------------------------------------
   沿革：
   2026-10~11：推荐「压榨员工的产品，最后买单的是谁」短视频（摘要 + 跳抖音）。
   2026-11-02：曾整体替换为公众号文章《成都一景区飞椅突发故障，游客悬停高空
        约半小时》的摘要，旧版数据存档于 prompt-original.html，
        弹窗底部加「访问被删除的内容」存档行。
   2026-11-03 站长指令：**飞椅版回退，还原为旧版（汽车 / 抖音视频推荐）**。
        站长原话：「全程仅用 20 分钟，好像不能说他们有什么问题，还是还原吧」。
        —— 景区从故障发生到游客落地全程 20 分钟，处置及时，
        不宜当负面案例挂在首页弹窗。
        → 弹窗内容整体还原为 2026-11-02 之前的旧版；
        → 存档页 prompt-original.html 删除（内容已回到弹窗本体，存档无意义）；
        → 弹窗底部存档行 .dyp__archive 移除，douyin-prompt.css 死样式一并清掉。
        ⚠️ 不要再把飞椅事件加回来：判据是「处置是否及时」，不是「有没有出故障」。

   ⚠️ 为什么不用 iframe 内嵌播放器（历史，旧视频方案遗留）：
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

  // ── 8 秒锁定窗口的资源预热（2026-11-05 站长指令）────────────────────
  // 站长原话大意：8 秒的时间内，也能预加载很多了吧？
  // 实现：弹窗弹出即开始低优先级并发预热首页品牌卡 LOGO 图片
  // （含后续 logo 加密 blob .enc 容器），并发 4 路、每 2s 重扫一遍
  // 捡漏（自定义卡是分批渐进注入的，弹窗时点可能还没注完），
  // 倒计时结束停止。用户关掉弹窗往下滚时 LOGO 已在 HTTP 缓存里。
  var warmSeen = {};
  var warmTimer = null;
  var warmUrls = [];
  var warmIdx = 0;
  function warmScan() {
    var imgs = document.querySelectorAll('div.bg-white.rounded-2xl.border img[src]');
    for (var i = 0; i < imgs.length; i++) {
      var u = imgs[i].getAttribute('src');
      if (u && !/^data:/.test(u) && !warmSeen[u]) {
        warmSeen[u] = 1;
        warmUrls.push(u);
      }
    }
    // 加密 LOGO 容器（logo-vault 流程：img 不带 src，.enc 地址在 data-sxg-enc）
    // 预热 .enc 文件本身，后续解密只差一次 WebCrypto 本地计算。
    var encs = document.querySelectorAll('img[data-sxg-enc]');
    for (var j = 0; j < encs.length; j++) {
      var e = encs[j].getAttribute('data-sxg-enc');
      if (e && !warmSeen[e]) {
        warmSeen[e] = 1;
        warmUrls.push(e);
      }
    }
  }
  function warmNext() {
    if (warmIdx >= warmUrls.length) return;
    var u = warmUrls[warmIdx];
    warmIdx += 1;
    if (/\.enc$/.test(u)) {
      fetch(u, { priority: 'low' }).catch(function () {});
      warmNext(); // fetch 无 onload，链式取下一个
    } else {
      var img = new Image();
      img.onload = img.onerror = warmNext;
      img.src = u;
    }
  }
  function warmStart() {
    warmScan();
    warmNext(); // 并发 4 路：4 个 Image 同时跑，各自 onload 链式取下一个
    warmNext();
    warmNext();
    warmNext();
    // 每 2s 重扫一遍捡漏（分批注入的后到卡片），倒计时到点清掉
    clearInterval(warmTimer);
    warmTimer = setInterval(warmScan, 2000);
  }
  function warmStop() {
    clearInterval(warmTimer);
    warmTimer = null;
  }

  // 8 秒滚动倒计时：数字递减 + 进度条收缩；到点后放行关闭
  function startCountdown() {
    unlockAt = Date.now() + 8000;
    var numEl = box.querySelector('.dyp__count__num');
    var barEl = box.querySelector('.dyp__count__bar > i');
    var labelEl = box.querySelector('.dyp__count__label');
    if (countTimer) clearInterval(countTimer);
    warmStart(); // 锁定窗口开场即预热
    function tick() {
      var left = unlockAt - Date.now();
      if (left <= 0) {
        clearInterval(countTimer);
        countTimer = null;
        warmScan(); // 收尾再扫一遍，把分批注入的后到卡片也预热掉
        warmNext(); warmNext(); warmNext(); warmNext();
        setTimeout(warmStop, 3000); // 留 3s 给最后一批拉完，然后停摆
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
