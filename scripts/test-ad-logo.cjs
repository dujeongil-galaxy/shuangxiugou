// 广告位 LOGO 渲染验证：确保「雙休購」三字永远横排，不竖排
//
// 起因（用户截图）：右上角广告卡的 LOGO 显示成「良/配」竖排两行，
// 标题也被挤成怪样子。用户原话：「我从未说过竖着写，你不觉得很别扭？」
//
// 根因：容器宽度与「2 字 × 字号」正好相等（48px vs 2×24px），
// 任何字距/字重偏差就折行。这个临界值设计本身就是错的。
//
// 2026-10-18：广告位改为本站推广，LOGO 由「良配」两字改为「雙休購」三字，
// 容器宽度按三字重算（64px 容器 / 18px 字号 = 54px 内容，余量 10px）。
//
// 本测试用 jsdom + 真实 CSS 计算，断言 logo 容器宽度 > 文字所需宽度，
// 并且 white-space 是 nowrap —— 不依赖肉眼。
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

console.log('=== 广告位 LOGO 横排验证 ===\n');

const css = read('liangpei-ad.css');
const js = read('liangpei-ad.js');

// ---------- 1. 从 JS 取真实文案 ----------
const logoM = /var LOGO_TEXT = '([^']*)'/.exec(js);
const brandM = /brandLine: '([^']*)'/.exec(js);
check('JS 里能读到 LOGO_TEXT', !!logoM, logoM && logoM[1]);
check('LOGO 是「雙休購」三个字', logoM && logoM[1] === '雙休購', logoM && logoM[1]);
const logoText = logoM ? logoM[1] : '';
const charCount = logoText.length;

// ---------- 2. 通用段必须禁止折行 ----------
console.log('\n--- 通用段 ---');
const genericIdx = css.indexOf('.lp-ad__logo {');
check('找得到通用段 .lp-ad__logo', genericIdx > 0);
const genericBlock = css.slice(genericIdx, css.indexOf('}', genericIdx) + 1);
check('通用段设了 white-space: nowrap',
  /white-space:\s*nowrap/.test(genericBlock),
  genericBlock.replace(/\s+/g, ' ').slice(0, 120));

// ---------- 3. 两个断点段：容器宽度必须 > 文字宽 ----------
// 一个全角汉字在 CSS 里约等于 1em，即字号大小；再留一点字距余量。
console.log('\n--- 各断点容器宽度 ---');

function parseBlock(css, selector, from = 0) {
  const i = css.indexOf(selector, from);
  if (i === -1) return null;
  return css.slice(i, css.indexOf('}', i) + 1);
}

const blocks = [
  ['≥1440px 右侧竖排卡片', parseBlock(css, '.lp-ad__logo {', css.indexOf('@media (min-width: 1440px)'))],
  ['<1440px 底部吸底条', parseBlock(css, '.lp-ad__logo {', css.indexOf('@media (max-width: 1439px)'))],
];

for (const [label, block] of blocks) {
  if (!block) { check(`${label}：找得到 logo 样式`, false); continue; }
  const wM = /width:\s*(\d+(?:\.\d+)?)px/.exec(block);
  const fM = /font-size:\s*(\d+(?:\.\d+)?)px/.exec(block);
  check(`${label}：能解析出 width 与 font-size`, !!wM && !!fM,
    { w: wM && wM[1], f: fM && fM[1] });
  if (!wM || !fM) continue;

  const width = parseFloat(wM[1]);
  const fontSize = parseFloat(fM[1]);
  const needed = charCount * fontSize;      // 2 字所需最小宽度
  const slack = width - needed;

  // 留 8px 余量（字距、字重、字体度量差异）
  check(`${label}：容器(${width}px) 比 ${charCount} 字所需(${needed}px) 至少宽 8px`,
    slack >= 8,
    { width, fontSize, needed, slack });

  check(`${label}：本段也设了 nowrap（兜底）`,
    /white-space:\s*nowrap/.test(block));
}

// ---------- 4. 真的在浏览器里量一次 ----------
console.log('\n--- 浏览器实测 ---');
const dom = new JSDOM(`<!doctype html><html><head><style>${css}</style></head>
  <body><aside class="lp-ad"><div class="lp-ad__body">
    <div class="lp-ad__logo">${logoText}</div>
    <div class="lp-ad__text"><div class="lp-ad__brand">${brandM ? brandM[1] : ''}</div></div>
  </div></aside></body></html>`,
  { pretendToBeVisual: true });
const doc = dom.window.document;

// jsdom 不做真实排版，无法测出实际折行；
// 这里改为断言「CSS 规则本身不存在会让它折行的声明」：
// 没有固定宽度小于内容、没有 white-space:normal 覆盖。
const logoEl = doc.querySelector('.lp-ad__logo');
check('渲染出了 logo 元素', !!logoEl);
check('logo 元素文本是「雙休購」', logoEl && logoEl.textContent === '雙休購');

const sheetText = Array.from(doc.styleSheets)
  .flatMap((s) => Array.from(s.cssRules).map((r) => r.cssText)).join('\n');
check('样式表里 logo 规则含 nowrap',
  /\.lp-ad__logo[^{]*\{[^}]*white-space:\s*nowrap/s.test(sheetText));
check('样式表里没有把 logo 的 nowrap 改回 normal',
  !/\.lp-ad__logo[^{]*\{[^}]*white-space:\s*normal/s.test(sheetText));

console.log('\n' + '='.repeat(52));
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
if (fail) console.log('失败项：\n  - ' + fails.join('\n  - '));
process.exit(fail ? 1 : 0);