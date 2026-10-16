// 员工投稿转 GitHub Issue：行为测试
//
// 为什么需要这个测试：
//   压缩包里原来的 onSubmit 只做 React 本地 state 更新，
//   400ms 后关窗，看起来像「入库成功」，实际数据刷新即丢。
//   改成跳 GitHub 之后，必须保证：链接指向真仓库、六个字段都带、
//   且**不**伪造「已入库」的说法 —— 这是最容易回退的地方。
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

let pass = 0, fail = 0;
const fails = [];
const check = (label, cond, extra) => {
  if (cond) { pass++; console.log('  ✓', label); }
  else { fail++; fails.push(label); console.log('  ✗', label, extra !== undefined ? JSON.stringify(extra) : ''); }
};

console.log('=== 员工投稿转 GitHub Issue ===\n');

const indexHtml = read('index.html');

// ---------- 1. 引入与顺序 ----------
console.log('--- 引入 ---');
check('index.html 引入了 employee-report-to-issue.js',
  /<script src="\.\/employee-report-to-issue\.js\?v=\d+"/.test(indexHtml));
check('带了 ?v= 缓存版本号', /employee-report-to-issue\.js\?v=\d+/.test(indexHtml));

// ---------- 2. 原来的假入库必须已被替换 ----------
console.log('\n--- 不再有「假入库」路径 ---');
const bundle = read('assets/index-YthXZ9eP.js');
const src = read('employee-report-to-issue.js');
check('压缩包本身没有 sendBeacon（原本也没有）', !/sendBeacon/.test(bundle));
// 注入层必须在捕获阶段 preventDefault，阻止原来的本地 setTimeout 生效。
// 匹配放宽到跨行：addEventListener('submit', … , true) 的第三个参数才是捕获标志。
check('注入层用捕获阶段拦截 submit',
  /addEventListener\('submit'[\s\S]{0,400}?\},\s*true\s*\)/.test(src));
check('注入层调用了 preventDefault', /ev\.preventDefault\(\)/.test(src));
check('注入层调用了 stopPropagation（挡在 React 之前）', /ev\.stopPropagation\(\)/.test(src));

// ---------- 4. 不许出现「已入库」这类假承诺 ----------
console.log('\n--- 文案不许误导 ---');
// ⚠️ 必须先剥掉注释再断言：源文件里保留了「入库公证中」这个词的**历史说明**
// （记录原来那个假承诺长什么样），那是必要的注释，不是误导文案。
// 同一条纪律见 PITFALLS「判断属性前先剥掉注释」。
const codeOnly = src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => l.replace(/(^|\s)\/\/.*$/, '')).join('\n');
check('代码体里没有「入库公证中」字样（那是原文案的假承诺）',
  !/入库公证中/.test(codeOnly));
check('代码体里没有「感谢提交…已被记录」类假承诺',
  !/已被记录|提交成功/.test(codeOnly));
check('按钮文案如实说明会跳 GitHub',
  /将跳转 GitHub 记录/.test(codeOnly));

// ---------- 4. issue URL 生成 ----------
console.log('\n--- issue URL 内容 ---');
const dom = new JSDOM(indexHtml, {
  runScripts: 'dangerously', url: 'http://localhost/', pretendToBeVisual: true,
});
const { window } = dom;
// jsdom 缺 matchMedia，bundle 启动即抛
window.matchMedia = (q) => ({
  matches: false, media: q, onchange: null,
  addListener() {}, removeListener() {},
  addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; },
});
if (!window.requestAnimationFrame) {
  window.requestAnimationFrame = (cb) => window.setTimeout(() => cb(Date.now()), 16);
  window.cancelAnimationFrame = (h) => window.clearTimeout(h);
}
for (const m of indexHtml.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)) {
  const clean = m[1].split('?')[0];
  const file = path.join(ROOT, clean);
  if (!fs.existsSync(file)) continue;
  try { window.eval(read(clean)); } catch (e) { /* 脚手架限制，忽略 */ }
}

setTimeout(() => {
  const hook = window.__sxgReportHook;
  check('注入层已加载并暴露 __sxgReportHook', !!hook && typeof hook.buildIssueUrl === 'function');
  if (!hook) { done(); return; }

  const url = hook.buildIssueUrl(
    '喜茶 (HEYTEA)', '研发技术', '100% 双休指数',
    '18:30 之前（神仙企业）', '✓ 依法足额发放', '老板挺开明，基本到点走'
  );
  const dec = decodeURIComponent(url);

  check('指向本站仓库的 issues/new',
    url.startsWith('https://github.com/dujeongil-galaxy/shuangxiugou/issues/new'), url.slice(0, 80));
  check('title 参数含 [员工工时投稿] 前缀',
    dec.includes('[员工工时投稿]'));
  check('带 labels=员工投稿', dec.includes('labels=员工投稿'));

  const fields = [
    ['企业名', '喜茶 (HEYTEA)'],
    ['部门岗位', '研发技术'],
    ['周末双休指数', '100% 双休指数'],
    ['平均下班时间', '18:30'],
    ['法定加班报酬', '依法足额发放'],
    ['真心话', '老板挺开明'],
  ];
  for (const [name, needle] of fields) {
    check(`URL 里带「${name}」`, dec.includes(needle));
  }

  check('明确声明「只作核查线索，不直接计入统计」',
    dec.includes('只作核查线索'));
  check('提醒读者补充可查证来源',
    dec.includes('可查证来源') || dec.includes('招聘平台'));
  check('说明查不到就保持未核实（不许编数字）',
    dec.includes('不会') && dec.includes('未核实'));
  check('标注了数据为自动生成',
    dec.includes('自动生成'));

  // ---------- 5. 幂等与安全 ----------
  console.log('\n--- 幂等 ---');
  check('重复 sweep 不会重复绑事件（有标记）',
    /MARK|setAttribute\(MARK/.test(src));
  const url2 = hook.buildIssueUrl('测试', '产线工人', '15% 双休指数', '22:00', '✕ 克扣/强制自愿', '');
  const dec2 = decodeURIComponent(url2);
  check('空真心话时不报错，正文写「（未填写）」', dec2.includes('未填写'));
  check('克扣情形也能如实带出', dec2.includes('克扣'));

  // XSS：字段来自用户输入，拼进 URL 前必须经过 encodeURIComponent
  check('URL 拼接用了 encodeURIComponent',
    /encodeURIComponent/.test(src));
  const xss = hook.buildIssueUrl('测试', '"><script>alert(1)</script>', '100%', '18:00', '✓', '');
  check('恶意输入被 URL 编码，不会裸奔',
    !/title=[^&]*<script>/.test(xss), xss.slice(0, 100));

  done();
}, 1200);

function done() {
  console.log('\n' + '='.repeat(52));
  console.log(`通过 ${pass} 项，失败 ${fail} 项`);
  if (fail) console.log('失败项：\n  - ' + fails.join('\n  - '));
  process.exit(fail ? 1 : 0);
}