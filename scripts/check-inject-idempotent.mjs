// 验证 insertAppleNote 的幂等性。
// 判据：连续调用时 DOM 结构性变动（insertBefore/removeChild）次数必须为 0，
// 否则 `new MutationObserver(init)` 会自激 → 无限循环 → 浏览器「页面没有响应」。
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const h = fs.readFileSync(ROOT + '/index.html', 'utf8');

// 函数体切分：从 `function insertAppleNote()` 头部开始做**花括号配对**。
//
// ⚠️ 不要改回「找下一个注释标记 / 下一个 function 关键字」的定位方式。
//    2026-10-22 在 insertAppleNote 后面新增了 insertStarbucksNote（平行实现），
//    「下一个 function 声明」式切分会把两个函数体粘在一起，
//    eval 时直接 SyntaxError（真实发生过：verify 报「insertAppleNote 幂等仿真」失败）。
//    花括号配对与函数插入顺序无关，且正确跳过字符串与注释里的花括号。
function extractFnBody(src, header) {
  const start = src.indexOf(header);
  if (start < 0) return null;
  let i = src.indexOf('{', start);
  if (i < 0) return null;
  let depth = 0;
  let str = null;        // 当前所处的字符串引号（' " `）
  let lineComment = false;
  let blockComment = false;
  for (; i < src.length; i++) {
    const c = src[i];
    const n = src[i + 1];
    if (lineComment) { if (c === '\n') lineComment = false; continue; }
    if (blockComment) { if (c === '*' && n === '/') { blockComment = false; i++; } continue; }
    if (str) { if (c === '\\') { i++; continue; } if (c === str) str = null; continue; }
    if (c === '/' && n === '/') { lineComment = true; i++; continue; }
    if (c === '/' && n === '*') { blockComment = true; i++; continue; }
    if (c === "'" || c === '"' || c === '`') { str = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return null;
}

const fnSrc = extractFnBody(h, 'function insertAppleNote()');
if (!fnSrc || fnSrc.indexOf("'apple-note'") < 0) {
  console.error('✗ 在 index.html 里找不到 function insertAppleNote() 的完整函数体');
  process.exit(1);
}

let mutations = 0;

function mkNode(tag, cls, text) {
  return {
    tagName: tag,
    className: cls || '',
    textContent: text || '',
    style: {},
    children: [],
    parentNode: null,
    get innerHTML() { return this._h || ''; },
    set innerHTML(v) { this._h = v; mutations++; },
    querySelector(sel) { return queryIn(this, sel); },
    get nextSibling() {
      if (!this.parentNode) return null;
      const i = this.parentNode.children.indexOf(this);
      return this.parentNode.children[i + 1] || null;
    },
    get previousSibling() {
      if (!this.parentNode) return null;
      const i = this.parentNode.children.indexOf(this);
      return i > 0 ? this.parentNode.children[i - 1] : null;
    },
    insertBefore(node, ref) {
      if (node.parentNode) node.parentNode.removeChild(node);
      let i = this.children.length;
      if (ref) {
        const r = this.children.indexOf(ref);
        if (r >= 0) i = r;
      }
      this.children.splice(i, 0, node);
      node.parentNode = this;
      mutations++;
    },
    removeChild(node) {
      const i = this.children.indexOf(node);
      if (i >= 0) this.children.splice(i, 1);
      node.parentNode = null;
      mutations++;
    },
  };
}

function queryIn(root, sel) {
  // 支持两种选择器：类选择（.flex-wrap）与标签选择（h2,h3，标题精确匹配用）
  const tags = sel.indexOf(',') >= 0 ? sel.split(',') : [];
  const cls = sel.replace(/^\./, '');
  const walk = (n) => {
    for (const c of n.children) {
      if (tags.length && tags.includes(c.tagName)) return c;
      if ((c.className || '').split(' ').includes(cls)) return c;
      const r = walk(c);
      if (r) return r;
    }
    return null;
  };
  return walk(root);
}

const root = mkNode('div', 'root');
const appleCard = mkNode('div', 'bg-white rounded-2xl border', 'Apple (苹果中国) iPhone MacBook');
// 标题元素：insertAppleNote 按「卡片标题」识别品牌（2026-10-18 起，
// 不再全文子串匹配——华为卡替代推荐区含 Apple 文本会误判）
const appleTitle = mkNode('h3', '', 'Apple (苹果中国)');
appleTitle.parentNode = appleCard;
appleCard.children.push(appleTitle);
const tagsRow = mkNode('div', 'flex-wrap');
tagsRow.parentNode = appleCard;
appleCard.children.push(tagsRow);
root.children.push(appleCard);

let visibleCards = [appleCard];

const doc = {
  _byId: {},
  getElementById(id) { return doc._byId[id] || null; },
  querySelector(sel) { return sel === '#apple-note' ? (doc._byId['apple-note'] || null) : null; },
  querySelectorAll() { return visibleCards; },
  createElement(tag) {
    const n = mkNode(tag, '');
    Object.defineProperty(n, 'id', {
      set(v) { doc._byId[v] = n; },
      get() { return ''; },
    });
    return n;
  },
};

globalThis.document = doc;
globalThis.diagWarn = () => {};
const insertAppleNote = eval('(' + fnSrc.replace(/^function insertAppleNote/, 'function') + ')');

let pass = true;
const report = (label, actual, expect) => {
  const ok = actual === expect;
  if (!ok) pass = false;
  console.log(`${ok ? '✓' : '✗'} ${label}: ${actual}（期望 ${expect}）`);
};

insertAppleNote();
report('首次调用 DOM 变动', mutations, 2);
console.log(`  apple-note 已创建: ${!!doc._byId['apple-note']}`);

mutations = 0;
for (let i = 0; i < 100; i++) insertAppleNote();
report('随后 100 次调用 DOM 变动', mutations, 0);

mutations = 0;
visibleCards = [];
insertAppleNote();
report('苹果卡消失后 DOM 变动', mutations, 1);
const n0 = doc._byId['apple-note'];
console.log(`  apple-note 已摘除: ${!n0 || !n0.parentNode}`);

mutations = 0;
for (let i = 0; i < 100; i++) insertAppleNote();
report('无苹果卡时再调 100 次', mutations, 0);

mutations = 0;
visibleCards = [appleCard];
insertAppleNote();
report('苹果卡回来后 DOM 变动', mutations, 1);

mutations = 0;
for (let i = 0; i < 100; i++) insertAppleNote();
report('恢复后再调 100 次', mutations, 0);

console.log(pass ? '\n全部通过：函数幂等，不会自激' : '\n存在自激风险');
process.exit(pass ? 0 : 1);