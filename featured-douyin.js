/* ==========================================================================
   首页常驻视频卡 · 抖音招聘/求职相关视频（支持多条，数组扩展）
   --------------------------------------------------------------------------
   背景：2026-10-31 站长要求在首页放抖音视频，做成「点击可播放」的嵌入式，
        不是纯链接。本条随需求从单视频扩展为多视频（VIDEOS 数组）。

   技术约束（与 douyin-prompt.js 同源结论）：
   - 抖音 embed 页带 X-Frame-Options: SAMEORIGIN，浏览器禁止跨域 iframe 内嵌，
     真·站内播放需后端解析会过期的直链 .mp4，纯静态站做不到稳定内嵌。
   - 因此本组件采用「视频卡 + 优雅降级」：封面 + 播放按钮，点击先尝试内嵌
     播放器，播不了则在卡内直接给「在抖音打开」入口（99% 能看）。

   实现：DOM 层补丁（同 liangpei-ad.js / evidence-collapse.js 模式），注入到
         #evidence-board 之前，不碰 React(#root) 也不碰生成内容，verify 不受影响。
   ========================================================================== */
(function () {
  'use strict';

  // 视频列表：在数组里追加即可，组件自动渲染对应数量的卡片。
  var VIDEOS = [
    {
      id: '7699446807902825186',
      share: 'https://v.douyin.com/AY0dA2mhhAw/',
      player: 'https://www.douyin.com/player/video/7699446807902825186',
      title: '专科双非怎么混进钱多事少的红利公司！',
      sub: '不要抱着招聘软件刷了！# 找工作 # 求职 # 应届生求职 # 大学生就业 # 失业',
      cover: '专科双非怎么混进\n钱多事少的红利公司'
    },
    {
      id: '7672962293453360390',
      share: 'https://v.douyin.com/uEMZRkt73Jg/',
      player: 'https://www.douyin.com/player/video/7672962293453360390',
      title: 'BOSS直聘等招聘网站的骗局套路大全',
      sub: '诈骗犯在BOSS直聘等招聘网站设下了无数骗局和套路，防不胜防。# BOSS直聘 # boss直聘被骗 # 招聘网站 # 诈骗 # 套路',
      cover: 'BOSS直聘等招聘网站\n的骗局套路大全'
    }
  ];

  function injectStyle() {
    if (document.getElementById('feat-video-style')) return;
    var s = document.createElement('style');
    s.id = 'feat-video-style';
    s.textContent =
      '.feat-video{max-width:960px;margin:24px auto;padding:0;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden;background:#0f172a;color:#e2e8f0;font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif}' +
      '.feat-video .fv-head{padding:12px 16px;background:linear-gradient(90deg,#0f172a,#1e293b);display:flex;align-items:center;gap:10px;flex-wrap:wrap}' +
      '.feat-video .fv-badge{background:#0f766e;color:#fff;font-size:12px;font-weight:700;padding:2px 9px;border-radius:999px;white-space:nowrap}' +
      '.feat-video .fv-title{font-size:15px;font-weight:700;color:#f8fafc;margin:0;line-height:1.4}' +
      '.feat-video .fv-sub{width:100%;font-size:12px;color:#94a3b8;margin:2px 0 0;line-height:1.5}' +
      '.feat-video .fv-stage{position:relative;width:100%;aspect-ratio:16/9;background:radial-gradient(120% 120% at 30% 20%,#1d4ed8 0%,#0f172a 60%);display:flex;align-items:center;justify-content:center}' +
      '.feat-video .fv-cover{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;cursor:pointer;text-align:center;padding:16px}' +
      '.feat-video .fv-cover:hover .fv-play{transform:scale(1.06)}' +
      '.feat-video .fv-play{width:64px;height:64px;border-radius:50%;border:none;background:rgba(255,255,255,.92);color:#0f172a;font-size:26px;line-height:64px;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.35);transition:transform .15s ease}' +
      '.feat-video .fv-cover-title{color:#fff;font-size:17px;font-weight:700;text-shadow:0 2px 8px rgba(0,0,0,.4);max-width:80%;white-space:pre-line}' +
      '.feat-video .fv-cover-hint{color:#cbd5e1;font-size:12px}' +
      '.feat-video .fv-player{position:absolute;inset:0}' +
      '.feat-video .fv-player iframe{width:100%;height:100%;border:0;background:#000}' +
      '.feat-video .fv-foot{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 16px;background:#111827}' +
      '.feat-video .fv-foot .fv-note{font-size:12px;color:#94a3b8}' +
      '.feat-video .fv-open{color:#5eead4;font-size:13px;font-weight:600;text-decoration:none;white-space:nowrap}' +
      '.feat-video .fv-open:hover{text-decoration:underline}' +
      '@media(max-width:640px){.feat-video .fv-title{font-size:14px}.feat-video .fv-cover-title{font-size:15px}}';
    document.head.appendChild(s);
  }

  function buildCard(v) {
    var card = document.createElement('section');
    card.className = 'feat-video';
    card.innerHTML =
      '<div class="fv-head">' +
        '<span class="fv-badge">站长推荐 · 视频</span>' +
        '<h3 class="fv-title"></h3>' +
        '<p class="fv-sub"></p>' +
      '</div>' +
      '<div class="fv-stage">' +
        '<div class="fv-cover" role="button" tabindex="0" aria-label="播放视频">' +
          '<button class="fv-play" type="button" aria-hidden="true">▶</button>' +
          '<div class="fv-cover-title"></div>' +
          '<div class="fv-cover-hint">点击播放（抖音视频）</div>' +
        '</div>' +
        '<div class="fv-player" hidden></div>' +
      '</div>' +
      '<div class="fv-foot">' +
        '<span class="fv-note">若站内无法播放，可前往抖音观看</span>' +
        '<a class="fv-open" target="_blank" rel="noopener noreferrer"></a>' +
      '</div>';

    card.querySelector('.fv-title').textContent = v.title;
    card.querySelector('.fv-sub').textContent = v.sub;
    card.querySelector('.fv-cover-title').textContent = v.cover || v.title;
    var openLink = card.querySelector('.fv-open');
    openLink.textContent = '在抖音打开 ↗';
    openLink.href = v.share;

    var cover = card.querySelector('.fv-cover');
    var player = card.querySelector('.fv-player');
    var iframeInjected = false;

    function play() {
      if (iframeInjected) return;
      iframeInjected = true;
      cover.style.display = 'none';
      player.hidden = false;
      // 尽力内嵌抖音播放器；X-Frame-Options 拦截时浏览器会显示错误页，
      // 此时用户用下方「在抖音打开」入口即可（优雅降级）。
      var ifr = document.createElement('iframe');
      ifr.src = v.player;
      ifr.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture; fullscreen');
      ifr.setAttribute('referrerpolicy', 'no-referrer-when-downgrade');
      ifr.title = v.title;
      player.appendChild(ifr);
    }

    cover.addEventListener('click', play);
    cover.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); play(); }
    });

    return card;
  }

  function init() {
    var anchor = document.getElementById('evidence-board');
    if (!anchor) return;
    if (document.getElementById('feat-video-0')) return; // 已注入，避免重复
    injectStyle();

    var frag = document.createDocumentFragment();
    VIDEOS.forEach(function (v, i) {
      var card = buildCard(v);
      card.id = 'feat-video-' + i;
      frag.appendChild(card);
    });
    anchor.parentNode.insertBefore(frag, anchor); // 保持 VIDEOS 顺序，视频依次排在证据板前
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
