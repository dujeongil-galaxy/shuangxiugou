// 站点政策声明条行为验证（policy-notice.js）。
//
// 起因（站长 2026-11-18 截图）：在顶栏正下方画红框，要求加一条社区治理声明，
// 措辞由站长给定，其中「这里」两字是**可点击链接** →
// https://dujeongil-galaxy.github.io/
//
// 重点钉死三件事，任一回潮都会让这条声明形同虚设：
//   ① 声明条插在 React 渲染的 <header> 之后（红框那条空白），不是塞进
//      #site-notice 滚动栏（那条有「零超链接」硬约定，点不准）；
//   ② 「这里」是 <a href=指定网址>，不是纯文本、不是占位 URL；
//   ③ 文案三段一字不差，尤其「零容忍」不能被软化掉。
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

let pass = 0, fail = 0;
const fails = [];
const check = (l, c, x) => {
  if (c) { pass++; console.log('  ✓', l); }
  else { fail++; fails.push(l); console.log('  ✗', l, x !== undefined ? JSON.stringify(x) : ''); }
};

console.log('=== 站点政策声明条验证（header 下方 + 「这里」真链接）===\n');

const js = read('policy-notice.js');
const html = read('index.html');
const htmlNoComments = html.replace(/<!--[\s\S]*?-->/g, '');

// ---------- 1. 脚本挂载 ----------
console.log('--- 挂载 ---');
check('policy-notice.js 存在', fs.existsSync(path.join(ROOT, 'policy-notice.js')));
check('index.html 活跃引用 policy-notice.js?v=3（非注释）',
  /<script[^>]*policy-notice\.js\?v=3[^>]*>/i.test(htmlNoComments));
check('脚本排在 header-to-dock.js 之后（同属 header 下游补丁）',
  html.indexOf('policy-notice.js') > html.indexOf('header-to-dock.js'));

// ---------- 2. 文案与链接常量 ----------
console.log('\n--- 文案与链接 ---');
const beforeM = /var TEXT_BEFORE = '([^']*)'/.exec(js);
const linkM = /var LINK_TEXT = '([^']*)'/.exec(js);
const afterM = /var TEXT_AFTER = '([^']*)'/.exec(js);
const hrefM = /var LINK_HREF = '([^']*)'/.exec(js);
const before = beforeM ? beforeM[1] : '';
const linkText = linkM ? linkM[1] : '';
const after = afterM ? afterM[1] : '';
const href = hrefM ? hrefM[1] : '';

check('原文前半段含「因乌克兰发生战争」', before.includes('因乌克兰发生战争'), before.slice(0, 20));
check('原文前半段含「无视或纵容」', before.includes('无视或纵容'));
check('原文前半段含 issues 与匿名邮箱来信举例',
  before.includes('issues') && before.includes('匿名邮箱来信'));
check('原文前半段以「点击」收尾（紧接链接）', before.endsWith('点击'), before.slice(-8));
check('链接文字恰好是「这里」两字', linkText === '这里', linkText);
check('原文后半段是「查看本站政策」', after === '查看本站政策', after);
check('文案含「零容忍原则」（不许被软化，站长强调是原则）', before.includes('零容忍原则'));
check('链接 URL 精确指向站长给定地址',
  href === 'https://dujeongil-galaxy.github.io/', href);
