// 2026-11-27 站长批次回归：有独立专题页的品牌，卡片底部最左侧多一枚「专题报道」按钮。
// 真 DOM 验证（jsdom 加载 topic-page-button.js），不是只比对配置字符串——
// 这个站的默认静默失效方式就是「源码写了、渲染出来的卡片上啥也没有」。
//
// ⚠️ 本机专用（不挂 CI）：本机 PAT 没有 workflow scope，改不了 .github/workflows/，
//    没法给 CI 加这一步；与 scripts/test-ai-cf-stream.cjs 同因（见 verify §21o 标记纪律）。
//    待换用带 workflow scope 的 token 后，补挂进 .github/workflows/verify.yml。
// 跑法：npm install --no-save jsdom && node scripts/test-topic-page-button.cjs
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

// 与线上 bundle 渲染出来的品牌卡同构（见 CDP dump）：
// 根 .bg-white.rounded-2xl.border > .p-5.space-y-3.5（标题/工时政策/标签）
//   > 底栏 .px-5 py-3 … > 左侧组（我支持/我抵制） + 右侧组（员工投票/打卡/详情证据）
const CARD = (title, id) => `<div class="bg-white rounded-2xl border" id="${id}">
  <div class="p-5 space-y-3.5">
    <div class="flex items-start justify-between gap-3"><h3>${title}</h3></div>
  </div>
  <div class="px-5 py-3 bg-slate-50/70 border-t border-slate-100 flex items-center justify-between text-xs">
    <div class="flex items-center gap-2">
      <button class="up">支持</button><button class="down">抵制</button>
    </div>
    <div class="flex items-center gap-2">
      <button>员工投票</button><button>打卡</button><button>详情证据</button>
    </div>
  </div>
</div>`;

const PAGE = `<!doctype html><html><head></head><body>
<div id="root">
  ${CARD('BYD (比亚迪)', 'card-byd')}
  ${CARD('华为终端 (Huawei)', 'card-huawei')}
  ${CARD('Starbucks (星巴克中国)', 'card-starbucks')}
  ${CARD('Patagonia (巴塔哥尼亚)', 'card-patagonia')}
</div>
<section id="evidence-board">
  <h2>证据链公示区</h2>
  <div class="ev-list">
    <details id="ev-byd" data-b="byd" data-topic="./byd-report.html"><summary><span class="bn">BYD (比亚迪)</span></summary><div class="ev-body">5 条证据</div></details>
    <details id="ev-huawei" data-b="huawei" data-topic="./zunjie-report.html"><summary><span class="bn">华为终端</span></summary><div class="ev-body">1 条证据</div></details>
    <details id="ev-starbucks" data-b="starbucks" data-topic="./chaocha-report.html"><summary><span class="bn">Starbucks (星巴克中国)</span></summary><div class="ev-body">1 条证据</div></details>
    <details id="ev-patagonia" data-b="patagonia"><summary><span class="bn">Patagonia (巴塔哥尼亚)</span></summary><div class="ev-body">1 条证据</div></details>
  </div>
</section>
</body></html>`;

function makeDom() {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => {
    if (/Could not load|not implemented/i.test(e.message)) return;
    errors.push(e.message);
  });
  const dom = new JSDOM(PAGE, {
    url: 'http://localhost/index.html',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole: vc
  });
  const w = dom.window;
  const d = w.document;
  w.eval(read('topic-page-button.js'));
  d.dispatchEvent(new w.Event('DOMContentLoaded'));
  return { dom, w, d, errors };
}

const footOf = (d, id) => d.querySelector('#' + id + ' div[class*="px-5 py-3"]');
const btnOf = (d, id) => d.querySelector('#' + id + ' a[data-sxg-topic-btn]');

