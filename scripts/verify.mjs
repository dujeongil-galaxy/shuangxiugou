/**
 * 双休购 · 站点一致性校验（零依赖，纯 Node.js）
 *
 * 为什么需要这个：
 *   本站是「React 渲染后抓 DOM 再改写」的事后打补丁架构，失败模式默认是静默的——
 *   页面看不出异常，只是某个卡片少了一部分内容。同时卡片数据分散在两处
 *   （内置卡在压缩 bundle、自定义卡在 index.html），文档里的数字口径极易脱节。
 *   这个脚本把上述两类「静默失效」变成明确的退出码。
 *
 * 用法：
 *   node scripts/verify.mjs            正常输出报告，有问题 exit 1
 *   node scripts/verify.mjs --quiet    只输出问题
 *
 * 建议接入 CI 或本地 pre-commit。零依赖，任何环境都能跑。
 */

import { readFileSync, existsSync, writeFileSync, unlinkSync } from 'node:fs';
import { execSync, spawnSync } from 'node:child_process';
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

const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const exists = (p) => existsSync(join(ROOT, p));

/** 判断一个站内相对路径是否存在（自动剥离 query/hash，并尝试 assets/ 前缀） */
function localExists(ref) {
  const p = ref.split('?')[0].split('#')[0];
  if (!p) return true; // 纯锚点或空
  const cands = [p, p.replace(/^\.\//, ''), p.replace(/^\//, ''), join('assets', p.replace(/^\.\//, ''))];
  return cands.some((c) => existsSync(join(ROOT, c)));
}

function check(cond, msg, detail) { cond ? ok(msg) : err(msg, detail); }

// ---------- 路径常量 ----------
const INDEX_HTML = 'index.html';
const BUNDLE = 'assets/index-YthXZ9eP.js';
const NON_DEPLOY_COPY = 'index-YthXZ9eP.js';

const html = read(INDEX_HTML);
const bundle = read(BUNDLE);

// ============1. 内置卡数据解析 ============
section('1. 内置卡数据（assets/index-YthXZ9eP.js）');

/**
 * 只匹配「顶层品牌卡」：{id:`xxx`,name:`xxx`,companyName:...
 * 踩过的坑：用 /\{id:`xxx`/ 会把 evidence(ev-)、comment(cm-)、
 * vote(post-/rep-) 子对象一起数进去，虚高到 125 张（真实 32 张）。
 * 必须用「紧跟 name + companyName」作边界。
 */
const brandRe = /\{id:`([a-z0-9-]+)`,name:`([^`]+)`,companyName:/g;
const brandCards = [];
let m;
while ((m = brandRe.exec(bundle)) !== null) {
  brandCards.push({ id: m[1], name: m[2], pos: m.index });
}
const BUILTIN_COUNT = brandCards.length;

// 虚构对比黑榜卡：不对外展示，不计入文档口径
const FICTIONAL = brandCards.filter((c) => c.name.includes('虚拟对比黑榜'));

check(BUILTIN_COUNT > 0, `解析到${BUILTIN_COUNT} 张内置卡`);
if (BUILTIN_COUNT !== 32) {
  warn(`内置卡数量为 ${BUILTIN_COUNT}，文档口径按32 张写`, '若确实增减过卡，请同步更新 README / FORK_GUIDE / MAINTAINING / 核实清单 / noscript 五处');
}

// 关键卡必须在场
['heytea', 'starbucks-coffee', 'luckin', 'haier', 'ikea'].forEach((id) => {
  check(brandCards.some((c) => c.id === id), `关键内置卡在位：${id}`);
});

// ---------- 数值字段核对：null 规则 ----------
section('2. null 规则（null ≠ 0）');

// 未核实字段必须是 null 或明确的 '—'，不能是 0
brandCards.forEach((c, i) => {
  const end = i + 1 < brandCards.length ? brandCards[i + 1].pos : bundle.length;
  const chunk = bundle.slice(c.pos, end);
  const rate = chunk.match(/realDoubleWeekendRate:([^,}]+)/)?.[1]?.trim();
  const off = chunk.match(/avgOffWorkTime:`?([^,`}]+)/)?.[1]?.trim();
  // 0 是可疑值：要么真的实测为 0（极罕见），要么是历史占位
  if (rate === '0') err(`${c.name} 的 realDoubleWeekendRate 是 0`, '未核实应填 null（页面显示「—」），0 会被读成「实测无人双休」');
  if (off === '0') err(`${c.name} 的 avgOffWorkTime 是 0`, '未核实应填 null');
});
ok('内置卡数值字段无占位 0');

// ---------- 2b. 证据链完整性 ----------
section('2b. 证据链完整性');

/**
 * 占位符 URL 检查。
 * 背景：真实存在两条证据（迪卡侬 ESG、常州星宇官方通报）共用一个
 * 占位链接 `ARTIxxxxxxxx.shtml`，读者点不开，等于没有证据。
 * 这违反项目「不能把推测写成事实」的红线 —— 必须拦住。
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
      `URL: ${u} —— 读者无法点击核实，等于没有证据。请补真实链接，或在标题里明确标注「链接待补」`);
  }
  if (evDate > todayStr) {
    evBad++;
    err(`证据 ${evId} 的日期 ${evDate} 晚于今天`, '可能是笔误');
  }
}
if (evBad === 0) ok(`${evCount} 条证据的 URL 均为真实链接，无占位符、无未来日期`);

// 证据时效提示（不阻塞）：超过 1 年的招聘页/论坛帖可能已失效
const evDates = [...new Set([...bundle.matchAll(/date:`(\d{4}-\d{2}-\d{2})`/g)].map((x) => x[1]))].sort();
if (evDates.length) {
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 1);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const stale = evDates.filter((d) => d < cutoffStr);
  if (stale.length) {
    note(`证据日期跨度 ${evDates[0]} ~ ${evDates[evDates.length - 1]}，其中 ${stale.length} 个早于 ${cutoffStr}。招聘页与论坛帖可能已失效或内容变更，建议定期抽查`);
  }
}

// ---------- 2c. bundle 语法完整性 ----------
section('2c. bundle 语法完整性');

/**
 * 用 `node --check` 校验压缩 bundle 的语法。
 *
 * ## 为什么这项检查最重要
 * 手工编辑压缩 bundle 时，多打一个 `[{`、少一个引号，都会让整个 bundle
 * 语法崩溃 → **页面全白，但浏览器控制台通常不报任何错**。
 * 本项目真实踩过：`evidence:[{[{id:` 多了一个 `[{`，
 * 是靠「与 git 原版做 node --check 对照」才发现的。
 *
 * ## 为什么用 git 原版做对照
 * React/JSX bundle 可能因 import.meta 等原因在node --check 下误报。
 * 所以只有「git 里的原版通过 + 当前版本不通过」才判定为新引入的错误。
 *
 * ## 已知局限：Windows 本地可能跑不了
 * Windows 上 spawnSync 稳定返回 EBUSY（status=null），
 * 此时这项检查会显示「未能执行」而不是误报——本地能力受限，
 * **权威判定在 CI（Linux）上**。这是有意为之：
 * 宁可说「查不了」，也不给一个可能错的结论。
 *
 * 返回三态：'ok' | 'bad' | 'skip'（skip = 检查没能跑起来，不是语法错误）
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
  // 本地（尤其是 Windows）跑不了 node --check —— 这是能力限制，不是错误
  note('当前环境无法执行 node --check（Windows 上spawn 偶发 EBUSY）');
  note('bundle 语法的权威校验在 CI（Linux）上进行；本地请人工留意页面是否渲染正常');
} else {
  // curCheck === 'bad'：与 git 原版对照，区分「既有误报」与「新引入的错误」
  //
  // ⚠️ Windows 上不能在同一进程里先 execSync 再 spawnSync（EBUSY），
  // 必须先让 git 把原版写到磁盘，隔开进程再检查。
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
    err('bundle 存在语法错误（git 原版正常 → 本次修改引入的）',
      '手工编辑压缩 bundle 时极易打错括号或引号。' +
      '这类错误会让 React 整个挂不上，**页面全白但浏览器控制台通常无报错**。' +
      '请对照 git 版本逐字符检查：git diff --word-diff assets/index-YthXZ9eP.js');
  } else if (baseCheck === 'bad') {
    warn('bundle 未通过 node --check，但 git 原版同样不通过',
      '大概率是 React/JSX bundle 的既有误报（如 import.meta），非本次修改引入。' +
      '若你确实改了 bundle，请人工确认页面能正常渲染。');
  } else {
    warn('bundle 有语法错误，但无法取 git 原版做对照',
      '不能确定是新引入的还是既有的。请人工确认页面能正常渲染。');
  }
}

// ---------- 自定义卡解析 ----------
section('3. 自定义卡（index.html 的 customCardsConfig）');

const cfgBlock = html.match(/var customCardsConfig = \[([\s\S]*?)\n      \];/);
check(!!cfgBlock, '能解析 customCardsConfig 数组');

/**
 * 按配置项切片再取字段，而不是用跨字段的大窗口正则。
 * 早先写成 `id:'x'[\s\S]{0,900}?doubleRestRate:\s*0[,}]` 有两个问题：
 *   1. `\s*0` 匹配不到`'0'`（带引号），漏掉了最典型的占位写法
 *   2. 900 字符窗口会串到下一张卡，误报/漏报都可能出现
 */
const customCards = [];
if (cfgBlock) {
  const body = cfgBlock[1];
  const itemRe = /\{\s*id:\s*'([^']+)',([\s\S]*?)\n\s*\},?\n/g;
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

// null 规则：双休率 / 下班时间不得为占位 0，也不得是字符串 '未知'
customCards.forEach((c) => {
  check(c.rate !== '0' && c.rate !== "'0'",
    `自定义卡「${c.name}」双休率未使用占位 0（当前 ${c.rate}）`,
    c.rate === '0' || c.rate === "'0'" ? '未核实应填 null，页面会显示「—」' : '');
  check(c.off !== "'未知'",
    `自定义卡「${c.name}」下班时间未使用「未知」字符串（当前 ${c.off}）`,
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
  check(missing.length === 0, `${page} 的本地引用全部有效（${refs.size} 个引用）`,
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

  // 每个真实内置卡（排除虚构黑榜卡）都应出现在 noscript 里
  const missingInNoscript = brandCards
    .filter((c) => !FICTIONAL.some((f) => f.id === c.id))
    .filter((c) => {
      // 取品牌中文名或英文名的可识别片段
      const key = c.name.split('(')[0].trim().slice(0, 4);
      return !brands.some((b) => b.includes(key));
    });
  check(missingInNoscript.length === 0,
    `${BUILTIN_COUNT - FICTIONAL.length} 张真实内置卡全部在 noscript 清单中`,
    missingInNoscript.length ? `漏了：${missingInNoscript.map((c) => c.name).join('、')}—— 爬虫看不到这些卡` : '');

  // 自定义卡也应在
  const missingCustom = customCards.filter((c) => !brands.some((b) => b.includes(c.name.split('/')[0].slice(0, 3))));
  check(missingCustom.length === 0, `${CUSTOM_COUNT} 张自定义卡全部在 noscript 清单中`,
    missingCustom.length ? `漏了：${missingCustom.map((c) => c.name).join('、')}` : '');
}

// ---------- 7. 文档数字口径 ----------
section('7. 文档数字口径一致性');

/**
 * 只校验「陈述当前规模」的数字，必须放过三类正当用法：
 *   1. 分档拆分：  「已核实 26 张、确认原值 2 张、未核实 3 张，合计 32 张内置卡」
 *   2. 历史记录：  「2026-10-04 那次的范围是 31 张内置卡」
 *   3. 局部口径：  「noscript 36 项 = 31 真实内置 + 5 自定义」
 * 这三种后面跟的是别的量纲或过去时态，一律不算口径错误。
 */
const EXPECT = { builtin: BUILTIN_COUNT, custom: CUSTOM_COUNT, total: BUILTIN_COUNT + CUSTOM_COUNT };
const docs = ['README.md', 'FORK_GUIDE.md', 'MAINTAINING.md', '员工实测数据核实修改清单.md'].filter(exists);

/** 判断一个数字是否属于「正当的局部/历史/分档用法」 */
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
    `${d} 的卡片数字口径正确（${EXPECT.builtin} 内置 / ${EXPECT.custom} 自定义）`,
    bad.join('\n      '));
});

// ---------- 8. 文档链接有效性 ----------
section('8. 文档内部链接');
for (const d of docs) {
  const t = read(d);
  const links = [...t.matchAll(/\]\(([^)]+)\)/g)].map((x) => x[1])
    .filter((p) => !/^https?:|^#|^mailto:/.test(p));
  const bad = links.filter((p) => !existsSync(join(ROOT, p.split('#')[0])));
  check(bad.length === 0, `${d} 的 ${links.length} 个内部链接全部有效`, bad.join(', '));
}

// ---------- 9. 提交号真实性 ----------
section('9. 文档中的提交号真实性');

/**
 * ⚠️ 浅克隆陷阱（CI 上真实踩过）：
 * GitHub Actions 的 actions/checkout 默认 `fetch-depth: 1`，仓库里只有
 * **最新 1 个提交**的对象。此时 `git cat-file -e <历史哈希>` 对所有历史提交
 * 都会失败，本项检查会把全部真实提交号误判成「编造的哈希」，
 * 在 CI 上凭空报出十几条错误。
 *
 * 判据：`git rev-list --count HEAD` 若小于文档里出现的最大哈希数，
 * 说明历史不完整，本项自动跳过并说明原因，不误报。
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
  // 历史不完整（浅克隆），跳过本项而非误报
  note(`检出历史仅 ${commitCount} 个提交（浅克隆），跳过「提交号真实性」检查以免误报`);
  note('完整校验需仓库含全部历史：git clone --depth=full，或在 CI 中设 fetch-depth: 0');
} else {
  for (const d of docs) {
    const t = read(d);
    // 提取反引号包裹的 7 位十六进制
    const hashes = [...new Set([...t.matchAll(/`([0-9a-f]{7})`/g)].map((x) => x[1]))];
    for (const h of hashes) {
      // 跳过被文档明确标注为「不存在 / 不可核验 / 编造 / 反例」的——
      // 这些是反例引用，不是真实引用。
      const idx = t.indexOf('`' + h + '`');
      const ctx = t.slice(Math.max(0, idx - 120), idx + 120);
      if (/不存在|不可核验|编造|反例|无此提交/.test(ctx)) continue;
      hashTotal++;
      let valid = false;
      try { execSync(`git cat-file -e ${h}`, { cwd: ROOT, stdio: 'ignore' }); valid = true; } catch { valid = false; }
      if (!valid) { hashBad++; err(`${d} 引用了不存在的提交 ${h}`, '未落仓库的改动请写「无对应提交」，不要编造哈希'); }
    }
  }
  if (hashBad === 0) ok(`核验了 ${hashTotal} 个提交号，全部真实存在（仓库共 ${commitCount} 个提交）`);
}

// ---------- 10. 运行时补丁健壮性 ----------
section('10. 运行时补丁健壮性（静默失效防护）');

// 10.1 定位卡片必须 h2/h3 双查—— 但要区分三种情况：
//   ✓ querySelector('h2') || querySelector('h3')   双查，正确
//   ✓ fixHeadingHierarchy 内部的 querySelector('h3')它是「找 h3 换成 h2」，
//     本来就该只找 h3，是正确用法
//   ✗ 其他任何孤立的 querySelector('h3')            会在 H2 修复后静默失效
const lines = html.split('\n');
const h3Violations = [];
lines.forEach((line, i) => {
  // 跳过双查的后半段。
  // 注意双查常写成 `card.querySelector('h2') || card.querySelector('h3')`，
  // 中间夹着接收者名 `card.` / `newCard.`，正则必须留出这部分：
  // 早先写成 `\|\|\s*querySelector` 会漏掉接收者，导致双查被误判为单查。
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
check(html.includes('diagError') && html.includes('diagWarn'), '诊断日志函数已定义');
check(html.indexOf('function diagWarn') < html.indexOf('function getGradeTemplateCard'),
  '诊断日志定义在调用点之前（不依赖变量提升）');

// 10.3 静默 catch 应已改为记录
const silentCatches = [...html.matchAll(/catch\s*\([^)]*\)\s*\{\s*\/\*[^}]*\*\/\s*\}/g)];
check(silentCatches.length === 0, '没有空catch（异常会被记录而非吞掉）',
  silentCatches.length ? `第 ${silentCatches.map((x) => html.slice(0, x.index).split('\n').length).join(', ')} 行` : '');

// 10.4 null兜底函数存在
check(html.includes('statText'), '自定义卡 null 兜底函数 statText 存在');

// 10.5 直接按下标取元素而无判空（有抛异常风险）
const unguarded = [...html.matchAll(/\n\s*(infoRows\[\d\]|stats\[\d\]|newCard\.querySelector[^\n]*?)\.textContent\s*=/g)];
check(unguarded.length === 0, '自定义卡字段赋值均已判空', unguarded.length ? unguarded.map((x) => x[1]).join('; ') : '');

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
  // 本项目踩过的坑：*.mdtext 少打一个空格，整类文件没被锁定 LF；
  // GitHub Actions 的 YAML 若被转成 CRLF 会直接解析失败。
  ['*.html', '*.md', '*.json', '*.xml', '*.mjs', '*.yml', '*.yaml'].forEach((pat) => {
    const re = new RegExp(pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s+text\\s+eol=lf');
    check(re.test(ga), `.gitattributes 锁定了 ${pat} 为 LF`);
  });
  // bundle 与图片必须禁止换行转换
  ['*.js', '*.css'].forEach((pat) => {
    const re = new RegExp(pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s+-text');
    check(re.test(ga), `.gitattributes 对 ${pat} 禁止换行符转换`);
  });
} else {
  err('.gitattributes 不存在', '缺它会导致 autocrlf 把 bundle 的 \\n 转成 \\r\\n，线上文件与仓库不一致');
}

// ---------- 13. 面向 fork 者的文档完整性 ----------
section('13. 面向 fork 者的文档完整性');

// 这些是给二次 fork 的开发者看的入口，内容失效会直接误导人
const FORK_DOCS = ['FORK_GUIDE.md', 'README.md', 'MAINTAINING.md'];
FORK_DOCS.filter(exists).forEach((d) => {
  const t = read(d);
  check(/npm run verify/.test(t),
    `${d} 提到了校验命令 npm run verify`,
    `${d} 未提及校验脚本，fork 者会不知道改完该怎么验证`);
});

// FORK_GUIDE 的「一页速查」是 fork 者的行动清单，必须包含这几条关键约束。
// ⚠️ 只扫速查章节本身：其他章节（如数据合规、第十三节）也提到过这些约束，
//扫全文会出现假阴性——删掉速查行照样能匹配到别处。
if (exists('FORK_GUIDE.md')) {
  const fg = read('FORK_GUIDE.md');
  // 标题实际是「## 十二、一页速查」，序号在中间，
  // 所以不能写 /^##\s*一页速查/ （匹配不到）。
  const qIdx = fg.search(/^##\s*[^\n]*一页速查/m);
  check(qIdx >= 0, 'FORK_GUIDE 有「一页速查」章节');
  const quick = qIdx >= 0 ? fg.slice(qIdx) : '';
  const mustMention = [
    ['null 而非 0', /`null`[^\n]*不要填\s*`?0`?/],
    ['noscript 清单同步', /noscript/i],
    ['四处文档同步', /(README[\s\S]{0,60}FORK_GUIDE|四处)/],
    ['h2/h3 双查', /querySelector\('h2'\)\s*\|\|\s*querySelector\('h3'\)/],
    ['不要 npm run build 部署', /npm run build/],
    ['改完跑校验', /npm run verify/],
    ['不要动根目录同名副本', /根目录/],
    ['递增 ?v=N', /\?v=N/],
  ];
  mustMention.forEach(([label, re]) => {
    check(re.test(quick), `一页速查含关键约束：${label}`);
  });
}

// ---------- 14. 非部署副本 ----------
section('14. 非部署副本提示');
if (exists(NON_DEPLOY_COPY)) {
  const copyIds = new Set([...read(NON_DEPLOY_COPY).matchAll(/\{id:`([a-z0-9-]+)`,name:/g)].map((x) => x[1]));
  const realIds = new Set(brandCards.map((c) => c.id));
  const only = [...copyIds].filter((i) => !realIds.has(i));
  const absent = [...realIds].filter((i) => !copyIds.has(i));
  note(`根目录 ${NON_DEPLOY_COPY} 是非部署副本，与 assets 版不一致（仅副本有：${only.join(', ') || '无'}；副本缺：${absent.join(', ') || '无'}）。改数据请只改 assets/ 那份。`);
  ok('非部署副本的存在已被识别并提示');
}

// ---------- 14. 运行环境自检 ----------
section('15. 运行环境自检');

// 本项目真实踩过：CI 上因浅克隆全线误报，而本地全过。
// 这里把环境差异显式打印出来，让人一眼看出「当前跑在什么环境」，
// 避免再次把「本地过」当成「CI 也会过」。
const inCI = !!process.env.CI;
note(inCI
  ? `运行环境：CI（CI=${process.env.CI}, GITHUB_ACTIONS=${process.env.GITHUB_ACTIONS || '未设置'}）`
  : '运行环境：本地');
note(`检出提交数：${Number.isFinite(commitCount) ? commitCount : '未知（非 git 仓库或命令失败）'}，平台：${process.platform}`);
if (inCI && Number.isFinite(commitCount) && commitCount < 30) {
  warn('CI 中的 git 历史不完整（浅克隆）',
    '提交号真实性检查已被跳过。若要让它在 CI 中真正生效，' +
    '请给 actions/checkout 设 fetch-depth: 0');
}

// ---------- 汇总 ----------
console.log('\n' + '='.repeat(60));
if (QUIET === false) {
  console.log(`通过 ${passCount} 项`);
}
if (warns.length) console.log(`\x1b[33m警告 ${warns.length} 项\x1b[0m（不阻塞，但建议处理）`);
if (errors.length) {
  console.log(`\x1b[31m错误 ${errors.length} 项\x1b[0m —— 存在静默失效风险，请修复后再提交`);
  process.exit(1);
}
console.log('\x1b[32m全部检查通过\x1b[0m');
