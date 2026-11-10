// 2026-11-10 站长全站检查回归：品牌专属登记框不许串到别的卡片。
// 复现现场：index.html 用 templateCard.cloneNode(true) 造自定义卡，
// A 级模板 = Logitech (罗技)、C 级模板 = 常州星宇股份，模板被新闻补丁插框后
// 整框复制进 103 张无关自定义卡（罗技 65 份 / 星宇 40 份）。
// 本测试用 jsdom 真 DOM 验证两层修复：
//   ① index.html 克隆后的剥离表（NODES/ATTRS）确实能清空模板带来的框；
//   ② news-incident-patch.js 的品牌绑定自愈：标题一换，框自动消失；换回来自动补挂。
// 跑法：node scripts/test-news-scope.cjs
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const tick = (ms) => new Promise((r) => setTimeout(r, ms));

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
  console.log('=== 品牌专属登记框：克隆污染 / 串卡自愈 ===\n');
  const src = read('news-incident-patch.js');
  const html = read('index.html');

  // ─────────── 1. 静态：克隆剥离表 + 补丁自愈逻辑 ───────────
  console.log('--- 1. 静态接线 ---');
  const grab = (name) => {
    const m = html.match(new RegExp('var ' + name + ' = \\[([\\s\\S]*?)\\];'));
    return m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : null;
  };
  const stripNodes = grab('SXG_CLONE_STRIP_NODES');
  const stripAttrs = grab('SXG_CLONE_STRIP_ATTRS');
  check('index.html 定义了克隆剥离表 NODES / ATTRS',
    Array.isArray(stripNodes) && stripNodes.length >= 8
    && Array.isArray(stripAttrs) && stripAttrs.length >= 4);
  const mustNodes = ['data-sxg-news', 'data-byd-expose', 'data-luckin-note',
    'data-luxiyi-alt', 'data-ai-notice', 'data-rate-note'];
  check('NODES 覆盖所有品牌专属补丁注入节点',
    mustNodes.every((n) => stripNodes.includes(n)), stripNodes);
  check('ATTRS 覆盖补丁写在骨架上的「已处理」标记',
    ['data-luckin-policy', 'data-rate-patched', 'data-sxg-localnote', 'data-sxg-tier']
      .every((n) => stripAttrs.includes(n)), stripAttrs);
  check('class 型注入节点（.sxg-localnote）也被剥离，避免重复挂两行提示',
    /newCard\.querySelectorAll\('\.sxg-localnote'\)/.test(html)
    && /removeChild\(sxgLocalNotes\[sl\]\)/.test(html));
  check('剥离代码紧贴在 cloneNode(true) 之后',
    html.indexOf('SXG_CLONE_STRIP_NODES') > html.indexOf('cloneNode(true)')
    && html.indexOf('SXG_CLONE_STRIP_NODES') - html.indexOf('cloneNode(true)') < 3000);
  const newsCode = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  check('新闻补丁有品牌绑定自愈（cleanupMisplaced + dedupeOn 且 patchOnce 真的调用）',
    /function cleanupMisplaced\(/.test(newsCode) && /function dedupeOn\(/.test(newsCode)
    && /cleanupMisplaced\(item\)\s*;/.test(newsCode) && /cardTitle\(card\)/.test(newsCode));
  check('CI 挂了本回归测试', /test-news-scope\.cjs/.test(read('.github/workflows/verify.yml')));

  // ─────────── 2. 真 DOM：补丁 + 克隆 ───────────
  console.log('\n--- 2. 真 DOM：补丁挂载 / 克隆 / 自愈 ---');
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => {
    if (/Could not load|not implemented/i.test(e.message)) return;
    errors.push(e.message);
  });
  const CARD = (title, id) => `<div class="bg-white rounded-2xl border" id="${id}">` +
    '<div class="p-5 space-y-3.5">' +
    '<div class="flex items-start justify-between gap-3"><div><h2>' + title + '</h2>' +
    '<p>示例公司</p></div><span>评级徽章</span></div>' +
    '<div class="bg-slate-50 rounded-xl p-2.5"><span>工时政策：</span><span>—</span></div>' +
    '<div class="flex flex-wrap gap-1.5 pt-1"><span>标签</span></div>' +
    '</div></div>';
  const dom = new JSDOM(
    '<!doctype html><html><head></head><body>' +
    CARD('Patagonia (巴塔哥尼亚)', 'other-card') +
    CARD('Logitech (罗技)', 'logi-card') +
    CARD('常州星宇股份 (车灯及汽车消费品)', 'xing-card') +
    '</body></html>',
    { runScripts: 'outside-only', url: 'http://localhost/', virtualConsole: vc, pretendToBeVisual: true }
  );
  const { window } = dom;
  const doc = window.document;
  try { window.eval(src); } catch (e) { errors.push('eval patch: ' + e.message); }
  await tick(160);

  check('★ 罗技 / 星宇各只挂 1 个框，其它卡 0 个',
    doc.querySelectorAll('#logi-card [data-sxg-news="logitech"]').length === 1
    && doc.querySelectorAll('#xing-card [data-sxg-news="xingyu"]').length === 1
    && doc.querySelectorAll('#other-card [data-sxg-news]').length === 0);

  // 模拟 index.html 的 cloneNode(true)：从带框的罗技卡克隆一张「阿里巴巴」出来
  const template = doc.querySelector('#logi-card');
  const clone = template.cloneNode(true);
  clone.id = 'ali-card';
  clone.querySelector('h2').textContent = '阿里巴巴';

  // ① 先验证「不剥离」一定串卡（这就是站长截图里的现象）
  check('★ 未剥离时克隆体确实带着罗技的框（故障现场可复现）',
    clone.querySelectorAll('[data-sxg-news="logitech"]').length === 1);

  // ② 按 index.html 的真实剥离表清理，克隆体必须干净
  const doStrip = (root) => {
    for (const n of stripNodes) {
      const nodes = root.querySelectorAll('[' + n + ']');
      for (const node of nodes) if (node.parentNode) node.parentNode.removeChild(node);
    }
    const notes = root.querySelectorAll('.sxg-localnote');
    for (const node of notes) if (node.parentNode) node.parentNode.removeChild(node);
    const roots = [root].concat([].slice.call(root.querySelectorAll('*')));
    for (const el of roots) for (const a of stripAttrs) el.removeAttribute(a);
  };
  doStrip(clone);
  check('★ 按剥离表清理后克隆体零登记框',
    clone.querySelectorAll('[data-sxg-news]').length === 0);

  // ③ 把「忘了剥离」的克隆体也放进场，验证补丁自愈会兜底清掉
  const dirtyClone = template.cloneNode(true);
  dirtyClone.id = 'baidu-card';
  dirtyClone.querySelector('h2').textContent = '百度';
  doc.body.appendChild(dirtyClone);
  await tick(180);
  check('★ 补丁自愈：忘了剥离的克隆体，挂错品牌的框被自动删除',
    dirtyClone.querySelectorAll('[data-sxg-news]').length === 0
    && doc.querySelectorAll('[data-sxg-news="logitech"]').length === 1);

  // ④ 标题被换掉 / 换回来：框跟着走，不残留
  const xing = doc.querySelector('#xing-card');
  xing.querySelector('h2').textContent = '零食有鸣';
  await tick(180);
  check('★ 标题改成无关品牌后，星宇框自动消失',
    doc.querySelectorAll('[data-sxg-news="xingyu"]').length === 0);
  xing.querySelector('h2').textContent = '常州星宇股份 (车灯及汽车消费品)';
  await tick(180);
  check('★ 标题改回来后，星宇框自动补挂且只有一份',
    doc.querySelectorAll('#xing-card [data-sxg-news="xingyu"]').length === 1
    && doc.querySelectorAll('[data-sxg-news="xingyu"]').length === 1);

  check('运行期无 JS 异常', errors.length === 0, errors.slice(0, 3));

  console.log('\n' + '='.repeat(52));
  console.log(`通过 ${pass} 项，失败 ${fail} 项`);
  if (fail) console.log('失败项：\n  - ' + fails.join('\n  - '));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
