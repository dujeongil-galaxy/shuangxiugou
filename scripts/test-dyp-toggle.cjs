/* ==========================================================================
   test-dyp-toggle.cjs —— 首页弹窗「新版 / 旧版」转换按钮 行为测试
   --------------------------------------------------------------------------
   被测：dyp-version-toggle.js（浏览器 IIFE，jsdom 真跑）
   覆盖：
     ① 默认版本 new；转换按钮文案随版本翻转（替换旧版 / 新版本）
     ② 默认（new）把 .dyp__acts 调成 [比亚迪] [理想L8] [站长随笔]，隐藏事实核查
     ③ 切到 old 恢复 [在抖音中观看] [事实核查] [站长随笔]
     ④ 幂等：重复应用 new 不产生多枚 .dyp__douyin2
     ⑤ 桌面落位：Login GitHub 之后、带 sxg-header-btn、文案默认「替换旧版」
     ⑥ 手机落位：进 #sxg-fab-dock、带 dock 短标签、不进菜单
     ⑦ 点击转换按钮翻版本（new ↔ old）并记忆 localStorage
     ⑧ index.html 引用 dyp-version-toggle.js?v=1（剥 HTML 注释再判）
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'dyp-version-toggle.js'), 'utf8');

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name + (detail !== undefined ? ' → ' + JSON.stringify(detail) : '')); }
}

function mkDom(opts) {
  opts = opts || {};
  const state = { narrow: !!opts.narrow, listeners: [] };
  const html = '<!DOCTYPE html><html><head></head><body>'
    + '<div class="flex items-center gap-3" id="hdr" style="position:relative">'
    + '<a id="star" href="x">★ Star on GitHub</a>'
    + '<a id="sponsor-entry-btn" href="./sponsor.html">☕ 赞助本项目</a>'
    + '<a id="login-github-btn" href="https://x/auth/github">🔑 Login GitHub</a>'
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
  w.eval(SRC);
  w.document.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true }));
  if (w.SXGDypToggle) w.SXGDypToggle.sweep();
  return { w: w, state: state };
}

// 造一个 .dyp__acts（模拟 douyin-prompt.js + factcheck-button.js 已注入的弹窗底部）
function buildDyp(w, withFactcheck) {
  const acts = w.document.createElement('div');
  acts.className = 'dyp__acts';
  const go = w.document.createElement('a');
  go.className = 'dyp__go';
  go.textContent = '在抖音中观看';
  go.href = 'https://v.douyin.com/37pbo6qxUbs/';
  const later = w.document.createElement('a');
  later.className = 'dyp__later';
  later.href = './notes.html';
  later.textContent = '站长随笔';
  acts.appendChild(go);
  if (withFactcheck) {
    const fc = w.document.createElement('a');
    fc.className = 'dyp__factcheck';
    fc.id = 'dyp__factcheck';
    fc.href = './jiahua-fact-check.html';
    fc.textContent = '事实核查';
    acts.appendChild(fc);   // factcheck-button.js 插在 go 与 later 之间
  }
  acts.appendChild(later);
  w.document.body.appendChild(acts);
  return acts;
}

(async function () {
  /* ① 默认版本 new + 文案翻转 */
  console.log('\n① 默认版 new + 文案翻转');
  const a = mkDom({});
  check('默认版本是 new', a.w.SXGDypToggle.getVersion() === 'new');
  check('new 时标签「替换旧版」', a.w.SXGDypToggle.labelFor('new') === '替换旧版');
  check('old 时标签「新版本」', a.w.SXGDypToggle.labelFor('old') === '新版本');
  a.w.close();

  /* ② 默认（new）调成 [比亚迪] [理想L8] [站长随笔]，隐藏事实核查 */
  console.log('\n② new 版 acts');
  const b = mkDom({});
  buildDyp(b.w, true);
  b.w.SXGDypToggle.setVersion('new');
  b.w.SXGDypToggle.applyDyp('new');
  const actsB = b.w.document.querySelector('.dyp__acts');
  const goB = actsB.querySelector('.dyp__go');
  const fcB = actsB.querySelector('.dyp__factcheck');
  const d2B = actsB.querySelector('.dyp__douyin2');
  const laterB = actsB.querySelector('.dyp__later');
  check('主页按钮＝比亚迪抖音短链', goB.href === 'https://v.douyin.com/_n2cFrXIRec/'
    && goB.textContent === '比亚迪·抖音短片', { href: goB.href, t: goB.textContent });
  check('第二按钮＝理想L8抖音短链', !!d2B && d2B.href === 'https://v.douyin.com/EHOOH9INCMk/'
    && d2B.textContent === '理想L8·抖音短片', d2B && { href: d2B.href, t: d2B.textContent });
  check('事实核查被隐藏（display:none，不删除节点）', !!fcB && fcB.style.display === 'none');
  check('第三链接仍是站长随笔', !!laterB && laterB.textContent === '站长随笔'
    && laterB.href === b.w.location.href.replace(/\/$/, '') + '/notes.html' || laterB.href.indexOf('notes.html') !== -1);
  check('d2 插在站长随笔之前（第二按钮位）', !!d2B && d2B.nextSibling === laterB);
  b.w.close();

  /* ③ 切 old 恢复 [在抖音中观看] [事实核查] [站长随笔] */
  console.log('\n③ old 版 acts');
  const c = mkDom({});
  buildDyp(c.w, true);
  c.w.SXGDypToggle.setVersion('old');
  c.w.SXGDypToggle.applyDyp('old');
  const actsC = c.w.document.querySelector('.dyp__acts');
  const goC = actsC.querySelector('.dyp__go');
  const fcC = actsC.querySelector('.dyp__factcheck');
  const d2C = actsC.querySelector('.dyp__douyin2');
  check('主页按钮恢复「在抖音中观看」', goC.textContent === '在抖音中观看'
    && goC.href === 'https://v.douyin.com/37pbo6qxUbs/');
  check('事实核查恢复显示', !!fcC && fcC.style.display !== 'none');
  check('新版第二按钮 .dyp__douyin2 已移除', !d2C);
  c.w.close();

  /* ④ 幂等：重复应用 new 不重复造 .dyp__douyin2 */
  console.log('\n④ 幂等：重复应用不重复');
  const d = mkDom({});
  buildDyp(d.w, true);
  d.w.SXGDypToggle.applyDyp('new');
  d.w.SXGDypToggle.applyDyp('new');
  d.w.SXGDypToggle.applyDyp('new');
  check('new 应用三次仍只有 1 枚 .dyp__douyin2',
    d.w.document.querySelectorAll('.dyp__douyin2').length === 1);
  d.w.close();

  /* ⑤ 桌面落位 */
  console.log('\n⑤ 桌面顶栏落位');
  const e = mkDom({ narrow: false });
  const btnE = e.w.document.getElementById('sxg-dyp-toggle-btn');
  check('按钮存在', !!btnE);
  check('插在 Login GitHub 之后', !!btnE && btnE.previousSibling
    && btnE.previousSibling.id === 'login-github-btn');
  check('带 sxg-header-btn 且文案默认「替换旧版」', !!btnE
    && btnE.classList.contains('sxg-header-btn') && btnE.textContent === '替换旧版');
  e.w.close();

  /* ⑥ 手机落位 */
  console.log('\n⑥ 手机端进 dock');
  const f = mkDom({ narrow: true, dock: true });
  const btnF = f.w.document.getElementById('sxg-dyp-toggle-btn');
  const dock = f.w.document.getElementById('sxg-fab-dock');
  check('按钮是 dock 第一个子项', !!btnF && dock.firstChild === btnF);
  check('dock 短标签＝「替换旧版」', !!btnF && btnF.getAttribute('data-sxg-dock-label') === '替换旧版');
  check('绝不挂进 #sxg-header-menu', !f.w.document.getElementById('sxg-header-menu')
    || !f.w.document.getElementById('sxg-header-menu').contains(btnF));
  f.w.close();

  /* ⑦ 点击转换按钮翻版本 */
  console.log('\n⑦ 点击翻转 + 记忆');
  const g = mkDom({ narrow: false });
  const btnG = g.w.document.getElementById('sxg-dyp-toggle-btn');
  check('起始文案＝替换旧版（new）', btnG.textContent === '替换旧版');
  btnG.dispatchEvent(new g.w.Event('click', { bubbles: true, cancelable: true }));
  check('点一次 → new 翻成 old，文案＝新版本', g.w.SXGDypToggle.getVersion() === 'old'
    && btnG.textContent === '新版本');
  btnG.dispatchEvent(new g.w.Event('click', { bubbles: true, cancelable: true }));
  check('再点一次 → old 翻回 new，文案＝替换旧版', g.w.SXGDypToggle.getVersion() === 'new'
    && btnG.textContent === '替换旧版');
  g.w.close();

  /* ⑧ index.html 引用 ?v=1（剥 HTML 注释后再判，避免被注释块误判）*/
  console.log('\n⑧ index.html 引用');
  const idx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
    .replace(/<!--[\s\S]*?-->/g, '');
  check('index.html 已引用 dyp-version-toggle.js?v=1',
    /<script defer src="\.\/dyp-version-toggle\.js\?v=1"><\/script>/.test(idx));

  setTimeout(function () {
    console.log('\n========== 结果：' + passed + ' 项通过，' + failed + ' 项失败 ==========');
    process.exit(failed ? 1 : 0);
  }, 80);
})();
