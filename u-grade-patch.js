/*
 * u-grade-patch.js — U 级档位的中性灰渲染（2026-10-31 站长：「U 级允许，但规则写死」）
 *                    2026-11-02 扩展：bundle 的档位渲染 switch 没有 U 分支，
 *                    tier 为 U 的卡会**完全不渲染徽标**，本脚本负责补上。
 *
 * 为什么有这个文件：
 *   U 级 = 证据缺失级（仅当已尽合理检索仍无任何可采信证据时使用，且 MUST 附
 *   「证据缺失说明」，规则由 scripts/verify.mjs §2d 机器强制）。它允许存在，
 *   但视觉上必须和 S/A/B/C 区分开——既不能是绿色（良），也不能是红色（避雷），
 *   用中性灰「证据不足」表达「本站暂无法评级，非褒非贬」。
 *
 * 实现约束：
 *   - 压缩 bundle（assets/index-*.js）按铁律不许改。bundle 里档位渲染是
 *     T=t=>{switch(t){case`S`…case`C`…}}，没有 `U` 分支，tier=U 时返回 undefined
 *     → 卡片头部不渲染徽标。所以由本补丁注入。
 *   - 识别靠品牌名（U_BRANDS）。**不能靠 DOM class 判断"这是不是 U 卡"**：
 *     Tailwind 是按需生成的，bundle 源码里没出现过的 class 在 CSS 里也不存在。
 *     清单必须与 bundle 内 tier:`U` 的卡一一对应，由 verify.mjs §2d-3 机器核对。
 *   - 样式全部内联，视觉与 S/A/B/C 徽标同规格：圆角 8px、2px 边框、12px 字、
 *     font-weight 900，仅配色改中性灰。
 *   - **性能红线（2026-11-02 踩过）**：初版用 `document.querySelectorAll('span,div,a,p,strong,b')`
 *     全文档遍历 + 120ms MutationObserver，在 174 张卡的首页上把主线程占死，
 *     React 根本没挂载出来（实测卡片数 = 0）。现在只遍历品牌卡容器，且先用
 *     textContent 做名字预筛，命中才做深检查；MO 防抖 800ms。
 *   - 幂等：注入节点带 data-sxg-ubadge，重复扫描直接跳过，不自激。
 */
(function () {
  'use strict';
  var UB = 'data-sxg-ubadge';
  var CARD_SEL = 'div.bg-white.rounded-2xl.border';   // 与 stat-filter.js 同选择器
  var NOTE_ID = 'sxg-u-note';

  // 与 bundle 内 tier:`U` 的卡一一对应（verify §2d-3 强制核对）
  var U_BRANDS = ['三星', '宏碁'];

  var BADGE_CSS = [
    'display:inline-flex', 'align-items:center', 'gap:4px',
    'padding:4px 10px', 'border-radius:8px',
    'font-size:12px', 'font-weight:900', 'letter-spacing:.02em',
    'background:#f1f5f9', 'color:#475569', 'border:2px solid #cbd5e1',
    'margin-left:auto', 'white-space:nowrap', 'flex:none'
  ].join(';');

  function makeBadge() {
    var s = document.createElement('span');
    s.setAttribute(UB, '1');
    s.setAttribute('style', BADGE_CSS);
    s.textContent = 'U级 · 证据不足';
    s.title = '本站已尽合理检索仍无可采信的月休/双休证据，不作评级（非褒非贬）；'
      + '详见该品牌详情页的「证据缺失说明」';
    return s;
  }

  // 卡片内已有档位徽标？（S级/A级/B级/C级/U级，兼容空格）
  function hasTierBadge(card) {
    var nodes = card.querySelectorAll('span');
    for (var i = 0; i < nodes.length; i++) {
      var t = (nodes[i].textContent || '').trim();
      if (t.length < 24 && /^[SABCU]\s*级/.test(t)) return true;
    }
    return false;
  }

  function injectU() {
    var cards = document.querySelectorAll(CARD_SEL);
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      var h = card.querySelector('h3, h2');
      if (!h) continue;
      var name = h.textContent || '';
      var hit = false;
      for (var k = 0; k < U_BRANDS.length; k++) {
        if (name.indexOf(U_BRANDS[k]) !== -1) { hit = true; break; }
      }
      if (!hit) continue;                                    // 名字预筛：只深查命中的卡
      if (card.querySelector('[' + UB + ']')) continue;       // 已注入
      if (hasTierBadge(card)) continue;                       // 已有正档位徽标，不动
      var info = h.parentElement;                             // 品牌信息块
      var head = info && info.parentElement;                  // 头部容器
      if (!head) continue;
      head.appendChild(makeBadge());
    }
  }

  /* 顶部四格只统计 S/A/B/C，U 级不进格。不给出出口的话「收录品牌 172」
     会和四格合计对不上，读者会以为算错。这里补一行中性灰小字。 */
  function injectStatNote() {
    if (document.getElementById(NOTE_ID)) return;
    var label = null;
    var divs = document.querySelectorAll('div');
    for (var i = 0; i < divs.length; i++) {
      var el = divs[i];
      if (el.childNodes.length !== 1) continue;
      if ((el.textContent || '').trim() === '避雷预警') { label = el; break; }
    }
    if (!label) return;
    var grid = label.closest ? label.closest('div.grid') : null;
    if (!grid || !grid.parentElement) return;
    var n = document.querySelectorAll(CARD_SEL + ' [' + UB + ']').length;
    if (!n) return;
    var p = document.createElement('div');
    p.id = NOTE_ID;
    p.setAttribute('style', 'margin-top:6px;font-size:11px;line-height:1.5;color:#94a3b8;text-align:center');
    p.textContent = '四格只统计 S/A/B/C；另有 ' + n + ' 家已尽合理检索仍无证据，标为 U级 · 证据不足（不计入上表）';
    grid.parentElement.insertBefore(p, grid.nextSibling);
  }

  function scan() {
    try { injectU(); } catch (e) { warn(e); }
    try { injectStatNote(); } catch (e) { warn(e); }
  }
  function warn(e) {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[u-grade-patch] 跳过：', e && e.message);
    }
  }

  // 首轮：卡片是异步插入的（自定义卡脚本 + 拼音索引），先密后疏地试几拍
  var tries = [0, 400, 1200, 2500, 4500];
  for (var i = 0; i < tries.length; i++) setTimeout(scan, tries[i]);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scan);
  }
  window.addEventListener('load', scan);

  // React 重渲染会重建卡片 DOM → 监听兜底重注入。
  // 防抖 800ms + 名字预筛，避免在 174 张卡的页面上把主线程拖死（初版教训）。
  var timer = null;
  try {
    new MutationObserver(function () {
      if (timer) return;
      timer = setTimeout(function () { timer = null; scan(); }, 800);
    }).observe(document.body, { childList: true, subtree: true });
  } catch (e) { /* 无 MO 时退化为上面的定时扫描 */ }
})();
