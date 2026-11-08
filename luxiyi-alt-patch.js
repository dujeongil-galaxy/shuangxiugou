// ============================================================
// 奶茶／新茶饮类 B/C 级品牌 → 平替统一推荐「陆喜依」
//
// 站长 2026-11-08 指令：「奶茶类品牌，只要是 B 级或 C 级的，平替一律
// 可以推荐『陆喜依』并 URL 天猫旗舰店」，并明确「注意不要泄露我自己的
// 账号 id」。给来的分类页链接带来源追踪码、店铺类目参数，且会跳登录页；
// 逐个参数查过后清洗成零参数店铺首页（原始带参地址不写入仓库任何文件）。
//
// 为什么是 DOM 补丁而不是改数据：
//   ① 内置卡的推荐位由压缩产物 assets/index-YthXZ9eP.js 的 alternatives
//      渲染，项目红线是不动这个 bundle（多一个字符就可能白屏且无报错）；
//   ② 自定义卡的推荐位在 index.html 注入层里被 recommendText 整体替换，
//      硬塞链接会破坏那套红/绿警示框的语义。
//   所以两边统一在渲染层追加一个独立的「双休平替推荐」小块，幂等、可逆，
//   与卡片同生共死，React 重渲染后由 MutationObserver 补回。
//
// 单一真相源：下面的 TARGETS 就是「奶茶／新茶饮类 B/C 级」清单，
// 由 scripts/verify.mjs §26 反查 index.html 的 grade 字段强制对齐。
// ============================================================
(function () {
  'use strict';

  var SHOP_URL = 'https://luxiyi.tmall.com/';
  var MARK = 'data-luxiyi-alt';
  var NOTE = '陆喜依主销刺梨原液等果汁饮品，与现制茶饮不是同一类目；按「优先支持公开双休制度企业」的用脚投票口径推荐，不构成商业背书或广告。';

  // id 命中自定义卡（注入层给卡片写了 id）；内置卡靠标题文本定位。
  var TARGETS = [
    { id: 'chabaidao-card', name: '茶百道', grade: 'C级' },
    { id: 'yidiandian-card', name: '一点点', grade: 'C级' },
    { id: 'molina-card', name: '茉莉奶白', grade: 'C级' },
    { id: 'heytea', name: '喜茶 (HEYTEA)', grade: 'C级' },
    { id: 'mixue', name: '蜜雪冰城 (MIXUE)', grade: 'C级' },
    { id: 'chagee', name: '霸王茶姬 (CHAGEE)', grade: 'C级' }
  ];

  function isBC(g) { return g === 'B级' || g === 'C级'; }

  function findBuiltinCard(name) {
    var heads = document.querySelectorAll('h2, h3');
    for (var i = 0; i < heads.length; i++) {
      var h = heads[i];
      if ((h.textContent || '').trim().indexOf(name) !== 0) continue;
      var node = h.parentElement;
      while (node && node !== document.body && !/rounded-2xl/.test(node.className || '')) {
        node = node.parentElement;
      }
      if (node && node !== document.body) return node;
    }
    return null;
  }

  function findCard(t) {
    var byId = document.getElementById(t.id);
    if (byId) return byId;
    return findBuiltinCard(t.name);
  }

  function buildBox() {
    var box = document.createElement('div');
    box.setAttribute(MARK, '1');
    box.style.cssText = [
      'margin-top:12px', 'padding:10px 12px', 'border:1px solid #a7f3d0',
      'border-radius:12px', 'background:#ecfdf5', 'color:#047857',
      'font-size:12px', 'line-height:1.7'
    ].join(';');

    var head = document.createElement('div');
    head.style.fontWeight = '800';
    head.style.fontSize = '13px';
    head.textContent = '双休平替推荐 · 陆喜依（S 级 · 公开双休制度，员工实测待补）';
    box.appendChild(head);

    var linkRow = document.createElement('div');
    var a = document.createElement('a');
    a.href = SHOP_URL;
    a.textContent = '陆喜依天猫旗舰店 ↗';
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
    a.style.cssText = 'color:#047857;font-weight:700;text-decoration:underline';
    linkRow.appendChild(a);
    box.appendChild(linkRow);

    var note = document.createElement('div');
    note.style.cssText = 'margin-top:4px;color:#6b7280;font-size:11px';
    note.textContent = NOTE;
    box.appendChild(note);
    return box;
  }

  function applyOne(t) {
    if (!isBC(t.grade)) return false;
    var card = findCard(t);
    if (!card) return false;
    if (card.querySelector('[' + MARK + '="1"]')) return true; // 幂等
    var box = buildBox();
    var body = card.querySelector('div.p-5') || card;
    body.appendChild(box);
    return true;
  }

  function applyAll() {
    var done = 0;
    for (var i = 0; i < TARGETS.length; i++) {
      if (applyOne(TARGETS[i])) done++;
    }
    return done;
  }

  // React 条件渲染 / 搜索过滤会重建卡片，必须持续补挂。
  function startObserver() {
    var root = document.getElementById('root') || document.body;
    if (!root || typeof MutationObserver === 'undefined') return;
    var scheduled = false;
    var mo = new MutationObserver(function () {
      if (scheduled) return;
      scheduled = true;
      setTimeout(function () {
        scheduled = false;
        try { applyAll(); } catch (e) {
          if (window.console) console.warn('[陆喜依平替] 补挂失败', e);
        }
      }, 80);
    });
    mo.observe(root, { childList: true, subtree: true });
  }

  function boot() {
    applyAll();
    startObserver();
    // bundle 是 type=module，首屏挂载晚于本脚本；补两次延迟重试。
    setTimeout(applyAll, 1200);
    setTimeout(applyAll, 3500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // 测试钩子：JSDOM 里可以直接调 apply() 而不必等 MutationObserver 时序。
  window.__sxgLuxiyiAlt = {
    targets: TARGETS,
    shopUrl: SHOP_URL,
    apply: applyAll
  };
})();
