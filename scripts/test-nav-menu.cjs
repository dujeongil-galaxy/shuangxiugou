/* ==========================================================================
   test-nav-menu.cjs —— 右下角悬浮导航菜单行为测试
   --------------------------------------------------------------------------
   被测对象：nav-menu.js（浏览器 IIFE，无导出，纯 DOM 行为）

   背景（2026-11-02 站长）：
     ① 顶部公告栏不许出现超链接，导航入口收到这里；
     ② PC 常显横向 dock；
     ③ 手机只露一个主按钮，**点开才加载**其余条目。

   覆盖路径：
     ① 桌面（matchMedia 不命中 640）：条目立即建好、三个出口 href 正确
     ② 手机（matchMedia 命中 640）：panel 初始为空（真·按需创建），点开才出现
     ③ 再点一次收起；条目不复建（不是「隐藏/显示」假按需）
     ④ Esc 收起、点空白处收起
     ⑤ 幂等：重复执行脚本不重复注入节点 / style
     ⑥ 三个出口可达：两个页面文件真实存在 + #evidence-board 锚点真实存在
     ⑦ img/svg 图标存在，按钮有 aria 属性（无障碍）

   ⚠️ jsdom 没有 window.matchMedia，必须自己打桩，否则永远走桌面分支，
      「手机按需创建」这条路径根本没被测到（典型救绿形态）。
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'nav-menu.js'), 'utf8');

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name + (detail !== undefined ? ' → ' + JSON.stringify(detail) : '')); }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function until(condFn, timeoutMs) {
  const start = Date.now();
  return new Promise((resolve) => {
    (function poll() {
      let ok = false;
      try { ok = condFn(); } catch (e) { ok = false; }
      if (ok) return resolve(true);
      if (Date.now() - start >= timeoutMs) return resolve(false);
      setTimeout(poll, 5);
    })();
  });
}

/** 造一个页面：onlyMobile=true 时 matchMedia 只对 max-width:640 命中。
 *  withNotice=true 时带上公告栏 + 版本号节点 —— 手机菜单的版本号项是从
 *  这个节点读文本的，桩里不给就等于永远测不到那条路径（救绿形态）。 */
function mkDom(onlyMobile, withNotice) {
  const notice = withNotice
    ? '<div id="site-notice"><span id="evidence-notice">本站全部数据均附公开证据链</span>'
      + '<span class="notice-sep">｜</span>'
      + '<span class="notice-ver" style="color:#000;font-weight:700">当前版本号 abc1234</span></div>'
    : '';
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body>' + notice
    + '<div id="root"></div></body></html>',
    { runScripts: 'outside-only', url: 'https://dujeongil-galaxy.github.io/shuangxiugou/' });
  const w = dom.window;
  const listeners = [];
  w.matchMedia = function (q) {
    return {
      media: q,
      matches: onlyMobile && /max-width:\s*640px/.test(q),
      addEventListener: function (t, fn) { listeners.push(fn); },
      removeEventListener: function () {},
      addListener: function (fn) { listeners.push(fn); },
      removeListener: function () {}
    };
  };
  w.eval(SRC);
  // jsdom 构造期可能还在 loading，脚本会等 DOMContentLoaded —— 补一发
  if (!w.document.getElementById('sxg-nav')) {
    w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  }
  return w;
}

