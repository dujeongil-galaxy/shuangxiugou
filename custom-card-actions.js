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
        total: Math.min(Math.round(p.amount), MAX_TOTAL),
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
          ? Math.min(Math.round(p.lastDelta), MAX_TOTAL)
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

  // 累计值只允许非负整数，上限封顶
  function clampTotal(v) {
    var n = parseInt(v, 10);
    if (isNaN(n) || n < 0) return 0;
    return Math.min(n, MAX_TOTAL);
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
            out[k] = Math.min(Math.round(o[k]), MAX_TOTAL);
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
  function clampDelta(v) {
    var s = String(v == null ? '' : v).trim();
    if (!s) return 0;
    var n = parseInt(s, 10);
    if (isNaN(n) || n <= 0) return 0;
    return Math.min(n, MAX_TOTAL);
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
          '<input id="sxg-f-amount" type="number" inputmode="numeric" min="0" ' +
            'max="' + MAX_TOTAL + '" placeholder="留空则不增加" />' +
          '<span class="sxg-total sxg-total-2">' +
            '<span class="sxg-total-line">本品牌累计 <b id="sxg-total-brand">￥' + brandBase0 + '</b></span>' +
            '<span class="sxg-total-line">全站累计 <b id="sxg-total">￥0</b></span>' +
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
      if (amountEl) amountEl.textContent = '￥' + shown;
      var brandShown = Math.min(brandBase + clampDelta(fAmount.value), MAX_TOTAL);
      if (fTotalBrand) fTotalBrand.textContent = '￥' + brandShown;
      var brandEl = $('#sxg-t-amount-brand', receipt);
      if (brandEl) brandEl.textContent = '￥' + brandShown;
      if (fTotal) fTotal.textContent = '￥' + shown;
      // 理由是后加的一行，实时输入时需要补出来
      var reasonKv = receipt.querySelector('[data-sxg-reason]');
      if (p.reason) {
        if (!reasonKv) {
          var holder = amountEl ? amountEl.closest('.sxg-kv') : null;
          if (holder) {
            reasonKv = el('div', 'sxg-kv');
            reasonKv.setAttribute('data-sxg-reason', '1');
            reasonKv.innerHTML = '<span class="k">理由:</span>' +
              '<span class="v"></span>';
            holder.parentNode.insertBefore(reasonKv, holder.nextSibling);
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
        if (fTotal) fTotal.textContent = '￥0';
        if (fTotalBrand) fTotalBrand.textContent = '￥0';
        var amountEl = $('#sxg-t-amount', receipt);
        if (amountEl) amountEl.textContent = '￥0';
        var brandEl = $('#sxg-t-amount-brand', receipt);
        if (brandEl) brandEl.textContent = '￥0';
      });
    });

    // 小票主体：样式与内置卡片的小票保持一致
    var receipt = el('div', 'receipt-tear-top receipt-tear-bottom sxg-mono');
    receipt.style.cssText =
      'background:#faf8f5;color:#0f172a;padding:24px;position:relative;overflow:hidden;' +
      'border-left:1px solid #ebe5dc;border-right:1px solid #ebe5dc;' +
      'box-shadow:0 25px 50px -12px rgba(0,0,0,.45);' +
      'background-image:radial-gradient(rgba(0,0,0,.02) 1px,transparent 0);background-size:8px 8px';

    var stampCls = isC ? 'sxg-stamp sxg-stamp-bad' : 'sxg-stamp sxg-stamp-good';
    var stampTxt = isC ? '违规避雷' : '良心认证';

    receipt.innerHTML =
      '<div class="' + stampCls + '">' + stampTxt + '</div>' +

      '<div class="sxg-dashed" style="text-align:center;padding-bottom:16px">' +
        '<div style="font-size:16px;font-weight:900;letter-spacing:-.02em;color:#020617">' +
        '★ 双休购 · 反向考核小票 ★</div>' +
        '<div class="sxg-xs">SHUANGXIUGOU CONSUMER AUDIT RECEIPT</div>' +
        '<div class="sxg-xs sxg-mono" style="padding-top:4px">NO. ' + code + ' · ' + today + '</div>' +
      '</div>' +

      '<div class="sxg-dashed" style="padding:16px 0">' +
        kv('考核执行官:', '<span class="sxg-bold" id="sxg-t-name">' +
          esc(displayName(profile.name, anonId)) + '</span>') +
        kv('考核品牌:', '<span class="sxg-bold">' + esc(cfg.name) + '</span>') +
        kv('所属企业:', '<span class="sxg-bold">' + esc(cfg.company || '—') + '</span>') +
        kv('企业评级:', '<span class="sxg-bold">' + esc(cfg.grade || 'C级') + '</span>') +
        kv('工时政策:', '<span class="sxg-bold">' + esc(cfg.workPolicy || '—') + '</span>') +
        kv('本品牌累计:', '<span class="sxg-bold" style="color:#059669" id="sxg-t-amount-brand">' +
          '￥' + brandBase + '</span>') +
        kv('全站累计已转移/支持消费:', '<span class="sxg-bold" style="color:#059669" id="sxg-t-amount">' +
          '￥' + profile.total + '</span>') +
        (profile.reason
          ? kv('理由:', '<span class="sxg-bold">' + esc(profile.reason) + '</span>')
          : '') +
      '</div>' +

      '<div class="sxg-dashed" style="padding:16px 0">' +
        '<div class="sxg-p" style="font-style:italic">' +
        '“老板考核你的 KPI，你的钱包考核老板的良心”</div>' +
        '<div class="sxg-xs" style="padding-top:6px">' +
        '本小票为消费立场表达，不构成对任何企业的法律或名誉评价。</div>' +
      '</div>' +

      '<div class="sxg-xs" style="text-align:center;padding-top:12px">' +
        '数据查验来自开源双休购 shuangxiugou.vercel.app' +
      '</div>';

    wrap.appendChild(receipt);

    // 操作按钮
    var actions = el('div', 'sxg-actions');
    actions.style.padding = '0 4px';
    var copyBtn = el('button', 'sxg-btn sxg-btn-primary', '复制小票文本');
    var doneBtn = el('button', 'sxg-btn sxg-btn-dark', '完成');
    copyBtn.addEventListener('click', function () {
      // 以点击这一刻表单里的内容为准。
      var st = refreshPreview();
      var p = st.profile;
      var shown = st.shown;

      // 结算：把「本次新增」并入累计，并把新增额清零，
      // 这样同一次弹窗里再点一次复制不会重复累加。
      //
      // ⚠️ 先保存再清空输入框，顺序反了会在赋值前就把 0 存进去。
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
      if (fTotal) fTotal.textContent = '￥' + baseTotal;
      if (fTotalBrand) fTotalBrand.textContent = '￥' + brandNext;

      var text =
        '【双休购 · 反向考核小票】\n' +
        '凭证编号：' + code + '\n' +
        '考核目标：' + (cfg.name || '') + '\n' +
        '企业评级：' + (cfg.grade || 'C级') + '\n' +
        '考核执行官：' + displayName(p.name, anonId) + '\n' +
        (p.reason ? '理由：' + p.reason + '\n' : '') +
        '本品牌累计：￥' + brandNext + '\n' +
        '全站累计已转移/支持消费：￥' + shown + '\n' +
        '“老板考核你的KPI，你的钱包考核老板的良心”\n' +
        '数据查验来自开源双休购：shuangxiugou.vercel.app';
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () {
          copyBtn.textContent = '已复制 ✓';
          setTimeout(function () { copyBtn.textContent = '复制小票文本'; }, 2000);
        }, function () {
          window.prompt('请手动复制以下小票文本：', text);
        });
      } else {
        window.prompt('请手动复制以下小票文本：', text);
      }
    });
    doneBtn.addEventListener('click', closeLayer);
    actions.appendChild(copyBtn);
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

  // 把纸面金额行改写成「累计已转移/支持消费:￥498」
  // 只在内容不同时才写，避免 MutationObserver 自己触发自己无限循环。
  function paintBuiltinAmount(receipt, total) {
    var span = findBuiltinAmountSpan(receipt);
    if (span) {
      span.id = 'sxg-t-amount';
      var want = '￥' + total;
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
    var wantVal = '￥' + brandVal;
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
    var nameSpan = findValueNode(receipt, '考核执行官:');
    if (nameSpan) {
      nameSpan.id = 'sxg-t-name';
      var nm = displayName(p.name, builtinAnonId);
      if ((nameSpan.textContent || '').trim() !== nm) nameSpan.textContent = nm;
    }
    paintBuiltinAmount(receipt, want);
    paintBuiltinBrandRow(receipt, brandKey, brandWant);
    paintBuiltinReason(receipt, (p.reason || '').trim());
    hideBuiltinAmountInput(receipt);
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
    var okName = !!findValueNode(receipt, '考核执行官:');
    if (!okAmount) diag('内置小票未找到金额行，纸面金额仍是写死的值');
    paintBuiltinBrandRow(receipt, brandKey, brandBase);

    var fTotal = $('#sxg-total', form);
    var fTotalBrand = $('#sxg-total-brand', form);
    if (fTotal) fTotal.textContent = '￥' + baseTotal;
    if (fTotalBrand) fTotalBrand.textContent = '￥' + brandBase;

    // 实时联动
    if (form) {
      var fName = $('#sxg-f-name', form);
      var fAmount = $('#sxg-f-amount', form);
      var fReason = $('#sxg-f-reason', form);
      [fName, fAmount, fReason].forEach(function (input) {
        input.addEventListener('input', function () {
          var shown = previewTotalOf();
          builtinPreview = shown;
          var brandShown = Math.min(brandBase + clampDelta(fAmount.value), MAX_TOTAL);
          builtinBrandPreview = brandShown;
          var nameEl = $('#sxg-t-name', receipt);
          var amountEl = $('#sxg-t-amount', receipt);
          if (nameEl) nameEl.textContent = displayName(fName.value, builtinAnonId);
          if (amountEl) amountEl.textContent = '￥' + shown;
          if (fTotal) fTotal.textContent = '￥' + shown;
          if (fTotalBrand) fTotalBrand.textContent = '￥' + brandShown;
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
        if (fTotal) fTotal.textContent = '￥0';
        if (fTotalBrand) fTotalBrand.textContent = '￥0';
        paintBuiltinAmount(receipt, 0);
        paintBuiltinBrandRow(receipt, brandKey, 0);
      });
    });

    // 用户点「完成 / 复制 / 确认打卡并计入全网总额」才结算本次新增。
    // 用捕获阶段监听，因为这些按钮是 bundle 内部处理的，我们只旁挂结算。
    var box = receipt.closest('.max-w-sm') || receipt.parentNode;
    if (box) {
      box.addEventListener('click', function (ev) {
        var t = (ev.target && ev.target.textContent) || '';
        var settle = t.indexOf('完成') !== -1
                  || t.indexOf('复制') !== -1
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
        if (fTotal) fTotal.textContent = '￥' + total;
        if (fTotalBrand) fTotalBrand.textContent = '￥' + brandNext;
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