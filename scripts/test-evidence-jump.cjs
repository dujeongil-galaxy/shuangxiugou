// 2026-11-10 站长「大改」回归：每张卡详情弹窗都要有「跳转到证据公示」，
// 且必须**完整定位到该品牌对应的公示条目**（不是只打开公示区顶部）。
// 真 DOM 验证（jsdom 加载 evidence-jump-patch.js）：内置 React 弹窗与自定义
// .sxg-layer 弹窗各点一次，命中/无条目/幂等/重渲染/分享锚点全覆盖。
// 跑法：npm install --no-save jsdom && node scripts/test-evidence-jump.cjs
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

// 与线上真渲染 DOM 同构（CDP dump 2026-11-10）：
// 内置弹窗 .fixed.inset-0 > 白框 > h2 + div.pt-2.flex.justify-end.gap-2 > 小票按钮
// 自定义弹窗 .sxg-layer > .sxg-box > h2 + div.sxg-actions.right > 小票按钮 + 关闭
const PAGE = `<!doctype html><html><head></head><body>
<div id="root"></div>
<section id="evidence-board">
  <h2>证据链公示区</h2>
  <div class="ev-body-wrap" style="display:none">
    <div class="ev-list">
      <details id="ev-patagonia" data-b="patagonia"><summary><span class="bn">Patagonia (巴塔哥尼亚)</span><span class="co">Patagonia Works</span></summary><div class="ev-body">ESG 报告</div></details>
      <details id="ev-zhaoyiming" data-b="zhaoyiming"><summary><span class="bn">赵一鸣 / 零食很忙</span><span class="co">湖南鸣鸣很忙</span></summary><div class="ev-body">8 条证据</div></details>
      <details id="ev-icbc" data-b="icbc"><summary><span class="bn">工商银行 (ICBC)</span><span class="co">中国工商银行股份有限公司</span></summary><div class="ev-body">4 条证据</div></details>
      <details id="ev-abc" data-b="abc"><summary><span class="bn">农业银行 (ABC)</span><span class="co">中国农业银行股份有限公司</span></summary><div class="ev-body">2 条证据</div></details>
      <details id="ev-yidiandian" data-b="yidiandian"><summary><span class="bn">一点点 (1点点)</span><span class="co">生根餐饮</span></summary><div class="ev-body">3 条证据</div></details>
      <details id="ev-customx" data-b="customx"><summary><span class="bn">完全不同的公示名</span><span class="co">某公司</span></summary><div class="ev-body">1 条证据</div></details>
      <details id="ev-luxiyi" data-b="luxiyi"><summary><span class="bn">陆喜依</span><span class="co">陆喜依</span></summary><div class="ev-body">5 条证据</div></details>
    </div>
  </div>
</section>
<div id="builtin-layer" class="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4">
  <div class="bg-white rounded-2xl">
    <button class="close-x">✕</button>
    <h2>Patagonia (巴塔哥尼亚)</h2>
    <div class="pt-2 flex justify-end gap-2">
      <button class="ticket-btn">生成我的投票小票</button>
    </div>
  </div>
</div>
<div id="custom-layer" class="sxg-layer">
  <div class="sxg-box sxg-box-lg">
    <h2 class="sxg-h2">工商银行</h2>
    <div class="sxg-actions right">
      <button class="sxg-btn sxg-btn-primary sxg-btn-sm">生成我的投票小票</button>
      <button class="sxg-btn sxg-btn-ghost sxg-btn-sm">关闭</button>
    </div>
  </div>
</div>
<div id="ticket-layer" class="sxg-layer">
  <div class="sxg-box">
    <div class="sxg-actions"><button class="sxg-btn">复制小票文本</button></div>
  </div>
</div>
</body></html>`;

