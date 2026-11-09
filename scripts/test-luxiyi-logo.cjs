// 2026-11-09 站长批次回归：「去拼音搜索框找陆喜依，提交 logo」。
// 真渲染 index.html + 注入层，断言拼音搜索框里陆喜依品牌卡真的挂上了那张插画，
// 而不是只改了配置字符串、页面仍显示文字回退（这个站的默认静默失效方式）。
// 跑法：npm install --no-save jsdom && node scripts/test-luxiyi-logo.cjs
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const LOGO = './assets/luxiyi.jpg';

let pass = 0, fail = 0;
const fails = [];
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else {
    fail++; fails.push(label);
    console.log('  ✗', label, extra !== undefined ? JSON.stringify(extra) : '');
  }
}

(async () => {
  console.log('=== 陆喜依品牌卡 logo（拼音搜索框） ===\n');

  // ─────────── 0. 单一真相源：文件与两处引用 ───────────
  console.log('--- 0. 素材单一真相源 ---');
  check('logo 文件真实存在于 assets/', fs.existsSync(path.join(ROOT, 'assets/luxiyi.jpg')));
  const html = read('index.html');
  const ad = read('black-card-adslot.js');
  check('品牌卡配置指向该图片',
    /\{\s*id:\s*'luxiyi-card',[\s\S]{0,400}?logo:\s*'\.\/assets\/luxiyi\.jpg'/.test(html));
  check('滚动广告位品牌卡也指向同一张图（不重复入库明文素材）',
    ad.indexOf("var IMG = './assets/luxiyi.jpg'") !== -1);
  check('品牌卡不再用 null 文字回退',
    !/\{\s*id:\s*'luxiyi-card',[\s\S]{0,300}?logo:\s*null/.test(html));

  // ─────────── 1. 真渲染：拼音搜索框里那张卡 ───────────
  console.log('\n--- 1. 全站真渲染：拼音搜索框找陆喜依 ---');
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => {
    if (/Could not load|not implemented/i.test(e.message)) return;
    errors.push(e.message);
  });
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', resources: undefined,
    url: 'http://localhost/', virtualConsole: vc, pretendToBeVisual: true,
  });
  const { window } = dom;
  const doc = window.document;
  if (!window.matchMedia) {
    window.matchMedia = (q) => ({
      matches: false, media: q, onchange: null,
      addListener() {}, removeListener() {},
      addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; },
    });
  }
  window.scrollTo = window.scrollTo || (() => {});
  if (!window.requestAnimationFrame) {
    window.requestAnimationFrame = (cb) => window.setTimeout(() => cb(Date.now()), 16);
    window.cancelAnimationFrame = (h) => window.clearTimeout(h);
  }
  const order = [
    ...html.matchAll(/<script[^>]*\bsrc="([^"]+)"/g),
    ...html.matchAll(/<link[^>]*\bas="script"[^>]*\bhref="([^"]+)"/g),
  ].map((m) => m[1]);
  for (const srcPath of [...new Set(order)]) {
    const clean = srcPath.split('?')[0];
    if (clean.startsWith('http')) continue;
    const file = path.join(ROOT, clean);
    if (!fs.existsSync(file)) continue;
    try { window.eval(read(clean)); } catch (e) { errors.push('eval ' + clean + ': ' + e.message); }
  }
  await new Promise((r) => setTimeout(r, 800));
  try { await require('./_wait-cards.cjs')(window); } catch (e) {
    console.log('  ✗ 卡片未落齐：' + e.message); process.exit(1);
  }

  const card = doc.getElementById('luxiyi-card');
  check('陆喜依品牌卡已注入（拼音搜索框的结果卡）', !!card);
  const logoDiv = card && card.querySelector('.w-10.h-10.rounded-xl.bg-slate-100');
  check('品牌卡有 logo 容器', !!logoDiv);
  if (logoDiv) {
    const img = logoDiv.querySelector('img');
    check('logo 容器里真的挂了 <img>（不是文字回退）', !!img,
      logoDiv.textContent.trim());
    check('图片地址就是站长提交的那张插画', !!img && img.getAttribute('src') === LOGO,
      img && img.getAttribute('src'));
    check('图片 alt 为「陆喜依」', !!img && img.getAttribute('alt') === '陆喜依',
      img && img.getAttribute('alt'));
    check('未触发 onerror 文字降级', logoDiv.getAttribute('data-logo-fallback') !== '1',
      logoDiv.getAttribute('data-logo-fallback'));
  }

  // 拼音搜索框：输中文主名，卡仍可见且带图（站长「去拼音搜索框找陆喜依」的动作）
  const input = doc.getElementById('site-search-input');
  check('拼音搜索框存在', !!input);
  if (input && card) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    const type = (q) => {
      setter.call(input, q);
      input.dispatchEvent(new window.Event('input', { bubbles: true }));
    };
    type('陆喜依');
    check('输「陆喜依」时品牌卡可见', card.style.display !== 'none', card.style.display);
    const imgAfter = card.querySelector('.w-10.h-10.rounded-xl.bg-slate-100 img');
    check('搜索结果里这张卡仍显示 logo 图', !!imgAfter && imgAfter.getAttribute('src') === LOGO,
      imgAfter && imgAfter.getAttribute('src'));

    // 拼音全拼 / 首字母走联想回填（站点既有设计，不擅自改口径）：
    // 联想框必须能给回填词，点了才出卡。锁住这条链路不断。
    const box = doc.getElementById('pinyin-suggest');
    for (const q of ['luxiyi', 'lxy']) {
      type(q);
      const fills = box && box.style.display !== 'none'
        ? [...box.querySelectorAll('button[data-fill]')].map((b) => b.getAttribute('data-fill')) : [];
      check(`输「${q}」联想里有「陆喜依」可回填`, fills.includes('陆喜依'), fills);
    }
    type('');
    check('清空后品牌卡恢复可见且带图',
      card.style.display !== 'none'
      && card.querySelector('.w-10.h-10.rounded-xl.bg-slate-100 img') !== null);
  }

  console.log('\n' + '='.repeat(52));
  console.log(`通过 ${pass} 项，失败 ${fail} 项`);
  if (fail) console.log('失败项：\n  - ' + fails.join('\n  - '));
  if (errors.length) console.log('运行期告警（不阻断）：\n  - ' + errors.slice(0, 5).join('\n  - '));
  process.exit(fail ? 1 : 0);
})();
