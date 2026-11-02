/*
 * u-grade-patch.js — bundle 未覆盖档位（U / D）的徽标与备注渲染
 *                    文件名沿用旧名（改动面最小），实际职责已扩为「所有 bundle 没有
 *                    case 分支的档位」统一出口。
 *
 * 为什么有这个文件：
 *   压缩 bundle 里档位渲染是 T=t=>{switch(t){case`S`…case`C`…}}，**只有 S/A/B/C 四个分支**。
 *   tier 为 U 或 D 时返回 undefined → 卡片头部根本不渲染徽标（静默空白，只有真渲染才看得出来）。
 *   bundle 按铁律不许做结构改动（只允许同长度字节替换），所以这两个档位的徽标由本补丁注入。
 *
 * 两个档位的语义完全不同，样式也刻意不同：
 *
 *   U 级 = 证据缺失级。仅当已尽合理检索仍无任何可采信证据时使用，必须附「证据缺失说明」
 *        （规则由 verify.mjs §2d 机器强制）。视觉用**中性灰**——既不是绿（良）也不是红（避雷），
 *        表达「本站暂无法评级，非褒非贬」。
 *
 *   D 级 = 站长人工干预级。判据固定为一条：**管理层指令性规避法律风险加班**——
 *        企业高管/公司文件主动要求「想办法规避法律风险」以安排加班（奇瑞 2023-03 内部邮件
 *        「周六是奋斗者的正常工作日…请想办法（规避法律风险）」为标本）。
 *        它比 C 更重：C 是被动超时/月休不足/拒不披露，D 是**明知违法而设计规避**。
 *        **AI 不得自行判 D**：D 只由站长人工介入判定，卡面必须写明「站长强制降级」，
 *        这是全站唯一一档「人的结论高于数据推演」的记录，所以视觉用**近黑深红** + 卡内备注条。
 *
 * 识别靠品牌名清单（不能靠 DOM class：Tailwind 是按需生成的，bundle 源码里没出现过的
 * class 在 CSS 里也不存在）。清单必须与 bundle 内 tier:`U` / tier:`D` 的卡一一对应，
 * 由 verify.mjs §2d-3 / §2e-4 机器核对。
 *
 * 性能红线（2026-11-02 踩过）：初版用 document.querySelectorAll('span,div,a,p,strong,b')
 *   全文档遍历 + 120ms MutationObserver，在 174 张卡的首页上把主线程占死，React 根本没挂载
 *   出来（实测卡片数 = 0）。现在只遍历品牌卡容器，且先用 textContent 做名字预筛，
 *   命中才做深检查；MO 防抖 800ms。
 *
 * 幂等：注入节点带 data-sxg-ubadge / data-sxg-dbadge，重复扫描直接跳过，不自激。
 */
