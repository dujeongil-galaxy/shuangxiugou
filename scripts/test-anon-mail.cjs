/* ==========================================================================
   test-anon-mail.cjs —— 匿名邮箱入口 / 访问告知弹窗 / 断点落位 行为测试
   --------------------------------------------------------------------------
   被测：anon-mail.js、header-menu-patch.js（浏览器 IIFE，jsdom 真跑）
   覆盖：
     ① 常量：目标站点与站长最新匿名邮箱（单一真相源）
     ② 桌面落位：顶栏 Login GitHub 之后、带 sxg-header-btn
     ③ 手机落位：直接进 #sxg-fab-dock 且不进「菜单▼」；dock 未就绪时 pending 兜底
     ④ 首次点击：preventDefault + 先弹窗，绝不直接跳走
     ⑤ 弹窗内容：无 VPN 无法访问 / 邮箱 / 复制 / 仍要前往两个出口
     ⑥ 复制：navigator.clipboard 真写入 + 「已复制」反馈
     ⑦ 关闭：× / 先不去 / ESC / 点遮罩 / 仍要前往 都收起，重复点击不叠加
     ⑧ 断点：手机 ↔ 桌面来回切换，按钮不丢、不进下拉
     ⑨ §36t 顶栏全部常显：不建下拉、旧菜单残留回收、断点来回按钮不丢
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const ANON_SRC = fs.readFileSync(path.join(ROOT, 'anon-mail.js'), 'utf8');
const HEADER_SRC = fs.readFileSync(path.join(ROOT, 'header-menu-patch.js'), 'utf8');

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name + (detail !== undefined ? ' → ' + JSON.stringify(detail) : '')); }
}

/* 可变的 matchMedia 桩：testMode 能改，change 监听器能手动触发 */
function mkDom(opts) {
  opts = opts || {};
  const state = { narrow: !!opts.narrow, listeners: [] };
  const html = '<!DOCTYPE html><html><head></head><body>'
    + '<div class="flex items-center gap-3" id="hdr" style="position:relative">'
    + '<a id="star" class="inline-flex items-center starcls sxg-header-btn" href="https://github.com/x">★ Star on GitHub</a>'
    + '<a id="sponsor-entry-btn" class="inline-flex items-center sxg-header-btn" href="./sponsor.html">☕ 赞助本项目</a>'
    + '<a id="login-github-btn" class="inline-flex items-center sxg-header-btn" href="https://x/auth/github">🔑 Login GitHub</a>'
    + '</div>'
    + (opts.dock ? '<div id="sxg-fab-dock"><button id="sxg-top-btn">TOP</button></div>' : '')
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
  w.eval(ANON_SRC);
  if (opts.header !== false) w.eval(HEADER_SRC);
  /* jsdom 新建文档的 readyState 还是 loading，两个 IIFE 都挂在
     DOMContentLoaded 上；这里同步派发一次，等价于浏览器加载完成时那一拍。 */
  w.document.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true }));
  if (w.SXGAnonMail) w.SXGAnonMail.sweep();
  return { w: w, state: state, copied: copied };
}

