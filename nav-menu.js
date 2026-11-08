/* ==========================================================================
   右下角悬浮导航菜单（PC 常显 / 手机折叠成一个主按钮）
   --------------------------------------------------------------------------
   需求（2026-11-02 站长）：
     1) 「超链接不放顶部」——顶部公告栏不再挂导航链接（同类项目导航 / 成功案例），
        只留「68 家企业 179 条证据」那一个页内锚点（当天下午站长要求恢复）；
     2) PC 版在右下角做常显悬浮菜单；
     3) 手机版做 iOS 那种：只露一个主按钮，点开才加载其余按钮。

   设计取舍：
   - 只收导航项（证据链公示 / 同类项目导航 / 成功案例），既有五个悬浮按钮
     （视频 / TOP / ⤓ / AI / 提醒）保持原样，不并进来。
   - 手机端另挂一条**不可点**的版本号：公告栏不再写版本号（2026-11-02 第五轮
     站长「版本号不要写这里了，加入三横菜单吧，但是 PC 端那边怎么办？」），
     版本号统一由本菜单承载。它不是导航、不是链接，用 <div> + pointer-events:none；
     文本运行时读 DOM 里的 #site-version，不另存哈希。
   - **PC 端没有三横按钮**，所以答案不是"再造一个汉堡"：PC 的菜单本身就是右下角
     常显的横向 pill 串，版本号挂在串尾当独立徽标（8px 间隙 + 自己一圈圆角），
     既满足"进菜单"，也不用为一个版本号改变桌面端交互。
   - PC 端 dock 放在最底部一行的右侧、避开右侧悬浮按钮列（right:72px 让开 16+44 的
     按钮列），横向 pill 常显；<640px 折叠成圆形主按钮。
   - 手机端主按钮放**左下**：右侧从 bottom 48 到 272 已经排满五个按钮，再往那
     一列塞第六个会把按钮阵拉到屏幕中部。左下与右侧「视频」钮对称，视觉不挤。
   - 「点开才加载」是字面实现：条目 DOM 在第一次展开时才创建（_built 标记），
     不是先渲染再靠 CSS 隐藏。PC 端常显，所以桌面直接建。
   - 样式自带 <style>、sxg- 前缀、幂等（已存在直接 return），与 top-button.js
     等同族脚本一致；不使用 Tailwind 类（打包 CSS 里没有未用到的类）。

   与既有悬浮组的关系：
   - z-index 9000，与右侧按钮同层，低于良配吸底条（9990）；
   - 底距统一 calc(var(--sxg-bar-h) + Npx)：条高由 liangpei-ad.js 实测发布，
     条在（<1440px）时自动让开，条关掉时归 0 不留空洞。
   ========================================================================== */
