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
 *   D 级 = 站长人工干预级。判据（2026-11-03 扩为三类，占一条即够格）：
 *        ① 指令性规避法律风险安排加班（标本：奇瑞 2023-03 内部邮件「请想办法（规避法律风险）」）
 *        ② 公开倡导、以加班为荣  ③ 劝导／诱导员工放弃法定社保等义务。
 *        **AI 不得自行判 D**：D 只由站长人工介入判定，详情页必须留「人工干预记录」，
 *        这是全站唯一一档「人的结论高于数据推演」的记录，视觉用**近黑深红** + 卡内备注条。
 *
 *        2026-11-03 站长拍板的现状（重要，别按老版本理解）：
 *        - **奇瑞已回退 C 级**（站长：「D级还原为C级吧…不然越改越混乱」），bundle 内不再有 D 档卡；
 *        - **当前唯一 D 级是 BOSS直聘**，它属「平台类目」——不是用工单位、不适用双休判档，
 *          是三类判据之外的**站长主观定级例外**（理由单列，见 brand/bosszhipin.html）；
 *        - BOSS直聘 在首页只出现在静态证据板（无 bundle 卡片），所以 **D_BRANDS 为空数组**——
 *          本补丁只负责「bundle 卡片上的 D 徽标」，证据板/详情页是手写 HTML，不需要补丁。
 *          将来若真有 bundle 卡被判 D，把品牌名加回 D_BRANDS 即可。
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
  // 2026-11-03 起为**空**：奇瑞已回退 C（bundle 内 tier:D 归零），
  // 当前唯一 D 级 BOSS直聘 是平台类目，只出现在静态证据板 + 详情页，没有 bundle 卡片。
  // 加品牌 = 站长人工降级，必须同时在详情页写入「人工干预记录」区块。
  var D_BRANDS = [];

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
      + '判据见详情页「人工干预记录」（三类：规避法律风险加班／以加班为荣／劝放弃法定社保）';
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
      + '判据与理由见详情页「人工干预记录」——该档位不由 AI 判定，'
      + '只记录站长的人工结论。';
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
    /* 2026-11-04 站长指定：紧接上述说明文字下方换行，
       红色加粗写「抵制垃圾Boss直聘，请使用智联招聘App」（含智联官网链接）。 */
    var b = document.createElement('div');
    b.id = 'sxg-boss-boycott';
    b.setAttribute('style', 'margin-top:4px;font-size:14px;font-weight:900;'
      + 'color:#dc2626;text-align:center;line-height:1.6');
    b.innerHTML = '🚫 抵制垃圾Boss直聘，'
      + '请使用<a href="https://www.zhaopin.com" target="_blank" rel="noopener noreferrer"'
      + ' style="color:#1d4ed8;text-decoration:underline">智联招聘App</a>';
    p.appendChild(document.createElement('br'));
    p.appendChild(b);
    /* 2026-11-04 站长指定：抵制行下方挂 BOSS直聘详情页入口——
       「点击这里阅读 狗日的Boss直聘」，「这里」是链接，
       「狗日的Boss直聘」单独换色标注。 */
    var r = document.createElement('div');
    r.setAttribute('style', 'margin-top:4px;font-size:13px;text-align:center;line-height:1.6');
    r.innerHTML = '点击<a href="./brand/bosszhipin.html"'
      + ' style="color:#1d4ed8;text-decoration:underline">这里</a>阅读 '
      + '<span style="color:#d97706;font-weight:bold">狗日的Boss直聘</span>';
    p.appendChild(r);
    /* 2026-11-06 站长指定：抵制区末尾追加「海比优」一句 + 固定末句。
       海比优文案由站长提供英文 Application Introduction，此处译写一句中文；
       末句一字不改（含「；」不换行）：应用商店搜索（开发中，限号注册）+ 与本站无关声明。 */
    var h = document.createElement('div');
    h.setAttribute('style', 'margin-top:6px;font-size:13px;text-align:center;'
      + 'line-height:1.7;color:#475569');
    h.textContent = '海比优（Haibiyou）是一款认真做招聘的求职平台，'
      + '为求职者筛选真实可靠的企业岗位，也帮企业快速找到优秀人才。';
    p.appendChild(h);
    var f = document.createElement('div');
    f.setAttribute('style', 'margin-top:4px;font-size:13px;text-align:center;'
      + 'line-height:1.7;color:#475569');
    f.textContent = '欢迎前往各大手机应用商店搜索（开发中，限号注册）；推广内容与本站无关，站长不会收取任何广告费。';
    p.appendChild(f);
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
    p.textContent = '其中 ' + n + ' 家为 D 级 · 站长人工介入降级'
      + '（已计入上表避雷预警；该档位不由 AI 判定，理由见各详情页「人工干预记录」）';
    var uNote = document.getElementById(NOTE_ID);
    grid.parentElement.insertBefore(p, uNote ? uNote.nextSibling : grid.nextSibling);
  }

  /* ---------------------------------------------------------- 评级过滤条 D/U 按钮
   * bundle 的评级过滤按钮数组写死 [`全部`,`S`,`A`,`B`,`C`]，过滤表达式
   * `c===\`全部\`||e.tier===c` —— U/D 卡在选中任何具体档位时都被 React 在
   * 内存里滤掉（DOM 上根本没有这张卡）。2026-11-02 站长截图指出：评级过滤
   * 只有 S/A/B/C 四个按钮，新增 D 级后全站检查发现此漏。
   * bundle 铁律不许改 → 往过滤条尾部注入「D 级」「U 级」两个按钮，
   * 点击时做 DOM 层 display 过滤。
   *
   * 与 stat-filter 四格筛选的互斥：stat-filter 的 ROW_RATING_TEXTS 已同步加
   * 'D 级','U 级' —— 它在 document capture 阶段先清五格筛选，然后本模块再
   * 隐藏，顺序天然正确，不会互刷。
   *
   * 恢复只清自己打的标记（data-sxg-gf），绝不动 stat-filter / 自定义卡过滤
   * 设置的 display 状态。
   *
   * 已知限制（如实写在这里）：用户选 React 的「C 级」时，D 卡被 React 内存
   * 过滤、DOM 上不存在，DOM 补丁无法复活 —— C 视图不含 D 卡，看 D 卡要用
   * 本补丁的「D 级」按钮。根治只能改 bundle（红线），暂不做。
   *
   * 自定义卡跳过：它们的显隐由 index.html filterCustomCards 管（那边已同步
   * 认得 'D 级','U 级' 按钮），本模块若再插手会两头打架。
   */
  var GF_MARK = 'data-sxg-gf';        // 本模块隐藏过的卡的标记（恢复只清这个）
  var GF_BTN_ATTR = 'data-sxg-gf-btn';
  var GF_LETTERS = ['D', 'U'];
  var gfActive = null;                // null | 'D' | 'U'

  /* 单一真相源：把当前 U/D 激活态同步给 index.html 的 filterCustomCards。
   * 2026-11-04 修复「从某档切到 U 级时 C 级卡泄漏」：filterCustomCards 原本靠
   * 扫描按钮 className(bg-slate-900) 判激活，而 React 重渲染会重建评级条、丢失该
   * 类，导致误判「无选中」回退「全部评级」。这里直接写入 window.__sxgGradeFilter
   * （'U 级'/'D 级'/'all'），filterCustomCards 优先采信，跨重渲染稳定。 */
  try { window.__sxgGradeFilter = 'all'; } catch (e) {}
  function gfSetActive(v) {
    gfActive = v;
    try { window.__sxgGradeFilter = v ? (v + ' 级') : 'all'; } catch (e) {}
  }
  var gfBar = null;                   // 评级过滤按钮容器
  var _scanTimer = null;              // 统一的 scan 防抖计时器（16ms = 一帧）
  var _observer = null;               // MutationObserver 实例
  var _skipMO = false;                // scan() 执行期间设为 true，防止 MO 触发自己
  var _userActionPending = false;     // 用户操作后设为 true，scan() 跳过 gfSyncAndApply()
  var _overlayTimer = null;           // 遮罩层定时器
  var ROW_RATING_TEXTS = ['全部评级', 'S 级', 'A 级', 'B 级', 'C 级', 'D 级', 'U 级'];

  // 2026-11-03 新增：评级过滤切换时的加载遮罩（掩盖 DOM 操作的闪烁）
  // 参考首页加载动画方案：点击按钮 → 显示遮罩 0.5 秒 → 移除遮罩显示结果
  var GF_OVERLAY_ID = 'sxg-gf-overlay';
  function showFilterOverlay() {
    if (document.getElementById(GF_OVERLAY_ID)) return;  // 已显示
    var overlay = document.createElement('div');
    overlay.id = GF_OVERLAY_ID;
    overlay.setAttribute('style', [
      'position:fixed', 'top:0', 'left:0', 'right:0', 'bottom:0',
      'z-index:9999', 'background:rgba(255,255,255,0.85)',
      'display:flex', 'align-items:center', 'justify-content:center',
      'font-size:16px', 'color:#475569', 'font-weight:600',
      'transition:opacity 0.15s ease-out'
    ].join(';'));
    overlay.textContent = '正在切换评级…';
    document.body.appendChild(overlay);
  }
  function hideFilterOverlay() {
    var overlay = document.getElementById(GF_OVERLAY_ID);
    if (!overlay) return;
    // 淡出动画
    overlay.style.opacity = '0';
    setTimeout(function() {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }, 150);
  }
  function scheduleHideOverlay() {
    // 0.5 秒后移除遮罩（给用户足够时间看到动画，同时掩盖 DOM 操作）
    if (_overlayTimer) clearTimeout(_overlayTimer);
    _overlayTimer = setTimeout(function() {
      _overlayTimer = null;
      hideFilterOverlay();
    }, 500);
  }
  function _scheduleScan() {
    if (_scanTimer) {
      clearTimeout(_scanTimer);  // 清除旧的定时器，确保最后一次点击后 16ms 才执行
    }
    _scanTimer = setTimeout(function () {
      _scanTimer = null;
      scan();
    }, 16);
  }

  function gfCardTier(card) {
    if ((card.textContent || '').indexOf('虚拟对比黑榜') !== -1) return 'V';
    var f = card.getAttribute(TIER_ATTR);           // U/D 卡由 scan() 打标记
    if (f) return f;
    var nodes = card.querySelectorAll('span,div');
    for (var i = 0; i < nodes.length; i++) {
      var s = (nodes[i].textContent || '').trim();
      var m = /^(S|A|B|C|D|U)\s*级/.exec(s);        // 与 stat-filter cardTier 同正则
      if (m) return m[1];
    }
    // U/D 徽标可能尚未注入（scan 是异步多拍的）：按品牌名兜底认定
    var h = card.querySelector('h3, h2');
    var name = h ? (h.textContent || '') : '';
    if (nameHit(name, D_BRANDS)) return 'D';
    if (nameHit(name, U_BRANDS)) return 'U';
    return null;
  }

  function gfFindBar() {
    // bundle: <div class="flex flex-wrap items-center gap-2"><span>评级过滤:</span>…buttons
    var spans = document.querySelectorAll('span');
    for (var i = 0; i < spans.length; i++) {
      if ((spans[i].textContent || '').trim() === '评级过滤:') {
        var bar = spans[i].parentElement;
        if (bar && bar.querySelector('button')) return bar;
      }
    }
    return null;
  }

  function gfSetBtnState(btn, on) {
    btn.className = 'text-xs px-3 py-1 rounded-md font-mono font-bold transition ' +
      (on ? 'bg-slate-900 text-white' : 'bg-slate-100 hover:bg-slate-200 text-slate-600');
  }

  function gfEnsureButtons() {
    gfBar = gfFindBar();
    if (!gfBar) return;
    var buttons = gfBar.querySelectorAll('button');
    var mine = [];
    for (var i = 0; i < buttons.length; i++) {
      if (buttons[i].hasAttribute(GF_BTN_ATTR)) mine.push(buttons[i]);
    }
    if (mine.length === GF_LETTERS.length) return;   // 已在（React 没重建过滤条）
    // 缺失/部分缺失：React 重建了按钮数组 —— 清掉残缺的重注
    for (var j = 0; j < mine.length; j++) mine[j].parentNode.removeChild(mine[j]);
    var last = buttons.length ? buttons[buttons.length - 1] : null;
    // React 重建后 last 可能又是自己的旧按钮（已删）——重新取
    var all = gfBar.querySelectorAll('button');
    last = all.length ? all[all.length - 1] : null;
    for (var k = 0; k < GF_LETTERS.length; k++) {
      var b = document.createElement('button');
      b.setAttribute(GF_BTN_ATTR, '1');
      b.setAttribute('data-sxg-gf-letter', GF_LETTERS[k]);
      b.type = 'button';
      b.textContent = GF_LETTERS[k] + ' 级';
      b.title = GF_LETTERS[k] === 'D'
        ? 'D 级 · 站长人工介入降级（不由 AI 判定，理由见详情页「人工干预记录」）'
        : 'U 级 · 证据不足（已尽合理检索仍无可采信证据，不评级）';
      gfSetBtnState(b, gfActive === GF_LETTERS[k]);
      if (last && last.parentNode === gfBar) last.parentNode.insertBefore(b, last.nextSibling);
      else gfBar.appendChild(b);
      last = b;
    }
    if (!gfBar.getAttribute('data-sxg-gf-bound')) {
      gfBar.setAttribute('data-sxg-gf-bound', '1');
      gfBar.addEventListener('click', gfOnClick);
    }
  }

  /* 把 React 的评级过滤弹回「全部评级」，确保 U/D 卡片进入 DOM。
   * 根因（2026-11-04 站长实测）：React 的评级过滤会按 tier 在内存里过滤卡片，
   * 选中 S/A/B/C 任一具体档位时，U/D 卡根本不在 DOM 里——我们这层 DOM 补丁只能
   * hide 现存的卡，唤不回 React 删掉的卡。所以激活 U/D 前必须先让 React 回到「全部」，
   * 等它把全部卡片（含 U/D）渲染进来，再做 DOM 层 hide。
   * 返回 true 表示确实点了「全部评级」（需等 React 异步重渲染）；false 表示已在全部。 */
  function gfResetReactToAll() {
    if (!gfBar) return false;
    var allBtn = null;
    var btns = gfBar.querySelectorAll('button');
    for (var i = 0; i < btns.length; i++) {
      if ((btns[i].textContent || '').trim() === '全部评级') { allBtn = btns[i]; break; }
    }
    if (!allBtn) return false;
    var active = allBtn.className.indexOf('bg-slate-900') !== -1;
    if (active) return false;        // 已在全部，无需点
    allBtn.click();                  // 触发 React 重渲染（异步）；其捕获监听会先把 gfActive 临时清零
    return true;
  }

  function gfOnClick(e) {
    var btn = e.target && e.target.closest ? e.target.closest('button') : null;
    if (!btn || !gfBar.contains(btn)) return;
    // 只处理我们自己的 D/U 按钮（带 GF_BTN_ATTR 属性）
    if (btn.hasAttribute(GF_BTN_ATTR)) {
      var letter = btn.getAttribute('data-sxg-gf-letter');
      var willActivate = (gfActive !== letter);
      // 再点同一个 = 取消（回到全部评级；React state 保持「全部」，列表仍是全量）
      gfSetActive(willActivate ? letter : null);
      // 2026-11-03 新增：显示加载遮罩（掩盖 DOM 操作的闪烁）
      showFilterOverlay();
      if (willActivate) {
        var needed = gfResetReactToAll();   // 弹回全部；点击会触发捕获监听把 gfActive 临时清零
        if (needed) {
          gfSetActive(letter);                // 重新置回激活态（捕获监听已把它重置）
          // React 重渲染是异步的，等它把全部卡片（含 U/D）渲染进 DOM 后再应用我们的过滤。
          // 用定时器兜底；同时 MO 在 React 重渲染完也会触发 scan()→gfSyncAndApply() 做同样的事。
          setTimeout(function () {
            try { injectU(); } catch (_) {}
            try { injectD(); } catch (_) {}
            gfSetActive(letter);
            gfSyncAndApply();
          }, 150);
          _userActionPending = true;        // 拦住 16ms 那次 scan，别在 React 重渲染前误应用
          scheduleHideOverlay();
          return;                            // 跳过下方的立即 gfSyncAndApply
        }
        gfSyncAndApply();
      } else {
        gfSyncAndApply();
      }
      _userActionPending = true;  // 标记用户操作，scan() 跳过重复的 gfSyncAndApply()
      // 0.5 秒后移除遮罩
      scheduleHideOverlay();
      // 16ms 后补一次 scan，确保状态同步
      _scheduleScan();
    }
    // React 按钮的点击由捕获监听器（第370-391行）处理，这里不再重复处理
  }

  // 2026-11-03 修复闪烁：在捕获阶段监听 React 按钮点击，同步清除我们的过滤状态
  // 这样在 React 重渲染之前，gfActive 已经是 null，避免 MO 触发时的级联重绘
  // 2026-11-03 再优化（反复切换 C↔D 卡顿）：点击 React 按钮后，立即同步按钮状态 +
  // 设置标志位跳过 MO 的重复触发 + 延迟 100ms 再同步一次（等 React 重渲染完成）
  // 2026-11-03 修复误拦截：排除我们自己的 D/U 按钮（data-sxg-gf-btn），只拦截 React 按钮
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || t.tagName !== 'BUTTON') return;
    // 排除我们自己的 D/U 按钮（它们有 data-sxg-gf-btn 属性）
    if (t.hasAttribute(GF_BTN_ATTR)) return;
    var text = (t.textContent || '').trim();
    if (ROW_RATING_TEXTS.indexOf(text) === -1) return;
    // 用户点击了 React 的评级按钮（全部/S/A/B/C），同步清除我们的状态
    if (gfActive || document.getElementById(GF_EMPTY_ID)) {
      // 2026-11-03 新增：显示加载遮罩（掩盖 DOM 操作的闪烁）
      showFilterOverlay();
      gfSetActive(null);
      gfClear();
      if (gfBar) {
        var mine = gfBar.querySelectorAll('[' + GF_BTN_ATTR + ']');
        for (var i = 0; i < mine.length; i++) {
          gfSetBtnState(mine[i], false);
        }
      }
      gfEmptyNote();
      _userActionPending = true;  // 标记用户操作，scan() 跳过重复的 gfSyncAndApply()
      // 0.5 秒后移除遮罩
      scheduleHideOverlay();
      // 16ms 后补一次 scan
      _scheduleScan();
    }
  }, true);

  function gfSyncStyles() {
    if (!gfBar) return;
    var mine = gfBar.querySelectorAll('[' + GF_BTN_ATTR + ']');
    for (var i = 0; i < mine.length; i++) {
      gfSetBtnState(mine[i], gfActive === mine[i].getAttribute('data-sxg-gf-letter'));
    }
    // 我们激活时压掉 React 按钮的选中态（React state 没变，不会自己改回来）
    if (gfActive) {
      var theirs = gfBar.querySelectorAll('button:not([' + GF_BTN_ATTR + '])');
      for (var j = 0; j < theirs.length; j++) {
        var cn = theirs[j].className || '';
        if (cn.indexOf('bg-slate-900') !== -1) {
          theirs[j].className = cn
            .replace('bg-slate-900', 'bg-slate-100')
            .replace('text-white', 'text-slate-600');
        }
      }
    }
  }

  /* 结构防护栏（2026-11-03 修 bug 加，别删）：
     CARD_SEL 是按 Tailwind 类名拼的，命中面比「品牌卡」宽 ——
     「搜索 + 品类 + 评级过滤」那一整块操作区容器
     （div.bg-white.p-4.rounded-2xl.border.border-slate-200.shadow-sm.space-y-4）
     同样命中。它没有品牌标题、识别不到档位，早期版本按 `tier !== gfActive`
     一刀切 → 点「D 级 / U 级」把拼音搜索框整个藏掉（站长 2026-11-03 实测）。
     两道闸：
       ① 只认带品牌标题（h2/h3）的节点为卡片（结构判据，不依赖文案内容）；
       ② 档位识别不到就一律不动（与 stat-filter.js applyTierFilter 的
          `tier === null → return` 同口径，宁漏标不许误伤布局）。
     注：工牌/证据板等非卡片区块有的也带 h2/h3，但它们没有档位徽标，
     会被第②道闸挡住。 */
  function gfIsCard(node) {
    return !!(node.querySelector('h3, h2'));
  }

  function gfUnmark(node) {
    if (node.getAttribute(GF_MARK)) {
      node.style.display = '';
      node.removeAttribute(GF_MARK);
    }
  }

  function gfApply() {
    var cards = document.querySelectorAll(CARD_SEL);
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      // 自定义卡（id 形如 xxx-card）由 index.html filterCustomCards 管，跳过
      if (card.id && /-card$/.test(card.id)) { gfUnmark(card); continue; }
      if (!gfIsCard(card)) { gfUnmark(card); continue; }   // 布局容器：永远不碰
      var tier = gfCardTier(card);
      if (!tier) { gfUnmark(card); continue; }             // 档位未知：不动
      if (gfActive && tier !== gfActive) {
        card.style.display = 'none';
        card.setAttribute(GF_MARK, '1');
      } else {
        gfUnmark(card);
      }
    }
  }


  function gfClear() {
    var marked = document.querySelectorAll('[' + GF_MARK + ']');
    for (var i = 0; i < marked.length; i++) {
      marked[i].style.display = '';
      marked[i].removeAttribute(GF_MARK);
    }
  }

  function gfSyncAndApply() {
    gfSyncStyles();
    gfApply();
    gfEmptyNote();
  }

  /* D 级空态提示（2026-11-03 新增）：
     D 级现在没有 bundle 卡片 —— 唯一一家 BOSS直聘 是平台类目，只在静态证据板 + 详情页。
     于是「点 D 级」会筛出空面板，看起来像 bug。这里补一条说明，指向证据板对应条目。
     只在「确实一张 D 卡都没有」时出现；将来若有 D 卡自动消失。 */
  var GF_EMPTY_ID = 'sxg-gf-empty';
  function gfEmptyNote() {
    var old = document.getElementById(GF_EMPTY_ID);
    var need = false;
    if (gfActive === 'D') {
      var cards = document.querySelectorAll(CARD_SEL);
      var anyD = false;
      for (var i = 0; i < cards.length; i++) {
        if (gfCardTier(cards[i]) === 'D') { anyD = true; break; }
      }
      need = !anyD;
    }
    if (!need) {
      if (old && old.parentNode) old.parentNode.removeChild(old);
      return;
    }
    if (old) return;
    // 锚点必须是**真卡片**：CARD_SEL 的第一个命中是搜索/筛选操作区容器，
    // 插在它前面会把提示条塞到搜索框上方（2026-11-03 同批修）。
    var all = document.querySelectorAll(CARD_SEL);
    var first = null;
    for (var j = 0; j < all.length; j++) {
      if (gfIsCard(all[j])) { first = all[j]; break; }
    }
    if (!first || !first.parentNode) return;
    var p = document.createElement('div');
    p.id = GF_EMPTY_ID;
    p.setAttribute('style', 'margin:0 0 14px;padding:10px 12px;border-radius:8px;'
      + 'background:#fef2f2;border:1px solid #fecaca;color:#991b1b;font-size:13px;line-height:1.7');
    p.innerHTML = '本站 <strong>D 级 1 家</strong>——BOSS直聘（平台类目例外，站长人工介入定级）。'
      + '它是招聘平台、没有企业用工卡，所以卡片区筛不出结果；'
      + '请到下方 <a href="javascript:void(0)" onclick="window.__sxgOpenEvidenceBoard(\'ev-bosszhipin\')" '
      + 'style="color:#991b1b;font-weight:700;text-decoration:underline;cursor:pointer">'
      + '「全站证据链公示」</a> 查看它的评级理由（点击自动展开并跳转）。';
    first.parentNode.insertBefore(p, first);
  }

  function gfEnsure() {
    gfEnsureButtons();
    // React 重渲染（搜索/品类/点赞）会重建卡片与过滤条：重放当前过滤态
    // 注意：不调用 gfSyncAndApply()，避免在 scan() 中重复修改 DOM
    // gfSyncAndApply() 的调用由 gfOnClick 和捕获监听器负责
  }

  function scan() {
    // 2026-11-03 修复反复切换 C↔D 延迟动画：
    // 根因是 scan() 每次都调用 gfSyncAndApply()，而用户操作后已经调用过了
    // 重复操作 DOM 导致延迟动画（用户点 D → gfOnClick 调用 → 16ms 后 scan 又调用）
    // 新方案：用 _userActionPending 标志位区分用户操作和 React 重渲染
    if (scan._running) { scan._pending = true; return; }
    scan._running = true;
    _skipMO = true;  // 开始执行，MO 检测到变化也不触发 scan()
    try {
      try { injectD(); } catch (e) { warn(e); }
      try { injectU(); } catch (e) { warn(e); }
      try { injectStatNote(); } catch (e) { warn(e); }
      try { injectDStatNote(); } catch (e) { warn(e); }
      try { gfEnsureButtons(); } catch (e) { warn(e); }
      // 只有 React 重渲染触发的 scan 才需要重新应用过滤（用户操作后已应用过）
      if (!_userActionPending && gfActive) { try { gfSyncAndApply(); } catch (e) { warn(e); } }
      _userActionPending = false;  // 重置标志位
    } finally {
      scan._running = false;
      _skipMO = false;  // 执行完毕，恢复 MO 监听
      if (scan._pending) { scan._pending = false; _scheduleScan(); }
    }
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
  // 2026-11-03 修复反复切换 C↔D 闪烁：移除 gfApplyingFilter 机制，改用统一的 16ms 防抖
  // 所有触发点（gfOnClick / 捕获监听器 / MO）都用 _scheduleScan()，避免计时器互相覆盖
  // scan() 执行期间会断开 MO，执行完再重新连接，彻底切断反馈循环
  try {
    _observer = new MutationObserver(function () {
      // 16ms 防抖，几乎无延迟
      _scheduleScan();
    });
    _observer.observe(document.body, { childList: true, subtree: true });
  } catch (e) { /* 无 MO 时退化为上面的定时扫描 */ }
})();
