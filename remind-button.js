/* ==========================================================================
   首页悬浮「提醒」按钮（纯文字 logo）
   --------------------------------------------------------------------------
   需求（2026-10-28 站长）：首页右侧新增一个按钮，logo 用纯文字「提醒」，
        其余悬浮按钮（TOP / 滑到底部 / AI 对话）行为不变，该弹出还是弹出。
   2026-10-30 站长指令：模态层原「劳工友好提醒」三条内容整体删除，
        替换为站长亲笔长文《双休购》（八段，逐字保留，含引号风格）；
        正文区加 max-height 滚动（长文不撑爆小屏）。
   2026-11-01 站长指令：八段长文整体替换为新《双休购倡议：用钱包投票，
        拒绝单休企业的商品》文案（含小标题/列表结构）；
        原文不删，单独存档于 remind-original.html，弹窗底部加「查看之前的内容」超链接；
        正文 p 改为无缩进并新增 h4/ul/ol/.sxg-rm-archive 样式。

   实现约束（照抄 top-button.js / bottom-button.js 的既有纪律，见 AGENTS.md / PITFALLS.md）：
   - 不用 Tailwind 类，样式自带 <style>，选择器用 sxg- 前缀避免冲突；
   - 幂等：已存在 #sxg-remind-btn / #sxg-remind-modal 直接返回，防止重复注入；
   - 挂 body（React 只管 #root，本按钮不碰它的地盘）；
   - 栈位：TOP(96) → ⤓底部(154) → AI对话(210, 52px 高 → 占 210–262) →
        本按钮放在 bottom:272px，正好在 AI 对话钮上方；
   - 暗色适配：深色下用深色圆底 + 青图标，悬停翻转成青底白字；
   - 模态层：点遮罩 / 右上角 × / 「我知道了」/ Esc 均可关闭；
        打开时锁 body 滚动，关闭恢复，避免背景穿透滚动。
   ========================================================================== */