function makeDom(hash) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => {
    if (/Could not load|not implemented/i.test(e.message)) return;
    errors.push(e.message);
  });
  const dom = new JSDOM(PAGE, {
    url: 'http://localhost/index.html' + (hash || ''),
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole: vc
  });
  const w = dom.window;
  const d = w.document;
  // 模拟 evidence-collapse.js 的全局函数，并记录调用参数
  w.__sxgOpenEvidenceBoard = function (id) {
    w.__openCalls = w.__openCalls || [];
    w.__openCalls.push(id);
    const wrap = d.querySelector('.ev-body-wrap');
    if (wrap) wrap.style.display = 'block';
    const t = id ? d.getElementById(id) : null;
    if (t && t.tagName === 'DETAILS') t.setAttribute('open', '');
  };
  w.customCardsConfig = [
    { id: 'snack-card', name: '赵一鸣/零食很忙' },
    { id: 'icbc-card', name: '工商银行' },
    { id: 'abc-card', name: '农业银行' },
    { id: 'customx-card', name: '某张卡' }
  ];
  // 关闭按钮模拟 React / custom-card-actions.js 自己的卸载
  const bx = d.querySelector('#builtin-layer .close-x');
  bx.addEventListener('click', () => {
    const l = d.getElementById('builtin-layer');
    if (l && l.parentNode) l.parentNode.removeChild(l);
    w.__closedBuiltin = true;
  });
  const bc = d.querySelector('#custom-layer .sxg-actions button:last-child');
  bc.addEventListener('click', () => {
    const l = d.getElementById('custom-layer');
    if (l && l.parentNode) l.parentNode.removeChild(l);
    w.__closedCustom = true;
  });
  w.eval(read('evidence-jump-patch.js'));
  d.dispatchEvent(new w.Event('DOMContentLoaded'));
  return { dom, w, d, errors };
}

