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
      '.sxg-form-tip{font-size:11px;color:rgba(255,255,255,.6);line-height:1.6;margin-top:10px}'
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
  function displayName(name) {
    var s = (name || '').trim();
    if (s) return s;
    return '匿名打工人 #' + Math.floor(1000 + Math.random() * 9000);
  }

  // 自定义卡与内置卡共用的填写区，避免两处 UI 走样
  function buildProfileForm(profile) {
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
          '<span class="sxg-total">累计 <b id="sxg-total">￥0</b></span>' +
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
    var form = buildProfileForm(profile);
    wrap.appendChild(form);

    var fName = $('#sxg-f-name', form);
    var fAmount = $('#sxg-f-amount', form);
    var fReason = $('#sxg-f-reason', form);
    var fTotal = $('#sxg-total', form);

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
      if (nameEl) nameEl.textContent = displayName(p.name);
      if (amountEl) amountEl.textContent = '￥' + shown;
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
          esc(displayName(profile.name)) + '</span>') +
        kv('考核品牌:', '<span class="sxg-bold">' + esc(cfg.name) + '</span>') +
        kv('所属企业:', '<span class="sxg-bold">' + esc(cfg.company || '—') + '</span>') +
        kv('企业评级:', '<span class="sxg-bold">' + esc(cfg.grade || 'C级') + '</span>') +
        kv('工时政策:', '<span class="sxg-bold">' + esc(cfg.workPolicy || '—') + '</span>') +
        kv('累计已转移/支持消费:', '<span class="sxg-bold" style="color:#059669" id="sxg-t-amount">' +
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
      baseTotal = shown;          // 让后续预览以此为新基准
      fAmount.value = '';         // 已结算，别让用户误以为还能再加一次
      if (fTotal) fTotal.textContent = '￥' + baseTotal;

      var text =
        '【双休购 · 反向考核小票】\n' +
        '凭证编号：' + code + '\n' +
        '考核目标：' + (cfg.name || '') + '\n' +
        '企业评级：' + (cfg.grade || 'C级') + '\n' +
        '考核执行官：' + displayName(p.name) + '\n' +
        (p.reason ? '理由：' + p.reason + '\n' : '') +
        '累计已转移/支持消费：￥' + shown + '\n' +
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

  /* ------------------- 内置品牌卡的小票：DOM 层接管（不改压缩包） -------------------
     内置小票由压缩包里的 React 组件渲染，「清醒打工人 #7709」和金额 199
     都写死在构建产物里。改压缩包风险高（34 万字符，改错整站白屏），
     且下次重新构建会被覆盖。

     这里的做法：等内置小票渲染出来后，用 DOM 找到那两个文本节点，
     换成访客填的值，并在小票上方插入同一套填写区。
     —— 视觉与自定义卡完全一致，且与构建流程解耦。            */

  var builtinPatched = null;

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
  var TOTAL_LABEL = '累计已转移/支持消费:';

  // 用户正在输入时的预览值。null 表示以存档的 profile.total 为准。
  // React 重渲染会把纸面内容冲回写死的 199，observer 触发 syncBuiltin
  // 重绘时必须用这个值，否则用户填到一半的预览会被 199 覆盖掉。
  var builtinPreview = null;

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
  function syncBuiltin(receipt) {
    var p = loadProfile();
    var want = builtinPreview != null ? builtinPreview : p.total;
    var nameSpan = findValueNode(receipt, '考核执行官:');
    if (nameSpan) {
      nameSpan.id = 'sxg-t-name';
      var nm = displayName(p.name);
      if ((nameSpan.textContent || '').trim() !== nm) nameSpan.textContent = nm;
    }
    paintBuiltinAmount(receipt, want);
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
    var form = buildProfileForm(profile);
    if (form && receipt.parentNode) {
      receipt.parentNode.insertBefore(form, receipt);
    }

    // 纸面金额与标签一次画好。找不到金额行时必须出声，
    // 不能再像以前那样静默失败 —— 静默失败正是这个 bug 上线的直接原因。
    var okAmount = paintBuiltinAmount(receipt, baseTotal);
    var okName = !!findValueNode(receipt, '考核执行官:');
    if (!okAmount) diag('内置小票未找到金额行，纸面金额仍是写死的值');

    var fTotal = $('#sxg-total', form);
    if (fTotal) fTotal.textContent = '￥' + baseTotal;

    // 实时联动
    if (form) {
      var fName = $('#sxg-f-name', form);
      var fAmount = $('#sxg-f-amount', form);
      var fReason = $('#sxg-f-reason', form);
      [fName, fAmount, fReason].forEach(function (input) {
        input.addEventListener('input', function () {
          var shown = previewTotalOf();
          builtinPreview = shown;
          var nameEl = $('#sxg-t-name', receipt);
          var amountEl = $('#sxg-t-amount', receipt);
          if (nameEl) nameEl.textContent = displayName(fName.value);
          if (amountEl) amountEl.textContent = '￥' + shown;
          if (fTotal) fTotal.textContent = '￥' + shown;
          paintBuiltinReason(receipt, (fReason.value || '').trim());
        });
      });
    }

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
        // 结算后清空新增额并以新累计为基准，连点两次不会加两次
        baseTotal = total;
        builtinPreview = total;
        if (fA) fA.value = '';
        if (fTotal) fTotal.textContent = '￥' + total;
        paintBuiltinAmount(receipt, total);
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

      // 点赞 / 点踩：按用户要求暂不实现，先明确置灰避免误以为坏了
      $$('button', card).forEach(function (b) {
        var txt = (b.textContent || '').trim();
        if (/^\d+$/.test(txt) || /^\d+$/.test((b.querySelector('span') || {}).textContent || '')) {
          b.classList.add('sxg-vote-off');
          b.setAttribute('title', '点赞/点踩需要数据库支持，暂未开放');
          b.setAttribute('aria-disabled', 'true');
        }
      });
    });
  }

  /* ------------------------------------------------------------------ 杂项 */

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