(async function () {
  /* ① 常量 */
  console.log('\n① 单一真相源');
  const c = mkDom({ header: false });
  check('目标站点是 m.kuku.lu/cn.php', c.w.SXGAnonMail.SITE_URL === 'https://m.kuku.lu/cn.php');
  check('最新匿名邮箱是 tensi2026@choco.la', c.w.SXGAnonMail.MAIL === 'tensi2026@choco.la');
  c.w.close();

  /* ② 桌面落位 */
  console.log('\n② 桌面顶栏落位');
  const d = mkDom({ narrow: false });
  const bD = d.w.document.getElementById('sxg-anon-mail-btn');
  check('按钮存在且 href 指向目标站点', !!bD && bD.href === 'https://m.kuku.lu/cn.php');
  check('插在 Login GitHub 之后', !!bD && bD.previousSibling && bD.previousSibling.id === 'login-github-btn');
  check('带 sxg-header-btn 且 slot=header', !!bD && bD.classList.contains('sxg-header-btn')
    && bD.getAttribute('data-sxg-anon-slot') === 'header');
  check('顶栏外观基线不被空 class 退化', !!bD && /inline-flex/.test(bD.className) && /rounded-lg/.test(bD.className));
  d.w.close();

  /* ③ 手机落位 */
  console.log('\n③ 手机端直接进 dock');
  const m = mkDom({ narrow: true, dock: true });
  const bM = m.w.document.getElementById('sxg-anon-mail-btn');
  const dock = m.w.document.getElementById('sxg-fab-dock');
  check('按钮是 dock 第一个子项', !!bM && dock.firstChild === bM);
  check('slot=dock 且不带 sxg-header-btn（不会被隐藏规则吃掉）', !!bM
    && bM.getAttribute('data-sxg-anon-slot') === 'dock'
    && !bM.classList.contains('sxg-header-btn'));
  check('撑开的宽条有短中文标签', !!bM && bM.getAttribute('data-sxg-dock-label') === '匿名邮箱');
  check('绝不挂进 #sxg-header-menu', !m.w.document.getElementById('sxg-header-menu')
    || !m.w.document.getElementById('sxg-header-menu').contains(bM));
  m.w.close();

  const p = mkDom({ narrow: true, dock: false });
  const bP = p.w.document.getElementById('sxg-anon-mail-btn');
  check('dock 未就绪时先 pending 藏好', !!bP && bP.getAttribute('data-sxg-anon-slot') === 'pending');
  const late = p.w.document.createElement('div');
  late.id = 'sxg-fab-dock';
  p.w.document.body.appendChild(late);
  p.w.SXGAnonMail.sweep();
  check('dock 一出现就搬进去', bP.parentNode === late && bP.getAttribute('data-sxg-anon-slot') === 'dock');
  p.w.close();

  /* ④ 首次点击先弹窗 */
  console.log('\n④ 首次点击先弹窗，不直接跳走');
  const k = mkDom({ narrow: true, dock: true });
  const bK = k.w.document.getElementById('sxg-anon-mail-btn');
  const ev = new k.w.Event('click', { bubbles: true, cancelable: true });
  bK.dispatchEvent(ev);
  const modal = k.w.document.getElementById('sxg-anon-mail-modal');
  check('点击默认行为被拦下', ev.defaultPrevented === true);
  check('弹窗出现且挂在 body 上', !!modal && modal.parentNode === k.w.document.body);
  check('z-index 高于悬浮层', !!modal && /z-index:10050/.test(
    k.w.document.getElementById('sxg-anon-mail-style').textContent.replace(/\s/g, '')));

  /* ⑤ 弹窗内容 */
  console.log('\n⑤ 弹窗内容');
  const txt = modal ? modal.textContent : '';
  check('明确写「没有 VPN … 无法访问」', /没有 VPN/.test(txt) && /无法访问/.test(txt));
  check('写明大陆网络直连会打不开', /大陆网络/.test(txt) && /连接失败/.test(txt));
  check('备注最新匿名邮箱', txt.indexOf('tensi2026@choco.la') !== -1);
  check('备注点明目标站点是境外临时邮箱', /m\.kuku\.lu/.test(txt) && /境外/.test(txt));
  check('草稿批注 / 推广话术不上页面', !/别抄原话|站长推荐|点此购买|直接url链接/.test(txt));
  const go = modal.querySelector('.sxg-am-go');
  check('「仍要前往」是唯一目标链接且新标签打开', !!go && go.href === 'https://m.kuku.lu/cn.php'
    && go.target === '_blank' && go.rel.indexOf('noopener') !== -1);
  check('复制按钮存在', !!modal.querySelector('.sxg-am-copy'));

  /* ⑥ 复制 */
  console.log('\n⑥ 复制邮箱');
  modal.querySelector('.sxg-am-copy').dispatchEvent(new k.w.Event('click', { bubbles: true }));
  await new Promise(function (r) { setTimeout(r, 20); });
  check('clipboard.writeText 写入的就是最新邮箱', k.copied.length === 1 && k.copied[0] === 'tensi2026@choco.la', k.copied);
  check('按钮给出「已复制」反馈', modal.querySelector('.sxg-am-copy').textContent === '已复制');

  /* ⑦ 关闭路径 */
  console.log('\n⑦ 关闭路径与幂等');
  modal.querySelector('.sxg-am-cancel').dispatchEvent(new k.w.Event('click', { bubbles: true }));
  check('「先不去」关掉弹窗', !k.w.document.getElementById('sxg-anon-mail-modal'));
  k.w.SXGAnonMail.openModal();
  const m2 = k.w.document.getElementById('sxg-anon-mail-modal');
  m2.querySelector('.sxg-am-x').dispatchEvent(new k.w.Event('click', { bubbles: true }));
  check('× 关掉弹窗', !k.w.document.getElementById('sxg-anon-mail-modal'));
  k.w.SXGAnonMail.openModal();
  k.w.document.dispatchEvent(new k.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  check('ESC 关掉弹窗', !k.w.document.getElementById('sxg-anon-mail-modal'));
  k.w.SXGAnonMail.openModal();
  const m3 = k.w.document.getElementById('sxg-anon-mail-modal');
  m3.dispatchEvent(new k.w.Event('click', { bubbles: true, cancelable: true }));
  check('点遮罩关掉弹窗', !k.w.document.getElementById('sxg-anon-mail-modal'));
  k.w.SXGAnonMail.openModal(); k.w.SXGAnonMail.openModal();
  check('重复打开不叠加弹窗', k.w.document.querySelectorAll('#sxg-anon-mail-modal').length === 1);
  const m4 = k.w.document.getElementById('sxg-anon-mail-modal');
  m4.querySelector('.sxg-am-go').dispatchEvent(new k.w.Event('click', { bubbles: true, cancelable: true }));
  check('「仍要前往」放行时先收起弹窗', !k.w.document.getElementById('sxg-anon-mail-modal'));
  k.w.close();

  /* ⑧ 断点来回切换 */
  console.log('\n⑧ 断点手机 ↔ 桌面');
  const r = mkDom({ narrow: true, dock: true });
  const bR = r.w.document.getElementById('sxg-anon-mail-btn');
  check('起点：按钮在 dock', bR.getAttribute('data-sxg-anon-slot') === 'dock');
  r.state.narrow = false;
  r.state.listeners.forEach(function (fn) { fn(); });
  r.w.SXGAnonMail.sweep();
  check('切桌面：按钮回到顶栏', bR.getAttribute('data-sxg-anon-slot') === 'header'
    && bR.classList.contains('sxg-header-btn'));
  r.state.narrow = true;
  r.w.document.body.appendChild(r.w.document.getElementById('sxg-fab-dock') ||
    (function () { var e = r.w.document.createElement('div'); e.id = 'sxg-fab-dock'; return e; })());
  r.state.listeners.forEach(function (fn) { fn(); });
  r.w.SXGAnonMail.sweep();
  check('切回手机：按钮重新进 dock', bR.getAttribute('data-sxg-anon-slot') === 'dock'
    && !bR.classList.contains('sxg-header-btn'));
  r.w.close();

  /* ⑨ §36t：顶栏全部常显，撤掉折叠；旧菜单残留要被回收 */
  console.log('\n⑨ 顶栏按钮全部常显（不再折叠）');
  const h = mkDom({ narrow: true, header: true });
  const doc = h.w.document;
  const hdr = doc.getElementById('hdr');
  const login = doc.getElementById('login-github-btn');
  // 补齐真实页面的 <header> + data-hdr-acts 结构
  const header = doc.createElement('header');
  hdr.parentNode.insertBefore(header, hdr);
  header.appendChild(hdr);
  hdr.setAttribute('data-hdr-acts', '1');
  // 人为造一份旧版残留：下拉容器里藏着一枚按钮 + 一个「菜单▼」
  const stale = doc.createElement('div');
  stale.id = 'sxg-header-menu';
  hdr.appendChild(stale);
  stale.appendChild(login);
  const staleToggle = doc.createElement('button');
  staleToggle.id = 'sxg-header-menu-toggle';
  hdr.appendChild(staleToggle);
  h.state.listeners.forEach(function (fn) { fn(); });
  check('窄屏：展开标记就位', hdr.getAttribute('data-sxg-hdr-expanded') === '1');
  check('窄屏：不创建下拉容器与「菜单▼」',
    !doc.getElementById('sxg-header-menu') && !doc.getElementById('sxg-header-menu-toggle'));
  check('旧菜单里藏着的按钮被搬回顶栏', login.parentNode === hdr);
  check('窄屏：三枚顶栏按钮全部留在按钮组常显', hdr.querySelectorAll('a').length === 3,
    hdr.querySelectorAll('a').length);
  const expStyle = doc.getElementById('sxg-header-expand-style');
  check('注入「不许隐藏」兜底样式', !!expStyle && /display:inline-flex/.test(expStyle.textContent));
  h.state.narrow = false;
  h.state.listeners.forEach(function (fn) { fn(); });
  // 切宽屏时 anon-mail.js 按设计把「匿名邮箱」挂回顶栏（第 4 枚），别写死 3。
  check('切宽屏：原三枚按钮不丢、仍在顶栏',
    hdr.contains(login) && hdr.querySelectorAll('a').length >= 3,
    hdr.querySelectorAll('a').length);
  h.state.narrow = true;
  h.state.listeners.forEach(function (fn) { fn(); });
  check('再切窄屏：按钮不丢、仍常显',
    hdr.contains(login) && !doc.getElementById('sxg-header-menu'));
  h.w.close();

  setTimeout(function () {
    console.log('\n========== 结果：' + passed + ' 项通过，' + failed + ' 项失败 ==========');
    process.exit(failed ? 1 : 0);
  }, 80);
})();
