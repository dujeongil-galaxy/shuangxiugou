/* ==========================================================================
   首页右侧悬浮「视频」按钮 + 视频弹窗（打工人口径短视频，支持多条）
   --------------------------------------------------------------------------
   背景：2026-10-31 站长要求在首页放抖音视频（先是底部常驻视频卡）。
        2026-11-01 站长反馈：底部信息已经太多，别再往底部堆；抖音确认拒绝
        跨域嵌入（X-Frame-Options: SAMEORIGIN），站内播不了是既定事实。
        → 改成本方案：右侧悬浮按钮组里加「视频」钮，点开单独弹窗，弹窗里
          直接给抖音链接（点上即走）。站长原话：
          「在右侧是不是有 AI 和提醒的按钮，去提醒下面新建视频按钮，
            然后单独放弹窗，放抖音链接；这是目前的最优解法，没办法了。」

   为什么不挂在「收录品牌 / 双休红榜」那排统计卡下面做小窗口：
        那排是 React(#root) 渲染的，往里塞 DOM 补丁会被 React 重渲染抹掉，
        补注入又要靠 MutationObserver，容易触发本站踩过的 MO 自激（主线程卡死）。
        本站既定纪律：DOM 补丁一律挂 body，不碰 React 的地盘。
        所以放在右侧悬浮组里（body 级），稳定且随时可点。

   技术约束（与 douyin-prompt.js 同源结论，勿重复尝试）：
   - 抖音 embed 页带 X-Frame-Options: SAMEORIGIN，浏览器禁止跨域 iframe 内嵌；
     真·站内播放要靠后端解析会过期的直链 .mp4，纯静态站做不到稳定内嵌。
   - 所以弹窗只做「标题 + 说明 + 跳转链接」，不再假装能内嵌播放。

   实现约束（照抄 remind-button.js / top-button.js 的既有纪律）：
   - 不用 Tailwind 类，样式自带 <style>，选择器用 sxg- 前缀避免冲突；
   - 幂等：已存在 #sxg-video-btn / #sxg-video-modal 直接返回；
   - 挂 body；栈位（实测 1440×900 / 390×780 两套视口）：
        ≥1440px：TOP(6) → ⤓(56) → 本钮(110, 高 42) → 提醒(160) → AI(210)
        <1440px ：本钮(48) → TOP(96) → ⤓(154) → AI(210) → 提醒(272)
     ⚠️ 关键约束：AI 对话面板（#sxg-ai-panel，z 9001）首访即展开，
        占据 right 侧 bottom 270px 以上的整段——放在 270 以上的按钮会被它盖住
        （第一版放 274 就是这个原因被盖住，已改）。
        桌面端 270 以下只有 26px 空隙塞不下新钮，所以把 TOP/⤓ 各下移一档腾位
        （改 top-button.js 28→6、bottom-button.js 88→56，仅 ≥1440px 生效）。
   - 暗色适配；模态层：点遮罩 / × / 关闭 / Esc 均可关闭，打开时锁 body 滚动。
   ========================================================================== */
