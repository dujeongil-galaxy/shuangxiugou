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

import { readFileSync, existsSync, writeFileSync, unlinkSync, readdirSync } from 'node:fs';
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

/**
 * 读文件并统一换行符为 LF。
 *
 * 为什么必须这么做：本机 git 的 autocrlf 会把检出的文本文件转成 CRLF，
 * 而后续所有正则都按 LF 写死。CRLF 下这些正则会**静默匹配失败**
 * —— 本次就因此得出「自定义卡 0 张」的错误结论，排查了很久。
 *
 * 只换行符，不改内容语义；对本来就是 LF 的文件是廉价操作。
 */
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
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

// ---------- 13b. SEO 基础配置 ----------
section('13b. SEO 基础配置');

/**
 * 这些是收录的最低门槛。缺任何一项都会静默掉收录，所以纳入自动检查。
 * 背景：曾拿到一份通用 SEO 诊断报告，逐项核实后发现本站已配置齐全，
 * 但这些项确实容易在后续改动中被误删 —— 所以要有脚本盯着。
 */

const SEO_PAGES = ['index.html', 'sponsor.html', 'projects.html', '404.html'];

// 0b. Google Search Console 验证文件
//
// 为什么必须检查：这是个纯文本文件，正常人看不出它被删了或内容坏了。
// 一旦被 git clean 掉或误改，Google 后台的验证会静默失效，
// 而且**不会主动通知你** —— 只有等发现收录断了才知道。
//
// Google 下发的文件格式为：
//   googlea540a6c2cd5f0e6c.html
//   内容：google-site-verification: googlea540a6c2cd5f0e6c.html
// 注意内容里的文件名与真实文件名一致 —— 这是校验的关键点：
// 若改过名或改过内容而另一方没跟着改，验证会失效。
// ⚠️ 不要写成 exists(ROOT) —— exists() 内部会再拼一次 ROOT，
// 结果是 join(ROOT, ROOT)，指向一个不存在的路径，恒返回 false。
// 目录判断直接用 readdirSync(ROOT)。
let googleFiles = [];
try {
  googleFiles = readdirSync(ROOT).filter((f) => /^google[0-9a-f]+\.html$/.test(f));
} catch {
  googleFiles = [];
}

if (googleFiles.length === 0) {
  warn('Google Search Console 验证文件缺失',
    '资源已验证通过，但仓库里找不到 google*.html。' +
    '若被误删，Google 后台的验证会静默失效且不通知 —— 需要重新验证并补回该文件。');
} else {
  googleFiles.forEach((f) => {
    const c = read(f);
    check(c.includes('google-site-verification'),
      `${f} 含 google-site-verification 标识`, `实际内容：${c.slice(0, 100)}`);

    // 文件内容里声明的文件名必须与真实文件名一致
    const declared = c.match(/google-site-verification:\s*(\S+)/)?.[1];
    check(!!declared && declared === f,
      `${f} 内容声明的文件名与实际文件名一致`,
      declared ? `内容声明「${declared}」，实际文件「${f}」—— 不一致会导致验证失败` : '内容里没解析出文件名');

    // 是个 HTML 文件，正文至少有内容（防止被清空）
    check(c.trim().length > 0, `${f} 内容非空`);
  });
}

