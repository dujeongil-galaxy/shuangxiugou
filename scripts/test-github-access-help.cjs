/* ==========================================================================
   test-github-access-help.cjs —— GitHub 访问帮助 + 分享链接规整 行为测试
   --------------------------------------------------------------------------
   被测：github-access-help.js / share-modal.js（浏览器 IIFE）
   覆盖：
     ① isDesktop()：PC / Android / iPhone / iPad / iPadOS 伪装 Mac / 触屏笔记本
     ② helpHtml()：§36t 起电脑 / 手机平板两条办法都常显，isDesktop() 只打推荐标记
     ③ populate()：容器填充幂等，不重复叠加
     ④ Star 二级菜单：宽窄屏都贴 Star 常显（不进下拉）+ 点击出浮层 + 外部点击关闭
     ⑤ shareUrl()：sponsor.html（含 query / hash）剥净，其它页面 URL 原样
     ⑥ share-modal.info()：打赏页分享出去的 url 不带 sponsor.html
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const HELP_SRC = fs.readFileSync(path.join(ROOT, 'github-access-help.js'), 'utf8');
const SHARE_SRC = fs.readFileSync(path.join(ROOT, 'share-modal.js'), 'utf8');

/* 2026-11-12 站长要求删掉顶栏那颗蓝色 🌐 ⇒ SHOW_TRIGGER=false。
   这里从源码读开关真值，断言方向跟着开关走：开着就深验落位，关着就验「不挂入口 +
   浮层与申诉槽位仍在」。这样开关翻回 true 时测试不会误判，也不会失去故障注入价值。 */
const TRIGGER_ON = /var\s+SHOW_TRIGGER\s*=\s*true/.test(HELP_SRC);

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name + (detail !== undefined ? ' → ' + JSON.stringify(detail) : '')); }
}

function mkDom(opts) {
  opts = opts || {};
  const html = '<!DOCTYPE html><html><head><meta name="description" content="测试"></head><body>'
    + '<div id="root"><a id="star" href="https://github.com/dujeongil-galaxy/shuangxiugou">★ Star on GitHub</a></div>'
    + '<div id="slot" data-sxg-gh-help="1"></div>'
    + '</body></html>';
  const dom = new JSDOM(html, {
    runScripts: 'outside-only',
    url: opts.url || 'https://dujeongil-galaxy.github.io/shuangxiugou/sponsor.html',
    pretendToBeVisual: true
  });
  const w = dom.window;
  Object.defineProperty(w.navigator, 'userAgent', {
    value: opts.ua || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
    configurable: true
  });
  Object.defineProperty(w.navigator, 'maxTouchPoints', { value: opts.touch || 0, configurable: true });
  w.matchMedia = function (q) {
    return { matches: !!(opts.narrow && /max-width/.test(q)), addEventListener: function () {}, removeEventListener: function () {} };
  };
  w.eval(HELP_SRC);
  if (opts.share !== false) w.eval(SHARE_SRC);
  return w;
}

