/* ==========================================================================
   首页悬浮「提醒」按钮（纯文字 logo）
   --------------------------------------------------------------------------
   需求（2026-10-28 站长）：首页右侧新增一个按钮，logo 用纯文字「提醒」，
        其余悬浮按钮（TOP / 滑到底部 / AI 对话）行为不变，该弹出还是弹出。
   2026-10-30 站长指令：模态层原「劳工友好提醒」三条内容整体删除，
        替换为站长亲笔长文《双休购》（八段，逐字保留，含引号风格）；
        正文区加 max-height 滚动（长文不撑爆小屏）。

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
        '<p>当“996”从互联网圈的调侃变成无数打工人的日常，当“自愿加班”的签字笔在深夜的办公室里划过纸面，我们似乎早已习惯了将“休息”视为一种奢侈。然而，就在这样的惯性中，一个名为“双休购”的倡议悄然出现——它不只是一次消费行为的呼吁，更是一封写给时代的公开信：让劳动者拥有完整的周末，让企业在良性轨道上奔跑，而此刻，那个被点名的人，就是你。</p>' +
        '<p>“双休购”的核心朴素得近乎天真：在双休日消费、为双休日消费、因双休日而消费。它呼吁企业将生产节奏锚定在法定的五天工作制，呼吁劳动者在周末走出写字楼、走进商场、走进山野，用真实的休息激活真实的消费，用真实的消费反哺企业的活力。这并非一个简单的经济闭环，而是一次对“人”的重新发现。</p>' +
        '<p>我们习惯了用“奋斗”来美化透支。凌晨一点的写字楼灯火通明，周末的会议室里咖啡杯堆叠成山，朋友圈里晒出的不是风景而是加班打卡——这些画面被包装成“敬业”，却掩盖了一个残酷的真相：当劳动者的休息权被系统性侵蚀，企业的创新力也会被系统性掏空。一个长期睡眠不足、没有时间陪伴家人、连周末都要随时响应工作消息的人，很难在周一的早晨迸发出真正的创造力。而一个依靠员工透支来维持运转的企业，其增长注定是脆弱的、不可持续的。</p>' +
        '<p>“双休购”的深层逻辑，正在于此。它试图用市场的力量倒逼制度的回归：当消费者只在双休日集中消费，那些试图在周末也开门迎客的商家就会发现，强行延长营业时间并不划算；当劳动者的休息日真正得到保障，他们才有精力和意愿去消费、去体验、去创造——而这，恰恰是内需最本真的动力。这不是道德绑架，而是一次理性的利益重构：劳动者的休息权与企业的长远发展，从来不是零和博弈。</p>' +
        '<p>但改变不会自动发生。它需要每一个“你”的参与。如果你是劳动者，请理直气壮地守护自己的双休日，去消费、去休息、去生活——你的每一次周末消费，都是在为“休息权”投票；如果你是企业主，请重新计算那笔账：让员工多休一天，看似少了八小时产能，却可能换来一周的高效与忠诚；如果你是政策制定者，请让法律长出牙齿，让“双休”从纸面走进现实。</p>' +
        '<p>别回头，说的就是你。你或许觉得个体的声音微不足道，但“双休购”的本质，正是一场由无数个体发起的集体觉醒。当我们不再将“连轴转”视为荣耀，当我们在周末关掉工作群、走进一家小店、买一束花、陪孩子放一次风筝，我们就在用最柔软也最坚定的方式告诉这个世界：人，不是工具；生活，不该只有工作。</p>' +
        '<p>这条路不会平坦。习惯了透支的体系不会轻易转向，习惯了加班的惯性不会瞬间消失。但正如那句被反复引用的话：“不要问篝火该不该燃烧，先问寒冷是否存在；不要问子弹该不该上膛，先问压迫是否存在。”双休购不是一颗子弹，而是一粒火种——它点燃的，是对另一种可能的想象：一个劳动者有尊严、企业有活力、社会有温度的未来。</p>' +
        '<p>此刻，你手握这粒火种。别回头，向前走，去消费，去休息，去生活。因为推动这件事的人，正是你。</p>' +
      '</div>' +
      '<button type="button" class="sxg-rm-ok">我知道了</button>' +
    '</div>';

  function buildStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent =
      '#' + BTN_ID + '{' +
        'position:fixed;right:14px;' +
        'bottom:calc(272px + env(safe-area-inset-bottom, 0px));' +
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
      '.sxg-rm-body p{margin:0 0 12px;text-indent:2em}' +
      '.sxg-rm-body p:last-child{margin-bottom:0}' +
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