(async () => {
  console.log('=== 详情弹窗「跳转到证据公示」：完整定位到对应公示条目 ===\n');

  // ─────────── 0. 静态接线（三层强制的第三层） ───────────
  console.log('--- 0. 文件与接线 ---');
  const src = read('evidence-jump-patch.js');
  const html = read('index.html');
  const wf = read('.github/workflows/verify.yml');
  const rd = read('README.md');
  check('跳转补丁文件存在', exists('evidence-jump-patch.js'));
  check('首页挂了跳转补丁（?v=1 防缓存）',
    /<script defer src="\.\/evidence-jump-patch\.js\?v=1"><\/script>/.test(html));
  check('真 DOM 测试挂进 CI 的 pinyin job', /test-evidence-jump\.cjs/.test(wf));
  check('README 写死两类弹窗一视同仁 + 完整定位口径',
    /详情弹窗证据链公示跳转/.test(rd) && /完整定位/.test(rd) && /内置.*自定义/.test(rd));
  check('补丁不碰压缩 bundle', /不能改 bundle|不能改\s*bundle/.test(src));
  check('补丁不硬编码任何品牌 URL / 外链', !/https?:\/\//.test(src));
  check('补丁不写死品牌清单（运行时读公示区 DOM 建索引）',
    /#evidence-board details\[data-b\]/.test(src) && !/ev-patagonia|ev-icbc|ev-zhaoyiming/.test(src));

  // ─────────── 1. 真 DOM：两类弹窗都插上按钮 ───────────
  console.log('\n--- 1. 两类弹窗按钮挂载 ---');
  const { dom, w, d, errors } = makeDom();
  await tick(120);
  const btns = [...d.querySelectorAll('button[data-sxg-ev-jump]')];
  check('内置 React 弹窗 + 自定义卡弹窗各一个按钮（共 2 个）', btns.length === 2, btns.length);
  const bBuiltin = d.querySelector('#builtin-layer button[data-sxg-ev-jump]');
  const bCustom = d.querySelector('#custom-layer button[data-sxg-ev-jump]');
  check('内置弹窗按钮挂在 pt-2 flex justify-end 那一排',
    !!bBuiltin && /pt-2/.test(bBuiltin.parentElement.className)
    && /justify-end/.test(bBuiltin.parentElement.className));
  check('自定义弹窗按钮挂在 sxg-actions right 那一排',
    !!bCustom && /sxg-actions/.test(bCustom.parentElement.className));
  check('两个按钮文案一致「跳转到证据公示」',
    !!btns.length && btns.every((b) => b.textContent.trim() === '跳转到证据公示'));
  check('按钮是 type=button 且有 aria-label / title',
    btns.every((b) => b.type === 'button' && b.getAttribute('aria-label') && b.getAttribute('title')));
  check('按钮插在「生成我的投票小票」之前（截图红框位置）',
    btns.every((b) => b.nextElementSibling && /生成我的投票小票/.test(b.nextElementSibling.textContent)));
  check('容器打了幂等标记 data-sxg-ev-jump-root',
    btns.every((b) => b.parentElement.hasAttribute('data-sxg-ev-jump-root')));
  check('按钮排允许换行，不挤压原有按钮', /flex-wrap:wrap/.test(d.getElementById('sxg-ev-jump-style').textContent));
  check('没有锚点按钮的其它弹窗（小票层）不会被误挂',
    !d.querySelector('#ticket-layer button[data-sxg-ev-jump]'));

  // 幂等 + React/自定义弹窗重渲染自愈
  d.body.appendChild(d.createElement('span'));
  await tick(120);
  check('重复触发 DOM 变动不会重复插按钮（幂等）',
    d.querySelectorAll('button[data-sxg-ev-jump]').length === 2);
  const oldFoot = bBuiltin ? bBuiltin.parentElement : null;
  if (oldFoot) {
    const rebuilt = d.createElement('div');
    rebuilt.className = 'pt-2 flex justify-end gap-2';
    rebuilt.innerHTML = '<button class="ticket-btn">生成我的投票小票</button>';
    oldFoot.parentNode.replaceChild(rebuilt, oldFoot);
  }
  await tick(150);
  const reBtn = d.querySelector('#builtin-layer button[data-sxg-ev-jump]');
  check('React 重渲染替换按钮排后自动补挂', !!reBtn);
  check('补挂后按钮仍在小票按钮之前',
    !!reBtn && !!reBtn.nextElementSibling
    && reBtn.nextElementSibling.textContent.indexOf('生成我的投票小票') !== -1);

  // ─────────── 2. 卡片 → 公示条目解析（四层） ───────────
  console.log('\n--- 2. 卡片 → 公示条目解析 ---');
  const J = w.__sxgEvidenceJump;
  check('测试钩子已暴露', !!J && typeof J.resolve === 'function');
  check('① 品牌名归一化精确：Patagonia (巴塔哥尼亚) → ev-patagonia',
    J.resolve('Patagonia (巴塔哥尼亚)')?.id === 'ev-patagonia');
  check('① 空格/斜杠归一化：赵一鸣/零食很忙 → ev-zhaoyiming',
    J.resolve('赵一鸣/零食很忙', 'snack-card')?.id === 'ev-zhaoyiming');
  check('② 去括号匹配：工商银行 → ev-icbc',
    J.resolve('工商银行', 'icbc-card')?.id === 'ev-icbc');
  check('② 去括号匹配：一点点 → ev-yidiandian',
    J.resolve('一点点', 'yidiandian-card')?.id === 'ev-yidiandian');
  check('③ slug 兜底：品牌名与公示名完全不同时按 data-b 命中 ev-customx',
    J.resolve('某张卡', 'customx-card')?.id === 'ev-customx');
  check('④ 公司名归一化：中国农业银行股份有限公司 → ev-abc',
    J.resolve('中国农业银行股份有限公司')?.id === 'ev-abc');
  // 站长 2026-11-10 点名复核：拼音搜索框搜「陆喜依」→ 点新按钮要精准落到 ev-luxiyi。
  // 这一条已用无头 Edge + CDP 真渲染验收（D:/WorkBuddy-Cache/_luxiyi_verify.cjs）。
  check('★ 站长点名：陆喜依（S 级自定义卡）→ ev-luxiyi',
    J.resolve('陆喜依', 'luxiyi-card')?.id === 'ev-luxiyi');
  check('★ 真实首页公示区存在 ev-luxiyi 条目（精准定位的真相源）',
    /<details id="ev-luxiyi" data-b="luxiyi"/.test(read('index.html')));
  check('无条目（虚拟对比黑榜）返回 null，不编造',
    J.resolve('某代工烘焙食品 (虚拟对比黑榜)') === null);
  check('cfgIdByName 能从 customCardsConfig 反查 slug',
    J.cfgIdByName('工商银行') === 'icbc-card');
  check('norm 去掉空格/斜杠/括号，英文小写',
    J.norm(' 赵一鸣 / 零食很忙 ') === J.norm('赵一鸣零食很忙')
    && J.norm('ICBC (工商银行)') === J.norm('icbc工商银行'));
  check('stripParen 去掉中英文括号内容', J.stripParen('工商银行 (ICBC)') === '工商银行');

  // ─────────── 3. 点击内置弹窗：完整跳转链路 ───────────
  console.log('\n--- 3. 内置弹窗点击 → 完整定位 ---');
  d.querySelector('#builtin-layer button[data-sxg-ev-jump]').click();
  await tick(220);
  check('点了弹窗自身的关闭按钮（不外部 removeChild React 节点）', w.__closedBuiltin === true);
  check('弹窗已卸载', !d.getElementById('builtin-layer'));
  check('调用了 evidence-collapse.js 的展开函数且目标为 ev-patagonia',
    (w.__openCalls || []).includes('ev-patagonia'));
  check('公示区从默认折叠变成展开', d.querySelector('.ev-body-wrap').style.display === 'block');
  check('目标 <details> 被展开（open）', d.getElementById('ev-patagonia').hasAttribute('open'));
  check('目标条目带可见高亮标记 data-sxg-ev-focus',
    d.getElementById('ev-patagonia').getAttribute('data-sxg-ev-focus') === '1');
  check('同时只有一个条目高亮', d.querySelectorAll('details[data-sxg-ev-focus]').length === 1);
  check('URL 锚点更新为 #ev-patagonia（可复制分享）', w.location.hash === '#ev-patagonia');
  check('没有出现「暂无独立条目」提示（确实命中了）', !d.querySelector('[data-sxg-ev-notice]'));

  // ─────────── 4. 点击自定义弹窗：去括号/slug 兜底也完整定位 ───────────
  console.log('\n--- 4. 自定义弹窗点击 → 完整定位 ---');
  d.querySelector('#custom-layer button[data-sxg-ev-jump]').click();
  await tick(220);
  check('点了自定义弹窗的「关闭」按钮', w.__closedCustom === true);
  check('自定义弹窗已卸载', !d.getElementById('custom-layer'));
  check('目标解析为 ev-icbc（卡名「工商银行」vs 公示名「工商银行 (ICBC)」）',
    (w.__openCalls || []).includes('ev-icbc'));
  check('ev-icbc 被展开 + 高亮',
    d.getElementById('ev-icbc').hasAttribute('open')
    && d.getElementById('ev-icbc').getAttribute('data-sxg-ev-focus') === '1');
  check('高亮从上一条目移走（不残留）',
    !d.getElementById('ev-patagonia').hasAttribute('data-sxg-ev-focus'));
  check('URL 锚点更新为 #ev-icbc', w.location.hash === '#ev-icbc');

  // ─────────── 5. 无条目：诚实降级，不假装命中 ───────────
  console.log('\n--- 5. 无对应条目时如实说明 ---');
  J.open(null, '某代工烘焙食品 (虚拟对比黑榜)');
  await tick(120);
  const notice = d.querySelector('[data-sxg-ev-notice]');
  check('出现如实提示，且点名该品牌', !!notice && notice.textContent.indexOf('某代工烘焙食品') !== -1);
  check('提示写明「暂无独立证据链公示条目」', !!notice && notice.textContent.indexOf('暂无独立证据链公示条目') !== -1);
  check('提示写明「不编造证据」', !!notice && notice.textContent.indexOf('不编造证据') !== -1);
  check('没有伪造任何高亮条目', d.querySelectorAll('details[data-sxg-ev-focus]').length === 0);
  check('公示区总览仍展开', d.querySelector('.ev-body-wrap').style.display === 'block');
  check('锚点回落为 #evidence-board', w.location.hash === '#evidence-board');
  check('运行期无 JS 异常', errors.length === 0, errors.slice(0, 3));

  // ─────────── 6. 分享链接 #ev-xxx 自动定位 ───────────
  console.log('\n--- 6. 分享链接自动定位 ---');
  const boot = makeDom('#ev-icbc');
  await tick(500);
  check('带 #ev-icbc 打开首页时自动展开该条目',
    boot.d.getElementById('ev-icbc').hasAttribute('open'));
  check('自动定位时公示区展开',
    boot.d.querySelector('.ev-body-wrap').style.display === 'block');
  check('自动定位不误改锚点', boot.w.location.hash === '#ev-icbc');
  check('#evidence-board 原有导航锚点不会误触发 ev- 自动定位',
    (() => { const b2 = makeDom('#evidence-board'); return b2.w.location.hash === '#evidence-board'; })());

  dom.window.close(); boot.dom.window.close();
  console.log('\n' + '='.repeat(52));
  console.log(`通过 ${pass} 项，失败 ${fail} 项`);
  if (fail) console.log('失败项：\n  - ' + fails.join('\n  - '));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
