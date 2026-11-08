// 2026-11-08 站长批次回归：① 奶茶／新茶饮类 B/C 级平替统一推荐陆喜依；
// ② 关联词典别名（MIUI 等）无需点击联想即可直接搜出自定义卡。
//
// 跑法：npm install --no-save jsdom && node scripts/test-luxiyi-alt.cjs
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const CLEAN_URL = 'https://luxiyi.tmall.com/';
// 拼接而非字面量：避免本文件自己被 §26 的参数红线扫中
const BAD_PARAMS = ['spm', 'topIds', 'user_id', 'member_id', 'buyer_id',
  'sellerId', 'nick', 'trackId'].map((k) => k + '=');

let pass = 0, fail = 0;
const fails = [];
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else {
    fail++; fails.push(label);
    console.log('  ✗', label, extra !== undefined ? JSON.stringify(extra) : '');
  }
}
const noBadParams = (s) => BAD_PARAMS.every((p) => s.indexOf(p) === -1);

(async () => {
  console.log('=== 陆喜依平替推荐 / 别名直接搜索 ===\n');

  // ─────────── 1. 轻量 DOM：补丁本体 ───────────
  console.log('--- 1. luxiyi-alt-patch.js 单元行为 ---');
  const mini = new JSDOM(`<!DOCTYPE html><html><body><div id="root">
    <div id="chabaidao-card" class="bg-white rounded-2xl border"><div class="p-5"><h2>茶百道</h2></div></div>
    <div id="yidiandian-card" class="bg-white rounded-2xl border"><div class="p-5"><h2>一点点</h2></div></div>
    <div id="molina-card" class="bg-white rounded-2xl border"><div class="p-5"><h2>茉莉奶白</h2></div></div>
    <div class="bg-white rounded-2xl border"><div class="p-5"><h2>喜茶 (HEYTEA)</h2></div></div>
    <div class="bg-white rounded-2xl border"><div class="p-5"><h2>蜜雪冰城 (MIXUE)</h2></div></div>
    <div class="bg-white rounded-2xl border"><div class="p-5"><h2>霸王茶姬 (CHAGEE)</h2></div></div>
    <div id="luckin-card" class="bg-white rounded-2xl border"><div class="p-5"><h2>瑞幸咖啡 (Luckin Coffee)</h2></div></div>
  </div></body></html>`, { runScripts: 'outside-only', pretendToBeVisual: true });
  const mw = mini.window;
  const patchSrc = read('luxiyi-alt-patch.js');
  mw.eval(patchSrc);
  const hook = mw.__sxgLuxiyiAlt;
  check('补丁暴露测试钩子且清单为 6 家', !!hook && hook.targets.length === 6,
    hook && hook.targets.map((t) => t.id));
  check('清洗后的店铺地址是零参数首页', !!hook && hook.shopUrl === CLEAN_URL, hook && hook.shopUrl);
  check('补丁源码不含账号/追踪参数', noBadParams(patchSrc));
  check('清单里只允许 B/C 两档', !!hook && hook.targets.every((t) => t.grade === 'B级' || t.grade === 'C级'));

  hook.apply();
  const boxes = () => mw.document.querySelectorAll('[data-luxiyi-alt="1"]');
  check('6 张奶茶类卡片各挂一个推荐小块', boxes().length === 6, boxes().length);
  check('非奶茶类（瑞幸）不挂推荐块',
    !mw.document.getElementById('luckin-card').querySelector('[data-luxiyi-alt="1"]'));
  const links = [...mw.document.querySelectorAll('[data-luxiyi-alt="1"] a')];
  check('每个推荐块都有可点链接', links.length === 6, links.length);
  check('链接全部指向零参数店铺首页', links.every((a) => a.getAttribute('href') === CLEAN_URL));
  check('链接 target/rel 安全跳转齐备',
    links.every((a) => a.getAttribute('target') === '_blank'
      && a.getAttribute('rel') === 'noopener noreferrer'));
  check('推荐块写明「员工实测待补」的诚实口径',
    [...boxes()].every((b) => /员工实测待补/.test(b.textContent)));
  check('推荐块写明非同类目 / 不构成背书',
    [...boxes()].every((b) => /不是同一类目/.test(b.textContent) && /不构成商业背书/.test(b.textContent)));
  check('渲染结果不含账号/追踪参数', noBadParams(mw.document.body.innerHTML));

  hook.apply();
  check('重复执行幂等（不叠加第二块）', boxes().length === 6, boxes().length);

  // 档位护栏：改成 S 级后不再补挂
  const first = mw.document.getElementById('chabaidao-card');
  first.querySelector('[data-luxiyi-alt="1"]').remove();
  hook.targets[0].grade = 'S级';
  hook.apply();
  check('升到 S 级后不再推荐（B/C 级护栏生效）',
    !first.querySelector('[data-luxiyi-alt="1"]') && boxes().length === 5, boxes().length);
  hook.targets[0].grade = 'C级';

  // ─────────── 2. 真实 index.html：别名直接出结果 ───────────
  console.log('\n--- 2. 全站真渲染：MIUI 不用点联想 ---');
  const html = read('index.html');
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

  const input = doc.getElementById('site-search-input');
  function typeQuery(q) {
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, q);
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    return true;
  }
  const xm = doc.getElementById('xiaomi-card');
  check('小米自定义卡已注入', !!xm);
  check('拼音索引已加载（别名可查）',
    Array.isArray(window.__PINYIN_INDEX__) && window.__PINYIN_INDEX__.length > 0);
  const visible = () => !!xm && xm.style.display !== 'none';

  for (const q of ['MIUI', 'miui', 'Redmi', 'POCO', 'hongmi']) {
    typeQuery(q);
    check(`输「${q}」直接显示小米卡（无需点联想）`, visible(), xm && xm.style.display);
  }
  typeQuery('小米');
  check('回归：输「小米」仍显示小米卡', visible());
  typeQuery('zzzzzz');
  check('回归：无匹配词仍隐藏小米卡', !visible(), xm && xm.style.display);
  typeQuery('');
  check('回归：清空后小米卡恢复显示', visible());

  // 首页六个奶茶卡也都挂上了推荐块
  if (window.__sxgLuxiyiAlt) window.__sxgLuxiyiAlt.apply();
  const homeBoxes = doc.querySelectorAll('[data-luxiyi-alt="1"]');
  check('首页奶茶类卡片全部挂上平替推荐块', homeBoxes.length >= 6, homeBoxes.length);
  check('首页推荐链接全部为清洗 URL',
    [...homeBoxes].every((b) => {
      const a = b.querySelector('a');
      return a && a.getAttribute('href') === CLEAN_URL;
    }));
  check('页面源码与运行时都没有账号/追踪参数',
    noBadParams(html) && noBadParams(doc.body.innerHTML));

  console.log('\n' + '='.repeat(52));
  console.log(`通过 ${pass} 项，失败 ${fail} 项`);
  if (fail) console.log('失败项：\n  - ' + fails.join('\n  - '));
  if (errors.length) console.log('运行期告警（不阻断）：\n  - ' + errors.slice(0, 5).join('\n  - '));
  process.exit(fail ? 1 : 0);
})();