check('链接不是占位符（无 example/placeholder/仓库主页）',
  !/example|placeholder|#|github\.com\/dujeongil-galaxy$/i.test(href), href);

// ---------- 3. DOM 构建方式：真 <a>，不写 innerHTML ----------
console.log('\n--- DOM 构建 ---');
check('用 createElement("a") 建链接', /createElement\('a'\)/.test(js));
check('用 createTextNode 拼文案', /createTextNode\(TEXT_BEFORE\)/.test(js)
  && /createTextNode\(TEXT_AFTER\)/.test(js));
check('链接文字用 textContent 赋值（不 innerHTML）', /a\.textContent\s*=\s*LINK_TEXT/.test(js));
check('href 用 a.href 赋值（不写死在 innerHTML 字符串）', /a\.href\s*=\s*LINK_HREF/.test(js));
check('链接带 target=_blank 与 rel=noopener',
  /setAttribute\('target',\s*'_blank'\)/.test(js)
  && /setAttribute\('rel',\s*'noopener noreferrer'\)/.test(js));
check('脚本没有 innerHTML 赋值（无注入面；注释里提到不算）',
  !/\.innerHTML\s*=/.test(js));

// ---------- 4. 插入位置：header 之后，不进滚动栏 ----------
console.log('\n--- 插入位置 ---');
check('select 的是 <header>（React 顶栏）', /querySelector\('header'\)/.test(js));
check('插在 header.nextSibling 之前（即紧随 header 之后）',
  /insertBefore\(bar,\s*header\.nextSibling\)/.test(js));
check('有幂等判断：已在 header 后面就 return',
  /bar\.previousSibling === header/.test(js));
check('不往 #site-notice 里插（滚动栏零超链接硬约定）',
  !/getElementById\('site-notice'\)/.test(js)
  && !/querySelector\('#site-notice'\)/.test(js));
check('header 未挂载时定时重试 + MutationObserver 自愈',
  /setTimeout\(sweep,\s*300\)/.test(js)
  && /new MutationObserver/.test(js)
  && /obs\.observe/.test(js));

// ---------- 5. 样式：浅黄底深红字（站长最终定稿）、移动端可读 ----------
console.log('\n--- 样式 ---');
check('声明条浅黄底深红字（浅底配深色文字，不牺牲可读性）',
  /background:#fef3c7;color:#7f1d1d/.test(js));
check('不再是深红底白字，也不是更早的浅底红字',
  !/background:#7f1d1d;color:#ffffff/.test(js) && !/background:#fff;color:#dc2626/.test(js));
check('链接深红 + 下划线（浅底上可点可辨，非亮黄）',
  /color:#991b1b/.test(js) && /text-decoration:underline/.test(js)
  && !/color:#fde047/.test(js));
check('有 ≤640px 移动端字号下调', /@media \(max-width:640px\)/.test(js)
  && /font-size:12px/.test(js));

// ---------- 6. jsdom 真渲染 ----------
console.log('\n--- 浏览器实测（jsdom）---');
const dom = new JSDOM(`<!doctype html><html><head></head><body>
  <div id="root"><header><div>双休购 · ShuangxiuGo</div></header><main>正文</main></div>
  </body></html>`, { url: 'http://localhost/', pretendToBeVisual: true, runScripts: 'outside-only' });
dom.window.eval(js);
const doc = dom.window.document;
/* jsdom 新建后 readyState 仍是 loading，sweep 挂在 DOMContentLoaded 上没跑；
   这里显式触发一次，测的是 sweep 本身的正确性（真实浏览器里由事件/定时触发）。 */
dom.window.SXGPolicyNotice.sweep();
const bar = doc.getElementById('sxg-policy-notice');
check('渲染出了声明条', !!bar);
check('声明条紧随 header 之后', bar && bar.previousSibling === doc.querySelector('header'));
check('声明条文本与原文三段拼接一致',
  bar && bar.textContent === before + linkText + after,
  bar && bar.textContent);
const a = bar && bar.querySelector('a');
check('渲染出了「这里」链接', !!a && a.textContent === '这里');
check('链接 href 正确', a && a.getAttribute('href') === 'https://dujeongil-galaxy.github.io/',
  a && a.getAttribute('href'));
check('注入样式节点 #sxg-policy-notice-style 已创建',
  !!doc.getElementById('sxg-policy-notice-style'));
// 幂等：再次 sweep 不应插出第二条
dom.window.SXGPolicyNotice.sweep();
check('重复 sweep 幂等（页面里只有一条声明）',
  doc.querySelectorAll('#sxg-policy-notice').length === 1);
// 自愈：被移除后 sweep 能补回
bar.remove();
dom.window.SXGPolicyNotice.sweep();
check('被移除后 sweep 能重新插回（React 重渲染自愈）',
  !!doc.getElementById('sxg-policy-notice'));

console.log('\n' + '='.repeat(52));
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
if (fail) console.log('失败项：\n  - ' + fails.join('\n  - '));
process.exit(fail ? 1 : 0);
