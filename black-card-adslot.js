/* ==========================================================================
   首页黑色「全网打工人已转移消费额」卡片 → 滚动式广告位（轮播）
   --------------------------------------------------------------------------
   站长 2026-11-09 晚间指令升级：原「陆喜依品牌展示」单卡升级为独立的滚动式
   广告位轮播组件，支持手动切换（左右箭头 / 圆点）与自动轮播（悬停暂停）。
   首批两张卡：① 陆喜依品牌广告——点击广告图片跳天猫旗舰店支持双休企业，
   品牌名仍指向站内详情页；② 广告位招商中占位卡。
   定位锚点：全站唯一文案「全网打工人已转移消费额」。沿用三重兜底替换。
   主站 bundle assets/index-*.js 不可改，所有页面微调一律走独立补丁脚本。
   ========================================================================== */
(function () {
  'use strict';

  var SIG = '全网打工人已转移消费额';
  var TMALL = 'https://luxiyi.tmall.com/';
  var DETAIL = './brand/luxiyi.html';
  var IMG = './assets/luxiyi.jpg';
  var AUTOPLAY_MS = 5000;

  function injectStyle() {
    if (document.getElementById('sxg-adslot-style')) return;
    var css =
      '.sxg-adslot{box-sizing:border-box;position:relative;margin:0;padding:0;' +
      'border:1px solid #e2e8f0;border-radius:16px;background:#fff;overflow:hidden;' +
      'font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;width:100%}' +
      '.sxg-adslot__head{display:flex;align-items:center;gap:6px;padding:9px 16px;' +
      'font-size:12px;font-weight:700;color:#94a3b8;letter-spacing:.04em;' +
      'border-bottom:1px solid #f1f5f9}' +
      '.sxg-adslot__head::before{content:"";width:6px;height:6px;border-radius:50%;background:#f59e0b}' +
      '.sxg-adslot__viewport{overflow:hidden}' +
      '.sxg-adslot__track{display:flex;transition:transform .45s ease;will-change:transform}' +
      '.sxg-adslot__card{flex:0 0 100%;box-sizing:border-box;display:flex;align-items:center;' +
      'gap:14px;padding:14px 16px;color:#0f172a}' +
      '.sxg-adslot__logo{flex:0 0 auto;width:76px;height:76px;display:flex;' +
      'align-items:center;justify-content:center;border-radius:14px;overflow:hidden;' +
      'background:#fff;box-shadow:0 2px 10px rgba(15,23,42,.1);text-decoration:none}' +
      '.sxg-adslot__logo img{width:100%;height:100%;object-fit:contain;display:block}' +
      '.sxg-adslot__body{flex:1 1 auto;min-width:0}' +
      '.sxg-adslot__name{font-size:17px;font-weight:800;letter-spacing:.02em;display:flex;' +
      'align-items:center;gap:8px}' +
      '.sxg-adslot__name a{color:inherit;text-decoration:none}' +
      '.sxg-adslot__mark{flex:0 0 auto;padding:2px 8px;border-radius:999px;' +
      'background:#f1f5f9;color:#94a3b8;font-size:11px;font-weight:700;white-space:nowrap}' +
      '.sxg-adslot__tag{margin-top:3px;font-size:13px;color:#64748b;line-height:1.5}' +
      '.sxg-adslot__cta{margin-top:6px;font-size:13px;font-weight:700;color:#2563eb;line-height:1.5}' +
      '.sxg-adslot__card--recruit{flex-direction:column;align-items:flex-start;justify-content:center;gap:4px}' +
      '.sxg-adslot__recruit-title{font-size:16px;font-weight:800;color:#0f172a}' +
      '.sxg-adslot__recruit-sub{font-size:13px;color:#64748b;line-height:1.5}' +
      '.sxg-adslot__nav{position:absolute;top:54%;transform:translateY(-50%);' +
      'width:30px;height:30px;border:none;border-radius:50%;background:rgba(15,23,42,.5);' +
      'color:#fff;font-size:18px;line-height:1;cursor:pointer;display:flex;' +
      'align-items:center;justify-content:center;z-index:2}' +
      '.sxg-adslot__nav:hover{background:rgba(15,23,42,.78)}' +
      '.sxg-adslot__prev{left:10px}' +
      '.sxg-adslot__next{right:10px}' +
      '.sxg-adslot__dots{display:flex;justify-content:center;gap:6px;padding:8px 0 10px}' +
      '.sxg-adslot__dot{width:7px;height:7px;border-radius:50%;background:#cbd5e1;cursor:pointer;transition:background .2s}' +
      '.sxg-adslot__dot.is-active{background:#2563eb}' +
      '@media (max-width:480px){.sxg-adslot__nav{display:none}.sxg-adslot__cta{font-size:12px}}';
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
    root.innerHTML =
      '<div class="sxg-adslot__head">广告位</div>' +
      '<div class="sxg-adslot__viewport">' +
        '<div class="sxg-adslot__track">' +
          '<div class="sxg-adslot__card sxg-adslot__card--brand">' +
            '<a class="sxg-adslot__logo" href="' + TMALL + '" target="_blank" rel="noopener" aria-label="进入陆喜依天猫旗舰店">' +
              '<img src="' + IMG + '" alt="陆喜依">' +
            '</a>' +
            '<div class="sxg-adslot__body">' +
              '<div class="sxg-adslot__name"><a href="' + DETAIL + '" rel="noopener">陆喜依</a>' +
                '<span class="sxg-adslot__mark">品牌展示</span></div>' +
              '<div class="sxg-adslot__tag">真实双休标杆品牌 · 站长指定 S 级</div>' +
              '<div class="sxg-adslot__cta">点此进入天猫旗舰店，支持真实双休企业 →</div>' +
            '</div>' +
          '</div>' +
          '<div class="sxg-adslot__card sxg-adslot__card--recruit">' +
            '<div class="sxg-adslot__recruit-title">广告位招商中</div>' +
            '<div class="sxg-adslot__recruit-sub">真实双休标杆品牌长期招募，欢迎联系站长</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<button class="sxg-adslot__nav sxg-adslot__prev" aria-label="上一张">‹</button>' +
      '<button class="sxg-adslot__nav sxg-adslot__next" aria-label="下一张">›</button>' +
      '<div class="sxg-adslot__dots"></div>';
    initCarousel(root);
    // 图片缺失（如资源未加载）时降级为文字，避免破图
    var img = root.querySelector('img');
    if (img) {
      img.addEventListener('error', function () {
        var logo = root.querySelector('.sxg-adslot__logo');
        if (logo) { logo.textContent = '陆喜依'; }
      });
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

  // 找到黑卡就把它换成滚动式广告位；已换过的（锚点文字消失）自动跳过
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
