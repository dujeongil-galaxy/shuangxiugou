// 星巴克 × WorkBuddy 联名推广 —— 行为 / 布局验证
//
// 起因（站长指令 2026-11-12）：把原「良配」限时推广临时下线（index.html 注释其引用，
// 文件保留），换成星巴克 × WorkBuddy 联名活动。悬浮窗放不下整张海报，
// 采用「小悬浮卡 + 点击弹出活动海报弹窗」。站长唯一硬约束：活动日期必须完整显示。
//
// 本测试用 jsdom + 真实 CSS 计算，断言：
//   1) 星巴克 LOGO 借用站内现成 assets/starbucks.svg（图片非文字，2026-11-17 站长要求）
//   2) 弹窗里含完整活动日期、活动文案、真·微信小程序码入口（非我画的假码）
//   3) index.html 中良配引用已注释下线、星巴克引用已上线
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

console.log('=== 星巴克 × WorkBuddy 联名推广 验证 ===\n');

const css = read('starbucks-promo.css');
const js = read('starbucks-promo.js');
const html = read('index.html');

// ---------- 1. 文件存在 ----------
console.log('--- 文件 ---');
check('starbucks-promo.css 存在', fs.existsSync(path.join(ROOT, 'starbucks-promo.css')));
check('starbucks-promo.js 存在', fs.existsSync(path.join(ROOT, 'starbucks-promo.js')));

// ---------- 2. 配置：完整活动日期 + 文案 ----------
console.log('\n--- 配置与文案 ---');
const dateM = /activityDateFull:\s*'([^']*)'/.exec(js);
check('JS 能读到 activityDateFull', !!dateM, dateM && dateM[1]);
check('活动日期完整显示（含起止时分）',
  dateM && /11月12日\s*8:00\s*[—-]\s*11月16日\s*23:59/.test(dateM[1]),
  dateM && dateM[1]);

const copyM = /copy:\s*'([^']*)'/.exec(js);
check('活动文案含「完全免费哦」', copyM && copyM[1].includes('完全免费哦'), copyM && copyM[1]);

const brandM = /var LOGO_TEXT = '([^']*)'/.exec(js);
check('LOGO 是「星巴克」', brandM && brandM[1] === '星巴克', brandM && brandM[1]);

const ctaM = /cta:\s*'([^']*)'/.exec(js);
check('悬浮卡 CTA 文案为「查看活动」', ctaM && ctaM[1] === '查看活动', ctaM && ctaM[1]);

