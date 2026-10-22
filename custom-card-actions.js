/* ==========================================================================
   custom-card-actions.js
   --------------------------------------------------------------------------
   解决两件事：
   1) 首页顶部「打卡并生成小票」按钮 → 改成弹窗，引导用户去下方品牌档案卡打卡
   2) 自定义品牌卡片（DOM 克隆出来的）的「打卡」「详情证据」按钮补上功能
      —— 克隆节点没有 React 的 onClick，所以点了没反应

   为什么不用 F12 临时改：刷新即丢，必须落盘到这个文件里。

   拦截原理：React 的事件是委托在 #root 上的（在冒泡阶段），
   所以在 document 上用「捕获阶段」监听 + stopPropagation，
   就能在事件到达 #root 之前把它拦下来，React 的原处理函数不会执行。
   ========================================================================== */
(function () {
  'use strict';

  /* 本站实际可访问的「数据查验」网址。上游模板写死的上游域名已死
     （2026-10-09 实测无法访问，projects.html 同源记录），不能再往小票上印死链。 */
  var SXG_SITE_URL = 'dujeongil-galaxy.github.io/shuangxiugou';
  /* 条形码下的域名水印（内置卡印的是上游死链大写形式，DOM 层改写为本站） */
  var BUILTIN_CAPTION = 'SHUANGXIUGOU.VERCEL.APP';
  var SXG_CAPTION = 'DUJEONGIL-GALAXY.GITHUB.IO/SHUANGXIUGOU';

  /* lucide 图标（内置卡按钮同款 path，行内 SVG，不依赖 React 组件） */
  var ICON_COPY = '<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';
  var ICON_CHECK_GREEN = '<svg class="w-3.5 h-3.5 text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
  var ICON_DOWNLOAD = '<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/></svg>';
  var ICON_SPARKLES = '<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/></svg>';

  /* ---------------------------------------------------------------- 工具 */

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }

  /* ---------------------------------------------------------------- 样式注入
     不能依赖主CSS 里的 Tailwind 类：那份 CSS 是构建时按源码实际用到的类
     生成的（`hover:bg-white/20`、`bg-slate-950/70`、`max-h-[85vh]` 等都没被输出），
     直接套用会没有样式。所以这里自带一份样式，用 sxg- 前缀避免冲突。
     receipt-tear-top / receipt-tear-bottom 复用主CSS 里已存在的锯齿边。 */

  var STYLE_ID = 'sxg-custom-card-styles';
  if (!document.getElementById(STYLE_ID)) {
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '.sxg-layer{position:fixed;inset:0;z-index:9999;background:rgba(2,6,23,.72);',
      'backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);display:flex;',
      'align-items:center;justify-content:center;padding:16px;overflow-y:auto}',
      '.sxg-box{background:#fff;border:1px solid #e2e8f0;border-radius:16px;max-width:448px;',
      'width:100%;box-shadow:0 25px 50px -12px rgba(0,0,0,.35)}',
      '.sxg-box-lg{max-width:512px;max-height:85vh;overflow-y:auto}',
      '.sxg-pad{padding:24px}',
      '.sxg-pad-sm{padding:16px}',
      '.sxg-space>*+*{margin-top:16px}',
      '.sxg-row{display:flex;align-items:center;gap:8px}',
      '.sxg-row-between{display:flex;align-items:center;justify-content:space-between}',
      '.sxg-row-top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}',
      '.sxg-h2{margin:0;font-size:20px;font-weight:900;color:#0f172a;line-height:1.4}',
      '.sxg-h3{margin:0;font-size:16px;font-weight:900;color:#0f172a;line-height:1.5}',
      '.sxg-sub{margin:2px 0 0;font-size:12px;color:#64748b}',
      '.sxg-p{margin:0;font-size:12px;line-height:1.7;color:#475569}',
      '.sxg-p-tight{margin:0;font-size:12px;line-height:1.6;color:#64748b}',
      '.sxg-xs{font-size:11px;line-height:1.7;color:#94a3b8}',
      '.sxg-title-sm{font-size:12px;font-weight:700;color:#1e293b}',
      '.sxg-mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}',
      '.sxg-bold{font-weight:700;color:#0f172a}',
      '.sxg-accent{color:#059669}',
      '.sxg-panel{background:#f8fafc;border:1px solid #f1f5f9;border-radius:12px;padding:14px}',
      '.sxg-panel-dark{background:#0f172a;color:#fff;border-radius:16px;padding:16px}',
      /* 投票弹窗（与内置弹窗视觉对齐：深色头部 / 药丸选项 / 墨绿主按钮） */
      '.sxg-vote-head{background:#0f172a;color:#fff;border-radius:14px 14px 0 0;padding:20px 22px 16px}',
      '.sxg-vote-head .sxg-h2{color:#fff}',
      '.sxg-vote-head .sxg-sub{color:#94a3b8}',
      '.sxg-vote-head [data-vote-close]{background:rgba(255,255,255,.12);color:#fff;border:0;border-radius:10px;width:32px;height:32px;font-size:15px;cursor:pointer;flex:none}',
      '.sxg-vote-head [data-vote-close]:hover{background:rgba(255,255,255,.22)}',
      '.sxg-vote-body{border-radius:0 0 14px 14px;background:#fff}',
      '.sxg-pill{display:inline-flex;align-items:center;padding:7px 12px;border-radius:10px;border:1px solid #e2e8f0;background:#fff;color:#334155;font-size:12px;font-weight:600;cursor:pointer;transition:all .15s}',
      '.sxg-pill:hover{border-color:#10b981;color:#059669}',
      '.sxg-pill input{position:absolute;opacity:0;pointer-events:none}',
      '.sxg-pill input:checked + span{color:#059669}',
      '.sxg-pill:has(input:checked){background:#ecfdf5;border-color:#10b981;color:#047857}',
      '.sxg-vote-note{background:#f8fafc;border-radius:10px;padding:10px 12px;font-size:11px;color:#64748b}',
      '.sxg-dark-label{font-size:12px;font-weight:700;color:#34d399;display:flex;',
      'align-items:center;gap:6px}',
      '.sxg-grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;text-align:center;',
      'font-size:12px;margin-top:12px}',
      '.sxg-grid3>div{background:rgba(30,41,59,.8);border-radius:12px;padding:8px}',
      '.sxg-grid3 .k{font-size:10px;color:#94a3b8}',
      '.sxg-grid3 .v{font-family:ui-monospace,monospace;font-weight:700;font-size:14px;margin-top:2px}',
      '.sxg-badge{display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:8px;',
      'font-size:12px;font-weight:900;letter-spacing:.02em;text-transform:uppercase}',
      '.sxg-badge-bad{background:#fef2f2;color:#b91c1c;border:2px solid #f87171}',
      '.sxg-badge-good{background:#ecfdf5;color:#065f46;border:2px solid #10b981}',
      '.sxg-chip{background:#f1f5f9;color:#475569;border-radius:6px;padding:2px 8px;font-size:12px}',
      '.sxg-note{background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:14px;',
      'font-size:12px;line-height:1.7;color:#78350f}',
      '.sxg-note-green{background:#ecfdf5;border:1px solid #a7f3d0;border-radius:12px;padding:14px;',
      'font-size:12px;line-height:1.7;color:#065f46}',
      '.sxg-actions{display:flex;gap:8px;padding-top:4px}',
      '.sxg-actions.right{justify-content:flex-end}',
      '.sxg-btn{flex:1;padding:10px 16px;border:0;border-radius:12px;font-size:14px;',
      'font-weight:700;cursor:pointer;transition:background .15s}',
      '.sxg-btn-primary{background:#059669;color:#fff}',
      '.sxg-btn-primary:hover{background:#10b981}',
      '.sxg-btn-dark{background:rgba(255,255,255,.12);color:#fff}',
      '.sxg-btn-dark:hover{background:rgba(255,255,255,.22)}',
      '.sxg-btn-ghost{background:#f1f5f9;color:#334155}',
      '.sxg-btn-ghost:hover{background:#e2e8f0}',
      '.sxg-btn-sm{font-size:12px;padding:10px 16px}',
      '.sxg-close{width:28px;height:28px;border:0;border-radius:999px;background:rgba(255,255,255,.12);',
      'color:#fff;font-size:12px;font-weight:700;cursor:pointer;flex:none}',
      '.sxg-close:hover{background:rgba(255,255,255,.22)}',
      '.sxg-receipt-wrap{max-width:384px;width:100%;margin:auto}',
      '.sxg-receipt-head{display:flex;align-items:center;justify-content:space-between;',
      'padding:0 4px;color:rgba(255,255,255,.85)}',
      '.sxg-receipt-head .lbl{display:flex;align-items:center;gap:6px;font-size:12px;',
      'font-weight:600;letter-spacing:.06em;color:#34d399}',
      '.sxg-dashed{border-bottom:1px dashed #d6d3d1}',
      '.sxg-stamp{position:absolute;right:16px;top:80px;pointer-events:none;opacity:.85;',
      'transform:rotate(-14deg);border:2px solid;border-radius:8px;padding:4px 10px;',
      'font-size:11px;font-weight:900;letter-spacing:.12em;text-transform:uppercase}',
      '.sxg-stamp-bad{border-color:#e11d48;color:#e11d48}',
      '.sxg-stamp-good{border-color:#059669;color:#059669}',
      '.sxg-kv{display:flex;justify-content:space-between;align-items:flex-start;gap:8px;',
      'font-size:12px;padding:4px 0}',
      '.sxg-kv .k{color:#64748b;white-space:nowrap;flex:none}',
      '.sxg-kv .v{font-weight:700;color:#0f172a;text-align:right;overflow:hidden;',
      'text-overflow:ellipsis;white-space:nowrap;max-width:190px}',
      '.sxg-vote-off{opacity:.45;cursor:not-allowed}',
      /* 点赞/点踩按下后的反馈（本地记录态） */
      '.sxg-thumb-on{outline:2px solid #10b981;outline-offset:1px;border-radius:8px}',
      /* 访客填写区 */
      '.sxg-form{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);',
      'border-radius:12px;padding:14px;margin-bottom:4px}',
      '.sxg-form-title{font-size:12px;font-weight:700;color:#fff;margin-bottom:10px}',
      '.sxg-field{margin-bottom:10px}',
      '.sxg-field:last-of-type{margin-bottom:0}',
      '.sxg-field label{display:block;font-size:11px;color:rgba(255,255,255,.72);margin-bottom:4px}',
      '.sxg-field input{width:100%;padding:8px 10px;font-size:13px;font-family:inherit;',
      'color:#0f172a;background:#fff;border:1px solid #cbd5e1;border-radius:8px;outline:none}',
      '.sxg-field input:focus{border-color:#10b981;box-shadow:0 0 0 3px rgba(16,185,129,.2)}',
      // 「本次新增」输入框 + 右侧累计，窄屏也不会挤成两行
      '.sxg-amount-row{display:flex;align-items:center;gap:8px}',
      '.sxg-amount-row input{flex:1;min-width:0}',
      '.sxg-total{flex-shrink:0;font-size:12px;color:rgba(255,255,255,.72);white-space:nowrap}',
      '.sxg-total b{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:14px;',
      'font-weight:800;color:#34d399}',
      '.sxg-total-2{display:flex;flex-direction:column;align-items:flex-end;gap:2px;line-height:1.35}',
      '.sxg-total-2 .sxg-total-line{font-size:11px;white-space:nowrap;max-width:150px;',
      'overflow:hidden;text-overflow:ellipsis}',
      '.sxg-total-2 b{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;',
      'font-weight:800;color:#34d399}',
      '.sxg-btn-clear{flex:none;padding:7px 10px;border:1px solid #fecaca;background:#fff;color:#b91c1c;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer}',
      '.sxg-btn-clear:hover{background:#fef2f2}',
      '.sxg-form-tip{font-size:11px;color:rgba(255,255,255,.6);line-height:1.6;margin-top:10px}',
      /* 每张品牌卡底部的一行「数据只在本地」说明（2026-10-19 站长要求全站卡片都加）。
         px-5 是 20px，左右用同值 padding 才能和上方按钮条对齐。 */
      '.sxg-localnote{display:flex;align-items:flex-start;gap:6px;',
      'margin:8px 0 0;padding:8px 20px 0;border-top:1px dashed #e2e8f0;',
      'font-size:11px;line-height:1.65;color:#94a3b8}',
      '.sxg-localnote b{color:#b45309;font-weight:700}'
    ].join('');
    document.head.appendChild(style);
  }

  // 从按钮/元素里按文字找（React 把文案放在 span 里，不能只看自身 textContent）
  function findByText(container, text) {
    var all = $$('button, a', container);
    for (var i = 0; i < all.length; i++) {
      if ((all[i].textContent || '').indexOf(text) !== -1) return all[i];
    }
    return null;
  }

  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  /* ------------------------------------------------- 自定义卡片配置（读取） */

  function getConfig() {
    // index.html 里的 customCardsConfig 是顶层 var，会挂到 window 上
    var cfg = window.customCardsConfig;
    if (cfg && cfg.length) return cfg;

    //兜底：配置读不到时，从卡片 DOM 反推基本信息，保证按钮仍可用
    var ids = ['snack-card', 'chabaidao-card'];
    return ids.map(function (id) {
      var card = document.getElementById(id);
      if (!card) return null;
      var title = card.querySelector('h2') || card.querySelector('h3');
      return {
        id: id,
        name: title ? title.textContent : id,
        company: (card.querySelectorAll('p')[0] || {}).textContent || '',
        grade: 'C级'
      };
    }).filter(Boolean);
  }

  function tierLetter(grade) {
    var m = /([SABC])/.exec(grade || '');
    return m ? m[1] : 'C';
  }

  /* --------------------------------------------------------- 弹窗：通用壳 */

  var openLayer = null;

  function closeLayer() {
    if (openLayer && openLayer.parentNode) openLayer.parentNode.removeChild(openLayer);
    openLayer = null;
    document.body.style.overflow = '';
  }

  function ensureLayer() {
    if (openLayer) return openLayer;
    var layer = el('div', 'sxg-layer');
    layer.addEventListener('click', function (ev) {
      if (ev.target === layer) closeLayer();
    });
    document.body.appendChild(layer);
    document.body.style.overflow = 'hidden';
    openLayer = layer;
    return layer;
  }

  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') closeLayer();
  });

  /* ------------------------------------- 清空累计：二次确认（2026-10-17）
     站长要求：累计金额旁加「清空」，点击必须弹出提示告知
     「一经删除则不可恢复，是否确认」。用独立于 openLayer 的第二层，
     叠在小票层之上；确认后只清金额，保留昵称与理由。 */
  function openClearConfirm(onConfirm) {
    var layer = el('div', 'sxg-layer');
    layer.style.zIndex = '10002'; // 盖住小票层（9999）与广告 toast（10001）
    layer.addEventListener('click', function (ev) {
      if (ev.target === layer && layer.parentNode) layer.parentNode.removeChild(layer);
    });
    var box = el('div', 'sxg-box');
    box.style.maxWidth = '360px';
    box.innerHTML =
      '<div class="sxg-pad">' +
        '<h3 class="sxg-h3">清空累计金额？</h3>' +
        '<p class="sxg-p" style="margin-top:8px">「累计已转移/支持消费」将清为零。' +
        '<strong>一经删除则不可恢复</strong>（昵称与理由会保留），是否确认？</p>' +
        '<div class="sxg-actions right" style="padding-top:14px">' +
          '<button type="button" class="sxg-btn sxg-btn-ghost sxg-btn-sm" data-sxg-clear-cancel>取消</button>' +
          '<button type="button" class="sxg-btn sxg-btn-primary sxg-btn-sm" data-sxg-clear-ok>确认清空</button>' +
        '</div>' +
      '</div>';
    layer.appendChild(box);
    document.body.appendChild(layer);
    layer.querySelector('[data-sxg-clear-cancel]').addEventListener('click', function () {
      if (layer.parentNode) layer.parentNode.removeChild(layer);
    });
    layer.querySelector('[data-sxg-clear-ok]').addEventListener('click', function () {
      if (layer.parentNode) layer.parentNode.removeChild(layer);
      onConfirm();
    });
  }

  /* ------------------------------------------------- 访客档案（仅存本地浏览器）
     隐私边界：只写 localStorage，不发任何网络请求，不上传服务器。
     清缓存 / 换浏览器 / 无痕窗口都会丢，这是刻意的 —— 站点不留档。 */

  var PROFILE_KEY = 'sxg-visitor-profile';

  // 累计金额上限。防止手滑或脚本错误累加出一个天文数字，
  // 也防止存进 localStorage 的数值大到破坏布局。
  var MAX_TOTAL = 99999999;

  // 金额统一保留两位小数（2026-10-22 站长截图要求：
  // 「金额也只能整数，不支持小数点后两位吗？」—— 以前 parseInt 会把
  // 10.5 截成 10、0.5 直接归零，用户输小数像被无视）。
  // 浮点二进制表示有误差（0.1+0.2=0.30000000000000004），
  // 先放大 100 倍取整再除回，才是真正的「两位小数」。
  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  // 展示格式：两位小数。整数也显示成 ￥10.00，与真实消费凭据一致；
  // 旧数据（localStorage 里存的整数）经此格式化后视觉统一。
  function fmtMoney(n) {
    return round2(n).toFixed(2);
  }

  function defaultProfile() {
    // total = 历史累计，lastDelta = 上次填的「本次新增」，reason = 上次理由
    return { name: '', total: 0, lastDelta: 0, reason: '' };
  }

  // 旧版本存的是 { name, amount, reason }，amount 是单次值。
  // 首次读到旧结构时，把那个 amount 当作「历史累计」迁移过来，
  // 否则老用户升级后累计金额会凭空归零 —— 那是会让人察觉的丢数据。
  function migrateLegacy(p) {
    if (typeof p.total === 'number' && isFinite(p.total)) return p;
    if (typeof p.amount === 'number' && isFinite(p.amount) && p.amount > 0) {
      return {
        name: p.name,
        total: Math.min(round2(p.amount), MAX_TOTAL),
        lastDelta: 0,
        reason: p.reason
      };
    }
    return p;
  }

  function loadProfile() {
    var base = defaultProfile();
    try {
      var raw = window.localStorage.getItem(PROFILE_KEY);
      if (!raw) return base;
      var p = migrateLegacy(JSON.parse(raw) || {});
      return {
        name: typeof p.name === 'string' ? p.name.slice(0, 40) : base.name,
        total: clampTotal(p.total),
        lastDelta: typeof p.lastDelta === 'number' && p.lastDelta > 0
          ? Math.min(round2(p.lastDelta), MAX_TOTAL)
          : base.lastDelta,
        reason: typeof p.reason === 'string' ? p.reason.slice(0, 120) : base.reason
      };
    } catch (e) {
      return base;
    }
  }

  function saveProfile(p) {
    try {
      window.localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
    } catch (e) {
      // 隐私模式 / 存储已满：本次会话仍可用，只是不跨刷新
      diag('访客档案保存失败（可能处于无痕模式）：' + e);
    }
  }

  // 累计值只允许非负、最多两位小数，上限封顶
  function clampTotal(v) {
    var n = parseFloat(v);
    if (isNaN(n) || n < 0) return 0;
    return Math.min(round2(n), MAX_TOTAL);
  }

  /* 分品牌累计（2026-10-18 站长）：「累计」拆两级显示——
     第一行 = 本品牌累计（标签不再带企业名：企业名一长会被累计 chip 的
     max-width:150px + ellipsis 截断，行尾金额正好看不见，2026-10-18 精简）；
     第二行 = 全站累计（本站所有品牌金额加总 = profile.total）。
     brandTotals 以「考核品牌」名称为键，仍只存本浏览器、不上传。 */
  var BRAND_TOTALS_KEY = 'sxg-brand-totals-v1';

  function loadBrandTotals() {
    try {
      var raw = window.localStorage.getItem(BRAND_TOTALS_KEY);
      var o = raw ? JSON.parse(raw) : null;
      var out = {};
      if (o && typeof o === 'object') {
        for (var k in o) {
          if (Object.prototype.hasOwnProperty.call(o, k)
            && typeof o[k] === 'number' && isFinite(o[k]) && o[k] > 0) {
            out[k] = Math.min(round2(o[k]), MAX_TOTAL);
          }
        }
      }
      return out;
    } catch (e) { return {}; }
  }

  function saveBrandTotals(map) {
    try {
      window.localStorage.setItem(BRAND_TOTALS_KEY, JSON.stringify(map || {}));
    } catch (e) { diag('分品牌累计保存失败（可能处于无痕模式）'); }
  }

  function brandKeyOf(name) {
    var s = String(name || '').replace(/\s+/g, ' ').trim();
    return s ? s.slice(0, 60) : '当前品牌';
  }

  // 本次新增额：允许留空（= 不增加），非正数按 0 处理而不是回退到 199 ——
  // 用户既然留空了就是想不加，凭什么替他加 199。
  // 2026-10-22：parseInt → parseFloat + 两位小数，支持「小数点后两位」。
  function clampDelta(v) {
    var s = String(v == null ? '' : v).trim();
    if (!s) return 0;
    var n = parseFloat(s);
    if (isNaN(n) || n <= 0) return 0;
    return Math.min(round2(n), MAX_TOTAL);
  }

  // 没填昵称时给个匿名编号，跟内置小票的观感一致
  // 没填昵称时给个匿名编号，跟内置小票的观感一致。
  // stableId（2026-10-17 修复「#号一直滚动」）：同一次弹窗内必须稳定 ——
  // 以前每次重绘都重新随机，MutationObserver 触发 syncBuiltin 时
  // 「随机值 ≠ 现值」恒成立 → 每次都写 DOM → 再次触发 observer → 自激循环。
  function displayName(name, stableId) {
    var s = (name || '').trim();
    if (s) return s;
    var id = (typeof stableId === 'number' && stableId >= 1000)
      ? stableId
      : Math.floor(1000 + Math.random() * 9000);
    return '匿名打工人 #' + id;
  }

  // 按需加载 vendored html-to-image（UMD 构建，挂在 window.htmlToImage）。
  // 只有自定义卡点「保存高清图」时才注入 <script>，平时零开销。
  // 内置卡的保存高清图由 bundle 自带实现，不走这里。
  // 路径必须相对：站点部署在 github.io 子路径 /shuangxiugou/ 下，绝对根路径会 404。
  function loadHtmlToImage(cb) {
    if (window.htmlToImage) return cb(true);
    var s = document.createElement('script');
    s.src = 'vendor/html-to-image.js';
    s.onload = function () { cb(!!window.htmlToImage); };
    s.onerror = function () { cb(false); };
    document.head.appendChild(s);
  }

  // 自定义卡与内置卡共用的填写区，避免两处 UI 走样
  function buildProfileForm(profile, brandKey, brandBase) {
    var brandBase0 = (typeof brandBase === 'number' && brandBase > 0) ? brandBase : 0;
    var form = el('div', 'sxg-form');
    form.innerHTML =
      '<div class="sxg-form-title">这张小票要署名，填一次就记住了</div>' +

      '<div class="sxg-field">' +
        '<label for="sxg-f-name">你的称呼（可留空，默认匿名）</label>' +
        '<input id="sxg-f-name" type="text" maxlength="40" ' +
          'placeholder="例如：清醒打工人 / 匿名打工人 #1234" ' +
          'value="' + esc(profile.name) + '" />' +
      '</div>' +

      '<div class="sxg-field">' +
        '<label for="sxg-f-amount">本次新增消费（元）</label>' +
        '<div class="sxg-amount-row">' +
          // step=0.01：不设的话浏览器默认 step=1，输 10.5 会被判 invalid，
          //  spinner 也不让往下调到小数（2026-10-22 站长截图：金额只能整数）。
          //  inputmode=decimal 配合移动端弹出带小数点的键盘。
          '<input id="sxg-f-amount" type="number" inputmode="decimal" min="0" step="0.01" ' +
            'max="' + MAX_TOTAL + '" placeholder="留空则不增加" />' +
          '<span class="sxg-total sxg-total-2">' +
            '<span class="sxg-total-line">本品牌累计 <b id="sxg-total-brand">￥' + fmtMoney(brandBase0) + '</b></span>' +
            '<span class="sxg-total-line">全站累计 <b id="sxg-total">￥0.00</b></span>' +
          '</span>' +
          '<button type="button" id="sxg-f-clear" class="sxg-btn-clear">清空</button>' +
        '</div>' +
      '</div>' +

      '<div class="sxg-field">' +
        '<label for="sxg-f-reason">理由（可留空）</label>' +
        '<input id="sxg-f-reason" type="text" maxlength="120" ' +
          'placeholder="例如：双休落实不错 / 门店单休太频繁" ' +
          'value="' + esc(profile.reason) + '" />' +
      '</div>' +

      '<div class="sxg-form-tip">' +
        '累计金额与昵称只存在你自己的浏览器里，不上传服务器；清缓存即消失。' +
      '</div>';
    return form;
  }

  /* ----------------------------------------------- 弹窗 1：打卡小票（对齐内置 jn） */

  function openTicketModal(cfg) {
    closeLayer();
    var layer = ensureLayer();

    var tier = tierLetter(cfg.grade);
    var isC = tier === 'C';
    var code = 'WLB-' + String(Date.now()).slice(-8);
    var today = new Date().toLocaleDateString('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit'
    });

    var profile = loadProfile();

    // 分品牌累计：本品牌 = brandTotals[当前卡片企业名]
    var brandKey = brandKeyOf(cfg.name);
    var brandBase = loadBrandTotals()[brandKey] || 0;

    var anonId = Math.floor(1000 + Math.random() * 9000); // 本次弹窗内稳定
    var wrap = el('div', 'sxg-receipt-wrap');
    wrap.style.padding = '16px 0';

    // 顶部条
    var head = el('div', 'sxg-receipt-head');
    head.innerHTML =
      '<div class="lbl"><span aria-hidden="true">&#10003;</span>打工人反向考核凭据</div>';
    var closeBtn = el('button', 'sxg-close', '&#10005;');
    closeBtn.setAttribute('aria-label', '关闭');
    closeBtn.addEventListener('click', closeLayer);
    head.appendChild(closeBtn);
    wrap.appendChild(head);

    /* ---- 填写区：昵称 / 金额 / 理由，填完实时反映到小票上 ---- */
    var form = buildProfileForm(profile, brandKey, brandBase);
    wrap.appendChild(form);

    var fName = $('#sxg-f-name', form);
    var fAmount = $('#sxg-f-amount', form);
    var fReason = $('#sxg-f-reason', form);
    var fTotal = $('#sxg-total', form);
    var fTotalBrand = $('#sxg-total-brand', form);

    // baseTotal 是「打开这个弹窗那一刻」的累计值，是个常量。
    //
    // 为什么必须是常量而不是每次读 profile.total：
    // 如果直接累加，用户只是「打开弹窗看了一眼」就把钱算进去了；
    // 关掉重开一次会加一次，来回几次金额就离谱了。
    // 正确语义是：只有在明确点「复制小票文本」时才结算本次新增。
    var baseTotal = profile.total;

    // 预览态累计 = 打开时的累计 + 本次已填的新增（尚未落盘）
    function previewTotal() {
      return Math.min(baseTotal + clampDelta(fAmount.value), MAX_TOTAL);
    }

    function currentProfile() {
      return {
        name: (fName.value || '').trim(),
        total: baseTotal,
        lastDelta: clampDelta(fAmount.value),
        reason: (fReason.value || '').trim()
      };
    }

    function refreshPreview() {
      var p = currentProfile();
      var shown = previewTotal();
      var nameEl = $('#sxg-t-name', receipt);
      var amountEl = $('#sxg-t-amount', receipt);
      if (nameEl) nameEl.textContent = displayName(p.name, anonId);
      if (amountEl) amountEl.textContent = '￥' + fmtMoney(shown);
      var brandShown = Math.min(brandBase + clampDelta(fAmount.value), MAX_TOTAL);
      if (fTotalBrand) fTotalBrand.textContent = '￥' + fmtMoney(brandShown);
      var brandEl = $('#sxg-t-amount-brand', receipt);
      if (brandEl) brandEl.textContent = '￥' + fmtMoney(brandShown);
      if (fTotal) fTotal.textContent = '￥' + fmtMoney(shown);
      // 理由是后加的一行，实时输入时需要补出来。
      // 锚点是评级行（data-sxg-rating-row），与内置卡 paintBuiltinReason 同位。
      var reasonKv = receipt.querySelector('[data-sxg-reason]');
      if (p.reason) {
        if (!reasonKv) {
          var anchor = receipt.querySelector('[data-sxg-rating-row]');
          if (anchor && anchor.parentNode) {
            reasonKv = el('div', 'flex justify-between items-start gap-2');
            reasonKv.setAttribute('data-sxg-reason', '1');
            reasonKv.innerHTML =
              '<span class="text-slate-500 whitespace-nowrap">理由:</span>' +
              '<span class="v font-bold text-slate-900 text-right truncate max-w-[180px]"></span>';
            anchor.parentNode.insertBefore(reasonKv, anchor.nextSibling);
          }
        }
        if (reasonKv) reasonKv.querySelector('.v').textContent = p.reason;
      } else if (reasonKv && reasonKv.parentNode) {
        reasonKv.parentNode.removeChild(reasonKv);
      }
      return { profile: p, shown: shown };
    }

    [fName, fAmount, fReason].forEach(function (input) {
      input.addEventListener('input', refreshPreview);
    });

    // 清空累计（2026-10-17）：二次确认后才清零，只清金额，保留昵称与理由
    var clearBtn = $('#sxg-f-clear', form);
    if (clearBtn) clearBtn.addEventListener('click', function () {
      openClearConfirm(function () {
        var p2 = loadProfile();
        saveProfile({ name: p2.name, total: 0, lastDelta: 0, reason: p2.reason });
        saveBrandTotals({});
        baseTotal = 0;
        brandBase = 0;
        fAmount.value = '';
        if (fTotal) fTotal.textContent = '￥0.00';
        if (fTotalBrand) fTotalBrand.textContent = '￥0.00';
        var amountEl = $('#sxg-t-amount', receipt);
        if (amountEl) amountEl.textContent = '￥0.00';
        var brandEl = $('#sxg-t-amount-brand', receipt);
        if (brandEl) brandEl.textContent = '￥0.00';
      });
    });

    // 小票主体：类名逐条照抄内置卡的 receipt JSX（bundle 307795 起），
    // 保证两种卡的小票肉眼无差 —— 2026-10-23 站长要求统一。
    var receipt = el('div', 'receipt-tear-top receipt-tear-bottom bg-[#faf8f5] text-slate-900 ' +
      'p-6 shadow-2xl border-x border-[#ebe5dc] relative font-mono select-none overflow-hidden');
    receipt.style.backgroundImage = 'radial-gradient(rgba(0,0,0,0.02) 1px, transparent 0)';
    receipt.style.backgroundSize = '8px 8px';

    // 印章（右上角斜置）
    var stampHtml = isC
      ? '<div class="border-2 border-rose-600 text-rose-600 rounded-lg px-2.5 py-1 text-[11px] font-black tracking-widest uppercase shadow-sm">违规避雷</div>'
      : '<div class="border-2 border-emerald-600 text-emerald-600 rounded-lg px-2.5 py-1 text-[11px] font-black tracking-widest uppercase shadow-sm">良心认证</div>';

    // 评级徽章配色：与内置卡同款映射（S/A/B/U/其余）
    var badgeCls = tier === 'S' ? 'bg-emerald-100 text-emerald-800'
      : tier === 'A' ? 'bg-green-100 text-green-800'
      : tier === 'B' ? 'bg-amber-100 text-amber-800'
      : tier === 'U' ? 'bg-slate-100 text-slate-500'
      : 'bg-rose-100 text-rose-800';

    // 条形码：与内置卡同一组固定条纹
    var BARS = [2, 1, 3, 1, 2, 4, 1, 3, 2, 1, 4, 1, 2, 3, 1, 2, 1, 3, 4, 1, 2, 3, 1];
    var barsHtml = '';
    for (var bi = 0; bi < BARS.length; bi++) {
      barsHtml += '<div class="bg-slate-800 h-full" style="width:' + (BARS[bi] * 1.5) + 'px"></div>';
    }

    receipt.innerHTML =
      '<div class="absolute right-4 top-20 pointer-events-none opacity-85 rotate-[-14deg]">' +
        stampHtml +
      '</div>' +

      '<div class="text-center pb-4 border-b border-dashed border-slate-300 space-y-1">' +
        '<div class="text-base font-black tracking-tighter text-slate-950">★ 双休购 · 反向考核小票 ★</div>' +
        '<div class="text-[10px] text-slate-500 tracking-tight">SHUANGXIUGOU CONSUMER AUDIT RECEIPT</div>' +
        '<div class="text-[10px] text-slate-400 font-mono pt-1">NO. ' + code + ' · ' + today + '</div>' +
      '</div>' +

      '<div class="py-4 border-b border-dashed border-slate-300 space-y-2 text-xs">' +
        '<div class="flex justify-between items-start">' +
          '<span class="text-slate-500">考核执行官:</span>' +
          '<span class="font-bold text-slate-800" id="sxg-t-name">' +
            esc(displayName(profile.name, anonId)) + '</span>' +
        '</div>' +
        '<div class="flex justify-between items-start gap-2">' +
          '<span class="text-slate-500 whitespace-nowrap">考核品牌:</span>' +
          '<span class="font-bold text-slate-900 text-right truncate max-w-[180px]">' + esc(cfg.name) + '</span>' +
        '</div>' +
        '<div class="flex justify-between items-start gap-2">' +
          '<span class="text-slate-500 whitespace-nowrap">所属企业:</span>' +
          '<span class="text-[11px] text-slate-600 text-right truncate max-w-[180px]">' + esc(cfg.company || '—') + '</span>' +
        '</div>' +
        '<div class="flex justify-between items-center pt-1" data-sxg-rating-row="1">' +
          '<span class="text-slate-500">工时健康评级:</span>' +
          '<span class="font-black px-1.5 py-0.5 rounded text-xs ' + badgeCls + '">' +
            esc(cfg.grade || 'C级') + ' · ' + esc(cfg.workPolicy || '—') + '</span>' +
        '</div>' +
        (profile.reason
          ? '<div class="flex justify-between items-start gap-2" data-sxg-reason="1">' +
            '<span class="text-slate-500 whitespace-nowrap">理由:</span>' +
            '<span class="v font-bold text-slate-900 text-right truncate max-w-[180px]">' +
              esc(profile.reason) + '</span>' +
            '</div>'
          : '') +
      '</div>' +

      '<div class="py-4 border-b border-dashed border-slate-300 space-y-2 text-xs">' +
        '<div class="flex justify-between items-baseline">' +
          '<span class="text-slate-600 font-semibold whitespace-nowrap">本品牌累计:</span>' +
          '<span class="font-bold font-mono text-sm text-emerald-700" id="sxg-t-amount-brand">' +
            '￥' + fmtMoney(brandBase) + '</span>' +
        '</div>' +
        '<div class="flex justify-between items-baseline">' +
          '<span class="text-slate-600 font-semibold">全站累计已转移/支持消费:</span>' +
          '<span class="text-xl font-black font-mono ' + (isC ? 'text-rose-600' : 'text-emerald-700') + '" id="sxg-t-amount">' +
            '￥' + fmtMoney(profile.total) + '</span>' +
        '</div>' +
        '<div class="text-[10px] text-slate-500 leading-normal">' +
          (isC
            ? '已从单休/严重违规企业剥离该消费额，并将订单优先转移给合规双休平替。'
            : '用每一次下单，奖励真正实行周末双休、尊重员工休息权的良心品牌。') +
        '</div>' +
      '</div>' +

      '<div class="pt-4 text-center space-y-3">' +
        '<div class="text-[11px] text-slate-700 italic font-medium leading-relaxed px-2">' +
          '“老板考核你的 KPI，<br>你的钱包考核老板的良心。”</div>' +
        '<div class="flex flex-col items-center justify-center pt-1">' +
          '<div class="flex items-center gap-[2px] h-9">' + barsHtml + '</div>' +
          '<div class="text-[9px] text-slate-400 font-mono tracking-widest pt-1">' +
            SXG_CAPTION + '</div>' +
        '</div>' +
        '<div class="text-[10px] text-slate-500 leading-normal px-2">' +
          '本小票为消费立场表达，不构成对任何企业的法律或名誉评价。</div>' +
      '</div>';

    wrap.appendChild(receipt);

    // 操作按钮：与内置卡完全同一套（2026-10-23 站长要求统一）——
    // 类名逐条照抄 bundle 按钮的 className，图标用 lucide 同款行内 SVG。
    // 语义三键一致：复制文本=结算+复制；保存高清图=结算+存PNG；确认打卡=仅结算+关闭。
    var actions = el('div', 'bg-white/95 backdrop-blur-md rounded-2xl p-4 border border-white/20 shadow-xl space-y-3');
    var btnRow = el('div', 'grid grid-cols-2 gap-2 pt-1');

    var copyBtn = el('button', 'py-2.5 px-3 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold transition flex items-center justify-center gap-1.5 shadow-xs');
    copyBtn.type = 'button';
    function paintCopyBtn(copied) {
      copyBtn.innerHTML = copied
        ? ICON_CHECK_GREEN + '<span>已复制</span>'
        : ICON_COPY + '<span>复制文本</span>';
    }
    paintCopyBtn(false);

    var saveBtn = el('button', 'py-2.5 px-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold transition flex items-center justify-center gap-1.5 shadow-md shadow-slate-900/20');
    saveBtn.type = 'button';
    function paintSaveBtn(state) {
      saveBtn.innerHTML = ICON_DOWNLOAD +
        '<span>' + (state === 'busy' ? '生成中...' : '保存高清图') + '</span>';
    }
    paintSaveBtn('idle');

    var doneBtn = el('button', 'w-full py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold transition flex items-center justify-center gap-1.5 shadow-md shadow-emerald-600/20');
    doneBtn.type = 'button';
    doneBtn.innerHTML = ICON_SPARKLES + '<span>确认打卡并计入全网总额</span>';

    // 结算：把「本次新增」并入累计并清空新增额，同一次弹窗里再点不会重复累加。
    //
    // 2026-10-23 站长定稿按钮语义（与内置卡统一后三键同源）：
    //   复制文本               = 结算（记录）+ 复制；
    //   保存高清图             = 结算（记录）+ 下载 PNG；
    //   确认打卡并计入全网总额 = 仅结算（记录本次消费），不碰剪切板。
    // （旧版自定义卡的「完成」只 closeLayer —— 填了金额直接点完成会静默丢账。）
    //
    // ⚠️ 先保存再清空输入框，顺序反了会在赋值前就把 0 存进去。
    function settleReceipt() {
      // 以点击这一刻表单里的内容为准。
      var st = refreshPreview();
      var p = st.profile;
      var shown = st.shown;
      var next = {
        name: p.name,
        total: shown,
        lastDelta: 0,
        reason: p.reason
      };
      saveProfile(next);
      var brandNext = Math.min(brandBase + clampDelta(fAmount.value), MAX_TOTAL);
      var bt = loadBrandTotals();
      bt[brandKey] = brandNext;
      saveBrandTotals(bt);
      brandBase = brandNext;
      baseTotal = shown;          // 让后续预览以此为新基准
      fAmount.value = '';         // 已结算，别让用户误以为还能再加一次
      if (fTotal) fTotal.textContent = '￥' + fmtMoney(baseTotal);
      if (fTotalBrand) fTotalBrand.textContent = '￥' + fmtMoney(brandNext);
      return { name: p.name, reason: p.reason, shown: shown, brandNext: brandNext };
    }

    copyBtn.addEventListener('click', function () {
      var r = settleReceipt();
      var text =
        '【双休购 · 反向考核小票】\n' +
        '凭证编号：' + code + '\n' +
        '考核目标：' + (cfg.name || '') + '\n' +
        '企业评级：' + (cfg.grade || 'C级') + '\n' +
        '考核执行官：' + displayName(r.name, anonId) + '\n' +
        (r.reason ? '理由：' + r.reason + '\n' : '') +
        '本品牌累计：￥' + fmtMoney(r.brandNext) + '\n' +
        '全站累计已转移/支持消费：￥' + fmtMoney(r.shown) + '\n' +
        '“老板考核你的KPI，你的钱包考核老板的良心”\n' +
        '数据查验来自开源双休购：' + SXG_SITE_URL;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () {
          paintCopyBtn(true);
          setTimeout(function () { paintCopyBtn(false); }, 2000);
        }, function () {
          window.prompt('请手动复制以下小票文本：', text);
        });
      } else {
        window.prompt('请手动复制以下小票文本：', text);
      }
    });

    // 保存高清图：与内置卡同款参数（pixelRatio 3 / 底色 #faf8f5）。
    // html-to-image 从 vendor 目录按需加载（~70KB，平时零开销）。
    function captureReceipt() {
      paintSaveBtn('busy');
      saveBtn.disabled = true;
      window.htmlToImage.toPng(receipt, {
        cacheBust: true,
        pixelRatio: 3,
        backgroundColor: '#faf8f5'
      }).then(function (dataUrl) {
        var a = document.createElement('a');
        a.download = '双休购考核小票-' + (cfg.name || '') + '-' + code + '.png';
        a.href = dataUrl;
        a.click();
      }).catch(function () {
        window.alert('生成图片失败，可尝试直接复制小票文本');
      }).then(function () {
        saveBtn.disabled = false;
        paintSaveBtn('idle');
      });
    }
    saveBtn.addEventListener('click', function () {
      settleReceipt();
      if (window.htmlToImage) { captureReceipt(); return; }
      loadHtmlToImage(function (ok) {
        if (ok) { captureReceipt(); return; }
        window.alert('生成图片组件加载失败，可使用「复制文本」');
      });
    });

    doneBtn.addEventListener('click', function () {
      settleReceipt();
      closeLayer();
    });
    btnRow.appendChild(copyBtn);
    btnRow.appendChild(saveBtn);
    actions.appendChild(btnRow);
    actions.appendChild(doneBtn);
    wrap.appendChild(actions);

    layer.appendChild(wrap);

    function kv(k, v) {
      return '<div class="sxg-kv"><span class="k">' + k + '</span>' +
        '<span class="v">' + v + '</span></div>';
    }
  }

  /* ------------------------------------- 弹窗 2：详情证据（对齐内置详情弹窗） */

  function openEvidenceModal(cfg) {
    closeLayer();
    var layer = ensureLayer();

    var box = el('div', 'sxg-box sxg-box-lg');
    var body = el('div', 'sxg-pad sxg-space');

    var tier = tierLetter(cfg.grade);
    var badgeCls = tier === 'C' ? 'sxg-badge sxg-badge-bad' : 'sxg-badge sxg-badge-good';
    var rateCls = tier === 'C' ? 'color:#34d399' : 'color:#34d399';

    body.innerHTML =
      '<div class="sxg-row-top">' +
        '<div>' +
          '<h2 class="sxg-h2">' + esc(cfg.name) + '</h2>' +
          '<p class="sxg-sub">' + esc(cfg.company || '—') + '</p>' +
        '</div>' +
      '</div>' +

      '<div class="sxg-row">' +
        '<span class="' + badgeCls + '">' + esc(cfg.grade || 'C级') + '</span>' +
        '<span class="sxg-chip">' + esc(cfg.category || '未分类') + '</span>' +
      '</div>' +

      '<div class="sxg-panel">' +
        '<div class="sxg-title-sm">制度与背景概要：</div>' +
        '<p class="sxg-p" style="margin-top:6px">' +
          esc(stripQuotes(cfg.desc || '暂无公开摘要。')) + '</p>' +
        (cfg.overtime
          ? '<p class="sxg-p" style="margin-top:6px"><strong>加班实情：</strong>' +
            esc(cfg.overtime) + '</p>'
          : '') +
      '</div>' +

      '<div class="sxg-panel-dark">' +
        '<div class="sxg-dark-label">' +
          '内部员工匿名投票汇总 ( ' + esc(cfg.voteCount || '0') + ' 票 )' +
        '</div>' +
        '<div class="sxg-grid3">' +
          stat('真实双休率', (cfg.doubleRestRate == null ? '—' : cfg.doubleRestRate + '%'), rateCls) +
          stat('平均离岗时间', cfg.offWorkTime || '—', 'color:#e2e8f0') +
          stat('法定加班费兑付', '—', 'color:#2dd4bf') +
        '</div>' +
      '</div>' +

      '<div class="sxg-note">' +
        '<strong>说明：</strong>该品牌为社区提交数据，尚未接入公开司法文书与官方通报的交叉核验，' +
        '证据强度低于已核验档案。请以实际排班与劳动合同为准。' +
      '</div>';

    var foot = el('div', 'sxg-actions right');
    var evidenceBtn = el('button', 'sxg-btn sxg-btn-primary sxg-btn-sm', '生成我的投票小票');
    var close = el('button', 'sxg-btn sxg-btn-ghost sxg-btn-sm', '关闭');
    evidenceBtn.addEventListener('click', function () { openTicketModal(cfg); });
    close.addEventListener('click', closeLayer);
    foot.appendChild(evidenceBtn);
    foot.appendChild(close);
    body.appendChild(foot);

    box.appendChild(body);
    layer.appendChild(box);

    function stat(label, val, color) {
      return '<div><div class="k">' + label + '</div>' +
        '<div class="v" style="' + color + '">' + esc(String(val)) + '</div></div>';
    }
  }

  /* ------------------------------------- 弹窗 3：员工投票（2026-10-19）
     自定义卡是克隆内置卡模板生成的，克隆体上的「员工投票」按钮
     没有React onClick（克隆不带 React 内部 fiber 事件），而
     bindCustomCards 此前只绑了「打卡」「详情证据」——用户点
     「员工投票」**完全没反应**，看起来就像按钮坏了/数据是 null。
     这里补一个与内置投票弹窗对齐的表单：岗位/双休情况/下班时间/
     加班费，提交后把票数写进 localStorage（后续云同步再上传）。 */

  var VOTE_STORE_KEY = 'sxg-custom-votes';
  // 2026-10-19 站长定版：员工投票与内置卡一致，提交后跳 GitHub Issues 入库；
  // 点赞/点踩只记本地（弹提示告知），上传 GitHub 云端是后续功能。
  var ISSUE_REPO = 'https://github.com/dujeongil-galaxy/shuangxiugou/issues/new';

  function loadCustomVotes() {
    try { return JSON.parse(localStorage.getItem(VOTE_STORE_KEY) || '{}'); }
    catch (e) { return {}; }
  }
  function saveCustomVotes(data) {
    try { localStorage.setItem(VOTE_STORE_KEY, JSON.stringify(data)); } catch (e) {}
  }

  function openVoteModal(cfg) {
    closeLayer();
    var layer = ensureLayer();

    var box = el('div', 'sxg-box sxg-box-lg');
    box.style.padding = '0';
    box.style.overflow = 'hidden';
    var head = el('div', 'sxg-vote-head');
    var body = el('div', 'sxg-vote-body sxg-pad sxg-space');

    // 已投过的本地记录（按品牌 id 存最新一票）
    var votes = loadCustomVotes();
    var mine = votes[cfg.id];

    var roleOpts = ['研发技术', '产线工人', '职能/人事/财务', '一线门店/骑手/销售'];
    var     weekendOpts = [
      ['100', '严格双休从不打折', '100% 双休'],
      ['80', '周末基本不占用', '大小周/阶段性加班'],
      ['50', '隔周单休或常态加班', '周末经常被占用'],
      ['20', '月休 4 天或更少', '单休/更少']
    ];
    var timeOpts = ['17:30 之前', '18:00 准点', '19:00 左右', '20:30 左右', '22:00 以后'];

    function pillGroup(name, opts) {
      // opts: [value, 主文案, 副文案或空]
      return opts.map(function (o, i) {
        return '<label class="sxg-pill">' +
          '<input type="radio" name="' + name + '" value="' + esc(o[0]) + '"' + (i === 0 ? ' checked' : '') + '>' +
          '<span>' + esc(o[1]) + (o[2] && o[2] !== o[1] ? '<em style="display:block;font-style:normal;font-weight:400;font-size:10px;color:#94a3b8">' + esc(o[2]) + '</em>' : '') + '</span></label>';
      }).join('');
    }

    head.innerHTML =
      '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">' +
        '<div>' +
          '<span style="display:inline-block;font-size:10px;font-weight:700;letter-spacing:.05em;background:rgba(16,185,129,.18);color:#6ee7b7;border-radius:999px;padding:3px 10px">内部员工匿名传真实工时公证</span>' +
          '<h2 class="sxg-h2" style="margin:8px 0 0">投出你在 ' + esc(cfg.name) + ' 的真实工时</h2>' +
          '<p class="sxg-sub" style="margin-top:4px">保护隐私：全程匿名投票，只记录汇总结果，不留任何个人信息。</p>' +
        '</div>' +
        '<button type="button" data-vote-close>✕</button>' +
      '</div>';

    body.innerHTML =
      '<div>' +
        '<div class="sxg-title-sm">你的部门/岗位类型：</div>' +
        '<div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:8px">' + pillGroup('sxg-vote-role', roleOpts.map(function (o) { return [o, o, '']; })) + '</div>' +
      '</div>' +

      '<div>' +
        '<div style="display:flex;align-items:center;justify-content:space-between">' +
          '<div class="sxg-title-sm">周末休息真实情况（选最符合的一项）：</div>' +
        '</div>' +        '<div style="margin-top:8px;display:grid;grid-template-columns:repeat(3,1fr);gap:8px" data-vote-weekend-group>' +
          weekendOpts.map(function (o, i) {
            return '<label class="sxg-pill" style="flex-direction:column;align-items:flex-start;gap:2px;padding:10px 12px">' +
              '<input type="radio" name="sxg-vote-weekend" value="' + o[0] + '"' + (i === 0 ? ' checked' : '') + '>' +
              '<span style="font-weight:700">' + esc(o[1]) + '</span>' +
              '<em style="font-style:normal;font-size:10px;color:#94a3b8">' + esc(o[2]) + '</em></label>';
          }).join('') +
        '</div>' +
      '</div>' +

      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' +
        '<div>' +
          '<div class="sxg-title-sm">平时平均下班时间：</div>' +
          '<select data-vote-time style="margin-top:6px;width:100%;box-sizing:border-box;border:1px solid #e2e8f0;border-radius:8px;padding:8px;font-size:12px;background:#fff;color:#334155">' +
            timeOpts.map(function (o) { return '<option value="' + esc(o) + '">' + esc(o) + '</option>'; }).join('') +
          '</select>' +
        '</div>' +
        '<div>' +
          '<div class="sxg-title-sm">法定加班费/福利补贴：</div>' +
          '<div style="margin-top:6px;display:flex;gap:8px;flex-wrap:wrap">' +
            '<label class="sxg-pill"><input type="radio" name="sxg-vote-bonus" value="ok" checked><span>✅ 依法足额发放</span></label>' +
            '<label class="sxg-pill"><input type="radio" name="sxg-vote-bonus" value="no"><span>❌ 克扣/强制自愿</span></label>' +
          '</div>' +
        '</div>' +
      '</div>' +

      '<div>' +
        '<div class="sxg-title-sm">一句话补充（可选，匿名显示）：</div>' +
        '<textarea data-vote-comment rows="2" style="margin-top:6px;width:100%;box-sizing:border-box;border:1px solid #e2e8f0;' +
          'border-radius:8px;padding:8px;font-size:12px;font-family:inherit" ' +
          'placeholder="例如：赶项目时周末必来，平时到点走"></textarea>' +
      '</div>' +

      (mine
        ? '<p class="sxg-xs">你之前投过一票（' + esc(mine.weekendLabel || '') + '），再次提交会覆盖。</p>'
        : '') +

      '<div class="sxg-vote-note">全程匿名投票：不记录 IP、不关联任何社交账户，你的选择只参与本站综合评分。</div>' +

      '<div class="sxg-actions right">' +
        '<button type="button" class="sxg-btn sxg-btn-ghost sxg-btn-sm" data-vote-close>取消</button>' +
        '<button type="button" class="sxg-btn sxg-btn-primary sxg-btn-sm" data-vote-submit>提交我的真实工时票（跳转 GitHub 记录）</button>' +
      '</div>';

    box.appendChild(head);
    box.appendChild(body);
    layer.appendChild(box);

    // ✕ 与「取消」绑定同一个动作：直接点「取消」按钮（同一处理函数），再加文档级捕获兜底
    var cancelBtn = body.querySelector('.sxg-actions [data-vote-close]');
    box.querySelectorAll('[data-vote-close]').forEach(function (b) {
      if (b === cancelBtn) return;
      b.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (cancelBtn) { cancelBtn.click(); } else { closeLayer(); }
      });
    });
    if (cancelBtn) cancelBtn.addEventListener('click', closeLayer);
    box.addEventListener('click', function (e) {
      var t = e.target;
      while (t && t !== box) {
        if (t.hasAttribute && t.hasAttribute('data-vote-close') && t !== cancelBtn) { closeLayer(); return; }
        t = t.parentNode;
      }
    }, true);

    body.querySelector('[data-vote-submit]').addEventListener('click', function () {
      var role = (body.querySelector('input[name="sxg-vote-role"]:checked') || {}).value || '';
      var weekendEl = body.querySelector('input[name="sxg-vote-weekend"]:checked');
      var time = (body.querySelector('[data-vote-time]') || {}).value || '';
      var bonus = (body.querySelector('input[name="sxg-vote-bonus"]:checked') || {}).value || 'ok';
      var comment = (body.querySelector('[data-vote-comment]') || {}).value || '';
      if (!weekendEl) return;
      var weekendLabel = (weekendOpts.filter(function (o) { return o[0] === weekendEl.value; })[0] || ['', ''])[1];

      var votesNow = loadCustomVotes();
      votesNow[cfg.id] = {
        role: role,
        weekend: Number(weekendEl.value),
        weekendLabel: weekendLabel,
        offWorkTime: time,
        bonus: bonus === 'ok' ? '依法足额发放' : '克扣/强制自愿',
        comment: comment.trim(),
        at: new Date().toISOString()
      };
      saveCustomVotes(votesNow);

      // 跳转 GitHub Issues 入库（与内置卡 employee-report-to-issue.js 同一套路：
      // 拼预填的「新建 issue」URL，用户在 GitHub 点一下确认才真正提交）
      var params =
        '?title=' + encodeURIComponent('[员工工时投稿] ' + cfg.name) +
        '&body=' + encodeURIComponent(
          '## 员工工时投稿（自动生成，请补充可查证来源）\n' +
          '\n' +
          '| 项目 | 填写内容 |\n' +
          '| --- | --- |\n' +
          '| 企业 | ' + cfg.name + ' |\n' +
          '| 部门/岗位 | ' + role + ' |\n' +
          '| 周末休息真实情况 | ' + weekendLabel + ' |\n' +
          '| 平时平均下班时间 | ' + (time || '未选择') + ' |\n' +
          '| 法定加班费/福利补贴 | ' + (bonus === 'ok' ? '依法足额发放' : '克扣/强制自愿') + ' |\n' +
          '\n' +
          '### 一句话补充\n' +
          (comment.trim() || '（未填写）') + '\n' +
          '\n' +
          '---\n' +
          '\n' +
          '**这份投稿只作核查线索，不直接计入统计。**核实后本站会更新品牌详情页。\n' +
          '\n' +
          '（本条由自定义品牌卡「员工投票」表单自动生成）'
        ) +
        '&labels=' + encodeURIComponent('员工投稿');
      window.open(ISSUE_REPO + params, '_blank', 'noopener');

      // 卡面上的「N 人已投票」同步 +1（本地视角）
      var card = document.getElementById(cfg.id);
      if (card) {
        var cnt = card.querySelector('.bg-slate-900 .font-mono');
        if (cnt) {
          var n = parseInt((cnt.textContent || '0'), 10);
          if (isNaN(n)) n = 0;
          cnt.textContent = (n + 1) + ' 人已投票';
        }
      }
      closeLayer();
      openVoteThanks(cfg, weekendLabel, time);
    });
  }

  // 投票成功回执（轻量，不 confetti —— confetti 库在 bundle 内部拿不到）
  function openVoteThanks(cfg, weekendLabel, time) {
    closeLayer();
    var layer = ensureLayer();
    var box = el('div', 'sxg-box');
    box.innerHTML =
      '<div class="sxg-pad" style="text-align:center">' +
        '<div style="font-size:34px;line-height:1">🗳️</div>' +
        '<h3 class="sxg-h3" style="margin-top:10px">投票成功</h3>' +
        '<p class="sxg-p" style="margin-top:8px">你在 <strong>' + esc(cfg.name) + '</strong> 的一票已记下：<br>' +
          esc(weekendLabel) + ' · ' + esc(time || '') + '</p>' +
        '<p class="sxg-xs" style="margin-top:8px">已为你打开 GitHub 的新建 Issue 页面，' +
          '在 GitHub 点「Submit new issue」后投稿即入库；本页票数同步记入浏览器本地。</p>' +
        '<div class="sxg-actions" style="justify-content:center;padding-top:14px">' +
          '<button type="button" class="sxg-btn sxg-btn-primary sxg-btn-sm" data-thanks-ok>好的</button>' +
        '</div>' +
      '</div>';
    layer.appendChild(box);
    box.querySelector('[data-thanks-ok]').addEventListener('click', closeLayer);
  }

  // 点赞/点踩后的提示（2026-10-19 站长定版文案）：
  // 数据保存在本地浏览器 Cookie（localStorage），上传 GitHub 云端是后续功能
  function openThumbToast(cfg, kind, repeat) {
    closeLayer();
    var layer = ensureLayer();
    var box = el('div', 'sxg-box');
    var label = kind === 'like' ? '点赞' : '点踩';
    box.innerHTML =
      '<div class="sxg-pad" style="text-align:center">' +
        '<div style="font-size:34px;line-height:1">' + (kind === 'like' ? '👍' : '👎') + '</div>' +
        '<h3 class="sxg-h3" style="margin-top:10px">' + (repeat ? '你已经' + label + '过啦' : label + '成功') + '</h3>' +
        '<p class="sxg-p" style="margin-top:8px">你对 <strong>' + esc(cfg.name) + '</strong> 的' + label +
          '已记录。</p>' +
        '<p class="sxg-xs" style="margin-top:8px">你的数据将保存在本地浏览器 Cookie / 缓存中，仅自己可见；' +
          '<strong style="color:#b45309">请勿清除浏览器 Cookie 与缓存</strong>，否则记录会丢失。' +
          '上传 GitHub 云端是后续考虑开发的功能。</p>' +
        '<div class="sxg-actions" style="justify-content:center;padding-top:14px">' +
          '<button type="button" class="sxg-btn sxg-btn-primary sxg-btn-sm" data-thumb-ok>好的</button>' +
        '</div>' +
      '</div>';
    layer.appendChild(box);
    box.querySelector('[data-thumb-ok]').addEventListener('click', closeLayer);
  }

  /* ------------------- 内置品牌卡的小票：DOM 层接管（不改压缩包） -------------------
     内置小票由压缩包里的 React 组件渲染，「清醒打工人 #7709」和金额 199
     都写死在构建产物里。改压缩包风险高（34 万字符，改错整站白屏），
     且下次重新构建会被覆盖。

     这里的做法：等内置小票渲染出来后，用 DOM 找到那两个文本节点，
     换成访客填的值，并在小票上方插入同一套填写区。
     —— 视觉与自定义卡完全一致，且与构建流程解耦。            */

  var builtinPatched = null;
  // 当次内置小票弹窗的稳定匿名编号（每次弹窗重开时重新生成一次）
  var builtinAnonId = null;

  // 内置小票纸面上的金额行，标签有两个（按是否违规避雷二选一）：
  //   转移撤销消费金额: / 注入良心企业预算:
  // 值是它右边的 span，内容形如「+ ¥ 199」。
  //
  // ⚠️ 这里的标签不是「已转移/支持消费:」——那句话只存在于复制文本的
  // 模板字符串里，纸面上根本没有。踩过这个坑：早期版本按复制文本里的
  // 文案去定位，纸面金额永远定位不到，代码改了但界面纹丝不动。
  var AMOUNT_LABELS = ['转移撤销消费金额:', '注入良心企业预算:'];
  var RATING_LABEL = '工时健康评级:';
  var BUILTIN_INPUT_LABEL = '本次投票消费金额:';
  var TOTAL_LABEL = '全站累计已转移/支持消费:';

  // 用户正在输入时的预览值。null 表示以存档的 profile.total 为准。
  // React 重渲染会把纸面内容冲回写死的 199，observer 触发 syncBuiltin
  // 重绘时必须用这个值，否则用户填到一半的预览会被 199 覆盖掉。
  var builtinPreview = null;
  // 本品牌累计的预览值（当次弹窗内）；null = 以存档的分品牌累计为准
  var builtinBrandPreview = null;

  // 昵称/理由的当次预览值（2026-10-23 站长截图 bug：存档过一次昵称后，
  // 第二次无论输入什么都显示第一次的昵称）。根因：syncBuiltin 每次都按
  // 存档 p.name / p.reason 重绘 —— 金额有 builtinPreview 保护，昵称和理由
  // 没有，输入监听刚写入的真实值会被 observer 防抖回调刷回存档值。
  // null = 以存档为准（弹窗刚打开、还没输入时）。
  var builtinNamePreview = null;
  var builtinReasonPreview = null;

  function findLabelNode(root, labels) {
    var spans = $$('span', root);
    for (var i = 0; i < spans.length; i++) {
      var txt = (spans[i].textContent || '').trim();
      for (var j = 0; j < labels.length; j++) {
        if (txt === labels[j]) return spans[i];
      }
    }
    return null;
  }

  function findBuiltinAmountSpan(receipt) {
    for (var i = 0; i < AMOUNT_LABELS.length; i++) {
      var n = findValueNode(receipt, AMOUNT_LABELS[i]);
      if (n) return n;
    }
    return null;
  }

  // 署名行改写成访客填的称呼；没填则用本次弹窗的稳定匿名编号。
  //
  // ⚠️ 2026-10-22 站长截图 bug：昵称框输入「test」后小票纹丝不动。
  //    根因是「首次接管只画金额、不画名字」—— 署名 span 的
  //    id="sxg-t-name" 只在 syncBuiltin（第二次进入）里才设，
  //    而实时联动的 input 监听用 $('#sxg-t-name', receipt) 找节点，
  //    首次进入时永远是 null → if (nameEl) 静默跳过 → 输入毫无反应。
  //    修法：① 抽出本函数，首次接管就改写署名行并设 id；
  //          ② input 监听改用 findValueNode 按标签文字定位，
  //             不依赖 id（React 重建节点后 id 会丢，届时又会失效）。
  function paintBuiltinName(receipt, name) {
    var span = findValueNode(receipt, '考核执行官:');
    if (!span) return false;
    span.id = 'sxg-t-name';
    var want = displayName(name, builtinAnonId);
    if ((span.textContent || '').trim() !== want) span.textContent = want;
    return true;
  }

  // 把纸面金额行改写成「累计已转移/支持消费:￥498」
  // 只在内容不同时才写，避免 MutationObserver 自己触发自己无限循环。
  function paintBuiltinAmount(receipt, total) {
    var span = findBuiltinAmountSpan(receipt);
    if (span) {
      span.id = 'sxg-t-amount';
      var want = '￥' + fmtMoney(total);
      if ((span.textContent || '').trim() !== want) span.textContent = want;
    }
    var label = findLabelNode(receipt, AMOUNT_LABELS);
    if (label && (label.textContent || '') !== TOTAL_LABEL) {
      label.textContent = TOTAL_LABEL;
    }
    return !!span;
  }

  // 本品牌累计行（2026-10-18）：插在「全站累计」行上方，两级上下行显示。
  // 幂等：行已存在时只改文本（不同才写），避免 observer 自激。
  function paintBuiltinBrandRow(receipt, brandKey, brandVal) {
    if (!brandKey) return false;
    var label = findLabelNode(receipt, [TOTAL_LABEL]);
    if (!label) return false;
    var holder = label.parentNode;
    if (!holder || !holder.parentNode) return false;
    var row = receipt.querySelector('[data-sxg-brand-row]');
    var wantLabel = '本品牌累计:';
    var wantVal = '￥' + fmtMoney(brandVal);
    if (!row) {
      row = el('div', 'flex justify-between items-baseline gap-2 text-xs');
      row.setAttribute('data-sxg-brand-row', '1');
      row.innerHTML =
        '<span class="text-slate-600 font-semibold whitespace-nowrap"></span>' +
        '<span class="font-bold font-mono text-sm text-emerald-700" id="sxg-t-amount-brand"></span>';
      holder.parentNode.insertBefore(row, holder);
    }
    var lab = row.children[0];
    var val = row.children[1];
    if ((lab.textContent || '') !== wantLabel) lab.textContent = wantLabel;
    if ((val.textContent || '') !== wantVal) val.textContent = wantVal;
    return true;
  }

  // 隐藏 bundle 自带的「本次投票消费金额」输入行。
  // 金额统一由注入的「本次新增消费（元）」框录入，两个框并存会让人填错。
  function hideBuiltinAmountInput(root) {
    var label = findLabelNode(root, [BUILTIN_INPUT_LABEL]);
    if (!label) return false;
    var row = label.closest('.flex.items-center.justify-between') || label.parentNode;
    if (!row) return false;
    if (row.getAttribute('data-sxg-hidden') !== '1') {
      row.style.display = 'none';
      row.setAttribute('data-sxg-hidden', '1');
    }
    return true;
  }

  // 理由行挂在「工时健康评级」之后。
  // 这里不能用 .sxg-kv 定位 —— 那是自定义卡才有的 class，
  // 内置小票上没有，holder 恒为 null，理由就永远插不进去。
  function paintBuiltinReason(receipt, reason) {
    var anchor = findLabelNode(receipt, [RATING_LABEL]);
    var holder = anchor && anchor.parentNode;
    if (!holder || !holder.parentNode) return;
    var row = receipt.querySelector('[data-sxg-reason]');
    if (reason) {
      if (!row) {
        row = el('div', 'flex justify-between items-start gap-2 text-xs');
        row.setAttribute('data-sxg-reason', '1');
        row.innerHTML =
          '<span class="text-slate-500 whitespace-nowrap">理由:</span>' +
          '<span class="font-bold text-slate-900 text-right truncate max-w-[180px]"></span>';
        holder.parentNode.insertBefore(row, holder.nextSibling);
      }
      var v = row.lastChild;
      if (v && (v.textContent || '') !== reason) v.textContent = reason;
    } else if (row && row.parentNode) {
      row.parentNode.removeChild(row);
    }
  }

  // 小票重新渲染后（React 重渲染）把已存的值再写回去。
  // 不做「已处理过就 return」的短路：React 复用同一个 span 节点时 id 还在，
  // 但内容已被重置成 199，那次短路会让 199 留在屏幕上。
  function syncBuiltin(receipt, brandKey, brandBase) {
    var p = loadProfile();
    var want = builtinPreview != null ? builtinPreview : p.total;
    var totals = brandKey ? loadBrandTotals() : null;
    var brandWant = builtinBrandPreview != null
      ? builtinBrandPreview
      : (totals && totals[brandKey] ? totals[brandKey] : (brandBase || 0));
    // 昵称/理由同金额：用户当次输入的值优先于存档值，否则输入即被刷回（见上方注释）
    paintBuiltinName(receipt, builtinNamePreview != null ? builtinNamePreview : p.name);
    paintBuiltinAmount(receipt, want);
    paintBuiltinBrandRow(receipt, brandKey, brandWant);
    paintBuiltinReason(receipt, (builtinReasonPreview != null
      ? builtinReasonPreview
      : (p.reason || '')).trim());
    paintBuiltinCaption(receipt);
    hideBuiltinAmountInput(receipt);
  }

  // 条形码下的域名水印（bundle 印死的是上游死链大写形式，改写为本站）
  //
  // ⚠️ 2026-10-23 真实浏览器截图发现的坑：bundle 的 DOM 是
  //      <div class="flex flex-col items-center justify-center pt-1">
  //        <div class="flex items-center gap-[2px] h-9">…23 根条纹…</div>
  //        <div class="text-[9px] …">SHUANGXIUGOU.VERCEL.APP</div>
  //      </div>
  //    外层容器包着条形码，而条形码 div 没有文字，所以外层容器的
  //    textContent 也整好等于水印文案。早前版本按 textContent 匹配，
  //    先命中的是外层容器，把 textContent 写上去 = 连条形码带水印
  //    节点一起清空，内置小票的条形码就这样被抹没了（截图里
  //    引语下方只剩一片空白）。
  //    修法：只认叶子节点（children.length === 0）——外层容器有子节点，
  //    天然被排除；真正的水印 div 只有文字，才会被改写。
  function paintBuiltinCaption(receipt) {
    var divs = $$('div', receipt);
    for (var i = 0; i < divs.length; i++) {
      var d = divs[i];
      if (d.children.length !== 0) continue; // 外层容器会连带清掉条形码，跳过
      var txt = (d.textContent || '').trim();
      if (txt === BUILTIN_CAPTION) {
        if (txt !== SXG_CAPTION) d.textContent = SXG_CAPTION;
        return true;
      }
    }
    return false;
  }

  function patchBuiltinTicket() {
    // 内置小票容器：带receipt-tear-top 的那张米色纸
    var receipt = document.querySelector('.receipt-tear-top');
    if (!receipt) return;
    hideBuiltinAmountInput(receipt.parentNode || document);
    if (receipt.getAttribute('data-sxg-builtin') === '1') {
      // 已处理过，只同步数值
      syncBuiltin(receipt);
      return;
    }

    var profile = loadProfile();
    receipt.setAttribute('data-sxg-builtin', '1');
    builtinAnonId = Math.floor(1000 + Math.random() * 9000); // 本次弹窗内稳定
    builtinNamePreview = null;   // 新弹窗，没有「当次输入」可言
    builtinReasonPreview = null;

    // 上游模板把复制文本里的「数据查验」网址写死为上游死链域名，
    // 而该上游站点 2026-10-09 实测已无法访问（见 projects.html 同源记录）。
    // bundle 按铁律不可改，这里对 clipboard.writeText 做一次性窄包装：
    // 只改写包含该死链的小票文本，其余剪贴板写入原样放行。
    (function fixBuiltinCopyUrl() {
      var cb = window.navigator && window.navigator.clipboard;
      if (!cb || typeof cb.writeText !== 'function' || cb.__sxgUrlFix) return;
      var orig = cb.writeText.bind(cb);
      cb.writeText = function (t) {
        if (typeof t === 'string' && t.indexOf('shuangxiugou.vercel.app') !== -1) {
          t = t.split('shuangxiugou.vercel.app').join(SXG_SITE_URL);
        }
        return orig(t);
      };
      cb.__sxgUrlFix = true;
    })();

    // 分品牌累计：本品牌 = brandTotals[纸面「考核品牌」]
    var brandKey = brandKeyOf((findValueNode(receipt, '考核品牌:') || {}).textContent);
    var brandBase = loadBrandTotals()[brandKey] || 0;
    builtinBrandPreview = brandBase;

    // 与自定义卡弹窗同一条规则：打开时的累计是个常量，
    // 只有用户明确点「完成 / 复制」才把本次新增结算进去。
    // 否则光是打开看一眼就会算一次钱。
    var baseTotal = profile.total;
    builtinPreview = baseTotal;

    function previewTotalOf() {
      var fA = document.getElementById('sxg-f-amount');
      return Math.min(baseTotal + clampDelta(fA ? fA.value : ''), MAX_TOTAL);
    }

    // 在小票前面插入填写区
    var form = buildProfileForm(profile, brandKey, brandBase);
    if (form && receipt.parentNode) {
      receipt.parentNode.insertBefore(form, receipt);
    }

    // 纸面金额与标签一次画好。找不到金额行时必须出声，
    // 不能再像以前那样静默失败 —— 静默失败正是这个 bug 上线的直接原因。
    var okAmount = paintBuiltinAmount(receipt, baseTotal);
    // 署名行同样要在首次接管时改写（2026-10-22 bug：只画金额不画名字，
    // 导致实时联动的 nameEl 永远找不到，昵称输入无反应）
    var okName = paintBuiltinName(receipt, profile.name);
    if (!okAmount) diag('内置小票未找到金额行，纸面金额仍是写死的值');
    paintBuiltinBrandRow(receipt, brandKey, brandBase);
    paintBuiltinCaption(receipt);

    var fTotal = $('#sxg-total', form);
    var fTotalBrand = $('#sxg-total-brand', form);
    if (fTotal) fTotal.textContent = '￥' + fmtMoney(baseTotal);
    if (fTotalBrand) fTotalBrand.textContent = '￥' + fmtMoney(brandBase);

    // 实时联动
    if (form) {
      var fName = $('#sxg-f-name', form);
      var fAmount = $('#sxg-f-amount', form);
      var fReason = $('#sxg-f-reason', form);
      [fName, fAmount, fReason].forEach(function (input) {
        input.addEventListener('input', function () {
          var shown = previewTotalOf();
          builtinPreview = shown;
          // 记录当次输入：observer 回调 syncBuiltin 重绘时以此为准，
          // 不能让它拿存档值把用户正在输入的内容刷掉（昵称 bug 根因）
          builtinNamePreview = fName.value;
          builtinReasonPreview = fReason.value;
          var brandShown = Math.min(brandBase + clampDelta(fAmount.value), MAX_TOTAL);
          builtinBrandPreview = brandShown;
          // 按标签文字定位，不依赖 id —— React 重渲染会重建 span 节点，
          // 届时 id 丢失（2026-10-22 bug 的次要根因，见 paintBuiltinName 注释）
          var nameEl = findValueNode(receipt, '考核执行官:');
          if (nameEl) {
            nameEl.id = 'sxg-t-name';
            nameEl.textContent = displayName(fName.value, builtinAnonId);
          }
          var amountEl = $('#sxg-t-amount', receipt);
          if (amountEl) amountEl.textContent = '￥' + fmtMoney(shown);
          if (fTotal) fTotal.textContent = '￥' + fmtMoney(shown);
          if (fTotalBrand) fTotalBrand.textContent = '￥' + fmtMoney(brandShown);
          paintBuiltinBrandRow(receipt, brandKey, brandShown);
          paintBuiltinReason(receipt, (fReason.value || '').trim());
        });
      });
    }

    // 清空累计（2026-10-17）：二次确认后才清零，只清金额，保留昵称与理由。
    // baseTotal/builtinPreview 同步归零，React 重渲染后 syncBuiltin 也写 0。
    var clearBtnB = $('#sxg-f-clear', form);
    if (clearBtnB) clearBtnB.addEventListener('click', function () {
      openClearConfirm(function () {
        var p2 = loadProfile();
        saveProfile({ name: p2.name, total: 0, lastDelta: 0, reason: p2.reason });
        saveBrandTotals({});
        baseTotal = 0;
        builtinPreview = 0;
        brandBase = 0;
        builtinBrandPreview = 0;
        var fAmt = document.getElementById('sxg-f-amount');
        if (fAmt) fAmt.value = '';
        if (fTotal) fTotal.textContent = '￥0.00';
        if (fTotalBrand) fTotalBrand.textContent = '￥0.00';
        paintBuiltinAmount(receipt, 0);
        paintBuiltinBrandRow(receipt, brandKey, 0);
      });
    });

    // 用户点「完成 / 复制 / 保存高清图 / 确认打卡并计入全网总额」才结算本次新增。
    // 用捕获阶段监听，因为这些按钮是 bundle 内部处理的，我们只旁挂结算。
    var box = receipt.closest('.max-w-sm') || receipt.parentNode;
    if (box) {
      box.addEventListener('click', function (ev) {
        var t = (ev.target && ev.target.textContent) || '';
        var settle = t.indexOf('完成') !== -1
                  || t.indexOf('复制') !== -1
                  || t.indexOf('高清图') !== -1
                  || t.indexOf('确认打卡') !== -1;
        if (!settle) return;
        var fA = document.getElementById('sxg-f-amount');
        var fN = document.getElementById('sxg-f-name');
        var fR = document.getElementById('sxg-f-reason');
        var delta = clampDelta(fA ? fA.value : '');
        var total = Math.min(baseTotal + delta, MAX_TOTAL);
        saveProfile({
          name: (fN ? fN.value : '').trim(),
          total: total,
          lastDelta: 0,
          reason: (fR ? fR.value : '').trim()
        });
        // 已落盘，预览值清空，syncBuiltin 恢复以存档为准
        builtinNamePreview = null;
        builtinReasonPreview = null;
        var brandNext = Math.min(brandBase + delta, MAX_TOTAL);
        var bt = loadBrandTotals();
        bt[brandKey] = brandNext;
        saveBrandTotals(bt);
        brandBase = brandNext;
        builtinBrandPreview = brandNext;
        // 结算后清空新增额并以新累计为基准，连点两次不会加两次
        baseTotal = total;
        builtinPreview = total;
        if (fA) fA.value = '';
        if (fTotal) fTotal.textContent = '￥' + fmtMoney(total);
        if (fTotalBrand) fTotalBrand.textContent = '￥' + fmtMoney(brandNext);
        paintBuiltinAmount(receipt, total);
        paintBuiltinBrandRow(receipt, brandKey, brandNext);
      }, true);
    }

    diag('已接管内置小票的署名与金额（金额行 ' + (okAmount ? '已改写' : '未找到')
        + '，署名行 ' + (okName ? '已改写' : '未找到') + '）');
  }

  // 内置小票是「标签: 值」左右两格的布局，按标签文字找到右边的值
  function findValueNode(root, label) {
    var spans = $$('span', root);
    for (var i = 0; i < spans.length; i++) {
      if ((spans[i].textContent || '').trim() === label) {
        var p = spans[i].parentNode;
        if (!p) continue;
        var kids = p.children;
        for (var j = 0; j < kids.length; j++) {
          if (kids[j] !== spans[i]) return kids[j];
        }
      }
    }
    return null;
  }

  // 说明：内置小票的「理由」行由 paintBuiltinReason 负责，
  // 它挂在「工时健康评级」之后。早前这里叫 applyReasonToBuiltin，
  // 依赖 .sxg-kv 定位，而那是自定义卡才有的 class —— 内置小票上
  // holder 恒为 null，理由永远插不进去。已并入 paintBuiltinReason。
  //
  // 说明：syncBuiltin 也已上移到 paintBuiltin* 那一组，
  // 现在无短路、每次都按 builtinPreview 重绘（见该函数上方注释）。

  /* ------------------------------- 弹窗 3：首页顶部按钮的引导（去档案卡打卡） */

  var guideShown = false;

  function openGuideModal() {
    if (guideShown) return;
    guideShown = true;
    // 同一次会话只弹一次，刷新后可再次触发
    try { sessionStorage.setItem('sxg-guide-checkin', '1'); } catch (e) {}

    closeLayer();
    var layer = ensureLayer();

    var box = el('div', 'sxg-box sxg-pad sxg-space');
    box.style.maxWidth = '448px';
    box.innerHTML =
      '<div class="sxg-row-top">' +
        '<h3 class="sxg-h3">' +
        '打卡要对具体品牌，所以请在下方卡片上操作' +
        '</h3>' +
      '</div>' +
      '<p class="sxg-p">' +
        '这张小票会写上考核对象、企业评级和工时政策，' +
        '所以需要你先选定一家企业，再生成属于它的小票。' +
      '</p>' +
      '<div class="sxg-note-green">' +
        '<strong>怎么打卡：</strong>往下翻到「企业真双休档案」，' +
        '找到你要支持或避雷的那家公司，' +
        '点它卡片下方的<strong>「打卡」</strong>按钮即可。' +
      '</div>' +
      '<div class="sxg-xs">' +
        '提示：可以用上方搜索框直接搜品牌名，或用品类筛选缩小范围。' +
      '</div>';

    var foot = el('div', 'sxg-actions right');
    var go = el('button', 'sxg-btn sxg-btn-primary sxg-btn-sm', '去下面看看');
    var close = el('button', 'sxg-btn sxg-btn-ghost sxg-btn-sm', '知道了');
    go.addEventListener('click', function () {
      closeLayer();
      scrollToArchive();
    });
    close.addEventListener('click', closeLayer);
    foot.appendChild(go);
    foot.appendChild(close);
    box.appendChild(foot);

    layer.appendChild(box);
  }

  function scrollToArchive() {
    // 品牌档案区的搜索框就是锚点，滚到它上面即可开始浏览卡片
    var input = document.getElementById('site-search-input');
    if (input) {
      input.scrollIntoView({ behavior: 'smooth', block: 'center' });
      try { input.focus({ preventScroll: true }); } catch (e) {}
      return;
    }
    var cards = $$('div.bg-white.rounded-2xl.border');
    if (cards.length) cards[0].scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ------------------------------------------------------- 绑定：首页顶部按钮 */

  function bindHeaderButton() {
    var btn = findByText(document.body, '打卡并生成小票');
    if (!btn) return false;
    if (btn.getAttribute('data-sxg-guide-bound') === '1') return true;
    btn.setAttribute('data-sxg-guide-bound', '1');
    // 捕获阶段拦截，阻止 React 原逻辑（默认给第一家品牌打卡）
    btn.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      openGuideModal();
    }, true);
    return true;
  }

  /* --------------------------------------------------- 绑定：自定义卡片的按钮 */

  function bindCustomCards() {
    var configs = getConfig();
    if (!configs.length) return;

    configs.forEach(function (cfg) {
      var card = document.getElementById(cfg.id);
      if (!card) return;
      if (card.getAttribute('data-sxg-bound') === '1') return;
      card.setAttribute('data-sxg-bound', '1');

      // 打卡
      var checkin = findByText(card, '打卡');
      if (checkin) {
        checkin.addEventListener('click', function (ev) {
          ev.preventDefault();
          ev.stopPropagation();
          openTicketModal(cfg);
        });
      } else {
        diag('自定义卡「' + cfg.name + '」找不到「打卡」按钮');
      }

      // 详情证据
      var evidence = findByText(card, '详情证据');
      if (evidence) {
        evidence.addEventListener('click', function (ev) {
          ev.preventDefault();
          ev.stopPropagation();
          openEvidenceModal(cfg);
        });
      } else {
        diag('自定义卡「' + cfg.name + '」找不到「详情证据」按钮');
      }

      // 员工投票（2026-10-19）：克隆模板丢了 React onClick，之前点了没反应
      var voteBtn = findByText(card, '员工投票');
      if (voteBtn) {
        voteBtn.addEventListener('click', function (ev) {
          ev.preventDefault();
          ev.stopPropagation();
          openVoteModal(cfg);
        });
      } else {
        diag('自定义卡「' + cfg.name + '」找不到「员工投票」按钮');
      }

      // 点赞 / 点踩（2026-10-19 站长定版）：点击有效，数据只保存在浏览器本地
      // （localStorage，等价于站点可用的持久存储），并弹提示告知；
      // 上传 GitHub 云端汇总是后续开发功能。
      var THUMB_KEY = 'sxg-custom-thumbs';
      function readThumbs() {
        try { return JSON.parse(localStorage.getItem(THUMB_KEY) || '{}'); }
        catch (e) { return {}; }
      }
      // 区分赞/踩：内置卡两个按钮都是「图标 + 数字」，文本区分不出来。
      // 以 title 属性为准（赞=我支持这家良心品牌，踩=用脚投票抵制单休），
      // 兜底看 SVG 图标 path（thumbs-up 含 M7 10v12，thumbs-down 含 M17 14V2）。
      function thumbKind(b) {
        var title = b.getAttribute('title') || '';
        if (/支持|认同|点赞/.test(title)) return 'like';
        if (/抵制|点踩|踩/.test(title)) return 'dislike';
        var d = '';
        [...b.querySelectorAll('svg path')].forEach(function (p) { d += (p.getAttribute('d') || ''); });
        if (/M17 14V2/.test(d)) return 'dislike';
        if (/M7 10v12/.test(d)) return 'like';
        return null;
      }
      $$('button', card).forEach(function (b) {
        var kind = thumbKind(b);
        if (!kind) return;

        var saved = readThumbs()[cfg.id];
        if (saved) {
          b.classList.add('sxg-thumb-on');
          b.setAttribute('title', '你已' + (saved === 'like' ? '点赞' : '点踩') + '过（保存在本地浏览器）');
        } else {
          b.setAttribute('title', '点击后记录保存在你的浏览器本地');
        }
        b.removeAttribute('aria-disabled');
        b.classList.remove('sxg-vote-off');
        b.addEventListener('click', function (ev) {
          ev.preventDefault();
          ev.stopPropagation();
          var t = readThumbs();
          if (t[cfg.id]) {
            // 重复点击：提示已记录，不重复计
            openThumbToast(cfg, t[cfg.id], true);
            return;
          }
          t[cfg.id] = kind;
          try { localStorage.setItem(THUMB_KEY, JSON.stringify(t)); } catch (e) {}
          b.classList.add('sxg-thumb-on');
          b.setAttribute('title', '你已' + (kind === 'like' ? '点赞' : '点踩') + '过（保存在本地浏览器）');
          openThumbToast(cfg, kind, false);
        });
      });

      patchVoteCounts();
    });
  }

  /* ------------------- 修「投票数显示 null」 -------------------
     新增卡片的数据里 totalEmployeeVotes 写成 null（表示「尚无实测投票」，
     是正常业务状态，不是脏数据）。bundle 只在卡片头部做了判空，详情弹窗里
     仍是直接拼接 `内部员工匿名投票汇总 ( {votes} 票 )`。

     ⚠️ 两个实测踩到的坑（2026-10-18）：
     1) React 遇到 null 子节点会**跳过不渲染**，页面上不是字面 "null"，
        而是「内部员工匿名投票汇总 ( 票)」——数字整个消失，括号里空着。
     2) React 把这段文案拆成**多个相邻文本节点**（`"…汇总 ("` + `" 票)"`），
        逐个文本节点跑正则永远匹配不到。所以必须按**父元素整体文本**判定，
        命中后整块重写成一句话。 */
  var VOTE_NULL_RE = /内部员工匿名投票汇总\s*[（(]\s*(null|undefined|—)?\s*票\s*[）)]/;

  function patchVoteText(root) {
    if (!root || !root.querySelectorAll) return false;
    var changed = false;
    var spans = root.querySelectorAll('span, div');
    for (var i = 0; i < spans.length; i++) {
      var e = spans[i];
      var t = e.textContent || '';
      if (t.indexOf('内部员工匿名投票汇总') === -1) continue;
      // 只处理「文字直接挂在它下面」的最近一层，别动整块卡片的容器
      if (e.querySelector('span, div')) continue;
      if (!VOTE_NULL_RE.test(t)) continue;
      e.textContent = t.replace(VOTE_NULL_RE, '内部员工匿名投票汇总（暂无实测投票）');
      changed = true;
    }
    return changed;
  }

  function patchVoteCounts() {
    // 2026-10-19 修复「详情弹窗偶发残留 ( 票)」：
    // 旧版只扫 .sxg-layer（我们自己的弹窗）和卡片容器，React 详情弹窗
    // 是渲染在 #root 下的 fixed 覆盖层，两者都不是 → 首次打开时补丁
    // 要等 MutationObserver 防抖 300ms 才落到，用户肉眼可见「( 票)」闪一下。
    // 现在直接全页扫描（元素数量 ~千级，开销可忽略），并在「详情证据」
    // 点击后用 rAF 立刻补一次，弹窗一出现就是正确文案。
    var hit = patchVoteText(document.body);
    return hit;
  }

  // 「详情证据」被点击 → React 渲染详情弹窗 → 弹窗里若有空票数文案，
  // 在渲染完成后的下一帧立刻改写，不等 300ms 防抖。
  // 捕获阶段监听 + 多次 rAF 重试：React 提交渲染可能在 rAF 之后，多试几帧。
  function bindVotePatchOnClick() {
    if (bindVotePatchOnClick.done) return;
    bindVotePatchOnClick.done = true;
    document.addEventListener('click', function (ev) {
      var t = ev.target;
      var btn = t && t.closest ? t.closest('button') : null;
      if (!btn) return;
      var txt = btn.textContent || '';
      if (txt.indexOf('详情证据') === -1 && txt.indexOf('员工投票') === -1) return;
      var tryPatch = function (left) {
        requestAnimationFrame(function () {
          patchVoteCounts();
          if (left > 0) tryPatch(left - 1);
        });
      };
      tryPatch(8); // 约 8 帧 ≈ 130ms，覆盖 React 渲染完成时机
    }, true);
  }

  /* ------------------------------------------------------------------ 杂项 */

  /* ------------------------------------------------ 每张品牌卡：本地存储说明
     站长 2026-10-19 要求：所有卡片（内置 React 卡 + 克隆出来的自定义卡）
     都要写明「数据当前仅保存在本地，不上传云端」。

     做法不看卡片来源，而是从卡片底部的操作按钮反查卡片根节点：
     「员工投票」按钮往上走 4 层就是 div.bg-white.rounded-2xl.border，
     内置卡和自定义卡是同一套结构，一条链路天然全覆盖。
     React 重渲染会把整个卡片换掉，所以加 MutationObserver 补挂（复用外层 observer）。 */

  // 文案按数据实际去向分述（站长 2026-10-19 更正）：
  // 点赞/点踩只写 localStorage；员工投票是跳 GitHub Issues 公开提交，两者不能混为一谈。
  var LOCAL_NOTE_HTML =
    '<span aria-hidden="true">💾</span>' +
    '<span><b>点赞、点踩</b>仅保存在本地浏览器，不上传云端；' +
    '清除 Cookie 与缓存会丢失。<b>员工投票</b>会提交到 GitHub Issues 公开记录。</span>';

  function cardRootOf(btn) {
    // 按钮 → div.flex.items-center.gap-2 → div.px-5.py-3 → 卡片根
    return btn.closest('.bg-white.rounded-2xl') || btn.parentElement.parentElement.parentElement;
  }

  function patchLocalNotes() {
    var btns = $$('button, a');
    var done = 0;
    btns.forEach(function (b) {
      if (!/员工投票/.test(b.textContent || '')) return;
      var card = cardRootOf(b);
      if (!card) return;
      // 已挂过就跳过：幂等，否则 observer 每次重渲染都会追加一行
      if (card.getAttribute('data-sxg-localnote') === '1') return;

      // 插到按钮条（支付的那一行灰底容器）之后，紧跟在按钮下面
      var bar = b.closest('.px-5') || card.lastElementChild;
      if (!bar) return;

      var note = document.createElement('div');
      note.className = 'sxg-localnote';
      note.innerHTML = LOCAL_NOTE_HTML;
      bar.parentNode.insertBefore(note, bar.nextSibling);
      card.setAttribute('data-sxg-localnote', '1');
      done++;
    });
    return done;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function stripQuotes(s) {
    return String(s == null ? '' : s).replace(/^["“”]|["“”]$/g, '');
  }

  function diag(msg) {
    if (window.console && console.warn) console.warn('[双休购] ' + msg);
  }

  /* --------------------------------------------------------------- 启动 */

  function init() {
    try { bindHeaderButton(); } catch (e) { diag('绑定顶部按钮出错: ' + e); }
    try { bindCustomCards(); } catch (e) { diag('绑定自定义卡片出错: ' + e); }
    try { patchBuiltinTicket(); } catch (e) { diag('接管内置小票出错: ' + e); }
    try { bindVotePatchOnClick(); } catch (e) { diag('绑定投票补丁点击监听出错: ' + e); }
    try { patchVoteCounts(); } catch (e) { diag('修正投票数显示出错: ' + e); }
    try { patchLocalNotes(); } catch (e) { diag('补挂本地存储说明出错: ' + e); }
  }

  init();

  // 自定义卡片是异步插入的，跟着 DOM 变化补挂
  var pending = null;
  var observer = new MutationObserver(function () {
    if (pending) return;
    pending = setTimeout(function () {
      pending = null;
      init();
    }, 300);
  });
  observer.observe(document.getElementById('root') || document.body, {
    childList: true,
    subtree: true
  });

  window.addEventListener('load', init);
})();