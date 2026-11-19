// 广告位 LOGO 渲染验证。
//
// 起因（用户截图）：早期「良配」两字 LOGO 显示成竖排两行，用户原话
// 「我从未说过竖着写，你不觉得很别扭？」。根因是容器宽度与「2 字 × 字号」
// 正好相等（48px vs 2×24px），一点字距偏差就折行。
//
// 2026-11-18 起站长要求 LOGO 改用站内现成 assets/heytea.png（喜茶黑白标识），
// 不再画紫底白字。本测试改成钉死「图片真的被引用、等比不拉伸、白底看得清」，
// 同时保留 nowrap + 容器宽度断言 —— 图片加载失败会回退文字「良配」，
// 那条老坑不能因为换了图片就复活。
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

console.log('=== 广告位 LOGO 验证（喜茶图 + 文字兜底）===\n');

const css = read('liangpei-ad.css');
const js = read('liangpei-ad.js');
const html = read('index.html');

// ---------- 1. 站内现成 LOGO 真的被引用 ----------
console.log('--- LOGO 引用 ---');
const logoM = /logoSrc:\s*'([^']*)'/.exec(js);
check('JS 里能读到 logoSrc', !!logoM, logoM && logoM[1]);
check('LOGO 指向站内现成 assets/heytea.png',
  logoM && logoM[1] === './assets/heytea.png', logoM && logoM[1]);
check('assets/heytea.png 文件真实存在',
  fs.existsSync(path.join(ROOT, 'assets/heytea.png')));
check('DOM 用 logoHtml() 渲染图片（不是写死文字）',
  /'<div class="lp-ad__logo"[^>]*>' \+ logoHtml\(\)/.test(js));
check('图片带 onerror 文字兜底，离线不开天窗',
  /onerror=/.test(js) && /is-fallback/.test(js) && /LOGO_TEXT/.test(js));
// 剥注释判断活跃引用
const htmlNoComments = html.replace(/<!--[\s\S]*?-->/g, '');
check('index.html 活跃引用良配 CSS（恢复上线，非注释）',
  /<link[^>]*liangpei-ad\.css\?v=17[^>]*>/i.test(htmlNoComments));
check('index.html 活跃引用良配 JS（恢复上线，非注释）',
  /<script[^>]*liangpei-ad\.js\?v=16[^>]*>/i.test(htmlNoComments));

// ---------- 2. 图片等比、白底 ----------
console.log('\n--- 图片样式 ---');
const imgIdx = css.indexOf('.lp-ad__logo__img {');
check('找得到 .lp-ad__logo__img 样式', imgIdx > 0);
const imgBlock = imgIdx > 0 ? css.slice(imgIdx, css.indexOf('}', imgIdx) + 1) : '';
check('图片 object-fit: contain（不拉伸变形）', /object-fit:\s*contain/.test(imgBlock));
check('图片宽高填满容器', /width:\s*100%/.test(imgBlock) && /height:\s*100%/.test(imgBlock));
const logoIdx = css.indexOf('.lp-ad__logo {');
const logoBlock = logoIdx > 0 ? css.slice(logoIdx, css.indexOf('}', logoIdx) + 1) : '';
check('LOGO 容器白底（喜茶是黑白标识，紫底会吃掉图）',
  /background:\s*#fff\b/.test(logoBlock), logoBlock.replace(/\s+/g, ' ').slice(0, 140));
const fbIdx = css.indexOf('.lp-ad__logo.is-fallback {');
check('保留 .lp-ad__logo.is-fallback 文字兜底段', fbIdx > 0);
const fbBlock = fbIdx > 0 ? css.slice(fbIdx, css.indexOf('}', fbIdx) + 1) : '';
check('兜底段恢复紫底白字', /background:\s*linear-gradient/.test(fbBlock) && /color:\s*#fff/.test(fbBlock));

// ---------- 3. 文字兜底仍不许竖排（老坑防复活）----------
console.log('\n--- 通用段与断点（文字兜底）---');
check('通用段设了 white-space: nowrap', /white-space:\s*nowrap/.test(logoBlock));
const logoTextM = /var LOGO_TEXT = '([^']*)'/.exec(js);
const logoText = logoTextM ? logoTextM[1] : '';
const charCount = logoText.length;
check('兜底文字是「良配」两个字', logoText === '良配', logoText);

function parseBlock(cssText, selector, from = 0) {
  const i = cssText.indexOf(selector, from);
  if (i === -1) return null;
  return cssText.slice(i, cssText.indexOf('}', i) + 1);
}
const blocks = [
  ['≥1440px 右侧竖排卡片', parseBlock(css, '.lp-ad__logo {', css.indexOf('@media (min-width: 1440px)'))],
  ['<1440px 底部吸底条', parseBlock(css, '.lp-ad__logo {', css.indexOf('@media (max-width: 1439px)'))],
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
  check(`${label}：容器(${width}px) 比兜底 2 字所需(${needed}px) 至少宽 8px`,
    slack >= 8, { width, fontSize, needed, slack });
  check(`${label}：本段也设了 nowrap（兜底）`, /white-space:\s*nowrap/.test(block));
}

// ---------- 4. jsdom 真渲染 ----------
console.log('\n--- 浏览器实测 ---');
const imgSrc = logoM ? logoM[1] : '';
const dom = new JSDOM(`<!doctype html><html><head><style>${css}</style></head>
  <body><aside class="lp-ad"><div class="lp-ad__body">
    <div class="lp-ad__logo" aria-hidden="true"><img class="lp-ad__logo__img" src="${imgSrc}" alt="喜茶"></div>
    <div class="lp-ad__text"><div class="lp-ad__brand">良配 - AI婚恋</div></div>
  </div></aside></body></html>`,
  { pretendToBeVisual: true });
const doc = dom.window.document;
const logoEl = doc.querySelector('.lp-ad__logo');
check('渲染出了 logo 容器', !!logoEl);
const imgEl = doc.querySelector('.lp-ad__logo__img');
check('渲染出了喜茶 logo 图片', !!imgEl);
check('图片 src 与 JS 配置一致', imgEl && imgEl.getAttribute('src') === imgSrc);
const sheetText = Array.from(doc.styleSheets)
  .flatMap((s) => Array.from(s.cssRules).map((r) => r.cssText)).join('\n');
check('样式表里图片规则含 object-fit:contain',
  /\.lp-ad__logo__img[^{]*\{[^}]*object-fit:\s*contain/s.test(sheetText));
check('样式表里兜底文字规则含 nowrap',
  /\.lp-ad__logo[^{]*\{[^}]*white-space:\s*nowrap/s.test(sheetText));
check('样式表里没有把兜底文字 nowrap 改回 normal',
  !/\.lp-ad__logo[^{]*\{[^}]*white-space:\s*normal/s.test(sheetText));

console.log('\n' + '='.repeat(52));
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
if (fail) console.log('失败项：\n  - ' + fails.join('\n  - '));
process.exit(fail ? 1 : 0);
