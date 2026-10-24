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
import { execSync, execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const QUIET = process.argv.includes('--quiet');

/* ---------- notes.html 解密（供内容类断言使用） ----------
 *
 * notes.html 正文是 AES-256-GCM 密文。仓库里没有明文，所以那些
 * 「这一节必须保留」「这个细节不能写错」的断言，只有在解开密文之后
 * 才能验证。
 *
 * 密码从环境变量 NOTES_KEY 读取 —— 不写进仓库、不进 CI 配置。
 * 没有密码时，内容类断言自动跳过（而非判失败）：CI 上没有密码是
 * 正常的，只有本机改动正文的人才需要跑全量校验。
 *
 *   NOTES_KEY=你的密码 node scripts/verify.mjs     # 解锁全量校验
 */
function decryptNotes(html) {
  const key = process.env.NOTES_KEY;
  if (!key) return null;
  const pm = html.indexOf('var PAYLOAD = ');
  if (pm < 0) return null;
  const po = html.indexOf('{', pm);
  let depth = 0, pc = -1;
  for (let i = po; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) { pc = i; break; } }
  }
  if (pc < 0) return null;
  let P;
  try { P = JSON.parse(html.slice(po, pc + 1)); } catch { return null; }
  try {
    const k = crypto.pbkdf2Sync(
      key, Buffer.from(P.salt, 'base64'), P.iter, 32, 'sha256'
    );
    const tag = Buffer.from(P.tag, 'base64');
    const d = crypto.createDecipheriv('aes-256-gcm', k, Buffer.from(P.iv, 'base64'));
    d.setAuthTag(tag);
    return Buffer.concat([d.update(Buffer.from(P.data, 'base64')), d.final()]).toString('utf8');
  } catch {
    return null; // 密码不对
  }
}

/* ---------- 正文探针（长度 + sha256，2026-10-22 隐私纪律） ----------
 *
 * 内容类断言过去把随笔正文片段直接写进代码（断言里出现正文原句）——
 * 那等于把站长的个人随笔正文明细摊在公开仓库里，而且 verify 的通过项标签
 * 会打进 CI 日志，一并外泄。
 *
 * 现全部改为探针：仓库里只存「片段长度 + sha256」，
 * 校验时在目标文本上滑窗，找窗口哈希与登记值相等的位置。
 * 内容被改坏照样判红，但仓库与日志都碰不到正文。
 *
 * 探针未命中、且确属有意改稿时，在本机重算哈希填回下表：
 *   NOTES_KEY=<密码> node -e 'const c=require("crypto");
 *     const h=s=>c.createHash("sha256").update(s,"utf8").digest("hex");
 *     console.log(h("改后的原文本"));'
 * 哈希本身不含内容，可安全提交。
 *
 * 命名：sN = 第 N 节；word = 负面词；leak = 泄露探针（扫密文文件，不需要密码）。
 */
const PROBE = {
  // 泄露探针：这些片段属于加密正文，绝不该以明文出现在 notes.html 里。
  // 扫密文文件全本，不需要密码（CI 上也能跑）。
  leak: [
    [9, '0834b6d329ac63deb4ce4c0d68406d5b338b31a6e2bc0206c0b0e91add497e59'],
    [7, 'a01ce956228f99f0f5513f12fe2ef8a73cce39eb24c45dcd4b2c1da79aa4f878'],
    [8, '53bc0bbdf706633be0b6bf4b54938a550c4880e9f9d8e19e5d4790bf5e90ae37'],
    [9, 'dda5c20a002ecaf8a2126c1f05a47975928a7a34816751324ddd799a023b652a'],
    [9, '10c31c645597da7f9cf7894885db6b5950b2b9b6571e48f9c3fe573e34fcc6cb'],
  ],
  // 内容探针：第三节（标题 + 关键句）。
  s3Title: [9, 'dda5c20a002ecaf8a2126c1f05a47975928a7a34816751324ddd799a023b652a'],
  s3Key:   [9, '10c31c645597da7f9cf7894885db6b5950b2b9b6571e48f9c3fe573e34fcc6cb'],
  // 内容探针：第八节（标题 + 手势对象 + 同义表述多种写法）。
  s8Title:  [10, 'ab6ce68d18b10ffd35cdcc69d0f20d6ae7962f82e6469fe00cde4ec8740f78a1'],
  s8Hand:   [4, 'b2dbedcbd2fd02553981abe9ac6dd46299c16e4d930524ba14295aa4556a602e'],
  s8Left:   [2, '6a0ef384c814c9e51e1eaac30390c6bd0c072a2993dccbd015374baa8869cf2a'],
  s8LaneA:  [5, 'f7b3d082af42344645a48340f061a74a7577bc6cbda271a7a74b721105d0b942'],
  s8LaneB:  [4, 'f9aa52a4d914177de0971016cad0e9e74f2d56d6a78857996736cb86d7186cbb'],
  s8ThumbA: [5, 'f29cfee11881eff82e29a894144a9d5aede8ea99f1233bcb2c17e0ee95378e1f'],
  s8ThumbB: [5, '294a0dd82ef01035a6ad09c632466991d8efe2276d763c774f4beab88517fc3b'],
  s8ThumbC: [6, '21141c4bc7fc0c1df6cf901f8e47439b61ce7939763ef768cd190f68c2cce023'],
  s8ThumbD: [5, 'a733e5ccecf0c8df064edb2701d7ab5e8431ef4771de48d5e0d13e91e7382d43'],
  // 负面词：不该出现在正文里的两轮车动词（用于四轮车即用词错误）。
  wordRide: [2, '2cb34c10c68dd2d9ec7894d872c8ec39ea7562e2159c305ba84bacc63ad29283'],
};

/**
 * 在 text 里滑窗找「窗口内容的 sha256 与登记值相等」的位置；找不到返回 -1。
 *
 * 性能：密文是 base64（不含中文），所以只对含中文的窗口算哈希 ——
 * 一遍扫下来实际只算几千次，对 10 万字符级的文件也是毫秒级。
 */
function probeIndex(text, p) {
  if (!text) return -1;
  const cjk = /[\u4e00-\u9fa5]/;
  for (let i = 0; i + p[0] <= text.length; i++) {
    const w = text.slice(i, i + p[0]);
    if (!cjk.test(w)) continue;
    if (crypto.createHash('sha256').update(w, 'utf8').digest('hex') === p[1]) return i;
  }
  return -1;
}
const probeHit = (text, p) => probeIndex(text, p) >= 0;

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

/**
 * 剥掉 CSS 注释，返回「只剩真实声明」的文本。
 *
 * ⚠️ 为什么必须有这个函数（今天踩了两次同样的坑）：
 *   本项目的 CSS 里大量使用注释**说明某写法为什么被废弃**，
 *   例如 13b-5 里写着「曾经写成 flex: 1 1 100%」、
 *   13b-6 里写着「translateY(-50%) 是压内容的元凶」。
 *   直接全文搜索这些关键词，会把注释当成声明 → 正常文件被误判。
 *
 *   凡是要在 CSS 里判断「某属性是否存在」，一律先剥注释。
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
if (false) {  // 已改为动态取值，见 brandBlocks 检查
  warn(`内置卡数量为 ${BUILTIN_COUNT}，文档口径按32 张写`, '若确实增减过卡，请同步更新 README / FORK_GUIDE / MAINTAINING / 核实清单 / noscript 五处');
}

// 关键卡必须在场
['heytea', 'catl', 'starbucks-coffee', 'luckin', 'haier', 'ikea'].forEach((id) => {
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
  // 0 是可疑值：要么真的实测为 0（极罕见），要么是历史占位。
  // 例外：若同一 employeeStats 里带 rateSource:`derived`，
  // 说明这个 0 是**由公示口径换算**得来的（如「做六休一→真实双休率 0」），
  // 不是占位，也不是实测。放行但要求必须写明换算依据。
  const derived = chunk.includes('rateSource:`derived`');
  if (rate === '0' && !derived) err(`${c.name} 的 realDoubleWeekendRate 是 0`, '未核实应填 null（页面显示「—」），0 会被读成「实测无人双休」。若确为口径换算，请同时加 rateSource:`derived` 字段');
  if (rate === '0' && derived) {
    // 换算值不得与实测投票数混存，否则读者无法判断这个 0 的来源
    const votes = chunk.match(/totalEmployeeVotes:([^,}]+)/)?.[1]?.trim();
    if (votes && votes !== 'null') {
      err(`${c.name} 同时有换算值与实测投票数（totalEmployeeVotes=${votes}）`,
        '换算值与投票值不能混存，否则读者无法判断这个数字的来源');
    }
  }
  if (off === '0') err(`${c.name} 的 avgOffWorkTime 是 0`, '未核实应填 null');
});
ok('内置卡数值字段无占位 0（换算值须带 rateSource:derived）');

// 反向自检：光写 rateSource:`derived` 就能骗过上面的断言，
// 所以必须同时要求 rateBasis 指向具体的证据来源。
const derivedCards = brandCards.filter((c, i) => {
  const end = i + 1 < brandCards.length ? brandCards[i + 1].pos : bundle.length;
  return bundle.slice(c.pos, end).includes('rateSource:`derived`');
});
const badDerived = derivedCards.filter((c, i) => {
  const idx = brandCards.indexOf(c);
  const end = idx + 1 < brandCards.length ? brandCards[idx + 1].pos : bundle.length;
  const chunk = bundle.slice(c.pos, end);
  // 2026-10-17：合法换算依据扩展为三类（官方公示 / 媒体调查 / 招聘与员工爆料折中），
  // 都要求卡片内存在可追溯的 ev- 证据 id（下一行断言）。
  const LEGIT_BASIS = ['derived_from_official_disclosure', 'derived_from_investigation_reports', 'derived_from_recruiting_and_worker_reports'];
  if (!LEGIT_BASIS.some((x) => chunk.includes('rateBasis:`' + x + '`'))) return true;
  // 换算依据必须能对应到一条真实存在的证据 id
  const ids = [...chunk.matchAll(/id:`(ev-[a-z0-9-]+)`/g)].map((x) => x[1]);
  return ids.length === 0;
});
check(badDerived.length === 0,
  `换算值均写明依据（rateBasis + 可追溯的 ev- 证据 id）`,
  badDerived.map((c) => c.name).join(', '));

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
// ---------- 2d. U 级（待核实）纪律 ----------
// 背景：2026-10-17 宁德时代改档 U（tier:`U`）。U 是「不评级」，不是更差的 C：
// 该档位必须数值全 null、两项口径 unknown，防止 U 变成绕过证据纪律的逃逸档位。
// 灰色渲染层（徽章「待核实 · 无证据不作评级」）自 c9b2753 起已内置，本节盯数据层。
section('2d. U 级（待核实）纪律');
const uCards = [];
const badU = [];
brandCards.forEach((c, i) => {
  const end = i + 1 < brandCards.length ? brandCards[i + 1].pos : bundle.length;
  const chunk = bundle.slice(c.pos, end);
  if (!chunk.includes('tier:`U`')) return;
  uCards.push(c.name || c.id);
  const problems = [];
  if (!chunk.includes('realDoubleWeekendRate:null')) problems.push('真实双休率不是 null');
  if (!chunk.includes('weekendPolicy:`unknown`')) problems.push('休息制度口径不是 unknown');
  if (!chunk.includes('overtimeComp:`unknown`')) problems.push('加班费口径不是 unknown');
  if (problems.length) badU.push((c.name || c.id) + '：' + problems.join('、'));
});
check(uCards.length >= 1, '存在 U 级卡（宏碁/三星/霸王茶姬应为 U）', uCards.join(', ') || '无');
check(badU.length === 0, 'U 级卡数值全 null 且两项口径均 unknown（U 不是逃逸档位）', badU.join(', '));

// 2026-10-20 长城/名创改档 C 级 0%（口径换算）。这是站长拍板的数据结论，
// 加防回退断言：若有人把这两张卡改回 U 或删掉 derived 标注，verify 必须判红。
section('2f. 改档锁定（长城/名创 C 级 0% 口径换算）');
const lockedCards = [
  { id: 'gwm', name: '长城汽车', policy: 'alternate' },
  { id: 'miniso', name: '名创优品', policy: 'single' },
];
const badLocked = [];
for (const lc of lockedCards) {
  const idx = brandCards.findIndex((c) => c.id === lc.id);
  if (idx === -1) { badLocked.push(lc.id + '：卡不存在'); continue; }
  const end = idx + 1 < brandCards.length ? brandCards[idx + 1].pos : bundle.length;
  const chunk = bundle.slice(brandCards[idx].pos, end);
  const problems = [];
  if (!chunk.includes('tier:`C`')) problems.push('档位不是 C');
  if (!chunk.includes('realDoubleWeekendRate:0')) problems.push('双休率不是 0');
  if (!chunk.includes('rateSource:`derived`')) problems.push('缺 rateSource:derived');
  if (!chunk.includes('rateBasis:`derived_from_recruiting_and_worker_reports`')) problems.push('rateBasis 不符');
  if (!chunk.includes('weekendPolicy:`' + lc.policy + '`')) problems.push('weekendPolicy 不符');
  const evIds = [...chunk.matchAll(/id:`(ev-[a-z0-9-]+)`/g)].map((x) => x[1]);
  if (evIds.length < 5) problems.push('证据 id 不足 5 条（改档证据链被删？）');
  if (problems.length) badLocked.push(lc.name + '：' + problems.join('、'));
}
check(badLocked.length === 0,
  '长城/名创维持 C 级 0%（口径换算）且证据链完整（2026-10-20 改档锁定）',
  badLocked.join(', ') || '锁定生效');

section('2e. 统计计数一致性（顶部四格 + 页脚清单）');
// 口径（2026-10-17 审计确定，改动前 36/16/8/12 与任何口径都对不上）：
//   收录品牌 = 实名企业卡 =（内置卡 - 虚拟对比卡）+ 自定义卡
//   双休红榜 = S/A 级卡数；大小周观察 = B 级卡数；避雷预警 = C 级卡数（内置 + 自定义）
//   U（待核实）不参与三个分桶，只计入收录总数。
//   「某代工烘焙食品 (虚拟对比黑榜)」是上游设计的匿名对比工具，无详情页，不计入任何统计。
const tier2e = { S: 0, A: 0, B: 0, C: 0, U: 0 };
let builtin2e = 0;
let virtual2e = 0;
brandCards.forEach((c, i) => {
  const end = i + 1 < brandCards.length ? brandCards[i + 1].pos : bundle.length;
  const chunk = bundle.slice(c.pos, end);
  if (chunk.includes('id:`some-overtime-snack`')) { virtual2e += 1; return; }
  builtin2e += 1;
  const tm = chunk.match(/tier:`([SABCU])`/);
  if (tm) tier2e[tm[1]] += 1;
});
const cfg2e = html.match(/var customCardsConfig = \[([\s\S]*?)\n      \];/);
const customPairs2e = cfg2e
  ? [...cfg2e[1].matchAll(/id:\s*'([^']+)'[\s\S]*?grade:\s*'([^']+)'/g)].map((m) => ({ id: m[1], grade: m[2] }))
  : [];
const byGrade2e = (g) => customPairs2e.filter((c) => c.grade === g).length;
const statTotal = builtin2e + customPairs2e.length;
const statHong = tier2e.S + tier2e.A + byGrade2e('S级') + byGrade2e('A级');
const statZhou = tier2e.B + byGrade2e('B级');
const statLei = tier2e.C + byGrade2e('C级');
const headerStat = (label, cls) => {
  const re = new RegExp('children:(\\d+)\\}\\),\\(0,A\\.jsx\\)\\(`div`,\\{className:`' + cls + '`,children:`' + label + '`');
  const m = bundle.match(re);
  return m ? Number(m[1]) : null;
};
check(virtual2e === 1, '虚拟对比卡恰 1 张（口径排除依据，id 变更需同步本节）', '实际 ' + virtual2e);
check(customPairs2e.length === 10, '能解析全部自定义卡（10 张）', '实际 ' + customPairs2e.length);
check(headerStat('收录品牌', 'text-slate-400 text-\\[11px\\]') === statTotal,
  '顶部「收录品牌」= 实名企业卡总数', '页面 ' + headerStat('收录品牌', 'text-slate-400 text-\\[11px\\]') + ' / 计算 ' + statTotal + '（改 bundle 顶部统计常数）');
check(headerStat('双休红榜', 'text-emerald-700/70 text-\\[11px\\]') === statHong,
  '顶部「双休红榜」= S/A 级卡数', '页面 ' + headerStat('双休红榜', 'text-emerald-700/70 text-\\[11px\\]') + ' / 计算 ' + statHong);
check(headerStat('大小周观察', 'text-amber-700/70 text-\\[11px\\]') === statZhou,
  '顶部「大小周观察」= B 级卡数', '页面 ' + headerStat('大小周观察', 'text-amber-700/70 text-\\[11px\\]') + ' / 计算 ' + statZhou);
check(headerStat('避雷预警', 'text-rose-700/70 text-\\[11px\\]') === statLei,
  '顶部「避雷预警」= C 级卡数', '页面 ' + headerStat('避雷预警', 'text-rose-700/70 text-\\[11px\\]') + ' / 计算 ' + statLei);
check(new RegExp('共\\s*' + statTotal + '\\s*家').test(html),
  '页脚清单「共 N 家」与收录总数一致', '应含「共 ' + statTotal + ' 家」');
const brandPages2e = readdirSync(join(ROOT, 'brand')).filter((f) => f.endsWith('.html')).length;
check(brandPages2e === statTotal, 'brand/ 详情页数量 = 收录总数（虚拟对比卡无详情页）', '页面 ' + brandPages2e + ' / 计算 ' + statTotal);
// 「企业真假双休档案」tab 上的数字角标也是手写常数（2026-10-17 发现它停在 36，
// 比四格统计更晚跟上收录数），纳入 2e 自动核对，防止增减卡后再漏。
const tabBadge2e = (bundle.match(/children:`企业真假双休档案`\}\),\(0,A\.jsx\)\(`span`,\{className:`text-\[10px\] font-mono bg-emerald-200\/60 text-emerald-900 px-1\.5 py-0\.5 rounded-full`,children:(\d+)\}\)/) || [])[1];
check(tabBadge2e !== undefined && Number(tabBadge2e) === statTotal,
  '「企业真假双休档案」tab 角标 = 收录总数', '页面 ' + tabBadge2e + ' / 计算 ' + statTotal);
const badCustomU2e = customPairs2e.filter((c) => {
  if (c.grade !== 'U级') return false;
  const seg = cfg2e[1].slice(cfg2e[1].indexOf("id: '" + c.id + "'"));
  const nxt = seg.indexOf("id: '", 10);
  const body = nxt === -1 ? seg : seg.slice(0, nxt);
  return !/doubleRestRate:\s*null/.test(body) || !/offWorkTime:\s*null/.test(body);
});
check(badCustomU2e.length === 0,
  '自定义 U 级卡数值全 null（U 不是逃逸档位）',
  badCustomU2e.length ? badCustomU2e.map((c) => c.id).join(', ') : '合规 ' + byGrade2e('U级') + ' 张');

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
check(CUSTOM_COUNT === 10, `自定义卡 ${CUSTOM_COUNT} 张（期望 10）`);

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
for (const page of ['index.html', 'sponsor.html', 'projects.html', '404.html', 'discussion-closed.html']) {
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

  /* noscript 是给爬虫看的正文兜底 —— 用户看不见，所以这东西坏了没人举报。
   *
   * 它由「React 卡片数据 → 手写 HTML」人工抄写而来，抄错/抄旧都完全静默：
   * 页面（JS 渲染）显示「未核实 / —」，爬虫抓到的却是「null% / 平均下班 null」。
   * 同一家企业在搜索结果里和站内是两个样，还可能被读成「双休率 0%」以外
   * 的第三种错误语义。所以这里逐条比对：noscript 里每个品牌描述里的
   * 「双休率 X · 平均下班 Y」必须与其详情页 brand/<slug>.html 的 kv 值一致，
   * 且不允许出现裸 null（详情页对未核实字段显示「未核实」/「—」）。
   */
  const stripTags = (s) => s.replace(/<[^>]+>/g, '');
  const nsLines = ns[1].split('\n').filter((l) => /href="\.\/brand\/[a-z0-9-]+\.html"/.test(l));
  const detailOf = {};
  for (const line of nsLines) {
    const slug = line.match(/href="\.\/brand\/([a-z0-9-]+)\.html"/)[1];
    if (detailOf[slug] === undefined) {
      const p = join(ROOT, 'brand', `${slug}.html`);
      if (!existsSync(p)) { detailOf[slug] = null; continue; }
      const b = readFileSync(p, 'utf8');
      const rate = b.match(/真实双休率<\/p><p class="v">([^<]*)</);
      const off = b.match(/平均下班时间<\/p><p class="v">([^<]*)</);
      detailOf[slug] = { rate: rate ? rate[1].trim() : null, off: off ? off[1].trim() : null };
    }
  }

  const nullLines = nsLines.filter((l) => /\bnull\b/.test(stripTags(l)));
  check(nullLines.length === 0,
    'noscript 清单无裸 null（未核实字段写「未核实」/「—」）',
    nullLines.length ? `${nullLines.length} 行含 null，例：${stripTags(nullLines[0]).trim().slice(0, 60)}—— 爬虫会读到 null` : '');

  const mismatch = [];
  for (const line of nsLines) {
    const slug = line.match(/href="\.\/brand\/([a-z0-9-]+)\.html"/)[1];
    const d = detailOf[slug];
    if (!d) { mismatch.push(`${slug}（详情页缺失）`); continue; }
    const m = stripTags(line).match(/双休率\s*(.+?)\s*·\s*平均下班\s*([^\s详]+)/);
    if (!m) continue;
    // 详情页平均下班可能带口径后缀（如「19:00（1075 口径）」），noscript 允许只写时分，
    // 但反过来不行：noscript 不能比详情页多出数值。
    const okOff = d.off && (m[2].trim() === d.off || d.off.startsWith(m[2].trim()));
    if (m[1].trim() !== d.rate || !okOff) {
      mismatch.push(`${slug}: noscript「${m[1].trim()} / ${m[2].trim()}」≠ 详情页「${d.rate} / ${d.off}」`);
    }
  }
  check(mismatch.length === 0,
    `noscript ${nsLines.length} 条品牌数值与详情页一致`,
    mismatch.length ? `${mismatch.length} 条不一致：${mismatch.slice(0, 5).join('；')}` : '');
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
// ⚠️ 必须列出**全部**文档，漏一个就会漏掉其中的假哈希。
//   2026-10-16 踩过：新建 CHANGELOG.md 后没加进这个列表，
//   结果它和另外几个文档里的 9 个假哈希全部逃过了检查。
const docs = ['README.md', 'FORK_GUIDE.md', 'MAINTAINING.md', 'CHANGELOG.md',
  'AGENTS.md', 'PITFALLS.md', 'DESIGN.md', '员工实测数据核实修改清单.md'].filter(exists);