(function () {
  'use strict';

  var BTN_ID = 'sxg-video-btn';
  var STYLE_ID = 'sxg-video-btn-style';
  var MODAL_ID = 'sxg-video-modal';

  // 视频列表：在数组里追加即可，弹窗自动渲染对应条目。
  var VIDEOS = [
    {
      share: 'https://v.douyin.com/AY0dA2mhhAw/',
      title: '专科双非怎么混进钱多事少的红利公司！',
      sub: '不要抱着招聘软件刷了！# 找工作 # 求职 # 应届生求职 # 大学生就业 # 失业'
    },
    {
      share: 'https://v.douyin.com/uEMZRkt73Jg/',
      title: 'BOSS直聘等招聘网站的骗局套路大全',
      sub: '诈骗犯在BOSS直聘等招聘网站设下了无数骗局和套路，防不胜防。# BOSS直聘 # boss直聘被骗 # 招聘网站 # 诈骗 # 套路'
    }
  ];

  var NOTE =
    '抖音设置了 X-Frame-Options，禁止跨域内嵌播放，纯静态站无法稳定站内播放。' +
    '下面是站长挑过的短视频，点「在抖音打开」直接看。';

  function buildStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent =
      '#' + BTN_ID + '{' +
        'position:fixed;right:14px;' +
        'bottom:calc(48px + env(safe-area-inset-bottom, 0px));' +
        'height:42px;min-width:46px;padding:0 10px;border-radius:21px;' +
        'display:flex;align-items:center;justify-content:center;gap:5px;' +
        'background:#ffffff;color:#0F766E;border:1.5px solid #0F766E;' +
        'font:700 13px/1 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;' +
        'letter-spacing:.04em;cursor:pointer;' +
        'box-shadow:0 6px 18px rgba(15,118,110,.22);z-index:9000;' +
        '-webkit-tap-highlight-color:transparent;' +
        'transition:background .2s ease,color .2s ease,border-color .2s ease,' +
          'box-shadow .2s ease,transform .2s ease;' +
      '}' +
      '#' + BTN_ID + '::before{' +
        'content:"";width:0;height:0;border-left:7px solid currentColor;' +
        'border-top:5px solid transparent;border-bottom:5px solid transparent;' +
      '}' +
      '#' + BTN_ID + ':hover{' +
        'background:linear-gradient(135deg,#0F766E,#0d9488);color:#fff;border-color:#0d9488;' +
        'box-shadow:0 10px 24px rgba(13,148,136,.36);transform:translateY(-2px)' +
      '}' +
      '#' + BTN_ID + ':active{transform:translateY(0) scale(.94)}' +
      '#' + BTN_ID + ':focus-visible{outline:2px solid #0F766E;outline-offset:3px}' +
      '@media (min-width:1440px){#' + BTN_ID + '{right:16px;bottom:110px}}' +
      '@media (prefers-color-scheme:dark){' +
        '#' + BTN_ID + '{background:#1e2429;color:#5eead4;border-color:#3aa68c;' +
          'box-shadow:0 6px 18px rgba(0,0,0,.5)}' +
        '#' + BTN_ID + ':hover{background:linear-gradient(135deg,#0F766E,#0d9488);color:#fff;border-color:#0d9488}' +
      '}' +
      // ---- 模态层 ----
      '#' + MODAL_ID + '{' +
        'position:fixed;inset:0;z-index:9500;' +
        'display:flex;align-items:center;justify-content:center;padding:20px;' +
        'background:rgba(15,23,42,.55);' +
        '-webkit-backdrop-filter:blur(2px);backdrop-filter:blur(2px);' +
      '}' +
      '#' + MODAL_ID + '[hidden]{display:none}' +
      '.sxg-vd-card{' +
        'position:relative;max-width:440px;width:100%;' +
        'background:#fff;color:#1f2937;border-radius:16px;padding:22px 20px 18px;' +
        'box-shadow:0 24px 60px rgba(0,0,0,.32);' +
        'font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;' +
        'animation:sxgVdM 160ms ease-out;' +
      '}' +
      '@keyframes sxgVdM{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:none}}' +
      '.sxg-vd-close{' +
        'position:absolute;top:8px;right:10px;width:30px;height:30px;border:none;' +
        'background:transparent;color:#94a3b8;font-size:22px;line-height:1;cursor:pointer;border-radius:8px;' +
      '}' +
      '.sxg-vd-close:hover{background:#f1f5f9;color:#475569}' +
      '.sxg-vd-title{margin:0 0 4px;font-size:17px;font-weight:800;color:#0F766E}' +
      '.sxg-vd-note{margin:0 0 12px;font-size:12px;color:#8a94a6;line-height:1.6}' +
      '.sxg-vd-list{' +
        'max-height:52vh;overflow-y:auto;margin:0;padding:0;list-style:none;' +
        '-webkit-overflow-scrolling:touch;' +
      '}' +
      '.sxg-vd-item{' +
        'border:1px solid #e6ebf1;border-radius:12px;padding:12px 13px;margin-bottom:10px;' +
        'background:#f8fafc;' +
      '}' +
      '.sxg-vd-item:last-child{margin-bottom:0}' +
      '.sxg-vd-name{margin:0 0 5px;font-size:14px;font-weight:700;color:#0f172a;line-height:1.5}' +
      '.sxg-vd-sub{margin:0 0 9px;font-size:12px;color:#7c8798;line-height:1.55}' +
      '.sxg-vd-open{' +
        'display:inline-flex;align-items:center;gap:4px;' +
        'background:linear-gradient(135deg,#0F766E,#0d9488);color:#fff;text-decoration:none;' +
        'font-size:13px;font-weight:700;padding:7px 13px;border-radius:999px;' +
      '}' +
      '.sxg-vd-open:hover{filter:brightness(1.06)}' +
      '.sxg-vd-ok{' +
        'display:block;width:100%;margin-top:14px;padding:10px 0;border:none;border-radius:10px;' +
        'background:#eef2f6;color:#475569;' +
        'font:700 14px/1 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;' +
        'cursor:pointer;' +
      '}' +
      '.sxg-vd-ok:hover{background:#e2e8f0}' +
      '@media (prefers-color-scheme:dark){' +
        '.sxg-vd-card{background:#1e2429;color:#e2e8f0}' +
        '.sxg-vd-note{color:#94a3b8}' +
        '.sxg-vd-item{background:#151b20;border-color:#2b333a}' +
        '.sxg-vd-name{color:#f1f5f9}' +
        '.sxg-vd-sub{color:#94a3b8}' +
        '.sxg-vd-ok{background:#2b333a;color:#cbd5e1}' +
      '}';
    document.head.appendChild(s);
  }

  function buildModalHtml() {
    var items = VIDEOS.map(function (v) {
      return '<li class="sxg-vd-item">' +
        '<p class="sxg-vd-name"></p>' +
        '<p class="sxg-vd-sub"></p>' +
        '<a class="sxg-vd-open" target="_blank" rel="noopener noreferrer">在抖音打开 ↗</a>' +
      '</li>';
    }).join('');
    return '<div class="sxg-vd-card" role="dialog" aria-modal="true" aria-label="站长推荐视频">' +
      '<button type="button" class="sxg-vd-close" aria-label="关闭视频弹窗">×</button>' +
      '<h3 class="sxg-vd-title">站长推荐 · 打工人视频</h3>' +
      '<p class="sxg-vd-note"></p>' +
      '<ul class="sxg-vd-list">' + items + '</ul>' +
      '<button type="button" class="sxg-vd-ok">关闭</button>' +
    '</div>';
  }

  function openModal() {
    var modal = document.getElementById(MODAL_ID);
    if (!modal) return;
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    var ok = modal.querySelector('.sxg-vd-ok');
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
      btn.setAttribute('aria-label', '站长推荐视频');
      btn.title = '站长推荐 · 打工人视频';
      btn.textContent = '视频';
      btn.addEventListener('click', openModal);
      document.body.appendChild(btn);
    }

    if (!document.getElementById(MODAL_ID)) {
      var modal = document.createElement('div');
      modal.id = MODAL_ID;
      modal.hidden = true;
      modal.innerHTML = buildModalHtml();
      // 文案用 textContent 填，避免字符串里的特殊字符破坏 HTML
      var noteEl = modal.querySelector('.sxg-vd-note');
      if (noteEl) noteEl.textContent = NOTE;
      var items = modal.querySelectorAll('.sxg-vd-item');
      for (var i = 0; i < items.length && i < VIDEOS.length; i++) {
        var v = VIDEOS[i];
        items[i].querySelector('.sxg-vd-name').textContent = v.title;
        items[i].querySelector('.sxg-vd-sub').textContent = v.sub;
        items[i].querySelector('.sxg-vd-open').href = v.share;
      }
      modal.addEventListener('click', function (e) {
        if (e.target === modal) closeModal();
      });
      modal.querySelector('.sxg-vd-close').addEventListener('click', closeModal);
      modal.querySelector('.sxg-vd-ok').addEventListener('click', closeModal);
      document.body.appendChild(modal);
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
