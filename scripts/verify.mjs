/**
 * 双休购 · [中文内容已移除] Node.js）
 *
 * [中文内容已移除]
 *   本站是「React 渲染后抓 DOM [中文内容已移除]
 *   [中文内容已移除]
 *   （内置卡在压缩 bundle、自定义卡在 index.html[中文内容已移除]
 *   [中文内容已移除]
 *
 * 用法：
 *   node scripts/verify.mjs            [中文内容已移除] exit 1
 *   node scripts/verify.mjs --quiet    只输出问题
 *
 * 建议接入 CI 或本地 pre-commit[中文内容已移除]
 */

import { readFileSync, existsSync, writeFileSync, unlinkSync, readdirSync } from 'node:fs';
import { execSync, execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const QUIET = process.argv.includes('--quiet');

// ---------- 基础设施 ----------
let passCount = 0;
const errors = [];
const warns = [];
const notes = [];

function ok(msg) { passCount++; if (!QUIET) console.log(`  \x1b[32m✓\x1b[0m ${msg}`); }
function err(msg, detail) { errors.push({ msg, detail }); console.log(`  \x1b[31m✗\x1b[0m ${msg}`); if (detail) console.log(`      ${detail}`); }
function warn(msg, detail) { warns.push({ msg, detail }); console.log(`  \x1b[33m!\x1b[0m ${msg}`); if (detail) console.log(`      ${detail}`); }
function note(msg) { notes.push(msg); console.log(`  \x1b[90m·\x1b[0m ${msg}`); }
function section(title) { if (!QUIET) console.log(`\n\x1b[1m${title}\x1b[0m`); }

/**
 * [中文内容已移除] LF。
 *
 * [中文内容已移除] git 的 autocrlf [中文内容已移除] CRLF，
 * [中文内容已移除] LF 写死。CRLF 下这些正则会**静默匹配失败**
 * —— [中文内容已移除] 0 [中文内容已移除]
 *
 * [中文内容已移除] LF [中文内容已移除]
 */
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const exists = (p) => existsSync(join(ROOT, p));

/** [中文内容已移除] query/hash，并尝试 assets/ 前缀） */
function localExists(ref) {
  const p = ref.split('?')[0].split('#')[0];
  if (!p) return true; // 纯锚点或空
  const cands = [p, p.replace(/^\.\//, ''), p.replace(/^\//, ''), join('assets', p.replace(/^\.\//, ''))];
  return cands.some((c) => existsSync(join(ROOT, c)));
}

function check(cond, msg, detail) { cond ? ok(msg) : err(msg, detail); }

/**
 * 剥掉 CSS [中文内容已移除]
 *
 * ⚠️ [中文内容已移除]
 *   本项目的 CSS 里大量使用注释**[中文内容已移除]**，
 *   例如 13b-5 [中文内容已移除] flex: 1 1 100%」、
 *   13b-6 里写着「translateY(-50%) [中文内容已移除]
 *   [中文内容已移除] → [中文内容已移除]
 *
 *   凡是要在 CSS [中文内容已移除]
 */
function stripCssComments(css) {
  return String(css).replace(/\/\*[\s\S]*?\*\//g, '');
}

// ---------- 路径常量 ----------
const INDEX_HTML = 'index.html';
const BUNDLE = 'assets/index-YthXZ9eP.js';
const NON_DEPLOY_COPY = 'index-YthXZ9eP.js';

const html = read(INDEX_HTML);
const bundle = read(BUNDLE);

// ============1. 内置卡数据解析 ============
section('1. 内置卡数据（assets/index-YthXZ9eP.js）');

/**
 * [中文内容已移除]{id:`xxx`,name:`xxx`,companyName:...
 * 踩过的坑：用 /\{id:`xxx`/ 会把 evidence(ev-)、comment(cm-)、
 * vote(post-/rep-) [中文内容已移除] 125 张（真实 32 张）。
 * 必须用「紧跟 name + companyName」作边界。
 */
const brandRe = /\{id:`([a-z0-9-]+)`,name:`([^`]+)`,companyName:/g;
const brandCards = [];
let m;
while ((m = brandRe.exec(bundle)) !== null) {
  brandCards.push({ id: m[1], name: m[2], pos: m.index });
}
const BUILTIN_COUNT = brandCards.length;

// [中文内容已移除]
const FICTIONAL = brandCards.filter((c) => c.name.includes('虚拟对比黑榜'));

check(BUILTIN_COUNT > 0, `解析到${BUILTIN_COUNT} 张内置卡`);
if (BUILTIN_COUNT !== 32) {
  warn(`内置卡数量为 ${BUILTIN_COUNT}，文档口径按32 张写`, '[中文内容已移除] README / FORK_GUIDE / MAINTAINING / 核实清单 / noscript 五处');
}

// 关键卡必须在场
['heytea', 'starbucks-coffee', 'luckin', 'haier', 'ikea'].forEach((id) => {
  check(brandCards.some((c) => c.id === id), `[中文内容已移除]${id}`);
});

// ---------- 数值字段核对：null 规则 ----------
section('2. null 规则（null ≠ 0）');

// [中文内容已移除] null 或明确的 '—'，不能是 0
brandCards.forEach((c, i) => {
  const end = i + 1 < brandCards.length ? brandCards[i + 1].pos : bundle.length;
  const chunk = bundle.slice(c.pos, end);
  const rate = chunk.match(/realDoubleWeekendRate:([^,}]+)/)?.[1]?.trim();
  const off = chunk.match(/avgOffWorkTime:`?([^,`}]+)/)?.[1]?.trim();
  // 0 [中文内容已移除] 0[中文内容已移除]
  if (rate === '0') err(`${c.name} 的 realDoubleWeekendRate 是 0`, '未核实应填 null[中文内容已移除]0 [中文内容已移除]');
  if (off === '0') err(`${c.name} 的 avgOffWorkTime 是 0`, '未核实应填 null');
});
ok('[中文内容已移除] 0');

// ---------- 2b. 证据链完整性 ----------
section('2b. 证据链完整性');

/**
 * 占位符 URL 检查。
 * [中文内容已移除] ESG[中文内容已移除]
 * 占位链接 `ARTIxxxxxxxx.shtml`[中文内容已移除]
 * [中文内容已移除] —— 必须拦住。
 */
const PLACEHOLDER_PAT = /(xxx+|XXXX+|ARTIxxxxxxxx|example\.com|\.\.\.|待补|TODO)/i;
const evRe = /\{id:`(ev-[a-z0-9-]+)`,date:`([0-9-]+)`,type:`([a-z_]+)`,title:`([^`]*)`/g;
let evCount = 0;
let evBad = 0;
let evm;
const todayStr = new Date().toISOString().slice(0, 10);
while ((evm = evRe.exec(bundle)) !== null) {
  const [, evId, evDate, , evTitle] = evm;
  const chunk = bundle.slice(evm.index, evm.index + 2000);
  const u = chunk.match(/sourceUrl:`([^`]*)`/)?.[1] ?? '';
  if (!u) continue;
  evCount++;
  if (PLACEHOLDER_PAT.test(u)) {
    evBad++;
    err(`证据 ${evId}（${evDate}，${evTitle}）的 URL 是占位符`,
      `URL: ${u} —— [中文内容已移除]`);
  }
  if (evDate > todayStr) {
    evBad++;
    err(`证据 ${evId} 的日期 ${evDate} 晚于今天`, '可能是笔误');
  }
}
if (evBad === 0) ok(`${evCount} 条证据的 URL [中文内容已移除]`);

// [中文内容已移除] 1 年的招聘页/[中文内容已移除]
const evDates = [...new Set([...bundle.matchAll(/date:`(\d{4}-\d{2}-\d{2})`/g)].map((x) => x[1]))].sort();
if (evDates.length) {
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 1);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const stale = evDates.filter((d) => d < cutoffStr);
  if (stale.length) {
    note(`证据日期跨度 ${evDates[0]} ~ ${evDates[evDates.length - 1]}，其中 ${stale.length} 个早于 ${cutoffStr}[中文内容已移除]`);
  }
}

// ---------- 2c. bundle 语法完整性 ----------
section('2c. bundle 语法完整性');

/**
 * 用 `node --check` 校验压缩 bundle 的语法。
 *
 * ## [中文内容已移除]
 * 手工编辑压缩 bundle 时，多打一个 `[{`[中文内容已移除] bundle
 * 语法崩溃 → **[中文内容已移除]**。
 * [中文内容已移除]`evidence:[{[{id:` 多了一个 `[{`，
 * 是靠「与 git 原版做 node --check [中文内容已移除]
 *
 * ## 为什么用 git 原版做对照
 * React/JSX bundle 可能因 import.meta 等原因在node --check 下误报。
 * 所以只有「git 里的原版通过 + [中文内容已移除]
 *
 * ## 已知局限：Windows 本地可能跑不了
 * Windows 上 spawnSync 稳定返回 EBUSY（status=null），
 * [中文内容已移除]
 * **权威判定在 CI（Linux）上**[中文内容已移除]
 * [中文内容已移除]
 *
 * 返回三态：'ok' | 'bad' | 'skip'（skip = [中文内容已移除]
 */
function nodeSyntaxCheck(text) {
  const tmp = join(tmpdir(), `bundle-check-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`);
  try {
    writeFileSync(tmp, text, 'utf8');
    const r = spawnSync(process.execPath, ['--check', tmp], { encoding: 'utf8', timeout: 60000 });
    if (r.error || r.status === null) return 'skip';
    return r.status === 0 ? 'ok' : 'bad';
  } catch {
    return 'skip';
  } finally {
    try { unlinkSync(tmp); } catch { /* 忽略 */ }
  }
}

const curCheck = nodeSyntaxCheck(bundle);
if (curCheck === 'ok') {
  ok('bundle 通过 node --check 语法校验');
} else if (curCheck === 'skip') {
  // 本地（尤其是 Windows）跑不了 node --check —— [中文内容已移除]
  note('[中文内容已移除] node --check（Windows 上spawn 偶发 EBUSY）');
  note('bundle [中文内容已移除] CI（Linux[中文内容已移除]');
} else {
  // curCheck === 'bad'：与 git [中文内容已移除]
  //
  // ⚠️ Windows [中文内容已移除] execSync 再 spawnSync（EBUSY），
  // 必须先让 git [中文内容已移除]
  let baseCheck = 'skip';
  const basePath = join(tmpdir(), `bundle-base-${process.pid}-${Math.random().toString(36).slice(2)}.js`);
  try {
    execSync(`git show HEAD:${BUNDLE} > "${basePath}"`, { cwd: ROOT, stdio: 'ignore' });
    baseCheck = nodeSyntaxCheck(readFileSync(basePath, 'utf8'));
  } catch {
    baseCheck = 'skip';
  } finally {
    try { unlinkSync(basePath); } catch { /* 忽略 */ }
  }

  if (baseCheck === 'ok') {
    err('bundle 存在语法错误（git 原版正常 → [中文内容已移除]',
      '手工编辑压缩 bundle [中文内容已移除]' +
      '这类错误会让 React 整个挂不上，**[中文内容已移除]**。' +
      '请对照 git [中文内容已移除]git diff --word-diff assets/index-YthXZ9eP.js');
  } else if (baseCheck === 'bad') {
    warn('bundle 未通过 node --check，但 git 原版同样不通过',
      '大概率是 React/JSX bundle 的既有误报（如 import.meta[中文内容已移除]' +
      '若你确实改了 bundle[中文内容已移除]');
  } else {
    warn('bundle [中文内容已移除] git 原版做对照',
      '[中文内容已移除]');
  }
}

// ---------- 自定义卡解析 ----------
section('3. 自定义卡（index.html 的 customCardsConfig）');

const cfgBlock = html.match(/var customCardsConfig = \[([\s\S]*?)\n      \];/);
check(!!cfgBlock, '能解析 customCardsConfig 数组');

/**
 * [中文内容已移除]
 * 早先写成 `id:'x'[\s\S]{0,900}?doubleRestRate:\s*0[,}]` 有两个问题：
 *   1. `\s*0` 匹配不到`'0'`[中文内容已移除]
 *   2. 900 [中文内容已移除]/漏报都可能出现
 */
const customCards = [];
if (cfgBlock) {
  const body = cfgBlock[1];
  const itemRe = /\{\s*id:\s*'([^']+)',([\s\S]*?)\n\s*\},?\n/g;  // read() 已归一化为 LF
  let m2;
  while ((m2 = itemRe.exec(body)) !== null) {
    const [, id, chunk] = m2;
    const name = chunk.match(/name:\s*'([^']+)'/)?.[1] ?? id;
    const rate = chunk.match(/doubleRestRate:\s*([^,\n]+)/)?.[1]?.trim() ?? '(缺失)';
    const off = chunk.match(/offWorkTime:\s*([^,\n]+)/)?.[1]?.trim() ?? '(缺失)';
    const insertAfter = chunk.match(/insertAfter:\s*'([^']+)'/)?.[1] ?? '(缺失)';
    const logo = chunk.match(/logo:\s*'([^']+)'/)?.[1] ?? '';
    customCards.push({ id, name, rate, off, insertAfter, logo });
  }
}
const CUSTOM_COUNT = customCards.length;
check(CUSTOM_COUNT === 5, `自定义卡 ${CUSTOM_COUNT} 张（期望 5）`);

// null 规则：双休率 / [中文内容已移除] 0[中文内容已移除] '未知'
customCards.forEach((c) => {
  check(c.rate !== '0' && c.rate !== "'0'",
    `自定义卡「${c.name}[中文内容已移除] 0（当前 ${c.rate}）`,
    c.rate === '0' || c.rate === "'0'" ? '未核实应填 null[中文内容已移除]' : '');
  check(c.off !== "'未知'",
    `自定义卡「${c.name}[中文内容已移除] ${c.off}）`,
    c.off === "'未知'" ? '应改为 null，由 statText() 渲染成「—」' : '');
  check(c.insertAfter !== '(缺失)', `自定义卡「${c.name}」配置了 insertAfter`);
  check(!!c.logo && localExists(c.logo.replace(/^\.\//, '')),
    `自定义卡「${c.name}」logo 路径有效：${c.logo}`);
});

// ---------- 4. logo 与资源路径 ----------
section('4. 资源引用（404 前置检查）');

// 4.1 四个 HTML 页面的 src / href / url()
for (const page of ['index.html', 'sponsor.html', 'projects.html', '404.html']) {
  if (!exists(page)) { err(`${page} 不存在`); continue; }
  const h = read(page);
  const refs = new Set();
  for (const r of h.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/g)) refs.add(r[1]);
  for (const r of h.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) refs.add(r[1]);
  const missing = [...refs].filter((r) => !/^(https?:)?\/\/|^data:|^mailto:|^tel:|^#/.test(r)).filter((r) => !localExists(r));
  check(missing.length === 0, `${page} [中文内容已移除]${refs.size} 个引用）`,
    missing.length ? `缺失：${missing.join(', ')}` : '');
}

// 4.2 brandLogos 映射表
section('5. 品牌 logo 映射表');
const logoBlock = html.match(/var brandLogos = \{([\s\S]*?)\n      \};/);
check(!!logoBlock, '能解析 brandLogos');
if (logoBlock) {
  const pairs = [...logoBlock[1].matchAll(/'([^']+)':\s*'([^']+)'/g)].map((x) => [x[1], x[2]]);
  const bad = pairs.filter(([, p]) => !localExists(p));
  check(bad.length === 0, `${pairs.length} 条 logo 路径全部存在`, bad.map((b) => b.join('→')).join('; '));

  // 未配图 logo 的卡会走 onerror 文字降级，不算404，但要报出来
  const mapped = new Set(pairs.map(([k]) => k));
  const noLogo = brandCards.filter((c) => {
    const end = brandCards.indexOf(c) + 1 < brandCards.length ? brandCards[brandCards.indexOf(c) + 1].pos : bundle.length;
    const chunk = bundle.slice(c.pos, end);
    const short = chunk.match(/logoText:`([^`]*)`/)?.[1];
    return short && !mapped.has(short);
  });
  if (noLogo.length) note(`${noLogo.length} 张内置卡无图片 logo，走文字降级：${noLogo.map((c) => c.name).join('、')}`);
}

// 4.3 自定义卡 logo
for (const m of html.matchAll(/logo:\s*'\.\/([^']+)'/g)) {
  check(localExists(m[1]), `自定义卡 logo 存在：${m[1]}`);
}

// ---------- 6. noscript SEO 兜底清单 ----------
section('6. noscript SEO 兜底清单');
const ns = html.match(/<noscript>([\s\S]*?)<\/noscript>/);
check(!!ns, '存在 noscript 兜底正文');
if (ns) {
  const items = [...ns[1].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)]
    .map((x) => x[1].replace(/<[^>]+>/g, '').trim())
    .filter(Boolean);
  const grades = items.filter((t) => /^[SABC]\s*级/.test(t));
  const brands = items.filter((t) => !/^[SABC]\s*级/.test(t));
  check(grades.length > 0 && brands.length > 0, `noscript 含 ${grades.length} 条评级说明 + ${brands.length} 项品牌`);

  // [中文内容已移除] noscript 里
  const missingInNoscript = brandCards
    .filter((c) => !FICTIONAL.some((f) => f.id === c.id))
    .filter((c) => {
      // [中文内容已移除]
      const key = c.name.split('(')[0].trim().slice(0, 4);
      return !brands.some((b) => b.includes(key));
    });
  check(missingInNoscript.length === 0,
    `${BUILTIN_COUNT - FICTIONAL.length} [中文内容已移除] noscript 清单中`,
    missingInNoscript.length ? `漏了：${missingInNoscript.map((c) => c.name).join('、')}—— [中文内容已移除]` : '');

  // 自定义卡也应在
  const missingCustom = customCards.filter((c) => !brands.some((b) => b.includes(c.name.split('/')[0].slice(0, 3))));
  check(missingCustom.length === 0, `${CUSTOM_COUNT} [中文内容已移除] noscript 清单中`,
    missingCustom.length ? `漏了：${missingCustom.map((c) => c.name).join('、')}` : '');
}

// ---------- 7. 文档数字口径 ----------
section('7. [中文内容已移除]');

/**
 * [中文内容已移除]
 *   1. 分档拆分：  「已核实 26 张、确认原值 2 张、未核实 3 张，合计 32 张内置卡」
 *   2. 历史记录：  「2026-10-04 那次的范围是 31 张内置卡」
 *   3. 局部口径：  「noscript 36 项 = 31 真实内置 + 5 自定义」
 * [中文内容已移除]
 */
const EXPECT = { builtin: BUILTIN_COUNT, custom: CUSTOM_COUNT, total: BUILTIN_COUNT + CUSTOM_COUNT };
const docs = ['README.md', 'FORK_GUIDE.md', 'MAINTAINING.md', '[中文内容已移除].md'].filter(exists);

/** [中文内容已移除]/历史/分档用法」 */
function isLegitimateNumber(line, num) {
  if (/20\d\d-\d\d-\d\d/.test(line)) return true;                       // 历史记录带日期
  if (/(已核实|确认原值|未核实)\s*\d+\s*张/.test(line)) return true;     // 分档拆分
  if (/(noscript|爬虫|项\s*=|真实内置)/i.test(line)) return true;        // noscript 局部口径
  if (/合计\s*3[27]\s*张|共\s*3[27]\s*张/.test(line)) return true;        // 正确合计
  return false;
}

docs.forEach((d) => {
  const t = read(d);
  const bad = [];
  for (const line of t.split('\n')) {
    for (const m of line.matchAll(/(\d+)\s*张(内置|自定义)/g)) {
      const n = +m[1];
      const kind = m[2];
      const expect = kind === '内置' ? EXPECT.builtin : EXPECT.custom;
      if (n !== expect && !isLegitimateNumber(line, n)) {
        bad.push(`「${line.trim().slice(0, 60)}…」应写 ${expect} 张${kind}，实际 ${n}`);
      }
    }
  }
  check(bad.length === 0,
    `${d} [中文内容已移除]${EXPECT.builtin} 内置 / ${EXPECT.custom} 自定义）`,
    bad.join('\n      '));
});

// ---------- 8. 文档链接有效性 ----------
section('8. 文档内部链接');
for (const d of docs) {
  const t = read(d);
  const links = [...t.matchAll(/\]\(([^)]+)\)/g)].map((x) => x[1])
    .filter((p) => !/^https?:|^#|^mailto:/.test(p));
  const bad = links.filter((p) => !existsSync(join(ROOT, p.split('#')[0])));
  check(bad.length === 0, `${d} 的 ${links.length} [中文内容已移除]`, bad.join(', '));
}

// ---------- 9. 提交号真实性 ----------
section('9. [中文内容已移除]');

/**
 * ⚠️ 浅克隆陷阱（CI 上真实踩过）：
 * GitHub Actions 的 actions/checkout 默认 `fetch-depth: 1`，仓库里只有
 * **最新 1 个提交**的对象。此时 `git cat-file -e <历史哈希>` 对所有历史提交
 * [中文内容已移除]
 * 在 CI [中文内容已移除]
 *
 * 判据：`git rev-list --count HEAD` [中文内容已移除]
 * [中文内容已移除]
 */
function shallowCloneLimit() {
  try {
    return parseInt(execSync('git rev-list --count HEAD', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(), 10);
  } catch {
    return Infinity; // 不是 git 仓库或命令失败 → 不设限
  }
}

const commitCount = shallowCloneLimit();
let hashTotal = 0;
let hashBad = 0;

if (!Number.isFinite(commitCount) || commitCount < 30) {
  // [中文内容已移除]
  note(`检出历史仅 ${commitCount} [中文内容已移除]`);
  note('[中文内容已移除]git clone --depth=full，或在 CI 中设 fetch-depth: 0');
} else {
  for (const d of docs) {
    const t = read(d);
    // [中文内容已移除] 7 位十六进制
    const hashes = [...new Set([...t.matchAll(/`([0-9a-f]{7})`/g)].map((x) => x[1]))];
    for (const h of hashes) {
      // [中文内容已移除] / 不可核验 / 编造 / 反例」的——
      // [中文内容已移除]
      const idx = t.indexOf('`' + h + '`');
      const ctx = t.slice(Math.max(0, idx - 120), idx + 120);
      if (/不存在|不可核验|编造|反例|无此提交/.test(ctx)) continue;
      hashTotal++;
      let valid = false;
      try { execSync(`git cat-file -e ${h}`, { cwd: ROOT, stdio: 'ignore' }); valid = true; } catch { valid = false; }
      if (!valid) { hashBad++; err(`${d} [中文内容已移除] ${h}`, '[中文内容已移除]'); }
    }
  }
  if (hashBad === 0) ok(`核验了 ${hashTotal} [中文内容已移除] ${commitCount} 个提交）`);
}

// ---------- 10. [中文内容已移除] ----------
section('10. [中文内容已移除]');

// 10.1 定位卡片必须 h2/h3 双查—— [中文内容已移除]
//   ✓ querySelector('h2') || querySelector('h3')   双查，正确
//   ✓ fixHeadingHierarchy 内部的 querySelector('h3')它是「找 h3 换成 h2」，
//     本来就该只找 h3，是正确用法
//   ✗ 其他任何孤立的 querySelector('h3')            会在 H2 修复后静默失效
const lines = html.split('\n');
const h3Violations = [];
lines.forEach((line, i) => {
  // [中文内容已移除]
  // 注意双查常写成 `card.querySelector('h2') || card.querySelector('h3')`，
  // [中文内容已移除] `card.` / `newCard.`[中文内容已移除]
  // 早先写成 `\|\|\s*querySelector` [中文内容已移除]
  const h2Before = /querySelector\(\s*['"]h2['"]\s*\)[\s\S]{0,24}\|\|[\s\S]{0,24}querySelector\(\s*['"]h3['"]\s*\)/.test(line);
  if (h2Before) return;
  if (!/querySelector\(\s*['"]h3['"]\s*\)/.test(line)) return;
  // 跳过 fixHeadingHierarchy 函数体内部
  const inFix = lines.slice(Math.max(0, i - 30), i).some((l) => l.includes('function fixHeadingHierarchy'));
  if (inFix) return;
  h3Violations.push(i + 1);
});
check(h3Violations.length === 0, '没有只查 h3 的定位点（须 h2/h3 双查）',
  h3Violations.length ? `第 ${h3Violations.join(', ')} 行` : '');

// 10.2 诊断日志已就位
check(html.includes('diagError') && html.includes('diagWarn'), '[中文内容已移除]');
check(html.indexOf('function diagWarn') < html.indexOf('function getGradeTemplateCard'),
  '[中文内容已移除]');

// 10.3 静默 catch 应已改为记录
const silentCatches = [...html.matchAll(/catch\s*\([^)]*\)\s*\{\s*\/\*[^}]*\*\/\s*\}/g)];
check(silentCatches.length === 0, '没有空catch[中文内容已移除]',
  silentCatches.length ? `第 ${silentCatches.map((x) => html.slice(0, x.index).split('\n').length).join(', ')} 行` : '');

// 10.4 null兜底函数存在
check(html.includes('statText'), '自定义卡 null 兜底函数 statText 存在');

// 10.5 [中文内容已移除]
const unguarded = [...html.matchAll(/\n\s*(infoRows\[\d\]|stats\[\d\]|newCard\.querySelector[^\n]*?)\.textContent\s*=/g)];
check(unguarded.length === 0, '[中文内容已移除]', unguarded.length ? unguarded.map((x) => x[1]).join('; ') : '');

// ---------- 11. 缓存版本号 ----------
section('11. bundle 缓存版本号');
const vMatch = [...html.matchAll(/index-YthXZ9eP\.js\?v=(\d+)/g)].map((x) => +x[1]);
check(vMatch.length > 0, `index.html 声明了 bundle 版本 ${vMatch[0]}`);
const allSame = vMatch.every((v) => v === vMatch[0]);
check(allSame, '所有 script/link 引用版本号一致', allSame ? '' : `出现多个版本：${[...new Set(vMatch)].join(', ')}`);

// ---------- 12. 换行符锁定 ----------
section('12. 换行符锁定（.gitattributes）');
const gaPath = '.gitattributes';
if (exists(gaPath)) {
  const ga = read(gaPath);
  // [中文内容已移除]*.mdtext [中文内容已移除] LF；
  // GitHub Actions 的 YAML 若被转成 CRLF [中文内容已移除]
  ['*.html', '*.md', '*.json', '*.xml', '*.mjs', '*.yml', '*.yaml'].forEach((pat) => {
    const re = new RegExp(pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s+text\\s+eol=lf');
    check(re.test(ga), `.gitattributes 锁定了 ${pat} 为 LF`);
  });
  // bundle [中文内容已移除]
  ['*.js', '*.css'].forEach((pat) => {
    const re = new RegExp(pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s+-text');
    check(re.test(ga), `.gitattributes 对 ${pat} 禁止换行符转换`);
  });
} else {
  err('.gitattributes 不存在', '缺它会导致 autocrlf 把 bundle 的 \\n 转成 \\r\\n[中文内容已移除]');
}

// ---------- 13. 面向 fork 者的文档完整性 ----------
section('13. 面向 fork 者的文档完整性');

// 这些是给二次 fork [中文内容已移除]
const FORK_DOCS = ['FORK_GUIDE.md', 'README.md', 'MAINTAINING.md'];
FORK_DOCS.filter(exists).forEach((d) => {
  const t = read(d);
  check(/npm run verify/.test(t),
    `${d} 提到了校验命令 npm run verify`,
    `${d} [中文内容已移除]fork [中文内容已移除]`);
});

// PITFALLS.md 2.4/2.5 记录了「issue 模板必须用 .md、不能用 .yml」这条约束。
// [中文内容已移除]
if (exists('PITFALLS.md')) {
  const pf = read('PITFALLS.md');
  check(/Issue 模板必须用\s*`?\.md`?/.test(pf),
    'PITFALLS.md 记有「issue 模板必须用 .md，不能用 .yml」',
    '这条约束丢了 → [中文内容已移除] .yml，New issue 选择框变空白页');
  check(/[中文内容已移除]/.test(pf),
    'PITFALLS.md [中文内容已移除]',
    '这条约束丢了 → [中文内容已移除] a- 前缀才能排第一');
}

// README 的「N [中文内容已移除] fork [中文内容已移除]
//
// [中文内容已移除] 5 [中文内容已移除]
// [中文内容已移除]
// [中文内容已移除]
if (exists('README.md')) {
  const rdm = read('README.md');
  const cntM = rdm.match(/###\s*([[中文内容已移除]]+)[中文内容已移除]/);
  check(!!cntM, 'README 有「N [中文内容已移除]',
    '找不到该章节 —— fork [中文内容已移除]');

  if (cntM) {
    const CN = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
    const declared = CN[cntM[1]];
    // [中文内容已移除] \n--- ，数有序列表项
    const secStart = rdm.indexOf(cntM[0]);
    const secEnd = rdm.indexOf('\n---', secStart);
    const sec = rdm.slice(secStart, secEnd > secStart ? secEnd : secStart + 6000);
    const actual = (sec.match(/^\d+\.\s+\*\*/gm) || []).length;

    check(declared === actual,
      `README 标题声明 ${declared} 条，实际列了 ${actual} 条`,
      `标题写「${cntM[1]}件」但实际有 ${actual} 条 —— [中文内容已移除]` +
      '[中文内容已移除]');

    // 新增的 DOM [中文内容已移除]
    check(/insertAppleNote/.test(sec),
      'README 踩坑清单包含「React 复用 DOM 节点」这条',
      '清单里找不到 insertAppleNote —— [中文内容已移除] fork 者');
  }
}

// notes.html [中文内容已移除]
//
// [中文内容已移除]
// 1. robots.txt 必须 Disallow —— [中文内容已移除]
// 2. sitemap.xml 里不能有它—— sitemap [中文内容已移除]
// 3. 页面自身必须带 noindex —— robots.txt [中文内容已移除]
//
// [中文内容已移除]
if (exists('notes.html')) {
  const nt = read('notes.html');

  // ① robots.txt屏蔽
  const rb = exists('robots.txt') ? read('robots.txt') : '';
  check(/^Disallow:\s*\/notes\.html$/m.test(rb),
    'robots.txt 屏蔽 notes.html',
    '未屏蔽 → [中文内容已移除]');

  // ② 不进 sitemap
  const sm = exists('sitemap.xml') ? read('sitemap.xml') : '';
  check(!/notes\.html/.test(sm),
    'sitemap.xml 不含 notes.html',
    '进了 sitemap [中文内容已移除] → 会被索引');

  // ③ 页面自身 noindex
  check(/name="robots"[^>]*noindex/i.test(nt),
    'notes.html 自带 noindex',
    '页面自身没有 noindex → robots.txt [中文内容已移除]');

  // ④ [中文内容已移除]
  const declIdx = nt.search(/不代表本站立场|不构成对任何|[中文内容已移除]/);
  const firstPara = nt.search(/<h1|<p>/);
  check(declIdx >= 0,
    'notes.html [中文内容已移除]',
    '没有声明 → [中文内容已移除]');
  check(declIdx >= 0 && firstPara >= 0 && declIdx < firstPara,
    'notes.html [中文内容已移除]',
    '[中文内容已移除] → [中文内容已移除]');

  // ⑤[中文内容已移除]
  //⚠️ [中文内容已移除] CSS/JS/[中文内容已移除]
  const bodyText = nt
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  const leaks = [
    [/19[89]\d\s*年\s*\d{1,2}\s*月/, '写了出生年月'],
    [/\b(19[89]\d|20[012]\d)\s*年\s*出生/, '写了出生年'],
    [/成都|重庆|绵阳|德阳|宜宾|泸州/, '写了具体城市'],
    [/\d{6,}/, '出现了疑似 QQ 号 / 手机号 / 群号'],
  ];
  for (const [re, why] of leaks) {
    check(!re.test(bodyText),
      `notes.html [中文内容已移除]${why}）`,
      `${why} —— [中文内容已移除]`);
  }

  // ⚠️ [中文内容已移除]
  //
  // [中文内容已移除]
  // [中文内容已移除] [中文内容已移除] / 群号 / 照片」
  // [中文内容已移除]
  // [中文内容已移除]**「我不放 X」等于告诉别人 X 可以定位。**
  const locatorWords = [
    [/名字.*群号.*照片/, '列出了「名字/群号/照片」定位清单'],
    [/网名/, '出现了「网名」'],
    [/群号/, '出现了「群号」'],
    [/截图里?的?照片/, '[中文内容已移除]'],
  ];
  for (const [re, why] of locatorWords) {
    check(!re.test(bodyText),
      `notes.html [中文内容已移除]${why}）`,
      `${why} —— [中文内容已移除]`
      + '[中文内容已移除]');
  }

  // ⑥ [中文内容已移除]
  //
  // ⚠️ [中文内容已移除] —— [中文内容已移除]
  //    [中文内容已移除] PITFALLS 3.1 记的坑。
  const dpRaw = exists('douyin-prompt.js') ? read('douyin-prompt.js') : '';
  const dp = dpRaw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  check(/站长随笔/.test(dp) && /notes\.html/.test(dp),
    '[中文内容已移除]',
    '入口缺失 → [中文内容已移除]');
  check(!/以后再说/.test(dp),
    '[中文内容已移除]',
    '[中文内容已移除]');

  // ⑧ notes.html [中文内容已移除]
  //
  // [中文内容已移除]
  // [中文内容已移除]
  // [中文内容已移除]
  // [中文内容已移除]
  //
  // 做法：从 bundle 的品牌数据里抽 name，取长度 ≥2 的，
  // [中文内容已移除] notes.html 里逐个找。
  const BUNDLE = 'assets/index-YthXZ9eP.js';
  if (exists('notes.html') && exists(BUNDLE)) {
    const bj = read(BUNDLE);
    const names = new Set();
    for (const m of bj.matchAll(/\bname:`([^`]{2,40})`/g)) {
      const full = m[1];
      // bundle [中文内容已移除] (中文)」格式：`BYD (比亚迪)`、`Apple (苹果中国)`。
      // ⚠️ [中文内容已移除]
      //    [中文内容已移除]BYD」也抓不到 —— [中文内容已移除]
      names.add(full);
      const cn = full.match(/\(([^)]{2,})\)/);
      if (cn) names.add(cn[1].trim());
      // [中文内容已移除]
      const head = full.replace(/\s*\([^)]*\)\s*$/, '').trim();
      if (head.length >= 2) names.add(head);
    }
    // [中文内容已移除]
    //  1) bundle 里所有 name [中文内容已移除]icon、tag [中文内容已移除]
    //  2) 过短的词（≤2 [中文内容已移除]
    const NOISE = /^(某|部分|tag$|icon$|badge|check|circle|chevron|clock|compass|copy|download|funnel|heart|lock|message|receipt|search|send|shield|shopping|sparkles|thumbs|triangle|user|building)/i;
    const suspects = [...names].filter((n) => {
      const s = n.trim();
      // ⚠️ [中文内容已移除]
      //    [中文内容已移除]
      //    用 `length < 3` [中文内容已移除] → [中文内容已移除]
      //    英文则要 ≥3，否则 'GE'、'HP' 这类会误报。
      const ascii = /^[\x20-\x7e]+$/.test(s);
      if (ascii && s.length < 3) return false;
      if (!ascii && s.length < 2) return false;
      if (NOISE.test(s)) return false;
      // [中文内容已移除] "Bee & Flower"[中文内容已移除]
      if (ascii && s.includes(' ')) return false;
      return true;
    });
  // ⚠️ 必须只扫**可见正文**。
  //    扫全文会命中 <style> 里的 `font-family: "Microsoft YaHei"` —— [中文内容已移除]
  //    [中文内容已移除]
  const ntVisible = nt
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<head[\s\S]*?<\/head>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '');
    // ⚠️ 中文品牌名**[中文内容已移除]/前后瞻**。
    //
    // [中文内容已移除] → 落在 \w 范围内，
    // [中文内容已移除]**全部漏报**。
    //
    // [中文内容已移除] includes。
    // [中文内容已移除]**ASCII 字母或数字**[中文内容已移除] BYDX），跳过；
    // [中文内容已移除]`BYD很有性价比` 里的 BYD 就是点名）。
    const isAscii = (s) => /^[\x20-\x7e]+$/.test(s);
    const hit = suspects.filter((n) => {
      const s = n.trim();
      if (isAscii(s)) {
        return new RegExp(`${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9])`).test(ntVisible);
      }
      return ntVisible.includes(s);
    });
    check(hit.length === 0,
      'notes.html 未点名收录企业',
      hit.length
        ? `出现品牌名：${hit.slice(0, 5).join('、')} —— [中文内容已移除]` +
          '[中文内容已移除]'
        : '');
  }

  // ⑩[中文内容已移除]
  //
  // [中文内容已移除]
  // [中文内容已移除]
  // **[中文内容已移除]**
  check(/[中文内容已移除]/.test(nt),
    'notes.html [中文内容已移除]',
    '这一节不见了 → [中文内容已移除]' +
    '[中文内容已移除]');
  check(/[中文内容已移除]/.test(nt),
    'notes.html [中文内容已移除]',
    '[中文内容已移除]');

  // ⑩b[中文内容已移除]
  //
  // 事实：让路的是**非机动车**[中文内容已移除]
  // [中文内容已移除]
  // [中文内容已移除]
  const jamStart = nt.indexOf('关于川西自驾游');
  check(jamStart > 0, 'notes.html [中文内容已移除]');
  if (jamStart > 0) {
    const jamEnd = nt.indexOf('<h2>', jamStart + 10);
    const jam = nt.slice(jamStart, jamEnd > jamStart ? jamEnd : jamStart + 3000);
    // ⚠️ 摇窗竖大拇指的**对象与手**[中文内容已移除]
    //
    // [中文内容已移除]**左边 A 车道的车**看 ——
    // [中文内容已移除] C [中文内容已移除]
    //
    // [中文内容已移除]
    //   · 写成右手 → [中文内容已移除]
    //   · [中文内容已移除]→ [中文内容已移除]
    //   · [中文内容已移除]→ 物理上不成立，C [中文内容已移除]
    check(/伸出左手/.test(jam),
      '[中文内容已移除]',
      '[中文内容已移除]');
    check(/左边那些车|左边.*车看/.test(jam),
      '[中文内容已移除]',
      '手势是做给左边 A [中文内容已移除]' +
      '不是给右边 C [中文内容已移除]');
    check(!/往右离开|往右变道|向右变道/.test(jam),
      '[中文内容已移除]',
      'C [中文内容已移除] —— 物理上不成立');
    check(/伸个大拇指|伸出大拇指|竖了个大拇指|竖起大拇指/.test(jam),
      '[中文内容已移除]',
      '[中文内容已移除]');

    // ⚠️ [中文内容已移除]
    //    [中文内容已移除]
    check(!/骑在/.test(nt),
      'notes.html [中文内容已移除]',
      '[中文内容已移除]/[中文内容已移除]' +
      '[中文内容已移除]');
  }

  // ⑪ 尾注必须存在。
  //
  // [中文内容已移除]AI [中文内容已移除]**[中文内容已移除]** ——
  // [中文内容已移除] AI [中文内容已移除]
  // [中文内容已移除]
  check(/class="colophon"/.test(nt),
    'notes.html 有尾注（colophon）',
    '尾注不见了 → [中文内容已移除]' +
    '而AI [中文内容已移除]');
  check(/AI\s*帮着排的版|AI/.test(nt),
    'notes.html 尾注声明了 AI 参与',
    '尾注里必须写明 AI 参与过排版');

  // ⑪ notes.html 的返回顶部按钮
  //
  // [中文内容已移除] bundle[中文内容已移除] <script> 里。
  // [中文内容已移除]
  // HTML 还在、CSS 还在，但没有 JS 就没有 data-show 的切换。
  const nHtml = exists('notes.html') ? read('notes.html') : '';
  check(/id="to-top"/.test(nHtml), 'notes.html [中文内容已移除]');
  check(/class="to-top"/.test(nHtml), 'notes.html 返回顶部按钮带 .to-top 样式类');

  const nScripts = [...nHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const nJs = nScripts.join('\n');
  check(/getElementById\(['"]to-top['"]\)/.test(nJs),
    'notes.html [中文内容已移除] to-top',
    '按钮元素存在但 JS 没绑它 → 点了没反应');
  check(/scrollTo\(\s*\{\s*top:\s*0/.test(nJs),
    'notes.html [中文内容已移除]',
    '按钮点击无行为 → 是个死按钮');

  // [中文内容已移除] CSS [中文内容已移除] opacity/visibility。
  //
  // [中文内容已移除] 80% [中文内容已移除] data-show 切换；
  // [中文内容已移除] scroll 监听一起删了。
  // 若残留 data-show 或默认 opacity:0[中文内容已移除] —— 而 HTML 和 JS 都在，
  // [中文内容已移除]
  const toTopCss = (nHtml.match(/\.to-top\s*\{([\s\S]*?)\}/) || ['', ''])[1];
  check(!/opacity:\s*0/.test(toTopCss) && !/visibility:\s*hidden/.test(toTopCss),
    'notes.html [中文内容已移除]CSS 无隐藏声明）',
    'CSS 里还有 opacity:0 / visibility:hidden → 按钮永久隐形，' +
    '但 HTML 和 JS [中文内容已移除]');
  // ⚠️ 剥掉注释再匹配 —— CSS/JS 注释里提到 data-show [中文内容已移除]
  //    [中文内容已移除]
  const nHtmlNoComment = nHtml
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  check(!/data-show/.test(nHtmlNoComment),
    'notes.html 不再有 data-show 切换机制',
    '[中文内容已移除]data-show 与 scroll [中文内容已移除]' +
    '残留会导致 HTML 属性与 CSS [中文内容已移除]');
  check(!/addEventListener\(\s*['"]scroll['"]/.test(nJs),
    'notes.html 不再监听 scroll',
    '[中文内容已移除] scroll [中文内容已移除]');
}

// [中文内容已移除]
//
// [中文内容已移除] "HU"[中文内容已移除]
// [中文内容已移除]
//
// 根因：**React [中文内容已移除] DOM 节点**[中文内容已移除]
// React [中文内容已移除]
// 而手动插入的 #apple-note 是 React [中文内容已移除]
// 原实现首行 `if (document.querySelector('#apple-note')) return;` 永远不纠正。
if (exists('index.html')) {
  const ih = read('index.html');
  const fnStart = ih.indexOf('function insertAppleNote()');
  check(fnStart >= 0, 'index.html 有 insertAppleNote()',
    '找不到该函数 → [中文内容已移除]');

  if (fnStart >= 0) {
    // [中文内容已移除] function 声明）
    const fnEnd = ih.indexOf('\n      function ', fnStart + 10);
    const body = ih.slice(fnStart, fnEnd > fnStart ? fnEnd : fnStart + 2000);

    check(/removeChild\(note\)|note\.remove\(\)/.test(body),
      'insertAppleNote [中文内容已移除]',
      '缺少摘除逻辑 → React 复用 DOM [中文内容已移除]' +
      '[中文内容已移除]');

    // ⚠️⚠️ [中文内容已移除]
    //
    // index.html 末尾有 `new MutationObserver(init)`：init() 里的 DOM 改动
    // 会再次触发 observer → 又调 init() → 又改 DOM → **无限循环**，
    // [中文内容已移除]
    //
    // 曾写「每次都 removeChild 再重新 insertBefore[中文内容已移除]
    // 实际每轮 init [中文内容已移除] → observer 自激 → 页面卡死。
    // 必须**[中文内容已移除]**。
    check(/previousSibling\s*===\s*tagsRow|previousSibling\s*==\s*tagsRow/.test(body),
      'insertAppleNote [中文内容已移除]',
      '缺少幂等判断 → 每轮 init 都删了再插 → MutationObserver 自激 → ' +
      '[中文内容已移除]note.previousSibling === tagsRow 就直接 return');

    check(!/if\s*\(\s*document\.querySelector\('#apple-note'\)\s*\)\s*return/.test(body),
      'insertAppleNote [中文内容已移除] return」的早退',
      '[中文内容已移除]');

    check(/if\s*\(\s*!appleCard\s*\)\s*\{?/.test(body),
      '[中文内容已移除]',
      '缺少判空 → [中文内容已移除]');

    // [中文内容已移除]
    // ⚠️ [中文内容已移除] → 校验恒过。
    //    改为切到下一个 addEventListener 为止。
    const sliceHandler = (eventName) => {
      const s = ih.indexOf(`addEventListener('${eventName}'`);
      if (s < 0) return '';
      const e = ih.indexOf('addEventListener(', s + 20);
      return ih.slice(s, e > s ? e : s + 1500);
    };
    check(/insertAppleNote/.test(sliceHandler('input')),
      '[中文内容已移除]',
      '[中文内容已移除]');

    check(/insertAppleNote/.test(sliceHandler('click')),
      '品类/[中文内容已移除]',
      '[中文内容已移除]');
  }

  // [中文内容已移除] insertAppleNote，统计 DOM [中文内容已移除]
  //
  // [中文内容已移除]
  // 这个脚本从 index.html [中文内容已移除] DOM 桩 eval 出来连调 100 次，
  // [中文内容已移除] exit 1 —— 那正是 MutationObserver 自激的判据。
  const idem = join(ROOT, 'scripts', 'check-inject-idempotent.mjs');
  if (existsSync(idem)) {
    let out = '';
    let code = 0;
    try {
      out = execFileSync(process.execPath, [idem], {
        cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 20000,
      });
    } catch (e) {
      code = e.status === undefined ? 1 : e.status;
      out = (e.stdout || '') + (e.stderr || '');
    }
    check(code === 0,
      'insertAppleNote [中文内容已移除] 100 次无 DOM 变动）',
      `scripts/check-inject-idempotent.mjs exit ${code} ——\n` +
      `      ${out.trim().split('\n').slice(-6).join('\n      ')}\n` +
      '      非幂等 → MutationObserver(init) 自激 → [中文内容已移除]');
  } else {
    err('scripts/check-inject-idempotent.mjs 缺失',
      '[中文内容已移除] —— [中文内容已移除]');
  }
}

// FORK_GUIDE [中文内容已移除] fork [中文内容已移除]
// ⚠️ [中文内容已移除]
//[中文内容已移除]
if (exists('FORK_GUIDE.md')) {
  const fg = read('FORK_GUIDE.md');
  // 标题实际是「## [中文内容已移除]
  // 所以不能写 /^##\s*一页速查/ （匹配不到）。
  const qIdx = fg.search(/^##\s*[^\n]*一页速查/m);
  check(qIdx >= 0, 'FORK_GUIDE [中文内容已移除]');
  const quick = qIdx >= 0 ? fg.slice(qIdx) : '';
  const mustMention = [
    ['null 而非 0', /`null`[^\n]*不要填\s*`?0`?/],
    ['noscript 清单同步', /noscript/i],
    ['四处文档同步', /(README[\s\S]{0,60}FORK_GUIDE|四处)/],
    ['h2/h3 双查', /querySelector\('h2'\)\s*\|\|\s*querySelector\('h3'\)/],
    ['不要 npm run build 部署', /npm run build/],
    ['改完跑校验', /npm run verify/],
    ['[中文内容已移除]', /根目录/],
    ['递增 ?v=N', /\?v=N/],
  ];
  mustMention.forEach(([label, re]) => {
    check(re.test(quick), `[中文内容已移除]${label}`);
  });
}

// ---------- 13b. SEO 基础配置 ----------
section('13b. SEO 基础配置');

/**
 * [中文内容已移除]
 * [中文内容已移除] SEO [中文内容已移除]
 * [中文内容已移除] —— [中文内容已移除]
 */

const SEO_PAGES = ['index.html', 'sponsor.html', 'projects.html', '404.html'];

// 0b. Google Search Console 验证文件
//
// [中文内容已移除]
// 一旦被 git clean 掉或误改，Google [中文内容已移除]
// 而且**不会主动通知你** —— [中文内容已移除]
//
// Google [中文内容已移除]
//   googlea540a6c2cd5f0e6c.html
//   内容：google-site-verification: googlea540a6c2cd5f0e6c.html
// [中文内容已移除] —— [中文内容已移除]
// [中文内容已移除]
// ⚠️ 不要写成 exists(ROOT) —— exists() 内部会再拼一次 ROOT，
// 结果是 join(ROOT, ROOT)[中文内容已移除] false。
// 目录判断直接用 readdirSync(ROOT)。
let googleFiles = [];
try {
  googleFiles = readdirSync(ROOT).filter((f) => /^google[0-9a-f]+\.html$/.test(f));
} catch {
  googleFiles = [];
}

if (googleFiles.length === 0) {
  warn('Google Search Console 验证文件缺失',
    '[中文内容已移除] google*.html。' +
    '若被误删，Google [中文内容已移除] —— [中文内容已移除]');
} else {
  googleFiles.forEach((f) => {
    const c = read(f);
    check(c.includes('google-site-verification'),
      `${f} 含 google-site-verification 标识`, `实际内容：${c.slice(0, 100)}`);

    // [中文内容已移除]
    const declared = c.match(/google-site-verification:\s*(\S+)/)?.[1];
    check(!!declared && declared === f,
      `${f} [中文内容已移除]`,
      declared ? `内容声明「${declared}」，实际文件「${f}」—— [中文内容已移除]` : '[中文内容已移除]');

    // 是个 HTML [中文内容已移除]
    check(c.trim().length > 0, `${f} 内容非空`);
  });
}

// 0a. [中文内容已移除]Bing[中文内容已移除]
//
// [中文内容已移除] BingSiteAuth.xml 一直能访问（HTTP 200），
// [中文内容已移除]Bing [中文内容已移除]
// [中文内容已移除] —— [中文内容已移除]
//
// [中文内容已移除]XML 结构）。
// [中文内容已移除] Bing [中文内容已移除]
if (exists('BingSiteAuth.xml')) {
  const bingXml = read('BingSiteAuth.xml');
  const keyMatch = bingXml.match(/<user>\s*([0-9A-Fa-f]+)\s*<\/user>/);
  check(!!keyMatch, 'BingSiteAuth.xml 含<user> 节点', `实际内容：${bingXml.slice(0, 120)}`);
  if (keyMatch) {
    // 不能写死长度：Bing [中文内容已移除] 31 位也有 32 位
    // [中文内容已移除] 32 [中文内容已移除] 31 位），
    // [中文内容已移除] —— [中文内容已移除]bug。
    check(/^[0-9A-Fa-f]{16,64}$/.test(keyMatch[1]),
      'BingSiteAuth.xml [中文内容已移除]',
      `实际 ${keyMatch[1].length} 位：${keyMatch[1]}`);
  }
} else {
  warn('BingSiteAuth.xml 不存在',
    '若要接入 Bing Webmaster Tools 的 XML [中文内容已移除] Bing [中文内容已移除]');
}

// 1. 每页必须有 title 与 description
SEO_PAGES.forEach((pg) => {
  if (!exists(pg)) { err(`${pg} 不存在`); return; }
  const h = read(pg);
  const title = h.match(/<title>([^<]+)<\/title>/)?.[1]?.trim();
  const desc = h.match(/name="description"\s+content="([^"]+)"/)?.[1]
    || h.match(/content="([^"]+)"\s+name="description"/)?.[1];
  check(!!title && title.length >= 6, `${pg} 有有效的 <title>（${title?.length ?? 0} 字符）`);
  check(!!desc && desc.length >= 30, `${pg} 有足够长的 description（${desc?.length ?? 0} 字符，建议 ≥ 30）`);
});

// 2. title 必须唯一（重复 title [中文内容已移除]
const titles = SEO_PAGES.filter(exists).map((pg) => read(pg).match(/<title>([^<]+)<\/title>/)?.[1]?.trim()).filter(Boolean);
check(new Set(titles).size === titles.length, `${titles.length} 个页面的 title 互不相同`,
  new Set(titles).size === titles.length ? '' : `重复：${titles.filter((t, i) => titles.indexOf(t) !== i).join(', ')}`);

// 3. index.html 必须有 canonical[中文内容已移除]
const idx = read('index.html');
const canon = idx.match(/rel="canonical"\s+href="([^"]+)"/)?.[1];
check(!!canon, 'index.html 有 canonical');
if (canon) {
  check(canon.startsWith('https://dujeongil-galaxy.github.io/shuangxiugou'),
    'canonical [中文内容已移除]', `当前：${canon}`);
}

// 4. sitemap 与 robots.txt
if (exists('sitemap.xml')) {
  const smRaw = readFileSync(join(ROOT, 'sitemap.xml'));
  const smText = smRaw.toString('utf8');
  const locs = [...smText.matchAll(/<loc>([^<]+)<\/loc>/g)].map((x) => x[1]);
  check(locs.length > 0, `sitemap.xml 含 ${locs.length} 条 URL`);

  // ---- sitemap 格式严格校验 ----
  //
  // 为什么只数 <loc> 不够：2026-10-10 Google [中文内容已移除]
  // 而本地数出来 38 [中文内容已移除]
  //
  // 下面 5 [中文内容已移除] Google 报错快得多。

  // 1) 命名空间 —— Google 要求 sitemaps.org [中文内容已移除]
  check(/<urlset[^>]+xmlns\s*=\s*["']http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9["']/.test(smText),
    'sitemap.xml 声明了 sitemaps.org 0.9 命名空间',
    'Google [中文内容已移除]');

  // 2) 第一行必须是 XML 声明
  check(smRaw.subarray(0, 5).toString() === '<?xml',
    'sitemap.xml 第一行是 XML 声明',
    `实际开头：${JSON.stringify(smRaw.subarray(0, 30).toString())}`);

  // 3) 无 BOM —— BOM [中文内容已移除]
  check(!(smRaw[0] === 0xef && smRaw[1] === 0xbb && smRaw[2] === 0xbf),
    'sitemap.xml 无 BOM');

  // 4) LF 换行 —— CRLF [中文内容已移除] LF 约定一致
  check(!smRaw.includes(0x0d),
    'sitemap.xml 使用 LF 换行（无 CR）',
    '检测到 CR 字节，可能是 CRLF');

  // 5) 无注释 —— sitemap [中文内容已移除]
  //    [中文内容已移除] docs，而不是塞进 sitemap。
  check(!smText.includes('<!--'),
    'sitemap.xml 不含注释',
    '[中文内容已移除] docs 或 generate-sitemap.py 顶部');

  // 6) 标签配平 —— 抓「少写一个 </url>」这类手误
  const openUrl = (smText.match(/<url>/g) || []).length;
  const closeUrl = (smText.match(/<\/url>/g) || []).length;
  check(openUrl === closeUrl && openUrl === locs.length,
    `sitemap.xml 标签配平（<url> ${openUrl} 个 / <loc> ${locs.length} 条）`,
    `标签数与 URL [中文内容已移除]`);

  const noindexPages = SEO_PAGES.filter((pg) => {
    if (!exists(pg)) return false;
    return /name="robots"\s+content="[^"]*noindex/.test(read(pg));
  });
  const inSitemap = noindexPages.filter((pg) => locs.some((l) => l.endsWith('/' + pg)));
  check(inSitemap.length === 0,
    'sitemap 未包含 noindex 页面',
    inSitemap.length ? `这些页声明了 noindex 却出现在 sitemap：${inSitemap.join(', ')}` : '');
} else {
  err('sitemap.xml 不存在', '[中文内容已移除]');
}

if (exists('robots.txt')) {
  const rb = read('robots.txt');
  check(/Sitemap:/i.test(rb), 'robots.txt 声明了 Sitemap 路径');
  check(!/Disallow:\s*\/$/m.test(rb), 'robots.txt [中文内容已移除]');
} else {
  err('robots.txt 不存在');
}

// 5. [中文内容已移除] JSON（写成非法 JSON 比不写还糟）
const ldBlocks = [...idx.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((x) => x[1]);
check(ldBlocks.length > 0, `index.html 含 ${ldBlocks.length} 块结构化数据`);
ldBlocks.forEach((b, i) => {
  try {
    const obj = JSON.parse(b);
    check(!!obj['@type'], `结构化数据块 ${i} 合法且有 @type（${obj['@type']}）`);
  } catch (e) {
    err(`结构化数据块 ${i} 是非法 JSON`, `${e.message} —— [中文内容已移除]`);
  }
});
// FAQPage 与 noscript 里的 FAQ 标题应保持一致
const hasFaqSchema = ldBlocks.some((b) => { try { return JSON.parse(b)['@type'] === 'FAQPage'; } catch { return false; } });
const noscriptFaq = /常见问题/.test(idx.match(/<noscript>([\s\S]*?)<\/noscript>/)?.[1] ?? '');
check(!(hasFaqSchema && !noscriptFaq) , 'FAQPage [中文内容已移除]',
  '声明了 FAQPage [中文内容已移除] FAQ[中文内容已移除]');

// 6. noscript [中文内容已移除]
const nsHtml = idx.match(/<noscript>([\s\S]*?)<\/noscript>/)?.[1] ?? '';
const nsText = nsHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
check(nsText.length >= 600, `noscript 正文 ${nsText.length} 字符（≥600[中文内容已移除]`,
  nsText.length < 600 ? '[中文内容已移除]' : '');
check(/常见问题/.test(nsText), 'noscript [中文内容已移除]');

// 7. IndexNow 推送脚本
check(exists('submit-indexnow.mjs'), 'IndexNow 推送脚本存在');
const wfDir = '.github/workflows';
if (exists(wfDir)) {
  const wf = join(wfDir, 'indexnow.yml');
  if (exists(wf)) {
    const y = read(wf);
    check(/INDEXNOW_KEY/.test(y), 'IndexNow workflow [中文内容已移除]');
    check(!/[0-9a-f]{16,}/i.test(y), 'IndexNow workflow 未硬编码密钥');
  } else {
    note('未配置 IndexNow 的 GitHub Actions[中文内容已移除] Bing 后台申请密钥）');
  }
}

// ---------- 13b-2. [中文内容已移除] ----------
//
// [中文内容已移除]
// [中文内容已移除] —— 这与本站
// [中文内容已移除]
//
// 检查三件事：①每条来源都有 http(s) 链接 ②有 target/rel
// ③[中文内容已移除]
section('13b-2. [中文内容已移除]');
if (exists('jiahua-fact-check.html')) {
  const jh = read('jiahua-fact-check.html');

  const srcBlock = (jh.match(/<ul class="src">([\s\S]*?)<\/ul>/) || [, ''])[1];
  const srcItems = srcBlock.split(/<li>/).filter((x) => x.trim() && !x.trim().startsWith('</li'));
  const srcLinks = [...srcBlock.matchAll(/href="(https?:\/\/[^"]+)"/g)].map((x) => x[1]);

  check(srcLinks.length >= 4, `来源列表含 ${srcLinks.length} 条可点击链接`,
    '[中文内容已移除]');

  // [中文内容已移除]
  const itemsWithLink = srcItems.filter((x) => /href="https?:\/\//.test(x));
  check(itemsWithLink.length === srcItems.length,
    `${srcItems.length} [中文内容已移除]`,
    `[中文内容已移除]${srcItems
      .map((x) => ((x.match(/src-title">([^<]+)/) || [, '?'])[1]))
      .filter((_, i) => !/href="https?:\/\//.test(srcItems[i]))
      .join(' / ')}`);

  // [中文内容已移除] noopener，防 tabnabbing
  const tgtAll = [...jh.matchAll(/<a\b[^>]*href="https?:\/\/[^"]+"[^>]*>/g)]
    .map((x) => x[0])
    .filter((a) => /target="_blank"/.test(a));
  check(
    tgtAll.length > 0 && tgtAll.every((a) => /rel="[^"]*noopener/.test(a)),
    `${tgtAll.length} 个外链均带 rel="noopener"`,
    tgtAll.filter((a) => !/rel="[^"]*noopener/.test(a))[0] || ''
  );

  // [中文内容已移除]
  const cites = (jh.match(/class="cite"/g) || []).length;
  check(cites >= 3, `正文含 ${cites} 处引用角标`, '[中文内容已移除]');

  // [中文内容已移除]
  //
  // ⚠️ 必须扫**全页**[中文内容已移除]
  //   [中文内容已移除]
  //   本站自身域名（canonical / og:url / [中文内容已移除]
  const SITE_HOST = 'dujeongil-galaxy.github.io';
  const allExternal = [...jh.matchAll(/href="(https?:\/\/[^"]+)"/g)]
    .map((x) => x[1])
    .filter((u) => !u.includes(SITE_HOST));
  const allowed = [
    // [中文内容已移除]
    'xdkb.net', 'nfnews.com', 'toutiao.com', 'sohu.com',
    'scol.com.cn', 'cyol.com', '163.com', 'thepaper.cn', 'jiemian.com',
    // [中文内容已移除]
    'github.com',
  ];
  const badDomains = [...new Set(allExternal
    .map((u) => (u.match(/^https?:\/\/([^/]+)/) || [, ''])[1])
    .filter((d) => d && !allowed.some((a) => d.endsWith(a))))];
  check(badDomains.length === 0,
    `全页 ${allExternal.length} [中文内容已移除]`,
    badDomains.length ? `[中文内容已移除]${badDomains.join(', ')}` : '');
}

// ---------- 13b-3. [中文内容已移除] ----------
//
// [中文内容已移除]
// [中文内容已移除] padding / font-size[中文内容已移除]
// 而 flex [中文内容已移除] ——
// [中文内容已移除]
//
// 这类 bug [中文内容已移除]
// [中文内容已移除]
section('13b-3. [中文内容已移除]');
if (exists('douyin-prompt.css')) {
  const dyp = read('douyin-prompt.css');

  // [中文内容已移除]
  const unified = (dyp.match(/\.dyp__acts > \* \{([^}]*)\}/) || [, ''])[1];
  check(unified.length > 0, '.dyp__acts > * [中文内容已移除]');
  for (const k of ['min-height', 'font-size', 'line-height', 'padding', 'border-radius', 'white-space']) {
    check(new RegExp(`${k}\\s*:`).test(unified), `统一规则含 ${k}[中文内容已移除]`);
  }

  // [中文内容已移除]/边框/交互）
  //
  // flex 的例外：`.dyp__go { flex: 2 1 0 }` 是**宽度分配权重**，
  // 不是尺寸 —— [中文内容已移除]6 字 vs 4 [中文内容已移除]
  // 它的 flex-basis 仍是 0[中文内容已移除]grow 比例，
  // [中文内容已移除] .dyp__acts > * 的 min-height 决定。
  const SIZE_KEYS = /^\s*(padding|font-size|line-height|min-height|min-width|border-radius)\s*:/;
  const FLEX_ALLOWED = /^\s*flex\s*:\s*[\d.]+\s+1\s+0\s*$/; // 只改 grow，basis 仍为 0
  const offenders = [];
  for (const cls of ['dyp__go', 'dyp__later', 'dyp__factcheck']) {
    const rules = [...dyp.matchAll(new RegExp(`\\.${cls}\\s*\\{([^}]*)\\}`, 'g'))];
    for (const r of rules) {
      const decls = r[1]
        .split(';')
        .map((x) => x.trim())
        .filter((x) => x && SIZE_KEYS.test(x) && !FLEX_ALLOWED.test(x));
      if (decls.length) offenders.push(`${cls}: ${decls.join(' / ')}`);
    }
  }
  check(offenders.length === 0, '[中文内容已移除] .dyp__acts > * 给）',
    offenders.length ? `[中文内容已移除]\n      ${offenders.join('\n      ')}` : '');

  // [中文内容已移除] —— [中文内容已移除]
  if (exists('factcheck-button.js')) {
    const fcb = read('factcheck-button.js');
    check(!/\.style\.cssText/.test(fcb), '注入脚本未内联 cssText');
    check(!/window\.matchMedia/.test(fcb),
      '注入脚本未用 JS [中文内容已移除] CSS 的 @media）');
  }

  // [中文内容已移除]14px [中文内容已移除] 420px 面板里
  // 主按钮拿 2/4 宽度 ≈ 178px，中文 14px/字 → 最多 12 字）
  if (exists('douyin-prompt.js')) {
    const dp = read('douyin-prompt.js');
    const lt = (dp.match(/linkText:\s*'([^']+)'/) || [, ''])[1];
    if (lt) {
      const MAX = 10;
      const ok = lt.length <= MAX;
      check(ok, `主按钮文案「${lt}」共 ${lt.length} 字（上限 ${MAX}）`,
        ok ? '' : `[中文内容已移除] —— [中文内容已移除] .dyp__go 的 flex-grow 权重`);
    }
  }

  /* ------------------------------------------------------------------
     [中文内容已移除]

     [中文内容已移除]+ 淡米色边框 + 灰字，
     [中文内容已移除] —— [中文内容已移除] vs 关闭）。

     [中文内容已移除]**背景 / 文字 / [中文内容已移除]**。
     [中文内容已移除]

     ⚠️ 实现要点：同一 class 可能有**多条规则**（如 .dyp__go 既有 flex 权重
     [中文内容已移除] —— [中文内容已移除]
     [中文内容已移除] bug。
     ------------------------------------------------------------------ */
  const parseAll = (cssText, cls) => {
    const out = {};
    const re2 = new RegExp(`\\.${cls}\\s*\\{([^}]*)\\}`, 'g');
    let m;
    while ((m = re2.exec(cssText))) {
      for (const decl of m[1].split(';')) {
        const i = decl.indexOf(':');
        if (i < 0) continue;
        out[decl.slice(0, i).trim()] = decl.slice(i + 1).trim();
      }
    }
    return out;
  };

  const palette = {
    '在抖音中观看': parseAll(dyp, 'dyp__go'),
    '事实核查': parseAll(dyp, 'dyp__factcheck'),
    '以后再说': parseAll(dyp, 'dyp__later'),
  };

  const nameList = Object.keys(palette);
  const ambiguous = [];
  for (let i = 0; i < nameList.length; i++) {
    for (let j = i + 1; j < nameList.length; j++) {
      const A = palette[nameList[i]];
      const B = palette[nameList[j]];
      const diffs = [];
      if ((A.background || 'inherit') !== (B.background || 'inherit')) diffs.push('背景');
      if ((A.color || 'inherit') !== (B.color || 'inherit')) diffs.push('文字');
      if ((A.border || 'none') !== (B.border || 'none')) diffs.push('边框');
      if (diffs.length < 2) {
        ambiguous.push(`${nameList[i]} ↔ ${nameList[j]} 仅差 ${diffs.length} 个维度${diffs.length ? '（' + diffs.join('、') + '）' : ''}`);
      }
    }
  }
  check(ambiguous.length === 0, '[中文内容已移除]/文字/边框）',
    ambiguous.length ? `[中文内容已移除]\n      ${ambiguous.join('\n      ')}` : '');

  // [中文内容已移除]/[中文内容已移除]
  const goBg = palette['在抖音中观看'].background || '';
  check(goBg.length > 0 && goBg !== 'transparent',
    `主按钮为实心/[中文内容已移除]${goBg.slice(0, 42)}`);
  check((palette['以后再说'].background || '').match(/transparent|none|inherit/) !== null,
    '[中文内容已移除]');
}

/* ------------------------------------------------------------------
   [中文内容已移除]
   ------------------------------------------------------------------
   [中文内容已移除]≤640px [中文内容已移除]
   「提交爆料 / 推荐」「Star on GitHub[中文内容已移除]

   根因在 bundle 里（按钮缺 whitespace-nowrap、容器缺 flex-wrap，
   且顶栏是 h-16 [中文内容已移除] CSS 覆盖。

   [中文内容已移除]**被当成冗余删掉**：
   以后若有人重建 bundle [中文内容已移除]
   反之若 bundle [中文内容已移除]
   [中文内容已移除]
   ------------------------------------------------------------------ */
section('13b-5. 移动端排版修复');
if (exists('mobile-fixes.css')) {
  const mf = read('mobile-fixes.css');

  check(/@media\s*\(max-width:\s*640px\)/.test(mf), '含 ≤640px 主断点（Tailwind sm 断点）');
  check(/@media\s*\(max-width:\s*400px\)/.test(mf), '含 ≤400px [中文内容已移除]');

  // [中文内容已移除]
  check(/white-space:\s*nowrap/.test(mf), '含 white-space: nowrap[中文内容已移除]');
  // 注意：不再要求 flex-wrap: wrap ——
  // 竖排（flex-direction: column[中文内容已移除]
  // 而 flex-wrap [中文内容已移除]
  // ⚠️ 关键：只加 flex-wrap 不放开 h-16[中文内容已移除]
  check(/height:\s*auto/.test(mf) && /min-height:\s*64px/.test(mf),
    '[中文内容已移除]h-16 → min-height[中文内容已移除]');

  // [中文内容已移除]
  //
  // ⚠️ [中文内容已移除]
  //
  // 失败经历：
  //   ① [中文内容已移除] → [中文内容已移除]
  //   ② [中文内容已移除] → [中文内容已移除]
  //      因为 640px [中文内容已移除] 1551 与 3704），400px 夹在中间，
  //      end(1551) < start(2623)
  //
  // [中文内容已移除] → [中文内容已移除]
  //   [中文内容已移除]
  //   [中文内容已移除]
  //   [中文内容已移除] —— [中文内容已移除]
  //   [中文内容已移除]
  //   [中文内容已移除]
  const seenW = new Set();
  const byW = new Map();
  for (const m of mf.matchAll(/@media\s*\(max-width:\s*(\d+)px\)\s*\{/g)) {
    const w = Number(m[1]);
    if (!seenW.has(w)) {
      seenW.add(w);
      byW.set(w, m.index);
    }
  }
  const BLOCK_KEYS = [
    ['github\\.com', 'Star on GitHub'],
    ['sponsor\\.html', '赞助本项目'],
    ['shuangxiugou/issues', '提交爆料'],
  ];
  for (const [w, start] of [...byW.entries()].sort((a, b) => b[0] - a[0])) {
    const body = mf.slice(start);
    for (const [key, label] of BLOCK_KEYS) {
      check(new RegExp(`a\\[href\\*="${key}`).test(body),
        `≤${w}px [中文内容已移除]${label}」`,
        `该宽度区间里 ${label} 没有 nowrap [中文内容已移除]`);
    }
  }

  // 必须被 index.html 引用，且在主CSS [中文内容已移除]
  if (exists('index.html')) {
    const ih = read('index.html');
    check(/mobile-fixes\.css/.test(ih), 'index.html 已引用 mobile-fixes.css');

    // ⚠️ [中文内容已移除] <link rel="stylesheet" ... assets/index-BgVofs0W.css>，
    //    不能只indexOf('assets/index-BgVofs0W.css')——
    //    那会先命中第 19 行的 <link rel="preload" as="style">，
    //    [中文内容已移除]
    const mainCssPos = ih.search(/<link[^>]*rel="stylesheet"[^>]*assets\/index-BgVofs0W\.css/);
    const fixCssPos = ih.search(/<link[^>]*mobile-fixes\.css/);
    check(mainCssPos >= 0, '主 CSS 有 stylesheet [中文内容已移除]');
    check(fixCssPos > mainCssPos,
      '引用顺序在主 CSS [中文内容已移除]',
      `主CSS 在第 ${mainCssPos} 字符、mobile-fixes 在第 ${fixCssPos} 字符 —— ` +
      '[中文内容已移除]');

    const vi = ih.match(/mobile-fixes\.css\?v=(\d+)/);
    check(!!vi, '带 ?v= [中文内容已移除]', vi ? '' : '[中文内容已移除]');
  }

  /* ------------------------------------------------------------------
     [中文内容已移除]
     ------------------------------------------------------------------
     [中文内容已移除]≤400px 时曾写 flex: 1 1 100%，
     结果「☕ [中文内容已移除] 5 [中文内容已移除]
     [中文内容已移除] —— **[中文内容已移除]**。

     [中文内容已移除] flex: 0 0 auto（按内容宽），
     而不是 1 1 100%（强制占满）。
     ------------------------------------------------------------------ */
  // [中文内容已移除] flex: ...
  // 不能用 /flex:\s*1\s+1\s+100%/ 全文搜——
  // [中文内容已移除] flex: 1 1 100%[中文内容已移除]
  const mfClean = stripCssComments(mf);

  /* ------------------------------------------------------------------
     [中文内容已移除]
     ------------------------------------------------------------------
     [中文内容已移除]①竖排单字 ②撑满整行 ③真机横向重叠。
     前三次都在调 flex [中文内容已移除]
     但三按钮总宽 408px > 手机可用 196~250px[中文内容已移除]

     [中文内容已移除] ——
     flex-direction: column [中文内容已移除]
     [中文内容已移除]

     [中文内容已移除] flex-direction: column。
     ------------------------------------------------------------------ */
  const colDecl = mfClean.match(/flex-direction:\s*column/);
  check(!!colDecl, '窄屏按钮区为 flex-direction: column[中文内容已移除]',
    '横排三按钮总宽 408px > 手机可用 196~250px，永远放不下；'
    + '不要再试图用 flex 三值调横排');

  // [中文内容已移除] 100% 或 auto，不能是内容宽
  const widthDecl = mfClean.match(/width:\s*(\d+%|auto)/);
  check(widthDecl && widthDecl[1] === '100%',
    '竖排按钮宽度为 100%[中文内容已移除]',
    '若为 auto[中文内容已移除] logo 区');

  // [中文内容已移除]
  check(/height:\s*auto/.test(mfClean) && /min-height:\s*64px/.test(mfClean),
    '[中文内容已移除]');

  const stretch400 = mfClean.split('\n')
    .map((l) => l.trim())
    .filter((l) => /^flex:\s*1\s+1\s+(100%|0)\s*;?$/.test(l));
  check(stretch400.length === 0,
    '[中文内容已移除]',
    stretch400.length
      ? 'flex: 1 1 0/100% [中文内容已移除]'
      : '');

  /* ------------------------------------------------------------------
     [中文内容已移除] :has()
     ------------------------------------------------------------------
     [中文内容已移除] :has() 未生效 → flex-wrap 没应用 → 三按钮重叠。
     必须有 JS 打属性（data-hdr-acts）的等价路径。

     检查：CSS 用了 :has() [中文内容已移除] + 注入脚本。
     ------------------------------------------------------------------ */
  const usesHas = /:has\(/.test(mfClean);
  const hasAttrPath = /data-hdr-acts/.test(mfClean);
  check(!usesHas || hasAttrPath,
    '换行规则不单靠 :has()[中文内容已移除]',
    hasAttrPath ? '' : '只有 :has() [中文内容已移除]');

  check(hasAttrPath && exists('header-fix.js'),
    'data-hdr-acts [中文内容已移除]header-fix.js）');
  if (hasAttrPath && exists('header-fix.js')) {
    const hf = read('header-fix.js');
    check(/setAttribute\(\s*ATTR/.test(hf) || /setAttribute\(['"]data-hdr-acts/.test(hf),
      '[中文内容已移除] data-hdr-acts');
    check(/header a\[href\*="github\.com"\] > span/.test(hf),
      '脚本选择器匹配 bundle 真实层级（a > span）');
    check(/MutationObserver/.test(hf),
      '[中文内容已移除] React [中文内容已移除]');
  }
} else {
  note('未找到 mobile-fixes.css —— 若 bundle [中文内容已移除]');
}

/* ------------------------------------------------------------------
   [中文内容已移除]
   ------------------------------------------------------------------
   [中文内容已移除]≤1439px 的吸底条里，
   [中文内容已移除] position:absolute + translateY(-50%)
   浮在左上角，**直接盖住了 title 第一行**
   （「注册即送 喜茶 20 元 [中文内容已移除]

   徽标和 body 是兄弟节点，absolute [中文内容已移除]
   [中文内容已移除]padding-top[中文内容已移除]

   判据：徽标仍在 absolute[中文内容已移除]
   [中文内容已移除] padding-top，且徽标 top 值小于它。
   ------------------------------------------------------------------ */
section('13b-6. [中文内容已移除]');
if (exists('liangpei-ad.css')) {
  const lp = read('liangpei-ad.css');
  const barRaw = (lp.match(/@media\s*\(max-width:\s*1439px\)\s*\{[\s\S]*?\n\}/) || [''])[0];
  // ⚠️ [中文内容已移除] —— 这段 CSS 里就写着
  //    「translateY(-50%) [中文内容已移除]
  //    [中文内容已移除] stripCssComments 的注释）。
  const bar = stripCssComments(barRaw);

  check(/position:\s*absolute/.test(bar), '吸底条内徽标为absolute[中文内容已移除]');

  const pt = (bar.match(/padding-top:\s*(\d+)px/) || [, '0'])[1];
  const bt = (bar.match(/\.lp-ad__badge\s*\{[\s\S]*?top:\s*(\d+)px/) || [, '999'])[1];
  check(Number(pt) >= 16,
    `吸底条 padding-top: ${pt}px ≥ 徽标高度（约 19px 的一半 + 间距）`,
    `徽标 top: ${bt}px，若 padding-top [中文内容已移除]`);

  check(!/translateY\(-50%\)/.test(bar),
    '[中文内容已移除] translateY(-50%)[中文内容已移除]');

  check(!/-webkit-line-clamp/.test(bar),
    '[中文内容已移除]clamp [中文内容已移除]');

  const sideRaw = (lp.match(/@media\s*\(min-width:\s*1440px\)\s*\{[\s\S]*?\n\}/) || [''])[0];
  check(sideRaw.length > 0, '[中文内容已移除]');

  /* ----------------------------------------------------------------
     同一 media [中文内容已移除]
     ----------------------------------------------------------------
     [中文内容已移除] 119 行加了新规则，
     却忘了 184 行还有一条旧的 `.lp-ad__badge` ——
     [中文内容已移除]**改了等于没改**，
     而 119 [中文内容已移除]

     CSS [中文内容已移除]
     [中文内容已移除]
     ---------------------------------------------------------------- */
  const dupIn = (blockSrc, label) => {
    const seen = new Map();
    const dup = [];
    for (const m of stripCssComments(blockSrc).matchAll(/(^|\})\s*([^\s@{}][^{]*)\{/g)) {
      const sel = m[2].trim().replace(/\s+/g, ' ');
      seen.set(sel, (seen.get(sel) || 0) + 1);
    }
    for (const [sel, n] of seen) if (n > 1) dup.push(`${sel} ×${n}`);
    check(dup.length === 0, `${label} 内无重复选择器`,
      dup.length ? `[中文内容已移除]${dup.join('; ')}` : '');
  };
  dupIn(barRaw, '吸底条（<1440px）');
  dupIn(sideRaw, '竖排卡片（≥1440px）');
}

/* ------------------------------------------------------------------
   [中文内容已移除]
   ------------------------------------------------------------------
   [中文内容已移除]test」，列表**完全不变**[中文内容已移除]

   根因（读 bundle [中文内容已移除]
   `value:i, onChange:e=>a(e.target.value)` 的 state 变量 `i`，
   在整个组件里**只出现 1 次 —— 就是输入框的 value 本身**。
   组件内**没有任何 useMemo**，列表直接 `n.map(...)` 渲染全部数据。
   → [中文内容已移除]

   [中文内容已移除]UI 正常），
   [中文内容已移除]
   **一个 state [中文内容已移除]**

   检查：搜索 state [中文内容已移除]
   ------------------------------------------------------------------ */
section('13b-7. [中文内容已移除]');
{
  const bj = exists('assets/index-YthXZ9eP.js') ? read('assets/index-YthXZ9eP.js') : '';
  const phIdx = bj.indexOf('[中文内容已移除]');

  check(phIdx > 0, '[中文内容已移除] placeholder 定位）');

  if (phIdx > 0) {
    const bind = bj.slice(phIdx, phIdx + 400)
      .match(/value:([a-z]),onChange:e=>([a-z])\(e\.target\.value\)/);
    check(!!bind, '[中文内容已移除]value + onChange）');

    if (bind) {
      const v = bind[1];
      const re = new RegExp(`(?<![\\w$])${v}(?![\\w$])`, 'g');
      const all = [...bj.matchAll(re)].length;
      const inBind = (bj.slice(Math.max(0, phIdx - 150), phIdx + 400).match(re) || []).length;
      check(all > inBind,
        `搜索变量 \`${v}\` [中文内容已移除] ${all} 处 > 绑定附近 ${inBind} 处）`,
        `\`${v}\` [中文内容已移除] → [中文内容已移除]`);
    }

    // [中文内容已移除]
    //
    // ⚠️ 不用「切片 + 正则」去猜 —— 压缩代码里 `children:ln},[...]` 这类
    // [中文内容已移除]
    // 一次把 `ln.map` 切成 `l` + `ne.map`，一次漏掉后面 6000 字符）。
    // 改为**全局查找**：原始数组 `n.map(` [中文内容已移除]
    // [中文内容已移除]
    const gridIdx = bj.indexOf('grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5');
    check(gridIdx > 0, '[中文内容已移除]');

    // [中文内容已移除] `ln=(0,_.useMemo)` 提取
    const memoM = bj.match(/([a-z][\w$]*)=\(0,_\.useMemo\)\(\(\)=>\{let [a-z]=([a-z])\.trim\(\)/);
    check(!!memoM, '[中文内容已移除] useMemo 过滤');

    if (gridIdx > 0 && memoM) {
      const filteredVar = memoM[1];
      // 容器之后 400 字符内应出现 `<filteredVar>.map(`
      const after = bj.slice(gridIdx, gridIdx + 400);
      check(after.includes(`${filteredVar}.map(`),
        `[中文内容已移除]${filteredVar}.map）`,
        `容器后未见 ${filteredVar}.map —— [中文内容已移除]`);

      // [中文内容已移除] n.map [中文内容已移除]
      const tail = bj.slice(gridIdx, gridIdx + 400);
      const rawUse = tail.includes('n}.map(') || tail.includes('children:n}.map(');
      check(!rawUse, '[中文内容已移除] n');
    }

    // [中文内容已移除]
    // ⚠️ [中文内容已移除] `},[...]` 处，不能用固定 700 字符 ——
    //    [中文内容已移除] ne=n.filter(...)，里面同样引用 keyProducts，
    //    [中文内容已移除]ln 里删掉 keyProducts」也照样通过。
    const filterBody = memoM
      ? (() => {
        const from = bj.indexOf(`${memoM[1]}=(0,_.useMemo)`);
        const dep = bj.indexOf('},[', from);
        return bj.slice(from, dep > from ? dep : from + 700);
      })()
      : '';
    check(filterBody.includes('.category!==') || filterBody.includes('.category!=='),
      '品类筛选生效（category 比较）');
    check(filterBody.includes('.tier!=='), '评级筛选生效（tier 比较）');
    check(filterBody.includes('companyName'), '[中文内容已移除]');
    check(filterBody.includes('searchKeywords'), '[中文内容已移除]');
    // [中文内容已移除] keyProducts（喜茶=[中文内容已移除]=美式/拿铁），
    // 不搜 keyProducts [中文内容已移除]
    check(filterBody.includes('keyProducts'),
      '搜索匹配 keyProducts',
      '过滤条件里没有 keyProducts —— [中文内容已移除] keyProducts，' +
      '[中文内容已移除]');
    check(filterBody.includes('.trim()'),
      '搜索词先 trim [中文内容已移除]');
    // 空串陷阱：''.includes('') === true[中文内容已移除]
    check(/if\([a-z]&&!/.test(filterBody),
      '[中文内容已移除].includes 恒真架空条件）');

    // 每个内置 brand 都必须有 searchKeywords。
    // [中文内容已移除]
    // 32 [中文内容已移除] —— [中文内容已移除] searchKeywords，
    // 品类词全塞在 keyProducts [中文内容已移除] keyProducts 只能救一部分，
    // 口语词（奶茶/果茶/手机/[中文内容已移除]
    //
    // ⚠️ 不能用 split(/\{id:`/) —— evidence [中文内容已移除] id，
    //    切出来 143 段，大部分不是 brand，会误报。
    //    只认带 logoText 的顶层 brand [中文内容已移除]
    const bStart = bj.indexOf('brands:[');
    const brandBlocks = [];
    if (bStart >= 0) {
      const seg = bj.slice(bStart, bStart + 200000);
      const re = /\{id:`([^`]*)`,name:`[^`]*`,companyName:`[^`]*`,logoText:`/g;
      let mm;
      while ((mm = re.exec(seg))) {
        let d = 0;
        let q = mm.index;
        let instr = false;
        for (; q < seg.length; q++) {
          const ch = seg[q];
          if (instr) { if (ch === '`') instr = false; continue; }
          if (ch === '`') { instr = true; continue; }
          if (ch === '{') d++;
          else if (ch === '}') { d--; if (d === 0) { q++; break; } }
        }
        brandBlocks.push({ id: mm[1], body: seg.slice(mm.index, q) });
      }
    }
    const noKw = brandBlocks.filter((x) => !x.body.includes('searchKeywords')).map((x) => x.id);
    check(brandBlocks.length === 32,
      '内置 brand [中文内容已移除] 32 个',
      `只切出 ${brandBlocks.length} 个 —— [中文内容已移除]`);
    check(noKw.length === 0,
      `内置 ${brandBlocks.length} 个 brand 全部带 searchKeywords`,
      `缺 searchKeywords 的内置品牌：${noKw.join(', ')}\n` +
      '      [中文内容已移除]');
  }
}

/* ------------------------------------------------------------------
   [中文内容已移除] placeholder 文案
   ------------------------------------------------------------------
   [中文内容已移除]1」「test[中文内容已移除]

   根因：filterCustomCards() 用 `input[placeholder*="搜索"]` 定位输入框，
   而 placeholder [中文内容已移除]
   **[中文内容已移除]**，选择器返回 null，keyword 恒为空，
   [中文内容已移除] `placeholder.includes('搜索')` 同样不成立，
   连 input 事件都没挂上。

   > placeholder 是**文案**，会被人改；
   > id / data-* / name 才是**契约**。
   > [中文内容已移除]

   [中文内容已移除] placeholder [中文内容已移除]
   ------------------------------------------------------------------ */
section('13b-8. 元素定位不依赖 placeholder 文案');
{
  const ih = exists('index.html') ? read('index.html') : '';
  const scriptFiles = ['index.html', 'friend-links-footer.js', 'header-fix.js',
                       'liangpei-ad.js', 'douyin-prompt.js', 'factcheck-button.js']
    .filter(exists);

  const offenders = [];
  for (const f of scriptFiles) {
    const txt = read(f);
    // querySelector*('...[placeholder*=...]')
    const m1 = txt.match(/querySelector(?:All)?\([^)]*\[placeholder\*?=/g) || [];
    // xxx.placeholder.includes(...) / === 作为判定
    const m2 = txt.match(/\.placeholder[^;,)\n]{0,20}(?:\.includes|\.indexOf|===|==)/g) || [];
    if (m1.length) offenders.push(`${f}: 用 [placeholder*=] 定位 ${m1.length} 处`);
    if (m2.length) offenders.push(`${f}: 用 .placeholder 做判定 ${m2.length} 处`);
  }
  check(offenders.length === 0,
    '无脚本用 placeholder [中文内容已移除]',
    offenders.length
      ? `[中文内容已移除]\n      ${offenders.join('\n      ')}`
      : '');

  // [中文内容已移除] id，且过滤逻辑按 id 定位
  check(/'site-search-input'/.test(ih),
    '[中文内容已移除] id（site-search-input）');
  check(/getElementById\(\s*'site-search-input'\s*\)/.test(ih),
    '过滤逻辑按 id 定位搜索框');
  check(/e\.target\.id\s*===\s*'site-search-input'/.test(ih),
    'input 事件按 id 判定');
}

/* ---------- 13b-9. 文档一致性 ----------
 *
 * PITFALLS.md [中文内容已移除]13b-5 / 13b-6 / 13b-8 …），
 * [中文内容已移除]
 *
 * [中文内容已移除]
 * 文档就在**[中文内容已移除]** —— 比不写更糟。
 * [中文内容已移除]
 *
 * 触发方式举例：
 * - 把 13b-6 的 section() 改名成 13b-7（编号冲突）
 * - 把某个 section() 整段删掉
 * - [中文内容已移除]
 */
section('13b-9. [中文内容已移除]');

const DOCS = ['PITFALLS.md', 'README.md', 'FORK_GUIDE.md', 'MAINTAINING.md'];
const self = read('scripts/verify.mjs');

// [中文内容已移除] section 编号（排除 13b-9 [中文内容已移除]
const liveSections = new Set(
  [...self.matchAll(/^section\('([^']+)'/gm)].map((m) => m[1].split('.')[0].trim())
);

// [中文内容已移除] 13b-N / 13c / 14 之类的段落编号
const REF_RE = /\b(1[0-5]|1[3-5]b)(?:-(\d))?\b/g;

const dangling = [];
const missingDocs = [];
for (const d of DOCS) {
  if (!exists(d)) { missingDocs.push(d); continue; }
  const txt = read(d);
  for (const m of txt.matchAll(REF_RE)) {
    const base = m[1] + (m[2] ? '-' + m[2] : '');
    if (base === '13b-9') continue;           // 自身
    if (!liveSections.has(base)) {
      dangling.push(`${d}: 「${base}」`);
    }
  }
}

check(missingDocs.length === 0,
  `文档齐全（${DOCS.length} 份）`,
  missingDocs.length ? `缺失：${missingDocs.join(', ')}` : '');

check(dangling.length === 0,
  `[中文内容已移除] ${liveSections.size} 个 section）`,
  dangling.length
    ? [
        '以下编号在 verify.mjs 里找不到对应 section ——',
        '[中文内容已移除]',
        ...[...new Set(dangling)],
      ].join('\n      ')
    : '');

// [中文内容已移除] —— [中文内容已移除]
if (exists('PITFALLS.md')) {
  const pf = read('PITFALLS.md');
  const items = (pf.match(/^###\s/gm) || []).length;
  // [中文内容已移除]`> ### 规则`（带标题）与 `> **加粗一句**`（无标题）。
  // [中文内容已移除] —— [中文内容已移除]2 条规则。
  const rulesTitled = (pf.match(/^>\s*#{2,4}\s*规则/gm) || []).length;
  const rulesPlain = (pf.match(/^>\s*\*\*[^\n]{4,}\*\*/gm) || []).length;
  const rules = rulesTitled + rulesPlain;
  check(pf.length > 5000, `PITFALLS.md 有实质内容（${pf.length} 字符 / ${items} 个条目 / ${rules} 条规则）`,
    `仅 ${pf.length} [中文内容已移除]`);
  // [中文内容已移除] —— [中文内容已移除]
  check(/##\s*[中文内容已移除]/.test(pf),
    'PITFALLS.md [中文内容已移除]',
    '[中文内容已移除]');

  /**
   * 内部交叉引用（§x.y[中文内容已移除]
   *
   * [中文内容已移除] §x.y 指向具体小节，
   * [中文内容已移除] —— [中文内容已移除]
   *
   * ⚠️ 提取时必须匹配**完整的 x.y**[中文内容已移除]
   *    早先写成 `§(\d+)` 时，`§1.1` 会被截成 `1`，
   *    于是凭空多出 5 [中文内容已移除] **检查脚本自己的 bug**。
   *    [中文内容已移除]
   *    **[中文内容已移除]**
   */
  const pfHeads = [...pf.matchAll(/^#{2,4}\s*(\d+(?:\.\d+)?)[\s.、]/gm)].map((m) => m[1]);
  const pfRefSet = new Set(pfHeads);
  const pfRefs = [...new Set([...pf.matchAll(/§(\d+\.\d+)/g)].map((m) => m[1]))];
  const badRefs = pfRefs.filter((r) => !pfRefSet.has(r));
  check(badRefs.length === 0,
    `内部交叉引用 §x.y [中文内容已移除] ${pfRefs.length} 处引用 / ${pfHeads.length} 个小节）`,
    badRefs.length
      ? [
          '[中文内容已移除]',
          ...badRefs.map((r) => `  §${r}`),
        ].join('\n      ')
      : '');
}

/* ---------- 13c. 编码完整性 ----------
section('13c. 编码完整性');

/**
 * 检测乱码字符（U+FFFD REPLACEMENT CHARACTER）。
 *
 * 背景：FORK_GUIDE.md [中文内容已移除]
 * 被截断成了两个U+FFFD[中文内容已移除]??逻辑」。
 * [中文内容已移除]
 * [中文内容已移除]**[中文内容已移除]**：
 * GitHub [中文内容已移除]
 *
 * [中文内容已移除]
 *[中文内容已移除]
 */
const ENCODING_SENSITIVE = [
  'README.md', 'FORK_GUIDE.md', 'MAINTAINING.md', 'DESIGN.md', 'LICENSE.md',
  '[中文内容已移除].md',
  'index.html', 'sponsor.html', 'projects.html', '404.html',
  'scripts/verify.mjs', 'submit-indexnow.mjs',
];

let mojibakeFound = 0;
ENCODING_SENSITIVE.filter(exists).forEach((f) => {
  const t = read(f);
  const idxs = [...t.matchAll(/\uFFFD/g)].map((m) => m.index);
  if (idxs.length === 0) { ok(`${f} 无乱码字符`); return; }
  mojibakeFound += idxs.length;
  const details = idxs.slice(0, 5).map((i) => {
    const line = t.slice(0, i).split('\n').length;
    const ctx = t.slice(Math.max(0, i - 20), i + 20).replace(/\n/g, ' ');
    return `第 ${line} 行: ...${ctx}...`;
  });
  err(`${f} 含 ${idxs.length} 个乱码字符（U+FFFD）`,
    details.join('\n      ') + (idxs.length > 5 ? `\n      …… 另有 ${idxs.length - 5} 处` : '') +
    '\n      U+FFFD [中文内容已移除]');
});

// [中文内容已移除]
const mdTitles = [...read('FORK_GUIDE.md').matchAll(/^#{1,3}\s+(.+)$/gm)]
  .map((m) => m[1])
  .filter((t) => /\uFFFD/.test(t));
if (mdTitles.length === 0) ok('FORK_GUIDE.md [中文内容已移除]');

/* ---------- 13c-2. [中文内容已移除] ----------
 *
 * 背景：36 个详情页的 title[中文内容已移除]XX 双休率NN%｜双休购」，
 * 只覆盖「XX [中文内容已移除]**「XX [中文内容已移除]**，
 * [中文内容已移除] ——
 * 放在 title [中文内容已移除]
 *
 * 所以 title / og:title / h1 三处统一改为「XX 几点下班 双休率NN%」。
 *
 * [中文内容已移除]
 *  ① title 与 og:title 不一致 →[中文内容已移除]
 *  ② 某页漏改 → [中文内容已移除]
 *  ③ 改回单模子 → [中文内容已移除]
 */
section('13c-2. [中文内容已移除]');

const brandFiles = exists('brand') ? readdirSync(join(ROOT, 'brand')).filter((f) => f.endsWith('.html')) : [];
if (brandFiles.length === 0) {
  note('brand/ [中文内容已移除]');
} else {
  const noQidian = [];
  const titleOgMismatch = [];
  const badH1 = [];
  for (const bf of brandFiles) {
    const t = read(join('brand', bf));
    const tm = t.match(/<title>([^<]*)<\/title>/);
    const om = t.match(/property="og:title" content="([^"]*)"/);
    const hm = t.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);

    const title = tm ? tm[1] : '';
    const og = om ? om[1] : '';
    const h1 = hm ? hm[1].replace(/<[^>]+>/g, '').trim() : '';

    if (!/几点下班/.test(title)) noQidian.push(bf);
    if (title && og && title !== og) titleOgMismatch.push(bf);
    if (h1 && !/几点下班/.test(h1)) badH1.push(bf);
  }

  check(noQidian.length === 0,
    `全部 ${brandFiles.length} 个详情页 title [中文内容已移除]`,
    noQidian.length
      ? `这些页没覆盖：${noQidian.slice(0, 8).join(', ')}${noQidian.length > 8 ? ' …' : ''}`
      : '');

  check(titleOgMismatch.length === 0,
    'title 与 og:title 内容一致',
    titleOgMismatch.length
      ? `[中文内容已移除]${titleOgMismatch.slice(0, 5).join(', ')}`
      : '');

  check(badH1.length === 0,
    '全部详情页 h1 含「几点下班」',
    badH1.length ? `未覆盖：${badH1.slice(0, 8).join(', ')}` : '');

  // title 过长会被 SERP [中文内容已移除]
  const tooLong = brandFiles.filter((bf) => {
    const m = read(join('brand', bf)).match(/<title>([^<]*)<\/title>/);
    return m && m[1].length > 40;
  });
  check(tooLong.length === 0,
    'title [中文内容已移除]≤40 字符）',
    tooLong.length
      ? `[中文内容已移除]${tooLong.slice(0, 5).join(', ')}`
      : '');
}

// ---------- 13d. 品牌详情页 ----------
section('13d. 品牌详情页');

/**
 * [中文内容已移除]XX公司 [中文内容已移除]
 * 由 scripts 外的生成脚本从 bundle [中文内容已移除]
 *
 * [中文内容已移除]
 *  1. 页面存在但 SEO 头缺失（title/description/canonical）→ 无法被索引
 *  2. [中文内容已移除] → [中文内容已移除]
 */
const BRAND_DIR = 'brand';
if (exists(BRAND_DIR)) {
  const files = readdirSync(join(ROOT, BRAND_DIR)).filter((f) => f.endsWith('.html'));
  check(files.length > 0, `[中文内容已移除] ${files.length} 个页面`);

  const problems = { noTitle: [], noDesc: [], noCanon: [], shortBody: [], noLink: [] };
  const slugs = new Set(files.map((f) => f.replace(/\.html$/, '')));

  files.forEach((f) => {
    const t = read(join(BRAND_DIR, f));
    const titleM = t.match(/<title>([^<]+)<\/title>/)?.[1] ?? '';
    const descM = t.match(/name="description"\s+content="([^"]+)"/)?.[1] ?? '';
    const canon = t.match(/rel="canonical"\s+href="([^"]+)"/)?.[1] ?? '';

    if (titleM.length < 8) problems.noTitle.push(f);
    if (descM.length < 30) problems.noDesc.push(f);
    // canonical [中文内容已移除]
    if (!canon || !canon.includes(`/brand/${f}`)) problems.noCanon.push(f);

    // [中文内容已移除]
    const body = t.replace(/<script[\s\S]*?<\/script>/g, ' ')
      .replace(/<style[\s\S]*?<\/style>/g, ' ')
      .replace(/<[^>]+>/g, ' ');
    if (body.replace(/\s+/g, ' ').trim().length < 400) problems.shortBody.push(f);

    // [中文内容已移除]
    if (!/href="\.\.\//.test(t)) problems.noLink.push(f);
  });

  const show = (arr) => (arr.length ? arr.slice(0, 3).join(', ') + (arr.length > 3 ? ` 等 ${arr.length} 个` : '') : '');
  check(problems.noTitle.length === 0, `${files.length} [中文内容已移除]title`, show(problems.noTitle));
  check(problems.noDesc.length === 0, `${files.length} 个详情页都有 description`, show(problems.noDesc));
  check(problems.noCanon.length === 0, `${files.length} 个详情页 canonical [中文内容已移除]`, show(problems.noCanon));
  check(problems.shortBody.length === 0, `${files.length} [中文内容已移除] 400 字符`, show(problems.shortBody));
  check(problems.noLink.length === 0, `${files.length} [中文内容已移除]`, show(problems.noLink));

  // [中文内容已移除]
  check(!slugs.has('mouhongbei') && !files.some((f) => /烘焙|mouhongbei/i.test(f)),
    '[中文内容已移除]');

  // [中文内容已移除] 1 [中文内容已移除]
  const orphan = files.filter((f) => {
    const t = read(join(BRAND_DIR, f));
    const links = [...t.matchAll(/href="\.\/([a-z0-9-]+)\.html"/g)].map((m) => m[1]);
    return links.filter((l) => l !== f.replace(/\.html$/, '')).length === 0;
  });
  check(orphan.length === 0, `${files.length} [中文内容已移除]`, show(orphan));

  // 首页与 projects [中文内容已移除] —— 否则爬虫进不去
  [['index.html', '首页'], ['projects.html', '同类项目导航页']].forEach(([f, label]) => {
    if (!exists(f)) return;
    const t = read(f);
    const n = (t.match(/href="\.\/brand\/[a-z0-9-]+\.html"/g) || []).length;
    check(n >= files.length, `${label} 链向全部 ${files.length} 个详情页（实际 ${n}）`,
      `[中文内容已移除]`);
  });

  // sitemap [中文内容已移除]
  if (exists('sitemap.xml')) {
    const sm = read('sitemap.xml');
    const missing = files.filter((f) => !sm.includes(`/brand/${f}`));
    check(missing.length === 0, `sitemap.xml 含全部 ${files.length} 个详情页`, show(missing));
  }
} else {
  warn('brand/ 目录不存在', '[中文内容已移除]XX公司 [中文内容已移除]');
}

// ---------- 13g. [中文内容已移除] ----------

// projects.html 里的「本站 / [中文内容已移除]/fork [中文内容已移除]
// [中文内容已移除] `dujeongil-galaxy/shuangxiugou-guide` [中文内容已移除]
// [中文内容已移除] —— [中文内容已移除]
if (exists('projects.html')) {
  const pj = read('projects.html');

  const SELF_OWNED = [
    ['dujeongil-galaxy/shuangxiugou', '本站'],
    ['dujeongil-galaxy/shuangxiugou-guide', '姊妹站'],
  ];
  for (const [repo, tag] of SELF_OWNED) {
    // [中文内容已移除]
    const anchor = pj.indexOf(`>${repo}</a>`);
    check(anchor > 0, `projects.html 收录了 ${repo}`);
    if (anchor <= 0) continue;

    // 卡片范围：从该 <a> 往前找最近的 <li class="card，往后找最近的 </li>
    const cardStart = pj.lastIndexOf('<li class="card', anchor);
    const cardEnd = pj.indexOf('</li>', anchor);
    const card = pj.slice(cardStart, cardEnd);
    check(card.includes(`<span class="self-tag">${tag}</span>`),
      `projects.html 中 ${repo} 带「${tag}」标记`,
      `该卡片没有 self-tag「${tag}」→ [中文内容已移除]`);

    // [中文内容已移除]
    check(/<li class="card is-self"/.test(card),
      `${repo} 的卡片带 is-self 底色高亮`,
      '有 self-tag 但没有 is-self → [中文内容已移除]');
  }

  // [历史正文已移除]
  check(!/[中文内容已移除]/.test(pj),
    'projects.html [中文内容已移除]',
    '[中文内容已移除]');

  // [中文内容已移除]
  const sisterBad = ['姐妹站', '妹子站', '兄弟站'].filter((w) => pj.includes(w));
  check(sisterBad.length === 0,
    'projects.html [中文内容已移除]',
    `出现异写：${sisterBad.join('、')} —— [中文内容已移除]`);
}

// ---------- 13e. [中文内容已移除] ----------
/*
 * README [中文内容已移除]**[中文内容已移除]**的位置：
 *
 *   dujeongil-galaxy/shuangxiugou        → README.md
 *   dujeongil-galaxy/shuangxiugou-guide  → README.md[中文内容已移除]
 *   dujeongil-galaxy/shuangxiu-go-archive → 无推广位
 *
 * [中文内容已移除]**极易只改一处**[中文内容已移除] ——
 * 没人会点自己 README [中文内容已移除]
 *
 * [中文内容已移除]
 * 且 MAINTAINING.md [中文内容已移除]
 */
section('13e. 推广位链接');
if (exists('README.md')) {
  const rd = stripCssComments(read('README.md'));
  const AFF = 'v17mHNYv';
  // 只取「IP:8000/register?aff=[中文内容已移除] URL
  const affLinks = [...rd.matchAll(
    new RegExp(`https://(\\d+\\.\\d+\\.\\d+\\.\\d+):8000/register\\?aff=(\\w+)`, 'g')
  )].map((m) => ({ ip: m[1], aff: m[2] }));

  if (affLinks.length === 0) {
    note('README [中文内容已移除]');
  } else {
    check(affLinks.length >= 1,
      `推广位含 ${affLinks.length} 条线路（主推 + 备用）`,
      '备用线路缺失 —— [中文内容已移除] fallback');

    const badAff = affLinks.filter((l) => l.aff !== AFF);
    check(badAff.length === 0,
      `全部线路 aff 码一致（${AFF}）`,
      badAff.length ? `以下 aff 码不一致：${badAff.map((l) => l.ip).join(', ')}` : '');

    // IP [中文内容已移除]0.0.0.0 / 1.1.1.1 之类）
    const badIp = affLinks.filter((l) => !/^\d{1,3}(\.\d{1,3}){3}$/.test(l.ip));
    check(badIp.length === 0, '全部 IP 为合法四段形式',
      badIp.length ? `格式异常：${badIp.map((l) => l.ip).join(', ')}` : '');

    // [中文内容已移除]
    const ips = affLinks.map((l) => l.ip);
    check(new Set(ips).size === ips.length,
      '各线路 IP 互不重复',
      `重复的 IP：${ips.filter((x, i) => ips.indexOf(x) !== i).join(', ')}`);

    // [中文内容已移除] + 至少一条备用
    check(affLinks.length >= 2,
      '含备用线路（≥2 条）',
      `当前只有 ${affLinks.length} 条 —— [中文内容已移除]`);
  }

  // MAINTAINING.md 里提到旧 IP [中文内容已移除]**不应被批量替换**
  if (exists('MAINTAINING.md')) {
    const mn = read('MAINTAINING.md');
    check(!/^### 4\.6[\s\S]{0,400}?备用线路/m.test(mn),
      'MAINTAINING.md [中文内容已移除]',
      '4.6 [中文内容已移除]');
  }
}

/* ---------- 13f. [中文内容已移除] ----------
 *
 * 通道形态现为 **`.md` 模板**（GitHub 在 New issue [中文内容已移除]
 *
 *⚠️ 格式必须是 .md + frontmatter[中文内容已移除] `about` 不是 `description`
 *    ——提交 66297d9 用 .md + about [中文内容已移除]
 *    改成 .yml（issue form[中文内容已移除]
 *    [中文内容已移除] .yml。
 *
 * [中文内容已移除]
 * 「模板存在 + frontmatter 用 about + [中文内容已移除]
 */
section('13f. [中文内容已移除]');

const TICKET_TPL = '.github/ISSUE_TEMPLATE/a-ticket.md';
const TICKET_OPTIONS = [
  '功能建议', '问题反馈', 'Bug 报告', '双休报告',
  '双休名单加入', '双休名单移除', '[中文内容已移除]', '其他',
];

check(exists(TICKET_TPL), `存在工单模板 ${TICKET_TPL}`,
  'issueUrl [中文内容已移除] → 提交者点开会404');

if (exists(TICKET_TPL)) {
  const tk = read(TICKET_TPL);

  // frontmatter 必须是 --- [中文内容已移除] about（.md 模板的字段名）
  check(/^---\n/.test(tk), 'a-ticket.md 以 --- 开头（frontmatter）',
    '缺少开头 --- → GitHub 不识别为模板，New issue 时不显示');
  check(/^about:\s*\S/m.test(tk), 'a-ticket.md frontmatter 用 about 字段',
    '.md [中文内容已移除] about；写成 description 是 .yml issue form 的字段名，' +
    '.md 里不生效 → 选择框不显示');

  // 类型以 `- 【类型】` [中文内容已移除]
  const missing = TICKET_OPTIONS.filter((o) => !tk.includes(`- 【${o}】`));
  check(missing.length === 0,
    `a-ticket.md 含全部 ${TICKET_OPTIONS.length} 个工单类型`,
    `缺少：${missing.join('、')} —— 提交者无法归类`);

  // 目录里不能有 .yml issue form：实测有 .yml 时选择框空白
  const tdir = join(ROOT, '.github/ISSUE_TEMPLATE');
  if (existsSync(tdir)) {
    const badTpl = readdirSync(tdir).filter((f) => /\.ya?ml$/.test(f) && f !== 'config.yml');
    check(badTpl.length === 0,
      'ISSUE_TEMPLATE 下没有 .yml issue form',
      `存在 ${badTpl.join(', ')} —— .yml issue form 与 .md 模板混用时，` +
      'GitHub 的 New issue [中文内容已移除]');
  }

  // GitHub 的选择框**[中文内容已移除]**（用户实测：blank.md 排在 ticket.md 前，
  // 尽管 blank [中文内容已移除] a 开头。
  // 同时GitHub 自带的 "Blank issue" 条目要靠 config.yml 的 blank_issues_enabled: false 关掉。
  if (existsSync(tdir)) {
    const tpls = readdirSync(tdir).filter((f) => f.endsWith('.md')).sort();
    check(tpls.length > 0 && tpls[0] === 'a-ticket.md',
      '[中文内容已移除]',
      `当前模板排序为 [${tpls.join(', ')}] —— GitHub [中文内容已移除]` +
      '主模板不以 a [中文内容已移除]');

    // ⚠️ [中文内容已移除]read() 内部会拼 ROOT，
    //    [中文内容已移除] ROOT+绝对路径 → ENOENT → 读不到 → 恒判失败。
    const cfgRel = '.github/ISSUE_TEMPLATE/config.yml';
    check(exists(cfgRel) && /blank_issues_enabled:\s*false/.test(read(cfgRel)),
      'config.yml 关闭 GitHub 自带的 Blank issue 条目',
      '未设置 blank_issues_enabled: false → [中文内容已移除] GitHub 自带的 ' +
      '"Blank issue / Create a new issue from scratch"');

    // [中文内容已移除]
    //
    // 背景：GitHub 的 .md [中文内容已移除]**[中文内容已移除]**
    //（title [中文内容已移除]
    // [中文内容已移除]
    const tplFiles = readdirSync(tdir).filter((f) => f.endsWith('.md'));
    for (const tf of tplFiles) {
      const bodyTxt = read(`.github/ISSUE_TEMPLATE/${tf}`);
      check(/[中文内容已移除]/.test(bodyTxt),
        `${tf} [中文内容已移除]`,
        '缺少该提示 → GitHub [中文内容已移除]' +
        '[中文内容已移除]');
    }
  }

  // 全仓库 issues 链接统一指向 /issues（列表页）。
  // [中文内容已移除] issue 列表，再点 GitHub 的 New issue 才出模板选项，
  // 所以不能跳 /issues/new 或 /issues/new/choose，更不能带 query。
  //
  // ⚠️ 必须用**相对路径**遍历：read() 内部会拼 ROOT，
  //    而 readdirSync(ROOT) [中文内容已移除] → 直接传会拼成 ROOT+绝对路径 → ENOENT。
  const linkFiles = [];
  const NEW_URL = 'https://github.com/dujeongil-galaxy/shuangxiugou/issues';
  // 正确形态 = /issues 且紧跟 " 或 ' （无 /new、无 ?）。
  const OK_LINK = /dujeongil-galaxy\/shuangxiugou\/issues(?=["'])/;
  const collect = (rel) => {
    for (const e of readdirSync(join(ROOT, rel), { withFileTypes: true })) {
      if (e.name === '.git' || e.name === 'node_modules' || e.name === 'scripts') continue;
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) collect(p);
      else if (p.endsWith('.html')) {
        const txt = read(p);
        const hits = txt.match(/dujeongil-galaxy\/shuangxiugou\/issues[^"'\s<>)]*/g) || [];
        if (hits.some((h) => !OK_LINK.test(h + '"'))) linkFiles.push(p);
      }
    }
  };
  collect('');
  check(linkFiles.length === 0,
    '全仓库 issues 链接统一为 /issues 列表页（不带 /new、不带 query）',
    `仍有 ${linkFiles.length} [中文内容已移除]${linkFiles.slice(0, 5).join(', ')}\n` +
    `      正确形态是 ${NEW_URL}`);
}


/* ---------- 13g. [中文内容已移除] ----------
 *
 * [中文内容已移除] / [中文内容已移除] / [中文内容已移除]
 **[中文内容已移除]**：
 *
 * ① 原按钮文案 `+ 提交爆料 / 推荐` [中文内容已移除]
 *    [中文内容已移除]**被评C [中文内容已移除]**，
 *    [中文内容已移除]
 *
 * ② [中文内容已移除] / 有偿加班 / 提醒避雷），
 *    **[中文内容已移除]**。
 *
 * ③ [中文内容已移除]
 *    详情页底部→ `[数据异议]`（中立，13f 已锁）
 *    顶栏入口 → [中文内容已移除]
 *
 * ④ [中文内容已移除]
 *    [中文内容已移除]
 *
 * [中文内容已移除] / [中文内容已移除] / [中文内容已移除] / [中文内容已移除]
 */
section('13g. [中文内容已移除]');

if (exists('index.html') && exists('assets/index-YthXZ9eP.js')) {
  const ih = read('index.html');
  const bj = read('assets/index-YthXZ9eP.js');

  // ① 按钮改名
  check(/提交数据 \/ 申诉/.test(ih),
    '[中文内容已移除] / 申诉」',
    '[中文内容已移除] [中文内容已移除]');

  // bundle 里的「提交爆料 / 推荐」**必须保留** —— [中文内容已移除]
  // [中文内容已移除] bundle [中文内容已移除] ③ 项自相矛盾：
  //   删掉它 → keywords 拦截匹配不到 → [中文内容已移除]
  //   正确做法是保持 bundle 原文，由 index.html [中文内容已移除]
  check(/提交爆料 \/ 推荐/.test(bj),
    'bundle [中文内容已移除]index.html 运行时改写）',
    'bundle 里已无此文案 → keywords [中文内容已移除]');

  check(/replace\('提交爆料 \/ 推荐'/.test(ih),
    'index.html [中文内容已移除]',
    "缺少 replace('提交爆料 / 推荐', ...) → [中文内容已移除] / 推荐」");

  // ② [中文内容已移除] —— bundle 里没有 href[中文内容已移除]
  //    ⚠️ 注入验证时发现 `includes('提交爆料')` 判不出来：
  //    把整个 keywords 数组替换成 `[]` [中文内容已移除] →
  //    [中文内容已移除]**数组字面量本身**含有该关键词。
  const kwMatch = ih.match(/var\s+keywords\s*=\s*\[([^\]]*)\]/);
  check(!!kwMatch && /提交爆料/.test(kwMatch[1]),
    'keywords [中文内容已移除]',
    kwMatch
      ? `数组内容为 [${kwMatch[1].trim()}] —— [中文内容已移除] button [中文内容已移除]`
      : '未找到 keywords 数组定义 —— [中文内容已移除]');

  // ③ [中文内容已移除] issueUrl（issues 列表页）
  const HUB = 'https://github.com/dujeongil-galaxy/shuangxiugou/issues';
  const u1 = ih.match(/var\s+issueUrl\s*=\s*'([^']+)'/);
  check(!!u1 && u1[1] === HUB,
    '[中文内容已移除] issues 链接',
    u1 ? `issueUrl = ${u1[1]} —— 应为 ${HUB}` : '未找到 issueUrl 定义');

  // ④ [中文内容已移除] issueTitle / issueBody 残留
  check(!/issueTitle\s*=\s*encodeURIComponent/.test(ih) && !/issueBody\s*=\s*encodeURIComponent/.test(ih),
    '[中文内容已移除]issueTitle / issueBody）已清除',
    '[中文内容已移除] → [中文内容已移除] ticket.yml 内容会不同步');

  // ⑤ [中文内容已移除]
  check(/提交数据 \/ 申诉/.test(bj),
    'bundle [中文内容已移除] / 申诉」',
    '[中文内容已移除] [中文内容已移除]');
}

/* ---------- 13h. [中文内容已移除] ----------
 *
 * [中文内容已移除] issues 模板。
 *
 * [中文内容已移除]
 * bundle 里原本是 `<button onClick:()=>S(!0)>` —— onClick 打开的是
 * **站内 modal**[中文内容已移除] issues。
 * 只改文案不改 onClick [中文内容已移除]
 * [中文内容已移除] = [中文内容已移除]
 *
 * 所以 bundle 侧**同时摘掉了 onClick**，让 index.html 的关键词拦截
 * [中文内容已移除] issueUrl 的 <a>。
 *
 * [中文内容已移除] / onClick 已摘 / 关键词已加 / 目标 URL 与顶栏一致。
 */
section('13h. [中文内容已移除]');

if (exists('index.html') && exists('assets/index-YthXZ9eP.js')) {
  const ih = read('index.html');
  const bj = read('assets/index-YthXZ9eP.js');

  // ① bundle [中文内容已移除]
  check(/children:`联系我们`/.test(bj),
    '[中文内容已移除]',
    'bundle [中文内容已移除]');

  check(!/children:`提供数据`/.test(bj),
    'bundle [中文内容已移除]',
    '旧文案仍在 → [中文内容已移除]');

  // ② 那个按钮的 onClick 必须已摘 —— [中文内容已移除] modal
  //
  // ⚠️ 不能用 /`button`,\{[^`]*\},children:`联系我们`/ 这类正则：
  //    className [中文内容已移除][^`] 会被立刻截断 → 永远匹配不到。
  //    改用「定位文案 → 回溯到最近的 `button`,{ → 看这段里有没有 onClick」。
  const CONTACT_KEY = 'children:`联系我们`';
  const cIdx = bj.indexOf(CONTACT_KEY);
  check(cIdx > 0, '在 bundle [中文内容已移除]', cIdx > 0 ? '' : '未找到该文案');

  if (cIdx > 0) {
    const btnStart = bj.lastIndexOf('`button`,{', cIdx);
    const btnSeg = btnStart >= 0 ? bj.slice(btnStart, cIdx) : '';
    check(btnStart >= 0 && !/onClick/.test(btnSeg),
      '[中文内容已移除] onClick[中文内容已移除] modal）',
      btnSeg
        ? '仍带 onClick → [中文内容已移除]'
        : '未能回溯到 button [中文内容已移除] bundle 结构脱节');
  }

  // ③ index.html [中文内容已移除]
  const kwMatch = ih.match(/var\s+keywords\s*=\s*\[([^\]]*)\]/);
  check(!!kwMatch && /联系我们/.test(kwMatch[1]),
    'keywords [中文内容已移除]',
    kwMatch
      ? `数组内容为 [${kwMatch[1].trim()}] —— [中文内容已移除] button`
      : '未找到 keywords 数组定义');

  // ④ [中文内容已移除] issueUrl，且统一指向 issues 列表页
  //
  // ⚠️ 不能用 /联系我们[\s\S]{0,200}/ [中文内容已移除] URL」——
  //    它只证明附近 200 [中文内容已移除]
  const issueHub = 'https://github.com/dujeongil-galaxy/shuangxiugou/issues';
  const urlMatch = ih.match(/var\s+issueUrl\s*=\s*'([^']+)'/);
  check(!!urlMatch && urlMatch[1] === issueHub,
    '顶栏与页脚共用 issueUrl，指向 issues 列表页',
    urlMatch
      ? `issueUrl = ${urlMatch[1]} —— 应为 ${issueHub}`
      : '未找到 issueUrl 定义');

  check(!/isContact\s*\?/.test(ih) && !/blankIssueUrl/.test(ih),
    '[中文内容已移除] href[中文内容已移除]',
    '出现 isContact 三元或 blankIssueUrl → [中文内容已移除]');

  // ⑤ [中文内容已移除] / 推荐」）
  check(/replace\('提交爆料 \/ 推荐',\s*'提交数据 \/ 申诉'\)/.test(ih),
    '[中文内容已移除] / 申诉」',
    '缺少文案替换 → 顶栏会显示 bundle 原文「+ 提交爆料 / 推荐」');

  // ⑥ [中文内容已移除] 8 [中文内容已移除].md 形态，见 13f 说明）
  const ticketPath = '.github/ISSUE_TEMPLATE/a-ticket.md';
  check(exists(ticketPath), '工单模板 a-ticket.md 存在',
    `${ticketPath} 不存在 → 提交者在 New issue 里选不到模板`);
  if (exists(ticketPath)) {
    const tk = read(ticketPath);
    check(/^about:\s*\S/m.test(tk), 'a-ticket.md frontmatter 用 about 字段',
      '未找到 about: —— .md [中文内容已移除]');
    for (const want of ['功能建议', '问题反馈', 'Bug 报告', '双休报告',
                        '双休名单加入', '双休名单移除', '[中文内容已移除]', '其他']) {
      check(tk.includes(`- 【${want}】`), `a-ticket.md 含类型「${want}」`,
        '[中文内容已移除] → [中文内容已移除]');
    }

    // 类型必须以 `- 【类型】` 的**可复制格式**出现在正文里。
    //
    // ⚠️ 不要写成 `- 功能建议`[中文内容已移除] [中文内容已移除]
    //    维护者在issue [中文内容已移除]
    //    也不要靠 title [中文内容已移除]
    //    [中文内容已移除]
    // ⚠️ [中文内容已移除]
    //    /^title:\s*【/ 只匹配 `title: 【x】`，
    //    但实际文件里是 title: "【x】" —— [中文内容已移除]
    check(!/^title:\s*["']?【/m.test(tk),
      'a-ticket.md 不靠 title 预填强制类型',
      'title [中文内容已移除]' +
      '[中文内容已移除]');

    // [中文内容已移除]
    check(/^-\s+【.+】/m.test(tk),
      'a-ticket.md [中文内容已移除]',
      '[中文内容已移除]→ [中文内容已移除]');

    // [中文内容已移除]
    // [中文内容已移除]
    check(/^示例\s*[：:]/m.test(tk) && !/^例\s*[：:]/m.test(tk),
      'a-ticket.md [中文内容已移除]',
      '[中文内容已移除] [中文内容已移除]');

    // [中文内容已移除]
    // [中文内容已移除]
    //
    // ⚠️ 扫全文（含 frontmatter）。`about:` [中文内容已移除]
    //    [中文内容已移除] —— [中文内容已移除]
    const chatty = [
      [/挑一个/, '[中文内容已移除]'],
      [/选一个/, '[中文内容已移除]'],
      [/连\s*括号\s*一起\s*复制/, '[中文内容已移除]'],
      [/照抄/, '[中文内容已移除]'],
      [/你要说的事情/, '[中文内容已移除]'],
      [/写成这样/, '[中文内容已移除]'],
      [/请在下面选/, '口语化指令'],
      [/下面\s*8\s*个/, '「下面 8 [中文内容已移除] 8 项」'],
    ];
    for (const [re, why] of chatty) {
      check(!re.test(tk),
        `a-ticket.md [中文内容已移除]${why}）`,
        `${why}—— [中文内容已移除]`);
    }

    // frontmatter 的 about [中文内容已移除] GitHub 模板选择框里
    const aboutM = tk.match(/^about:\s*(.+)$/m);
    check(!!aboutM && !/挑一个|选一个|下面\s*8\s*个/.test(aboutM[1]),
      'a-ticket.md 的 about 副标题为书面语',
      aboutM
        ? `about = "${aboutM[1].trim()}" —— [中文内容已移除]`
        : '未找到 about 字段');
  }
}

// ---------- 14. 非部署副本 ----------
section('14. 非部署副本提示');
if (exists(NON_DEPLOY_COPY)) {
  const copyIds = new Set([...read(NON_DEPLOY_COPY).matchAll(/\{id:`([a-z0-9-]+)`,name:/g)].map((x) => x[1]));
  const realIds = new Set(brandCards.map((c) => c.id));
  const only = [...copyIds].filter((i) => !realIds.has(i));
  const absent = [...realIds].filter((i) => !copyIds.has(i));
  note(`根目录 ${NON_DEPLOY_COPY} [中文内容已移除] assets [中文内容已移除]${only.join(', ') || '无'}；副本缺：${absent.join(', ') || '无'}[中文内容已移除] assets/ 那份。`);
  ok('[中文内容已移除]');
}

// ---------- 14. 运行环境自检 ----------
section('15. 运行环境自检');

// [中文内容已移除]CI [中文内容已移除]
// [中文内容已移除]
// [中文内容已移除]CI 也会过」。
const inCI = !!process.env.CI;
note(inCI
  ? `运行环境：CI（CI=${process.env.CI}, GITHUB_ACTIONS=${process.env.GITHUB_ACTIONS || '未设置'}）`
  : '运行环境：本地');
note(`检出提交数：${Number.isFinite(commitCount) ? commitCount : '未知（非 git [中文内容已移除]'}，平台：${process.platform}`);
if (inCI && Number.isFinite(commitCount) && commitCount < 30) {
  warn('CI 中的 git [中文内容已移除]',
    '[中文内容已移除] CI 中真正生效，' +
    '请给 actions/checkout 设 fetch-depth: 0');
}

// ---------- 汇总 ----------
console.log('\n' + '='.repeat(60));
if (QUIET === false) {
  console.log(`通过 ${passCount} 项`);
}
if (warns.length) console.log(`\x1b[33m警告 ${warns.length} 项\x1b[0m[中文内容已移除]`);
if (errors.length) {
  console.log(`\x1b[31m错误 ${errors.length} 项\x1b[0m —— [中文内容已移除]`);
  process.exit(1);
}
console.log('\x1b[32m全部检查通过\x1b[0m');