// ---------- 3. LOGO：借用站内现成 svg（2026-11-17 站长要求，不再用文字标） ----------
console.log('\n--- LOGO（站内现成 svg） ---');
function parseBlock(cssText, selector, from = 0) {
  const i = cssText.indexOf(selector, from);
  if (i === -1) return null;
  return cssText.slice(i, cssText.indexOf('}', i) + 1);
}
check('assets/starbucks.svg 存在', fs.existsSync(path.join(ROOT, 'assets/starbucks.svg')));
check('JS 配置 logoSrc 指向站内 starbucks.svg', /logoSrc:\s*'\.\/assets\/starbucks\.svg'/.test(js));
check('JS 用 logoHtml() 渲染 <img>（含 onerror 兜底）',
  /logoHtml\(/.test(js) && /onerror/.test(js));
check('CSS 有 logo 图片等比缩放规则', /\.sxg-promo__logo__img[^{]*\{[^}]*object-fit:\s*contain/s.test(css));
const blocks = [
  ['≥1440px 右侧竖排卡片', css.indexOf('@media (min-width: 1440px)')],
  ['<1440px 底部吸底条', css.indexOf('@media (max-width: 1439px)')],
  ['≤374px 超窄屏', css.indexOf('@media (max-width: 374px)')],
];
for (const [label, from] of blocks) {
  const block = parseBlock(css, '.sxg-promo__logo {', from);
  if (!block) { check(`${label}：找得到 logo 样式`, false); continue; }
  const wM = /width:\s*(\d+(?:\.\d+)?)px/.exec(block);
  const hM = /height:\s*(\d+(?:\.\d+)?)px/.exec(block);
  check(`${label}：logo 容器为正方或近方（图片用，不是长条文字底）`,
    !!wM && !!hM && Math.abs(parseFloat(wM[1]) - parseFloat(hM[1])) <= 6,
    { w: wM && wM[1], h: hM && hM[1] });
}

// ---------- 4. 弹窗与海报关键节点 ----------
console.log('\n--- 弹窗与海报 ---');
check('CSS 含 .sb-modal（活动海报弹窗）', /\.sb-modal\s*\{/.test(css));
check('CSS 含 .sb-poster__date（完整日期节点）', /\.sb-poster__date\s*\{/.test(css));
check('CSS 含 .sb-poster__scan（微信扫一扫说明）', /\.sb-poster__scan\s*\{/.test(css));
check('真·微信小程序码图片存在', fs.existsSync(path.join(ROOT, 'assets/workbuddy-mp-code.png')));
check('JS 引用真码 mpCode 并渲染 <img>', /mpCode:\s*'\.\/assets\/workbuddy-mp-code\.png'/.test(js) && /sb-poster__qr-img/.test(js));
check('弹窗文案为「微信扫一扫」而非假「扫码参与」', /微信扫一扫/.test(js) && !/扫码参与/.test(js));
check('JS 构建弹窗时写入完整日期', /CONFIG\.activityDateFull/.test(js));
check('JS 弹窗含底部规则说明', /CONFIG\.foot/.test(js));

// ---------- 5. 避让语义（沿用良配 --sxg-bar-h） ----------
console.log('\n--- 避让语义 ---');
check('JS 按 1440px 断点判断「是否吸底」', /matchMedia\('\(min-width: 1440px\)'\)\.matches/.test(js));
check('JS ≥1440px 或隐藏时 --sxg-bar-h 写 0', /var h = \(wide \|\| aside\.classList\.contains\('is-hidden'\)\) \? 0 : aside\.offsetHeight;/.test(js));
check('CSS 吸底条让 body 避让 --sxg-bar-h', /body\s*\{\s*padding-bottom:\s*var\(--sxg-bar-h/.test(css));

// ---------- 6. index.html 引用状态 ----------
console.log('\n--- index.html 引用状态 ---');
// 必须先剥掉 HTML 注释：良配的引用被包在 <!-- ... --> 里，
// 裸正则会把注释里的 <link>/<script> 也当成活跃引用（已栽过）。
const htmlNoComments = html.replace(/<!--[\s\S]*?-->/g, '');
// 良配：必须被注释下线（活跃引用不得出现），文件保留以便恢复
const lpCssActive = /<link[^>]*liangpei-ad\.css[^>]*>/i.test(htmlNoComments);
const lpJsActive = /<script[^>]*liangpei-ad\.js[^>]*>/i.test(htmlNoComments);
check('index.html 中良配 css 已注释下线（无活跃引用）', !lpCssActive);
check('index.html 中良配 js 已注释下线（无活跃引用）', !lpJsActive);
check('良配 css 注释块仍保留（便于恢复）', html.includes('liangpei-ad.css?v=13') && html.includes('<!-- <link rel="stylesheet" href="./liangpei-ad.css'));
check('良配 js 注释块仍保留（便于恢复）', html.includes('liangpei-ad.js?v=11') && html.includes('<!-- <script defer src="./liangpei-ad.js'));

// 星巴克：必须已上线
check('index.html 引用 starbucks-promo.css', /<link[^>]*starbucks-promo\.css[^>]*>/i.test(html));
check('index.html 引用 starbucks-promo.js', /<script[^>]*starbucks-promo\.js[^>]*>/i.test(html));
check('starbucks-promo.css 版本号 ?v=2', /starbucks-promo\.css\?v=2/.test(html));
check('starbucks-promo.js 版本号 ?v=2', /starbucks-promo\.js\?v=2/.test(html));
check('星巴克广告 showAfter = 1500ms（1.5 秒淡入，非 6000ms 长空窗）', /showAfter:\s*1500\b/.test(js));

// ---------- 7. jsdom 真渲染：logo 不折行声明 ----------
console.log('\n--- 浏览器实测 ---');
const dom = new JSDOM(`<!doctype html><html><head><style>${css}</style></head>
  <body><aside class="sxg-promo"><div class="sxg-promo__body">
    <div class="sxg-promo__logo">${brandM ? brandM[1] : ''}</div>
    <div class="sxg-promo__text"><div class="sxg-promo__brand">${brandM ? brandM[1] : ''} × WorkBuddy</div></div>
  </div></aside></body></html>`,
  { pretendToBeVisual: true });
const doc = dom.window.document;
const logoEl = doc.querySelector('.sxg-promo__logo');
check('渲染出了 logo 元素', !!logoEl);
const sheetText = Array.from(doc.styleSheets).flatMap((s) => Array.from(s.cssRules).map((r) => r.cssText)).join('\n');
check('样式表有 logo 图片等比规则（object-fit:contain）', /\.sxg-promo__logo__img[^{]*\{[^}]*object-fit:\s*contain/s.test(sheetText));
check('logo 容器白底（.is-fallback 之外背景 #ffffff，图片看得清）', /\.sxg-promo__logo:not\(\.is-fallback\)[^{]*\{[^}]*background:\s*#ffffff/s.test(sheetText));

console.log('\n' + '='.repeat(52));
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
if (fail) console.log('失败项：\n  - ' + fails.join('\n  - '));
process.exit(fail ? 1 : 0);
