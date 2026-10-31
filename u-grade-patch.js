/*
 * u-grade-patch.js — U 级档位的中性灰渲染兜底（2026-10-31 站长：「U 级允许，但规则写死」）
 *
 * 为什么有这个文件：
 *   U 级 = 证据缺失级（仅当已尽合理检索仍无任何可采信证据时使用，且 MUST 附
 *   「证据缺失说明」，规则由 scripts/verify.mjs §2d 机器强制）。它允许存在，
 *   但视觉上必须和 S/A/B/C 区分开——既不能是绿色（良），也不能是红色（避雷），
 *   用中性灰「证据不足」表达「本站暂无法评级，非褒非贬」。
 *
 * 实现约束：
 *   - 压缩 bundle（assets/index-*.js）按铁律不许改；内置卡 U 渲染若后续需要，
 *     由本补丁统一兜底，不另动 bundle。
 *   - 本补丁只做「渲染层」修正：在 DOM 渲染完成后，按档位文案识别 U 徽章并改中性灰，
 *     不改数据、不触发 MutationObserver 自激（单次扫描、幂等、带 data 标记）。
 *   - 真实评级判定与防偷懒规则在 verify.mjs §2d，本文件不重复判定逻辑。
 */
(function () {
  'use strict';
  var PROCESSED = 'data-sxg-upatched';

  function restyle(el) {
    if (el.getAttribute(PROCESSED) === '1') return;
    el.setAttribute(PROCESSED, '1');
    // 中性灰：既非良（绿）也非避雷（红）
    el.style.background = '#f1f5f9';
    el.style.color = '#475569';
    el.style.border = '1px solid #cbd5e1';
    var txt = (el.textContent || '').trim();
    // 把「U级 / U 级 / U级评级」统一呈现为「U级 · 证据不足」
    if (/^U\s*级(评级)?$/.test(txt)) {
      el.textContent = 'U级 · 证据不足';
    }
  }

  function isBadgeLike(el) {
    var cls = (el.className || '').toString();
    return /badge|inline-flex/.test(cls) || el.tagName === 'SPAN' || el.tagName === 'DIV';
  }

  function scan() {
    try {
      var all = document.querySelectorAll('span, div, a, p, strong, b');
      for (var i = 0; i < all.length; i++) {
        var el = all[i];
        if (el.getAttribute(PROCESSED) === '1') continue;
        // 只看「自身直接文案」是 U 级的节点，避免误伤含 U 字的其他文字
        var own = '';
        for (var n = 0; n < el.childNodes.length; n++) {
          if (el.childNodes[n].nodeType === 3) own += el.childNodes[n].nodeValue || '';
        }
        own = own.trim();
        if (/^U\s*级(评级)?$/.test(own) && isBadgeLike(el)) {
          restyle(el);
          // 首页卡整块背景（emerald/red）也改成中性灰，避免 U 卡显红/绿
          var card = el;
          while (card && card !== document.body) {
            var c = (card.className || '').toString();
            if (/bg-(emerald|red)-50/.test(c) || /border-(emerald|red)-200/.test(c)) {
              card.className = c
                .replace(/bg-(emerald|red)-50/g, 'bg-slate-50')
                .replace(/border-(emerald|red)-200/g, 'border-slate-200');
              break;
            }
            card = card.parentElement;
          }
        }
      }
    } catch (e) {
      // 兜底：补丁自身任何异常都不该影响页面其它功能
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[u-grade-patch] 扫描跳过：', e && e.message);
      }
    }
  }

  // 渲染完成后执行：DOMContentLoaded 之后、再留一拍给动态卡渲染
  function run() { scan(); setTimeout(scan, 400); }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
  // 页面资源（含自定义卡脚本）load 后再扫一次，覆盖异步渲染
  window.addEventListener('load', function () { setTimeout(scan, 300); });
})();
