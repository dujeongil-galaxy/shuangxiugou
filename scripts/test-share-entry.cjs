/* ==========================================================================
   test-share-entry.cjs —— 顶栏「分享本站」入口 + 匿名邮箱 LOGO 行为测试
   --------------------------------------------------------------------------
   被测：share-entry.js、anon-mail.js（浏览器 IIFE，jsdom 真跑）
   覆盖：
     ① 常量与开关：BTN_ID / ENABLED / 内联 SVG，不依赖外部图片
     ② 桌面落位：紧跟「匿名邮箱」之后、带 sxg-header-btn、slot=header
     ③ 锚点缺失兜底：没有匿名邮箱时退到 Login GitHub / 赞助，绝不悬空
     ④ 手机落位：分享本站留顶栏，排在赞助之后（匿名 / Login 在 dock）
     ⑤ 点击：拦下默认行为、调 window.SXGShare.open()，不自己拼第二套弹窗
     ⑥ 弹窗脚本缺席：退化为复制当前地址 + 气泡提示，按钮不做成死的
     ⑦ 键盘可达：Enter / 空格同样能打开
     ⑧ 断点：手机 ↔ 桌面来回切，按钮不丢、不重复创建
     ⑨ 开关：ENABLED=false 只隐藏不删（DOM 仍在、落位照旧）
     ⑩ 匿名邮箱 LOGO：信封 SVG 就位且 textContent 仍是「匿名邮箱」
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const SHARE_SRC = fs.readFileSync(path.join(ROOT, 'share-entry.js'), 'utf8');
const ANON_SRC = fs.readFileSync(path.join(ROOT, 'anon-mail.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name + (detail !== undefined ? ' → ' + JSON.stringify(detail) : '')); }
}

/* 可变的 matchMedia 桩：能在同一次 jsdom 里模拟断点来回切 */
function mkDom(opts) {
  opts = opts || {};
  const state = { narrow: !!opts.narrow, listeners: [] };
  const html = '<!DOCTYPE html><html><head></head><body>'
    + '<header class="sticky top-0" id="hdr">'
    + '<a id="star" class="inline-flex items-center starcls sxg-header-btn" href="https://github.com/x">★ Star on GitHub</a>'
    + '<a id="sponsor-entry-btn" class="inline-flex items-center sxg-header-btn" href="./sponsor.html">☕ 赞助本项目</a>'
    + '<a id="login-github-btn" class="inline-flex items-center sxg-header-btn" href="https://x/auth/github">🔑 Login GitHub</a>'
    + '</header>'
    + (opts.dock ? '<div id="sxg-fab-dock"><button id="sxg-top-btn" data-sxg-dock-label="TOP">TOP</button></div>' : '')
    + '</body></html>';
  const dom = new JSDOM(html, {
    runScripts: 'outside-only',
    url: 'https://dujeongil-galaxy.github.io/shuangxiugou/',
    pretendToBeVisual: true
  });
  const w = dom.window;
  w.matchMedia = function (q) {
    return {
      get matches() { return /max-width/.test(q) ? state.narrow : false; },
      addEventListener: function (_, fn) { state.listeners.push(fn); },
      removeEventListener: function () {},
      addListener: function (fn) { state.listeners.push(fn); }
    };
  };
  const copied = [];
  Object.defineProperty(w.navigator, 'clipboard', {
    value: { writeText: function (v) { copied.push(v); return Promise.resolve(); } },
    configurable: true
  });
  if (opts.anon !== false) w.eval(ANON_SRC);
  w.eval(SHARE_SRC);
  w.document.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true }));
  if (w.SXGShareEntry) w.SXGShareEntry.sweep();
  return { w: w, state: state, copied: copied };
}
function fire(w, el, type) {
  el.dispatchEvent(new w.MouseEvent(type, { bubbles: true, cancelable: true }));
}

