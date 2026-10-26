/* ==========================================================================
   test-appeal-policy.cjs —— 申诉政策确认弹窗行为测试
   --------------------------------------------------------------------------
   被测对象：appeal-policy.js（浏览器 IIFE，挂 window.__SXGAppealPolicy）

   覆盖路径：
     ① isAppealLink 判定：issues 链接命中、普通链接/按钮不命中
     ② 点击申诉链接 → 弹层出现（hidden=false），不直接跳转
     ③ 同意并跳转 → window.open 原链接、弹层关闭
     ④ 拒绝并关闭 → 弹层关闭、不跳转
     ⑤ ESC / 点遮罩 = 拒绝
     ⑥ 幂等：重复绑定不重复弹层；modal 复用同一节点
     ⑦ 政策文案关键句逐字在弹层里
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const PATCH_SRC = fs.readFileSync(path.join(ROOT, 'appeal-policy.js'), 'utf8');

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name + (detail !== undefined ? ' → ' + JSON.stringify(detail) : '')); }
}

const ISSUE_URL = 'https://github.com/dujeongil-galaxy/shuangxiugou/issues';

function mkDom() {
  const html = '<!DOCTYPE html><html><head></head><body><div id="root">'
    + '<a id="link-appeal" target="_blank" href="' + ISSUE_URL + '">提交数据 / 申诉</a>'
    + '<a id="link-other" target="_blank" href="https://github.com/dujeongil-galaxy/shuangxiugou/blob/main/README.md">README</a>'
    + '<a id="link-external" target="_blank" href="https://example.com/">外站</a>'
    + '</div></body></html>';
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://dujeongil-galaxy.github.io/shuangxiugou/' });
  const w = dom.window;
  // 拦截 window.open 记录调用
  w.__opens = [];
  w.open = function (url, target, feat) { w.__opens.push({ url, target }); return null; };
  w.eval(PATCH_SRC);
  return w;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function until(condFn, timeoutMs) {
  const start = Date.now();
  return new Promise((resolve) => {
    (function poll() {
      let ok = false;
      try { ok = condFn(); } catch (e) { ok = false; }
      if (ok) return resolve(true);
      if (Date.now() - start >= timeoutMs) return resolve(false);
      setTimeout(poll, 5);
    })();
  });
}

(async function () {
  const w = mkDom();
  const doc = w.document;

  /* ① 判定 */
  console.log('\n① isAppealLink 判定');
  check('issues 链接命中', w.__SXGAppealPolicy.isAppealLink(doc.getElementById('link-appeal')) === true);
  check('同仓库非 issues 链接不命中', w.__SXGAppealPolicy.isAppealLink(doc.getElementById('link-other')) === false);
  check('外站链接不命中', w.__SXGAppealPolicy.isAppealLink(doc.getElementById('link-external')) === false);
  check('非 A 节点不命中', w.__SXGAppealPolicy.isAppealLink(doc.getElementById('root')) === false);

  /* ② 点击 → 弹层 */
  console.log('\n② 点击申诉链接 → 弹政策层，不直接跳转');
  const bound = await until(() => doc.getElementById('link-appeal').dataset.sxgAppealBound === '1', 2500);
  check('申诉链接被绑定（dataset 标记）', bound);
  w.__opens.length = 0;
  doc.getElementById('link-appeal').dispatchEvent(new w.Event('click', { bubbles: true, cancelable: true }));
  const modal = doc.getElementById('sxg-appeal-policy');
  check('弹层节点存在', !!modal);
  check('弹层显示（hidden=false）', modal && modal.hidden === false);
  check('点击后未直接跳转（open 零调用）', w.__opens.length === 0);
  check('弹层记录了目标 URL', modal && modal.dataset.targetUrl === ISSUE_URL, modal && modal.dataset.targetUrl);

  /* ⑦ 政策文案 */
  console.log('\n⑦ 政策文案关键句逐字在弹层');
  const txt = modal ? (modal.textContent || '') : '';
  check('AI 依据仓库规则自动计算句', txt.indexOf('本项目评级由AI依据GitHub仓库公示的判定规则自动计算得出') !== -1);
  check('受理范围句', txt.indexOf('申诉仅受理证据过时、信息不实、个案误判、规则发生变更类复核申请') !== -1);
  check('不予受理句', txt.indexOf('仅对评级结果不满意、无有效佐证材料的申诉不予受理') !== -1);
  check('人工核验句', txt.indexOf('请提交客观佐证材料，我们将人工核验材料后重新运行评级流程') !== -1);
  check('脱敏句', txt.indexOf('所有申诉线索严格脱敏保护，不会泄露提交者隐私') !== -1);
  check('按钮「同意并跳转」', txt.indexOf('同意并跳转') !== -1);
  check('按钮「拒绝并关闭」', txt.indexOf('拒绝并关闭') !== -1);

  /* ③ 同意 → 跳转 */
  console.log('\n③ 同意并跳转');
  doc.getElementById('sxg-appeal-policy-agree').dispatchEvent(new w.Event('click', { bubbles: true }));
  check('同意后 window.open 了目标 URL', w.__opens.length === 1 && w.__opens[0].url === ISSUE_URL,
    w.__opens);
  check('同意后弹层关闭', modal.hidden === true);
  check('同意后 open 用 _blank', w.__opens.length === 1 && w.__opens[0].target === '_blank');

  /* ④ 拒绝 → 不跳转 */
  console.log('\n④ 拒绝并关闭');
  doc.getElementById('link-appeal').dispatchEvent(new w.Event('click', { bubbles: true, cancelable: true }));
  await wait(50);
  check('再次点击重新弹出', modal.hidden === false);
  w.__opens.length = 0;
  doc.getElementById('sxg-appeal-policy-deny').dispatchEvent(new w.Event('click', { bubbles: true }));
  check('拒绝后弹层关闭', modal.hidden === true);
  check('拒绝后未跳转', w.__opens.length === 0);

  /* ⑤ ESC / 遮罩 */
  console.log('\n⑤ ESC 与点遮罩都算拒绝');
  doc.getElementById('link-appeal').dispatchEvent(new w.Event('click', { bubbles: true, cancelable: true }));
  await wait(50);
  check('ESC 前弹层开着', modal.hidden === false);
  doc.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  check('ESC 关闭弹层', modal.hidden === true);
  doc.getElementById('link-appeal').dispatchEvent(new w.Event('click', { bubbles: true, cancelable: true }));
  await wait(50);
  modal.dispatchEvent(new w.Event('click', { bubbles: true }));
  check('点遮罩关闭弹层', modal.hidden === true);

  /* ⑥ 幂等 */
  console.log('\n⑥ 幂等与复用');
  const before = doc.querySelectorAll('#sxg-appeal-policy').length;
  w.__SXGAppealPolicy.buildModal();
  const after = doc.querySelectorAll('#sxg-appeal-policy').length;
  check('弹层节点复用（不重复创建）', before === 1 && after === 1);
  const attrBefore = doc.getElementById('link-appeal').dataset.sxgAppealBound;
  w.__SXGAppealPolicy.openModal(ISSUE_URL);
  w.__SXGAppealPolicy.closeModal();
  check('重复 open/close 不破坏绑定标记', doc.getElementById('link-appeal').dataset.sxgAppealBound === attrBefore);
  // 非申诉链接点击不弹层
  w.__opens.length = 0;
  doc.getElementById('link-other').dispatchEvent(new w.Event('click', { bubbles: true, cancelable: true }));
  check('非申诉链接点击不触发弹层（README 链接）', modal.hidden === true && w.__opens.length === 0);

  setTimeout(function () {
    console.log('\n========== 结果：' + passed + ' 项通过，' + failed + ' 项失败 ==========');
    process.exit(failed ? 1 : 0);
  }, 800);
})();