// 0a. 站长平台验证文件（Bing）：存在还不够，内容必须合法
//
// 踩过的坑：仓库里的 BingSiteAuth.xml 一直能访问（HTTP 200），
// 但内容是上游时期遗留的旧密钥，Bing 验证直接报「身份验证密钥不正确」。
// 「文件存在」和「内容正确」是两件事 —— 只测前者会漏掉这类失效。
//
// 注意：这里只能校验结构合法性（十六进制、XML 结构）。
// 密钥与哪个站点绑定由 Bing 决定，脚本无从判断，只能靠后台报错发现。
if (exists('BingSiteAuth.xml')) {
  const bingXml = read('BingSiteAuth.xml');
  const keyMatch = bingXml.match(/<user>\s*([0-9A-Fa-f]+)\s*<\/user>/);
  check(!!keyMatch, 'BingSiteAuth.xml 含<user> 节点', `实际内容：${bingXml.slice(0, 120)}`);
  if (keyMatch) {
    // 不能写死长度：Bing 下发的密钥实测有 31 位也有 32 位
    // （上游遗留那份是 32 位，本次下发的是 31 位），
    // 写死任何长度都会把合法密钥判成错误 —— 这是本检查第一版的bug。
    check(/^[0-9A-Fa-f]{16,64}$/.test(keyMatch[1]),
      'BingSiteAuth.xml 的密钥是合法十六进制字符串',
      `实际 ${keyMatch[1].length} 位：${keyMatch[1]}`);
  }
} else {
  warn('BingSiteAuth.xml 不存在',
    '若要接入 Bing Webmaster Tools 的 XML 文件验证方式，需把 Bing 提供的文件放到仓库根目录。');
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

// 2. title 必须唯一（重复 title 会让搜索引擎困惑）
const titles = SEO_PAGES.filter(exists).map((pg) => read(pg).match(/<title>([^<]+)<\/title>/)?.[1]?.trim()).filter(Boolean);
check(new Set(titles).size === titles.length, `${titles.length} 个页面的 title 互不相同`,
  new Set(titles).size === titles.length ? '' : `重复：${titles.filter((t, i) => titles.indexOf(t) !== i).join(', ')}`);

// 3. index.html 必须有 canonical，且与站点地址一致
const idx = read('index.html');
const canon = idx.match(/rel="canonical"\s+href="([^"]+)"/)?.[1];
check(!!canon, 'index.html 有 canonical');
if (canon) {
  check(canon.startsWith('https://dujeongil-galaxy.github.io/shuangxiugou'),
    'canonical 指向正式站点地址', `当前：${canon}`);
}

// 4. sitemap 与 robots.txt
if (exists('sitemap.xml')) {
  const smRaw = readFileSync(join(ROOT, 'sitemap.xml'));
  const smText = smRaw.toString('utf8');
  const locs = [...smText.matchAll(/<loc>([^<]+)<\/loc>/g)].map((x) => x[1]);
  check(locs.length > 0, `sitemap.xml 含 ${locs.length} 条 URL`);

  // ---- sitemap 格式严格校验 ----
  //
  // 为什么只数 <loc> 不够：2026-10-10 Google 后台报「无法抓取」，
  // 而本地数出来 38 条完全正常。这类问题必须靠格式检查才能提前发现。
  //
  // 下面 5 项对应「提交前就能发现的失败模式」，比等 Google 报错快得多。

  // 1) 命名空间 —— Google 要求 sitemaps.org 命名空间，缺了直接判无效
  check(/<urlset[^>]+xmlns\s*=\s*["']http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9["']/.test(smText),
    'sitemap.xml 声明了 sitemaps.org 0.9 命名空间',
    'Google 要求此命名空间，缺失会导致「无法抓取」');

  // 2) 第一行必须是 XML 声明
  check(smRaw.subarray(0, 5).toString() === '<?xml',
    'sitemap.xml 第一行是 XML 声明',
    `实际开头：${JSON.stringify(smRaw.subarray(0, 30).toString())}`);

  // 3) 无 BOM —— BOM 会让严格解析器判定为非法
  check(!(smRaw[0] === 0xef && smRaw[1] === 0xbb && smRaw[2] === 0xbf),
    'sitemap.xml 无 BOM');

  // 4) LF 换行 —— CRLF 在部分解析器下会出问题，且与项目 LF 约定一致
  check(!smRaw.includes(0x0d),
    'sitemap.xml 使用 LF 换行（无 CR）',
    '检测到 CR 字节，可能是 CRLF');

  // 5) 无注释 —— sitemap 是机器读文件，注释是多余内容。
  //    收录策略这类人看的说明应写进 docs，而不是塞进 sitemap。
  check(!smText.includes('<!--'),
    'sitemap.xml 不含注释',
    '注释会让部分严格解析器判定无效；说明请写到 docs 或 generate-sitemap.py 顶部');

  // 6) 标签配平 —— 抓「少写一个 </url>」这类手误
  const openUrl = (smText.match(/<url>/g) || []).length;
  const closeUrl = (smText.match(/<\/url>/g) || []).length;
  check(openUrl === closeUrl && openUrl === locs.length,
    `sitemap.xml 标签配平（<url> ${openUrl} 个 / <loc> ${locs.length} 条）`,
    `标签数与 URL 数不一致，可能是编辑时漏写闭合标签`);

  const noindexPages = SEO_PAGES.filter((pg) => {
    if (!exists(pg)) return false;
    return /name="robots"\s+content="[^"]*noindex/.test(read(pg));
  });
  const inSitemap = noindexPages.filter((pg) => locs.some((l) => l.endsWith('/' + pg)));
  check(inSitemap.length === 0,
    'sitemap 未包含 noindex 页面',
    inSitemap.length ? `这些页声明了 noindex 却出现在 sitemap：${inSitemap.join(', ')}` : '');
} else {
  err('sitemap.xml 不存在', '搜索引擎需要它来发现页面');
}