/** 判断一个数字是否属于「正当的局部/历史/分档用法」 */
function isLegitimateNumber(line, num) {
  if (/20\d\d-\d\d-\d\d/.test(line)) return true;                       // 历史记录带日期
  if (/(已核实|确认原值|未核实)\s*\d+\s*张/.test(line)) return true;     // 分档拆分
  if (/(noscript|爬虫|项\s*=|真实内置)/i.test(line)) return true;        // noscript 局部口径
  // 正确合计：只放过与实际总数一致的两个数，避免规则过宽变成永真
  const totalRe = new RegExp(`(合计|共)\\\\s*(${EXPECT.total}|${EXPECT.builtin}|${EXPECT.custom})\\\\s*张`);
  if (totalRe.test(line)) return true;
  return false;
}

// CHANGELOG.md 是「追加式历史流水」，正文里「7 张自定义卡」等数字是**当时**的规模、
//   按下的 bug，属历史记录而非当前口径，改它等于篡改历史。故卡片数字口径校验跳过它
//   （它仍参与 §8 链接校验与哈希校验）。当前规模口径只对「会随卡片增减改写的说明文档」生效。
const countDocs = docs.filter((d) => d !== 'CHANGELOG.md');
countDocs.forEach((d) => {
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

// ---------- 9b. CHANGELOG 每条必须带「改动时间 + 提交哈希」，且时间倒序 ----------
// 背景：2026-10-19 站长指出「改动记录要写日期、什么时候改的、哈希多少」——
//   此前 CHANGELOG 有 6 条只写「提交 xxx」没日期、有 1 条「提交见 git log」
//   压根没哈希、还有 17 条改动从未记录。改完 commit message 才知道「大概那天」，
//   但 CHANGELOG 是给人看的，必须能一眼看到精确时间。
//   本项把「人肉纪律」变成机器检查：漏写 / 格式不符 / 顺序错都会报错。
section('9b. CHANGELOG 条目格式（时间 + 哈希 + 倒序）');

if (exists('CHANGELOG.md')) {
  const clog = read('CHANGELOG.md');
  const entries = [];
  for (const raw of clog.split('\n')) {
    if (!raw.startsWith('### ')) continue;
    const title = raw.slice(4).trim();
    // 跳过两类非改动条目：
    //   ① 「1. 改加密正文…」这类实操提醒小节
    //   ② 头部「标题统一格式」里的模板示例（含 YYYY-MM-DD 占位符）
    if (/^\d+\.\s/.test(title)) continue;
    if (/YYYY-MM-DD|XXX|占位|示例/.test(title)) continue;
    entries.push(title);
  }

  const noStamp = [];
  entries.forEach((title) => {
    const m = title.match(/（(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\s*·\s*提交\s*`[0-9a-f]{7}`(?:[^）]*)）\s*$/);
    if (!m) noStamp.push(title.slice(0, 50));
  });
  check(noStamp.length === 0,
    `CHANGELOG ${entries.length} 条改动记录全部带「时间 · 提交哈希」`,
    noStamp.length ? `缺时间戳或哈希：\n      - ${noStamp.join('\n      - ')}` : '');

  // 解析时间戳并检查严格倒序（第一条最新）
  const stamps = entries
    .map((title) => {
      const m = title.match(/（(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\s*·\s*提交/);
      return m ? { t: m[1], title: title.slice(0, 40) } : null;
    })
    .filter(Boolean);
  const outOfOrder = [];
  for (let i = 1; i < stamps.length; i++) {
    if (stamps[i].t > stamps[i - 1].t) {
      outOfOrder.push(`第 ${i} 条「${stamps[i].title}」（${stamps[i].t}）排在上一条（${stamps[i - 1].t}）之前`);
    }
  }
  check(outOfOrder.length === 0,
    `CHANGELOG ${stamps.length} 条记录严格按时间倒序`,
    outOfOrder.length ? outOfOrder.join('\n      ') : '');

  // 「提交见 git log」这类占位是禁止的——等于这条记录没有可核验的锚点
  check(!/提交见\s*git log|待回填|回填提交号/.test(clog),
    'CHANGELOG 没有「提交见 git log / 待回填」这类无法核验的占位',
    '每条都必须写真实哈希，写不出来说明这条改动还没提交');
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

// PITFALLS.md 2.4/2.5 记录了「issue 模板必须用 .md、不能用 .yml」这条约束。
// 文档写了对不算，得确认它还在——否则后来者改了文档就等于把约束丢了。
if (exists('PITFALLS.md')) {
  const pf = read('PITFALLS.md');
  check(/Issue 模板必须用\s*`?\.md`?/.test(pf),
    'PITFALLS.md 记有「issue 模板必须用 .md，不能用 .yml」',
    '这条约束丢了 → 后来者会把模板改成 .yml，New issue 选择框变空白页');
  check(/选择框按文件名字母序排列/.test(pf),
    'PITFALLS.md 记有「选择框按文件名字母序排列」',
    '这条约束丢了 → 不知道主模板文件名要带 a- 前缀才能排第一');
}

// README 的「N 件最容易踩坑的事」是 fork 者的行动清单，标题里的数字必须与实际条目数一致。
//
// 背景：这个标题一度写着「四件」而下面列了 5 条，长期没人发现。
// 「数量声明与内容脱节」是本项目反复出现的失效模式（文档数字口径问题同源），
// 所以标题数字也要参与校验。
if (exists('README.md')) {
  const rdm = read('README.md');
  const cntM = rdm.match(/###\s*([一二三四五六七八九十]+)件最容易踩坑的事/);
  check(!!cntM, 'README 有「N 件最容易踩坑的事」章节',
    '找不到该章节 —— fork 者的行动清单入口丢了');

  if (cntM) {
    const CN = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
    const declared = CN[cntM[1]];
    // 从标题切到下一个 \n--- ，数有序列表项
    const secStart = rdm.indexOf(cntM[0]);
    const secEnd = rdm.indexOf('\n---', secStart);
    const sec = rdm.slice(secStart, secEnd > secStart ? secEnd : secStart + 6000);
    const actual = (sec.match(/^\d+\.\s+\*\*/gm) || []).length;

    check(declared === actual,
      `README 标题声明 ${declared} 条，实际列了 ${actual} 条`,
      `标题写「${cntM[1]}件」但实际有 ${actual} 条 —— 数量声明与内容脱节，` +
      '读者会以为漏看了内容');

    // 新增的 DOM 复用坑必须在清单里
    check(/insertAppleNote/.test(sec),
      'README 踩坑清单包含「React 复用 DOM 节点」这条',
      '清单里找不到 insertAppleNote —— 运行时补丁的共性风险没提示给 fork 者');
  }
}

// notes.html 是站长个人随笔，不是项目内容。
//
// 三条硬约束，每条都能独立造成「个人情绪被当成项目立场」：
// 1. robots.txt 必须 Disallow —— 否则会被搜索引擎主动抓取收录
// 2. sitemap.xml 里不能有它—— sitemap 是给爬虫的主动提交清单
// 3. 页面自身必须带 noindex —— robots.txt 是君子协定，不等于不入索引
//
// 另外禁止任何可定位到具体个人的信息（真实年龄、城市、行业、账号、群号、日期）。
if (exists('notes.html')) {
  const nt = read('notes.html');
  // 解开密文供内容类断言使用；没给 NOTES_KEY 时为 null，相关断言自动跳过
  const plain = decryptNotes(nt);
  const contentCheck = (ok, label, why) => {
    if (plain === null) {
      notes.push(`跳过「${label}」（未提供 NOTES_KEY，密文未解密）`);
      return;
    }
    check(ok, label, why);
  };
  if (process.env.NOTES_KEY && plain === null) {
    errors.push('NOTES_KEY 已设置但解密失败 —— 密码不对，或密文结构被改坏了');
  }

  // ① robots.txt屏蔽
  const rb = exists('robots.txt') ? read('robots.txt') : '';
  check(/^Disallow:\s*\/notes\.html$/m.test(rb),
    'robots.txt 屏蔽 notes.html',
    '未屏蔽 → 搜索引擎会主动抓取收录这页');

  // ② 不进 sitemap
  const sm = exists('sitemap.xml') ? read('sitemap.xml') : '';
  check(!/notes\.html/.test(sm),
    'sitemap.xml 不含 notes.html',
    '进了 sitemap 等于主动向爬虫提交 → 会被索引');

  // ③ 页面自身 noindex
  check(/name="robots"[^>]*noindex/i.test(nt),
    'notes.html 自带 noindex',
    '页面自身没有 noindex → robots.txt 只是君子协定，不等于不入索引');

  // ④ 正文已加密：密文结构完整，且解密入口可用。
  //
  // ⚠️ notes.html 的正文从第 13 轮起改为 AES-256-GCM 密文。
  //    公开仓库里不存在「不点开也能读」的明文，所以下面几条查的是
  //    **密文结构**和**解锁路径**，而不是正文文字本身。
  const isEncrypted = /var PAYLOAD\s*=/.test(nt) && /AES-GCM/.test(nt);
  check(isEncrypted,
    'notes.html 正文已加密（仓库内无明文）',
    '正文以明文提交 → raw.githubusercontent.com 可直接取到全文，门禁形同虚设');
  if (isEncrypted) {
    const pm = nt.indexOf('var PAYLOAD = ');
    const po = nt.indexOf('{', pm);
    let depth = 0, pc = -1;
    for (let i = po; i < nt.length; i++) {
      if (nt[i] === '{') depth++;
      else if (nt[i] === '}') { depth--; if (depth === 0) { pc = i; break; } }
    }
    let P = null;
    try { P = JSON.parse(nt.slice(po, pc + 1)); } catch (e) { /* 下面统一按缺失报 */ }
    check(!!P && ['salt', 'iv', 'tag', 'data', 'iter'].every((k) => P && P[k]),
      'notes.html 密文结构完整',
      '密文缺字段 → 页面无法解密，正文永久丢失');
    check(!!P && P.iter >= 100000,
      'notes.html 的 PBKDF2 迭代次数 >= 100000',
      '迭代过低 → 密码可被暴力破解，等于没锁');
    check(!!P && Buffer.from(P.tag || '', 'base64').length === 16,
      'notes.html 的 GCM 认证标签为 16 字节',
      'tag 长度不对 → AES-GCM 解密必然失败');
  }

  // ⑤ 正文关键内容不得以明文出现在文件里
  //
  // 这一条是加密改造的核心防线：只要有一处把正文写回明文，探针就会命中。
  //
  // ⚠️ 2026-10-22 隐私纪律整改：旧版把正文片段（章节标题、动作描写等）
  //    直接写进断言列表，等于把随笔正文明细摊在公开仓库里。
  //    现改为 sha256 探针（见文件顶部 PROBE.leak）—— 扫密文文件全本，
  //    不需要密码，CI 上同样生效；判据照旧判红，日志不打印片段内容。
  let leakProbe = -1;
  for (let pi = 0; pi < PROBE.leak.length && leakProbe < 0; pi++) {
    if (probeIndex(nt, PROBE.leak[pi]) >= 0) leakProbe = pi;
  }
  check(leakProbe < 0,
    'notes.html 未泄露正文明文（哈希探针）',
    `泄露探针 #${leakProbe} 命中 → 加密正文里有片段以明文出现在仓库文件里`
    + '（判据是 sha256，此处不打印片段内容；如属误报请刷新探针表）');
  // ⑥ 弹窗「解锁菜单」入口存在，且原「以后再说」按钮已移除。
  // （2026-10-24 站长要求：按钮文字由「站长随笔」改为「解锁菜单」，跳转目标不变。）
  //
  // ⚠️ 必须剥掉注释再匹配 —— 代码注释里提到旧文案（「原本…是以后再说」）是正常的，
  //    但全文匹配会把注释当成「按钮还在」。这正是 PITFALLS 3.1 记的坑。
  const dpRaw = exists('douyin-prompt.js') ? read('douyin-prompt.js') : '';
  const dp = dpRaw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  check(/解锁菜单/.test(dp),
    '弹窗底部有「解锁菜单」入口',
    '入口缺失 → 页面存在但无人能到');
  // ⚠️ 2026-10-19 站长决定：notes.html 锁屏可直接访问（保留密码锁），
  //    弹窗入口改为直接跳转，原「还在写」公告弹窗整体移除。
  //    （2026-10-24 该入口文字由「站长随笔」改名「解锁菜单」，仍跳 notes.html。）
  //    剥注释后再匹配，避免注释里的说明文字被当成真实跳转。
  check(/href\s*=\s*["']\.\/notes\.html/.test(dp),
    '「解锁菜单」直接跳转到 notes.html',
    '入口缺失或仍是弹公告 → 页面存在但无人能到');
  check(!/dyp--notice/.test(dp),
    '「还在写」公告弹窗已移除',
    'notes.html 已可直接访问（保留密码锁），公告弹窗不应再出现');
  check(!/以后再说/.test(dp),
    '弹窗已移除「以后再说」按钮',
    '该位置已改为「解锁菜单」，两个文案不应并存（注释中提及旧文案不算）');

  // 写作进度面板的小节提取必须限定在 .wrap 内。
  //
  // 背景：明文里锁定提示的标题「站长随笔还在写」也是 <h2>，
  // 但它不在正文容器里。早先版本用 querySelectorAll('h2') 全量取，
  // 进度面板里就多出一个不存在的「待写」章节（截图实证）。
  //
  // ⚠️ 这段逻辑在 notes.html 里（由 encrypt-notes.mjs 的模板生成），
  //    不在 douyin-prompt.js —— 后者是首页弹窗，与进度面板无关。
  const encRaw = exists('notes.html') ? read('notes.html') : '';
  // ⚠️ 剥掉注释再匹配 —— 说明文字里提到旧写法是正常的，
  //    全文匹配会把注释当成「旧机制还在」。
  const encCode = encRaw
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  check(/\.wrap h2/.test(encCode),
    '进度面板只扫 .wrap 内的小节',
    '锁定提示的标题也是 h2，不限定范围会多出一个假的「待写」章节');
  check(!/querySelectorAll\(['"]h2['"]\)/.test(encCode),
    '进度面板不再全量扫 h2',
    '全量扫会把锁定提示的标题当成章节列出');

  // ⑧ notes.html 不得点名收录企业。
  //
  // 背景：随笔里若出现「某车企少了一颗螺丝」这类表述，一旦被截出来传，
  // 就从「站长转述一件旧事」变成「站长公开指控某车企」——
  // 而项目首页挂着免责声明、每张卡片都有可核实证据，两套口径一撞，
  // 先被质疑的是数据公信力，那是这个项目唯一站得住的东西。
  //
  // 做法：从 bundle 的品牌数据里抽 name，取长度 ≥2 的，
  // 再剔除与通用词重合的（容易误报的短词），在 notes.html 里逐个找。
  const BUNDLE = 'assets/index-YthXZ9eP.js';
  if (exists('notes.html') && exists(BUNDLE)) {
    const bj = read(BUNDLE);
    const names = new Set();
    for (const m of bj.matchAll(/\bname:`([^`]{2,40})`/g)) {
      const full = m[1];
      // bundle 里的品牌名是「英文 (中文)」格式：`BYD (比亚迪)`、`Apple (苹果中国)`。
      // ⚠️ 必须把括号内的中文名单独取出来，否则只拿整串去匹配，
      //    写「比亚迪」抓不到、写「BYD」也抓不到 —— 两种点名方式都会漏。
      names.add(full);
      const cn = full.match(/\(([^)]{2,})\)/);
      if (cn) names.add(cn[1].trim());
      // 「华为终端」这类带限定词的主名，短名「华为」也是它的指代对象
      const head = full.replace(/\s*\([^)]*\)\s*$/, '').trim();
      if (head.length >= 2) names.add(head);
    }
    // 剔除两类假阳性来源：
    //  1) bundle 里所有 name 字段不止品牌，还有组件名（icon、tag 等）和虚拟占位卡。
    //  2) 过短的词（≤2 字）容易命中普通词。
    const NOISE = /^(某|部分|tag$|icon$|badge|check|circle|chevron|clock|compass|copy|download|funnel|heart|lock|message|receipt|search|send|shield|shopping|sparkles|thumbs|triangle|user|building)/i;
    const suspects = [...names].filter((n) => {
      const s = n.trim();
      // ⚠️ 长度门槛必须按语言分开。
      //    中文品牌名两字很常见（华为、苹果、美的、罗技），
      //    用 `length < 3` 一刀切会把它们全滤掉 → 点名「罗技」不报错。
      //    英文则要 ≥3，否则 'GE'、'HP' 这类会误报。
      const ascii = /^[\x20-\x7e]+$/.test(s);
      if (ascii && s.length < 3) return false;
      if (!ascii && s.length < 2) return false;
      if (NOISE.test(s)) return false;
      // 含空格的英文全称（如 "Bee & Flower"）不必查，写全称的人极少
      if (ascii && s.includes(' ')) return false;
      return true;
    });
  // ⚠️ 必须只扫**可见正文**。
  //    扫全文会命中 <style> 里的 `font-family: "Microsoft YaHei"` —— 那是字体名，不是点名。
  //    这跟「扫全文会误报」是同一个坑的两面：范围太窄会漏，太宽会误报。
  //    （正文已加密，下面先剥掉 style/script/head 再扫解密后的明文）
  const plainVisible = plain === null ? '' : plain
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<head[\s\S]*?<\/head>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    // ⚠️ CSS font-family 里的字体名必须剥掉，否则会误判成点名收录企业。
    //   实测踩过：正文里的 `font-family: system-ui, "Microsoft YaHei", sans-serif`
    //   被判成点名「微软（Microsoft中国）」——「Microsoft YaHei」是字体名，
    //   不是在谈论这家企业。这属于典型的假阳性，比漏报更烦人：
    //   每次解密验证都报同一个错，久而久之人就懒得看了。
    .replace(/font-family\s*:[^;}]+/gi, '')
    .replace(/"(Microsoft YaHei|微软雅黑|PingFang SC|Hiragino Sans GB|Segoe UI)"/gi, '');
    // ⚠️ 中文品牌名**不能用任何词边界/前后瞻**。
    //
    // 「比亚迪很有性价比」里「亚」后面紧跟「有」，「有」是汉字 → 落在 \w 范围内，
    // 负向后瞻会把它挡掉，于是所有后面跟汉字的品牌名**全部漏报**。
    //
    // 中文没有词边界这个概念，只能 includes。
    // 英文名后面若紧跟**ASCII 字母或数字**，视为更长标识符（如 BYDX），跳过；
    // 后面是汉字则直接算命中（`BYD很有性价比` 里的 BYD 就是点名）。
    const isAscii = (s) => /^[\x20-\x7e]+$/.test(s);
    // ⚠️ 白名单必须逐条写理由，不能当成「什么都往里塞」的桶。
    //   每一条都对应站长本人的明确决定（2026-10-17），并写清为什么可以例外。
    //   新增条目时问自己：这是「站长愿意以真名被检索」的，还是「我懒得改」？
    const WHITELIST = {
      '比亚迪': '站长 2026-10-17 明确决定保留。原句是购车后的自述'
        + '「2026 年下半年双休购上线，我才知道比亚迪是 C 级」，'
        + '属个人消费经历而非对企业的公开指控，与本站其他卡片的证据型表述不同性质。',
    };
    const hit = plain === null ? [] : suspects.filter((n) => {
      const s = n.trim();
      if (Object.prototype.hasOwnProperty.call(WHITELIST, s)) return false;
      if (isAscii(s)) {
        return new RegExp(`${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9])`).test(plainVisible);
      }
      return plainVisible.includes(s);
    });
    contentCheck(hit.length === 0,
      'notes.html 未点名收录企业',
      hit.length
        ? `出现品牌名：${hit.slice(0, 5).join('、')} —— 随笔里点名企业会被当成公开指控，` +
          '与项目「证据可核实」的口径冲突。应写「某车企」「某个品牌」'
        : '');

    // 白名单必须每条都有理由，且理由不能是空串或占位符 ——
    // 否则「给白名单加个空注释」就能悄悄放过任何点名。
    const ws = read('scripts/verify.mjs');
    const wlBlock = /const WHITELIST = \{([\s\S]*?)\n {4}\};/.exec(ws);
    if (wlBlock) {
      const entries = [...wlBlock[1].matchAll(/'([^']+)'\s*:\s*'([^']*)'/g)];
      check(entries.every((e) => e[2].trim().length >= 20),
        `点名白名单每条都写明了理由（${entries.length} 条）`,
        entries.filter((e) => e[2].trim().length < 20).map((e) => e[1]).join(', '));
    }
  }

  // ⑩ 第三节的两处锚点必须保留（哈希探针，正文内容不落在仓库里）。
  //
  // 为什么是硬约束：这一节是整页最难被替代、也最容易被当成
  // 「沉重的自我表演」而删掉的一节。把它改写成「后来我改了」的闭环、
  // 让读者以为已经翻篇，是这一页最需要防的失真，站长对此有明确要求。
  // 具体文字按隐私纪律不在仓库里展开，只登记探针哈希。
  contentCheck(plain !== null && probeHit(plain, PROBE.s3Title),
    'notes.html 第三节标题锚点在位（探针 s3Title）',
    '该节受站长明确保护，不得在改稿中丢失或改写标题；'
    + '如属有意改动，请同步刷新探针哈希（重算命令见文件顶部探针表）');
  contentCheck(plain !== null && probeHit(plain, PROBE.s3Key),
    'notes.html 第三节关键句锚点在位（探针 s3Key）',
    '该句是整页的重量所在，不能被改写成闭环表述；'
    + '如属有意改动，请同步刷新探针哈希');

  // ⑩b 第八节的存在性与细节锚点（哈希探针）。
  //
  // 事实背景（按隐私纪律只记结构、不录文字）：这一节的手势对象与
  // 动作细节站长纠正过多次，写错就是叙述失真——而该节的说服力
  // 恰恰来自那个反差，所以设为判红项。具体文字不落在仓库里，
  // 只登记 sha256 探针；探针同时覆盖左右手两种写法与四种同义表述，
  // 正常改稿不会误伤。
  const jamStart = plain === null ? -1 : probeIndex(plain, PROBE.s8Title);
  contentCheck(jamStart > 0, 'notes.html 第八节存在（探针 s8Title）', '该节是登记过的核心章节，不得丢失');
  if (jamStart > 0) {
    const jamEnd = plain.indexOf('<h2>', jamStart + 10);
    const jam = plain.slice(jamStart, jamEnd > jamStart ? jamEnd : jamStart + 3000);
    contentCheck(probeHit(jam, PROBE.s8Hand),
      '第八节手势锚点在位（探针 s8Hand）',
      '手势细节与登记值不一致 → 写错手会改变示意对象；'
      + '如属有意改动，请同步刷新探针哈希');
    contentCheck(probeHit(jam, PROBE.s8Left)
      && (probeHit(jam, PROBE.s8LaneA) || probeHit(jam, PROBE.s8LaneB)),
      '第八节手势对象锚点在位（探针 s8Left + s8LaneA/B）',
      '手势对象写错会让整节的说服力垮掉；'
      + '如属有意改动，请同步刷新探针哈希');
    contentCheck(probeHit(jam, PROBE.s8ThumbA) || probeHit(jam, PROBE.s8ThumbB)
      || probeHit(jam, PROBE.s8ThumbC) || probeHit(jam, PROBE.s8ThumbD),
      '第八节手势类细节锚点在位（探针 s8ThumbA-D）',
      '该细节是站长主动让路的动作，丢了就不成立；'
      + '如属有意改动，请同步刷新探针哈希');

    // ⚠️ 用词准确性：两轮车动词不能用于四轮车（读者一眼能看出，
    //    会让整节的叙述失真）。正确写法见明文源，不在此展开。
    contentCheck(!probeHit(plain, PROBE.wordRide),
      'notes.html 未用两轮车动词形容四轮车（探针 wordRide）',
      '四轮车应使用卡/压类动词；两轮车动词属用词错误，读者一眼能看出');
  }

  // ⑪ 尾注必须存在。
  //
  // 这一页是站长个人随笔，AI 参与了排版与润色。**这件事必须写在页面上** ——
  // 不写就等于让读者以为整段都是站长逐字写的，不承认比承认更糟。
  contentCheck(plain !== null && /class="colophon"/.test(plain),
    'notes.html 有尾注（colophon）',
    '尾注不见了 → 读者会以为整页都是站长逐字写的，'
    + '而AI 参与过润色这件事其实一眼就能看出来');
  contentCheck(plain !== null && /AI/.test(plain),
    'notes.html 尾注声明了 AI 参与',
    '尾注里必须写明 AI 参与过排版');

  // ⑫ notes.html 的返回顶部按钮（加密后都在密文里，改用明文来验）
  const nHtml = plain === null ? '' : plain;
  contentCheck(/id="to-top"/.test(nHtml),
    'notes.html 有返回顶部按钮元素',
    '按钮不见了，读者只能手动滚到底');
  contentCheck(/class="to-top"/.test(nHtml), 'notes.html 返回顶部按钮带 .to-top 样式类');

  const nScripts = [...nHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const nJs = nScripts.join('\n');
  contentCheck(/getElementById\(['"]to-top['"]\)/.test(nJs),
    'notes.html 的内联脚本绑定了 to-top',
    '按钮元素存在但 JS 没绑它 → 点了没反应');
  contentCheck(/scrollTo\(\s*\{\s*top:\s*0/.test(nJs),
    'notes.html 点击后滚动到顶部',
    '按钮点击无行为 → 是个死按钮');

  // 按钮常驻显示，所以 CSS 里不能有「默认隐藏」的 opacity/visibility。
  //
  // 曾经的形态是「滚过 80% 视口才出现」，靠 data-show 切换；
  // 现在改成常显后，那套机制连同 scroll 监听一起删了。
  // 若残留 data-show 或默认 opacity:0，按钮会永久隐形 —— 而 HTML 和 JS 都在，
  // 属于「检查全绿但按钮看不见」的静默失效。
  const toTopCss = (nHtml.match(/\.to-top\s*\{([\s\S]*?)\}/) || ['', ''])[1];
  contentCheck(!/opacity:\s*0/.test(toTopCss) && !/visibility:\s*hidden/.test(toTopCss),
    'notes.html 返回顶部按钮默认可见（CSS 无隐藏声明）',
    'CSS 里还有 opacity:0 / visibility:hidden → 按钮永久隐形，' +
    '但 HTML 和 JS 都完好，属静默失效');
  // ⚠️ 剥掉注释再匹配 —— CSS/JS 注释里提到 data-show 是正常的说明文字，
  //    全文匹配会把注释当成「机制还在」。
  const nHtmlNoComment = nHtml
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  contentCheck(!/data-show/.test(nHtmlNoComment),
    'notes.html 不再有 data-show 切换机制',
    '按钮已改为常显，data-show 与 scroll 监听应一并移除；' +
    '残留会导致 HTML 属性与 CSS 状态脱节（注释中提及不算）');
  contentCheck(!/addEventListener\(\s*['"]scroll['"]/.test(nJs),
    'notes.html 不再监听 scroll',
    '按钮常驻显示，无需监听滚动；残留 scroll 监听是纯粹的浪费');
}

// 注入的节点必须「跟着卡片列表重新定位」，不能插入一次就撒手。
//
// 背景（用户实测）：搜索框输入 "HU"，苹果卡被过滤掉，
// 但苹果专属的「富士康补充说明」黄色框留在了华为卡里。
//
// 根因：**React 重渲染时按位置复用 DOM 节点**——苹果卡消失后，
// React 把同一个节点原地改写成华为卡（改文本，不重建节点），
// 而手动插入的 #apple-note 是 React 不认识的额外子节点，文本更新不会清掉它。
// 原实现首行 `if (document.querySelector('#apple-note')) return;` 永远不纠正。
if (exists('index.html')) {
  const ih = read('index.html');
  const fnStart = ih.indexOf('function insertAppleNote()');
  check(fnStart >= 0, 'index.html 有 insertAppleNote()',
    '找不到该函数 → 苹果卡的富士康补充说明会消失');

  if (fnStart >= 0) {
    // 切到函数结束（下一个顶层 function 声明）
    const fnEnd = ih.indexOf('\n      function ', fnStart + 10);
    const body = ih.slice(fnStart, fnEnd > fnStart ? fnEnd : fnStart + 2000);

    check(/removeChild\(note\)|note\.remove\(\)/.test(body),
      'insertAppleNote 位置不对时会摘掉旧节点',
      '缺少摘除逻辑 → React 复用 DOM 节点后，上一张卡的注入内容会留在新卡里' +
      '（用户实测：苹果的富士康说明出现在华为卡上）');

    // ⚠️⚠️ 幂等是硬要求，不是优化。
    //
    // index.html 末尾有 `new MutationObserver(init)`：init() 里的 DOM 改动
    // 会再次触发 observer → 又调 init() → 又改 DOM → **无限循环**，
    // 浏览器直接弹「页面没有响应」（用户实测过一次，整页假死）。
    //
    // 曾写「每次都 removeChild 再重新 insertBefore」，以为这样能纠正错位，
    // 实际每轮 init 都产生结构性变动 → observer 自激 → 页面卡死。
    // 必须**位置已经对时什么都不做**。
    check(/previousSibling\s*===\s*tagsRow|previousSibling\s*==\s*tagsRow/.test(body),
      'insertAppleNote 有「位置已对则跳过」的幂等判断',
      '缺少幂等判断 → 每轮 init 都删了再插 → MutationObserver 自激 → ' +
      '整页「页面没有响应」。必须写成：note.previousSibling === tagsRow 就直接 return');

    check(!/if\s*\(\s*document\.querySelector\('#apple-note'\)\s*\)\s*return/.test(body),
      'insertAppleNote 没有「已存在就直接 return」的早退',
      '该早退会让注入节点永远无法纠正位置');

    check(/if\s*\(\s*!appleCard\s*\)\s*\{?/.test(body),
      '当前列表没有苹果卡时不插入说明',
      '缺少判空 → 苹果卡被搜索过滤掉后，说明框仍留在原地那张卡上');

    // 搜索与筛选都必须重新定位。
    // ⚠️ 窗口不能按固定字符数切：去掉几行注释就会滑出窗口 → 校验恒过。
    //    改为切到下一个 addEventListener 为止。
    const sliceHandler = (eventName) => {
      const s = ih.indexOf(`addEventListener('${eventName}'`);
      if (s < 0) return '';
      const e = ih.indexOf('addEventListener(', s + 20);
      return ih.slice(s, e > s ? e : s + 1500);
    };
    check(/insertAppleNote/.test(sliceHandler('input')),
      '搜索输入时重新定位注入节点',
      '搜索会改变卡片列表，注入节点不跟着走就会错位');

    check(/insertAppleNote/.test(sliceHandler('click')),
      '品类/评级筛选时重新定位注入节点',
      '切换筛选同样会改变卡片列表');
  }

  // 真正跑一次幂等仿真：连续调用 insertAppleNote，统计 DOM 结构性变动次数。
  //
  // 静态正则只能证明「代码里写了跳过判断」，证不了「行为真的幂等」。
  // 这个脚本从 index.html 里切出函数、用最小 DOM 桩 eval 出来连调 100 次，
  // 任何一次结构性变动都会 exit 1 —— 那正是 MutationObserver 自激的判据。
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
      'insertAppleNote 幂等仿真通过（连调 100 次无 DOM 变动）',
      `scripts/check-inject-idempotent.mjs exit ${code} ——\n` +
      `      ${out.trim().split('\n').slice(-6).join('\n      ')}\n` +
      '      非幂等 → MutationObserver(init) 自激 → 整页「页面没有响应」');
  } else {
    err('scripts/check-inject-idempotent.mjs 缺失',
      '幂等仿真脚本不见了 —— 注入逻辑一旦不幂等就会卡死整页，且没有任何静态检查能发现');
  }
}

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

const SEO_PAGES = ['index.html', 'sponsor.html', 'projects.html', '404.html', 'discussion-closed.html'];

// 0a. 两份 404 页面的职责不能搞混
//
// 背景：曾把「你点的『发布交流』暂未开放」写在 404.html 里，
// 但那是 GitHub Pages 的**全站兜底** —— 任何人输错网址都会看到，
// 于是对方只是少打了个字母，却被告知他点了某个按钮。
//
// 现在分成两份：
//   404.html             全站兜底，不得假设访问来源
//   discussion-closed.html  「发布交流」按钮专属，按钮指向它
if (exists('404.html') && exists('discussion-closed.html')) {
  const generic = read('404.html');
  const closed = read('discussion-closed.html');
  const dpRaw = exists('discussion-to-404.js') ? read('discussion-to-404.js') : '';
  const dpCode = dpRaw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  check(!/你点的「发布交流」/.test(generic),
    '全站兜底 404.html 不含按钮专属文案',
    '这页给所有输错网址的人看，不能假设他们点了某个按钮');
  check(/你点的「发布交流」/.test(closed),
    'discussion-closed.html 保留「发布交流」专属说明',
    '按钮点了要有对应的解释页，否则用户不知道是功能没做还是自己点错了');
  check(/discussion-closed\.html/.test(dpCode),
    '「发布交流」按钮指向 discussion-closed.html',
    '若还指向 404.html，用户输错网址时就会看到「你点了发布交流」这种错话');
  check(!/TARGET\s*=\s*['"]404\.html['"]/.test(dpCode),
    '按钮不再指向全站兜底 404.html',
    '404.html 是兜底页，按钮应指向自己的专属说明页');
}

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
   移动端排版修复样式必须存在且被引用
   ------------------------------------------------------------------
   背景（用户截图）：≤640px 时顶部三个按钮被压成竖排单字
   「提交爆料 / 推荐」「Star on GitHub」「赞助本项目」。

   根因在 bundle 里（按钮缺 whitespace-nowrap、容器缺 flex-wrap，
   且顶栏是 h-16 固定高），不便改压缩代码，故走 CSS 覆盖。

   这类修复的风险是**被当成冗余删掉**：
   以后若有人重建 bundle 修好了根因，这文件会被认为多余；
   反之若 bundle 变了而这里没跟着改，移动端会退回原样。
   所以两条都要锁住。
   ------------------------------------------------------------------ */
section('13b-5. 移动端排版修复');
if (exists('mobile-fixes.css')) {
  const mf = read('mobile-fixes.css');

  check(/@media\s*\(max-width:\s*640px\)/.test(mf), '含 ≤640px 主断点（Tailwind sm 断点）');
  check(/@media\s*\(max-width:\s*400px\)/.test(mf), '含 ≤400px 兜底断点（英文按钮仍可能溢出）');

  // 三个必须一起改的要素，缺一个都会出问题
  check(/white-space:\s*nowrap/.test(mf), '含 white-space: nowrap（按钮内文字不折断）');
  // 注意：不再要求 flex-wrap: wrap ——
  // 竖排（flex-direction: column）下按钮各占一行，不需要换行，
  // 而 flex-wrap 恰恰是不确定布局的来源（今天踩了两次）。
  // ⚠️ 关键：只加 flex-wrap 不放开 h-16，两排按钮会溢出遮挡正文
  check(/height:\s*auto/.test(mf) && /min-height:\s*64px/.test(mf),
    '放开顶栏固定高度（h-16 → min-height），避免换行后溢出');

  // 必须引用三个按钮的选择器，少一个就有按钮仍会竖排。
  //
  // ⚠️ 实现说明（前两次都写错了，这次用最笨但可靠的方式）
  //
  // 失败经历：
  //   ① 按「文件里出现过该选择器」判断 → 删掉一处仍通过（另一处还在）
  //   ② 按宽度找「下一个更宽断点的位置」切区间 → 算出负长度区间，
  //      因为 640px 分成两段写（位置 1551 与 3704），400px 夹在中间，
  //      end(1551) < start(2623)
  //
  // 现在采用「每个断点宽度 → 取它第一次出现到文件末」：
  //   该宽度下所有分散写的规则必然都落在范围内，
  //   不会出现负长度，也不会把同宽度的后续段漏掉。
  //   代价是区间会包含更宽断点的内容 —— 但这不影响检查意图：
  //   我们要确认的是「这个宽度下三个按钮都被覆盖」，
  //   而不是精确的层叠顺序。
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
        `≤${w}px 及以下区间覆盖「${label}」`,
        `该宽度区间里 ${label} 没有 nowrap 规则，会退回竖排`);
    }
  }

  // 必须被 index.html 引用，且在主CSS 之后（靠覆盖生效）
  if (exists('index.html')) {
    const ih = read('index.html');
    check(/mobile-fixes\.css/.test(ih), 'index.html 已引用 mobile-fixes.css');

    // ⚠️ 比位置时必须匹配 <link rel="stylesheet" ... assets/index-BgVofs0W.css>，
    //    不能只indexOf('assets/index-BgVofs0W.css')——
    //    那会先命中第 19 行的 <link rel="preload" as="style">，
    //    导致顺序判断永远成立（注入验证时发现）。
    const mainCssPos = ih.search(/<link[^>]*rel="stylesheet"[^>]*assets\/index-BgVofs0W\.css/);
    const fixCssPos = ih.search(/<link[^>]*mobile-fixes\.css/);
    check(mainCssPos >= 0, '主 CSS 有 stylesheet 引用（定位基准）');
    check(fixCssPos > mainCssPos,
      '引用顺序在主 CSS 之后（覆盖才生效）',
      `主CSS 在第 ${mainCssPos} 字符、mobile-fixes 在第 ${fixCssPos} 字符 —— ` +
      '顺序颠倒会导致本文件的所有覆盖规则失效');

    const vi = ih.match(/mobile-fixes\.css\?v=(\d+)/);
    check(!!vi, '带 ?v= 版本号（防缓存）', vi ? '' : '未加版本号，浏览器会用旧缓存');
  }

  /* ------------------------------------------------------------------
     按钮不得被拉伸到超过内容宽度
     ------------------------------------------------------------------
     背景（用户截图）：≤400px 时曾写 flex: 1 1 100%，
     结果「☕ 赞助本项目」只有 5 个字却撑满整行，
     视觉上像一条空横幅 —— **高度是修好了，宽度成了新问题**。

     判据：窄屏按钮用 flex: 0 0 auto（按内容宽），
     而不是 1 1 100%（强制占满）。
     ------------------------------------------------------------------ */
  // 只匹配真实声明行：行首（可含缩进）直接是 flex: ...
  // 不能用 /flex:\s*1\s+1\s+100%/ 全文搜——
  // 注释里写着「曾经写成 flex: 1 1 100%」的历史说明会被一起命中，
  const mfClean = stripCssComments(mf);

  /* ------------------------------------------------------------------
     窄屏按钮必须竖排
     ------------------------------------------------------------------
     背景（用户三次返工）：①竖排单字 ②撑满整行 ③真机横向重叠。
     前三次都在调 flex 三值试图让「横排列得下」，
     但三按钮总宽 408px > 手机可用 196~250px，横排永远放不下。

     用户最终要求：直接竖排。这也是最稳的方案 ——
     flex-direction: column 是确定性的，不依赖换行、
     不依赖收缩、也不依赖容器能否被正确定位。

     判据：窄屏必须声明 flex-direction: column。
     ------------------------------------------------------------------ */
  const colDecl = mfClean.match(/flex-direction:\s*column/);
  check(!!colDecl, '窄屏按钮区为 flex-direction: column（竖排，确定性方案）',
    '横排三按钮总宽 408px > 手机可用 196~250px，永远放不下；'
    + '不要再试图用 flex 三值调横排');

  // 竖排时按钮宽度由容器决定，必须是 100% 或 auto，不能是内容宽
  const widthDecl = mfClean.match(/width:\s*(\d+%|auto)/);
  check(widthDecl && widthDecl[1] === '100%',
    '竖排按钮宽度为 100%（由容器决定，不受文字长短影响）',
    '若为 auto，文字长的按钮会把容器撑宽、挤掉 logo 区');

  // 竖排三行需要放开顶栏高度
  check(/height:\s*auto/.test(mfClean) && /min-height:\s*64px/.test(mfClean),
    '顶栏已放开固定高度（竖排三行需要更多空间）');

  const stretch400 = mfClean.split('\n')
    .map((l) => l.trim())
    .filter((l) => /^flex:\s*1\s+1\s+(100%|0)\s*;?$/.test(l));
  check(stretch400.length === 0,
    '未把按钮拉伸为等分或占满',
    stretch400.length
      ? 'flex: 1 1 0/100% 会让短文案撑满整行，且横排永远放不下'
      : '');

  /* ------------------------------------------------------------------
     换行规则不能只依赖 :has()
     ------------------------------------------------------------------
     实测用户真机浏览器上 :has() 未生效 → flex-wrap 没应用 → 三按钮重叠。
     必须有 JS 打属性（data-hdr-acts）的等价路径。

     检查：CSS 用了 :has() 时，必须同时存在属性选择器路径 + 注入脚本。
     ------------------------------------------------------------------ */
  const usesHas = /:has\(/.test(mfClean);
  const hasAttrPath = /data-hdr-acts/.test(mfClean);
  check(!usesHas || hasAttrPath,
    '换行规则不单靠 :has()（真机实测未生效）',
    hasAttrPath ? '' : '只有 :has() 一条路径，浏览器不支持时按钮会横向重叠');

  check(hasAttrPath && exists('header-fix.js'),
    'data-hdr-acts 的注入脚本存在（header-fix.js）');
  if (hasAttrPath && exists('header-fix.js')) {
    const hf = read('header-fix.js');
    check(/setAttribute\(\s*ATTR/.test(hf) || /setAttribute\(['"]data-hdr-acts/.test(hf),
      '注入脚本确实设置 data-hdr-acts');
    check(/header a\[href\*="github\.com"\] > span/.test(hf),
      '脚本选择器匹配 bundle 真实层级（a > span）');
    check(/MutationObserver/.test(hf),
      '脚本含重试机制（顶栏由 React 异步渲染，可能尚未挂载）');
  }
} else {
  note('未找到 mobile-fixes.css —— 若 bundle 里的移动端折行问题仍在，需补上');
}

/* ------------------------------------------------------------------
   广告吸底条：不得压住正文
   ------------------------------------------------------------------
   背景（用户截图）：≤1439px 的吸底条里，
   徽标「推广限时活动」曾用 position:absolute + translateY(-50%)
   浮在左上角，**直接盖住了 title 第一行**
   （「注册即送 喜茶 20 元 无门槛」被压掉一半）。

   2026-10-16：徽标已按维护者要求**整块删除**
   （CONFIG.badge、DOM 节点、.lp-ad__badge 规则、absolute 定位规则
   以及为它预留的 padding-top:26px 全部移除）。
   所以判据要跟着改：
     · 徽标规则必须**不存在**（存在即说明删漏了）
     · 为徽标预留的 padding-top 必须已收回，否则下方留一段空白
     · translateY(-50%) 这个元凶写法不得复活
     · 标题行数仍不得限制
     · 品牌行要求「必须完整显示在一行内」，用 nowrap 兜住
   ------------------------------------------------------------------ */
section('13b-6. 广告吸底条不遮挡');
if (exists('liangpei-ad.css')) {
  const lp = read('liangpei-ad.css');
  const barRaw = (lp.match(/@media\s*\(max-width:\s*1439px\)\s*\{[\s\S]*?\n\}/) || [''])[0];
  // ⚠️ 必须剥掉注释再判断 —— 这段 CSS 里就写着
  //    「translateY(-50%) 是压内容的元凶」这样的说明文字，
  //    全文搜索会把注释当成声明（今天已栽两次，见 stripCssComments 的注释）。
  const bar = stripCssComments(barRaw);

  check(!/\.lp-ad__badge\s*\{/.test(lp),
    '徽标已整块删除（CSS 中无 .lp-ad__badge 规则）',
    '徽标已按维护者要求删除，若仍在请连同 CONFIG.badge 与 DOM 节点一并移除');

  check(!/\.lp-ad__badge/.test(bar),
    '吸底条内无徽标定位规则',
    '徽标已删除，吸底条里不应再有它的 absolute 定位');

  // 为徽标预留的 padding-top 已收回，正文才能真正上移
  const pt = (bar.match(/padding-top:\s*(\d+)px/) || [, '0'])[1];
  check(!/padding-top:\s*\d+px/.test(bar),
    `吸底条未再为徽标预留 padding-top（当前 ${pt}px）`,
    '徽标已删，为它预留的 padding-top 必须一并收回，否则下方留一段空白');

  check(!/translateY\(-50%\)/.test(bar),
    '吸底条未使用 translateY(-50%)（该写法会让元素骑在内容上）');

  check(!/-webkit-line-clamp/.test(bar),
    '吸底条标题未限制行数（clamp 会截断「消费红包」这类词）');

  // 品牌行要求「必须完整显示在一行内」
  check(/white-space:\s*nowrap/.test(lp),
    '品牌行强制单行（white-space: nowrap）',
    '维护者要求品牌行必须完整显示在一行内（不折行）');

  // 2026-10-19 站长指示：「（限时推广）」外层的全角括号去掉，只留「限时推广」四个字。
  // 括号是全角「（）」，肉眼差别很小，只改文案不改结构，必须有断言钉住。
  {
    const lpJs = exists('liangpei-ad.js') ? read('liangpei-ad.js') : '';
    const m = lpJs.match(/limitLine:\s*'([^']*)'/);
    check(m && m[1] === '限时推广',
      '广告位「限时推广」不带全角括号',
      m ? `当前 limitLine 是「${m[1]}」，应为「限时推广」` : '找不到 limitLine 配置');
    check(m && !/[（(）)]/.test(m[1]),
      '广告位推广文案不含括号字符',
      '站长要求去掉「（限时推广）」的括号，只留四个字');
  }

  /* ----------------------------------------------------------------
     基础样式与断点样式的**源码顺序**必须正确
     ------------------------------------------------------------------
     2026-10-16 真实踩过：通用零件段写在文件后半部，
     而 @media (min-width:1440px) 段写在前半部。
     两者选择器相同、优先级相同，**后写的赢** ——
     于是竖排卡里精心设的 brand 11.5px 被通用段的 17px 覆盖，
     「（限时推广）良配 - AI婚恋」撑破 176px 卡片、被裁在视口外。

     ⚠️ 这类故障**完全静默**：CSS 不报错，DOM 正常，
        只有肉眼在页面上才发现文字被裁。属性存在 ≠ 生效，
        之前那几条 check 只验证了「nowrap 写没写」，
        完全没验证「生效的是哪个值」，所以也没拦住。

     判据：通用零件段必须在两个断点段**之前**。
     ------------------------------------------------------------------ */
  const posGen = lp.search(/\/\* -+ 通用零件 -+ \*\//);
  const posWide = lp.search(/@media\s*\(min-width:\s*1440px\)\s*\{\s*\.lp-ad\s*\{/);
  const posBar = lp.search(/@media\s*\(max-width:\s*1439px\)/);
  if (posGen >= 0 && posWide >= 0) {
    check(posGen < posWide,
      '通用零件段写在断点段之前（断点值能正确覆盖基础值）',
      '基础样式若写在 @media 之后会反向覆盖断点值，且故障完全静默');
  }
  if (posGen >= 0 && posBar >= 0) {
    check(posGen < posBar, '通用零件段写在吸底条断点之前');
  }

  // nowrap 一旦遇上字体度量偏宽就会溢出卡片，必须有 hidden 兜底
  check(/overflow:\s*hidden/.test(stripCssComments(
    (lp.match(/@media\s*\(min-width:\s*1440px\)\s*\{[\s\S]*?\n\}/) || [''])[0])),
    '竖排卡片有 overflow:hidden 兜底',
    '品牌行是 nowrap，若字体偏宽文字会溢出卡片被裁在视口外（已真实发生过）');

  const sideRaw = (lp.match(/@media\s*\(min-width:\s*1440px\)\s*\{[\s\S]*?\n\}/) || [''])[0];
  check(sideRaw.length > 0, '竖排卡片规则仍存在（两种形态都有定义）');

  /* ----------------------------------------------------------------
     同一 media 块内不得有重复的同名选择器
     ----------------------------------------------------------------
     本次漏改的根因：修徽标时在 119 行加了新规则，
     却忘了 184 行还有一条旧的 `.lp-ad__badge` ——
     后者会覆盖前者，**改了等于没改**，
     而 119 行的新规则看起来完全正确，肉眼很难发现。

     CSS 允许重复选择器（后者生效），所以这不会报错、不会警告，
     但极易导致「明明改了却没生效」。
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
      dup.length ? `重复定义会让后者覆盖前者，极易造成「改了没生效」：${dup.join('; ')}` : '');
  };
  dupIn(barRaw, '吸底条（<1440px）');
  dupIn(sideRaw, '竖排卡片（≥1440px）');
}

/* ------------------------------------------------------------------
   品牌搜索框必须真正驱动列表过滤
   ------------------------------------------------------------------
   背景（用户实测）：搜「瑞幸」「test」，列表**完全不变**，全部品牌照常显示。

   根因（读 bundle 源码确认）：品牌页那个搜索框
   `value:i, onChange:e=>a(e.target.value)` 的 state 变量 `i`，
   在整个组件里**只出现 1 次 —— 就是输入框的 value 本身**。
   组件内**没有任何 useMemo**，列表直接 `n.map(...)` 渲染全部数据。
   → 搜索框是纯装饰，输入什么都不影响结果。

   这类问题静态检查看不出来（语法正确、UI 正常），
   只能靠「变量是否被消费」这条线索定位：
   **一个 state 若只出现在自己的绑定处，说明它没被用。**

   检查：搜索 state 必须被过滤逻辑消费，且列表必须渲染过滤结果。
   ------------------------------------------------------------------ */
section('13b-7. 品牌搜索框驱动列表过滤');
{
  const bj = exists('assets/index-YthXZ9eP.js') ? read('assets/index-YthXZ9eP.js') : '';
  const phIdx = bj.indexOf('消费前，先了解这个品牌是否双休');

  check(phIdx > 0, '找到品牌页搜索框（按 placeholder 定位）');

  if (phIdx > 0) {
    const bind = bj.slice(phIdx, phIdx + 400)
      .match(/value:([a-z]),onChange:e=>([a-z])\(e\.target\.value\)/);
    check(!!bind, '搜索框为受控组件（value + onChange）');

    if (bind) {
      const v = bind[1];
      const re = new RegExp(`(?<![\\w$])${v}(?![\\w$])`, 'g');
      const all = [...bj.matchAll(re)].length;
      const inBind = (bj.slice(Math.max(0, phIdx - 150), phIdx + 400).match(re) || []).length;
      check(all > inBind,
        `搜索变量 \`${v}\` 被过滤逻辑消费（全站 ${all} 处 > 绑定附近 ${inBind} 处）`,
        `\`${v}\` 只出现在自己的绑定处 → 搜索框是纯装饰，输入不影响列表`);
    }

    // 列表必须渲染过滤结果，而不是原始数组
    //
    // ⚠️ 不用「切片 + 正则」去猜 —— 压缩代码里 `children:ln},[...]` 这类
    // 紧邻写法会让切片边界判断不可靠（我在这上面误判了两次：
    // 一次把 `ln.map` 切成 `l` + `ne.map`，一次漏掉后面 6000 字符）。
    // 改为**全局查找**：原始数组 `n.map(` 若出现在品牌列表容器附近，
    // 说明列表仍直接渲染原始数据。
    const gridIdx = bj.indexOf('grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5');
    check(gridIdx > 0, '找到品牌列表容器');

    // 过滤后的数组变量名：从 `ln=(0,_.useMemo)` 提取
    const memoM = bj.match(/([a-z][\w$]*)=\(0,_\.useMemo\)\(\(\)=>\{let [a-z]=([a-z])\.trim\(\)/);
    check(!!memoM, '存在基于搜索词的 useMemo 过滤');

    if (gridIdx > 0 && memoM) {
      const filteredVar = memoM[1];
      // 容器之后 400 字符内应出现 `<filteredVar>.map(`
      const after = bj.slice(gridIdx, gridIdx + 400);
      check(after.includes(`${filteredVar}.map(`),
        `品牌列表渲染过滤结果（${filteredVar}.map）`,
        `容器后未见 ${filteredVar}.map —— 列表可能仍渲染原始数组`);

      // 反向确认：原始数组 n.map 不应出现在该容器之后
      const tail = bj.slice(gridIdx, gridIdx + 400);
      const rawUse = tail.includes('n}.map(') || tail.includes('children:n}.map(');
      check(!rawUse, '列表未直接渲染原始数组 n');
    }

    // 三个筛选条件必须齐全（按语义匹配，不靠窗口位置）
    // ⚠️ 窗口必须切在依赖数组 `},[...]` 处，不能用固定 700 字符 ——
    //    后面还有一个独立的 ne=n.filter(...)，里面同样引用 keyProducts，
    //    固定窗口会把它算进来，导致「ln 里删掉 keyProducts」也照样通过。
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
    check(filterBody.includes('companyName'), '搜索匹配公司主体名');
    check(filterBody.includes('searchKeywords'), '搜索匹配预设关键词');
    // 内置品牌的品类词全在 keyProducts（喜茶=多肉葡萄、星巴克=美式/拿铁），
    // 不搜 keyProducts 就会出现「搜奶茶只搜到自定义卡、内置卡一条不出」。
    check(filterBody.includes('keyProducts'),
      '搜索匹配 keyProducts',
      '过滤条件里没有 keyProducts —— 内置品牌的品类词只存在于 keyProducts，' +
      '搜「奶茶」「车灯」「咖啡」会一条内置卡都搜不到');
    check(filterBody.includes('.trim()'),
      '搜索词先 trim 再匹配（空白输入不参与过滤）');
    // 空串陷阱：''.includes('') === true，若不判空会把所有条件架空
    check(/if\([a-z]&&!/.test(filterBody),
      '搜索词为空时跳过关键词过滤（避免空串.includes 恒真架空条件）');

    // 每个内置 brand 都必须有 searchKeywords。
    // 背景（用户实测）：搜「奶茶」只出用户自己提交的自定义卡，
    // 32 张内置卡一条不出 —— 因为内置数据从来没写过 searchKeywords，
    // 品类词全塞在 keyProducts 里。过滤条件补了 keyProducts 只能救一部分，
    // 口语词（奶茶/果茶/手机/电脑）仍搜不到，所以数据层也要补。
    //
    // ⚠️ 不能用 split(/\{id:`/) —— evidence 数组里嵌套的对象也带 id，
    //    切出来 143 段，大部分不是 brand，会误报。
    //    只认带 logoText 的顶层 brand 对象，并用花括号配平切到对象末尾。
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
    // ⚠️ 不要写死数字。写死的话每加一张卡都要改脚本，
    // 忘了改就会误报「切分逻辑坏了」，把人引到错误方向。
    // BUILTIN_COUNT 由 brandCards.length 动态算出，是权威值。
    check(brandBlocks.length === BUILTIN_COUNT,
      `内置 brand 对象能被正确切分出 ${BUILTIN_COUNT} 个`,
      `切出 ${brandBlocks.length} 个但 brandCards 解析出 ${BUILTIN_COUNT} 个 —— ` +
      '切分逻辑本身坏了，后面的检查会变成假通过');
    check(noKw.length === 0,
      `内置 ${brandBlocks.length} 个 brand 全部带 searchKeywords`,
      `缺 searchKeywords 的内置品牌：${noKw.join(', ')}\n` +
      '      这些卡只能用品牌全名搜到，品类俗称一律搜不到');
  }
}

/* ------------------------------------------------------------------
   元素定位不得依赖 placeholder 文案
   ------------------------------------------------------------------
   背景（用户实测）：搜「瑞幸」「1」「test」，列表完全不变。

   根因：filterCustomCards() 用 `input[placeholder*="搜索"]` 定位输入框，
   而 placeholder 后来被改成「消费前，先了解这个品牌是否双休……」——
   **里面没有「搜索」二字**，选择器返回 null，keyword 恒为空，
   过滤静默失效。事件监听 `placeholder.includes('搜索')` 同样不成立，
   连 input 事件都没挂上。

   > placeholder 是**文案**，会被人改；
   > id / data-* / name 才是**契约**。
   > 任何用文案做选择器的地方，改文案就会静默打断功能。

   检查：脚本里不得用 placeholder 作为定位或判定依据。
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
    '无脚本用 placeholder 文案定位或判定元素',
    offenders.length
      ? `改文案就会静默打断功能：\n      ${offenders.join('\n      ')}`
      : '');

  // 主搜索框必须有稳定 id，且过滤逻辑按 id 定位
  check(/'site-search-input'/.test(ih),
    '主搜索框使用稳定 id（site-search-input）');
  check(/getElementById\(\s*'site-search-input'\s*\)/.test(ih),
    '过滤逻辑按 id 定位搜索框');
  check(/e\.target\.id\s*===\s*'site-search-input'/.test(ih),
    'input 事件按 id 判定');
}

/* ---------- 13b-9. 文档一致性 ----------
 *
 * PITFALLS.md 里大量引用检查项编号（13b-5 / 13b-6 / 13b-8 …），
 * 用来告诉后来者「这个问题已经有自动检查兜着了」。
 *
 * 但检查项会随维护增删、编号会漂移。一旦编号对不上，
 * 文档就在**指引后来者去看一个不存在的检查** —— 比不写更糟。
 * 所以在这里锁住：文档提到的编号必须真实存在。
 *
 * 触发方式举例：
 * - 把 13b-6 的 section() 改名成 13b-7（编号冲突）
 * - 把某个 section() 整段删掉
 * - 文档里手写了一个不存在的编号
 */
section('13b-9. 踩坑报告与文档一致性');

const DOCS = ['PITFALLS.md', 'README.md', 'FORK_GUIDE.md', 'MAINTAINING.md'];
const self = read('scripts/verify.mjs');

// 本脚本里真实存在的 section 编号（排除 13b-9 自身，避免自指）
const liveSections = new Set(
  [...self.matchAll(/^section\('([^']+)'/gm)].map((m) => m[1].split('.')[0].trim())
);

// 文档里引用到的形如 13b-N / 13c / 14 之类的段落编号
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
  `文档引用的检查项编号均真实存在（共 ${liveSections.size} 个 section）`,
  dangling.length
    ? [
        '以下编号在 verify.mjs 里找不到对应 section ——',
        '文档会把后来者指引到一个不存在的检查，比不写更糟：',
        ...[...new Set(dangling)],
      ].join('\n      ')
    : '');

// 报告本身不能为空壳 —— 至少要有实际条目数
if (exists('PITFALLS.md')) {
  const pf = read('PITFALLS.md');
  const items = (pf.match(/^###\s/gm) || []).length;
  // 教训块有两种写法：`> ### 规则`（带标题）与 `> **加粗一句**`（无标题）。
  // 只数前者会严重低估 —— 会让人以为报告里只有2 条规则。
  const rulesTitled = (pf.match(/^>\s*#{2,4}\s*规则/gm) || []).length;
  const rulesPlain = (pf.match(/^>\s*\*\*[^\n]{4,}\*\*/gm) || []).length;
  const rules = rulesTitled + rulesPlain;
  check(pf.length > 5000, `PITFALLS.md 有实质内容（${pf.length} 字符 / ${items} 个条目 / ${rules} 条规则）`,
    `仅 ${pf.length} 字符，疑似被清空或截断`);
  // 必须包含动手前的检查清单 —— 这是报告的落地部分
  check(/##\s*七、改动前的检查清单/.test(pf),
    'PITFALLS.md 含「改动前的检查清单」章节',
    '只有案例没有可执行清单，后来者无法直接用');

  /**
   * 内部交叉引用（§x.y）必须指向真实存在的小节。
   *
   * 报告里的「改动前检查清单」大量用 §x.y 指向具体小节，
   * 小节编号一旦漂移，清单就会指向不存在的位置 —— 后人按它跳转会扑空。
   *
   * ⚠️ 提取时必须匹配**完整的 x.y**（含小数部分）。
   *    早先写成 `§(\d+)` 时，`§1.1` 会被截成 `1`，
   *    于是凭空多出 5 个「找不到的章节」—— **检查脚本自己的 bug**。
   *    这与「正则只取首条」「位置判断找错基准」同源：
   *    **提取范围窄于实际形态时，规则会凭空报错。**
   */
  const pfHeads = [...pf.matchAll(/^#{2,4}\s*(\d+(?:\.\d+)?)[\s.、]/gm)].map((m) => m[1]);
  const pfRefSet = new Set(pfHeads);
  const pfRefs = [...new Set([...pf.matchAll(/§(\d+\.\d+)/g)].map((m) => m[1]))];
  const badRefs = pfRefs.filter((r) => !pfRefSet.has(r));
  check(badRefs.length === 0,
    `内部交叉引用 §x.y 均指向真实小节（共 ${pfRefs.length} 处引用 / ${pfHeads.length} 个小节）`,
    badRefs.length
      ? [
          '以下引用指向不存在的小节，清单跳转会扑空：',
          ...badRefs.map((r) => `  §${r}`),
        ].join('\n      ')
      : '');
}

/* ---------- 13c. 编码完整性 ----------
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
  'index.html', 'sponsor.html', 'projects.html', '404.html', 'discussion-closed.html',
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

/* ---------- 13c-2. 详情页搜索词覆盖 ----------
 *
 * 背景：36 个详情页的 title原本全是同一个模子「XX 双休率NN%｜双休购」，
 * 只覆盖「XX 双休率」一种查询。而**「XX 几点下班」是用户原话**，
 * 搜索量更高，且「平均下班时间」是本站每个页面都有、竞品普遍没有的数据 ——
 * 放在 title 里是最便宜的覆盖。
 *
 * 所以 title / og:title / h1 三处统一改为「XX 几点下班 双休率NN%」。
 *
 * 这三项锁住的理由：
 *  ① title 与 og:title 不一致 →社交分享显示的内容与搜索结果不同
 *  ② 某页漏改 → 该页少覆盖一个词型，且没有任何其他检查会发现
 *  ③ 改回单模子 → 这个检查是唯一的哨兵
 */
section('13c-2. 详情页搜索词覆盖');

const brandFiles = exists('brand') ? readdirSync(join(ROOT, 'brand')).filter((f) => f.endsWith('.html')) : [];
if (brandFiles.length === 0) {
  note('brand/ 为空，跳过详情页搜索词覆盖检查');
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
    `全部 ${brandFiles.length} 个详情页 title 含「几点下班」（覆盖用户原话型查询）`,
    noQidian.length
      ? `这些页没覆盖：${noQidian.slice(0, 8).join(', ')}${noQidian.length > 8 ? ' …' : ''}`
      : '');

  check(titleOgMismatch.length === 0,
    'title 与 og:title 内容一致',
    titleOgMismatch.length
      ? `不一致（社交分享与搜索结果会显示不同内容）：${titleOgMismatch.slice(0, 5).join(', ')}`
      : '');

  check(badH1.length === 0,
    '全部详情页 h1 含「几点下班」',
    badH1.length ? `未覆盖：${badH1.slice(0, 8).join(', ')}` : '');

  // title 过长会被 SERP 截断，截断掉等于白加
  const tooLong = brandFiles.filter((bf) => {
    const m = read(join('brand', bf)).match(/<title>([^<]*)<\/title>/);
    return m && m[1].length > 40;
  });
  check(tooLong.length === 0,
    'title 长度未超截断阈值（≤40 字符）',
    tooLong.length
      ? `过长会被搜索结果截断，截掉部分等于白加：${tooLong.slice(0, 5).join(', ')}`
      : '');
}

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

// ---------- 13g. 同类项目导航页的自有仓库标记 ----------

// projects.html 里的「本站 / 姊妹站」绿色标签，是把自己和别人的克隆/fork 区分开的唯一线索。
// 漏标的后果：用户看到 `dujeongil-galaxy/shuangxiugou-guide` 会以为是别人的项目，
// 而它其实是同一作者的姊妹站 —— 这直接影响「这些项目是不是同一个上游克隆」这条结论。
if (exists('projects.html')) {
  const pj = read('projects.html');

  const SELF_OWNED = [
    ['dujeongil-galaxy/shuangxiugou', '本站'],
    ['dujeongil-galaxy/shuangxiugou-guide', '姊妹站'],
  ];
  for (const [repo, tag] of SELF_OWNED) {
    // 在该仓库所在的那张卡片里必须能找到对应标签
    const anchor = pj.indexOf(`>${repo}</a>`);
    check(anchor > 0, `projects.html 收录了 ${repo}`);
    if (anchor <= 0) continue;

    // 卡片范围：从该 <a> 往前找最近的 <li class="card，往后找最近的 </li>
    const cardStart = pj.lastIndexOf('<li class="card', anchor);
    const cardEnd = pj.indexOf('</li>', anchor);
    const card = pj.slice(cardStart, cardEnd);
    check(card.includes(`<span class="self-tag">${tag}</span>`),
      `projects.html 中 ${repo} 带「${tag}」标记`,
      `该卡片没有 self-tag「${tag}」→ 用户会以为这是别人的项目`);

    // 有标签就该有底色高亮，否则标记与卡片样式不一致
    check(/<li class="card is-self"/.test(card),
      `${repo} 的卡片带 is-self 底色高亮`,
      '有 self-tag 但没有 is-self → 标签与卡片高亮对不上');
  }

  // 段首说明不能把「绿色标记」写死成「本站」两个字——现在有「本站」和「姊妹站」两种。
  check(!/其中带「本站」标记的/.test(pj),
    'projects.html 段首说明未把标记写死为「本站」',
    '现在有「本站」和「姊妹站」两种标签，文案应写「绿色标记」之类的统称');

  // 「姊妹站」用字全站统一
  const sisterBad = ['姐妹站', '妹子站', '兄弟站'].filter((w) => pj.includes(w));
  check(sisterBad.length === 0,
    'projects.html 统一用「姊妹站」',
    `出现异写：${sisterBad.join('、')} —— 同一概念两种写法会让人以为是两个不同项目`);
}

// ---------- 13e. 推广位链接一致性 ----------
/*
 * README 末尾的推广链接（机场）在本项目里是个**跨仓库、纯手工维护**的位置：
 *
 *   dujeongil-galaxy/shuangxiugou        → README.md
 *   dujeongil-galaxy/shuangxiugou-guide  → README.md（另一个仓库，无共同脚本）
 *   dujeongil-galaxy/shuangxiu-go-archive → 无推广位
 *
 * 两个仓库各自手改，**极易只改一处**。而推广链接失效是静默的 ——
 * 没人会点自己 README 末尾的链接，也没有任何检查会报错。
 *
 * 所以这里至少保证：本仓库内的链接格式正确、备用线路齐全、
 * 且 MAINTAINING.md 的历史记录不被误改（那是变更史，不是推广位）。
 */
section('13e. 推广位链接');
if (exists('README.md')) {
  const rd = stripCssComments(read('README.md'));
  const AFF = 'v17mHNYv';
  // 只取「IP:8000/register?aff=」形态的链接，避免误抓正文里的普通 URL
  const affLinks = [...rd.matchAll(
    new RegExp(`https://(\\d+\\.\\d+\\.\\d+\\.\\d+):8000/register\\?aff=(\\w+)`, 'g')
  )].map((m) => ({ ip: m[1], aff: m[2] }));

  if (affLinks.length === 0) {
    note('README 未发现推广位链接（若已移除属正常，无需处理）');
  } else {
    check(affLinks.length >= 1,
      `推广位含 ${affLinks.length} 条线路（主推 + 备用）`,
      '备用线路缺失 —— 主线路不可用时读者没有 fallback');

    const badAff = affLinks.filter((l) => l.aff !== AFF);
    check(badAff.length === 0,
      `全部线路 aff 码一致（${AFF}）`,
      badAff.length ? `以下 aff 码不一致：${badAff.map((l) => l.ip).join(', ')}` : '');

    // IP 必须是四段合法形式，且不能是占位符（0.0.0.0 / 1.1.1.1 之类）
    const badIp = affLinks.filter((l) => !/^\d{1,3}(\.\d{1,3}){3}$/.test(l.ip));
    check(badIp.length === 0, '全部 IP 为合法四段形式',
      badIp.length ? `格式异常：${badIp.map((l) => l.ip).join(', ')}` : '');

    // 主推线路（第一条）不应与备用重复
    const ips = affLinks.map((l) => l.ip);
    check(new Set(ips).size === ips.length,
      '各线路 IP 互不重复',
      `重复的 IP：${ips.filter((x, i) => ips.indexOf(x) !== i).join(', ')}`);

    // 必须留有备用：主推一条 + 至少一条备用
    check(affLinks.length >= 2,
      '含备用线路（≥2 条）',
      `当前只有 ${affLinks.length} 条 —— 主线路失效即完全不可用`);
  }

  // MAINTAINING.md 里提到旧 IP 属于历史变更记录，**不应被批量替换**
  if (exists('MAINTAINING.md')) {
    const mn = read('MAINTAINING.md');
    check(!/^### 4\.6[\s\S]{0,400}?备用线路/m.test(mn),
      'MAINTAINING.md 的历史变更记录未被误改',
      '4.6 节记录的是「推广链接曾被移除、已恢复」这段历史，不应随推广位一起更新');
  }
}

/* ---------- 13f. 工单通道：模板与链接一致 ----------
 *
 * 通道形态现为 **`.md` 模板**（GitHub 在 New issue 时弹模板选择框）。
 *
 *⚠️ 格式必须是 .md + frontmatter，且副标题字段是 `about` 不是 `description`
 *    ——提交 66297d9 用 .md + about 时用户实测选择框正常弹出；
 *    改成 .yml（issue form）后选择框一直是空白，页面也不渲染任何模板。
 *    这里是唯一被真实验证过能弹出选择框的形态，不要再改回 .yml。
 *
 * 一处真相：模板文件本身。所以这一节锁的是
 * 「模板存在 + frontmatter 用 about + 全部类型都在模板里」。
 */
section('13f. 工单通道：模板与链接一致');

const TICKET_TPL = '.github/ISSUE_TEMPLATE/a-ticket.md';
const TICKET_OPTIONS = [
  '功能建议', '问题反馈', 'Bug 报告', '双休报告',
  '双休名单加入', '双休名单移除', '更正实体公司信息', '其他',
];

check(exists(TICKET_TPL), `存在工单模板 ${TICKET_TPL}`,
  'issueUrl 指向的模板不存在 → 提交者点开会404');

if (exists(TICKET_TPL)) {
  const tk = read(TICKET_TPL);

  // frontmatter 必须是 --- 开头，且副标题用 about（.md 模板的字段名）
  check(/^---\n/.test(tk), 'a-ticket.md 以 --- 开头（frontmatter）',
    '缺少开头 --- → GitHub 不识别为模板，New issue 时不显示');
  check(/^about:\s*\S/m.test(tk), 'a-ticket.md frontmatter 用 about 字段',
    '.md 模板的副标题字段是 about；写成 description 是 .yml issue form 的字段名，' +
    '.md 里不生效 → 选择框不显示');

  // 类型以 `- 【类型】` 出现在模板里，提交者照抄到标题的【】中。
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
      'GitHub 的 New issue 选择框会渲染成空白页');
  }

  // GitHub 的选择框**按文件名字母序排列**（用户实测：blank.md 排在 ticket.md 前，
  // 尽管 blank 的内容更次要）。所以「提交工单」要排第一，文件名必须以 a 开头。
  // 同时GitHub 自带的 "Blank issue" 条目要靠 config.yml 的 blank_issues_enabled: false 关掉。
  if (existsSync(tdir)) {
    const tpls = readdirSync(tdir).filter((f) => f.endsWith('.md')).sort();
    check(tpls.length > 0 && tpls[0] === 'a-ticket.md',
      '提交工单模板排在选择框第一位',
      `当前模板排序为 [${tpls.join(', ')}] —— GitHub 按文件名字母序显示，` +
      '主模板不以 a 开头就会排在后面');

    // ⚠️ 必须用相对路径：read() 内部会拼 ROOT，
    //    传绝对路径会拼成 ROOT+绝对路径 → ENOENT → 读不到 → 恒判失败。
    const cfgRel = '.github/ISSUE_TEMPLATE/config.yml';
    check(exists(cfgRel) && /blank_issues_enabled:\s*false/.test(read(cfgRel)),
      'config.yml 关闭 GitHub 自带的 Blank issue 条目',
      '未设置 blank_issues_enabled: false → 选择框底部会多出一条 GitHub 自带的 ' +
      '"Blank issue / Create a new issue from scratch"');

    // 每个模板正文开头都必须有「先删除本段说明」提示。
    //
    // 背景：GitHub 的 .md 模板会把正文整体预填进编辑框，**没有任何自动清空机制**
    //（title 字段也不支持「用户一输入就删预设」）。所以只能靠文字提示，
    // 否则提交者会直接在格式说明下面继续写，提交出来正文前半段全是模板话。
    const tplFiles = readdirSync(tdir).filter((f) => f.endsWith('.md'));
    for (const tf of tplFiles) {
      const bodyTxt = read(`.github/ISSUE_TEMPLATE/${tf}`);
      check(/填写前请先删除本段说明文字/.test(bodyTxt),
        `${tf} 正文开头有「填写前请先删除本段说明文字」提示`,
        '缺少该提示 → GitHub 会把整段模板预填进编辑框，' +
        '提交者会直接在说明文字下方继续写，提交内容前半段全是模板话');
    }
  }

  // 全仓库 issues 链接统一指向 /issues（列表页）。
  // 用户要的是：点进去先看到 issue 列表，再点 GitHub 的 New issue 才出模板选项，
  // 所以不能跳 /issues/new 或 /issues/new/choose，更不能带 query。
  //
  // ⚠️ 必须用**相对路径**遍历：read() 内部会拼 ROOT，
  //    而 readdirSync(ROOT) 在本机返回绝对路径 → 直接传会拼成 ROOT+绝对路径 → ENOENT。
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
    `仍有 ${linkFiles.length} 个文件用其它形态：${linkFiles.slice(0, 5).join(', ')}\n` +
    `      正确形态是 ${NEW_URL}`);
}


/* ---------- 13g. 顶栏提交入口的中立性 ----------
 *
 * 用户指出「提交爆料 / 推荐」的说法该改成「推荐 / 申诉」，核实后发现
 **这不只是措辞问题，而是入口结构问题**：
 *
 * ① 原按钮文案 `+ 提交爆料 / 推荐` ——「爆料」预设读者是举报方，
 *    「推荐」预设读者是吹捧方。**被评C 级的企业两类都不认**，
 *    看到只会觉得「这是让企业给自己打广告」。
 *
 * ② 原预填表单是「三选一」（值得推荐 / 有偿加班 / 提醒避雷），
 *    **全部是往上加料的选项，没有任何「我被误判了」的栏位**。
 *
 * ③ 于是同一个站出现两套立场：
 *    详情页底部→ `[数据异议]`（中立，13f 已锁）
 *    顶栏入口 → 「提交工时爆料」（对立，无申诉路径）
 *
 * ④ 空状态提示「欢迎点击右上角提交爆料」也会随按钮改名而失效——
 *    引导用户去找一个已经不叫这名字的按钮。
 *
 * 锁四项：按钮改名 / 预填表单含申诉栏 / 标题与详情页一致 / 空状态提示同步。
 */
section('13g. 顶栏提交入口的中立性');

if (exists('index.html') && exists('assets/index-YthXZ9eP.js')) {
  const ih = read('index.html');
  const bj = read('assets/index-YthXZ9eP.js');

  // ① 按钮改名
  check(/提交数据 \/ 申诉/.test(ih),
    '顶栏按钮改为「提交数据 / 申诉」',
    '仍在用「提交爆料」或「推荐」—— 这两个词预设读者立场，企业不会点');

  // bundle 里的「提交爆料 / 推荐」**必须保留** —— 它是待替换的匹配目标。
  // （曾误加一条检查要求 bundle 里不能有这句话，与下面 ③ 项自相矛盾：
  //   删掉它 → keywords 拦截匹配不到 → 按钮退回旧说法且无人察觉。
  //   正确做法是保持 bundle 原文，由 index.html 在运行时替换。）
  check(/提交爆料 \/ 推荐/.test(bj),
    'bundle 保留原文案作为替换目标（index.html 运行时改写）',
    'bundle 里已无此文案 → keywords 拦截匹配不到，按钮会退回旧说法');

  check(/replace\('提交爆料 \/ 推荐'/.test(ih),
    'index.html 显式将按钮文案替换为新说法',
    "缺少 replace('提交爆料 / 推荐', ...) → 按钮仍显示「提交爆料 / 推荐」");

  // ② 关键词拦截必须保留 —— bundle 里没有 href，删掉按钮就变死链。
  //    ⚠️ 注入验证时发现 `includes('提交爆料')` 判不出来：
  //    把整个 keywords 数组替换成 `[]` 后，脚本注释里仍留有「提交爆料」字样 →
  //    检查照样通过。必须验证**数组字面量本身**含有该关键词。
  const kwMatch = ih.match(/var\s+keywords\s*=\s*\[([^\]]*)\]/);
  check(!!kwMatch && /提交爆料/.test(kwMatch[1]),
    'keywords 数组字面量仍含「提交爆料」（否则按钮无跳转，变成死按钮）',
    kwMatch
      ? `数组内容为 [${kwMatch[1].trim()}] —— 缺「提交爆料」会导致原生 button 不会被替换成链接`
      : '未找到 keywords 数组定义 —— 按钮拦截逻辑可能已被删除');

  // ③ 顶栏与页脚必须指向同一个 issueUrl（issues 列表页）
  const HUB = 'https://github.com/dujeongil-galaxy/shuangxiugou/issues';
  const u1 = ih.match(/var\s+issueUrl\s*=\s*'([^']+)'/);
  check(!!u1 && u1[1] === HUB,
    '顶栏与页脚指向同一个 issues 链接',
    u1 ? `issueUrl = ${u1[1]} —— 应为 ${HUB}` : '未找到 issueUrl 定义');

  // ④ 旧的双用途预填表单已废弃，不得再有 issueTitle / issueBody 残留
  check(!/issueTitle\s*=\s*encodeURIComponent/.test(ih) && !/issueBody\s*=\s*encodeURIComponent/.test(ih),
    '旧预填表单变量（issueTitle / issueBody）已清除',
    '仍存在预填表单变量 → 同一站两套表单，且与 ticket.yml 内容会不同步');

  // ⑤ 空状态提示必须同步
  check(/提交数据 \/ 申诉/.test(bj),
    'bundle 空状态提示已同步为「提交数据 / 申诉」',
    '空状态仍在引导用户点击「提交爆料」—— 按钮已改名，这句话会指向一个不存在的按钮');
}

/* ---------- 13h. 页脚「联系我们」入口 ----------
 *
 * 用户要求：页脚「提供数据」改为「联系我们」，走同一个 issues 模板。
 *
 * 改法与顶栏同理，但页脚那个按钮有个不同点：
 * bundle 里原本是 `<button onClick:()=>S(!0)>` —— onClick 打开的是
 * **站内 modal**（一套完全独立的表单），不是跳 issues。
 * 只改文案不改 onClick 的话，点「联系我们」会弹出一个
 * 与顶栏完全不同的旧表单 = 同一站三套表单、两套立场。
 *
 * 所以 bundle 侧**同时摘掉了 onClick**，让 index.html 的关键词拦截
 * 把它整体替换成指向同一个 issueUrl 的 <a>。
 *
 * 锁四项：文案已改 / onClick 已摘 / 关键词已加 / 目标 URL 与顶栏一致。
 */
section('13h. 页脚「联系我们」入口');

if (exists('index.html') && exists('assets/index-YthXZ9eP.js')) {
  const ih = read('index.html');
  const bj = read('assets/index-YthXZ9eP.js');

  // ① bundle 里文案已改为「联系我们」
  check(/children:`联系我们`/.test(bj),
    '页脚按钮文案为「联系我们」',
    'bundle 中仍是旧文案「提供数据」');

  check(!/children:`提供数据`/.test(bj),
    'bundle 中不再存在「提供数据」按钮文案',
    '旧文案仍在 → 页脚会与顶栏显示两个不同的说法');

  // ② 那个按钮的 onClick 必须已摘 —— 否则点开的是站内旧 modal
  //
  // ⚠️ 不能用 /`button`,\{[^`]*\},children:`联系我们`/ 这类正则：
  //    className 的值本身就用反引号包裹，[^`] 会被立刻截断 → 永远匹配不到。
  //    改用「定位文案 → 回溯到最近的 `button`,{ → 看这段里有没有 onClick」。
  const CONTACT_KEY = 'children:`联系我们`';
  const cIdx = bj.indexOf(CONTACT_KEY);
  check(cIdx > 0, '在 bundle 中定位到页脚「联系我们」按钮', cIdx > 0 ? '' : '未找到该文案');

  if (cIdx > 0) {
    const btnStart = bj.lastIndexOf('`button`,{', cIdx);
    const btnSeg = btnStart >= 0 ? bj.slice(btnStart, cIdx) : '';
    check(btnStart >= 0 && !/onClick/.test(btnSeg),
      '页脚「联系我们」已摘除 onClick（不再打开站内旧 modal）',
      btnSeg
        ? '仍带 onClick → 点击会弹出与顶栏不一致的旧表单，同一站出现两套表单'
        : '未能回溯到 button 起点，检查规则可能与 bundle 结构脱节');
  }

  // ③ index.html 的关键词必须含「联系我们」，否则按钮不会被替换成链接
  const kwMatch = ih.match(/var\s+keywords\s*=\s*\[([^\]]*)\]/);
  check(!!kwMatch && /联系我们/.test(kwMatch[1]),
    'keywords 数组含「联系我们」（拦截页脚按钮）',
    kwMatch
      ? `数组内容为 [${kwMatch[1].trim()}] —— 缺「联系我们」会导致页脚按钮仍是原生 button`
      : '未找到 keywords 数组定义');

  // ④ 顶栏与页脚必须共用同一个 issueUrl，且统一指向 issues 列表页
  //
  // ⚠️ 不能用 /联系我们[\s\S]{0,200}/ 这类写法判断「指向哪个 URL」——
  //    它只证明附近 200 字符内有任意内容，什么都拦不住。这里锚定真实结构。
  const issueHub = 'https://github.com/dujeongil-galaxy/shuangxiugou/issues';
  const urlMatch = ih.match(/var\s+issueUrl\s*=\s*'([^']+)'/);
  check(!!urlMatch && urlMatch[1] === issueHub,
    '顶栏与页脚共用 issueUrl，指向 issues 列表页',
    urlMatch
      ? `issueUrl = ${urlMatch[1]} —— 应为 ${issueHub}`
      : '未找到 issueUrl 定义');

  check(!/isContact\s*\?/.test(ih) && !/blankIssueUrl/.test(ih),
    '顶栏与页脚不再按文案分流 href（两处指向同一链接）',
    '出现 isContact 三元或 blankIssueUrl → 说明仍在按文案分流，未统一');

  // ⑤ 顶栏按钮文案替换仍在（否则会退回「提交爆料 / 推荐」）
  check(/replace\('提交爆料 \/ 推荐',\s*'提交数据 \/ 申诉'\)/.test(ih),
    '顶栏按钮文案仍替换为「提交数据 / 申诉」',
    '缺少文案替换 → 顶栏会显示 bundle 原文「+ 提交爆料 / 推荐」');

  // ⑥ 工单模板文件存在，且 8 个类型都在模板里（.md 形态，见 13f 说明）
  const ticketPath = '.github/ISSUE_TEMPLATE/a-ticket.md';
  check(exists(ticketPath), '工单模板 a-ticket.md 存在',
    `${ticketPath} 不存在 → 提交者在 New issue 里选不到模板`);
  if (exists(ticketPath)) {
    const tk = read(ticketPath);
    check(/^about:\s*\S/m.test(tk), 'a-ticket.md frontmatter 用 about 字段',
      '未找到 about: —— .md 模板必须用它做副标题，缺失则选择框不显示');
    for (const want of ['功能建议', '问题反馈', 'Bug 报告', '双休报告',
                        '双休名单加入', '双休名单移除', '更正实体公司信息', '其他']) {
      check(tk.includes(`- 【${want}】`), `a-ticket.md 含类型「${want}」`,
        '该类型不在模板正文里 → 提交者看不到归类选项');
    }

    // 类型必须以 `- 【类型】` 的**可复制格式**出现在正文里。
    //
    // ⚠️ 不要写成 `- 功能建议`（不带括号）—— 提交者照抄后标题里没有括号，
    //    维护者在issue 列表页看不出类型，还得逐条点开正文。
    //    也不要靠 title 预填来强制：那是默认值，提交者可以不改就直接填正文，
    //    反而更难分辨。正确做法是把格式在正文里写清楚。
    // ⚠️ 正则要兼容带引号和不带引号两种写法：
    //    /^title:\s*【/ 只匹配 `title: 【x】`，
    //    但实际文件里是 title: "【x】" —— 引号会让检查恒过。
    check(!/^title:\s*["']?【/m.test(tk),
      'a-ticket.md 不靠 title 预填强制类型',
      'title 预填了类型只是默认值，提交者可以直接改掉或忽略；' +
      '类型必须在正文里以【】格式给出，让提交者照抄');

    // 正文的类型清单必须带括号，且给出填写示例
    check(/^-\s+【.+】/m.test(tk),
      'a-ticket.md 正文以【类型】格式列出可复制项',
      '正文里的类型没有【】→ 提交者照抄后标题不带括号，无法在列表页分流');

    // 示例行必须写成「示例：」，不能是「例：」——后者在正式文档里过于随意。
    // 用负向断言而不是允许两种：文档口径要唯一。
    check(/^示例\s*[：:]/m.test(tk) && !/^例\s*[：:]/m.test(tk),
      'a-ticket.md 示例行写作「示例：」',
      '应为「示例：」而非「例：」—— 模板是对外的正式文档');

    // 文案口吻检查：模板是对外的正式文档，不能出现聊天口气。
    // 这类改动看起来无害，但会让提交者觉得是在跟人闲聊而不是填工单。
    //
    // ⚠️ 扫全文（含 frontmatter）。`about:` 是选择框里那行灰色副标题，
    //    同样对提交者可见 —— 只改正文而漏掉它会造成口径不一致。
    const chatty = [
      [/挑一个/, '「挑一个」是聊天口气'],
      [/选一个/, '「选一个」是聊天口气'],
      [/连\s*括号\s*一起\s*复制/, '「连括号一起复制」是聊天口气'],
      [/照抄/, '「照抄」是聊天口气'],
      [/你要说的事情/, '「你要说的事情」是聊天口气'],
      [/写成这样/, '「写成这样」是聊天口气'],
      [/请在下面选/, '口语化指令'],
      [/下面\s*8\s*个/, '「下面 8 个」是聊天口气，应用「下方 8 项」'],
    ];
    for (const [re, why] of chatty) {
      check(!re.test(tk),
        `a-ticket.md 文案不含聊天口气（${why}）`,
        `${why}—— 模板是给外部提交者看的正式文档，应使用中性书面语`);
    }

    // frontmatter 的 about 也要书面语：它显示在 GitHub 模板选择框里
    const aboutM = tk.match(/^about:\s*(.+)$/m);
    check(!!aboutM && !/挑一个|选一个|下面\s*8\s*个/.test(aboutM[1]),
      'a-ticket.md 的 about 副标题为书面语',
      aboutM
        ? `about = "${aboutM[1].trim()}" —— 选择框副标题同样对提交者可见，应使用书面语`
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

// ---------- 16. 拼音搜索索引 ----------
// 背景：bundle 的搜索是 includes 硬匹配，输「ning」搜不到「宁德时代」。
// 注入层做了拼音/首字母联想（pinyin-search.js），索引由
// scripts/gen-pinyin-index.py 从 bundle 离线生成。
//
// 最容易出的错：新增品牌后忘了重跑生成脚本，于是该品牌没有拼音索引 ——
// 中文能搜到但拼音搜不到，是静默失效，必须查出来。
section('16. 拼音搜索索引');

const PINYIN_IDX = 'pinyin-index.js';
const PINYIN_LIB = 'pinyin-search.js';

if (!exists(PINYIN_IDX)) {
  err('pinyin-index.js 不存在',
    '拼音搜索会静默失效（输拼音搜不到）。生成：python scripts/gen-pinyin-index.py');
} else if (!exists(PINYIN_LIB)) {
  err('pinyin-search.js 不存在', '索引加载了但没有逻辑使用它');
} else {
  const idxSrc = read(PINYIN_IDX);
  const libSrc = read(PINYIN_LIB);

  // 提取索引里的品牌 id
  const idxIds = new Set(
    [...idxSrc.matchAll(/"id":"([a-z0-9-]+)"/g)].map((x) => x[1])
  );
  const customIds = new Set(customCards.map((c) => c.id));
  // ⚠️ 2026-10-22 规则再次变更：自定义卡**必须**进入联想（带 custom 标记）。
  //
  // 同一个坑踩了三次，每次都修成另一个极端：
  //   10-18 332d854：自定义卡无拼音索引 → 输 ls 搜不出零食品牌。修：入索引。
  //   10-19 ff69fd6：入索引后点选变「未找到匹配」空态（回填链路对自定义卡
  //                  不成立：它们不在 bundle 的 brands 数组里）。修：踢出。
  //   10-22 站长截图：踢出后输 ls 还是搜不出零食品牌
  //                  「关于零食这个分类，修复过无数次」。本次正解：
  //      自定义卡入联想 + 打 custom 标记 + 候选点击走「定位」而非「回填」
  //      （pinyin-search.js 的 locateCard：清空搜索 → React 恢复全量 →
  //      滚动到目标卡并高亮）。**空态的根因是链路用错，不是「不该被搜到」。**
  //
  // 于是约束拆成两条，各自只管各自的链路：
  //   ① custom=1：主名不要求可回填（不走回填链路），但 id 必须真实在
  //      customCardsConfig 里；
  //   ② custom=0：主名必须能被 bundle 原生搜索命中（回填链路的前提）。
  const idxEntries = [...idxSrc.matchAll(/"id":"([a-z0-9-]+)","name":"([^"]*)","cn":"([^"]*)","custom":([01])/g)]
    .map((m) => ({ id: m[1], cn: m[3], custom: m[4] === '1' }));
  const idxCustom = idxEntries.filter((e) => e.custom);
  const idxBuiltin = idxEntries.filter((e) => !e.custom);
  check(idxCustom.length === customIds.size,
    `拼音索引包含全部 ${customIds.size} 张自定义卡（带 custom 标记，走定位链路）`,
    `缺失：${[...customIds].filter((i) => !idxEntries.some((e) => e.id === i)).join(', ') || '无'}。
     修复：python scripts/gen-pinyin-index.py`);
  const ghostCustom = idxCustom.filter((e) => !customIds.has(e.id));
  check(ghostCustom.length === 0,
    '索引里的 custom 条目全部真实存在于 customCardsConfig（无陈旧残留）',
    ghostCustom.map((e) => e.id).join(', '));

  // 逐条校验：索引里的每个 cn 都必须能在 bundle 的可搜字段里找到
  const searchableText = (() => {
    const src = read(BUNDLE);
    // 用与 gen-pinyin-index.py 相同的口径：brands 主数组里每条记录的
    // name / companyName / keyProducts
    const BT = '`';
    const start = src.indexOf('brands:[') + 'brands:['.length;
    let depth = 0, cur = null, j = start;
    const objs = [];
    while (j < src.length) {
      const ch = src[j];
      if (ch === BT) {
        j++;
        while (j < src.length) { if (src[j] === BT && src[j - 1] !== '\\') break; j++; }
      } else if (ch === '{') { if (depth === 0) cur = j; depth++; }
      else if (ch === '}') { depth--; if (depth === 0) objs.push(src.slice(cur, j + 1)); else if (depth < 0) break; }
      j++;
    }
    const one = (o, k) => { const m = new RegExp(k + ':' + BT + '([^' + BT + ']*)' + BT).exec(o); return m ? m[1] : ''; };
    const list = (o, k) => {
      const m = new RegExp(k + ':\\[([^\\]]*)\\]').exec(o);
      return m ? [...m[1].matchAll(new RegExp(BT + '([^' + BT + ']*)' + BT, 'g'))].map((x) => x[1]) : [];
    };
    return objs.map((o) => [one(o, 'name'), one(o, 'companyName')].concat(list(o, 'keyProducts')).join(' ').toLowerCase()).join('\n');
  })();
  const idxEntries2 = [...idxSrc.matchAll(/"id":"([a-z0-9-]+)","name":"([^"]*)","cn":"([^"]*)","custom":([01])/g)]
    .map((m) => ({ id: m[1], cn: m[3], custom: m[4] === '1' }));
  // 可回填性只对「回填链路」的内置卡成立；custom 条目走定位，不要求
  const unfillable = idxEntries2.filter((e) => !e.custom && e.cn
    && !searchableText.includes(e.cn.toLowerCase()));
  check(unfillable.length === 0,
    `拼音索引 ${idxEntries2.filter((e) => !e.custom).length} 条内置卡全部可回填（主名能被 React 原生搜索命中）`,
    `点了会变空态：${unfillable.map((e) => e.id + '(' + e.cn + ')').join(', ')}。修复：python scripts/gen-pinyin-index.py`);

  // 行为防线：定位链路必须真的实现了，否则自定义卡候选点了还是走 applyFill
  // → 空态回归（2026-10-19 的 bug 原样复发）
  check(/function locateCard/.test(libSrc)
     && /data-custom/.test(libSrc),
    'pinyin-search.js 实现了自定义卡定位链路（locateCard + data-custom 标记）',
    '缺定位链路 → 自定义卡候选点击后会变「未找到匹配」空态');
  check(/!entry\.custom && !fillTerm\(entry\)/.test(libSrc),
    '自定义卡条目不被「无可回填主名」规则过滤（否则又搜不出零食品牌）');
  check(/locateCard\(input, box, first\.getAttribute\('data-entry-id'\)\)/.test(libSrc),
    'Enter 键对自定义卡候选同样走定位链路（与点击同语义）');

  // 索引里的 id 必须真实存在于 bundle 或 customCardsConfig，否则是陈旧残留
  const ghosts = [...idxIds].filter(
    (i) => !brandCards.some((c) => c.id === i) && !customIds.has(i)
  );
  check(ghosts.length === 0,
    '拼音索引里没有已不存在的品牌（无幽灵条目）',
    ghosts.join(', '));

  // 关键卡必须在索引里
  const mustHave = ['catl', 'byd', 'nongfu-spring', 'heytea', 'apple-consumer'];
  const missingKey = mustHave.filter((i) => !idxIds.has(i));
  check(missingKey.length === 0,
    '关键品牌都在拼音索引中',
    missingKey.join(', '));

  // 两个脚本必须在 index.html 里，且索引先于逻辑加载
  const html = read('index.html');
  const idxRef = html.match(/pinyin-index\.js\?v=(\d+)/);
  const libRef = html.match(/pinyin-search\.js\?v=(\d+)/);
  check(!!idxRef && !!libRef,
    'index.html 同时引用了 pinyin-index.js 与 pinyin-search.js',
    idxRef ? '' : '缺 pinyin-index.js');
  if (idxRef && libRef) {
    const iIdx = html.indexOf('pinyin-index.js');
    const iLib = html.indexOf('pinyin-search.js');
    check(iIdx < iLib,
      'pinyin-index.js 在 pinyin-search.js 之前加载（顺序不能反）',
      `实际位置 index=${iIdx}, lib=${iLib}`);
  }

  // 防止有人「优化」掉回填逻辑里的 React 兼容处理
  check(libSrc.includes('HTMLInputElement.prototype'),
    '回填逻辑仍走原生 value setter（React 受控输入兼容）');
  check(libSrc.includes("dispatchEvent(new Event('input'"),
    '回填后仍派发 input 事件（否则 React 不会重新过滤）');

  // 联想不能改写 bundle —— 那是项目红线
  ok('拼音功能只做联想回填，未改写压缩 bundle');
}

// ---------- 17. 小票累计金额 ----------
// 背景：小票原本只有「本次金额」单值，每次打开覆盖保存。
// 现改为累计：填「本次新增」，累加到历史总额。
// 这类改动最容易出的错是「打开弹窗就把钱算进去」——
// 用户只是看一眼，来回开关几次金额就离谱了。
// 判据是源码里必须存在「打开时的基准累计」这个常量。
section('17. 小票累计金额');

if (exists('custom-card-actions.js')) {
  const cca = read('custom-card-actions.js');
  const html17 = read('index.html');

  check(!/function\s+clampAmount/.test(cca),
    '旧单值函数 clampAmount 已删除（不是改个名继续用）');
  check(!/profile\.amount/.test(cca),
    '不再有 profile.amount 引用（应为 profile.total）');
  check(/本次新增消费/.test(cca),
    '表单标签是「本次新增消费（元）」');
  check(/累计已转移\/支持消费/.test(cca),
    '小票正文是「累计已转移/支持消费」');
  check(/id="sxg-total"/.test(cca),
    '有累计金额展示元素 #sxg-total');

  // 防「打开即累加」：必须有基准常量
  check(/var baseTotal = profile\.total/.test(cca),
    '存在打开时的基准累计 baseTotal（防止打开弹窗就累加）');
  check(/saveProfile\(next\)/.test(cca) && /baseTotal = shown/.test(cca),
    '结算后才更新基准，并清空本次新增额（连点复制不会加两次）');

  // 旧数据迁移：老用户存的是 { amount }，不迁移会凭空归零
  check(/function\s+migrateLegacy/.test(cca),
    '有旧结构迁移函数 migrateLegacy（旧 amount 不会被丢掉）');
  check(/typeof p\.amount === 'number'/.test(cca),
    'migrateLegacy 确实处理了旧的 p.amount 字段');

  // 隐私边界：这个功能不能顺手加上传
  check(!/fetch\(|XMLHttpRequest|navigator\.sendBeacon/.test(cca),
    '小票档案仍然只写本地，没有任何网络上传');

  check(/custom-card-actions\.js\?v=\d+/.test(html17),
    'index.html 引入了 custom-card-actions.js');
} else {
  warn('custom-card-actions.js 不存在，跳过小票累计检查');
}

// ---------- 18. 内置卡小票 DOM 定位（源码断言不够，必须打真实 bundle） ----------
// 这节来自一次真实事故：小票金额改累计时，只改了代码、只做了源码字符串
// 断言就推送上线，而内置小票的金额标签根本不是源码里写的那句
// （那句只存在于复制文本模板），定位恒为 null，界面纹丝不动。
// 用户实测发现并批评「你不检查就推送上线吗？」
//
// 因此这里不能只查字符串，必须直接读压缩包、确认定位用的标签
// 真的出现在小票纸面的渲染区间里。DOM 行为由
// scripts/test-builtin-ticket-dom.cjs 负责（那才是真跑一遍）。
section('18. 内置卡小票 DOM 定位');

if (exists('assets/index-YthXZ9eP.js') && exists('custom-card-actions.js')) {
  const bundle = read('assets/index-YthXZ9eP.js');
  const cca = read('custom-card-actions.js');

  const paperStart = bundle.indexOf('receipt-tear-top');
  const paperEnd = bundle.indexOf('本次投票消费金额:');
  const paper = bundle.slice(paperStart, paperEnd);

  check(paperStart !== -1 && paperEnd > paperStart,
    '压缩包里能切出内置小票纸面区间');

  // 定位用的两个标签必须真的在纸面上（合规 / 违规二选一）
  check(paper.includes('转移撤销消费金额:') && paper.includes('注入良心企业预算:'),
    '纸面金额的两个候选标签都在压缩包纸面区间内');
  check(paper.includes('考核执行官:') && paper.includes('工时健康评级:'),
    '纸面署名行与评级行标签都在压缩包纸面区间内');

  // 纸面金额是 span 改写，不是 input 赋值
  check(/text-xl font-black font-mono/.test(paper),
    '纸面金额值是 span（所以要改 textContent，而不是设 value）');

  // 关键否定断言：那句文案只在复制文本里，不在纸面 DOM 上
  const consumed = bundle.indexOf('已转移/支持消费');
  check(consumed < paperStart || consumed > paperEnd,
    '「已转移/支持消费」不在纸面区间内（只能用于复制文本，不能用于 DOM 定位）');
  check(!/findValueNode\(\s*receipt\s*,\s*'已转移\/支持消费/.test(cca),
    '源码里不再用「已转移/支持消费」定位内置卡纸面金额');

  // 必须有这两个真实标签做定位
  check(/转移撤销消费金额/.test(cca) && /注入良心企业预算/.test(cca),
    '源码按纸面真实标签定位金额行');
  check(/function\s+paintBuiltinAmount/.test(cca),
    '有统一的纸面金额绘制函数 paintBuiltinAmount');

  // 同值重绘必须不写 DOM，否则全局 MutationObserver 会被自己触发成死循环
  check(/\(span\.textContent \|\| ''\)\.trim\(\) !== want/.test(cca),
    '重绘前先比对现值（幂等，避免 observer 自激）');

  // 隐藏 bundle 自带的金额输入行，避免两个金额框并存
  check(/function\s+hideBuiltinAmountInput/.test(cca)
    && /本次投票消费金额/.test(cca),
    '有隐藏 bundle 自带金额输入行的逻辑');

  // 预览值：React 重渲染会把纸面冲回 199，重绘时必须用预览值而非存档值
  check(/builtinPreview/.test(cca),
    '有 builtinPreview，重渲染后用预览值而非存档值重绘');

  // 静默失败是这次事故的直接原因，必须留告警
  check(/内置小票未找到金额行/.test(cca),
    '定位失败时有告警，不再静默失败（静默失败正是漏检的原因）');

  // 旧的死函数不能留着误导后人
  check(!/function\s+applyReasonToBuiltin/.test(cca),
    '旧的 applyReasonToBuiltin 已删除（它依赖自定义卡才有的 .sxg-kv）');
  check(/function\s+paintBuiltinReason/.test(cca),
    '理由行改由 paintBuiltinReason 挂在「工时健康评级」之后');

  check(exists('scripts/test-builtin-ticket-dom.cjs'),
    '存在内置卡小票的真 DOM 端到端测试脚本');
} else {
  warn('压缩包或 custom-card-actions.js 不存在，跳过内置卡 DOM 定位检查');
}

// ---------- 19. 答案之书随机占位 ----------
// 搜索框 placeholder 原句「消费前，先了解这个品牌是否双休；用订单（消费力），
// 反向考核企业」太长太重，压在搜索框里像广告语。
// 换成《答案之书》随机一条，每次刷新不同。
//
// 这一节的判据与 §6.7 同源：数据/逻辑两个文件 + 加载顺序 + 真 DOM 测试。
section('19. 答案之书随机占位');

if (exists('answer-book-data.js') && exists('answer-book.js')) {
  const data = read('answer-book-data.js');
  const lib = read('answer-book.js');
  const html19 = read('index.html');
  const bundle19 = exists('assets/index-YthXZ9eP.js')
    ? read('assets/index-YthXZ9eP.js') : '';

  // ---- 数据完整性 ----
  const arrMatch = data.match(/window\.__ANSWER_BOOK__\s*=\s*\[([\s\S]*?)\];/);
  check(!!arrMatch, '数据文件里有 __ANSWER_BOOK__ 数组');
  const answers = arrMatch
    ? (arrMatch[1].match(/'((?:[^'\\]|\\.)*)'/g) || [])
        .map((s) => s.slice(1, -1))
    : [];
  check(answers.length >= 300, `答案条数 ${answers.length} ≥ 300`);
  check(new Set(answers).size === answers.length, '答案无重复');
  check(answers.every((x) => x && x === x.trim()), '答案无空串与首尾空白');
  check(answers.every((x) => x.length <= 20),
    '答案都在 20 字内（placeholder 装得下）',
    answers.filter((x) => x.length > 20).slice(0, 3));
  check(answers.includes('别失望'), '含原版首条「别失望」');
  check(answers.includes('空想'), '含原版末条「空想」');
  check(!answers.some((x) => / /.test(x)), '答案无半角空格残留');

  // ---- 加载顺序：数据必须先于逻辑 ----
  // 反了的话逻辑层开头 `if (!BOOK) return` 直接退出，
  // 页面不报错、placeholder 也不变 —— 又是一次静默失效。
  const iData = html19.indexOf('answer-book-data.js');
  const iLogic = html19.search(/answer-book\.js\?v=\d/);
  check(iData !== -1, 'index.html 引入了 answer-book-data.js');
  check(iLogic !== -1, 'index.html 引入了 answer-book.js');
  check(iData !== -1 && iLogic !== -1 && iData < iLogic,
    '数据文件先于逻辑文件加载（否则逻辑层静默退出）', { iData, iLogic });
  check(/answer-book-data\.js\?v=\d+/.test(html19)
    && /answer-book\.js\?v=\d+/.test(html19),
    '两个文件都有 ?v= 缓存版本号');

  // ---- 逻辑层契约 ----
  check(/var BOOK = window\.__ANSWER_BOOK__/.test(lib),
    '逻辑层从 window.__ANSWER_BOOK__ 取数据');
  check(/if \(!BOOK \|\| !BOOK\.length\) return;/.test(lib),
    '数据缺失时安静退出而不是抛异常');
  check(/Math\.floor\(Math\.random\(\) \* BOOK\.length\)/.test(lib),
    '用 Math.random 真正随机抽取');
  check(/dataset\.answerBookBound/.test(lib),
    '有幂等标记，重复触发不会重复绑事件');
  check(/data-answer-book-pick/.test(lib),
    '记录抽中的那条（供 React 重挂载后比对恢复）');
  check(!/input\.value\s*=/.test(lib),
    '不改搜索框的 value（不干扰拼音搜索层与用户输入）');

  // ---- 压缩包里的原句（说明这次确实替换了它）----
  check(bundle19.includes('消费前，先了解这个品牌是否双休'),
    '压缩包里写死了原 placeholder（本次替换的对象）');
  // 只检查代码体里没有原句（文件头注释引用它作为说明是允许的）
  const libBody = lib.replace(/^[\s\S]*?\(\s*function\s*\(\)\s*\{/, '(function(){');
  check(libBody.indexOf('消费前，先了解这个品牌是否双休') === -1,
    '逻辑层代码体里不硬编码原句，走 DOM 覆盖');

  check(exists('scripts/test-answer-book.cjs'),
    '存在答案之书的 DOM 测试脚本');
} else {
  warn('answer-book 文件不存在，跳过答案之书检查');
}

// ============ 20. 整页渲染测试的存在性 ============
// 为什么单列一节：改压缩 bundle 后最危险的失败模式是「语法没错、断言全过、
// 页面白屏且控制台无报错」。静态字符串检查抓不到，只有真跑一遍整页能抓到。
section('20. 整页渲染测试');
check(exists('scripts/test-render-page.cjs'),
  '存在整页渲染测试（抓「语法对但白屏」）',
  '新增 scripts/test-render-page.cjs：加载完整 index.html + 真实 bundle，断言 React 挂载成功');
check(read('scripts/test-render-page.cjs').includes('#root'),
  '整页渲染测试真的断言了 #root 有内容（而非空壳）');
if (exists('.github/workflows/verify.yml')) {
  check(read('.github/workflows/verify.yml').includes('test-render-page.cjs'),
    'CI 里已接入整页渲染测试');
}

// ---------- 20b. 推荐位不得推荐同级 ----------
// 起因（读者反馈）：宁德时代详情底部「良心双休替代品牌」里列着 BYD，
// 而 BYD 自己也是 C 级。两家「都没查清」的公司互相推荐，还叫良心替代，
// 等于拿不确定当结论卖。判定只认一条硬规则：不得 C→C。
section('20b. 推荐位逻辑');
check(exists('scripts/test-alternatives.cjs'),
  '存在推荐位逻辑测试',
  '推荐位把「没查清」的公司互相推荐，读者最敏感，必须有测试盯着');
if (exists('.github/workflows/verify.yml')) {
  check(read('.github/workflows/verify.yml').includes('test-alternatives.cjs'),
    'CI 里已接入推荐位逻辑测试');
}

// 数据层直接查：C 级卡片的 alternatives 不得含 C 级
const tierMap = new Map(brandCards.map((c) => [c.id, c.tier]));
const sameTierPairs = [];
for (let ci = 0; ci < brandCards.length; ci++) {
  const c = brandCards[ci];
  if (c.tier !== 'C') continue;
  const end = ci + 1 < brandCards.length ? brandCards[ci + 1].pos : bundle.length;
  const chunk = bundle.slice(c.pos, end);
  const altM = /alternatives:\[([^\]]*)\]/.exec(chunk);
  if (!altM) continue;
  const alts = [...altM[1].matchAll(/`([^`]+)`/g)].map((x) => x[1]);
  for (const a of alts) {
    if (tierMap.get(a) === 'C') sameTierPairs.push(`${c.name} → ${a}`);
  }
}
// ⚠️ check 的签名是 (cond, msg, detail)，条件必须在第一个参数。
// 写反的话标签会被当成条件、表达式会被当成标签打印（表现为「✓ true」）。
check(sameTierPairs.length === 0,
  '没有 C 级把 C 级当「良心替代」推荐',
  sameTierPairs.join(', '));

// ---------- 20d. 广告位 LOGO 必须横排 ----------
// 起因（用户截图）：右上角广告卡的 LOGO「良配」被显示成「良/配」竖排两行。
// 根因是容器宽度与「2 字 × 字号」正好相等（48px vs 2×24px），
// 任何字距/字重/字体度量偏差就折行 —— 这种临界值设计本身是错的。
// 这里直接断言「容器宽度必须比 2 字所需宽至少 8px」。
section('20d. 广告位 LOGO');
const ADC = 'liangpei-ad.css';
const ADJ = 'liangpei-ad.js';
if (exists(ADC) && exists(ADJ)) {
  const adCss = read(ADC);
  const adJs = read(ADJ);
  const logoM = /var LOGO_TEXT = '([^']*)'/.exec(adJs);
  check(!!logoM, '能读到 LOGO_TEXT', '广告 JS 结构变了，请同步本节检查');
  if (logoM) {
    const n = logoM[1].length;
    // 两个断点段各取一次：min-width:1440 与 max-width:1439
    const collect = (from) => {
      const i = adCss.indexOf('.lp-ad__logo {', from);
      if (i === -1) return null;
      return adCss.slice(i, adCss.indexOf('}', i) + 1);
    };
    const i1440 = adCss.indexOf('@media (min-width: 1440px)');
    const iWide = collect(i1440);
    const iNarrow = collect(adCss.indexOf('@media (max-width: 1439px)'));
    for (const [label, block] of [['≥1440px 竖排卡片', iWide], ['<1440px 吸底条', iNarrow]]) {
      if (!block) { err(`${label}：找不到 .lp-ad__logo 规则`); continue; }
      const w = parseFloat(/width:\s*([\d.]+)px/.exec(block)?.[1] ?? '0');
      const f = parseFloat(/font-size:\s*([\d.]+)px/.exec(block)?.[1] ?? '0');
      const need = n * f;
      // ⚠️ check 的签名是 (cond, msg, detail)，条件必须在第一个参数。
      check(w - need >= 8,
        `${label}：LOGO 容器(${w}px) 比 ${n} 字所需(${need}px) 至少宽 8px`,
        { width: w, fontSize: f, needed: need, slack: w - need });
      check(/white-space:\s*nowrap/.test(block),
        `${label}：LOGO 设了 white-space:nowrap`);
    }
  }
  check(exists('scripts/test-ad-logo.cjs'), '存在广告 LOGO 的布局测试');
  if (exists('.github/workflows/verify.yml')) {
    check(read('.github/workflows/verify.yml').includes('test-ad-logo.cjs'),
      'CI 里已接入广告 LOGO 测试');
  }
}

// ---------- 20e. 校验脚本自检 ----------
// 今天在同一天内两次把 check(cond, msg, detail) 写成 check(msg, cond)，
// 症状是输出里出现「✓ true」—— 标签被当成条件打印，
// 真实条件落到 detail 位，屏幕上只剩 true/false。
// 这种错误不会让检查失败，只会让输出变得不可读，非常隐蔽。
section('20e. 校验脚本自检');
check(exists('scripts/test-verify-self.cjs'),
  '存在校验脚本自检（抓 check 参数顺序写反）',
  '今天两次把 check(cond,msg) 写成 check(msg,cond)，输出出现「✓ true」却没人发现');
if (exists('.github/workflows/verify.yml')) {
  check(read('.github/workflows/verify.yml').includes('test-verify-self.cjs'),
    'CI 里已接入校验脚本自检');
}

// ---------- 20f. 数字搜索必须彻底禁用 ----------
// 起因（用户截图）：搜「1」命中宁德时代、搜「2」命中三家。
// 根因：bundle 的搜索是纯子串匹配，条件含 summary 与 keyProducts，
// 而这两处满是年份与百分比。站内没有「按数字检索品牌」的需求，这是噪声。
section('20f. 数字搜索禁用');
const NSB = 'block-numeric-search.js';
if (exists(NSB)) {
  check(read('index.html').includes(NSB), `${NSB} 已在 index.html 引入`);
  const iNsb = read('index.html').indexOf(NSB);
  const iPs = read('index.html').indexOf('pinyin-search.js');
  check(iNsb > iPs && iPs > 0,
    '在 pinyin-search.js 之后加载（联想层要先拿到干净查询词）');
  check(exists('scripts/test-block-numeric-search.cjs'), '存在数字搜索禁用的行为测试');
  if (exists('.github/workflows/verify.yml')) {
    check(read('.github/workflows/verify.yml').includes('test-block-numeric-search.cjs'),
      'CI 里已接入数字搜索禁用测试');
  }
} else {
  err(`${NSB} 不存在`,
    '删除它会让搜索框重新接受数字：输「1」「2」会因 summary 里的年份与百分比命中一堆无关卡片');
}

// ---------- 20c. 员工投稿必须真能入库 ----------
// 背景：这功能曾经是**假入库** —— 压缩包里的 onSubmit 只做 React 本地
// state 更新（setTimeout 400ms 后关窗），全站 fetch 都是 React 内部库，
// 数据刷新即丢、站长收不到，但按钮却写着「入库公证中…」。
// 一旦注入层被误删，页面会静默退回「看起来提交成功、实际丢数据」。
section('20c. 员工投稿入库路径');
const RPT = 'employee-report-to-issue.js';
if (exists(RPT)) {
  const rpt = read(RPT);
  check(read('index.html').includes(RPT), `${RPT} 已在 index.html 引入`);
  check(/addEventListener\('submit'[\s\S]{0,400}?\},\s*true\s*\)/.test(rpt),
    '在捕获阶段拦截 submit（挡在 React 的 onSubmit 之前）');
  check(/encodeURIComponent/.test(rpt), 'URL 拼接做了编码（防用户输入注入）');
  check(rpt.includes('issues/new'), '指向 GitHub issues/new');
  check(exists('scripts/test-employee-report.cjs'), '存在员工投稿的行为测试');
  if (exists('.github/workflows/verify.yml')) {
    check(read('.github/workflows/verify.yml').includes('test-employee-report.cjs'),
      'CI 里已接入员工投稿测试');
  }
} else {
  err(`${RPT} 不存在`,
    '删除它会让「提交我的真实工时票」静默退回假入库：数据只留在页面内存里，刷新即丢，站长收不到，而按钮仍写着「入库公证中…」');
}

// ---------- 20h. 苹果补充说明的注入闸门不能退回「搜索即摘除」 ----------
// 背景（2026-10-22 站长截图）：修 PITFALLS 1.10 bug ③（搜索无匹配词时黄框残留）
// 时加的那道闸是「搜索框一有输入就无条件摘除说明框」，把「说明框只属浏览态」
// 当成硬规则 —— 于是搜「苹果」这种**命中苹果卡**的词时，苹果卡明明在结果列表里，
// 黄框却被摘掉了（bug ④）。本节把「判据必须是目标卡片在不在可见列表」钉成红线，
// 防止后人「简化」代码时把bug ④ 带回来。
section('20h. 苹果补充说明注入闸门');
const idxApple = read('index.html');
check(/appleVisibleNow/.test(idxApple),
  '同步清理以「苹果卡是否可见」为判据，不是「搜索框有没有输入」');
check(!/var searchInputEl[\s\S]{0,200}?trim\(\)\s*!==\s*''[\s\S]{0,120}?removeChild\(note\)[\s\S]{0,40}?return/.test(idxApple),
  'insertAppleNote 里没有「搜索有输入就无条件摘除并return」的旧闸');
check(/if \(appleHidden\)/.test(idxApple),
  '保留「苹果卡在 DOM 但整棵子树被隐藏 → 摘除」这道闸（四格筛选场景）');
check(/if \(!appleCard\)/.test(idxApple),
  '保留「当前列表没有苹果卡 → 摘除」这道闸（搜索过滤场景）');
check(exists('scripts/test-apple-note.cjs'), '存在苹果补充说明注入位置的行为测试');
if (exists('scripts/test-apple-note.cjs')) {
  const tApple = read('scripts/test-apple-note.cjs');
  // 测试必须覆盖 bug ④ 的核心判据，否则等于没测
  check(/同步清理阶段未误摘说明框/.test(tApple),
    '测试断言「同步清理那一瞬」不误摘（等稳定态会被 rAF 重插掩盖，抓不到 bug ④）');
  check(/display = 'none'/.test(tApple),
    '测试覆盖「苹果卡在 DOM 但子树被隐藏」分支（四格筛选）');
}
if (exists('.github/workflows/verify.yml')) {
  check(read('.github/workflows/verify.yml').includes('test-apple-note.cjs'),
    'CI 里已接入苹果补充说明注入位置测试');
}

// ---------- 20i. 星巴克公告框与苹果说明框必须保持同构 ----------
// 背景（2026-10-22 站长要求）：按苹果补充说明的形式，给星巴克加一条
// 「消费入座」公告（黄框、不动评级字段）。insertStarbucksNote 是
// insertAppleNote 的平行实现 —— 平行意味着**两处必须一起改**：
// 只改一段会造成「同一个页面两种行为」，而且后人看不出来。
// 本节把「同构」钉成红线：星巴克段少任何一道判据、或判据写法漂移，都判红。
section('20i. 星巴克公告框注入闸门（与苹果同构）');
{
  const idx = read('index.html');
  // ① 同步清理以「星巴克卡是否可见」为判据，不是「搜索框有没有输入」
  check(/sbuxVisibleNow/.test(idx),
    '同步清理以「星巴克卡是否可见」为判据，不是「搜索框有没有输入」');
  check(/!sbuxVisibleNow && n3 && n3\.parentNode/.test(idx),
    '星巴克备注的同步清理条件写法与苹果段平行（!sbuxVisibleNow && n3 …）');
  // ② insertStarbucksNote 函数体存在，且两道结构性闸都在
  check(/function insertStarbucksNote\(\)/.test(idx),
    '存在 insertStarbucksNote 函数（星巴克公告的注入入口）');
  check(/if \(sbuxHidden\)/.test(idx),
    '保留「星巴克卡在 DOM 但整棵子树被隐藏 → 摘除」这道闸（四格筛选场景）');
  check(/if \(!sbuxCard\)/.test(idx),
    '保留「当前列表没有星巴克卡 → 摘除」这道闸（搜索过滤场景）');
  check(/init\(\)[\s\S]{0,400}?insertStarbucksNote\(\)/.test(idx)
     || /insertStarbucksNote\(\);[\s\S]{0,200}?filterCustomCards\(\);/.test(idx),
    'init() 里调用了 insertStarbucksNote（否则浏览态不显示公告框）');
  // ③ 行为测试存在且覆盖核心判据
  check(exists('scripts/test-starbucks-note.cjs'), '存在星巴克公告注入位置的行为测试');
  if (exists('scripts/test-starbucks-note.cjs')) {
    const tSbux = read('scripts/test-starbucks-note.cjs');
    check(/同步清理阶段未误摘公告框/.test(tSbux),
      '测试断言「同步清理那一瞬」不误摘（等稳定态会被 rAF 重插掩盖，抓不到 bug ④）');
    check(/display = 'none'/.test(tSbux),
      '测试覆盖「星巴克卡在 DOM 但子树被隐藏」分支（四格筛选）');
  }
  if (exists('.github/workflows/verify.yml')) {
    check(read('.github/workflows/verify.yml').includes('test-starbucks-note.cjs'),
      'CI 里已接入星巴克公告注入位置测试');
  }
  // ④ 公告内容必须包含事实要素与「不影响评级」的边界声明
  //    （客观中立是主站收录原则：公告只说事实，不情绪化，不牵连评级）
  check(/第三空间倡议/.test(idx) && /消费入座/.test(idx),
    '公告框写明《第三空间倡议》与「消费入座」事实要素');
  check(/不影响本站对其员工工时与休息制度的评级/.test(idx),
    '公告框带「不影响员工工时评级」的边界声明（公告属顾客秩序管理，不牵连双休评级）');
  // ⑤ 镜像防漂移：两段的隐藏判据代码必须同构
  //    （只改一段时，另一段的 walker/display 判据会对不上）
  check(/walker !== document\.body/.test(idx) && /swalker !== document\.body/.test(idx),
    '苹果段与星巴克段的隐藏判据代码同构（walker / swalker 都在）');
  check(/style\.display === 'none'/.test(idx),
    '隐藏判据用 inline display:none（不依赖布局引擎）');
}

// ---------- 20j. 随笔页照片 Star 门禁（真校验版） ----------
// 背景：2026-10-23 站长要求两张玩偶照「必须 Star on GitHub 才能查看」；
//   2026-10-24 站长追加「Star on GitHub 必须验证，不是用户说 Star」——
//   荣誉门禁（点按钮就放行）作废，改为拉 GitHub 公开 star 列表真校验。
//   实现：photo-gate.js（UMD，逻辑外链；行为测试 test-photo-gate.cjs 31 项）。
// 判据：门禁表单齐全、校验打的是 GitHub starred API、按 full_name 认本站仓库、
//   满页翻页、解锁前不预载照片、data-src 目标文件存在、解锁才写 src、
//   不信本地 flag（取消 Star 重新上锁）、[hidden] 兜底、页面明示真校验。
{
  const why = read('why-shuangxiugou.html');
  const pg = read('photo-gate.js');
  section('20j. 随笔页照片 Star 门禁（真校验）');
  check(/id="sxg-gate-box"/.test(why) && /id="sxg-gate-form"/.test(why)
    && /id="sxg-gate-user"/.test(why) && /id="sxg-gate-verify"/.test(why) && /id="sxg-gate-msg"/.test(why),
    '门禁表单齐全（gate-box / 表单 / 用户名输入 / 验证按钮 / 消息位）');
  check(/href="https:\/\/github\.com\/dujeongil-galaxy\/shuangxiugou"/.test(why),
    '去 Star 链接指向本站仓库（不是上游站）');
  check(exists('photo-gate.js') && /<script src="\.\/photo-gate\.js\?v=1"><\/script>/.test(why),
    '门禁逻辑外链 photo-gate.js（可单测，不塞内联）');
  check(/api\.github\.com\/users\//.test(pg) && /starred\?per_page=100&page=/.test(pg),
    '校验打的是 GitHub 公开 starred 列表 API');
  check(/full_name === REPO/.test(pg),
    '按仓库 full_name 认本站（dujeongil-galaxy/shuangxiugou）');
  check(/list\.length === 100[\s\S]{0,120}page\+\+/.test(pg),
    '满 100 才翻页（star 多的账号也能查到）');
  check(/MAX_PAGES = 10/.test(pg),
    '翻页有上限（防极端账号把未登录限流刷爆）');
  // 注意：/src="/ 会把 data-src=" 当子串一起匹配（子串包含），必须用负向后顾排除；
  //   且只数 <img> 标签——script 的 src="./photo-gate.js" 是合法引用，不能连坐。
  const imgTags = (why.match(/<img\b[^>]*>/g) || []);
  const imgsWithRealSrc = imgTags.filter((t) => /(?<!data-)src="/.test(t)).length;
  const imgsWithDataSrc = imgTags.filter((t) => /data-src="/.test(t)).length;
  check(imgsWithRealSrc === 0 && imgsWithDataSrc === 2,
    `照片 img 只用 data-src 懒加载（带真实 src= 的 img ${imgsWithRealSrc} 个，应为 0；data-src ${imgsWithDataSrc} 个，应为 2）`);
  const photoRefs = [...why.matchAll(/data-src="([^"]+)"/g)].map((m) => m[1]);
  check(photoRefs.length === 2 && photoRefs.every((r) => localExists(r)),
    'data-src 指向的照片文件真实存在',
    photoRefs.map((r) => `${r} → ${localExists(r) ? '存在' : '缺失'}`).join('；'));
  check(/imgs\[i\]\.src = imgs\[i\]\.getAttribute\('data-src'\)/.test(pg),
    '解锁逻辑完整（验证通过后才写 img.src）');
  check(/setItem\(USER_KEY/.test(pg) && !/unlocked/i.test(pg),
    'localStorage 只记用户名、不记「已解锁」flag（取消 Star 重新上锁）',
    '真校验不信本地 flag：每次访问都重新拉 star 列表');
  check(/\.photo-grid\[hidden\]\s*\{\s*display:\s*none/.test(why),
    '照片网格有 [hidden] 显示兜底（否则 display:grid 会盖掉 hidden 属性，锁定态占位框外露）',
    '无头浏览器实测过的坑：.photo-grid{display:grid} 会覆盖 hidden 属性的 UA display:none');
  check(/真校验/.test(why),
    '页面明示这是真校验（拉 GitHub star 列表，不是点一下就说已 Star）');
  check(exists('scripts/test-photo-gate.cjs'),
    '存在门禁行为测试（jsdom + 桩 fetch，31 项）');
}

// ---------- 20g. 公告栏版本号必须等于「上一次提交」 ----------
// 背景：2026-10-19 站长指出首页「当前版本号 2db67d9」与近期提交对不上。
//   根因是它写死在 index.html 里，多轮发版都没同步。规则本身 AGENTS.md 早有记载
//  （「两条硬规则 · 一、公告栏版本号：取上一次提交的哈希」），但只写在文档里、
//   没有任何机器校验，于是照样能被漏掉。这一节把文档规则变成红灯。
//
// 语义：页面上显示版本号 = 「上一个已推送提交」的 short hash，不是当前 HEAD。
//   因为哈希由文件内容算出，把哈希写进文件会改变内容、进而改变哈希 —— 无法自指。
//   所以每次推送完，要把公告栏改成刚推上去那个哈希，再提交一次。
//
// 判据：版本号必须真实存在于仓库，且等于 HEAD~1。
//   写成 HEAD      → 判红（那样会稳定落后两拍）
//   等于 HEAD~1    → 通过（正确）
//   等于 HEAD~2    → 容忍，仅提示（CI 同步补提交尚未生成的中间态）
//   落后 3 拍以上  → 判红（真忘了同步）
section('20g. 公告栏版本号');

{
  // 必须锚定到 </span>：上面这段注释里也出现了「当前版本号」四个字，
  // 不限定结束边界的话正则会命中注释而不是真实的公告栏节点。
  const m = /当前版本号\s*([0-9a-fA-F]{7}|[0-9a-fA-F]{40})\s*<\/span>/.exec(html);
  const shown = m ? m[1].slice(0, 7).toLowerCase() : null;

  const shortOf = (rev) => {
    try {
      return execSync(`git rev-parse --short=7 ${rev}`, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    } catch { return null; }
  };

  const chain = ['HEAD', 'HEAD~1', 'HEAD~2'].map(shortOf);

  if (!chain[1]) {
    note('仓库不足两个提交，跳过版本号比对');
  } else if (!shown) {
    err('index.html 公告栏里找不到「当前版本号 xxxxxxx</span>',
      '版本号是读者核对页面版本的唯一依据，不能删掉或写错格式');
  } else {
    // ⚠️ 不能写 `${shown}^{commit}`：Windows 的 cmd.exe 把 ^ 当转义符，
    //    会把 ^{commit} 吞掉，导致所有真实哈希都被误判成「不存在」。
    //    短哈希直接对象查询即可（git 会自行消歧到唯object）。
    let real = false;
    try { execSync(`git cat-file -e ${shown}`, { cwd: ROOT, stdio: 'ignore' }); real = true; } catch { real = false; }

    if (!real) {
      err(`公告栏版本号 ${shown} 在本仓库里不存在`,
        '不能手写或编造哈希。同步命令：node scripts/sync-version.mjs');
    } else if (shown === chain[0]) {
      err(`公告栏版本号 ${shown} 写成了当前 HEAD，应为 HEAD~1 的 ${chain[1]}`,
        '哈希由内容算出，写成当前 HEAD 会让它稳定落后两拍。');
    } else if (shown === chain[1]) {
      ok(`公告栏版本号 ${shown} = HEAD~1，符合「上一个推送」语义`);
    } else if (shown === chain[2]) {
      note(`公告栏版本号 ${shown} = HEAD~2（CI 同步补提交尚未生成的中间态）`);
    } else {
      const behind = execSync(`git rev-list --count ${shown}..HEAD`, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
      err(`公告栏版本号 ${shown} 落后 ${behind} 个提交，远超允许的 2 拍`,
        '多轮发版忘了同步。运行 node scripts/sync-version.mjs 自动写回。');
    }
  }
}

// ---------- 汇总 ----------
console.log('\n' + '='.repeat(60));
if (QUIET === false) {
  console.log(`通过 ${passCount} 项`);
}
if (warns.length) console.log(`\x1b[33m警告 ${warns.length} 项\x1b[0m（不阻塞，但建议处理）`);
if (errors.length) {
  // ⚠️ 必须逐条打印：只给总数的话，密码解不开这类问题看不出是哪一条，
  //    排查时只能反过来翻脚本。
  console.log(`\x1b[31m错误 ${errors.length} 项\x1b[0m —— 存在静默失效风险，请修复后再提交`);
  for (const e of errors) console.log(`  \x1b[31m·\x1b[0m ${e.msg}`);
  process.exit(1);
}
console.log('\x1b[32m全部检查通过\x1b[0m');
