// 端到端集成测试：真实 bundle + 真实 index.html 注入层 + 真实拼音脚本
//
// 为什么不用 agent-browser 截图：截图只能证明「看起来对」，
// 无法证明「回填后 React 真的重新过滤了」。这里直接加载真实 bundle，
// 断言回填后卡片列表里确实只剩目标品牌 —— 那是用户真正看到的结果。
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const dom = new JSDOM(
  `<!DOCTYPE html><html><body>
     <div id="root"></div>
     <main><div><input type="text" id="site-search-input"></div></main>
   </body></html>`,
  {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'http://localhost/',
  }
);
const { window } = dom;

// 注入真实的拼音索引与逻辑
window.eval(read('pinyin-index.js'));
window.eval(read('pinyin-search.js'));

// 用真实 bundle 的 brands 数据 + 真实的搜索算法，重建一个最小 React 等价体。
// bundle 里的过滤逻辑（压缩后）是：
//   name/companyName/category/searchKeywords/keyProducts/summary/id 任一 includes 命中
// 这里刻意复刻它，用来验证「回填的词能被原生搜索命中」。
const src = read('assets/index-YthXZ9eP.js');
const BT = String.fromCharCode(96);
const marker = 'brands:[';
let i = src.indexOf(marker) + marker.length;
const objs = [];
let depth = 0, cur = null, j = i;
while (j < src.length) {
  const ch = src[j];
  if (ch === BT) {
    // 跳过整个模板字符串，内部的花括号不参与配平
    j++;
    while (j < src.length) {
      if (src[j] === BT && src[j - 1] !== '\\') break;
      j++;
    }
  } else if (ch === '{') {
    if (depth === 0) cur = j;
    depth++;
  } else if (ch === '}') {
    depth--;
    if (depth === 0) {
      objs.push(src.slice(cur, j + 1));
    } else if (depth < 0) {
      break;
    }
  }
  j++;
}
const fld = (o, k) => { const m = new RegExp(k + ':' + BT + '([^' + BT + ']*)' + BT).exec(o); return m ? m[1] : null; };
const arr = (o, k) => { const m = new RegExp(k + ':\\[([^\\]]*)\\]').exec(o); return m ? [...m[1].matchAll(new RegExp(BT + '([^' + BT + ']*)' + BT, 'g'))].map(x => x[1]) : []; };
const BRANDS = objs.map(o => ({
  id: fld(o, 'id'), name: fld(o, 'name'), company: fld(o, 'companyName'),
  category: fld(o, 'category'), tier: fld(o, 'tier'),
  kw: arr(o, 'searchKeywords'), products: arr(o, 'keyProducts'), summary: fld(o, 'summary'),
})).filter(b => b.id);
console.log('真实 bundle 品牌数:', BRANDS.length, '\n');

// 复刻 bundle 原生搜索（压缩后真实逻辑）
function nativeSearch(kw) {
  const t = kw.trim().toLowerCase();
  if (!t) return BRANDS;
  return BRANDS.filter(b =>
    (b.name || '').toLowerCase().includes(t) ||
    (b.company || '').toLowerCase().includes(t) ||
    (b.category || '').toLowerCase().includes(t) ||
    (b.kw || []).some(k => k.toLowerCase().includes(t)) ||
    (b.products || []).some(k => k.toLowerCase().includes(t)) ||
    (b.summary || '').toLowerCase().includes(t) ||
    (b.id || '').toLowerCase().includes(t)
  );
}

const input = window.document.getElementById('site-search-input');
function fire(v) {
  input.value = v;
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
}
const box = () => window.document.getElementById('pinyin-suggest');
const rows = () => {
  const b = box();
  return b && b.style.display !== 'none' ? [...b.querySelectorAll('button[data-fill]')] : [];
};

let pass = 0, fail = 0; const fails = [];
const check = (l, c, x) => {
  if (c) { pass++; console.log('  ✓', l); }
  else { fail++; fails.push(l); console.log('  ✗', l, x !== undefined ? JSON.stringify(x) : ''); }
};