(async function () {
  /* ① 设备判定 */
  console.log('\n① isDesktop() 设备判定');
  const PC_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36';
  const cases = [
    ['Windows 桌面', PC_UA, 0, true],
    ['Android 手机', 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Mobile Safari/537.36', 5, false],
    ['iPhone', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148', 5, false],
    ['iPad', 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148', 5, false],
    ['iPadOS 伪装 Macintosh', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Safari/605.1.15', 5, false],
    ['触屏 Windows 笔记本', PC_UA, 5, true],
    ['桌面 Mac（无触控）', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Safari/537.36', 0, true]
  ];
  cases.forEach(function (c) {
    const w = mkDom({ ua: c[1], touch: c[2] });
    check(c[0] + ' → ' + (c[3] ? 'PC' : '移动'), w.SXGGitHubAccess.isDesktop() === c[3],
      w.SXGGitHubAccess.isDesktop());
    w.close();
  });

  /* ② §36t：两条办法都常显，设备判定只决定推荐标记落在哪一条 */
  console.log('\n② helpHtml() 两条办法都常显 + 推荐标记');
  const wPc = mkDom({});
  const hPc = wPc.SXGGitHubAccess.helpHtml();
  check('PC 含 Steam++ 官网', hPc.indexOf('https://steampp.net/') !== -1);
  check('PC 含「网络加速」与「勾选 GitHub」', /网络加速/.test(hPc) && /勾选/.test(hPc) && /GitHub/.test(hPc));
  check('PC 也把手机 / 平板那条常显（不隐藏）', hPc.indexOf('47.112.97.173') !== -1 && /手机\s*\/\s*平板/.test(hPc));
  check('PC 两条 row 都在', (hPc.match(/sxg-gh-help__row/g) || []).length === 2);
  check('PC 只有一枚推荐标记，落在电脑那条',
    (hPc.match(/sxg-gh-help__rec/g) || []).length === 1
    && /steampp\.net[\s\S]{0,180}当前设备 · 推荐/.test(hPc));
  check('PC 无「站长推荐 / 点此购买」推广话术', !/站长推荐|点此购买/.test(hPc));
  check('不再写「自动判断，无需手动切换」', !/已按当前设备自动判断，无需手动切换/.test(hPc));
  wPc.close();

  const wMob = mkDom({ ua: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) Mobile Safari/537.36', touch: 5 });
  const hMob = wMob.SXGGitHubAccess.helpHtml();
  check('移动端含站点原有入口', hMob.indexOf('47.112.97.173:8000/register?aff=v17mHNYv') !== -1);
  check('移动端也把电脑那条常显（不隐藏）', hMob.indexOf('steampp.net') !== -1 && /网络加速/.test(hMob));
  check('移动端文案点明手机 / 平板', /手机\s*\/\s*平板/.test(hMob));
  check('移动端两条 row 都在', (hMob.match(/sxg-gh-help__row/g) || []).length === 2);
  check('移动端只有一枚推荐标记，落在手机 / 平板那条',
    (hMob.match(/sxg-gh-help__rec/g) || []).length === 1
    && /手机\s*\/\s*平板[\s\S]{0,260}当前设备 · 推荐/.test(hMob));
  wMob.close();

  /* ③ populate 幂等 */
  console.log('\n③ populate() 填充幂等');
  const wPop = mkDom({});
  const slot = wPop.document.getElementById('slot');
  wPop.SXGGitHubAccess.populate(slot);
  const n1 = slot.querySelectorAll('.sxg-gh-help').length;
  wPop.SXGGitHubAccess.populate(slot);
  const n2 = slot.querySelectorAll('.sxg-gh-help').length;
  check('容器填充一次且重复调用不叠加', n1 === 1 && n2 === 1, { n1, n2 });
  check('容器标了 filled 标记', slot.getAttribute('data-sxg-gh-help-filled') === '1');
  wPop.close();

  /* ④ Star 二级菜单 */
  console.log('\n④ Star 二级菜单浮层');
  const wMenu = mkDom({});
  await new Promise(function (r) { setTimeout(r, 60); });
  const trig = wMenu.document.getElementById(wMenu.SXGGitHubAccess.TRIGGER_ID);
  if (TRIGGER_ON) {
    check('桌面在 Star 按钮旁挂了触发入口', !!trig && trig.getAttribute('data-sxg-gh-desktop') === '1');
    if (trig) {
      trig.dispatchEvent(new wMenu.Event('click', { bubbles: true, cancelable: true }));
      const fly = wMenu.document.getElementById(wMenu.SXGGitHubAccess.FLY_ID);
      check('点击后浮层出现且含访问帮助', !!fly && fly.textContent.indexOf('GitHub 访问帮助') !== -1);
      check('浮层用 fixed 定位（不插入 header 菜单）', !!fly && fly.style.position === 'fixed' && fly.parentNode === wMenu.document.body);
      wMenu.document.body.dispatchEvent(new wMenu.Event('click', { bubbles: true }));
      check('点外部收起浮层', !wMenu.document.getElementById(wMenu.SXGGitHubAccess.FLY_ID));
    }
  } else {
    check('SHOW_TRIGGER=false：顶栏不再挂 🌐 入口（只撤可见入口，2026-11-12 站长）', !trig);
    check('浮层机制原样保留（openFlyout 与 fixed 定位仍在意）',
      /function\s+openFlyout\(/.test(HELP_SRC) && /position:fixed/.test(HELP_SRC));
  }
  wMenu.close();

  /* §36t：窄屏不再挂下拉，🌐 圆钮仍贴在 Star 右侧常显（与桌面同一分支） */
  const wNarrow = mkDom({ narrow: true, ua: 'Mozilla/5.0 (Linux; Android 13) Mobile Safari/537.36', touch: 5 });
  const menu = wNarrow.document.createElement('div');
  menu.id = 'sxg-header-menu';
  wNarrow.document.body.appendChild(menu);
  await new Promise(function (r) { setTimeout(r, 60); });
  const trigN = wNarrow.document.getElementById(wNarrow.SXGGitHubAccess.TRIGGER_ID);
  if (TRIGGER_ON) {
    check('窄屏仍贴 Star 常显（同桌面父节点 #root）', !!trigN && trigN.parentNode && trigN.parentNode.id === 'root');
    check('窄屏入口沿用圆形桌面样式', !!trigN && trigN.getAttribute('data-sxg-gh-desktop') === '1');
  } else {
    check('SHOW_TRIGGER=false：窄屏同样不挂 🌐 入口（不是只藏桌面）', !trigN);
  }
  check('窄屏入口不进 #sxg-header-menu', !menu.querySelector('#' + wNarrow.SXGGitHubAccess.TRIGGER_ID));
  wNarrow.close();

  /* ⑤ shareUrl 剥除 sponsor.html */
  console.log('\n⑤ shareUrl() 链接规整');
  const wShare = mkDom({});
  const norm = wShare.SXGShare.shareUrl;
  const BASE = 'https://dujeongil-galaxy.github.io/shuangxiugou/';
  check('裸 sponsor.html → 站点根', norm(BASE + 'sponsor.html') === BASE, norm(BASE + 'sponsor.html'));
  check('带 query 也剥净', norm(BASE + 'sponsor.html?from=wx') === BASE);
  check('带 hash 也剥净', norm(BASE + 'sponsor.html#pay') === BASE);
  check('首页 URL 原样保留', norm(BASE + 'index.html') === BASE + 'index.html');
  check('路径中间的 sponsor.html 不误伤', norm(BASE + 'sponsor.html/foo') === BASE + 'sponsor.html/foo');
  check('打赏页 info().url 不带 sponsor.html', wShare.SXGShare.info().url === BASE, wShare.SXGShare.info().url);
  wShare.close();

  const wIdx = mkDom({ url: 'https://dujeongil-galaxy.github.io/shuangxiugou/' });
  check('首页 info().url 保持原样', wIdx.SXGShare.info().url === 'https://dujeongil-galaxy.github.io/shuangxiugou/');
  wIdx.close();

  setTimeout(function () {
    console.log('\n========== 结果：' + passed + ' 项通过，' + failed + ' 项失败 ==========');
    process.exit(failed ? 1 : 0);
  }, 100);
})();