(async () => {
  console.log('=== 有专题页的品牌卡：底部最左侧「专题报道」按钮 ===\n');

  // ─────────── 0. 静态接线（三层强制的第三层） ───────────
  console.log('--- 0. 文件与接线 ---');
  const src = read('topic-page-button.js');
  const html = read('index.html');
  const gen = read('scripts/gen-evidence-board.py');
  const wf = read('.github/workflows/verify.yml');

  check('补丁脚本存在', exists('topic-page-button.js'));
  check('首页挂了补丁（?v=1 防缓存）',
    /<script defer src="\.\/topic-page-button\.js\?v=1"><\/script>/.test(html));
  check('真 DOM 测试挂进 CI', /test-topic-page-button\.cjs/.test(wf));

  // 真相源：brand/*.html 的标记 → 生成器搬运 → 公示区 data-topic
  const marks = [
    ['brand/byd.html', '../byd-report.html'],
    ['brand/huawei.html', '../zunjie-report.html'],
    ['brand/starbucks.html', '../chaocha-report.html'],
  ];
  for (const [f, href] of marks) {
    const t = read(f);
    check(`${f} 带 sxg-topic-page 标记（${href}）`,
      new RegExp('name="sxg-topic-page"\\s+content="' + href.replace(/[/.]/g, '\\$&') + '"').test(t));
  }
  check('生成器读标记并写进公示区 data-topic',
    /sxg-topic-page/.test(gen) && /data-topic=/.test(gen));
  for (const slug of ['byd', 'huawei', 'starbucks']) {
    const m = (html.match(new RegExp('<details id="ev-' + slug + '"[^>]*data-topic="([^"]+)"')) || []);
    check(`公示区 ev-${slug} 带 data-topic`, m.length === 2 && m[1].length > 0, m[1]);
  }

  // 补丁源码口径：不许出现品牌清单（注释里的说明不算，看代码）
  const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  check('补丁不硬编码品牌名或专题页文件名（运行时读 DOM）',
    !/byd-report|zunjie-report|chaocha-report|ev-byd|ev-huawei|ev-starbucks|比亚迪|华为|星巴克/.test(codeOnly));
  check('按钮文案「专题报道」', /var BTN_TEXT = '专题报道'/.test(src));
  check('幂等标记 + MutationObserver + rAF 合帧',
    /data-sxg-topic-btn/.test(src) && /new MutationObserver\(schedule\)/.test(src)
    && /requestAnimationFrame/.test(src));

  // ─────────── 1. 真 DOM：按钮真的挂在卡片底部最左侧 ───────────
  console.log('\n--- 1. 真 DOM 渲染 ---');
  const { dom, w, d, errors } = makeDom();
  await tick(150);

  const all = [...d.querySelectorAll('a[data-sxg-topic-btn]')];
  check('三张有专题页的卡片各一枚按钮，共 3 枚', all.length === 3, all.length);
  check('没有专题页的 Patagonia 卡不出现按钮', !btnOf(d, 'card-patagonia'));

  for (const [id, href] of [
    ['card-byd', './byd-report.html'],
    ['card-huawei', './zunjie-report.html'],
    ['card-starbucks', './chaocha-report.html'],
  ]) {
    const b = btnOf(d, id);
    check(`${id}：按钮在卡片底部、左侧组最前面（最左侧）`,
      !!b && b.parentElement === footOf(d, id).firstElementChild
      && b.parentElement.firstElementChild === b);
    check(`${id}：href 取自公示区 data-topic（${href}）`,
      !!b && b.getAttribute('href') === href);
    check(`${id}：文案「专题报道」+ 新窗口 + rel=noopener`,
      !!b && b.textContent.trim() === '专题报道'
      && b.getAttribute('target') === '_blank' && /noopener/.test(b.getAttribute('rel') || ''));
  }

  // 右侧组（员工投票 / 打卡 / 详情证据）不受影响
  const rightByd = footOf(d, 'card-byd').lastElementChild;
  check('底栏右侧组原样保留（员工投票 / 打卡 / 详情证据）',
    rightByd && rightByd.querySelectorAll('button').length === 3);

  // ─────────── 2. 幂等与自愈 ───────────
  console.log('\n--- 2. 幂等与自愈 ---');
  d.body.appendChild(d.createElement('span'));
  await tick(150);
  check('重复触发 DOM 变动不会重复插按钮（幂等）',
    d.querySelectorAll('a[data-sxg-topic-btn]').length === 3);

  // 模拟 React 复用节点：按钮被挪到别的卡 / 位置不对 → 下一轮自愈
  const wrong = btnOf(d, 'card-byd');
  if (wrong) {
    footOf(d, 'card-patagonia').firstElementChild.insertBefore(wrong,
      footOf(d, 'card-patagonia').firstElementChild.firstChild);
  }
  await tick(200);
  check('跑到别的卡上的按钮被摘掉（不会挂错品牌）',
    !d.querySelector('#card-patagonia a[data-sxg-topic-btn]'));
  check('原卡的按钮重新挂回正确位置',
    !!btnOf(d, 'card-byd')
    && btnOf(d, 'card-byd').parentElement === footOf(d, 'card-byd').firstElementChild
    && btnOf(d, 'card-byd').parentElement.firstElementChild === btnOf(d, 'card-byd'));

  // href 被改坏 → 自愈纠正（观察器只盯 childList，改完属性要再触发一次 DOM 变动）
  const b2 = btnOf(d, 'card-starbucks');
  if (b2) b2.setAttribute('href', './wrong.html');
  d.body.appendChild(d.createElement('span'));
  await tick(200);
  check('href 被改坏后自动纠正回公示区里的地址',
    !!btnOf(d, 'card-starbucks')
    && btnOf(d, 'card-starbucks').getAttribute('href') === './chaocha-report.html');

  // ─────────── 3. 其它 ───────────
  console.log('\n--- 3. 其它 ---');
  const J = w.__sxgTopicBtn;
  check('测试钩子已暴露', !!J && typeof J.scan === 'function');
  check('解析：卡面「华为终端 (Huawei)」能对上公示名「华为终端」',
    J.topicOf('华为终端 (Huawei)') === './zunjie-report.html');
  check('解析：没有专题页的品牌返回空串',
    J.topicOf('Patagonia (巴塔哥尼亚)') === '');
  check('运行期无 JS 异常', errors.length === 0, errors.slice(0, 3));

  console.log('\n' + '='.repeat(54));
  console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  if (fail) console.log('失败项：\n  - ' + fails.join('\n  - '));
  process.exit(fail ? 1 : 0);
})();
