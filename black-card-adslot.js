/* ==========================================================================
   首页黑色「全网打工人已转移消费额」卡片 → 预留广告位
   --------------------------------------------------------------------------
   站长 2026-11-09 指令（修订）：该黑卡（含 ¥268,490 与「打卡并生成小票」按钮）
   不保留，但原位不要空着，放一个「广告位预留」占位框；
   其余页面架构（横幅 / 统计卡片 174·84·31·57 / 导航 / 筛选 / 品牌列表 /
   海比优广告块 / 良配推广位）一律原样保留，绝不动。

   定位锚点：全站唯一文案「全网打工人已转移消费额」。
   该卡片由主站压缩 bundle 异步渲染，且 React 可能在挂载后重渲染/回填文字，
   故采用三重兜底：① 渲染后多次 setTimeout；② setInterval 每秒扫一次（限 60 秒）；
   ③ MutationObserver 监听 DOM 增删与文字回填，发现锚点立即再换。
   （注意：主站 bundle assets/index-*.js 不可改，所有页面微调一律走独立补丁脚本。）
   ========================================================================== */
(function () {
  'use strict';

  var SIG = '全网打工人已转移消费额';

  // 占位框样式只注入一次，避免污染全局
  function injectStyle() {
    if (document.getElementById('sxg-adslot-style')) return;
    var css =
      '.sxg-adslot-reserved{box-sizing:border-box;min-height:128px;display:flex;' +
      'align-items:center;justify-content:center;margin:0;padding:18px;' +
      'border:2px dashed #cbd5e1;border-radius:16px;background:#f8fafc;' +
      'color:#64748b;font-family:system-ui,-apple-system,"PingFang SC",' +
      '"Microsoft YaHei",sans-serif;text-align:center;width:100%}' +
      '.sxg-adslot-reserved__tag{font-size:16px;font-weight:800;letter-spacing:.08em}' +
      '.sxg-adslot-reserved__sub{margin-top:6px;font-size:12px;color:#94a3b8}';
    var st = document.createElement('style');
    st.id = 'sxg-adslot-style';
    st.textContent = css;
    (document.head || document.documentElement).appendChild(st);
  }

  function buildSlot() {
    var slot = document.createElement('div');
    slot.className = 'sxg-adslot-reserved';
    slot.setAttribute('data-adslot-reserved', '1');
    slot.innerHTML =
      '<div class="sxg-adslot-reserved__inner">' +
      '<div class="sxg-adslot-reserved__tag">广告位预留</div>' +
      '<div class="sxg-adslot-reserved__sub">招商中 · 欢迎联系投放</div>' +
      '</div>';
    return slot;
  }

  // 找到黑卡就把它换成占位框；已换过的（锚点文字消失）自动跳过
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