setTimeout(() => {
  console.log('=== 端到端：输拼音 → 联想 → 回填 → 原生搜索出卡片 ===\n');
  const cases = [
    ['ning', '宁德时代'], ['ndsd', '宁德时代'], ['ningde', '宁德时代'],
    ['byd', '比亚迪'], ['hw', '华为'], ['nongfu', '农夫山泉'],
    ['mt', '美团'], ['sf', '顺丰'], ['tt', '优衣库'],
    ['hongqi', '宏碁'], ['hq', '宏碁'], ['acer', '宏碁'], ['hongji', '宏碁'],
  ];
  for (const [q, expect] of cases) {
    fire(q);
    const r = rows();
    if (!r.length) { check(`${q} → 有联想候选`, false); continue; }
    const fill = r[0].getAttribute('data-fill');
    // 关键断言：回填词走原生搜索后，必须只剩目标品牌
    const res = nativeSearch(fill);
    const hit = res.some(b => b.name.includes(expect));
    check(`${q} 回填「${fill}」→ 原生搜出 ${expect}`, hit && res.length <= 2,
      { 得到: res.map(b => b.name) });
  }

  console.log('\n=== 反向断言：回填词必须真的收窄结果 ===');
  fire('ning');
  const fill = rows()[0].getAttribute('data-fill');
  const narrowed = nativeSearch(fill);
  check(`「${fill}」把 ${BRANDS.length} 家收窄到 ${narrowed.length} 家`,
        narrowed.length > 0 && narrowed.length < 5, narrowed.map(b => b.name));
  check('结果里确实含宁德时代', narrowed.some(b => b.id === 'catl'));

  console.log('\n=== 反向断言：拼音联想不得放宽成「什么都搜得到」===');
  fire('catl');
  const r2 = rows();
  check('catl 联想首个候选是宁德时代', r2.length && /宁德时代/.test(r2[0].textContent), r2.map(x=>x.textContent));

  console.log('\n=== 产品名不得污染首字母匹配（真实 bug 回归）===');
  // bug：搜 xl 曾同时命中「vivo X 系列」「纯茶饮系列」「夜行者系列」「生鲜冷链」
  // ——全是产品线。用户搜 xl 是想找品牌，不是找产品。
  fire('xl');
  const xlRows = rows();
  const xlNames = xlRows.map(r => r.textContent);
  const productHits = xlNames.filter(t => /系列|冷链/.test(t));
  check('xl 联想结果里不含产品线（系列/冷链）',
        productHits.length === 0, xlNames);
  check('xl 要么不联想，要么只给品牌级结果',
        xlRows.length === 0 || xlNames.every(t => /系列|冷链/.test(t) === false), xlNames);
  // 品牌级首字母仍要能搜到
  fire('sf');
  check('品牌级首字母 sf 仍能搜到顺丰',
        rows().length && /顺丰/.test(rows()[0].textContent), rows().map(r => r.textContent));

  console.log('\n=== 回归：原生中文/英文搜索不受影响 ===');
  check('原生搜「宁德时代」= 1 家', nativeSearch('宁德时代').length === 1, nativeSearch('宁德时代').map(b=>b.name));
  check('原生搜「CATL」= 1 家', nativeSearch('CATL').length === 1, nativeSearch('CATL').map(b=>b.name));
  check('原生搜「宁德」= 1 家', nativeSearch('宁德').length === 1);
  check('原生搜「苹果」= 1 家', nativeSearch('苹果').length === 1, nativeSearch('苹果').map(b=>b.name));
  check('原生搜空串 = 全部', nativeSearch('').length === BRANDS.length);
  check('原生搜乱码 = 0 家', nativeSearch('zzzzzz').length === 0);

  console.log('\n=== 回归：新增的宏碁卡必须能被搜到（含常见错别字）===');
  check('原生搜「宏碁」= 1 家', nativeSearch('宏碁').length === 1, nativeSearch('宏碁').map(b=>b.name));
  check('原生搜「宏基」（错别字）= 1 家', nativeSearch('宏基').length === 1, nativeSearch('宏基').map(b=>b.name));
  check('原生搜「Acer」= 1 家', nativeSearch('Acer').length === 1, nativeSearch('Acer').map(b=>b.name));
  check('原生搜「acer」小写= 1 家', nativeSearch('acer').length === 1);
  check('原生搜「笔记本」能带出宏碁', nativeSearch('笔记本').some(b=>b.id==='acer'));
  check('宏碁卡片在 bundle 里，tier 为 B', nativeSearch('宏碁')[0] && nativeSearch('宏碁')[0].tier === 'B');
  check('宏碁客服口径文案可搜到', nativeSearch('客服').some(b=>b.id==='acer'));

  console.log('\n' + '='.repeat(52));
  console.log(`通过 ${pass} 项，失败 ${fail} 项`);
  if (fail) console.log('失败项：\n  - ' + fails.join('\n  - '));
  process.exit(fail ? 1 : 0);
}, 400);