(function () {
  'use strict';

  var BTN_ID = 'sxg-remind-btn';
  var STYLE_ID = 'sxg-remind-btn-style';
  var MODAL_ID = 'sxg-remind-modal';

  var REMIND_HTML =
    '<div class="sxg-rm-card">' +
      '<button type="button" class="sxg-rm-close" aria-label="关闭提醒">×</button>' +
      '<h3 class="sxg-rm-title">双休购</h3>' +
      '<div class="sxg-rm-body">' +
        '<h4 class="sxg-rm-h">双休购倡议：用钱包投票，拒绝单休企业的商品</h4>' +
        '<p>我们每天在消费，却很少意识到——每一次下单，都是一次价值观的投票。</p>' +
        '<p>“双休购”很简单：优先购买双休企业、双休品牌、双休劳动者生产的商品；对明确单休、大小周、常态化加班的企业的产品，少买，甚至不买。</p>' +
        '<p>这不是抵制，是选择。</p>' +
        '<h4 class="sxg-rm-h">为什么这件事值得做？</h4>' +
        '<p>因为单休不是“企业文化差异”，是劳动权益的实质性缩水。双休是《劳动法》明确规定的权利，不是企业施舍的福利。当一家企业连法定休息都做不到，它省下来的每一分人力成本，都来自对员工生活的挤压。</p>' +
        '<p>而你买它的产品，就是在为这种模式买单。</p>' +
        '<p>更现实的是——单休企业往往意味着更高的员工流失率、更差的产品品控、更敷衍的售后服务。一个被压榨到没有生活的人，很难持续输出高质量的工作。你买到的商品背后，可能就是一群疲惫的人赶工出来的东西。</p>' +
        '<h4 class="sxg-rm-h">双休购不是道德绑架，是市场信号。</h4>' +
        '<p>企业最听得懂的语言是钱。当足够多的人开始用消费选择表达“我支持尊重员工的企业”，市场会给出反馈：</p>' +
        '<ul class="sxg-rm-list">' +
          '<li>双休企业获得更多消费者青睐，形成正向激励</li>' +
          '<li>单休企业被迫面对“不改善用工条件就流失客户”的压力</li>' +
          '<li>劳动权益从纸面规定变成真实的商业竞争力</li>' +
        '</ul>' +
        '<p>这比发一百条吐槽帖有用。</p>' +
        '<h4 class="sxg-rm-h">怎么落地？</h4>' +
        '<p>不用搞得很复杂：</p>' +
        '<ol class="sxg-rm-list">' +
          '<li>购物前花30秒查一下——这家公司什么作息？招聘网站上搜一下就能看到</li>' +
          '<li>同等条件下优先选双休品牌——奶茶、外卖、电商、连锁店，很多都能查到</li>' +
          '<li>不是非黑即白——单休企业不是永远不能买，但至少让它成为你的“次选”而不是“默认选项”</li>' +
          '<li>顺手传播——跟朋友聊起来时提一嘴，让更多人知道还有这个选择维度</li>' +
        '</ol>' +
        '<h4 class="sxg-rm-h">最后说一句大实话：</h4>' +
        '<p>一个人少买一件单休企业的商品，改变不了什么。但如果一百万人都开始这么做，企业HR在写招聘JD时就会多想一秒，老板在讨论加班文化时会多一分顾虑。</p>' +
        '<p><strong>消费即立场。</strong>你的钱去哪儿，就是在告诉这个世界你想要什么样的规则。</p>' +
      '</div>' +
      '<button type="button" class="sxg-rm-ok">我知道了</button>' +
      '<p class="sxg-rm-archive">我们移除了原文，但你仍然可以查看之前的内容，请点击<a href="./remind-original.html">这里</a>访问被删除的内容。</p>' +
    '</div>';

  function buildStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent =
      '#' + BTN_ID + '{' +
        'position:fixed;right:14px;' +
        'bottom:calc(var(--sxg-bar-h, 0px) + 272px + env(safe-area-inset-bottom, 0px));' +
        'height:46px;min-width:46px;padding:0 10px;border-radius:23px;' +
        'display:flex;align-items:center;justify-content:center;' +
        'background:#ffffff;color:#0F766E;border:1.5px solid #0F766E;' +
        'font:700 13px/1 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;' +
        'letter-spacing:.04em;cursor:pointer;' +
        'box-shadow:0 6px 18px rgba(15,118,110,.22);z-index:9000;' +
        '-webkit-tap-highlight-color:transparent;' +
        'transition:background .2s ease,color .2s ease,border-color .2s ease,' +
          'box-shadow .2s ease,transform .2s ease;' +
      '}' +
      '#' + BTN_ID + ':hover{' +
        'background:linear-gradient(135deg,#0F766E,#0d9488);color:#fff;border-color:#0d9488;' +
        'box-shadow:0 10px 24px rgba(13,148,136,.36);transform:translateY(-2px)' +
      '}' +
      '#' + BTN_ID + ':active{transform:translateY(0) scale(.94)}' +
      '#' + BTN_ID + ':focus-visible{outline:2px solid #0F766E;outline-offset:3px}' +
      '@media (min-width:1440px){' +
        '#' + BTN_ID + '{right:16px;bottom:160px}' +
      '}' +
      '@media (prefers-color-scheme:dark){' +
        '#' + BTN_ID + '{background:#1e2429;color:#5eead4;border-color:#3aa68c;' +
          'box-shadow:0 6px 18px rgba(0,0,0,.5)}' +
        '#' + BTN_ID + ':hover{background:linear-gradient(135deg,#0F766E,#0d9488);color:#fff;border-color:#0d9488}' +
      '}' +
      // 模态层
      '#' + MODAL_ID + '{' +
        'position:fixed;inset:0;z-index:9500;' +
        'display:flex;align-items:center;justify-content:center;padding:20px;' +
        'background:rgba(15,23,42,.55);' +
        '-webkit-backdrop-filter:blur(2px);backdrop-filter:blur(2px);' +
      '}' +
      '#' + MODAL_ID + '[hidden]{display:none}' +
      '.sxg-rm-card{' +
        'position:relative;max-width:420px;width:100%;' +
        'background:#fff;color:#1f2937;border-radius:16px;padding:24px 22px 20px;' +
        'box-shadow:0 24px 60px rgba(0,0,0,.32);' +
        'font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;' +
        'line-height:1.7;animation:sxgRmM 160ms ease-out;' +
      '}' +
      '@keyframes sxgRmM{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:none}}' +
      '.sxg-rm-close{' +
        'position:absolute;top:10px;right:12px;width:30px;height:30px;border:none;' +
        'background:transparent;color:#94a3b8;font-size:22px;line-height:1;cursor:pointer;border-radius:8px;' +
      '}' +
      '.sxg-rm-close:hover{background:#f1f5f9;color:#475569}' +
      '.sxg-rm-title{' +
        'margin:0 0 12px;font-size:18px;font-weight:800;color:#0F766E;' +
      '}' +
      '.sxg-rm-body{' +
        'max-height:52vh;overflow-y:auto;margin:0 0 16px;padding-right:6px;' +
        'font-size:14px;color:#374151;-webkit-overflow-scrolling:touch;' +
      '}' +
      '.sxg-rm-body h4{margin:16px 0 8px;font-size:15px;font-weight:700;color:#0F766E;text-indent:0;line-height:1.4}' +
      '.sxg-rm-body h4:first-child{margin-top:0}' +
      '.sxg-rm-body p{margin:0 0 12px;text-indent:0}' +
      '.sxg-rm-body p:last-child{margin-bottom:0}' +
      '.sxg-rm-body ul,.sxg-rm-body ol{margin:0 0 12px;padding-left:22px}' +
      '.sxg-rm-body li{margin:0 0 6px;text-indent:0;line-height:1.6}' +
      '.sxg-rm-archive{margin:14px 0 0;font-size:12px;color:#64748b;text-indent:0;line-height:1.6}' +
      '.sxg-rm-archive a{color:#0F766E;text-decoration:underline;font-weight:600}' +
      '.sxg-rm-ok{' +
        'display:block;width:100%;padding:11px 0;border:none;border-radius:10px;' +
        'background:linear-gradient(135deg,#0F766E,#0d9488);color:#fff;' +
        'font:700 14px/1 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;' +
        'cursor:pointer;' +
      '}' +
      '.sxg-rm-ok:hover{filter:brightness(1.05)}' +
      '@media (prefers-color-scheme:dark){' +
        '.sxg-rm-card{background:#1e2429;color:#e2e8f0}' +
        '.sxg-rm-body{color:#cbd5e1}' +
        '.sxg-rm-archive{color:#94a3b8}' +
        '.sxg-rm-archive a{color:#5eead4}' +
      '}';
    document.head.appendChild(s);
  }

  function openModal() {
    var modal = document.getElementById(MODAL_ID);
    if (!modal) return;
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    var ok = modal.querySelector('.sxg-rm-ok');
    if (ok) ok.focus();
  }
  function closeModal() {
    var modal = document.getElementById(MODAL_ID);
    if (!modal) return;
    modal.hidden = true;
    document.body.style.overflow = '';
  }

  function build() {
    if (document.getElementById(BTN_ID) && document.getElementById(MODAL_ID)) return;
    buildStyle();

    if (!document.getElementById(BTN_ID)) {
      var btn = document.createElement('button');
      btn.id = BTN_ID;
      btn.type = 'button';
      btn.setAttribute('aria-label', '双休购');
      btn.title = '双休购·倡议';
      btn.textContent = '提醒';
      btn.addEventListener('click', openModal);
      document.body.appendChild(btn);
    }

    if (!document.getElementById(MODAL_ID)) {
      var modal = document.createElement('div');
      modal.id = MODAL_ID;
      modal.hidden = true;
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      modal.setAttribute('aria-label', '双休购');
      modal.innerHTML = REMIND_HTML;
      // 点遮罩关闭（点卡片内部不关闭）
      modal.addEventListener('click', function (e) {
        if (e.target === modal) closeModal();
      });
      modal.querySelector('.sxg-rm-close').addEventListener('click', closeModal);
      modal.querySelector('.sxg-rm-ok').addEventListener('click', closeModal);
      document.body.appendChild(modal);
      // Esc 关闭
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && !modal.hidden) closeModal();
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build);
  } else {
    build();
  }
})();
