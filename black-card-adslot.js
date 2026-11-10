/* ==========================================================================
   首页黑色「全网打工人已转移消费额」卡片 → 滚动式「公益广告位」（轮播）
   --------------------------------------------------------------------------
   站长 2026-11-09 深夜指令（三处修正）：
   ① 「天猫链接也点不动啊」——CTA 提示词原先是 <div> 没有 href，只有左边 76px
      小 logo 可点。现在整张广告设计图 + CTA 提示词都是真 <a href=天猫零参数首页>。
   ② 「广告位为什么不是居中」——卡片内容一律水平居中；左右箭头从「绝对定位盖在
      卡片上」移到卡片下方导航条，彻底消除招商卡标题被箭头压住的问题。
   ③ 「广告位这个你不能设计一下图片吗」——新增两张站点自绘矢量设计稿：
      assets/ad-luxiyi.svg（品牌广告）/ assets/ad-recruit.svg（虚位以待衬底），
      与品牌 mascot 共用蓝红民族纹样 + 刺梨金黄配色，任意分辨率清晰。

   站长 2026-11-10 批次（两处）：
   ④ 「挡住了，你没发现？」——真渲染量出两类遮挡：
      a) 招商卡设计稿中央那个 r=102 的圆形印章把 HTML 文案圈在里面、弧线压字；
         现改为横向圆角白底横幅，文案区不放任何线条，副标题对比度加深。
      b) 右侧限时推广浮层 / 底部吸底条 / 悬浮按钮（z-index 9990、9000）在窄屏下
         会压住广告位；现给 .sxg-adslot 独立层级 9995，导航条底部留白 14px。
         全屏劳工提醒弹窗 .dyp（100000）的遮罩另在 douyin-prompt.css 里减淡，
         弹窗打开时广告位仍可辨认，不再是一片模糊。
   ⑤ 「广告位请优化一下，叫 公益广告位」——全站可见文案统一改为「公益广告位」，
      第二张卡由「广告位招商中」改为「公益广告位 · 虚位以待」，明确免费展示、
      非商业招商；品牌卡标记「公益展示」。两张 SVG 角标文案同步。

   两张卡：① 陆喜依品牌广告（整图点击跳天猫、品牌名跳站内详情页）；
   ② 公益广告位虚位以待。支持箭头/圆点手动切换 + 5s 自动轮播（悬停暂停）。
   定位锚点：全站唯一文案「全网打工人已转移消费额」。沿用三重兜底替换。
   主站 bundle assets/index-*.js 不可改，所有页面微调一律走独立补丁脚本。
   ========================================================================== */
