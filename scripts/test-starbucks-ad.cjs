// 星巴克 × WorkBuddy 联名推广 —— 行为 / 布局验证
//
// 起因（站长指令 2026-11-12）：把原「良配」限时推广临时下线（index.html 注释其引用，
// 文件保留），换成星巴克 × WorkBuddy 联名活动。悬浮窗放不下整张海报，
// 采用「小悬浮卡 + 点击弹出活动海报弹窗」。站长唯一硬约束：活动日期必须完整显示。
//
// 本测试用 jsdom + 真实 CSS 计算，断言：
//   1) 星巴克 LOGO「星巴克」三字永远横排（容器宽 > 文字宽 + 余量，nowrap）
//   2) 弹窗里含完整活动日期、活动文案、扫码参与
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

const css = read('starbucks-ad.css');
const js = read('starbucks-ad.js');
const html = read('index.html');

// ---------- 1. 文件存在 ----------
console.log('--- 文件 ---');
check('starbucks-ad.css 存在', fs.existsSync(path.join(ROOT, 'starbucks-ad.css')));
check('starbucks-ad.js 存在', fs.existsSync(path.join(ROOT, 'starbucks-ad.js')));

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

// ---------- 3. LOGO 横排（容器宽 > 文字宽 + 余量，nowrap） ----------
console.log('\n--- LOGO 横排 ---');
function parseBlock(cssText, selector, from = 0) {
  const i = cssText.indexOf(selector, from);
  if (i === -1) return null;
  return cssText.slice(i, cssText.indexOf('}', i) + 1);
}
const genIdx = css.indexOf('.sb-ad__logo {');
check('找得到通用段 .sb-ad__logo', genIdx > 0);
const genBlock = css.slice(genIdx, css.indexOf('}', genIdx) + 1);
check('通用段设了 white-space: nowrap', /white-space:\s*nowrap/.test(genBlock));

const charCount = brandM ? brandM[1].length : 0; // 3
const blocks = [
  ['≥1440px 右侧竖排卡片', parseBlock(css, '.sb-ad__logo {', css.indexOf('@media (min-width: 1440px)'))],
  ['<1440px 底部吸底条', parseBlock(css, '.sb-ad__logo {', css.indexOf('@media (max-width: 1439px)'))],
  ['≤374px 超窄屏', parseBlock(css, '.sb-ad__logo {', css.indexOf('@media (max-width: 374px)'))],
];
for (const [label, block] of blocks) {
  if (!block) { check(`${label}：找得到 logo 样式`, false); continue; }
  const wM = /width:\s*(\d+(?:\.\d+)?)px/.exec(block);
  const fM = /font-size:\s*(\d+(?:\.\d+)?)px/.exec(block);
  check(`${label}：能解析出 width 与 font-size`, !!wM && !!fM, { w: wM && wM[1], f: fM && fM[1] });
  if (!wM || !fM) continue;
  const width = parseFloat(wM[1]);
  const fontSize = parseFloat(fM[1]);
  const needed = charCount * fontSize;
  const slack = width - needed;
  check(`${label}：容器(${width}px) 比 ${charCount} 字所需(${needed}px) 至少宽 8px`, slack >= 8, { width, fontSize, needed, slack });
  check(`${label}：本段也设了 nowrap（兜底）`, /white-space:\s*nowrap/.test(block));
}

// ---------- 4. 弹窗与海报关键节点 ----------
console.log('\n--- 弹窗与海报 ---');
check('CSS 含 .sb-modal（活动海报弹窗）', /\.sb-modal\s*\{/.test(css));
check('CSS 含 .sb-poster__date（完整日期节点）', /\.sb-poster__date\s*\{/.test(css));
check('CSS 含 .sb-poster__scan（扫码参与）', /\.sb-poster__scan\s*\{/.test(css));
check('JS 构建弹窗时写入完整日期', /CONFIG\.activityDateFull/.test(js));
check('JS 弹窗含「扫码参与」文案', /扫码参与/.test(js));
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
check('index.html 引用 starbucks-ad.css', /<link[^>]*starbucks-ad\.css[^>]*>/i.test(html));
check('index.html 引用 starbucks-ad.js', /<script[^>]*starbucks-ad\.js[^>]*>/i.test(html));
check('starbucks-ad.css 版本号 ?v=1', /starbucks-ad\.css\?v=1/.test(html));
check('starbucks-ad.js 版本号 ?v=1', /starbucks-ad\.js\?v=1/.test(html));

// ---------- 7. jsdom 真渲染：logo 不折行声明 ----------
console.log('\n--- 浏览器实测 ---');
const dom = new JSDOM(`<!doctype html><html><head><style>${css}</style></head>
  <body><aside class="sb-ad"><div class="sb-ad__body">
    <div class="sb-ad__logo">${brandM ? brandM[1] : ''}</div>
    <div class="sb-ad__text"><div class="sb-ad__brand">${brandM ? brandM[1] : ''} × WorkBuddy</div></div>
  </div></aside></body></html>`,
  { pretendToBeVisual: true });
const doc = dom.window.document;
const logoEl = doc.querySelector('.sb-ad__logo');
check('渲染出了 logo 元素', !!logoEl);
check('logo 元素文本是「星巴克」', logoEl && logoEl.textContent === '星巴克');
const sheetText = Array.from(doc.styleSheets).flatMap((s) => Array.from(s.cssRules).map((r) => r.cssText)).join('\n');
check('样式表里 logo 规则含 nowrap', /\.sb-ad__logo[^{]*\{[^}]*white-space:\s*nowrap/s.test(sheetText));
check('样式表里没有把 logo 的 nowrap 改回 normal', !/\.sb-ad__logo[^{]*\{[^}]*white-space:\s*normal/s.test(sheetText));

console.log('\n' + '='.repeat(52));
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
if (fail) console.log('失败项：\n  - ' + fails.join('\n  - '));
process.exit(fail ? 1 : 0);