(async function () {
  /* ================= ① 桌面：常显、条目立即建好 ================= */
  console.log('\n① 桌面（>640px）常显');
  const wd = mkDom(false, true);
  const docD = wd.document;
  await until(() => docD.getElementById('sxg-nav'), 2000);

  const rootD = docD.getElementById('sxg-nav');
  const panelD = docD.getElementById('sxg-nav-panel');
  const fabD = docD.getElementById('sxg-nav-fab');

  check('注入 #sxg-nav 容器', !!rootD);
  check('注入主按钮 #sxg-nav-fab', !!fabD);
  check('注入面板 #sxg-nav-panel', !!panelD);
  // 桌面也要建版本项，视觉交给 CSS 隐藏。只在手机端建是错的：桌面宽屏
  // 首屏加载时 built 已置 true，之后把窗口拖窄到 <640px 不会再补建，
  // 手机上就永远少这一条（2026-11-02 首版实测就是这个坑，截图里只有 3 项）。
  check('桌面端也建版本号项（跨断点才补得上，视觉由 CSS 隐藏）',
    panelD && panelD.querySelectorAll('.sxg-nav-ver').length === 1,
    panelD && panelD.querySelectorAll('.sxg-nav-ver').length);
  check('桌面端条目 4 条（3 导航 + 1 版本号）',
    panelD && panelD.querySelectorAll('.sxg-nav-item').length === 4,
    panelD && panelD.querySelectorAll('.sxg-nav-item').length);

  const itemsD = panelD ? Array.from(panelD.querySelectorAll('.sxg-nav-item')) : [];
  check('① 证据链公示 → #evidence-board（页内锚点）',
    itemsD[0] && itemsD[0].textContent === '证据链公示' && itemsD[0].getAttribute('href') === '#evidence-board',
    itemsD[0] && [itemsD[0].textContent, itemsD[0].getAttribute('href')]);
  check('② 同类项目导航 → ./projects.html',
    itemsD[1] && itemsD[1].textContent === '同类项目导航' && itemsD[1].getAttribute('href') === './projects.html',
    itemsD[1] && [itemsD[1].textContent, itemsD[1].getAttribute('href')]);
  check('③ 成功案例 → ./success-stories.html',
    itemsD[2] && itemsD[2].textContent === '成功案例' && itemsD[2].getAttribute('href') === './success-stories.html',
    itemsD[2] && [itemsD[2].textContent, itemsD[2].getAttribute('href')]);

  check('桌面端不进入展开态（is-open 不挂）', !rootD.classList.contains('is-open'));

  const styleD = docD.getElementById('sxg-nav-style');
  check('注入样式表 #sxg-nav-style', !!styleD);
  const css = styleD ? styleD.textContent : '';
  // 花括号配平取媒体查询块：正则取到的是「从 @media 到文件尾」，
  // 会把暗色块也吞进来，等于没限定范围（救绿形态）。
  const mqBlock = (function (txt, needle) {
    const i = txt.indexOf(needle);
    if (i < 0) return '';
    const start = txt.indexOf('{', i);
    let depth = 0;
    for (let p = start; p < txt.length; p++) {
      if (txt[p] === '{') depth++;
      else if (txt[p] === '}') { depth--; if (depth === 0) return txt.slice(start + 1, p); }
    }
    return '';
  })(css, '@media (max-width:640px)');
  check('样式含手机断点 max-width:640px', mqBlock.length > 0);
  check('★ 主按钮默认 display:none，只有手机断点里才 display:flex',
    /#sxg-nav-fab\{display:none/.test(css) && /#sxg-nav-fab\{display:flex\}/.test(mqBlock),
    { baseHide: /#sxg-nav-fab\{display:none/.test(css), mqShow: /#sxg-nav-fab\{display:flex\}/.test(mqBlock) });
  check('手机断点里面板默认 display:none、展开态才 flex',
    /#sxg-nav-panel\{display:none/.test(mqBlock) && /\.is-open #sxg-nav-panel\{display:flex\}/.test(mqBlock),
    { panelHide: /#sxg-nav-panel\{display:none/.test(mqBlock) });
  check('底距用 --sxg-bar-h 变量（避让良配吸底条）', /var\(--sxg-bar-h/.test(css));
  // 版本号项：桌面隐藏、手机露出。写在断点里没写基础规则的话，桌面上
  // 会跟 dock 并排多出一条灰底 pill；只有基础规则不写断点，手机上则永远看不见。
  check('★ 版本号项基础规则隐藏、只在手机断点露出',
    /\.sxg-nav-ver\{display:none/.test(css)
      && /#sxg-nav \.sxg-nav-ver\{display:block\}/.test(mqBlock),
    {
      baseHide: /\.sxg-nav-ver\{display:none/.test(css),
      mqShow: /#sxg-nav \.sxg-nav-ver\{display:block\}/.test(mqBlock),
    });
  // 桌面版本号项以 display:none 留在 DOM 里，它仍然是 :last-child。
  // 右端圆角若还写 :last-child，会画到那个看不见的节点上，
  // 第三个导航项变成直角收尾（真渲染截图里一眼可见）。
  check('★ dock 右端圆角挂在 a:last-of-type（不被隐藏的版本号 div 吃掉）',
    /a\.sxg-nav-item:last-of-type\{border-right:1px solid #d1d5db;border-radius:0 19px 19px 0\}/.test(css));
  // 坑（2026-11-02 实测）：≥1440px 良配是右上卡片，但脚本照样把它的高度
  // （实测 279px）写进 --sxg-bar-h，不覆盖的话桌面 dock 会被顶到页面中部。
  check('★ ≥1440px 覆盖掉条高变量，dock 贴回右下角',
    /@media \(min-width:1440px\)\{#sxg-nav\{bottom:12px\}\}/.test(css),
    { found: /@media \(min-width:1440px\)/.test(css) });

  /* ================= ② 手机：点开才加载 ================= */
  console.log('\n② 手机（≤640px）按需创建');
  const wm = mkDom(true, true);
  const docM = wm.document;
  await until(() => docM.getElementById('sxg-nav'), 2000);

  const rootM = docM.getElementById('sxg-nav');
  const panelM = docM.getElementById('sxg-nav-panel');
  const fabM = docM.getElementById('sxg-nav-fab');

  check('手机端容器就位', !!rootM);
  check('★ 未点开时面板里一个条目都没有（真·按需创建）',
    panelM && panelM.querySelectorAll('.sxg-nav-item').length === 0,
    panelM && panelM.querySelectorAll('.sxg-nav-item').length);
  check('未点开时 aria-expanded=false',
    fabM && fabM.getAttribute('aria-expanded') === 'false');
  check('主按钮有 aria-controls 指向面板',
    fabM && fabM.getAttribute('aria-controls') === 'sxg-nav-panel');
  check('主按钮含三横线图标 svg', !!fabM && !!fabM.querySelector('svg'));

  // 点开
  fabM.dispatchEvent(new wm.MouseEvent('click', { bubbles: true }));
  await until(() => panelM.querySelectorAll('.sxg-nav-item').length === 4, 1000);

  const itemsM = Array.from(panelM.querySelectorAll('.sxg-nav-item'));
  check('★ 点开后条目才被创建（3 个导航 + 1 个版本号 = 4 条）', itemsM.length === 4, itemsM.length);
  check('展开态 is-open 挂上', rootM.classList.contains('is-open'));
  check('展开后 aria-expanded=true', fabM.getAttribute('aria-expanded') === 'true');
  check('点开后的第一条是「证据链公示」→ #evidence-board',
    itemsM[0] && itemsM[0].textContent === '证据链公示' && itemsM[0].getAttribute('href') === '#evidence-board');
  check('点开后的第二条是「同类项目导航」→ ./projects.html',
    itemsM[1] && itemsM[1].textContent === '同类项目导航' && itemsM[1].getAttribute('href') === './projects.html');
  check('点开后的第三条是「成功案例」→ ./success-stories.html',
    itemsM[2] && itemsM[2].textContent === '成功案例' && itemsM[2].getAttribute('href') === './success-stories.html');
  // 版本号项：文本必须来自公告栏 DOM（比对的是桩里写死的 abc1234，
  // 不是「含『当前版本号』」这种子串断言 —— 子串断言在 JS 里另写死一份
  // 同样能过，等于没测到「读 DOM」这个关键行为）
  const verM = panelM.querySelector('.sxg-nav-ver');
  check('手机菜单第四条是版本号（文本为公告栏 .notice-ver 原文）',
    verM && verM.textContent === '当前版本号 abc1234', verM && verM.textContent);
  check('版本号项不是链接（<div>、无 href，点了不会跳走）',
    verM && verM.tagName === 'DIV' && !verM.hasAttribute('href'),
    verM && [verM.tagName, verM.getAttribute('href')]);
  check('版本号项排在导航之后（不在第一条，别抢「证据链公示」的位置）',
    itemsM[itemsM.length - 1] === verM);

  // 点条目后收起（手机态）：取消顶部链接后「证据链公示」是唯一入口，
  // 点完面板若还浮在左下，正好压在刚滚到的区块上。
  itemsM[0].dispatchEvent(new wm.MouseEvent('click', { bubbles: true }));
  await wait(20);
  check('★ 手机端点条目后菜单自动收起（不挡住跳转目标）',
    !rootM.classList.contains('is-open'));
  fabM.dispatchEvent(new wm.MouseEvent('click', { bubbles: true }));
  await wait(20);
  check('（前置）再点主按钮能重新打开', rootM.classList.contains('is-open'));

  // 再点收起，且不复建
  const firstNode = itemsM[0];
  fabM.dispatchEvent(new wm.MouseEvent('click', { bubbles: true }));
  await wait(20);
  check('再点一次收起（is-open 移除）', !rootM.classList.contains('is-open'));
  check('收起后条目仍在 DOM 里（只切显隐，不销毁重建）',
    panelM.querySelectorAll('.sxg-nav-item').length === 4);
  check('★ 收起再点开不重复创建（还是同一批节点）',
    (function () {
      fabM.dispatchEvent(new wm.MouseEvent('click', { bubbles: true }));
      const again = Array.from(panelM.querySelectorAll('.sxg-nav-item'));
      return again.length === 4 && again[0] === firstNode;
    })());

  /* ================= ③ Esc / 点空白 ================= */
  console.log('\n③ 关闭方式');
  docM.dispatchEvent(new wm.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await wait(20);
  check('Esc 收起', !rootM.classList.contains('is-open'));

  fabM.dispatchEvent(new wm.MouseEvent('click', { bubbles: true }));
  await wait(20);
  check('（前置）再次点开', rootM.classList.contains('is-open'));
  docM.body.dispatchEvent(new wm.MouseEvent('click', { bubbles: true }));
  await wait(20);
  check('点空白处收起', !rootM.classList.contains('is-open'));

  /* ================= ④ 幂等 ================= */
  console.log('\n④ 幂等');
  wm.eval(SRC);
  await wait(20);
  check('重复执行不重复注入 #sxg-nav', docM.querySelectorAll('#sxg-nav').length === 1);
  check('重复执行不重复注入 #sxg-nav-style', docM.querySelectorAll('#sxg-nav-style').length === 1);
  check('重复执行后条目数不变（仍是 4）', panelM.querySelectorAll('.sxg-nav-item').length === 4);

  /* ================= ⑤ 没有公告栏的页面：不留空壳 ================= */
  console.log('\n⑤ 读不到版本号时不建空壳');
  const wm2 = mkDom(true, false);
  const docM2 = wm2.document;
  await until(() => docM2.getElementById('sxg-nav'), 2000);
  const panelN2 = docM2.getElementById('sxg-nav-panel');
  const fabN2 = docM2.getElementById('sxg-nav-fab');
  fabN2.dispatchEvent(new wm2.MouseEvent('click', { bubbles: true }));
  await wait(30);
  check('页面没有 .notice-ver 时，手机菜单只建 3 条导航',
    panelN2.querySelectorAll('.sxg-nav-item').length === 3,
    panelN2.querySelectorAll('.sxg-nav-item').length);
  check('页面没有 .notice-ver 时也不存在 .sxg-nav-ver 空壳节点',
    panelN2.querySelectorAll('.sxg-nav-ver').length === 0,
    panelN2.querySelectorAll('.sxg-nav-ver').length);

  /* ================= ⑥ 出口文件真实存在 ================= */
  console.log('\n⑥ 出口可达');
  check('projects.html 存在', fs.existsSync(path.join(ROOT, 'projects.html')));
  check('success-stories.html 存在', fs.existsSync(path.join(ROOT, 'success-stories.html')));
  // 页内锚点同理：菜单第一条跳 #evidence-board，这个 id 不在 index.html 里就是死链
  const idxHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  check('index.html 里真有 id="evidence-board"（页内跳转不是死链）',
    /id="evidence-board"/.test(idxHtml));

  console.log('\n' + '='.repeat(60));
  console.log('通过 ' + passed + ' 项，失败 ' + failed + ' 项');
  if (failed) { console.log('失败项需逐条确认，不许直接放行'); process.exit(1); }
  console.log('全部通过');
})();
