// AI 按钮全局化行为验证（2026-11-18）。
//
// 钉死三件事：
//   ① 全站应挂页都挂新版 ai-link.js、特例页不挂、零 ai-chat.js 残留；
//   ② 锁屏态建按钮、href 按目录推断正确；
//   ③ ★ 阅读态守卫：notes.html 解锁成正文（#toc）后按钮不建/被移除，
//      且 800/1800ms 兜底定时器触发时也不复活（实测 document.write 不清 DOM）。
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const exists = (f) => fs.existsSync(path.join(ROOT, f));

let pass = 0, fail = 0;
const fails = [];
const check = (l, c, x) => {
  if (c) { pass++; console.log('  ✓', l); }
  else { fail++; fails.push(l); console.log('  ✗', l, x !== undefined ? JSON.stringify(x) : ''); }
};

console.log('=== AI 按钮全局化验证 ===\n');

const aiLinkSrc = read('ai-link.js');

// ---------- 1. 全站挂载口径 ----------
console.log('--- 挂载口径 ---');
const SHOULD = ['about.html', 'byd-report.html', 'community-rules.html', 'contact.html',
  'disclaimer.html', 'notes.html', 'privacy.html', 'projects.html', 'qq-nainai.html',
  'remind-original.html', 'sponsor.html', 'success-stories.html', 'usdt-guide.html',
  'why-shuangxiugou.html', 'index.html'];
const NO = ['labor-ai.html', '404.html', 'discussion-closed.html',
  'notes-plaintext-preview.html', 'googlea540a6c2cd5f0e6c.html'];
const miss = SHOULD.filter((f) => !exists(f) || !/ai-link\.js\?v=\d+/.test(read(f)));
check('15 个应挂页全部挂 ai-link.js', miss.length === 0, miss);
const stray = NO.filter((f) => exists(f) && /ai-link\.js\?v=\d+/.test(read(f)));
check('5 个特例页不挂 ai-link.js', stray.length === 0, stray);

// 全站（含 brand/）零 ai-chat.js
const stale = [];
for (const f of fs.readdirSync(ROOT)) {
  if (f.endsWith('.html') && /ai-chat\.js/.test(read(f))) stale.push(f);
}
for (const f of fs.readdirSync(path.join(ROOT, 'brand'))) {
  if (f.endsWith('.html') && /ai-chat\.js/.test(fs.readFileSync(path.join(ROOT, 'brand', f), 'utf8'))) stale.push('brand/' + f);
}
check('全站零 ai-chat.js 旧挂件引用', stale.length === 0, stale.slice(0, 8));

// 版本统一：所有引用页 ?v 一致
const versions = new Set();
for (const f of fs.readdirSync(ROOT).filter((x) => x.endsWith('.html'))) {
  const m = /ai-link\.js\?v=(\d+)/.exec(fs.readFileSync(path.join(ROOT, f), 'utf8'));
  if (m) versions.add(m[1]);
}
for (const f of fs.readdirSync(path.join(ROOT, 'brand')).filter((x) => x.endsWith('.html'))) {
  const m = /ai-link\.js\?v=(\d+)/.exec(fs.readFileSync(path.join(ROOT, 'brand', f), 'utf8'));
  if (m) versions.add(m[1]);
}
check('全站 ai-link.js ?v 统一为一个值', versions.size === 1, [...versions]);

// ---------- 2. jsdom 行为：锁屏建按钮 / href 正确 ----------
console.log('\n--- 锁屏态行为 ---');
function makeDom(bodyHtml, url) {
  const dom = new JSDOM(`<!doctype html><html><head><style>
    :root{--sxg-bar-h:0px}</style></head><body>${bodyHtml}</body></html>`,
    { url: url || 'http://localhost/shuangxiugou/notes.html', pretendToBeVisual: true, runScripts: 'outside-only' });
  dom.window.eval(aiLinkSrc);
  return dom;
}
// 锁屏页：有 #pw，无 #toc
const lockDom = makeDom('<div class="lock"><input id="pw" type="password"></div>');
lockDom.window.SXG_AI_LINK ? null : null; // eval 已执行
// jsdom readyState 可能仍 loading，显式 boot 通过 DOMContentLoaded 已挂；用 setTimeout 前先手动触发
// ai-link.js 没有暴露 boot，用 DOMContentLoaded 事件或直接等 —— jsdom 触发 DOMContentLoaded
lockDom.window.document.dispatchEvent(new lockDom.window.Event('DOMContentLoaded'));
const lockBtn = lockDom.window.document.getElementById('sxg-ai-fab');
check('锁屏态建出 AI 按钮', !!lockBtn);
check('锁屏态按钮 href 指向 ./labor-ai.html',
  lockBtn && lockBtn.getAttribute('href') === './labor-ai.html', lockBtn && lockBtn.getAttribute('href'));
check('锁屏态 aria-label 正确',
  lockBtn && lockBtn.getAttribute('aria-label') === '休休查');

// 品牌目录页：href 应为 ../labor-ai.html
const brandDom = makeDom('<div>brand</div>', 'http://localhost/shuangxiugou/brand/xiaomi.html');
brandDom.window.document.dispatchEvent(new brandDom.window.Event('DOMContentLoaded'));
const brandBtn = brandDom.window.document.getElementById('sxg-ai-fab');
check('品牌页 href 指向 ../labor-ai.html',
  brandBtn && brandBtn.getAttribute('href') === '../labor-ai.html', brandBtn && brandBtn.getAttribute('href'));

// ---------- 3. ★ 阅读态守卫 ----------
console.log('\n--- 阅读态守卫（关键）---');
const readDom = makeDom('<nav id="toc"></nav><article>正文</article>');
readDom.window.document.dispatchEvent(new readDom.window.Event('DOMContentLoaded'));
check('阅读态（#toc）下 isReaderMode() 为真', readDom.window.SXG_AI_LINK.isReaderMode());
check('阅读态下不建 AI 按钮', !readDom.window.document.getElementById('sxg-ai-fab'));

// 模拟「先锁屏建按钮 → 再 document.write 成正文 → 兜底定时器触发」的真实序列：
// 直接造一个有按钮 + #toc 的文档，再触发 DOMContentLoaded（等价于 boot 重跑）。
const afterDom = makeDom('<a id="sxg-ai-fab">AI</a><nav id="toc"></nav><article>正文</article>');
afterDom.window.document.dispatchEvent(new afterDom.window.Event('DOMContentLoaded'));
check('★ 正文态里已有的残留按钮被移除（不复活）',
  !afterDom.window.document.getElementById('sxg-ai-fab'));

// 守卫函数源码钉死
check('守卫检测 #toc 且调用 removeChild',
  /getElementById\('toc'\)/.test(aiLinkSrc) && /removeChild\(stale\)/.test(aiLinkSrc));

console.log('\n' + '='.repeat(52));
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
if (fail) console.log('失败项：\n  - ' + fails.join('\n  - '));
process.exit(fail ? 1 : 0);
