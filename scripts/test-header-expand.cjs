/* ==========================================================================
   test-header-expand.cjs —— §36t 手机端「全部展开，按钮不再做隐藏」行为测试
   --------------------------------------------------------------------------
   被测：header-menu-patch.js / github-access-help.js / mobile-fixes.css /
        appeal-policy.js（浏览器 IIFE，jsdom 真跑）
   覆盖：
     ① 窄屏顶栏：不建「菜单▼」下拉、四枚按钮全留在按钮组、展开标记就位
     ② 不许隐藏：注入的兜底样式里没有 display:none
     ③ 旧菜单残留：藏着的按钮搬回按钮组，旧容器与菜单按钮一并清掉
     ④ 断点来回：宽 ↔ 窄切换按钮不丢、不折叠、class/style 不被清空
     ⑤ 🌐 入口：宽窄屏都贴 Star 常显（同一父节点），不进下拉
     ⑥ 帮助内容：PC / 移动 UA 都同时常显两条办法，推荐标记只一枚且位置对
     ⑦ 申诉弹窗：填充帮助块后两条 row 都在；脚本有滚动复位
     ⑧ CSS：换行铺满、按钮自身宽度、圆形入口排除
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const HEADER_SRC = fs.readFileSync(path.join(ROOT, 'header-menu-patch.js'), 'utf8');
const HELP_SRC = fs.readFileSync(path.join(ROOT, 'github-access-help.js'), 'utf8');
const CSS_SRC = fs.readFileSync(path.join(ROOT, 'mobile-fixes.css'), 'utf8');
const APPEAL_SRC = fs.readFileSync(path.join(ROOT, 'appeal-policy.js'), 'utf8');

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name + (detail !== undefined ? ' → ' + JSON.stringify(detail) : '')); }
}

function mkDom(opts) {
  opts = opts || {};
  const state = { narrow: !!opts.narrow, listeners: [] };
  const html = '<!DOCTYPE html><html><head></head><body>'
    + '<header><div class="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">'
    + '<div id="brand">双休购</div>'
    + '<div id="acts" data-hdr-acts="1">'
    + '<a id="appeal" href="https://github.com/dujeongil-galaxy/shuangxiugou/issues">+ 提交数据 / 申诉</a>'
    + '<a id="star" href="https://github.com/dujeongil-galaxy/shuangxiugou">★ Star on GitHub</a>'
    + '<a id="sponsor-entry-btn" href="./sponsor.html">☕ 赞助本项目</a>'
    + '<a id="login-github-btn" href="https://x/auth/github">🔑 Login GitHub</a>'
    + '</div></div></header>'
    + '<div id="slot" data-sxg-gh-help="1"></div>'
    + '</body></html>';
  const dom = new JSDOM(html, {
    runScripts: 'outside-only',
    url: 'https://dujeongil-galaxy.github.io/shuangxiugou/',
    pretendToBeVisual: true
  });
  const w = dom.window;
  Object.defineProperty(w.navigator, 'userAgent', {
    value: opts.ua || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
    configurable: true
  });
  Object.defineProperty(w.navigator, 'maxTouchPoints', { value: opts.touch || 0, configurable: true });
  w.matchMedia = function (q) {
    return {
      get matches() { return /max-width/.test(q) ? state.narrow : false; },
      addEventListener: function (_, fn) { state.listeners.push(fn); },
      removeEventListener: function () {},
      addListener: function (fn) { state.listeners.push(fn); }
    };
  };
  w.eval(HEADER_SRC);
  w.eval(HELP_SRC);
  /* jsdom 新文档 readyState 还是 loading，两个 IIFE 都挂在 DOMContentLoaded 上 */
  try { w.document.dispatchEvent(new w.Event('DOMContentLoaded')); } catch (e) {}
  return { w: w, state: state };
}

