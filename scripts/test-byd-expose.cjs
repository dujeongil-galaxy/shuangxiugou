// 2026-11-10 站长批次回归：比亚迪卡片「曝光登记」+ 视频下架如实登记。
// 真 DOM 验证（jsdom 加载 byd-expose-patch.js），不是只比对配置字符串——
// 这个站的默认静默失效方式就是「源码写了、渲染出来的卡片上啥也没有」。
// 跑法：npm install --no-save jsdom && node scripts/test-byd-expose.cjs
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const exists = (f) => fs.existsSync(path.join(ROOT, f));

let pass = 0, fail = 0;
const fails = [];
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else {
    fail++; fails.push(label);
    console.log('  ✗', label, extra !== undefined ? JSON.stringify(extra) : '');
  }
}
const tick = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  console.log('=== 比亚迪卡片：曝光登记 / 视频下架如实登记 ===\n');

  // ─────────── 0. 静态接线（三层强制的第三层） ───────────
  console.log('--- 0. 文件与接线 ---');
  const src = read('byd-expose-patch.js');
  const html = read('index.html');
  const detail = read('brand/byd.html');
  const wf = read('.github/workflows/verify.yml');
  const rd = read('README.md');

  check('曝光补丁文件存在', exists('byd-expose-patch.js'));
  check('首页挂了曝光补丁（?v=2 防缓存）',
    /<script defer src="\.\/byd-expose-patch\.js\?v=2"><\/script>/.test(html));
  check('真 DOM 测试挂进 CI 的 pinyin job', /test-byd-expose\.cjs/.test(wf));
  check('README 写死曝光登记口径',
    /比亚迪卡片曝光登记/.test(rd) && /失效链接不得冒充可点来源/.test(rd));

  // ─────────── 1. 如实登记：详情页 + 公示区 ───────────
  console.log('\n--- 1. 视频下架如实登记 ---');
  const evBlock = (detail.match(/<h2>证据来源<\/h2>\s*<ul>([\s\S]*?)<\/ul>/) || [])[1] || '';
  const bydLi = (evBlock.match(/<li style="margin:0 0 12px"><strong>BYD 直营门店强制加班曝光[\s\S]*?<\/li>/) || [])[0] || '';
  check('详情页证据条目存在', !!bydLi);
  for (const [label, needle] of [
    ['视频已删除', '该视频现已删除'],
    ['原链接已失效', '原链接已失效'],
    ['发布者受到某种压力', '受到了某种压力'],
    ['不作事实认定', '不对指称内容作事实认定'],
    ['劳动法第九十六条', '《劳动法》第九十六条'],
    ['强制加班至晚十点', '强制加班至晚十点'],
    ['随笔第10章', '《站长随笔》第10章'],
  ]) {
    check('详情页写了「' + label + '」', bydLi.indexOf(needle) !== -1 || detail.indexOf(needle) !== -1);
  }
  check('失效的抖音短链保留为纯文本记录（可追溯）', /v\.douyin\.com\/kKmeU180irU\//.test(bydLi));
  check('失效短链不再冒充可点原始链接（无 <a href>）',
    !/<a href="https:\/\/v\.douyin\.com\/kKmeU180irU\//.test(detail));
  const ebByd = (html.match(/<details id="ev-byd"[\s\S]*?<\/details>/) || [])[0] || '';
  check('公示区 ev-byd 5 条证据、可点链接 3 条（死链不计；11-13 新增法务部悬赏线索 +1 条带链）',
    /data-n="5" data-l="3"/.test(ebByd), ebByd.slice(0, 120));
  check('公示区摘要如实写出视频已删除 / 链接已失效',
    ebByd.indexOf('该视频现已删除') !== -1 && ebByd.indexOf('原链接已失效') !== -1);
  check('公示区该条标注「无可点原始链接」',
    (ebByd.match(/（本条无可点原始链接/g) || []).length === 2);

  // ─────────── 2. 补丁源码口径 ───────────
  console.log('\n--- 2. 补丁源码口径 ---');
  check('按标题 BYD (比亚迪) 定位卡片', /\^BYD\\s\*\\\(比亚迪\\\)/.test(src));
  check('幂等标记 + MutationObserver + rAF 合帧',
    /data-byd-expose/.test(src) && /new MutationObserver\(schedule\)/.test(src)
    && /requestAnimationFrame/.test(src));
  check('卡片里不放任何抖音外链（死链不进卡）', !/v\.douyin\.com|https?:\/\//.test(src));
  check('不抄站长口述、不写「日记」', !/日记/.test(src));
  check('随笔引用走站内 ./notes.html', /var NOTES_HREF = '\.\/notes\.html'/.test(src));

  // ─────────── 3. 真 DOM：渲染后卡片上真的挂了曝光框 ───────────
  console.log('\n--- 3. 真 DOM 渲染 ---');
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => {
    if (/Could not load|not implemented/i.test(e.message)) return;
    errors.push(e.message);
  });
  // 与线上 bundle 渲染出来的卡片同构（见 CDP dump）：
  // 根 .bg-white.rounded-2xl.border > .p-5.space-y-3.5 > 标题行 / 工时政策栏 / 标签行
  const CARD = (title, id) => `<div class="bg-white rounded-2xl border" id="${id}">` +
    '<div class="p-5 space-y-3.5">' +
    '<div class="flex items-start justify-between gap-3"><div><h2>' + title + '</h2>' +
    '<p>比亚迪股份有限公司</p></div><span>C级 · 避雷预警</span></div>' +
    '<div class="bg-slate-50 rounded-xl p-2.5"><span>工时政策：</span><span>产线高压单休</span></div>' +
    '<div class="flex flex-wrap gap-1.5 pt-1"><span>秦/汉/海鸥电动车</span></div>' +
    '</div></div>';
  const dom = new JSDOM(
    '<!doctype html><html><head></head><body>' +
    CARD('BYD (比亚迪)', 'byd-card') + CARD('Volvo (沃尔沃汽车)', 'volvo-card') +
    '</body></html>',
    { runScripts: 'outside-only', url: 'http://localhost/', virtualConsole: vc, pretendToBeVisual: true }
  );
  const { window } = dom;
  const doc = window.document;
  try { window.eval(src); } catch (e) { errors.push('eval patch: ' + e.message); }
  await tick(120);

  const bydCard = doc.getElementById('byd-card');
  const otherCard = doc.getElementById('volvo-card');
  const box = bydCard && bydCard.querySelector('[data-byd-expose]');
  check('比亚迪卡片上真的挂出了曝光框', !!box);
  if (!box) { console.log('渲染失败，后续断言跳过'); process.exit(1); }
  check('曝光框在卡片内容区里', box.parentElement.className === 'p-5 space-y-3.5',
    box.parentElement.className);
  check('曝光框插在标题行之后、工时政策栏之前（一眼可见）',
    box.parentElement.children[1] === box, [...box.parentElement.children].map((c) => c.tagName));
  const text = box.textContent.replace(/\s+/g, ' ').trim();
  check('标题是「直营门店强制加班曝光」', text.indexOf('直营门店强制加班曝光') !== -1);
  for (const [label, needle] of [
    ['强制加班至晚十点', '强制加班至晚十点'],
    ['《劳动法》第九十六条', '《劳动法》第九十六条'],
    ['该视频现已删除', '该视频现已删除'],
    ['原链接已失效', '原链接已失效'],
    ['受到了某种压力', '受到了某种压力'],
    ['不作事实认定', '不对指称内容作事实认定'],
    ['《站长随笔》第10章', '《站长随笔》第10章'],
  ]) {
    check('曝光框写了「' + label + '」', text.indexOf(needle) !== -1, text.slice(0, 160));
  }
  const notesLink = box.querySelector('a');
  check('随笔引用是站内真链接 ./notes.html',
    !!notesLink && notesLink.getAttribute('href') === './notes.html',
    notesLink && notesLink.getAttribute('href'));
  check('曝光框内没有任何外链 / 图片',
    !/https?:\/\//.test(box.innerHTML) && !box.querySelector('img'));
  // 2026-11-13 第二只框：琥珀色「站长点评 · 法务部悬赏」（同一幂等标记，一次插入两只）
  const bothBoxes = bydCard.querySelectorAll('[data-byd-expose]');
  const legalBox = bothBoxes[1];
  check('2026-11-13 起卡面共两只框（红色曝光登记 + 琥珀色站长点评）', bothBoxes.length === 2, bothBoxes.length);
  check('点评框含站长原话（大唐 · 法务部技能）与悬赏事实',
    !!legalBox
    && legalBox.textContent.indexOf('法务部悬赏') !== -1
    && legalBox.textContent.indexOf('你大唐刚出事') !== -1
    && legalBox.textContent.indexOf('50 万元至 500 万元') !== -1);
  check('点评框链接是站内 ./brand/byd.html（外链在详情页证据链）',
    !!legalBox.querySelector('a[href="./brand/byd.html"]'));
  check('点评框内同样零外链',
    !!legalBox && !/https?:\/\//.test(legalBox.innerHTML));
  check('别的品牌卡不受影响', !otherCard.querySelector('[data-byd-expose]'));

  // 幂等：再触发一次 DOM 变动，仍只有两只曝光框（红色登记 + 琥珀点评）
  bydCard.appendChild(doc.createElement('span'));
  await tick(120);
  check('重复触发不会重复插框（幂等，2026-11-13 起两只框）',
    bydCard.querySelectorAll('[data-byd-expose]').length === 2);

  // React 重渲染模拟：整段内容区被替换，MutationObserver 必须补挂
  const inner = bydCard.querySelector('div.p-5.space-y-3\\.5');
  inner.innerHTML = '<div class="flex items-start justify-between gap-3"><div><h2>BYD (比亚迪)</h2></div></div>' +
    '<div class="bg-slate-50 rounded-xl p-2.5">工时政策</div>';
  await tick(150);
  check('卡片被重渲染后两只框都自动补挂',
    bydCard.querySelectorAll('[data-byd-expose]').length === 2);
  check('重渲染后补挂的框仍在标题之后',
    bydCard.querySelector('div.p-5.space-y-3\\.5').children[1].getAttribute('data-byd-expose') === '1');
  check('运行期无 JS 异常', errors.length === 0, errors.slice(0, 3));

  console.log('\n' + '='.repeat(52));
  console.log(`通过 ${pass} 项，失败 ${fail} 项`);
  if (fail) console.log('失败项：\n  - ' + fails.join('\n  - '));
  if (errors.length) console.log('运行期告警（不阻断）：\n  - ' + errors.slice(0, 5).join('\n  - '));
  process.exit(fail ? 1 : 0);
})();