if (exists('robots.txt')) {
  const rb = read('robots.txt');
  check(/Sitemap:/i.test(rb), 'robots.txt 声明了 Sitemap 路径');
  check(!/Disallow:\s*\/$/m.test(rb), 'robots.txt 未屏蔽整个站点根目录');
} else {
  err('robots.txt 不存在');
}

// 5. 结构化数据必须是合法 JSON（写成非法 JSON 比不写还糟）
const ldBlocks = [...idx.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((x) => x[1]);
check(ldBlocks.length > 0, `index.html 含 ${ldBlocks.length} 块结构化数据`);
ldBlocks.forEach((b, i) => {
  try {
    const obj = JSON.parse(b);
    check(!!obj['@type'], `结构化数据块 ${i} 合法且有 @type（${obj['@type']}）`);
  } catch (e) {
    err(`结构化数据块 ${i} 是非法 JSON`, `${e.message} —— 搜索引擎会静默忽略非法块`);
  }
});
// FAQPage 与 noscript 里的 FAQ 标题应保持一致
const hasFaqSchema = ldBlocks.some((b) => { try { return JSON.parse(b)['@type'] === 'FAQPage'; } catch { return false; } });
const noscriptFaq = /常见问题/.test(idx.match(/<noscript>([\s\S]*?)<\/noscript>/)?.[1] ?? '');
check(!(hasFaqSchema && !noscriptFaq) , 'FAQPage 结构化数据与页面可见内容一致',
  '声明了 FAQPage 但页面正文没有对应 FAQ，属于结构化数据滥用');

// 6. noscript 必须有实质正文（纯客户端渲染下这是爬虫唯一能读到的内容）
const nsHtml = idx.match(/<noscript>([\s\S]*?)<\/noscript>/)?.[1] ?? '';
const nsText = nsHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
check(nsText.length >= 600, `noscript 正文 ${nsText.length} 字符（≥600，爬虫唯一可读内容）`,
  nsText.length < 600 ? '内容过少，纯客户端渲染下会影响收录' : '');
check(/常见问题/.test(nsText), 'noscript 含常见问题区（覆盖长尾搜索词）');

// 7. IndexNow 推送脚本
check(exists('submit-indexnow.mjs'), 'IndexNow 推送脚本存在');
const wfDir = '.github/workflows';
if (exists(wfDir)) {
  const wf = join(wfDir, 'indexnow.yml');
  if (exists(wf)) {
    const y = read(wf);
    check(/INDEXNOW_KEY/.test(y), 'IndexNow workflow 使用密钥变量而非硬编码');
    check(!/[0-9a-f]{16,}/i.test(y), 'IndexNow workflow 未硬编码密钥');
  } else {
    note('未配置 IndexNow 的 GitHub Actions（可选，需要先在 Bing 后台申请密钥）');
  }
}

// ---------- 13b-2. 事实核查页的来源必须可点击 ----------
//
// 背景：这个页面的价值全在「可溯源」。来源写成纯文字时，
// 读者无法自己核对，站方就成了唯一信源 —— 这与本站
// 「证据链」的核心原则相悖。
//
// 检查三件事：①每条来源都有 http(s) 链接 ②有 target/rel
// ③正文里有指向来源的引用角标（说明结论与出处是绑定的）
section('13b-2. 事实核查页来源可溯源');
if (exists('jiahua-fact-check.html')) {
  const jh = read('jiahua-fact-check.html');

  const srcBlock = (jh.match(/<ul class="src">([\s\S]*?)<\/ul>/) || [, ''])[1];
  const srcItems = srcBlock.split(/<li>/).filter((x) => x.trim() && !x.trim().startsWith('</li'));
  const srcLinks = [...srcBlock.matchAll(/href="(https?:\/\/[^"]+)"/g)].map((x) => x[1]);

  check(srcLinks.length >= 4, `来源列表含 ${srcLinks.length} 条可点击链接`,
    '事实核查页的来源若为纯文字，读者无法自行核对');

  // 每条来源都必须有真实外链（不能只有标题）
  const itemsWithLink = srcItems.filter((x) => /href="https?:\/\//.test(x));
  check(itemsWithLink.length === srcItems.length,
    `${srcItems.length} 条来源全部带超链接`,
    `以下来源没有链接：${srcItems
      .map((x) => ((x.match(/src-title">([^<]+)/) || [, '?'])[1]))
      .filter((_, i) => !/href="https?:\/\//.test(srcItems[i]))
      .join(' / ')}`);

  // 新窗口打开必须带 noopener，防 tabnabbing
  const tgtAll = [...jh.matchAll(/<a\b[^>]*href="https?:\/\/[^"]+"[^>]*>/g)]
    .map((x) => x[0])
    .filter((a) => /target="_blank"/.test(a));
  check(
    tgtAll.length > 0 && tgtAll.every((a) => /rel="[^"]*noopener/.test(a)),
    `${tgtAll.length} 个外链均带 rel="noopener"`,
    tgtAll.filter((a) => !/rel="[^"]*noopener/.test(a))[0] || ''
  );

  // 正文角标：结论处必须能一键跳到出处
  const cites = (jh.match(/class="cite"/g) || []).length;
  check(cites >= 3, `正文含 ${cites} 处引用角标`, '结论与出处未绑定，读者需自己找对应关系');

  // 域名白名单：防止手滑贴进无关域名
  //
  // ⚠️ 必须扫**全页**外链，只扫来源区块会漏：
  //   别人（或我）在正文里贴一个陌生域名，一样会把读者引到不可信来源。
  //   本站自身域名（canonical / og:url / 站内导航）不算外链，先排除。
  const SITE_HOST = 'dujeongil-galaxy.github.io';
  const allExternal = [...jh.matchAll(/href="(https?:\/\/[^"]+)"/g)]
    .map((x) => x[1])
    .filter((u) => !u.includes(SITE_HOST));
  const allowed = [
    // 已核实的内容来源
    'xdkb.net', 'nfnews.com', 'toutiao.com', 'sohu.com',
    'scol.com.cn', 'cyol.com', '163.com', 'thepaper.cn', 'jiemian.com',
    // 本站自身的反馈入口（非内容来源，但同样是可信目标）
    'github.com',
  ];
  const badDomains = [...new Set(allExternal
    .map((u) => (u.match(/^https?:\/\/([^/]+)/) || [, ''])[1])
    .filter((d) => d && !allowed.some((a) => d.endsWith(a))))];
  check(badDomains.length === 0,
    `全页 ${allExternal.length} 个外链的域名均在已知媒体白名单内`,
    badDomains.length ? `出现未预期域名：${badDomains.join(', ')}` : '');
}

// ---------- 13b-3. 弹窗按钮的尺寸规格必须统一 ----------
//
// 背景（用户截图发现）：弹窗三个按钮高度参差。
// 根因是每个按钮各写一套 padding / font-size，注入第三个时又照抄一份，
// 而 flex 均分宽度后「在抖音中观看」六字放不下会折行 ——
// 折行的那个就比旁边两个高一截。
//
// 这类 bug 静态检查抓不到「视觉不齐」，但能抓住根因：
// 只要发现某个按钮又自己声明了尺寸，就报错。
section('13b-3. 弹窗按钮尺寸统一');
if (exists('douyin-prompt.css')) {
  const dyp = read('douyin-prompt.css');

  // 统一规则必须存在，且给出决定高度的关键属性
  const unified = (dyp.match(/\.dyp__acts > \* \{([^}]*)\}/) || [, ''])[1];
  check(unified.length > 0, '.dyp__acts > * 存在统一尺寸规则');
  for (const k of ['min-height', 'font-size', 'line-height', 'padding', 'border-radius', 'white-space']) {
    check(new RegExp(`${k}\\s*:`).test(unified), `统一规则含 ${k}（决定高度的属性）`);
  }

  // 三个按钮各自的规则里不得再出现尺寸属性（只允许配色/边框/交互）
  //
  // flex 的例外：`.dyp__go { flex: 2 1 0 }` 是**宽度分配权重**，
  // 不是尺寸 —— 主按钮文案更长（6 字 vs 4 字），等分时窄屏会折行。
  // 它的 flex-basis 仍是 0（与统一规则一致），只改grow 比例，
  // 不影响高度。高度只由 .dyp__acts > * 的 min-height 决定。
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
  check(offenders.length === 0, '各按钮未自行声明尺寸（尺寸统一由 .dyp__acts > * 给）',
    offenders.length ? `尺寸又分散到各按钮了：\n      ${offenders.join('\n      ')}` : '');

  // 注入脚本不得内联写样式 —— 那是「三套规格」的源头
  if (exists('factcheck-button.js')) {
    const fcb = read('factcheck-button.js');
    check(!/\.style\.cssText/.test(fcb), '注入脚本未内联 cssText');
    check(!/window\.matchMedia/.test(fcb),
      '注入脚本未用 JS 判断断点（窄屏顺序交给 CSS 的 @media）');
  }

  // 按钮文案不能太长导致折行（14px 字号下，桌面最窄 420px 面板里
  // 主按钮拿 2/4 宽度 ≈ 178px，中文 14px/字 → 最多 12 字）
  if (exists('douyin-prompt.js')) {
    const dp = read('douyin-prompt.js');
    const lt = (dp.match(/linkText:\s*'([^']+)'/) || [, ''])[1];
    if (lt) {
      const MAX = 10;
      const ok = lt.length <= MAX;
      check(ok, `主按钮文案「${lt}」共 ${lt.length} 字（上限 ${MAX}）`,
        ok ? '' : `超出会折行或被省略号截断 —— 需缩短文案，或调大 .dyp__go 的 flex-grow 权重`);
    }
  }

  /* ------------------------------------------------------------------
     配色可辨识性（用户反馈：「两个按钮不应该设置同颜色，不利于一眼识别」）

     原来「事实核查」与「以后再说」都是白底+ 淡米色边框 + 灰字，
     完全同色，扫一眼分不出 —— 而两者性质恰恰不同（内容入口 vs 关闭）。

     规则：任意两个按钮，**背景 / 文字 / 边框三个维度里至少要差两项**。
     只差一项（比如仅边框深浅）在实际尺寸下几乎看不出。

     ⚠️ 实现要点：同一 class 可能有**多条规则**（如 .dyp__go 既有 flex 权重
     又有配色）。必须合并全部规则再取属性 —— 只取第一条会漏掉配色，
     导致「看起来没差异」而实际是解析 bug。
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
  check(ambiguous.length === 0, '三个按钮两两之间至少差两个视觉维度（背景/文字/边框）',
    ambiguous.length ? `配色过于接近，实际分辨不出：\n      ${ambiguous.join('\n      ')}` : '');

  // 三级权重递进：主按钮必须有底色（实心/渐变），关闭按钮不应有底色
  const goBg = palette['在抖音中观看'].background || '';
  check(goBg.length > 0 && goBg !== 'transparent',
    `主按钮为实心/渐变底（视觉最重）：${goBg.slice(0, 42)}`);
  check((palette['以后再说'].background || '').match(/transparent|none|inherit/) !== null,
    '关闭按钮为透明底（视觉最轻）');
}

/* ------------------------------------------------------------------
   本站在正文中必须露出自己的 GitHub 仓库
   ------------------------------------------------------------------
   背景（用户截图）：搜「双休购 GitHub」，Google 排在前面的
   ZhiqingHeyi/shuangxiugou、MoFengr/shuangxiugou 都是 GitHub 仓库页，
   而本站 index.html 正文里**没有任何一处指向自己的仓库**——
   只有「提交更正用的 Issues」链接和「别人的仓库」。
   想找源码的人翻到最底部也找不到。

   这类缺失静默发生：链接删了、校验也全绿（因为没有任何检查覆盖它），
   只有用户在搜索结果页才发现。

   检查两处（缺一不可）：
     ① 可视页脚（friend-links-footer.js）—— 真人能看到
     ② noscript 正文（index.html）—— 纯客户端渲染下爬虫唯一能读到的正文
   ------------------------------------------------------------------ */
section('13b-4. 本站仓库入口');
const OWN_REPO = 'github.com/dujeongil-galaxy/shuangxiugou';
{
  const fcb = exists('friend-links-footer.js') ? read('friend-links-footer.js') : '';
  // 只认仓库首页，排除 issues/new 这类子路径（子路径不算「入口」）
  const fcbHasRepo = new RegExp(OWN_REPO.replace(/\//g, '\\/') + '[\'"]').test(fcb);
  check(fcbHasRepo, '可视页脚含指向本站仓库的链接');

  const idx = exists('index.html') ? read('index.html') : '';
  const nsBlock = (idx.match(/<noscript>([\s\S]*?)<\/noscript>/) || [, ''])[1];

  // 取出 noscript 里所有指向本站仓库的链接，筛出「仓库首页」
  //（排除 /issues/... 这类子路径 —— 有Issues 链接不等于暴露了仓库地址）
  const escOwn = OWN_REPO.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const nsRepoLinks = (nsBlock.match(
    new RegExp(`https?://${escOwn}(?:/[^\\s"'>]*)?`, 'g')
  ) || []).map((u) => u.replace(/[),.;]*$/, ''));
  const nsRepoHome = nsRepoLinks.filter((u) => !/\/issues(\/|$|\?)/.test(u));

  check(nsRepoHome.length > 0,
    `noscript 含仓库首页链接（${nsRepoHome.length} 处，爬虫唯一能读到的位置）`,
    nsRepoLinks.length > 0
      ? `只有 issues 子路径：${nsRepoLinks.join(', ')} —— 搜索引擎看不到仓库地址`
      : 'noscript 里没有任何指向本站仓库的链接');

  // 仓库链接必须指向正确的用户名/仓库名，避免改错一个字符就失效
  check(OWN_REPO === 'github.com/dujeongil-galaxy/shuangxiugou',
    '仓库地址与实际仓库一致', `期望 github.com/dujeongil-galaxy/shuangxiugou，实际检查 ${OWN_REPO}`);
}

// ---------- 13c. 编码完整性 ----------
section('13c. 编码完整性');

/**
 * 检测乱码字符（U+FFFD REPLACEMENT CHARACTER）。
 *
 * 背景：FORK_GUIDE.md 曾有一个标题里，「原始逻辑」的「始」字
 * 被截断成了两个U+FFFD（替换字符），显示为「原??逻辑」。
 * 注意：本注释刻意不复制那个坏字符，否则本脚本自己就成了乱码源头。
 * 上下文完全能推断原意，但**如果不主动扫，永远不会有人发现**：
 * GitHub 正常渲染、搜索功能正常、语法正确、校验脚本全绿。
 *
 * 危害：文档标题对读者不可读，且搜索引擎抓到的标题变成乱码，
 *直接损害收录质量——而这类问题恰好是所有其他检查都抓不到的。
 */
const ENCODING_SENSITIVE = [
  'README.md', 'FORK_GUIDE.md', 'MAINTAINING.md', 'DESIGN.md', 'LICENSE.md',
  '员工实测数据核实修改清单.md',
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
    '\n      U+FFFD 通常是字节被截断造成的（编码不匹配或写入中断）。');
});