(function () {
  'use strict';
  var UB = 'data-sxg-ubadge';
  var DB = 'data-sxg-dbadge';
  var TIER_ATTR = 'data-sxg-tier';                    // 供 stat-filter.js 读取（不依赖徽标是否已注入）
  var CARD_SEL = 'div.bg-white.rounded-2xl.border';   // 与 stat-filter.js 同选择器
  var NOTE_ID = 'sxg-u-note';
  var DNOTE_ID = 'sxg-d-note';
  var CARDNOTE_ATTR = 'data-sxg-dnote';

  // 与 bundle 内 tier:`U` 的卡一一对应（verify §2d-3 强制核对）
  var U_BRANDS = ['三星', '宏碁'];
  // 与 bundle 内 tier:`D` 的卡一一对应（verify §2e-4 强制核对）。
  // 加品牌 = 站长人工降级，必须同时在详情页写入「人工干预记录」区块。
  var D_BRANDS = ['奇瑞'];

  var U_BADGE_CSS = [
    'display:inline-flex', 'align-items:center', 'gap:4px',
    'padding:4px 10px', 'border-radius:8px',
    'font-size:12px', 'font-weight:900', 'letter-spacing:.02em',
    'background:#f1f5f9', 'color:#475569', 'border:2px solid #cbd5e1',
    'margin-left:auto', 'white-space:nowrap', 'flex:none'
  ].join(';');

  // D 比 C 的 #BE123C 更重一档：近黑底 + 深红描边，视觉上一眼看出「这不是自动判的」
  var D_BADGE_CSS = [
    'display:inline-flex', 'align-items:center', 'gap:4px',
    'padding:4px 10px', 'border-radius:8px',
    'font-size:12px', 'font-weight:900', 'letter-spacing:.02em',
    'background:#450a0a', 'color:#fff', 'border:2px solid #7f1d1d',
    'margin-left:auto', 'white-space:nowrap', 'flex:none'
  ].join(';');

  function makeBadge() {
    var s = document.createElement('span');
    s.setAttribute(UB, '1');
    s.setAttribute('style', U_BADGE_CSS);
    s.textContent = 'U级 · 证据不足';
    s.title = '本站已尽合理检索仍无可采信的月休/双休证据，不作评级（非褒非贬）；'
      + '详见该品牌详情页的「证据缺失说明」';
    return s;
  }

  function makeDBadge() {
    var s = document.createElement('span');
    s.setAttribute(DB, '1');
    s.setAttribute('style', D_BADGE_CSS);
    s.textContent = 'D级 · 站长强制降级';
    s.title = 'D 级不由 AI 判定：站长人工介入，强制把该卡从 AI 原判档位降为 D 级；'
      + '判据为管理层指令性规避法律风险加班，详见详情页「人工干预记录」';
    return s;
  }

  /* 卡内人工干预备注条（站长明确要求「备注站长人为干预，强制介入要求 AI 降级」）。
     徽标只有几个字，装不下「为什么」；这条说明必须留在卡面上，不能只藏在详情页。 */
  function makeDCardNote() {
    var d = document.createElement('div');
    d.setAttribute(CARDNOTE_ATTR, '1');
    d.setAttribute('style', [
      'margin:8px 0 0', 'padding:8px 10px', 'border-radius:8px',
      'background:#fef2f2', 'border:1px solid #fecaca',
      'color:#991b1b', 'font-size:11px', 'line-height:1.6', 'text-align:left'
    ].join(';'));
    d.innerHTML = '<strong>⚑ 站长人工干预 · 强制降级</strong>：'
      + '本卡原判 <s>C 级</s>，站长介入后强制降为 <strong>D 级</strong>。'
      + '判据：高管内部邮件要求「想办法（规避法律风险）」把周六定为奋斗者正常工作日——'
      + '属<strong>管理层指令性规避法律风险加班</strong>，比一般超时更重。'
      + '该档位不由 AI 判定，详见详情页「人工干预记录」。';
    return d;
  }

  // 卡片内已有档位徽标？（S/A/B/C/D/U 级，兼容空格）
  function hasTierBadge(card) {
    var nodes = card.querySelectorAll('span');
    for (var i = 0; i < nodes.length; i++) {
      var t = (nodes[i].textContent || '').trim();
      if (t.length < 24 && /^[SABCDU]\s*级/.test(t)) return true;
    }
    return false;
  }

  function nameHit(name, list) {
    for (var k = 0; k < list.length; k++) {
      if (name.indexOf(list[k]) !== -1) return true;
    }
    return false;
  }

  /* 先注入 D（它同时要备注条），再注入 U。
     两个档位互斥（bundle 里一张卡只有一个 tier），顺序其实无所谓，
     但 D 需要额外节点，放在前面失败时不影响 U。 */
  function injectU() {
    var cards = document.querySelectorAll(CARD_SEL);
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      var h = card.querySelector('h3, h2');
      if (!h) continue;
      var name = h.textContent || '';
      if (!nameHit(name, U_BRANDS)) continue;                 // 名字预筛：只深查命中的卡
      card.setAttribute(TIER_ATTR, 'U');
      if (card.querySelector('[' + UB + ']')) continue;        // 已注入
      if (hasTierBadge(card)) continue;                        // 已有正档位徽标，不动
      var info = h.parentElement;                              // 品牌信息块
      var head = info && info.parentElement;                   // 头部容器
      if (!head) continue;
      head.appendChild(makeBadge());
    }
  }

  function injectD() {
    var cards = document.querySelectorAll(CARD_SEL);
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      var h = card.querySelector('h3, h2');
      if (!h) continue;
      var name = h.textContent || '';
      if (!nameHit(name, D_BRANDS)) continue;
      card.setAttribute(TIER_ATTR, 'D');                       // stat-filter 靠这个认档，不等徽标
      if (card.querySelector('[' + DB + ']')) continue;
      if (hasTierBadge(card)) continue;
      var info = h.parentElement;
      var head = info && info.parentElement;
      if (!head) continue;
      head.appendChild(makeDBadge());
      /* 备注条的位置：必须插在**卡片正文块**里、紧跟头部行之后。
       *
       * 2026-11-02 踩坑：最初写成「插到 head.parentElement 里 head 之后」，
       * 结果落进了头部那行 `flex items-start justify-between` —— 备注变成第 3 个
       * flex 子项，被挤成 49.5px 宽、1091px 高，整张卡被撑成一片空白（截图才发现）。
       * 正确做法：从徽标所在节点往上走到「正文块的直接子节点」，再插在它后面。
       */
      var body = card.firstElementChild;                 // React 渲染的 div.p-5 正文块
      var row = head;
      while (row && row.parentElement && row.parentElement !== body) row = row.parentElement;
      var note = makeDCardNote();
      if (body && row && row.parentElement === body) {
        body.insertBefore(note, row.nextSibling);
      } else if (body) {
        body.appendChild(note);                          // 结构变了：退化为塞在正文块末尾
      } else {
        card.appendChild(note);
      }
    }
  }

  /* 顶部四格只统计 S/A/B/C（D 计入「避雷预警」格，U 不计）。
     不给出口的话「收录品牌 172」会和四格合计对不上，读者会以为算错。 */
  function findStatLabel(text) {
    var divs = document.querySelectorAll('div');
    for (var i = 0; i < divs.length; i++) {
      var el = divs[i];
      if (el.childNodes.length !== 1) continue;
      if ((el.textContent || '').trim() === text) return el;
    }
    return null;
  }

  function injectStatNote() {
    if (document.getElementById(NOTE_ID)) return;
    var label = findStatLabel('避雷预警');
    if (!label) return;
    var grid = label.closest ? label.closest('div.grid') : null;
    if (!grid || !grid.parentElement) return;
    var n = document.querySelectorAll(CARD_SEL + ' [' + UB + ']').length;
    if (!n) return;
    var p = document.createElement('div');
    p.id = NOTE_ID;
    p.setAttribute('style', 'margin-top:6px;font-size:11px;line-height:1.5;color:#94a3b8;text-align:center');
    p.textContent = '四格统计 S/A/B/C（D 级已计入避雷预警格）；另有 ' + n
      + ' 家已尽合理检索仍无证据，标为 U级 · 证据不足（不计入上表）';
    grid.parentElement.insertBefore(p, grid.nextSibling);
  }

  /* D 级出口：它**计入**避雷预警格（D 是 C 的加重版，不是另一类），
     所以这里不写「不计入」，只说明格内成分与人工干预事实。 */
  function injectDStatNote() {
    if (document.getElementById(DNOTE_ID)) return;
    var label = findStatLabel('避雷预警');
    if (!label) return;
    var grid = label.closest ? label.closest('div.grid') : null;
    if (!grid || !grid.parentElement) return;
    var n = document.querySelectorAll(CARD_SEL + ' [' + DB + ']').length;
    if (!n) return;
    var p = document.createElement('div');
    p.id = DNOTE_ID;
    p.setAttribute('style', 'margin-top:4px;font-size:11px;line-height:1.5;color:#991b1b;text-align:center');
    p.textContent = '其中 ' + n + ' 家为 D 级 · 站长强制降级（管理层指令性规避法律风险加班，'
      + '已计入上表避雷预警；该档位不由 AI 判定）';
    var uNote = document.getElementById(NOTE_ID);
    grid.parentElement.insertBefore(p, uNote ? uNote.nextSibling : grid.nextSibling);
  }

  function scan() {
    try { injectD(); } catch (e) { warn(e); }
    try { injectU(); } catch (e) { warn(e); }
    try { injectStatNote(); } catch (e) { warn(e); }
    try { injectDStatNote(); } catch (e) { warn(e); }
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
