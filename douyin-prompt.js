/* ==========================================================================
   首页「公益提醒」弹窗（2026-11-14 由「劳工友好提醒」更名）
   --------------------------------------------------------------------------
   2026-11-14 站长指令：弹窗内容整体替换为一篇公众号式长文
   《别让"跟风买车"，变成我们为"傲慢"买单》（比亚迪轮毂装反 / 500 万悬赏
   事件视角的消费者提醒）。要点：
     · 顶栏标签「劳工友好提醒」→「公益提醒」（站长原话「劳工友好提醒也不要了，
       直接替换为 公益提醒」）。
     · 弹窗旧版的所有其他内容（标题 / 摘要 / 要点 / 抖音短片按钮 / 站长随笔 /
       事实核查 / 切换旧版）全部撤掉——这些由 dyp-version-toggle.js 与
       factcheck-button.js 注入，本站用 .dyp--article 标记让它们自动不注入
       （保留脚本本体以便将来回退弹窗内容）。
     · 弹窗底部做成两枚按钮：①「去看看站长的新网站」（外链婚恋数据核查台）
       ②「我要分享此文章」（打开分享弹窗，文案带文章标题）。
   2026-11-14 站长追加指令：「已经有了按钮，就不要留那句话（绿色）」——
   原先挂在按钮上方那行绿色推荐小字（指向新站）撤下，引流交给按钮、不再重复；
   改为在文章末尾加一句整句加粗的备注，界定本文讨论的重点：
     「本文讨论的重点，不是反对悬赏打击黑公关这件事本身，而是在品控争议、
       车主质疑集中爆发的这个时间点高调发布悬赏，时机不妥，很容易引火烧身，
       造成舆论误解。」

   弹出需求：每次刷新首页都必弹（站长 2026-11-13 指令「不要 15 分钟冷却，
   刷新首页必弹」）。不再用 localStorage 记时间戳、不再有冷却期，关掉再刷就再弹。

   关闭需求（2026-11-13 站长「先锁死」）：**只能点右上角 × 关闭**，遮罩点击与
   Esc 一律不绑 close；弹出后 8 秒内 × 不生效（倒计时）。
   ========================================================================== */
