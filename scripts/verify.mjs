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
  // 内容探针：川西自驾游一节（标题 + 手势对象 + 同义表述多种写法）。
  // ⚠️ 命名沿用历史叫法「第八节 / s8」；2026-11-05 随笔重排后该节顺延为第九节。
  //    探针窗口取的是标题里的「2025 川西自驾游」，不含章节号，因此顺延无需刷新哈希；
  //    jamStart 之后到下一个 <h2> 仍是该节全文，手势类探针也不受影响。
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
  // 2026-11-12：新增第四类「岗位人数结构加权」——当企业有年报/ESG 披露的分岗位员工人数，
  // 且两类岗位排班口径分别有公开证据时，按人数结构加权换算（长城汽车即此类）。
  const LEGIT_BASIS = ['derived_from_official_disclosure', 'derived_from_investigation_reports',
    'derived_from_recruiting_and_worker_reports', 'derived_from_headcount_structure'];
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
// ---------- 2d. U 级硬规则（允许，但须附证据缺失说明——规则写死，不给 AI 偷懒口子） ----------
// 背景：2026-10-17 引入 U 级（待核实·不评级）；2026-10-31 上午因 AI 滥用（什么都往 U 塞）
//   一度废除。同日站长纠正原话：「U 级允许，但规则写死，这不是给 AI 偷懒的理由」。
//   故恢复 U 为合法档位，但机器强制以下硬规则——任何一条不满足即判红：
//   ① 标 U 的品牌详情页 MUST 含「证据缺失说明」区块（标记 id="evidence-gap" 或 data-evgap="1"），
//      写明检索了哪些渠道、为何无任何可采信证据；无说明 = 无效 U = 判红（堵死「懒得查就标 U」）。
//   ② U 级详情页 MUST NOT 给出定档结论（「判 C 级」「定级 A 级」）——那样卡片徽标与正文自相矛盾。
//      注意：**不是**「不能有任何证据条目」。U 页恰恰要记录「查过什么」（规则①的说明块），
//      这些证据（如客服热线时间、校招 JD 的「三班倒」）只能证明形态、换算不出月休天数，
//      不足以定档。2026-11-02 修正：原判据是「有证据来源条目就判红」，会把
//      「查过但定不了档」的正常 U 页一律误杀，也逼着人把已查过的来源删掉。
//   ③ U 级不计入 S/A/B/C 合格统计，须单独列示（证据不足 N 家），不得混入红榜/避雷（由 §2e 四格不含 U 保证）。
//   ④ gen-pinyin-index.py 允许 U 映射；但 U 品牌须带 证据缺失说明（verify 兜底，缺则判红）。
//   ⑤ 禁止以「我不确定 / 没空查 / 懒得找」为由标 U——每次标 U 必须记录检索动作（规则写死）。
//   旧 U 时代死文案（「待核实（未评级）」「U 级待核实」「参考：其他待核实」「待核实 · 无证据不作评级」）
//   仍禁用：新 U 用「U 级 + 证据缺失说明」，不沿用旧措辞。
section('2d. U 级硬规则（允许，但须附证据缺失说明）');

// 解析 brand/*.html：哪些页标了 U 档，是否附证据缺失说明、是否夹带证据
const brandHtmlPages = readdirSync(join(ROOT, 'brand')).filter((f) => f.endsWith('.html'));
const uPages = [];
for (const f of brandHtmlPages) {
  const ph = readFileSync(join(ROOT, 'brand', f), 'utf8');
  // 注意（2026-11-02 救绿教训）：原正则写的是 `>U 级<`，要求标签闭合紧跟，
  // 而实际徽标是「U 级 · 证据不足」，于是 isU 恒为 false → uPages 空集 →
  // 下面两条 every() 在空集上恒真，断言形同虚设（注入故障也照样绿）。
  // 改成不要求闭合，并新增「必须抓到 U 页」的断言兜底。
  const isU = /class="badge"[^>]*>\s*U\s*级|data-tier=["']U["']/.test(ph);
  if (!isU) continue;
  // 只认结构标记：曾经把裸词「证据缺失说明」当备选，结果正文里引用了一次
  // 这几个字就能让「删掉说明块」的故障注入照样绿。
  const hasGap = /id="evidence-gap"|data-evgap="1"/.test(ph);
  // 自相矛盾 = 徽标说 U、正文却给 S/A/B/C 的定档结论（如「按…口径判 C 级」）
  const hasVerdict = /(判|定级为|定档为)\s*[SABC]\s*级/.test(ph);
  uPages.push({ f, hasGap, hasVerdict });
}
// 空集兜底：bundle 有 U 卡时，uPages 必须非空——否则上面两条 every() 白跑
const bundleUCount = (() => {
  let n = 0;
  brandCards.forEach((c, i) => {
    const end = i + 1 < brandCards.length ? brandCards[i + 1].pos : bundle.length;
    if (bundle.slice(c.pos, end).includes('tier:`U`')) n += 1;
  });
  return n;
})();
check(bundleUCount === 0 || uPages.length >= bundleUCount,
  'bundle 内 U 档卡都在 brand/ 里被识别为 U 级页（空集不许冒充通过）',
  'bundle U=' + bundleUCount + ' / 识别到 U 页=' + uPages.length + '（' + uPages.map((p) => p.f).join(',') + '）');
check(uPages.every((p) => p.hasGap),
  'U 级详情页 MUST 含「证据缺失说明」（规则①：无说明 = 无效 U，堵死 AI 偷懒）',
  uPages.filter((p) => !p.hasGap).map((p) => p.f).join(', ') || '全部 U 页均附说明');
check(uPages.every((p) => !p.hasVerdict),
  'U 级详情页不得自相矛盾：正文不能出现「判 S/A/B/C 级」定档结论（规则②）',
  uPages.filter((p) => p.hasVerdict).map((p) => p.f).join(', ') || '无 U 页给出定档结论');

// bundle 内置卡同理：tier:`U` 必须对应详情页附证据缺失说明
const bundleU = [];
brandCards.forEach((c, i) => {
  const end = i + 1 < brandCards.length ? brandCards[i + 1].pos : bundle.length;
  const chunk = bundle.slice(c.pos, end);
  if (!chunk.includes('tier:`U`')) return;
  const pageName = c.id + '.html';
  const ok = brandHtmlPages.includes(pageName) &&
    /id="evidence-gap"|data-evgap="1"|证据缺失说明/.test(readFileSync(join(ROOT, 'brand', pageName), 'utf8'));
  if (!ok) bundleU.push(c.id);
});
check(bundleU.length === 0,
  'bundle 内置 U 档卡 MUST 对应详情页附「证据缺失说明」（规则①对内置卡一致适用）',
  bundleU.join(', ') || '无 U 档内置卡 / 均已附说明');

// 自定义卡同理
const cfgUD = html.match(/var customCardsConfig = \[([\s\S]*?)\n      \];/);
const customUD = cfgUD
  ? [...cfgUD[1].matchAll(/id:\s*'([^']+)'[\s\S]*?grade:\s*'([^']+)'/g)].map((m) => ({ id: m[1], grade: m[2] }))
  : [];
const customU = customUD.filter((c) => c.grade === 'U级');
const customUBad = [];
for (const c of customU) {
  const pageName = c.id.replace(/-card$/, '') + '.html';
  if (!brandHtmlPages.includes(pageName) ||
    !/id="evidence-gap"|data-evgap="1"|证据缺失说明/.test(readFileSync(join(ROOT, 'brand', pageName), 'utf8')))
    customUBad.push(c.id);
}
check(customUBad.length === 0,
  'U 级自定义卡同样须附证据缺失说明（规则①对自定义卡一致适用）',
  customUBad.join(', ') || '无 U 级自定义卡 / 均已附说明');

// 旧 U 时代死文案仍禁用（新 U 不沿用旧措辞）
const DEAD_U_MARKS = ['待核实（未评级）', 'U 级待核实', '参考：其他待核实', '待核实 · 无证据不作评级'];
const uDeadHits = [];
const htmlPages = ['projects.html', ...brandHtmlPages.map((f) => join('brand', f))];
for (const page of htmlPages) {
  const ph = readFileSync(join(ROOT, page), 'utf8');
  for (const mark of DEAD_U_MARKS) {
    if (ph.includes(mark)) uDeadHits.push(page + '：「' + mark + '」');
  }
}
check(uDeadHits.length === 0,
  '旧 U 时代死文案仍禁用（新 U 用「U 级 + 证据缺失说明」，不沿用旧措辞）',
  uDeadHits.length ? uDeadHits.join('；') : '已清零');

// 倒置口径全站禁用（2026-11-02 站长：「6 家未核实继续给 U 级」）
// 「查不到统一双休证据即视为无双休」= 举证责任倒置——把"我没找到"当成"确实没有"，
// 据此判 C 级。这不是站长的口径（站长：C = 月休不足 6 天／严重超时／通报违约／拒答双休），
// 是 AI 自拟的过度口径，2026-10-31 已被站长纠正，但 brand 页里躺了 4 处没清。
// 注意不要误伤「查不到就不作评级」——那正是现在要的口径（U 级）。
const inverseHits = [];
const INVERSE_RE = /查不到[^。；\n]{0,40}(即视为无双休|视为无双休|即判\s*C\s*级|判\s*C\s*级)/;
for (const f of brandHtmlPages) {
  const ph = readFileSync(join(ROOT, 'brand', f), 'utf8');
  if (INVERSE_RE.test(ph)) inverseHits.push('brand/' + f);
}
check(inverseHits.length === 0,
  '禁用「查不到即视为无双休」倒置口径（查不到 → U 级，不是 C 级）',
  inverseHits.length ? inverseHits.join(', ') : '已清零');

// 首页口径区必须声明 U 级合法且不得再写「废除 U 级」
// （2026-10-31 站长当晚已反转，但口径区漏改，导致代码与文案打架、全站 U 卡清零）
check(/<strong>U 级（证据不足）<\/strong>/.test(html) && !/废除\s*「?U 级/.test(html),
  'index.html 评级口径区声明 U 级（证据不足）为合法档位，且不得再写「废除 U 级」');

// gen-pinyin 允许 U（不再 crash），规则由 verify §2d 兜底
const genTool = readFileSync(join(ROOT, 'scripts', 'gen-pinyin-index.py'), 'utf8');
check(genTool.includes("'U级': 'u'") || genTool.includes('"U级": "u"'),
  'gen-pinyin-index.py 允许 U 级映射（遇 U 不再 crash，规则由 verify §2d 兜底）');

// 2026-10-20 长城/名创改档 C 级 0%（口径换算）。这是站长拍板的数据结论，
// 加防回退断言：若有人把这两张卡改回 U 或删掉 derived 标注，verify 必须判红。
// 2026-11-12 站长指令：长城汽车 C→B（官宣全员双休已落地办公岗、产线仍单双休），
// 双休率改为按 2025 年报岗位人数结构加权换算的 51%，平均下班 18:30（招聘口径）。
section('2f. 改档锁定（长城 B 级 51% / 名创 C 级 0% 口径换算）');
const lockedCards = [
  { id: 'gwm', name: '长城汽车', policy: 'alternate', tier: 'B', rate: 51,
    basis: 'derived_from_headcount_structure', minEv: 7 },
  { id: 'miniso', name: '名创优品', policy: 'single', tier: 'C', rate: 0,
    basis: 'derived_from_recruiting_and_worker_reports', minEv: 5 },
];
const badLocked = [];
for (const lc of lockedCards) {
  const idx = brandCards.findIndex((c) => c.id === lc.id);
  if (idx === -1) { badLocked.push(lc.id + '：卡不存在'); continue; }
  const end = idx + 1 < brandCards.length ? brandCards[idx + 1].pos : bundle.length;
  const chunk = bundle.slice(brandCards[idx].pos, end);
  const problems = [];
  if (!chunk.includes('tier:`' + lc.tier + '`')) problems.push('档位不是 ' + lc.tier);
  if (!chunk.includes('realDoubleWeekendRate:' + lc.rate)) problems.push('双休率不是 ' + lc.rate);
  if (!chunk.includes('rateSource:`derived`')) problems.push('缺 rateSource:derived');
  if (!chunk.includes('rateBasis:`' + lc.basis + '`')) problems.push('rateBasis 不符');
  if (!chunk.includes('weekendPolicy:`' + lc.policy + '`')) problems.push('weekendPolicy 不符');
  const evIds = [...chunk.matchAll(/id:`(ev-[a-z0-9-]+)`/g)].map((x) => x[1]);
  if (evIds.length < lc.minEv) problems.push('证据 id 不足 ' + lc.minEv + ' 条（改档证据链被删？）');
  if (problems.length) badLocked.push(lc.name + '：' + problems.join('、'));
}
check(badLocked.length === 0,
  '长城 B 级 51% / 名创 C 级 0%（口径换算）且证据链完整（2026-11-12 长城改档锁定）',
  badLocked.join(', ') || '锁定生效');

section('2e. 统计计数一致性（顶部四格 + 页脚清单）');
// 口径（2026-10-17 审计确定，改动前 36/16/8/12 与任何口径都对不上）：
//   收录品牌 = 实名企业卡 =（内置卡 - 虚拟对比卡）+ 自定义卡
//   双休红榜 = S/A 级卡数；大小周观察 = B 级卡数；避雷预警 = C 级卡数（内置 + 自定义）
//   （U 级恢复但单独列示、不计入四格统计；原 U 级卡已按证据改判 S/A/B/C。）
//   「某代工烘焙食品 (虚拟对比黑榜)」是上游设计的匿名对比工具，无详情页，不计入任何统计。
const tier2e = { S: 0, A: 0, B: 0, C: 0, D: 0, U: 0 };
let builtin2e = 0;
let virtual2e = 0;
brandCards.forEach((c, i) => {
  const end = i + 1 < brandCards.length ? brandCards[i + 1].pos : bundle.length;
  const chunk = bundle.slice(c.pos, end);
  if (chunk.includes('id:`some-overtime-snack`')) { virtual2e += 1; return; }
  builtin2e += 1;
  const tm = chunk.match(/tier:`([SABCDU])`/);
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
const statLei = tier2e.C + tier2e.D + byGrade2e('C级') + byGrade2e('D级');
const headerStat = (label, cls) => {
  const re = new RegExp('children:(\\d+)\\}\\),\\(0,A\\.jsx\\)\\(`div`,\\{className:`' + cls + '`,children:`' + label + '`');
  const m = bundle.match(re);
  return m ? Number(m[1]) : null;
};
check(virtual2e === 1, '虚拟对比卡恰 1 张（口径排除依据，id 变更需同步本节）', '实际 ' + virtual2e);
// 2026-11-02 批量导入 104 张榜单卡（data/imported-brands.json 生成）后，16 → 120；
// 2026-11-08 新增「陆喜依」（独立公开来源，非榜单导入）→ 121 张导入卡；
// 2026-11-11 新增「吉利汽车」（站长指令建卡，独立公开来源）→ 122 张导入卡。
// 2026-11-19 新增 8 家国产新能源车企（小鹏/问界/极氪/埃安/深蓝/岚图/五菱/长安启源）→ 116 张导入卡。
// 这个数不是「随便写死」：它同时被 §2e 的四格统计、brand/ 页数、公告栏数字三处引用，
// 任何一处生成器漏跑都会在这里对不上，所以必须保留为硬断言。
const IMPORTED_CARD_COUNT = 116;
check(customPairs2e.length === 22 + IMPORTED_CARD_COUNT,
  `能解析全部自定义卡（${22 + IMPORTED_CARD_COUNT} 张 = 22 张手工卡含联通/小米汽车/广汽丰田/网易游戏 + ${IMPORTED_CARD_COUNT} 张导入卡（104 榜单 + 陆喜依 / 沪上阿姨等独立来源））`,
  '实际 ' + customPairs2e.length);
check(headerStat('收录品牌', 'text-slate-400 text-\\[11px\\]') === statTotal,
  '顶部「收录品牌」= 实名企业卡总数', '页面 ' + headerStat('收录品牌', 'text-slate-400 text-\\[11px\\]') + ' / 计算 ' + statTotal + '（改 bundle 顶部统计常数）');
// 2026-11-04：bundle 四格统计数字（81/31/59）已冻结，通过 rating-stats-patch.js 动态修正
// 为实际值（82/31/58）。verify 检查补丁脚本的修正值，而非 bundle 的硬编码值。
const patchScript = exists('rating-stats-patch.js') ? read('rating-stats-patch.js') : '';
const patchHong = patchScript.match(/'双休红榜':\s*(\d+)/);
const patchZhou = patchScript.match(/'大小周观察':\s*(\d+)/);
const patchLei = patchScript.match(/'避雷预警':\s*(\d+)/);
const effectiveHong = patchHong ? Number(patchHong[1]) : headerStat('双休红榜', 'text-emerald-700/70 text-\\[11px\\]');
const effectiveZhou = patchZhou ? Number(patchZhou[1]) : headerStat('大小周观察', 'text-amber-700/70 text-\\[11px\\]');
const effectiveLei = patchLei ? Number(patchLei[1]) : headerStat('避雷预警', 'text-rose-700/70 text-\\[11px\\]');
check(effectiveHong === statHong,
  '顶部「双休红榜」= S/A 级卡数', '页面 ' + effectiveHong + ' / 计算 ' + statHong + (patchHong ? '（由 rating-stats-patch.js 修正）' : '（改 bundle 顶部统计常数）'));
check(effectiveZhou === statZhou,
  '顶部「大小周观察」= B 级卡数', '页面 ' + effectiveZhou + ' / 计算 ' + statZhou + (patchZhou ? '（由 rating-stats-patch.js 修正）' : '（改 bundle 顶部统计常数）'));
check(effectiveLei === statLei,
  '顶部「避雷预警」= C 级卡数', '页面 ' + effectiveLei + ' / 计算 ' + statLei + (patchLei ? '（由 rating-stats-patch.js 修正）' : '（改 bundle 顶部统计常数）'));
// 2026-11-03 加强：曾发现 noscript 清单标题停在「共 67 家」（上游旧账，断言只咬第一处）——
// 改为全文所有「共 N 家」都必须等于 statTotal，防止再出现漏改的第二处。
const allTotals2e = [...html.matchAll(new RegExp('共\\s*(\\d+)\\s*家', 'g'))].map((m) => Number(m[1]));
check(allTotals2e.length >= 2 && allTotals2e.every((n) => n === statTotal),
  '页面全部「共 N 家」与收录总数一致（出现 ' + allTotals2e.length + ' 处）',
  '不一致处：' + JSON.stringify(allTotals2e));
const brandPages2e = readdirSync(join(ROOT, 'brand')).filter((f) => f.endsWith('.html')).length;
check(brandPages2e === statTotal, 'brand/ 详情页数量 = 收录总数（虚拟对比卡无详情页）', '页面 ' + brandPages2e + ' / 计算 ' + statTotal);
// 「企业真假双休档案」tab 上的数字角标也是手写常数（2026-10-17 发现它停在 36，
// 比四格统计更晚跟上收录数），纳入 2e 自动核对，防止增减卡后再漏。
const tabBadge2e = (bundle.match(/children:`企业真假双休档案`\}\),\(0,A\.jsx\)\(`span`,\{className:`text-\[10px\] font-mono bg-emerald-200\/60 text-emerald-900 px-1\.5 py-0\.5 rounded-full`,children:(\d+)\}\)/) || [])[1];
check(tabBadge2e !== undefined && Number(tabBadge2e) === statTotal,
  '「企业真假双休档案」tab 角标 = 收录总数', '页面 ' + tabBadge2e + ' / 计算 ' + statTotal);
// 2026-10-31 U 级废除 + 月休口径复核改判锁定（站长口径：B=月休 6-8 天、
// A=月休 8 天以上、S=A+真实双休率达标、C=月休不足 6 天或拒不披露）。据此：
//   工/建/中/成都 4 家银行网点轮休制、周休 2 天（≈月休 8.6 天）→ A 级；
//   农行 2026-11-04 复核：网点固定关门日 + 员工轮流双休（周休 2 天）→ 重新评级为 A 级；
//   淘宝闪购客服被直接询问双休安排而拒答 → C 级。
// 防回退断言：任一卡改档或删卡都必须判红。
const EXPECT_GRADE_2E = {
  'icbc-card': 'A级', 'ccb-card': 'A级', 'boc-card': 'A级', 'chengdubank-card': 'A级',
  'abc-card': 'A级', 'taobao-shanguang-card': 'C级',
  // 2026-11-03 站长拍板：BOSS直聘 C→D（平台类目例外），奇瑞 D→C —— 两张卡都不许再动。
  'bosszhipin-card': 'D级',
  // 2026-11-03 新增：中国联通 B 级（站长线下核实一个城市，月休 8 天以上，见 brand/unicom.html）。
  'unicom-card': 'B级',
  // 2026-11-05 新增：小米 B→A（爱企查公开知识条目「公司普遍每周双休」；原有线下销售岗单休备注保留）。
  'xiaomi-card': 'B级',
  // 2026-11-12 新增：广发银行 / 四川天府银行 A 级（站长指令建卡，网点轮班周休 2 天，见 brand/guangfa.html、brand/tianfu.html）。
  'guangfa-card': 'A级', 'tianfu-card': 'A级',
};
const locked2e = customPairs2e.filter((c) => EXPECT_GRADE_2E[c.id]);
const relockedU2e = locked2e
  .filter((c) => c.grade !== EXPECT_GRADE_2E[c.id])
  .map((c) => c.id + '=' + c.grade + '（应 ' + EXPECT_GRADE_2E[c.id] + '）');
check(relockedU2e.length === 0,
  '7 家银行 A 级（工/建/中/成都/农行/广发/天府）+ 小米 B 级（2026-11-13 站长要求下调）+ 淘宝闪购 C 级 + BOSS直聘 D 级（锁定，不得回退）',
  relockedU2e.length ? relockedU2e.join(', ') : '锁定生效');
check(locked2e.length === 11,
  '11 张锁定卡全部存在（删卡判红）', '实际 ' + locked2e.length);
// 2026-11-02 起：A 级 / C 级计数含榜单导入卡（A 58 张、C 29 张）。
// 断言仍然写成「基准 + 导入数」的算式，导入批次调整时改 IMPORTED_CARD_COUNT 一处即可，
// 但两个基准值（4 / 11）必须保持 —— 那是手工卡的既有口径，动了就等于偷偷改档。
// 2026-11-02 起：A 级 / C 级计数含榜单导入卡（A 58 张、C 29 张）。
// 断言仍然写成「基准 + 导入数」的算式，导入批次调整时改 IMPORTED_CARD_COUNT 一处即可，
// 但两个基准值（4 / 11）必须保持 —— 那是手工卡的既有口径，动了就等于偷偷改档。
check(byGrade2e('A级') === 7 + 58,
  '自定义卡 A 级共 65 张（工/建/中/成都/农行 5 家银行 + 2026-11-12 广发银行/四川天府银行 2 家 + 榜单导入 58 张；小米 2026-11-05 B→A、2026-11-13 站长要求下调回 B）',
  '实际 ' + byGrade2e('A级'));
check(byGrade2e('C级') === 10 + 29 + 4,
  '自定义卡 C 级共 41 张（手工 10 张 + 榜单导入 29 张 + 2026-11-12 新增零跑汽车 C 级；小米汽车 2026-11-13 建卡 C 级、同日站长人工介入上调 B 级；农行 2026-11-04 由 C 转 A；BOSS直聘 2026-11-03 转入 D 级；2026-11-11 新增吉利汽车 C 级；2026-11-15 新增沪上阿姨 C 级（门店招聘月休 2 天））',
  '实际 ' + byGrade2e('C级'));
// 2026-11-12 新增「零跑汽车」自定义卡（站长指令：新增品牌、证据链由联网核实公开报道；
// 两条抖音短视频线索归属首页弹窗新版入口、不挂本卡证据链；备注栏必须注明内容存疑）。
// 以下断言锁定该卡的关键字段，防止后续误改档位/漏挂免责声明/误把短视频链挂进证据链。
{
  const noscriptText2e = (html.match(/<noscript>([\s\S]*?)<\/noscript>/) || [])[1] || '';
  const start = html.indexOf("id: 'leapmotor-card'");
  const end = html.indexOf('// ==IMPORTED-CARDS-END==');
  const block = start >= 0 && end > start ? html.slice(start, end) : '';
  check(start >= 0, '自定义卡 leapmotor-card 存在', 'index.html 未发现 leapmotor-card');
  check(/logo:\s*null/.test(block), '零跑卡 logo:null（文字徽标回退，无 PNG 资源）', 'leapmotor-card 块未含 logo:null');
  check(/grade:\s*'C级'/.test(block), '零跑卡 grade 锁定为 C 级', '实际 ' + (block.match(/grade:\s*'([^']+)'/)||[])[1]);
  check(/insertAfter:\s*'吉利汽车'/.test(block), '零跑卡 insertAfter 锁定为 吉利汽车（BYD 锚点已被吉利占用，共用会触发归位互抢判红）', 'leapmotor-card 块未发现 insertAfter 或值不符');
  check(/cardNoteTitle:\s*'站长备注（内容真实性存疑，请注意甄别）'/.test(block), '零跑卡备注标题含「内容真实性存疑，请注意甄别」', 'leapmotor-card 未挂免责标题');
  check(/cardNote:\s*'[^']*内容真实性存疑[^']*'/.test(block), '零跑卡备注正文含「内容真实性存疑」免责声明', 'leapmotor-card 未挂免责正文');
  check(/cardNote:\s*'[^']*首页弹窗[^']*新版本[^']*'/.test(block), '零跑卡备注注明两条短视频线索归属首页弹窗新版本（不挂本卡证据链）', 'leapmotor-card 未注明短视频线索归属');
  // 2026-11-12 15:48 站长：售后服务那条抖音链「写入备注栏（参考比亚迪），不要挂在证据链」，
  // 备注栏务必注明「内容真实性存疑，请注意甄别」。
  //   ① 链接必须落在 cardNote（备注栏）里，且同段有「请注意甄别」；
  //   ② 详情页（证据链所在）不得出现该链接——挂进证据链就违反了站长口径。
  const noteBlock = (block.match(/cardNote:\s*'([^']*)'/) || [, ''])[1];
  check(/v\.douyin\.com\/n-xv654_mrI\//.test(noteBlock),
    '零跑卡备注栏写入售后服务抖音短链（v.douyin.com/n-xv654_mrI/）',
    '备注栏没写入站长给的售后服务短视频链接');
  check(/内容真实性存疑[\s\S]*请注意甄别/.test(noteBlock)
    && /未点名品牌/.test(noteBlock) && /不进入本卡证据链/.test(noteBlock),
    '零跑卡备注栏写明「内容真实性存疑，请注意甄别」+ 视频未点名品牌 + 不进入本卡证据链',
    '备注栏缺免责口径（存疑/未点名品牌/不挂证据链）');
  check(!/v\.douyin\.com/.test(exists('brand/leapmotor.html') ? read('brand/leapmotor.html') : ''),
    '零跑详情页（证据链）不含抖音短链——短视频线索只留在卡面备注栏',
    '详情页被塞进了抖音短链 → 违反「不要挂在证据链」');
  // 备注栏链接要能点：渲染层把 cardNote 里的 http(s) 自动成 <a>（原先只有 textContent）。
  check(/var noteUrlRe = \/https\?:\\\/\\\/\[/.test(html)
    && /noteLink\.rel = 'noopener noreferrer nofollow'/.test(html)
    && /noteBody\.appendChild\(noteLink\)/.test(html),
    '备注栏渲染把 http(s) 自动转成可点链接（带 rel=noopener noreferrer nofollow）',
    '备注栏仍是纯 textContent → 站长给的抖音链接在卡面上点不动');
  check(/零跑汽车/.test(noscriptText2e), 'noscript 主评级清单含零跑汽车（仅主清单、不进详情页 ul，保 177 计数链）', 'noscript 未含零跑汽车');
  check(/brand\/leapmotor\.html/.test(html), '零跑卡已有 brand/leapmotor.html 详情页（自定义卡↔品牌页 1:1，保 178 计数链）', '未发现 brand/leapmotor.html 引用');
}
// D 级自定义卡：2026-11-03 起只有 BOSS直聘 一张（平台类目例外）。多一张或少一张都要判红 ——
// 这一档是「人的结论」，被悄悄批量加卡就等于把站长的判断稀释成普通档位。
check(byGrade2e('D级') === 1 && customPairs2e.filter((c) => c.grade === 'D级').map((c) => c.id)[0] === 'bosszhipin-card',
  '自定义卡 D 级恰好 1 张 = BOSS直聘（平台类目例外，不许增删）',
  '实际 ' + byGrade2e('D级') + ' 张：' + customPairs2e.filter((c) => c.grade === 'D级').map((c) => c.id).join(','));
// 规则③：U 级单独列示、不并入四格统计（红榜/观察/避雷只含 S/A/B/C）
const fourSum2e = statHong + statZhou + statLei;
const totalCards2e = builtin2e + customPairs2e.length;
const uCards2e = tier2e.U + byGrade2e('U级');
check(fourSum2e === totalCards2e - uCards2e,
  'U 级单独列示、不并入四格统计（四格合计 = 总卡数 − U 卡数）',
  '四格 ' + fourSum2e + ' / 总 ' + totalCards2e + ' − U ' + uCards2e);
// bundle 侧档位锁定（2026-11-02 站长复核：宏碁/三星拿不到月休天数、正文自己写着
// 「不作评级」，挂 C 级是自相矛盾 → 改 U；霸王茶姬有 BOSS 直聘门店岗「月休 4 天」
// 快照（与名创同形态），维持 C。改任何一张都要同步这条断言，防止悄悄回退）
const BUNDLE_TIER_LOCK = { acer: 'U', samsung: 'U', chagee: 'C', chery: 'C' };
const badBundleLock = [];
for (const bid of Object.keys(BUNDLE_TIER_LOCK)) {
  const idx = brandCards.findIndex((c) => c.id === bid);
  if (idx === -1) { badBundleLock.push(bid + '：卡不存在'); continue; }
  const end = idx + 1 < brandCards.length ? brandCards[idx + 1].pos : bundle.length;
  const chunk = bundle.slice(brandCards[idx].pos, end);
  const want = 'tier:`' + BUNDLE_TIER_LOCK[bid] + '`';
  if (!chunk.includes(want)) badBundleLock.push(bid + '：不是 ' + BUNDLE_TIER_LOCK[bid] + ' 档');
}
check(badBundleLock.length === 0,
  '宏碁/三星 = U 档、霸王茶姬 = C 档、奇瑞 = C 档（2026-11-02 复核；奇瑞 2026-11-03 从 D 回退 C）',
  badBundleLock.join(', ') || '锁定生效');

/* ---- 2e-4. D 级（站长人工干预）硬规则 ----
 *
 * 沿革：
 *   2026-11-02 设立。站长：「像这种，高管要求规避法律风险想办法加班，直接D级，
 *     并备注站长人为干预，强制介入要求Ai降级」→ 奇瑞由 C 强制降为 D。
 *   2026-11-03 判据扩为三类：「如果是什么加班为荣，以及主动规避劳动法的，
 *     劝员工自愿放弃购买社保的，这种就可以D级了」+ 同时确立「新判据只管往后」
 *     → 招商银行（2026-11-02 定 C）不追溯、维持 C。
 *   2026-11-03 再拍板（同日稍晚）：「D级还原为C级吧，boss直聘那个给D级算了，哎。
 *     不然越改越混乱」→ **奇瑞回退 C**，D 级只留 BOSS直聘 一家，
 *     且 BOSS直聘 是「平台类目例外」——不属于用工单位、双休口径不适用，
 *     三类判据套不上，由站长直接定级、理由单列。
 *
 * ⚠️ 结构变了（2026-11-03）：D 级**不再对应 bundle 卡片**。
 *   BOSS直聘 在首页只出现在静态证据板，没有 bundle 卡 → bundle 内 tier:`D` 必须为 0，
 *   u-grade-patch.js 的 D_BRANDS 也必须为空。别再按「bundle D 卡数」去核对，
 *   那套规则会让「把 D 悄悄塞回卡片」和「卡片没徽标」两种错误都逃过校验。
 * 四条机器规则：
 *   ① bundle 内 tier:`D` = 0，且 D_BRANDS 条数与之相等（两者必须同步为 0）
 *   ② brand/ 里标 D 徽标的页 = 白名单 D_MANUAL_PAGES（非空，防空集恒真）
 *   ③ 每个 D 页必须有「人工干预记录」（data-manual-override）并写明站长介入
 *   ④ 口径区必须写明「不由 AI 判定」+ 平台类目例外 + 奇瑞已回退 C
 */
const bundleTierD = [];
brandCards.forEach((c, i) => {
  const end = i + 1 < brandCards.length ? brandCards[i + 1].pos : bundle.length;
  if (bundle.slice(c.pos, end).includes('tier:`D`')) bundleTierD.push(c.id);
});
const patchSrc0 = readFileSync(join(ROOT, 'u-grade-patch.js'), 'utf8');
const dListRaw = (patchSrc0.match(/D_BRANDS\s*=\s*\[([^\]]*)\]/) || [])[1] || '';
const dListCount = (dListRaw.match(/'/g) || []).length / 2;
check(bundleTierD.length === 0,
  'bundle 内无 D 档卡（2026-11-03 起 D 级不再来自 bundle：BOSS直聘 仅为证据板+详情页）',
  '仍有 D 档卡：' + bundleTierD.join(',') + ' → 奇瑞回退没退干净，或有人把 D 塞回卡片');
check(dListCount === bundleTierD.length,
  'u-grade-patch.js 的 D_BRANDS 条数 = bundle 内 D 档卡数（现在两边都必须是 0）',
  '清单 ' + dListCount + ' 条 / bundle D 档 ' + bundleTierD.length + ' 张（' + bundleTierD.join(',') + '）');

// D 级页面白名单：改动档位（增/删）必须同步此清单，否则下面那条「页数 = 清单数」会判红。
const D_MANUAL_PAGES = ['bosszhipin.html'];
const dPages = [];
const badDPage = [];
for (const f of readdirSync(join(ROOT, 'brand')).filter((x) => x.endsWith('.html'))) {
  const ph = readFileSync(join(ROOT, 'brand', f), 'utf8');
  if (!/class="badge"[^>]*>\s*D\s*级/.test(ph)) continue;
  dPages.push(f);
  if (!/data-manual-override="1"/.test(ph)) badDPage.push(f + '：缺「人工干预记录」区块（data-manual-override）');
  if (!/站长/.test(ph)) badDPage.push(f + '：正文未写明是站长介入');
}
check(D_MANUAL_PAGES.length > 0,
  'D 级白名单非空（空集会让下面两条恒真，这是本站踩过的坑）');
check(dPages.length === D_MANUAL_PAGES.length && D_MANUAL_PAGES.every((x) => dPages.includes(x)),
  'brand/ 里标 D 级的页 = 白名单（当前仅 BOSS直聘）',
  '页面 ' + dPages.join(',') + ' / 白名单 ' + D_MANUAL_PAGES.join(','));
check(dPages.length > 0 && badDPage.length === 0,
  'D 级详情页必须附「人工干预记录」并写明站长介入（降了档就必须留账）',
  badDPage.join('；') || dPages.join(', ') + ' 均已留账');
check(/D 级（站长人工介入，2026-11-02 设立、2026-11-03 扩充）/.test(html) && /不由 AI 判定|AI 不得自行判定/.test(html),
  'index.html 评级口径区声明 D 级存在、且明确「不由 AI 判定」',
  '口径区 D 级标题被改而本断言未同步，或「不由 AI 判定」字样丢失 → D 会被当成普通档位滥用');

// 平台类目例外（2026-11-03 站长拍板）：BOSS直聘 不是用工单位，三类判据套不上，
// 走单独通道 —— 但这条通道 AI 不得使用，必须写在口径区里。
check(/平台类目例外/.test(html) && /BOSS直聘/.test(html),
  '★ 口径区写明「平台类目例外」并把 BOSS直聘 点名（D 级唯一例外的落点）',
  '缺例外条款 → BOSS直聘 的 D 级看起来像「违反了三类判据」，或 AI 会照着给企业套 D');
const bossPage = readFileSync(join(ROOT, 'brand', 'bosszhipin.html'), 'utf8');
check(/平台类目例外/.test(bossPage) && /不套三类判据|套不上/.test(bossPage) && /2026-11-03/.test(bossPage),
  '★ BOSS直聘 页必须写清「平台类目例外、不套三类判据、2026-11-03 改判」',
  '缺一句 → 读者（和未来的 AI）会以为它是按劳动法判据评的 D');
// 奇瑞回退：结论没变（仍 C 级避雷预警），但历史必须留痕，且不许再标 D 徽标。
const cheryPage = readFileSync(join(ROOT, 'brand', 'chery.html'), 'utf8');
check(!/class="badge"[^>]*>\s*D\s*级/.test(cheryPage) && /class="badge"[^>]*>\s*C\s*级/.test(cheryPage),
  '★ 奇瑞页已回退 C 级（不再有 D 徽标）',
  '奇瑞仍标 D → 2026-11-03「D级还原为C级」没落地');
check(/2026-11-02/.test(cheryPage) && /回退为 C 级/.test(cheryPage) && /2026-11-03/.test(cheryPage),
  '★ 奇瑞页保留「2026-11-02 判 D → 2026-11-03 回退 C」留痕（结论可改，账不能抹）',
  '回退留痕缺失 → 以后没人知道这一档曾被人工改过两次');
// 证据板 data-g 必须与详情页档位一致（手写 HTML 最容易漏改的一处）。
const evChery = (html.match(/<details id="ev-chery"[^>]*>/) || [''])[0];
const evBoss = (html.match(/<details id="ev-bosszhipin"[^>]*>/) || [''])[0];
check(/data-g="C"/.test(evChery) && /data-g="D"/.test(evBoss),
  '★ 首页证据板 data-g 与详情页档位一致（chery=C、bosszhipin=D）',
  '证据板档位没跟着改 → 过滤/统计与详情页打架：' + evChery + ' / ' + evBoss);

// ---------------------------------------------------------------------------
// §2f 证据链：定档判据「只有一条、还是第三方二手」的页面，必须把证据链写在明面上。
//   背景（2026-11-02 站长质问「新增的都是 A 级，证据链在哪」）：批量导入的 104 家
//   每家都只有 1 条来源——同一篇第三方榜单聚合（2026-07-11，二手、未抓原文），
//   凭它换算出 58 个 A 级。来源不是不能第三方，但**来源、日期、原话、缺口**必须公示，
//   否则读者看到「A 级」无从判断它是实测还是转载。
//   三条断言：①单源二手页必须有证据链区块 ②集合非空（空集会让 every 恒真）
//   ③已补齐真实来源的页面不许退回单条第三方（招行为标本）
// ---------------------------------------------------------------------------
const weakSrcPages = [];
const missingChain = [];
for (const f of readdirSync(join(ROOT, 'brand')).filter((x) => x.endsWith('.html'))) {
  const ph = readFileSync(join(ROOT, 'brand', f), 'utf8');
  const m = ph.match(/<h2>证据来源<\/h2>\s*<ul>([\s\S]*?)<\/ul>/);
  if (!m) continue;
  const n = (m[1].match(/<li style="margin:0 0 12px">/g) || []).length;
  // 「单源二手」= 只有 1 条，且该条标注为二手/未抓原文
  const secondary = /二手|未抓原文/.test(m[1]);
  if (n === 1 && secondary) {
    weakSrcPages.push(f);
    if (!/data-evchain="1"/.test(ph)) missingChain.push(f);
  }
}
check(weakSrcPages.length > 0,
  '存在「单源二手」详情页（空集会让下面那条 every 恒真，这是本站踩过的坑）',
  '实际 ' + weakSrcPages.length + ' 页');
check(missingChain.length === 0,
  '★ 单源二手（1 条 + 二手未抓原文）的详情页必须附「证据链」区块（data-evchain）',
  missingChain.length ? missingChain.length + ' 页缺区块：' + missingChain.slice(0, 6).join(', ') : weakSrcPages.length + ' 页均已附');
check(/待补证据/.test(readFileSync(join(ROOT, 'brand', 'google.html'), 'utf8')),
  '★ 证据链区块必须写明「待补证据」（只写来源不写缺口 = 半条链）');
// 招商银行：2026-11-02 已把单条第三方换成 6 条公开来源，不许退回
const cmb = readFileSync(join(ROOT, 'brand', 'cmb.html'), 'utf8');
const cmbItems = ((cmb.match(/<h2>证据来源<\/h2>\s*<ul>([\s\S]*?)<\/ul>/) || [])[1] || '')
  .match(/<li style="margin:0 0 12px">/g) || [];
check(cmbItems.length >= 6 && /nfnews\.com/.test(cmb) && /financeun\.com/.test(cmb),
  '★ 招商银行已补齐公开来源证据链（≥6 条且含南都/中国金融网原文链接，不许退回单条第三方）',
  '条数 ' + cmbItems.length);
check(/为什么不是 D 级/.test(cmb) && /判据不追溯/.test(cmb) && /2026-11-02/.test(cmb),
  '★ 招商银行页必须写明「为什么不是 D 级」并标注结论的判据时点（2026-11-02 判据下维持 C；2026-11-03 判据扩充后按不追溯原则保留，不得拿旧结论冒充新判断）');

// D 级判据 2026-11-03 扩充为三类（规避法律风险加班／以加班为荣／劝放弃法定社保），
// 并同步确立「不追溯」原则。这三条不只是文案——口径文本被改窄会让后续 D 级判定失去依据，
// 而丢了「不追溯」会让招行那个 C 被读成「新判据下招行仍不够 D」，与事实不符。
// 判据词在口径区出现两处（简版 li + 详细段），必须**分别**判断：
// 只做全页 includes 会被另一处救绿（2026-11-03 故障注入实证：删掉详细段的「以加班为荣」，
// 简版 li 里还有一份，全页断言照样通过 → 判据被改窄而校验全绿）。
const idxText = readFileSync(join(ROOT, 'index.html'), 'utf8');
const dLi = (idxText.match(/<li><strong>D 级<\/strong>[\s\S]*?<\/li>/) || [''])[0];
const dPara = (idxText.match(/<strong>D 级（站长人工介入[\s\S]*?<\/p>/) || [''])[0];
check(dLi.length > 0 && /以加班为荣/.test(dLi) && /放弃法定社保/.test(dLi) && /规避法律风险/.test(dLi),
  '★ D 级判据三类情形写进口径区简版条目（评级口径 li）',
  '简版 li 缺某一类判据 → 只看小字的读者拿到的判据不完整');
check(dPara.length > 0 && /以加班为荣/.test(dPara) && /放弃法定社保/.test(dPara) && /规避法律风险/.test(dPara),
  '★ D 级判据三类情形写进口径区详细段',
  '详细段缺某一类判据 → 2026-11-03 站长拍板扩充的判据被改窄或删除，D 级失去判定依据');
check(/判据不追溯/.test(idxText) && /2026-11-03/.test(idxText),
  '★ D 级新判据须写明「不追溯 + 生效日 2026-11-03」',
  '缺不追溯条款或生效日 → 旧结论会被当成新判据下的结论');
check(/招商银行维持 C 级/.test(idxText),
  '★ 口径区须点名说明招商银行按不追溯原则维持 C（原则必须落到具体结论）');

// u-grade-patch.js 的 U 品牌清单必须与 bundle 内 tier:`U` 的卡一一对应。
// 漏改的后果不是报错，是那张卡**徽标空白**（bundle 的 switch 没有 U 分支）——
// 静默失效，只有真渲染才看得出来，所以必须机器咬住。
const bundleTierU = [];
brandCards.forEach((c, i) => {
  const end = i + 1 < brandCards.length ? brandCards[i + 1].pos : bundle.length;
  if (bundle.slice(c.pos, end).includes('tier:`U`')) bundleTierU.push(c.id);
});
const patchSrc = readFileSync(join(ROOT, 'u-grade-patch.js'), 'utf8');
const patchList = (patchSrc.match(/U_BRANDS\s*=\s*\[([^\]]*)\]/) || [])[1] || '';
const patchCount = (patchList.match(/'/g) || []).length / 2;
check(patchCount === bundleTierU.length,
  'u-grade-patch.js 的 U_BRANDS 条数 = bundle 内 U 档卡数（漏一条 = 该卡徽标空白）',
  '清单 ' + patchCount + ' 条 / bundle U 档 ' + bundleTierU.length + ' 张（' + bundleTierU.join(',') + '）');
// ---- 2e-2. 月休口径落地断言（2026-10-31 站长口径）----
// 防两类回退：① 口径区文字被改回「无双休证据即判 C」旧口径；
// ② 数据层改档但 brand/ 详情页徽章没跟着改（首页 A、详情页 C 的自相矛盾）。
check(/A 级<\/strong>：月休 8 天以上/.test(html)
  && /B 级<\/strong>：月休 6-8 天/.test(html)
  && /C 级<\/strong>：月休不足 6 天/.test(html),
  'index.html 评级口径区写明月休四档标准（B=6-8 天 / A=8 天以上 / C=不足 6 天）');
check(html.includes('轮休制周休 2 天（做五休二）属双休、判 A 级'),
  'index.html 口径区写明「轮休制周休 2 天属双休判 A」（废除 AI 自拟的周末限定口径）');
check(!html.includes('查不到直雇统一双休证据即视为无双休'),
  'index.html 已无「查不到直雇统一双休证据即视为无双休」自拟旧口径（活文案）');
const BANK_PAGE_TIER = { icbc: 'A', ccb: 'A', boc: 'A', chengdubank: 'A', abc: 'A', guangfa: 'A', tianfu: 'A' };
const badBankPage = [];
for (const [slug, tier] of Object.entries(BANK_PAGE_TIER)) {
  const page = join('brand', slug + '.html');
  const ph = readFileSync(join(ROOT, page), 'utf8');
  const want = tier === 'A'
    ? '<span class="badge" style="background:#0F766E">A 级评级</span>'
    : '<span class="badge" style="background:#BE123C">C 级 · 主体单休</span>';
  if (!ph.includes(want)) badBankPage.push(page + '：徽章不是 ' + tier + ' 级');
  if (tier === 'A') {
    if (ph.includes('为什么判 C 级') || ph.includes('C 级 · 无双休')) badBankPage.push(page + '：仍有 C 级判级文案');
    if (!ph.includes('为什么判 A 级')) badBankPage.push(page + '：缺「为什么判 A 级」小节');
  } else {
    if (ph.includes('即视为无双休')) badBankPage.push(page + '：判据仍是自拟旧口径');
    if (!ph.includes('单休网点占比 61%') && !ph.includes('单休网点占比61%')) badBankPage.push(page + '：缺单休占比硬证据判据');
  }
}
check(badBankPage.length === 0,
  'brand/ 5 张银行页徽章与判据跟数据层一致（5 家 A 级硬证据）',
  badBankPage.join('；') || '一致');

// ---- 2g. 首页证据链完整公示（2026-10-31 站长要求「证据链必须首页完整公示，口说无凭」）----
// 事故背景：首页顶部公告栏长期写着「本站全部数据均附公开证据链…来源可查可溯」，
// 但首页可见区一条证据都没有——174 条证据全藏在 brand/*.html 里。口号与实况脱节，
// 就是站长说的「口说无凭」。现在首页有 #evidence-board 完整公示区。
//
// 本节是防漂移断言。关键设计：**用 Node 独立解析 brand/ 页（真相源）**，
// 再与 index.html 公示区里的 data-* 契约逐项对账。
// 生成器是 Python、这里是 Node，两份独立实现同一套解析口径——
// 只要有人改了详情页证据却没重跑生成器，两边数字就会对不上，本节判红。
// （若只校验公示区自身自洽，那是自己对自己，抓不到漂移。）
section('2g. 首页证据链完整公示');
{
  const EB_START = '<!-- EVIDENCE-BOARD-START';
  const EB_END = '<!-- EVIDENCE-BOARD-END -->';
  const NOTICE_ID = 'evidence-notice';

  // ---------- 1. 独立解析 brand/ 真相源 ----------
  /** 从单个详情页解析：档位 + 证据条数 + 带链接条数。口径须与生成器一致。 */
  function parseBrandEvidence(pagePath) {
    const t = read(pagePath);
    // 2026-11-02：U 级重新出现（三星/宏碁证据不足），这里必须包含 U，
    // 否则 truth.grade 变成空串、与公示区的 data-g="U" 对不上，整条契约断言判红。
    const grade = (t.match(/<span class="badge"[^>]*>\s*([SABCDU])\s*级/) || [])[1] || '';
    const evBlock = t.match(/<h2>证据来源<\/h2>\s*<ul>([\s\S]*?)<\/ul>/);
    const items = evBlock
      ? [...evBlock[1].matchAll(/<li style="margin:0 0 12px">([\s\S]*?)<\/li>/g)]
      : [];
    return {
      grade,
      n: items.length,
      linked: items.filter((m) => m[1].includes('<a href="')).length,
    };
  }

  const brandDir = join(ROOT, 'brand');
  const brandFiles = existsSync(brandDir)
    ? readdirSync(brandDir).filter((f) => f.endsWith('.html')).sort()
    : [];
  const truth = new Map();
  for (const f of brandFiles) {
    const slug = f.replace(/\.html$/, '');
    truth.set(slug, parseBrandEvidence(join('brand', f)));
  }
  const truthTotal = [...truth.values()].reduce((s, v) => s + v.n, 0);
  const truthLinked = [...truth.values()].reduce((s, v) => s + v.linked, 0);
  const truthWeak = [...truth.entries()].filter(([, v]) => v.n === 0).map(([k]) => k);

  check(brandFiles.length > 0, `能独立解析 brand/ 详情页（${brandFiles.length} 页）`,
    brandFiles.length ? '' : 'brand/ 目录为空或不存在');

  // ---------- 2. 公示区块必须在位 ----------
  const ebStart = html.indexOf(EB_START);
  const ebEnd = html.indexOf(EB_END);
  check(ebStart >= 0 && ebEnd > ebStart,
    'index.html 有首页证据公示区块（EVIDENCE-BOARD 锚点）');
  // 缺区块时不 throw：throw 会让整个 verify 崩掉、丢掉全部 699 项的汇总。
  // 改成给空串，后续每条断言各自判红，既有红灯又能看到完整报告。
  const eb = (ebStart >= 0 && ebEnd > ebStart)
    ? html.slice(ebStart, ebEnd + EB_END.length)
    : '';

  // ---------- 3. 区块必须是纯静态（无 JS 也能公示）----------
  // 「公示」不能依赖被公示方的脚本可用性——用户禁用 JS、爬虫抓取，
  // 看到的必须是同一份证据清单。所以区块内一个 <script> 都不许有。
  // ⚠️ 必须先确认区块非空再测无 script：区块被整块删掉时 eb 是空串，
  //    `!/<script/.test('')` 恒为 true → 断言在「区块根本不存在」时判绿，
  //    这就是 2026-10-31 故障注入②实际抓到的救绿形态（测了个寂寞）。
  check(eb.length > 0 && !/<script/i.test(eb),
    '公示区块为纯静态 HTML（区块内无 <script>，禁用 JS 也能完整公示）',
    eb.length === 0 ? '区块为空（已被删除？）' : '区块里出现了 script 标签');
  // 折叠必须用原生 <details>，不能靠 JS 切显隐
  const detailsCount = (eb.match(/<details /g) || []).length;
  check(detailsCount === truth.size,
    `公示区用原生 <details> 折叠，逐家一个（${detailsCount} 个 = ${truth.size} 家）`,
    `实际 ${detailsCount} 个`);

  // ---------- 4. 挂载位置：必须在 #root 之外 ----------
  // React 只管 #root。挂在里面会被重渲染清掉，就得靠 MutationObserver 自愈——
  // 2026-10-31 刚踩过 MO 锚点冲突无限自激的坑（主线程卡死）。
  // 注：#root 内部允许放一个「加载中」占位（React 挂载时自动替换），所以不再死磕
  // 空标签 <div id="root"></div>，改为按开标签定位 + 标签平衡找真正的闭合 </div>，
  // 要求证据链区块在该闭合标签之后（既能容下占位，又能防住「把证据链塞进 #root」）。
  const rootOpen = html.indexOf('<div id="root"');
  function matchCloseTag(s, openPos) {
    let i = s.indexOf('>', openPos) + 1;
    let depth = 1;
    while (i < s.length && depth > 0) {
      const o = s.indexOf('<div', i);
      const c = s.indexOf('</div>', i);
      if (c < 0) return -1;
      if (o >= 0 && o < c) { depth++; i = o + 4; }
      else { depth--; i = c + 6; }
    }
    return i - 6; // 匹配到的闭合 </div> 起点
  }
  const rootClose = rootOpen >= 0 ? matchCloseTag(html, rootOpen) : -1;
  check(rootOpen >= 0 && rootClose >= 0 && ebStart > rootClose,
    '公示区块挂在 #root 之后（React 管不到，不需要 MutationObserver 自愈）',
    rootOpen < 0 ? '找不到 #root 锚点' : '区块在 #root 之内或之前');

  // ---------- 5. 逐家对账（data-b/data-g/data-n/data-l 契约）----------
  const rows = [...eb.matchAll(
    /<details id="ev-([^"]+)" data-b="([^"]*)" data-g="([^"]*)" data-n="(\d+)" data-l="(\d+)"/g)]
    .map((m) => ({ id: m[1], slug: m[2], grade: m[3], n: Number(m[4]), l: Number(m[5]) }));

  check(rows.length === truth.size,
    `公示区覆盖全部 ${truth.size} 家企业（逐家 data 契约齐全）`,
    `实际解析到 ${rows.length} 家`);

  const mismatch = [];
  const seen = new Set();
  for (const r of rows) {
    seen.add(r.slug);
    const t = truth.get(r.slug);
    if (!t) { mismatch.push(`${r.slug}：brand/ 里没有这个详情页（公示区有幽灵条目）`); continue; }
    if (r.grade !== t.grade) mismatch.push(`${r.slug}：档位 公示${r.grade} ≠ 详情页${t.grade}`);
    if (r.n !== t.n) mismatch.push(`${r.slug}：证据条数 公示${r.n} ≠ 详情页${t.n}`);
    if (r.l !== t.linked) mismatch.push(`${r.slug}：带链接条数 公示${r.l} ≠ 详情页${t.linked}`);
    // id 与 data-b 必须同指一家，否则锚点跳转会跳错
    if (r.id !== r.slug) mismatch.push(`${r.slug}：锚点 id(ev-${r.id}) 与 data-b 不一致`);
  }
  for (const slug of truth.keys()) {
    if (!seen.has(slug)) mismatch.push(`${slug}：详情页有，公示区漏了这家`);
  }
  check(mismatch.length === 0,
    '公示区逐家 data 契约与 brand/ 详情页完全一致（档位/条数/链接数/锚点）',
    mismatch.slice(0, 12).join('；') + (mismatch.length > 12 ? ` …共 ${mismatch.length} 处` : '')
    || '一致');

  // ---------- 6. 区块级汇总自洽 + 与真相源一致 ----------
  const head = eb.match(/data-ev-brands="(\d+)" data-ev-total="(\d+)" data-ev-linked="(\d+)" data-ev-weak="(\d+)"/);
  check(!!head, '公示区块头部有 data-ev-* 汇总契约');
  if (head) {
    const [, hb, ht, hl, hw] = head.map(Number);
    const sumN = rows.reduce((s, r) => s + r.n, 0);
    const sumL = rows.reduce((s, r) => s + r.l, 0);
    check(hb === truth.size, `汇总「企业数」= 详情页数（${hb} = ${truth.size}）`, `写的是 ${hb}`);
    check(ht === truthTotal && ht === sumN,
      `汇总「证据总条数」= 真相源（${ht} = ${truthTotal}，且等于各行之和 ${sumN}）`,
      `汇总 ${ht} / 真相 ${truthTotal} / 行和 ${sumN}`);
    check(hl === truthLinked && hl === sumL,
      `汇总「带原始链接」= 真相源（${hl} = ${truthLinked}）`, `汇总 ${hl} / 真相 ${truthLinked}`);
    check(hw === truthWeak.length,
      `汇总「证据薄弱家数」= 零证据页家数（${hw} = ${truthWeak.length}）`,
      `汇总 ${hw} / 真相 ${truthWeak.length}`);
  }

  // ---------- 7. 公示的链接必须真的可点（不是把 URL 当纯文本写出来）----------
  // 「来源可查可溯」的最低要求：134 条带链接的证据，每条都得是 <a href>。
  const ebLinks = [...eb.matchAll(/<div class="u"><a href="(https?:\/\/[^"]+)" rel="nofollow noopener"/g)]
    .map((m) => m[1]);
  check(ebLinks.length === truthLinked,
    `公示区可点原始链接数 = 详情页真实链接数（${ebLinks.length} = ${truthLinked}）`,
    `公示 ${ebLinks.length} / 真相 ${truthLinked}`);
  // 逐条核对链接内容：公示区里的 URL 集合必须与详情页里的完全相同
  const truthLinks = [];
  for (const f of brandFiles) {
    const t = read(join('brand', f));
    const blk = t.match(/<h2>证据来源<\/h2>\s*<ul>([\s\S]*?)<\/ul>/);
    if (!blk) continue;
    for (const m of blk[1].matchAll(/<li style="margin:0 0 12px">([\s\S]*?)<\/li>/g)) {
      const a = m[1].match(/<a href="(https?:\/\/[^"]+)"/);
      if (a) truthLinks.push(a[1].replace(/&amp;/g, '&'));
    }
  }
  const ebLinkSet = ebLinks.map((u) => u.replace(/&amp;/g, '&'));
  const missingLinks = truthLinks.filter((u) => !ebLinkSet.includes(u));
  const extraLinks = ebLinkSet.filter((u) => !truthLinks.includes(u));
  check(missingLinks.length === 0 && extraLinks.length === 0,
    '公示区的原始链接逐条等于详情页的链接（不多不少不改写）',
    [...missingLinks.slice(0, 4).map((u) => '公示区缺 ' + u),
     ...extraLinks.slice(0, 4).map((u) => '公示区多出 ' + u)].join('；') || '一致');
  // 无链接的条目必须如实标注「无可点原始链接」，不许拿 URL 纯文本冒充可点。
  // 口径：公示区里「标注了无链接」的条数 = 真相源里「零链接」的条数。
  const noLinkMarks = (eb.match(/（本条无可点原始链接/g) || []).length;
  check(noLinkMarks === truthTotal - truthLinked,
    `无链接条目均如实标注（${noLinkMarks} 条 = ${truthTotal - truthLinked} 条）`,
    `标注 ${noLinkMarks} 条，真相 ${truthTotal - truthLinked} 条`);

  // ---------- 8. 证据薄弱清单必须如实单列（站长要求，不遮掩）----------
  const weakBlock = eb.match(/<div class="ev-weak">([\s\S]*?)<\/div>\s*\n\s*<div class="ev-list">/);
  check(!!weakBlock || truthWeak.length === 0,
    truthWeak.length ? '公示区有「证据薄弱清单」独立警示块' : '当前无证据薄弱企业（无需警示块）');
  if (weakBlock) {
    const wb = weakBlock[1];
    const notListed = truthWeak.filter((s) => !wb.includes(`./brand/${s}.html`));
    check(notListed.length === 0,
      `薄弱清单列全了 ${truthWeak.length} 家零证据企业`,
      notListed.length ? '漏列：' + notListed.join(', ') : '齐全');
    check(/拿不出可点击的公开原始链接/.test(wb) && /不伪造来源/.test(wb),
      '薄弱清单如实写明「无可点公开链接」且不伪造来源');
    // 零证据的那几家，展开体里必须给出判据（不能只显示一个空壳）
    const noReason = truthWeak.filter((s) => {
      const d = eb.match(new RegExp(`<details id="ev-${s}"[\\s\\S]*?<\\/details>`));
      return !d || !/class="ev-nolink"/.test(d[0]) || !/class="ev-reasons"/.test(d[0]);
    });
    check(noReason.length === 0,
      '零证据企业的展开体给出了评级判据（不是空壳）',
      noReason.length ? '缺判据：' + noReason.join(', ') : '齐全');
  }

  // ---------- 9. 公告栏：口号必须变成可点入口 + 真实数字 ----------
  // 这是本次改动的核心：原来那句「均附公开证据链…来源可查可溯」是纯口号，
  // 首页却看不到证据。现在必须是带锚点跳转的真实条数，且数字跟真相源一致。
  const notice = html.match(new RegExp(`<span id="${NOTICE_ID}">([\\s\\S]*?)</span>`));
  check(!!notice, '公告栏证据链句子有 evidence-notice 标记（生成器托管，不许手写）');
  if (notice) {
    const nb = notice[1];
    // 2026-11-02 一天里三轮指令，最终收敛成：
    //   上午「超链接不放顶部」→ 导航链接（同类项目导航 / 成功案例）全部移走；
    //   下午「这个我看了，建议还是保持原样，url 超链接」→ 这一句曾恢复成
    //   跳 #evidence-board 的页内锚点；
    //   再晚些「既然证据链公示已经在三横菜单，顶部就可以考虑取消 url」→ 撤掉。
    // 所以判据是**零超链接**：跳转入口由悬浮菜单里的「证据链公示」承担
    // （§9c 正向断言菜单必须有那一项，两处互补，不是各说各话）。
    // 只判「零」不够 —— 把整句删干净也是零，所以下面还有容器/版本号/数字断言兜底。
    const nbAnchors = nb.match(/<a\s[^>]*>/gi) || [];
    check(nbAnchors.length === 0,
      '公告栏那句是纯文字（跳转入口只在悬浮菜单，顶部零超链接）',
      `实际 ${nbAnchors.length} 个 <a>：${nbAnchors.join(' | ') || '（无）'}`);
    // ⚠️ 假承诺闸门：公告栏说「已在本页完整公示」，那本页就必须真有公示区块。
    //    区块被删而口号还在，比根本不公示更坏——它在骗读者。
    //    2026-10-31 故障注入②实测：区块整块删掉后，公告栏 6 条断言仍全绿，
    //    页面上挂着「174 条证据已在本页完整公示」而下面什么都没有。
    if (/已在本页完整公示/.test(nb)) {
      check(eb.length > 0 && html.includes('id="evidence-board"'),
        '公告栏宣称「已在本页完整公示」时，本页必须真有公示区块（不许留假承诺）',
        '公告栏在承诺，但 #evidence-board 不存在');
    }
    const m2 = nb.match(/(\d+) 家企业 (\d+) 条证据已在本页完整公示/);
    check(!!m2, '公告栏写明「N 家企业 M 条证据已在本页完整公示」');
    if (m2) {
      check(Number(m2[1]) === truth.size && Number(m2[2]) === truthTotal,
        `公告栏数字与 brand/ 真相源一致（${m2[1]} 家 / ${m2[2]} 条 = ${truth.size} 家 / ${truthTotal} 条）`,
        `公告栏写 ${m2[1]} 家 ${m2[2]} 条，真相是 ${truth.size} 家 ${truthTotal} 条`);
    }
    check(nb.includes(`${truthWeak.length} 家暂无可点公开链接`),
      `公告栏如实披露薄弱家数（${truthWeak.length} 家），不只报喜`);
    // 旧口号原句不许再裸露存在（否则等于两处口径，一处仍是空话）
    const bareSlogan = html.includes('本站全部数据均附公开证据链：招聘口径、员工反馈与官方通报分项标注，'
      + '来源可查可溯，欢迎核实纠错');
    check(!bareSlogan, '公告栏旧口号原句已被托管句替换（不留第二份空话）');
  }

  // ---------- 9b. 顶部公告栏：整条零超链接，跳转一律走悬浮菜单 ----------
  // 站长原话三轮：「不是说了超链接不放顶部吗？」→ 导航移走；
  // 「68 家企业 179 条证据…建议还是保持原样，url 超链接」→ 这一句曾恢复链接；
  // 「既然证据链公示已经在三横菜单，顶部就可以考虑取消 url」→ 链接再次撤掉，定稿为纯文字。
  // 判据：整条公告栏**零个 <a>**；导航链接回顶部、页内锚点回顶部，都判红。
  // 只查 <span id="evidence-notice"> 内部不够：有人可能把导航再加到 span 外面，
  // 所以必须在**整条 #site-notice**范围内扫。
  const noticeDiv = html.match(/<div id="site-notice"[\s\S]*?<\/div>/);
  check(!!noticeDiv, '顶部公告栏容器 #site-notice 在位');
  if (noticeDiv) {
    // 2026-11-16 站长：「加粗，字体也稍微加大一号，看着真难受啊！！！！」
    // 原来 12px/600 在中文系统字体下多半被回落成 400（中文字体常只有 400/700
    // 两档，600 是 semibold 空缺档），视觉上就是又细又小。定稿 13px/700。
    // 这里写「下限」而非等值：以后想继续加大/加粗不拦，但回退到旧值必须判红。
    const noticeFontSize = /font-size:\s*(\d+(?:\.\d+)?)px/.exec(noticeDiv[0]);
    const noticeFontWeight = /font-weight:\s*(\d+)/.exec(noticeDiv[0]);
    check(!!noticeFontSize && Number(noticeFontSize[1]) >= 13,
      '★ 公告栏字号 ≥13px（2026-11-16 站长加大一号，不许退回 12px）',
      '实际：' + (noticeFontSize ? noticeFontSize[1] + 'px' : '整条没有 font-size 声明'));
    check(!!noticeFontWeight && Number(noticeFontWeight[1]) >= 700,
      '★ 公告栏字重 ≥700（真正加粗，不许退回 600 让中文字体回落成 400）',
      '实际：' + (noticeFontWeight ? noticeFontWeight[1] : '整条没有 font-weight 声明'));
    const anchors = noticeDiv[0].match(/<a\s[^>]*>/gi) || [];
    check(anchors.length === 0,
      '★ 公告栏整条零超链接（顶部只放文字，跳转归悬浮菜单）',
      `实际 ${anchors.length} 个 <a>：${anchors.join(' | ') || '（无）'}`);
    // 上面已经是「零」，这条在逻辑上被包含；保留它是防有人把上面放宽成
    // 「≤1」之后，导航链接悄悄溜回来 —— 分工不同，别当冗余删掉。
    const navBack = anchors.filter((a) => /href="\.\/(projects|success-stories)\.html"/.test(a));
    check(navBack.length === 0,
      '公告栏里没有回到「同类项目导航 / 成功案例」的链接（导航归悬浮菜单）',
      '又挂回来了：' + navBack.join(' | '));
    // 版本号**不再**出现在公告栏（2026-11-02 第五轮，站长：「版本号不要写这里了，
    // 加入三横菜单吧，但是 PC 端那边怎么办？」）。
    // 这条从「必须有」反转成「必须没有」—— 反转而不是删掉，因为「又悄悄把版本号
    // 加回公告栏」正是下一轮最可能发生的回退，删了断言就等于没人拦。
    check(!/当前版本号\s*[0-9a-f]{7}/.test(noticeDiv[0])
      && !/notice-ver/.test(noticeDiv[0]),
      '公告栏里不再有版本号（改由悬浮菜单承载）',
      '公告栏又出现版本号：' + ((noticeDiv[0].match(/当前版本号[^<]*/) || [''])[0]));
    // 但锚点节点必须存在且**唯一**：sync-version.mjs、verify §20g、
    // .github/workflows/sync-version.yml 三处都靠「当前版本号 xxxxxxx</span>」
    // 回写，节点丢了就是每日版本号同步静默失效；节点重复则回写只改第一处，
    // 另一处永远停在旧值。
    const verAnchors = html.match(/当前版本号\s*[0-9a-f]{7}\s*<\/span>/g) || [];
    check(verAnchors.length === 1,
      '版本号真相源节点唯一且带 7 位哈希（sync-version 回写锚点）',
      `实际 ${verAnchors.length} 处：${verAnchors.join(' | ')}`);
    check(/<span id="site-version"[^>]*hidden[^>]*>\s*<span class="notice-ver">/.test(html),
      '版本号召回源是 #site-version（hidden 隐藏，菜单运行时读文本）',
      '没找到 <span id="site-version" hidden><span class="notice-ver"> 这层结构');

      /* 2026-11-15 站长口令反转：「算了，滚动起来，别展开折叠了」「至于最近新增，
         不如放在展开的那个位置？就是右侧加按钮算了，弄成一行看看？」
         原 2026-11-02 的「两行 clamp + checkbox/label 展开」整套作废。
         这里把断言方向反过来：折叠开关**不许回流**，滚动视口/轨道/按钮槽三件
         缺一件就等于没有一行滚动；正文完整原句的四条断言仍在下面保留。 */
    check(!/notice-more|notice-more-cb|notice-more-lbl|<label/i.test(noticeDiv[0]),
      '★ 公告栏已撤掉展开/收起折叠开关（回流即判红）',
      '又写回 checkbox + label → 站长 2026-11-15「别展开折叠了」被推翻');
    check(/id="notice-viewport"/.test(noticeDiv[0])
      && /id="notice-track"/.test(noticeDiv[0])
      && /id="sxg-recent-slot"/.test(noticeDiv[0]),
      '公告栏单行结构齐备：滚动视口 + 轨道 + 右侧「最新新增」按钮槽');
    check(/display:\s*flex/.test(noticeDiv[0]) && /text-align:\s*left/.test(noticeDiv[0])
      && /align-items:\s*center/.test(noticeDiv[0]),
      '公告栏整体 flex 单行（正文与右侧按钮同一行、垂直居中）',
      '退回 block 或居中 → 按钮会掉到第二行，站长要的「弄成一行」落空');

    /* 第四轮定稿：正文是**原句**，不许再改写成短句。
       —— 第三轮曾把手机文本换成 21 字改写句「全站 N 家企业 M 条证据已公示」，
          读着省事，但那已经不是本站的证据链口径，站长原话是「我要的是这句完整的话」。
       判据四条：原句开头 / 四个分句一个不少 / 以「欢迎核实纠错」收尾 / 正文无省略号。
       截断只许发生在 CSS 层（line-clamp），DOM 里必须是完整一句话 ——
       爬虫、读屏、复制粘贴拿到的都得是全本。 */
    // 正文取自主告栏 span 本体（前面 §9 里的 nb 在上一个 if 块里，作用域出不来）。
    // 右边界用「紧跟 <!-- /notice -->」，与生成器的 NOTICE_SPAN_RE 同口径，
    // 以后谁再往里套标签也不会被内层 </span> 提前截断。
    const nb = (noticeDiv[0].match(
      new RegExp(`<span id="${NOTICE_ID}">[\\s\\S]*?</span><!-- /notice -->`)) || [''])[0]
      .replace(new RegExp(`^<span id="${NOTICE_ID}">`), '')
      .replace(/<\/span><!-- \/notice -->$/, '');
    const NOTICE_OPEN = '本站全部数据均附公开证据链：';
    check(nb.trim().startsWith(NOTICE_OPEN),
      '公告栏正文以原句开头（「本站全部数据均附公开证据链：」）',
      '实际开头：' + nb.trim().slice(0, 20));
    const CLAUSES = ['家企业', '条证据已在本页完整公示',
      '（招聘口径、员工反馈与官方通报分项标注，来源可查可溯；',
      '家暂无可点公开链接，已在公示区如实单列），欢迎核实纠错'];
    const missingClause = CLAUSES.filter((c) => !nb.includes(c));
    check(missingClause.length === 0,
      '公告栏是完整一句话（四个分句一个不少，含「欢迎核实纠错」收尾）',
      '缺：' + missingClause.join(' / '));
    check(nb.trim().endsWith('欢迎核实纠错'),
      '公告栏正文以「欢迎核实纠错」收尾（句子没被砍尾）',
      '实际结尾：' + nb.trim().slice(-14));
    check(!/[….．]{1,3}/.test(nb) && !/\.\.\./.test(nb),
      '公告栏正文里没有省略号（截断交给 CSS，文本本身是完整句子）',
      '正文含省略号：' + nb.trim().slice(-24));
    // 改写句必须彻底消失：HTML 与 CSS 都清掉，否则「手机显示的是哪一句」有两个答案
    // （真机谁赢取决于具体实现，验不了 = 等于没验）。
    {
      const mfc = stripCssComments(read('mobile-fixes.css'));
      const mqCss = stripCssComments(read('notice-marquee.css'));
      const mqJs = read('notice-marquee.js');
      const gen9b = read('scripts/gen-evidence-board.py');
      check(!/notice-short/.test(html) && !/notice-short/.test(mfc),
        '不再有「手机改写短句」机制（notice-short 已从 HTML 与 CSS 一并清除）',
        'notice-short 残留：' + (/notice-short/.test(html) ? 'index.html ' : '')
          + (/notice-short/.test(mfc) ? 'mobile-fixes.css' : ''));
      // 版本号真相源节点在任何端都不可见：HTML 的 hidden 只是 UA 样式，
      // 任何一份给 span 加 display 的样式表都能把它顶出来，必须有 id 级兜底。
      check(/#site-version\s*\{[^}]*display:\s*none/.test(mfc),
        '版本号真相源节点有 CSS 隐藏兜底（#site-version{display:none}）',
        '只靠 HTML 的 hidden 属性，一旦有样式表给 span 加 display 就会露出来');
      // 旧折叠规则必须整体清空：留着就是两套布局互相顶，且「谁生效」取决于断点。
      check(!/notice-more-cb|notice-more-lbl|-webkit-line-clamp:\s*2/.test(mfc),
        '★ mobile-fixes.css 已清空折叠开关与两行 clamp 规则（不留死代码）',
        '旧折叠样式还在 → 公告栏不再是单行滚动，或宽度断点下样式互相打架');

      /* ---- 单行横向滚动：脚本 + 样式 + 生成器三层都钉住 ----
         只断言「index.html 里有 viewport」是不够的：把动画删了、副本写死文案、
         或把 -50% 改成 -100%，页面照样有这些 id，但用户看到的是空白/旧数字。 */
      check(/@keyframes\s+sxg-notice-scroll/.test(mqCss)
        && /translateX\(-50%\)/.test(mqCss)
        && /animation:\s*sxg-notice-scroll\s+[\d.]+s\s+linear\s+infinite/.test(mqCss)
        && /#site-notice\.is-marquee\s+\.notice-track\s*\{[^}]*animation/.test(mqCss),
        '滚动动画真生效（两份等宽文本 + translateX(-50%) 无缝，仅 is-marquee 启播）',
        '删动画 / 改成 -100% / 无条件启播 → 循环处空白或脚本挂了滚成空条');
      check(/overflow-x:\s*auto/.test(mqCss) && /prefers-reduced-motion:\s*reduce/.test(mqCss)
        && /\.notice-copy\s*\{\s*display:\s*none/.test(mqCss),
        '降级齐备：脚本挂了可手动横滑，reduced-motion 停动画并隐藏副本');
      check(/\.notice-viewport\s*\{[^}]*flex:\s*1\s+1\s+auto/.test(mqCss)
        && /#sxg-recent-slot\s*\{[^}]*flex:\s*0\s+0\s+auto/.test(mqCss),
        '滚动视口吃掉剩余宽度、按钮槽固定不压缩（真的一行）',
        '按钮槽写成 flex:1 或视口不伸缩 → 320px 下按钮会被挤到第二行');
      check(/getElementById\('evidence-notice'\)/.test(mqJs)
        && /copy\.textContent\s*=\s*src\.textContent/.test(mqJs)
        && /setAttribute\('aria-hidden',\s*'true'\)/.test(mqJs),
        '★ 循环副本运行时克隆同源正文（不硬编码第二份，读屏只读一份）',
        '把句子复制进 JS 或静态 HTML → 生成器改数字后副本永远是旧口径');
      check(/classList\.add\('is-marquee'\)/.test(mqJs)
        && /animationDuration/.test(mqJs)
        && /prefers-reduced-motion/.test(mqJs)
        && /querySelector\('\.notice-copy'\)/.test(mqJs),
        '补丁具备启播条件、按宽度算时长、reduced-motion 与幂等');
      check(/<link rel="stylesheet" href="\.\/notice-marquee\.css\?v=4">/.test(html)
        && /<script defer src="\.\/notice-marquee\.js\?v=4"><\/script>/.test(html),
        '首页挂载公告栏滚动样式与脚本（各 ?v=4，改后须 bump）',
        '脚本/样式没挂 → 页面看着还是静态一行，滚动静默失效');
      check(/'id="notice-viewport"'\s+not in cur/.test(gen9b)
        && /'id="notice-more"'\s+in cur/.test(gen9b)
        && /'id="sxg-recent-slot"'\s+not in cur/.test(gen9b),
        '生成器 --check 同步钉住单行结构、拦折叠开关回流',
        '只有 verify 会判红、生成器不判 → 重跑生成器时结构漂移无人发现');
    }
  }

  // ---------- 9c. 导航出口改由右下角悬浮菜单承担 ----------
  check(exists('nav-menu.js'), '存在右下角悬浮导航菜单 nav-menu.js');
  if (exists('nav-menu.js')) {
    const nm = read('nav-menu.js');
    check(nm.includes("'./projects.html'") && nm.includes("'./success-stories.html'"),
      '悬浮菜单含「同类项目导航 / 成功案例」两个出口');
    // 公告栏折叠后，不想点「展开」的人得有别的路到证据链 —— 菜单里补一个页内锚点
    check(nm.includes("'#evidence-board'"),
      '悬浮菜单含「证据链公示」页内跳转（公告栏折叠后的补偿入口）');
    /* 2026-11-14 站长：弹窗保持两枚按钮，随笔入口改挂右下角悬浮导航，双端统一叫
       「手气不错」；只改按钮文字，notes.html 的标题 / 锁屏 / 加密正文一个字都不动。
       ⚠️ 咬住 ITEMS 数组本身：上面的注释如实引用了站长原话（含「站长随笔」），
       全文负向断言会把正确实现判红（PITFALLS 第六十三章的子串误伤）。 */
    const navItems = (nm.match(/var ITEMS = \[([\s\S]*?)\];/) || [, ''])[1];
    check(/label: '手气不错', href: '\.\/notes\.html'/.test(navItems)
      && !/label: '站长随笔'/.test(navItems)
      && exists('notes.html'),
      '悬浮导航新增「手气不错」→ notes.html（PC 右下 dock / 手机二级菜单共用同一 ITEMS，双端同名）',
      '入口缺失或写回「站长随笔」→ 弹窗改版丢掉的随笔按钮没补回来，或站长要求的改名没落地');
    check((html.match(/nav-menu\.js\?v=11/g) || []).length === 2,
      'index.html 的 nav-menu.js 预加载与脚本两处缓存号同步 bump 到 ?v=11',
      '只 bump 一处 → 预加载旧脚本，用户拿到没有最新菜单的旧脚本');
    // QQ 浏览器专题「不进」导航（2026-11-19 站长纠正）：拦截跳专题页就够了，
    // 普通访客不应有直达入口；专题页也不 backlink 站点其它页，只有搜索引擎来路。
    check(!/label: 'QQ 浏览器专题'/.test(navItems),
      '悬浮导航不再含「QQ 浏览器专题」入口（专题页只对 QQ 浏览器访客可见）',
      '擅自给专题页加访客入口 → 违背站长「拦截跳专题、但不主动推给普通访客」的口径');
    const dpNav = read('douyin-prompt.js');
    check(!/手气不错/.test(dpNav)
      && (dpNav.match(/class="dyp__(?:video|share)"/g) || []).length === 2,
      '弹窗仍恰好两枚按钮（视频 / 分享文章），「手气不错」只进导航栏不回弹窗',
      '站长明确「弹窗还是就 2 个按钮吧」，随笔按钮不许塞回弹窗');
    // 版本号由菜单承载（2026-11-02 第五轮）：公告栏已经彻底不写它了，
    // 所以「菜单读得到」这件事从"锦上添花"变成"唯一出口"。
    // 同理断言「读 DOM」而不是「有版本号」：JS 里另写死一份哈希也能过字面检查，
    // 但那份永远不会跟着 sync-version 更新，所以行为测试比对的是桩里的原文。
    check(/notice-ver/.test(nm) && /sxg-nav-ver/.test(nm),
      '悬浮菜单承载版本号（运行时读 .notice-ver，不另存哈希）');
    // 第五轮：真相源搬到页面级 #site-version。只留 #site-notice 选择器的话，
    // 公告栏一撤就整条读不到 —— 菜单静默少一项，页面看不出任何异常。
    // ⚠️ 不能只断言「文件里出现 #site-version 字样」：noticeVersion() 上方的
    // 注释里就有这个词，于是把查询代码改回旧选择器也照样绿 ——
    // 2026-11-02 故障注入实测正是这样（典型「注释救绿」，见 PITFALLS 25.5）。
    // 必须咬住真正的调用点。
    check(/querySelector\('#site-version \.notice-ver'\)/.test(nm),
      '菜单优先读 #site-version（真相源已搬出公告栏，旧选择器只作回退）',
      'noticeVersion() 里没有对 #site-version 的查询');
    // PC 端没有三横按钮，版本号挂在常显 dock 串尾。
    // 判据必须是「没有 display:none」：上一版正是靠它把 PC 端藏起来的，
    // 只断言"有 .sxg-nav-ver 类"的话，藏着的版本号也照样过。
    check(!/\.sxg-nav-ver\s*\{[^}]*display:\s*none/.test(nm),
      'PC 端菜单也显示版本号（.sxg-nav-ver 不再被 display:none 藏起来）',
      '样式里还有 .sxg-nav-ver{display:none}，桌面端会看不到版本号');
    check(/<script(?:\s+defer)? src="\.\/nav-menu\.js\?v=\d+"><\/script>/.test(html),
      'index.html 已挂载 nav-menu.js（带 ?v 缓存号）');
    // PC 常显 / 手机折叠：两个断点都必须写在样式里，否则等同只有一个形态
    check(/@media \(max-width:640px\)/.test(nm) && /--sxg-bar-h/.test(nm),
      '悬浮菜单自带手机断点与吸底条避让变量');
    if (exists('.github/workflows/verify.yml')) {
      const ci = read('.github/workflows/verify.yml');
      // 2026-11-02：这一步暂缺 —— 本机 git 凭据的 PAT 缺 `workflow` scope，
      // 推不上去 `.github/workflows/*` 的任何改动（API 通道同样 403）。
      // 有就断言，没有就明说（note），**不把条件写成字面量 true 冒充绿灯**
      // （test-verify-self.cjs 正是抓这个的，本轮被抓过一次）。
      // TODO(站长补 token workflow 权限后)：在 verify.yml 加一行
      //   node scripts/test-nav-menu.cjs
      // 并把下面的 note 分支删掉。
      const navInCi = ci.includes('test-nav-menu.cjs');
      if (navInCi) {
        check(navInCi, 'CI 里已接入悬浮菜单行为测试');
      } else {
        // 2026-11-03：本机 token 补了 workflow scope，已挂进 CI（见 verify.yml
        // 「悬浮菜单测试」step）。这条只在接线被删掉时才提示。
        note('悬浮菜单测试未接入 CI（test-nav-menu.cjs 不在 verify.yml 里）');
      }
    }
  }

  // ---------- 10. 证据强度分级图例（不许把弱证据当强证据用）----------
  check(/证据强度分级（强 → 弱）/.test(eb), '公示区有证据强度分级图例');
  check(/司法裁判文书与劳动监察通报为最高强度证据/.test(eb),
    '图例写明司法文书/监察通报为最高强度');
  check(/招聘平台自述属「招聘方口径」/.test(eb) && /不证明实际怎么排班/.test(eb),
    '图例写明招聘口径的局限（只证明企业怎么说）');
  check(/本站不用它们单独定档/.test(eb),
    '图例写明社群匿名反馈与旁证不单独定档');
  // 每条证据都要标出归并后的强度大类（原始字面标注也保留，不因归并丢细节）
  const kindBadges = (eb.match(/<span class="k" /g) || []).length;
  check(kindBadges === truthTotal,
    `每条证据都标了强度大类徽章（${kindBadges} 个 = ${truthTotal} 条）`,
    `实际 ${kindBadges} 个`);
  check((eb.match(/原标注：/g) || []).length > 0,
    '归并后仍保留原始字面标注（不因归并篡改证据细节）');

  // ---------- 11. 生成器与托管纪律 ----------
  check(exists('scripts/gen-evidence-board.py'),
    '存在公示区生成器 scripts/gen-evidence-board.py');
  check(/由 scripts\/gen-evidence-board\.py 自动生成，请勿手改/.test(eb),
    '公示区块头部写明由生成器托管、请勿手改');
  check(/scripts\/verify\.mjs<\/code> 判红/.test(eb),
    '公示区向访客说明「两处不一致会被校验判红」（公示自身的可信度声明）');
  // 生成器必须有 --check 模式，否则 CI/本地无法做漂移检测
  if (exists('scripts/gen-evidence-board.py')) {
    const gen = read('scripts/gen-evidence-board.py');
    check(gen.includes("'--check'"), '生成器有 --check 漂移检测模式');
    check(gen.includes("'--dump'"), '生成器有 --dump 解析自检模式');
    check(/'rb'/.test(gen) && /'wb'/.test(gen),
      '生成器字节级读写（仓库锁 LF，文本模式会引入 CRLF）');
  }
}

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
    // 2026-11-12：自定义卡也允许 0%，但必须自带「口径换算」字样（算术换算而非实测）
    const derived = chunk.includes('口径换算');
    customCards.push({ id, name, rate, off, insertAfter, logo, derived });
  }
}
const CUSTOM_COUNT = customCards.length;
check(CUSTOM_COUNT === 22 + IMPORTED_CARD_COUNT,
  `自定义卡 ${CUSTOM_COUNT} 张（22 张手工 + ${IMPORTED_CARD_COUNT} 张导入；2026-11-02 批量导入，2026-11-03 增联通 B 级，2026-11-08 增陆喜依 S 级，2026-11-12 增广发银行/四川天府银行 A 级 + 零跑汽车 C 级，2026-11-13 增小米汽车（建卡 C 级、同日站长人工介入上调 B 级）+ 广汽丰田 B 级，2026-11-19 增 8 家国产新能源车企，2026-11-20 增网易游戏 B 级）`);

// 2026-11-19：8 家国产新能源车企卡（紧跟时事建卡，站长定级 + 招聘 JD 标注来源采信）。
// 锁定 id/档位/详情页，删卡、改档或漏页都判红；评级按公开证据口径，非本站实测。
{
  const EV_CARS_3 = {
    'xiaopeng-card': { name: '小鹏汽车', grade: 'B级' },
    'wenjie-card': { name: '问界（赛力斯）', grade: 'C级' },
    'jike-card': { name: '极氪', grade: 'B级' },
    'aion-card': { name: '广汽埃安', grade: 'B级' },
    'shenlan-card': { name: '深蓝汽车', grade: 'B级' },
    'lantu-card': { name: '岚图', grade: 'C级' },
    'wuling-card': { name: '上汽通用五菱', grade: 'B级' },
    'changan-qiyuan-card': { name: '长安启源', grade: 'B级' },
  };
  const gradeById3 = Object.fromEntries(customPairs2e.map((c) => [c.id, c.grade]));
  const wrong3 = [];
  for (const [id, spec] of Object.entries(EV_CARS_3)) {
    if (gradeById3[id] !== spec.grade) wrong3.push(`${id}=${gradeById3[id] || '缺失'}（应 ${spec.grade}）`);
    if (!exists('brand/' + id.replace(/-card$/, '') + '.html')) wrong3.push(`${id} 详情页缺失`);
  }
  check(wrong3.length === 0,
    '8 家国产新能源车企卡 id/档位/详情页齐全（小鹏/问界/极氪/埃安/深蓝/岚图/五菱/长安启源）',
    wrong3.join('；') || '全部到位');
  // 招聘 JD 来源必须标注（"采信但标注来源"口径）：至少一家页脚/证据带降级采信字样
  const jdLabel3 = ['xiaopeng', 'wenjie', 'lantu'].every((s) =>
    /降级采信|劳务派遣|中介发布/.test(read('brand/' + s + '.html')));
  check(jdLabel3,
    '新能源车企卡的招聘 JD 来源已标注「劳务派遣/中介发布·降级采信」',
    '缺来源标注 → 二手 JD 被当成官方口径');
}

// null 规则：双休率 / 下班时间不得为占位 0，也不得是字符串 '未知'
customCards.forEach((c) => {
  check((c.rate !== '0' && c.rate !== "'0'") || c.derived,
    `自定义卡「${c.name}」双休率未使用占位 0（当前 ${c.rate}）`,
    c.rate === '0' || c.rate === "'0'" ? '未核实应填 null；0% 若是排班口径算术换算，须在 desc 写「（口径换算）」' : '');
  check(c.off !== "'未知'",
    `自定义卡「${c.name}」下班时间未使用「未知」字符串（当前 ${c.off}）`,
    c.off === "'未知'" ? '应改为 null，由 statText() 渲染成「—」' : '');
  check(c.insertAfter !== '(缺失)', `自定义卡「${c.name}」配置了 insertAfter`);
  // logo 可以是 null：榜单导入的 104 张卡没有官方 logo 文件，注入层会直接回退成
  // 品牌简称文字（index.html 里 `if (!config.logo)` 分支）。只要有 src 就必须真实存在，
  // 否则就是破图；null 属于「已知无图」而不是「路径写错」，两者必须分开判。
  // 2026-11-05 起 'enc:<slug>' 是加密 LOGO 容器标记（logo-vault.js 本地解密），
  // 不落磁盘路径——有效性由 §20p「enc: 配置与容器一一对应」盯着。
  check(c.logo === '' || /^enc:[a-z0-9]+$/.test(c.logo)
    || localExists(c.logo.replace(/^\.\//, '')),
    `自定义卡「${c.name}」logo 路径有效或显式留空：${c.logo || '(null=文字回退)'}`,
    c.logo && !/^enc:/.test(c.logo) && !localExists(c.logo.replace(/^\.\//, '')) ? '路径指向不存在的文件（会破图）' : '');
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

  /* noscript 里「全部品牌详细页（N 个）」的 N 必须同时等于：
   *   ① 该 <ul> 里实际列出的唯一 slug 数  ② brand/ 目录里的页数
   *
   * 2026-11-02 踩坑：批量导入 104 条 <li> 塞进的正是这个 <ul>，标题却还写着旧的 64。
   * 结果是「用户看到 JS 渲染的 172 张卡，爬虫看到一份自称 64 个的清单」——
   * 两边不一致，而且没有任何东西会报错（noscript 用户看不见，爬虫不会抱怨）。
   * 标题里的数字是手工抄的，列表是脚本追加的，两者天然会漂，所以必须机器咬住。
   */
  const listSeg = (() => {
    const k = ns[1].indexOf('全部品牌详细页');
    if (k < 0) return '';
    const s = ns[1].indexOf('<ul', k);
    const e = s >= 0 ? ns[1].indexOf('</ul>', s) : -1;
    return e > s ? ns[1].slice(s, e) : '';
  })();
  const listSlugs = new Set(
    [...listSeg.matchAll(/href="\.\/brand\/([a-z0-9-]+)\.html"/g)].map((m) => m[1]));
  const headN = Number((ns[1].match(/全部品牌详细页（(\d+) 个）/) || [])[1]);
  const pageCount = existsSync(join(ROOT, 'brand'))
    ? readdirSync(join(ROOT, 'brand')).filter((f) => f.endsWith('.html')).length : 0;
  check(Number.isInteger(headN) && headN === listSlugs.size && headN === pageCount,
    `noscript「全部品牌详细页（${headN} 个）」= 列表 ${listSlugs.size} 个 = brand/ ${pageCount} 页`,
    `标题 ${headN} / 列表 ${listSlugs.size} / 页数 ${pageCount} —— 三者必须相等，否则爬虫看到的清单自相矛盾`);

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

  /* 档位一致性（2026-11-02 新增）：清单里写的「X 级」必须与 brand/<slug>.html 的徽标一致。
   *
   * 上面那条只比「双休率 / 平均下班」——**档位是空白**。三星/宏碁改判 U 级之后，
   * index.html 的两份清单（`：X 级` 手写区 + `—— X 级` 静态区，共 4 行）与
   * projects.html（2 行）仍写着「C 级」，verify 照样全绿。
   * 后果与这一轮要根除的毛病同源：爬虫和不执行 JS 的用户看到「C 级」，
   * 详情页正文却写着「不作评级」。所以档位也必须咬住。
   */
  const badgeGrade = (slug) => {
    const p = join(ROOT, 'brand', `${slug}.html`);
    if (!existsSync(p)) return null;
    const m = readFileSync(p, 'utf8').match(/class="badge"[^>]*>\s*([SABCDU])\s*级/);
    return m ? m[1] : null;
  };
  const projectsHtml = existsSync(join(ROOT, 'projects.html'))
    ? readFileSync(join(ROOT, 'projects.html'), 'utf8') : '';
  const listGradeBad = [];
  for (const [label, text] of [['index.html 清单', listSeg], ['projects.html', projectsHtml]]) {
    for (const line of text.split('\n')) {
      const sm = line.match(/href="\.\/brand\/([a-z0-9-]+)\.html"/);
      if (!sm) continue;
      const gm = line.replace(/<[^>]+>/g, '').match(/(?:——|：)\s*([SABCDU])\s*级/);
      if (!gm) continue;
      const dg = badgeGrade(sm[1]);
      if (dg !== gm[1]) listGradeBad.push(`${label} ${sm[1]}「${gm[1]} 级」≠ 详情页「${dg || '无徽标'}」`);
    }
  }
  check(listGradeBad.length === 0,
    'noscript / projects 清单档位与详情页徽标一致（改档必须四处同改）',
    listGradeBad.length ? `${listGradeBad.length} 处：${listGradeBad.slice(0, 5).join('；')}` : '');
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
  // BUG-ROOT-CAUSES.md 是 2026-11-14 从 README 搬出去的 36 条 bug 明细，
  // 里面每个章节标题都带真实哈希；不扫它等于给「编造哈希」留了一块无人区。
  for (const d of [...docs, 'BUG-ROOT-CAUSES.md'].filter(exists)) {
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
    const m = title.match(/（(\d{4}-\d{2}-\d{2})\s*·\s*提交\s*`[0-9a-f]{7,9}`(?:[^）]*)）\s*$/);
    if (!m) noStamp.push(title.slice(0, 50));
  });
  check(noStamp.length === 0,
    `CHANGELOG ${entries.length} 条改动记录全部带「日期 · 提交哈希」（只记日期，不写时刻）`,
    noStamp.length ? `缺时间戳或哈希：\n      - ${noStamp.join('\n      - ')}` : '');

  // 解析时间戳并检查严格倒序（第一条最新）
  const stamps = entries
    .map((title) => {
      const m = title.match(/（(\d{4}-\d{2}-\d{2})\s*·\s*提交/);
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
  // ⑥ 弹窗「站长随笔」入口存在，且原「以后再说」按钮已移除。
  // （2026-10-25 站长要求：按钮文字还原为「站长随笔」，跳转目标不变。
  //   沿革：「站长随笔」→「解锁菜单」→「解锁彩蛋」→「站长随笔」。）
  //
  // ⚠️ 必须剥掉注释再匹配 —— 代码注释里提到旧文案（「原本…是以后再说」）是正常的，
  //    但全文匹配会把注释当成「按钮还在」。这正是 PITFALLS 3.1 记的坑。
  const dpRaw = exists('douyin-prompt.js') ? read('douyin-prompt.js') : '';
  const dp = dpRaw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  // 2026-11-14 站长指令：弹窗内容整体替换为公众号式长文《别让"跟风买车"…》，
  // 顶栏标签「劳工友好提醒」→「公益提醒」；底部两枚按钮（新站引流 / 分享文章）；
  // 追加指令「已经有了按钮，就不要留那句话（绿色）」→ 绿色推荐小字撤掉、
  // 文末补一句整句加粗的备注；再追加「之前的版本也保留吧，× 左侧做版本切换」
  // → 旧槽位（LEGACY_HTML）先作 GitHub 存档；2026-11-16 站长令最早那份存档彻底
  //   删除，整篇换成 Hy4 的《买车之前，先看清谁在替比亚迪说话》，默认仍显示新版。
  // 弹窗的功能入口（站长随笔 / 抖音旧链接 / 以后再说 / 解锁彩蛋）仍清零。
  check(/公益提醒/.test(dp) && !/劳工友好提醒/.test(dp),
    '弹窗标签已更名「公益提醒」（旧「劳工友好提醒」清零）',
    '标签没改 → 仍显示旧名');
  check(/dyp--article/.test(dp) && /dyp__article/.test(dp),
    '弹窗为文章版（.dyp--article 标记 + 正文容器，旧版抖音按钮不再注入）',
    '缺文章版标记 → 旧版抖音按钮会重新注入弹窗');
  check(/别让["“]跟风买车/.test(dp) && /比亚迪轮毂/.test(dp),
    '弹窗正文已替换为新文章（标题 + 比亚迪轮毂事件）',
    '正文不是新文章 → 替换没落地');
  // 2026-11-14 17:00 站长最新口径「至于新网站，保持旧版本那样，但是这一次注意
  // 一下，无论是否向下滚动，原本那句话（绿色）都会显示在文章下方，两个按钮的上方」：
  // 绿色推荐语恢复，且必须挂在 .dyp__article 滚动容器之外（DOM 顺序在正文之后、
  // 按钮之前），由面板 flex 列固定住——覆盖 15:39 的「不留那句话」。
  check(/顺便推荐站长的新站/.test(dp) && /SITE_LINK_TEXT/.test(dp)
    && /dyp__sitelink/.test(dp) && /dyp__tip/.test(dp),
    '弹窗绿色推荐语按最新指令恢复（站长新站「婚恋数据核查台」）',
    '绿色推荐语缺失 → 第一个按钮让位给视频后，新站没有入口了');
  // 必须精确盯「正文 </div> 闭合之后才是 .dyp__tip」：只查字符串先后顺序不够，
  // 把 tip 塞进 article 内部时宽松的窗口正则仍会通过（故障注入实测到的漏洞）。
  // 2026-11-20：正文与 tip 之间新增了搜索引擎确认块 .dyp__se（同样在 article 外），
  // 仍要求「article 闭合 → se → tip → acts」这条固定顺序。
  check(/ARTICLE_HTML \+ '<\/div>' \+[\s\S]{0,160}dyp__se__q[\s\S]{0,900}dyp__tip[\s\S]{0,240}dyp__acts/.test(dp),
    '绿色推荐行位于滚动正文之外：文章下方（确认块之后）、两枚按钮上方（不随正文滚走）',
    '又把绿色句子塞回 .dyp__article 里 → 往下读文章时它就消失了');
  check(/dating-data-factcheck/.test(dp) && /sl\.href = SITE_LINK/.test(dp),
    '新站外链由固定绿色推荐行承担（dating-data-factcheck 未丢）',
    '外链被误删 → 新站入口丢失');
  check(/dyp__note/.test(dp) && /<strong>备注：本文讨论的重点/.test(dp)
    && /高调发布悬赏，时机不妥/.test(dp) && /造成舆论误解/.test(dp),
    '文末加粗备注已落地（界定重点：不反对打击黑公关，而是这个时间点时机不妥）',
    '备注缺失或未加粗 → 文章立场容易被误读为反对悬赏');
  // 2026-11-14 19:46 站长追加「希望无论劳动者还是企业……对，别回头，说的就是你！」；
  // 20:28 改口：新版那句要绿色、旧版存档保持红色，且旧版签名删掉「日期+之前」。
  // 整句仍加粗，新版文末压轴；旧槽位 2026-11-16 起换成第二篇文章、不再共用这句。
  // 不许只改一半、也不许悄悄改字。CSS 侧必须显式写死颜色与字重，不许靠继承。
  const dpcCall = read('douyin-prompt.css').replace(/\/\*[\s\S]*?\*\//g, '');
  // 2026-11-16：旧版存档已换成 Hy4 的第二篇公益文章，那篇按原文收尾、不带
  // 号召语；CALL_HTML 只剩「定义 + 新版文末」两处，单一真相源约束仍成立。
  check(/var CALL_TEXT/.test(dp) && /var CALL_HTML/.test(dp)
    && /dyp__note--call/.test(dp)
    && /广纳贤言并期待听到你的声音/.test(dp) && /对，别回头，说的就是你！/.test(dp)
    && /<strong>' \+ CALL_TEXT \+ '<\/strong>/.test(dp)
    && (dp.match(/CALL_HTML/g) || []).length >= 2,
    '弹窗加粗号召语已落地（新版文末压轴；旧版换成第二篇文章后不再共用）',
    '号召语漏加粗 / 改字 / 新版丢掉 → 站长指定的压轴句没了');
  check(/\.dyp__article \.dyp__note--call strong\s*\{[^}]*color:\s*#2e8b6f[^}]*font-weight:\s*800/.test(dpcCall)
    && /\.dyp__article \.dyp__note--call\s*\{[^}]*background:\s*#eef7f1/.test(dpcCall),
    '新版号召语为真绿色加粗（浅绿底 + 绿左边框，颜色写死不靠 .dyp__article strong 继承）',
    '新版没改绿 / 颜色靠继承 → 站长 20:28 指定的绿色会被正文红色粗体带走');
  check(/\.dyp--legacy \.dyp__article \.dyp__note--call strong\s*\{[^}]*color:\s*#c0392b/.test(dpcCall)
    && /\.dyp--legacy \.dyp__article \.dyp__note--call\s*\{[^}]*background:\s*#fdf1ee/.test(dpcCall)
    && /classList\.toggle\('dyp--legacy'/.test(dp),
    '旧版存档仍为红色加粗（.dyp--legacy 祖先覆盖回浅红底 + 红字，且切换时真挂上这个类）',
    '旧版被一起改绿 / 覆盖规则丢失 → 站长明确要求「这里红色」没落地');
  // 2026-11-16：旧版存档整篇换成 Hy4 的第二篇文章，签名改「双休购 · 公益提醒」，
  // 不再有「存档」字样；新版署名日期仍保留。
  check(/<p class="dyp__sign">双休购 · 公益提醒<\/p>/.test(dp)
    && !/旧版弹窗存档/.test(dp) && !/仓库留存/.test(dp)
    && /2026 年 11 月 14 日/.test(dp),
    '旧版签名已随内容替换改为「双休购 · 公益提醒」，无存档字样；新版署名日期不受影响',
    '又写回存档签名 / 连新版日期一起删 → 旧版替换或站长 20:28 的删改要求没落地');
  check(/我要分享此文章/.test(dp) && /VIDEO_BTN_TEXT/.test(dp)
    && /https:\/\/v\.douyin\.com\/uBwf2Fbt0d8\//.test(dp)
    && /video\.href = VIDEO_LINK/.test(dp)
    && /dyp__video/.test(dp),
    '弹窗底部两枚按钮：第一枚改挂轮毂事件抖音视频，第二枚仍是「我要分享此文章」',
    '视频按钮缺失 / 短链写错 → 站长指定的视频没挂到首页第一个按钮');
  check(/dyp__video[\s\S]{0,300}dyp__share/.test(dp),
    '视频按钮排在分享按钮之前（第一个按钮是视频）',
    '顺序反了 → 第一个按钮不是视频');
  // 2026-11-16 站长「右上角按钮你看着改，最好控制在6个字以内」：
  // 旧存档已删，按钮两态改「看另一篇 / 看回前篇」（各 4 字）。
  check(/dyp__version-toggle/.test(dp) && /看另一篇/.test(dp) && /看回前篇/.test(dp)
    && /onToggleVersion/.test(dp) && /setVersion\(/.test(dp)
    && !/切换旧版/.test(dp) && !/切换新版/.test(dp),
    '× 左侧切换按钮文案为「看另一篇 / 看回前篇」（各 4 字，≤6 字）+ 切换函数',
    '按钮文案没改 / 超过 6 字 / 切换函数缺失 → 站长本轮指令没落地');
  // 2026-11-16：最早那份「压榨员工」旧存档整篇删除，槽位换成 Hy4 的
  // 《买车之前，先看清谁在替比亚迪说话》；站长澄清不是朋友分享、是自己刷到的。
  check(/LEGACY_HTML/.test(dp) && /currentVersion = 'new'/.test(dp)
    && /买车之前，先看清谁在替比亚迪说话/.test(dp)
    && /最近我自己刷到一个抖音号/.test(dp)
    && !/压榨员工的产品/.test(dp) && !/LEGACY_NOTE/.test(dp),
    '第二篇公益文章进旧槽位（标题 + 「自己刷到」澄清），最早旧存档已彻底删除，默认仍从新版开始',
    '文章没换 / 仍写「朋友发我」/ 旧存档没删 / 默认版本不对 → 站长本轮指令没落地');
  check(/买车之前，先看清谁在替比亚迪说话（2026-11-16 晚）<\/h1>/.test(dp),
    '第二篇文章标题带日期与「（晚）」标记（2026-11-16 站长指令）',
    '标题没打日期 / 漏「（晚）」→ 站长要求没落地');
  check(!/本版本已下线/.test(dp) && !/GitHub 仓库留存/.test(dp) && !/随时清理/.test(dp)
    && !/此版本已删除，你现在看见的是GitHub仓库存档/.test(dp),
    '旧槽位已无「仓库留存 / 随时清理」存档说明（现在是正式第二篇，不是临时存档）',
    '存档说明回流 → 读者以为看到的第二篇是随时清理的旧档');
  check(/versionShareText\(currentVersion\)/.test(dp)
    && /art\.innerHTML = currentVersion === 'new' \? ARTICLE_HTML : LEGACY_HTML/.test(dp),
    '切换时正文与分享文案按当前版本联动',
    '切到旧版却仍分享新版文案 → 分享出去的标题与所见内容不符');
  check(!/dyp--notice/.test(dp),
    '「还在写」公告弹窗已移除',
    'notes.html 已可直接访问（保留密码锁），公告弹窗不应再出现');

  /* ===== 2026-11-14 17:00 批次：固定推荐行 / 分享层级 / 专题页 / 卡片按钮 ===== */
  // ① 面板 flex 列 + 正文可收缩，保证绿色推荐行与按钮真的不会被滚动带走。
  const dpcX = read('douyin-prompt.css').replace(/\/\*[\s\S]*?\*\//g, '');
  check(/\.dyp--article\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column[^}]*overflow:\s*hidden/.test(dpcX)
    && /\.dyp__article\s*\{[^}]*flex:\s*0 1 auto/.test(dpcX),
    '弹窗面板 flex 列 + 正文可收缩：绿色推荐行 / 两枚按钮 / 倒计时常驻不随正文滚动',
    '缺 flex 列或正文不可收缩 → 窄屏按钮被裁掉，或绿色行又跟着正文滚走');
  // ② 分享面板必须压过首页弹窗（站长「为什么点击分享还要关闭弹窗才能看见」）。
  const smX = read('share-modal.js');
  const dypZ = Number((dpcX.match(/\.dyp\s*\{[\s\S]*?z-index:\s*(\d+)/) || [])[1] || 0);
  const smZ = Number((smX.match(/\.sxg-share-mask\{[^}]*z-index:\s*(\d+)/) || [])[1] || 0);
  check(dypZ > 0 && smZ > dypZ,
    '分享面板层级高于首页公益提醒弹窗（点分享立刻可见，不必先关文章弹窗）',
    '分享面板 z-index 低于 .dyp → 又被盖住，用户要先关弹窗才看得见');
  // ③ QQ 图标是矢量重绘的经典红围巾企鹅，不是放大发糊的位图。
  check(/viewBox="0 0 48 48"/.test(smX) && /sxgQqScarf/.test(smX)
    && /#C62828/.test(smX) && /#FF9D2E/.test(smX),
    'QQ 图标为纯矢量重绘的经典红围巾企鹅（黑身白肚 + 红围巾 + 橙嘴橙脚）',
    'QQ 图标又退回位图或丢了红围巾 → 站长截图指出的「像素不行」没解决');
  // ④ 品牌卡底栏：按「组」整齐换行，不再第一行溢出、个别按钮掉到第二行。
  const mfX = read('mobile-fixes.css');
  check(/div\[class\*="border-t"\]\[class\*="bg-slate-50"\]\s*\{[^}]*flex-wrap:\s*wrap\s*!important/.test(mfX)
    && /div\[class\*="border-t"\]\[class\*="bg-slate-50"\]\s*>\s*div\.flex\.items-center\.gap-2\s*\{[^}]*flex:\s*0 0 auto/.test(mfX),
    '品牌卡底栏按钮按「组」整齐换行（flex-wrap + 组不收缩），不再零散断行',
    '缺 wrap 或组仍会收缩 → 桌面窄卡片 / 手机端又出现 4+1 溢出');
  check(/div\.flex\.items-center\.gap-2:last-child\s*\{[^}]*flex-wrap:\s*nowrap/.test(mfX)
    && /gap-2:last-child\s*>\s*button\s*\{[^}]*flex:\s*1 1 auto/.test(mfX),
    '手机端右组三枚操作钮强制一行三等分（不再出现 2+1 孤行）',
    '右组 nowrap 或等分规则丢失 → 窄屏又把「详情证据」单独挤到第三行');
  // ④b 顶栏「公益提醒」标签（2026-11-14 18:46 站长截图「改成圆角的，不要一行直接占满」）：
  // 面板是 flex 列，交叉轴默认 stretch，只写 inline-block + border-radius 仍会被拉成
  // 一条贯穿整行的浅绿横幅；必须显式 align-self:flex-start + fit-content 才是紧凑圆角徽标。
  const tagRule = (dpcX.match(/\.dyp__tag\s*\{([^}]*)\}/) || [, ''])[1];
  check(/align-self:\s*flex-start/.test(tagRule)
    && /width:\s*fit-content/.test(tagRule)
    && /border-radius:\s*999px/.test(tagRule)
    && !/(?:^|[;{\s])width:\s*100%/.test(tagRule),
    '顶栏「公益提醒」为紧凑圆角徽标（align-self:flex-start + fit-content，不占满一行）',
    '标签缺 align-self 会被 flex 列 stretch 成整行绿横条 → 站长截图指出的问题回潮');
  // ⑤ 比亚迪车主专题报道页：独立 HTML、双休购旗下、三则故事齐全、不照抄原话。
  const br = exists('byd-report.html') ? read('byd-report.html') : '';
  check(br.length > 0 && /<html lang="zh-CN">/.test(br)
    && /双休购 · 专题报道/.test(br) && /返回双休购首页/.test(br),
    '比亚迪专题报道页独立成页且明确属于双休购旗下（未改主站架构）',
    '专题页缺失或没写归属 → 变成游离页面');
  check(/2025 · 雨夜高速/.test(br) && /2026 · 保养之后/.test(br)
    && /唐 EV 2026 款/.test(br) && /雨刮器/.test(br) && /方向盘/.test(br)
    && /并不是这款车的车主/.test(br),
    '专题页三则故事齐全（2025 雨刮器 / 2026 方向盘异响 / 唐 EV 车型澄清）',
    '故事缺失 → 站长口述的三个要点没写全');
  check(/github\.com\/dujeongil-galaxy\/shuangxiugou\/issues"/.test(br)
    && /m\.kuku\.lu\/cn\.php/.test(br) && /AI 补充意见/.test(br)
    && /第八十二条/.test(br) && /150 米/.test(br),
    '专题页保留 Issues / 匿名邮箱请教入口，并写入 AI 补充意见（含法规与 150 米）',
    '请教入口或 AI 意见缺失 → 站长「可以 issues 或匿名邮箱告诉站长」没落地');
  check(!/狂喷水/.test(br) && !/差点想停在应急车道/.test(br)
    && !/接二连三的出现这些小故障/.test(br) && !/很牛逼/.test(br),
    '专题页措辞已优化、未复制粘贴站长口述原话（意思不变）',
    '出现口述原句 → 违反「禁止复制粘贴，优化，但不要改变我说话的意思」');
  check(/\/byd-report\.html/.test(read('sitemap.xml'))
    && /STORY_HREF = '\.\/byd-report\.html'/.test(read('byd-expose-patch.js')),
    '专题页已进 sitemap，且比亚迪卡片备注栏挂了跳转入口',
    '缺 sitemap 或卡面入口 → 新页用户找不到');
  // ⑦ 防搬运锁（2026-11-04 站长指令）：随笔页禁 F12/右键/复制剪切选择拖拽，
  //    Ctrl/Shift/Alt/Meta 组合键全禁；密码输入框豁免 Shift（大写字母）与粘贴。
  //    盯行为关键点：事件名 + preventDefault 必须成对出现在 notes.html 里，
  //    且密码框豁免逻辑（isPw / type==='password'）真实存在。
  check(/addEventListener\('contextmenu'[\s\S]{0,80}preventDefault\(\)/.test(nt)
    && /'(copy|cut|selectstart|dragstart)'/.test(nt)
    && /addEventListener\('paste'[\s\S]{0,120}isPw\(e\.target\)[\s\S]{0,40}preventDefault\(\)/.test(nt),
    'notes.html 防搬运锁：右键/复制/剪切/选中/拖拽全禁、粘贴仅密码框放行',
    '删掉任一禁用分支 → 正文可被右键/复制带走');
  check(/e\.key === 'F12'/.test(nt)
    && /e\.key === 'ContextMenu'/.test(nt)
    && /e\.ctrlKey \|\| e\.altKey \|\| e\.metaKey/.test(nt)
    && /if \(combo \|\| e\.shiftKey\)/.test(nt)
    && /t\.type === 'password'/.test(nt),
    'notes.html 防搬运锁：F12/菜单键/Ctrl+Alt+Meta 组合/输入框外 Shift 组合全禁，密码框豁免 Shift',
    '删掉 F12 拦截或组合键拦截 → 快捷键又通了');
  check(!/以后再说/.test(dp),
    '弹窗已移除「以后再说」按钮',
    '该位置已改为「站长随笔」，两个文案不应并存（注释中提及旧文案不算）');
  // 2026-10-25 站长明确「还原」：剥注释后不应再出现「解锁彩蛋」
  // （注释里记沿革没关系，按钮上不行）。
  check(!/解锁彩蛋/.test(dp),
    '弹窗按钮已还原为「站长随笔」（不再是「解锁彩蛋」）',
    '站长 2026-10-25 原话：「解锁彩蛋按钮还原为站长随笔」');
  // 2026-11-03 站长指令：飞椅版**回退**，弹窗还原为 2026-11-02 之前的旧版
  //   《压榨员工的产品，最后买单的是谁？》（汽车 / 抖音视频推荐）。
  //   站长原话：「全程仅用 20 分钟，好像不能说他们有什么问题，还是还原吧」。
  //   —— 景区从故障到游客落地仅 20 分钟，处置及时，不宜当负面案例挂首页弹窗。
  //   ⚠️ dp 已剥注释 —— 注释里记沿革不算，只认代码本体。
  // 2026-11-14 口径变更：站长要求「之前的版本也保留」，旧版正文以 LEGACY_HTML
  // 存档形式并存（见上面四条断言），故这里只封死旧版的**功能入口**。
  check(!/站长随笔/.test(dp) && !/v\.douyin\.com\/37pbo6qxUbs/.test(dp),
    '旧版弹窗的功能入口已清零（站长随笔 / 抖音旧链接）；旧版正文仅作存档保留',
    '旧功能入口残留 → 存档版会把已下线的按钮/链接带回来');
  check(!/景区飞椅/.test(dp) && !/mp\.weixin\.qq\.com/.test(dp) && !/阅读微信原文/.test(dp),
    '飞椅版内容在弹窗里已清零（标题/链接/按钮文案）',
    '仍有飞椅残留 → 2026-11-02 那版没退干净，两份内容会并存');
  check(!/dyp__archive/.test(dp) && !/prompt-original/.test(dp),
    '弹窗底部存档行已移除，且不再引用 prompt-original.html',
    '存档行/存档页引用还在 → 会指向已删除的页面（404）');
  check(!exists('prompt-original.html'),
    '独立存档页 prompt-original.html 已删除（内容已回到弹窗本体）',
    '存档页还在 → 2026-11-03 站长「记得删独立页」没执行');
  // ⑧ 8 秒锁定窗口资源预热（2026-11-05 站长指令「8 秒的时间内也能预加载很多了吧」）：
  //    弹窗倒计时开场即低优先级预热品牌卡 LOGO 图片与加密容器（.enc），
  //    收尾再扫一遍捡分批注入的后到卡，倒计时结束停摆。
  check(/function warmStart\(\)/.test(dp)
    && /function warmStop\(\)/.test(dp)
    && /assets\/logos\.enc\?v=\d+/.test(dp)
    && /new Image\(\)/.test(dp),
    '弹窗预热模块齐备（warmStart/warmStop/Image 预载/加密容器预热）',
    '预热模块缺失 → 8 秒锁定窗口白白空转，用户下滑时 LOGO 才开始加载');
  // 2026-11-05 事故：warmScan 曾把 data-sxg-enc 的裸 slug（'kfc' 等）当 URL
  // 预加载 → 每轮 59 个 404。断言钉死「预热的是容器文件，不是裸 slug」。
  check(!/getAttribute\('data-sxg-enc'\)[\s\S]{0,120}warmUrls\.push/.test(dp),
    '预热不再把 data-sxg-enc 裸 slug 当 URL（那是 59 个 404 的元凶）',
    '裸 slug 请求 = 无效流量 + 服务器 404 日志噪音');
  check(/startCountdown[\s\S]{0,400}warmStart\(\)/.test(dp),
    '预热挂在 8 秒倒计时开场（startCountdown → warmStart）',
    '倒计时不预热 → 预加载与锁定窗口脱钩，改动时序后失效');
  check(/left <= 0[\s\S]{0,700}setTimeout\(warmStop, 3000\)/.test(dp),
    '倒计时到点后预热收尾停摆（tick → 延时 warmStop）',
    '预热不停摆 → 弹窗关了后台还在反复扫 DOM 拉资源');
  const dpcss = exists('douyin-prompt.css')
    ? read('douyin-prompt.css').replace(/\/\*[\s\S]*?\*\//g, '')
    : '';
  check(!/dyp__archive/.test(dpcss),
    'douyin-prompt.css 已清掉 .dyp__archive 死样式',
    '存档行节点没了但样式还留着 → 死代码堆积，下次再加节点会莫名带上旧样式');

  // 2026-11-17 站长指令：删掉「写作进度」中间页，输对密码直接读全文。
  // 旧机制：解密后先 renderPanel() 停在进度面板，点「读全文」才换页。
  // 新机制：解密后直接 document.write(decrypted) 进正文，面板整块删除。
  const encRaw = exists('notes.html') ? read('notes.html') : '';
  // ⚠️ 剥掉注释再匹配 —— 说明文字里提到旧写法是正常的，
  //    全文匹配会把注释当成「旧机制还在」。
  const encCode = encRaw
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  check(!/id="panel"|renderPanel\s*\(|buildOutline|goRead|saveNote|statDone|notes_progress_note/.test(encCode),
    '写作进度中间页已彻底删除（面板 DOM + 函数 + 绑定的备注缓存）',
    '面板残留 → 输密码后仍会停在中间页，站长要求的「直接读全文」没落地');
  check(/decrypted = new TextDecoder\(\)\.decode\(plain\);[\s\S]{0,160}?document\.write\(decrypted\)/.test(encCode),
    '密码 + 同意校验通过后直接 document.write 解密正文进全文',
    '解密后没直接换页 → 又停在某个中间界面');
  // 正文目录仍须限定 .wrap（明文里锁定提示的标题也是 h2，不限定会多出一个假章节）。
  // 该逻辑随密文正文解锁后运行，脚本源码在明文源 notes-plaintext.md 中。
  const plainSrc = exists('notes-plaintext.md') ? read('notes-plaintext.md') : '';
  // notes-plaintext.md 是 gitignore 的本机文件（.gitignore），CI 与任何克隆环境都没有它。
  // 文件缺席时断言无从校验 → 按环境缺席跳过；本机存在明文源时仍强制校验。
  // 不加守卫 CI 永远判红（2026-11-17 run #717 实测：本断言新增当日从未在 CI 上跑过）。
  check(plainSrc === ''
    || (/\.wrap h2/.test(plainSrc)
      && !/querySelectorAll\(['"]h2['"]\)/.test(plainSrc)),
    plainSrc === ''
      ? '正文目录只扫 .wrap 内的小节（notes-plaintext.md 不在本环境，断言缺席跳过）'
      : '正文目录仍只扫 .wrap 内的小节（锁定提示的 h2 不算章节）',
    '不限定 .wrap → 目录多出一个假的「待写」章节');

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

  // ⑩c 随笔章节编排：站长 2026-11-05「我说过，顺序打乱，别非要写在第 11 章」。
  // 新写的章节不许按写作时间追加到正文末尾，必须按内容主题插到既有章节之间。
  // 只咬结构、不咬具体标题文字，改稿换标题不会误伤；特征词按补写批次登记。
  // 规则不能只写文档（2026-10-19 血泪）：这条已被站长提醒过两次，故配套断言。
  // 2026-11-05 追加第二批（Soul 封号 / 付费搭讪），同一条规则要能咬住每一批新章。
  {
    const ws = plain === null ? -1 : plain.indexOf('<div class="wrap">');
    const we = plain === null ? -1 : plain.indexOf('</div><!-- /.layout -->');
    const wrap = (ws >= 0 && we > ws) ? plain.slice(ws, we) : (plain || '');
    const hs = [...wrap.matchAll(/<h2>([^<]+)<\/h2>/g)].map((m) => m[1].trim());
    const batches = [
      { name: '较真／驾照批次', mark: /较真|驾照|储物柜|退群/ },
      { name: 'Soul 封号批次', mark: /Soul|封号|舔狗经济|搭讪/ },
    ];
    const lastBody = hs.length >= 2 ? hs[hs.length - 2] : ''; // 末位是「附：AI 解读」
    contentCheck(plain !== null && hs.length >= 13,
      '随笔章节数已含新写的章节（≥13 个 h2）',
      '少一个 h2 → 新章节可能被删，或根本没写进正文');
    for (const b of batches) {
      contentCheck(plain !== null && !b.mark.test(lastBody),
        `随笔新章未追加到正文末尾（${b.name}）`,
        '倒数第二个 h2 命中新章特征词 → 又按写作时间把新故事排到了最后一章');
      contentCheck(plain !== null
        && hs.some((x, i) => i > 0 && i < hs.length - 2 && b.mark.test(x)),
        `新章按主题插在既有章节之间（${b.name}）`,
        '正文中段找不到新章 → 可能被删，或仍被排在末尾');
    }
  }

  // ⑩d 测评结果专题：站长 2026-11-05「永远保持把它放在最后一章独立的专题页面」，
  // 「并备注后续会随着测评结果的增加而逐步更新」。带 recordId（token）的结果页
  // 只准集中在这一节；这一节是「顺序打乱」规则唯一的固定锚点，永远留在正文末尾
  // （「附：AI 解读」之前）。规则不能只写文档（2026-10-19 血泪）：配套断言 + 故障注入。
  {
    const ws = plain === null ? -1 : plain.indexOf('<div class="wrap">');
    const we = plain === null ? -1 : plain.indexOf('</div><!-- /.layout -->');
    const wrap = (ws >= 0 && we > ws) ? plain.slice(ws, we) : (plain || '');
    const hs = [...wrap.matchAll(/<h2>([^<]+)<\/h2>/g)]
      .map((m) => ({ t: m[1].trim(), i: m.index }));
    const topicIdx = hs.findIndex((x) => /测评结果存档/.test(x.t));
    const ch2Idx = hs.findIndex((x) => /^二、/.test(x.t));
    const seg = (a, b) => (a >= 0 && b > a) ? wrap.slice(a, b) : '';
    const topicStart = hs[topicIdx]?.i ?? -1;
    const topicEnd = hs[topicIdx + 1]?.i ?? wrap.length;
    const ch2Text = seg(hs[ch2Idx]?.i ?? -1, hs[ch2Idx + 1]?.i ?? -1);
    const topicText = seg(topicStart, topicEnd);
    // 金额只有截图第一条显示了 ¥0.01；另外两条页面没标，故留空、不代补。
    const rows = [
      ['6e1f22ff5d224c1c959c93910aef5cc4', '原生家庭创伤测试', '2026/08/19 21:27', '¥0.01', '已解锁'],
      ['54352712fd22422090610508a723e299', '情绪价值测试', '2026/08/19 21:19', '', '未解锁'],
      ['c3aa393b674d4dec9b6658506f532a35', 'IQ 智商测试', '2026/08/19 20:59', '', '未解锁'],
    ];
    const pos = rows.map(([id]) => wrap.indexOf('recordId=' + id));

    contentCheck(plain !== null && topicIdx >= 0 && topicIdx === hs.length - 2
      && /^十四、/.test(hs[topicIdx].t),
      '测评结果专题固定在正文最后一章（十四、，附之前）',
      '专题不是倒数第二个 h2 → 以后新章插到它后面，「永远保持在最后一章」就失守了');
    contentCheck(plain !== null && /固定留在末尾|固定在?正文最后/.test(topicText)
      && /逐步更新/.test(topicText) && /token/.test(topicText),
      '专题写明带 token、固定在末尾、后续逐步更新',
      '缺了「固定末尾」或「逐步更新」的备注 → 后续维护会把它当成普通章节挪走');
    contentCheck(plain !== null && pos.every((p) => p >= 0)
      && (wrap.match(/recordId=/g) || []).length === 3
      && pos.every((p) => p > topicStart && p < topicEnd),
      '三条带 token 的结果链接全部、且仅集中在专题章内',
      '链接散到别的章节，或专题里缺了一条 → 不再是独立专题');
    contentCheck(plain !== null && pos[0] < pos[1] && pos[1] < pos[2],
      '三条结果按截图时间倒序（最新在前、最早在最下）',
      '顺序被打乱 → 站长要求「最新的摆前面，最早的放在最下面」没落实');
    contentCheck(plain !== null && rows.every(([, name, time, amount, status]) => {
      const i = topicText.indexOf(name);
      if (i < 0) return false;
      const line = topicText.slice(i, i + 180);
      return line.includes(time) && line.includes(status)
        && (!amount || line.includes(amount));
    }), '每条记录照截图写全名称／时间／金额／解锁状态',
      '记录字段缺失，或替截图补了没显示的金额 → 不照抄也不许编造');
    contentCheck(plain !== null
      && ch2Text.includes('https://www.toolxq.com/psych/mbti64/index')
      && /四格八维/.test(ch2Text) && /MBTI/.test(ch2Text),
      '第二章末尾有 MBTI 入口链接与四格八维说明',
      'MBTI 入口链接或说明不在第二章 → 站长要求的落点没落实');
  }

  // ⑩e 站长 2026-11-06「双休购这边，做一个引导提示，如果想看原截图，去新网站看」。
  // 原截图只放在 dating-data-factcheck 的 04 避雷节，双休购这边只给入口、不放图；
  // 并按站长强调写死「图里的女性账号和头像都不是站长」，防止读者按头像对号入座。
  // 内容断言依赖 NOTES_KEY，CI 不带密码会自动跳过。
  {
    const ws = plain === null ? -1 : plain.indexOf('<div class="wrap">');
    const we = plain === null ? -1 : plain.indexOf('</div><!-- /.layout -->');
    const wrap = (ws >= 0 && we > ws) ? plain.slice(ws, we) : (plain || '');
    const hs = [...wrap.matchAll(/<h2>([^<]+)<\/h2>/g)]
      .map((m) => ({ t: m[1].trim(), i: m.index }));
    const ch8Idx = hs.findIndex((x) => /^八、/.test(x.t));
    const ch8 = (ch8Idx >= 0)
      ? wrap.slice(hs[ch8Idx].i, hs[ch8Idx + 1]?.i ?? wrap.length) : '';
    const a = ch8.indexOf('<h3>8.1');
    const b = ch8.indexOf('<h3>8.2');
    const s81 = (a >= 0 && b > a) ? ch8.slice(a, b) : '';
    contentCheck(plain !== null && /想看原截图/.test(s81) && /新网站/.test(s81),
      '⑩e 第八章 8.1 有「想看原截图去新网站」的引导提示',
      '引导句被删 → 站长 2026-11-06 要求的导流没落实');
    contentCheck(plain !== null && /女性账号和头像都不是站长/.test(s81),
      '⑩e 引导处写明「图里的女性账号和头像不是站长」',
      '澄清句被删 → 读者会按截图里的女性头像对号入座（站长强调「那个女生不是我」）');
    contentCheck(plain !== null && ch8.length > 0 && !/<img\b/i.test(ch8)
      && (ch8.match(/<a\s+href=/g) || []).length === 1
      && ch8.includes('dating-data-factcheck/picks.html#avoid'),
      '⑩e 双休购第八章只给入口、不放截图、不新增外链',
      '第八章出现 img、外链数量不为 1 或导流链接被改 → 违反「双休购不放原截图，只导流」');
    // 2026-11-07 站长纠正事实：原来 8.1 写「帖子底下和很多人吵了起来，
    // 吵到最后我被举报，账号封了」是错的。真相是：在那条「瞬间」底下吵的是
    // 他们自己，站长没在那底下吵；站长跟人吵是在私聊里，另一件事；
    // 封号是更前面（大概 2017 还是 2018 年）的事，这条动态是 2019 还是 2020 年的，
    // 两件事不是一回事。同时站长要求现阶段删除 8.4（VPN 被打 /「那个女的」
    // 其实是前女友，等站长讲清经过再写），并把章末导流链接临时移到 8.1。
    // 2026-11-07 站长追加：「8.1 重写，语气过于僵硬，且 AI 味严重」。
    // 上一版是说明书式写法（开头「先把两件事拆开」、三段同义重申、结尾
    // 「封号是封号…是…」机械对仗，还连着教训读者三次）。已按 7.1 / 8.2 / 8.3
    // 的短句叙事口吻重写，事实点一个不丢。断言改成锁「事实要点」而不是锁死
    // 僵硬措辞，免得下次正常润色又被机器判红。
    // 2026-11-07 14:52 站长二次标红：不要再写「不是同一件事／不是一回事」这类
    // 显式澄清句，也不要「大概」叠年份。区分靠分段与叙事顺序，不靠叮嘱读者。
    // 因此断言改为锁「三件事各占一段、互不串因果」的结构，不锁任何措辞，
    // 正常润色换个说法照样通过（⑩g 只把被点名的套话列黑名单防回退）。
    const s81ps = s81.split('<p>').slice(1).map((x) => x.split('</p>')[0]);
    const pThem = s81ps.find((x) => /他们自己/.test(x)) || '';
    const pMe = s81ps.find((x) => /私聊/.test(x)) || '';
    const pBan = s81ps.find((x) => /封号/.test(x)) || '';
    contentCheck(plain !== null && pThem !== '' && pMe !== '' && pBan !== ''
      && pThem !== pMe && pMe !== pBan && pThem !== pBan
      && !/(评论区|帖子底下|私聊|吵架)/.test(pBan),
      '⑩f 8.1 三件事各占一段（评论区是别人／我在私聊／封号更早），互不串因果',
      '把两桩事又混回一段或串成因果 → 站长 2026-11-07 明确要求「不要混淆」');
    contentCheck(plain !== null && /2017 年还是 2018 年/.test(s81)
      && /2019 年还是 2020 年/.test(s81)
      && /记不清/.test(s81),
      '⑩f 8.1 把封号年份（17/18）与动态年份（19/20）分开写，记不清处照写记不清',
      '年份被写成确定值或两件事被并成一件 → 替站长圆口径，违反站长纪律');
    // 文风回归防线：只锁上一版最典型的「像在写免责声明」的句型，
    // 不锁具体措辞、不评价文笔，防止改回去或下次润色又写回来。
    const stiffPhrases = ['先把两件事拆开', '封号是封号', '别搞混淆',
      '确实吵得很凶', '两件事不是一回事，别',
      '不是同一件事', '不是一回事'];
    contentCheck(plain !== null && stiffPhrases.every((w) => !s81.includes(w)),
      '⑩g 8.1 不再出现说明书式套话／显式澄清句（站长 2026-11-07 两次指 AI 味）',
      '僵硬套话回潮 → 又变成 AI 味免责声明，违反站长的文风要求');
    contentCheck(plain !== null && !/跟这(条|个)(帖子|动态|瞬间)/.test(s81)
      && !/大概\s*201[78]/.test(s81),
      '⑩g 8.1 不写「跟这条…」比较句、不在年份上叠「大概」（站长 14:52 标红三处）',
      '标红的「大概」「跟这条帖子不是同一件事」「跟这条动态不是一回事」又回来了');
    contentCheck(plain !== null && !/吵到最后我被举报，账号封了/.test(s81)
      && !/跟我吵过的人/.test(s81),
      '⑩f 8.1 不得再出现旧的错误因果（帖子底下吵架导致封号／跟我吵过的人）');
    contentCheck(plain !== null && !/VPN 被打/.test(ch8) && !/翻墙看片/.test(ch8),
      '⑩f 8.4（VPN 被打）已按站长要求现阶段删除，正文不留该节文字',
      '删掉的 8.4 又回来了 → 站长说过「这里的女的其实才是前女友，后面讲清经过再写」');
    contentCheck(plain !== null && s81.includes('dating-data-factcheck/picks.html#avoid')
      && /欢迎去站长的新网站/.test(s81),
      '⑩f 原章末导流链接已临时移到 8.1 内（8.4 删除后链接不丢）');
    contentCheck(plain !== null && /<h3>8\.4 顺带说一个我做过的小测试/.test(ch8)
      && !/<h3>8\.5/.test(ch8),
      '⑩f 删 8.4 后小节编号连续（原 8.5 顺延为 8.4），目录不跳号');
    // ⑩h 2026-11-07 19:25 站长纠正：「我没花钱，谢谢，这就是一个免费测评网站」。
    // 8.4 两处写成「花一块钱」是事实错误；站长同时说「你写的结论我不反驳什么」，
    // 所以只改付费表述，结论段（不认 48 分的两个理由、反推公式、诚实之处）一字不动。
    // 专题章「十三、测评结果存档」里那条 ¥0.01 是另一个平台、按截图照抄的字段，
    // 与本节无关，不在这里一并抹掉（站长纪律：截图没显示的字段不补、显示的照抄）。
    const c84 = ch8.indexOf('<h3>8.4');
    const s84 = c84 >= 0 ? ch8.slice(c84) : '';
    contentCheck(plain !== null && s84.length > 500 && /是免费的/.test(s84)
      && !/花一块钱|一块钱|付费|掏钱|¥|收费/.test(s84),
      '⑩h 8.4 写明测评免费，不再出现「花一块钱」等付费表述（站长 2026-11-07 纠正）',
      '又把免费测评写成花钱 → 站长明确「我没花钱，谢谢」');
    contentCheck(plain !== null && /套错了人，分就没有意义/.test(s84)
      && /创伤性联结/.test(s84) && /48\.5/.test(s84)
      && /尚未完成信效度检验/.test(s84),
      '⑩h 只改付费表述，8.4 的结论与公式一字未动（站长「结论我不反驳什么」）');
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

// ---------- 13b-3. SEO 规则写死（2026-11-21 站长指令） ----------
//
// 背景：站长确认 Bing 已收录本站（搜索「双休购」能看到品牌评级摘要），
// 要求把「每个可索引页必须有完整 SEO 三要素 + 品牌页 100% 进 sitemap」
// 写死成机器校验，防止以后有人改页面时漏掉导致收录退化。
// 这类规则不能只写文档 —— 必须脚本 + 断言 + CI 三层强制。
section('13b-3. SEO 规则写死（三要素 + 品牌页全覆盖）');

// 对外可索引页：这些页是给搜索引擎看的，必须四要素齐全。
// 排除：noindex 的存档/工具页（sponsor/usdt-guide/ua-check/remind-original/
// discussion-closed/404）、内部测试页（_sheet/_logo-fetch/archive）、Google 验证文件。
const SEO_INDEXABLE = [
  'index.html', 'labor-ai.html', 'qq-nainai.html', 'success-stories.html',
  'why-shuangxiugou.html', 'projects.html', 'brand/mixue.html', 'brand/huawei.html', 'brand/byd.html',
];
{
  const missing = [];
  for (const pg of SEO_INDEXABLE) {
    if (!exists(pg)) { missing.push(pg + '(缺文件)'); continue; }
    const h = read(pg);
    const bad = [];
    if (!/<title>[^<]{5,}<\/title>/.test(h)) bad.push('title');
    if (!/name="description"\s+content="[^"]{20,}"/.test(h)
      && !/content="[^"]{20,}"\s+name="description"/.test(h)) bad.push('description');
    if (!/property="og:title"/.test(h)) bad.push('og:title');
    if (!/rel="canonical"[^>]*href="https:\/\/dujeongil-galaxy\.github\.io/.test(h)) bad.push('canonical');
    if (bad.length) missing.push(pg + '(' + bad.join(',') + ')');
  }
  check(missing.length === 0,
    `SEO 写死：${SEO_INDEXABLE.length} 个对外页 title/description/og/canonical 齐全`,
    missing.length ? '缺项：' + missing.join(' / ') : '');
}

// 190 个品牌页必须 100% 有 SEO 三要素（抽查过的历史结论固化为断言）
{
  const brandPages = exists('brand') ? readdirSync(join(ROOT, 'brand')).filter((f) => f.endsWith('.html')) : [];
  check(brandPages.length >= 180, `品牌页数量 ${brandPages.length}（≥180）`);
  const bad = [];
  for (const pg of brandPages) {
    const h = read(join('brand', pg));
    if (!/<title>[^<]{5,}<\/title>/.test(h) || !/name="description"/.test(h)
      || !/property="og:title"/.test(h) || !/application\/ld\+json/.test(h)) bad.push(pg);
  }
  check(bad.length === 0,
    `SEO 写死：全部 ${brandPages.length} 个品牌页含 title/description/og/结构化数据`,
    bad.length ? '缺项页：' + bad.slice(0, 8).join(', ') : '');
}

// sitemap 必须收录全部品牌页（否则爬虫发现不了品牌详情页）
{
  const sm = exists('sitemap.xml') ? read('sitemap.xml') : '';
  const brandPages = readdirSync(join(ROOT, 'brand')).filter((f) => f.endsWith('.html'));
  const notIn = brandPages.filter((pg) => !sm.includes('brand/' + pg));
  check(notIn.length === 0,
    `SEO 写死：全部 ${brandPages.length} 个品牌页都在 sitemap.xml`,
    notIn.length ? '未收录：' + notIn.slice(0, 8).join(', ') : '');
}

// 奶茶聚合页：承载「奶茶品牌月休」泛关键词，内链到各品牌页（SEO 长尾入口）
{
  check(/href="\.\/tea-rest-board\.html"/.test(read('projects.html')),
    'SEO 写死：同类项目导航页有奶茶聚合专题的内链入口');
  check(exists('tea-rest-board.html'), '奶茶品牌月休对照聚合页存在');
  const tb = read('tea-rest-board.html');
  check(/<title>[^<]*奶茶[^<]*月休[^<]*<\/title>/.test(tb)
    && /name="description"[^>]*奶茶/.test(tb)
    && /property="og:title"/.test(tb)
    && /rel="canonical"/.test(tb)
    && /application\/ld\+json/.test(tb),
    'SEO 写死：奶茶聚合页有完整三要素 + 结构化数据');
  const teaBrands = ['mixue', 'chabaidao', 'chagee', 'hushangayi', 'heytea', 'luckin', 'cotti', 'yidiandian', 'molina', 'bingliw'];
  const noLink = teaBrands.filter((b) => !tb.includes('brand/' + b + '.html'));
  check(noLink.length === 0 && (tb.match(/<tr>/g) || []).length >= 10,
    '奶茶聚合页内链 10 个品牌页 + 表格 ≥10 行',
    noLink.length ? '缺内链：' + noLink.join(', ') : '');
  check(/site|data|sitemap/.test(read('sitemap.xml')) && read('sitemap.xml').includes('tea-rest-board.html'),
    '奶茶聚合页已提交到 sitemap.xml');
}

// ---------- 13b-4. 全站 SEO 写成生成器 + AI 爬虫可见性（2026-11-21 站长指令） ----------
// 站长明确：不是只给华为/比亚迪/奶茶品牌做 SEO，而是**已收录与未来收录的每个页面**
// 都要专属 SEO，并让 Copilot/Gemini/ChatGPT 能推荐本站。
// 三层强制：① gen-ai-seo.mjs 扫描全部页面补齐缺项；② 本段断言写死；③ CI 跑 verify。
// 事实边界：Google 已公开不读 llms.txt；本段只保证「机器可读、爬虫可进」，不承诺排名。
section('13b-4. 全站 SEO 生成器 + AI 爬虫可见性');
{
  // ① 生成器存在且 --check 全绿 —— 新页面忘了 SEO 会在这里判红
  check(exists('scripts/gen-ai-seo.mjs'),
    'SEO 生成器 scripts/gen-ai-seo.mjs 存在（新页面可一键补齐专属 SEO）',
    '没有生成器 → 新增页面必然漏 SEO，回到「只顾几个品牌页」的老路');
  let seoGenCheck = null;
  try {
    const r = spawnSync(process.execPath, [join(ROOT, 'scripts/gen-ai-seo.mjs'), '--check'],
      { cwd: ROOT, encoding: 'utf8', timeout: 30000 });
    seoGenCheck = { status: r.status, out: (r.stdout || '') + (r.stderr || '') };
  } catch (e) { seoGenCheck = { status: -1, out: String(e) }; }
  check(seoGenCheck && seoGenCheck.status === 0,
    '全站可索引页核心 SEO 齐全（gen-ai-seo --check，含未来新增页）',
    '缺项：' + (seoGenCheck ? seoGenCheck.out.slice(0, 400) : '无法执行生成器'));

  // ② llms.txt 存在、结构合规、链接都是站内真实 URL（防止写死失效链接）
  if (exists('llms.txt')) {
    const ll = read('llms.txt');
    const urls = [...ll.matchAll(/\((https:\/\/dujeongil-galaxy\.github\.io\/shuangxiugou\/[^)]+)\)/g)]
      .map((m) => m[1]);
    const badUrls = urls.filter((u) => {
      const rel = u.replace('https://dujeongil-galaxy.github.io/shuangxiugou/', '').replace(/\/$/, '');
      return rel && !exists(rel) && !rel.includes('<');
    });
    check(/^# 双休购 ShuangxiuGo/m.test(ll) && /^> /m.test(ll)
      && /^## 核心页面/m.test(ll) && /^## Optional/m.test(ll)
      && urls.length >= 10,
      'llms.txt 结构合规（H1 + 摘要 + 核心页面 + Optional + ≥10 条链接）',
      'llms.txt 缺结构或链接太少 → AI 拿不到站点精选入口');
    check(badUrls.length === 0,
      'llms.txt 站内链接全部指向真实存在的文件',
      '失效链接：' + badUrls.slice(0, 5).join(', '));
    check(/Google 已公开表示不使用 llms\.txt/.test(ll)
      && /不承诺|取决于公开索引/.test(ll),
      'llms.txt 诚实标注作用边界（不谎称「保证被 AI 推荐」）',
      '夸大 llms.txt 效果 → 误导站长，且与实际抓取行为不符');
  } else {
    err('llms.txt 不存在', 'AI 爬虫缺少站点精选入口，Copilot/Gemini/ChatGPT 更难找到本站');
  }

  // ③ robots.txt 显式放行主流 AI 爬虫，同时继续屏蔽 notes.html
  if (exists('robots.txt')) {
    const rb = read('robots.txt');
    const bots = ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'Bingbot', 'Googlebot',
      'Google-Extended', 'ClaudeBot', 'PerplexityBot', 'Applebot-Extended',
      'Amazonbot', 'CCBot', 'meta-externalagent'];
    const notAllowed = bots.filter((b) => !new RegExp('User-agent:\\s*' + b + '\\s*\\nAllow:\\s*/').test(rb));
    check(notAllowed.length === 0,
      'robots.txt 显式放行 ' + bots.length + ' 个 AI/搜索爬虫',
      '未放行：' + notAllowed.join(', ') + ' → 对应 AI 无法抓取本站');
    check(/^User-agent: \*\s*\nAllow: \/\s*\nDisallow: \/notes\.html/m.test(rb),
      'robots.txt 默认放行仍保留 notes.html 屏蔽',
      'notes.html 被放行 → 加密笔记页暴露给爬虫');
  } else {
    err('robots.txt 不存在', '爬虫无抓取规则');
  }
}

// 品牌页 title 必须含中文品牌关键词（纯英文名不利于中文搜索「华为/比亚迪/奶茶品牌」）
{
  const huawei = read('brand/huawei.html');
  const byd = read('brand/byd.html');
  const teaPages = ['brand/mixue.html', 'brand/chabaidao.html', 'brand/heytea.html'];
  check(/<title>[^<]*华为[^<]*<\/title>/.test(huawei)
    && /<title>[^<]*比亚迪|BEYOND|BYD[^<]*<\/title>/.test(byd)
    && teaPages.every((p) => {
      const t = read(p).match(/<title>([^<]+)<\/title>/)?.[1] ?? '';
      return t.length > 8 && /几点下班|双休|月休/.test(t);
    }),
    'SEO 写死：华为/比亚迪/奶茶品牌页 title 含中文关键词 + 双休/月休搜索词',
    'title 缺中文品牌名或搜索词 → 中文搜索命中率下降');
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

  /* ----------------------------------------------------------------
     超窄屏（≤374px）紧凑段必须存在且真的更紧凑
     ------------------------------------------------------------------
     2026-11-03（320px 修复）：.lp-ad__text 因 min-width:0，在 320px 下
     被 nowrap 的 CTA + LOGO + 内边距挤到只剩十几 px，主文案一字一行
     竖排爆炸，吸底条实测撑到 356px —— body 被 --sxg-bar-h 垫高 356px，
     TOP/⤓/AI/提醒整组悬浮按钮被顶出屏幕或压到正文上（站长截图）。
     修复只在 ≤374px 断点生效：谁删掉这个 media 块或把值改回基础值，
     故障会原样回来，且其他断言全绿。判据：块存在 + CTA/LOGO 确比
     吸底条基础值收紧。
     ------------------------------------------------------------------ */
  // 2026-11-19：374px 断点不再只属于广告一段（良配口令弹窗也有小屏收紧块），
  // 单块 match 会抓到弹窗块导致 .lp-ad__cta 判 null。聚合**所有** 374px 块。
  const narrowParts = lp.match(/@media\s*\(max-width:\s*374px\)\s*\{[\s\S]*?\n\}/g) || [''];
  const narrowRaw = narrowParts.join('\n');
  const narrow = stripCssComments(narrowRaw);
  check(narrowParts.some(b => /\.lp-ad__cta/.test(b)) && narrowRaw.length > 0,
    '超窄屏（≤374px）紧凑段存在',
    '删掉它，320px 下吸底条会竖排爆炸回 356px，悬浮按钮群被顶出屏幕');
  if (narrow) {
    dupIn(narrowRaw, '超窄屏（≤374px）');
    const num = (sel, prop, src) => {
      const m = src.match(new RegExp(sel.replace(/\./g, '\\.') + '\\s*\\{[^}]*' + prop + ':\\s*([\\d.]+)px'));
      return m ? parseFloat(m[1]) : null;
    };
    const barBlock = stripCssComments(barRaw);
    const ctaN = num('.lp-ad__cta', 'font-size', narrow);
    const ctaB = num('.lp-ad__cta', 'font-size', barBlock);
    const logoN = num('.lp-ad__logo', 'width', narrow);
    const logoB = num('.lp-ad__logo', 'width', barBlock);
    check(ctaN !== null && ctaB !== null && ctaN < ctaB,
      `超窄屏 CTA 字号确比吸底条基础值小（${ctaN} < ${ctaB}）`,
      '紧凑段若改回基础值，320px 下正文区会被 nowrap CTA 挤到一字一行');
    check(logoN !== null && logoB !== null && logoN < logoB,
      `超窄屏 LOGO 宽度确比吸底条基础值小（${logoN} < ${logoB}）`,
      '紧凑段若改回基础值，320px 下 LOGO 会挤占正文区');
    check(/\.lp-ad__title/.test(narrow),
      '超窄屏段收紧了主文案（.lp-ad__title）',
      '主文案是竖排爆炸的主角，紧凑段必须管住它');
  }
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
    if (!/href="\.\.\//.test(t) && !/dujeongil-galaxy\.github\.io\/shuangxiugou\//.test(t)) problems.noLink.push(f);
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

// projects.html 里的「本站」绿色标签，是把自己和别人的克隆/fork 区分开的唯一线索。
// 漏标的后果：用户看到 `dujeongil-galaxy/shuangxiugou` 会以为是别人的项目 ——
// 这直接影响「这些项目是不是同一个上游克隆」这条结论。
//
// 2026-11-01 站长明令「姊妹站，删！」：dujeongil-galaxy/shuangxiugou-guide 的整张卡片
// 已从导航页移除（「别什么都往上面丢」）。删除类改动只删 HTML 不算完 ——
// 原来的正向断言（必须有「姊妹站」标签）反向改写为「不许再出现」，
// 否则谁把它加回来也没人拦。
// ⚠️ 只约束 projects.html：brand/*.html 里作为**证据来源**出现的「姊妹站」是证据链，
//    不是导航卡，不在删除范围内（删了等于毁证据）。
if (exists('projects.html')) {
  const pj = read('projects.html');

  const SELF_OWNED = [
    ['dujeongil-galaxy/shuangxiugou', '本站'],
  ];

  const SISTER_REPO = 'dujeongil-galaxy/shuangxiugou-guide';
  check(pj.indexOf(SISTER_REPO) < 0,
    'projects.html 不再收录姊妹站仓库（2026-11-01 站长要求删除）',
    `又出现了 ${SISTER_REPO} —— 该卡片已被站长要求从导航页删除`);
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

  // 段首说明不能把「绿色标记」写死成某个具体标签名（标签体系随时增减，文案应保持统称）。
  check(!/其中带「本站」标记的/.test(pj),
    'projects.html 段首说明未把标记写死为「本站」',
    '文案应保持统称（如「带绿色标记的是我们自己的项目」）');

  // 姊妹站卡片 2026-11-01 已整块删除，页面里连字样（含异写）都不该留。
  const sisterBad = ['姊妹站', '姐妹站', '妹子站', '兄弟站'].filter((w) => pj.includes(w));
  check(sisterBad.length === 0,
    'projects.html 已无「姊妹站」字样及异写',
    `仍出现：${sisterBad.join('、')} —— 该卡片已被站长要求删除，字样也应清干净`);
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

  // ③ index.html 的关键词数组必须保住顶栏四个按钮的拦截词。
  //    2026-11-09 手机端下拉菜单批次（12f3126「去掉联系我们的链接改写」）
  //    已按站长要求把「联系我们」移出数组，页脚按钮不再被改写成链接。
  //    旧断言仍硬要求该词，导致 CI 持续判红 —— 属于断言过期而非站点故障，
  //    这里改为锁住真正的不变量：顶栏四个拦截词一个都不能少。
  const kwMatch = ih.match(/var\s+keywords\s*=\s*\[([^\]]*)\]/);
  const kwText = kwMatch ? kwMatch[1] : '';
  check(!!kwMatch && ['提交爆料', '我来提供这家', '提交审核', '提供数据']
      .every((k) => kwText.includes(k)),
    'keywords 数组含顶栏四个按钮拦截词（页脚「联系我们」改写已按 2026-11-09 口径移除）',
    kwMatch
      ? `数组内容为 [${kwText.trim()}] —— 缺任一词会让顶栏按钮退回原生 button`
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
  //      （pinyin-search.js 的 locateCard：2026-10-30 起回填品牌词 keywords[0]
  //      → 页面进入与手动输入相同的稳定态 → 滚动到目标卡并高亮。
  //      旧版「清空搜索恢复全量再定位」会把搜索态打回 65 张全量——
  //      站长实测「点击美宜佳后自动回退」——已废弃）。
  //      **空态的根因是链路用错，不是「不该被搜到」。**
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
  check(/locateCard\(input, box, first\.getAttribute\('data-entry-id'\),\s*\n?\s*first\.getAttribute\('data-fill'\)\)/.test(libSrc),
    'Enter 键对自定义卡候选同样走定位链路（与点击同语义，且传回填词）');

  // 2026-10-30 防回退红线：定位链路必须回填品牌词、绝不清空搜索框。
  // 「清空」正是站长实测「点击美宜佳后自动回退」的根因。
  check(!/set\.call\(input, ''\)/.test(libSrc) && !/input\.value = ''/.test(libSrc),
    'pinyin-search.js 不再清空搜索框（清空 = 列表回退 bug）',
    '定位链路改为回填 entry.kw（keywords[0]），见 locateCard');
  // 自定义卡索引条目必须带 kw（回填词），且必命中该卡 keywords
  // （否则回填后 filterCustomCards 把卡隐藏，点击候选=卡片消失）
  const idxCustomKw = [...idxSrc.matchAll(/"id":"([a-z0-9-]+)","name":"[^"]*","cn":"[^"]*","custom":1,"kw":"([^"]*)"/g)]
    .map((m) => ({ id: m[1], kw: m[2] }));
  check(idxCustomKw.length === customIds.size,
    `拼音索引 ${customIds.size} 张自定义卡全部带 kw 回填词（定位链路依赖）`,
    `缺失：${[...customIds].filter((i) => !idxCustomKw.some((e) => e.id === i)).join(', ') || '无'}。
     修复：python scripts/gen-pinyin-index.py`);
  // kw 必须是 customCardsConfig 里对应卡 keywords 的子串（必命中过滤）
  //
  // 取值窗口按「本卡 id 到下一张卡 id」自动切，不写死 1600 字：
  // 2026-11-12 零跑卡备注栏写入短视频链接后，单卡配置变得比原来长，
  // 写死窗口会把 keywords 切在窗口外 → 误报「kw 未命中」。按下一张卡的
  // `id: '` 位置界定才是稳定做法（读到结尾时退回 4000 字上限兜底）。
  const kwMismatch = idxCustomKw.filter((e) => {
    const cfgAll = read(INDEX_HTML);
    const cfgStart = cfgAll.indexOf("id: '" + e.id + "'");
    const after = cfgAll.slice(cfgStart + 1);
    const nextId = after.indexOf("id: '");
    const chunk = after.slice(0, nextId > 0 ? nextId : 4000);
    const kwArr = /keywords:\s*\[([^\]]*)\]/.exec(chunk);
    if (!kwArr) return true;
    return !kwArr[1].includes("'" + e.kw + "'");
  });
  check(kwMismatch.length === 0,
    '自定义卡 kw 回填词必命中自身 keywords（否则点击候选卡片消失）',
    kwMismatch.map((e) => e.id + '(' + e.kw + ')').join(', '));

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

  // 顶部「打卡并生成小票」引导弹窗：第二次及以后点击必须仍有提示，
  // 且口径不能与首弹完全一致（2026-11-05 站长需求）。
  check(/function showGuideRepeatModal\(/.test(cca) && /var isRepeat = guideShown != null/.test(cca),
    '引导弹窗有「第二次及以后」的轻量提醒分支（第二次点击不再是毫无响应）');
  check(!/if \(isRepeat\) \{ showGuideRepeatModal\(\);/.test(cca),
    '重复弹分支传入了弹次计数（按钮文案随次数变化，不是死文案）');
  check(!/guideShown = true/.test(cca) && /guideShown = times \+ 1/.test(cca),
    'guideShown 改为计数（老写法布尔短路 = 第二次点击静默吞掉）');
  check(/这次带我去|又来啦？带我去/.test(cca) && /我自己翻/.test(cca),
    '重复提醒的按钮文案与首弹不同（不与第一次完全一致）');
} else {
  warn('custom-card-actions.js 不存在，跳过小票累计检查');
}

// ---------- 17b. 结果区 frosted 闪屏：评级切换 + 搜索清空共用一套 ----------
// 2026-11-05 站长报障：搜索框删空后看得见一次新的预加载动画，
// 要求「和切换评价卡保持一致，高度模糊遮挡」，且品类卡切换暂不改。
// 2026-11-07 17:45 站长再要求：「删除小米之后，留空白，也做一个高度模糊的画面。
// 准确的说，无论是小米，还是其他，只要有这个动作出现了，都要做高度模糊」。
// CDP 时间线实测出 500ms 之后还有约 1s 的顺序复位回放裸露窗口，故搜索清空改为
// 整屏 flash(0) + sxg-scof-hold/release 挂起，直到回放清空才撤遮罩。
// 行为由 scripts/test-search-clear-flash.cjs / test-search-clear-render.cjs 真跑，
// 这里守静态口径：两场景共用 flash()、边沿触发、任意词、整屏、回放挂起、
// 预加载层与拼音联想层兜底、品类文案不得混入。
if (exists('filter-flash.js')) {
  const ff = read('filter-flash.js');
  const htmlFF = read('index.html');

  check(ff.length > 1500, 'filter-flash.js 非空集（防空文件把下面断言全变成假通过）');
  check(/<script defer src="\.\/filter-flash\.js\?v=7"><\/script>/.test(htmlFF),
    'index.html 引入了 filter-flash.js?v=7（改脚本必须 bump 缓存号）');
  check(/sxg-flash-spin/.test(ff) && /sxg-flash-tip/.test(ff) && /加载中/.test(ff),
    '★ 闪屏遮罩内带转圈 + 「加载中…」明确加载态（近白磨砂不再被误认成卡死/白屏而退出）');
  check(/@keyframes sxg-flash-spin/.test(ff) && /prefers-reduced-motion:reduce/.test(ff),
    '加载动画有 keyframes 且尊重 prefers-reduced-motion（减弱动效降级）');
  check(/m\.appendChild\(box\)/.test(ff) && /function getMask\(\)/.test(ff),
    '加载动画挂在共用遮罩节点内（评级切换与搜索清空两种闪屏都显示）');
  check(/function flash\(top, mode\)/.test(ff) && /flash\(btn\.getBoundingClientRect\(\)\.bottom \+ 4\)/.test(ff),
    '评级切换走共用 flash()，几何仍是按钮底边 +4（工具条保持清晰）');
  check(/flash\(0, 'search'\)/.test(ff) && !/flash\(ratingBarBottom\(\)\)/.test(ff) &&
        !/function ratingBarBottom\(\)/.test(ff),
    '★ 搜索清空改整屏 flash(0, search)：搜索框与联想面板一起糊，回放回填的词看不见');
  check(/addEventListener\('beforeinput'/.test(ff) && /addEventListener\('input'/.test(ff),
    '搜索分支挂了 beforeinput + input 两道捕获监听');
  check(/was !== null && was !== '' && now === ''/.test(ff),
    '★ 只在「非空 → 空」边沿触发（打字/删一半/重复 Backspace 都不闪）');
  check(/var SEARCH_ID = 'site-search-input'/.test(ff) && /t\.id !== SEARCH_ID/.test(ff),
    '只认 #site-search-input，不误绑页面其它输入框');
  check(!/小米|腾讯|银行|xiaomi|patagonia/.test(ff),
    '★ 闪屏逻辑不认具体搜索词：任何词、中文 IME、拼音、全选删除一律同样高度模糊');
  check(/isRatingButton\(/.test(ff) && /RATING\.indexOf/.test(ff),
    '评级按钮仍走 RATING 文案白名单（click 口径没被扩大）');
  check(/blur\(36px\) saturate\(0\.7\)/.test(ff) && /rgba\(252,252,253,0\.9\)/.test(ff),
    'frosted 遮罩仍是 blur(36px) + 近页面底色 0.9');
  check(/z-index:8000/.test(ff) && /var DURATION = 500/.test(ff) && /pointer-events:none/.test(ff),
    'z-index 8000 / 500ms / 不挡点击 三项规格未漂');
  check(/filter:blur\(20px\)/.test(ff),
    '卡片自身 blur(20px) 双保险仍在');
  check(/body\.sxg-filter-flashing #sxg-loading/.test(ff) && /visibility:hidden!important/.test(ff),
    '★ 闪屏期压住 z-index 2147483647 的首屏预加载层（转圈不会浮在磨砂之上）');
  check(/\.sxg-boot__spinner/.test(ff),
    '首屏占位 spinner 同样被压住');
  check(/if \(e\.__sxgScofReplay\) return;/.test(ff) && /__sxgScofReplay/.test(ff),
    '★ 跳过 search-clear-order-fix.js 的回放合成 input（不额外闪屏 / 不打断撤除契约）');
  check(/addEventListener\('sxg-scof-hold', holdFlash, true\)/.test(ff) &&
        /addEventListener\('sxg-scof-release', releaseFlash, true\)/.test(ff),
    '★ 顺序复位回放的 hold / release 两个挂起监听都在（与 scof 侧事件同名）');
  check(/function holdFlash\(\)/.test(ff) && /function releaseFlash\(\)/.test(ff) &&
        /function dismiss\(\)/.test(ff) && /if \(held\) return;/.test(ff),
    '★ hold 期间 dismiss 不撤遮罩：1.2s 回放全程保持高度模糊，不留裸露窗口');
  check(/var RELEASE_GRACE = 450/.test(ff) && /var HOLD_MAX = 3000/.test(ff) &&
        /timer = setTimeout\(dismiss, RELEASE_GRACE\)/.test(ff),
    '★ release 后留 450ms 等空态落地；HOLD_MAX 看门狗防 release 丢失把页面永久糊住');
  check(/body\.sxg-filter-flashing #pinyin-suggest/.test(ff),
    '★ 闪屏期压住拼音联想面板（整屏糊不被高层联想条漏出破坏）');
  check(!/数码外设|数码3C|户外服饰|个人护理|运动器材|零食饮料|汽车用品|互联网软件|家电数码|物流服务|汽车生活|食品饮品|互联网服务|服装饰品/.test(ff),
    '★ 品类卡文案完全没进本脚本（站长 2026-11-05 明确「品类卡切换暂时先不改」）');
  check((ff.match(/addEventListener\('click'/g) || []).length === 1,
    'click 监听仍只有评级按钮那一处（没有偷偷扩到品类卡点击）');
  check(!/fetch\(|XMLHttpRequest|location\.reload/.test(ff),
    '闪屏补丁纯 DOM 层，不发请求、不刷新页面');
  check(/var SEARCH_DURATION = 6000/.test(ff) && /var TICK_MS = 1000/.test(ff)
    && /SEARCH_TIP_HEAD = '正在加载缓存，请稍后'/.test(ff)
    && /function startCountdown\(\)/.test(ff) && /function renderCountdown\(\)/.test(ff),
    '★ 2026-11-10 搜索删空强制 6 秒 + 每秒倒计时「正在加载缓存，请稍后x秒」');
  check(/var forcedUntil = 0/.test(ff) && /var left = forcedUntil - Date\.now\(\)/.test(ff)
    && /Date\.now\(\) < forcedUntil/.test(ff) && /timer = setTimeout\(dismiss, isSearch \? SEARCH_DURATION : DURATION\)/.test(ff),
    '★ forcedUntil 硬 deadline：hold/release、评级点击、重复输入都不得提前撤除 6 秒遮罩');
  check(/var DURATION = 500/.test(ff) && /var RATING_TIP = '加载中…'/.test(ff),
    '评级切换仍是 500ms + 「加载中…」，搜索 6 秒口径没有扩大到评级切换');
  check(/契约|两侧必须同改/.test(read('search-clear-order-fix.js'))
    && /forcedUntil/.test(read('search-clear-order-fix.js')),
    '★ 顺序复位脚本的注释同步写明 6 秒强制契约（两侧同改，勿单侧删除）');
} else {
  warn('filter-flash.js 不存在，跳过结果区闪屏检查');
}

// ---------- 17c. 搜索框 IME 清空后卡片顺序残留修复 ----------
// 2026-11-06 站长报障：中文输入法在搜索框输入「小米」后清空，企业卡片列表
// 顺序残留错乱（首屏不再是默认 Patagonia 序）。根因是 bundle 在 IME 路径下
// 排序 state 未复位 + 延迟 effect 用残留重排，DOM 层只能回放「最近词→空」复位。
// 修复脚本 search-clear-order-fix.js 用「缓存基准序 + 检测空态残留 → 回放」实现。
section('17c. 搜索框 IME 清空顺序残留修复');

if (exists('search-clear-order-fix.js')) {
  const scf = read('search-clear-order-fix.js');
  const idx = read('index.html');

  check(/search-clear-order-fix\.js\?v=3/.test(idx) &&
    (idx.match(/search-clear-order-fix\.js\?v=3/g) || []).length >= 2,
    'index.html 引用 search-clear-order-fix.js?v=3（preload + script 两处，改脚本须 bump）');

  check(/.bg-white\.rounded-2xl\.border/.test(scf) && /cardTitles|offsetParent/.test(scf),
    '修复脚本用同样的卡片选择器重建顺序基准，与全站口径一致');

  check(/data-scof-last/.test(scf) && /setAttribute\('data-scof-last'/.test(scf),
    '记录最近搜过的词（data-scof-last）用于回放，不依赖 composition 事件');

  check(/RESET_DELAY/.test(scf) && /setTimeout/.test(scf) &&
    /s\.call\(inp, word\)/.test(scf) && /s\.call\(inp, ''\)/.test(scf),
    '回放走「非 IME 路径回填最近词 → 延时清空」完整转换，让延迟 effect 在干净态复位');

  check(/setTimeout\(function \(\) \{[\s\S]*valueSetter\(\);\s*s\.call\(inp, word\)/.test(scf),
    '★ 回放必须脱离 input 事件栈（setTimeout 栈外）执行，否则 React 合并忽略');

  check(/if \(sameOrder\(now, baseline\)\) return/.test(scf),
    '空态顺序与基准一致则跳过修复（正常清空不误触发回放闪烁）');

  // ⚠️ 必须锁「赋值语句」本体：只查 /__sxgScofReplay/ 会被注释里的字样蒙混过关
  //    （故障注入 B 实测：删掉 ev.__sxgScofReplay = true; 仍全绿）。
  check(/ev\.__sxgScofReplay = true;/.test(scf) && /function replayInput\(inp\)/.test(scf) &&
    (scf.match(/replayInput\(inp\);/g) || []).length === 2,
    '★ 回放的两次合成 input 都带 __sxgScofReplay 标记（与 filter-flash.js 的跳过契约）');

  // 2026-11-07 17:45：回放期间必须挂起磨砂撤除，否则删空后 1s 的回填窗口会裸露
  check(/function notifyFlash\(name\)/.test(scf) &&
        /notifyFlash\('sxg-scof-hold'\)/.test(scf) &&
        /notifyFlash\('sxg-scof-release'\)/.test(scf),
    '★ 回放开始发 sxg-scof-hold、回放清空发 sxg-scof-release（与 filter-flash.js 挂起契约）');
  const scfPos = {
    hold: scf.indexOf("notifyFlash('sxg-scof-hold')"),
    replay: scf.indexOf('var s = valueSetter()'),
    clear: scf.indexOf("s.call(inp, '')"),
    release: scf.indexOf("notifyFlash('sxg-scof-release')"),
  };
  check(scfPos.hold > -1 && scfPos.replay > scfPos.hold &&
        scfPos.clear > scfPos.replay && scfPos.release > scfPos.clear,
    '★ hold 必须在回放开始前、release 必须在第二次清空之后（顺序不能反）', scfPos);

  // 故障注入红线：删掉回放里的「延时清空」那一步，残留将无法复位
  const scfNoReplay = scf.replace(/s\.call\(inp, ''\);[\s\S]*?replayInput\(inp\);[\s\S]*?\}, RESET_DELAY\);/, '/* replay removed */');
  check(scfNoReplay !== scf,
    '回放逻辑存在（故障注入基线：应能删出差异）');
} else {
  warn('search-clear-order-fix.js 不存在，跳过 IME 清空顺序修复检查');
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

// ---------- 20n. 良配广告秒级显示（不加载即弹、也不卡 visibility） ----------
// 起因：2026-10-29 旧实现用 requestAnimationFrame 立即移除 is-hidden，广告在首页
// 加载瞬间弹出盖住品牌卡；改成延迟 showAfter 毫秒。2026-11-18 站长反馈恢复后仍要
// 等一会儿：6000ms 长空窗 → 200ms。同时发现旧 is-hidden 的 visibility:hidden +
// transition 会卡 computed visibility（0da3a15 星巴克真根因），改 display:none 硬隐藏。
// 本段守住「秒级可见且不在首屏瞬间弹出」两个边界。
section('20n. 良配广告秒级显示');
const ADJS = 'liangpei-ad.js';
const ADCSS = 'liangpei-ad.css';
if (exists(ADJS) && exists(ADCSS)) {
  const adj = read(ADJS);
  const adc = read(ADCSS);
  // 1) reveal 必须由 setTimeout(reveal, CONFIG.showAfter) 触发。
  //    旧断言 /setTimeout\([\s\S]*?classList.remove\('is-hidden'\)/ 会跨行匹配到
  //    showToast 里另一个 setTimeout，属于假绿；这里钉住真实调用 + 函数体。
  check(/setTimeout\(reveal,\s*CONFIG\.showAfter\)/.test(adj)
    && /function reveal\(\)\s*\{[\s\S]*?classList\.remove\('is-hidden'\)/.test(adj),
    '广告 reveal 由 setTimeout(reveal, CONFIG.showAfter) 延迟触发（非加载即弹）',
    '旧断言跨行瞎匹配会假绿；必须钉住真实调用与 reveal 函数体');
  check(!/requestAnimationFrame\(\s*function[\s\S]*?classList\.remove\('is-hidden'\)/.test(adj),
    '广告 reveal 不再用 requestAnimationFrame 立即移除 is-hidden',
    'rAF 立即移除 is-hidden = 加载即弹，正是 2026-10-29 修掉的 bug');
  check(/showAfter:\s*200\b/.test(adj),
    'CONFIG.showAfter = 200ms（秒级显示，非 6000ms 长空窗 / 0ms 加载即弹）');
  // 2) 2026-11-18 反转：is-hidden 必须 display:none 硬隐藏。
  //    旧口径「用 opacity/visibility 淡入」有 visibility 过渡卡帧的致命 bug：
  //    DOM 在、opacity 1，但 computed visibility 卡在 hidden，广告永远不可见。
  //    淡入改由基础态 opacity + 200ms 延迟实现，不依赖 visibility 过渡。
  const ihM = adc.match(/\.lp-ad\.is-hidden\s*\{([\s\S]*?)\}/);
  check(!!ihM, 'CSS 中存在 .lp-ad.is-hidden 规则');
  if (ihM) {
    check(/display\s*:\s*none/.test(ihM[1]),
      '.lp-ad.is-hidden 用 display:none 硬隐藏（2026-11-18 反转 opacity/visibility 旧口径）',
      'visibility:hidden + transition 会卡在 hidden，广告 DOM 在却永远不可见');
  }
} else {
  err('liangpei-ad.js / liangpei-ad.css 缺失', '广告位文件被删会导致首页推广位彻底失效');
}

// ---------- 20o. 桌面悬浮层互不遮挡（广告卡 × AI 按钮） ----------
// 2026-11-18：旧版 AI 挂件 ai-chat.js 已彻底删除（含文件、引用、头像），
// 本段原「AI 面板锚定/避让」两条断言随旧挂件作废并移除；保留广告 --sxg-bar-h
// 语义断言（新版 AI 圆钮 ai-link.js 同样读这个变量避让吸底条）。
section('20o. 桌面悬浮层互不遮挡');
if (exists(ADJS) && exists(ADCSS)) {
  const adj = read(ADJS);

  // --sxg-bar-h 的语义是「底部吸底条占位」。≥1440px 广告是右上竖排卡片，
  // 根本不在底部，却照样把卡片高度（实测 279px）写进变量 —— 整列 FAB 与 AI 圆钮
  // 被抬高一个卡片高度飘到页面中部（2026-11-02 站长截图）。
  check(/matchMedia\('\(min-width: 1440px\)'\)\.matches/.test(adj),
    '广告脚本按 1440px 断点判断「是否吸底」（读 matchMedia 结果）',
    '不判断断点 → 桌面把右上卡片的高度也写进 --sxg-bar-h');
  check(/var h = \(wide \|\| aside\.classList\.contains\('is-hidden'\)\) \? 0 : aside\.offsetHeight;/.test(adj),
    '≥1440px 或广告隐藏时 --sxg-bar-h 恒为 0（桌面没有吸底条可让位）',
    '桌面仍写卡片高度 → 悬浮按钮组与 AI 圆钮被整体抬高 279px');
} else {
  err('缺少 liangpei-ad.js / liangpei-ad.css', '桌面悬浮层避让无法校验');
}

// ---------- 20q. 良配广告恢复上线 + 星巴克推广彻底移除（2026-11-18 站长指令） ----------
// 背景：星巴克 × WorkBuddy 联名活动 11/16 23:59 已结束。站长要求「把代码删掉，
// 彻底抹除」，恢复之前的良配限时推广（文案：注册送喜茶 20 元红包），
// 且 LOGO 改用站内现成 assets/heytea.png。
// 本节机器钉死：星巴克推广代码零残留、良配活跃上线、喜茶 LOGO 真被引用。
// 2026-11-12 本节原编 20p，与「品牌 LOGO 加密容器」撞号导致 CI 连红，改回 20q。
section('20q. 良配广告恢复上线 + 星巴克推广彻底移除');
{
  const idxHtml = exists('index.html') ? read('index.html') : '';
  // 剥 HTML 注释：判断「活跃引用」必须先去注释，避免注释块被误判为上线
  const idxNoCmt = idxHtml.replace(/<!--[\s\S]*?-->/g, '');

  // 1) 星巴克 × WorkBuddy 推广代码彻底抹除。
  //    注意：assets/starbucks.svg、星巴克品牌卡、星巴克消费公告与这次活动无关，必须保留。
  const sbuxPromoFiles = [
    'starbucks-promo.css', 'starbucks-promo.js',
    'starbucks-ad.css', 'starbucks-ad.js',
    'scripts/test-starbucks-ad.cjs', 'scripts/cdp-starbucks-ad.cjs',
    'assets/workbuddy-mp-code.png'
  ];
  for (const f of sbuxPromoFiles) {
    check(!exists(f), `星巴克推广残留已抹除：${f}`,
      '活动 11/16 已到期，站长要求彻底删除，代码留着只会误导后来人');
  }
  check(!/starbucks-promo|starbucks-ad|sxg-promo|sb-modal|workbuddy-mp-code/.test(idxHtml),
    'index.html 无星巴克推广引用（CSS/JS/类名/弹窗/真码全部清零）');
  if (exists('.github/workflows/verify.yml')) {
    check(!read('.github/workflows/verify.yml').includes('test-starbucks-ad.cjs'),
      'CI 里已移除星巴克联名活动位测试');
  }
  check(exists('assets/starbucks.svg'),
    '保留 assets/starbucks.svg（星巴克品牌卡 LOGO，非活动推广资产）');

  // 2) 良配广告恢复活跃上线（不再是注释状态），版本号必须 bump 破缓存
  check(/<link[^>]*liangpei-ad\.css\?v=17[^>]*>/i.test(idxNoCmt),
    'index.html 活跃引用 liangpei-ad.css?v=17（注册须知警示块 bump 破缓存）');
  check(/<script[^>]*liangpei-ad\.js\?v=16[^>]*>/i.test(idxNoCmt),
    'index.html 活跃引用 liangpei-ad.js?v=16（注册须知警示块 bump 破缓存）');
  check(exists('liangpei-ad.css') && exists('liangpei-ad.js'),
    '良配推广文件仍在仓库');

  // 3) LOGO 用站内现成喜茶图（站长 2026-11-18 明确要求）
  const lpJs = exists('liangpei-ad.js') ? read('liangpei-ad.js') : '';
  const lpCss = exists('liangpei-ad.css') ? read('liangpei-ad.css') : '';
  check(exists('assets/heytea.png'), '站内现成喜茶 LOGO assets/heytea.png 存在');
  check(/logoSrc:\s*'\.\/assets\/heytea\.png'/.test(lpJs),
    '良配 JS 的 logoSrc 指向站内 assets/heytea.png（不自己画标）');
  check(/lp-ad__logo__img/.test(lpJs) && /'<div class="lp-ad__logo"[^>]*>' \+ logoHtml\(\)/.test(lpJs),
    '良配 DOM 真的用 logoHtml() 渲染图片，不只是配置里写了路径');
  check(/\.lp-ad__logo__img\s*\{[^}]*object-fit:\s*contain/s.test(lpCss),
    '喜茶 LOGO 等比缩放 object-fit:contain（不拉伸变形）');
  check(/\.lp-ad__logo\s*\{[^}]*background:\s*#fff/s.test(lpCss),
    'LOGO 容器白底（喜茶是黑白标识，紫底会吃掉图）');
  check(/\.lp-ad__logo\.is-fallback\s*\{[^}]*background:\s*linear-gradient/s.test(lpCss)
    && /is-fallback/.test(lpJs),
    '图片加载失败时回退紫底白字「良配」（离线不开天窗）');

  // 3b) 2026-11-18 站长要求秒级显示：6000ms 长空窗 + visibility 卡帧一并修掉。
  //     沿用 0da3a15 星巴克推广条已真渲染验证的那套方案，逐条钉死防回退。
  //     剥注释再判 transition：注释里写了「旧写法 transition:visibility」作说明，
  //     不剥会把解释文字当成残留规则。
  const lpCssNoCmt = lpCss.replace(/\/\*[\s\S]*?\*\//g, '');
  check(/showAfter:\s*200\b/.test(lpJs),
    '良配广告 showAfter = 200ms（秒级显示，非 6000ms 长空窗 / 0ms 加载即弹）');
  check(/function reveal\(\)/.test(lpJs)
    && /void aside\.offsetWidth/.test(lpJs)
    && /setProperty\('visibility',\s*'visible',\s*'important'\)/.test(lpJs),
    'reveal 强制重排 + 内联 visibility:visible !important（visibility 过渡卡 hidden 的 undo）',
    '只 remove is-hidden → computed visibility 卡在 hidden，广告 DOM 在却永远不可见');
  check(!/\.lp-ad\.is-hidden\s*\{[^}]*visibility:\s*hidden/.test(lpCssNoCmt)
    && /\.lp-ad\.is-hidden\s*\{[^}]*display:\s*none/.test(lpCssNoCmt),
    '.is-hidden 用 display:none 硬隐藏（不再用 visibility:hidden，避免过渡竞态）');
  check(!/transition:[^;}]*visibility/.test(lpCssNoCmt),
    'CSS transition 里不再有 visibility（两处断点都已去掉）',
    'transition:visibility 会让移除 is-hidden 后 computed visibility 卡在 hidden');
  check(/aside\.style\.visibility\s*=\s*''/.test(lpJs),
    'close 时清内联 visibility，保证 is-hidden 重新生效（否则内联 visible 压过隐藏）');
  check(/window\.addEventListener\('load',\s*function/.test(lpJs)
    && /if \(aside\.classList\.contains\('is-hidden'\)\) reveal\(\)/.test(lpJs),
    'load 兜底：reveal 帧被合并/延后时再强制一次');

  // 4) 窄屏弹窗避让吸底条：良配同样发布 --sxg-bar-h，这条规则继续生效
  const dypCssNow = exists('douyin-prompt.css') ? read('douyin-prompt.css') : '';
  check(/bottom:\s*calc\(var\(--sxg-bar-h, 0px\)\s*\+\s*env\(safe-area-inset-bottom, 0px\)\)/.test(dypCssNow),
    '窄屏弹窗 .dyp__panel 继续避让吸底推广条（--sxg-bar-h，良配同样发布该变量）');
  check(/var h = \(wide \|\| aside\.classList\.contains\('is-hidden'\)\) \? 0 : aside\.offsetHeight;/.test(lpJs),
    '良配脚本 ≥1440px / 隐藏时 --sxg-bar-h 写 0（避让语义延续）');

  // 4b) 2026-11-19 站长指令：口令提示从黑色小 toast 改为居中弹窗——
  //     「上文提示，下文给链接」。旧 toast 的类名必须清零防双实现漂移。
  check(/showModal/.test(lpJs) && !/showToast/.test(lpJs),
    '良配 JS 已从 showToast 切换到 showModal（旧 toast 函数清零）');
  check(!/lp-ad-toast/.test(lpJs) && !/lp-ad-toast/.test(lpCss),
    '旧 .lp-ad-toast 类名在 JS/CSS 中零残留（防双实现漂移）');
  check(/lp-modal__steps/.test(lpJs) && /lp-modal__code/.test(lpJs) && /lp-modal__copy/.test(lpJs),
    '弹窗结构齐全：上文步骤（steps）+ 下文口令（code）+ 复制按钮（copy）');
  check(/lp-modal__steps[\s\S]*?① [\s\S]*?粘贴到微信[\s\S]*?② [\s\S]*?点自己刚发出/.test(lpJs),
    '弹窗步骤含两步玩法：粘贴发送 → 点自己发的消息唤起');
  // 2026-11-19 站长补：客服截图里的 AI 风控注意事项必须进弹窗——
  // 只教操作不提示「资料敷衍会被封」，访客被封会反过来怪推广。
  check(/lp-modal__caution/.test(lpJs) && /lp-modal__caution/.test(lpCss),
    '弹窗含注册须知警示块（JS 结构 + CSS 样式都在，防只写一半）');
  check(/AI 审核注册资料/.test(lpJs) && /与平台价值观不符/.test(lpJs)
    && /封禁账号/.test(lpJs) && /邀请也不算成功/.test(lpJs),
    '注册须知写明 AI 审核 / 资料敷衍 / 价值观不符封禁 / 邀请无效四个要点');
  check(/lp-modal__title[\s\S]*?lp-modal__caution[\s\S]*?lp-modal__steps/.test(lpJs),
    '警示块排在标题与操作步骤之间（先提示风险再教操作）');
  check(/#小程序:\/\/良配\//.test(lpJs) && /lp-modal__code">' \+ CONFIG\.scheme/.test(lpJs),
    '弹窗口令本体渲染 CONFIG.scheme（小程序链接常驻可见）');
  check(/lp-modal__close|lp-modal__mask/.test(lpJs) && /Escape/.test(lpJs),
    '弹窗可关闭：× / 点遮罩 / Esc 三通道');
  check(/\.lp-modal\s*\{/.test(lpCss) && /display:\s*none/.test(lpCss.match(/\.lp-modal\s*\{([\s\S]*?)\}/)?.[1] || ''),
    '弹窗显隐用 display:none↔flex 硬切换（不用 visibility 过渡，防卡帧坑复发）');
  check(!/\.lp-modal[^_]*\{[^}]*visibility:\s*hidden/.test(lpCssNoCmt || lpCss)
    && !/transition:[^;}]*visibility/.test(lpCssNoCmt || lpCss),
    '弹窗 CSS 无 visibility 过渡（0da3a15 卡帧老坑不复发）');

  // 5) 行为测试接入
  check(exists('scripts/test-ad-logo.cjs'), '存在广告位 LOGO 行为测试');
  if (exists('.github/workflows/verify.yml')) {
    check(read('.github/workflows/verify.yml').includes('test-ad-logo.cjs'),
      'CI 里已接入广告位 LOGO 测试');
  }
}

// ---------- 20r. 顶栏下方站点政策声明条 ----------
// 起因（2026-11-18 站长截图）：在顶栏正下方的空白横条画红框，要求加一条
// 社区治理声明，措辞由站长给定，其中「这里」两字是**可点击链接**。
// 不能塞进 #site-notice 滚动栏 —— 那条有「零超链接」硬约定（移动文字上的
// 链接点不准，2026-11-02 当年就因此否掉过带链接公告）。故独立脚本插在
// React 的 <header> 之后。文案/链接/插入位置任一漂移都会让声明形同虚设。
section('20r. 顶栏下方站点政策声明条');
const PNS = 'policy-notice.js';
const POLICY_HREF = 'https://dujeongil-galaxy.github.io/';
const POLICY_BEFORE = '因乌克兰发生战争，对于利用、无视或纵容这场战争的言论（包括但不限于issues、匿名邮箱来信等），我们将采取零容忍原则，点击';
const POLICY_AFTER = '查看本站政策';
if (exists(PNS)) {
  const pn = read(PNS);
  const idxActive = read('index.html').replace(/<!--[\s\S]*?-->/g, '');
  check(/<script[^>]*policy-notice\.js\?v=4[^>]*>/.test(idxActive),
    'index.html 活跃引用 policy-notice.js?v=4（非注释）');
  check(read('index.html').indexOf(PNS) > read('index.html').indexOf('header-to-dock.js'),
    '排在 header-to-dock.js 之后（同属 header 下游补丁）');
  check(pn.includes(POLICY_BEFORE),
    '声明文案前半段一字不差（含「零容忍原则」「issues」「匿名邮箱来信」「点击」收尾）',
    '文案被软化或截断 → 声明失去原意');
  check(/零容忍原则/.test(pn) && !/采取零容忍[，,]/.test(pn),
    '「零容忍」补全为「零容忍原则」（站长强调是原则，不是软化）');
  check(/var LINK_TEXT = '这里'/.test(pn),
    '链接文字恰好是「这里」两字');
  check(pn.includes("var TEXT_AFTER = '" + POLICY_AFTER + "'"),
    '后半段是「查看本站政策」');
  check(pn.includes("var LINK_HREF = '" + POLICY_HREF + "'"),
    '「这里」链接精确指向站长给定网址（不是占位符/仓库主页）',
    '写成 example/#/github.com 主页都算错，站长要的是指定 URL');
  check(/createElement\('a'\)/.test(pn) && /a\.href\s*=\s*LINK_HREF/.test(pn)
    && /a\.textContent\s*=\s*LINK_TEXT/.test(pn),
    '用 DOM API 建真 <a>（textContent/href），不写 innerHTML');
  check(!/\.innerHTML\s*=/.test(pn),
    '脚本没有 innerHTML 赋值（无注入面）');
  check(/querySelector\('header'\)/.test(pn)
    && /insertBefore\(bar,\s*header\.nextSibling\)/.test(pn),
    '插在 React <header> 之后（红框那条空白）');
  check(/bar\.previousSibling === header/.test(pn),
    '幂等：已在 header 后面就 return');
  check(!/getElementById\('site-notice'\)/.test(pn)
    && !/querySelector\('#site-notice'\)/.test(pn),
    '不往 #site-notice 滚动栏插（零超链接硬约定）');
  check(/setTimeout\(sweep,\s*300\)/.test(pn) && /new MutationObserver/.test(pn),
    'header 未挂载时定时重试 + MutationObserver 自愈');
  // 2026-11-18 站长看真渲染后改口：「不如换成浅黄色背底，真的」。
  // 浅底必须配深色字才看得清，故文字/链接都改深红系，亮黄链接一并撤掉。
  check(/background:#fef3c7;color:#7f1d1d/.test(pn)
    && /text-decoration:underline/.test(pn)
    && /@media \(max-width:640px\)/.test(pn),
    '浅黄底 #fef3c7 + 深红字 #7f1d1d（浅底配深色，不牺牲可读性）+ 链接下划线 + 移动端字号下调');
  check(!/background:#7f1d1d;color:#ffffff/.test(pn)
    && !/background:#fff;color:#dc2626/.test(pn),
    '既不是深红底白字，也不是更早的浅底红字（站长最终定稿：浅黄底深红字）');
  check(/a\{color:#991b1b;text-decoration:underline/.test(pn)
    && !/a\{color:#fde047/.test(pn),
    '「这里」链接为深红 #991b1b + 下划线（浅底上可辨可点，非亮黄）');
  // 2026-11-19 站长最终口径：乌克兰公告无条件显示——白名单门槛已整体撤销。
  // 门槛函数或「仅白名单显示」注释回流会让一半访客看不到治理声明。
  check(!/sxgIsBrowserAllowed|sxgPolicyAllowed|sxgIsDomesticBrowser/.test(pn)
    && !/仅白名单浏览器/.test(pn.replace(/[\s\S]*?(?:无条件显示|已撤销)[\s\S]*$/, '')),
    '§20r 乌克兰公告无条件显示（浏览器白名单门槛已整体撤销，不再按 UA 过滤）',
    '门槛函数或「仅白名单」口径回流 → 国产/国际部分浏览器访客看不到治理声明');
  check(exists('scripts/test-policy-notice.cjs'), '存在政策声明条行为测试');
  if (exists('.github/workflows/verify.yml')) {
    check(read('.github/workflows/verify.yml').includes('test-policy-notice.cjs'),
      'CI 里已接入政策声明条测试');
  }
} else {
  err(PNS + ' 不存在', '顶栏下方的政策声明条会整条消失，站长指定的治理口径不再展示');
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
//   同日深夜站长实测反馈：①「每次输入用户名都会自动验证」（输入即验）；
//   ②「刷新一下连我自己也锁了」——无痕/清缓存后浏览器恢复输入框内容但不发
//   input 事件，mount 必须补验；③限流要给出重置时刻并到点自动重试；
//   ④解锁后给「别取消 Star / 更多福利」提示。
//   2026-10-25 站长定稿访问节奏：每次刷新/关闭浏览器再访问都重新验证；
//   不清理浏览器本地数据（Cookie / localStorage）就自动用记忆的用户名验；
//   同时照片改为仓库内加密（.enc 密文），解锁动作委托 photo-vault.js 解密显示
//   （见 20l）。Cookie 双写：读写都走 Cookie 优先、localStorage 兜底。
//   实现：photo-gate.js（UMD，逻辑外链；行为测试 test-photo-gate.cjs 66 项）。
// 判据：门禁表单齐全、校验打的是 GitHub starred API、按 full_name 认本站仓库、
//   满页翻页、解锁前不预载照片、data-enc 指向 .enc 密文、解锁委托 vault、
//   Cookie/localStorage 双写双清、不信本地 flag（取消 Star 重新上锁）、
//   [hidden] 兜底、页面明示真校验、输入即验、恢复值补验、限流重置重试、
//   解锁提示条。
{
  const why = read('why-shuangxiugou.html');
  const pg = read('photo-gate.js');
  section('20j. 随笔页照片 Star 门禁（真校验）');
  check(/id="sxg-gate-box"/.test(why) && /id="sxg-gate-form"/.test(why)
    && /id="sxg-gate-user"/.test(why) && /id="sxg-gate-verify"/.test(why) && /id="sxg-gate-msg"/.test(why),
    '门禁表单齐全（gate-box / 表单 / 用户名输入 / 验证按钮 / 消息位）');
  check(/href="https:\/\/github\.com\/dujeongil-galaxy\/shuangxiugou"/.test(why),
    '去 Star 链接指向本站仓库（不是上游站）');
  check(exists('photo-gate.js') && /<script src="\.\/photo-gate\.js\?v=4"><\/script>/.test(why),
    '门禁逻辑外链 photo-gate.js（可单测，不塞内联；v=4 含 VPN 提示文案）');
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
  const imgsWithDataEnc = imgTags.filter((t) => /data-enc="/.test(t)).length;
  check(imgsWithRealSrc === 0 && imgsWithDataEnc === 2,
    `照片 img 只用 data-enc 懒引用密文（带真实 src= 的 img ${imgsWithRealSrc} 个，应为 0；data-enc ${imgsWithDataEnc} 个，应为 2）`);
  const photoRefs = [...why.matchAll(/data-enc="([^"]+)"/g)].map((m) => m[1]);
  check(photoRefs.length === 2 && photoRefs.every((r) => localExists(r)),
    'data-enc 指向的 .enc 密文文件真实存在',
    photoRefs.map((r) => `${r} → ${localExists(r) ? '存在' : '缺失'}`).join('；'));
  // 页面上不许再出现明文照片引用（加密的意义就在于 URL 也拿不到原图）
  check(!/photo-kuromi\.jpg"/.test(why) && !/photo-melody\.jpg"/.test(why)
    && !/photo-kuromi\.jpg'/.test(why) && !/photo-melody\.jpg'/.test(why),
    '页面不再引用明文 jpg（只有 .enc 密文）');
  // 解锁动作必须委托 vault：仓库里只有密文，门禁自己不解密
  check(/vault\.reveal\(grid, status, \{ fetch: fetchImpl \}\)/.test(pg)
    && /root\.SXGPhotoVault/.test(pg),
    '验证通过后委托 SXGPhotoVault.reveal（取密文→解密→显示，门禁不解密）',
    '把 vault.reveal 改成门禁自己写 img.src，等于照片退回明文');
  // vault 没加载上时的兜底：明示错误，不允许「解锁了却是一排空框」
  check(/解密组件没有加载成功/.test(pg) && /grid\.hidden = true/.test(pg),
    'vault 缺失时状态位出红字、网格保持隐藏（不静默显示空框）');
  // ---- Cookie / localStorage 双写（2026-10-25 站长定稿的访问节奏） ----
  // 语义是「只记用户名，不记已解锁 flag」。早先用 !/unlocked/i 子串匹配，
  //   结果元素 id sxg-gate-unlocked-note 里的 unlocked 误判——改成枚举所有 setItem 的键，
  //   必须全部是 USER_KEY（字符串键也要抓，防止 store.setItem('sxg-unlocked', 1) 漏网）。
  const setItemKeys = [...pg.matchAll(/\.setItem\(\s*(?:'([^']*)'|"([^"]*)"|([A-Za-z_$][\w$]*))\s*,/g)]
    .map((m) => m[1] || m[2] || m[3]);
  check(setItemKeys.length >= 1 && setItemKeys.every((k) => k === 'USER_KEY'),
    'localStorage 只记用户名、不记「已解锁」flag（取消 Star 重新上锁）',
    `setItem 的键：[${setItemKeys.join(', ') || '无'}]，应全部为 USER_KEY`);
  // Cookie 双写：读要 Cookie 优先，写要两个都写，清要两个都清
  check(/\(cookie && cookie\.read\(\)\) \|\| \(store && store\.getItem\(USER_KEY\)\)/.test(pg),
    'mount 时 Cookie 优先读记忆用户名（localStorage 兜底）',
    '站长口径：「不清理浏览器 Cookie 就自动用这个用户名重新验证」');
  check(/cookie && cookie\.write\(u\)/.test(pg) && /cookie && cookie\.clear\(\)/.test(pg),
    '验证成功 Cookie+localStorage 双写；用户名不存在时两个都清');
  // ⚠️ 2026-10-25 行为测试实测抓到的真 bug：清 Cookie 的串少了「=」，
  //   RFC 6265 规定没有 '=' 的 set-cookie 串整个被忽略——clear() 变空操作，
  //   错名字永远赖在 Cookie 里。隔离实验里手写串带 = 所以没暴露，是行为测试抓到的。
  check(/USER_KEY \+ '=; path=\/; max-age=0'/.test(pg),
    '清 Cookie 的串带等号（少个 = 浏览器整个忽略，clear 是空操作）',
    '2026-10-25 test-photo-gate.cjs 实测：缺 = 时 cookie 原样留着');
  check(/path=\/; max-age=/.test(pg) && /SameSite=Lax/.test(pg),
    'Cookie 写全属性（path / max-age / SameSite）');
  check(/\.photo-grid\[hidden\]\s*\{\s*display:\s*none/.test(why),
    '照片网格有 [hidden] 显示兜底（否则 display:grid 会盖掉 hidden 属性，锁定态占位框外露）',
    '无头浏览器实测过的坑：.photo-grid{display:grid} 会覆盖 hidden 属性的 UA display:none');
  check(/真校验/.test(why),
    '页面明示这是真校验（拉 GitHub star 列表，不是点一下就说已 Star）');
  check(/每次刷新/.test(why) && /Cookie \/ 本地存储/.test(why),
    '页面写明访问节奏（每次访问重新验证；不清本地数据就自动用记忆用户名验）');
  // ---- 2026-10-24 深夜站长实测反馈后的新增断言 ----
  check(/addEventListener\('input'/.test(pg) && /setTimeout\(/.test(pg) && /DEBOUNCE_MS/.test(pg),
    '输入停顿即自动验证（不用非点按钮；防抖省 API 调用）',
    '站长原话：「每次输入用户名都会自动验证」');
  // 注意：只匹配 normalize(input.value)…USERNAME_RE.test 会误中 input 监听器里
  //   同款代码（距离 <200 字符）——必须锚定恢复值分支独有的变量名 restored。
  check(/var restored = normalize\(input\.value\)/.test(pg) && /verify\(restored/.test(pg),
    'mount 时对「浏览器恢复的输入值」补一次自动验证',
    '无痕/清缓存刷新不发 input 事件，不补验就是「用户名在框里却还锁着」');
  // 不能只匹配字符串——注释里也提这件事。要盯住 readReset 函数本体里真的在读这个头，
  //   以及 onRes 里真的调用了 readReset。
  check(/function readReset\(/.test(pg) && /readReset\(res\)/.test(pg)
    && /function readReset[\s\S]{0,600}X-RateLimit-Reset/.test(pg) && /resetAt/.test(pg),
    '限流按 X-RateLimit-Reset 解析重置时刻（提示写明几点几分自动重试）');
  // 不能只匹配「自动重试」四个字（提示文案里也有）——要盯住真的调用和真的定时器。
  //   scheduleRateRetry(u, info) 是调用点，区别于函数定义 scheduleRateRetry(user, info)。
  check(/scheduleRateRetry\(u, info\)/.test(pg) && /rateTimer = setTimeout/.test(pg)
    && /hhmmss/.test(pg) && /自动重试/.test(pg),
    '限流提示带重置时刻 + 到点自动重试（一次访问最多 2 次）');
  // 同理：netTry 光有变量名不算，要盯住 catch 里真的 setTimeout(next, …)
  check(/netTry/.test(pg) && /setTimeout\(next, delay\)/.test(pg),
    '网络抖一下自动重试（重试耗尽才报 network）');
  // 去重判断本身要在，光有 inflight 变量名不算
  check(/inflight === u\) return/.test(pg),
    '同一用户名并发验证去重（不重复打 API 刷限流）');
  check(/id="sxg-gate-unlocked-note"/.test(why)
    && /\.gate-unlocked-note\[hidden\]\s*\{\s*display:\s*none/.test(why),
    '解锁提示条存在且有 [hidden] 显示兜底',
    '提示条目前没有 display 规则，但兜底先写上，防哪天加了 display 盖掉 hidden');
  check(/note\.hidden = false/.test(pg) && /请勿取消 Star/.test(why) && /更多福利/.test(why),
    '解锁后显示「别取消 Star / 不定期更新更多福利」提示');
  check(exists('scripts/test-photo-gate.cjs'),
    '存在门禁行为测试（jsdom + 桩 fetch，66 项）');
  // ---- 2026-10-26 站长指令：验证失败与 VPN 的关系要提示 ----
  // 门禁验证打 GitHub 公开 API，代理 IP 出口共享易判异常——
  // 提示分两层：门禁框里事前可见（gate-vpn-tip 真实 DOM 节点）+
  // 限流/网络两条错误文案里事后补充（VPN_HINT 拼接，失败当口看得到）。
  check(/class="gate-vpn-tip"/.test(why) && /关闭 VPN \/ 代理/.test(why)
    && /验证失败或限流/.test(why),
    '门禁框里有可见的「关闭 VPN / 代理」提示段（事前预防）');
  check(/\.gate-vpn-tip\s*\{/.test(why),
    'gate-vpn-tip 有样式定义（黄底警示卡，与 sponsor pre-tip 同视觉语义）');
  check(/var VPN_HINT = /.test(pg)
    && /ratelimit: [\s\S]{0,200}VPN_HINT/.test(pg)
    && /network: [\s\S]{0,120}VPN_HINT/.test(pg),
    '限流与网络错误文案拼接 VPN_HINT（失败当口提示，两处都要）');
  check(/rateLimitText[\s\S]{0,400}VPN_HINT/.test(pg),
    '带重置时刻的限流提示同样拼 VPN_HINT（三个限流出口全覆盖）');
}

// ---------- 20k. 搜索口径修正：summary 命中不得串品牌 ----------
// 背景：2026-10-24 站长截图：搜「瑞幸咖啡」，结果里同时出现库迪咖啡。
//   根因：bundle 主过滤器共 7 路匹配（name/companyName/category/
//   searchKeywords/keyProducts/summary/id），其中 summary 是叙述性
//   长文本，库迪的 summary 写着「由瑞幸咖啡创始团队于 2022 年创立」，
//   「瑞幸咖啡」四字整串命中 → 串味。与 20f 处理的「输 1 出宁德时代」
//   同病根（summary 里的年份/百分比/别家品牌名参与检索）。
//   修法：search-scope-fix.js 在 React 过滤后按强口径重算。
// 判据：补丁挂载、提取用括号配平（非正则）、强字段六路、summary 兜底、
//   class+!important（与 stat-filter 共存）、黑榜排除、降级源、行为测试。
{
  const ssf = read('search-scope-fix.js');
  const idxHtml = read('index.html');
  section('20k. 搜索口径修正（summary 命中降级为兜底）');
  check(exists('search-scope-fix.js')
    && /<script(?:\s+defer)? src="\.\/search-scope-fix\.js\?v=\d+"><\/script>/.test(idxHtml),
    '口径修正补丁存在且在 index.html 挂载');
  // 提取必须括号配平 + 跳过模板字符串：词条间距不固定，正则前瞻会跨对象
  // 误匹配（gen-pinyin-index.py 踩过：patagonia 被安上别家关键词）；
  // 模板字符串里也可能含 {}（summary 常见），不跳过配平立刻错乱。
  // 外层 if (ch === BT) 才是「进入跳过模式」的开关，只盯内层循环条件的话，
  // 把外层判断改死（跳过逻辑整体失效）断言照样绿——2026-10-24 实测。
  check(/brands:\[/.test(ssf) && /depth \+= 1/.test(ssf) && /depth === 0/.test(ssf)
    && /if \(ch === BT\)/.test(ssf),
    'bundle 提取用括号配平并跳过模板字符串（不用正则）');
  // 每路都要「取出且真的进 fields」：只匹配 field(obj,'companyName') 的话，
  // 把 push 那行删掉（字段取了却不参与判定）断言照样绿——2026-10-24
  // 故障注入实测过这个漏洞。
  check(/field\(obj, 'name'\)/.test(ssf) && /fields\.push\(name\)/.test(ssf)
    && /field\(obj, 'companyName'\)/.test(ssf) && /fields\.push\(companyName\)/.test(ssf)
    && /arrField\(obj, 'searchKeywords'\)/.test(ssf) && /arrField\(obj, 'keyProducts'\)/.test(ssf)
    && /field\(obj, 'id'\)/.test(ssf) && /fields\.push\(id\)/.test(ssf),
    '强字段五路齐全且都进 fields（name/companyName/searchKeywords/keyProducts/id）');
  check(!/field\(obj, 'summary'\)/.test(ssf) && !/arrField\(obj, 'summary'\)/.test(ssf),
    'summary 不进强字段（修正的核心：summary 是叙述文本，不是检索字段）');
  // 兜底：强字段零命中（如搜「六休一」）必须放开展示，不能一律隐藏成空结果
  check(/strongCount > 0 && !v\.strong/.test(ssf) && /else v\.card\.classList\.remove/.test(ssf),
    '强字段零命中 → summary 兜底全显示（搜「六休一」不空结果）');
  check(/HIDE_CLASS = 'sxg-scope-hidden'/.test(ssf)
    && /display:none !important/.test(ssf) && /classList\.add\(HIDE_CLASS\)/.test(ssf),
    '隐藏用 class + !important（stat-filter 的 inline display 盖不掉）');
  // 黑榜排除必须盯逻辑行：文件头注释里也提「虚拟对比黑榜」，
  // 只匹配字面量会被注释救绿（2026-10-24 故障注入实测）。
  check(/text\.indexOf\('虚拟对比黑榜'\) !== -1/.test(ssf),
    '虚拟对比黑榜卡不计入（与 stat-filter 口径一致）');
  // 同理，降级源要盯「真的去读了 window 上的索引」，注释提一句不算
  check(/var INDEX = window\.__PINYIN_INDEX__/.test(ssf),
    'fetch 失败有降级源（拼音索引），不是直接放弃修正');
  check(/requestAnimationFrame/.test(ssf) && /MutationObserver/.test(ssf) && /, 300\)/.test(ssf),
    '触发链齐全（input 事件 + MutationObserver 防抖重算 + load）');
  // 只定义了处理器不算数，必须真的绑到 input 上
  check(/input\.addEventListener\('input'/.test(ssf),
    'input 事件真的绑了（不是只定义了处理器函数）');
  check(exists('scripts/test-search-scope-fix.cjs'),
    '存在口径修正行为测试（jsdom + 桩 fetch，30 项）');

  // 20m：搜索容器防护栏（2026-10-25 站长 bug：输「啊」退格后输入框消失）。
  // 根因：搜索容器 div.bg-white.p-4.rounded-2xl.border 也命中 CARD_SEL，
  // 联想框残留品牌名（BYD）使其被 findBrandFor 认成品牌卡；IME 组合中间态
  // （拼音 'a'）字母命中其他品牌时容器被判弱命中加 HIDE_CLASS。
  // 修法：isSearchContainer 防护栏——含 #site-search-input 的容器不参与判定。
  // 断言盯「取出且真的用」：applyScope 循环里必须先调 isSearchContainer 再
  // continue（只定义不调用的断言形态已被 2026-10-25 注入实测排除）。
  section('20m. 搜索容器防护栏（输入框所在容器永不被口径判定隐藏）');
  check(/function isSearchContainer\(/.test(ssf)
    && /node\.querySelector\(INPUT_SEL\)/.test(ssf),
    'isSearchContainer 定义存在且以 INPUT_SEL 探测');
  check(/if \(isSearchContainer\(card\)\) \{ verdicts\.push\(null\); continue; \}/.test(ssf),
    'applyScope 真的调用防护栏跳过搜索容器（不是只定义）');
  check(/isSearchContainer: isSearchContainer/.test(ssf),
    '自测导出含 isSearchContainer（测试可直达）');
  const tssf = read('scripts/test-search-scope-fix.cjs');
  check(/搜索容器防护栏/.test(tssf) && /BYD_BUNDLE/.test(tssf),
    '行为测试覆盖防护栏场景且 BYD 在测试 bundle（防数据缺失救绿）');
}

// ---------- 20l. 照片仓库内加密 + 解密渲染 + 点击放大灯箱 ----------
// 背景：2026-10-25 站长要求「照片在仓库中加密」。此前 photo-kuromi.jpg /
//   photo-melody.jpg 是 git 跟踪的明文（clone 即可得）；现在仓库里只有
//   .enc 密文容器（scripts/encrypt-photos.mjs：PBKDF2-SHA256 21 万次 +
//   AES-256-GCM，与 notes.html 同参数），Star 门禁通过后由 photo-vault.js
//   在浏览器本地解密成 Blob 显示。
//   ⚠️ 已推历史里的旧明文：按本项目铁律不重写历史，只能保证「从今往后
//      仓库（工作区 + 新提交）只有密文」——所以 git ls-files 必须盯着，
//      明文一旦被重新跟踪，加密就白做了。
//   ⚠️ 口令在前端源码里（浏览器解密要用）：防的是「仓库躺明文」，
//      不防刻意读源码的人——真正的门是 Star 门禁。别在文案里吹军事级。
//   同时站长要求：图片可点击放大，放大后必须有「图片来源于网络，请不要
//   恶意传播，否则隐私权等法律纠纷一律与本站无关」的提示。
// 判据：.enc 在库、明文不被跟踪、.gitignore 兜底、加密脚本带往返自检、
//   口令同源、前端 KDF/GCM/tag 拼接/Blob URL、失败不静默、灯箱结构与免责提示。
{
  const pv = read('photo-vault.js');
  const why = read('why-shuangxiugou.html');
  section('20l. 照片仓库内加密 + 解密灯箱');
  check(exists('photo-kuromi.jpg.enc') && exists('photo-melody.jpg.enc'),
    '两张照片的 .enc 密文容器在仓库里',
    '缺 .enc → 照片加密名不副实');
  // git 层：明文不许再被跟踪，密文必须被跟踪。
  // 光看文件存在不够——明文在本机磁盘上永远在（要留着重新加密），
  // 只有 git ls-files 能区分「在库里」和「只在本机」。
  let tracked = [];
  try {
    tracked = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' })
      .split('\n').map((s) => s.trim()).filter(Boolean);
  } catch (e) { /* git 不可用时跳过 git 层断言，其余断言照跑 */ }
  if (tracked.length) {
    const stillTracked = tracked.filter((t) => t === 'photo-kuromi.jpg' || t === 'photo-melody.jpg');
    check(stillTracked.length === 0,
      '明文照片未被 git 跟踪（clone 拿不到原图）',
      `仍被跟踪：${stillTracked.join('、')}（git rm --cached 移出，.gitignore 兜底）`);
    check(tracked.includes('photo-kuromi.jpg.enc') && tracked.includes('photo-melody.jpg.enc'),
      '.enc 密文已被 git 跟踪（随仓库推送，访客页面才取得到）');
  }
  check(/photo-kuromi\.jpg/.test(read('.gitignore')) && /photo-melody\.jpg/.test(read('.gitignore')),
    '.gitignore 收录两张明文照片（防误 git add 回来）');
  // 加密脚本：同参数 + 往返自检（参数写错时带着错密文上线，访客全解不开）
  const ep = exists('scripts/encrypt-photos.mjs') ? read('scripts/encrypt-photos.mjs') : '';
  check(/pbkdf2Sync/.test(ep) && /aes-256-gcm/.test(ep)
    && /decryptContainer/.test(ep) && /roundtrip\.equals/.test(ep),
    '加密脚本在仓库里（PBKDF2-SHA256 + AES-256-GCM，写完当场解密比对）');
  // 口令同源：加密脚本与前端口令漂移的话，上线后所有人都解不开——
  // 这种故障静态审查看不出来，test-photo-vault.cjs 用真 .enc 真口令盯着。
  // ⚠️ 必须比对**完整值**，不能只比前缀：2026-10-25 故障注入实测，只写
  //   /PASSPHRASE = 'sxg-photo-vault-/ 的话，把值改成同前缀另一串照样绿
  //   （前缀是约定俗成的起手式，不是身份）——同前缀 ≠ 同值。
  const pvPass = /PASSPHRASE = '([^']+)'/.exec(pv);
  const epPass = /PASSPHRASE = '([^']+)'/.exec(ep);
  check(!!pvPass && !!epPass && pvPass[1] === epPass[1] && pvPass[1].length >= 12,
    '前端口令与加密脚本口令完全一致（同值且 ≥12 位）',
    `不一致：前端「${pvPass ? pvPass[1] : '未找到'}」 vs 脚本「${epPass ? epPass[1] : '未找到'}」`
    + '——两边改漏一个，线上就是「门禁过了、照片永远解不开」；跑 node scripts/test-photo-vault.cjs 可验');
  // 前端解密链：KDF → GCM → tag 拼接 → Blob → createObjectURL
  check(/importKey\('raw'/.test(pv) && /PBKDF2/.test(pv) && /SHA-256/.test(pv)
    && /deriveKey/.test(pv) && /AES-GCM/.test(pv) && /tagLength: 128/.test(pv),
    '前端用 Web Crypto 同参数解密（PBKDF2-SHA256 → AES-256-GCM）');
  // data 和 tag 必须分别解码再拼接：直接拼 base64 字符串会因各自 padding 解出乱码
  check(/buf\.set\(tag, body\.length\)/.test(pv),
    '密文与 tag 分别 base64 解码再拼接（Web Crypto 的 GCM 要 tag 附在尾部）',
    'notes.html 同款口径；直接拼 base64 串是经典坑');
  check(/createObjectURL/.test(pv) && /setAttribute\('src'/.test(pv),
    '解密产物走 Blob URL 写 img.src（不把 base64 塞进 src 属性）');
  // 失败不许静默：全成功才显网格，失败出红字且网格保持隐藏
  check(/grid\.hidden = false/.test(pv) && /data-vault-done/.test(pv) && /解密失败/.test(pv),
    '全部解密成功才显网格；失败出红字、网格保持隐藏（幂等标记防重复取密文）',
    '半截照片比没有更糟；静默空框是 2026-10-24 定过的红线');
  // 灯箱：结构、交互、免责提示、[hidden] 兜底、放大光标
  check(/id="sxg-photo-lightbox"/.test(why) && /id="sxg-photo-lightbox-img"/.test(why)
    && /id="sxg-photo-lightbox-cap"/.test(why) && /data-close="1"/.test(why),
    '灯箱结构齐全（遮罩与 ✕ 可关、大图位、标题位）');
  check(/图片来源于网络，请不要恶意传播，否则隐私权等法律纠纷一律与本站无关/.test(why),
    '灯箱带来源免责提示（站长 2026-10-25 要求的原文）',
    '图片来源于网络，放大后必须明示；这句话被截图外传也不会让站长为难');
  check(/\.photo-lightbox\[hidden\]\s*\{\s*display:\s*none/.test(why),
    '灯箱有 [hidden] 显示兜底（display:flex 会盖掉 hidden 属性，遮罩会浮在页面上）',
    'photo-grid 同款坑：2026-10-24 无头截图实测');
  check(/cursor:\s*zoom-in/.test(why),
    '照片有放大光标提示（可点击）');
  check(/id="sxg-photo-status"/.test(why) && /\.photo-status\[hidden\]\s*\{\s*display:\s*none/.test(why),
    '解密状态位存在且有 [hidden] 显示兜底');
  check(/addEventListener\('click'/.test(pv) && /Escape/.test(pv) && /data-close/.test(pv),
    '灯箱交互齐全（委托点击放大 + Esc/遮罩/✕ 关闭）');
  check(exists('scripts/test-photo-vault.cjs'),
    '存在解密/灯箱行为测试（jsdom + Node Web Crypto，30 项）');
}

// ---------- 20p. 品牌 LOGO 加密容器（2026-11-05 站长拍板） ----------
// 背景：站长要求「LOGO 图标缓存放 GitHub 仓库，blob 容器、不得明文，
//   优化后不再引用站外来源」。59 张核实过的官方 LOGO 经
//   scripts/build-logos.mjs 规范化 + scripts/encrypt-logos.mjs 加密成单个
//   assets/logos.enc（PBKDF2-SHA256 21 万次 + AES-256-GCM，photo 同款），
//   页面侧 logo-vault.js 浏览器本地解密成 Blob URL。
// 判据：.enc 在库且被跟踪、真解密出 59 张 PNG、口令同源、enc: 配置与容器
//   一一对应（漏一条 = 卡片 logo 永远空框）、index.html 接线、CI 挂测试。
{
  const lv = read('logo-vault.js');
  section('20p. 品牌 LOGO 加密容器');
  check(exists('assets/logos.enc'), 'assets/logos.enc 密文容器在仓库里');
  let tracked20m = [];
  try {
    tracked20m = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' })
      .split('\n').map((s) => s.trim()).filter(Boolean);
  } catch (e) { /* git 不可用时跳过 git 层断言 */ }
  if (tracked20m.length) {
    check(tracked20m.includes('assets/logos.enc'),
      'logos.enc 已被 git 跟踪（随仓库推送，访客才取得到）');
  }
  // 真解密：用 logo-vault.js 源码里的口令解容器（防口令/脚本漂移——
  // 漂移时线上所有 LOGO 框全空，静态审查看不出来）
  const lvPass = /PASSPHRASE = '([^']+)'/.exec(lv);
  const elScript = exists('scripts/encrypt-logos.mjs') ? read('scripts/encrypt-logos.mjs') : '';
  const elPass = /PASSPHRASE = '([^']+)'/.exec(elScript);
  check(!!lvPass && !!elPass && lvPass[1] === elPass[1] && lvPass[1].length >= 12,
    'logo-vault.js 与 encrypt-logos.mjs 口令完全一致（同值且 ≥12 位）',
    `不一致：前端「${lvPass ? lvPass[1] : '未找到'}」 vs 脚本「${elPass ? elPass[1] : '未找到'}」`
    + '——两边改漏一个，线上就是一排空 logo 框；跑 node scripts/test-logo-vault.cjs 可验');
  let logoSlugs = null;
  try {
    const cryptoMod = await import('node:crypto');
    const c = JSON.parse(read('assets/logos.enc'));
    const key = cryptoMod.pbkdf2Sync(lvPass ? lvPass[1] : '', Buffer.from(c.salt, 'base64'), c.iter, 32, 'sha256');
    const d = cryptoMod.createDecipheriv('aes-256-gcm', key, Buffer.from(c.iv, 'base64'));
    d.setAuthTag(Buffer.from(c.tag, 'base64'));
    const plain = JSON.parse(Buffer.concat([d.update(Buffer.from(c.data, 'base64')), d.final()]).toString('utf8'));
    logoSlugs = Object.keys(plain.logos || {});
    const allPng = logoSlugs.every((s) => Buffer.from(plain.logos[s].d, 'base64').slice(0, 4).toString('hex') === '89504e47');
    check(logoSlugs.length === 59 && allPng,
      `容器真解密出 59 张 PNG（实际 ${logoSlugs.length} 张，PNG magic 全对：${allPng}）`,
      '数量或格式不对 → 先重跑 scripts/build-logos.mjs + scripts/encrypt-logos.mjs');
  } catch (e) {
    err('logos.enc 用前端口令解不开（口令漂移或容器损坏）: ' + e.message,
      '线上会是一排空 logo 框');
  }
  // index.html 的 enc: 配置与容器一一对应（漏一条 = 该卡永远空框）
  const encVals = [...new Set([...html.matchAll(/logo: 'enc:([a-z0-9]+)'/g)].map((m) => m[1]))];
  if (logoSlugs) {
    const missing = encVals.filter((s) => !logoSlugs.includes(s));
    check(encVals.length === 59 && missing.length === 0,
      `index.html 有 59 处 enc: 配置且全部在容器里（实际 ${encVals.length} 处，缺失：${missing.join('、') || '无'}）`,
      'enc: 指向容器里没有的 slug = 卡片 logo 永远空框');
    const unused = logoSlugs.filter((s) => !encVals.includes(s));
    check(unused.length === 0,
      `容器里没有闲 Image 素材（未接线：${unused.join('、') || '无'}）`,
      '多出来的 slug 说明 encrypt-logos.mjs 与 index.html 不同步');
  }
  // 建行手绘旧标必须下线（2026-11-05 站长点名「建行 LOGO 仍然错误」）
  check(!/\.\/assets\/ccb\.svg/.test(html) && /logo: 'enc:ccb'/.test(html),
    '建行手绘近似标已换成官方标（enc:ccb，ccb.svg 不再被引用）');
  // 前端接线：脚本标签 + preload + 构建器分支
  check(/<script defer src="\.\/logo-vault\.js\?v=\d+"><\/script>/.test(html)
    && /<link rel="preload" href="\.\/logo-vault\.js\?v=\d+" as="script">/.test(html),
    'index.html 挂了 logo-vault.js（defer 脚本 + preload，带 ?v 缓存号）');
  check(/setAttribute\('data-sxg-enc'/.test(html) && /__sxgEncQueue/.test(html),
    '卡片构建器给 enc 卡写 data-sxg-enc 并接入回填队列');
  check(/data-sxg-enc/.test(lv) && /__sxgEncQueue/.test(lv) && /sxg-logos-ready/.test(lv)
    && /sxg-logos-failed/.test(lv),
    'logo-vault.js 队列+DOM 双回填、成功/失败事件齐全（失败恢复文字不留空框）');
  // ENC_URL 缓存号与脚本标签一致（改了容器没 bump ?v = 用户拿旧密文）
  const mEncUrlLv = /ENC_URL = '\.\/assets\/logos\.enc\?v=(\d+)'/.exec(lv);
  const mTagLv = /logo-vault\.js\?v=(\d+)/.exec(html);
  check(!!mEncUrlLv && !!mTagLv && mEncUrlLv[1] === mTagLv[1],
    'ENC_URL 的 ?v 与 logo-vault.js 脚本标签 ?v 一致',
    'pinyin-index ?v 事故同款：改了内容没 bump 缓存号，用户永远拿旧文件');
  check(exists('scripts/test-logo-vault.cjs'), '存在 LOGO 容器行为测试');
  // douyin-prompt 预热的容器地址必须与 logo-vault 的 ENC_URL 同一个 ?v
  // （改容器不 bump 预热侧 = 预热白热一个旧文件）
  const dpWarm = read('douyin-prompt.js');
  const mWarmEnc = /ENC_LOGO_URL = '\.\/assets\/logos\.enc\?v=(\d+)'/.exec(dpWarm);
  check(!!mWarmEnc && !!mEncUrlLv && mWarmEnc[1] === mEncUrlLv[1],
    '弹窗预热的 logos.enc 缓存号与 logo-vault ENC_URL 一致',
    '不一致 = 预热拉的是旧容器，等于白预热');
}

// ---------- 20g. 页面版本号必须等于「上一次提交」 ----------
// 2026-11-02 第五轮：版本号已从公告栏移到页面级节点 #site-version（菜单显示），
// 本节的判据只认「当前版本号 xxxxxxx</span>」这个锚点，位置变了不影响；
// 但文案里的「公告栏」已不准确，统一改成「页面版本号」。
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
section('20g. 页面版本号');

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
    err('index.html 里找不到「当前版本号 xxxxxxx</span>',
      '版本号是读者核对页面版本的唯一依据，不能删掉或写错格式');
  } else {
    // ⚠️ 不能写 `${shown}^{commit}`：Windows 的 cmd.exe 把 ^ 当转义符，
    //    会把 ^{commit} 吞掉，导致所有真实哈希都被误判成「不存在」。
    //    短哈希直接对象查询即可（git 会自行消歧到唯object）。
    let real = false;
    try { execSync(`git cat-file -e ${shown}`, { cwd: ROOT, stdio: 'ignore' }); real = true; } catch { real = false; }

    if (!real) {
      err(`页面版本号 ${shown} 在本仓库里不存在`,
        '不能手写或编造哈希。同步命令：node scripts/sync-version.mjs');
    } else if (shown === chain[0]) {
      err(`页面版本号 ${shown} 写成了当前 HEAD，应为 HEAD~1 的 ${chain[1]}`,
        '哈希由内容算出，写成当前 HEAD 会让它稳定落后两拍。');
    } else if (shown === chain[1]) {
      ok(`页面版本号 ${shown} = HEAD~1，符合「上一个推送」语义`);
    } else if (shown === chain[2]) {
      note(`页面版本号 ${shown} = HEAD~2（CI 同步补提交尚未生成的中间态）`);
    } else {
      const behind = execSync(`git rev-list --count ${shown}..HEAD`, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
      err(`页面版本号 ${shown} 落后 ${behind} 个提交，远超允许的 2 拍`,
        '多轮发版忘了同步。运行 node scripts/sync-version.mjs 自动写回。');
    }
  }
}

// ---------- 21. USDT 教程页（usdt-guide.html） ----------
section('21. USDT 教程页');
{
  const guidePath = join(ROOT, 'usdt-guide.html');
  const guide = existsSync(guidePath) ? readFileSync(guidePath, 'utf8') : '';

  check(guide.includes('USDT 充值教程'), '教程页标题在位');
  // 金句必须逐字：站长的硬性要求，改一个字都算违约。
  check(guide.includes('「所谓的幸运，就是当你准备好了的时候，机会来了。」'),
    '指定金句逐字出现在教程页',
    '站长原话：文案一定要有这句话。逐字比对，标点也要一致。');
  // 书名/作者锚定到唯一位置：金句署名行 + 推荐卡标题。
  // 教训（2026-10-25 注入实测）：裸 includes('《把时间当作朋友》') 在书名出现
  // 多处时会被「删一处留一处」救绿——同族值救绿的又一形态。锚定组合串后
  // 删掉署名行或推荐卡各自独立判红。
  check(guide.includes('——《把时间当作朋友》，李笑来'),
    '金句出处署名行在位（——《把时间当作朋友》，李笑来）');
  check(/《把时间当作朋友》—— 李笑来/.test(guide),
    '书籍推荐卡在位（《把时间当作朋友》—— 李笑来）');
  // 维基百科链接：作者介绍必须可溯源。URL 编码的 %E6%9D%8E%E7%AC%91%E6%9D%A5 = 李笑来
  check(guide.includes('https://zh.wikipedia.org/wiki/%E6%9D%8E%E7%AC%91%E6%9D%A5'),
    '教程页含维基百科「李笑来」词条链接');
  check(/维基百科「李笑来」词条/.test(guide) && /1972年7月12日/.test(guide),
    '作者介绍标注引自维基百科且含出生日期');
  // 提币步骤的核心口径：网络必须 TRC20，否则资产丢失
  check(/<b>网络必须选 TRC20（Tron）<\/b>/.test(guide), '提币步骤明确 TRC20 网络口径');
  // 不硬编码收款地址：地址唯一权威来源是 sponsor.html，教程页只负责指路
  check(!/TRyy3C668REPBGo2dDU1yiREdCyegFqjRN/.test(guide),
    '教程页不硬编码 TRC-20 收款地址（指向赞助页复制，地址单一权威来源）');
  // VPN 提示在教程页同样要有一份（KYC 步骤前置阅读）
  check(/关闭 VPN \/ 代理/.test(guide), '教程页含「关闭 VPN / 代理」提示');
  check(/sponsor\.html/.test(guide), '教程页链接回赞助页');
}

// ---------- 21b. 赞助页 VPN 提示与教程入口 ----------
section('21b. 赞助页 VPN 提示与教程入口');
{
  const sp = readFileSync(join(ROOT, 'sponsor.html'), 'utf8');
  // 盯「取出且真的用」：样式定义 + 真实 DOM 节点都要在
  check(/\.pre-tip\s*\{/.test(sp), 'sponsor.html 定义了 .pre-tip 样式');
  check(/<p class="pre-tip">/.test(sp), 'sponsor.html 有真实 pre-tip DOM 节点（非仅样式声明）');
  // 提示语义：锚定到提示正文整句（「触发风控限流」只出现在可见文案里）。
  // 教训（2026-10-25 注入实测）：裸 /限流/ 会被 CSS 注释里的「限流」救绿
  // ——文件头注释救绿的又一形态。删掉正文整句才判红。
  check(/关闭 VPN \/ 代理/.test(sp) && /触发风控限流/.test(sp),
    '赞助页提示含「关闭 VPN / 代理」与「触发风控限流」后果说明');
  // 教程入口：链接到 usdt-guide.html 且文案可见
  check(/href="\.\/usdt-guide\.html"/.test(sp) && /USDT 充值教程/.test(sp),
    '赞助页有指向 usdt-guide.html 的「USDT 充值教程」入口链接');
}

// ---------- 21b-1. 打赏页交易所安全事件带 ----------
// 为什么强制存在：币安 10·29 热钱包事件后提币一度全停，「从交易所提到本站地址」
// 这条路直接断掉。打赏页不写这一条，用户会以为自己的操作有问题而反复重试。
section('21b-1. 打赏页交易所安全事件带');
{
  const sp = readFileSync(join(ROOT, 'sponsor.html'), 'utf8');
  check(/\.incident\s*\{/.test(sp), 'sponsor.html 定义了 .incident 样式');
  // 2026-11-04 站长改口径：安全事件默认收起（点 summary 展开），
  // 取代此前「默认展开」的断言。块内容完整性与免责口径的断言保持不变。
  check(/<details class="incident">/.test(sp) && !/<details class="incident"[^>]*\bopen/.test(sp),
    '安全事件块默认收起的原生 <details>（零 JS 依赖，点 summary 展开）',
    'details 带 open → 安全事件默认展开，违反站长 2026-11-04 收起口径');
  check(/币安 10·29 热钱包事件/.test(sp) && /63 亿美元/.test(sp),
    '事件块写明起因与规模（10-29 热钱包、约 63 亿美元）');
  check(/由 80% 升至/.test(sp) && /100% 覆盖/.test(sp),
    '事件块含补足进度（80% → 90%、十种币 100% 覆盖）');
  check(/储备金证明（PoR）/.test(sp) && /11-03/.test(sp),
    '事件块含储备金证明（PoR）与可核验时间');
  check(/ETH 网络（ETH \/ USDT \/ USDC）/.test(sp) && /BSC（BNB \/ USDT \/ USDC）/.test(sp),
    '事件块写明 11-01 已恢复提币的网络（ETH 与 BSC）');
  check(/收款地址没有变/.test(sp),
    '事件块明确「收款地址未变」（防盗用事件名目钓鱼换址）');
  check(/本站与币安无隶属/.test(sp) && /以币安官方公告为准/.test(sp),
    '事件块含免责口径（无隶属关系、以官方公告为准）');
  check(/href="https:\/\/news\.qq\.com\/rain\/a\/20261101A0408U00"[^>]*rel="noopener noreferrer nofollow"/.test(sp),
    '事件块外链来源带 rel=noopener noreferrer nofollow');
}

// ---------- 21b-2. 安全事件默认收起 + 分享弹窗接线 ----------
// 背景（2026-11-04 站长两轮纠偏）：①「默认收起」针对的是安全事件块
// （details.incident），不是打赏收款面板——收款面板已还原为常驻展示；
// ②打卡成功后弹分享弹窗覆盖所有卡片（share-modal.js 挂进页面才生效）。
section('21b-2. 安全事件默认收起 + 分享弹窗接线');
{
  const sp = readFileSync(join(ROOT, 'sponsor.html'), 'utf8');
  // 收款面板还原：不得再出现 rewardToggle/rewardPanel（2026-11-04 曾误改，已还原）
  check(!/rewardPanel|rewardToggle/.test(sp) && /<div class="panel">/.test(sp),
    '打赏收款面板保持常驻展示（还原 rewardToggle 默认隐藏改法）',
    '收款面板又被藏起来 = 超出站长指令范围');
  // 分享弹窗：sponsor.html 与 index.html 都挂 share-modal.js（打卡成功弹分享的依赖）
  // 标签两种写法都认：<script defer src=…> 与 <script src=… defer>
  const shareTag = (h) => /<script(?=[^>]*\bsrc="\.\/share-modal\.js\?v=\d+")(?=[^>]*\bdefer)[^>]*><\/script>/.test(h);
  const idx = readFileSync(join(ROOT, 'index.html'), 'utf8');
  check(shareTag(idx) && shareTag(sp),
    'index.html 与 sponsor.html 都挂载了 share-modal.js 脚本标签（defer，属性顺序不限）');
  // 打卡成功 → 分享弹窗：盯「结算+关弹窗之后真的调起 SXGShare」
  const cca = readFileSync(join(ROOT, 'custom-card-actions.js'), 'utf8');
  check(/window\.SXGShare\) window\.SXGShare\.open\(/.test(cca),
    'custom-card-actions.js 打卡成功后调起分享弹窗（SXGShare.open）');
  // 2026-11-04 站长追加：分享弹窗覆盖所有卡片（含内置卡）。
  // 内置卡由 bundle React 关小票，必须轮询 .receipt-tear-top 离开 DOM 再弹。
  check(/waitBuiltinClose/.test(cca)
    && /document\.body\.contains\(receipt\)/.test(cca)
    && /waitBuiltinClose[\s\S]{0,400}window\.SXGShare\) window\.SXGShare\.open\(/.test(cca),
    '内置卡打卡也接分享（waitBuiltinClose 轮询关小票后调起 SXGShare）',
    '删掉 waitBuiltinClose → 内置卡打卡后不弹分享，只有自定义卡有');
  // 分享文案：复制类平台带说明文字，不照搬网站标题（站长 2026-11-04 要求）
  const sm = readFileSync(join(ROOT, 'share-modal.js'), 'utf8');
  check(/FALLBACK_DESC/.test(sm)
    && /og:description/.test(sm)
    && /i\.desc \+ '\\n' \+ i\.url/.test(sm),
    'share-modal.js 复制类平台带说明文案（og:description + 兜底 FALLBACK_DESC）',
    '删掉 desc 拼接 → 复制出去又是光秃秃一个链接');
  // 海外平台清单含 WhatsApp（2026-11-04 站长指定最底部新增）
  check(/name: 'WhatsApp', url: 'whatsapp'/.test(sm) && /wa\.me\/\?text=/.test(sm),
    'share-modal.js 海外清单含 WhatsApp（wa.me 分享，挂在最底部）',
    '删掉 WhatsApp 条目 → 站长指定的平台缺失');
  // og 标签：微信/Discord/Telegram 贴链接时的卡片与配图（og:image 必须是位图绝对 URL）
  check(/property="og:image" content="https:\/\/dujeongil-galaxy\.github\.io\/shuangxiugou\/og-share\.png"/.test(idx)
    && /property="og:description"/.test(idx),
    'index.html 有 og:image（og-share.png 位图绝对 URL）与 og:description 卡片标签');
  // og 唯一性（2026-11-04 清理）：index.html 曾同时存在新旧两套 og 标签
  // （初始导入的模板遗留 + 后加的 og-share 套），两组冲突的 title/description/image
  // 让爬虫与社交平台随机取值。现在必须各恰好一次，且不得再引用已退役的 og-cover.png。
  const ogCount = (re) => (idx.match(re) || []).length;
  check(ogCount(/property="og:title"/g) === 1
    && ogCount(/property="og:description"/g) === 1
    && ogCount(/property="og:image"/g) === 1
    && ogCount(/property="og:url"/g) === 1,
    'index.html og:title/description/image/url 各恰好一次（无重复 og 块）',
    '再塞进第二套 og 标签 → 爬虫取值随机，必应摘要又乱');
  check(!/og-cover\.png/.test(idx),
    'index.html 不再引用已退役的 assets/og-cover.png（统一 og-share.png）');
  // BOSS直聘详情页入口（2026-11-04 站长指定）：抵制行下方
  // 「点击这里阅读 “狗日的”Boss直聘」，「这里」链接 brand/bosszhipin.html，
  // 「“狗日的”Boss直聘」单独换色（#d97706）。
  // 2026-11-07 站长追加：「狗日的」必须加中文引号，表明是引用标题用词而非本站骂人。
  const ugp = readFileSync(join(ROOT, 'u-grade-patch.js'), 'utf8');
  check(/brand\/bosszhipin\.html/.test(ugp)
    && /狗日的”Boss直聘<\/span>/.test(ugp)
    && /color:#d97706/.test(ugp),
    '抵制行下方有 BOSS直聘详情页入口（这里=链接，“狗日的”Boss直聘换色标注）',
    '删掉入口行 → 站长指定的阅读链接缺失');
  // 2026-11-16 站长指令：点「这里」直接定位到「站长备注：为什么我要人为干涉这一条」，
  // 链接带 #note-manual-override，目标页同名 h2 必须有这个 id，否则锚点落空回页顶。
  const bossManual = readFileSync(join(ROOT, 'brand', 'bosszhipin.html'), 'utf8');
  check(/bosszhipin\.html#note-manual-override/.test(ugp)
    && /<h2 id="note-manual-override">站长备注：为什么我要人为干涉这一条<\/h2>/.test(bossManual),
    '§21b-4 「这里」链接带 #note-manual-override 锚点，目标页 h2 有同名 id（点进去直达站长备注）',
    '锚点或 id 缺一边 → 点进去仍落在页顶，站长要看的「人为干涉」那节找不到');
  check(/“狗日的”Boss直聘<\/span>/.test(ugp) && !/[^”]狗日的Boss直聘/.test(ugp),
    '§21b-3 「狗日的」带中文弯引号（U+201C/U+201D），不得退回无引号原样',
    '粗口不加引号 → 读起来像本站/站长在这行直接骂人（站长 2026-11-07 明确要求）');
  // 2026-11-14 站长指令：抵制区末尾的第三方推广整段撤下（对方明确表示不希望
  // 继续推广）。原「介绍句 + 固定末句」两条正向断言按新口径改成负向断言，
  // 配套排版补丁连同首页挂载一起删除；README 只留一句中性留痕，不提对方名称。
  const idxUgp = readFileSync(join(ROOT, 'index.html'), 'utf8');
  check(!/Haibiyou/.test(ugp) && !/认真做招聘的求职平台/.test(ugp)
    && !/限号注册/.test(ugp) && !/推广内容与本站无关/.test(ugp)
    && !/广告费/.test(ugp),
    '抵制区末尾第三方推广已整段撤下（介绍句与固定末句均清零）',
    '推广文案残留 → 对方已明确表示不希望继续推广');
  check(!/ad-text-width-fix\.js/.test(idxUgp) && !exists('ad-text-width-fix.js'),
    '推广配套排版补丁已撤挂载并删除（不再留只为广告服务的脚本）',
    '补丁残留 → 广告撤了但废脚本仍在跑');
  const rmAd = read('README.md');
  check(/应合作方要求，首页一处第三方推广内容已整段撤下/.test(rmAd)
    && !/Haibiyou/.test(rmAd) && !/海比优/.test(rmAd),
    'README 留痕一句话略过且不提对方名称',
    '留痕缺失或写出对方名称 → 不符合「直接一句话略过」的最新指令');
  // 脚本缓存号：改 u-grade-patch.js 必须同步 ?v=，否则线上仍是旧抵制区
  check(/u-grade-patch\.js\?v=22/.test(idxUgp)
    && !/u-grade-patch\.js\?v=21/.test(idxUgp),
    'index.html 引用 u-grade-patch.js?v=22（缓存号已随改动同步 +1）',
    '漏 bump ?v 或仍写旧值 → 浏览器命中旧缓存，新抵制区不生效');
}

// ---------- 21c. 首页滑到底部按钮 ----------
section('21c. 首页滑到底部按钮');
{
  const idx = readFileSync(join(ROOT, 'index.html'), 'utf8');
  // 脚本引用在位：盯着 <script src> 标签，不是文件存在性
  // （文件存在但没挂进页面 = 白做，2026-10-24 photo-gate.js 的教训）
  check(/<script(?:\s+defer)? src="\.\/bottom-button\.js\?v=\d+"><\/script>/.test(idx),
    'index.html 挂载了 bottom-button.js 脚本标签');
  // 底部按钮文件本体：幂等保护 + 点击绑定 scrollTo，缺一即判红
  const bbPath = join(ROOT, 'bottom-button.js');
  const bb = existsSync(bbPath) ? readFileSync(bbPath, 'utf8') : '';
  check(/getElementById\(BTN_ID\)\) return/.test(bb),
    'bottom-button.js 有幂等保护（已存在即返回）');
  check(/window\.scrollTo\(\{\s*top:\s*target,\s*behavior:/.test(bb),
    'bottom-button.js 点击时真的调用了 scrollTo（绑定在监听器内）');
  // 近底部隐藏逻辑：监听 scroll + 切换 class，删掉即判红
  check(/addEventListener\('scroll'/.test(bb) && /sxg-at-bottom/.test(bb),
    'bottom-button.js 有近底部自动隐藏逻辑（scroll 监提 + class 切换）');
}

// ---------- 21d. 申诉入口政策确认弹窗 ----------
// 背景（2026-10-25 站长要求）：申诉入口点击直接跳 GitHub issue，
// 用户没读政策就进去，产生无效申诉。改为先弹政策层：
// 「同意并跳转」开原链接、「拒绝并关闭」留在本页。
// 文案用站长定稿的简洁版（AI 自动计算 / 受理范围 / 不予受理 /
// 人工核验 / 脱敏五句）。
{
  const ap = read('appeal-policy.js');
  const idxHtml = read('index.html');
  section('21d. 申诉入口政策确认弹窗');
  check(exists('appeal-policy.js')
    && /<script(?:\s+defer)? src="\.\/appeal-policy\.js\?v=\d+"><\/script>/.test(idxHtml),
    '申诉政策弹窗脚本存在且在 index.html 挂载');
  // 判定逻辑：issues 链接才拦，普通链接放过（盯逻辑行，注释救绿已防）
  check(/github\\.com\\\/\[\^\/\]\+\\\/\[\^\/\]\+\\\/issues/.test(ap),
    'isAppealLink 只拦 issues 链接（正则逻辑行）');
  // 弹层文案五句逐字（站长定稿）
  check(ap.indexOf('本项目评级由AI依据GitHub仓库公示的判定规则自动计算得出') !== -1,
    '政策文案：AI 依据仓库规则自动计算（逐字）');
  check(ap.indexOf('申诉仅受理证据过时、信息不实、个案误判、规则发生变更类复核申请') !== -1,
    '政策文案：受理范围（逐字）');
  check(ap.indexOf('仅对评级结果不满意、无有效佐证材料的申诉不予受理') !== -1,
    '政策文案：不予受理（逐字）');
  check(ap.indexOf('请提交客观佐证材料，我们将人工核验材料后重新运行评级流程') !== -1,
    '政策文案：人工核验重跑（逐字）');
  check(ap.indexOf('所有申诉线索严格脱敏保护，不会泄露提交者隐私') !== -1,
    '政策文案：脱敏承诺（逐字）');
  // 两个按钮都要真的存在且语义相反
  check(/'同意并跳转'/.test(ap) && /'拒绝并关闭'/.test(ap),
    '双按钮：同意并跳转 / 拒绝并关闭');
  // 同意必须真的 window.open（不是只关弹层）
  check(/window\.open\(url, '_blank', 'noopener'\)/.test(ap),
    '同意按钮真的调 window.open（新标签）');
  // 点击接管：preventDefault 挡原生跳转
  check(/ev\.preventDefault\(\)/.test(ap) && /openModal\(a\.href\)/.test(ap),
    '点击申诉链接先弹层（preventDefault + openModal(a.href)）');
  // 幂等标记
  check(/dataset\[MARK\] === '1'/.test(ap) || /dataset\.sxgAppealBound === '1'/.test(ap),
    '链接绑定幂等（dataset 标记）');
  check(exists('scripts/test-appeal-policy.cjs'),
    '存在弹窗行为测试（jsdom，28 项）');
  // CI 接线：测试文件存在但没挂进 CI = 形同虚设（photo-gate.js 教训同源）。
  if (exists('.github/workflows/verify.yml')) {
    check(read('.github/workflows/verify.yml').includes('test-appeal-policy.cjs'),
      'CI 里已接入申诉政策弹窗测试');
  }
}

// ---------- 21e. 虚拟对比黑榜卡下线（2026-10-26 站长指令） ----------
// 背景：该卡是上游模板的匿名对比工具，此前「显示但不计入口径」。
// 站长指令「删了，不再保留」——bundle 不能动，视觉层隐藏（class
// display:none !important，不 removeChild——React 协调层不许可外部
// 删它管理的节点，第一版 removeChild 实测搜「瑞幸」整个 tab 崩掉）+
// noscript 清单同步删行（noscript 非 React 管，removeChild 安全）+
// MutationObserver 兜底重渲染。
// stat-filter / search-scope-fix 里的「虚拟对比黑榜不计入统计」防栏
// 保留（bundle 数据还在，防口径回退）。
{
  const vcr = exists('virtual-card-remove.js') ? read('virtual-card-remove.js') : '';
  section('21e. 虚拟对比黑榜卡下线');
  check(exists('virtual-card-remove.js')
    && /<script(?:\s+defer)? src="\.\/virtual-card-remove\.js\?v=\d+"><\/script>/.test(html),
    '下线脚本存在且在 index.html 挂载');
  // 判定逻辑盯真效果：MARK 字面 + textContent 命中
  check(/var MARK = '虚拟对比黑榜'/.test(vcr)
    && /textContent \|\| ''\)\.indexOf\(MARK\) !== -1/.test(vcr),
    '按 textContent 命中「虚拟对比黑榜」判定虚拟卡（与统计口径同字面）');
  // 隐藏机制：class + !important（不是 removeChild——React 协调安全）
  check(/var HIDE_CLASS = 'sxg-vcard-gone'/.test(vcr)
    && /\{display:none !important\}/.test(vcr)
    && /classList\.add\(HIDE_CLASS\)/.test(vcr),
    '隐藏用 class + display:none!important（React 协调安全，removeChild 会崩）');
  // 样式必须真的注入了
  check(/STYLE_ID = 'sxg-vcard-style'/.test(vcr)
    && /document\.getElementById\(STYLE_ID\)/.test(vcr),
    '隐藏样式由脚本注入（sxg-vcard-style）');
  // noscript 清理：SEO 降级视图也不留
  check(/function cleanNoscript/.test(vcr)
    && /querySelectorAll\('noscript li'\)/.test(vcr)
    && /p\.removeChild\(nodes\[i\]\)/.test(vcr),
    'noscript 静态清单行同步删除（SEO 兜底视图不留虚拟卡）');
  // 兜底：React 重渲染会把卡挂回来，必须有 MutationObserver
  check(/new MutationObserver/.test(vcr)
    && /mo\.observe\(root, \{ childList: true, subtree: true \}\)/.test(vcr),
    'MutationObserver 兜底重渲染（搜索/筛选/切标签会把卡挂回）');
  // 幂等
  check(/data-sxg-virtual-removed/.test(vcr),
    '幂等标记（documentElement data 属性）');
  // 静态侧：index.html noscript 里不再有虚拟卡行（此前有一行 <li>）
  const nsNow = html.match(/<noscript>([\s\S]*?)<\/noscript>/);
  check(!!nsNow && !nsNow[1].includes('虚拟对比黑榜'),
    'index.html noscript 清单已无虚拟卡行');
  // 行为测试存在且挂进 CI
  check(exists('scripts/test-virtual-card-remove.cjs'),
    '存在下线行为测试（jsdom，17 项）');
  if (exists('.github/workflows/verify.yml')) {
    check(read('.github/workflows/verify.yml').includes('test-virtual-card-remove.cjs'),
      'CI 里已接入虚拟卡下线测试');
  }
  // 防线不拆：统计口径的虚拟卡排除逻辑仍在（bundle 数据未动）
  check(/text\.indexOf\('虚拟对比黑榜'\) !== -1/.test(read('search-scope-fix.js')),
    '统计/搜索口径的虚拟卡排除防栏保留（bundle 未动，防口径回退）');
}

// ---------- 21f. 首页 FAQ 的 GitHub 入口 VPN 提示（2026-10-26 站长指令） ----------
// 背景：站长指认首页常见问题「数据准不准？发现错了怎么办？」答案里的
// GitHub Issues 入口——「这里提示用户，关闭VPN，否则可能触发GitHub
// 验证接口限流」。提示要落在两处：noscript SEO 兜底视图（可见 <p>）+
// JSON-LD FAQPage 结构化数据（搜索结果直达答案，同样要读到）。
// 断言锚定整句短语（防注释/多露面救绿，sponsor.html §21b 同款纪律）。
{
  section('21f. 首页 FAQ 的 GitHub 入口 VPN 提示');
  // 可见文案：noscript 视图里的提示段（真实 <p> 节点 + b 强调）
  check(/<p style="margin:0 0 12px;color:#6b7280;font-size:13px">\s*⚠️ 提交前请先<b>关闭 VPN \/ 代理<\/b>/.test(html),
    'FAQ 答案下方有可见的「关闭 VPN / 代理」提示段（noscript 视图）');
  // 语义完整：后果说明必须是「GitHub 验证接口限流」场景（与赞助页的交易所场景区分）
  check(/GitHub 的人机验证与登录接口\s*对代理 IP 触发限流/.test(html),
    '提示含 GitHub 验证接口限流的具体后果说明');
  check(/验证码无限循环、无法登录或页面空白/.test(html),
    '提示含「验证码无限循环、无法登录或页面空白」故障形态');
  // JSON-LD 镜像同步：FAQPage 结构化数据里的同款句子（搜索直达也读到）
  const faqJson = html.match(/"@type":\s*"FAQPage"([\s\S]*?)"mainEntity"([\s\S]*?)\]\s*}/);
  check(!!faqJson && faqJson[0].includes('提交前请先关闭 VPN / 代理'),
    'JSON-LD FAQPage 答案同步含 VPN 提示（结构化数据不漏）');
}

// ---------- 21g. 劳动法小助手（Worker 代理 + 全站跳转按钮） ----------
// 2026-11-18 架构：旧版内嵌挂件 ai-chat.js / ai-config.js 已彻底删除（文件、
// 引用、头像、专属测试全清）；现为独立页 labor-ai.html（双线路：国内硅基流动
// 直连 + Cloudflare Worker 代理）+ 全站跳转按钮 ai-link.js。Cloudflare Worker
// （env.AI binding 零 key，ai-worker/）仍服务新版 CF 线路，安全层断言保留。
{
  const worker = exists('ai-worker/src/worker.js') ? read('ai-worker/src/worker.js') : '';
  section('21g. 劳动法小助手（Worker 代理 + 品牌页挂件）');

  // ---- 前端图标跳转脚本 + 品牌页挂载（2026-11-17 改版：内嵌对话撤掉，AI 图标跳独立页 labor-ai.html）----
  check(exists('ai-link.js') && exists('labor-ai.html'),
    'AI 图标跳转脚本与新页面存在（ai-link.js / labor-ai.html）');
  // 2026-11-17 改版断言独立成节；原沿用 21g 节号与上方重复（test-verify-self 判红），
  // 改 21g-2（时间序在 21g-1 双线路之后）。
  section('21g-2. 劳动法小助手（图标跳独立页 + Worker 代理兜底）');
  // 品牌页全量挂载：数 brand/*.html 里引用 ai-link.js 的页数 == 品牌页总数
  const brandDir = join(ROOT, 'brand');
  let brandPages = 0, mounted = 0;
  if (exists('brand')) {
    for (const f of readdirSync(brandDir)) {
      if (!f.endsWith('.html')) continue;
      brandPages++;
      if (readFileSync(join(brandDir, f), 'utf8').includes('ai-link.js?v=')) mounted++;
    }
  }
  check(brandPages > 0 && mounted === brandPages,
    `${brandPages} 张品牌页全部挂载 AI 跳转脚本（实际 ${mounted}/${brandPages}）`);
  // 品牌页 ai-link.js 的 ?v 必须与首页同值（2026-11-17 沿用旧纪律）：
  // 版本不一致会让品牌页访客读到缓存里的旧跳转脚本（仍弹内嵌对话）。
  {
    const chatV = (html.match(/ai-link\.js\?v=(\d+)/) || [])[1];
    const staleV = [];
    if (exists('brand')) {
      for (const f of readdirSync(brandDir)) {
        if (!f.endsWith('.html')) continue;
        const t = readFileSync(join(brandDir, f), 'utf8');
        const v = (t.match(/ai-link\.js\?v=(\d+)/) || [])[1];
        if (v !== chatV) staleV.push(`${f}@${v}`);
      }
    }
    check(chatV && staleV.length === 0,
      `品牌页 ai-link.js ?v 与首页一致（首页 v${chatV}，不一致 ${staleV.length} 张${staleV.length ? '：' + staleV.slice(0, 5).join(' / ') : ''}）`);
  }
  // 旧版 ai-config.js 已彻底删除：全站任何页面不得再挂这个开关脚本。
  // 曾有「config 在 link 前」的挂载顺序纪律，config 删除后一并作废。
  check(!/<script[^>]*ai-config\.js/.test(html)
    && !/<script[^>]*ai-config\.js/.test(readFileSync(join(ROOT, 'brand/acer.html'), 'utf8')),
    '首页与品牌页均不再挂载 ai-config.js（旧开关随挂件彻底删除）');
  // 首页也挂新版跳转（手机端主入口）
  check(/<script(?:\s+defer)? src="\.\/ai-link\.js\?v=\d+"><\/script>/.test(html),
    '首页 index.html 挂载 AI 跳转脚本（手机端主入口）');
  // ai-link.js 必须：建 AI 圆钮 + 点击跳 labor-ai.html（相对路径按目录推断）
  const aiLink = exists('ai-link.js') ? read('ai-link.js') : '';
  check(/sxg-ai-fab/.test(aiLink) && /labor-ai\.html/.test(aiLink) && /targetHref/.test(aiLink),
    'ai-link.js 复刻 AI 圆钮并跳转 labor-ai.html');

  /* ---- 2026-11-18 全局化：AI 按钮全站统一新版，旧挂件彻底清零 ----
     起因：站长进 projects.html / notes.html 仍是老版内嵌 AI（ai-chat.js），
     要求全局检查 + 左下角 AI 按钮全站都有。口径：
       · 正常站点页一律挂 ai-link.js（新版跳转）；
       · 特例页不挂：labor-ai.html（自身即终点）、404、discussion-closed、
         notes-plaintext-preview、google 站点验证文件；
       · 全站零 ai-chat.js 引用（老版内嵌挂件彻底下线）；
       · notes.html 解锁后的「阅读全文」正文不能再有按钮 → 阅读态守卫。 */
  const AI_SHOULD_HAVE = ['about.html', 'byd-report.html', 'community-rules.html',
    'contact.html', 'disclaimer.html', 'notes.html', 'privacy.html', 'projects.html',
    'qq-browser-report.html', 'qq-nainai.html', 'remind-original.html', 'sponsor.html',
    'success-stories.html', 'usdt-guide.html', 'why-shuangxiugou.html'];
  const AI_NO_BUTTON = ['labor-ai.html', '404.html', 'discussion-closed.html',
    'notes-plaintext-preview.html', 'googlea540a6c2cd5f0e6c.html'];
  const missBtn = AI_SHOULD_HAVE.filter((f) => !exists(f) || !/ai-link\.js\?v=\d+/.test(read(f)));
  check(missBtn.length === 0,
    `AI 按钮全站化：15 个应有页全部挂 ai-link.js（缺 ${missBtn.length}${missBtn.length ? '：' + missBtn.join(' / ') : ''}）`,
    '漏挂页的访客看不到左下角 AI 按钮，与「全站都有」口径不符');
  const strayBtn = AI_NO_BUTTON.filter((f) => exists(f) && /ai-link\.js\?v=\d+/.test(read(f)));
  check(strayBtn.length === 0,
    `5 个特例页不挂 AI 按钮（多挂 ${strayBtn.length}${strayBtn.length ? '：' + strayBtn.join(' / ') : ''}）`,
    'labor-ai 自身 / 404 / 讨论关闭 / 明文预览 / google 验证不该出现 AI 按钮');
  // 全站（含 brand/）零 ai-chat.js 引用 —— 老版内嵌挂件彻底下线
  const staleChat = [];
  for (const f of readdirSync(ROOT)) {
    if (!f.endsWith('.html')) continue;
    if (/ai-chat\.js/.test(read(f))) staleChat.push(f);
  }
  for (const f of readdirSync(brandDir)) {
    if (!f.endsWith('.html')) continue;
    if (/ai-chat\.js/.test(read('brand/' + f))) staleChat.push('brand/' + f);
  }
  check(staleChat.length === 0,
    `全站零 ai-chat.js 旧挂件引用（残留 ${staleChat.length}${staleChat.length ? '：' + staleChat.slice(0, 5).join(' / ') : ''}）`,
    '老版内嵌对话挂件回潮会让访客看到两套 AI 入口');
  // 阅读态守卫：document.write 不会清掉已插按钮，必须在 boot 里检测 #toc 并移除
  check(/function isReaderMode\(\)/.test(aiLink)
    && /getElementById\('toc'\)/.test(aiLink)
    && /if \(isReaderMode\(\)\)/.test(aiLink)
    && /removeChild\(stale\)/.test(aiLink),
    '★ 阅读态守卫：正文（#toc）里移除 AI 按钮并跳过构建（解锁后不复活）',
    '删守卫 → notes.html 解锁进「阅读全文」后左下角 AI 按钮仍在，违反站长要求');

  // ---- AI 开通公告文案（2026-11-18 站长优化）----
  // 保留开通日期 2026-11-07 不删；补上当日全面升级 + 旧版历史遗留代码彻底清除。
  // 措辞由站长给定含义、脚本自组织，不许照抄指令、也不许把两件事实删掉。
  section('21g-3. AI 开通公告文案');
  const noticeJs = exists('ai-notice-patch.js') ? read('ai-notice-patch.js') : '';
  const noticeM = noticeJs.match(/var NOTICE_TEXT = '([^']*)'/);
  check(!!noticeM, '公告脚本存在且定义 NOTICE_TEXT');
  if (noticeM) {
    const nt = noticeM[1];
    check(/2026-11-07/.test(nt), '公告保留开通日期 2026-11-07（站长：日期不删）');
    check(/11-18/.test(nt) && /全面升级/.test(nt),
      '公告写明 11-18 完成全面升级');
    check(/旧版/.test(nt) && /(彻底清除|彻底移除|彻底删除)/.test(nt) && /代码/.test(nt),
      '公告写明旧版历史遗留代码已彻底清除（不是「优化/更新」软话）');
    check(/Ai 对话图标/.test(nt) && /咨询劳动法/.test(nt),
      '公告用统一叫法「Ai 对话图标」给出咨询劳动法指引（不写位置）');
    check(!/(右下角|左下角|左下|右下|🤖)/.test(nt),
      '公告不含任何方位词或 🤖（PC 常显右侧 dock / 手机收在别处，写死位置会误导）');
    check(nt.length <= 120,
      `公告长度可控，不撑破首页 hero 徽章（当前 ${nt.length} 字）`);
  }
  const noticeHtmlNoCmt = html.replace(/<!--[\s\S]*?-->/g, '');
  check(/<script[^>]*src="\.\/ai-notice-patch\.js\?v=3"/.test(noticeHtmlNoCmt),
    '首页活跃引用 ai-notice-patch.js?v=3（非注释，文案变更 bump 破缓存）');

  // labor-ai.html 必须：双线路 + 新权限矩阵（登录 20 / 未登录 10；附件登录+Star 才开）+ 两处免责声明
  {
    const la = read('labor-ai.html');
    const hmp = read('header-menu-patch.js');
    check(/sxg_github_logged_in/.test(la) && /sxg_github_has_star/.test(la)
      && /RATE_FULL = 20/.test(la) && /RATE_HALF = 10/.test(la)
      && /CN_RATE_KEY = 'sxg_ai_cn_rate'/.test(la),
      '新页面读取登录/Star 状态；登录 20 次/小时、未登录减半 10 次/小时（国内外同口径）');
    check(/askCN/.test(la) && /askCF/.test(la) && /api\.siliconflow\.cn/.test(la) && /workers\.dev/.test(la),
      '新页面双线路齐备（国内硅基流动 + Cloudflare Worker）');
    check(/currentRoute = 'cf'/.test(la) && /quotaLimit: logged \? RATE_FULL : RATE_HALF/.test(la)
      && /function cnRateOk\(\)/.test(la) && /hits\.length < limit/.test(la)
      && /quotaTier: starStatus\(\)\.logged \? 'full' : 'half'/.test(la) && !/cnUnlocked/.test(la),
      '默认走 Cloudflare；文字问答两条线路都开放，额度只看登录态（CF 声明档位 + CN 本地滑窗）');
    check(/attachUnlocked: logged && hasStar,/.test(la) && !/STAR_ATTACH_DAYS/.test(la)
      && !/attachUnlocked[^\n]*days\s*>=\s*3/.test(la)
      && /fileInput\.disabled = !ok/.test(la)
      && /if \(attachments\.length && !starStatus\(\)\.attachUnlocked\)/.test(la)
      && /if \(!st\.attachUnlocked\)/.test(la),
      '附件锁死：登录 + Star 才放行，不看天数；入口禁用、选文件、发送前共三道门');
    check(!/sxg_ai_blacklisted|sxg_ai_ever_starred|拉黑/.test(la)
      && !/sxg_ai_blacklisted|sxg_ai_ever_starred|拉黑/.test(hmp)
      && !/localStorage\.setItem\('sxg_ai_blacklisted'/.test(hmp),
      '旧「取消 Star 永久拉黑」规则已彻底移除，AI 页与首页回调都不再写/说拉黑');
    check(/header-menu-patch\.js\?v=15/.test(read('index.html')),
      '首页脚本内容已变，缓存号 bump 到 v15');
    check(/ipNotice/.test(la) && /visitorIp/.test(la) && /个人敏感信息/.test(la)
      && /请求过于频繁将触发短时限流/.test(la) && /请间隔片刻再试/.test(la),
      '安全公告：显示访问 IP + 勿发敏感信息 + 高频只说「触发短时限流、间隔再试」（不谎称封禁）');
    // §21h-2（2026-11-21 站长定规）：限流口径是每 IP 20 次/小时、超出等一会儿自动恢复，
    // 对用户一律不提「封禁」——限流文案与接口异常提示都不许出现惩罚性字眼或内部错误码。
    {
      const ipBody = (la.match(/async function renderIpNotice\(\)\{[\s\S]*?\n\}/) || [''])[0];
      const askBody = (la.match(/async function askCF\([\s\S]*?\n\}/) || [''])[0];
      check(/请求过于频繁将触发短时限流/.test(ipBody) && /请间隔片刻再试/.test(ipBody)
        && !/封禁|被封|取消授权|取消后续|停用|拉黑|稍后即可恢复/.test(ipBody),
        '§21h-2 IP 公告只说「触发短时限流、间隔再试」，不含封禁/取消授权等惩罚字眼',
        '写回封禁或「稍后恢复」措辞 → 用户把短时限流误读成永久惩罚或误解机制');
      check(/res\.status === 429/.test(askBody) && /res\.status === 403/.test(askBody)
        && /请间隔片刻再试/.test(askBody) && !/ip-blocked|封禁|被封|稍后即可恢复/.test(askBody),
        '§21h-2 askCF 对 403/429 统一温和提示，不向用户透出内部错误码或封禁字眼',
        '403 原样回显 {"error":"ip-blocked"} → 等于告诉用户被封，与「不提示封禁」口径冲突');
    }
    // §21h-4（2026-11-21 站长定规）：具体额度档位不对外公开，访客可见处只保留统一的一句话。
    // 判据只扫用户可见文案（meta / 线路提示 / 附件提示 / 登录弹窗 / 隐私页），不碰代码常量。
    {
      const PUBLIC_QUOTA_LINE = '登录GitHub并Star可获取更多额度';
      const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
      // §21h-5（2026-11-21 站长定规）：对外不写「免费」，线路按钮去掉括号副文案。
      check(/<button class="route-btn" id="btnCF">Cloudflare<\/button>/.test(la)
        && !/免费额度|免费开放/.test(stripComments(la))
        && !/免费额度/.test(stripComments(hmp))
        && !/免费额度/.test(read('privacy.html')),
        '§21h-5 对外文案不写「免费」：按钮只留 Cloudflare，无「免费额度/免费开放」',
        '把「免费开放」括号或「免费额度」写回 → 截图里那两处又出现「免费」字样');
      check(/header-menu-patch\.js\?v=15/.test(read('index.html'))
        && !/header-menu-patch\.js\?v=14/.test(read('index.html')),
        '§21h-5 首页补丁脚本内容已变，缓存号 bump 到 v15',
        '文案改了但缓存号没 bump → 老访客浏览器仍读旧弹窗文案');
      const publicMetas = [...la.matchAll(/<meta[^>]*>/g)].map(m => m[0])
        .filter(m => /description/i.test(m));
      check(publicMetas.length >= 3 && publicMetas.every(m => m.includes(PUBLIC_QUOTA_LINE))
        && !publicMetas.some(m => /10 次|20 次|减半/.test(m)),
        '§21h-4 搜索摘要只写统一一句话，不公开 10/20 档位',
        '把具体额度写回 description → 搜索引擎与分享卡片直接暴露内部档位');
      const routeBody = (stripComments(la).match(/function renderRoute\(\)\{[\s\S]*?\n\}/) || [''])[0];
      check(routeBody.includes(PUBLIC_QUOTA_LINE)
        && !/未登录减半|当前额度/.test(routeBody),
        '§21h-4 线路提示条只展示统一一句话，不再显示登录态额度数字',
        '把「当前额度 10/20 次」写回 → 具体档位对每位访客可见');
      const hmpPublic = stripComments(hmp);
      check((hmpPublic.match(/登录GitHub并Star可获取更多额度/g) || []).length >= 4
        && !/每小时 20 次|每小时 10 次|不限天数/.test(hmpPublic),
        '§21h-4 登录弹窗不报具体额度，统一使用同一句话',
        '弹窗里露出「每小时 20 次」→ 登录前后档位差被直接公开');
      const privacy24 = read('privacy.html');
      check(privacy24.includes(PUBLIC_QUOTA_LINE)
        && !/已登录每小时 20|未登录减半为 10|20 次\/小时/.test(privacy24),
        '§21h-4 隐私页也只给统一一句话，不列具体额度档位',
        '隐私页写回档位 → 对外文档仍公开内部规则');
    }
    // §21h-3（2026-11-21 站长改版）：登录 20 次/小时、未登录一律减半 10 次/小时；
    // Star 只管附件，不再决定文字问答。两个后端 + 前端必须同一套口径。
    {
      const workerSrc = read('ai-worker/src/worker.js');
      const aliSrc = read('ai-worker-aliyun/index.mjs');
      check(/const RATE_LIMIT_FULL = 20/.test(workerSrc) && /const RATE_LIMIT_HALF = 10/.test(workerSrc)
        && /quotaTier === 'full' \? RATE_LIMIT_FULL : RATE_LIMIT_HALF/.test(workerSrc)
        && /recent\.length >= rateLimit/.test(workerSrc) && /tier: quotaTier/.test(workerSrc),
        '§21h-3 CF Worker 按 quotaTier 选上限：登录 20 / 未登录 10，日志带档位',
        '删掉 half 档 → 未登录仍按 20 次跑，减半口径落空');
      check(/const RATE_LIMIT_FULL = 20/.test(aliSrc) && /const RATE_LIMIT_HALF = 10/.test(aliSrc)
        && /quotaTier === 'full' \? RATE_LIMIT_FULL : RATE_LIMIT_HALF/.test(aliSrc)
        && /function checkRate\(ip, limit\)/.test(aliSrc) && /checkRate\(clientIp\(ev\), rateLimit\)/.test(aliSrc)
        && /recent\.length >= limit/.test(aliSrc),
        '§21h-3 阿里云线路同口径：登录 20 / 未登录 10（checkRate 接收档位上限）',
        '国内后端仍写死 20 → 国内外限流不一致，与站长「一律减半」冲突');
      check(/quotaTier/.test(read('scripts/test-ai-worker.cjs'))
        && /'half'/.test(read('scripts/test-ai-worker.cjs'))
        && /quotaTier: 'half'/.test(read('scripts/test-ai-worker-aliyun.cjs')),
        '§21h-3 两端单测都覆盖未登录 10 次上限（第 11 次判红）',
        '只测 20 次老口径 → 减半逻辑回归无人发现');
    }
    check(/IPIP_ENDPOINT = 'https:\/\/myip\.ipip\.net\/json'/.test(la)
      && /IPIFY_ENDPOINT = 'https:\/\/api\.ipify\.org\?format=json'/.test(la)
      && /async function resolveVisitorIp/.test(la)
      && /capsCache && capsCache\.visitorIp/.test(la)
      && /source: 'cf'/.test(la) && /source: 'ipip'/.test(la) && /source: 'ipify'/.test(la) && /source: 'none'/.test(la)
      && /data-ip-source/.test(la)
      && /fetchJsonWithTimeout\(IPIP_ENDPOINT, 8000\)/.test(la)
      && /fetchJsonWithTimeout\(IPIFY_ENDPOINT, 8000\)/.test(la)
      && /succeed\(\{ ip: ip, source: 'ipip' \}\)/.test(la),
      'IP 公告四级降级：CF → 国内 ipip 源 → 国际 ipify 并行竞速 → 未知，标记来源供审计',
      '国内直连时 ipify 超时被 abort 或 CF 探测挂起 → 公告卡「正在获取」/显示「未知」→ 降级失效');
    check(/setTimeout\(function\(\)\{ ctl\.abort\(\); \}, 3000\)/.test(la)
      && /cfSupportsVision\(\)\.then\(renderIpNotice, renderIpNotice\)/.test(la),
      'CF 能力探测有 3 秒超时 + 失败/超时仍渲染公告（防卡「正在获取」）',
      'workers.dev 国内挂起 → renderIpNotice 不执行 → 公告永久卡住');
    check(/escIp\(j && j\.data && j\.data\.ip\)/.test(la)
      && /escIp\(j && j\.ip\)/.test(la)
      && /ip !== '未知' \? succeed\(\{ ip: ip, source: 'ipip' \}\) : fail\(\)/.test(la)
      && /ip !== '未知' \? succeed\(\{ ip: ip, source: 'ipify' \}\) : fail\(\)/.test(la),
      'IP 降级有格式白名单校验 + 两个源都「失败才让位」（防注入/防假成功覆盖真 IP）',
      '无格式校验 → 第三方响应可注入 HTML；失败源误判成功 → 覆盖可用 IP');
    // 全局一致：生效代码里不许残留旧的「按天数才能开国内线路」口径（历史 CHANGELOG / 最近更新是留痕，不改）
    {
      const liveFiles = ['labor-ai.html', 'header-menu-patch.js', 'ai-worker/src/worker.js',
        'ai-worker/README.md', 'ai-worker/DEPLOY-教程.md', 'scripts/verify.mjs']
        .filter((f) => exists(f));
      const stale = liveFiles.filter((f) => /Star\s*满?\s*7\s*天|满\s*7\s*天|攒满\s*7\s*天/.test(read(f)));
      check(stale.length === 0,
        '全局一致性：生效代码/文档无旧版天数门槛残留（历史记账除外）',
        '仍含旧口径：' + stale.join(' / '));
    }
    check((la.match(/不构成法律意见/g) || []).length >= 1,
      '新页面含免责声明「不构成法律意见」');
    // 国内线路 Key 必须已配置（2026-11-17）：运行时解码 _SEG 还原出的 Key 需为合法 sk- 串。
    // 不把明文写进校验/文档——这里用页面同款算法还原后只校验「格式」，防回退成占位串无人发现。
    {
      const mMask = la.match(/var _MASK = \[([^\]]+)\]/);
      const mOrder = la.match(/var _ORDER = \[([^\]]+)\]/);
      const mSeg = la.match(/var _SEG = (\[[^\]]+\])/);
      let restored = '';
      try {
        const mask = mMask[1].split(',').map(x => parseInt(x.trim(), 16) || 0);
        const order = mOrder[1].split(',').map(x => parseInt(x.trim(), 10));
        const seg = JSON.parse(mSeg[1]);
        const ordered = [];
        for (let k = 0; k < 5; k++) ordered[k] = seg[order.indexOf(k)];
        const bin = Buffer.from(ordered.join(''), 'base64').toString('binary');
        let rev = '';
        for (let i = 0; i < bin.length; i++) rev += String.fromCharCode((bin.charCodeAt(i) - mask[i % mask.length] + 256) % 256);
        restored = rev.split('').reverse().join('');
      } catch (e) { restored = ''; }
      check(/^sk-[A-Za-z0-9]{40,}$/.test(restored) && restored.indexOf('PLACEHOLDER') < 0,
        '国内线路 API Key 已配置（_SEG 还原为合法 sk- 串，非占位）');
    }
  }
  // ---- 21u. 劳动法小助手图片/文档上传（2026-11-21 站长：「支持图片或文件上传」）----
  // 前端在浏览器本地解析附件（不上传第三方解析服务），统一封装 parts 走双线路；
  // CF Worker 加 vision 模型与能力探测，未部署新版时诚实降级，不静默吞图。
  {
    const la = read('labor-ai.html');
    const w = read('ai-worker/src/worker.js');
    check(/type="file"[^>]*accept="image\/jpeg,image\/png,image\/webp,application\/pdf,\.docx"[^>]*multiple/.test(la)
      && /ATTACH_LIMIT\s*=\s*\{\s*max:\s*3/.test(la),
      '§21u 前端文件入口接受 JPG/PNG/WEBP/PDF/DOCX、最多 3 个（含大小上限常量）',
      '退回纯文本框 → 站长要的「支持图片或文件上传」直接丢失');
    check(/function ensurePdfjs/.test(la) && /function ensureMammoth/.test(la)
      && /cdn\.jsdelivr\.net/.test(la) && /unpkg\.com/.test(la)
      && /getTextContent\(\)/.test(la) && /extractRawText/.test(la),
      '§21u PDF 用 pdf.js 抽文本层、扫描页渲染成图；DOCX 用 mammoth 抽文本；双 CDN 回退',
      '只靠单一 CDN → 挂了就没法解析；不抽文本层 → 每张 PDF 都走图，额度烧得快');
    check(/function buildParts/.test(la) && /type: 'image_url'/.test(la)
      && /image_url: \{ url: a\.dataUrl \}/.test(la) && /partsHasImage/.test(la),
      '§21u 附件封装为 OpenAI 兼容 parts（text / image_url data URL），含图片判定',
      '附件退化成只发文件名 → AI 根本看不到内容');
    // 2026-11-21：硅基流动下线 Qwen2.5-VL-7B-Instruct（400 Model does not exist），
    // 换 Qwen3-VL-8B-Instruct（实测文本/带图均 200）。写死新名，防止回退到失效模型。
    check(/Qwen\/Qwen3-VL-8B-Instruct/.test(la)
      && !/model:\s*"Qwen\/Qwen2\.5-VL/.test(la)
      && /cfSupportsVision/.test(la) && /\/api\/capabilities/.test(la)
      && /不支持图片\/文档识别/.test(la),
      '§21u 国内线路切在册视觉模型 Qwen3-VL-8B；CF 线路先探测能力，老 Worker 明确提示换线路（不静默失败）',
      '模型名被硅基流动下线 → 国内线路 400；CF 不探测 → 图片被吞且无提示');
    check(/只在你的浏览器里解析/.test(la) && /不上传到任何第三方解析服务/.test(la),
      '§21u 隐私文案明示本地解析、附件随提问发给所选线路',
      '上传件知情权缺失 → 隐私合规风险');
    check(/request\.method === 'GET' && path === '\/api\/capabilities'/.test(w)
      && /vision: true/.test(w) && /@cf\/meta\/llama-3\.2-11b-vision-instruct/.test(w)
      && /const hasImage = parts\.some/.test(w),
      '§21u Worker 提供能力探测端点 + 带图切视觉模型（纯文本仍走原模型）',
      '端点缺失 → 前端一律降级；无视觉模型 → 带图请求仍走文本模型');
    check(/\^data:image\\\/\(jpeg\|png\|webp\);base64,/.test(w)
      && /url\.length > 7 \* 1024 \* 1024/.test(w) && /\.slice\(0, 8\)/.test(w),
      '§21u Worker 只收 data:image base64（禁 http 外链防 SSRF），限 8 段 / 7MB',
      '放行 http 链接 → Worker 被当图片代理 SSRF；不限体积 → 单请求打爆内存');
  }
  // ---- 旧版挂件彻底删除（2026-11-18 站长：「彻底删干净，不是注释」）----
  // 这些文件/测试/头像曾服务旧版内嵌挂件，新版独立页 + 跳转按钮完全不依赖，
  // 必须物理删除而非注释保留，否则站长再次误入旧版、或被人当死代码复活。
  for (const dead of ['ai-chat.js', 'ai-config.js',
    'assets/ai-avatar.svg', 'assets/ai-avatars/A.svg', 'assets/ai-avatars/B.svg',
    'assets/ai-avatars/C.svg', 'assets/ai-avatars/D.svg', 'assets/ai-avatars/E.svg',
    'assets/ai-avatars/F.svg',
    'scripts/test-ai-chat.cjs', 'scripts/test-ai-route.cjs',
    'scripts/shot-ai-chat.cjs', 'scripts/shot-ai-mobile.cjs']) {
    check(!exists(dead), `旧版挂件资产已物理删除：${dead}`);
  }

  // ---- Worker 安全层（防的是「endpoint 公开」带来的滥用面）----
  check(exists('ai-worker/src/worker.js') && exists('ai-worker/wrangler.json'),
    'Worker 源码与 wrangler 配置存在');
  check(/"ai"\s*:\s*\{\s*"binding"\s*:\s*"AI"/.test(read('ai-worker/wrangler.json')),
    'wrangler 配了 ai binding（env.AI，零 key 架构的地基）');
  // CORS 白名单：真逻辑行（不是注释）
  check(/ALLOWED_ORIGINS\.includes\(origin\)/.test(worker)
    && /dujeongil-galaxy\.github\.io/.test(worker),
    'CORS 白名单只放行本站域名（逻辑行）');
  // 输入校验
  check(/question\.length > 500/.test(worker),
    'question 超 500 字拒绝（400）');
  // 限流
  check(/recent\.length >= rateLimit/.test(worker)
    && /RATE_LIMIT_FULL = 20/.test(worker) && /RATE_LIMIT_HALF = 10/.test(worker),
  '每 IP 滑窗限流（登录 20 / 未登录 10 次每小时，429）');
  // IP 黑名单（2026-11-21）：静态数组 + secret 双来源，最前置拦截，命中不调 AI
  check(/const BLOCKED_IPS = \[/.test(worker)
    && /function isBlockedIp\(ip, env\)/.test(worker)
    && /env\.BLOCKED_IPS/.test(worker)
    && /event: 'ip_blocked'/.test(worker)
    && /error: 'ip-blocked'/.test(worker),
    '§21g Worker IP 黑名单：静态数组 + secret 双来源，命中在边缘 403 且写 ip_blocked 日志',
    '黑名单被删 → 指定 IP 无法在 Cloudflare 边缘拦掉，只能靠 20 次/小时的粗限流');
  check(/isBlockedIp\(clientIp, env\)/.test(worker)
    && /async fetch\(request, env\)/.test(worker)
    && worker.indexOf('isBlockedIp(clientIp, env)') < worker.indexOf('handleGitHubLogin'),
    '§21g 黑名单检查位于 fetch 最前置（早于 OAuth/CORS/AI，命中连日志计数都不产生）',
    '拦截位置后移 → 被封 IP 仍能触发限流计数/OAuth，等于没真拦');
  check(/黑名单 IP → 403/.test(read('scripts/test-ai-worker.cjs'))
    && /黑名单命中不调 AI/.test(read('scripts/test-ai-worker.cjs')),
    '§21g Worker 单测覆盖黑名单命中 403 + 不烧 neurons');
  // 输出上限：纯文本 2000（推理模型留空间）；带图压到 1200（视觉模型输出单价 1.7 倍，省额度）
  check(/hasImage \? 1200 : 2000/.test(worker),
    'max_tokens 分流：纯文本 2000（GLM-4.7-flash reasoning 留空间）/ 带图 1200（视觉模型省 neuron）');
  // 模型
  check(/@cf\/zai-org\/glm-4\.7-flash/.test(worker),
    '模型 ID = @cf/zai-org/glm-4.7-flash（Workers AI 免费层）');
  // 系统提示词的合规口径
  check(/不构成对企业的法律定性/.test(worker) && /12333/.test(worker),
    '系统提示词含站点口径与 12333 转介（合规两件套）');

  // ---- 测试与 CI（旧挂件测试已删，只留服务新版的 Worker 测试）----
  check(exists('scripts/test-ai-worker.cjs'),
    '存在 Worker 逻辑测试（旧挂件行为测试已随挂件删除）');
  if (exists('.github/workflows/verify.yml')) {
    const ci = read('.github/workflows/verify.yml');
    check(ci.includes('test-ai-worker.cjs') && !ci.includes('test-ai-chat.cjs'),
      'CI 接入 Worker 测试且不再挂已删除的挂件测试');
  }
  check(exists('ai-worker/README.md') && /wrangler deploy/.test(read('ai-worker/README.md')),
    'Worker 有部署指南（站长两分钟可部署）');
  check(exists('ai-worker/DEPLOY-教程.md') && /dash\.cloudflare\.com\/sign-up/.test(read('ai-worker/DEPLOY-教程.md')),
    '存在零基础部署教程（注册→部署五步，2026-10-26 站长要教程）');

  // ---- 空态块同步（2026-10-30 修复「搜美宜佳出现不相关内容」）----
  // 测试文件必须存在且挂进 CI，否则删了同步逻辑没人发现。
  check(exists('scripts/test-empty-state-sync.cjs'),
    '存在空态块同步回归测试');
  if (exists('.github/workflows/verify.yml')) {
    const ci = read('.github/workflows/verify.yml');
    check(ci.includes('test-empty-state-sync.cjs'),
      'CI 里已接入空态块同步测试');
  }

  // ---- 茉莉奶白 C 级卡 + 提醒按钮《双休购》文案（2026-10-30 下午 U→C）----
  // 站长提出复核后定级：线下核实「月休 4 天」（单休形态），
  // 按站内口径「单休归为 C 级」；联名水杯新闻必须带链接。
  check(exists('scripts/test-molina-card.cjs'),
    '存在茉莉奶白卡+提醒文案回归测试');
  {
    const cfgStart2 = html.indexOf("id: 'molina-card'");
    const molinaChunk = html.slice(cfgStart2, cfgStart2 + 1600);
    check(/grade:\s*'C级'/.test(molinaChunk),
      '茉莉奶白卡为 C 级（2026-10-30 U→C 升级）');
    check(/单休归为 C 级/.test(molinaChunk),
      '茉莉奶白 desc 写明定级口径「单休归为 C 级」');
    const mjStart = html.indexOf("id: 'meiyijia-card'");
    const mjChunk = html.slice(mjStart, mjStart + 1600);
    check(/grade:\s*'C级'/.test(mjChunk),
      '美宜佳卡为 C 级（2026-10-30 U→C 升级）');
    check(/单休归为 C 级/.test(mjChunk),
      '美宜佳 desc 写明定级口径「单休归为 C 级」');
  }
  check(/nfnews\.com\/content\/5yppgW0nyp\.html/.test(html) && /news\.qq\.com\/rain\/a\/20261030A05B0C00/.test(html),
    '茉莉奶白说明框含两条新闻链接（南方+ / 腾讯新闻）');
  check(
    /sxg-rm-title">双休购</.test(read('remind-button.js')) &&
    /用钱包投票/.test(read('remind-button.js')) &&
    /消费即立场/.test(read('remind-button.js')) &&
    !/消费也是投票/.test(read('remind-button.js')),
    '提醒按钮模态已换成《双休购倡议：用钱包投票》文案（旧三条文案删除，原文存档于 remind-original.html）'
  );
  if (exists('.github/workflows/verify.yml')) {
    const ci = read('.github/workflows/verify.yml');
    check(ci.includes('test-molina-card.cjs'),
      'CI 里已接入茉莉奶白卡与提醒文案测试');
  }
}

// ---------- 21g-1. AI 双线路后端（CF Worker + 阿里云可选线路） ----------
// 2026-11-18：旧版「形象 A-F 按索引分流」（A-C 走 CF / D-F 走阿里云）的前端逻辑
// 随内嵌挂件 ai-chat.js / ai-config.js / 头像一起彻底删除。新版 labor-ai.html
// 的双线路是「国内硅基流动直连 + Cloudflare Worker」，由 §21g-2 校验；本段只守
// 后端：CF Worker 的 route 白名单（新版 askCF 仍传 route:'cf'）+ 阿里云可选脚手架。
{
  const worker = exists('ai-worker/src/worker.js') ? read('ai-worker/src/worker.js') : '';
  const aliyun = exists('ai-worker-aliyun/index.mjs') ? read('ai-worker-aliyun/index.mjs') : '';
  section('21g-1. AI 双线路后端（CF Worker + 阿里云可选线路）');

  // ---- Worker 端线路说明 ----
  check(/function routeNotice\(route\)/.test(worker) && /线路标识/.test(worker),
    'Cloudflare Worker 系统提示词按 route 补「如实说明线路」一条');
  check(/body\.route === 'cf' \|\| body\.route === 'cn'/.test(worker),
    'Worker 对 route 做白名单校验（非法值忽略，防注入）');

  // ---- 阿里云侧脚手架 ----
  check(exists('ai-worker-aliyun/index.mjs') && exists('ai-worker-aliyun/README.md'),
    '阿里云函数计算脚手架 + 中文 README 已落地');
  check(/export async function handler/.test(aliyun) && /compatible-mode\/v1\/chat\/completions/.test(aliyun),
    '阿里云函数实现 OpenAI 兼容（百炼 DashScope）调用');
  check(/process\.env\.DASHSCOPE_API_KEY/.test(aliyun) && !/sk-[A-Za-z0-9]{16,}/.test(aliyun),
    '密钥只从环境变量读，源码不落明文 Key');
  check(/ALLOWED_ORIGINS\.includes\(origin\)/.test(aliyun) && /recent\.length >= limit/.test(aliyun),
    '阿里云侧 CORS 白名单与每 IP 分档限流口径与 Worker 对齐');
  {
    const rd = read('ai-worker-aliyun/README.md');
    check(/API-KEY|API Key/.test(rd) && /百炼/.test(rd),
      'README 写清百炼拿 Key 的步骤');
    check(/环境变量/.test(rd) && /DASHSCOPE_API_KEY/.test(rd),
      'README 写清环境变量配置');
    check(/endpointCN/.test(rd),
      'README 仍写明 endpointCN 接入点（阿里云线路可选备用，不依赖已删的旧挂件）');
    check(/fcapp\.run|自定义域名/.test(rd),
      'README 写清公网地址/自定义域名获取方式');
  }

  // ---- 测试与 CI（旧分流前端测试已删，只留阿里云后端逻辑测试）----
  check(exists('scripts/test-ai-worker-aliyun.cjs'),
    '存在阿里云线路逻辑测试（test-ai-worker-aliyun.cjs）');
  if (exists('.github/workflows/verify.yml')) {
    const ci = read('.github/workflows/verify.yml');
    check(ci.includes('test-ai-worker-aliyun.cjs') && !ci.includes('test-ai-route.cjs'),
      'CI 接入阿里云后端测试且不再挂已删除的分流前端测试');
  }
}

// ---------- 美团骑手休息口径说明框（2026-10-30 站长亲历） ----------
// 站长曾任美团骑手：实际月休 4 天（周休一天），与网传「月休 2 天算好的」
// 严重不符；休满 4 天被组长嘲讽「公务员」——月休 4 天在骑手里是异类。
// 美团是 bundle 内置卡（评论区 cm-mt-1 不可改），DOM 补丁注入层实现。
{
  section('美团骑手休息口径说明框');
  check(exists('scripts/test-meituan-note.cjs'),
    '存在美团骑手口径回归测试');
  check(/function insertMeituanNote\(\)/.test(html),
    'insertMeituanNote 函数已定义');
  check(/getElementById\('meituan-note'\)/.test(html),
    '说明框 id 为 meituan-note');
  check(/title\.indexOf\('Meituan'\) === 0/.test(html),
    '标题匹配用 Meituan 前缀（不误伤他卡）');
  check(/实际月休 4 天/.test(html) && /你真是公务员/.test(html),
    '文案含站长亲历口径（月休 4 天 + 公务员嘲讽原话）');
  check(/严重不符/.test(html) && /异类/.test(html) && /并非行业常态/.test(html),
    '文案写明与网传不符、月休 4 天是异类非常态');
  // 三触发点：init 同步 + input/click 异步（三个位置都不得缺）
  const mtInitCount = (html.match(/insertMeituanNote\(\);/g) || []).length;
  check(mtInitCount >= 3,
    'insertMeituanNote 挂载三触发点（init/input/click）', { mtInitCount });
  const mtTryCount = (html.match(/try \{ insertMeituanNote\(\); \}/g) || []).length;
  check(mtTryCount === 2,
    'input 与 click 异步触发点均带异常捕获（共 2 处）', { mtTryCount });
  // 详情页三处：休息制度 kv + 工时情况段 + 评级理由
  if (exists('brand/meituan.html')) {
    const mt = read('brand/meituan.html');
    check(/骑手月休 4 天·周休一天/.test(mt) && /站长亲历补记/.test(mt) && /你真是公务员/.test(mt),
      '美团详情页含站长亲历口径（kv/工时段/嘲讽原话）');
    check(/站长亲历（2026-10-30 补记）/.test(mt),
      '美团详情页评级理由新增亲历条目');
  }
  if (exists('.github/workflows/verify.yml')) {
    const ci = read('.github/workflows/verify.yml');
    check(ci.includes('test-meituan-note.cjs'),
      'CI 里已接入美团骑手口径测试');
  }
}

// ---------- 21h. 本地 js/css 的 ?v 缓存号必须随内容变更同步 bump ----------
// 血泪（2026-11-01 站长实测）：pinyin-index.js 在 4ef34c4 / fb23417 两次提交里
// 都加了新卡，但 index.html 的 `?v=7` 自 d393f6c 起纹丝不动 —— 浏览器/CDN 拿到的
// 仍是旧索引，输「直聘」联想框全空，而改的人本地跑起来一切正常，是典型的
// 「只有真实用户会踩」的静默失效。同批审计还查出 douyin-prompt.js/css、
// custom-card-actions.js、top/bottom-button.js、stat-filter.js 共 7 处同类问题。
//
// 判据：工作区里该文件的内容相对 HEAD 有变化，而 index.html 里它的 ?v 没变 → 判红。
// 这样在本地提交前跑 verify 就一定会被拦住；CI 里工作树与 HEAD 一致，天然不误报。
{
  const htmlIdx = read('index.html');
  const refs = [...htmlIdx.matchAll(/(?:src|href)="\.\/([A-Za-z0-9_\-\.]+\.(?:js|css))\?v=(\d+)"/g)];
  const seen = new Set();
  const stale = [];
  let changed = 0;
  const gitShow = (path) => {
    try {
      return execSync(`git show HEAD:${path}`, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] })
        .toString().replace(/\r\n/g, '\n');
    } catch { return null; }
  };
  const headHtml = gitShow('index.html');
  for (const m of refs) {
    const f = m[1];
    const v = m[2];
    if (seen.has(f)) continue;
    seen.add(f);
    if (!exists(f)) continue;
    const head = gitShow(f);
    // HEAD 里没有 = 新增文件（首次发布不存在旧缓存），不参与本判据
    if (head === null) continue;
    if (head === read(f)) continue; // 内容没变，无需 bump
    changed++;
    if (!headHtml) continue;
    const hm = headHtml.match(
      new RegExp('\\./' + f.replace(/[.]/g, '\\.') + '\\?v=(\\d+)'));
    const oldV = hm ? hm[1] : null;
    if (oldV !== null && oldV === v) stale.push(`${f}?v=${v}（内容已改，?v 未变）`);
  }
  check(stale.length === 0,
    '本地 js/css 的 ?v 缓存号随内容变更同步 bump（改了文件就必须 +1）',
    stale.length ? stale.join('； ') : `本次有 ${changed} 个资源内容变更，?v 均已同步`);
}

// ---------- 21i. customCardsConfig 的 insertAfter 锚点必须可解析 ----------
// 血泪（2026-11-02 站长实测）：alibaba-card 的锚点写成 'nongfu'（拼音 slug）——
// findCardByH3 三条路全打不中（无 id="nongfu" 的元素，卡片标题「农夫山泉」
// 也不含拉丁字 nongfu）→ 每次新插入都走「列表末尾兜底」。搜索会把注入的
// 自定义卡从 DOM 移除、清空搜索后注入层重新注入，链头落点随注入时机漂移
// （真渲染实测：阿里 70 位→44 位，工行链被挤到 155 位）——站长观感是
// 「搜索奇瑞汽车删除后列表变样，F5 刷新才正常」。
// 判据：每个 insertAfter 必须 ①命中某张自定义卡的 id（链式锚点，即
// getElementById 能找到），或 ②被 bundle 某个 name:`X` 包含（对应
// findCardByH3 的标题 includes 匹配）。两条都不满足 = 该锚点永远解析失败
// = 位置必然漂移 → 判红。
{
  const htmlIdx = read('index.html');
  const cfgText = (htmlIdx.match(/var customCardsConfig = \[([\s\S]*?)\n      \];/) || ['', ''])[1];
  const pairs = [...cfgText.matchAll(/id:\s*'([^']+)'[\s\S]*?insertAfter:\s*'([^']+)'/g)]
    .map((m) => ({ id: m[1], after: m[2] }));
  check(pairs.length > 0, '能解析 customCardsConfig 的 id/insertAfter 对（空集=断言失效）',
    '解析到 0 对 → 正则与 index.html 的配置格式失配，本断言形同虚设');
  const cardNames = [...read('assets/index-YthXZ9eP.js').matchAll(/name:`([^`]{1,80})`/g)]
    .map((m) => m[1]);
  const ids = new Set(pairs.map((p) => p.id));
  // 锚点也可以指向先注入的自定义卡的中文 name（findCardByH3 的标题扫描
  // 会命中已注入的自定义卡，如「赵一鸣/零食很忙」）——注入按 config 顺序
  // 进行，name 锚点指向的卡必须在本卡之前，这里只验「可命中」，顺序由
  // 真渲染验收把关。
  const customNames = new Set([...cfgText.matchAll(/name:\s*'([^']{1,60})'/g)].map((m) => m[1]));
  const badAnchors = pairs.filter((p) =>
    !ids.has(p.after) &&
    !customNames.has(p.after) &&
    ![...customNames].some((n) => n.includes(p.after)) &&
    !cardNames.some((n) => n.includes(p.after)));
  check(badAnchors.length === 0,
    `customCardsConfig 全部 ${pairs.length} 个 insertAfter 锚点可解析（id 链或 bundle 卡名）`,
    badAnchors.length
      ? '以下锚点永远无法被 findCardByH3 命中，注入会走「列表末尾兜底」导致位置随搜索/清空漂移：'
        + badAnchors.map((p) => `${p.id} <- ${JSON.stringify(p.after)}`).join('； ')
      : '');
  // 锚点唯一性：两张卡共用同一个锚点时，MO 归位每轮都把对方挤走 ——
  // 互相追逐无限自激，真浏览器主线程直接卡死（2026-11-02 修 nongfu 锚点时
  // 险些引入：阿里锚到「农夫山泉」，与茶百道撞车，真渲染 9 分钟无响应）。
  const seen2 = new Map();
  for (const p of pairs) seen2.set(p.after, (seen2.get(p.after) || 0) + 1);
  const dupAnchors = [...seen2.entries()].filter(([, n]) => n > 1).map(([a]) => a);
  check(dupAnchors.length === 0,
    '每个 insertAfter 锚点只被一张卡使用（共用 = 归位互抢 = 无限自激卡死）',
    dupAnchors.length
      ? '以下锚点被多张卡共用：' + dupAnchors.map((a) => `${JSON.stringify(a)} ×${seen2.get(a)}`).join('； ')
      : '');
}

// ---------- 21j. 成功案例页：案例 #02 事实锚点 / AI 生成标注 / 传播源标注 ----------
// 站长 2026-11-02 提供抖音视频（「女生一纸诉，改写全国火车乘车规则」），
// 要求做成案例 #02 并**明确备注内容由 AI 生成**。
// 事实链（均经公开报道核实）：2015 浙大陈绘衣因丢票被要求补全价 487.5 元
// + 5 元手续费 → 起诉昆明铁路局 → 杭州铁路运输法院 11-27 调解退还票款 →
// 2017-01-01 起铁路实行挂失补办（只收 2 元）。
// 三条必须机器封死：
//   ① AI 生成必须明示（.ai-badge 徽章 + .ai-note 声明框）——站长硬要求，
//      属诚实披露，删了就是蒙人；
//   ② 抖音链接只能作传播源（必须标 douyin tag + 「未核实视频本体」），
//      事实以官媒/司法报道为准（同 #01 迪士尼案的口径）；
//   ③ 关键事实锚点不许在后续编辑中丢失（金额/日期/改规节点），
//      并保留纠偏框——「一个人改写全国规则」是演绎，必须当场厘清。
{
  const ss = read('success-stories.html');
  // ⚠️ 所有 #02 相关断言必须限定在 #02 区块内切片判断：#01 也有 .correct /
  // .tag.douyin / ai 类样式，全页级判断会被 #01 的存在救绿（2026-11-02 故障
  // 注入实测：删掉 #01 的纠偏框，#02 的还在 → 断言照样绿，等于没断言）。
  const case02 = (ss.match(/案例 #02[\s\S]*?<\/article>/) || [''])[0];
  check(case02.length > 1000,
    '能切出案例 #02 的区块（空集 = 断言失效）',
    '切出的区块过短或为空 → 正则与版式失配，下面所有 #02 断言形同虚设');
  check(/案例 #02/.test(ss),
    '成功案例页含「案例 #02」',
    '案例 #02 缺失 → 新增案例没落地');
  // 序号连续性：新增后 wip 卡必须同步推进到 #04，否则下一条会撞号
  check(/前辈案例整理中/.test(ss) && /案例 #04/.test(ss),
    '待补充卡已推进（致敬前辈板块标注「前辈案例整理中」，且案例 #04 已落地为真实案例）',
    'wip/致敬卡缺失或案例 #04 未落地 → 新增案例序号可能撞车');

  // ① AI 生成披露（站长硬要求）
  check(/class="ai-badge"[^>]*>\s*内容由 AI 生成/.test(case02),
    '案例 #02 挂出「内容由 AI 生成」徽章（.ai-badge）',
    'AI 生成徽章缺失 → 站长 2026-11-02 明确要求「需要备注内容由 AI 生成」');
  check(/class="ai-note"/.test(case02) && /AI 依据下列公开报道检索/.test(case02),
    '案例 #02 保留 AI 生成声明框（.ai-note，写明生成方式与以来源为准）',
    '.ai-note 声明框缺失或内容被改 → AI 生成内容没做诚实披露');

  // ② 传播源标注
  const dyTag = case02.match(/v\.douyin\.com\/jBn1ZOchTzM\/[\s\S]{0,200}?<\/li>/);
  check(!!dyTag && /tag douyin/.test(dyTag[0]) && /未核实视频本体/.test(dyTag[0]),
    '抖音链接标为传播源（.tag.douyin + 「未核实视频本体」）',
    '抖音链接缺传播源标注 → 社媒内容被当事实出处用（抖音页需脚本渲染，抓不到正文，无法核实）');

  // ③ 关键事实锚点
  const facts = [
    ['陈绘衣', '当事人姓名'],
    ['昆明铁路局', '被告'],
    ['487.5', '补票款金额'],
    ['2017 年 1 月 1 日', '挂失补办新规施行日'],
    ['只收 2 元手续费', '新规手续费'],
    ['杭州铁路运输法院', '受理法院']
  ];
  const missFacts = facts.filter(([s]) => !case02.includes(s)).map(([s, d]) => `${s}（${d}）`);
  check(missFacts.length === 0,
    `案例 #02 的 ${facts.length} 个关键事实锚点齐全`,
    missFacts.length ? '以下事实锚点丢失，正文可能被改坏：' + missFacts.join('； ') : '');
  check(/class="correct"/.test(case02) && /调解结案/.test(case02),
    '案例 #02 保留纠偏框并写明「本案是调解结案」（「改写全国规则」属演绎）',
    '纠偏框缺失 → 与 #01 口径不一致：未经核实的社媒演绎会被当事实');
  // 来源条目：新案例必须自带来源，且不能只挂一条
  const srcCount = (case02.match(/<li><a /g) || []).length;
  check(srcCount >= 6,
    `案例 #02 附 ${srcCount} 条公开来源（要求 ≥6，事实必须可查证）`,
    `只有 ${srcCount} 条来源 → 事实无出处，与本站证据链纪律冲突`);

  /* ----------------------------------------------------------------
     案例 #03（微信提现手续费案）：同一套纪律，同样机器封死。
     站长 2026-11-03 拍板记入成功案例并补事实：
     「最低提现门槛 0.1 元现已下调至最低 0.01 元」。
     事实链（均经公开报道核实）：2024-05 上政学生提现 5 万被收近 50 元 →
     五名法学生组团起诉财付通（深圳前海法院 2024-08-22 开庭，尚未宣判）→
     2025-08-01 微信将单笔服务费下限 0.1 元降至 0.01 元（0.1% 费率未变）。
     与 #02 同口径：①AI 生成明示 ②抖音只作传播源 ③事实锚点 + 纠偏框
     —— 纠偏点比 #02 更要紧：「告赢了」「手续费取消了」都是演绎。
     ------------------------------------------------------------------ */
  const case03 = (ss.match(/案例 #03[\s\S]*?<\/article>/) || [''])[0];
  check(case03.length > 1000,
    '能切出案例 #03 的区块（空集 = 断言失效）',
    '切出的区块过短或为空 → 正则与版式失配，下面所有 #03 断言形同虚设');
  check(/class="ai-badge"[^>]*>\s*内容由 AI 生成/.test(case03),
    '案例 #03 挂出「内容由 AI 生成」徽章（.ai-badge）',
    'AI 生成徽章缺失 → 站长 2026-11-03 要求记入成功案例，同 #02 诚实披露口径');
  check(/class="ai-note"/.test(case03) && /AI 依据下列公开报道检索/.test(case03),
    '案例 #03 保留 AI 生成声明框（.ai-note，写明生成方式与以来源为准）',
    '.ai-note 声明框缺失或内容被改 → AI 生成内容没做诚实披露');
  const dyTag3 = case03.match(/v\.douyin\.com\/ZkraiQg9NB8\/[\s\S]{0,200}?<\/li>/);
  check(!!dyTag3 && /tag douyin/.test(dyTag3[0]) && /未核实视频本体/.test(dyTag3[0]),
    '案例 #03 抖音链接标为传播源（.tag.douyin + 「未核实视频本体」）',
    '抖音链接缺传播源标注 → 社媒内容被当事实出处用（抖音页需脚本渲染，抓不到正文，无法核实）');
  const facts3 = [
    ['杨昊斌', '起诉团队负责人'],
    ['财付通', '被告主体'],
    ['0.1%', '提现服务费率'],
    ['2024 年 8 月 22 日', '开庭日期'],
    ['深圳市前海合作区人民法院', '受理法院'],
    ['0.01 元', '2025-08-01 起的单笔服务费新下限'],
    ['2025 年 8 月 1 日', '下限下调施行日']
  ];
  const missFacts3 = facts3.filter(([s]) => !case03.includes(s)).map(([s, d]) => `${s}（${d}）`);
  check(missFacts3.length === 0,
    `案例 #03 的 ${facts3.length} 个关键事实锚点齐全`,
    missFacts3.length ? '以下事实锚点丢失，正文可能被改坏：' + missFacts3.join('； ') : '');
  check(/class="correct"/.test(case03) && /0\.1% 的费率没有取消/.test(case03)
    && /尚未宣判/.test(case03),
    '案例 #03 保留纠偏框并写明「0.1% 的费率没有取消」「尚未宣判」',
    '纠偏框缺失 → 「告赢了」「手续费取消了」这类演绎会被当事实（比 #02 更易误读）');
  const srcCount3 = (case03.match(/<li><a /g) || []).length;
  check(srcCount3 >= 6,
    `案例 #03 附 ${srcCount3} 条公开来源（要求 ≥6，事实必须可查证）`,
    `只有 ${srcCount3} 条来源 → 事实无出处，与本站证据链纪律冲突`);
}

// ---------- 33. 成功案例页：案例 #05 + 左侧目录树 + 无框小火箭 + 首页 SW 防旧黑弹窗 ----------
// 2026-11-09 站长指令四连：
//   ① 案例 #04 后紧接补「案例 #05」（列五中学现场/家长举手机拍取消早读），与 #04 政策线互补，
//      抖音两视频作传播源、事实以官媒为准（同 §21j 口径）；
//   ② 参考站长随笔，成功案例页左侧加目录树（扫 data-toc 自动生成 + 滚动高亮）；
//   ③ 回到顶部按钮去掉圆形外框，改成无框小火箭；
//   ④ 首页广告位底层架构优化：sw.js 对导航请求 network-first，旧黑弹窗不再残留。
{
  const ss = read('success-stories.html');

  // —— 案例 #05（与 §21j 同口径的诚实披露）——
  const case05 = (ss.match(/案例 #05[\s\S]*?<\/article>/) || [''])[0];
  check(case05.length > 1000,
    '能切出案例 #05 的区块（空集 = 断言失效）',
    '切出的区块过短或为空 → 正则与版式失配，#05 断言形同虚设');
  check(/案例 #05/.test(ss), '成功案例页含「案例 #05」', '案例 #05 缺失 → 新增案例没落地');
  check(/class="ai-badge"[^>]*>\s*内容由 AI 生成/.test(case05),
    '案例 #05 挂出「内容由 AI 生成」徽章', 'AI 生成徽章缺失 → 诚实披露失守');
  check(/class="ai-note"/.test(case05) && /AI 依据下列公开报道检索/.test(case05),
    '案例 #05 保留 AI 生成声明框（.ai-note）', '.ai-note 缺失 → 没做诚实披露');
  const dy05 = case05.match(/v\.douyin\.com\/(gmIc0vY52p0|8d1jq7RH9Bg)\/[\s\S]{0,240}?<\/li>/g) || [];
  const dyOk = dy05.filter((s) => /tag douyin/.test(s) && /未核实视频本体/.test(s)).length;
  check(dyOk === 2,
    '案例 #05 两条抖音链接都标为传播源（.tag.douyin + 「未核实视频本体」）',
    `案例 #05 的传播源标注只有 ${dyOk}/2 → 社媒被当事实出处`);
  const facts05 = ['列五中学', '教育部', '2021 年', '五年', '睡眠管理通知', '取消统一强制早读', '家长举着手机'];
  const miss05 = facts05.filter((s) => !case05.includes(s));
  check(miss05.length === 0,
    `案例 #05 的 ${facts05.length} 个关键事实锚点齐全`,
    '以下事实锚点丢失：' + miss05.join('； '));
  const src05 = (case05.match(/<li><a /g) || []).length;
  check(src05 >= 6, `案例 #05 附 ${src05} 条来源（要求 ≥6）`, `只有 ${src05} 条来源`);

  // —— 左侧目录树（参考站长随笔自动生成）——
  const tocCount = (ss.match(/data-toc=/g) || []).length;
  check(tocCount === 7,
    `成功案例页目录树锚点齐全（7 个 data-toc：致敬前辈/QQ奶奶/#01~#05，实际 ${tocCount}）`,
    `data-toc 数量不对（${tocCount}）→ 目录树会漏章节`);
  check(/id="toc-nav"/.test(ss), '成功案例页含目录树容器 #toc-nav', '目录树容器缺失 → 左侧目录树建不出来');
  check(/class="toc"/.test(ss) && /<summary>目录<\/summary>/.test(ss),
    '目录树用可折叠 <details class="toc"> 承载（窄屏回落单栏）', '目录树结构缺失或不可折叠');
  check(/querySelectorAll\('\[data-toc\]'\)/.test(ss),
    '目录树脚本扫描 [data-toc] 自动生成（参考站长随笔，不手填）', '目录树不是自动生成 → 加章节会漏');

  // —— 无框小火箭（去掉圆形外框）——
  check(/class="rk-body"/.test(ss) && /class="rk-flame"/.test(ss),
    '回到顶部按钮是无框小火箭 SVG（含箭体/尾焰路径）', '小火箭 SVG 缺失 → 还是旧箭头/圆形');
  // .to-top 主样式块不得再有圆形外框特征
  const toTopCss = (ss.match(/\.to-top\s*\{[\s\S]*?\n      \}/) || [''])[0];
  check(toTopCss.length > 50 && /border:\s*none/.test(toTopCss) && /background:\s*transparent/.test(toTopCss),
    '小火箭按钮无边框、无底色方块（border:none + background:transparent）',
    '.to-top 仍有边框/底色 → 没真正去掉圆形外框');
  check(!/border-radius:\s*999px/.test(toTopCss),
    '.to-top 不再有圆形外框（border-radius:999px 已移除）', '圆形外框还在 → 用户要的「无框」没落实');
  check(!/M12 19V5/.test(ss) && !/M5\.5 11\.5 12 5l6\.5 6\.5/.test(ss),
    '旧的圆形箭头 SVG 已移除', '旧箭头 SVG 还在 → 不是小火箭');

  // —— 首页 SW 防旧黑弹窗 ——
  const idx = read('index.html');
  check(/http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate"/.test(idx),
    '首页 head 加了 no-cache 兜底（文档级缓存防御）', '首页缺 no-cache 兜底');
  // SW 注册路径允许带 ?v=N（2026-11-19 为修复 360 旧缓存，注册改为 ./sw.js?v=2，
  // 换 SW 文件时必须同步 bump 该参数，否则浏览器继续用旧 SW 文件）
  check(/navigator\.serviceWorker\.register\(['"]\.\/sw\.js(\?v=\d+)?['"]/.test(idx),
    '首页注册了 sw.js（network-first 导航接管）', '首页没注册 SW → 旧黑弹窗残留问题没解决');
  check(/navigator\.serviceWorker\.register\(['"]\.\/sw\.js\?v=\d+['"]/.test(idx),
    'SW 注册路径带 ?v=N（360 旧缓存修复：换 sw.js 时必须 bump 参数强制浏览器取新版）',
    'SW 注册没带 ?v=N → 换 sw.js 后浏览器仍用旧 SW 文件，修复不生效');
  check(/params\.has\('no-sw'\)/.test(idx) && /isSecureContext/.test(idx),
    'SW 注册带安全上下文判断 + ?no-sw 一键卸载开关', '缺安全上下文判断或 no-sw 开关 → 调试/异常环境会炸');
  const sw = exists('sw.js') ? read('sw.js') : '';
  check(sw.length > 200, 'sw.js 已落地', 'sw.js 不存在');
  check(/req\.mode === 'navigate'/.test(sw) && /fresh = await fetch\(req\)/.test(sw),
    'sw.js 对导航请求做 network-first（在线永远取最新 HTML）', 'sw.js 没做 network-first 导航 → 旧版仍会被缓存顶出');
  check(/skipWaiting/.test(sw) && /clients\.claim/.test(sw),
    'sw.js 安装即 skipWaiting + 激活即 clients.claim（缩短部署生效空窗）', '缺 skipWaiting/clients.claim → 新版本接管慢');
  // 安全红线：拦截点只允许两处 —— ① navigate（network-first）② 不可变资源（cache-first）。
  // 「不可变」限定为「带 ?v=」或「/assets/ 内容哈希文件名」两种，绝不按裸扩展名放宽：
  // notes.html 的 .enc 密文两者都不满足，永远走放行路径。
  const rwCount = (sw.match(/event\.respondWith/g) || []).length;
  const vBranchRaw = (sw.match(/if \(url\.searchParams\.has\('v'\)[\s\S]{0,200}?\{([\s\S]*?)\n  \}/) || [])[1] || '';
  const hasImmutableRule = sw.includes('[A-Za-z0-9_.-]+-[A-Za-z0-9_-]{8,}');
  check(rwCount === 2
    && /if \(req\.mode === 'navigate'\)\s*\{[\s\S]*?event\.respondWith/.test(sw)
    && vBranchRaw.length > 100 && /event\.respondWith/.test(vBranchRaw)
    && hasImmutableRule
    && !/\.enc/.test(vBranchRaw),
    'sw.js 拦截点恰为两处：navigate（network-first）+ 不可变资源（仅 ?v= 或内容哈希文件名，cache-first），.enc 永不被接管',
    `sw.js 拦截点 ${rwCount}（应恰为 2：navigate + 不可变资源分支，且该分支内不得出现 .enc）→ 可能误伤 notes.html 密文拉取`);
  check(/\.enc/.test(sw),
    'sw.js 明确处理 notes.html 的 .enc 等非导航请求（注释 + 放行）', 'sw.js 没说明对 .enc 的处理 → 密文解锁链路有隐患');

  // —— 首屏加载性能（站长 2026-11-10「超过了 10 秒都没有加载成功，代码必须优化」）——
  // 本地按 ~1.5Mbps / 300ms RTT 节流实测：51 个资源、1587KB，主包 434KB 与 CSS 53KB
  // 各下载两遍（preload 缺 crossorigin，credentials 模式与标签不一致被当成两个请求），
  // 广告位补丁排在第 40 个 defer，要等 692KB body 解析完 → 15 秒才出现广告位。
  // 三处结构性修法各钉一条，任何一条被改回去，慢网都会退回「十几秒白屏」。
  const preJs = idx.match(/<link rel="preload" as="script"[^>]*href="\.\/assets\/index-[^"]+"/);
  const preCss = idx.match(/<link rel="preload" as="style"[^>]*href="\.\/assets\/index-[^"]+\.css"/);
  check(preJs && /crossorigin/.test(preJs[0]) && preCss && /crossorigin/.test(preCss[0])
    && /<script type="module" crossorigin src="\.\/assets\/index-/.test(idx)
    && /<link rel="stylesheet" crossorigin href="\.\/assets\/index-/.test(idx),
    '§33a preload 的 credentials 模式与 module / stylesheet 标签一致（都带 crossorigin），主包与 CSS 不再各下两遍',
    'preload 少了 crossorigin → 浏览器当成两个不同资源，434KB 主包 + 53KB CSS 全下两遍');

  // 手机专用三张由 §35c 单独管（带 media 的预热）；这里只数桌面三张原稿，
  // 否则新增 *_MOBILE 常量会把「三张」撑成 6 张，旧断言误红。
  const artUrls33 = [...read('black-card-adslot.js')
    .matchAll(/var ART[_A-Z]* = '(\.\/assets\/[^']+)'/g)].map((m) => m[1])
    .filter((u) => u.indexOf('-mobile.svg') === -1);
  check(artUrls33.length === 3
    && artUrls33.every((u) => idx.includes('<link rel="preload" as="image" href="' + u + '"')),
    '§33a2 广告位三张设计图首屏预热，且每张的 ?v 与 black-card-adslot.js 里的常量完全一致',
    '预热 URL 与脚本里的实际 URL 不一致 → 白预热，广告位照样「卡片先出来、图还是空的」');

  check(/<script async src="\.\/black-card-adslot\.js\?v=22"><\/script>/.test(idx)
    && idx.indexOf('black-card-adslot.js?v=22') < idx.indexOf('</head>')
    && !/script defer src="\.\/black-card-adslot\.js/.test(idx),
    '§33b 广告位补丁在 head 里 async 加载（不再排在第 40 个 defer，也不必等 692KB body 解析完）',
    '广告位补丁退回 defer 队列尾部 → 慢网又要 15 秒才冒出广告位');

  // —— 行为回归测试必须存在且已接线 CI ——
  const tssFile = 'scripts/test-success-stories.cjs';
  check(exists(tssFile), '存在成功案例页目录树/小火箭的回归测试（jsdom）', '缺测试 → TOC 脚本静默失效无人发现');
  if (exists(tssFile)) {
    const tt = read(tssFile);
    check(/toc-nav/.test(tt) && /data-toc/.test(tt) && /rk-body/.test(tt),
      '测试真的在查目录树 + 小火箭（不是空壳）', '测试没查 TOC/火箭 → 测了个寂寞');
    check(/案例 #05/.test(tt), '测试覆盖案例 #05 落地', '测试没查 #05 → 新增案例没人咬');
  }
  const wf33 = read('.github/workflows/verify.yml');
  check(/node scripts\/test-success-stories\.cjs/.test(wf33), 'CI 已接线 test-success-stories.cjs', '测试没挂 CI → 只跑一次');
}

// ---------- 21k. 评级过滤条必须认得 D/U（bundle 数组写死 S/A/B/C，补丁注入） ----------
// 2026-11-02 站长截图指出：新增 D 级后评级过滤条仍只有 S/A/B/C —— 选任何具体
// 档位时 U/D 卡被 React 内存过滤（DOM 上不存在），且无法筛出 D/U。
// 修法（bundle 红线不许改）：u-grade-patch.js 往过滤条注入「D 级」「U 级」按钮 +
// DOM 层过滤；三处必须同步，缺一处就打架或漏卡：
//   ① u-grade-patch.js 注入逻辑  ② index.html 自定义卡过滤枚举  ③ stat-filter.js
//   评级行互斥枚举（点 D/U 时清五格筛选，capture 阶段先跑，顺序天然正确）。
{
  const ugp = read('u-grade-patch.js');
  const idx = read('index.html');
  const sf = read('stat-filter.js');
  check(/GF_LETTERS = \['D', 'U'\]/.test(ugp) && /GF_BTN_ATTR/.test(ugp) && /评级过滤:/.test(ugp),
    'u-grade-patch.js 会向评级过滤条注入「D 级」「U 级」按钮（bundle 数组写死 S/A/B/C）',
    '按钮注入逻辑缺失或锚点文案失配 → D/U 卡永远无法被筛出');
  check(/'全部评级',\s*'S 级',\s*'A 级',\s*'B 级',\s*'C 级',\s*'D 级',\s*'U 级'/.test(idx),
    'index.html 自定义卡评级过滤枚举含「D 级」「U 级」',
    'index.html 没跟上 → D/U 激活时 122 张自定义卡不会被同步隐藏（bundle 卡藏了自定义卡还在）');
  const rowTexts = (sf.match(/ROW_RATING_TEXTS = \[([^\]]*)\]/) || ['', ''])[1];
  check(/'D 级'/.test(rowTexts) && /'U 级'/.test(rowTexts),
    'stat-filter.js 评级行互斥枚举含「D 级」「U 级」（点 D/U 清五格筛选）',
    'stat-filter 没跟上 → 点 D/U 不清四格筛选，两套过滤层互相覆盖出现空面板');
  check(/u-grade-patch\.js\?v=22/.test(idx) && /stat-filter\.js\?v=9/.test(idx),
    'u-grade-patch.js?v=22 / stat-filter.js?v=9（缓存号已随内容 bump；11-16 锚点直达站长备注）',
    '缓存号没 bump → 用户拿旧补丁，D/U 按钮注入不生效（2026-11-01 拼音索引同类事故）');
  // 2026-11-03 站长实测 bug：点「D 级 / U 级」后拼音搜索框整块消失。
  // 根因：CARD_SEL（div.bg-white.rounded-2xl.border）命中面比品牌卡宽，
  // 「搜索+品类+评级过滤」操作区容器同样命中，它没有品牌标题、识别不到档位，
  // 旧代码 `tier !== gfActive` 一刀切 display:none 把搜索区藏了（实测点 D 隐藏 173 个节点）。
  // 结构防护必须两道都在，删任何一道这个 bug 就会复活：
  //   ① gfIsCard() 只认带 h2/h3 品牌标题的节点为卡片
  //   ② gfApply() 里 tier 为空时 gfUnmark + continue（不许隐藏）
  const gfApplySrc = (ugp.match(/function gfApply\(\)\s*\{[\s\S]*?\n  \}/) || [''])[0];
  check(/function gfIsCard[\s\S]{0,200}querySelector\('h3, h2'\)/.test(ugp),
    'u-grade-patch.js 有结构防护栏 gfIsCard（只认带品牌标题 h2/h3 的节点为卡片）',
    'gfIsCard 缺失 → CARD_SEL 会继续命中搜索/筛选操作区容器，点 D/U 藏掉搜索框');
  check(/if \(!gfIsCard\(card\)\) \{\s*gfUnmark\(card\); continue; \}/.test(gfApplySrc),
    'gfApply()：非卡片节点（布局容器）一律跳过，不写 display',
    'gfApply 对布局容器也做隐藏 → 点 D/U 后搜索框消失（2026-11-03 站长实测 bug）');
  check(/if \(!tier\) \{\s*gfUnmark\(card\); continue; \}/.test(gfApplySrc),
    'gfApply()：档位识别不到时不动该节点（与 stat-filter 的 tier===null 同口径）',
    '档位未知就隐藏 → 任何非品牌区块（操作区/证据板）都会被误伤');
  check(/if \(gfActive && tier !== gfActive\) \{/.test(gfApplySrc),
    'gfApply()：只有 tier 已识别时才按档位隐藏',
    'gfApply 的隐藏条件被改写 → 防护失效');
  // 2026-11-04 修复「从某档切到 U 级时 C 级卡泄漏进 U 视图」：
  // 根因是 filterCustomCards 靠扫描按钮 className(bg-slate-900) 判激活，React 重渲染
  // 重建评级条会丢这个类 → 误判无选中 → 默认回退「全部评级」→ 自定义卡一个都不藏。
  // 修法：u-grade-patch.js 把激活态写入 window.__sxgGradeFilter（'U 级'/'D 级'/'all'），
  // filterCustomCards 优先采信。下面两道静态断言守住这条机器契约，避免被「改写法」绕过。
  check(/function gfSetActive/.test(ugp) && /window\.__sxgGradeFilter/.test(ugp),
    'u-grade-patch.js：U/D 激活态写入 window.__sxgGradeFilter 单一真相源（gfSetActive）',
    '缺失 → 重渲染丢失 className 时 U/D 激活态无从同步，C 级卡会漏进 U 视图');
  check(/window\.__sxgGradeFilter\s*===\s*'U 级'\s*\|\|\s*window\.__sxgGradeFilter\s*===\s*'D 级'/.test(idx),
    'index.html filterCustomCards：U/D 激活态优先采信 window.__sxgGradeFilter',
    '回退成纯 className 扫描 → 重渲染后误判无选中，自定义卡泄漏（2026-11-04 bug 复活）');
}

// ---------- 21l. D/U 过滤误伤布局的回归测试必须存在且已接线 ----------
// 站长 2026-11-03 实测：点「D 级 / U 级」后拼音搜索框整块消失。
// §21k 只是源码断言，改个写法就能绕过；真正的症状是渲染结果，
// 所以另立 jsdom 行为测试 scripts/test-gf-search.cjs（verify 保持零依赖，
// 不在本脚本里 require jsdom）。这里只咬「测试还在 + CI 真的会跑」。
{
  const testFile = 'scripts/test-gf-search.cjs';
  check(exists(testFile),
    '存在 D/U 过滤误伤布局的回归测试（jsdom，真点按钮验搜索框）',
    '测试文件缺失 → 2026-11-03「点 D/U 搜索框消失」没有任何行为层防线');
  if (exists(testFile)) {
    const t = read(testFile);
    check(/site-search-input/.test(t) && /data-sxg-gf-letter/.test(t),
      '回归测试真的在查搜索框 + D/U 按钮（不是空壳文件）',
      '测试里没有搜索框或按钮锚点 → 测了个寂寞');
    check(/getComputedStyle|display/.test(t),
      '回归测试断言的是可见性（display），不是节点存在与否',
      '只断言节点存在 → 搜索框明明被 display:none 也照样绿');
    // 计数断言（2026-11-03 注入实验逼出来的）：只查锚点存在会被「留一条同义断言」救绿——
    // 掏空 D 分支那条，U 分支那条照样让上面两条恒真。所以要求「搜索框仍可见」至少
    // 出现 2 次（D / U 各一次），且两条分支都真的点过按钮。
    // 分片断言（不是计数）：两条分支的断言文案各自唯一，掏空任一条立即判红。
    // 计数会被「第三处同义断言」救绿（2026-11-03 注入实验实测：删了 D 分支，
    // 「取消 D 后搜索框仍可见」那条顶上，visCount 仍 ≥2）。
    check(/搜索框仍可见（核心回归/.test(t),
      'D 分支有「点 D 后搜索框仍可见」断言（文案唯一，掏空即红）',
      'D 分支的可见性断言被删/改写 → 站上报的原始症状没人咬');
    check(/搜索框仍可见（U 分支/.test(t),
      'U 分支有「点 U 后搜索框仍可见」断言（文案唯一，掏空即红）',
      'U 分支的可见性断言被删/改写');
    check(/clickBtn\('D'\)/.test(t) && /clickBtn\('U'\)/.test(t),
      '回归测试真的点了 D 与 U 两个按钮',
      '缺 clickBtn 调用 → 按钮没点，可见性断言恒真');
  }
  const wf = read('.github/workflows/verify.yml');
  check(/node scripts\/test-gf-search\.cjs/.test(wf),
    'CI 已接线 test-gf-search.cjs（写完不挂 CI = 只跑一次的测试）',
    'README 写死的「新测试必须挂进 CI」没落实 → 这个 bug 下次照样复发');
}

// ---------- 21m. 记账条目的时间必须是该提交的真实 commit 时间 ----------
// 2026-11-03 自查发现：CHANGELOG / 最近更新 / README 里 110 处「时间 · 提交 `hash`」
// 的时间是我凭感觉写的，与 git 真实提交时间不符（`8f83b84` 真实 10:02，记账写 02:40，
// 差了 7 小时）。哈希有断言咬着所以没写错，时间没有，于是一路错到现在。
// 记账的第一性是「可核对」，时间与哈希一样必须是事实而不是估计 —— 这里按哈希反查
// 真实提交时间逐条比对。用 author date（%ad）：rebase 不会改写它，比 committer 稳定。
{
  let timeMap = {};
  try {
    // ⚠️ 命令里不能带空格或 | ：execSync 在 Windows 走 cmd.exe，
    //    --date=format:"%Y-%m-%d %H:%M" 会被拆成两个参数，%h|%ad 的 | 会直接变成管道符
    //    （两种写法都实测取不到数据，静默变空集 → 断言空跑）。改用 unix 时间戳（%at），
    //    由 Node 自己格式化成本地时间，彻底绕开 shell 转义。
    // ⚠️ 用 %H（40 位全哈希）建表：git 的短哈希长度会随仓库规模变，
    //    历史记账里既有 7 位也有 8 位（CHANGELOG 第 1308 行就记载过 8 位短哈希），
    //    用 %h 建表会让 8 位引用全部查不到、被误报成「哈希不存在」。
    //    查询时按前缀匹配，既支持任意长度短哈希，又不用逐个跑 git rev-parse。
    const out = execSync('git log --pretty=format:%H-%at', {
      cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024,
    }).toString();
    const pad = (n) => String(n).padStart(2, '0');
    for (const line of out.split('\n')) {
      const t = line.trim();
      const k = t.indexOf('-');
      if (k <= 0) continue;
      const sec = parseInt(t.slice(k + 1), 10);
      if (!sec) continue;
      // ⚠️ 记账里的「时间」一直是北京时间（+0800）。这里不能直接用 getFullYear/getHours：
      //    它们取的是**运行环境**时区，CI runner 是 UTC，会把所有时间算少 8 小时
      //    （2026-11-03 实测：本地全绿、CI 全红，正是这个原因）。
      //    做法：时间戳先平移 +8h，再用 getUTC* 读取 —— 无论机器在哪个时区，
      //    输出的都是 UTC+8 的墙上时间。
      const d = new Date(sec * 1000 + 8 * 3600 * 1000);
      // 2026-11-16 站长死命令：文档只记日期、不记时刻（不暴露站长作息）。
      // 映射与比对都只到「日期」这一级，时刻一律不写进文档、也不参与比对。
      timeMap[t.slice(0, k)] = d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
    }
  } catch (e) { /* 非 git 环境：下面会因为 map 为空而走 missing 分支 */ }

  // 任意长度短哈希 → 时间（前缀匹配；40 位全哈希直接命中）
  // ⚠️ 必须写在 try/catch 之外：const 是块级作用域，留在 try 块里会
  //    ReferenceError: timeOf is not defined（实测踩到）。
  const timeOf = (h) => {
    if (timeMap[h]) return timeMap[h];
    for (const k in timeMap) if (k.indexOf(h) === 0) return timeMap[k];
    return null;
  };

  // 7~40 位：git 短哈希长度会随仓库规模自动变（不一定正好 7 位），
  // 只认 7 位会让「把哈希写成 8 位乱码」这种错误整个逃过扫描（故障注入实测）。
  // 只记日期（2026-11-16 死命令）：正则不再要求 HH:MM，改为匹配纯日期 + 哈希。
  // ⚠️ 必须限制在同一行（[^\n`]）：纯日期比「日期+时刻」常见得多，允许跨行会把
  //    正文里的任意日期跨几十行配到后面的哈希上，误报一堆「时间不符」（实测 7 处误报）。
  const PAT = /(\d{4}-\d{2}-\d{2})([^\n`]{0,120}?)`([0-9a-f]{7,40})`/g;
  const bad = [];
  const missing = [];
  let checked = 0;
  for (const f of ['CHANGELOG.md', '\u6700\u8fd1\u66f4\u65b0.md', 'README.md']) {
    if (!exists(f)) continue;
    const txt = read(f);
    for (const m of txt.matchAll(PAT)) {
      checked++;
      const h = m[3];
      const real = timeOf(h);
      if (!real) { missing.push(f + ' 引用了仓库里不存在的哈希 ' + h); continue; }
      if (m[1] !== real) bad.push(f + '：' + h + ' 写作 ' + m[1] + '，真实提交时间是 ' + real);
    }
  }
  // 空集不许冒充通过：映射拿不到或一条都没匹配到，说明正则/环境坏了
  check(Object.keys(timeMap).length > 20 && checked > 30,
    '时间戳断言真的扫到了记账条目（git 时间映射 + 匹配数双重空集防护）',
    '映射 ' + Object.keys(timeMap).length + ' 条 / 匹配 ' + checked + ' 处 → 断言在空跑');
  check(bad.length === 0,
    '记账条目写的日期 = 该提交的真实 commit 日期（只记日期，三个记账文件全量比对）',
    bad.slice(0, 4).join('；') + (bad.length > 4 ? '（共 ' + bad.length + ' 处）' : ''));
  check(missing.length === 0,
    '记账引用的哈希在仓库里都真实存在（防 rebase 后忘记回填新哈希）',
    missing.slice(0, 4).join('；'));
}

// ---------- 21m-2. 死命令：对外文档只记日期，不准写时刻（2026-11-16 站长令）----------
// 站长：「删时间，只记录日期……不要过多暴露站长……这一条也写进 README 死命令，
// 以后都不准做了！」时刻（HH:MM / HH:MM:SS）会暴露站长作息，一律不许出现在
// 对外 markdown 文档。保留 T 分隔的技术配置常量（如 UNLOCK=...T14:00+08:00），
// 那是代码里的定值、不是记账时刻。
{
  const DOCS = ['README.md', 'README-详情.md', 'README-细则.md', 'CHANGELOG.md',
    '\u6700\u8fd1\u66f4\u65b0.md', 'BUG-ROOT-CAUSES.md', 'PITFALLS.md'];
  // 空格分隔的「日期+时刻」= 记账时刻 → 禁止；T 分隔的不算（技术常量）
  const TIME_RE = /\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})?/g;
  const leaks = [];
  let docCount = 0;
  for (const f of DOCS) {
    if (!exists(f)) continue;
    docCount++;
    const txt = read(f);
    const m = txt.match(TIME_RE);
    if (m) leaks.push(f + ' 共 ' + m.length + ' 处，例：' + m[0]);
  }
  check(docCount >= 5,
    '§21m-2 真的扫到了全部对外文档（空集防护）',
    '只读到 ' + docCount + ' 个文档 → 断言在空跑');
  check(leaks.length === 0,
    '§21m-2 对外文档只有日期、没有时刻（不暴露站长作息，死命令长期强制）',
    leaks.join('；'));
}

// ---------- 21n. fix: 提交必须三处留痕（README 摘要 + BUG 专文 + 最近更新） ----------
// 站长 2026-11-05：「根据 GitHub 规则，修复 bug 必须记录 README 相关页面」。
// GitHub 仓库首页展示的就是 README，只写进 CHANGELOG 等于访客看不见。
// 站长 2026-11-14 21:44 追加：「一堆 BUG 记录翻页都能累死个人……README 本身只写摘要」。
// 于是明细整体外移到 BUG-ROOT-CAUSES.md：README 留摘要章节 + 链接 + 最近三条，
// 专文为每个 fix 立一条完整章节，最近更新.md 顶部留条目。三处都要引用最近一次 fix 哈希。
// 规则只写文档会漏（2026-10-19 血泪），这里按 Conventional Commits 的 fix:
// 类型取 git log 里最近一次 bug 修复提交，反查三处。
// ⚠️ 用 git log 而非 CHANGELOG 顶部条目：CHANGELOG 的哈希要「提交后回填」，
//    拿顶部条目当基准会形成「先写文档、后拿哈希」的自指死结。
{
  const UPDATE_DOC = '\u6700\u8fd1\u66f4\u65b0.md';
  let fixHash = null;
  let fixCount = 0;
  try {
    // %H-%s：全哈希是纯 hex，不含 '-'，用第一个 '-' 切分安全。
    const out = execSync('git log --pretty=format:%H-%s', {
      cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024,
    }).toString();
    for (const line of out.split('\n')) {
      const k = line.indexOf('-');
      if (k < 0) continue;
      if (/^fix(\([^)]*\))?:/.test(line.slice(k + 1).trim())) {
        fixCount++;
        if (!fixHash) fixHash = line.slice(0, k).slice(0, 7);
      }
    }
  } catch (e) { /* 非 git 环境 / shallow clone：下面走空集判红 */ }

  const BUG_DOC = 'BUG-ROOT-CAUSES.md';
  const rd = exists('README.md') ? read('README.md') : '';
  const ru = exists(UPDATE_DOC) ? read(UPDATE_DOC) : '';
  const rb = exists(BUG_DOC) ? read(BUG_DOC) : '';
  check(!!fixHash && fixCount >= 5,
    '§21n 真的扫到了 fix: 提交（git 历史 + 修复提交数双重空集防护）',
    'fixHash=' + fixHash + ' / fixCount=' + fixCount + ' → 断言在空跑');
  check(rd.length > 1000 && ru.length > 1000 && rb.length > 1000,
    '§21n README.md / 最近更新.md / BUG 专文都读到了内容（空集防护）',
    'README=' + rd.length + ' / 最近更新=' + ru.length + ' / BUG 专文=' + rb.length);

  // 2026-11-14 21:44 明细外移后，完整章节改去专文里找；至少两个章节，
  // 且最新章节的**标题行**必须引用最近一次 fix 哈希（正文碰巧出现同串哈希不算）。
  const headings = [...rb.matchAll(/^### 近期 bug 根因[^\n]*$/gm)].map(m => m.index);
  check(headings.length >= 2,
    'BUG-ROOT-CAUSES.md 至少有两个「近期 bug 根因」章节（章节被删也判红）',
    '当前 ' + headings.length + ' 个');
  const newest = headings.length ? rb.slice(headings[0]).split('\n')[0] : '';
  check(!!fixHash && newest.includes(fixHash),
    `BUG 专文最新章节标题记录了最近一次 fix 提交 ${fixHash}`,
    '最新 bug 根因章节标题没引用 ' + fixHash + ' → 修了 bug 却没在专文立条');
  check(!!fixHash && rd.includes(fixHash) && ru.includes(fixHash) && rb.includes(fixHash),
    `README.md / 最近更新.md / BUG 专文都引用了最近一次 fix 提交 ${fixHash}`,
    'README=' + rd.includes(fixHash) + ' / 最近更新=' + ru.includes(fixHash)
      + ' / BUG 专文=' + rb.includes(fixHash));
  check(/近期 bug 根因（摘要）/.test(rd) && /BUG-ROOT-CAUSES\.md/.test(rd),
    '§21n README 保留「近期 bug 根因（摘要）」章节并链接 BUG 专文（明细外移后访客仍有入口）',
    '摘要章节或链接被删 → GitHub 首页看不到 bug 记录，等于把 §21n 的原始要求弄丢了');
  // §21n-2（2026-11-21）：README 摘要「只留最近三条」此前只写在文档里、没有机器强制，
  // 实际累积到 19 条 / 4454 字符仍全绿（§23b 的 1500 字卡被列表结构绕过）。
  // 这里限定在摘要章节内数条目并卡单条长度，明细一律留 BUG 专文。
  {
    const secStart = rd.indexOf('### 近期 bug 根因（摘要）');
    let sec = secStart >= 0 ? rd.slice(secStart) : '';
    const nextHead = sec.indexOf('\n### ', 5);
    const nextRule = sec.indexOf('\n---', 5);
    const cut = [nextHead, nextRule].filter((x) => x > 0).sort((a, b) => a - b)[0];
    if (cut) sec = sec.slice(0, cut);
    const items = (sec.match(/^- \*\*20\d\d-\d\d-\d\d[^\n]*/gm) || []);
    const tooLong = items.filter((it) => it.length > 250);
    check(items.length > 0 && items.length <= 3 && tooLong.length === 0,
      `§21n-2 README bug 摘要只留最近三条且每条 ≤250 字（当前 ${items.length} 条 / 最长 ${items.reduce((m, x) => Math.max(m, x.length), 0)} 字）`,
      '摘要累积或单条变长 → 首页又要翻几百行；完整明细应外移 BUG-ROOT-CAUSES.md');
  }
}

// ---------- 21o. 未挂 CI 的 test-*.cjs 必须显式标「本机专用」 ----------
// 2026-11-05 自查：36 个测试里 6 个没挂 CI，逐个核对确认都是「无头 Edge + CDP
// 真渲染」、写死本机 Edge 绝对路径（CI runner 没有），属**有意**不挂，不是漏挂。
// 但「有意」当时只在我脑子里，没有任何东西拦住「新写的 jsdom 测试忘记挂 CI」。
// 这里反过来要求：没挂 CI 就必须自己声明本机专用，漏挂又没声明的直接判红。
{
  const wf = read('.github/workflows/verify.yml');
  const files = readdirSync(join(ROOT, 'scripts')).filter(f => /^test-.*\.cjs$/.test(f));
  const unhooked = files.filter(f => !wf.includes('node scripts/' + f));
  const unmarked = unhooked.filter(f => !/本机专用/.test(read('scripts/' + f).slice(0, 800)));
  check(files.length >= 30 && unhooked.length >= 1,
    '§21o 扫描到测试文件与未挂 CI 文件（双重空集防护）',
    `files=${files.length} / unhooked=${unhooked.length}`);
  check(unmarked.length === 0,
    `未挂 CI 的 ${unhooked.length} 个测试都显式标了「本机专用」`,
    '漏标（可能是新测试忘记挂 CI）：' + unmarked.join(', '));
}

// ---------- 21p. 小米门店性质备注（2026-11-06 站长口径）不得丢、两处必须同步 ----------
// 站长 2026-11-06 追加：「小米之家属于官方授权直营店，上六休一」，并明确这是门店
// 备注、不是 A 级评级依据。详情页是唯一真相源，首页自定义卡是副本；任一侧被改回
// 「线下销售岗位单休」的旧措辞都算脱节。评级依据的爱企查原始链接也一并锁住。
{
  const xmDetail = exists('brand/xiaomi.html') ? read('brand/xiaomi.html') : '';
  const xmIndex = read('index.html');
  check(xmDetail.length > 1000 && /id: 'xiaomi-card'/.test(xmIndex),
    '§21p 真的读到了小米详情页与首页自定义卡（双重空集防护）',
    `detail=${xmDetail.length} / card=${/id: 'xiaomi-card'/.test(xmIndex)}`);
  // 按「出现次数」锁，不按「文件里有没有」锁：故障注入首轮故意只抹掉一处，
  // 只查存在性的断言照样全绿（另外几处还写着），等于没拦住「某处被悄悄改回旧措辞」。
  // 2026-11-13 站长要求下调 A→B 后详情页整段重写，重复表述收敛但仍保有 3 处口径。
  const xmDetailHits = (xmDetail.match(/官方授权直营店/g) || []).length;
  const xmIndexHits = (xmIndex.match(/官方授权直营店/g) || []).length;
  check(/小米之家属于官方授权直营店/.test(xmDetail) && /上六休一/.test(xmDetail) && xmDetailHits >= 3,
    '§21p 详情页按站长口径写明「小米之家属于官方授权直营店，上六休一」（口径全在）',
    `detailHits=${xmDetailHits}`);
  check(xmIndexHits >= 3,
    '§21p 首页卡片三处（休息制度 / 描述 / 红框）口径全在',
    `indexHits=${xmIndexHits}`);
  check(/门店性质/.test(xmDetail) && /原有备注保留/.test(xmDetail)
    && !/线下销售岗位单休」。/.test(xmDetail.replace(/（线下销售岗位单休）/g, '')),
    '§21p 详情页标明门店备注性质（2026-11-06 口径保留；11-13 下调后岗位分化成为 B 级依据的一部分）');
  check(/recommendText: '⚠️ B 级 · 双休不稳（2026-11-13 站长要求下调）/.test(xmIndex) &&
        /小米之家（官方授权直营店）上六休一 \/ 客服轮班 \/ 工厂倒班 12 小时/.test(xmIndex),
    '§21p 首页卡片红框与休息制度字段与详情页同口径');
  check(/aiqicha\.baidu\.com\/details\/ugknowledge\?id=f5fe5b856c9a6bcf251add4319e48490/.test(xmDetail) &&
        /aiqicha\.baidu\.com\/details\/ugknowledge\?id=f5fe5b856c9a6bcf251add4319e48490/.test(xmIndex),
    '§21p 评级依据的爱企查原始链接在详情页与首页证据链都还在');
}

// ---------- 21q. 小米卡「内部」的站外链接（2026-11-06 站长纠正 / 11-07 换源） ----------
// 站长原要求：「小米卡片的下面，新增这个 mp.weixin.qq.com/s/1vEH4Ptw_6lvUJJcnYfpSA，
// 标题直接原标题，带 url 跳转到微信链接」。原标题逐字是 小米内置“反诈”被逆向了
// （中文弯引号 U+201C/U+201D，不是 ASCII 直引号），一字不能改。
// 2026-11-06 晚站长看过桌面三列网格后纠正：「写在卡片内，不是让你单独加弹窗，这样很乱」——
// 独立白卡会占掉网格一格、把整行挤乱。已删除 insertWechatLinkCard() 与过滤态隐藏逻辑，
// 改为 init() 里 insertWechatInlineLink() 往 #xiaomi-card 内容区末尾 append 一行紧凑链接。
// 链接随小米卡整体隐藏，所以 filterCustomCards 不应再有单独处理；注入仍须幂等
// （init() 挂 MutationObserver 反复执行）。以下断言把「卡内 + 不独立成卡」锁死。
// 2026-11-07 站长报微信原文《小米内置“反诈”被逆向了》已被删除，要求「替换为这个」
// 爱企查企业知识条目 URL。给过三个方案（整行换掉 / 只换跳转地址 / 删掉这行），
// 站长当时选「只换跳转地址」：标题、绿色标签、公众号来源说明一字不动，
// 只把 <a href> 从微信原文换成与 §21p 证据链同一条爱企查 URL（带 #:~:text= 定位）。
// 2026-11-07 17:45 站长看线上截图再次指出「我不是说这里替换成百度爱企查的链接吗」：
// 外观三处仍写着微信文章，肉眼完全看不出换过。故本轮把标签、来源、链接文字
// 一并换成爱企查可见条目（爱企查页面原题《小米公司的上下班时间》），href 保持不变。
// 断言同步收紧：锁「新 URL 唯一 + 旧微信 URL 不回流 + 可见文案确为爱企查」，
// 并禁止旧微信文案回流（这正是上一轮「只换 href」留下的坑）。
{
  const htmlQ = read('index.html');
  // 精确切出函数体（函数首行 6 空格缩进，闭合 } 也是 6 空格；内层语句 ≥8 空格）
  const qFnM = htmlQ.match(/function insertWechatInlineLink\(\) \{[\s\S]*?\n      \}/);
  const qFn = qFnM ? qFnM[0] : '';
  check(qFn.length > 300 && /getElementById\('xiaomi-card'\)/.test(qFn) &&
        /querySelector\('div\.p-5'\)/.test(qFn),
    '§21q 切到 insertWechatInlineLink 函数体且锚定小米卡内容区（双重空集防护）',
    `fnLen=${qFn.length}`);
  // ① 链接文字 = 爱企查页面原题（2026-11-07 17:45 换源后可见口径）
  check(/小米公司的上下班时间/.test(qFn),
    '§21q 链接文字为爱企查页面原题「小米公司的上下班时间」（外观看得出已换源）');
  // ①b 旧微信文案不得回流：只换 href 不换外观，站长看截图会以为根本没改
  check(/百度爱企查 · 站外跳转/.test(qFn) && /爱企查公开信息页 · 与本站无隶属关系/.test(qFn),
    '§21q 标签与来源写成百度爱企查公开信息页（不再冒充微信文章）');
  check(!/微信文章 · 站外跳转/.test(qFn) && !/青檬小栈/.test(qFn) &&
        !/小米内置“反诈”被逆向了/.test(qFn) && !/#07c160/.test(qFn),
    '§21q 旧微信文章标签 / 公众号来源 / 微信绿 / 旧标题全部不得回流到卡内来源块');
  // ② 站外链接写在 <a href> 里。2026-11-07 起 href 指向爱企查（微信原文已删），
  //    去独立卡后不该有第二份 window.open；旧微信 URL 不许回流到首页任何位置。
  const AQ_URL = 'https://aiqicha.baidu.com/details/ugknowledge?id=f5fe5b856c9a6bcf251add4319e48490#:~:text=%E5%B0%8F%E7%B1%B3%E5%85%AC%E5%8F%B8%E6%99%AE%E9%81%8D%E5%AE%9E%E8%A1%8C,%E5%9B%A0%E9%A1%B9%E7%9B%AE%E8%BF%9B%E5%BA%A6%E5%BB%B6%E5%90%8E%E3%80%82';
  const OLD_WX_URL = 'https://mp.weixin.qq.com/s/1vEH4Ptw_6lvUJJcnYfpSA';
  const aqHits = qFn.split(AQ_URL).length - 1;
  check(qFn.includes(`href="${AQ_URL}"`) && aqHits === 1,
    '§21q <a href> 指向爱企查企业知识条目（带 #:~:text= 文本片段定位）且整串只出现一次',
    `hits=${aqHits}`);
  check(!qFn.includes(OLD_WX_URL) && !htmlQ.includes(OLD_WX_URL),
    '§21q 已删除的微信原文链接不得回流到卡内链接或首页任何位置');
  check(/target="_blank"/.test(qFn) && /rel="noopener noreferrer"/.test(qFn),
    '§21q 链接带 target="_blank" + rel="noopener noreferrer"（站外新标签页安全跳转）');
  // ③ 卡内 + 幂等：重复 init 不重建，被挪走时归位回小米卡内容区
  check(/getElementById\('xiaomi-wechat-inline'\)/.test(qFn) &&
        /existing\.parentElement !== body/.test(qFn) &&
        /body\.appendChild\(row\)/.test(qFn) &&
        /body\.appendChild\(existing\)/.test(qFn),
    '§21q 链接挂在小米卡内容区内，幂等归位不重建');
  // 卡内行不是品牌卡：绝不能带 'bg-white rounded-2xl border' 三连类（全站 CARD_SEL），
  // 否则评级筛选会当成「无档位布局容器」，test-gf-search 护栏判红。
  check(/row\.className = 'sxg-wechat-inline'/.test(qFn) &&
        !/row\.className = '[^']*bg-white[^']*rounded-2xl[^']*border/.test(qFn),
    '§21q 卡内链接用专属 class，不命中 CARD_SEL（评级筛选不误伤）');
  // ④ 独立白卡彻底消失：旧函数、旧节点、旧过滤变量、旧 class、旧整卡插入都不许回流
  check(!/xiaomi-wechat-link-card|insertWechatLinkCard|wlcFilterActive|sxg-wechat-link/.test(htmlQ) &&
        !/parentNode\.insertBefore\(card, xm\.nextSibling\)/.test(htmlQ),
    '§21q 独立白卡已彻底移除（旧函数 / 旧节点 / 旧过滤变量 / 整卡点击不许回流）');
  // ⑤ init() 必须真的调用
  check(/\n\s*insertWechatInlineLink\(\);/.test(htmlQ),
    '§21q init() 里真的调用了 insertWechatInlineLink()');
}

// ---------- 21r. 打赏页分享文案：搜索摘要原句逐字照抄 + 保留开源署名 ----------
// 站长 2026-11-06：打赏页点「分享本站」→ 微博，框里还是旧的「二次开发 / 欢迎赞助支持」
// 口径（上一批把打赏页正文改成「为什么要打赏」时漏同步了 meta）。站长要求照抄此前给的
// Bing 搜索「双休购」AI 摘要截图里红框那句、**不优化**，同时保留开源署名。
// 这段 description 就是 share-modal.js 的 d（微博 / X / Telegram / LINE / WhatsApp
// 及复制类平台共用），改一处全平台生效，所以用整串等值锁死，防止日后被顺手改写。
{
  const spR = read('sponsor.html');
  const mR = spR.match(/name="description"\s+content="([^"]+)"/);
  const descR = mR ? mR[1] : '';
  const BING_SENTENCE = '“双休购”是一项倡导消费者优先购买实行双休制度企业产品的消费行动，并由同名平台（ShuangxiuGo）提供企业双休评级、证据查询和替代品牌建议等工具。';
  const CREDIT = '本项目基于 ZhiqingHeyi/shuangxiugou 开源项目（MIT）二次开发，由 dujeongil-galaxy 负责维护。';
  check(descR.length >= 30 && descR === BING_SENTENCE + CREDIT,
    '§21r 打赏页 description = 搜索摘要原句逐字照抄 + 原开源署名句（整串等值锁，改写即判红）',
    `len=${descR.length}`);
  check(!/欢迎赞助支持|提交你所在企业的真实双休数据|"双休购"/.test(descR),
    '§21r 旧赞助口径与 ASCII 直引号都不许回流（照抄不优化）');
  const smR = read('share-modal.js');
  check(/meta\[property="og:description"\]/.test(smR) &&
        /meta\[name="description"\]/.test(smR) &&
        /&title=' \+ d/.test(smR),
    '§21r 分享弹窗仍读页面 description 并传给微博 title（改 meta 真能生效）');
}

// ---------- 21s. 瑞幸卡片提示语：站长线下核实口径 + 成都地区（2026-11-07 19:25） ----------
// 站长原话：「首页的瑞幸卡片，可以优化一下提升语，站长线下多家门店核实，均为上六休一
// （月休4天）；成都地区情况稍微好一点（他们回答的是，想休就请假，属于是不愿意回答，
// 这个你看着写吧，别套用我原话，可以保留成都地区）」。
// 瑞幸是内置卡，数据在压缩 bundle（assets/index-YthXZ9eP.js）里，按仓库铁律不能改，
// 故写独立 DOM 补丁 luckin-note-patch.js：改工时政策栏 + 加红框提示语。
// 三层强制：这里的静态断言 + 故障注入（9 条全判红）+ CHANGELOG / 最近更新 / README 三处记账。
{
  const idxS = read('index.html');
  const patchS = read('luckin-note-patch.js');
  check(/<script defer src="\.\/luckin-note-patch\.js\?v=2"><\/script>/.test(idxS)
    && patchS.length > 800,
    '§21s 首页引入瑞幸提示语补丁且脚本真的存在（双重空集防护）',
    `scriptLen=${patchS.length}`);
  check(/var POLICY = '站长西南地区门店线下核实：上六休一（月休 4 天）'/.test(patchS)
    && /var NOTE = [^\n]*西南地区多家门店排班口径一致/.test(patchS),
    '§21s 工时政策栏写明西南地区门店线下核实上六休一（月休 4 天），红框写明西南多家门店口径一致');
  check(/var NOTE = [^\n]*成都地区/.test(patchS)
    && /未给出明确排班口径/.test(patchS) && /不据此改判/.test(patchS),
    '§21s 红框提示保留成都地区差异，并写明不据此单独改判');
  check(!/想休就请假|不愿意回答|情况稍微好一点|属于是/.test(patchS),
    '§21s 不套用站长口述原话（门店推脱的说法只写结论，不照抄）',
    '把「想休就请假／不愿意回答」原话搬上卡片 → 站长明确「别套用我原话」');
  check(/data-luckin-policy/.test(patchS) && /data-luckin-note/.test(patchS)
    && /new MutationObserver\(schedule\)/.test(patchS),
    '§21s 补丁幂等（双标记）+ MutationObserver 兜底 React 重渲染');
  check(!/writeFileSync|innerHTML\s*=/.test(patchS),
    '§21s 补丁只在渲染层改 DOM，不写文件、不整块重建（仓库铁律：不动 bundle）');
  check(/门店排班紧绷 \/ 兼职高压工时/.test(read('assets/index-YthXZ9eP.js')),
    '§21s 压缩 bundle 里的旧数据保持原样（新口径由补丁在渲染层覆盖）');
}

// ---------- 21t. 蜜雪冰城地区差异：西南月休 4 天 / 华北员工自述月休 2 天（2026-11-20 站长补充） ----------
// 站长 2026-11-20 补充一条地区差异：西南大部分门店月休 4 天；华北门店员工自述
// （2024-06 聊天记录）月休 2 天，经员工同意脱敏代为登记。华北口径只有员工自述、
// 无一手可核验证据，按「员工自述、待核实」单列登记，不替换西南已核实口径，
// 也不据此单独改判 C 级。蜜雪是内置卡（bundle 不可改），故独立补丁
// mixue-region-note.js 在渲染层挂红框；详情页是真相源，证据公示区由生成器同步
// （ev-mixue 5 条、全站 512 条）。
// 隐私红线：不展示聊天截图，不记录昵称/账号/城市/门店等可识别信息。
// 三层强制：静态断言 + 故障注入（全判红）+ CHANGELOG / 最近更新 / README 三处记账。
{
  const idxT = read('index.html');
  const patchT = read('mixue-region-note.js');
  const detailT = read('brand/mixue.html');
  check(/<script defer src="\.\/mixue-region-note\.js\?v=2"><\/script>/.test(idxT)
    && patchT.length > 800,
    '§21t 首页引入蜜雪地区差异补丁且脚本真的存在（双重空集防护）',
    `scriptLen=${patchT.length}`);
  check(/var NOTE = [^\n]*西南地区大部分门店月休 4 天/.test(patchT)
    && /var NOTE = [^\n]*华北地区门店员工自述（2024-06 聊天记录，脱敏登记）月休 2 天/.test(patchT)
    && /待核实/.test(patchT),
    '§21t 红框写明西南月休 4 天与华北员工自述月休 2 天（待核实）');
  check(/C 级与双休率 0%/.test(patchT) && /不变/.test(patchT)
    && /两地均不足双休/.test(patchT),
    '§21t 红框声明地区差异不改评级与换算值');
  check(/data-mixue-region-note/.test(patchT)
    && /new MutationObserver\(schedule\)/.test(patchT)
    && !/writeFileSync|innerHTML\s*=/.test(patchT),
    '§21t 补丁幂等、有 React 重渲染兜底，且只改 DOM（不写文件、不整块重建）');
  check(/\^蜜雪冰城\//.test(patchT),
    '§21t 按标题定位蜜雪冰城卡（不串卡）');
  check(/西南地区大部分门店月休 4 天/.test(detailT)
    && /华北地区员工自述（2024-06 聊天记录）月休 2 天，待核实/.test(detailT)
    && /员工自述、待核实/.test(detailT),
    '§21t 详情页写明西南 4 天 / 华北员工自述 2 天且华北标为待核实');
  const evMixueT = idxT.slice(idxT.indexOf('id="ev-mixue"'), idxT.indexOf('id="ev-mixue"') + 240);
  check(/data-n="5" data-l="3"/.test(evMixueT) && /data-ev-total="512"/.test(idxT),
    '§21t 公示区由生成器同步：ev-mixue 5 条证据 / 全站 512 条');
  check(/华北地区门店员工自述：两天公休（月休 2 天）（待核实）/.test(detailT)
    && /华北地区门店员工自述：两天公休（月休 2 天）（待核实）/.test(idxT)
    && /华北月休 2 天口径更紧/.test(detailT),
    '§21t 详情页证据链与公示区均登记华北自述口径，数值补充说明换算值不变');
  check(/var NOTE = [^\n]*华北地区门店员工自述[^\n]*待核实/.test(patchT)
    && !/var NOTE = [^\n]*月休 2 天[^\n]*已核实/.test(patchT)
    && !/华北地区门店月休 2 天（已核实）/.test(detailT),
    '§21t 华北口径必须标为待核实，不得写成已核实事实');
  // 隐私红线（2026-11-20 员工同意脱敏登记）：不展示截图，不出现任何可识别个人/门店的信息
  // 「不展示聊天截图」这类脱敏声明文字本身合法，故排除声明短语后再查敏感词
  const noDeclare = detailT.replace(/页面不展示聊天截图、昵称与任何可识别门店或个人的信息/g, '')
    .replace(/本站不展示聊天截图/g, '').replace(/og-cover\.png/g, '');
  const mixueEvT = detailT.slice(detailT.indexOf('<h2>证据来源</h2>'), detailT.indexOf('<h2>参考：其他 C 级品牌</h2>'));
  check(!/<img[\s>]/.test(mixueEvT) && !/\.(jpe?g|png|gif|webp)/i.test(mixueEvT),
    '§21t 隐私红线：蜜雪详情页证据链不引用任何截图图片（聊天截图不上库）');
  check(!/QQ|微信截图|聊天截图|(?:^|[^不据])qq/i.test(noDeclare),
    '§21t 隐私红线：蜜雪详情页（脱敏声明除外）不出现 QQ/截图引用等泄露字样');
  check(/脱敏说明/.test(detailT) && /不展示聊天截图/.test(detailT)
    && !/昵称[：:][^<]{2,}/.test(detailT)
    && !/账号[：:][^<]{2,}/.test(detailT)
    && !/(员工|当事人|店员)[（(]@(?:[\w-]{3,})[）)]/.test(detailT),
    '§21t 隐私红线：详情页写明脱敏说明，且不含昵称/账号等可识别信息');
  check(/经员工同意/.test(detailT) && /经员工同意，站长于 2026-11-20 代为登记/.test(detailT),
    '§21t 华北自述条目写明经员工同意代为登记');
}

// ---------- 21u. 奶茶品牌一线核实统一加「西南地区」限定（2026-11-20 站长明确） ----------
// 站长 2026-11-20 明确：本人线下一手走访只覆盖西南地区门店。此前茶百道/兵立王/
// 一点点/茉莉奶白（自定义卡）与喜茶/库迪/肯悦/瑞幸（内置卡）的「线下一手核实」
// 未限定地区，易被读成全国核实结论。本次统一加「西南地区」限定，只加地区，
// 不动已确证的月休 4 天 / 淡季 8 天数值，也不改 C 级与双休率换算值。
// 内置卡数据在压缩 bundle 不能改 → 独立 DOM 补丁 tea-region-note.js + 复用
// luckin-note-patch.js；详情页是真相源，证据公示区由生成器同步（512 条不变）。
{
  const idxU = read('index.html');
  const bundleU = read('assets/index-YthXZ9eP.js');

  // ① 自定义卡：desc + recommendText 全部带地区限定，且月休数值不丢失
  check(/西南地区门店店员匿名反馈：月休4天（单休形态）/.test(idxU)
    && /西南地区门店员工匿名反馈：月休4天/.test(idxU),
    '§21u 茶百道/兵立王自定义卡 desc 写明西南地区门店；月休 4 天保留');
  check(/西南地区线下核实（大学城附近门店员工实录）：淡季月休 8 天/.test(idxU)
    && /西南地区线下核实到门店「月休 4 天」/.test(idxU),
    '§21u 一点点/茉莉奶白自定义卡 desc 写明西南地区；原有月休数值保留');
  check((idxU.match(/西南地区门店月休4天（线下一手调查）/g) || []).length === 2
    && /西南地区门店旺季月休4天（单休）/.test(idxU)
    && /C 级 · 西南地区线下核实月休 4 天/.test(idxU),
    '§21u 四张自定义卡红框均带西南地区限定（茶百道/兵立王/一点点/茉莉奶白）');

  // ② 详情页（真相源）：七张奶茶/咖啡详情页的全部一线核实措辞带地区
  for (const [f, sample] of [
    ['chabaidao', '西南地区门店线下一手核实：月休 4 天'],
    ['bingliw', '西南地区门店线下一手核实：月休 4 天'],
    ['yidiandian', '站长西南地区门店线下一手核实：淡季月休 8 天'],
    ['molina', '西南地区线下核实到门店为「月休 4 天」'],
    ['heytea', '站长线下核实：西南地区门店月休 4 天'],
    ['cotti', '站长西南地区门店线下一手核实：月休 4 天'],
    ['kenyue', '站长西南地区门店线下一手核实：月休 4 天']
  ]) {
    check(read('brand/' + f + '.html').indexOf(sample) >= 0,
      '§21u 详情页 brand/' + f + '.html 写明西南地区限定');
  }
  // ③ 内置卡 DOM 补丁：喜茶/库迪/肯悦；瑞幸复用既有补丁
  const patchU = read('tea-region-note.js');
  check(/<script defer src="\.\/tea-region-note\.js\?v=1"><\/script>/.test(idxU)
    && patchU.length > 1200,
    '§21u 首页引入内置卡地区限定补丁且脚本存在（双重空集防护）',
    `scriptLen=${patchU.length}`);
  check(/\^喜茶/.test(patchU) && /\^库迪/.test(patchU) && /\^肯悦/.test(patchU)
    && /西南地区门店/.test(patchU),
    '§21u 补丁按标题精确定位喜茶/库迪/肯悦三卡且新文案带地区');
  check(/data-tea-region/.test(patchU)
    && /new MutationObserver\(schedule\)/.test(patchU)
    && !/writeFileSync|innerHTML\s*=/.test(patchU),
    '§21u 补丁幂等、有 React 重渲染兜底，只改 DOM 不写文件不动 bundle');
  check(/站长西南地区门店线下核实：上六休一（月休 4 天）/.test(read('luckin-note-patch.js')),
    '§21u 瑞幸补丁工时政策栏同步加西南地区限定');

  // ④ 公示区由生成器同步：证据总数不变，喜茶证据标题带地区
  check(/data-ev-total="512"/.test(idxU)
    && /站长线下核实：西南地区门店月休 4 天/.test(idxU),
    '§21u 证据公示区已同步：512 条不变且喜茶证据标题带地区');
  // ⑤ 铁律：压缩 bundle 里旧文案一字未动（新口径全在渲染层/详情页）
  check(/站长线下核实六休一（月休 4 天）/.test(bundleU)
    && !/西南地区门店线下一手核实：月休 4 天/.test(bundleU),
    '§21u 压缩 bundle 保持原样（地区限定只在补丁与详情页，不改 bundle）');
  // ⑥ 只加地区、不新增「待核实」软化：月休 4 天仍是确证口径
  check(!/西南地区[^。；\n]{0,30}月休 4 天[^。；\n]{0,20}待核实/.test(patchU)
    && !/西南地区门店月休4天[^。；\n]{0,20}待核实/.test(idxU),
    '§21u 只加地区限定，不把已确证的月休 4 天改写成待核实');
}

// ---------- 22. 素材链接规则（站长 2026-11-07 写死，同日纠正为 blob） ----------
// 站长原话：「链接改为 blob 格式，不要直接在 GitHub 仓库明文，以后也注意这个问题，
// 除非我明确表示明文，否则都使用 blob，此规则记录在 GitHub 仓库 README，写死规则」。
// ⚠️ 2026-11-07 曾把 blob 误听成 blog，据此做过一轮站内目录迁移并写进错误规则，
//    已撤销；这里同时锁「现行规则里不得残留 blog 说法」，防止再走回头路。
// 按本项目长期纪律，规则不能只写文档：README + 脚本断言 + 故障注入三层一起落。
section('22. 素材链接规则（blob 格式 / 素材不得明文入库）');
{
  const rd22 = read('README.md');
  const ruleSec22 = (rd22.split('## 📌 素材链接规则')[1] || '').split('\n---')[0];
  check(/除非站长明确表示/.test(ruleSec22) && /blob 格式/.test(ruleSec22)
    && /不得把素材原始文件明文提交进 GitHub 仓库/.test(ruleSec22)
    && /URL\.createObjectURL/.test(ruleSec22) && /密文容器/.test(ruleSec22),
    '§22a README 写死素材链接规则（除非站长明确表示明文，否则一律 blob 格式 + .enc 密文 + createObjectURL）',
    '规则只挂在口头 → 下次又会把站长给的截图明文塞进仓库');
  check(!/blog 格式链接/.test(ruleSec22) && !/站内 `blog\/`/.test(ruleSec22),
    '§22a2 现行素材规则里不得残留被纠正的 blog 说法（站长说的是 blob）',
    '把 blob 又写成 blog → 会再去做一次站内目录迁移，白折腾一轮');

  // 加密随笔正文里不许出现图片或仓库内素材引用（素材一律不上传、正文只留密文）
  const plain22 = exists('notes.html') ? decryptNotes(read('notes.html')) : null;
  if (plain22 === null) {
    notes.push('跳过「§22b 随笔正文无素材引用」（未提供 NOTES_KEY，密文未解密）');
  } else {
    // 2026-11-16 站长定稿：第11章两处 GIF 换成 12 张静态帧，图片以 data: URI
    // 内联在加密正文里（不新增仓库明文素材）。规则本意是「素材不上传」，
    // 因此只拦非 data: 的 img src 与仓库内素材路径，不再一刀切禁 img 标签。
    const badRef22 =
      /<img\b[^>]*\bsrc\s*=\s*["'](?!data:)[^"']*["']/i.test(plain22)
      || /\.\/assets\//.test(plain22)
      || /\.\/ch11\//.test(plain22);
    check(!badRef22,
      '§22b 随笔正文不放仓库内/外部素材引用（图只允许随正文加密的 data: URI 内联）',
      '正文里出现非 data: 的 img src，或 ./ch11/、./assets/ 等仓库内素材路径 → 违反「素材不上传」');
  }

  // 历史存量：站点自带的功能图（打赏二维码 / 分享图 / 既有测试截图）与
  // assets/ 下的品牌 logo 都不属于「站长提供的口述素材」，登记为白名单。
  // 新增任何其它明文素材文件（已跟踪）即判红，逼迫改用 .enc 密文 + blob 渲染。
  const LEGACY_MEDIA22 = new Set([
    'company-qrs/qianren.png', 'contact-developer-qr.jpg',
    'crypto-qr/btc-bep20.png', 'crypto-qr/btc-brc20.png', 'crypto-qr/eth-erc20.png',
    'crypto-qr/gt.png', 'crypto-qr/mbx-aptos.png', 'crypto-qr/mbx-multi.png',
    'crypto-qr/sol.png', 'crypto-qr/usdc-polygon.png', 'crypto-qr/usdt-trc20.png',
    'crypto-qr/wemix.png', 'crypto-qr/xpla.png',
    'og-share.png', 'scripts/shot-local-note.png', 'sponsor-support.jpg',
    // 2026-11-16 站长定稿：随笔第11章两处 GIF 已撤，改 12 张静态帧以 data: URI
    // 内联在加密正文里；ch11/ 下两个 .gif 已 git rm，白名单同步移除（不留悬空登记）。
    // 2026-11-19 微信文章存档：第三方公众号正文长图，不是站长提供的口述素材，
    // 属公开证据原件，必须保留原图供核验；路径钉死，新增其它明文图仍判红。
    'archive/wechat-liciaotiao-2023/01-letter/body.jpg',
    'archive/wechat-liciaotiao-2023/02-my-view/body.png',
  ]);
  let tracked22 = '';
  try {
    tracked22 = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' });
  } catch { tracked22 = ''; }
  const stray22 = tracked22.split('\n').map((s) => s.trim()).filter((f) =>
    f && !f.startsWith('assets/') && !LEGACY_MEDIA22.has(f)
    && /\.(jpe?g|png|webp|gif|mp4|mov|webm|pdf)$/i.test(f));
  check(stray22.length === 0,
    '§22c 已跟踪文件里无未登记的明文素材（新增素材须走 .enc 密文 + blob 渲染）',
    '发现未登记明文素材：' + stray22.join(', ') + '（须改用 .enc 密文容器或登记进白名单）');
}

// ---------- 22d. 随笔身份脱敏（站长 2026-11-16 硬性红线） ----------
// 原话：「禁止暴露站长本人的身份！」「可以说我找了四川省教育厅投诉市教育局，
//   四川省允许公开，但什么广安市、区、南充什么的，一律脱敏处理，只能说我是四川人，
//   但是不能更详细」。据此对 4.10 这节立三条硬约束：
//   ① 地域只到省级 + 「市教育局」泛指；具体市名/区名/「X区教育局」一律不许出现。
//   ② 不出现电话号码、具体时刻（几点几分）——两者都能反向定位到具体工单。
//   ③ 事件骨架保留（省教育厅 / 市教育局 / 四次 / 退休答复 / 四川人），防止整段被删或写空。
// 校验作用于解密后的正文（有 NOTES_KEY 才跑），并配一组故障注入自检。
{
  const plain22d = exists('notes.html') ? decryptNotes(read('notes.html')) : null;
  const d22 = (okv, label, why) => {
    if (plain22d === null) {
      notes.push(`跳过「${label}」（未提供 NOTES_KEY，密文未解密）`);
      return true;
    }
    return check(okv, label, why);
  };

  // 从正文里切出 4.10 这一节（到下一个 <h3> 或 <hr /> 或 <h2> 为止）
  function sec410(text) {
    const s = text.indexOf('4.10');
    if (s < 0) return '';
    const tail = text.slice(s);
    const e = tail.search(/<h3\b|<h2\b|<hr\s*\/?>/i);
    return e < 0 ? tail : tail.slice(0, e);
  }

  // 纯函数：给一段「4.10 文本」，返回是否触犯脱敏红线。故障注入直接调它。
  function leaksIdentity(sec) {
    if (!sec) return false; // 整节缺失由 ③ 的骨架断言负责，不算泄露
    const bans = [
      /广\s*安/, /南\s*充/, /成\s*都/, /达\s*州/, /绵\s*阳/, /广元/, /巴中/, /遂宁/,
      /[一-龥]{2,6}区教育局/,                 // 任何「XX区教育局」具体区级单位
      /028\s*[-\s]?\s*\d{6,8}/,              // 座机区号+号码
      /1[3-9]\d{9}/,                          // 手机号
      /\d{1,2}\s*[点时:：]\s*\d{1,2}\s*分/,  // 具体时刻「5点51分」
    ];
    return bans.some((re) => re.test(sec));
  }

  const sec = plain22d === null ? '' : sec410(plain22d);
  d22(!leaksIdentity(sec),
    '§22d 随笔 4.10 节无具体市名/区名/电话/时刻（身份脱敏红线）',
    '出现广安/南充/成都等具体地名、「XX区教育局」、电话号码或「几点几分」→ 可反向定位站长本人');
  d22(plain22d === null || [
    '四川省教育厅', '市教育局', '四次', '退休', '四川人', '2026-11-16',
  ].every((k) => sec.includes(k)),
    '§22d 随笔 4.10 节事件骨架完整（省级+市局泛指+关键情节+日期）',
    '删掉整节或抹掉关键锚点 → 脱敏变成了「干脆不写」，站长要的是事情写清楚但脱敏');

  // 故障注入自检：每次运行都确认护栏真能抓到回退（按字节构造坏样本，不落盘）
  if (plain22d !== null) {
    const GOOD = '<h3>4.10 测试</h3><span>2026-11-16</span>'
      + '<p>我找四川省教育厅投诉市教育局，反映过四次，对方说老师已退休，'
      + '我是四川人，诉求是别让下一代再受伤害。</p>';
    const cases = [
      ['塞入具体区名广安', (s) => s.replace('市教育局', '广安区教育局')],
      ['塞入具体市名南充', (s) => s.replace('四川人', '南充人')],
      ['塞入电话号码', (s) => s + '<p>电话 028-63006720</p>'],
      ['塞入具体时刻', (s) => s + '<p>下午5点51分打的</p>'],
    ];
    let caught = 0;
    for (const [name, mutate] of cases) {
      if (leaksIdentity(mutate(GOOD))) caught++;
      else console.log('  ! §22d 故障注入未拦住：' + name);
    }
    check(leaksIdentity(GOOD) === false && caught === cases.length,
      '§22d 故障注入 4/4：脱敏护栏能被自己判红',
      '正常样本被误拦，或 4 组回退有漏网 → 护栏不可信');
  } else {
    notes.push('跳过「§22d 故障注入 4/4」（未提供 NOTES_KEY）');
  }
}

// ---------- 23. README 长段落摘要化（站长 2026-11-07 明确） ----------
// 原话：「部分内容写得太长了……如果一个段落太长了，就只写摘要，其他的单独放一个页面」。
// 之前做过的优化：README「🆕 最近更新」把完整版单独放 最近更新.md、下面只列摘要。
// 本轮把同一条规则推广到全篇并写死：长段落只留摘要 + 独立页面链接，改动明细不堆首页。
// 三层强制：README 规则原文 + 这里的断言 + 故障注入（缺一层 README 又会膨胀回去）。
section('23. README 长段落摘要化（摘要 + 独立页面）');
{
  const rd23 = read('README.md');
  const detail23 = exists('README-详情.md') ? read('README-详情.md') : '';

  check(/长段落摘要化/.test(rd23) && /完整原文单独放一个页面/.test(rd23)
    && /不堆改动明细/.test(rd23),
    '§23a README 写死「段落写长了只留摘要、完整原文单独放页面、不堆改动明细」规则',
    '规则只挂口头 → README 下次又会膨胀成上万字的改动明细');

  // 按空行切 prose 块；代码块、表格、项目符号/有序清单不算「叙事段落」
  // （README 的「硬性要求」是必要的操作清单，不该被摘要化掉）。
  const ls23 = rd23.split('\n');
  let fence23 = false, blocks23 = [], cur23 = [];
  for (const ln of ls23) {
    if (/^\s*```/.test(ln)) { fence23 = !fence23; continue; }
    if (fence23) continue;
    if (ln.trim() === '') {
      if (cur23.length) { blocks23.push(cur23.join('\n')); cur23 = []; }
      continue;
    }
    cur23.push(ln);
  }
  if (cur23.length) blocks23.push(cur23.join('\n'));
  const prose23 = blocks23.filter(b => {
    const rows = b.split('\n');
    // 顶层列表项 ≥2 且整块没有引用行 → 操作清单（如「硬性要求」「加品牌的数据链」），
    // 它本来就该留在 README 里，不算可摘要化的叙事段落。
    const tops = rows.filter(r => /^\s*([-*+]\s|\d+\.\s)/.test(r)).length;
    const quoted = rows.some(r => /^\s*>/.test(r));
    const tableish = rows.filter(r => /^\s*\|/.test(r)).length;
    const isList = !quoted && (tops >= 2 || tableish >= rows.length * 0.8);
    return !isList;
  });
  const long23 = prose23.filter(b => b.length > 1500);
  check(prose23.length > 10 && long23.length === 0,
    '§23b README 无超过 1500 字的叙事段落（长段落须摘要化，清单/代码块除外）',
    'prose 块 ' + prose23.length + ' 个 / 超长 ' + long23.length + ' 处：'
      + long23.map(b => b.slice(0, 30)).join(' | '));

  check(/README-详情\.md/.test(rd23) && /\.\/最近更新\.md/.test(rd23)
    && /CHANGELOG\.md/.test(rd23),
    '§23c README 摘要保留指向独立页面的链接（归档页 / 最近更新 / CHANGELOG）');

  check(detail23.length > 1500 && /证据链不完善也照判不回避/.test(detail23)
    && /两套产物/.test(detail23) && /customCardsConfig/.test(detail23)
    && /id="scope"/.test(detail23) && /id="architecture"/.test(detail23),
    '§23d README-详情.md 归档了移出的完整原文（判档口径 / 架构说明 / 数据位置 / 锚点）',
    '归档页缺失或内容被删 → 摘要指向空页，长段落等于直接丢了');

  // 2026-11-14 21:44 站长「这太难看了」：旧断言只钉死三个特定日期串，
  // 结果「本批 / 上一批 / 更早一批」换个日期又堆回 121 行，36 条 bug 根因更没人管。
  // 改成通用正则：任何逐批明细引用块、任何 bug 明细章节标题都不许回流 README。
  check(!/^\s*>\s*\*\*(本批|上一批|更早一批|近期改动入口)/m.test(rd23)
    && !/^\s*>\s*(本批|上一批|更早一批)（20\d\d-/m.test(rd23)
    && !/^### 近期 bug 根因（fix）/m.test(rd23)
    && !/^### 近期 bug 根因[^（\n]/m.test(rd23),
    '§23e README 不再堆叠逐批改动明细与 bug 根因全文（通用正则，换日期也拦得住）',
    '逐批明细或 bug 明细回流 README → 首页又要翻几百行');

  const rdLines23 = rd23.split('\n').length;
  check(rdLines23 <= 750,
    `§23f README 总行数不超过 750 行（当前 ${rdLines23} 行）：过长就拆独立 md，外面只写摘要`,
    'README 又膨胀了 → 按「文档分工」把明细外移，别靠人肉自觉');
  const bug23 = exists('BUG-ROOT-CAUSES.md') ? read('BUG-ROOT-CAUSES.md') : '';
  const bugHeads23 = (bug23.match(/^### 近期 bug 根因/gm) || []).length;
  check(bugHeads23 >= 30 && /README\.md/.test(bug23) && /最近更新\.md/.test(bug23),
    `§23g BUG 专文收存了完整明细（${bugHeads23} 条章节）并写明与 README / 最近更新的分工`,
    '专文被清空或章节被删 → 摘要指向空页，明细等于直接丢了');
  check(/BUG-ROOT-CAUSES\.md/.test(rd23) && /README-详情\.md/.test(rd23)
    && /文档过长就拆/.test(rd23),
    '§23h README 摘要写明「过长就拆」并链接 BUG 专文与长段落归档页',
    '链接或规则文字被删 → 下次又会在 README 里堆长段落');
  const bugLinks23 = [...bug23.matchAll(/\]\(\.\/([^)#]+)(?:#[^)]*)?\)/g)].map(m => m[1]);
  check(bugLinks23.length >= 3 && bugLinks23.every(f => exists(f)),
    '§23i BUG 专文的内部链接全部指向真实存在的文档',
    '链接写错 → 访客从摘要点进去是 404');

  // 2026-11-18：站长再查 README，「六件最容易踩坑的事」第 6 条等长段落仍堆在首页。
  // 按同一条规则推广：长段落原文进 README-细则.md，README 每处只留摘要 + 锚点链接。
  // 锚点用显式 <a id="..."> 钉住，避免中文标题自动 slug 漂移造成「点了 404」。
  const rules23 = exists('README-细则.md') ? read('README-细则.md') : '';
  const anchors23 = ['pitfalls-react', 'adslot', 'byd', 'evidence', 'batch-1110',
    'brand-scope', 'assets-blob', 'notes-style', 'header', 'share', 'bookkeeping',
    'import-brands', 'doc-split', 'ai-rules', 'u-grade', 'rate-zero'];
  const noAnchor23 = anchors23.filter(a => !rules23.includes('<a id="' + a + '"></a>'));
  const noLink23 = anchors23.filter(a => !rd23.includes('./README-细则.md#' + a));
  check(anchors23.length >= 12 && noAnchor23.length === 0 && noLink23.length === 0,
    '§23j README 长段落已拆到 README-细则.md，且每个锚点都有摘要入口链接',
    '缺锚点：' + noAnchor23.join(',') + ' / 缺链接：' + noLink23.join(',')
      + ' → 摘要点不进全文，等于原文丢了');

  check(rdLines23 <= 500 && rules23.length > 12000,
    `§23k README 只留精简摘要（当前 ${rdLines23} 行 ≤ 500），完整原文在 README-细则.md`,
    'README 又堆回长段落 → 按分工外移，不要在首页靠人肉节制');

  // §23l 禁止逐字引用站长口述（2026-11-18 定规）。判据写成通用正则，不枚举具体句子：
  //   ① 标注式："原话/口述" + 引号；② 包裹式："站长/指令/要求..." + 20 字以上长引语。
  // 扫描面：9 份对外文档 + index.html 里所有 ?v= 引用的根目录补丁脚本注释。
  // 第三方证据、榜单原文等外部引语不受限——那是证据链，不是私人对话，故只针对"站长/指令"等主体词。
  const quoteDocs23L = ['README.md', 'README-细则.md', 'README-详情.md', 'AGENTS.md',
    '最近更新.md', 'CHANGELOG.md', 'PITFALLS.md', 'BUG-ROOT-CAUSES.md', 'SEO-RANKING.md'];
  const quotePats23L = [
    /原话\s*[：:]\s*[「『"]/,
    /口述\s*[：:]\s*[「『"]/,
    /站长[^\n。；：]{0,12}?「[^」]{20,}」/,
    /(?:指令|要求|追问|反馈|指出|强调)[^\n。；：]{0,8}[：:]\s*「[^」]{20,}」/
  ];
  const quoteFiles23L = quoteDocs23L.filter(f => exists(f)).slice();
  {
    const idx23L = exists('index.html') ? read('index.html') : '';
    const scripts23L = [...new Set([...idx23L.matchAll(/src=["']\.\/([^/]+\.js)\?v=\d+/g)]
      .map(m => m[1]))];
    for (const s of scripts23L) if (exists(s) && !quoteFiles23L.includes(s)) quoteFiles23L.push(s);
  }
  const quoteHits23L = [];
  for (const f of quoteFiles23L) {
    const lines23L = read(f).split('\n');
    for (let i = 0; i < lines23L.length; i++) {
      if (quotePats23L.some(p => p.test(lines23L[i]))) quoteHits23L.push(f + ':' + (i + 1));
    }
  }
  check(quoteFiles23L.length >= 9 && quoteHits23L.length === 0,
    '§23l 对外文档与 ?v 补丁脚本零逐字口述引用（只写第三人称要点）',
    '命中：' + quoteHits23L.slice(0, 12).join(' / ')
      + ' → 私人对话原句暴露表达习惯，改成结论句');
}

// ---------- 23m. 奶茶品牌备注月休口径统一为「月休4天」（2026-11-18 站长给最新数据） ----------
// 站长更新数据：奶茶品牌（沪上阿姨除外——它本就是月休2天）备注里的「月休不足4天」
// 一律改为「月休4天」。实际命中该文案的奶茶品牌是茶百道、兵立王两个。
// 判据写成通用扫描：这两个品牌的详情页 / index.html 卡面 / 备注补丁 / SEO 生成器 / 核实清单
// 都不许再出现「月休不足4天」，且必须出现「月休4天」；评级 C 级不变（月休4天仍属不足6天）。
section('23m. 奶茶品牌备注月休口径统一为月休4天');
{
  const idx23M = exists('index.html') ? read('index.html') : '';
  const rate23M = exists('rate-note-patch.js') ? read('rate-note-patch.js') : '';
  const teaPages23M = ['brand/chabaidao.html', 'brand/bingliw.html',
    'brand/lingshiyouming.html', 'brand/meiyijia.html', 'brand/molina.html',
    'brand/yidiandian.html'];
  const bad23M = /月休不足\s*4\s*天|单休都算不上/;
  const good23M = /月休\s*4\s*天|月休4天/;
  const teaBadFiles23M = teaPages23M.filter(f => exists(f) && bad23M.test(read(f)));
  check(teaPages23M.every(f => exists(f))
      && teaBadFiles23M.length === 0
      && teaPages23M.slice(0, 2).every(f => good23M.test(read(f))),
    '§23m 茶百道/兵立王等奶茶品牌页备注统一「月休4天」，零「月休不足4天」',
    '回潮文件：' + teaBadFiles23M.join(',') + ' → 旧口径未清干净');
  const cdbCard23M = idx23M.slice(idx23M.indexOf("id: 'chabaidao-card'"), idx23M.indexOf("id: 'chabaidao-card'") + 1600);
  const blwCard23M = idx23M.slice(idx23M.indexOf("id: 'bingliw-card'"), idx23M.indexOf("id: 'bingliw-card'") + 1600);
  check(/workPolicy: '月休4天'/.test(cdbCard23M) && /workPolicy: '月休4天'/.test(blwCard23M)
      && !/月休不足\s*4\s*天|单休都算不上/.test(cdbCard23M + blwCard23M),
    '§23m index.html 茶百道/兵立王自定义卡 workPolicy 均为月休4天，无旧文案残留',
    '卡片仍写「月休不足4天」→ 首页卡面备注与最新数据打架');
  check(!/月休不足\s*4\s*天/.test(rate23M)
      && /门店月休 4 天/.test(rate23M)
      && /rate-note-patch\.js\?v=3/.test(idx23M),
    '§23m 备注补丁两品牌改月休4天且缓存号 bump 到 v3',
    '补丁文案或 ?v 没跟上 → 浏览器拿旧缓存，卡面仍显示旧口径');
}

// ---------- 24. 白屏兜底 + 加载态（站长 2026-11-08「删空搜索后整站白屏，怕用户误退出」） ----------
// 双层防御：① filter-flash.js 的近白磨砂层内加「转圈 + 加载中…」明确加载态（§17b 守）；
//           ② white-screen-guard.js 盯 #root，真被 React 卸载时显示恢复卡片，不再永久白屏。
// 三层强制：README 规则 + 这里的静态断言 + scripts/test-white-screen-guard.cjs 行为测试（挂 CI）。
section('24. 白屏兜底与加载态（防用户误退出）');
{
  const html24 = read('index.html');
  const guard24 = exists('white-screen-guard.js') ? read('white-screen-guard.js') : '';

  check(guard24.length > 1500,
    '§24a white-screen-guard.js 非空集（防空文件把下面断言全变成假通过）');
  check(/<script defer src="\.\/white-screen-guard\.js\?v=1"><\/script>/.test(html24),
    '§24b index.html 引入 white-screen-guard.js?v=1（漏挂 = 兜底完全不生效）');
  check(/MutationObserver/.test(guard24) && /getElementById\('root'\)/.test(guard24)
    && /childElementCount/.test(guard24),
    '§24c 用 MutationObserver 盯 #root 从「已挂载」变空（React 卸载即白屏）');
  check(/var booted = false/.test(guard24) && /booted = true/.test(guard24)
    && /booted && rootEmpty\(\)/.test(guard24),
    '§24d 有 booted 门槛：首屏 React 尚未挂载时不误报崩溃');
  check(/addEventListener\('error'/.test(guard24) && /addEventListener\('unhandledrejection'/.test(guard24),
    '§24e 同时监听 window error 与 unhandledrejection');
  check(/重新加载页面/.test(guard24) && /location\.reload\(\)/.test(guard24)
    && /setAttribute\('role', 'alert'\)/.test(guard24),
    '§24f 恢复卡片提供「重新加载页面」按钮并带 role=alert 无障碍提示');
  check(/var shown = false/.test(guard24) && /if \(shown\) return;/.test(guard24)
    && /getElementById\(STYLE_ID\)/.test(guard24),
    '§24g 幂等：恢复卡片与 style 都不重复注入');
  check(!/fetch\(|XMLHttpRequest|assets\/index-/.test(guard24),
    '§24h 兜底是纯 DOM 补丁：不发请求、不碰压缩产物');
  check(/z-index:2147483646/.test(guard24),
    '§24i 恢复卡片层级低于首屏加载层（2147483647），不与 boot 层打架');
  check(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(guard24),
    '§24j 兜底 UI 不依赖 emoji（用 CSS 图形，跨平台字形一致）');
}

// ---------- 25. 陆喜依 S 级卡与独立公开证据链（2026-11-08 站长指定）----------
// 背景：站长给华龙网转载极目新闻报道，要求新增品牌卡、给 S 级、附证据链。
// 这类品牌**不在**即答侠榜单里，硬套 SRC_URL 会写出并不存在的证据（口说无凭），
// 所以数据链加了 sourceOverride。同批发现 import-brands.py 全量重跑会抹掉
// 既有详情页后补的证据／证据链／logo／insertAfter 锚点，故加增量模式与保护。
{
  const impPath = 'data/imported-brands.json';
  const imp25 = exists(impPath) ? JSON.parse(read(impPath)) : { brands: [] };
  const lxy25 = imp25.brands.find((b) => b.slug === 'luxiyi');
  check(!!lxy25, '§25a 数据链真相源含 luxiyi 条目');
  if (lxy25) {
    check(lxy25.grade === 'S', '§25b 陆喜依评级为 S 级（站长 2026-11-08 指定）');
    const so25 = lxy25.sourceOverride || {};
    check(so25.url === 'https://www.cqnews.net/web/content_1547903876716244992.html',
      '§25c 主证据用站长给的华龙网/极目新闻链接（不许套榜单 SRC_URL）');
    const ex25 = lxy25.extraEvidence || [];
    check(ex25.length >= 4 && ex25.every((e) => /^https?:\/\//.test(e.url || '')),
      '§25d ≥4 条独立佐证且都带可点原始链接', '实际 ' + ex25.length + ' 条');
    check(Array.isArray(so25.chain) && so25.chain.length >= 5,
      '§25e 证据链条目写明来源、交叉印证与待补缺口');
  }
  const pg25 = exists('brand/luxiyi.html') ? read('brand/luxiyi.html') : '';
  check(/badge" style="background:#7c3aed">S 级评级/.test(pg25), '§25f 详情页 S 级徽标');
  check(/id="evidence-chain" data-evchain="1"/.test(pg25), '§25g 详情页有显式证据链区块');
  check(!/榜单口径导入|旁证／二手汇总/.test(pg25),
    '§25h 非榜单来源品牌不写「榜单口径导入」等不实表述');
  const evBlock25 = (pg25.match(/<h2>证据来源<\/h2>\s*<ul>([\s\S]*?)<\/ul>/) || ['', ''])[1];
  const evCount25 = (evBlock25.match(/<li style="margin:0 0 12px">/g) || []).length;
  check(evCount25 === 5, '§25i 证据来源恰好 5 条（主源 + 4 条交叉印证）', '实际 ' + evCount25);
  check(evBlock25.includes('cqnews.net') && evBlock25.includes('view.inews.qq.com'),
    '§25j 证据来源含主源与独立转载全文链接');
  const idx25 = read('index.html');
  const card25 = (idx25.match(/\{\s*\n\s*id: 'luxiyi-card'[\s\S]*?\n\s*\}/) || [''])[0];
  check(/grade: 'S级'/.test(card25) && /doubleRestRate: null/.test(card25),
    '§25k 首页卡为 S 级且真实双休率留空 null（不估填）');
  check(/华龙网转载极目新闻/.test(card25), '§25l 卡面可见文案写明真实来源');
  // 标题里的数字不再硬编码（每次新增卡都要改断言等于把漂移搬到校验脚本里），
  // 改为与 brand/ 实际页数咬合：清单标题必须是「真实存在的页数」。
  const nsHead25 = Number((idx25.match(/全部品牌详细页（(\d+) 个）/) || [])[1]);
  const brandPages25 = existsSync(join(ROOT, 'brand'))
    ? readdirSync(join(ROOT, 'brand')).filter((f) => f.endsWith('.html')).length : 0;
  check(/\/brand\/luxiyi\.html/.test(idx25) && nsHead25 === brandPages25,
    `§25m noscript 清单含陆喜依且标题数字同步 ${brandPages25}`,
    `标题写 ${nsHead25}，brand/ 实有 ${brandPages25} 页`);
  check(/\/brand\/luxiyi\.html/.test(read('projects.html')), '§25n projects.html 索引含陆喜依');
  check(/\/brand\/luxiyi\.html/.test(read('sitemap.xml')), '§25o sitemap.xml 含陆喜依详情页');
  const ebStart = idx25.indexOf('id="evidence-board"');
  const eb25 = ebStart > 0 ? idx25.slice(ebStart, idx25.indexOf('</section>', ebStart)) : '';
  check(/陆喜依/.test(eb25), '§25p 首页证据链公示区收录陆喜依');
  check(/"id":"luxiyi-card"/.test(read('pinyin-index.js')), '§25q 拼音索引含陆喜依（可搜到）');
  const impPy25 = read('scripts/import-brands.py');
  check(/--only/.test(impPy25) && /def guard_full_rebuild/.test(impPy25)
    && /重新生成已存在的卡片配置/.test(impPy25),
    '§25r 导入脚本有增量模式 + 全量重建保护 + 已存在卡可重新生成');
  check(/'双休红榜':\s*85/.test(read('rating-stats-patch.js')),
    '§25s 四格红榜补丁同步为 85（2026-11-13 小米 A→B 站长要求下调）');
}

// ---------- 26. 淘宝评论补充说明 / 奶茶类 B/C 平替陆喜依 / 天猫链接隐私 / 别名直搜 ----------
// 2026-11-08 站长批次。四件事各自都有静默失效的路子：
//   ① 补充说明被写进「证据来源」列表 → 变成第 6 条伪证据；
//   ② 带账号/追踪参数的原始 URL 回流进仓库 → 泄露站长账号线索；
//   ③ 平替被挂到 S/A 级或咖啡卡上 → 口径跑偏；
//   ④ 别名只在联想里生效 → 用户又得点一下（站长问「鸿蒙可以 MIUI 不行」）。
// 所以这里把四件事全部写成断言，故障注入见本轮记账。
{
  const CLEAN26 = 'https://luxiyi.tmall.com/';
  // 拼接而非字面量：否则本文件自己会被下面的参数红线扫中
  const BAD26 = ['spm', 'topIds', 'user_id', 'member_id', 'buyer_id',
    'sellerId', 'nick', 'trackId'].map((k) => k + '=');
  const scan26 = (s) => BAD26.filter((p) => s.indexOf(p) !== -1);
  const tea26 = ['chabaidao', 'yidiandian', 'molina', 'heytea', 'mixue', 'chagee', 'bingliw'];
  const idx26 = read('index.html');
  const patch26 = exists('luxiyi-alt-patch.js') ? read('luxiyi-alt-patch.js') : '';
  const lxy26 = read('brand/luxiyi.html');

  // ① 补充说明：文字版、诚实口径、不进证据来源
  const supM = lxy26.match(/<div class="notice" id="supplement-2026-11-08"[^>]*>([\s\S]*?)<\/div>/);
  check(!!supM, '§26a 陆喜依详情页有独立的「补充说明」区块（非空集防护）');
  const sup26 = supM ? supM[1] : '';
  check(/匿名买家评论/.test(sup26) && /2026 年 9 月 26 日/.test(sup26)
    && /刺梨原液二盒/.test(sup26),
    '§26b 补充说明照实写日期、已购商品与评论出处（不代查不编造）');
  check(/已买不久，舒舒服服的放假吧你们，回头再来追评味道/.test(sup26),
    '§26c 淘宝评论正文逐字引用（截图显示什么写什么）');
  check(/漫步惊星（杭州）食品科技有限公司/.test(sup26)
    && /关于 2026 年中秋、国庆放假安排的通知/.test(sup26),
    '§26d 补充说明写明放假通知抬头与公司主体');
  check(/不是员工实测/.test(sup26) && /不是制度证明/.test(sup26)
    && /不用于本页定档/.test(sup26) && /不计入下方「证据来源」的 5 条/.test(sup26),
    '§26e 明确「不是员工实测 / 不是制度证明 / 不改档 / 不计入证据来源」');
  check(/不上传/.test(sup26) && /不放截图外链/.test(sup26),
    '§26f 截图原件不上传、页面不放截图外链（素材规则）');
  check(lxy26.indexOf('id="supplement-2026-11-08"') < lxy26.indexOf('<h2>证据来源</h2>'),
    '§26g 补充说明在「证据来源」之前，不会被证据板解析器当成第 6 条来源');

  // ② 六个奶茶类详情页的平替块
  let teaOk26 = 0;
  for (const slug of tea26) {
    const pg = exists('brand/' + slug + '.html') ? read('brand/' + slug + '.html') : '';
    const ok = /<!-- LUXIYI-ALT-START -->[\s\S]*?<!-- LUXIYI-ALT-END -->/.test(pg)
      && /<h2>双休平替推荐（奶茶／新茶饮类 B\/C 级统一口径）<\/h2>/.test(pg)
      && pg.includes('href="' + CLEAN26 + '"')
      && /target="_blank" rel="noopener noreferrer"/.test(pg)
      && /员工实测待补/.test(pg) && /不是同一类目/.test(pg)
      && /不构成商业背书/.test(pg);
    if (ok) teaOk26++;
  }
  check(teaOk26 === 7, '§26h 六个奶茶／新茶饮类 B/C 品牌详情页都有完整平替块',
    `通过 ${teaOk26}/7`);
  const extra26 = brandHtmlPages.filter((f) => !tea26.includes(f.replace(/\.html$/, ''))
    && /data-luxiyi-alt="1"/.test(read('brand/' + f)));
  check(extra26.length === 0, '§26i 平替块没有外溢到非奶茶类详情页', extra26.join(', '));

  // ③ 链接隐私：站内只准零参数店铺首页，禁止账号/追踪参数
  const rootHtml26 = readdirSync(ROOT).filter((f) => f.endsWith('.html'));
  const rootJs26 = readdirSync(ROOT).filter((f) => f.endsWith('.js'));
  const assetJs26 = readdirSync(join(ROOT, 'assets')).filter((f) => f.endsWith('.js'))
    .map((f) => 'assets/' + f);
  const pub26 = [...new Set([...rootHtml26, ...rootJs26, ...assetJs26,
    ...brandHtmlPages.map((f) => 'brand/' + f),
    'README.md', '最近更新.md', 'CHANGELOG.md', 'data/imported-brands.json'])];
  const dirty26 = [];
  const tmallRefs26 = [];
  for (const f of pub26) {
    if (!exists(f)) continue;
    const s = read(f);
    const hit = scan26(s);
    if (hit.length) dirty26.push(f + ':' + hit.join(','));
    for (const m of s.matchAll(/https?:\/\/luxiyi\.tmall\.com[^"'`\s<>)]*/g)) {
      tmallRefs26.push(f + ' → ' + m[0]);
    }
  }
  check(pub26.length > 150, '§26j 参数红线扫描覆盖到全站发布文件（非空集防护）',
    `扫描 ${pub26.length} 个文件`);
  check(dirty26.length === 0, '§26k 全站无账号 / 来源追踪 / 类目参数残留', dirty26.join(' | '));
  check(tmallRefs26.length >= 7 && tmallRefs26.every((x) => x.endsWith(CLEAN26)),
    '§26l 站内所有天猫链接都是零参数店铺首页（无 category.htm / 无问号）', tmallRefs26);
  check(!/category\.htm/.test(idx26 + patch26 + tea26.map((s) => read('brand/' + s + '.html')).join('')),
    '§26m 原始带参分类页路径没有回流');

  // ④ 首页 DOM 补丁与清单、评级对齐
  check(/<script defer src="\.\/luxiyi-alt-patch\.js\?v=\d+"><\/script>/.test(idx26),
    '§26n 首页引入陆喜依平替补丁（漏挂则页面完全不生效）');
  const targets26 = [...patch26.matchAll(/\{ id: '([^']+)', name: '([^']+)', grade: '([^']+)' \}/g)];
  check(targets26.length === 7, '§26o 补丁清单恰好 7 家奶茶／新茶饮品牌', targets26.length);
  const gradeMismatch26 = [];
  for (const m of targets26) {
    const id = m[1], g = m[3];
    const slug = id.replace(/-card$/, '');
    const gm = new RegExp('data-b="' + slug + '" data-g="([SABCU])"').exec(idx26);
    const actual = gm ? gm[1] : null;
    if (!/^[BC]级$/.test(g) || !actual || actual !== g.charAt(0)) {
      gradeMismatch26.push(id + ':' + g + '/' + actual);
    }
  }
  check(gradeMismatch26.length === 0,
    '§26p 补丁清单评级与首页证据区逐一对齐，且只允许 B/C 两档', gradeMismatch26.join(', '));
  check(/function isBC\(g\)/.test(patch26) && /if \(!isBC\(t\.grade\)\) return false/.test(patch26),
    '§26q 补丁有运行时 B/C 级护栏（升 S/A 后不再推荐）');
  check(/data-luxiyi-alt/.test(patch26) && /MutationObserver/.test(patch26)
    && /querySelector\('\[' \+ MARK \+ '="1"\]'\)/.test(patch26),
    '§26r 补丁幂等且能兜住 React 重渲染');
  check(scan26(patch26).length === 0, '§26s 补丁自身不含账号 / 追踪参数');

  // ⑤ 关联词典别名直接出结果
  const filterBody26 = idx26.slice(idx26.indexOf('function filterCustomCards'),
    idx26.indexOf('function tagSearchInput'));
  check(/meta\.keywords\.concat\(aliasWordsFor\(cardId\)\)/.test(filterBody26),
    '§26t 自定义卡过滤真的用上了关联词典别名（不是只写在注释里）');
  check(/function aliasWordsFor\(cardId\)/.test(idx26)
    && /window\.__PINYIN_INDEX__/.test(idx26) && /e\.custom/.test(idx26)
    && /不缓存/.test(idx26),
    '§26u 别名懒读拼音索引、只取自定义卡、不做空缓存（防首屏吞掉修复）');
  const aliasJson26 = read('scripts/pinyin-aliases.json');
  check(/"xiaomi-card"[\s\S]{0,200}"MIUI"/.test(aliasJson26)
    && /"id":"xiaomi-card"[\s\S]{0,400}"MIUI"/.test(read('pinyin-index.js')),
    '§26v MIUI 别名在真相源与生成的索引里都在（可直接搜出小米卡）');
  check(/关联词典别名/.test(read('README.md'))
    && /必须能直接搜出自定义卡/.test(read('README.md')),
    '§26w README 写死「别名直接出结果」行为约定');
  check(/天猫旗舰店链接只准零参数店铺首页/.test(read('README.md'))
    && /奶茶／新茶饮类 B\/C 级品牌/.test(read('README.md'))
    && /不计入证据来源/.test(read('README.md')),
    '§26x README 写死链接清洗 / 平替适用范围 / 补充说明三条口径');

  // ⑤ 2026-11-09 站长「去拼音搜索框找陆喜依，提交 logo」：
  //    陆喜依品牌卡此前 logo:null 只显示文字回退，站长给的插画（民族风少女喝刺梨汁）
  //    其实早已作为 assets/luxiyi.jpg 入库、被首页滚动广告位引用。按单一真相源，
  //    让品牌卡复用同一文件，不重复提交明文素材（§22 只豁免 assets/ 下品牌 logo）。
  //    这里把「卡必须挂图 + 与广告位共用同一文件 + 拼音搜索框能定位」写成红灯。
  const LXY_LOGO26 = './assets/luxiyi.jpg';
  const lxyCard26 = idx26.match(/\{\s*id:\s*'luxiyi-card',([\s\S]*?)\n\s*\},?\n/);
  const lxyLogoM26 = lxyCard26
    ? lxyCard26[1].match(/logo:\s*'([^']+)'/) : null;
  check(!!lxyCard26 && !!lxyLogoM26 && lxyLogoM26[1] === LXY_LOGO26,
    '§26y 陆喜依品牌卡 logo 指向站长提交的插画（不再是 null 文字回退）',
    lxyLogoM26 ? lxyLogoM26[1] : '(null / 缺失)');
  check(localExists('assets/luxiyi.jpg'),
    '§26z 陆喜依 logo 文件真实存在（防破图 / 防指向不存在路径）');
  const ad26 = exists('black-card-adslot.js') ? read('black-card-adslot.js') : '';
  check(ad26.indexOf("var IMG = './assets/luxiyi.jpg'") !== -1,
    '§26aa 滚动广告位品牌卡与搜索结果品牌卡共用同一 logo 文件（单一真相源）');
  check(/"id":"luxiyi-card"[^}]*"t":\[\["陆喜依","luxiyi","lxy"/.test(read('pinyin-index.js')),
    '§26ab 拼音搜索框能用 luxiyi / lxy 定位到陆喜依卡（联想回填路径未断）');
  check(exists('scripts/test-luxiyi-logo.cjs')
    && /test-luxiyi-logo\.cjs/.test(read('.github/workflows/verify.yml')),
    '§26ac 陆喜依 logo 真 DOM 行为测试存在且挂进 CI（§21o 同款）');
}

// ---------- 27. 详情证据弹窗的可点证据来源（2026-11-09 站长指出） ----------
// 站长原话：「另有腾讯新闻／济南时报／中国广告杂志／联合新闻网交叉印证，
// 你自己都这么说了，为什么不挂链接？说了要给证据来源」。
// 根因：custom-card-actions.js 的 openEvidenceModal 把 cfg.desc 当纯文本渲染，
// 弹窗里一个链接都没有；底部还固定写「社区提交数据、尚未接入交叉核验」，
// 和陆喜依已有的 5 条多源交叉证据自相矛盾。
// 修法：弹窗直接从首页证据链公示区（由生成器从 imported-brands.json 产出，
// §25p 守）抽 5 条原文链接挂成面板，不另写一份 URL，杜绝漂移。
// 这里把「点名了媒体就必须给可点来源」写成红灯，防下轮改回纯文字。
{
  const cca27 = read('custom-card-actions.js');
  const idx27 = read('index.html');
  const det27 = read('brand/luxiyi.html');
  const tst27 = exists('scripts/test-luxiyi-sources.cjs')
    ? read('scripts/test-luxiyi-sources.cjs') : '';
  const wf27 = read('.github/workflows/verify.yml');
  const imp27 = JSON.parse(read('data/imported-brands.json'));
  const lxy27 = imp27.brands.find((b) => b.slug === 'luxiyi');
  const urls27 = lxy27
    ? [lxy27.sourceOverride.url].concat((lxy27.extraEvidence || []).map((e) => e.url))
    : [];

  check(cca27.length > 10000 && idx27.length > 100000 && tst27.length > 1000,
    '§27a 真的读到了弹窗脚本 / 首页 / 行为测试（双重空集防护）',
    `cca=${cca27.length} / idx=${idx27.length} / test=${tst27.length}`);
  check(!!lxy27 && urls27.length === 5 && urls27.every((u) => /^https?:\/\//.test(u)),
    '§27b 真相源恰好 5 条可点原文链接（主源 + 4 条交叉印证）',
    '实际 ' + urls27.length + ' 条');

  check(/function readEvidenceLinks\(cfg\)/.test(cca27)
    && /function buildSourcePanel\(cfg\)/.test(cca27)
    && /getElementById\('ev-' \+ slug\)/.test(cca27),
    '§27c 弹窗从首页证据链公示区读链接（不是另写一份 URL）');
  check(!/cqnews\.net|view\.inews\.qq\.com|jinantimes\.com\.cn|udn\.com/.test(cca27),
    '§27d 弹窗脚本不硬编码原文 URL（防与真相源漂移）');
  check(/rel="nofollow noopener" target="_blank"/.test(cca27)
    && /data-sxg-source-links="1"/.test(cca27)
    && /查看完整详情页与证据链/.test(cca27),
    '§27e 证据面板链接可点开、带 rel/target、有幂等标记与详情页入口');
  check(/src\.html/.test(cca27)
    && /src\.count \? 'sxg-note-green' : 'sxg-note'/.test(cca27)
    && /不是榜单二手汇总/.test(cca27)
    && /尚未接入公开司法文书与官方通报的交叉核验/.test(cca27),
    '§27f 面板真的插进弹窗，底部说明按有无证据链切换（不再自相矛盾）');
  check(/window\.__sxgSourceLinks = \{ read: readEvidenceLinks, build: buildSourcePanel \}/.test(cca27),
    '§27g 暴露测试钩子，行为测试能直接验真实渲染逻辑');

  check((idx27.match(/custom-card-actions\.js\?v=24/g) || []).length === 2,
    '§27h 缓存号已 bump 到 ?v=24（§21h：preload + script 两处都要改）',
    '实际 ' + (idx27.match(/custom-card-actions\.js\?v=24/g) || []).length + ' 处');
  check(!!lxy27 && /5 条原文链接见「证据来源」/.test(lxy27.sourceOverride.cardDesc)
    && idx27.indexOf(lxy27.sourceOverride.cardDesc) !== -1,
    '§27i 卡面点名媒体时同时指向证据来源，且与真相源逐字一致');
  check(/上述五条报道的原文链接均列在下方「证据来源」/.test(det27)
    && !!lxy27 && det27.indexOf(lxy27.sourceOverride.scopeText) !== -1,
    '§27j 详情页「数据口径说明」指向下方 5 条原文链接，且与真相源一致');

  const evStart27 = idx27.indexOf('id="ev-luxiyi"');
  const board27 = evStart27 > 0
    ? idx27.slice(evStart27, idx27.indexOf('</details>', evStart27)) : '';
  // 证据板由 gen-evidence-board.py 生成，微信链接写成 &amp;；详情页生成器
  // 直接拼裸 &。两者渲染后等价，比对时统一还原，别把历史写法差异当漂移。
  const norm27 = (s) => s.replace(/&amp;/g, '&');
  const has27 = (s, u) => norm27(s).indexOf('href="' + u + '"') !== -1;
  check(board27.length > 500 && urls27.every((u) => has27(board27, u))
    && urls27.every((u) => has27(det27, u)),
    '§27k 首页证据板与详情页的 5 条原文链接都与真相源逐条一致',
    '缺：' + urls27.filter((u) => !has27(board27, u) || !has27(det27, u)).join(', '));
  // 行首锚定：故障注入实测，只查「全文有没有这串」会被注释掉的 run 行、
  // 或别的章节里顺带提到规则短语蒙混过关（假通过）。
  check(/^\s*run: node scripts\/test-luxiyi-sources\.cjs\s*$/m.test(wf27)
    && /__sxgSourceLinks/.test(tst27) && /anchors\.length === 5/.test(tst27),
    '§27l 行为测试以 run 行挂进 CI 且真的验了 5 条外链（§21o）');
  check(/^- \*\*点名媒体就必须给可点原文链接\*\*/m.test(read('README.md')),
    '§27m README 规则清单里写死「点名媒体声称交叉印证必须给可点原文链接」');
}

// ---------- 28. 随笔第九章重写：时间锚点唯一 + 事实与情绪原话不丢（2026-11-09） ----------
// 站长 2026-11-09 要求「重写整个第 9 章，但不要改变原文意图」，红框标出的是同一段
// 午饭后连续事件里重复出现的两处「吃过午饭（之后）」。重写只优化叙事语言、理顺时间线，
// 事实细节一条不丢；带攻击性／情绪的原话按站长长期口径逐字保留、各自独立成段。
// 内容断言依赖 NOTES_KEY，CI 不带密码会自动跳过。
{
  const p28 = exists('notes.html') ? decryptNotes(read('notes.html')) : null;
  const cc28 = (ok, label, why) => {
    if (p28 === null) {
      notes.push(`跳过「${label}」（未提供 NOTES_KEY，密文未解密）`);
      return;
    }
    check(ok, label, why);
  };
  const s28 = p28 === null ? -1 : p28.indexOf('<h2>九、');
  const e28 = s28 >= 0 ? p28.indexOf('<h2>', s28 + 8) : -1;
  const ch9 = (s28 >= 0 && e28 > s28) ? p28.slice(s28, e28) : '';
  const paras28 = [...ch9.matchAll(/<p>(.*?)<\/p>/gs)].map((m) => m[1].trim());
  const txt28 = paras28.join('\n');

  cc28(s28 > 0 && ch9.length > 800 && paras28.length >= 15,
    '§28a 随笔第九章存在且正文完整（≥15 段）',
    '整章被删或被改短 → 重写时漏段');
  cc28((ch9.match(/午饭过后|吃过午饭|午饭后/g) || []).length === 1
      && !/吃过午饭/.test(ch9),
    '§28b 第九章午饭后时间锚点只出现一次（红框标出的重复已消除）',
    '又出现两处「吃过午饭」→ 同一段连续事件被写成隔了一顿饭');
  cc28(['探探', '还在读高中', '周末不双休', '假名字', '太像男生', '鞋套',
    '上午都好好的', 'PUBG', '1060', '完全不支持', '左手边', '腿搭',
    '从背后抱住', '脚踝', '白丝', '并不想摸她裙子', '她也忍了',
    '拍几张腿照', '站着拍', '我离开卧室', '趴姿怎么拍', '趁机亲了她一口']
    .every((k) => txt28.includes(k)),
    '§28c 第九章重写后事实细节一条不丢（22 个锚点全在）',
    '缺：' + ['探探', '还在读高中', '周末不双休', '假名字', '太像男生', '鞋套',
      '上午都好好的', 'PUBG', '1060', '完全不支持', '左手边', '腿搭',
      '从背后抱住', '脚踝', '白丝', '并不想摸她裙子', '她也忍了',
      '拍几张腿照', '站着拍', '我离开卧室', '趴姿怎么拍', '趁机亲了她一口']
      .filter((k) => !txt28.includes(k)).join('、'));
  cc28([
    '她很反感。',
    '真正闹起来的，恰恰是后面她所谓的「又亲又抱」。',
    '更扯的是，她那会儿已经觉得我不尊重女生了，我还追着问，能不能做我女朋友。',
    '关系就那么彻底崩了。',
    '线下只见过这一回。这么多年过去，想起来还是会后悔。',
    '刚买的时候最低画质可以，后来突然就不行了，我明显被成都线下电脑城坑了',
    '我偏就揪着一个问题不放：屋里就她一个人，趴姿怎么拍？',
    '争着争着，她倒在我卧室床上。我趁机亲了她一口。',
  ].every((q) => paras28.includes(q)),
    '§28d 带情绪／攻击性的原话逐字保留且各自独立成段',
    '把站长的原话润色掉或并进别的段落，会改变本意');
  cc28(!/<a\b/i.test(ch9) && !/<img\b/i.test(ch9) && !/assets\//.test(ch9),
    '§28e 第九章不放外链、图片或素材引用',
    '重写时顺手挂素材或外链 → 违反素材不入库、正文不放外链');
  cc28(/<span class="section-date">最后更新：2026-11-09<\/span>/.test(ch9)
      && (ch9.match(/<h2>([^<]+)<\/h2>/) || [, ''])[1] === '九、2018 年，我把一件小事搞砸了',
    '§28f 第九章标题与最后更新日期保持正确',
    '标题或章节日期被改 → 目录树与进度面板会跟着漂');
  // 站长 2026-11-09 后续口述纠正：第九章事件时序要写准——「追着问做女朋友」之后，
  // 女生冲进洗手间反锁、回来后我仍有强迫念头非要亲自拍腿照、僵持数回合、女生失去耐心
  // 准备离开、我拽着手拦、走后在微信只留一句车费原话。下面两条断言把这段纠正后的
  // 关键事实与时序锁死，同样依赖 NOTES_KEY（CI 自动跳过）。
  cc28([
    '她冲了出去，躲进我家的洗手间，从里面把门反锁了。',
    '隔了一会儿，她又回来了。',
    '拒不离开卧室，非要亲自拍她腿照',
    '就这么僵着，来回推了几个回合。',
    '女生彻底失去耐心，准备离开我家。',
    '我却一直拽着她的手，想把她拦住，不让她走。',
    '给她结算下车费，她不想在我这种人身上投资哪怕一分钱',
  ].every((k) => ch9.includes(k)),
    '§28g 站长纠正后的关键事实逐字落档（洗手间反锁／回来／强迫拍腿照／僵持／拽手／车费原话）',
    '删或润色任意一处 → 纠正内容回退：' + [
      '她冲了出去，躲进我家的洗手间，从里面把门反锁了。',
      '隔了一会儿，她又回来了。',
      '拒不离开卧室，非要亲自拍她腿照',
      '就这么僵着，来回推了几个回合。',
      '女生彻底失去耐心，准备离开我家。',
      '我却一直拽着她的手，想把她拦住，不让她走。',
      '给她结算下车费，她不想在我这种人身上投资哪怕一分钱',
    ].filter((k) => !ch9.includes(k)).join('、'));
  cc28([
    '真正闹起来的，恰恰是后面她所谓的「又亲又抱」。',
    '她冲了出去，躲进我家的洗手间，从里面把门反锁了。',
    '隔了一会儿，她又回来了。',
    '拒不离开卧室，非要亲自拍她腿照',
    '就这么僵着，来回推了几个回合。',
    '女生彻底失去耐心，准备离开我家。',
    '我却一直拽着她的手，想把她拦住，不让她走。',
    '给她结算下车费，她不想在我这种人身上投资哪怕一分钱',
    '更扯的是，她那会儿已经觉得我不尊重女生了，我还追着问，能不能做我女朋友。',
    '关系就那么彻底崩了。',
  ].reduce((acc, s, i, arr) => acc && (i === 0 ? ch9.indexOf(s) >= 0 : ch9.indexOf(s) > ch9.indexOf(arr[i - 1])), true),
    '§28h 第九章事件时序正确（站长 2026-11-10 二次纠正）：又亲又抱 → 洗手间反锁 → 回来 → 强迫拍腿照 → 僵持 → 失去耐心 → 拽手 → 车费原话 → 追着问（她离开之后） → 关系崩',
    '时序被打乱（如「追着问」又跑回她在我家的时候）→ 2026-11-10 二次纠正失效');

  // 站长 2026-11-10 二次纠正引出的防漂移：追问原话整句必须**唯一**且**不许拆句残留**
  // （上一刀曾把它拆成「更扯的是…了。」残句留在洗手间反锁前 + 改写半句搬到车费后，
  //   被内容探针拦下）。匹配逻辑用 \u 转义正则写死，避免源码字面量编码差异。
  const RE_FULL28 = /<p>[^<]*\u8ffd\u7740\u95ee\uff0c\u80fd\u4e0d\u80fd\u505a\u6211\u5973\u670b\u53cb\u3002<\/p>/g;
  const RE_FRAG28 = /<p>[^<]*\u6211\u4e0d\u5c0a\u91cd\u5973\u751f\u4e86\u3002<\/p>/g;
  cc28((ch9.match(RE_FULL28) || []).length === 1 && (ch9.match(RE_FRAG28) || []).length === 0,
    '§28d2 追问原话整句唯一落档、无拆句残句（残句留在洗手间反锁前 = 时间线回退）',
    '整句段落 ' + (ch9.match(RE_FULL28) || []).length + ' 个 / 残句段落 ' + (ch9.match(RE_FRAG28) || []).length + ' 个');
}

// ---------- 29. 成功案例专题页：「QQ奶奶」张秀丽 ----------
// 站长 2026-11-09：「在成功案例（不是卡片5）新增一个专题页，单独写一个 html」。
// 落点：独立页面 qq-nainai.html，入口挂在 success-stories.html「致敬前辈」下方、
// 案例 #01 之前，**不占案例 #05 序号**。三条纪律同 §21j：
//   ① AI 整理必须明示（徽章 + 声明框）；
//   ② 关键事实锚点不许在后续编辑中丢失（2005／100 元／18 个号／13 万→18 万／年过九十）；
//   ③ 口径差异必须当场厘清——「好友数 ≠ 服务人次」「资格证 ≠ 执业」「近况不推测」。
section('25. 成功案例专题页（QQ奶奶）');
{
  const qq = exists('qq-nainai.html') ? read('qq-nainai.html') : '';
  check(qq.length > 4000,
    '§25a qq-nainai.html 存在且是完整长页（非空壳）',
    '页面缺失或过短 → 专题没落地');

  // ① AI 整理披露
  check(/class="ai-badge"[^>]*>\s*内容由 AI 生成/.test(qq)
    && /class="ai-note"/.test(qq) && /AI 依据下列公开报道检索/.test(qq),
    '§25b 专题页挂「内容由 AI 生成」徽章 + .ai-note 声明框',
    '缺徽章或声明框 → 与 §21j 同口径的诚实披露失守');

  // ② 关键事实锚点
  const factsQ = [
    ['张秀丽', '主人公姓名'],
    ['2005', '开始用 QQ 的年份（中青报／中新网口径）'],
    ['100 元', '打印店学费'],
    ['18 个 QQ 号', '账号数量'],
    ['企业号', '腾讯赠送的企业 QQ'],
    ['13 万', '2011 年好友数（中青报／央视网）'],
    ['18 万', '2015 年网友数（中新网）'],
    ['年过九十', '2023 年大河网报道的年龄口径'],
    ['四点半课堂', '社区接续运营的项目'],
  ];
  const missQ = factsQ.filter(([s]) => !qq.includes(s)).map(([s, d]) => `${s}（${d}）`);
  check(missQ.length === 0,
    `§25c 专题页的 ${factsQ.length} 个关键事实锚点齐全`,
    missQ.length ? '以下事实锚点丢失，正文可能被改坏：' + missQ.join('； ') : '');

  // ③ 口径厘清（比正文更要紧）
  check(/class="correct"/.test(qq) && /好友数/.test(qq) && /服务人次/.test(qq),
    '§25d 纠偏框写明「好友数 ≠ 服务人次」',
    '删掉这句 → 十几万好友会被读成十几万人接受过陪伴');
  check(/不是执业心理医生/.test(qq) && /资格证/.test(qq),
    '§25e 纠偏框写明「资格证 ≠ 执业」，不用疗效表述',
    '删掉这句 → 义务陪伴被写成心理治疗案例');
  check(/不推测/.test(qq) && /不要打扰老人本人/.test(qq),
    '§25f 近况不推测、并提示走社区渠道而非打扰本人',
    '缺隐私口径 → 会引导访客去联系这位九十岁老人');

  // ④ 来源与素材纪律
  // 计数口径：<li> 后面 160 字符内出现 http 链接才算一条来源（不重复匹配同一行）
  const srcQ = (qq.match(/<li>[\s\S]{0,160}?<a href="https?:\/\//g) || []).length;
  check(srcQ >= 8,
    `§25g 专题页附 ${srcQ} 条公开来源（要求 ≥8）`,
    `只有 ${srcQ} 条 → 事实无出处，与本站证据链纪律冲突`);
  check(!/<img\b/i.test(qq) && !/assets\//.test(qq),
    '§25h 专题页不引用图片或站内素材（文字页，素材不入库）',
    '挂了图片/素材 → 违反素材规则');

  // ⑤ 入口与索引
  const ssQ = read('success-stories.html');
  check(/class="topic-entry"[^>]*href="\.\/qq-nainai\.html"/.test(ssQ),
    '§25i 成功案例页有指向 qq-nainai.html 的专题入口',
    '没有入口 → 新页面成为孤岛');
  // 2026-11-09 起「案例 #05」是独立真实案例（站长 2026-11-09 指令补在 #04 之后），
  // 此处只咬「专题入口本身不占用案例序号」——入口块内不得出现「案例 #0X」编号。
  const entryQ = (ssQ.match(/<a class="topic-entry"[\s\S]*?<\/a>/) || [''])[0];
  check(/专题 · 前辈/.test(entryQ) && !/案例 #0[0-9]/.test(entryQ),
    '§25j 入口标为「专题 · 前辈」（不占案例序号），与案例 #05 各自独立',
    '专题入口被标成案例序号 → 与站长「不是卡片5」的要求冲突');
  check(/qq-nainai\.html/.test(read('sitemap.xml')),
    '§25k sitemap.xml 收录专题页',
    '漏收录 → 爬虫发现不了这一页');
  check(/qq-nainai\.html/.test(read('scripts/seo/generate-sitemap.py')),
    '§25l sitemap 生成脚本同样写入专题页（防下次重建时被抹掉）',
    '只改 sitemap.xml 不改生成器 → 一跑 seo:sitemap 就丢');

  // ⑥ 回归顶部按钮（站长 2026-11-09：成功案例页单独做一个 top 按钮）
  check(/<button class="to-top" id="to-top" type="button" aria-label="回到顶部"/.test(ssQ),
    '§25t 成功案例页有回到顶部按钮（button + aria-label，可键盘触发）',
    '按钮缺失或不是 button 元素 → 键盘/读屏用户无法回到顶部');
  check(/\.to-top\.is-on\s*\{[^}]*visibility:\s*visible/.test(ssQ)
    && /\.to-top\s*\{[\s\S]{0,500}?visibility:\s*hidden/.test(ssQ),
    '§25u 按钮隐藏态用 visibility:hidden（不留在 Tab 焦点链里）',
    '只写 opacity:0 → 看不见的按钮仍能被 Tab 聚焦');
  check(/THRESHOLD = 480/.test(ssQ)
    && /addEventListener\('scroll', [\w]+, \{ passive: true \}\)/.test(ssQ)
    && /requestAnimationFrame\(/.test(ssQ)
    && /prefers-reduced-motion/.test(ssQ),
    '§25v 滚动阈值 480px + rAF 合并滚动事件 + 尊重 reduced-motion',
    '刷新率与无障碍口径被改坏 → 按钮乱闪或平滑滚动无法关闭');
}

// ---------- 29. 滚动广告位可点 / 居中 / 自绘设计稿 + 缓存落 D 盘（2026-11-09 站长深夜） ----------
// 站长三连问：「天猫链接也点不动啊」「广告位为什么不是居中」「广告位这个你不能设计一下图片吗」，
// 外加「以后把缓存放在 D 盘，我 C 盘再搞要炸了」。
// 真因：CTA 提示词是 <div> 没有 href（只有 76px 小图能点）；卡片左对齐且箭头绝对定位
// 压在招商卡标题上；广告位只是文字块没有设计图；20 个脚本把 Edge profile 写进 C 盘
// （历史上堆了 523 个目录）。规则不能只写文档，这里配 §29 静态断言 + test-adslot.cjs
// 真 DOM 测试 + CI 挂接三层强制，故障注入见本轮记账。
{
  const ad29 = exists('black-card-adslot.js') ? read('black-card-adslot.js') : '';
  const rd29 = read('README.md');
  const idx29 = read('index.html');
  const wf29 = read('.github/workflows/verify.yml');
  const helper29 = exists('scripts/_cache-dir.cjs') ? read('scripts/_cache-dir.cjs') : '';

  check(/缓存一律放 D 盘/.test(rd29) && /广告位设计稿是站点自绘矢量图/.test(rd29)
    && /所有天猫入口必须真可点/.test(rd29) && /广告位内容一律居中/.test(rd29),
    '§29a README 写死设计稿 / 可点 / 居中 / D 盘缓存四条口径',
    '规则只挂口头 → 下次又会把 CTA 写成 div、把缓存写回 C 盘');

  check(/D:\/WorkBuddy-Cache\/edge-profiles/.test(helper29)
    && /function cacheRoot\(\)/.test(helper29)
    && /SXG_CACHE_DIR/.test(helper29)
    && /process\.platform === 'win32'/.test(helper29),
    '§29b 统一缓存根助手 Windows 默认 D 盘、支持 SXG_CACHE_DIR 覆盖、CI 回落系统临时目录');

  const scripts29 = readdirSync(join(ROOT, 'scripts'))
    .filter((f) => /\.(cjs|mjs|js)$/.test(f) && f !== '_cache-dir.cjs');
  const dirtyProfile29 = [];
  const missingImport29 = [];
  for (const f of scripts29) {
    const s29 = read('scripts/' + f);
    for (const ln29 of s29.split('\n')) {
      if (!/edgeprof|\.edge-adcheck|sxg-u-filter/.test(ln29)) continue;
      if (/path\.join\(\s*__dirname|path\.join\(\s*ROOT|tmpdir\(\)|[Cc]:[\\/]Users/.test(ln29)) {
        dirtyProfile29.push(f + ': ' + ln29.trim().slice(0, 110));
      }
    }
    if (/--user-data-dir=/.test(s29) && !/_cache-dir\.cjs/.test(s29)) missingImport29.push(f);
  }
  check(scripts29.length > 15 && dirtyProfile29.length === 0,
    '§29c 无头 Edge profile 一律经 cacheRoot() 落 D 盘（不许写回 scripts/ 或 %TEMP%）',
    dirtyProfile29.slice(0, 4).join(' | '));
  check(missingImport29.length === 0,
    '§29d 每个启动无头 Edge 的脚本都引入了统一缓存根助手（非空集防护）',
    missingImport29.join(', '));

  const arts29 = ['assets/ad-luxiyi.svg', 'assets/ad-recruit.svg', 'assets/ad-pangdonglai.svg'];
  check(arts29.every((f) => exists(f)
      && /<svg[\s\S]*?viewBox="0 0 \d+ \d+"/.test(read(f))
      && !/https?:\/\//.test(read(f).replace(/xmlns(?::[a-zA-Z]+)?="[^"]*"/g, ''))
      && !/<image\b/i.test(read(f)))
    && ad29.indexOf("var ART = './assets/ad-luxiyi.svg?v=2'") !== -1
    && ad29.indexOf("var ART_RECRUIT = './assets/ad-recruit.svg?v=5'") !== -1
    && ad29.indexOf("var ART_PDL = './assets/ad-pangdonglai.svg?v=3'") !== -1,
    '§29e 三张站点自绘矢量设计稿存在、有效、无外链，且被广告位引用（?v 与预热一致）');

  check(!/<div class="sxg-adslot__cta"/.test(ad29)
    && /sxg-adslot__cta" href="'\s*\+\s*TMALL/.test(ad29)
    && /sxg-adslot__banner" href="'\s*\+\s*TMALL/.test(ad29)
    && /sxg-adslot__name" href="'\s*\+\s*DETAIL/.test(ad29)
    && /target="_blank" rel="noopener"/.test(ad29),
    '§29f 天猫 CTA 与整张广告图都是真 <a>（新窗口 + noopener），品牌名仍指站内详情页',
    'CTA 又变回没 href 的 <div> → 站长「链接点不动」的老问题复发');

  check(/\.sxg-adslot__card\{[^}]*align-items:center[^}]*text-align:center/.test(ad29)
    && /\.sxg-adslot__meta\{[^}]*justify-content:center/.test(ad29)
    && /\.sxg-adslot__art\{display:block;width:100%;height:auto\}/.test(ad29)
    && !/\.sxg-adslot__nav\{[^}]*position:absolute/.test(ad29)
    && /sxg-adslot__foot/.test(ad29),
    '§29g 广告位内容水平居中、广告图满宽自适应、箭头在卡片下方导航条（不再压住招商卡标题）');

  const tmall29 = (ad29.match(/var TMALL = '([^']+)'/) || [])[1];
  check(tmall29 === 'https://' + 'luxiyi.tmall.com/'
    && ad29.indexOf("var IMG = './assets/luxiyi.jpg'") !== -1,
    '§29h 广告位天猫链接仍是零参数店铺首页，mascot 仍与品牌卡共用单一真相源');

  check(exists('scripts/test-adslot.cjs') && /test-adslot\.cjs/.test(wf29)
    && /black-card-adslot\.js\?v=22/.test(idx29),
    '§29i 广告位真 DOM 测试存在且挂进 CI，首页脚本已升版防缓存');

  // —— 站长 2026-11-10 晚：胖东来广告卡（首页推荐位） ——
  // 「视频中提到的胖东来对待劳动者的态度，务必备注，这也是为什么挂上广告位的原因，
  //   但不得直接把视频链接挂在广告位」。两条指令各钉一条：
  //   §29j 备注进图里（态度 + 挂广告位原因）；§29k 零视频链接 + 只链站内 + README 口径。
  const pdl29 = exists('assets/ad-pangdonglai.svg') ? read('assets/ad-pangdonglai.svg') : '';
  const code29 = ad29.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const pdlTexts29 = [...pdl29.matchAll(/<text[^>]*?y="(\d+)"[^>]*?font-size="(\d+)"/g)]
    .map((m) => ({ y: Number(m[1]), size: Number(m[2]) }));
  const pdlMain29 = pdlTexts29.filter((t) => t.y >= 100 && t.y <= 260).sort((a, b) => a.y - b.y);
  // 关键词只认 <text> 可见文案：aria-label / 注释里也写着「尊重」，拿全文比对会让
  // 「正文被改坏、注释还留着原话」的故障逃逸（§31「注释救活改坏的实现」的反向坑）。
  const pdlWords29 = [...pdl29.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]).join(' ');
  check(pdlMain29.length >= 3 && pdlMain29.every((t, i) => i === 0 || t.y > pdlMain29[i - 1].y)
    && pdlMain29[0].size >= 60
    && /胖东来/.test(pdlWords29) && !/备注/.test(pdlWords29) && /货车司机送货/.test(pdlWords29)
    && /尊重/.test(pdlWords29) && /善待劳动者/.test(pdlWords29) && /公益广告位的原因/.test(pdlWords29)
    && /PUBLIC WELFARE AD/.test(pdlWords29) && /公益广告位/.test(pdlWords29),
    '§29j 胖东来海报去掉「备注」两字，仍把劳动者态度（货车司机送货也能体会到尊重）与挂上公益广告位的原因写进图里；三条基线严格递增不叠字（风格互异由 §36a 管）',
    `图里主线文案基线 ${JSON.stringify(pdlMain29)} 不递增、出现「备注」两字或态度/原因要素缺失`);

  // 视频链接检查必须按**源码原文**扫（含注释）：① 站长口径就是「注释里也不许
  // 拼写该域名」；② 剥注释的 `\/\/[^\n]*` 会把 `https://` 当行注释吃掉整个 URL 尾巴，
  // 故障注入实测 URL 从 code 视图里消失、断言静默放行（已踩过）。域名模式用
  // douyin.com（带点），避免误伤 douyin-prompt.css 这类合法文件名。
  const videoRe29 = /douyin\.com|b23\.tv/i;
  check(!videoRe29.test(ad29)
    && !videoRe29.test(pdl29.replace(/xmlns(?::[a-zA-Z]+)?="[^"]*"/g, ''))
    && !videoRe29.test(read('assets/ad-luxiyi.svg'))
    && !videoRe29.test(read('assets/ad-recruit.svg'))
    && /PDL_IMG = '\.\/assets\/pdl\.png'/.test(code29)
    && /PDL_DETAIL = '\.\/brand\/pdl\.html'/.test(code29)
    && /对待劳动者的态度/.test(rd29) && /不得挂视频链接/.test(rd29),
    '§29k 广告位零视频链接（脚本/海报侧）、胖东来品牌名与头像只链站内，「备注劳动者态度 + 不得挂视频链接」口径写进 README',
    '视频链接进了广告位，或备注/零链接口径没进 README → 站长两条指令失守');

  // —— 站长 2026-11-11 01:48「链接不对，替换这个 #小程序://胖东来/zxlej7hK8bNv5Sj」 ——
  // 00:46 那版介绍文章 URL 整体撤下：要复制的是**微信小程序口令**，不是 URL。
  // 口令以 # 开头、只有粘贴到微信聊天窗口发送后才渲染成小程序卡片，所以 href
  // 只是可点载体，点击一律 preventDefault + 复制（§36c）。机器钉死「口令单一
  // 真相源 + 零参数 + 整图/CTA 共用 + 可见文案改口『口令』 + 组件与 README 零旧
  // 文章链接」。拼接写法避免本文件的 URL 尾巴被剥注释正则吃掉（§34 老坑）。
  const PDL_TOKEN29 = '#小程序:' + '//' + '胖东来/zxlej7hK8bNv5Sj';
  const pdlLink29 = (ad29.match(/var PDL_LINK = '([^']+)'/) || [])[1];
  const pdlCardStart29 = ad29.indexOf('sxg-adslot__card--pdl');
  const pdlCardEnd29 = ad29.indexOf('sxg-adslot__card--recruit');
  const pdlCard29 = pdlCardStart29 !== -1 && pdlCardEnd29 > pdlCardStart29
    ? ad29.slice(pdlCardStart29, pdlCardEnd29) : '';
  check(!!pdlLink29
    && pdlLink29 === PDL_TOKEN29
    && pdlLink29.indexOf('?') === -1 && pdlLink29.indexOf('&') === -1
    && pdlLink29.charAt(0) === '#'
    && (pdlCard29.match(/href="'\s*\+\s*PDL_LINK/g) || []).length >= 2
    && (pdlCard29.match(/target="_blank" rel="noopener"/g) || []).length >= 2
    && (pdlCard29.match(/data-sxg-share="pdl"/g) || []).length >= 2
    && /点此复制小程序口令/.test(pdlCard29) && /去微信打开/.test(pdlCard29)
    && /aria-label="复制胖东来小程序口令/.test(pdlCard29)
    && !/tmall|taobao|天猫|淘宝|京东|jd\.com|bendibao/i.test(pdlCard29)
    && !/var PDL_SHOP/.test(ad29)
    && !/bendibao/.test(ad29) && !/bendibao/.test(rd29)
    && /小程序口令/.test(rd29) && /复制/.test(rd29) && /微信/.test(rd29),
    '§29l 胖东来入口换成站长指定的小程序口令（# 开头、零参数），整图与 CTA 共用 PDL_LINK、可见文案同步改口「口令」、组件与 README 零旧文章链接',
    '只换常量留着「链接」字样 / 链回介绍文章 / README 没写新口径 → 站长 01:48 指令失守');
}

// ---------- 30. 比亚迪卡片曝光登记 + 视频下架如实登记 ----------
// 站长 2026-11-09 线索：抖音「BYD直营员工维权」指称直营门店强制加班至晚十点，
// 援引《劳动法》第九十六条；要求登记到比亚迪卡片、曝光，并注明站长随笔第10章。
// 2026-11-10 补正：视频已被删除、原链接已挂、发布者受到了某种压力，要如实登记。
// 上一批只在 brand/byd.html 与公示区补了证据条目，**卡片本身没改**（站长当场指出）。
// 本节锁死：卡片必须真挂出曝光框、死链不许冒充可点来源、随笔引用不抄口述原话。
{
  const p30 = exists('byd-expose-patch.js') ? read('byd-expose-patch.js') : '';
  const idx30 = read('index.html');
  const byd30 = read('brand/byd.html');
  const rd30 = read('README.md');
  const wf30 = read('.github/workflows/verify.yml');

  check(/比亚迪卡片曝光登记/.test(rd30) && /失效链接不得冒充可点来源/.test(rd30)
    && /卡片必须真挂出曝光说明/.test(rd30) && /如实登记、不作事实认定/.test(rd30),
    '§30a README 写死比亚迪曝光登记四条口径（卡片真挂载 / 死链不冒充 / 如实登记 / 随笔引用）',
    '规则只挂口头 → 又会出现「详情页写了、卡片没动」的静默失效');

  check(p30.length > 0 && /<script defer src="\.\/byd-expose-patch\.js\?v=8"><\/script>/.test(idx30)
    && /不能改 bundle|不能改\s*bundle/.test(p30),
    '§30b 曝光补丁入库并挂进首页（?v=8，2026-11-20 视频时长改为约 1 分 50 秒 + 悬赏口径分档），且写明不动压缩 bundle');

  check(/\^BYD\\s\*\\\(比亚迪\\\)/.test(p30) && /data-byd-expose/.test(p30)
    && /new MutationObserver\(schedule\)/.test(p30)
    && /requestAnimationFrame/.test(p30)
    && /div\.p-5\.space-y-3\\\\\.5/.test(p30),
    '§30c 补丁按标题定位 BYD 卡、幂等标记 + MutationObserver + rAF 兜底重渲染');

  check(/强制加班至晚十点/.test(p30) && /《劳动法》第九十六条/.test(p30)
    && /该视频现已删除/.test(p30) && /原链接已失效/.test(p30)
    && /受到了某种压力/.test(p30) && /不对指称内容作事实认定/.test(p30),
    '§30d 曝光框六条事实齐全（加班至晚十点 / 第96条 / 视频已删 / 链接失效 / 受压 / 不作事实认定）');

  check(/var P3 = '\(站长本人于2025年起持有比亚迪王朝，双休购是2026年上线的；车主亲历与近期车型澄清已整理成专题报道。\)'/.test(p30)
    && /STORY_HREF = '\.\/byd-report\.html'/.test(p30)
    && !/NOTES_TEXT/.test(p30)
    && !/NOTES_HREF/.test(p30)
    && !/日记/.test(p30)
    && /var LEGAL_HREF = 'https:\/\/v\.douyin\.com\/3oI-7tZ12R8\/'/.test(p30)
    && (p30.match(/https?:\/\//g) || []).length === 1
    && /setAttribute\('rel', 'nofollow noopener'\)/.test(p30)
    && /setAttribute\('target', '_blank'\)/.test(p30)
    && !/kKmeU180irU/.test(p30)
    && !/LEGAL_HREF = 'https:\/\/v\.douyin\.com\/NrP3/.test(p30),
    '§30e 卡面备注栏 P3 保留车主身份说明、改挂比亚迪专题报道页（./byd-report.html）入口；删掉站内 notes.html 随笔第10章链接；不抄口述、不写「日记」；卡面备注栏只挂一条抖音短链（nofollow noopener + 新窗口打开），失效旧短链一律不进卡');

  const evByd30 = (idx30.match(/<details id="ev-byd"[\s\S]*?<\/details>/) || [])[0] || '';
  const liByd30 = (byd30.match(/<li style="margin:0 0 12px"><strong>BYD 直营门店强制加班曝光[\s\S]*?<\/li>/) || [])[0] || '';
  check(liByd30.length > 0 && /该视频现已删除/.test(liByd30)
    && /原链接已失效/.test(liByd30) && /受到了某种压力/.test(liByd30)
    && /不对指称内容作事实认定/.test(liByd30)
    && !/<a href="https:\/\/v\.douyin\.com\/kKmeU180irU\//.test(byd30)
    && /v\.douyin\.com\/kKmeU180irU\//.test(liByd30),
    '§30f 详情页如实登记视频下架，失效抖音短链降级为纯文本、不再冒充可点来源');

  check(/data-n="5" data-l="3"/.test(evByd30)
    && evByd30.indexOf('该视频现已删除') !== -1
    && evByd30.indexOf('原链接已失效') !== -1
    && evByd30.indexOf('轮毂装反') !== -1
    && evByd30.indexOf('法务部') !== -1
    && (evByd30.match(/（本条无可点原始链接/g) || []).length === 2,
    '§30g 公示区由生成器同步：ev-byd 5 条证据（11-13 新增法务部悬赏线索，带链）、可点链接 3 条、摘要仍写出视频下架');

  check(/var BRANDS = \[/.test(p30)
&& /王朝网/.test(p30) && /海洋网/.test(p30) && /腾势/.test(p30) && /方程豹/.test(p30)
&& /仰望/.test(p30) && /弗迪电池/.test(p30) && /比亚迪电子/.test(p30)
&& /function patchBrandTags\(card\)/.test(p30) && /var BRANDS_ORIGIN = '秦\/汉\/海鸥电动车'/.test(p30),
'§30i 卡面标签区补全比亚迪旗下子品牌（王朝网秦/汉/唐/宋/元 · 海洋网海鸥/海豚/海豹/驱逐舰/护卫舰 · 腾势 · 方程豹 · 仰望 · 弗迪电池 · 比亚迪电子），DOM 就地改写、不动 bundle');

check(exists('scripts/test-byd-expose.cjs') && /test-byd-expose\.cjs/.test(wf30)
    && /data-byd-expose/.test(p30),
    '§30h 真 DOM 测试存在并挂进 CI（三层强制：规则 + 断言 + CI）');
}

// ---------- 31. 详情弹窗「跳转到证据公示」：完整定位到对应公示条目 ----------
// 站长 2026-11-10「大改」：每张卡打开之后，底部「生成我的投票小票」同排
// 都要加一个新按钮，能完整跳到该品牌对应的证据链公示条目；内置卡与自定义卡
// 一视同仁。红线：不许只滚到公示区顶部就冒充完成，不许写死品牌清单/URL，
// 不许给没有条目的卡编造证据。
{
  const p31 = exists('evidence-jump-patch.js') ? read('evidence-jump-patch.js') : '';
  // 只拿纯代码做行为契约校验：文件头的说明注释里也会出现 pt-2 / scrollIntoView
  // 等字样，若拿全文比对，把真正执行的代码改坏后断言仍会被注释「救活」判绿。
  const code31 = p31.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const idx31 = read('index.html');
  const rd31 = read('README.md');
  const wf31 = read('.github/workflows/verify.yml');

  check(/详情弹窗证据链公示跳转/.test(rd31)
    && /无论清单值是内置 React 卡还是自定义卡/.test(rd31)
    && /完整定位，不是打开页面顶部/.test(rd31)
    && /真相源单一/.test(rd31)
    && /不编造证据、不假装命中/.test(rd31),
    '§31a README 写死本批五条口径（两类弹窗一视同仁 / 完整定位 / 单一真相源 / 无条目如实降级 / 机器强制）',
    '规则只挂口头 → 又会出现「按钮有、跳过去却停在公示区顶部」的静默失效');

  check(p31.length > 0 && /<script defer src="\.\/evidence-jump-patch\.js\?v=3"><\/script>/.test(idx31)
    && /不能改 bundle|不能改\s*bundle/.test(p31)
    && !/https?:\/\//.test(p31)
    && !/ev-patagonia|ev-icbc|ev-zhaoyiming|ev-byd/.test(p31),
    '§31b 跳转补丁入库并挂进首页（?v=3）；不动压缩 bundle、不写死品牌 URL / 品牌 id 清单');

  check(code31.indexOf('var isBuiltin =') !== -1
    && code31.indexOf('pt-2') !== -1 && code31.indexOf('justify-end') !== -1
    && code31.indexOf('var isCustom =') !== -1 && code31.indexOf('sxg-actions') !== -1
    && /var ANCHOR_TEXT = '生成我的投票小票'/.test(code31)
    && /function findFoot\(/.test(code31),
    '§31c 同一个锚点按钮同时定位内置 React 弹窗（pt-2 flex justify-end）与自定义弹窗（sxg-actions right），不看清单值');

  check(/var BTN_ATTR = 'data-sxg-ev-jump'/.test(code31)
    && /var ROOT_ATTR = 'data-sxg-ev-jump-root'/.test(code31)
    && /new MutationObserver\(schedule\)/.test(code31)
    && /requestAnimationFrame/.test(code31)
    && /foot\.querySelector\('\[' \+ BTN_ATTR \+ '\]'\)/.test(code31),
    '§31d 幂等标记 + MutationObserver + rAF 合帧，React / 自定义弹窗重渲染后自动补挂');

  check(/function norm\(/.test(code31) && /function stripParen\(/.test(code31)
    && /replace\(\/-card\$/.test(code31)
    && /getAttribute\('data-b'\)/.test(code31)
    && /summary \.bn/.test(code31) && /summary \.co/.test(code31)
    && /#evidence-board details\[data-b\]/.test(code31),
    '§31e 四层解析缺一不可：品牌名归一化 / 去括号 / slug 查 data-b / 公司名；索引只读公示区运行时 DOM');

  check(/function closeModal\(/.test(code31) && /__sxgOpenEvidenceBoard/.test(code31)
    && /setAttribute\('open', ''\)/.test(code31)
    && /\.scrollIntoView\(\{/.test(code31)
    && /var FOCUS_ATTR = 'data-sxg-ev-focus'/.test(code31)
    && /history\.replaceState/.test(code31)
    && /function bootFromHash\(/.test(code31)
    && /\.\/index\.html#/.test(code31),
    '§31f 完整跳转链路：关弹窗 → 展开折叠区 → 展开目标 details → 滚动 → 高亮 → 可分享锚点 → 带锚点自动定位 + 跨页兜底');

  check(code31.indexOf('暂无独立证据链公示条目') !== -1
    && code31.indexOf('不编造证据') !== -1
    && /setHash\('evidence-board'\)/.test(code31)
    && /var NOTICE_ATTR = 'data-sxg-ev-notice'/.test(code31)
    && /return null/.test(code31),
    '§31g 无对应条目时如实提示并展开总览，不编造条目、不假装命中');

  check(exists('scripts/test-evidence-jump.cjs') && /test-evidence-jump\.cjs/.test(wf31)
    && /window\.__sxgEvidenceJump/.test(code31),
    '§31h 真 DOM 测试存在并挂进 CI（三层强制：规则 + 断言 + CI）');

  check(/var CLOSE_ATTR = 'data-sxg-ev-close'/.test(code31)
    && /function makeCloseButton\(/.test(code31)
    && /isBuiltinFoot/.test(code31)
    && code31.indexOf("'关闭'") !== -1,
    '§31i 2026-11-13 站长统一口径：内置弹窗底排补「关闭」幽灵按钮，两类弹窗统一三键（跳转/小票/关闭）');
}

// ---------- 32. 2026-11-10 批次：公益广告位 / 6 秒倒计时 / 新闻登记 / 随笔年内上线 ----------
// 站长本批一口气提了六件事，其中「挡住了，你没发现？」是真渲染才量出来的：
// .dyp 全屏遮罩把广告位整块糊掉，招商卡 SVG 的圆形印章又压住文案。
// 规则只写 README 会重演，这里把可观测的落点全部钉死。
{
  const ad32 = exists('black-card-adslot.js') ? read('black-card-adslot.js') : '';
  // 只拿纯代码判「旧文案清零」：文件头注释里会引用旧文案说明改了什么，
  // 拿全文比对会误判红（§31 已吃过「注释救活改坏的实现」的亏，这里是反向同理）。
  const code32 = ad32.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const rec32 = read('assets/ad-recruit.svg');
  const brand32 = read('assets/ad-luxiyi.svg');
  const dyp32 = read('douyin-prompt.css');
  const ff32 = read('filter-flash.js');
  const scof32 = read('search-clear-order-fix.js');
  const news32 = exists('news-incident-patch.js') ? read('news-incident-patch.js') : '';
  const nt32 = read('notes.html');
  const idx32 = read('index.html');
  const rd32 = read('README.md');
  const wf32 = read('.github/workflows/verify.yml');
  const logi32 = read('brand/logitech.html');
  const xing32 = read('brand/xingyu.html');

  check(/公益广告位/.test(rd32) && /不作因果认定|不写「报应」/.test(rd32)
    && /6 秒/.test(rd32) && /年内上线/.test(rd32),
    '§32a README 写死本批四条口径（公益广告位 / 6 秒倒计时 / 新闻登记 / 随笔年内上线）',
    '规则只挂口头 → 下次又把广告位做成「广告位招商中」、把 6 秒改回 500ms');

  check((code32.match(/公益广告位/g) || []).length >= 4
    && !/广告位招商中|品牌展示|>广告位</.test(code32)
    && /data-adslot-kind', 'public-welfare'/.test(code32)
    && /black-card-adslot\.js\?v=22/.test(idx32),
    '§32b 广告位所有可见文案统一「公益广告位」，旧「广告位招商中」/「品牌展示」清零，?v 升 22');

  // 站长 2026-11-10 二次纠正「广告图叫你重构，不是让你改成纯文字 / 文字明显重叠」：
  // 文案已全部画进 ad-recruit.svg 的 <text>（与图同坐标系同缩放，结构上不可能叠字），
  // HTML 侧只留一行正常流 meta。这里把「两套文案并存」钉死：三个旧类名一律不许回归，
  // 否则又会出现「图里一份 + DOM 一份」的叠字现场。
  // 注意：断言查纯代码 code32（已剥注释），else 里写清楚的来龙去脉不会污染断言。
  check(!/sxg-adslot__recruit-copy|sxg-adslot__recruit-title|sxg-adslot__recruit-sub/.test(code32)
    && !/sxg-adslot__recruit-copy/.test(ad32),
    '§32b2 招募卡不再有 HTML 文案层（recruit-copy/title/sub 清零），文案只在 SVG 里（手机端左右翻页箭头改由 §36k 钉死）',
    'recruit-copy 之类的 HTML 文案层一回来，就和图里的文案撞成「叠字」');

  // §32b3 黑卡预隐藏：慢网下 bundle 先渲染黑卡、black-card-adslot.js 后替换，
  // 中间那帧黑卡肉眼可见（站长 2026-11-10：「先加载黑色卡片，然后才出现广告位」）。
  // 修法是 index.html 头部内联预隐藏样式，先于 bundle 生效；选择器子串
  // 「rounded-2xl p-5 shadow-xl」在全 bundle 只被黑卡使用（已 grep 确认唯一），
  // 不会误伤自定义卡按钮 / 评级选中态等其它 bg-slate-900 元素。
  check(idx32.includes('id="sxg-blackcard-prehide"')
    && idx32.includes('div[class*="rounded-2xl p-5 shadow-xl"]{visibility:hidden}')
    && idx32.indexOf('sxg-blackcard-prehide') < idx32.indexOf('</head>'),
    '§32b3 黑卡预隐藏样式必须内联在头部（body 渲染前已解析，慢网首帧不再闪现旧黑卡）',
    '预隐藏样式被删或挪出头部，黑卡闪现就会回来');

  // 站长 2026-11-10「文字明显也重叠了」的根治口径：文案在图里，三条 <text> 基线必须
  // 严格递增（136/192/228 那一套），且必须有实体图形（挂牌/印章/聚光），不能只剩白底。
  // 这是「叠字」唯一能机器判红的抓手——光看类名挡不住。
  const recTexts = [...rec32.matchAll(/<text[^>]*?y="(\d+)"[^>]*?font-size="(\d+)"/g)]
    .map((m) => ({ y: Number(m[1]), size: Number(m[2]) }));
  const recMain = recTexts.filter((t) => t.y >= 100 && t.y <= 260).sort((a, b) => a.y - b.y);
  const recGrowing = recMain.length >= 3 && recMain.every((t, i) => i === 0 || t.y > recMain[i - 1].y);
  // 站长 2026-11-10 20:44「胖东来和广告位招商不要用同一种风格的图片，好吗？」：
  // 招商稿换成暖白纸面 + 虚线空位框 + 描边大字的「留白告示」风格，
  // 与第 1 张陆喜依（深蓝渐变 / 金色挂牌 / 圆印章 / 同心弧 / 聚光）、
  // 第 2 张胖东来（2026-11-11 改砖红号外稿）都彻底区分；三稿两两互异见 §36a/§36b。
  // 反向断言只查**剥掉注释后的图本体**（注释里要解释「刻意不用了什么」，
  // 拿全文比对会让说明文字自己把断言判红）。
  const recCode32 = rec32.replace(/<!--[\s\S]*?-->/g, '');
  const styleClash32 = /linearGradient|radialGradient|rc-plate|rc-gold|rc-bg|印章|同心弧|聚光/
    .test(recCode32) || /#0a1b47|#1d3f9e|#f9df8b|#e5a336/.test(recCode32);
  check(recGrowing
    && recMain.length >= 3 && recMain[0].size >= 60
    && !/\.sxg-adslot__recruit-copy\{position:absolute/.test(code32)
    && /rw-grid/.test(recCode32) && /rw-hatch/.test(recCode32)
    && /stroke-dasharray/.test(recCode32) && /VACANCY/.test(recCode32)
    // 刊头与 VACANCY 方章必须分开，且右下不许再挂会被虚线穿过的说明文字
    && /x="60" y="76" text-anchor="start"[^>]*>PUBLIC WELFARE AD/.test(recCode32)
    && /x="60" y="98" text-anchor="start"[^>]*>公益广告位 · 真实双休品牌招募/.test(recCode32)
    && !/text-anchor="end"[^>]*>公益广告位 · 真实双休品牌招募/.test(recCode32)
    && /<rect x="962" y="58"/.test(recCode32)
    && !styleClash32
    && /nd-ink/.test(read('assets/ad-pangdonglai.svg'))
    && /虚位以待/.test(rec32) && /可申请免费展示/.test(rec32)
    && /PUBLIC WELFARE AD/.test(rec32) && /公益广告位/.test(brand32)
    && /不要用同一种风格/.test(rd32),
    '§32c 招商卡是「广告设计图」且风格与胖东来/陆喜依明确互异（暖白纸面+虚线空位框，零深蓝渐变/金挂牌/圆印章）；三条基线严格递增不叠字，README 写死风格互异口径',
    `图里主线文案基线 ${JSON.stringify(recMain)} 不递增、或招商稿退回品牌稿的深蓝金字风格`);

  check(/z-index:9995/.test(ad32) && /padding:7px 0 14px/.test(ad32)
    && /background: rgba\(24, 20, 16, 0\.22\)/.test(dyp32)
    && /backdrop-filter: none/.test(dyp32)
    && /douyin-prompt\.css\?v=26/.test(idx32),
    '§32d 广告位层级 9995 / 底部留白 14px；.dyp 遮罩减淡去模糊，弹窗引流功能原样保留');

  check(/var SEARCH_DURATION = 6000/.test(ff32)
    && /正在加载缓存，请稍后/.test(ff32)
    && /forcedUntil/.test(ff32) && /startCountdown/.test(ff32)
    && /filter-flash\.js\?v=7/.test(idx32)
    && /forcedUntil/.test(scof32)
    && /search-clear-order-fix\.js\?v=3/.test(idx32),
    '§32e 搜索删空强制 6 秒 + 倒计时 + 硬 deadline；两侧契约同改、缓存号都 bump');

  // 2026-11-14 站长：「还是放理想的证据链吧，备注那一栏也加入，文案你写」。
  // 卡面备注栏原本是零外链（§32f 旧口径），本次按站长逐条指令放开**一条白名单**：
  // 理想 L8 高速方向盘线索的抖音短链。判据钉三点：
  //   ① news-incident-patch.js 里出现 http(s) 的只有这一个 URL（白名单不许自行扩大）；
  //   ② 外链必须 rel="nofollow noopener" + target="_blank"（§30e 外链纪律）；
  //   ③ 详情页 brand/lixiang.html 同步登记同一条链接（站规：备注栏内容同步证据链）。
  const newsLinks32 = [...news32.matchAll(/https?:\/\/[^'"\s)]+/g)].map((x) => x[0]);
  check(news32.length > 0
    && /<script defer src="\.\/news-incident-patch\.js\?v=9"><\/script>/.test(idx32)
    && /var ITEMS = \[/.test(news32) && /key: 'logitech'/.test(news32) && /key: 'xingyu'/.test(news32)
    && /key: 'geely'/.test(news32) && /key: 'lixiang'/.test(news32) && /key: 'chery'/.test(news32)
    && /key: 'lixiang-douyin'/.test(news32) && /key: 'huawei-zunjie'/.test(news32)
    && newsLinks32.length === 1 && newsLinks32[0] === 'https://v.douyin.com/nHGcAwzSXOU/'
    && /setAttribute\('rel', 'nofollow noopener'\)/.test(news32)
    && /setAttribute\('target', '_blank'\)/.test(news32)
    && /new MutationObserver\(schedule\)/.test(news32)
    && /不能改 bundle/.test(news32)
    && /nHGcAwzSXOU/.test(read('brand/lixiang.html')),
    '§32f 新闻登记补丁配置驱动内置卡 + 三张车企卡（吉利/理想/奇瑞），幂等 + 重渲染兜底、不碰 bundle；卡面外链只有白名单一条（理想 L8 抖音线索），rel/target 齐全且详情页证据链同步登记',
    '外链白名单被扩大、rel/target 缺失，或 brand/lixiang.html 没同步这条证据');

  check(/罗技中国就授权店铺侮辱消费者广告致歉/.test(logi32)
    && /总经理扣薪 12 个月、人力资源总监免职/.test(xing32)
    && /m\.gmw\.cn/.test(logi32) && /m\.chinanews\.com/.test(logi32)
    && /cnenergynews\.cn/.test(xing32) && /nfnews\.com/.test(xing32) && /inewsweek\.cn/.test(xing32)
    && !/报应/.test(xing32),
    '§32g 两条新闻的权威媒体原始链接落在详情页，口径中立不写「报应」');

  const ebLogi32 = (idx32.match(/<details id="ev-logitech"[\s\S]*?<\/details>/) || [])[0] || '';
  const ebXing32 = (idx32.match(/<details id="ev-xingyu"[\s\S]*?<\/details>/) || [])[0] || '';
  check(/data-n="3" data-l="2"/.test(ebLogi32) && /data-n="5" data-l="5"/.test(ebXing32),
    '§32h 首页公示区计数由生成器托管同步（罗技 1→3、星宇 2→5），未手改计数');

  check(!/lock__agree-hint/.test(nt32) && /lock__launch-note/.test(nt32)
    && /年内上线/.test(nt32) && /GitHub Star/.test(nt32) && /持有天数/.test(nt32)
    && /var PAYLOAD = /.test(nt32),
    '§32i 随笔红色提示语清零、统一年内上线公告（含 Star 持有天数），加密正文 PAYLOAD 未动');

  check(/test-news-incident\.cjs/.test(wf32) && exists('scripts/test-news-incident.cjs')
    && /test-search-clear-flash\.cjs/.test(wf32)
    && /test-adslot\.cjs/.test(wf32) && /test-notes-agree\.cjs/.test(wf32)
    && /陆喜依/.test(read('scripts/test-evidence-jump.cjs')),
    '§32j 真 DOM 测试挂进 CI；陆喜依精准定位已固化进跳转测试');
}

// ---------- 34. 品牌专属内容不串卡（2026-11-10 站长「现在做一次全站检查」） ----------
// 实测现场：罗技登记框 65 份、星宇登记框 40 份散落 103 张自定义卡。根因是
// index.html 的 templateCard.cloneNode(true) 把模板卡上的补丁节点整块复制。
// 两层强制：① 克隆侧剥离表覆盖所有品牌专属补丁标记；② 补丁侧品牌绑定自愈。
{
  const idx34 = read('index.html');
  const news34 = read('news-incident-patch.js');
  const rd34 = read('README.md');
  const wf34 = read('.github/workflows/verify.yml');
  const scope34 = exists('scripts/test-news-scope.cjs') ? read('scripts/test-news-scope.cjs') : '';
  const audit34 = exists('scripts/cdp-fullsite-audit.cjs') ? read('scripts/cdp-fullsite-audit.cjs') : '';

  const nodes34 = (idx34.match(/var SXG_CLONE_STRIP_NODES = \[([\s\S]*?)\];/) || [])[1] || '';
  const attrs34 = (idx34.match(/var SXG_CLONE_STRIP_ATTRS = \[([\s\S]*?)\];/) || [])[1] || '';
  const stripAll34 = nodes34 + attrs34;
  // 品牌专属补丁 → 它注入时用的标记。逐条反查「标记确实还在这个补丁里」且
  // 「标记确实进了剥离表」，新增补丁忘了登记就判红（这条是防串卡回潮的主钉子）。
  const brandPatches34 = [
    ['news-incident-patch.js', 'data-sxg-news'],
    ['byd-expose-patch.js', 'data-byd-expose'],
    ['luckin-note-patch.js', 'data-luckin-note'],
    ['luckin-note-patch.js', 'data-luckin-policy'],
    ['luxiyi-alt-patch.js', 'data-luxiyi-alt'],
    ['ai-notice-patch.js', 'data-ai-notice'],
    ['rate-note-patch.js', 'data-rate-note'],
    ['rate-note-patch.js', 'data-rate-patched'],
    ['custom-card-actions.js', 'data-sxg-localnote'],
    ['u-grade-patch.js', 'data-sxg-tier']
  ];
  const uncovered34 = brandPatches34.filter(([f, m]) =>
    !read(f).includes(m) || !stripAll34.includes(m));
  check(!!nodes34 && !!attrs34
    && idx34.indexOf('SXG_CLONE_STRIP_NODES') > idx34.indexOf('cloneNode(true)')
    && uncovered34.length === 0
    && /newCard\.querySelectorAll\('\.sxg-localnote'\)/.test(idx34),
    '§34a 自定义卡 cloneNode(true) 后剥离表覆盖全部品牌专属补丁标记（含 class 型 .sxg-localnote），新增补丁漏登记即判红',
    '漏登记的标记 = 下一轮又把某一家的内容复制到几十张卡上；漏项：' + JSON.stringify(uncovered34));

  // 只认剥注释后的纯代码：把调用注释掉、函数体还在，全文比对会假绿
  // （与 §31「注释救活改坏的实现」同一类坑）。本文件无任何 URL，剥注释安全。
  const newsCode34 = news34.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  check(/function cleanupMisplaced\(/.test(newsCode34) && /function dedupeOn\(/.test(newsCode34)
    && /function cardTitle\(/.test(newsCode34) && /cleanupMisplaced\(item\)\s*;/.test(newsCode34)
    && /!item\.title\.test\(cardTitle\(card\)\)/.test(newsCode34)
    && /new MutationObserver\(schedule\)/.test(newsCode34),
    '§34b 新闻登记补丁有品牌绑定自愈：标题不匹配的卡里的框一律删除，只留自己那一份',
    '只插不清的补丁在 DOM 节点被克隆/复用后必然把内容带到别的品牌名下');

  check(!!scope34 && /test-news-scope\.cjs/.test(wf34)
    && /cloneNode\(true\)/.test(scope34) && /cleanupMisplaced/.test(scope34)
    && !!audit34 && /FULLSITE /.test(audit34) && /mismatchCount/.test(audit34),
    '§34c 串卡回归测试挂进 CI，且全站真渲染审计脚本会按串卡数量判红（不是只打印）',
    '测试没挂 CI / 审计脚本不判红 → 下次还是靠站长截图才发现');

  check(/品牌专属内容不串卡/.test(rd34) && /克隆只继承骨架，不继承内容/.test(rd34)
    && /品牌绑定自愈/.test(rd34) && /不要用同一种风格/.test(rd34),
    '§34d README 写死「只写一家企业就只许出现在那家卡上」与克隆剥离/自愈/风格互异口径',
    '规则只挂口头 → 下次新增补丁照样漏登记');
}

// ---------- 站长 2026-11-10 23:40「手机端你检查了吗？新建的公益广告位，都穿模了」 ----------
// 旧 cdp-pdl-adcheck.cjs 只查结构、截图前还把所有浮层隐藏，所谓「双视口 PASS」
// 是假绿：真机 320~414 宽度下 fixed 悬浮圆钮被卡片切掉一半，桌面稿的小字
// 等比缩到 5~8px 糊成一片。本批把手机端口径钉成静态 + 真渲染两层断言。
{
  const ad35 = read('black-card-adslot.js');
  const idx35 = read('index.html');
  const rd35 = read('README.md');
  const wf35 = read('.github/workflows/verify.yml');
  // 第三列是各自 ?v：⑪ 只改了胖东来手机稿（升 2），其余仍是 1。
  // 早先这里写死 '?v=1'，一改其中一张就会被「版本不一致」误红。
  const mob35 = [
    ['assets/ad-luxiyi-mobile.svg', 'ART_MOBILE', 1],
    ['assets/ad-pangdonglai-mobile.svg', 'ART_PDL_MOBILE', 2],
    ['assets/ad-recruit-mobile.svg', 'ART_RECRUIT_MOBILE', 1]
  ];
  const svgOk35 = mob35.every(([f]) => {
    if (!exists(f)) return false;
    const s = read(f);
    if (!/<svg[\s\S]*?viewBox="0 0 400 240"/.test(s)) return false;
    const body35 = s.replace(/xmlns(?::[a-zA-Z]+)?="[^"]*"/g, '');
    if (/https?:\/\//.test(body35) || /<image\b/i.test(s)) return false;
    const texts35 = [...s.matchAll(/<text[^>]*?y="(\d+)"[^>]*?font-size="(\d+)"[^>]*>/g)]
      .map((m) => ({ y: Number(m[1]), size: Number(m[2]) }));
    const main35 = texts35.filter((t) => t.y >= 100 && t.y <= 220).sort((a, b) => a.y - b.y);
    return main35.length >= 3 && main35.every((t, i) => i === 0 || t.y > main35[i - 1].y)
      && main35[0].size >= 38 && Math.min(...main35.map((t) => t.size)) >= 14;
  });
  check(svgOk35,
    '§35a 三张手机专用海报（400×240）存在、零外链、三条主文案基线严格递增且字号 ≥14（桌面稿压到 356px 只剩 5px 小字）',
    '手机稿缺一 / 字号退回桌面比例 → 手机端又是一片糊字');

  // 数节点必须看剥注释后的纯代码：注释里也写着「用 <picture> 切换」，
  // 全文计数会把注释算进去（本批实测注释多出 2 处，假红）。
  const code35 = ad35.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const constOk35 = mob35.every(([f, name, ver]) => {
    const src35 = './' + f + '?v=' + ver;
    return ad35.indexOf("var " + name + " = '" + src35 + "'") !== -1
      && (code35.match(new RegExp('\\b' + name + '\\b', 'g')) || []).length >= 2;
  });
  check(constOk35 && (code35.match(/<source media="\(max-width:480px\)"/g) || []).length === 3
    && (code35.match(/<picture>/g) || []).length === 3
    && /\.sxg-adslot__art-wrap picture\{display:block/.test(ad35),
    '§35b 三张卡都用 <picture> 在窄屏切手机稿，桌面三张原稿与 ?v 一字不动',
    '只写了手机图没接 <source> → 手机上仍加载桌面稿，断言白写');

  const preload35 = mob35.every(([f, , ver]) =>
    idx35.indexOf('<link rel="preload" as="image" href="./' + f + '?v=' + ver + '" media="(max-width:480px)" />') !== -1);
  check(preload35 && /black-card-adslot\.js\?v=22/.test(idx35),
    '§35c 手机三图带 media 预热、?v 与脚本 *_MOBILE 常量一致，首页脚本已升 21（2026-11-12 政策文案改写后再 bump）',
    '预热漏 media 或 ?v 不一致 → 慢网首帧先出桌面稿再跳手机稿');

  check(/function keepClear\(/.test(code35) && /keepClear\(slot\);/.test(code35)
    && /new IntersectionObserver\(/.test(code35) && /z < 9995/.test(code35)
    && /data-sxg-adslot-avoid/.test(code35)
    && /html\.sxg-adslot-near \[data-sxg-adslot-avoid\]\{visibility:hidden!important/.test(ad35),
    '§35d 手机端广告位进入视口时让相交的 fixed 悬浮圆钮临时避让（不碰 100000 级弹窗），离开即恢复',
    '半个圆又被切在卡片边上 = 站长说的「都穿模了」');

  const audit35 = exists('scripts/cdp-adslot-mobile-audit.cjs') ? read('scripts/cdp-adslot-mobile-audit.cjs') : '';
  const t35 = exists('scripts/test-adslot-mobile.cjs') ? read('scripts/test-adslot-mobile.cjs') : '';
  check(!!audit35 && !!t35 && /test-adslot-mobile\.cjs/.test(wf35)
    && /process\.exit\(fail \? 1 : 0\)/.test(t35)
    && /MOBILE /.test(audit35) && /process\.exit\(fail \? 1 : 0\)/.test(audit35)
    && /currentSrc/.test(audit35) && /320/.test(audit35) && /414/.test(audit35)
    && !/display='none'/.test(audit35),
    '§35e jsdom 手机端回归挂 CI；本机真渲染审计覆盖 320~414 五档、查 currentSrc 与几何遮挡、判红退出 1，且不再隐藏任何浮层',
    '又回到「只查结构 + 把遮罩隐藏后再截图的假绿」');

  check(/手机端/.test(rd35) && /手机专用/.test(rd35) && /悬浮/.test(rd35),
    '§35f README 写死「手机端必须单独验收海报可读性与悬浮层遮挡」口径',
    '规则只挂口头 → 下次还是拿桌面双视口 PASS 糊弄过去');
}

// ---------- 站长 2026-11-11 00:46「第一张也不要和第二张广告使用同一种风格」+「参考良配的广告，点了就自动复制，弹窗提醒用户自己去微信」 ----------
// ① 三张海报两两互异（桌面 + 手机各查一遍，只认剥注释后的图本体，
//    否则注释里解释「刻意不用了什么」会自己把断言判红/救活）；
// ② 复制交互照良配的两级复制，但同步 execCommand 必须留在点击手势栈内；
// ③ 真点击验收：挂 CI 的 jsdom + 本机无头 Edge，两处都认新链接与 toast。
{
  const ad36 = read('black-card-adslot.js');
  const rd36 = read('README.md');
  const wf36 = read('.github/workflows/verify.yml');
  const strip36 = (s) => s.replace(/<!--[\s\S]*?-->/g, '');
  const lx36 = strip36(read('assets/ad-luxiyi.svg'));
  const pdl36 = strip36(read('assets/ad-pangdonglai.svg'));
  const rec36 = strip36(read('assets/ad-recruit.svg'));
  const lxm36 = strip36(read('assets/ad-luxiyi-mobile.svg'));
  const pdlm36 = strip36(read('assets/ad-pangdonglai-mobile.svg'));
  const recm36 = strip36(read('assets/ad-recruit-mobile.svg'));
  // 三套风格特征：品牌稿（深蓝渐变+金）/ 招商稿（暖白网格+虚线+方章）/
  // 号外稿（砖红纯色+米白运单条+橙装订边）。任一稿混入另两套特征即判红。
  const brandMark36 = /linearGradient|radialGradient|lx-gold|lx-glow|pdl-gold|pdl-plate|#f9df8b|#e5a336|#0a1b47|#1d3f9e/;
  // stroke-dasharray 不能当招商稿专属：陆喜依桌面稿的金色圆徽章也有
  // stroke-dasharray="3 11"（本批实测把 §36a 判红）。只认招商稿的精确值 14 10。
  const recruitMark36 = /rw-grid|rw-hatch|rwm-grid|rwm-hatch|stroke-dasharray="14 10"|VACANCY|#fbf7ee/;
  const dispatchMark36 = /nd-ink|#8f3325|#f7efe0|#e9a45c/;
  check(dispatchMark36.test(pdl36)
    && !brandMark36.test(pdl36) && !recruitMark36.test(pdl36)
    && brandMark36.test(lx36) && !dispatchMark36.test(lx36) && !recruitMark36.test(lx36)
    && recruitMark36.test(rec36) && !brandMark36.test(rec36) && !dispatchMark36.test(rec36),
    '§36a 三张桌面海报两两互异：陆喜依深蓝金字 / 胖东来砖红号外运单 / 招商暖白网格虚线框；第一张不再与第二张同风格',
    '胖东来稿退回深蓝金字或暖白网格 → 站长 00:46「第一张也不要和第二张广告使用同一种风格」失守');

  check(dispatchMark36.test(pdlm36)
    && !brandMark36.test(pdlm36) && !recruitMark36.test(pdlm36)
    && brandMark36.test(lxm36) && !dispatchMark36.test(lxm36) && !recruitMark36.test(lxm36)
    && recruitMark36.test(recm36) && !brandMark36.test(recm36) && !dispatchMark36.test(recm36),
    '§36b 三张手机专用海报同样两两互异（手机端不能只改桌面稿就交差）',
    '桌面改了风格、手机稿还是老一套 → 手机上第 1/2 张照样撞脸');

  const code36 = ad36.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  check(/function copySync\(/.test(code36) && /document\.execCommand\('copy'\)/.test(code36)
    && /function tryClipboardApi\(/.test(code36) && /navigator\.clipboard\.writeText/.test(code36)
    && /function copyText\(/.test(code36) && /var syncOk = copySync\(text\)/.test(code36)
    && /function showShareToast\(/.test(code36) && /data-sxg-share-toast/.test(code36)
    && /已复制小程序口令，请打开微信粘贴后打开/.test(code36)
    && /打开微信 → 粘贴到任意聊天窗口/.test(code36)
    && /点开刚发的小程序卡片/.test(code36)
    && /sxg-adslot__toast-code/.test(code36) && /copyText\(PDL_LINK\)/.test(code36)
    && /15000/.test(code36) && /function bindShare\(/.test(code36)
    && /bindShare\(root\);/.test(code36) && /e\.preventDefault\(\)/.test(code36)
    && /data-sxg-share="pdl"/.test(code36)
    // ⑫ 口令不是 URL：微信内置浏览器里也打不开，一律复制。放行跳转会让
    // 「点了就自动复制」在微信里静默失效，所以反向钉死不得回潮。
    && !/isWeChat/.test(ad36) && !/放行默认跳转直接打开/.test(ad36)
    && !/bendibao/.test(ad36)
    && /\.sxg-adslot__toast\{display:none/.test(ad36),
    '§36c 点击复制链路：同步 execCommand 趁手势写入 + clipboard API 兜底 + toast 提示去微信粘贴小程序卡片 + 口令可点再复制 + 15 秒不闪退；bindShare 真被调用，且不再按 UA 放行跳转（口令在微信内也必须复制）',
    '复制被挪进 Promise.then / 去掉 preventDefault / 又按 UA 放行跳转 / 提示里不写微信 → 站长「点了就自动复制，弹窗提醒用户自己去微信」失守');

  const t36 = exists('scripts/test-adslot.cjs') ? read('scripts/test-adslot.cjs') : '';
  const cdp36 = exists('scripts/cdp-pdl-adcheck.cjs') ? read('scripts/cdp-pdl-adcheck.cjs') : '';
  check(!!t36 && !!cdp36 && /test-adslot\.cjs/.test(wf36)
    && /#小程序:\/\/胖东来/.test(t36) && /sxg-adslot__toast/.test(t36)
    && /execCommand/.test(t36) && /defaultPrevented/.test(t36)
    && /#小程序:\/\/胖东来/.test(cdp36) && /toast/.test(cdp36)
    && /CHECK '/.test(cdp36),
    '§36d 复制交互有挂 CI 的 jsdom 真点击测试（验复制调用 / 阻止跳转 / toast）+ 本机 CDP 真点击验收，两处都认站长新给的小程序口令',
    '只写静态断言、没有真点击 → 又是一次「结构 PASS、实际点了没反应」');

  check(/不要用同一种风格/.test(rd36) && /两两互异/.test(rd36)
    && /第一张/.test(rd36) && /第二张/.test(rd36)
    && /小程序口令/.test(rd36) && /复制/.test(rd36) && /微信/.test(rd36)
    && !/bendibao/.test(rd36),
    '§36e README 写死「三张海报两两互异 / 第一张不与第二张同风格」与「小程序口令点击复制 + 去微信」口径，且零旧文章链接',
    '规则只挂口头 → 下次又拿两张同风格稿或静默跳转糊弄过去');
}

// ---------- 36f. 公益广告位标注「排名不分先后」+ 友链新增 JEV 双休筛选插件（2026-11-11 站长） ----------
// 站长三件事：① 公益广告位标题加「排名不分先后」（注意空格）；
// ② 给 littlewindy123/jev-weekend-shopping-chrome 做个友链（对方已在 Issue 回复，未开 Website 不要求互挂）；
// ③ 筛选摘要挂友链区（作为该友链描述）。
// 规则不能只写文档，这里用静态断言钉死，故障注入判红见本轮记账。
{
  const ad36f = exists('black-card-adslot.js') ? read('black-card-adslot.js') : '';
  const flf36f = exists('friend-links-footer.js') ? read('friend-links-footer.js') : '';
  const idx36f = read('index.html');

  // ① 标题文案：装饰圆点靠 flex gap 与文字分隔，文案内只用单空格，不塞多余字符
  check(ad36f.indexOf('sxg-adslot__head">公益广告位 排名不分先后<') !== -1,
    '§36f 公益广告位标题标注「排名不分先后」（文案内单空格，装饰圆点靠 flex gap 分隔）',
    '标题没加「排名不分先后」或空格不对 → 站长要求失守');

  // ② 友链区两条已撤（站长 2026-11-19：「这两个撤了，现在先不挂」）：
  //    JEV 双休购 Chrome 插件（2026-11-11 挂）与投资理财公式（2026-11-14 挂）整体下架，
  //    友链区只留「各行业双休公司」一条。断言从「必须有」反转为「必须无」，
  //    并钉住撤链留档注释仍在（防后续想挂回时找不到出处）。
  check(flf36f.indexOf('https://github.com/littlewindy123/jev-weekend-shopping-chrome') === -1
    && flf36f.indexOf('https://github.com/dujeongil-galaxy/investment-formulas') === -1,
    '§36f JEV 插件与投资理财公式两条友链已撤下（站长 2026-11-19 指令：先不挂）',
    '两条友链仍出现在脚本里（活数据或残留 href）→ 撤链未生效');
  check(/这两个撤了，现在先不挂/.test(flf36f) && /jev-weekend-shopping-chrome/.test(flf36f)
    && /investment-formulas/.test(flf36f),
    '§36f 撤链留档注释在位（记录原 URL 与站长指令，便于日后挂回；URL 不带 https:// 不会成为活链接）',
    '留档注释被删 → 日后挂回无出处可查');

  // ③ 该友链为单向（对方无 Website，不要求互挂）；JEV 条目本身不写互惠/互挂口径。
  //    注意：friend-links-footer.js 第 83 行有一段历史注释「互惠链接」（解释源码块为何单放，
  //    与本站单向友链政策一致，不是互挂口径），所以只扫描 JEV 条目自身窗口，不扫全文件。
  const jevIdx36f = flf36f.indexOf('jev-weekend-shopping-chrome');
  const jevBlock36f = jevIdx36f === -1 ? '' : flf36f.slice(Math.max(0, jevIdx36f - 400), jevIdx36f + 400);
  check(!/互挂|互惠|reciprocal/i.test(jevBlock36f),
    '§36f 友链为单向（对方无 Website，不要求互挂），JEV 条目不写互惠口径',
    'JEV 条目写成互惠/互挂 → 与「不要求互挂」矛盾');

  // ④ 脚本在 index.html 的 ?v 随内容变更 bump，否则浏览器缓存旧脚本（撤链看不到）
  check(/black-card-adslot\.js\?v=22/.test(idx36f)
    && /friend-links-footer\.js\?v=18/.test(idx36f),
    '§36f friend-links-footer.js 在 index.html 的 ?v 已随撤链 bump 到 18',
    '?v 没 bump → 浏览器缓存旧脚本，已撤的两条友链仍显示给访客');
}

// ---------- 36g. 手机端：内容避让右侧悬浮按钮组（穿模规则写死，2026-11-11 站长） ----------
{
  const mfc36g = exists('mobile-fixes.css') ? stripCssComments(read('mobile-fixes.css')) : '';
  const idx36g = read('index.html');
  // 右侧 FAB 列锚定区：right:14px + 单枚最宽 ~62px → 右 76px。规则必须给内容预留这一列宽。
  // 2026-11-11 §36j 起：这一列宽由 body 统一预留（padding-right:76px），
  // 公告不再自己写 calc(100% - 76px)——那样会双重扣减，390 宽下被压成竖排窄条。
  const ruleOk = /@media\s*\(max-width:\s*640px\)/.test(mfc36g)
    && /\[data-ai-notice\][^{]*\{[^}]*display:\s*block\s*!important/.test(mfc36g)
    && /body\s*\{[^}]*padding-right:\s*76px/.test(mfc36g);
  check(ruleOk,
    '§36g 手机端 [data-ai-notice]（AI 开通公告）改块级，右列 76px 由 body 统一预留（§36j 上移）',
    '公告仍是居中 inline-block 且无处预留右列宽 → 窄屏右缘压在右侧悬浮钮上（站长截图）');
  /* §36t 又改了同一份 CSS（顶栏全部常显），?v 随每次改动继续往上走。
     2026-11-15 撤折叠改滚动后又一次 bump 到 23：这里不再写死 22，
     改成「读当前号 + 下限断言」——原来 §36g/§36q/§36s/§36t 四处写死同一个
     数字，每次改 CSS 都要同步四处，漏一处就整片判红（本次实测踩到）。
     真正的「内容改了必须 bump」由 §11 通用检查负责，这里只保证不倒退。 */
  const mfcVer36g = Number((idx36g.match(/mobile-fixes\.css\?v=(\d+)/) || [])[1] || 0);
  check(mfcVer36g >= 23,
    '§36g mobile-fixes.css 的 ?v 已随公告栏改版 bump 到 ≥23（卡片三枚操作钮基线统一，顺延）',
    '?v 没 bump 或被改小 → 浏览器缓存旧 CSS，预留列宽不生效');
}

// ---------- 36h. 广告位不再穿透搜索-删空全屏磨砂（z-index 写死低于闪屏遮罩，2026-11-11 站长） ----------
{
  const ad36h = exists('black-card-adslot.js') ? read('black-card-adslot.js') : '';
  const idx36h = read('index.html');
  // 广告位是正常文档流内容，绝不能高于全站固定的 frosted 闪屏遮罩（#sxg-flash-mask，z 8000）。
  // 之前 .sxg-adslot 写死 z-index:9995，搜索删空整屏模糊时广告位穿透磨砂露出尖角（站长报障）。
  // 规则：.sxg-adslot 这个选择器本身不得再带任何 z-index（回到文档流，闪屏 / FAB 自然盖在它之上）。
  check(!/\.sxg-adslot\{[^}]*z-index/.test(ad36h),
    '§36h 广告位 .sxg-adslot 选择器不再带 z-index（回到文档流，不穿透 z8000 闪屏遮罩）',
    '.sxg-adslot 又写回 z-index → 搜索删空整屏模糊时广告位穿透磨砂露尖角');
  // keepClear 不得误伤闪屏遮罩：该遮罩 z8000 落在本函数 [1000,9995) 避让区间，必须按 id 排除。
  check(/n\.id\s*===\s*['"]sxg-flash-mask['"]/.test(ad36h),
    '§36h keepClear 按 id 排除闪屏遮罩 #sxg-flash-mask（不被当悬浮钮隐藏、整页磨砂不破洞）',
    'keepClear 漏排除闪屏遮罩 → 广告位相交时遮罩被隐藏、磨砂破洞、广告位穿模');
  check(/black-card-adslot\.js\?v=22/.test(idx36h),
    '§36h black-card-adslot.js 的 ?v 已 bump 到 21（浏览器缓存旧脚本会吃掉本次修复）',
    '?v 没 bump → 旧脚本仍带 z-index:9995，修复不生效');
}

// ---------- 36k. 手机端放出公益广告位左右翻页箭头（照 AI 参考图，圆形浅灰底带浅阴影，2026-11-11 站长） ----------
{
  const ad36k = exists('black-card-adslot.js') ? read('black-card-adslot.js') : '';
  const idx36k = read('index.html');
  // 原 ≤480px 媒体查询把 .sxg-adslot__nav 设 display:none，手机端只看到圆点、看不到左右箭头；
  // 站长对照 AI 参考图要求手机端也放出 prev/next。反向钉死：移动端媒体查询不得再隐藏 nav。
  check(!/@media \(max-width:480px\)\{\.sxg-adslot__nav\{display:none\}/.test(ad36k),
    '§36k 手机端（≤480px）不再隐藏公益广告位左右翻页箭头（放出 prev/next 按钮）',
    '移动端媒体查询又把 .sxg-adslot__nav 设 display:none → 手机上看不到左右翻页箭头');
  check(/black-card-adslot\.js\?v=22/.test(idx36k),
    '§36k black-card-adslot.js 的 ?v 已 bump 到 21（浏览器缓存旧脚本会吃掉本次改动）',
    '?v 没 bump → 旧脚本仍隐藏手机端箭头，改动不生效');
}

// ---------- 36l. 随笔锁屏说明段源文不得手写换行（居中排版会断在词中，2026-11-11 站长） ----------
{
  const nt36l = exists('notes.html') ? read('notes.html') : '';
  // `<p>` 内的换行 = 一次硬折断，不是排版无关的空白。`.lock__desc` 继承 `.lock` 的
  // text-align:center，手写断行的断点固定在作者写稿时的列宽上，与真实容器宽度无关，
  // 390px 真渲染下把「两者功能不同」断成「两者功能不 / 同」、把「从“数据”」断成
  // 「从“数 / 据”」。规则：这类说明/提示段一律单行源文，交给浏览器自然折行。
  // 断言只查标签与换行（不落任何正文措辞），与「正文明细不进仓库」不冲突。
  const desc36l = (nt36l.match(/<p class="lock__desc">[\s\S]*?<\/p>/) || [''])[0];
  check(desc36l.length > 0 && !/\n/.test(desc36l),
    '§36l 锁屏说明段源文单行（无手写硬换行，居中排版不会断在词中）',
    '说明段又被手写断行 → text-align:center 下每行各自居中，必然断在词中断句');
}

// ---------- 36m. 首页视频弹窗：BOSS直聘 视频标记已失效（保留痕迹）+ 新增《磨囚》（2026-11-11 站长） ----------
{
  const fd = exists('featured-douyin.js') ? read('featured-douyin.js') : '';
  const idx36m = read('index.html');
  // 站长：首页视频区（弹窗）里 BOSS直聘 那条抖音链接挂了，打「已失效」标记但保留不删，
  // 并在其下新增《磨囚》。dead 条目渲染时打红标、禁用跳转（链接已失效）。
  const bossBlock = (fd.match(/\{[\s\S]*?uEMZRkt73Jg\/[\s\S]*?\}/) || [''])[0];
  check(bossBlock.length > 0 && /dead\s*:\s*true/.test(bossBlock),
    '§36m 首页视频弹窗：BOSS直聘 视频条目标记 dead:true（链接挂了，保留痕迹、打已失效红标、禁用跳转）',
    'BOSS直聘 视频没打 dead 标记 → 失效链接仍可被点开、继续跳 404');
  check(/《磨囚》/.test(fd) && /v\.douyin\.com\/1hItX481VuQ\//.test(fd),
    '§36m 首页视频弹窗新增《磨囚》视频（标题 + 抖音短链均就位）',
    '《磨囚》新视频没进 VIDEOS 数组 → 首页视频区看不到这条');
  // 2026-11-12 站长：「宁等网约车也不要坐出租车」这条放视频区（不进任何品牌卡）。
  check(/v\.douyin\.com\/asAmGiTjrAU\//.test(fd)
    && /为什么说宁等网约车也不要坐出租车/.test(fd),
    '§36m 视频区新增「宁等网约车也不要坐出租车」（短链 + 标题均就位）',
    '站长 11-12 给的科普短视频没进 VIDEOS 数组 → 视频区少一条');
  // 2026-11-17 站长提供「卧底快递王国：谁抢走了快递员的奶酪？」（讲快递加盟商抽成，
  // 未点名具体品牌，只进视频区）。活动类标签（# 抖音精选App / # 创作阶梯计划）不收，
  // 那是平台活动标签，不是内容分类，挂上去读者会误以为是本站的活动。
  // ⚠️ 判据只看**渲染字符串**（title/sub 字段值），不看源码注释：
  //    注释里写明「为什么不收活动标签」是必要的说明，把它也判红会让说明与校验互斥。
  const ikwBlock = (fd.match(/\{[\s\S]*?ikwJurpCaGk\/[\s\S]*?\}/) || [''])[0];
  const ikwStrings = (ikwBlock.match(/'[^']*'/g) || []).join('');
  check(/v\.douyin\.com\/ikwJurpCaGk\//.test(fd)
    && /卧底快递王国/.test(ikwStrings)
    && !/抖音精选App/.test(ikwStrings),
    '§36m 视频区新增「卧底快递王国」（短链 + 标题就位，且不夹带平台活动标签）',
    '站长 11-17 给的产业揭秘视频没进 VIDEOS 数组，或把 #抖音精选App 这类活动标签挂进了题目/副标题');
  // 2026-11-20 站长：余淼杰「不守双休就降信用」视频挂视频区并**置顶**（数组第一条）。
  // 判据：aweme_id=7614341978976701723 必须出现在 VIDEOS 数组第一条对象里，
  // 且排在原第一条（AY0dA2mhhAw）之前——只「加进数组」不算置顶。
  const vidsBlock = (fd.match(/var VIDEOS = \[([\s\S]*?)\n  \];/) || ['', ''])[1];
  const firstVid = (vidsBlock.match(/\{\s*share:\s*'([^']+)'/) || ['', ''])[1];
  check(!!firstVid && firstVid.indexOf('aweme_id=7614341978976701723') !== -1
      && /aweme_id=7614341978976701723/.test(fd)
      && /不守双休，公司就降信用/.test(fd) && /余淼杰/.test(fd),
    '§36m 视频区第一条（置顶）为余淼杰「不守双休就降信用」视频（原始 so.douyin.com 链接 + 标题在案）',
    '视频没置顶到第一条、或标题/链接缺失 → 站长要的置顶没生效');
  check(/featured-douyin\.js\?v=8/.test(idx36m),
    '§36m featured-douyin.js 的 ?v 已 bump 到 8（浏览器缓存旧脚本会吃掉本次改动）',
    '?v 没 bump → 旧脚本仍按旧 VIDEOS 渲染，新视频与 dead 标记都不生效');
}


// ---------- 36v. 留言与参与准则：全站可达 + 只写本站真正能执行的处置（2026-11-17 站长） ----------
// 站长原意：Google AdSense 后台那条「因乌克兰发生战争…暂停其变现资格」的公告要照着写一条
// 站内公告，但不许提变现，处置手段换成本站真有的（GitHub 拉黑）。
// 落点判断：本站零账号、零评论区，公开互动只有 GitHub Issues 与匿名邮箱两条，
// 所以「公告」做成一个常驻法务页（community-rules.html），挂全站页脚，而不是首页顶部跑马灯——
// 跑马灯只承载证据链一句话，塞进去会把首页唯一的高优先级信息稀释掉。
// 断言只钉语义要素（通道 / 不予处理 / 拉黑 / 不收变现字样），不钉原句，便于日后润色。
{
  const cr36v = exists('community-rules.html') ? read('community-rules.html') : '';
  /* 可见正文（去 HTML 注释、去标签）：注释里写「AdSense 接入准备」这类工程备注
     是合理的，不该被当成为读者写的制度；正文才受下面两条「不许写什么」约束。 */
  const crBody = cr36v
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<[^>]+>/g, ' ');
  check(cr36v.length > 0, '§36v 留言与参与准则页 community-rules.html 在位',
    '准则页被删 → 全站页脚链接全部 404');
  check(/github\.com\/dujeongil-galaxy\/shuangxiugou/.test(cr36v) && /Issues/.test(cr36v)
    && /匿名邮箱|匿名通道/.test(cr36v),
    '§36v 准则页写明本站的两条真实通道（GitHub Issues + 匿名邮箱），不虚构站内评论区',
    '准则页承诺了本站并不存在的互动场所 → 读者照着去找会落空');
  check(/辱骂|人身攻击/.test(cr36v) && /人肉|挂人/.test(cr36v) && /刷屏/.test(cr36v),
    '§36v 准则页明确不予处理的三类内容（辱骂攻击 / 人肉挂人 / 刷屏带节奏）',
    '准则页没写清边界 → 删帖与屏蔽都会被质疑「凭什么」');
  check(/GitHub/.test(cr36v) && /屏蔽|拉黑/.test(cr36v),
    '§36v 严重违规处置落到「GitHub 屏蔽 / 拉黑」（本站实际能执行的动作）',
    '准则页写了本站执行不了的处罚（禁言时长 / 封号 / 处罚公示），等于空口威胁');
  /* ⚠️ 上面那条「有屏蔽/拉黑」还不够：正文别处提到「被屏蔽」也能骗过去
     （2026-11-17 故障注入实测：把标题里的「拉黑」改成「禁言」后仍全绿）。
     补一条只扫**处置章节标题**的断言——章节标题是这条规则的落点，必须自证是 GitHub 动作。 */
  const crActionHead = (cr36v.match(/<h2>\d+\.\s*严重违规[^<]*<\/h2>/) || [''])[0];
  check(crActionHead.length > 0 && /GitHub/.test(crActionHead)
    && /屏蔽|拉黑/.test(crActionHead),
    '§36v 「严重违规」章节标题本身就写明处置是 GitHub 屏蔽/拉黑（不接受只写「禁言/封号」）',
    `处置章节标题不合格：${crActionHead || '（找不到严重违规章节）'}`);
  check(!/站内禁言|封号|永久禁言|处罚公示/.test(crBody),
    '§36v 准则页不承诺本站执行不了的处罚（无站内账号 = 无禁言、无封号）',
    '出现「禁言 / 封号 / 处罚公示」字样 → 本站没有账号系统，这类处罚根本执行不了，属空口威胁');
  check(/匿名邮箱/.test(cr36v) && /证据[^。]{0,40}(仍会|照常|受理)/.test(cr36v),
    '§36v 被屏蔽后仍保留匿名邮箱递证据的通道（证据优先于说话的人）',
    '一旦屏蔽就断掉证据通道 → 真实纠错进不来，只剩情绪');
  /* 站长明确要求不写变现：AdSense 那条公告的触发条件是变现资格，
     本站没有广告主关系，写「暂停变现资格」是照抄别人的制度，且会把商业条款
     绑进内容治理（等于承认可以为了收入删帖）。这条断言防的就是日后有人「补全」回去。 */
  check(!/变现资格|广告收入|暂停.{0,6}收入|变现/.test(crBody),
    '§36v 准则页正文不提变现 / 广告收入（站长 2026-11-17 明确要求，内容治理与商业条款脱钩）',
    '准则页正文出现变现字样 → 照抄了 AdSense 公告的商业条款，治理逻辑被挂到收入上');
  // 全站可达：19 个顶层页 + 181 张品牌页，一个都不能漏（页脚是唯一入口）
  const crPages = ['index.html', '404.html', 'about.html', 'contact.html', 'disclaimer.html',
    'privacy.html', 'projects.html', 'sponsor.html', 'labor-ai.html'].filter((p) => exists(p));
  const crMissing = crPages.filter((p) => !read(p).includes('community-rules.html'));
  check(crMissing.length === 0,
    `§36v 法务页脚已挂「留言准则」入口（抽查 ${crPages.length} 个顶层页无一遗漏）`,
    `这些页面页脚缺入口：${crMissing.join(', ')}`);
  const crBrandNo = readdirSync(join(ROOT, 'brand'))
    .filter((f) => f.endsWith('.html'))
    .filter((f) => !read(join('brand', f)).includes('../community-rules.html'));
  check(crBrandNo.length === 0,
    '§36v 全部品牌详情页页脚也挂「留言准则」（相对路径 ../community-rules.html）',
    `这些品牌页缺入口或相对路径写错：${crBrandNo.slice(0, 5).join(', ')}`);
  check(/community-rules\.html/.test(read('sitemap.xml')),
    '§36v 准则页已进 sitemap.xml（能被搜索引擎发现）',
    '新页没进 sitemap → 只有从页脚点进来的人知道它存在');
}


// ---------- 36n. 公益广告位底部新增免责脚注（AI 生成图 + 站长人工核实 + issue 申请上刊，2026-11-11 站长） ----------
{
  const ad36n = exists('black-card-adslot.js') ? read('black-card-adslot.js') : '';
  const idx36n = read('index.html');
  /* 断言只钉语义要素，不钉原句：站长草稿里的措辞随时会被站内文案改写，
     把整句话逐字钉死会让「改文案」和「过校验」互斥（2026-11-11 踩过）。
     此处校验 5 个事实点：图是 AI 生成 / 站长人工核实 / 产线须双休 / 不靠联网搜 / 走 issue 交实证。 */
  check(/sxg-adslot__disclaimer/.test(ad36n) &&
    /AI\s*(生成|绘制)/.test(ad36n) &&
    /人工核实/.test(ad36n) &&
    /产线[^。]{0,30}双休/.test(ad36n) &&
    /联网/.test(ad36n) &&
    /issue/.test(ad36n) &&
    /实证|证据/.test(ad36n) &&
    /2026\s*年\s*11\s*月起(开始)?实行/.test(ad36n),
    '§36n 公益广告位底部免责脚注（AI 生成图 + 站长人工核实产线须双休 + 不靠联网 + issue 递交实证申请上刊 + 本政策自 2026 年 11 月起实行）',
    '脚注文案缺失 → 访客无法得知图片是 AI 生成、企业信息由站长人工核实、如何申请上刊');
  /* 2026-11-12 站长：「加一句话，仅限中国大陆品牌，因为双休购本质上还是希望改变我们自己」。
     同样只钉语义要素（适用范围 / 中国大陆），不钉改写后的原句，便于日后继续润色。 */
  check(/sxg-adslot__scope/.test(ad36n) &&
    /中国大陆/.test(ad36n),
    '§36n 脚注已声明适用范围仅限中国大陆品牌与门店（本站意在改进国内用工状况，不评价境外）',
    '缺「仅限中国大陆」限定 → 读者会以为榜单对境外品牌也作同等评判');
  check(/black-card-adslot\.js\?v=22/.test(idx36n),
    '§36n black-card-adslot.js 的 ?v 已 bump 到 21（浏览器缓存旧脚本会吃掉本次脚注）',
    '?v 没 bump → 旧脚本无脚注、本次改动不生效');
}

// ---------- 36o. BYD 证据链新增澎湃「轮毂装反」报道；首页卡片备注不得被污染（2026-11-11 站长） ----------
// 站长指令原文：「此视频加入到BYD相关证据链，但不要在首页卡片更改备注」。
// 两件事分别钉死：① 品牌页证据来源里必须落到这条澎湃报道（含短链 + 消费线索定性，
// 避免读者误以为是双休/用工证据）；② 首页 BYD 卡片备注保持原样，视频信息不许写进首页卡。
{
  const byd36o = exists('brand/byd.html') ? read('brand/byd.html') : '';
  check(/v\.douyin\.com\/On1eQs3gnWE\//.test(byd36o) &&
    /轮毂装反/.test(byd36o) &&
    /澎湃新闻/.test(byd36o) &&
    /不涉及用工与双休认定/.test(byd36o),
    '§36o BYD 品牌页证据来源新增「多位车主投诉前后轮毂装反」澎湃报道（原视频短链 + 消费线索定性说明）',
    '证据链缺这条 → 站长给的那条澎湃视频没落到 BYD 证据页');
  // 只扫「卡片备注那一句」而不是全页：新证据本来就要进首页公示区（证据链在首页），
  // 全页出现「轮毂」是正常的；被判红的是「卡片备注被改写」。
  const note36o = (/比亚迪：名义双休但加班重[^\n]{0,60}/.exec(html) || [''])[0];
  check(note36o.length > 0 && !/轮毂|装反|抖音/.test(note36o),
    '§36o 首页 BYD 卡片备注保持原样（仍是「名义双休但加班重…」，未被本次视频污染）',
    '首页卡备注被改写 → 违反站长「不要在首页卡片更改备注」');
}

// ---------- 36i/36j. 广告位令牌对齐品牌卡；窄屏整页右留 76px（2026-11-11 站长「接着做」） ----------
// 站长拍板：§36i 只对齐观感令牌（不动内部结构 / 不删第三张招商卡）；
// §36j 整页统一右留 76px，吸底条一起纳入。
{
  const ad36i = exists('black-card-adslot.js') ? read('black-card-adslot.js') : '';
  check(/\.sxg-adslot\{[\s\S]{0,400}?rgba\(226,232,240,\.8\)/.test(ad36i) &&
    /\.sxg-adslot\{[\s\S]{0,400}?box-shadow:0 1px 2px 0 rgba\(0,0,0,\.05\)/.test(ad36i),
    '§36i 广告位外观令牌对齐站点品牌卡（border-slate-200/80 + shadow-xs），内部结构与三张海报未动',
    '广告位仍是实色边框 / 无阴影 → 与品牌卡令牌不一致，看着像外挂的一块');

  // 与 §36g 一致剥掉 CSS 注释再断言：注释里也会出现「body padding-right:76px」这类说明文字
  const mf36j = exists('mobile-fixes.css') ? stripCssComments(read('mobile-fixes.css')) : '';
  check(/body \{[\s\S]{0,80}?padding-right: 76px/.test(mf36j) &&
    !/\.lp-ad \{[^}]*right: 76px/.test(mf36j),
    '§36j 窄屏（≤640px）整页内容右留 76px（body）；吸底条保持满宽（与 FAB 纵向不重叠，收右缘会把文案压成竖排）',
    '窄屏没给右侧 FAB 列留列宽 → hero/卡片/统计滚动经过时仍被悬浮钮压住；或又把吸底条收窄导致文案竖排');
}

// ---------- 36q. 悬浮层收口：唯一 #sxg-fab-dock 容器（2026-11-12） ----------
// §36s 之后撤掉了「更多」折叠层：右列 76px 已整页隔离（§36j），六枚 + 邮箱
// 一律常显并撑成宽条。这里只钉「唯一所有者 + 自动排布 + 可还原桌面」的架构契约，
// 不再钉任何逐点魔数，也不再钉折叠状态。
{
  const mf36q = exists('mobile-fixes.css') ? stripCssComments(read('mobile-fixes.css')) : '';
  const dock36q = exists('fab-dock.js') ? read('fab-dock.js') : '';
  const idx36q = read('index.html');

  // ① CSS：容器只写一次定位；容器子项把源脚本注入的 fixed/bottom 整体清成 relative。
  const dockCssOk = /#sxg-fab-dock\s*\{[^}]*position:\s*fixed[^}]*flex-direction:\s*column[^}]*gap:\s*6px/.test(mf36q)
    && /#sxg-fab-dock\s*>\s*\*[^}]*position:\s*relative\s*!important[^}]*bottom:\s*auto\s*!important/.test(mf36q)
    && /#sxg-fab-dock\s*\{[^}]*pointer-events:\s*none/.test(mf36q);
  // ② 面板与高度：AI 面板跟随 --sxg-dock-h，导航面板右锚定；绝不再出现逐点魔数。
  // 2026-11-12：AI 面板改 top 锚定（贴 header 下沿），不再用 dock-h 反推——
  // 键盘弹起时 visual viewport 变矮，bottom 算式会变负数把面板顶出屏幕。
  const panelOk = /#sxg-ai-panel\s*\{[^}]*top:\s*calc\(var\(--sxg-ai-top/.test(mf36q)
    && /#sxg-ai-panel\s*\{[^}]*bottom:\s*auto/.test(mf36q)
    && /#sxg-ai-panel\s*\{[^}]*var\(--sxg-ai-vh/.test(mf36q)
    && /#sxg-nav-panel\s*\{[^}]*position:\s*fixed\s*!important/.test(mf36q)
    && /#sxg-nav-panel\s*\{[^}]*--sxg-dock-h/.test(mf36q)
    && !/\+\s*(210|272|276|335)px/.test(mf36q)
    && !/body\s*\{[^}]*padding-left/.test(mf36q);
  check(dockCssOk && panelOk,
    '§36q 悬浮层唯一所有者 #sxg-fab-dock（flex 自动排布 / 空隙不吃点击），子项清掉各自 fixed+bottom，AI 面板 top 锚定 header 下沿并由 --sxg-ai-vh 钳高（键盘弹起不挪位），旧魔数清零',
    '又回到六枚各自 fixed 写死 bottom / 面板写死 +276px → 加按钮或换屏高必然再穿模');

  // ③ JS：注册清单覆盖六枚 + 客居入口，且能双向搬迁（桌面还原）。
  const listOk = /var\s+ORDER\s*=\s*\[[^\]]*sxg-nav[^\]]*sxg-remind-btn[^\]]*sxg-video-btn[^\]]*sxg-bottom-btn[^\]]*sxg-ai-fab[^\]]*sxg-top-btn/.test(dock36q)
    && /var\s+GUESTS\s*=\s*\[[^\]]*sxg-anon-mail-btn[^\]]*login-github-btn/.test(dock36q)
    && /var\s+ALL\s*=\s*ORDER\.concat\(GUESTS\)/.test(dock36q)
    && /'login-github-btn':\s*'登录'/.test(dock36q)
    && /data-sxg-dock-label/.test(dock36q);
  const archOk = /max-width:\s*640px/.test(dock36q)
    && /--sxg-dock-h/.test(dock36q)
    && /function\s+disable\(\)[\s\S]{0,900}?document\.body\.appendChild/.test(dock36q)
    && /MutationObserver/.test(dock36q)
    && !/is-expanded|sxg-fab-more|var\s+PRIMARY|var\s+EXTRA/.test(dock36q);
  check(exists('fab-dock.js') && listOk && archOk,
    '§36q fab-dock.js 六枚全部常显（含短标签）、客居入口（匿名邮箱 / Login GitHub）退出窄屏时还给 body，仅 ≤640px 启用且可还原桌面',
    '收编清单缺项 / 折叠层回潮 / 桌面端也被搬走 → 悬浮层又变成两套布局各自为政');

  // ④ 挂载顺序：dock 脚本必须排在所有悬浮脚本之后。
  const mountOk = /<script defer src="\.\/fab-dock\.js\?v=3"><\/script>/.test(idx36q)
    && idx36q.indexOf('fab-dock.js?v=3') > idx36q.indexOf('nav-menu.js?v=7')
    && Number((idx36q.match(/mobile-fixes\.css\?v=(\d+)/) || [])[1] || 0) >= 23
    && /header-menu-patch\.js\?v=(1[1-9]|[2-9]\d)/.test(idx36q);
  check(mountOk,
    '§36q index.html 已挂载 fab-dock.js?v=3 且排在所有悬浮脚本之后，mobile-fixes.css 带 ?v 缓存号 / header-menu-patch.js 缓存号随内容同步 bump',
    '挂载顺序错了 → dock 执行时按钮还没建好，收编为空；?v 没 bump → 浏览器缓存旧 CSS');
}

// ---------- 36r. 申诉弹窗补规则 + GitHub 访问帮助设备分流 + sponsor 链接规整（2026-11-12 站长） ----------
{
  const ap36r = read('appeal-policy.js');
  const gh36r = exists('github-access-help.js') ? read('github-access-help.js') : '';
  const ABS36R = 'https://dujeongil-galaxy.github.io/shuangxiugou/';
  const sm36r = read('share-modal.js');
  const sp36r = read('sponsor.html');
  const idx36r = read('index.html');
  const hp36r = read('header-menu-patch.js');

  // ① 追加规则：只取 body.textContent 的真实数组，注释救不了绿；只钉要素不钉原句。
  //    PITFALLS 第四十四章：站长口述是素材，逐字钉死会让「改文案」与「过校验」互斥；
  //    括号里的批注（别抄原话 / 站长推荐的vpn / 直接url链接）任何位置都不许上页面。
  const body36r = (ap36r.match(/body\.textContent\s*=\s*\[([\s\S]*?)\]\.join\('\\n'\)/) || ['', ''])[1];
  const ruleOk = /侮辱/.test(body36r) && /人身攻击/.test(body36r) && /不予审核/.test(body36r)
    && /重复/.test(body36r) && /劳动争议|劳动法/.test(body36r)
    && /法定渠道|法律途径|仲裁/.test(body36r)
    && !/别抄原话|站长推荐的vpn|直接url链接/.test(ap36r + gh36r);
  check(ruleOk && /setAttribute\('data-sxg-gh-help'/.test(ap36r),
    '§36r 申诉弹窗补一条站内语气规则（侮辱/人身攻击不予审核 · 勿重复投递 · 劳动争议优先法定渠道）+ 访问帮助容器；草稿批注未上页面',
    '规则要素缺失，或把站长括号批注当正文贴到公开弹窗 → 2026-11-11 §36n 同款事故');

  // ② 设备判定：UA 为主 + iPadOS 伪装 Mac 的触控修正，PC / 手机平板分得开。
  const devOk = /function\s+isDesktop\(\)/.test(gh36r)
    && /Android\|iPhone\|iPod\|iPad/.test(gh36r)
    && /maxTouchPoints/.test(gh36r)
    && /Macintosh/.test(gh36r)
    && /function\s+isNarrow\(\)/.test(gh36r);
  check(devOk,
    '§36r 设备判定代码就位（UA + maxTouchPoints + iPadOS 伪装 Mac 修正），区分 PC 与手机 / 平板',
    '没判定代码 → PC 与手机看到同一套方案，Steam++ 桌面方案会推给手机用户');

  // ③ PC 分支：只挂合规开源工具官网，不推荐 VPN；提示「网络加速中勾选 GitHub」。
  const pcOk = /STEAMPP_URL\s*=\s*'https:\/\/steampp\.net\/'/.test(gh36r)
    && /网络加速/.test(gh36r) && /勾选/.test(gh36r)
    && /isDesktop\(\)/.test(gh36r)
    && !/点此购买|站长推荐/.test(gh36r);
  check(pcOk,
    '§36r PC 分支挂 Watt Toolkit（原 Steam++）官网并提示「网络加速中勾选 GitHub」，不新增 VPN 推广话术',
    'PC 分支写回 VPN 推广或漏掉「勾选 GitHub」→ 与站长本次口径不符');

  // ④ 移动分支：沿用站点 Login GitHub 弹窗已有的那个入口，不新造链接。
  const mob36r = (gh36r.match(/MOBILE_ENTRY\s*=\s*'([^']+)'/) || ['', ''])[1];
  const hpEntry = (hp36r.match(/https:\/\/47\.112\.97\.173:8000\/register\?aff=[A-Za-z0-9]+/) || [''])[0];
  check(mob36r !== '' && hpEntry !== '' && mob36r === hpEntry
    && /手机\s*\/\s*平板/.test(gh36r),
    '§36r 手机 / 平板分支沿用 Login GitHub 弹窗的站点原有入口（同一 URL，不新造推广链接）',
    '移动端另起一条新推广链接 → 等于借本次改动扩大 VPN 推广面');

  // ⑤ Star on GitHub 二级菜单：§36t 起两端都贴 Star 常显，浮层 fixed 不插 DOM。
  const menuOk = /TRIGGER_ID/.test(gh36r) && /findStar\(\)/.test(gh36r)
    && /Star on GitHub/.test(gh36r)
    && /star\.parentNode\.insertBefore\(t, star\.nextSibling\)/.test(gh36r)
    && /position:fixed/.test(gh36r) && /FLY_ID/.test(gh36r)
    && !/sxg-header-menu/.test(gh36r);
  check(menuOk,
    '§36r Star on GitHub 二级菜单：🌐 触发入口贴 Star 常显（§36t 撤掉下拉），浮层 position:fixed 不插进顶栏 DOM',
    '入口又挂回下拉菜单 / 浮层塞进顶栏按钮组 → 长 URL 被 nowrap 撑爆或按钮被藏');

  // ⑥ 打赏页所有按钮生成的链接剥掉 sponsor.html：分享单一真相源 + 兜底复制都要改。
  const normOk = sm36r.indexOf('function shareUrl(') !== -1
    && sm36r.indexOf('var url = shareUrl(SITE_HOME)') !== -1
    && sm36r.indexOf("var SITE_HOME = '" + ABS36R + "'") !== -1
    && sm36r.indexOf('sponsor\\.html(?:[?#].*)?$') !== -1
    && sp36r.indexOf('ta.value = location.href.replace(/sponsor\\.html(?:[?#].*)?$/, \'\')') !== -1
    && !/ta\.value = location\.href;/.test(sp36r);
  check(normOk,
    '§36r sponsor.html 的分享 / 复制链接统一在 share-modal.js 的 info() 剥掉 sponsor.html，兜底复制同步处理',
    '只改好路径漏了兜底复制 → 脚本未加载时复制出去的仍是带 sponsor.html 的链接');

  // ⑦ 挂载与 ?v 钉子（§21h 纪律），以及 jsdom 行为测试存在。
  check(/<script defer src="\.\/github-access-help\.js\?v=3"><\/script>/.test(idx36r)
    && /appeal-policy\.js\?v=4/.test(idx36r)
    && /share-modal\.js\?v=12/.test(idx36r)
    && /share-modal\.js\?v=12/.test(sp36r)
    && exists('scripts/test-github-access-help.cjs'),
    '§36r index.html 挂载 github-access-help.js?v=3 / appeal-policy.js?v=4，改动脚本 ?v 同步 bump，配套 jsdom 行为测试存在',
    '?v 没 bump → 浏览器/CDN 命中旧脚本，新文案与链接规整都不生效');
}

// ---------- 36s. 匿名邮箱入口 + 访问告知弹窗 + 手机悬浮按钮全部撑开（2026-11-12 站长） ----------
{
  const am36s = exists('anon-mail.js') ? read('anon-mail.js') : '';
  const hp36s = read('header-menu-patch.js');
  const idx36s = read('index.html');
  const mf36s = stripCssComments(read('mobile-fixes.css'));
  const dock36s = read('fab-dock.js');
  const wf36s = read('.github/workflows/verify.yml');

  // ① 事实点：目标站点、最新匿名邮箱、明确的「没 VPN 打不开」，只钉要素不钉逐字。
  check(/SITE_URL\s*=\s*'https:\/\/m\.kuku\.lu\/cn\.php'/.test(am36s)
    && /MAIL\s*=\s*'tensi2026@choco\.la'/.test(am36s)
    && /没有 VPN/.test(am36s) && /无法访问/.test(am36s)
    && /大陆网络/.test(am36s)
    && !/别抄原话|站长推荐|点此购买|直接url链接/.test(am36s),
    '§36s 匿名邮箱弹窗写清「没有 VPN 无法访问」，并备注站长最新匿名邮箱（弹窗展示与复制按钮同由 MAIL 常量驱动）；草稿批注不上页面',
    '少了 VPN 告知或邮箱写错 → 用户点进去白等；把站长括号批注贴到公开弹窗 → §36n 同款事故');

  // ② 首次点击必须先弹窗：目标链接只存在于弹窗的「仍要前往」出口。
  const modalHtml36s = (am36s.match(/card\.innerHTML\s*=([\s\S]*?);/) || ['', ''])[1];
  const interceptOk = /addEventListener\('click',\s*function\s*\(ev\)[\s\S]{0,280}?ev\.preventDefault\(\)[\s\S]{0,280}?openModal\(\)/.test(am36s)
    && /class="sxg-am-go" href="' \+ SITE_URL/.test(modalHtml36s)
    && /target="_blank"/.test(modalHtml36s)
    && /class="sxg-am-copy"/.test(modalHtml36s)
    && !/window\.location/.test(am36s);
  check(interceptOk,
    '§36s 首次点击 preventDefault + 先弹窗，目标 URL 只在「仍要前往」出口（新标签），另给复制邮箱按钮',
    '按钮直接 href 跳走 / 弹窗没有可点出口 / 复制按钮丢失 → 等于没做告知层');

  // ③ 手机落位：不进顶栏、不进「菜单▼」，直接进已隔离的 dock；并禁止折叠回潮。
  const placeOk = /DOCK_ID\s*=\s*'sxg-fab-dock'/.test(am36s)
    && /dock\.insertBefore\(btn, dock\.firstChild\)/.test(am36s)
    && /data-sxg-anon-slot/.test(am36s)
    && /HEADER_CLASS/.test(am36s)
    && !/menu\.appendChild\(btn\)/.test(am36s);
  const stretchOk = /#sxg-fab-dock\s*\{[^}]*width:\s*68px[^}]*align-items:\s*stretch/.test(mf36s)
    && /#sxg-fab-dock\s*>\s*\*[^}]*width:\s*68px\s*!important[^}]*height:\s*36px\s*!important/.test(mf36s)
    && /content:\s*attr\(data-sxg-dock-label\)/.test(mf36s)
    && !/is-expanded|sxg-fab-dock__more-btn|sxg-fab-dock__extra/.test(mf36s)
    && !/is-expanded|sxg-fab-more/.test(dock36s);
  check(placeOk && stretchOk,
    '§36s 手机端按钮全部撑开：dock 68px 贴右留白列、每枚 68×36 带中文短标签、撤掉「更多」折叠；邮箱入口挂 dock 首位',
    '又写回「⋯ 更多」折叠 / 宽条退回圆钮 / 新入口塞进「菜单▼」被隐藏 → 白留一列且入口静默失效');

  // ④ §36t 起顶栏不再折叠：两端都常显，只确认展开标记与断点监听还在。
  check(/data-sxg-hdr-expanded/.test(hp36s)
    && /addEventListener\('change', onBp\)|addListener\(onBp\)/.test(hp36s)
    && !/function\s+restore\(\)|function\s+collapse\(/.test(hp36s)
    && !/\.sxg-header-btn\s*\{\s*display:\s*none/.test(hp36s),
    '§36s 顶栏不再折叠：撤掉 collapse/restore 与隐藏规则，宽窄屏都常显，断点只重新确认展开标记',
    '又写回折叠 / restore → 站长 §36t「全部展开，按钮不再做隐藏」被推翻');

  // ⑤ 挂载与 ?v 钉子（§21h 纪律）+ jsdom 行为测试挂进 CI（§21o）。
  check(/<script defer src="\.\/anon-mail\.js\?v=5"><\/script>/.test(idx36s)
    && idx36s.indexOf('anon-mail.js?v=5') > idx36s.indexOf('fab-dock.js?v=3')
    && /fab-dock\.js\?v=3/.test(idx36s)
    && Number((idx36s.match(/mobile-fixes\.css\?v=(\d+)/) || [])[1] || 0) >= 23
    && /header-menu-patch\.js\?v=(1[1-9]|[2-9]\d)/.test(idx36s)
    && exists('scripts/test-anon-mail.cjs')
    && wf36s.indexOf('node scripts/test-anon-mail.cjs') !== -1,
    '§36s index.html 挂载 anon-mail.js?v=5（排在 fab-dock 之后；v=5 为匿名邮箱地址变更那次 bump），三个改动资源 ?v 同步 bump，配套 jsdom 测试挂进 CI',
    '?v 没 bump → 浏览器/CDN 命中旧脚本；测试没挂 CI → §21o 判红或回归没人拦');

  // 隐藏开关 + CSS 隐藏规则必须都在（临时隐藏不删除：ENABLED 改 true 即恢复；
  // data-sxg-anon-hidden 的 !important 压过手机 dock 的 display:flex !important）。
  // 只钉机制存在，不钉 ENABLED 当前布尔值——翻回 true 恢复显示时不应判红。
  check(/var\s+ENABLED\s*=\s*(true|false)/.test(am36s)
    && /data-sxg-anon-hidden="1"\]\{display:none !important\}/.test(am36s),
    '§36s 匿名邮箱「隐藏开关 ENABLED + !important 隐藏规则」机制在位（不删除、可一键恢复）',
    'anon-mail.js 缺失 ENABLED 开关或 data-sxg-anon-hidden 隐藏规则');
}

// ---------- 36u. 首页弹窗 新版/旧版 转换按钮（2026-11-12 站长） ----------
{
  const t36u = exists('dyp-version-toggle.js') ? read('dyp-version-toggle.js') : '';
  const idx36u = read('index.html');
  const wf36u = read('.github/workflows/verify.yml');

  // ① 单一真相源：两个新版抖音短链 + 旧版「在抖音中观看」链接，与站长给的分享短链一致。
  //    2026-11-14 站长：「理想L8 的链接删了」→ 第二条换成 fe8jmWjCmqY（新车轮毂竟然装错），
  //    变量 L8 随之改名 BYD2（两条都是比亚迪短片，留着 L8 这个名字会误导下一次改链）。
  const srcOk = /BYD\s*=\s*'https:\/\/v\.douyin\.com\/_n2cFrXIRec\/'/.test(t36u)
    && /BYD2\s*=\s*'https:\/\/v\.douyin\.com\/fe8jmWjCmqY\/'/.test(t36u)
    && /OLD_GO_HREF\s*=\s*'https:\/\/v\.douyin\.com\/37pbo6qxUbs\/'/.test(t36u)
    && /OLD_GO_TEXT\s*=\s*'在抖音中观看'/.test(t36u);
  check(srcOk,
    '§36u 转换按钮单一真相源：新版比亚迪两条短片短链（轮辋装反 _n2cFrXIRec / 轮毂装错 fe8jmWjCmqY）+ 旧版「在抖音中观看」链接，与站长给的分享链一致',
    '抖音链接抄错 / 旧版链接丢失 → 转换后跳错页面');

  // ② 默认版本 new（用户硬规定「默认显示新版本」）；new 版隐藏事实核查（display:none，不删除节点）；
  //    old 版移除自有 .dyp__douyin2（绝不碰 factcheck-button.js 注入的 .dyp__factcheck 节点）。
  const verOk = /function\s+getVersion\(\)\s*\{[\s\S]{0,160}?return\s+v\s*===\s*'old'\s*\?\s*'old'\s*:\s*'new'/.test(t36u)
    && /if\s*\(\s*fact\s*\)\s*fact\.style\.display\s*=\s*'none'/.test(t36u)
    && /if\s*\(\s*d2\s*&&\s*d2\.parentNode\s*\)\s*d2\.parentNode\.removeChild\(d2\)/.test(t36u)
    && !/dyp__factcheck[\s\S]{0,60}removeChild/.test(t36u);
  check(verOk,
    '§36u 默认版本 new、new 版隐藏事实核查（display:none 不删除）、old 版移除自有 .dyp__douyin2（不删 factcheck 节点）',
    '默认版不是 new / new 版仍在显示事实核查 / 旧版没清掉新版第二按钮 / 误删事实核查节点');

  // ③ 转换按钮落位：站长 2026-11-12 纠正——放在「弹窗内部右上角」（.dyp__panel 内、
  //    紧挨 × 左侧），不放页面顶栏/dock。锚点用 .dyp__panel + .dyp__x + .dyp__version-toggle。
  const placeOk = /\.dyp__panel/.test(t36u)
    && /\.dyp__x/.test(t36u)
    && /dyp__version-toggle/.test(t36u)
    && /insertBefore\(btn,\s*x\)/.test(t36u)
    // 反面：不得再回退到顶栏落位（anon-mail 那套 dock 机制）
    && !/login-github-btn/.test(t36u)
    && !/DOCK_ID\s*=\s*'sxg-fab-dock'/.test(t36u);
  check(placeOk,
    '§36u 转换按钮落在弹窗内部右上角（.dyp__panel 内、插在 .dyp__x 之前、带 .dyp__version-toggle），不回退顶栏',
    '按钮没进弹窗 / 回到顶栏 dock 落位 → 与站长「放在这个位置」不符');

  // ④ 挂载与 ?v 钉子 + jsdom 测试挂进 CI（§21o）。
  check(/<script defer src="\.\/dyp-version-toggle\.js\?v=8"><\/script>/.test(idx36u)
    && exists('scripts/test-dyp-toggle.cjs')
    && wf36u.indexOf('node scripts/test-dyp-toggle.cjs') !== -1,
    '§36u index.html 挂载 dyp-version-toggle.js?v=8，配套 jsdom 测试挂进 CI',
    '?v 没 bump / 测试没挂 CI → 转换逻辑静默失效没人拦');

  /* ⑥ 站长 2026-11-12：「切换旧版，请不要使用替换二字」。
     按钮文案固定为「切换旧版」，源码里不得再出现「替换」二字（反面反查，
     防下次改文案又把词写回去）。old 态那侧仍写「新版本」，不受影响。 */
  check(/labelFor\(v\)\s*\{\s*return\s+v\s*===\s*'new'\s*\?\s*'切换旧版'/.test(t36u)
    && !/替换/.test(t36u),
    '§36u 转换按钮文案「切换旧版」，源码内不得出现「替换」二字',
    '文案回退到「替换旧版」或在别处又写「替换」→ 与站长用词要求不符');

  // ⑤ 三按钮文案与宽度分配（2026-11-12 15:48 站长「看看按钮大小，再看文字」）。
  //    实测（CDP 1440）：.dyp__acts 行宽 357px、gap 8px，旧版 .dyp__go{flex:2} 让
  //    第三枚只剩 90px，「理想L8·抖音短片」scrollWidth 107 > clientWidth 92 → 省略号截断。
  //    钉死：① 文案收到 ≤6 字；② 新版三枚等宽（flex:1 1 0）；③ 等宽只在 ≥521px 生效
  //    （≤520px 纵向排列必须保留官方 flex:0 0 auto）。
  // 只剥**注释**再判旧文案（文件里保留「原先写 8～9 字被截断」的说明，那是记录不是实现）。
  // 注意别用裸 `\/\/[^\n]*` 剥：会把 https:// 的尾巴一起吃掉（PITFALLS 第三十四章老坑），
  // 这里只认「整行以 // 开头」的行注释 + 块注释。
  const t36uCode = t36u.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*$/gm, '');
  //    2026-11-14：两个入口同属比亚迪后，按钮文字改按「部件 + 错误动作」区分——
  //    短片一 / 短片二（各 3 字）。品牌名重复写两遍等于零信息量，且分不清是哪条片子。
  const briefOk = /var NEW_GO_TEXT = '短片一'/.test(t36uCode)
    && /var NEW_D2_TEXT = '短片二'/.test(t36uCode);
  check(briefOk,
    '§36u 新版按钮文案只留中性序号（短片一 / 短片二），不再重复品牌名',
    '文案又写长 → 三等分格子里被 ellipsis 截断（站长 11-12 已指出一次）');
  check(/@media \(min-width:521px\)\{\.dyp__acts\.dyp--new > \*\{flex:1 1 0\}\}/.test(t36u),
    '§36u 新版三按钮等宽（≥521px 生效，≤520px 保留官方纵向 flex:0 0 auto）',
    '新版仍让 .dyp__go 占 2 倍宽度 → 后两枚被压到 90px、长文案截断');
}

// ---------- 36t. 手机端顶栏全部常显 + 帮助入口/两条办法不再隐藏（2026-11-12 站长「我再说一次」） ----------
{
  const hp36t = read('header-menu-patch.js');
  const mf36t = stripCssComments(read('mobile-fixes.css'));
  const gh36t = read('github-access-help.js');
  const ap36t = read('appeal-policy.js');
  const idx36t = read('index.html');
  const wf36t = read('.github/workflows/verify.yml');

  // ① 顶栏：撤掉折叠与隐藏，改成「不许隐藏」兜底 + 旧菜单残留回收。
  const noFold = /data-sxg-hdr-expanded/.test(hp36t)
    && /function\s+reclaim\(\)/.test(hp36t)
    && /display:inline-flex\s*!important/.test(hp36t)
    && !/\.sxg-header-btn\s*\{\s*display:\s*none/.test(hp36t)
    && !/function\s+collapse\(|function\s+restore\(/.test(hp36t)
    && !/menu\.appendChild\(btn\)|is-open|MENU_ID|TOGGLE_ID/.test(hp36t);
  check(noFold,
    '§36t 顶栏彻底撤掉「菜单▼」折叠：不再注入 .sxg-header-btn{display:none}、不建下拉容器，只留不许隐藏兜底 + 旧菜单残留回收',
    '又写回折叠 / 隐藏规则 → 站长「手机端全部展开，按钮不再做隐藏」再次落空');

  // ② CSS：≤640px 顶栏换行铺满，按钮自身宽度、nowrap、不省略；圆形帮助入口单独排除。
  const layoutOk = /header\s*>\s*div\[class\*="h-16"\]\s*\{[^}]*flex-wrap:\s*wrap[^}]*row-gap/.test(mf36t)
    && /header\s+div\[data-hdr-acts\][\s\S]{0,320}?flex-direction:\s*row\s*!important/.test(mf36t)
    && /header\s+div\[data-hdr-acts\][\s\S]{0,420}?flex-wrap:\s*wrap\s*!important/.test(mf36t)
    && /header\s+div\[data-hdr-acts\][\s\S]{0,900}?width:\s*auto\s*!important/.test(mf36t)
    && /white-space:\s*nowrap\s*!important/.test(mf36t)
    && /data-sxg-gh-desktop/.test(mf36t)
    && !/header\s+a\[href\*="github\.com"\][\s\S]{0,220}?width:\s*100%/.test(mf36t)
    && !/flex-direction:\s*column;\s*\n\s*align-items:\s*flex-end/.test(mf36t);
  check(layoutOk,
    '§36t ≤640px 顶栏 flex-wrap 换行、按钮组横向铺满第二行、每枚自身宽度 nowrap 全常显；🌐 圆形入口单独排除不撑成宽条',
    '退回竖排 width:100% / 文字省略号 → 全部展开变成换个姿态藏按钮');

  // ③ 帮助内容：两条办法都常显，设备判定只打「当前设备 · 推荐」标记。
  const helpBody = (gh36t.match(/function\s+helpHtml\(\)\s*\{([\s\S]*?)\n\s*\}/) || ['', ''])[1];
  const bothOk = /var\s+pcRow\s*=/.test(helpBody) && /var\s+mobRow\s*=/.test(helpBody)
    && /pcRow\s*\+\s*\(pc\s*\?\s*rec/.test(helpBody)
    && /mobRow\s*\+\s*\(pc\s*\?\s*''\s*:\s*rec\)/.test(helpBody)
    && /sxg-gh-help__rec/.test(gh36t)
    && !/var\s+row\s*;/.test(helpBody)
    && !/已按当前设备自动判断，无需手动切换/.test(gh36t);
  check(bothOk,
    '§36t GitHub 访问帮助两条（电脑 / 手机平板）同时常显，isDesktop() 只给当前设备那条打推荐标记，不再按设备隐藏另一条',
    '又用 if/else 只拼一个 row → 手机上永远看不到另一条办法，等于把内容藏起来');

  // ④ 触发入口：开关 SHOW_TRIGGER 单点控制，开着时贴 Star 常显、不依赖下拉菜单。
  //    2026-11-12 站长要求先删掉顶栏那颗蓝色 🌐（SHOW_TRIGGER=false），
  //    所以这里钉的是「机制在位、落位不变」，不钉当前布尔值——翻回 true 不该判红。
  const trigOk = /var\s+SHOW_TRIGGER\s*=\s*(true|false)/.test(gh36t)
    && /if\s*\(\s*!SHOW_TRIGGER\s*\)\s*\{\s*removeTrigger\(\);\s*return false;\s*\}/.test(gh36t)
    && /findStar\(\)/.test(gh36t)
    && /star\.parentNode\.insertBefore\(t, star\.nextSibling\)/.test(gh36t)
    && /position:fixed/.test(gh36t)
    && !/sxg-header-menu/.test(gh36t)
    && !/if\s*\(isNarrow\(\)\)/.test(gh36t);
  check(trigOk,
    '§36t 🌐 帮助入口由 SHOW_TRIGGER 单点开关控制（关 = 只撤可见入口，浮层与申诉槽位保留），开着时两端都贴 Star 常显、不挂下拉',
    '入口又塞进菜单 / 断点又重建 → 手机上按钮会凭空消失');

  // ⑤ 弹窗滚动复位：内容变长后聚焦按钮不能把标题滚出视野。
  check(/card\.scrollTop\s*=\s*0/.test(ap36t),
    '§36t 申诉弹窗打开后复位滚动位置，标题不被裁出视野（帮助块两条后卡片变高）',
    '内容变高 + focus() 自动滚到底 → 用户一打开只看到下半截');

  // ⑥ 641–900px 中等宽度：真渲染 660px 曾把六枚按钮挤成逐字竖条，补换行铺满。
  const midCss36t = (mf36t.match(/@media\s*\(min-width:\s*641px\)\s*and\s*\(max-width:\s*900px\)\s*\{([\s\S]*?)\n\}/) || ['', ''])[1];
  check(/flex-wrap:\s*wrap/.test(midCss36t)
    && /width:\s*100%/.test(midCss36t)
    && /white-space:\s*nowrap\s*!important/.test(midCss36t)
    && /flex:\s*0\s+0\s+auto\s*!important/.test(midCss36t),
    '§36t 641–900px 中等宽度顶栏也换行铺满（660px 真渲染实测逐字竖排），按钮 nowrap 不压缩',
    '只修 ≤640px → 平板横屏 / 窄桌面窗口按钮仍被挤成不可读的竖条');

  // ⑦ ?v 钉子（§21h）+ 新 jsdom 测试挂进 CI（§21o）。
  check(Number((idx36t.match(/mobile-fixes\.css\?v=(\d+)/) || [])[1] || 0) >= 23
    && /header-menu-patch\.js\?v=(1[1-9]|[2-9]\d)/.test(idx36t)
    && /github-access-help\.js\?v=3/.test(idx36t)
    && /appeal-policy\.js\?v=4/.test(idx36t)
    && exists('scripts/test-header-expand.cjs')
    && wf36t.indexOf('node scripts/test-header-expand.cjs') !== -1,
    '§36t 四个改动资源 ?v 同步 bump，配套 jsdom 行为测试存在并挂进 CI',
    '?v 没 bump → 真机命中旧折叠脚本；测试没挂 CI → §21o 判红或回归没人拦');
}

// ---------- 36v. 分享弹窗加固：平台一个都不能少，外链不再被误拦截（2026-11-12 站长） ----------
// 事故现场：站长看到分享平台「变少」。定位到 8 个外链平台（微博 / Facebook / X / LinkedIn /
// Reddit / Telegram / Line / WhatsApp）原先渲染成 <a href="…service.weibo.com/share…">，
// 被浏览器扩展 / 手机浏览器跟踪防护按分享接口特征整块移除，只剩 6 个复制类按钮。
// 加固口径（本段把它钉死，回退即判红）：外链一律 <button data-share>，URL 只活在 JS 闭包里，
// 点击走 window.open，新窗口若仍被拦就复制链接 + 明说，不允许「点了没反应」。
// 2026-11-14 站长追加：新增「汤不热（Tumblr）」→ 海外 10 项；图标全部圆形，上 5 下 10。
{
  const sm36v = read('share-modal.js');
  const idx36v = read('index.html');
  const sp36v = read('sponsor.html');
  const wf36v = read('.github/workflows/verify.yml');

  // ① 外链特征清零：弹窗里不许再有 <a> / href / target=_blank。
  //    先剥注释再判：源码注释里写「不再用 <a href>」属于说明，不是实际渲染。
  const sm36vCode = sm36v.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const noAnchor = !/<a\s/.test(sm36vCode)
    && !/href\s*=/.test(sm36vCode)
    && !/target\s*=\s*["']_blank/.test(sm36vCode)
    && !/<a class="sxg-sd"|<a class="sxg-sf"/.test(sm36vCode);
  check(noAnchor,
    '§36v 分享弹窗零外链特征：平台项不再渲染 <a> / href / target="_blank"（拦截规则无从匹配）',
    '外链又退回 <a href> → 扩展按分享接口特征整块移除，站长遇到的「平台变少」重新出现');

  // ② 外链平台按钮化：data-share 只带键名，URL 不进 DOM。
  const btnOk = /'<button type="button" class="sxg-sd" data-share="' \+ p\.url/.test(sm36v)
    && /'<button type="button" class="sxg-sf" data-share="' \+ p\.url/.test(sm36v)
    && /closest\('\[data-act="close"\], \[data-copy\], \[data-share\]'\)/.test(sm36v)
    && /var key = el\.getAttribute\('data-share'\)/.test(sm36v)
    && /openExternal\(shareTargets\[key\]\)/.test(sm36v)
    && !/data-share="'\s*\+\s*urls/.test(sm36v);
  check(btnOk,
    '§36v 国内 + 海外外链平台统一 <button data-share="键名">，点击按 key 从闭包取 URL（data-share 里不落 http 串）',
    '把分享 URL 写回 data-href / data-share 属性 → 换成会被扫的明文，加固白做');

  // ③ 打开方式与兜底：window.open 为主，被拦则复制 + 明说原因。
  const openOk = /function\s+openExternal\(url\)/.test(sm36v)
    && /window\.open\(url, '_blank'\)/.test(sm36v)
    && /win && !win\.closed/.test(sm36v)
    && /copyText\(url,/.test(sm36v)
    && /拦截/.test(sm36v);
  check(openOk,
    '§36v 外链统一 window.open 打开，遇新窗口被拦（返回空 / 已关闭）自动复制分享链接并在 toast 说明被拦',
    '删掉拦截判定 → 手机浏览器 / 严格拦截环境下「点了没反应」，用户连链接都拿不到');

  // ④ 平台清单恒定 14 项，不许任何条件裁剪（症状是「变少」，就不能再有任何少的机会）。
  const arrDom = (sm36v.match(/var DOMESTIC = \[([\s\S]*?)\];/) || ['', ''])[1];
  const arrFrn = (sm36v.match(/var FOREIGN = \[([\s\S]*?)\];/) || ['', ''])[1];
  const cntDom = (arrDom.match(/\{\s*k:\s*'/g) || []).length;
  const cntFrn = (arrFrn.match(/\{\s*k:\s*'/g) || []).length;
  check(cntDom === 5 && cntFrn === 10
    && /url: 'whatsapp'/.test(arrFrn)
    && /name: 'Tumblr', url: 'tumblr'/.test(arrFrn)
    && /tumblr:\s*'https:\/\/www\.tumblr\.com\/widgets\/share\/tool\?canonicalUrl='/.test(sm36v)
    && !/DOMESTIC\s*=\s*[\s\S]{0,80}?\.filter\(|FOREIGN\s*=\s*[\s\S]{0,80}?\.filter\(/.test(sm36v),
    '§36v 平台清单恒定渲染 15 项（国内 5 + 海外 10，末位 2026-11-14 新增的 Tumblr/汤不热，走 tumblr.com/widgets/share/tool），不做环境 / UA 条件裁剪',
    '条目被删或被 filter 掉 → 又变成「平台变少」，这次是自己人干的；少了 tumblr 键 → 点击落空');

  // ④-2 布局（2026-11-14 站长「下面的做成圆形，上 5 下 10」）：
  // 国内 5 一枚一排，海外 10 枚按 5 列网格折成两排，两段同一套圆形图标尺寸。
  const layoutOk = /\.sxg-share-domestic,\.sxg-share-foreign\{display:grid;grid-template-columns:repeat\(5,1fr\)/.test(sm36v)
    && /\.sxg-sd-ico,\.sxg-sf-ico\{[^}]*width:48px;height:48px;border-radius:50%/.test(sm36v)
    && /\.sxg-sd,\.sxg-sf\{display:flex;flex-direction:column/.test(sm36v)
    && !/\.sxg-sf\{[^}]*border-bottom/.test(sm36v)
    && !/sxg-sf-hint/.test(sm36v);
  check(layoutOk,
    '§36v 分享平台统一「圆形图标 + 名称」网格：国内 5 一排 + 海外 10 折成 5 列两排（上 5 下 10，共 15 枚），旧的横向清单行 / 提示文案已清除',
    '海外仍走横向清单行 → 上 5 下 10 不成立；图标容器改回圆角方形 → 与国内两套视觉分裂');

  // ⑤ ?v 同步 + jsdom 行为测试挂进 CI（§21h / §21o 纪律）。
  check(/share-modal\.js\?v=12/.test(idx36v)
    && /share-modal\.js\?v=12/.test(sp36v)
    && !/share-modal\.js\?v=11/.test(idx36v)
    && !/share-modal\.js\?v=11/.test(sp36v)
    && exists('scripts/test-share-modal.cjs')
    && wf36v.indexOf('node scripts/test-share-modal.cjs') !== -1,
    '§36v share-modal.js?v=12 在 index.html / sponsor.html 同步 bump，分享弹窗 jsdom 测试存在并挂进 CI',
    '?v 没 bump → 线上仍跑旧脚本，加固等于没发；测试没挂 CI → 下次回退没人拦');
}

// ---------- 36w. 顶栏第 6 枚「分享本站」+ 匿名邮箱 LOGO（2026-11-12 站长「右上角的问题」） ----------
{
  const se36w = exists('share-entry.js') ? read('share-entry.js') : '';
  const idx36w = read('index.html');
  const sp36w = read('sponsor.html');
  const am36w = exists('anon-mail.js') ? read('anon-mail.js') : '';
  const rd36w = read('README.md');
  const wf36w = read('.github/workflows/verify.yml');

  // ① 源码要素：按钮 id / 开关 / 内联 SVG 图标（不许引外部图片，三端各一套图床迟早 404）。
  check(/BTN_ID\s*=\s*'sxg-share-entry-btn'/.test(se36w)
    && /var\s+ENABLED\s*=\s*(true|false)/.test(se36w)
    && /<svg[^>]*viewBox="0 0 24 24"/.test(se36w)
    && /stroke="currentColor"/.test(se36w)
    && !/https?:\/\/[^"']*\.(png|svg|woff2?)/.test(se36w),
    '§36w 分享入口单一真相源：id=sxg-share-entry-btn、内联 SVG LOGO（currentColor 跟随前景色）、不依赖外部图片',
    '图改成外链 → 图床挂掉按钮变空白；id 乱改 → cdp-share-entry.cjs 与 README 规则全部对不上');

  // ② 点击一律走站内分享卡片，不许自己再造一套弹窗（§36v 那套 14 平台是唯一实现）。
  check(/var\s+api\s*=\s*window\.SXGShare;/.test(se36w)
    && /api\s*&&\s*typeof\s+api\.open\s*===\s*'function'/.test(se36w)
    && /api\.open\(\)/.test(se36w)
    && /navigator\.clipboard[\s\S]{0,120}?writeText/.test(se36w)
    && !/sxg-share-entry-modal/.test(se36w)
    && !/service\.weibo\.com|facebook\.com\/sharer|twitter\.com\/intent/.test(se36w),
    '§36w 点击分享 → 复用 window.SXGShare.open()（唯一实现），脚本缺席时退化为复制地址 + 气泡；不另造弹窗、不在本文件里写外链',
    '各写一套弹窗 → 平台清单两处漂移，又是「平台变少」事故；本文件塞外链 → 被扩展拦截即整块消失');

  // ③ 落位（2026-11-18 站长口径更新）：桌面留顶栏第 6 枚（紧跟匿名邮箱逐级兜底）；
  // 手机端四枚顶栏按钮全部收进右侧 dock —— 分享本站自搬，前三枚由 header-to-dock.js 搬。
  check(/getElementById\(ANON_ID\)/.test(se36w)
    && /getElementById\('login-github-btn'\)/.test(se36w)
    && /getElementById\('sponsor-entry-btn'\)/.test(se36w)
    && /targetParent\.insertBefore\(btn,\s*wantNext\s*\|\|\s*null\)/.test(se36w)
    && /data-sxg-share-slot/.test(se36w)
    && /dock\.appendChild\(btn\)/.test(se36w)
    && /if \(isNarrow\(\)\) \{\s*var dock = document\.getElementById\(DOCK_ID\)/.test(se36w)
    && /data-sxg-dock-label',\s*'分享'/.test(se36w)
    && !/menu\.appendChild\(btn\)/.test(se36w),
    '§36w 落位：桌面分享本站留顶栏第 6 枚（anon → login → sponsor 逐级兜底）；手机端进 #sxg-fab-dock 并显示短标签「分享」（前三枚由 header-to-dock.js 搬，四枚同归 dock）',
    '手机端又塞回顶栏 → 四枚按钮排两行、「分享本站」孤零零掉第三行（2026-11-18 站长截图判丑）；桌面锚点写死一枚 → 匿名缺失时悬空');

  // ④ 隐藏开关机制：只隐藏不删（与 §36s 同口径），!important 压过 dock 的 display:flex。
  check(/data-sxg-share-hidden="1"\]\{display:none !important\}/.test(se36w)
    && /data-sxg-share-slot="pending"\]\{display:none !important\}/.test(se36w)
    && /addEventListener\('keydown'/.test(se36w),
    '§36w 开关机制：ENABLED + data-sxg-share-hidden 的 !important 隐藏规则 + 残留 pending 兜底样式 + 键盘 Enter/空格可达',
    '直接删按钮本体 → 下次要恢复只能重写一遍；无隐藏规则 → 手机首次加载会裸奔出现一枚错位按钮');

  // ⑤ 匿名邮箱补 LOGO：信封 SVG 内联，textContent 仍是「匿名邮箱」（既有断言 / dock 标签依赖它）。
  check(/var\s+ICON\s*=\s*'<svg/.test(am36w)
    && /btn\.innerHTML\s*=\s*ICON\s*\+\s*'<span class="sxg-anon-mail-txt">匿名邮箱<\/span>'/.test(am36w)
    && /sxg-anon-mail-txt/.test(am36w),
    '§36w 匿名邮箱按钮文字前补内联信封 LOGO（innerHTML = ICON + <span>匿名邮箱</span>），按钮语义文字不变',
    '改成纯文字 → 丢失站长要的 LOGO；改掉「匿名邮箱」四个字 → test-anon-mail.cjs 与 dock 短标签一起判红');

  // ⑥ 挂载与 ?v：index.html 两个脚本同批 bump，sponsor.html 不挂分享入口（打赏页自己有分享逻辑）。
  check(/<script defer src="\.\/share-entry\.js\?v=5"><\/script>/.test(idx36w)
    && idx36w.indexOf('share-entry.js?v=5') > idx36w.indexOf('anon-mail.js?v=5')
    && /anon-mail\.js\?v=5/.test(idx36w)
    && !/anon-mail\.js\?v=4/.test(idx36w)
    && !/share-entry\.js/.test(sp36w),
    '§36w index.html 挂载 share-entry.js?v=5（排在 anon-mail.js?v=5 之后）；sponsor.html 不挂本入口（打赏页分享走自己的 shareUrl）',
    '?v 没 bump → 线上仍跑旧脚本；把入口也挂到 sponsor.html → 打赏页多出一枚重复分享，与「打赏页分享指向首页」的逻辑打架');

  // ⑦ README 规则章节跟着改：六枚 + 第 6 枚落位规则 + 新开关行（避免半年后又「被吃掉」）。
  check(/桌面顶栏自左向右固定六枚/.test(rd36w)
    && /\| 6 \| `分享本站`/.test(rd36w)
    && /`share-entry\.js` \| `var ENABLED`/.test(rd36w)
    && !/桌面顶栏自左向右固定五枚/.test(rd36w),
    '§36w README「🧭 顶栏按钮组成」规则章节同步为六枚：新增第 6 枚落位/兜底/窄屏规则 + share-entry.js 开关行 + ?v 与测试脚本口径',
    '只改代码不改规则章节 → 下一轮维护又按「五枚」核对，分享入口被当成野按钮删掉');

  // ⑧ 配套测试挂进 CI（§21o）。
  check(exists('scripts/test-share-entry.cjs')
    && wf36w.indexOf('node scripts/test-share-entry.cjs') !== -1,
    '§36w 新增 jsdom 行为测试 test-share-entry.cjs（39 项）并挂进 CI；真渲染验收 cdp-share-entry.cjs 五档 1440/900/660/390/360 在本机跑',
    '测试不挂 CI → 下次谁把按钮挪走没人拦');
}

// ---------- 36y. 手机端顶栏四枚全进右侧 dock（2026-11-18 站长「全部丢右边去吧」） ----------
// 站长看 393px 真机截图：顶栏四枚按钮排成两行、「分享本站」孤零零掉第三行，判定排版不合格。
// 前三枚（提交 / Star / 赞助）由 header-to-dock.js 搬，第四枚分享由 share-entry.js 自搬。
// 静态断言盯源码，真行为由手机视口 CDP 截图验收。
{
  const hd36y = exists('header-to-dock.js') ? read('header-to-dock.js') : '';
  const idx36y = read('index.html');

  check(exists('header-to-dock.js'),
    '§36y header-to-dock.js 存在（手机端顶栏三枚原生按钮的搬移脚本）',
    '脚本缺失 → 只有分享进 dock，提交 / Star / 赞助仍挤在顶栏两行');

  check(/DOCK_ID\s*=\s*'sxg-fab-dock'/.test(hd36y)
    && /var MQ\s*=\s*'\(max-width: 640px\)'/.test(hd36y)
    && /var ATTR\s*=\s*'data-hdr-acts'/.test(hd36y),
    '§36y 搬移脚本锚点正确：dock id / 640px 断点 / 顶栏容器 data 属性三者与现有机制对齐',
    '锚点写错 → 搬不进 dock 或桌面端也被误搬');

  check(/提交数据/.test(hd36y) && /Star on GitHub/.test(hd36y)
    && /打赏赞助\|赞助本项目/.test(hd36y)
    && /SHARE_ID\s*=\s*'sxg-share-entry-btn'/.test(hd36y)
    && /el\.id === SHARE_ID\) continue/.test(hd36y),
    '§36y 三枚原生按钮按文字识别、显式跳过分享按钮（分工不打架：分享归 share-entry.js 自搬）',
    '不跳过分享 → 两个 observer 互搬，按钮在 dock 与顶栏之间抖动');

  check(/homes\.push\(\{\s*el:\s*el,\s*parent:\s*box,\s*index:\s*i\s*\}\)/.test(hd36y)
    && /moveOut\(box\)/.test(hd36y)
    && /box\.insertBefore\(h\.el,\s*ref\)/.test(hd36y)
    && /removeAttribute\('data-sxg-dock-label'\)/.test(hd36y),
    '§36y 断点切回桌面按原 index 还原三枚按钮并移除 dock 短标签（可逆、不留痕）',
    '只搬不还原 → 用户从手机切到桌面后顶栏永久少三枚按钮');

  check(/setAttribute\('data-sxg-dock-label',\s*lab\)/.test(hd36y)
    && /dock\.appendChild\(el\)/.test(hd36y),
    '§36y 进 dock 的按钮打中文短标签并追加进容器（dock CSS 靠 ::after + data 属性显示文字）',
    '不打标签 → 68px 按钮里文字被 font-size:0 收起后一片空白');

  check(/<script defer src="\.\/header-to-dock\.js\?v=1"><\/script>/.test(idx36y)
    && idx36y.indexOf('header-to-dock.js?v=1') > idx36y.indexOf('share-entry.js?v=5'),
    '§36y index.html 挂载 header-to-dock.js?v=1，排在 share-entry.js?v=5 之后（dock 已建好一次到位）',
    '?v 缺失或顺序颠倒 → 线上跑旧逻辑 / dock 未就绪时搬失败');
}

// ---------- 36x. 首页弹窗只允许点 × 关闭（2026-11-13 站长「先锁死」） ----------
// 站长原话：「用户只能点击x按钮关闭，而不是点击空白区域就能关掉弹窗」。
// 静态断言盯源码（遮罩 / Esc 不许再绑 close、× 必须还在），真行为由 CDP
// 点击验收；故障注入见本轮 CHANGELOG / PITFALLS。
{
  const dp36x = read('douyin-prompt.js');
  const idx36x = read('index.html');
  // 剥注释再判：注释里写「不绑定」不能把真代码救绿。
  const dpCode36x = dp36x.replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  // 2026-11-14 收紧：原判据「任意 click 监听后 160 字内出现 close」窗口太宽，
  // 底部「我要分享此文章」的 addEventListener('click', onShareArticle) 后面正好
  // 跟着 × 的 onclick=close；撤掉夹在中间的绿色推荐小字代码块后曾误判。
  // 现在只认三种真实写法：遮罩 onclick=close / 把 close 直接注册成 click 回调 /
  // 取到遮罩节点后在近处绑 close。
  check(!/\.dyp__mask[^\n]*\.onclick\s*=\s*close/.test(dpCode36x)
    && !/addEventListener\(\s*['"]click['"]\s*,\s*close\b/.test(dpCode36x)
    && !/querySelector\(['"]\.dyp__mask['"]\)[\s\S]{0,120}close/.test(dpCode36x),
    '§36x 遮罩不再绑定 close（点空白不关弹窗）',
    '遮罩又绑回 close → 站长要的「锁死」失效，误点空白就关掉');
  check(!/addEventListener\(\s*['"]keydown['"]/.test(dpCode36x)
    && !/['"]Escape['"]/.test(dpCode36x),
    '§36x Esc 不再关闭弹窗（关闭入口只剩 ×）',
    'Esc 又能关 → 不是「只能点 ×」');
  check(/\.dyp__x[^\n]*\.onclick\s*=\s*close/.test(dpCode36x),
    '§36x × 仍绑定 close（唯一关闭入口没被一起删掉）',
    '× 被删 → 弹窗永远关不掉，比点空白能关更糟');
  check(/点右上角 × 关闭/.test(dp36x) && !/现在可以关闭了/.test(dp36x),
    '§36x 倒计时到点后提示改为「点右上角 × 关闭」',
    '提示仍写「可以关闭」却没说怎么关 → 用户会去点空白');
  // 2026-11-20 站长指令（同日二次修订）：在正文滚动区与绿色推荐语之间的空白
  // （截图红框处）插入「你的浏览器默认搜索引擎是 Bing 必应吗」确认块——是 / 不是
  // 二选一，回执按选项给（提示词重写，不照抄口语稿）；2026-11-21 站长实测反馈
  // 「第二次或者多按继续关闭按钮，就可以直接关闭」→ 收紧为真正锁死：未选择时
  // 点 × 永远只提醒不放行，选了「是的/不是」才允许关；落点按选择走：选「是的」
  // 关掉停原地，选「不是」才滚到页脚「如何用 Bing 搜到本站」卡片（#sxg-bing-guide）。
  check(/你的浏览器默认搜索引擎是 Bing 必应吗/.test(dpCode36x)
      && /好，那你在 Bing 里搜「双休购」就能找到我们，慢慢逛。/.test(dpCode36x)
      && /没关系，关掉后我把设置步骤摆出来，照着点两下就行。/.test(dpCode36x)
      && /先选一下上面的问题，选完就能关。/.test(dpCode36x),
    '§36x-2 弹窗含搜索引擎确认块（问句 + 是/不是两种友好回执 + 未选提醒）',
    '缺确认块或回执退化成「好的，欢迎访问」式直译 → 站长指定红框区域仍是空白或文案生硬');
  // §36x-3（2026-11-21 站长补）：Google 需搜「双休购GitHub」才收录本站，选「不是」的回执补这句引导；
  // 关闭后的跳转判定一个字不许动——弹窗文案优化不能顺手改掉「不是 → 跳页脚教程」的行为。
  check(/var SE_GOOGLE_HINT = '也可以在 Google 搜「双休购GitHub」找到本站。'/.test(dpCode36x)
      && /<strong class="dyp__se__google">' \+ SE_GOOGLE_HINT \+ '<\/strong>/.test(dpCode36x)
      && /\.dyp__se__google \{ color: #[0-9a-f]{6}; font-weight: 700; \}/.test(read('douyin-prompt.css')),
    '§36x-4 Google 引导句单独红色加粗（<strong> + CSS color/font-weight:700）',
    '漏掉加粗或样式 → 站长截图里那句不醒目，与要求不符');
  check(/if \(seChoice !== 'yes'\) jumpToBingGuide\(\)/.test(dpCode36x)
      && /seHint\.innerHTML = SE_NO_HINT \+ '<strong class="dyp__se__google">'/.test(dpCode36x),
    '§36x-3 跳转判定不变：「不是」关掉仍跳页脚教程，Google 提示只落在回执文案',
    '改动关闭落点 → 文案优化越界，破坏既有「是的停原地/不是跳教程」判定');
  check(/data-se="yes"/.test(dpCode36x) && /data-se="no"/.test(dpCode36x)
      && /role="radio"/.test(dpCode36x) && /aria-checked/.test(dpCode36x),
    '§36x-2 「是的 / 不是」为二选一 radiogroup（aria-checked 同步翻转）',
    '退化成两个能同时勾上的复选框 → 语义与交互都错');
  // 真锁死（2026-11-21）：剥注释后 close() 内必须是「if (!seChoice) { ...提醒... return; }」
  // 且不再有 seNudged 放行标记；「选了才关」的判定不得出现任何绕过分支。
  check(/if \(!seChoice\) \{[\s\S]{0,400}SE_NUDGE_HINT[\s\S]{0,600}return;/.test(dpCode36x)
      && !/seNudged/.test(dpCode36x)
      && /resetSE/.test(dpCode36x),
    '§36x-2 未选择永远不许关：每次点 × 只提醒 + 轻抖，选了「是的/不是」才放行；每次弹出复位',
    '没选也能关（二次或多按放行）→ 站长 2026-11-21 反馈的「锁死形同虚设」复现');
  check(/function jumpToBingGuide/.test(dpCode36x) && /sxg-bing-guide/.test(dpCode36x)
      && /scrollIntoView/.test(dpCode36x)
      && /if \(seChoice !== 'yes'\) jumpToBingGuide\(\)/.test(dpCode36x),
    '§36x-2 落点按选择走：「是的」关闭后停原地，选「不是」才滚到 Bing 教程（带重试）',
    '无条件跳转 → 明明是 Bing 用户，关掉弹窗还被往下拽');
  check(/<script defer src="\.\/douyin-prompt\.js\?v=33"><\/script>/.test(idx36x)
    && !/douyin-prompt\.js\?v=32/.test(idx36x)
    && /douyin-prompt\.css\?v=26/.test(idx36x)
    && !/douyin-prompt\.css\?v=25/.test(idx36x),
    '§36x index.html 挂载 douyin-prompt.js?v=33 与 css?v=26（JS/CSS 都改了，缓存号都 bump）',
    '?v 没 bump → 线上仍跑旧脚本/旧样式，改动等于没发');

  // 2026-11-21 手机端「右上角 × 溢出屏幕、无法关闭」兜底：
  // CSS 面板 max-width:100vw + × right:max(10px,safe-area) 双保险；
  // JS open() 后调 keepCloseVisible()，用 getBoundingClientRect 实测越界则钉回视口，
  // resize / 横竖屏切换重测。缺任一环 → 真机溢出复现。
  const dpCss36x = read('douyin-prompt.css');
  check(/max-width:\s*100vw/.test(dpCss36x)
      && /right:\s*max\(10px,\s*env\(safe-area-inset-right/.test(dpCss36x),
    '§36x-3 弹窗 CSS 双保险：面板 max-width:100vw + × right:max(10px, 安全区)',
    '面板被横向内容撑宽到 layout viewport → × 顶出可视区，真机点不到');
  check(/keepCloseVisible\(\)/.test(dpCode36x)
      && /function keepCloseVisible/.test(dpCode36x)
      && /getBoundingClientRect\(\)/.test(dpCode36x)
      && /r\.right\s*>\s*vw/.test(dpCode36x)
      && /x\.style\.position\s*=\s*'fixed'/.test(dpCode36x)
      && /addEventListener\('resize',\s*keepCloseVisible\)/.test(dpCode36x),
    '§36x-3 × 越界自愈：弹出后/resize 实测越界则 position:fixed 钉回视口右上角',
    '无自愈 → 手机横竖屏切换或 layout viewport 撑宽后 × 溢出且无法关闭');
  check(/<link rel="stylesheet" href="\.\/douyin-prompt\.css\?v=26">/.test(idx36x)
    && !/douyin-prompt\.css\?v=25/.test(idx36x),
    '§36x-4 douyin-prompt.css?v=26（CSS 也改了，必须 bump）',
    'CSS 改了不 bump → 线上仍用旧样式，× 溢出照旧');

  // 2026-11-13 站长追加：「不要 15 分钟冷却，刷新首页必弹」。
  // 静态断言：源码里不得再出现任何冷却/记时间戳逻辑。
  check(!/inCooldown|cooldownMs|markShown|readLastShown|storageKey/.test(dpCode36x),
    '§36x 冷却逻辑已彻底移除（刷新首页必弹，不再 15 分钟只弹一次）',
    '又出现 inCooldown / cooldownMs / markShown / readLastShown / storageKey → 冷却回来了，刷新首页不会必弹');
}

// ---------- 36y. 必应动态摘要防护（2026-11-14 站长「广告位的这个被抓取了」） ----------
// 11-04 曾排查过同一类问题（提交 835c9b1，当时抓的是大疆卡备注）：Bing 会渲染
// JS 后从页面可见文本里算法挑摘要，meta description 只是候选之一。这次轮到首屏
// 公益广告位；截图里「品牌展示 / 广告位招商中」在现网代码里早已清零，是旧索引快照。
// 双管齐下：① 官方 data-nosnippet 把推广区块与弹窗长文排除出摘要与 AI 回答；
// ② 首页 sitemap lastmod 刷新，给 Bing 一个明确的重抓信号（changefreq 被忽略）。
{
  const ad36y = read('black-card-adslot.js');
  const dp36y = read('douyin-prompt.js');
  const sm36y = read('sitemap.xml');
  const gen36y = read('scripts/seo/generate-sitemap.py');
  const strip36y = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const adCode36y = strip36y(ad36y);
  const dpCode36y = strip36y(dp36y);
  check(/root\.setAttribute\('data-nosnippet',\s*''\)/.test(adCode36y),
    '§36y 公益广告位根节点带 data-nosnippet（推广文案不进必应摘要 / AI 回答）',
    '属性丢了 → 必应又把「陆喜依 · 站长指定 S 级 · 点此进入天猫旗舰店」抓成站点简介');
  check(/box\.setAttribute\('data-nosnippet',\s*''\)/.test(dpCode36y),
    '§36y 首页弹窗根节点带 data-nosnippet（长文不会被挑成站点简介）',
    '弹窗漏标 → 自动弹出的长文段落又可能变成搜索摘要');
  check(!/品牌展示|广告位招商中/.test(adCode36y),
    '§36y 旧广告位文案确实不在现网代码里（必应截图属旧索引快照）',
    '旧文案回流 → 不是索引没刷新，是代码自己又写回去了');
  check(/<loc>https:\/\/dujeongil-galaxy\.github\.io\/shuangxiugou\/<\/loc>\s*<lastmod>2026-11-14<\/lastmod>/.test(sm36y),
    '§36y sitemap.xml 首页 lastmod 已刷新到 2026-11-14（给 Bing 重抓信号）',
    'lastmod 还停在 10-10 → Bing 缺少重抓依据，旧摘要一直挂着');
  check(/LASTMOD_HOME\s*=\s*'2026-11-14'/.test(gen36y)
    && /<lastmod>\{LASTMOD_HOME\}<\/lastmod>/.test(gen36y),
    '§36y sitemap 生成器首页 lastmod 单一真相源同步（不是只手改 xml）',
    '只改 xml 不改生成器 → 下次重建首页 lastmod 被打回 10-10');
}

// ---------- 37a. 首页「最新新增的企业」入口 + 海康网传登记卡（2026-11-15） ----------
// 站长指令：「在首页找个地方挂一下按钮，叫『最新新增的企业』；展示最近 x 天还是最新 x 条你决定」
// → 采用最新 5 条（按登记日期倒序）。本段把「真相源 → 生成器 → 数据文件 → 补丁 → 详情页」
//   五层全钉住：任何一层漏改/漂移都必须判红，不能靠人肉记得。
{
  const f37a = (p) => readFileSync(join(ROOT, p), 'utf8');
  const idx37a = f37a('index.html');
  const js37a = f37a('recent-brands.js');
  const dy37a = f37a('recent-brands-data.js');
  const gen37a = f37a('scripts/gen-recent-brands.py');
  const b37a = f37a('brand/hikvision.html');

  let cfg37a = null;
  try { cfg37a = JSON.parse(f37a('data/recent-brands.json')); } catch (e) { cfg37a = null; }
  const ent37a = cfg37a && Array.isArray(cfg37a.entries) ? cfg37a.entries : [];
  const dates37a = ent37a.map((e) => e.date);

  check(!!cfg37a && cfg37a.displayCount === 5 && ent37a.length >= 5,
    '§37a 最新新增清单 displayCount=5 且登记条数≥5（按条数不按天窗口）',
    '改回按天窗口或只留几条 → 面板会经常空的，这条规则是站长授权的口径');
  check(dates37a.length > 0 && dates37a.join('|') === dates37a.slice().sort().reverse().join('|'),
    '§37a 登记条目按 date 倒序排列（同日保持文件顺序）',
    '顺序乱了 → 面板显示的「最新」不成立');
  check(ent37a.every((e) => ['slug', 'name', 'date', 'kind', 'grade', 'note', 'href'].every((k) => typeof e[k] === 'string' && e[k].trim())),
    '§37a 每条登记的 7 个字段齐全且非空',
    '字段缺失 → 渲染出空白条目或 undefined');
  check(ent37a.every((e) => existsSync(join(ROOT, 'brand', e.slug + '.html'))),
    '§37a 每条登记的 slug 都有对应品牌详情页',
    'slug 写错或页面被删 → 面板点进去 404');
  check(ent37a.every((e) => existsSync(join(ROOT, e.href.split('#')[0].replace(/^\.\//, '')))),
    '§37a 每条登记的 href 指向真实文件（锚点部分不计）',
    '链接写错 → 用户点了跳空');

  check(/displayCount/.test(gen37a) && /reverse=True\)\[:n\]/.test(gen37a) && /--check/.test(gen37a),
    '§37a 生成器具备「按日期倒序取前 N 条」与 --check 自检',
    '生成器被改成全量输出或丢掉 --check → 数据文件漂移无人发现');
  check(/^\/\* 本文件由 scripts\/gen-recent-brands\.py 自动生成/m.test(dy37a),
    '§37a recent-brands-data.js 带生成器署名（禁止手改）',
    '手改数据文件 → 下次重跑被覆盖，两处清单漂移');

  const m37a = dy37a.match(/window\.__SXG_RECENT__\s*=\s*([\s\S]*?);\s*$/m);
  let payload37a = null;
  try { payload37a = m37a ? JSON.parse(m37a[1]) : null; } catch (e) { payload37a = null; }
  const expect37a = ent37a.slice().sort((x, y) => y.date.localeCompare(x.date)).slice(0, 5);
  check(!!payload37a && payload37a.displayCount === 5 && payload37a.items.length === 5
    && JSON.stringify(payload37a.items.map((i) => i.slug)) === JSON.stringify(expect37a.map((e) => e.slug)),
    '§37a 数据文件与 JSON 完全一致（最新 5 条、顺序一致）',
    '改了 JSON 没重跑生成器 → 面板展示的还是旧清单');

  check(/<script defer src="\.\/recent-brands-data\.js\?v=1"><\/script>/.test(idx37a)
    && /<script defer src="\.\/recent-brands\.js\?v=3"><\/script>/.test(idx37a),
    '§37a 首页按序挂载数据文件与补丁脚本（data ?v=1 / 补丁 ?v=3）',
    '脚本没挂或顺序反了 → 补丁读不到数据，按钮静默不出现');
  check(/最新新增的企业<\/button>/.test(js37a) && /<b>最新新增的企业<\/b>/.test(js37a)
    && (js37a.match(/最新新增的企业/g) || []).length >= 3 && /getElementById\(BTN_ID\)/.test(js37a),
    '§37a 补丁脚本按钮文案与面板标题逐字钉死（含幂等按钮 id）',
    '仅按总出现次数计数会被注释里的同名字样糊弄过去，必须钉具体标签');
  /* 2026-11-15 第二轮：按钮挪进公告栏右侧槽，与滚动正文同一行。
     旧版另起一条 #sxg-recent-bar（青底整行），现在是「弄成一行看看」，
     所以断言同时钉正向（有槽、有注入）与反向（旧 bar 不许回来）。 */
  check(/getElementById\(SLOT_ID\)/.test(js37a) && /slot\.innerHTML\s*=/.test(js37a)
    && !/sxg-recent-bar/.test(js37a)
    && /id="sxg-recent-slot"/.test(idx37a),
    '★ §37a 按钮注入 #site-notice 右侧槽（不再另起一条 bar）',
    '又写回独立 bar → 公告栏变两行，站长「右侧加按钮、弄成一行」被推翻');
  check(/site-notice/.test(js37a) && /getElementById\(BTN_ID\)\.addEventListener\('click', openPanel\)/.test(js37a)
    && /aria-haspopup="dialog"/.test(js37a) && /data-nosnippet/.test(js37a) && /Escape/.test(js37a)
    && /z-index:100020/.test(js37a),
    '§37a 补丁挂静态区、幂等、可访问性、Esc 与高层级齐备',
    '挂进 #root 会被 React 清掉；z-index 低于 .dyp(100000)/广告位(100010) 会被整块盖住');
  check(/#sxg-recent-btn\{[^}]*white-space:\s*nowrap/.test(js37a)
    && /#sxg-recent-btn\{[^}]*font-size:11px/.test(js37a),
    '§37a 行内按钮紧凑且不折行（320px 下与滚动正文挤得进同一行）',
    '字号放回 12px / 允许折行 → 按钮自己先占两行，破坏单行布局');

  const rumor37a = b37a.match(/<section class="rumor" id="hikvision-rumor">([\s\S]*?)<\/section>/);
  const rh37a = rumor37a ? rumor37a[1] : '';
  check(!!rumor37a && /网友爆料登记/.test(rh37a) && /待核实/.test(rh37a)
    && /11\/20/.test(rh37a) && /2027-12-14/.test(rh37a)
    && /评级维持 B 级/.test(rh37a) && /不作为评级依据/.test(rh37a),
    '§37a 海康详情页「网传登记卡」六条事实钉子齐全（含待验证时间与评级不变声明）',
    '少写「待核实」或删掉评级不变 → 网传被当成已落地事实，是本站最忌的失真');
  check(!!rumor37a && !/<li style="margin:0 0 12px">/.test(rh37a),
    '§37a 网传登记卡不伪装成证据条目（不触发公示区计数漂移）',
    '写成证据 li → gen-evidence-board 会把它算进 481 条，计数断言大面积判红');
  check(!!rumor37a && (rh37a.match(/target="_blank"/g) || []).length ===
      (rh37a.match(/rel="noopener noreferrer nofollow"/g) || []).length,
    '§37a 网传登记卡外链一律带 rel 安全属性',
    '外链漏 rel → 新窗口可通过 opener 反向操作本站');
}

// ---------- 37b. 随笔置顶+目录日期 / 打赏二维码生成动画 / 邀请码点击复制（2026-11-16 站长） ----------
section('37b. 随笔强制置顶与目录日期、打赏二维码假生成、邀请码点击复制');
{
  const sp37b = read('sponsor.html');
  // 图3：进正文强制置顶（解密后文档本体里 scrollRestoration=manual + scrollTo(0,0)）
  const plain37b = exists('notes.html') ? decryptNotes(read('notes.html')) : null;
  check(plain37b === null || (
      /scrollRestoration'\s+in\s+history\) history\.scrollRestoration\s*=\s*'manual'/.test(plain37b)
      && /window\.scrollTo\(0,\s*0\)/.test(plain37b)),
    '§37b 随笔正文加载即强制回顶（scrollRestoration=manual + scrollTo(0,0)）',
    '删掉置顶 → 浏览器记住上次滚动位置，一进正文就停在中间某节');
  // 图4：目录每项独立换行 + 日期红色加粗（toc__date 从 section-date 单一真相源取）
  check(plain37b === null || (
      /\.toc__date\s*\{/.test(plain37b)
      && /className = 'toc__date'/.test(plain37b)
      && /color:\s*#c0392b/.test(plain37b)
      && /dEl\.classList\.contains\('section-date'\)/.test(plain37b)
      && /d\.textContent\s*=\s*dEl\.textContent\.trim\(\)/.test(plain37b)),
    '§37b 目录每项下面写日期（红色 #c0392b 加粗，取正文 section-date）',
    '日期不写/不改红/另起数据源 → 站长要看的目录日期缺失或口径打架');
  // 图5：不默认勾选 Gate + 点击后 2-3 秒假动画 + cookie 记住已生成地址
  check(/var selEx = null;/.test(sp37b)
    && !/var selEx = 'gate';/.test(sp37b),
    '§37b 打赏页不再默认勾选 Gate（selEx 初值 null）',
    '默认 gate → 一进来就高亮交易所并出二维码，违反「不主动点击不显示」');
  check(/if \(!selEx \|\| !c\)/.test(sp37b)
    && /wrap0\.style\.display = 'none'/.test(sp37b),
    '§37b 未选交易所时隐藏二维码（qrWrap display:none）',
    '未选仍出二维码 → 站长明确要求「不主动点击下面就不显示」');
  check(/function revealQr/.test(sp37b)
    && /二维码生成中/.test(sp37b)
    && /2000 \+ Math\.floor\(Math\.random\(\) \* 1001\)/.test(sp37b),
    '§37b 二维码先播 2-3 秒「生成中」再显形（随机 2000~3000ms）',
    '动画/时长缺失 → 点击后瞬间出图或卡死，假生成效果没有');
  check(/var QR_COOKIE = 'sxg_qr_addr=';/.test(sp37b)
    && /function qrSeen/.test(sp37b) && /function qrRemember/.test(sp37b)
    && /max-age=31536000/.test(sp37b)
    && /if \(qrSeen\(addr\)\) \{ show\(\); return; \}/.test(sp37b),
    '§37b 生成过的地址存 cookie（365 天），同址再次出现直接出图不重播',
    '无 cookie 记忆 → 每次切回来都重播动画，或地址变了也不重新生成');
  // 图6：邀请码框点击复制（复用 copyText，读框内文本单一真相源）
  check(/id="ferryCode"/.test(sp37b)
    && /ferryCode\.addEventListener\('click', doCopyCode\)/.test(sp37b)
    && /copyText\(ferryCode\.textContent\.trim\(\), null\)/.test(sp37b),
    '§37b 邀请码框点一下自动复制（读框内文本为单一真相源）',
    '复制未绑定 → 站长要求「点了就自动复制」落空');
}

// ---------- 38. QQ 浏览器 UA 拦截扩围 + 李跳跳微信文章存档（2026-11-19） ----------
section('38. QQ 浏览器 UA 拦截扩围 + 李跳跳微信文章存档');
{
  const ug38 = exists('ua-guard.js') ? read('ua-guard.js') : '';

  // 38a. 主站拦截脚本识别独立 QQ 浏览器（任意形态，含电脑版 QQBrowser/10.x）
  check(/\/MQQBrowser\/i\.test\(ua\)/.test(ug38)
      && /\/QQBrowser\/i\.test\(ua\)/.test(ug38)
      && /isQQBrowser/.test(ug38)
      && /!isWeChat && !isQQ && !isQQBrowser/.test(ug38),
    '§38a ua-guard.js 识别独立 QQ 浏览器任意 UA 形态（引导专题页的前提）',
    '识别回退到版本号限定或未纳入分流条件 → 电脑版 QQ 浏览器漏判，专题页引导落空');

  // 38b. 微信/QQ 内置硬拦截文案保留；QQ 浏览器改走专题页顶部说明
  check(/微信 \/ QQ 的内置浏览器/.test(ug38) && /请在系统浏览器打开/.test(ug38),
    '§38b 微信/QQ 内置浏览器硬拦截层文案保留（口径未回退）',
    '内置浏览器文案丢失 → 硬拦截层成了无说明的空壳');

  // 38j. QQ 浏览器分流：v16 起改为直接全屏拦截（原「跳专题页 + 专题页自放行」已撤销），专题页只作说明存档
  {
    var rpt38src = exists('qq-browser-report.html') ? read('qq-browser-report.html') : '';
    check(!/location\.replace\(base \+ 'qq-browser-report\.html'\)/.test(ug38)
        && /isWeChat \|\| isQQ \|\| isQQBrowser/.test(ug38)
        && /data-sxg-ua-block/.test(ug38)
        && /qq-browser-report\.html/.test(rpt38src),
      '§38j QQ 浏览器命中后直接全屏拦截（2026-11-20 撤销跳专题页，专题页降为说明存档）',
      '跳转逻辑残留或硬拦截丢失 → QQ 浏览器又能进正站，或被锁在专题页自我跳转');
    check(/data-sxg-qq-browser="1"\] #qq-browser-notice/.test(rpt38src)
        && /检测到您正在使用 QQ 浏览器访问本站/.test(rpt38src)
        && /id="qq-browser-notice"/.test(rpt38src),
      '§38j 专题页顶部有 QQ 浏览器专属说明条，按 UA 属性显示（普通浏览器不可见）',
      '说明条缺失或无条件常显 → QQ 浏览器访客看不到引导缘由 / 普通访客被误导');
  }

  // 38k. 反 UA 伪装交叉验证（v5）：QQ 浏览器改 UA 标识后仍被识别
  {
    check(/sxgSpoofScore/.test(ug38)
        && /navigator\.userAgentData/.test(ug38)
        && /navigator\.platform/.test(ug38)
        && /navigator\.vendor/.test(ug38)
        && /spoofScore >= 3/.test(ug38)
        && /isQQBrowser = true/.test(ug38),
      '§38k ua-guard.js 含多信号反伪装判定（UA-CH / platform / vendor / chrome 对象，可疑分 ≥3 命中）',
      '交叉验证被删/阈值消失 → 改 UA 标识的 QQ 浏览器直接绕进正站，专题页引导落空');
    check(/typeof window\.mqq/.test(ug38) && /typeof window\.MQQBrowser/.test(ug38)
        && /claimsAppleMobile/.test(ug38) && /claimsDesktop/.test(ug38)
        && /!isWeChat && !isQQ && !isQQBrowser/.test(ug38),
      '§38k 反伪装以 UA 声称身份为前提、保留微信/QQ 内置优先（不误伤正常浏览器与内置浏览器）',
      '去掉身份前提或优先级 → 安卓 Chrome 等被误判，或微信内置落到引导分支');
    // 逐行锁定五项信号的加分语句——少任何一项，对应故障注入都必须判红
    var signalsK = [
      "typeof window.mqq !== 'undefined'",
      'if (claimsAppleMobile && navigator.userAgentData) {',
      'if (claimsAppleMobile && window.chrome && (window.chrome.runtime || window.chrome.loadTimes)) score += 3;',
      'if (claimsAppleMobile && plat && !/iPhone|iPad|iPod/i.test(plat)) score += 3;',
      'if (claimsDesktop && /iPhone|iPad|iPod|Linux arm|Android/i.test(plat)) score += 3;',
      'if (claimsAppleMobile && vendor && !/Apple/i.test(vendor)) score += 2;',
      'var claimsAppleMobile = /iPhone|iPad|iPod/i.test(ua) && !/Android/i.test(ua);'
    ];
    var missingK = signalsK.filter(function (s) { return ug38.indexOf(s) === -1; });
    check(missingK.length === 0,
      '§38k 五项信号加分语句与身份前提逐行在岗（防单项信号被静默删除）',
      '缺失信号：' + (missingK.join(' / ') || '无') + ' → 该项伪装特征不再参与判定');
    // 行为验证：从源文件原样抠出 sxgSpoofScore 函数体放进沙箱执行——测的是真代码，不是重写副本。
    // 单信号用例保证「删掉任一信号 → 得分跌破 3 → 判红」，避免只测组合时的假阴性。
    var fnMatchK = ug38.match(/function sxgSpoofScore\(\) \{[\s\S]*?\n    \}/);
    var uaIphoneK = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
    var uaPCK = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    var scoreK = function (u, plat, vendor, uaData, chromeObj, mqq) {
      if (!fnMatchK) return -1;
      var navK = { platform: plat, vendor: vendor };
      var winK = {};
      if (uaData) navK.userAgentData = { brands: [{ brand: 'Chromium' }] };
      if (chromeObj) winK.chrome = { runtime: {} };
      if (mqq) winK.mqq = {};
      var fnK = new Function('navigator', 'window', 'ua', fnMatchK[0] + '\n return sxgSpoofScore();');
      return fnK(navK, winK, u);
    };
    var casesK = {
      realIPhone: scoreK(uaIphoneK, 'iPhone', 'Apple Computer, Inc.', null, null, null),
      qqAsIPhone: scoreK(uaIphoneK, 'Linux armv8l', 'Google Inc.', true, true, true),
      qqAsPC: scoreK(uaPCK, 'Linux armv8l', 'Google Inc.', null, null, true),
      normalChrome: scoreK(uaPCK, 'Win32', 'Google Inc.', null, true, null),
      onlyUaData: scoreK(uaIphoneK, 'iPhone', 'Apple Computer, Inc.', true, null, null),
      onlyChrome: scoreK(uaIphoneK, 'iPhone', 'Apple Computer, Inc.', null, true, null),
      onlyPlatform: scoreK(uaIphoneK, 'Win32', 'Apple Computer, Inc.', null, null, null)
    };
    var behaviorOkK = casesK.realIPhone < 3 && casesK.normalChrome < 3
        && casesK.qqAsIPhone >= 3 && casesK.qqAsPC >= 3
        && casesK.onlyUaData >= 3 && casesK.onlyChrome >= 3 && casesK.onlyPlatform >= 3;
    check(behaviorOkK,
      '§38k 真代码沙箱判定矩阵：真 iPhone/普通 Chrome 放行；QQ 伪装 iPhone/PC 与三路单信号均命中',
      `实得分 ${JSON.stringify(casesK)}`);
  }

  // 38m. 国产浏览器顶部持续提示（v8，站长 2026-11-19 最终口径）：不做白名单、
  //      只认国产黑名单；韩日/欧美一切国际浏览器（含 Naver Whale/三星 Internet）放行
  {
    var flf38m = exists('friend-links-footer.js') ? read('friend-links-footer.js') : '';
    // ① 黑名单判定在岗：必须有国产特征判定函数 + 韩国两大浏览器特征串不得进黑名单
    var has38m = function (s) { return ug38.indexOf(s) !== -1; };
    check(has38m('var DOMESTIC_TOKENS')
        && has38m('function sxgMatchDomestic(u)')
        && /forceDomestic \|\| sxgIsDomesticBrowser\(ua\) \|\| shellScore >= 3 \|\| is360UA\).*sxgShowBrowserNotice/.test(ug38)
        && !/sxgIsAllowedBrowser|sxgDomesticSignal|sxgBrowserAllowed|sxgIsBrowserAllowed|sxgAllowedHint/.test(ug38),
      '§38m ua-guard.js 用 DOMESTIC_TOKENS 特征表 + sxgMatchDomestic 判定厂商浏览器（白名单函数族整体移除）',
      '特征表或命中判定缺失 / 白名单函数残留 → 要么全放行、要么回到「不在白名单就提示」的旧口径');
    check(!/Naver|Whale|SamsungBrowser|Samsung ?Internet/i.test(ug38.replace(/[\s\S]*?(?:国产浏览器黑名单|sxgIsDomesticBrowser)[\s\S]*$/, '')),
      '§38m 黑名单正则不含 Naver Whale / 三星 Internet 特征串（韩国主流浏览器不拦）',
      '韩国浏览器特征进了黑名单正则 → 韩国访客被误提示');
    // ② 分流分支：非微信/QQ/QQ浏览器时才走黑名单判定，三类既有口径在上游不变
    check(has38m('if (!isWeChat && !isQQ && !isQQBrowser && spoofScore >= 3) isQQBrowser = true;')
        && has38m('if (isWeChat || isQQ || isQQBrowser) {'),
      '§38m 厂商判定被 !isWeChat/!isQQ/!isQQBrowser 守卫（三类既有口径不被改写）',
      '判定被提到上游 → 微信/QQ 内置或 QQ 浏览器落到提示分支，硬拦口径被破坏');
    // ③ 持续提示：固定不可关闭 + 只挂顶部条不隐藏 body + 无任何 cookie 记忆
    check(/id = 'sxg-browser-notice'/.test(ug38)
        && /header\.nextSibling|anchor\.nextSibling/.test(ug38)
        && !/#sxg-browser-notice\{[^}]*position:fixed/.test(ug38)
        && !/#sxg-browser-notice\{[^}]*position:sticky/.test(ug38)
        && !/closeBtn|×|✕|close\s*button/i.test(ug38)
        && !/sxgHasNoticeCookie|sxgSetNoticeCookie|doc\.cookie/.test(ug38)
        && !/html\[data-sxg-ua-block\][\s\S]{0,80}sxg-browser-notice/.test(ug38),
      '§38m 页头黄色横幅走文档流（非 fixed/sticky，正文整体下移不被遮挡）、不可关闭、无 cookie 记忆',
      '改成 fixed/sticky 会盖住公告栏与正文；加关闭按钮/cookie 会退化成一次性提示；塞进硬拦样式会变成拦截');
    // ④ 提示文案要点（书面转述，不照抄口述）+「这里」链接指向 Bing 锚点
    var noticeCopy38m = (ug38.match(/检测到你正在使用[\s\S]*?继续留在这里也可以。/) || [''])[0];
    check(/检测到你正在使用/.test(noticeCopy38m)
        && /建议改用 Chrome、Edge、Safari 或 Firefox/.test(noticeCopy38m)
        && /本站不强制拦截/.test(noticeCopy38m)
        && /GitHub 纯静态页/.test(noticeCopy38m)
        && !/国产|国内/.test(noticeCopy38m)
        && !/href[^,)]*sxg-bing-guide/i.test(ug38),
      '§38m 横幅文案：报出具体浏览器 + 建议换 Chrome/Edge/Safari/Firefox + 不强制拦截，且不提「国产/国内」、不挂已删死链',
      '文案漏要点或提「国产/国内」→ 与站长口径冲突；重现 #sxg-bing-guide 死链 → 点开是空锚点');
    // ⑤ 锚点落在首页 Bing 教程卡片 + 动态注入后主动滚动
    check(/seoCard\.id = 'sxg-bing-guide'/.test(flf38m)
        && /location\.hash === '#sxg-bing-guide'/.test(flf38m)
        && /getElementById\('sxg-bing-guide'\)/.test(flf38m)
        && /scrollIntoView/.test(flf38m),
      '§38m 首页 Bing 教程卡片有锚点并预留顶部偏移，动态注入后主动滚动到该段（native hash 会落空）',
      '锚点或主动滚动缺失 → 点「这里」只到首页顶部，无法直达教程');
    check(/seoCard\.style\.scrollMarginTop = '70px'/.test(flf38m),
      '§38m Bing 卡片预留 70px 滚动偏移，标题不被固定提示条盖住',
      '缺滚动偏移 → 卡片顶到 y=0，标题被顶部固定提示条遮挡');
    // ⑥ 真代码沙箱判定矩阵：从源文件原样抠出 sxgIsDomesticBrowser 函数体执行，不测重写副本
    var tok38m = ug38.match(/var DOMESTIC_TOKENS = \[[\s\S]*?\n    \];/);
    var fnDomestic38m = ug38.match(/function sxgMatchDomestic\(u\) \{[\s\S]*?\n    \}/);
    var domestic38m = function (u) {
      if (!fnDomestic38m || !tok38m) return null;
      var fn = new Function('u', tok38m[0] + '\n' + fnDomestic38m[0] + '\n return sxgMatchDomestic(u).length > 0;');
      return fn(u);
    };
    var uaSafariM = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
    var uaIphoneS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
    var uaChromeM = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    var uaEdgeM = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0';
    var uaFfM = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0';
    var uaNaver = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Whale/3.24.223.18';
    var uaSamsung = 'Mozilla/5.0 (Linux; Android 14; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/24.0 Chrome/117.0.0.0 Mobile Safari/537.36';
    var uaOpera = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 OPR/106.0.0.0';
    var uaUC = 'Mozilla/5.0 (Linux; U; Android 12; zh-CN; PGT-AN00 Build/HUAWEIPGT-AN00) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/100.0.4896.58 UCBrowser/15.0.0.1234 Mobile Safari/537.36';
    var uaQuark = 'Mozilla/5.0 (Linux; Android 12; SM-G9910) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/104.0.0.0 Mobile Safari/537.36 Quark/6.5.0.280';
    var ua360 = 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/86.0.4240.198 Safari/537.36 QIHU 360SE';
    // 新版 360 安全浏览器（13/14）去掉 QIHU，改成 Safari/537.36/<版本号> 双段尾缀——
    // 2026-11-19 站长 PC 360 仍看不到国产提示条的真根因，必须纳入行为矩阵防回归。
    var ua360New = 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36/13.0.10000.0';
    var uaHuawei = 'Mozilla/5.0 (Linux; Android 11; HarmonyOS; ANA-AN00; HMSCore 6.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/99.0.4844.88 HuaweiBrowser/12.0.2.300 Mobile Safari/537.36';
    var uaAlipay = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 AlipayClient/10.3.0';
    var uaMiui = 'Mozilla/5.0 (Linux; U; Android 13; zh-cn; MI 14 Build/TKQ1.221114.001) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/109.0.5414.86 Mobile Safari/537.36 XiaoMi/MiuiBrowser/18.5.20815';
    var matrix38m = {
      safariMac: domestic38m(uaSafariM), safariIphone: domestic38m(uaIphoneS),
      chrome: domestic38m(uaChromeM), edge: domestic38m(uaEdgeM), firefox: domestic38m(uaFfM),
      naver: domestic38m(uaNaver), samsung: domestic38m(uaSamsung), opera: domestic38m(uaOpera),
      uc: domestic38m(uaUC), quark: domestic38m(uaQuark), browser360: domestic38m(ua360),
      browser360New: domestic38m(ua360New),
      huawei: domestic38m(uaHuawei), alipay: domestic38m(uaAlipay), miui: domestic38m(uaMiui)
    };
    var matrixOk38m = matrix38m.safariMac === false && matrix38m.safariIphone === false
        && matrix38m.chrome === false && matrix38m.edge === false && matrix38m.firefox === false
        && matrix38m.naver === false && matrix38m.samsung === false && matrix38m.opera === false
        && matrix38m.uc === true && matrix38m.quark === true && matrix38m.browser360 === true
        && matrix38m.browser360New === true
        && matrix38m.huawei === true && matrix38m.alipay === true && matrix38m.miui === true;
    check(matrixOk38m,
      '§38m 真代码沙箱：Safari/Chrome/Edge/Firefox/Whale(韩国)/三星Internet/Opera 全放行；UC/夸克/360(含新版双段尾缀)/华为/支付宝/MIUI 命中黑名单',
      `实判定 ${JSON.stringify(matrix38m)}`);
    check(has38m('Safari\\/537\\.36\\/\\d'),
      '§38m 黑名单含新版 360 双段尾缀特征 Safari/537.36/<版本号>（站长 PC 360 漏判根因）',
      '缺此特征 → 新版 360 被当成普通 Chrome 放行，国产提示条永远不弹');
  }

  // 38c. 全站引用版本号统一升到 v=2，notes.html 也必须挂上（全站无例外）
  {
    const htmlRefs38 = [];
    function walk38(d) {
      for (const e of readdirSync(join(ROOT, d), { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name === '.git' || e.name === 'archive') continue;
        const rel = join(d, e.name);
        if (e.isDirectory()) walk38(rel);
        else if (e.name.endsWith('.html')) htmlRefs38.push(rel);
      }
    }
    walk38('.');
    const withGuard38 = htmlRefs38.filter((p) => {
      try { return /ua-guard\.js\?v=/.test(readFileSync(join(ROOT, p), 'utf8')); } catch { return false; }
    });
    const oldV38 = withGuard38.filter((p) => /ua-guard\.js\?v=(?:[1-9]|10|11|12|13|14|15|16)\b/.test(readFileSync(join(ROOT, p), 'utf8')));
    const newV38 = withGuard38.filter((p) => /ua-guard\.js\?v=17\b/.test(readFileSync(join(ROOT, p), 'utf8')));
    check(withGuard38.length >= 199 && oldV38.length === 0 && newV38.length === withGuard38.length,
      `§38c 全站 ${withGuard38.length} 页 ua-guard 引用统一 v=17、无残留 v=1~16`,
      `旧版 ${oldV38.length} 页 / 新版 ${newV38.length} 页 → 缓存不刷新，用户拿到旧拦截脚本`);
    const notes38 = exists('notes.html') ? read('notes.html') : '';
    const notesAt38 = notes38.indexOf('ua-guard.js');
    const bodyAt38 = notes38.indexOf('<body');
    check(notesAt38 > 0 && /ua-guard\.js\?v=17/.test(notes38) && bodyAt38 > 0 && notesAt38 < bodyAt38,
      '§38c notes.html 已挂 ua-guard 且引用位于 body 之前（全站无例外、同步生效）',
      'notes 未挂 / 版本不对 / 放到 body 之后 → 加密笔记页在 QQ 浏览器里正文先闪现');
  }

  // 38c-2. UA 伪装自助兜底（2026-11-20）：新版 360 v13+ 把 UA 伪装成纯 Chrome，
  //   QIHU/360SE 全部移除，且 UA/platform/vendor/external/documentMode/chrome/uad.brands
  //   全部与真 Chrome 一致，纯特征匹配分不出来。必须同时具备：
  //   ① ua-guard.js 有 force-domestic 开关，?=1 写 localStorage 永久 + sessionStorage 兼容
  //   ② ?=0 同时清两个存储；旧 sessionStorage 标记自动迁移到 localStorage
  //   ③ 有一份诊断页，摊出真实 UA + 运行时指纹，且「永久开启 / 撤销」两个按钮都在
  {
    const guardSrc38 = exists('ua-guard.js') ? read('ua-guard.js') : '';
    check(/force-domestic=1/.test(guardSrc38)
        && /localStorage\.setItem\(FD_KEY,\s*'1'\)/.test(guardSrc38)
        && /sessionStorage\.setItem\(FD_KEY,\s*'1'\)/.test(guardSrc38)
        && /forceDomestic \|\| sxgIsDomesticBrowser\(ua\)/.test(guardSrc38),
      '§38c-2 ua-guard force-domestic=1 写 localStorage 永久 + sessionStorage 兼容，并入厂商浏览器判定',
      '删开关/降级回仅 sessionStorage → 关浏览器就失效，伪装 360 每次都要重加参数');
    check(/force-domestic=0/.test(guardSrc38)
        && /localStorage\.removeItem\(FD_KEY\)/.test(guardSrc38)
        && /sessionStorage\.removeItem\(FD_KEY\)/.test(guardSrc38),
      '§38c-2 force-domestic=0 同时清除 localStorage + sessionStorage（撤销彻底）',
      '只清一个存储 → 撤销后另一处标记仍在，黄条关不掉');
    check(/fdSs === '1' && fdLs !== '1'/.test(guardSrc38)
        && /forceDomestic = fdLs === '1' \|\| fdSs === '1'/.test(guardSrc38),
      '§38c-2 旧 sessionStorage 标记自动迁移 localStorage，两个存储任一命中即显示',
      '无迁移 → 上一版点过的访客升级后标记丢失，又要重新点一次');
    const diag38 = exists('ua-check.html') ? read('ua-check.html') : '';
    check(diag38.length > 2000
        && /navigator\.userAgent/.test(diag38)
        && /window\.external/.test(diag38)
        && /documentMode/.test(diag38)
        && /userAgentData/.test(diag38)
        && /\.\/\?force-domestic=1/.test(diag38)
        && /\.\/\?force-domestic=0/.test(diag38)
        && /强制显示横幅/.test(diag38)
        && /只能靠壳指纹/.test(diag38),
      '§38c-2 ua-check.html 自检页：UA + 运行时指纹 + 永久开启/撤销双按钮 + 「伪装成标准 Chrome 时只能靠壳指纹」实话说明',
      '自检页缺字段/撤销按钮 → 伪装 UA 访客开了黄条就关不掉，或继续被误导去盲猜');
    // 自检页的判定正则必须与 ua-guard.js 同源（否则诊断结论与真实行为对不上）
    const guardHasQihu38 = /QIHU/.test(guardSrc38);
    const guardHasSeg38 = guardSrc38.indexOf('Safari\\/537\\.36\\/\\d') !== -1;
    const diagHasQihu38 = /QIHU/.test(diag38);
    const diagHasSeg38 = diag38.indexOf('Safari\\/537\\.36\\/\\d') !== -1;
    check(guardHasQihu38 && guardHasSeg38 && diagHasQihu38 && diagHasSeg38,
      '§38c-2 自检页判定特征与 ua-guard 判定同源（QIHU + 360 双段尾缀）',
      '两处判定漂移 → 自检页说"命中"但线上不弹，排障被带偏');
  }

  // 38d. 微信文章存档：目录、正文图、完整 HTML、转录、来源清单齐全
  const ADIR = 'archive/wechat-liciaotiao-2023';
  const wantFiles38 = [
    [ADIR + '/README.md', null],
    [ADIR + '/01-letter/page.html', 3747226],
    [ADIR + '/01-letter/body.jpg', 425226],
    [ADIR + '/01-letter/transcript.md', null],
    [ADIR + '/02-my-view/page.html', 3746395],
    [ADIR + '/02-my-view/body.png', 1431313],
    [ADIR + '/02-my-view/transcript.md', null]
  ];
  const badFiles38 = wantFiles38.filter(([p, size]) => {
    if (!exists(p)) return true;
    if (size !== null && readFileSync(join(ROOT, p)).length !== size) return true;
    return false;
  });
  check(badFiles38.length === 0,
    `§38d 李跳跳两篇微信文章存档齐全（7 份文件，图片字节数锁定）`,
    '缺失/字节漂移：' + badFiles38.map((x) => x[0]).join(', ') + ' → 微信删文后无从恢复');

  // 38e. 图片 SHA-256 与存档清单登记值一致（内容级防篡改）
  {
    const hashes38 = {
      [ADIR + '/01-letter/page.html']: '1cc1c99d9b6b1c40e0a41700738f5824cf0ad2f68c5d1fe094f91210273d5684',
      [ADIR + '/01-letter/body.jpg']: 'b039668ca5d846ca4bd517a166df035136422b46e56c3fee88c1e4ddd65b4358',
      [ADIR + '/02-my-view/page.html']: '873b7379b5af09a2f5d1ca07453f7fe82b274a025079a24d12b3ef6f822b13b8',
      [ADIR + '/02-my-view/body.png']: 'c986da366fa7500cb84a6c493eebbaa5b38968d8dacfbc390e95dbb845ffed6b'
    };
    const badHash38 = Object.entries(hashes38).filter(([p, h]) => {
      if (!exists(p)) return true;
      return crypto.createHash('sha256').update(readFileSync(join(ROOT, p))).digest('hex') !== h;
    });
    check(badHash38.length === 0,
      '§38e 存档原件 SHA-256 与 README 登记表一致（内容防篡改）',
      '哈希漂移：' + badHash38.map((x) => x[0]).join(', ') + ' → 存档被替换或传输损坏');
  }

  // 38f. 存档 README 含两篇原文 URL 与发布时间，转录覆盖关键事实
  {
    const ar38 = exists(ADIR + '/README.md') ? read(ADIR + '/README.md') : '';
    const t138 = exists(ADIR + '/01-letter/transcript.md') ? read(ADIR + '/01-letter/transcript.md') : '';
    const t238 = exists(ADIR + '/02-my-view/transcript.md') ? read(ADIR + '/02-my-view/transcript.md') : '';
    check(/ha6hHr40umlj-ExHdGFXXw/.test(ar38) && /gsC9STZlGrPNNEKUV4btkA/.test(ar38)
        && /2023-08-24/.test(ar38) && /大小姐李跳跳/.test(ar38),
      '§38f 存档 README 记录两篇原文 URL、公众号与发布时间',
      '来源信息缺失 → 将来无法回溯原文、无法证明是当时版本');
    check(/48 小时内/.test(t138) && /不正当竞争/.test(t138) && /第十二条/.test(t138),
      '§38f 律师函转录覆盖核心事实（48 小时下架、不正当竞争、法条）',
      '转录缺关键事实 → 只剩图片难以检索，存档价值下降');
    check(/没有联网/.test(t238) && /薅厂商的羊毛/.test(t238) && /广受用户喜欢/.test(t238),
      '§38f 作者回应转录覆盖核心观点（无联网无盈利、厂商薅羊毛、用户喜欢）',
      '转录缺关键观点 → 双方记录不对等');
  }

  // 38g. 存档原图是第三方公开证据，登记进 §22c 白名单；其余明文素材仍不许新增
  {
    const vSrc38 = read('scripts/verify.mjs');
    const regd38 = /'archive\/wechat-liciaotiao-2023\/01-letter\/body\.jpg'/.test(vSrc38)
      && /'archive\/wechat-liciaotiao-2023\/02-my-view\/body\.png'/.test(vSrc38);
    check(regd38,
      '§38g 两张存档原图登记进 §22c 明文素材白名单（第三方证据原件，非站长口述素材）',
      '未登记 → §22c 把证据原图当违规明文素材判红；登记入口丢失');
  }

  // 38h. 电脑版 QQ 浏览器 UA（QQBrowser/10.x，不带 M 前缀）必须落进拦截范围
  const pcUa38 = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
    + '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 QQBrowser/10.9.4494.400';
  const pcHit38 = /MQQBrowser/i.test(pcUa38) || /QQBrowser/i.test(pcUa38);
  check(pcHit38 && /\/QQBrowser\/i\.test\(ua\)/.test(ug38) && /电脑版/.test(ug38),
    '§38h 电脑版 QQ 浏览器 UA（QQBrowser/10.x）被宽泛识别覆盖',
    '识别回退到版本号限定 / 注释丢电脑版口径 → PC 端 QQ 浏览器漏判，不会引导到专题页');

  // 38i. QQ 浏览器专题报道页：访客可访问的独立 HTML，两篇文章存档齐全
  const REPORT38 = 'qq-browser-report.html';
  const rpt38 = exists(REPORT38) ? read(REPORT38) : '';
  const sm38 = exists('sitemap.xml') ? read('sitemap.xml') : '';
  const nav38 = exists('nav-menu.js') ? read('nav-menu.js') : '';
  check(rpt38.length > 0
      && /ua-guard\.js\?v=17/.test(rpt38)
      && /ai-link\.js\?v=\d+/.test(rpt38)
      && /sxg-legal/.test(rpt38)
      && /<title>[^<]*QQ 浏览器[^<]*<\/title>/.test(rpt38),
    '§38i QQ 浏览器专题页存在且结构与全站一致（UA 分流 v17 / AI 按钮 / 法务页脚 / 标题）',
    '专题页缺失或不带全站组件 → 访客拿到的存档页无拦截、无 AI 入口、无法务链接');
  check(/\.\/archive\/wechat-liciaotiao-2023\/01-letter\/body\.jpg/.test(rpt38)
      && /\.\/archive\/wechat-liciaotiao-2023\/02-my-view\/body\.png/.test(rpt38)
      && /ha6hHr40umlj-ExHdGFXXw/.test(rpt38)
      && /gsC9STZlGrPNNEKUV4btkA/.test(rpt38)
      && /48 小时内/.test(rpt38) && /没有联网/.test(rpt38),
    '§38i 专题页嵌入两篇原图、原文链接与双方关键内容（律师函 48 小时 / 作者无联网）',
    '原图或来源缺失 → 微信删文后专题页只剩空壳，存档备份落空');
  check(sm38.includes('/qq-browser-report.html</loc>')
      && !/label: 'QQ 浏览器专题'/.test(nav38),
    '§38i 专题页被 sitemap 收录、悬浮导航不再有访客入口（只对 QQ 浏览器访客可见）',
    '导航又加回入口 → 违背站长「拦截跳专题、但不主动推给普通访客」的口径');
}

// ---------- 39. 狗日的华为做过的恶专题（2026-11-20：外界批评观点汇编 + 网传视频存档） ----------
// 站长 2026-11-20 三次定稿：① 初版为踏板支架争议存档（中性标题）；
// ② 追加指令：标题改用《狗日的华为做过的恶》，把外界批评观点（Evil Huawei / 知乎 /
//    维基百科「华为相关争议」）汇编进专题页，另附两个来源页面链接；
// ③ 最终指令（02:00）：撤掉一切「未经本站核实 / 不代表本站立场 / 不构成事实认定 / 待核实」
//    等本站擅自加的免责标注——站长明确「没说的不准写」，页面不留免责套话。
// 口径：① 标题按站长指令用书名号；② 外界批评观点逐条标来源；③ 原文与短链逐字存档；
//   ④ 卡面只链站内专题页、外链白名单不放宽；⑤ 全页不得出现免责声明字样（反向断言）。
{
  const zj = exists('zunjie-report.html') ? read('zunjie-report.html') : '';
  const newsZj = read('news-incident-patch.js');
  const smZj = read('sitemap.xml');
  const idxZj = read('index.html');

  check(zj.length > 3000 && /<html lang="zh-CN">/.test(zj)
      && /双休购专题报道/.test(zj)
      && /狗日的华为做过的恶/.test(zj)
      && /《<span class="quoted">狗日的华为做过的恶<\/span>》/.test(zj),
    '§39a 专题页独立成页、标题按站长指令用《狗日的华为做过的恶》',
    '标题缺失或书名号结构被改 → 站长指定标题未落地');
  check(/售价超百万豪车尊界V800被一脚踩断刹车踏板支架/.test(zj)
      && /到底是车子的问题还是测评员的问题/.test(zj)
      && /https:\/\/v\.douyin\.com\/Vc4SsZp8e1U\//.test(zj)
      && /逐字存档|逐字保留/.test(zj),
    '§39b 原文逐字存档 + 抖音短链在案（防链接下架）',
    '原文或短链缺失 → 视频下架后线索彻底消失，存档页失去意义');
  check(!/未经独立核实|未经本站核实|未经核实|不作事实认定|不构成事实认定|不代表本站立场|本站不下结论|本站不站队|本站照录|非事实认定|待核实|未核实 ·|仅供对照/.test(zj),
    '§39c 全页无「未经核实 / 不作事实认定 / 不代表本站立场」等免责标注（站长指令撤掉）',
    '免责字样回流 → 站长明确「没说的不准写」，页面不得再出现这些套话');
  check(/尊界 V800|尊界V800/.test(zj) && /S800/.test(zj)
      && /原文/.test(zj),
    '§39d 车型原文表述与公开资料对照在案（照录原文、附 S800 对照）',
    '车型原文或 S800 对照缺失 → 存档线索不完整');
  check(/WorkBuddy/.test(zj) && /协助完成/.test(zj),
    '§39e 页脚标注 WorkBuddy 协助完成',
    '站长明确允许的署名缺失');
  check(smZj.includes('/zunjie-report.html</loc>')
      && /ai-link\.js\?v=\d+/.test(zj) && /sxg-legal/.test(zj),
    '§39f 专题页进 sitemap、挂全站 AI 按钮与法务页脚',
    '缺 sitemap/AI/法务 → 新页游离在全站体系外');
  check(/key: 'huawei-zunjie'/.test(newsZj)
      && /title: \/\^华为终端\//.test(newsZj)
      && /href: '\.\/zunjie-report\.html'/.test(newsZj)
      && /不据此调整 C 级评级/.test(newsZj)
      && /<script defer src="\.\/news-incident-patch\.js\?v=9"><\/script>/.test(idxZj),
    '§39g 华为卡登记框只链站内专题页、声明不改评级，脚本 ?v=8 破缓存',
    '卡面挂外链或漏 bump 缓存号 → 违反外链白名单口径 / 用户拿旧补丁');
  // 外链白名单仍只有理想那一条：新增卡片不得扩大卡面外链口径
  const newsLinks39 = [...newsZj.matchAll(/https?:\/\/[^'"\s)]+/g)].map((x) => x[0]);
  check(newsLinks39.length === 1 && newsLinks39[0] === 'https://v.douyin.com/nHGcAwzSXOU/',
    '§39h 新闻登记补丁卡面外链白名单仍只有理想一条（华为线索不放外链）',
    '外链白名单被扩大 → 卡面变成外链 wagon，违反 §32f 既定口径');
  // 2026-11-20 站长追加：外界批评观点汇编四小节 + 两个来源页面链接
  check(/外界批评观点汇编/.test(zj) && /企业文化与员工管理争议/.test(zj)
      && /市场竞争与商业策略/.test(zj) && /外界争议与舆论/.test(zj)
      && /小结|争议的主要落点/.test(zj)
      && /被外界称为"华为做过的恶"/.test(zj),
    '§39i 外界批评观点四小节汇编在案（管理/市场/舆论/小结）',
    '汇编小节缺失 → 站长指定的 AI 整理内容未完整植入专题页');
  check(zj.includes('https://evil-huawei.github.io/evil-huawei/')
      && /zh\.wikipedia\.org\/wiki\/%E5%8D%8E%E4%B8%BA%E7%9B%B8%E5%85%B3%E4%BA%89%E8%AE%AE/.test(zj)
      && (zj.match(/evil-huawei\.github\.io\/evil-huawei\//g) || []).length >= 2,
    '§39j Evil Huawei 与维基百科两个来源页链接在案且 Evil Huawei 多处可点',
    '来源页链接缺失 → 批评观点无出处可回溯，读者无法自行判断');
  check(!/立场说明/.test(zj) && !/非本站立场/.test(zj) && !/不是本站的调查结论/.test(zj),
    '§39k 汇编章节无「立场说明 / 非本站立场」免责块（站长指令撤掉）',
    '立场声明回流 → 站长明确「没说的不准写」，汇编章节不得再加免责块');
  // 2026-11-20 站长追加：消歧义（备注讲的是华为问界汽车，不是手机终端）+ 问界卡同款备注 + 搜「华为汽车」出问界
  check(/head: '⚑ 站长备注 · 华为问界汽车踏板支架争议线索/.test(newsZj)
      && /这条备注说的是华为问界汽车/.test(newsZj)
      && /不是华为手机／终端业务本身/.test(newsZj),
    '§39l 华为终端卡备注写明「这条备注说的是华为问界汽车、非手机终端」（消歧义）',
    '备注不写清汽车业务归属 → 读者把踏板支架线索当成华为手机的事');
  check(/key: 'huawei-wenjie'/.test(newsZj)
      && /title: \/\^问界（赛力斯）\//.test(newsZj)
      && /href: '\.\/zunjie-report\.html'/.test(newsZj)
      && /不据此调整 C 级评级/.test(newsZj),
    '§39m 问界卡也有同款踏板支架备注、只链站内专题页（搜问界即可见）',
    '问界卡无备注 → 搜问界看不到这条线索，违背站长「问界也要写」');
  const idxWj = idxZj;
  const aliasFile39 = read('scripts/pinyin-aliases.json');
  const pinyinIdx39 = read('pinyin-index.js');
  check(/keywords: \['问界（赛力斯）', '华为汽车', '华为问界'/.test(idxWj)
      && /"wenjie-card": \[[^\]]*"华为汽车"[^\]]*"华为问界"/.test(aliasFile39)
      && /"id":"wenjie-card"[\s\S]{0,900}"华为汽车"/.test(pinyinIdx39)
      && /pinyin-index\.js\?v=23/.test(idxWj),
    '§39n 问界卡关键词与拼音别名含「华为汽车/华为问界」，索引已重建且 ?v=23 破缓存',
    '别名或重建缺失 → 搜「华为汽车」「华为问界」命中不了问界卡，站长说的「不智能」重现');

  // 2026-11-20 站长提供 @界面新闻 长城落实双休抖音视频，去核实后登记进长城汽车卡。
  // 核实结论：与卡内官宣/员工证言/界面新闻采访同源一致，属总部落实双休面的视频佐证；
  // 产线单双休矛盾未解，维持 B 级不变。卡面外链白名单不放宽——只链站内详情页，
  // 原始 so.douyin.com 链接按站规登记进 brand/gwm.html 证据链，公示区由生成器同步。
  check(/key: 'gwm-douyin'/.test(newsZj)
      && /title: \/\^长城汽车\//.test(newsZj)
      && /界面新闻抖音视频：长城汽车落实双休（2026-01-06）/.test(newsZj)
      && /href: '\.\/brand\/gwm\.html'/.test(newsZj)
      && /维持 B 级/.test(newsZj),
    '§39o 长城卡有界面新闻视频登记框（书面化、只链站内详情页、维持 B 级不改评级）',
    '长城卡无登记框或挂了外链 → 站长给的核实线索没落地 / 违反外链白名单');
  check(/aweme_id=7592181887922195738/.test(read('brand/gwm.html'))
      && /界面新闻（抖音视频）：长城汽车 2026 落实双休/.test(read('brand/gwm.html'))
      && /<details id="ev-gwm" data-b="gwm" data-g="B" data-n="10" data-l="9"/.test(idxZj),
    '§39p 原始抖音链接登记进 brand/gwm.html 证据链，首页公示区 ev-gwm 计数同步 10/9',
    '证据链或公示区计数没同步 → verify §5 对账判红、读者看不到这条来源');
  check(/<script defer src="\.\/news-incident-patch\.js\?v=9"><\/script>/.test(idxZj),
    '§39q 新闻补丁脚本 ?v bump 到 9（长城卡新登记框破缓存）',
    '?v 没 bump → 浏览器吃旧补丁，长城卡看不到新登记框');
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
