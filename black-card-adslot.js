/* ==========================================================================
   首页黑色「全网打工人已转移消费额」卡片 → 陆喜依品牌展示位
   --------------------------------------------------------------------------
   站长 2026-11-09 指令（修订）：该黑卡（含 ¥268,490 与「打卡并生成小票」按钮）
   不保留，原位放占位框；2026-11-09 晚间补充：陆喜依旗舰店主动提供品牌视觉，
   占位框升级为「陆喜依品牌展示」（mascot + 品牌名 + 真实双休标杆标签 + 指向
   品牌详情页的链接），其余页面架构（横幅 / 统计卡片 174·84·31·57 / 导航 / 筛选 /
   品牌列表 / 海比优广告块 / 良配推广位）一律原样保留，绝不动。

   定位锚点：全站唯一文案「全网打工人已转移消费额」。
   该卡片由主站压缩 bundle 异步渲染，且 React 可能在挂载后重渲染/回填文字，
   故采用三重兜底：① 渲染后多次 setTimeout；② setInterval 每秒扫一次（限 60 秒）；
   ③ MutationObserver 监听 DOM 增删与文字回填，发现锚点立即再换。
   （注意：主站 bundle assets/index-*.js 不可改，所有页面微调一律走独立补丁脚本。）
   ========================================================================== */
(function () {
  'use strict';

  var SIG = '全网打工人已转移消费额';

  // 样式只注入一次，避免污染全局
  function injectStyle() {
    if (document.getElementById('sxg-adslot-style')) return;
    var css =
      '.sxg-adslot-brand{box-sizing:border-box;display:flex;align-items:center;gap:14px;' +
      'margin:0;padding:14px 16px;border:1px solid #e2e8f0;border-radius:16px;' +
      'background:#fff;color:#0f172a;font-family:system-ui,-apple-system,"PingFang SC",' +
      '"Microsoft YaHei",sans-serif;width:100%;text-decoration:none}' +
      '.sxg-adslot-brand__logo{flex:0 0 auto;width:76px;height:76px;display:flex;' +
      'align-items:center;justify-content:center;border-radius:14px;overflow:hidden;' +
      'background:#fff;box-shadow:0 2px 10px rgba(15,23,42,.1)}' +
      '.sxg-adslot-brand__logo img{width:100%;height:100%;object-fit:contain;display:block}' +
      '.sxg-adslot-brand__body{flex:1 1 auto;min-width:0}' +
      '.sxg-adslot-brand__name{font-size:17px;font-weight:800;letter-spacing:.02em}' +
      '.sxg-adslot-brand__name a{color:inherit;text-decoration:none}' +
      '.sxg-adslot-brand__tag{margin-top:3px;font-size:13px;color:#64748b;line-height:1.5}' +
      '.sxg-adslot-brand__mark{flex:0 0 auto;align-self:flex-start;margin-left:6px;' +
      'padding:2px 8px;border-radius:999px;background:#f1f5f9;color:#94a3b8;' +
      'font-size:11px;font-weight:700;white-space:nowrap}';
    var st = document.createElement('style');
    st.id = 'sxg-adslot-style';
    st.textContent = css;
    (document.head || document.documentElement).appendChild(st);
  }

  function buildSlot() {
    var slot = document.createElement('div');
    slot.className = 'sxg-adslot-brand';
    slot.setAttribute('data-adslot-reserved', '1');
    slot.innerHTML =
      '<a class="sxg-adslot-brand__logo" href="./brand/luxiyi.html" rel="noopener" aria-label="陆喜依 品牌详情">' +
        '<img src="./assets/luxiyi.jpg" alt="陆喜依">' +
      '</a>' +
      '<div class="sxg-adslot-brand__body">' +
        '<div class="sxg-adslot-brand__name"><a href="./brand/luxiyi.html" rel="noopener">陆喜依</a></div>' +
        '<div class="sxg-adslot-brand__tag">真实双休标杆品牌 · 站长指定 S 级</div>' +
      '</div>' +
      '<span class="sxg-adslot-brand__mark">品牌展示</span>';
    // 图片缺失（如资源未加载）时降级为文字，避免破图
    var img = slot.querySelector('img');
    if (img) {
      img.addEventListener('error', function () {
        var logo = slot.querySelector('.sxg-adslot-brand__logo');
        if (logo) { logo.textContent = '陆喜依'; logo.removeAttribute('href'); }
      });
    }
    return slot;
  }

  // 找到黑卡就把它换成陆喜依品牌展示位；已换过的（锚点文字消失）自动跳过
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
