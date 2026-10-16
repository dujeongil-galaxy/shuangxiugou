// verify.mjs 自身的一致性检查：check() 参数顺序、节号连续性
//
// 为什么需要：2026-10-17 一天内两次把 check(cond, msg) 写成 check(msg, cond)。
// 症状很隐蔽 —— 输出里出现「✓ true」：标签被当成条件、表达式被当成标签打印，
// 检查**照样通过**，只是标签显示成 true。人工看输出很容易忽略，
// 但一旦写反，msg 变成条件，真实条件反而落到 detail 位，
// 出现了「永远显示某个值」的假绿灯。
//
// 本脚本把这些坑固化成可执行断言。
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const V = path.join(ROOT, 'scripts', 'verify.mjs');
const src = fs.readFileSync(V, 'utf8');

let pass = 0, fail = 0;
const fails = [];
const check = (l, c, x) => {
  if (c) { pass++; console.log('  ✓', l); }
  else { fail++; fails.push(l); console.log('  ✗', l, x !== undefined ? JSON.stringify(x) : ''); }
};

console.log('=== verify.mjs 自身一致性 ===\n');

// ---------- 1. check() 参数顺序 ----------
// 不用正则（会灾难回溯），手工扫描 check( 后的第一个非空白字符。
console.log('--- check() 参数顺序 ---');
const reversed = [];
let from = 0;
while (true) {
  const i = src.indexOf('check(', from);
  if (i === -1) break;
  // 跳过函数定义本身 function check(cond, msg, detail)
  const lineStart = src.lastIndexOf('\n', i) + 1;
  const lineHead = src.slice(lineStart, i).trim();
  let j = i + 6;
  while (j < src.length && /\s/.test(src[j])) j++;
  const c = src[j];
  if ((c === "'" || c === '"' || c === '`') && !/function$/.test(lineHead)) {
    reversed.push({ line: src.slice(0, i).split('\n').length,
      text: src.slice(i, i + 76).replace(/\n/g, ' ') });
  }
  from = i + 6;
}
check('没有把 check(msg, cond) 写成反序', reversed.length === 0, reversed);

// ---------- 2. check 签名本身必须对 ----------
console.log('\n--- check 定义 ---');
const defM = /function check\(\s*(\w+)\s*,\s*(\w+)\s*,\s*(\w+)\s*\)/.exec(src);
check('找得到 check 函数定义', !!defM);
if (defM) {
  check('第一个参数是条件（cond）', defM[1] === 'cond',
    `实际签名: check(${defM[1]}, ${defM[2]}, ${defM[3]})`);
}

// ---------- 3. 节号连续，不得跳号 ----------
console.log('\n--- 节号连续性 ---');
const secs = [...src.matchAll(/section\('([\d]+\.?[a-z]?)\.([^']*)'\)/g)]
  .map((m) => ({ id: m[1], name: m[2], line: src.slice(0, m.index).split('\n').length }));
console.log(`  共${secs.length} 节`);

// 主节号（第 20 节之后是20b/20c/20d 这样的子节）
const mainIds = secs.map((s) => s.id);
const dup = mainIds.filter((v, i) => mainIds.indexOf(v) !== i);
check('节号无重复', dup.length === 0, [...new Set(dup)]);

const tail = mainIds.filter((x) => /^\d+$/.test(x)).map(Number);
const tailSet = [...new Set(tail)].sort((a, b) => a - b);
const gaps = [];
for (let i = 1; i < tailSet.length; i++) {
  if (tailSet[i] !== tailSet[i - 1] + 1) gaps.push(`${tailSet[i - 1]} → ${tailSet[i]}`);
}
check('主节号连续无跳号', gaps.length === 0, gaps);

// ---------- 4. 不得有「✓ true」这类症状代码 ----------
console.log('\n--- 症状代码 ---');
// 反序的 check 会让输出变成 true/false 而不是中文标签。
// 这里查是否存在「标签参数是布尔字面量」的明显错误写法。
const boolFirst = [];
let f2 = 0;
while (true) {
  const i = src.indexOf('check(', f2);
  if (i === -1) break;
  let j = i + 6;
  while (j < src.length && /\s/.test(src[j])) j++;
  if (src[j] === 't' && src.slice(j, j + 4) === 'true') {
    boolFirst.push({ line: src.slice(0, i).split('\n').length,
      text: src.slice(i, i + 70).replace(/\n/g, ' ') });
  }
  f2 = i + 6;
}
check('没有 check(true, ...) 这种把条件写死的假绿灯', boolFirst.length === 0, boolFirst);

console.log('\n' + '='.repeat(52));
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
if (fail) console.log('失败项：\n  - ' + fails.join('\n  - '));
process.exit(fail ? 1 : 0);