// 标题里出现替换字符尤其严重：搜索引擎会直接抓到乱码标题
const mdTitles = [...read('FORK_GUIDE.md').matchAll(/^#{1,3}\s+(.+)$/gm)]
  .map((m) => m[1])
  .filter((t) => /\uFFFD/.test(t));
if (mdTitles.length === 0) ok('FORK_GUIDE.md 的所有标题无乱码');

// ---------- 13d. 品牌详情页 ----------
section('13d. 品牌详情页');

/**
 * 详情页是拿长尾搜索流量的核心手段（每个页面对应一个「XX公司 双休率」类查询），
 * 由 scripts 外的生成脚本从 bundle 提取数据后批量产出。
 *
 * 这些检查防止两类事故：
 *  1. 页面存在但 SEO 头缺失（title/description/canonical）→ 无法被索引
 *  2. 页面之间没有互链 → 爬虫无法遍历到，成为孤儿页
 */
const BRAND_DIR = 'brand';
if (exists(BRAND_DIR)) {
  const files = readdirSync(join(ROOT, BRAND_DIR)).filter((f) => f.endsWith('.html'));
  check(files.length > 0, `详情页目录存在，共 ${files.length} 个页面`);

  const problems = { noTitle: [], noDesc: [], noCanon: [], shortBody: [], noLink: [] };
  const slugs = new Set(files.map((f) => f.replace(/\.html$/, '')));

  files.forEach((f) => {
    const t = read(join(BRAND_DIR, f));
    const titleM = t.match(/<title>([^<]+)<\/title>/)?.[1] ?? '';
    const descM = t.match(/name="description"\s+content="([^"]+)"/)?.[1] ?? '';
    const canon = t.match(/rel="canonical"\s+href="([^"]+)"/)?.[1] ?? '';

    if (titleM.length < 8) problems.noTitle.push(f);
    if (descM.length < 30) problems.noDesc.push(f);
    // canonical 必须指向自己的正式地址
    if (!canon || !canon.includes(`/brand/${f}`)) problems.noCanon.push(f);

    // 正文体量：太短的页面没有索引价值
    const body = t.replace(/<script[\s\S]*?<\/script>/g, ' ')
      .replace(/<style[\s\S]*?<\/style>/g, ' ')
      .replace(/<[^>]+>/g, ' ');
    if (body.replace(/\s+/g, ' ').trim().length < 400) problems.shortBody.push(f);

    // 必须有回到首页的链接，否则无法被遍历
    if (!/href="\.\.\//.test(t)) problems.noLink.push(f);
  });

  const show = (arr) => (arr.length ? arr.slice(0, 3).join(', ') + (arr.length > 3 ? ` 等 ${arr.length} 个` : '') : '');
  check(problems.noTitle.length === 0, `${files.length} 个详情页都有有效title`, show(problems.noTitle));
  check(problems.noDesc.length === 0, `${files.length} 个详情页都有 description`, show(problems.noDesc));
  check(problems.noCanon.length === 0, `${files.length} 个详情页 canonical 均指向自身正式地址`, show(problems.noCanon));
  check(problems.shortBody.length === 0, `${files.length} 个详情页正文均超过 400 字符`, show(problems.shortBody));
  check(problems.noLink.length === 0, `${files.length} 个详情页都有返回首页的链接`, show(problems.noLink));

  // 虚构对比黑榜卡不应有对外可索引的页面
  check(!slugs.has('mouhongbei') && !files.some((f) => /烘焙|mouhongbei/i.test(f)),
    '虚构对比黑榜卡未生成详情页（虚构品牌不该对外发布）');

  // 每个详情页至少链向 1 个其他详情页（形成可爬的网）
  const orphan = files.filter((f) => {
    const t = read(join(BRAND_DIR, f));
    const links = [...t.matchAll(/href="\.\/([a-z0-9-]+)\.html"/g)].map((m) => m[1]);
    return links.filter((l) => l !== f.replace(/\.html$/, '')).length === 0;
  });
  check(orphan.length === 0, `${files.length} 个详情页均链向其他详情页（非孤儿页）`, show(orphan));

  // 首页与 projects 页都应链向详情页 —— 否则爬虫进不去
  [['index.html', '首页'], ['projects.html', '同类项目导航页']].forEach(([f, label]) => {
    if (!exists(f)) return;
    const t = read(f);
    const n = (t.match(/href="\.\/brand\/[a-z0-9-]+\.html"/g) || []).length;
    check(n >= files.length, `${label} 链向全部 ${files.length} 个详情页（实际 ${n}）`,
      `内链不足，爬虫可能无法遍历到部分详情页`);
  });

  // sitemap 应覆盖全部详情页
  if (exists('sitemap.xml')) {
    const sm = read('sitemap.xml');
    const missing = files.filter((f) => !sm.includes(`/brand/${f}`));
    check(missing.length === 0, `sitemap.xml 含全部 ${files.length} 个详情页`, show(missing));
  }
} else {
  warn('brand/ 目录不存在', '没有详情页就拿不到「XX公司 双休率」这类长尾流量');
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
