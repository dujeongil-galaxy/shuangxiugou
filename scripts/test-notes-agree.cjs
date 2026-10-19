// notes.html 锁屏「我同意 / 我不同意」勾选门禁的行为测试
// 跑法：node scripts/test-notes-agree.cjs（需要 jsdom，与其它 test-*.cjs 一致）
//
// 测的是真实上线的 notes.html：
//   1. 锁屏有两个勾选项，初始都不选（aria-checked=false）
//   2. 填了密码但没勾选 → 点「打开」被拦下，提示「请先勾选」
//   3. 勾了「我不同意」→ 点「打开」被拦下，提示无法访问
//   4. 勾了「我同意」→ 门禁放行（走到解密环节；jsdom 无 WebCrypto，
//      必然落到「密码不对。」，这恰好证明请求穿透了门禁）
//   5. 二选一互斥：从「不同意」切到「同意」时前者自动取消；再点一次可取消
//   6. 红色公告在锁屏上（含「不对没有证据链支撑」）
//   7. 故障注入自检：把门禁条件挖掉（if (agreeState !== 'yes') → if (false)）
//      后，同样的操作不再出现「请先勾选」—— 证明上面的断言真的在测门禁，
//      而不是永远为真的空断言
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'notes.html'), 'utf8');

let pass = 0, fail = 0;
const failures = [];
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else {
    fail++; failures.push(label);
    console.log('  ✗', label, extra !== undefined ? JSON.stringify(extra) : '');
  }
}

// jsdom 不带 WebCrypto；页面脚本顶层不用它，只有解密时才用，
// 所以锁屏交互可以直接跑。外链 top-button.js 默认不加载，也不参与门禁。
function makeDom(html) {
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'file://' + ROOT + '/notes.html' });
  return dom;
}

// 提交锁屏表单。门禁校验是同步的；解密失败写在 await 之后的 catch 里，
// 所以这里等一小段时间再读 err，两种情况都能拿到。
async function submit(dom) {
  const w = dom.window;
  w.document.getElementById('f').dispatchEvent(
    new w.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 80));
  return w.document.getElementById('err').textContent;
}

function clickAgree(dom, id) {
  dom.window.document.getElementById(id).click();
}

;(async () => {
console.log('=== 1. 锁屏勾选项存在且初始都不选 ===');
await (async () => {
  const dom = makeDom(HTML);
  const d = dom.window.document;
  const yes = d.getElementById('agreeYes');
  const no = d.getElementById('agreeNo');
  check('「我同意」按钮存在', !!yes);
  check('「我不同意」按钮存在', !!no);
  check('按钮文案正确', yes.textContent.includes('我同意') && no.textContent.includes('我不同意'));
  check('初始 aria-checked 均为 false',
    yes.getAttribute('aria-checked') === 'false' && no.getAttribute('aria-checked') === 'false');
  check('红色公告在锁屏上且含「不对没有证据链支撑」',
    d.querySelector('.lock__agree-hint') !== null &&
    d.querySelector('.lock__agree-hint').textContent.includes('不对没有证据链支撑'));
  dom.window.close();
})();

console.log('=== 2. 没勾选 → 点「打开」被拦下 ===');
await (async () => {
  const dom = makeDom(HTML);
  const d = dom.window.document;
  d.getElementById('pw').value = 'wrong-password-anyway';
  const msg = await submit(dom);
  check('提示「请先勾选」', msg.includes('请先勾选'), msg);
  check('未进入解密环节（不是「密码不对。」）', !msg.includes('密码不对'), msg);
  dom.window.close();
})();

console.log('=== 3. 勾「我不同意」→ 被拦下 ===');
await (async () => {
  const dom = makeDom(HTML);
  const d = dom.window.document;
  d.getElementById('pw').value = 'wrong-password-anyway';
  clickAgree(dom, 'agreeNo');
  check('「我不同意」呈选中态', d.getElementById('agreeNo').getAttribute('aria-checked') === 'true');
  const msg = await submit(dom);
  check('提示「我不同意」无法访问', msg.includes('我不同意'), msg);
  check('未进入解密环节', !msg.includes('密码不对'), msg);
  dom.window.close();
})();

console.log('=== 4. 勾「我同意」→ 门禁放行 ===');
await (async () => {
  const dom = makeDom(HTML);
  const d = dom.window.document;
  d.getElementById('pw').value = 'wrong-password-anyway';
  clickAgree(dom, 'agreeYes');
  check('「我同意」呈选中态', d.getElementById('agreeYes').getAttribute('aria-checked') === 'true');
  const msg = await submit(dom);
  // jsdom 没有 WebCrypto，解密必然抛错 →「密码不对。」。
  // 能看到这句话 = 请求已穿过门禁，走到解密环节。
  check('门禁放行（到达解密环节）', msg.includes('密码不对'), msg);
  dom.window.close();
})();

console.log('=== 5. 二选一互斥 + 再点一次取消 ===');
await (async () => {
  const dom = makeDom(HTML);
  const d = dom.window.document;
  clickAgree(dom, 'agreeNo');
  clickAgree(dom, 'agreeYes');
  check('切到「同意」后「不同意」自动取消',
    d.getElementById('agreeNo').getAttribute('aria-checked') === 'false' &&
    d.getElementById('agreeYes').getAttribute('aria-checked') === 'true');
  clickAgree(dom, 'agreeYes');
  check('再点一次「同意」→ 取消勾选',
    d.getElementById('agreeYes').getAttribute('aria-checked') === 'false');
  dom.window.close();
})();

console.log('=== 6. 故障注入自检：挖掉门禁后断言必须变红 ===');
await (async () => {
  const NEEDLE = "if (agreeState !== 'yes') {";
  check('门禁代码在页面里（needle 可定位）', HTML.includes(NEEDLE));
  const mutated = HTML.replace(NEEDLE, "if (false) { // 故障注入：门禁被挖掉");
  check('注入成功（源码确实被改）', mutated !== HTML && mutated.includes('if (false) { // 故障注入'));
  const dom = makeDom(mutated);
  const d = dom.window.document;
  d.getElementById('pw').value = 'wrong-password-anyway';
  const msg = await submit(dom);
  check('门禁被挖掉后不再出现「请先勾选」（证明断言有效）',
    !msg.includes('请先勾选'), msg);
  dom.window.close();
})();

console.log('============================================================');
if (fail === 0) {
  console.log(`通过 ${pass} 项，全部通过`);
  process.exit(0);
} else {
  console.log(`通过 ${pass} 项，失败 ${fail} 项：`);
  failures.forEach((f) => console.log('  -', f));
  process.exit(1);
}
})();
