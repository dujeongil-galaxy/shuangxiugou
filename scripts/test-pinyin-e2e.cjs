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

// jsdom 没有布局引擎：scrollIntoView 未实现、getBoundingClientRect 恒 0。
// 定位链路（locateCard）的验收两者都离不开，补最小 stub：
//   scrollIntoView 计数 + 实例 rect 可控（用来模拟「React 恢复把目标卡挤走」）。
window.__scrollLog = [];
window.HTMLElement.prototype.scrollIntoView = function () {
  window.__scrollLog.push(this.id || '(no-id)');
  this.__scrolled = (this.__scrolled || 0) + 1;
};

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
//
// ⚠️ 必须与 bundle 一字不差。bundle 里是：
//   ne = n.filter(e => e.name.toLowerCase().includes(kw)
//     || e.companyName.toLowerCase().includes(kw)
//     || e.keyProducts.some(p => p.toLowerCase().includes(kw)))
// **只有这三个字段**。searchKeywords / summary / category / id 都不查。
//
// 2026-10-19 之前这里多算了 searchKeywords / summary / id，比 React 宽松，
// 于是「回填词其实搜不到」的品牌在测试里全部通过 —— 用户截图里
// 联想有「赵一鸣/零食很忙」、点进去却是空态，测试全绿。
// 假测试比没测试更危险：它给了「已验证」的错觉。
function nativeSearch(kw) {
  const t = (kw || '').trim().toLowerCase();
  if (!t) return BRANDS;
  return BRANDS.filter(b =>
    (b.name || '').toLowerCase().includes(t) ||
    (b.company || '').toLowerCase().includes(t) ||
    (b.products || []).some(k => k.toLowerCase().includes(t))
  );
}
// 词条级搜索：用户输入的首字母/拼音走的是 searchKeywords，
// 与「回填词能否命中」是两条完全不同的链路，必须分开验，不能混着算。
function keywordSearch(kw) {
  const t = (kw || '').trim().toLowerCase();
  if (!t) return BRANDS;
  return BRANDS.filter(b =>
    (b.kw || []).some(k => k.toLowerCase().includes(t)) || nativeSearch(t).indexOf(b) !== -1
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

setTimeout(async () => {
  console.log('=== 端到端：输拼音 → 联想 → 回填 → 原生搜索出卡片 ===\n');
  const cases = [
    ['ning', '宁德时代'], ['ndsd', '宁德时代'], ['ningde', '宁德时代'],
    ['byd', '比亚迪'], ['hw', '华为终端'], ['nongfu', '农夫山泉'],
    ['mt', '美团'], ['sf', '顺丰速运'], ['tt', '库迪咖啡'],
    ['cotti', '库迪咖啡'], ['mixue', '蜜雪冰城'], ['kenyue', '肯悦咖啡'], ['uniqlo', '优衣库'],
['chagee', '霸王茶姬'],
  ['gree', '格力'],
  ['midea', '美的'],
  ['dji', '大疆'], ['samsung', '三星'],
  ['pdl', '胖东来'],
  ['gwm', '长城汽车'],
  ['miniso', '名创优品'],
  ['bytedance', '字节跳动'],
  ['kuaishou', '快手'],
  ['xiaohongshu', '小红书'],
  ['mihoyo', '米哈游'],
  ['ctrip', '携程'],
  ['haidilao', '海底捞'],
  ['hema', '盒马'],
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
  // 品牌级首字母仍要能搜到（走 searchKeywords 词条链路，不是回填链路）
  fire('sf');
  check('品牌级首字母 sf 仍能命中顺丰（词条级）',
        keywordSearch('sf').some(b => /顺丰/.test(b.name)),
        keywordSearch('sf').map(b => b.name));

  console.log('\n=== 回归：联想候选里出现的每一家，点回去都必须搜得到（2026-10-19 bug）===');
  // 用户真实截图：输入「Ls」→ 候选里出现「赵一鸣/零食很忙」→
  // 点选后页面变成「未找到匹配的品牌信息」。
  // 原因两层：① 自定义卡不在 React 的 brands 数组里；② 回填词没被原生搜索命中。
  // 这条断言扫全部索引条目 × 常见查询，只要有一个候选点回去是空态就失败。
  {
    const probeQueries = ['ls', 'lsym', 'zym', 'lshm', 'ys', 'kfc', 'ydd', 'xm',
      'hongqi', 'hq', 'ning', 'pepsi', 'lsg', 'xingyu', 'sony', 'apple'];
    const dead = [];
    for (const q of probeQueries) {
      fire(q);
      for (const r of rows()) {
        // 2026-10-22：自定义卡候选走「定位」链路，不要求回填后可搜
        // （它们不在 React 的 brands 数组里，回填必然空态 —— 那是链路用错，
        //   不是候选不该出现）。定位链路的契约是 data-custom=1 + data-entry-id。
        if (r.getAttribute('data-custom') === '1') {
          if (!r.getAttribute('data-entry-id')) {
            dead.push({ q, 候选: r.textContent.trim().slice(0, 24), 问题: 'custom 行缺 data-entry-id' });
          }
          continue;
        }
        const fill = r.getAttribute('data-fill') || '';
        const hit = nativeSearch(fill);
        if (!hit.length) dead.push({ q, 候选: r.textContent.trim().slice(0, 24), 回填: fill });
      }
    }
    check('回填链路候选点回去都搜得到；custom 候选带定位标记', dead.length === 0, dead.slice(0, 6));
  }
  // 「Ls」这一例单独锁死，且 2026-10-22 正反翻转：
  // 10-19 修「点选空态」时把自定义卡全部踢出联想 → 输 ls 永远搜不出
  // 零食品牌（站长：「关于零食这个分类，修复过无数次」）。
  // 现在自定义卡必须出现，并带 custom 标记走定位链路。
  fire('Ls');
  {
    const names = rows().map(r => r.textContent);
    check('★ 输入 Ls 出现「赵一鸣/零食很忙」（自定义卡，走定位）',
          names.some(t => /赵一鸣/.test(t)), names);
    check('★ 输入 Ls 出现「零食有鸣」（自定义卡，走定位）',
          names.some(t => /零食有鸣/.test(t)), names);
    check('Ls 的自定义卡候选都带 custom 标记（点击走定位而非回填）',
          rows().filter(r => /赵一鸣|零食有鸣/.test(r.textContent))
            .every(r => r.getAttribute('data-custom') === '1'),
          rows().map(r => [r.textContent.trim().slice(0, 20), r.getAttribute('data-custom')]));
    // 但 Ls 仍必须有真实候选，不能为了修 bug 把联想一起弄没
    check('输入 Ls 仍有真实品牌候选', rows().length > 0, names);
    check('输入 Ls 的非自定义候选点回去都能搜到',
          rows().filter(r => r.getAttribute('data-custom') !== '1')
            .every(r => nativeSearch(r.getAttribute('data-fill') || '').length > 0),
          rows().map(r => [r.textContent.trim().slice(0, 20), r.getAttribute('data-fill')]));
  }
  // 定位链路行为：点自定义卡候选 → 搜索框清空（React 恢复全量）、联想框隐藏
  {
    fire('Ls');
    const customRow = rows().find(r => r.getAttribute('data-custom') === '1');
    check('Ls 候选里存在自定义卡行（供定位链路测试）', !!customRow);
    if (customRow) {
      customRow.dispatchEvent(new window.MouseEvent('mousedown',
        { bubbles: true, cancelable: true }));
      const inp = window.document.getElementById('site-search-input');
      check('点击自定义卡候选后搜索框被清空（让 React 恢复全量列表）',
            inp.value === '', inp.value);
      check('点击后联想框隐藏',
            window.document.getElementById('pinyin-suggest').style.display === 'none');
    }
  }
  // 定位链路「最终真的滚到卡」：2026-10-22 实测 bug —— 只滚一次不够。
  // 点击候选时页面常停在上一轮搜索的过滤态，清空搜索后 React 把被过滤
  // 掉的内置卡逐个插回列表，目标卡被挤到下方几千像素，之前滚到的位置
  // 立刻失效（无头 Edge 实测：scrollIntoView 后 top=-22，200ms 后 top=3765）。
  // 所以 locateCard 必须在滚动后盯一小段窗口，目标跑出视口就补滚。
  {
    // ⚠️ 先耗尽上一个块遗留的 locateCard poll：它找不到卡会每 100ms
    // 重试、最多 2 秒。不耗尽的话，它会在本块补插卡片后「复活」并
    // 滚动一次，把 __scrolled 污染成 2 —— 补滚断言就永远真。
    await new Promise((r) => setTimeout(r, 2600));
    fire('Ls');
    // 选最后一个自定义卡候选：与上一个块点过的第一个不同 id，
    // 双保险防僵尸 poll 找到同一张卡。
    const customRows = rows().filter(r => r.getAttribute('data-custom') === '1');
    const customRow = customRows[customRows.length - 1];
    const entryId = customRow && customRow.getAttribute('data-entry-id');
    check('自定义卡候选带 data-entry-id（定位链路的目标）', !!entryId, entryId);
    let card = entryId ? window.document.getElementById(entryId) : null;
    if (!card && entryId) {
      // 本测试环境没有跑 insertAllCustomCards（root 是空的），造一张等价卡。
      // 真实浏览器里这张卡由 insertAllCustomCards 插入 —— 那条路由无头
      // Edge 视觉验收覆盖（_shot_bug_locate.png：点击后滚到并高亮）。
      card = window.document.createElement('div');
      card.id = entryId;
      card.className = 'bg-white rounded-2xl border';
      window.document.getElementById('root').appendChild(card);
    }
    check('定位目标卡存在（真实 DOM 或测试补插）', !!card, entryId);
    if (card) {
      // 模拟 React 恢复把目标卡挤出视口：第一次 rect 在视口内，之后一律在视口外。
      // （jsdom 的 rect 恒 0 = 永远「在视口内」，不 mock 的话 watch 永远不会触发，
      //   断言就成了摆设。）
      let rectCalls = 0;
      card.getBoundingClientRect = () => {
        rectCalls++;
        return rectCalls === 1
          ? { top: 100, bottom: 400 }
          : { top: 99999, bottom: 100400 };
      };
      card.__scrolled = 0;
      customRow.dispatchEvent(new window.MouseEvent('mousedown',
        { bubbles: true, cancelable: true }));
      // 等 locateCard 的 poll(100ms) + watch(250ms×5) 跑完：
      // t=250 第 1 次检查（rect 在视口内 → 不滚）、t=500 第 2 次
      // （rect 被 React 恢复挤出视口 → 补滚）。900ms 足够看到 ≥2 次滚动。
      // ⚠️ 这里不能改同步等待：Atomics.wait 会冻结整个事件循环，
      //    jsdom 的定时器一次都不会跑（实测 1500ms fired=0）。
      await new Promise((r) => setTimeout(r, 900));
      check('点击自定义卡候选后 scrollIntoView 至少调用一次（定位发生）',
            (card.__scrolled || 0) >= 1, card.__scrolled);
      check('★ 目标卡被 React 重渲染挤出视口后会补滚（watch 生效）',
            (card.__scrolled || 0) >= 2, { 滚动次数: card.__scrolled });
      delete card.getBoundingClientRect; // 恢复，避免污染后续断言
    }
  }
  // 自定义卡本身仍要能被中文搜到（由 filterCustomCards 负责，不靠联想）
  check('中文「赵一鸣」仍在 customCardsConfig 关键词里（自定义卡独立可搜）',
        /'赵一鸣'/.test(read('index.html')));

  console.log('\n=== 回归：原生中文/英文搜索不受影响 ===');
  check('原生搜「宁德时代」= 1 家', nativeSearch('宁德时代').length === 1, nativeSearch('宁德时代').map(b=>b.name));
  check('原生搜「CATL」= 1 家', nativeSearch('CATL').length === 1, nativeSearch('CATL').map(b=>b.name));
  check('原生搜「宁德」= 1 家', nativeSearch('宁德').length === 1);
  check('原生搜「苹果」= 1 家', nativeSearch('苹果').length === 1, nativeSearch('苹果').map(b=>b.name));
  check('原生搜空串 = 全部', nativeSearch('').length === BRANDS.length);
  check('原生搜乱码 = 0 家', nativeSearch('zzzzzz').length === 0);

  console.log('\n=== 回归：新增的宏碁卡必须能被搜到（含常见错别字）===');
  check('原生搜「宏碁」= 1 家', nativeSearch('宏碁').length === 1, nativeSearch('宏碁').map(b=>b.name));
  // ⚠️ 「宏基」是 searchKeywords 里的错别字，而 React 的首页过滤**不查**
  //    searchKeywords（只查 name/companyName/keyProducts）。所以它搜不出卡片
  //    是 bundle 的真实行为，不是本次改动造成的。联想层负责把它接住：
  //    输「hongji」仍能联想出宏碁、回填「宏碁」后可搜到。
  check('「宏基」在 searchKeywords 里（供拼音联想命中）', keywordSearch('宏基').some(b=>b.id==='acer'),
        keywordSearch('宏基').map(b=>b.name));
  fire('hongji');
  check('输 hongji 联想出宏碁，且回填词可被原生搜索命中',
        rows().length && /宏碁/.test(rows()[0].textContent) &&
        nativeSearch(rows()[0].getAttribute('data-fill') || '').some(b=>b.id==='acer'),
        rows().map(r => r.textContent));
  check('原生搜「Acer」= 1 家', nativeSearch('Acer').length === 1, nativeSearch('Acer').map(b=>b.name));
  check('原生搜「acer」小写= 1 家', nativeSearch('acer').length === 1);
  check('原生搜「笔记本」能带出宏碁', nativeSearch('笔记本').some(b=>b.id==='acer'));
  check('宏碁卡片在 bundle 里，tier 为 U（2026-10-17 改档：无工时证据不评级）', nativeSearch('宏碁')[0] && nativeSearch('宏碁')[0].tier === 'U');
  // 同上：「客服」「周六」这些只在 summary / reasons 里，React 首页过滤不查。
  check('「客服」在 bundle 正文里（不参与首页过滤，属正常）',
        src.indexOf('客服') !== -1);

  console.log('\n' + '='.repeat(52));
  console.log(`通过 ${pass} 项，失败 ${fail} 项`);
  if (fail) console.log('失败项：\n  - ' + fails.join('\n  - '));
  process.exit(fail ? 1 : 0);
}, 400);