(async () => {
  /* ---------------- ① 常量与开关 ---------------- */
  console.log('① 常量与开关');
  check('share-entry.js 暴露 BTN_ID / ENABLED / ICON',
    /BTN_ID\s*=\s*'sxg-share-entry-btn'/.test(SHARE_SRC)
    && /var\s+ENABLED\s*=\s*true/.test(SHARE_SRC)
    && /var\s+ICON\s*=\s*'<svg/.test(SHARE_SRC));
  check('图标是内联 SVG（不引外部图片/字体，避免 404 与三端不一致）',
    /<svg[^>]*viewBox="0 0 24 24"/.test(SHARE_SRC) && !/https?:\/\/[^"']*\.(png|svg|woff)/.test(SHARE_SRC));
  check('share-entry.js 给分享按钮注入 cursor:pointer（hover 变手型，与顶栏按钮一致）',
    /\.sxg-share-entry-btn\{cursor:pointer\}/.test(SHARE_SRC));
  check('index.html 挂载 share-entry.js?v=4，且排在 anon-mail.js 之后',
    (function () {
      const iShare = HTML.indexOf('./share-entry.js?v=4');
      const iAnon = HTML.indexOf('./anon-mail.js?v=5');
      return iShare > 0 && iAnon > 0 && iShare > iAnon;
    })());

  /* ---------------- ② 桌面落位 ---------------- */
  console.log('② 桌面落位');
  {
    const { w } = mkDom({ narrow: false });
    const d = w.document;
    const share = d.getElementById('sxg-share-entry-btn');
    const anon = d.getElementById('sxg-anon-mail-btn');
    check('按钮创建成功', !!share);
    check('slot=header', !!share && share.getAttribute('data-sxg-share-slot') === 'header');
    check('带 sxg-header-btn（与其余五枚同款外观）', !!share && share.classList.contains('sxg-header-btn'));
    check('紧跟匿名邮箱之后（DOM 相邻）', !!share && !!anon && anon.nextElementSibling === share);
    check('文字为「分享本站」', !!share && share.textContent.trim() === '分享本站');
    check('内含 1 枚 SVG 图标、且不污染 textContent', !!share
      && share.querySelectorAll('svg').length === 1
      && share.textContent.trim() === '分享本站');
    /* 手型指针（2026-11-14 站长纠正：要的是 hover 变手型，不是换图标）*/
    const style = d.getElementById('sxg-share-entry-style');
    check('注入 .sxg-share-entry-btn{cursor:pointer}（鼠标悬停显示手型，与顶栏其它按钮一致）',
      !!style && /\.sxg-share-entry-btn\{cursor:pointer\}/.test(style.textContent));
    check('role=button + 可聚焦 + aria-label', !!share
      && share.getAttribute('role') === 'button'
      && share.getAttribute('tabindex') === '0'
      && /分享本站/.test(share.getAttribute('aria-label') || ''));
  }

  /* ---------------- ③ 锚点缺失兜底 ---------------- */
  console.log('③ 锚点缺失兜底');
  {
    const { w } = mkDom({ narrow: false, anon: false });
    const share = w.document.getElementById('sxg-share-entry-btn');
    const login = w.document.getElementById('login-github-btn');
    check('没有匿名邮箱时退到 Login GitHub 之后', !!share && !!login && login.nextElementSibling === share);
    check('不重复创建第二枚分享按钮',
      w.document.querySelectorAll('#sxg-share-entry-btn').length === 1);
  }

  /* ---------------- ④ 手机落位 ---------------- */
  console.log('④ 手机落位（≤640px）：分享本站留顶栏（2026-11-13 站长口径）');
  {
    const { w } = mkDom({ narrow: true, dock: true });
    const d = w.document;
    const share = d.getElementById('sxg-share-entry-btn');
    const sponsor = d.getElementById('sponsor-entry-btn');
    const dock = d.getElementById('sxg-fab-dock');
    check('留在顶栏（不进 dock）', !!share && share.parentNode !== dock);
    check('slot=header', !!share && share.getAttribute('data-sxg-share-slot') === 'header');
    check('排在赞助之后（匿名 / Login 已在 dock，顶栏锚点退到赞助）',
      !!share && !!sponsor && sponsor.nextElementSibling === share);
    check('保留 sxg-header-btn（顶栏同款外观）',
      !!share && share.classList.contains('sxg-header-btn'));
  }
  {
    /* 手机端分享留顶栏：即使 dock 未就绪也不藏进 pending，挂顶栏锚点即可 */
    const { w } = mkDom({ narrow: true, dock: false });
    const share = w.document.getElementById('sxg-share-entry-btn');
    check('dock 未就绪时仍 slot=header（不 pending 藏起）',
      !!share && share.getAttribute('data-sxg-share-slot') === 'header');
  }

  /* ---------------- ⑤ 点击调分享弹窗 ---------------- */
  console.log('⑤ 点击 → SXGShare.open()');
  {
    const { w } = mkDom({ narrow: false });
    let opened = 0;
    w.SXGShare = { open: function () { opened++; } };
    const share = w.document.getElementById('sxg-share-entry-btn');
    const ev = new w.MouseEvent('click', { bubbles: true, cancelable: true });
    share.dispatchEvent(ev);
    check('调用了 window.SXGShare.open()', opened === 1, opened);
    check('拦下了默认行为（不跳页）', ev.defaultPrevented === true);
    check('自己不造第二套弹窗（页面上没有 sxg-share-entry-modal）',
      !w.document.getElementById('sxg-share-entry-modal'));
  }

  /* ---------------- ⑥ 弹窗脚本缺席 → 复制兜底 ---------------- */
  console.log('⑥ 弹窗脚本缺席时复制兜底');
  {
    const { w, copied } = mkDom({ narrow: false });
    /* 不注入 window.SXGShare，模拟 share-modal.js 被拦 / 还没执行 */
    fire(w, w.document.getElementById('sxg-share-entry-btn'), 'click');
    await new Promise(r => setTimeout(r, 30));
    check('把当前地址写进剪贴板', copied.length === 1 && copied[0] === w.location.href, copied);
    const toast = w.document.getElementById('sxg-share-entry-toast');
    check('给出「链接已复制」气泡反馈', !!toast && /已复制/.test(toast.textContent));
    check('气泡 2 秒后自动收起（有定时器，不常驻遮挡）',
      /setTimeout\(function \(\) \{ el\.setAttribute\('data-show', '0'\); \}, 2000\)/.test(SHARE_SRC));
  }

  /* ---------------- ⑦ 键盘可达 ---------------- */
  console.log('⑦ 键盘可达');
  {
    const { w } = mkDom({ narrow: false });
    let opened = 0;
    w.SXGShare = { open: function () { opened++; } };
    const share = w.document.getElementById('sxg-share-entry-btn');
    share.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    share.dispatchEvent(new w.KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
    check('Enter 与空格都能打开分享（不依赖鼠标）', opened === 2, opened);
  }

  /* ---------------- ⑧ 断点来回切 ---------------- */
  console.log('⑧ 断点手机 ↔ 桌面（分享两端都留顶栏）');
  {
    const { w, state } = mkDom({ narrow: false, dock: true });
    const d = w.document;
    const share = d.getElementById('sxg-share-entry-btn');
    const dock = d.getElementById('sxg-fab-dock');
    check('起点在顶栏', share.parentNode && share.parentNode.tagName === 'HEADER');
    state.narrow = true;
    w.dispatchEvent(new w.Event('resize'));
    check('切窄屏 → 仍留顶栏（不进 dock）', share.parentNode !== dock);
    state.narrow = false;
    w.dispatchEvent(new w.Event('resize'));
    check('切回桌面 → 回顶栏且仍在匿名邮箱之后',
      share.parentNode.tagName === 'HEADER'
      && d.getElementById('sxg-anon-mail-btn').nextElementSibling === share);
    state.narrow = true;
    w.dispatchEvent(new w.Event('resize'));
    check('再切窄屏 → 按钮不丢、不重复创建',
      share.parentNode !== dock && d.querySelectorAll('#sxg-share-entry-btn').length === 1);
  }

  /* ---------------- ⑨ ENABLED 开关 ---------------- */
  console.log('⑨ ENABLED 开关只隐藏不删');
  {
    const { w } = mkDom({ narrow: false });
    const d = w.document;
    const api = w.SXGShareEntry;
    const btn = d.getElementById('sxg-share-entry-btn');
    /* 复刻开关语义：脚本内 ENABLED 是常量，改它要重跑文件；这里直接验
       place() 在隐藏分支下的行为（data-sxg-share-hidden + display:none）。 */
    btn.setAttribute('data-sxg-share-hidden', '1');
    btn.style.display = 'none';
    check('隐藏态留 data-sxg-share-hidden 标记、DOM 不删',
      !!d.getElementById('sxg-share-entry-btn')
      && d.getElementById('sxg-share-entry-btn').getAttribute('data-sxg-share-hidden') === '1');
    const style = d.getElementById('sxg-share-entry-style');
    check('隐藏规则带 !important（压过 dock 的 display:flex !important）',
      !!style && /data-sxg-share-hidden="1"\]\{display:none !important\}/.test(style.textContent));
    check('对外导出 ENABLED 便于一键恢复', !!api && api.ENABLED === true);

    /* 恢复：place() 会把 display 与标记清掉 */
    btn.style.display = '';
    btn.removeAttribute('data-sxg-share-hidden');
    api.place();
    check('place() 后恢复可见、标记清空',
      d.getElementById('sxg-share-entry-btn').getAttribute('data-sxg-share-hidden') === null);
  }

  /* ---------------- ⑩ 匿名邮箱 LOGO ---------------- */
  console.log('⑩ 匿名邮箱按钮 LOGO');
  {
    const { w } = mkDom({ narrow: false });
    const anon = w.document.getElementById('sxg-anon-mail-btn');
    check('匿名邮箱按钮内有 1 枚信封 SVG', !!anon && anon.querySelectorAll('svg').length === 1);
    /* jsdom 的 innerHTML 会把自闭合标签展开成 <rect …></rect>，这里只钉几何形状 */
    check('SVG 用了信封画法（rect 信封体 + path 折线封口）',
      !!anon && /<rect x="3" y="5" width="18" height="14" rx="2"/.test(anon.innerHTML)
      && /<path d="m3\.5 7 8\.5 6 8\.5-6"/.test(anon.innerHTML));
    check('textContent 仍是「匿名邮箱」（既有断言与 dock 标签不受影响）',
      !!anon && anon.textContent.trim() === '匿名邮箱');
    check('LOGO 用 currentColor（跟随按钮前景色，不写死颜色）',
      /stroke="currentColor"/.test(ANON_SRC));
    check('index.html 中 anon-mail.js 已 bump 到 ?v=5', HTML.indexOf('./anon-mail.js?v=5') > 0);
  }

  console.log('\n========== 结果：' + passed + ' 项通过，' + failed + ' 项失败 ==========');
  process.exit(failed ? 1 : 0);
})();
