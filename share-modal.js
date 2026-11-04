/* 分享弹窗（任意页面可复用）
 * 用法：<script src="./share-modal.js?v=1" defer></script>
 *      window.SXGShare.open();
 *
 * 平台口径（站长 2026-11-04 指定）：
 *   国内：朋友圈 / 微信 / 抖音 / 小红书 / 微博（圆形图标，按站长给的样式）
 *   海外：Discord（替换原 Email）/ Facebook / X / LinkedIn / Reddit / Telegram / KakaoTalk / Line
 *   末尾：复制链接
 * 说明：微信、朋友圈、抖音、小红书、Discord、KakaoTalk 没有可用的网页分享接口，
 *       统一走「复制链接 + 提示粘贴」，不假装能一键跳转。
 */
(function () {
  'use strict';
  if (window.SXGShare) return;

  var CSS = [
    '.sxg-share-mask{position:fixed;inset:0;z-index:9999;background:rgba(15,23,42,.55);display:none;align-items:center;justify-content:center;padding:20px}',
    '.sxg-share-mask.on{display:flex}',
    '.sxg-share-card{position:relative;width:100%;max-width:400px;max-height:88vh;overflow-y:auto;background:#fff;border-radius:18px;padding:22px 20px 14px;box-shadow:0 24px 60px rgba(0,0,0,.28);-webkit-overflow-scrolling:touch}',
    '.sxg-share-x{position:absolute;top:9px;right:9px;width:32px;height:32px;border:none;background:none;border-radius:50%;font-size:22px;line-height:1;color:#9ca3af;cursor:pointer}',
    '.sxg-share-x:hover{background:#f3f4f6;color:#374151}',
    '.sxg-share-title{margin:0 0 4px;font-size:17px;font-weight:700;color:#0f766e}',
    '.sxg-share-sub{margin:0 0 16px;font-size:13px;color:#6b7280}',
    '.sxg-share-label{margin:0 0 10px;font-size:12px;font-weight:600;color:#94a3b8;letter-spacing:.5px}',
    '.sxg-share-domestic{display:flex;justify-content:space-between;gap:4px;margin-bottom:18px}',
    '.sxg-sd{flex:1;display:flex;flex-direction:column;align-items:center;gap:6px;padding:0;border:none;background:none;cursor:pointer;font:inherit;text-decoration:none;color:inherit}',
    '.sxg-sd-ico{width:50px;height:50px;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(15,23,42,.12);transition:transform .15s ease}',
    '.sxg-sd:hover .sxg-sd-ico{transform:translateY(-2px) scale(1.04)}',
    '.sxg-sd-ico svg{width:28px;height:28px;display:block}',
    '.sxg-sd-name{font-size:11px;color:#4b5563;white-space:nowrap}',
    '.sxg-share-foreign{border-top:1px solid #f1f5f9}',
    '.sxg-sf{display:flex;align-items:center;gap:10px;width:100%;padding:9px 2px;border:none;border-bottom:1px solid #f1f5f9;background:none;text-decoration:none;color:#1f2937;font:inherit;font-size:14px;text-align:left;cursor:pointer}',
    '.sxg-sf:hover{background:#f8fafc}',
    '.sxg-sf-ico{flex:0 0 22px;width:22px;height:22px;display:flex;align-items:center;justify-content:center}',
    '.sxg-sf-ico svg{width:22px;height:22px;display:block}',
    '.sxg-sf-name{flex:1}',
    '.sxg-sf-hint{font-size:11px;color:#cbd5e1}',
    '.sxg-share-copy{display:flex;align-items:center;gap:10px;width:100%;margin-top:10px;padding:10px 2px;border:none;background:none;font:inherit;font-size:14px;color:#1f2937;text-align:left;cursor:pointer;border-radius:8px}',
    '.sxg-share-copy:hover{background:#f8fafc}',
    '.sxg-share-toast{position:fixed;left:50%;bottom:40px;transform:translate(-50%,12px);z-index:10000;max-width:86vw;padding:10px 18px;border-radius:999px;background:rgba(17,24,39,.92);color:#fff;font-size:13px;text-align:center;opacity:0;pointer-events:none;transition:opacity .2s ease,transform .2s ease}',
    '.sxg-share-toast.on{opacity:1;transform:translate(-50%,0)}',
    '@media (max-width:420px){.sxg-sd-ico{width:44px;height:44px}.sxg-sd-ico svg{width:24px;height:24px}.sxg-sd-name{font-size:10px}.sxg-share-card{padding:20px 16px 12px}}'
  ].join('');

  var D = 'M15 3h1.9c.3 1.7 1.4 3.1 3.1 3.4v2c-1.2 0-2.3-.4-3.2-1.1v6.2c0 3-2.4 5.4-5.4 5.4S6 16.5 6 13.5s2.4-5.4 5.4-5.4c.3 0 .6 0 .9.1v2c-.3-.1-.6-.1-.9-.1-1.9 0-3.4 1.5-3.4 3.4s1.5 3.4 3.4 3.4 3.4-1.5 3.4-3.4V3z';

  // 兜底分享文案（页面没有 og:description 时用）。
  // 口径参考必应收录的站点简介，站长 2026-11-04 认可这个方向。
  var FALLBACK_DESC = '双休购 ShuangxiuGo —— 开源的劳工厂友好品牌索引：查公司双休制度、'
    + '企业工时评级、员工实测数据，避雷单休、大小周、996 血汗工厂，'
    + '买东西、找工作前先查一查。';

  var ICON = {
    moments: '<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="12" r="8.6"/><path d="M12 3.4l6.4 8M20.6 12l-9 6.4M12 20.6l-6.4-8M3.4 12l9-6.4"/></g></svg>',
    wechat: '<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="#fff"><path d="M9.6 4.1C6 4.1 3 6.6 3 9.6c0 1.7.9 3.3 2.4 4.3l-.7 2.2 2.5-1.2c.7.2 1.5.3 2.3.3h.4c-.2-.5-.3-1.1-.3-1.7 0-2.9 2.8-5.2 6.2-5.2h.4C15.7 5.8 12.9 4.1 9.6 4.1z"/><path d="M21 13.4c0-2.5-2.5-4.5-5.5-4.5S10 10.9 10 13.4s2.5 4.5 5.5 4.5c.6 0 1.2-.1 1.8-.2l2 1-.6-1.7c1.4-.8 2.3-2.1 2.3-3.6z"/></g></svg>',
    douyin: '<svg viewBox="0 0 24 24" aria-hidden="true"><g transform="translate(-.8,-.5)" fill="#25F4EE"><path d="' + D + '"/></g><g transform="translate(.8,.5)" fill="#FE2C55"><path d="' + D + '"/></g><path d="' + D + '" fill="#fff"/></svg>',
    xhs: '<svg viewBox="0 0 24 24" aria-hidden="true"><text x="12" y="12.4" text-anchor="middle" dominant-baseline="middle" font-size="7.6" font-weight="700" fill="#fff" font-family="-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif">小红书</text></svg>',
    weibo: '<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round"><ellipse cx="11.6" cy="12.8" rx="7.2" ry="5.1"/><path d="M17.4 6.5c1.8.4 3 1.6 3.4 3.3"/></g><circle cx="11.6" cy="12.8" r="2.1" fill="#fff"/></svg>',
    discord: '<svg viewBox="0 0 22 22" aria-hidden="true"><rect width="22" height="22" rx="6.2" fill="#5865F2"/><path d="M15.9 7.3a8.4 8.4 0 0 0-1.9-.6l-.3.6a6.6 6.6 0 0 0-2.4 0l-.3-.6c-.7.1-1.3.3-1.9.6-1.5 2.1-1.9 4.2-1.7 6.2.8.6 1.6 1 2.5 1.2l.5-.8-.8-.4.2-.2c1.6.7 3.3.7 4.8 0l.2.2-.8.4.5.8c.9-.2 1.7-.6 2.5-1.2.2-2-.2-4.1-1.7-6.2z" fill="#fff"/><circle cx="9.3" cy="11.6" r=".85" fill="#5865F2"/><circle cx="12.7" cy="11.6" r=".85" fill="#5865F2"/></svg>',
    facebook: '<svg viewBox="0 0 22 22" aria-hidden="true"><rect width="22" height="22" rx="6.2" fill="#1877F2"/><text x="11.4" y="11.9" text-anchor="middle" dominant-baseline="middle" font-size="14" font-weight="700" fill="#fff" font-family="Georgia,\'Times New Roman\',serif">f</text></svg>',
    x: '<svg viewBox="0 0 22 22" aria-hidden="true"><rect width="22" height="22" rx="6.2" fill="#0f1419"/><text x="11" y="11.4" text-anchor="middle" dominant-baseline="middle" font-size="11" font-weight="700" fill="#fff" font-family="Georgia,\'Times New Roman\',serif">X</text></svg>',
    linkedin: '<svg viewBox="0 0 22 22" aria-hidden="true"><rect width="22" height="22" rx="6.2" fill="#0A66C2"/><text x="11" y="11.4" text-anchor="middle" dominant-baseline="middle" font-size="9.6" font-weight="700" fill="#fff" font-family="-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif">in</text></svg>',
    reddit: '<svg viewBox="0 0 22 22" aria-hidden="true"><circle cx="11" cy="11" r="11" fill="#FF4500"/><path d="M11 6.7l.5 1.5" stroke="#fff" stroke-width="1.3" stroke-linecap="round"/><circle cx="11.6" cy="6.2" r="1" fill="#fff"/><ellipse cx="11" cy="12.7" rx="5" ry="4.2" fill="#fff"/><circle cx="9" cy="12.1" r="1.1" fill="#FF4500"/><circle cx="13" cy="12.1" r="1.1" fill="#FF4500"/><path d="M9.3 14.6c1.1.7 2.4.7 3.4 0" stroke="#FF4500" stroke-width="1" fill="none" stroke-linecap="round"/><circle cx="5.7" cy="11.5" r="1.2" fill="#fff"/><circle cx="16.3" cy="11.5" r="1.2" fill="#fff"/></svg>',
    telegram: '<svg viewBox="0 0 22 22" aria-hidden="true"><circle cx="11" cy="11" r="11" fill="#229ED9"/><path d="M5.2 10.9l11-4.3c.5-.2 1 .1.8.8l-1.9 8.7c-.1.5-.5.6-.9.4l-2.4-1.8-1.2 1.2c-.2.2-.4.2-.5.1l.2-2.6 4.9-4.4-6 3.7-2.7-.7c-.6-.2-.6-.7 0-.9z" fill="#fff"/></svg>',
    kakaotalk: '<svg viewBox="0 0 22 22" aria-hidden="true"><rect width="22" height="22" rx="6.2" fill="#FEE500"/><path d="M11 5.5c-3.5 0-6.3 2.3-6.3 5.1 0 1.7 1 3.2 2.6 4.1l-.7 2.4 2.7-1.5c.5.1 1.1.2 1.7.2 3.5 0 6.3-2.3 6.3-5.2S14.5 5.5 11 5.5z" fill="#3C1E1E"/></svg>',
    line: '<svg viewBox="0 0 22 22" aria-hidden="true"><rect width="22" height="22" rx="6.2" fill="#06C755"/><text x="11" y="11.4" text-anchor="middle" dominant-baseline="middle" font-size="6.4" font-weight="700" fill="#fff" font-family="-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif">LINE</text></svg>',
    whatsapp: '<svg viewBox="0 0 22 22" aria-hidden="true"><rect width="22" height="22" rx="6.2" fill="#25D366"/><path d="M11 4.6c-3.5 0-6.4 2.8-6.4 6.3 0 1.2.3 2.3.9 3.2L4.5 17.6l3.6-.9c.9.5 1.8.7 2.9.7 3.5 0 6.4-2.8 6.4-6.3S14.5 4.6 11 4.6z" fill="none" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/><path d="M8.7 7.9c.2-.4.4-.4.6-.4h.5c.2 0 .3.1.4.3l.7 1.5c.1.2.1.4-.1.6l-.5.5c-.1.1-.1.3-.1.4.4.8 1.3 1.6 2.1 2 .2.1.3.1.5-.1l.5-.5c.2-.2.4-.2.6-.1l1.5.7c.3.1.4.3.4.5-.1.9-.8 1.5-1.7 1.5-2.3 0-5.1-2.6-5.1-5.1 0-.8.1-1.4.7-1.8z" fill="#fff"/></svg>',
    link: '<svg viewBox="0 0 22 22" aria-hidden="true"><circle cx="11" cy="11" r="11" fill="#E2E8F0"/><g fill="none" stroke="#475569" stroke-width="1.6" stroke-linecap="round"><path d="M9.4 12.6a2.5 2.5 0 0 0 3.5 0l2.1-2.1a2.5 2.5 0 0 0-3.5-3.5l-.9.9"/><path d="M12.6 9.4a2.5 2.5 0 0 0-3.5 0l-2.1 2.1a2.5 2.5 0 0 0 3.5 3.5l.9-.9"/></g></svg>'
  };

  var DOMESTIC = [
    { k: 'moments', name: '朋友圈', bg: '#0B7A4B', copy: '文案和链接已复制，打开微信发朋友圈时粘贴' },
    { k: 'wechat', name: '微信', bg: '#07C160', copy: '文案和链接已复制，打开微信粘贴给好友' },
    { k: 'douyin', name: '抖音', bg: '#000000', copy: '文案和链接已复制，打开抖音粘贴给好友' },
    { k: 'xhs', name: '小红书', bg: '#FF2442', copy: '文案和链接已复制，打开小红书粘贴分享' },
    { k: 'weibo', name: '微博', bg: '#E6162D', url: 'weibo' }
  ];

  var FOREIGN = [
    { k: 'discord', name: 'Discord', copy: '文案和链接已复制，粘贴到 Discord 频道' },
    { k: 'facebook', name: 'Facebook', url: 'facebook' },
    { k: 'x', name: 'X', url: 'x' },
    { k: 'linkedin', name: 'LinkedIn', url: 'linkedin' },
    { k: 'reddit', name: 'Reddit', url: 'reddit' },
    { k: 'telegram', name: 'Telegram', url: 'telegram' },
    { k: 'kakaotalk', name: 'KakaoTalk', copy: '文案和链接已复制，粘贴到 KakaoTalk 聊天' },
    { k: 'line', name: 'Line', url: 'line' },
    { k: 'whatsapp', name: 'WhatsApp', url: 'whatsapp' }
  ];

  function injectStyle() {
    if (document.getElementById('sxg-share-style')) return;
    var s = document.createElement('style');
    s.id = 'sxg-share-style';
    s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  function info() {
    var url = location.href;
    var title = document.title || '双休购 ShuangxiuGo';
    var og = document.querySelector('meta[property="og:title"]');
    if (og && og.getAttribute('content')) title = og.getAttribute('content');
    // 2026-11-04 站长要求：分享出去不能光秃秃一个链接/照搬网站标题，
    // 要带一句人话说明。优先取页面 og:description，取不到用兜底文案。
    var desc = FALLBACK_DESC;
    var od = document.querySelector('meta[property="og:description"]')
      || document.querySelector('meta[name="description"]');
    if (od && od.getAttribute('content')) desc = od.getAttribute('content');
    return { url: url, title: title, desc: desc };
  }

  function build() {
    if (document.getElementById('sxg-share-mask')) return;
    var i = info();
    var u = encodeURIComponent(i.url);
    var t = encodeURIComponent(i.title);
    // 分享文本用说明文案，不照搬网站标题（站长 2026-11-04 要求）
    var d = encodeURIComponent(i.desc);
    // 能附图的平台就附图（og-share.png：微信/Discord/Telegram 链接卡片与微博配图共用）
    var pic = encodeURIComponent('https://dujeongil-galaxy.github.io/shuangxiugou/og-share.png');
    var urls = {
      weibo: 'https://service.weibo.com/share/share.php?url=' + u + '&title=' + d + '&pic=' + pic,
      facebook: 'https://www.facebook.com/sharer/sharer.php?u=' + u,
      x: 'https://twitter.com/intent/tweet?url=' + u + '&text=' + d,
      linkedin: 'https://www.linkedin.com/sharing/share-offsite/?url=' + u,
      reddit: 'https://www.reddit.com/submit?url=' + u + '&title=' + t,
    telegram: 'https://t.me/share/url?url=' + u + '&text=' + d,
    line: 'https://social-plugins.line.me/lineit/share?url=' + u + '&text=' + d,
    // wa.me 只有 text 参数，链接要拼进文案里
    whatsapp: 'https://wa.me/?text=' + d + '%0A' + u
  };

    var html = '<div class="sxg-share-card" role="dialog" aria-modal="true" aria-label="分享双休购">'
      + '<button type="button" class="sxg-share-x" data-act="close" aria-label="关闭">×</button>'
      + '<h3 class="sxg-share-title">分享双休购</h3>'
      + '<p class="sxg-share-sub">让更多人了解这些品牌的双休情况</p>'
      + '<p class="sxg-share-label">国内平台</p>'
      + '<div class="sxg-share-domestic">';

    DOMESTIC.forEach(function (p) {
      if (p.url) {
        html += '<a class="sxg-sd" href="' + urls[p.url] + '" target="_blank" rel="noopener noreferrer">'
          + '<span class="sxg-sd-ico" style="background:' + p.bg + '">' + ICON[p.k] + '</span>'
          + '<span class="sxg-sd-name">' + p.name + '</span></a>';
      } else {
        html += '<button type="button" class="sxg-sd" data-copy="1" data-msg="' + p.copy + '">'
          + '<span class="sxg-sd-ico" style="background:' + p.bg + '">' + ICON[p.k] + '</span>'
          + '<span class="sxg-sd-name">' + p.name + '</span></button>';
      }
    });

    html += '</div><p class="sxg-share-label">海外平台</p><div class="sxg-share-foreign">';

    FOREIGN.forEach(function (p) {
      if (p.url) {
        html += '<a class="sxg-sf" href="' + urls[p.url] + '" target="_blank" rel="noopener noreferrer">'
          + '<span class="sxg-sf-ico">' + ICON[p.k] + '</span>'
          + '<span class="sxg-sf-name">' + p.name + '</span></a>';
      } else {
        html += '<button type="button" class="sxg-sf" data-copy="1" data-msg="' + p.copy + '">'
          + '<span class="sxg-sf-ico">' + ICON[p.k] + '</span>'
          + '<span class="sxg-sf-name">' + p.name + '</span></button>';
      }
    });

    html += '</div>'
      + '<button type="button" class="sxg-share-copy" data-copy="link" data-msg="链接已复制">'
      + '<span class="sxg-sf-ico">' + ICON.link + '</span>'
      + '<span class="sxg-sf-name">复制链接</span></button>'
      + '</div>';

    var mask = document.createElement('div');
    mask.id = 'sxg-share-mask';
    mask.className = 'sxg-share-mask';
    mask.innerHTML = html;

    var toast = document.createElement('div');
    toast.id = 'sxg-share-toast';
    toast.className = 'sxg-share-toast';

    document.body.appendChild(mask);
    document.body.appendChild(toast);

    mask.addEventListener('click', function (e) {
      if (e.target === mask) { close(); return; }
      var el = e.target.closest ? e.target.closest('[data-act="close"], [data-copy]') : null;
      if (!el) return;
      if (el.getAttribute('data-act') === 'close') { close(); return; }
      var mode = el.getAttribute('data-copy');
      if (mode === 'link') {
        copyText(i.url, el.getAttribute('data-msg') || '链接已复制');
      } else {
        // 复制类平台：带说明文案 + 链接，不光秃秃一个 URL（站长 2026-11-04 要求）
        copyText(i.desc + '\n' + i.url, el.getAttribute('data-msg') || '文案和链接已复制');
      }
    });
  }

  var toastTimer = null;
  function toast(msg) {
    var el = document.getElementById('sxg-share-toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('on');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('on'); }, 2600);
  }

  function copyText(text, msg) {
    function done() { toast(msg); }
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (e) {}
      document.body.removeChild(ta);
      done();
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, fallback);
    } else {
      fallback();
    }
  }

  function onKey(e) {
    if (e.key === 'Escape') close();
  }

  function open() {
    injectStyle();
    build();
    var mask = document.getElementById('sxg-share-mask');
    if (!mask) return;
    mask.classList.add('on');
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
  }

  function close() {
    var mask = document.getElementById('sxg-share-mask');
    if (mask) mask.classList.remove('on');
    document.removeEventListener('keydown', onKey);
    document.body.style.overflow = '';
  }

  window.SXGShare = { open: open, close: close };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { injectStyle(); });
  } else {
    injectStyle();
  }
})();
