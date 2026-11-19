// 2026-11-20 踏板支架争议专题页回归：真 DOM 验证华为卡登记框 + 专题页存档链。
// 静态字符串比对不够——本站默认静默失效方式是「补丁写了、渲染出来啥也没有」。
// 跑法：node scripts/test-zunjie-report.cjs（依赖 jsdom，仓库已装）
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
  console.log('=== 踏板支架争议专题页：华为卡登记框 + 存档链 ===\n');

  console.log('--- 0. 文件与接线 ---');
  const src = read('news-incident-patch.js');
  const report = read('zunjie-report.html');
  const idx = read('index.html');
  const sm = read('sitemap.xml');
  const wf = read('.github/workflows/verify.yml');

  check('专题页文件存在且非空', exists('zunjie-report.html') && report.length > 3000);
  check('新闻登记补丁已 bump 到 ?v=7',
    /<script defer src="\.\/news-incident-patch\.js\?v=7"><\/script>/.test(idx));
  check('补丁含华为卡条目且指向站内专题页',
    /key: 'huawei-zunjie'/.test(src)
    && /title: \/\^华为终端\//.test(src)
    && /href: '\.\/zunjie-report\.html'/.test(src));
  check('条目声明与工时评级无关、不改 C 级', /不据此调整 C 级评级/.test(src));
  check('真 DOM 测试挂进 CI', /test-zunjie-report\.cjs/.test(wf));
  check('专题页进 sitemap', sm.includes('/zunjie-report.html</loc>'));

  console.log('\n--- 1. 专题页内容口径（jsdom 真 DOM）---');
  const vc = new VirtualConsole();
  const errors = [];
  vc.on('jsdomError', (e) => errors.push(e.message));
  const doc = new JSDOM(report, { runScripts: 'dangerously', virtualConsole: vc, url: 'https://dujeongil-galaxy.github.io/shuangxiugou/zunjie-report.html' }).window.document;

  const text = doc.body.textContent;
  const h1 = doc.querySelector('h1');
  check('标题按站长指令用《狗日的华为做过的恶》且带引用标识与立场说明',
    !!h1 && /狗日的华为做过的恶/.test(h1.textContent)
    && !!h1.querySelector('.quoted')
    && /并非本站的定性|外界批评文章的说法/.test(doc.body.textContent));
  check('外界批评观点四小节汇编在案',
    /外界批评观点汇编/.test(text) && /企业文化与员工管理争议/.test(text)
    && /市场竞争与商业策略/.test(text) && /外界争议与舆论/.test(text)
    && /争议的主要落点/.test(text));
  check('两个来源页链接可点且 nofollow',
    [...doc.querySelectorAll('a[href^="https://evil-huawei.github.io/evil-huawei/"],a[href^="https://zh.wikipedia.org/wiki/"]')].length >= 2
    && [...doc.querySelectorAll('a[href^="https://evil-huawei.github.io/"],a[href^="https://zh.wikipedia.org/wiki/"]')]
         .every((a) => /nofollow/.test(a.getAttribute('rel') || '')));
  check('原文逐字存档（含车型原表述与提问）',
    /尊界V800/.test(text) && /被一脚踩断刹车踏板支架/.test(text)
    && /到底是车子的问题还是测评员的问题/.test(text));
  const dyLink = doc.querySelector('#douyin-link');
  check('抖音短链为可点外链且 nofollow',
    !!dyLink && dyLink.getAttribute('href') === 'https://v.douyin.com/Vc4SsZp8e1U/'
    && /nofollow/.test(dyLink.getAttribute('rel')));
  check('三件套免责声明齐全',
    /未经独立核实/.test(text) && /不作事实认定|不构成事实认定/.test(text)
    && /不代表本站立场/.test(text));
  check('车型名待核实提示在案', /S800/.test(text) && /待核实/.test(text));
  check('页脚含 WorkBuddy 署名', /WorkBuddy/.test(text) && /协助完成/.test(text));
  const copyBtn = doc.querySelector('#copy-btn');
  check('复制口令按钮存在', !!copyBtn);

  console.log('\n--- 2. 真 DOM 跑补丁：华为卡插框、别的卡不串 ---');
  const errors2 = [];
  const vc2 = new VirtualConsole();
  vc2.on('jsdomError', (e) => errors2.push(e.message));
  const dom2 = new JSDOM(`<!doctype html><html><body>
    <div id="huawei-card" class="bg-white rounded-2xl border">
      <div class="p-5 space-y-3.5">
        <h3>华为终端 (Huawei)</h3>
        <div>占位</div>
        <div>后面</div>
      </div>
    </div>
    <div id="other-card" class="bg-white rounded-2xl border">
      <div class="p-5 space-y-3.5"><h3>别的品牌</h3><div>占位</div></div>
    </div>
  </body></html>`, { runScripts: 'outside-only', virtualConsole: vc2 });
  dom2.window.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  dom2.window.eval(src);
  await tick(60);
  const d2 = dom2.window.document;
  check('华为卡恰好插入一个登记框',
    d2.querySelectorAll('#huawei-card [data-sxg-news="huawei-zunjie"]').length === 1);
  check('别的卡零串框',
    d2.querySelectorAll('#other-card [data-sxg-news="huawei-zunjie"]').length === 0);
  const box = d2.querySelector('#huawei-card [data-sxg-news="huawei-zunjie"]');
  if (box) {
    const link = box.querySelector('a[href="./zunjie-report.html"]');
    check('登记框内链指向专题页', !!link);
    check('卡面无外链（白名单不放宽）', box.querySelectorAll('a[href^="http"]').length === 0);
    check('登记框文案无粗口', !/狗日的|做过的恶/.test(box.textContent));
  }
  check('运行期无 JS 异常', errors2.length === 0, errors2.slice(0, 3));

  console.log('\n' + '='.repeat(56));
  console.log(`通过 ${pass} 项 / 失败 ${fail} 项`);
  if (fail) {
    console.log('失败项：' + fails.join(' / '));
    process.exit(1);
  }
  console.log('全部通过');
})().catch((e) => { console.error(e); process.exit(1); });