(function () {
  'use strict';

  var SIG = '全网打工人已转移消费额';
  var TMALL = 'https://luxiyi.tmall.com/';
  var DETAIL = './brand/luxiyi.html';
  var IMG = './assets/luxiyi.jpg';
  var ART = './assets/ad-luxiyi.svg';
  var ART_RECRUIT = './assets/ad-recruit.svg';
  var AUTOPLAY_MS = 5000;

  function injectStyle() {
    if (document.getElementById('sxg-adslot-style')) return;
    var css =
      '.sxg-adslot{box-sizing:border-box;position:relative;z-index:9995;margin:0;padding:0;' +
      'border:1px solid #e2e8f0;border-radius:16px;background:#fff;overflow:hidden;' +
      'font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;width:100%}' +
      '.sxg-adslot__head{display:flex;align-items:center;justify-content:center;gap:6px;' +
      'padding:9px 16px;font-size:12px;font-weight:700;color:#94a3b8;letter-spacing:.12em;' +
      'border-bottom:1px solid #f1f5f9;text-align:center}' +
      '.sxg-adslot__head::before{content:"";width:6px;height:6px;border-radius:50%;background:#f59e0b}' +
      '.sxg-adslot__viewport{overflow:hidden}' +
      '.sxg-adslot__track{display:flex;transition:transform .45s ease;will-change:transform}' +
      '.sxg-adslot__card{flex:0 0 100%;box-sizing:border-box;display:flex;flex-direction:column;' +
      'align-items:center;justify-content:center;text-align:center;color:#0f172a}' +
      '.sxg-adslot__art-wrap{position:relative;width:100%;line-height:0}' +
      '.sxg-adslot__art{display:block;width:100%;height:auto}' +
      '.sxg-adslot__banner{display:block;width:100%;line-height:0;text-decoration:none;cursor:pointer}' +
      '.sxg-adslot__banner:hover .sxg-adslot__art{filter:brightness(1.06)}' +
      '.sxg-adslot__meta{box-sizing:border-box;width:100%;min-height:46px;display:flex;' +
      'align-items:center;justify-content:center;flex-wrap:wrap;gap:6px 10px;' +
      'padding:8px 16px;text-align:center}' +
      '.sxg-adslot__avatar{flex:0 0 auto;width:26px;height:26px;border-radius:8px;' +
      'object-fit:contain;background:#fff;box-shadow:0 1px 6px rgba(15,23,42,.14)}' +
      '.sxg-adslot__name{font-size:14px;font-weight:800;color:#0f172a;text-decoration:none}' +
      '.sxg-adslot__name:hover{text-decoration:underline}' +
      '.sxg-adslot__mark{flex:0 0 auto;padding:2px 8px;border-radius:999px;' +
      'background:#f1f5f9;color:#94a3b8;font-size:11px;font-weight:700;white-space:nowrap}' +
      '.sxg-adslot__tag{font-size:12px;color:#64748b;line-height:1.5}' +
      '.sxg-adslot__cta{font-size:13px;font-weight:700;color:#2563eb;line-height:1.5;' +
      'text-decoration:none;cursor:pointer}' +
      '.sxg-adslot__cta:hover{text-decoration:underline}' +
      '.sxg-adslot__hint{font-size:12px;color:#94a3b8;line-height:1.5}' +
      '.sxg-adslot__recruit-copy{position:absolute;inset:0;display:flex;flex-direction:column;' +
      'align-items:center;justify-content:center;gap:6px;text-align:center;pointer-events:none}' +
      '.sxg-adslot__recruit-title{font-size:25px;font-weight:800;color:#0f172a;letter-spacing:.06em}' +
      '.sxg-adslot__recruit-sub{font-size:14px;font-weight:600;color:#475569;line-height:1.5}' +
      '.sxg-adslot__foot{display:flex;align-items:center;justify-content:center;gap:12px;' +
      'padding:7px 0 14px;border-top:1px solid #f1f5f9}' +
      '.sxg-adslot__nav{width:26px;height:26px;border:none;border-radius:50%;' +
      'background:#e2e8f0;color:#334155;font-size:17px;line-height:1;cursor:pointer;' +
      'display:flex;align-items:center;justify-content:center;padding:0}' +
      '.sxg-adslot__nav:hover{background:#1d3f9e;color:#fff}' +
      '.sxg-adslot__dots{display:flex;align-items:center;gap:6px}' +
      '.sxg-adslot__dot{width:7px;height:7px;border-radius:50%;background:#cbd5e1;' +
      'cursor:pointer;transition:background .2s}' +
      '.sxg-adslot__dot.is-active{background:#1d3f9e}' +
      '@media (max-width:480px){.sxg-adslot__nav{display:none}' +
      '.sxg-adslot__recruit-title{font-size:18px}.sxg-adslot__recruit-sub{font-size:12px}' +
      '.sxg-adslot__cta{font-size:12px}.sxg-adslot__meta{gap:5px 8px}}';
    var st = document.createElement('style');
    st.id = 'sxg-adslot-style';
    st.textContent = css;
    (document.head || document.documentElement).appendChild(st);
  }

  function buildSlot() {
    var root = document.createElement('div');
    root.className = 'sxg-adslot';
    root.setAttribute('data-adslot', '1');
    root.setAttribute('data-adslot-reserved', '1'); // 兼容 cdp-adcheck 验收
    root.setAttribute('data-adslot-kind', 'public-welfare');
    root.setAttribute('aria-label', '公益广告位');
    root.innerHTML =
      '<div class="sxg-adslot__head">公益广告位</div>' +
      '<div class="sxg-adslot__viewport">' +
        '<div class="sxg-adslot__track">' +
          '<div class="sxg-adslot__card sxg-adslot__card--brand">' +
            '<a class="sxg-adslot__banner" href="' + TMALL + '" target="_blank" rel="noopener" ' +
              'aria-label="进入陆喜依天猫旗舰店，支持真实双休企业">' +
              '<img class="sxg-adslot__art" src="' + ART + '" ' +
                'alt="陆喜依 · 真实双休标杆品牌 · 点击进入天猫旗舰店">' +
            '</a>' +
            '<div class="sxg-adslot__meta">' +
              '<img class="sxg-adslot__avatar" src="' + IMG + '" alt="陆喜依">' +
              '<a class="sxg-adslot__name" href="' + DETAIL + '" rel="noopener">陆喜依</a>' +
              '<span class="sxg-adslot__mark">公益展示</span>' +
              '<span class="sxg-adslot__tag">真实双休标杆品牌 · 站长指定 S 级</span>' +
              '<a class="sxg-adslot__cta" href="' + TMALL + '" target="_blank" rel="noopener">' +
                '点此进入天猫旗舰店，支持真实双休企业 →</a>' +
            '</div>' +
          '</div>' +
          '<div class="sxg-adslot__card sxg-adslot__card--recruit">' +
            '<div class="sxg-adslot__art-wrap">' +
              '<img class="sxg-adslot__art" src="' + ART_RECRUIT + '" ' +
                'alt="公益广告位 · 虚位以待 · 真实双休标杆品牌可申请免费展示">' +
              '<div class="sxg-adslot__recruit-copy">' +
                '<div class="sxg-adslot__recruit-title">公益广告位 · 虚位以待</div>' +
                '<div class="sxg-adslot__recruit-sub">真实双休标杆品牌可申请免费展示，欢迎联系站长</div>' +
              '</div>' +
            '</div>' +
            '<div class="sxg-adslot__meta">' +
              '<span class="sxg-adslot__hint">← 左右箭头 / 圆点切换公益广告卡 · 自动轮播 5 秒 →</span>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="sxg-adslot__foot">' +
        '<button type="button" class="sxg-adslot__nav sxg-adslot__prev" aria-label="上一张">‹</button>' +
        '<div class="sxg-adslot__dots"></div>' +
        '<button type="button" class="sxg-adslot__nav sxg-adslot__next" aria-label="下一张">›</button>' +
      '</div>';
    initCarousel(root);
    // 图片缺失时降级为文字，避免破图（站点默认静默失效方式）
    var imgs = root.querySelectorAll('img');
    for (var j = 0; j < imgs.length; j++) {
      (function (img) {
        img.addEventListener('error', function () {
          img.setAttribute('data-adslot-img-error', '1');
          img.style.display = 'none';
          if (img.className.indexOf('sxg-adslot__avatar') !== -1) {
            var span = document.createElement('span');
            span.className = 'sxg-adslot__name';
            span.textContent = '陆喜依';
            if (img.parentNode) img.parentNode.insertBefore(span, img.nextSibling);
          }
        });
      })(imgs[j]);
    }
    return root;
  }

  function initCarousel(root) {
    var track = root.querySelector('.sxg-adslot__track');
    var cards = root.querySelectorAll('.sxg-adslot__card');
    var dotsWrap = root.querySelector('.sxg-adslot__dots');
    var prevBtn = root.querySelector('.sxg-adslot__prev');
    var nextBtn = root.querySelector('.sxg-adslot__next');
    var viewport = root.querySelector('.sxg-adslot__viewport');
    var n = cards.length;
    var cur = 0;
    var timer = null;

    var dots = [];
    for (var i = 0; i < n; i++) {
      (function (idx) {
        var d = document.createElement('span');
        d.className = 'sxg-adslot__dot' + (idx === 0 ? ' is-active' : '');
        d.addEventListener('click', function () { go(idx); });
        dotsWrap.appendChild(d);
        dots.push(d);
      })(i);
    }

    function render() {
      track.style.transform = 'translateX(' + (-cur * 100) + '%)';
      for (var k = 0; k < dots.length; k++) {
        if (k === cur) dots[k].classList.add('is-active');
        else dots[k].classList.remove('is-active');
      }
    }
    function go(i) {
      cur = (i % n + n) % n;
      render();
      restart();
    }
    function next() { go(cur + 1); }
    function prev() { go(cur - 1); }
    function restart() {
      if (timer) clearInterval(timer);
      timer = setInterval(next, AUTOPLAY_MS);
    }

    nextBtn.addEventListener('click', next);
    prevBtn.addEventListener('click', prev);
    viewport.addEventListener('mouseenter', function () { if (timer) clearInterval(timer); });
    viewport.addEventListener('mouseleave', restart);

    render();
    restart();
  }

  // 找到黑卡就把它换成滚动式公益广告位；已换过的（锚点文字消失）自动跳过
  function transformCard() {
    var nodes = document.querySelectorAll('div');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var cls = (el.className || '');
      if (typeof cls === 'string' &&
          cls.indexOf('bg-slate-900') !== -1 &&
          el.textContent &&
          el.textContent.indexOf(SIG) !== -1) {
        var slot = buildSlot();
        if (el.parentNode) {
          el.parentNode.replaceChild(slot, el);
        } else {
          el.replaceWith(slot);
        }
        return true;
      }
    }
    return false;
  }

  // 廉价守卫：整页还含锚点时才动手，避免每次 mutation 都全量扫描
  function maybeTransform() {
    if (document.body && document.body.innerHTML.indexOf(SIG) !== -1) {
      transformCard();
    }
  }

  injectStyle();

  // ① 立即试一次 + 异步渲染后多次兜底
  transformCard();
  setTimeout(transformCard, 500);
  setTimeout(transformCard, 1500);
  setTimeout(transformCard, 3000);
  setTimeout(transformCard, 5000);

  // ② 持续 60 秒每秒兜底，覆盖任何延迟渲染 / 重渲染
  var iv = setInterval(maybeTransform, 1000);
  setTimeout(function () { clearInterval(iv); }, 60000);

  // ③ MutationObserver：DOM 增删或文字回填（characterData）出现锚点立即再换
  if (typeof MutationObserver !== 'undefined') {
    var mo = new MutationObserver(maybeTransform);
    mo.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }
})();