(async function () {
  /* ① ② ③ 窄屏顶栏全部常显 */
  console.log('\n① 窄屏顶栏：不折叠、不隐藏');
  const m = mkDom({ narrow: true });
  const doc = m.w.document;
  const acts = doc.getElementById('acts');
  const star = doc.getElementById('star');
  check('按钮组打上展开标记', acts.getAttribute('data-sxg-hdr-expanded') === '1');
  check('不创建下拉容器 / 「菜单▼」',
    !doc.getElementById('sxg-header-menu') && !doc.getElementById('sxg-header-menu-toggle'));
  check('四枚顶栏按钮全部留在按钮组',
    acts.querySelectorAll('a').length >= 4, acts.querySelectorAll('a').length);
  const expStyle = doc.getElementById('sxg-header-expand-style');
  check('注入「不许隐藏」兜底样式且不含 display:none',
    !!expStyle && /display:inline-flex/.test(expStyle.textContent)
    && !/display:none/.test(expStyle.textContent));
  check('四枚按钮的内联 display 都不是 none',
    [].every.call(acts.querySelectorAll('a'), function (a) { return a.style.display !== 'none'; }));

  /* 🌐 入口：挂在 Star 右侧，与桌面同一分支 */
  const trig = doc.getElementById(m.w.SXGGitHubAccess.TRIGGER_ID);
  check('窄屏 🌐 入口贴 Star 常显（父节点就是按钮组）',
    !!trig && trig.parentNode === acts && trig.previousSibling === star);
  check('窄屏 🌐 入口沿用圆形桌面样式', !!trig && trig.getAttribute('data-sxg-gh-desktop') === '1');

  /* 旧菜单残留回收 */
  const stale = doc.createElement('div');
  stale.id = 'sxg-header-menu';
  acts.appendChild(stale);
  stale.appendChild(doc.getElementById('login-github-btn'));
  const staleToggle = doc.createElement('button');
  staleToggle.id = 'sxg-header-menu-toggle';
  acts.appendChild(staleToggle);
  m.state.listeners.forEach(function (fn) { fn(); });
  check('旧菜单里藏着的按钮被搬回按钮组', doc.getElementById('login-github-btn').parentNode === acts);
  check('旧菜单容器与「菜单▼」被清掉',
    !doc.getElementById('sxg-header-menu') && !doc.getElementById('sxg-header-menu-toggle'));

  /* ④ 断点来回 */
  console.log('\n② 断点来回：按钮不丢、不再折叠');
  m.state.narrow = false;
  m.state.listeners.forEach(function (fn) { fn(); });
  check('切宽屏：四枚按钮仍在按钮组', acts.querySelectorAll('a').length >= 4);
  check('切宽屏：没有生成下拉容器', !doc.getElementById('sxg-header-menu'));
  check('切宽屏：Login GitHub 仍在按钮组、内联样式没被改写',
    doc.getElementById('login-github-btn').parentNode === acts
    && doc.getElementById('login-github-btn').getAttribute('style') === null);
  m.state.narrow = true;
  m.state.listeners.forEach(function (fn) { fn(); });
  check('再切窄屏：四枚按钮仍常显', acts.querySelectorAll('a').length >= 4
    && !doc.getElementById('sxg-header-menu'));
  check('再切窄屏：展开标记还在', acts.getAttribute('data-sxg-hdr-expanded') === '1');
  m.w.close();

  /* ⑤ 宽屏同样贴 Star 常显 */
  console.log('\n③ 宽屏 🌐 入口同一分支');
  const d = mkDom({ narrow: false });
  const trigD = d.w.document.getElementById(d.w.SXGGitHubAccess.TRIGGER_ID);
  check('宽屏 🌐 入口也贴 Star 右侧',
    !!trigD && trigD.previousSibling === d.w.document.getElementById('star'));
  check('宽屏也不建下拉容器', !d.w.document.getElementById('sxg-header-menu'));
  d.w.close();

  /* ⑥ 两条办法都常显 */
  console.log('\n④ 帮助内容两条都常显');
  const pc = mkDom({});
  const hPc = pc.w.SXGGitHubAccess.helpHtml();
  check('PC 两条 row 都在', (hPc.match(/sxg-gh-help__row/g) || []).length === 2);
  check('PC 含 Steam++ 官网与站点原有入口',
    hPc.indexOf('https://steampp.net/') !== -1 && hPc.indexOf('47.112.97.173') !== -1);
  check('PC 推荐标记只一枚且落在电脑那条',
    (hPc.match(/sxg-gh-help__rec/g) || []).length === 1
    && /steampp\.net[\s\S]{0,180}当前设备 · 推荐/.test(hPc));
  check('PC 不再写「自动判断，无需手动切换」', !/已按当前设备自动判断，无需手动切换/.test(hPc));
  pc.w.close();

  const mob = mkDom({
    narrow: true, touch: 5,
    ua: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Mobile Safari/537.36'
  });
  const hMob = mob.w.SXGGitHubAccess.helpHtml();
  check('移动端两条 row 都在', (hMob.match(/sxg-gh-help__row/g) || []).length === 2);
  check('移动端也含 Steam++ 官网（不隐藏电脑那条）', hMob.indexOf('steampp.net') !== -1);
  check('移动端推荐标记只一枚且落在手机 / 平板那条',
    (hMob.match(/sxg-gh-help__rec/g) || []).length === 1
    && /手机\s*\/\s*平板[\s\S]{0,260}当前设备 · 推荐/.test(hMob));

  /* ⑦ 申诉弹窗帮助容器 */
  console.log('\n⑤ 申诉弹窗帮助容器与滚动复位');
  const slot = mob.w.document.getElementById('slot');
  mob.w.SXGGitHubAccess.populate(slot);
  check('容器里两条 row 都常显', slot.querySelectorAll('.sxg-gh-help__row').length === 2);
  check('容器里只有一枚推荐标记', slot.querySelectorAll('.sxg-gh-help__rec').length === 1);
  check('appeal-policy.js 打开弹窗后复位滚动位置', /card\.scrollTop\s*=\s*0/.test(APPEAL_SRC));
  mob.w.close();

  /* ⑧ CSS 换行铺满 */
  console.log('\n⑥ CSS 顶栏换行铺满');
  check('≤640px 顶栏允许换行', /header\s*>\s*div\[class\*="h-16"\]\s*\{[^}]*flex-wrap:\s*wrap/.test(CSS_SRC));
  check('按钮组横向 wrap 铺满第二行',
    /flex-direction:\s*row\s*!important/.test(CSS_SRC) && /flex-wrap:\s*wrap\s*!important/.test(CSS_SRC));
  check('每枚按钮自身宽度且不省略',
    /width:\s*auto\s*!important/.test(CSS_SRC) && /white-space:\s*nowrap\s*!important/.test(CSS_SRC));
  check('🌐 圆形入口单独排除，不被撑成宽条',
    /a:not\(\[data-sxg-gh-desktop\]\)/.test(CSS_SRC)
    && /a\[data-sxg-gh-desktop\]\s*\{[^}]*margin-left:\s*0/.test(CSS_SRC));
  check('顶栏不再写竖排 flex-end',
    !/flex-direction:\s*column;\s*\r?\n\s*align-items:\s*flex-end/.test(CSS_SRC));
  check('641–900px 中等宽度也换行铺满（660px 逐字竖条修复）',
    /@media\s*\(min-width:\s*641px\)\s*and\s*\(max-width:\s*900px\)/.test(CSS_SRC)
    && /flex:\s*0\s+0\s+auto\s*!important/.test(CSS_SRC));

  setTimeout(function () {
    console.log('\n========== 结果：' + passed + ' 项通过，' + failed + ' 项失败 ==========');
    process.exit(failed ? 1 : 0);
  }, 80);
})();
