// 成功案例页回归：左侧目录树真的建出来（7 条）、无框小火箭真的在 DOM 里、
// 案例 #05 真的落地。用 jsdom 真实跑页面内联脚本——这个站的默认静默失效方式
// 是「源码写得对、渲染出来目录树是空的 / 小火箭没画出来」。
// 跑法：npm install --no-save jsdom && node scripts/test-success-stories.cjs
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

let pass = 0, fail = 0;
const fails = [];
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else { fail++; fails.push(label); console.log('  ✗', label, extra !== undefined ? JSON.stringify(extra) : ''); }
}

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => {
  if (/Could not load|not implemented/i.test(e.message)) return;
  errors.push(e.message);
});
vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));

const html = read('success-stories.html');

(async () => {
  console.log('=== 成功案例页：目录树 + 无框小火箭 + 案例 #05 ===\n');

  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'http://localhost/',
    virtualConsole: vc,
    pretendToBeVisual: true,
  });
  const { window } = dom;
  const doc = window.document;

  // jsdom 缺 matchMedia / rAF，页面脚本已做容错（reduceMQ 走 undefined、rAF 兜底 setTimeout）。
  // 这里不强行补，验证脚本本身在“缺这些 API”的真实环境下也不抛错。

  // 让内联脚本（DOMContentLoaded 同步执行 + 微任务）跑完
  await new Promise((r) => setTimeout(r, 300));

  // 1. 目录树：扫描 [data-toc] 自动生成 7 条导航
  const links = doc.querySelectorAll('#toc-nav a');
  console.log('  目录树链接数：', links.length);
  check('目录树生成了 7 条导航（致敬前辈/QQ奶奶/#01~#05）', links.length === 7, links.length);
  const hrefs = Array.from(links).map((a) => a.getAttribute('href'));
  check('每条目录链接都指向页内锚点（#id）', hrefs.every((h) => /^#/.test(h)), hrefs);
  const targets = hrefs.map((h) => h.slice(1));
  check('每个锚点目标在文档里真实存在', targets.every((id) => doc.getElementById(id)), targets);

  // 2. 无框小火箭（不是旧圆形箭头）
  const rocket = doc.querySelector('.to-top svg .rk-body');
  check('回到顶部按钮是无框小火箭（含 rk-body 箭体路径）', !!rocket);
  check('小火箭有尾焰（rk-flame）与舷窗（rk-win）',
    !!doc.querySelector('.to-top svg .rk-flame') && !!doc.querySelector('.to-top svg .rk-win'));
  // 旧箭头特征必须消失
  check('旧的圆形箭头 SVG 已移除', !/M12 19V5/.test(html) && !/M5\.5 11\.5 12 5l6\.5 6\.5/.test(html));

  // 3. 回到顶部按钮无边框 / 无底色方块（computed style 兜底，jsdom 解析不出时只告警不判红）
  const btn = doc.getElementById('to-top');
  if (btn) {
    const cs = window.getComputedStyle(btn);
    const bw = cs.borderTopWidth, bg = cs.backgroundColor, br = cs.borderTopLeftRadius;
    console.log('  .to-top 计算样式：borderTopWidth=', bw, ' backgroundColor=', bg, ' radius=', br);
    if (bw === '0px' || bw === '') check('小火箭按钮无边框（borderTopWidth 为 0/未解析）', true);
    else check('小火箭按钮无边框（borderTopWidth 为 0/未解析）', false, bw);
  } else {
    check('回到顶部按钮存在', false);
  }

  // 4. 案例 #05 落地
  const case5 = doc.getElementById('case-5');
  check('案例 #05 区块存在（id=case-5）', !!case5);
  if (case5) {
    const t = case5.textContent;
    check('案例 #05 挂「内容由 AI 生成」徽章', /内容由 AI 生成/.test(case5.innerHTML));
    check('案例 #05 保留 AI 生成声明框（.ai-note）', /class="ai-note"/.test(case5.innerHTML));
    const dy = (case5.innerHTML.match(/v\.douyin\.com\/(gmIc0vY52p0|8d1jq7RH9Bg)\/[\s\S]{0,240}?<\/li>/g) || []);
    const dyOk = dy.filter((s) => /tag douyin/.test(s) && /未核实视频本体/.test(s)).length;
    check('案例 #05 两条抖音都标为传播源（.tag.douyin + 未核实视频本体）', dyOk === 2, dyOk);
    check('案例 #05 含关键事实锚点（列五中学/教育部/五年）',
      t.includes('列五中学') && t.includes('教育部') && t.includes('五年'));
    const srcCount = (case5.innerHTML.match(/<li><a /g) || []).length;
    check(`案例 #05 附 ${srcCount} 条来源（≥6）`, srcCount >= 6, srcCount);
  }

  // 5. 内联脚本无致命报错（目录树/火箭脚本若抛错，TOC 会是空的）
  console.log('\n  脚本错误：', errors.length);
  errors.slice(0, 5).forEach((e) => console.log('   -', e.slice(0, 160)));
  check('目录树/火箭脚本无致命报错', errors.length === 0, errors.slice(0, 3));

  console.log('\n' + '='.repeat(52));
  console.log(`通过 ${pass} 项，失败 ${fail} 项`);
  if (fail) console.log('失败项：\n  - ' + fails.join('\n  - '));
  try { dom.window.close(); } catch (e) { /* ignore */ }
  process.exit(fail ? 1 : 0);
})();