(function () {
  'use strict';

  var ROOT_ID = 'sxg-nav';
  var FAB_ID = 'sxg-nav-fab';
  var PANEL_ID = 'sxg-nav-panel';
  var STYLE_ID = 'sxg-nav-style';

  // 菜单项：只放「导航」，不放假按钮。
  // 「证据链公示」是页内锚点：公告栏在手机上默认折叠成一行，不想点「展开」
  // 的人也能从这儿一步跳到证据链区块（2026-11-02 站长：折叠后跳转要有去处）。
  var ITEMS = [
    { label: '证据链公示', href: '#evidence-board' },
    { label: '同类项目导航', href: './projects.html' },
    { label: '成功案例', href: './success-stories.html' }
  ];

  // 手机端才有的额外菜单项（PC 端右上角按钮保留，不挪下来）
  var MOBILE_ONLY_ITEMS = [
    { label: '提交数据 / 申诉', href: 'https://github.com/dujeongil-galaxy/shuangxiugou/issues', external: true },
    { label: '★ Star on GitHub', href: 'https://github.com/dujeongil-galaxy/shuangxiugou', external: true },
    { label: '☕ 赞助本项目', href: './sponsor.html' },
    { label: '🔑 Login GitHub', href: '#', id: 'menu-login-github' }
  ];

  function buildStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var css = [
      '#sxg-nav{position:fixed;right:72px;bottom:calc(var(--sxg-bar-h, 0px) + 12px + env(safe-area-inset-bottom, 0px));',
      '  z-index:9000;font:600 13px/1 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;',
      '  -webkit-tap-highlight-color:transparent;}',

      /* ≥1440px 良配广告是右上卡片（不吸底），底距不该再让位。
         坑（2026-11-02 实测）：--sxg-bar-h 在桌面也照发（实测 279px，是那张
         卡片的高度），不覆盖的话 dock 会被顶到页面中部。
         同日已把源头改掉（liangpei-ad.js 在 ≥1440px 写 0），这条留着当兜底：
         万一以后变量语义再变，dock 至少不会被顶飞。 */
      '@media (min-width:1440px){#sxg-nav{bottom:12px}}',

      /* 主按钮：手机端才出现 */
      '#sxg-nav-fab{display:none;position:relative;width:46px;height:46px;padding:0;border:none;border-radius:50%;',
      '  background:#0F766E;color:#fff;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.22);',
      '  align-items:center;justify-content:center;transition:background-color .18s,transform .18s;}',
      '#sxg-nav-fab:active{transform:translateY(1px)}',
      '#sxg-nav-fab:focus-visible{outline:2px solid #0F766E;outline-offset:2px}',
      '#sxg-nav-fab svg{display:block}',

      /* 面板：PC 常显（横向 pill 串），手机默认收起 */
      '#sxg-nav-panel{display:flex;flex-direction:row;align-items:center;}',
      '.sxg-nav-item{display:block;padding:9px 13px;background:#fff;color:#0F766E;text-decoration:none;',
      '  border:1px solid #d1d5db;border-right:none;white-space:nowrap;',
      '  transition:background-color .16s,color .16s;}',
      '.sxg-nav-item:first-child{border-radius:19px 0 0 19px}',
      /* 右端收口用 a:last-of-type，不能再用 :last-child ——
         版本号项是 <div>，桌面靠 display:none 藏着，但它仍是 last-child：
         圆角会画到那个看不见的节点上，第三个导航项变成直角收尾
         （2026-11-02 真渲染截图里一眼可见）。 */
      'a.sxg-nav-item:last-of-type{border-right:1px solid #d1d5db;border-radius:0 19px 19px 0}',
      '.sxg-nav-item:hover{background:#0F766E;color:#fff}',
      '.sxg-nav-item:focus-visible{outline:2px solid #0F766E;outline-offset:2px}',

      /* 版本号项（2026-11-02 第五轮）：公告栏里那一行彻底撤掉，改成两端都挂菜单。
         PC 端没有三横按钮，它是常显的横向 pill 串 —— 版本号挂在串尾当**独立徽标**：
         margin-left:8px 断开、自己一圈 19px 圆角。不改 a:last-of-type 的收口圆角，
         因为"导航串"和"版本徽标"本来就是两块东西，连成一条反而像第四个可点的项。
         不是链接，所以用 <div> 且 pointer-events:none —— 顺手把 :hover 一并废掉，
         不靠再写一条 hover 覆盖去追。 */
      '.sxg-nav-ver{margin-left:8px;border-radius:19px;pointer-events:none;cursor:default;',
      '  background:#f3f4f6;color:#6b7280;font-weight:600;}',

      /* 手机：折叠成一个主按钮，面板浮在按钮上方 */
      '@media (max-width:640px){',
      '  #sxg-nav{right:auto;left:14px;bottom:calc(var(--sxg-bar-h, 0px) + 48px + env(safe-area-inset-bottom, 0px));}',
      '  #sxg-nav-fab{display:flex}',
      '  #sxg-nav-panel{display:none;position:absolute;left:0;bottom:calc(100% + 10px);',
      '    flex-direction:column;align-items:stretch;gap:8px;}',
      '  #sxg-nav.is-open #sxg-nav-panel{display:flex}',
      '  .sxg-nav-item{border:1px solid #d1d5db;border-radius:14px;padding:11px 14px;',
      '    box-shadow:0 4px 14px rgba(0,0,0,.14);}',
      '  .sxg-nav-item:first-child,.sxg-nav-item:last-child,a.sxg-nav-item:last-of-type{border-radius:14px;border-right:1px solid #d1d5db}',
      /* 版本号项在手机上跟其余条目一样是竖排的一块，圆角与间距对齐 14px/8px
         （基础规则里的 19px 圆角 + margin-left 是为 PC 横向串尾设计的） */
      '  #sxg-nav .sxg-nav-ver{margin-left:0;border-radius:14px;}',
      '}',

      /* 暗色适配：随笔页一类有 prefers-color-scheme: dark 的页面 */
      '@media (prefers-color-scheme: dark){',
      '  .sxg-nav-item{background:#1f2937;color:#5eead4;border-color:#374151}',
      '  .sxg-nav-item:hover{background:#0F766E;color:#fff}',
      '  .sxg-nav-ver{background:#111827;color:#9ca3af;border-color:#374151}',
      '}',

      /* 手机端隐藏右上角的 4 个按钮（提交数据/Star/赞助/Login），
         它们已经挪到左下角下拉菜单里了（2026-11-08 站长指令） */
      '@media (max-width:640px){',
      '  .sxg-header-btn{display:none !important;}',
      '}'
    ].join('');
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = css;
    document.head.appendChild(style);
  }

  var root, fab, panel;
  var built = false;
  var isOpen = false;

  function isMobile() {
    return window.matchMedia && window.matchMedia('(max-width:640px)').matches;
  }

  // 版本号：运行时从 DOM 里那个唯一真相源节点读，**不在这里另存一份哈希**。
  // 存一份的后果是 sync-version.mjs 只改 index.html，菜单里的会永远停在旧值，
  // 而且没有任何断言会发现（两份数据没有比对源）。
  // 2026-11-02 第五轮：真相源从 `#site-notice .notice-ver` 搬到页面级隐藏节点
  // `#site-version`（公告栏不许再写版本号）。旧选择器保留作回退 —— 旧缓存 HTML
  // 与 notes.html 之类仍可能是老结构，回退总比"读不到就整条不显示"温和。
  function noticeVersion() {
    var el = document.querySelector('#site-version .notice-ver')
      || document.querySelector('#site-notice .notice-ver');
    if (!el) return '';
    return (el.textContent || '').replace(/\s+/g, ' ').trim();
  }

  // 条目 DOM 按需创建：手机端第一次点开才建，PC 端常显所以直接建。
  function ensureItems() {
    if (built || !panel) return;
    built = true;

    // 手机端才把右上角的 4 个按钮挪到下拉菜单里（PC 端右上角保留，不重复）
    var items = ITEMS.slice();
    if (isMobile()) {
      items = MOBILE_ONLY_ITEMS.concat(items);
    }

    items.forEach(function (it) {
      var a = document.createElement('a');
      a.className = 'sxg-nav-item';
      a.href = it.href;
      if (it.external) {
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
      }
      if (it.id) a.id = it.id;
      a.textContent = it.label;
      panel.appendChild(a);
    });
    // 版本号（两端都建、两端都显示）：不能只在手机端建 —— 桌面宽屏加载
    // 时 built 已经置 true，之后把窗口拖窄到 <640px 就不会再补建，
    // 手机上永远少这一条（2026-11-02 首版实测正是这个坑，截图只剩 3 项）。
    // 读不到就干脆不加 —— 别留一个「当前版本号」空壳（notes.html 之类
    // 没挂版本号节点的页面也会加载本脚本）。
    var ver = noticeVersion();
    if (ver) {
      var box = document.createElement('div');
      box.className = 'sxg-nav-item sxg-nav-ver';
      box.textContent = ver;
      panel.appendChild(box);
    }
  }

  function setOpen(next) {
    if (!fab) return;
    if (next) ensureItems();
    isOpen = !!next;
    root.classList.toggle('is-open', isOpen);
    fab.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    fab.setAttribute('aria-label', isOpen ? '收起站点导航' : '展开站点导航');
  }

  function build() {
    if (document.getElementById(ROOT_ID)) return;

    buildStyle();

    root = document.createElement('div');
    root.id = ROOT_ID;

    fab = document.createElement('button');
    fab.id = FAB_ID;
    fab.type = 'button';
    fab.setAttribute('aria-label', '展开站点导航');
    fab.setAttribute('aria-expanded', 'false');
    fab.setAttribute('aria-controls', PANEL_ID);
    // 三横线图标（内联 SVG，不依赖字体/图标库）
    fab.innerHTML = '<svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">'
      + '<path d="M3 5.5h14M3 10h14M3 14.5h14" stroke="currentColor" stroke-width="2" '
      + 'stroke-linecap="round" fill="none"/></svg>';

    panel = document.createElement('div');
    panel.id = PANEL_ID;

    root.appendChild(panel);
    root.appendChild(fab);
    document.body.appendChild(root);

    fab.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      setOpen(!isOpen);
    });

    // 点条目后收起（只手机态）：点「证据链公示」会滚到页面深处的区块，
    // 面板若还浮在左下就正好压在刚滚到的内容上。桌面 dock 常显，无所谓。
    panel.addEventListener('click', function (e) {
      var t = e.target;
      while (t && t !== panel) {
        if (t.tagName === 'A') {
          if (isMobile()) setOpen(false);
          return;
        }
        t = t.parentNode;
      }
    });

    // 点空白处 / 按 Esc 收起（只管手机态的展开）
    document.addEventListener('click', function (e) {
      if (!isOpen) return;
      if (root.contains(e.target)) return;
      setOpen(false);
    });
    document.addEventListener('keydown', function (e) {
      if (!isOpen) return;
      if (e.key === 'Escape' || e.key === 'Esc') {
        setOpen(false);
        if (fab) fab.focus();
      }
    });

    // 跨断点：从手机拖宽到桌面时，面板要常显，条目也得补建
    var mq = window.matchMedia && window.matchMedia('(max-width:640px)');
    var onBp = function () {
      if (!isMobile()) {
        ensureItems();
        if (isOpen) setOpen(false); // 桌面常显，无所谓「展开态」
      }
    };
    if (mq) {
      if (mq.addEventListener) mq.addEventListener('change', onBp);
      else if (mq.addListener) mq.addListener(onBp);
    }

    if (!isMobile()) ensureItems();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build);
  } else {
    build();
  }
})();