(function () {
  'use strict';

  // 站长新站外链（2026-11-01 站长要求「这里挂一下 url，推我的新网站」）：
  // 2026-11-14 追加指令「已经有了按钮，就不要留那句话（绿色）」——
  // 原先底部那行绿色推荐小字撤掉，只由「去看看站长的新网站」按钮承担引流。
  var SITE_LINK = 'https://dujeongil-galaxy.github.io/dating-data-factcheck/';

  // 底部「我要分享此文章」打开分享弹窗时，临时写进 og:description 的分享文案
  // （分享弹窗 info() 读 og:description 作为分享说明，开完即还原）。
  var SHARE_TEXT =
    '双休购·公益提醒《别让“跟风买车”变成我们为“傲慢”买单》：比亚迪轮毂装反、' +
    '500 万悬赏黑公关事件背后，消费者该如何清醒选车。';

  // 弹窗正文：一篇公众号式长文（站长 2026-11-14 提供，忠实转写）。
  // 用模板字符串保留换行与中文标点；粗体 **x** 已转成 <strong>。
  var ARTICLE_HTML = [
    '<h1 class="dyp__h1">别让“跟风买车”，变成我们为“傲慢”买单</h1>',
    '<p>各位家人、各位朋友：</p>',
    '<p>最近有一件事，我觉得必须拿出来和大家好好聊聊。因为我发现，身边很多 60 后、' +
      '70 后的长辈，甚至不少同龄人，买车的逻辑特别简单——「身边人买比亚迪，我就买比亚迪；' +
      '身边人买华为，我就买华为」。你跟他说华为没有双休、加班严重，他会立刻反驳你' +
      '「人家技术牛逼」；你跟他说比亚迪出了品控问题，他会觉得「那都是别人在黑它」。</p>',
    '<p>但这次，我想借着最近发生的一件事，给大家提个醒：<strong>技术再强，也掩盖不了' +
      '“傲慢”；品牌再响，也不能把消费者当“韭菜”</strong>。</p>',
    '<h2>一、先给大家捋清楚这件事的来龙去脉</h2>',
    '<p>11 月 11 号，比亚迪因为部分车型的轮毂前后装反了，刚发过致歉信。大家心里的火' +
      '都还没有消，正琢磨着你这么大的车企，层层质检居然没有发现，这是一个极其低级又致命的问题。</p>',
    '<p>结果仅仅相隔一天，11 月 13 号，比亚迪的法务部直接掏出一份悬赏公告，最高 500 万' +
      '征集黑公关线索。</p>',
    '<p>这个时间点卡的可太寸了，就像是刚刚「认罪认罚」，转头就掏出一张传票捂嘴。</p>',
    '<h2>二、我为什么觉得这件事值得所有消费者警惕？</h2>',
    '<p>得承认一个事实，现在车圈的黑公关早就不是几个网友发帖骂街了，而是真金白银的产业链。' +
      '这种工业化造谣，哪家车企看了都烧心，所以比亚迪掏出 500 万来反击。</p>',
    '<p>单从商业逻辑上讲没什么毛病，但问题出在大众观感上。当几万个真实的车主正在网上' +
      '吐槽自己的轮毂被装反，这个时候高调宣布要花 500 万抓黑公关，这就好比在火药桶旁边吸烟。</p>',
    '<p>甚至还有人发现，轮毂事件发酵期间，比亚迪还顺手投诉了一些批评的文章，理由是：' +
      '「片面渲染，放大风险」。</p>',
    '<p>这两件事一叠加，法务部重拳出击的形象算是彻底立住了，但同时也彻底把消费者的心给凉了。</p>',
    '<p>「有这 500 万还不如给工人加鸡腿呢」。这看似是一句废话，但是大家为什么要这么比？' +
      '因为大家感受到了一种分配的割裂感。</p>',
    '<p>一方面，比亚迪这两年员工总数减了十来万，一线工人底薪不高，靠加班费拼收入，' +
      '食堂伙食也被内部吐槽，这些消息时不时的传出来。</p>',
    '<p>另一方面，对外部黑粉的悬赏动辄百万，大家不是真的在乎工人差那一口肉，而是觉得' +
      '这个企业对外重拳出击，对内却斤斤计较。</p>',
    '<h2>三、我想告诉大家：真正的“靠谱车企”，不会这么干</h2>',
    '<p>当你在质量体系上出了娄子，公众最希望看到的是你向内开刀，对生产线的员工更好一点，' +
      '保证产品的品质，结果你却把聚光灯打向了外面，这种姿态在工人和消费者的眼里就是傲慢。</p>',
    '<p>轮毂装反这件事，核心根本不是有没有人在黑比亚迪，核心是你这么大的车企，层层质检' +
      '居然没有发现，这是一个极其低级又致命的问题。</p>',
    '<p>正确的危机公关应该怎么做？是老老实实承认错误，用足够的时间去展示你如何整改，' +
      '让公众看得到你在向内开刀。但比亚迪偏偏这个时候选择了把打击黑公关放在了前台。</p>',
    '<p>比亚迪的 500 万悬赏从事实层面看确实是在打击真实的造谣黑产，这无可厚非。但从大众的' +
      '情绪层面看，它刚好撞在了品控翻车的事件上。</p>',
    '<p>消费者能接受一个制造企业偶尔犯错，只要你足够真诚，但他们很难接受一个企业在犯错' +
      '之后第一反应却是去堵别人的嘴。</p>',
    '<p>这 500 万悬赏也许最终能抓到几个黑公关，但在这之前，它已经先伤到了那些真金白银' +
      '支持你的消费者。</p>',
    '<h2>四、最后，我想给所有准备买车的朋友提 3 个醒</h2>',
    '<ol>',
    '<li><strong>别把“跟风”当“靠谱”</strong>：身边人买什么你就买什么，本质上是把' +
      '自己的选择权交了出去。你不知道别人买车的真实需求，也不知道他们有没有遇到问题，' +
      '最后买单的是你自己。</li>',
    '<li><strong>别把“技术”当“免死金牌”</strong>：技术牛逼确实值得骄傲，但技术牛逼不代表' +
      '可以忽略品控、不代表可以不尊重员工、不代表可以不把消费者的声音当回事。</li>',
    '<li><strong>别把“沉默”当“支持”</strong>：你今天替它的品控问题说话，明天它就可能' +
      '把你的合理投诉当成“黑公关”。真正的支持，是让它变得更好，而不是替它掩盖问题。</li>',
    '</ol>',
    '<p>作为双休购的站长，我一直想做的，就是让大家在消费的时候，能多一份清醒，少一份盲从。' +
      '因为我始终相信：<strong>一个真正值得尊重的企业，不是靠“技术牛逼”来让你闭嘴，' +
      '而是靠“真诚靠谱”来让你放心</strong>。</p>',
    '<p>如果你们身边也有准备买车、或者已经买了比亚迪 / 华为相关产品的家人朋友，欢迎把这篇' +
      '文章转发给他们。我们一起，做一个清醒的消费者。</p>',
    '<p class="dyp__sign">双休购站长 dujeongil-galaxy<br>2026 年 11 月 14 日</p>',
    // 文末备注（2026-11-14 站长追加）：整句加粗，界定本文讨论的重点，
    // 避免被误读成「反对悬赏打击黑公关」。
    '<p class="dyp__note"><strong>备注：本文讨论的重点，不是反对悬赏打击黑公关这件事' +
      '本身，而是在品控争议、车主质疑集中爆发的这个时间点高调发布悬赏，时机不妥，' +
      '很容易引火烧身，造成舆论误解。</strong></p>'
  ].join('');

  var box = null;

  function build() {
    box = document.createElement('div');
    box.className = 'dyp';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'false');
    box.setAttribute('aria-labelledby', 'dyp-title');
    box.innerHTML =
      '<div class="dyp__mask"></div>' +
      '<div class="dyp__panel dyp--article">' +
        '<button class="dyp__x" type="button" aria-label="关闭">&times;</button>' +
        '<div class="dyp__tag">公益提醒</div>' +
        '<div class="dyp__article" id="dyp-title">' + ARTICLE_HTML + '</div>' +
        '<div class="dyp__acts">' +
          '<a class="dyp__visit" target="_blank" rel="noopener noreferrer"></a>' +
          '<button type="button" class="dyp__share"></button>' +
        '</div>' +
        '<div class="dyp__count" aria-live="polite">' +
          '<span class="dyp__count__num">8</span>' +
          '<span class="dyp__count__label">秒后可关闭</span>' +
          '<span class="dyp__count__bar"><i></i></span>' +
        '</div>' +
      '</div>';

    // 底部「去看看站长的新网站」——引流入口（原绿色推荐小字已撤，只留按钮）
    var visit = box.querySelector('.dyp__visit');
    visit.href = SITE_LINK;
    visit.textContent = '去看看站长的新网站';

    // 底部「我要分享此文章」——打开分享弹窗，文案带文章标题
    var share = box.querySelector('.dyp__share');
    share.textContent = '我要分享此文章';
    share.addEventListener('click', onShareArticle);

    // 关闭方式（2026-11-13 站长指令「先锁死」）：**只能点右上角 × 关闭**。
    // 原先遮罩点击、×、Esc 三条路都能关；现在遮罩与 Esc 一律不绑定 close，
    // 避免误点空白就把弹窗关掉。键盘用户仍可 Tab 到 ×（原生 <button>）按
    // Enter 关闭，可访问性不丢。
    box.querySelector('.dyp__x').onclick = close;

    document.body.appendChild(box);
  }

  // 底部「我要分享此文章」：打开分享弹窗，分享文案临时替换为文章标题（开完即还原）。
  // 分享弹窗 info() 读 og:description 作为分享说明，故开之前临时改写该 meta，
  // open() 同步 build 时会捕获到新文案，随后立即还原，无闪烁。
  function onShareArticle() {
    if (!window.SXGShare || !window.SXGShare.open) return;
    var od = document.querySelector('meta[property="og:description"]');
    var prev = od ? od.getAttribute('content') : '';
    if (od) od.setAttribute('content', SHARE_TEXT);
    try { window.SXGShare.open(); } finally {
      if (od) od.setAttribute('content', prev);
    }
  }

  function open() {
    if (!box) build();
    box.classList.add('is-open');
    startCountdown();     // 8 秒倒计时：未到则 × 不生效
  }

  // 关闭锁定：弹出后 8 秒内，点 × 不生效（遮罩与 Esc 本来就不关闭）
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
  /* 加密 LOGO 容器地址（与 logo-vault.js 的 ENC_URL 同一个文件；改容器缓存号
     时两边的 ?v 要一起 bump）。预热它 = 一次请求覆盖全部 59 张 LOGO。 */
  var ENC_LOGO_URL = './assets/logos.enc?v=1';
  function warmScan() {
    var imgs = document.querySelectorAll('div.bg-white.rounded-2xl.border img[src]');
    for (var i = 0; i < imgs.length; i++) {
      var u = imgs[i].getAttribute('src');
      if (u && !/^data:/.test(u) && !warmSeen[u]) {
        warmSeen[u] = 1;
        warmUrls.push(u);
      }
    }
    // 加密 LOGO 容器（logo-vault 流程）：data-sxg-enc 存的是裸 slug（如 'kfc'）
    // 而不是 URL——真正要预热的是容器文件 ./assets/logos.enc（一个请求覆盖全部
    // LOGO）。2026-11-05 事故：曾把裸 slug 当 URL 预加载，每轮 59 个 404。
    if (!warmSeen[ENC_LOGO_URL]) {
      warmSeen[ENC_LOGO_URL] = 1;
      warmUrls.push(ENC_LOGO_URL);
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
        if (labelEl) labelEl.textContent = '点右上角 × 关闭';
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
    // 每次刷新首页都自动弹（无冷却）：延迟 autoDelayMs 后弹出
    setTimeout(function () {
      open();
    }, 2500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
