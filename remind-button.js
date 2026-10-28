/* ==========================================================================
   首页悬浮「提醒」按钮（纯文字 logo）
   --------------------------------------------------------------------------
   需求（2026-10-28 站长）：首页右侧新增一个按钮，logo 用纯文字「提醒」，
        其余悬浮按钮（TOP / 滑到底部 / AI 对话）行为不变，该弹出还是弹出。
        本按钮点击后弹出一个「劳工友好提醒」模态层（中性、不站立场）。

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
      '<h3 class="sxg-rm-title">劳工友好提醒</h3>' +
      '<ul class="sxg-rm-list">' +
        '<li>消费也是投票：你花的每一笔钱，都在间接为这家企业的用工制度背书。' +
          '下单前，不妨先看看它的「真实双休率」与「平均下班时间」。</li>' +
        '<li>劳动者权益是法定底线：双休、加班费、社保受法律保护，不是企业的恩赐。' +
          '遇到单休、大小周、无偿加班，可留存证据并向劳动监察部门投诉或申请劳动仲裁。</li>' +
        '<li>本站数据仅供参考：用工情况随时间变化，且部分来自招聘口径与员工反馈，' +
          '不构成对任何企业的法律定性。请以最新公开信息为准；有疑义可在 GitHub Issues 提交可查证来源。</li>' +
      '</ul>' +
      '<p class="sxg-rm-foot">双休Go（本站全新Logo）—— 用订单（消费力），反向考核企业。</p>' +
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
      '.sxg-rm-list{margin:0 0 14px;padding-left:20px;font-size:14px;color:#374151;' +
        'display:flex;flex-direction:column;gap:10px;' +
      '}' +
      '.sxg-rm-list li{margin:0}' +
      '.sxg-rm-foot{' +
        'margin:0 0 16px;font-size:12.5px;color:#64748b;' +
        'border-left:3px solid #0F766E;padding-left:10px;' +
      '}' +
      '.sxg-rm-ok{' +
        'display:block;width:100%;padding:11px 0;border:none;border-radius:10px;' +
        'background:linear-gradient(135deg,#0F766E,#0d9488);color:#fff;' +
        'font:700 14px/1 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;' +
        'cursor:pointer;' +
      '}' +
      '.sxg-rm-ok:hover{filter:brightness(1.05)}' +
      '@media (prefers-color-scheme:dark){' +
        '.sxg-rm-card{background:#1e2429;color:#e2e8f0}' +
        '.sxg-rm-list{color:#cbd5e1}.sxg-rm-foot{color:#94a3b8}' +
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
      btn.setAttribute('aria-label', '劳工友好提醒');
      btn.title = '劳工友好提醒';
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
      modal.setAttribute('aria-label', '劳工友好提醒');
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
