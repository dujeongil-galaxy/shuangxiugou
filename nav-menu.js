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
   - PC 端放在最底部一行的右侧、避开右侧悬浮按钮列（right:72px 让开 16+44 的
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

  function buildStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var css = [
      '#sxg-nav{position:fixed;right:72px;bottom:calc(var(--sxg-bar-h, 0px) + 12px + env(safe-area-inset-bottom, 0px));',
      '  z-index:9000;font:600 13px/1 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;',
      '  -webkit-tap-highlight-color:transparent;}',

      /* ≥1440px 良配广告是右上卡片（不吸底），底距不该再让位。
         坑（2026-11-02 实测）：--sxg-bar-h 在桌面也照发（实测 279px，是那张
         卡片的高度），不覆盖的话 dock 会被顶到页面中部。 */
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
      '.sxg-nav-item:last-child{border-right:1px solid #d1d5db;border-radius:0 19px 19px 0}',
      '.sxg-nav-item:hover{background:#0F766E;color:#fff}',
      '.sxg-nav-item:focus-visible{outline:2px solid #0F766E;outline-offset:2px}',

      /* 手机：折叠成一个主按钮，面板浮在按钮上方 */
      '@media (max-width:640px){',
      '  #sxg-nav{right:auto;left:14px;bottom:calc(var(--sxg-bar-h, 0px) + 48px + env(safe-area-inset-bottom, 0px));}',
      '  #sxg-nav-fab{display:flex}',
      '  #sxg-nav-panel{display:none;position:absolute;left:0;bottom:calc(100% + 10px);',
      '    flex-direction:column;align-items:stretch;gap:8px;}',
      '  #sxg-nav.is-open #sxg-nav-panel{display:flex}',
      '  .sxg-nav-item{border:1px solid #d1d5db;border-radius:14px;padding:11px 14px;',
      '    box-shadow:0 4px 14px rgba(0,0,0,.14);}',
      '  .sxg-nav-item:first-child,.sxg-nav-item:last-child{border-radius:14px;border-right:1px solid #d1d5db}',
      '}',

      /* 暗色适配：随笔页一类有 prefers-color-scheme: dark 的页面 */
      '@media (prefers-color-scheme: dark){',
      '  .sxg-nav-item{background:#1f2937;color:#5eead4;border-color:#374151}',
      '  .sxg-nav-item:hover{background:#0F766E;color:#fff}',
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

  // 条目 DOM 按需创建：手机端第一次点开才建，PC 端常显所以直接建。
  function ensureItems() {
    if (built || !panel) return;
    built = true;
    ITEMS.forEach(function (it) {
      var a = document.createElement('a');
      a.className = 'sxg-nav-item';
      a.href = it.href;
      a.textContent = it.label;
      panel.appendChild(a);
    });
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
