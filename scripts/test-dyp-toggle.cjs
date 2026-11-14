/* ==========================================================================
   test-dyp-toggle.cjs —— 首页弹窗「新版 / 旧版」转换按钮 行为测试
   --------------------------------------------------------------------------
   被测：dyp-version-toggle.js（浏览器 IIFE，jsdom 真跑）
   覆盖：
     ① 默认版本 new；转换按钮文案随版本翻转（切换旧版 / 新版本）
     ② 默认（new）把 .dyp__acts 调成 [短片一] [短片二] [站长随笔]，隐藏事实核查
     ③ 切到 old 恢复 [在抖音中观看] [事实核查] [站长随笔]
     ④ 幂等：重复应用 new 不产生多枚 .dyp__douyin2
     ⑤ 落位：转换按钮在「弹窗内」右上角（.dyp__panel 内、插在 .dyp__x 之前），
        不在顶栏 / dock；带 .dyp__version-toggle
     ⑥ 弹窗未 build 时 sweep 不报错、不误建按钮
     ⑦ 点击转换按钮翻版本（new ↔ old）并记忆 localStorage
     ⑧ index.html 引用 dyp-version-toggle.js?v=7（剥 HTML 注释再判）
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
  const html = '<!DOCTYPE html><html><head></head><body>'
    + '<div class="flex items-center gap-3" id="hdr">'
    + '<a id="star" href="x">★ Star on GitHub</a>'
    + '<a id="sponsor-entry-btn" href="./sponsor.html">☕ 赞助本项目</a>'
    + '<a id="login-github-btn" href="https://x/auth/github">🔑 Login GitHub</a>'
    + '</div>'
    + (opts.panel ? buildPanelHtml() : '')
    + '</body></html>';
  const dom = new JSDOM(html, {
    runScripts: 'outside-only',
    url: 'https://dujeongil-galaxy.github.io/shuangxiugou/',
    pretendToBeVisual: true
  });
  const w = dom.window;
  w.matchMedia = function () { return { matches: false, addEventListener: function () {}, removeEventListener: function () {}, addListener: function () {} }; };
  w.eval(SRC);
  w.document.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true }));
  if (w.SXGDypToggle) w.SXGDypToggle.sweep();
  return { w: w };
}

// 模拟 douyin-prompt.js 的弹窗骨架（含 × 关闭 + tag + acts）
function buildPanelHtml() {
  return '<div class="dyp"><div class="dyp__mask"></div>'
    + '<div class="dyp__panel">'
    + '<button class="dyp__x" type="button" aria-label="关闭">×</button>'
    + '<div class="dyp__tag">劳工友好提醒</div>'
    + '<h2 class="dyp__title">压榨员工的产品，最后买单的是谁？</h2>'
    + '<div class="dyp__acts">'
    + '<a class="dyp__go" target="_blank" rel="noopener noreferrer"></a>'
    + '<a class="dyp__later" href="./notes.html">站长随笔</a>'
    + '</div>'
    + '</div></div>';
}

// 在已有弹窗里补一个事实核查节点（模拟 factcheck-button.js 注入到 go 与 later 之间）
function injectFactcheck(w) {
  const acts = w.document.querySelector('.dyp__acts');
  if (!acts || acts.querySelector('.dyp__factcheck')) return;
  const later = acts.querySelector('.dyp__later');
  const fc = w.document.createElement('a');
  fc.className = 'dyp__factcheck';
  fc.id = 'dyp__factcheck';
  fc.href = './jiahua-fact-check.html';
  fc.textContent = '事实核查';
  acts.insertBefore(fc, later);
}

(async function () {
  /* ① 默认版本 new + 文案翻转 */
  console.log('\n① 默认版 new + 文案翻转');
  const a = mkDom({});
  check('默认版本是 new', a.w.SXGDypToggle.getVersion() === 'new');
  check('new 时标签「切换旧版」', a.w.SXGDypToggle.labelFor('new') === '切换旧版');
  check('old 时标签「新版本」', a.w.SXGDypToggle.labelFor('old') === '新版本');
  a.w.close();

  /* ② 默认（new）调成 [短片一] [短片二] [站长随笔]，隐藏事实核查 */
  console.log('\n② new 版 acts');
  const b = mkDom({ panel: true });
  injectFactcheck(b.w);
  b.w.SXGDypToggle.setVersion('new');
  b.w.SXGDypToggle.applyDyp('new');
  const actsB = b.w.document.querySelector('.dyp__acts');
  const goB = actsB.querySelector('.dyp__go');
  const fcB = actsB.querySelector('.dyp__factcheck');
  const d2B = actsB.querySelector('.dyp__douyin2');
  const laterB = actsB.querySelector('.dyp__later');
  check('主页按钮＝比亚迪·短片一抖音短链', goB.href === 'https://v.douyin.com/_n2cFrXIRec/'
    && goB.textContent === '短片一', { href: goB.href, t: goB.textContent });
  // 2026-11-14 站长：理想L8 那条删了，换成 fe8jmWjCmqY（新车轮毂竟然装错）。
  // 两个入口至此都是比亚迪短片，按钮文字改按中性序号区分，各 3 字：
  //   短片一（比亚迪·前后轮辋装反了） / 短片二（比亚迪·新车轮毂竟然装错）。
  check('第二按钮＝比亚迪·短片二抖音短链', !!d2B && d2B.href === 'https://v.douyin.com/fe8jmWjCmqY/'
    && d2B.textContent === '短片二', d2B && { href: d2B.href, t: d2B.textContent });
  // 文案长度护栏：站长 2026-11-12「看看按钮大小，再看文字」——按钮是三等分窄格，
  // 文案超过 6 字（≈84px @14px）就会在 113px 的格子里触发 ellipsis 截断。
  check('两个新版按钮文案均 ≤6 字（防再写长导致截断）',
    goB.textContent.length <= 6 && d2B.textContent.length <= 6,
    { go: goB.textContent, d2: d2B.textContent });
  check('按钮 title 带「抖音短视频」说明（文案缩短后仍能说清是什么）',
    /抖音短视频/.test(goB.getAttribute('title') || '') && /抖音短视频/.test(d2B.getAttribute('title') || ''));
  check('事实核查被隐藏（display:none，不删除节点）', !!fcB && fcB.style.display === 'none');
  check('第三链接仍是站长随笔', !!laterB && laterB.textContent === '站长随笔'
    && laterB.href.indexOf('notes.html') !== -1);
  check('d2 在站长随笔之前（第二按钮位，可见顺序 抖音1→抖音2→随笔）',
    !!d2B && (d2B.compareDocumentPosition(laterB) & 4) === 4);
  b.w.close();

  /* ③ 切 old 恢复 [在抖音中观看] [事实核查] [站长随笔] */
  console.log('\n③ old 版 acts');
  const c = mkDom({ panel: true });
  injectFactcheck(c.w);
  c.w.SXGDypToggle.setVersion('old');
  c.w.SXGDypToggle.applyDyp('old');
  const actsC = c.w.document.querySelector('.dyp__acts');
  const goC = actsC.querySelector('.dyp__go');
  const fcC = actsC.querySelector('.dyp__factcheck');
  const d2C = actsC.querySelector('.dyp__douyin2');
  check('主页按钮恢复「在抖音中观看」', goC.textContent === '在抖音中观看'
    && goC.href === 'https://v.douyin.com/37pbo6qxUbs/');
  check('旧版不残留新版 title 提示', !goC.getAttribute('title'));
  check('事实核查恢复显示', !!fcC && fcC.style.display !== 'none');
  check('新版第二按钮 .dyp__douyin2 已移除', !d2C);
  c.w.close();

  /* ④ 幂等：重复应用 new 不重复造 .dyp__douyin2 */
  console.log('\n④ 幂等：重复应用不重复');
  const d = mkDom({ panel: true });
  injectFactcheck(d.w);
  d.w.SXGDypToggle.applyDyp('new');
  d.w.SXGDypToggle.applyDyp('new');
  d.w.SXGDypToggle.applyDyp('new');
  check('new 应用三次仍只有 1 枚 .dyp__douyin2',
    d.w.document.querySelectorAll('.dyp__douyin2').length === 1);
  d.w.close();

  /* ⑤ 落位：弹窗内右上角、× 之前、不在顶栏 */
  console.log('\n⑤ 弹窗内右上角落位');
  const e = mkDom({ panel: true });
  const panelE = e.w.document.querySelector('.dyp__panel');
  const btnE = e.w.document.getElementById('sxg-dyp-toggle-btn');
  const xE = panelE && panelE.querySelector('.dyp__x');
  check('按钮在 .dyp__panel 内', !!btnE && panelE.contains(btnE));
  check('插在 × 关闭按钮之前（右上角、× 左侧）', !!btnE && xE && btnE.nextSibling === xE);
  check('带 .dyp__version-toggle 且文案默认「切换旧版」', !!btnE
    && btnE.classList.contains('dyp__version-toggle') && btnE.textContent === '切换旧版');
  check('不在页面顶栏（不在 #hdr 内）', !!btnE && !e.w.document.getElementById('hdr').contains(btnE));
  e.w.close();

  /* ⑥ 弹窗未 build 时 sweep 不报错、不误建按钮 */
  console.log('\n⑥ 弹窗缺席时安全');
  const f = mkDom({ panel: false });
  check('无弹窗时 ensureButton 返回 null', f.w.SXGDypToggle.ensureButton() === null);
  check('无弹窗时未凭空创建按钮', !f.w.document.getElementById('sxg-dyp-toggle-btn'));
  f.w.close();

  /* ⑦ 点击转换按钮翻版本 */
  console.log('\n⑦ 点击翻转 + 记忆');
  const g = mkDom({ panel: true });
  const btnG = g.w.document.getElementById('sxg-dyp-toggle-btn');
  check('起始文案＝切换旧版（new）', btnG.textContent === '切换旧版');
  btnG.dispatchEvent(new g.w.Event('click', { bubbles: true, cancelable: true }));
  check('点一次 → new 翻成 old，文案＝新版本', g.w.SXGDypToggle.getVersion() === 'old'
    && btnG.textContent === '新版本');
  btnG.dispatchEvent(new g.w.Event('click', { bubbles: true, cancelable: true }));
  check('再点一次 → old 翻回 new，文案＝切换旧版', g.w.SXGDypToggle.getVersion() === 'new'
    && btnG.textContent === '切换旧版');
  g.w.close();

  /* ⑧ index.html 引用 ?v=7（剥 HTML 注释后再判，避免被注释块误判）*/
  console.log('\n⑧ index.html 引用');
  const idx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
    .replace(/<!--[\s\S]*?-->/g, '');
  check('index.html 已引用 dyp-version-toggle.js?v=7',
    /<script defer src="\.\/dyp-version-toggle\.js\?v=7"><\/script>/.test(idx));

  setTimeout(function () {
    console.log('\n========== 结果：' + passed + ' 项通过，' + failed + ' 项失败 ==========');
    process.exit(failed ? 1 : 0);
  }, 80);
})();
