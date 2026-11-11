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
// 2026-11-08 新增「陆喜依」（独立公开来源，非榜单导入）→ 121 张导入卡。
// 这个数不是「随便写死」：它同时被 §2e 的四格统计、brand/ 页数、公告栏数字三处引用，
// 任何一处生成器漏跑都会在这里对不上，所以必须保留为硬断言。
const IMPORTED_CARD_COUNT = 105;
check(customPairs2e.length === 17 + IMPORTED_CARD_COUNT,
  `能解析全部自定义卡（${17 + IMPORTED_CARD_COUNT} 张 = 17 张手工卡含联通 + ${IMPORTED_CARD_COUNT} 张导入卡（104 榜单 + 1 独立来源））`,
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
  'xiaomi-card': 'A级',
};
const locked2e = customPairs2e.filter((c) => EXPECT_GRADE_2E[c.id]);
const relockedU2e = locked2e
  .filter((c) => c.grade !== EXPECT_GRADE_2E[c.id])
  .map((c) => c.id + '=' + c.grade + '（应 ' + EXPECT_GRADE_2E[c.id] + '）');
check(relockedU2e.length === 0,
  '5 家银行 A 级（工/建/中/成都/农行）+ 小米 A 级 + 淘宝闪购 C 级 + BOSS直聘 D 级（锁定，不得回退）',
  relockedU2e.length ? relockedU2e.join(', ') : '锁定生效');
check(locked2e.length === 9,
  '9 张锁定卡全部存在（删卡判红）', '实际 ' + locked2e.length);
// 2026-11-02 起：A 级 / C 级计数含榜单导入卡（A 58 张、C 29 张）。
// 断言仍然写成「基准 + 导入数」的算式，导入批次调整时改 IMPORTED_CARD_COUNT 一处即可，
// 但两个基准值（4 / 11）必须保持 —— 那是手工卡的既有口径，动了就等于偷偷改档。
check(byGrade2e('A级') === 6 + 58,
  '自定义卡 A 级共 64 张（工/建/中/成都/农行银行 5 张 + 小米 2026-11-05 B→A + 榜单导入 58 张）',
  '实际 ' + byGrade2e('A级'));
check(byGrade2e('C级') === 9 + 29,
  '自定义卡 C 级共 38 张（手工 9 张 + 榜单导入 29 张；农行 2026-11-04 由 C 转 A；BOSS直聘 2026-11-03 转入 D 级）',
  '实际 ' + byGrade2e('C级'));
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
const BANK_PAGE_TIER = { icbc: 'A', ccb: 'A', boc: 'A', chengdubank: 'A', abc: 'A' };
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

      /* 手机端折叠：站长三轮口令的最终形态
         —— 第二轮「仍然占了 3–4 行」→ 第三轮「你确定手机版一行文字就能显示完？
            不考虑设备屏幕大小吗？」→ 第四轮「我要的是这句完整的话，最多两行，
            或者做折叠，你看着办吧，别问我了」。
       定稿：正文永远是**原句**，手机端压两行 + 展开看全，开关是纯 CSS 的
       checkbox + label（不依赖脚本）。三件缺一件就等于没折叠或折叠了打不开：
         ① 开关控件、② 指向它的 label、③ 真正生效的 clamp 规则。 */
    check(/id="notice-more"/.test(noticeDiv[0]),
      '公告栏带折叠开关控件（#notice-more）');
    check(/<label[^>]*for="notice-more"/.test(noticeDiv[0]),
      '折叠开关有可点的 label（纯 CSS 开关，脚本挂了也能展开）');

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
    if (exists('mobile-fixes.css')) {
      const mfc = stripCssComments(read('mobile-fixes.css'));
      check(!/notice-short/.test(html) && !/notice-short/.test(mfc),
        '不再有「手机改写短句」机制（notice-short 已从 HTML 与 CSS 一并清除）',
        'notice-short 残留：' + (/notice-short/.test(html) ? 'index.html ' : '')
          + (/notice-short/.test(mfc) ? 'mobile-fixes.css' : ''));
      check(/-webkit-line-clamp:\s*2/.test(mfc)
        && /\.notice-more-cb:checked\s*~\s*#evidence-notice\s*\{[^}]*(?:display:\s*block|-webkit-line-clamp:\s*none)/.test(mfc),
        '手机端公告栏默认压成 2 行、展开态解除 clamp（mobile-fixes.css）',
        'line-clamp:2 或展开态解除规则缺失');
    // 展开态必须给「提醒」悬浮按钮让位：按钮是 right:14 固定定位，纵向位置由
    // bottom:calc(--sxg-bar-h + 272px) 决定 —— 实测 320×720（--sxg-bar-h=356px）时
    // 按钮矩形 left 257 / top 46 / 49×46，正好压在展开后第 3–4 行上。
    // 折叠态只有两行（y 0–49）只蹭到内边距不压字，所以只需在展开态让位。
    const expandRule = mfc.match(/\.notice-more-cb:checked\s*~\s*#evidence-notice\s*\{([^}]*)\}/);
    const padR = expandRule && expandRule[1].match(/padding-right:\s*(\d+)px/);
    check(!!padR && Number(padR[1]) >= 50,
      '展开态右侧给「提醒」悬浮按钮让位（padding-right ≥50px，否则压住第 3–4 行）',
      padR ? `padding-right 只有 ${padR[1]}px` : '展开态没有 padding-right，正文会钻到按钮底下');
      // 「2 行」不是写个 2 就够：clamp 只在 -webkit-box 上生效，
      // 有人把 display 改回 block，clamp 会静默失效 → 公告栏又变回 5 行。
      const noticeBox = mfc.match(/#evidence-notice\s*\{([^}]*)\}/);
      check(!!noticeBox && /display:\s*-webkit-box/.test(noticeBox[1])
        && /-webkit-box-orient:\s*vertical/.test(noticeBox[1]),
        '两行折叠的前提条件在位（display:-webkit-box + box-orient:vertical）',
        '缺 -webkit-box 布局，clamp 会静默失效');
      // 第五轮（2026-11-02）：版本号已整体移出公告栏，不再靠「手机端隐藏它」这条规则。
      // 现在要的保证反过来了 —— 那个真相源节点在任何端都不可见。
      // HTML 已带 hidden，但 hidden 只是 UA 样式，任何一份给 span 加 display 的
      // 样式表都能把它顶出来（它的位置在公告栏与 #root 之间，顶出来就是页面顶部
      // 多一行莫名其妙的版本号），所以必须有 id 级 CSS 兜底。
      check(/#site-version\s*\{[^}]*display:\s*none/.test(mfc),
        '版本号真相源节点有 CSS 隐藏兜底（#site-version{display:none}）',
        '只靠 HTML 的 hidden 属性，一旦有样式表给 span 加 display 就会露出来');
      // 「展开」原先 padding-left 只有 4px，实测跟省略号贴在一起，
      // 「…已在本页…展开」读起来像连写（2026-11-02 站长看截图指出）。
      // 判据两条：间距抬到 ≥8px + 左边界有一条分隔线。
      check(/\.notice-more-lbl\s*\{[^}]*padding-left:\s*(?:[89]|1[0-9])px[^}]*border-left:\s*1px solid/.test(mfc),
        '折叠开关与正文有视觉分隔（间距 ≥8px + 左侧分隔线）');
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
    customCards.push({ id, name, rate, off, insertAfter, logo });
  }
}
const CUSTOM_COUNT = customCards.length;
check(CUSTOM_COUNT === 17 + IMPORTED_CARD_COUNT,
  `自定义卡 ${CUSTOM_COUNT} 张（17 张手工 + ${IMPORTED_CARD_COUNT} 张导入；2026-11-02 批量导入，2026-11-03 增联通 B 级，2026-11-08 增陆喜依 S 级）`);

// null 规则：双休率 / 下班时间不得为占位 0，也不得是字符串 '未知'
customCards.forEach((c) => {
  check(c.rate !== '0' && c.rate !== "'0'",
    `自定义卡「${c.name}」双休率未使用占位 0（当前 ${c.rate}）`,
    c.rate === '0' || c.rate === "'0'" ? '未核实应填 null，页面会显示「—」' : '');
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
    const m = title.match(/（(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\s*·\s*提交\s*`[0-9a-f]{7,9}`(?:[^）]*)）\s*$/);
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
  check(/站长随笔/.test(dp),
    '弹窗底部有「站长随笔」入口',
    '入口缺失 → 页面存在但无人能到');
  // ⚠️ 2026-10-19 站长决定：notes.html 锁屏可直接访问（保留密码锁），
  //    弹窗入口改为直接跳转，原「还在写」公告弹窗整体移除。
  //    （2026-10-25 该入口文字还原为「站长随笔」，仍跳 notes.html。）
  //    剥注释后再匹配，避免注释里的说明文字被当成真实跳转。
  check(/href\s*=\s*["']\.\/notes\.html/.test(dp),
    '「站长随笔」直接跳转到 notes.html',
    '入口缺失或仍是弹公告 → 页面存在但无人能到');
  check(!/dyp--notice/.test(dp),
    '「还在写」公告弹窗已移除',
    'notes.html 已可直接访问（保留密码锁），公告弹窗不应再出现');
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
  check(/压榨员工的产品，最后买单的是谁/.test(dp),
    '弹窗标题已还原为旧版（汽车 / 压榨员工的产品）',
    '标题不是旧版 → 2026-11-03 的回退没落地，或又被换了别的内容');
  check(/v\.douyin\.com\/37pbo6qxUbs/.test(dp),
    '弹窗主链接指向旧版抖音视频',
    '主链接不是抖音原视频 → 回退不完整（链接被改坏或仍指向微信原文）');
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
  const narrowRaw = (lp.match(/@media\s*\(max-width:\s*374px\)\s*\{[\s\S]*?\n\}/) || [''])[0];
  const narrow = stripCssComments(narrowRaw);
  check(narrowRaw.length > 0,
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
  const kwMismatch = idxCustomKw.filter((e) => {
    const cfgStart = read(INDEX_HTML).indexOf("id: '" + e.id + "'");
    const chunk = read(INDEX_HTML).slice(cfgStart, cfgStart + 1600);
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

// ---------- 20g. 良配广告必须延迟淡入（不得加载即弹） ----------
// 起因（用户截图 + 真机复现）：liangpei-ad.js 的 init() 在 DOMContentLoaded 后
// 无条件 build()，旧实现用 requestAnimationFrame 立刻移除 is-hidden，导致广告在
// 首页加载瞬间就浮层弹出，盖在品牌卡片上（用户误以为是点品牌卡触发的侵入式弹窗）。
// 2026-10-29 改为：延迟 CONFIG.showAfter 毫秒后再移除 is-hidden（配合 CSS opacity
// 淡入），先让用户看清首页内容。本段守住「不得加载即弹」这个回归点。
section('20n. 良配广告延迟淡入');
const ADJS = 'liangpei-ad.js';
const ADCSS = 'liangpei-ad.css';
if (exists(ADJS) && exists(ADCSS)) {
  const adj = read(ADJS);
  const adc = read(ADCSS);
  // 1) reveal 必须是延迟的（setTimeout 包裹 is-hidden 移除），不允许加载即 rAF 立即移除
  check(/setTimeout\([\s\S]*?classList\.remove\('is-hidden'\)/.test(adj),
    '广告 reveal 由 setTimeout 延迟触发（非加载即弹）',
    '旧实现用 requestAnimationFrame 立即移除 is-hidden，首页一打开就弹出广告');
  check(!/requestAnimationFrame\(\s*function[\s\S]*?classList\.remove\('is-hidden'\)/.test(adj),
    '广告 reveal 不再用 requestAnimationFrame 立即移除 is-hidden',
    'rAF 立即移除 is-hidden = 加载即弹，正是 2026-10-29 修掉的 bug');
  check(/showAfter\s*:/.test(adj),
    'CONFIG 里存在 showAfter 延迟配置（可调）');
  // 2) is-hidden 必须用 opacity/visibility 实现淡入，不能再用 display:none（否则无过渡）
  const ihM = adc.match(/\.lp-ad\.is-hidden\s*\{([\s\S]*?)\}/);
  check(!!ihM, 'CSS 中存在 .lp-ad.is-hidden 规则');
  if (ihM) {
    check(!/display\s*:\s*none/.test(ihM[1]),
      '.lp-ad.is-hidden 不再用 display:none（改用 opacity/visibility 以淡入）',
      'display:none 无法做淡入过渡，且会让「加载即弹」回潮');
  }
} else {
  err('liangpei-ad.js / liangpei-ad.css 缺失', '广告位文件被删会导致首页推广位彻底失效');
}

// ---------- 20o. 桌面悬浮层互不遮挡（广告卡 × AI 面板） ----------
section('20o. 桌面悬浮层互不遮挡');
if (exists(ADJS) && exists(ADCSS) && exists('ai-chat.js')) {
  const adj = read(ADJS);
  const adc = read(ADCSS);
  const aic = read('ai-chat.js');

  // 1) --sxg-bar-h 的语义是「底部吸底条占位」。≥1440px 广告是右上竖排卡片，
  //    根本不在底部，却照样把卡片高度（实测 279px）写进变量 —— 整列 FAB 与 AI 面板
  //    被抬高一个卡片高度飘到页面中部，面板还被卡片压住右半屏（2026-11-02 站长截图）。
  check(/matchMedia\('\(min-width: 1440px\)'\)\.matches/.test(adj),
    '广告脚本按 1440px 断点判断「是否吸底」（读 matchMedia 结果）',
    '不判断断点 → 桌面把右上卡片的高度也写进 --sxg-bar-h');
  check(/var h = \(wide \|\| aside\.classList\.contains\('is-hidden'\)\) \? 0 : aside\.offsetHeight;/.test(adj),
    '≥1440px 或广告隐藏时 --sxg-bar-h 恒为 0（桌面没有吸底条可让位）',
    '桌面仍写卡片高度 → 悬浮按钮组与 AI 面板被整体抬高 279px');

  // 2) 2026-11-05 站长拍板：AI 挂件整体挪到左下角。按钮 left:14 锚定；
  //    面板改左锚定后与右上广告卡不再同列，旧的 :has() 避让规则必须拔掉，
  //    残留即死规则 —— 谁把面板改回右锚定而不删它，这里判红。
  check(/'#' \+ BTN_ID \+ '\{position:fixed;left:14px;/.test(aic),
    'AI 按钮左下角锚定（left:14px，2026-11-05 站长拍板）',
    'AI 按钮仍锚右侧 → 与「回到顶部」钮（≥1440 距底 6px）同心叠住（2026-11-05 站长截图）');
  check(!/body:has\(\.lp-ad/.test(aic),
    '面板避让规则已拔除（面板左锚定后与右上广告卡不再同列）',
    '旧 :has() 避让规则残留 —— 面板已不贴右，规则成了永不生效的死代码');
} else {
  err('缺少 liangpei-ad.js / liangpei-ad.css / ai-chat.js', '桌面悬浮层避让无法校验');
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
  check(/“狗日的”Boss直聘<\/span>/.test(ugp) && !/[^”]狗日的Boss直聘/.test(ugp),
    '§21b-3 「狗日的」带中文弯引号（U+201C/U+201D），不得退回无引号原样',
    '粗口不加引号 → 读起来像本站/站长在这行直接骂人（站长 2026-11-07 明确要求）');
  // 2026-11-06 站长指定：抵制区末尾追加「海比优」一句 + 固定末句
  // （海比优文案由站长提供英文 Application Introduction，此处译写一句中文；
  // 末句一字不改，含「；」不换行：应用商店搜索 + 与本站无关声明）
  check(/海比优（Haibiyou）是一款认真做招聘的求职平台/.test(ugp)
    && /为求职者筛选真实可靠的企业岗位，也帮企业快速找到优秀人才。/.test(ugp),
    '抵制区末尾有海比优介绍句（站长英文 Application Introduction 译写）',
    '删掉海比优句 → 站长指定的推广文案缺失');
  check(/欢迎前往各大手机应用商店搜索（开发中，限号注册）；推广内容与本站无关，站长不会收取任何广告费。/.test(ugp),
    '抵制区末句一字不改（应用商店搜索 + 与本站无关声明，含「；」不换行）',
    '改末句措辞/断行 → 站长指定的固定收尾句被破坏');
  // 脚本缓存号：改 u-grade-patch.js 必须同步 ?v=，否则线上仍是旧抵制区
  const idxUgp = readFileSync(join(ROOT, 'index.html'), 'utf8');
  check(/u-grade-patch\.js\?v=17/.test(idxUgp)
    && !/u-grade-patch\.js\?v=16/.test(idxUgp),
    'index.html 引用 u-grade-patch.js?v=17（缓存号已随改动同步 +1）',
    '漏 bump ?v 或仍写 15 → 浏览器命中旧缓存，新抵制区不生效');
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

// ---------- 21g. 劳动法小助手（Worker 代理 + 品牌页挂件，2026-10-26 站长指令） ----------
// 架构：静态站不能藏 API key → Cloudflare Worker（env.AI binding 零 key，
// ai-worker/）做代理；品牌页右侧挂 ai-chat.js 聊天气泡；ai-config.js
// 是唯一开关（endpoint 空 = 挂件不渲染，先推前端不出半截 UI）。
// 断言分三组：挂件挂载、降级开关、Worker 安全层。
{
  const aiChat = exists('ai-chat.js') ? read('ai-chat.js') : '';
  const aiCfg = exists('ai-config.js') ? read('ai-config.js') : '';
  const worker = exists('ai-worker/src/worker.js') ? read('ai-worker/src/worker.js') : '';
  section('21g. 劳动法小助手（Worker 代理 + 品牌页挂件）');

  // ---- 前端挂件与品牌页挂载 ----
  check(exists('ai-chat.js') && exists('ai-config.js'),
    '挂件与配置脚本存在（ai-chat.js / ai-config.js）');
  // 品牌页全量挂载：数 brand/*.html 里引用 ai-chat.js 的页数 == 品牌页总数
  const brandDir = join(ROOT, 'brand');
  let brandPages = 0, mounted = 0;
  if (exists('brand')) {
    for (const f of readdirSync(brandDir)) {
      if (!f.endsWith('.html')) continue;
      brandPages++;
      if (readFileSync(join(brandDir, f), 'utf8').includes('ai-chat.js?v=')) mounted++;
    }
  }
  check(brandPages > 0 && mounted === brandPages,
    `62 张品牌页全部挂载挂件（实际 ${mounted}/${brandPages}）`);
  // 挂载顺序：config 在 chat 前（chat 读 window.SXG_AI_CONFIG，顺序反了首帧读不到）
  {
    const acer = readFileSync(join(ROOT, 'brand/acer.html'), 'utf8');
    const cfgPos = acer.indexOf('ai-config.js?v=');
    const chatPos = acer.indexOf('ai-chat.js?v=');
    check(cfgPos !== -1 && chatPos !== -1 && cfgPos < chatPos,
      '挂载顺序：ai-config.js 在 ai-chat.js 之前');
  }
  // ---- 首页也挂（2026-10-26 站长指令：保证手机端可见——手机用户主要逛首页） ----
  check(/<script(?:\s+defer)? src="\.\/ai-config\.js\?v=\d+"><\/script>/.test(html)
    && /<script(?:\s+defer)? src="\.\/ai-chat\.js\?v=\d+"><\/script>/.test(html),
    '首页 index.html 也挂载了挂件（手机端主入口）');
  {
    const cfgPos = html.indexOf('ai-config.js?v=');
    const chatPos = html.indexOf('ai-chat.js?v=');
    check(cfgPos !== -1 && chatPos !== -1 && cfgPos < chatPos,
      '首页挂载顺序：ai-config.js 在 ai-chat.js 之前');
  }
  // 卡通形象（2026-10-26 站长指令）：多头像文件架构（AVATARS 数组 + avatarSrc 从 .svg 加载），不用 emoji
  check(/var AVATARS = \[/.test(aiChat) && /function avatarSrc\(id\)/.test(aiChat) && /AVATAR_BASE/.test(aiChat),
    '卡通形象为多头像文件架构（AVATARS 数组 + avatarSrc 加载 .svg，非单内联 base64）');
  check(/headAvatar\.src = avatarSrc\(/.test(aiChat) && /im\.src = avatarSrc\(a\.id\)/.test(aiChat),
    '按钮与面板头部都用卡通形象（emoji 已替换，按头像 id 加载 .svg）');
  check(exists('assets/ai-avatar.svg'),
    '形象源文件 assets/ai-avatar.svg 在仓库（换形象的单一权威来源）');
  // 手机端适配（2026-10-26 站长指令：保证手机端可用）
  check(/@media \(max-width:640px\)/.test(aiChat) && /font-size:16px/.test(aiChat),
    '手机端媒体查询在位（输入 16px 防 iOS 聚焦缩放）');
  check(/env\(safe-area-inset-bottom, 0px\)/.test(aiChat),
    '按钮/面板底距带 safe-area 安全区（刘海屏不贴边）');
  // 手机端 AI 钮必须抬到左下导航主按钮（bar-h+48 起 46px 高）上方：bar-h+104
  check(/\+ 104px \+ env\(safe-area-inset-bottom/.test(aiChat) && /\+ 170px \+ env\(safe-area-inset-bottom/.test(aiChat),
    '手机端 AI 钮/面板抬高到导航主按钮上方（钮 +104 / 面板 +170）',
    '手机端 AI 钮停在距底 14px → 与左下导航主按钮（+48..94）重叠');
  check(/z-index:9000/.test(aiChat) && /z-index:9001/.test(aiChat),
    'z-index 9000/9001 与浮钮家族平级（广告条 9990 之下，不盖广告）');

  // ---- stub 模式（endpoint 空 = 按钮照常显示 + 面板提示开通中）----
  // 2026-10-26 站长实测反馈：旧设计「endpoint 空 = 整体隐身」让站长以为
  // 图标坏了。改为永远显示；stub 提示「开通中」+ 表单禁用 + ask() 双保险。
  check(/var STUB = !ENDPOINT \|\| !\/\^https\?:\\\/\\\/\/\.test\(ENDPOINT\);/.test(aiChat),
    'stub 模式标记（未配置 endpoint 时按钮仍渲染）');
  check(/if \(STUB\) return; \/\/ 未接入：不 fetch/.test(aiChat),
    'ask() 的 stub 守卫（不 fetch，双保险）');
  check(/AI 服务正在开通中/.test(aiChat) && /AI 开通中，暂不可提问/.test(aiChat),
    'stub 面板有「开通中」提示文案（欢迎语 + 占位符）');
  check(/input\.disabled = true/.test(aiChat) && /send\.disabled = true/.test(aiChat),
    'stub 模式输入框与发送按钮禁用');
  check(/endpoint: '(?:https?:\/\/[^']+)?'/.test(aiCfg),
    'ai-config.js endpoint 为合法字符串（空串=关闭，或 https Worker 地址=开启）');
  check(/window\.SXG_AI_CONFIG/.test(aiCfg) && /window\.SXG_AI_CONFIG \|\| \{\}/.test(aiChat),
    '配置读取走 window.SXG_AI_CONFIG（两侧同源）');

  // ---- 挂件行为要点 ----
  check(/maxLength = 500/.test(aiChat) && /MAX_HISTORY = 8/.test(aiChat),
    '输入 500 字上限 + 历史 8 条上限（前端第一道，Worker 有二道）');
  check(/daily-quota-exhausted/.test(aiChat) && /额度已用完/.test(aiChat),
    '配额耗尽有中文文案（用户能看懂为什么答不了）');
  check(/不构成法律意见/.test(aiChat),
    '挂件内声明「不构成法律意见」（合规口径与 Worker 提示词一致）');

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
  check(/recent\.length >= 20/.test(worker),
    '每 IP 每小时 20 次限流（429）');
  // 输出上限
  check(/max_tokens: 2000/.test(worker),
    'max_tokens 2000（GLM-4.7-flash 推理模型，reasoning 吃掉大量 token，输出是 neuron 大头，需留足空间）');
  // 模型
  check(/@cf\/zai-org\/glm-4\.7-flash/.test(worker),
    '模型 ID = @cf/zai-org/glm-4.7-flash（Workers AI 免费层）');
  // 系统提示词的合规口径
  check(/不构成对企业的法律定性/.test(worker) && /12333/.test(worker),
    '系统提示词含站点口径与 12333 转介（合规两件套）');

  // ---- 测试与 CI ----
  check(exists('scripts/test-ai-chat.cjs') && exists('scripts/test-ai-worker.cjs'),
    '存在挂件行为测试 + Worker 逻辑测试');
  if (exists('.github/workflows/verify.yml')) {
    const ci = read('.github/workflows/verify.yml');
    check(ci.includes('test-ai-chat.cjs') && ci.includes('test-ai-worker.cjs'),
      'CI 里已接入两个 AI 测试');
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
  check(/navigator\.serviceWorker\.register\(['"]\.\/sw\.js['"]/.test(idx),
    '首页注册了 sw.js（network-first 导航接管）', '首页没注册 SW → 旧黑弹窗残留问题没解决');
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

  check(/<script async src="\.\/black-card-adslot\.js\?v=20"><\/script>/.test(idx)
    && idx.indexOf('black-card-adslot.js?v=20') < idx.indexOf('</head>')
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
  check(/u-grade-patch\.js\?v=17/.test(idx) && /stat-filter\.js\?v=9/.test(idx),
    'u-grade-patch.js?v=17 / stat-filter.js?v=9（缓存号已随内容 bump）',
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
      timeMap[t.slice(0, k)] = d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate())
        + ' ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes());
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
  const PAT = /(\d{4}-\d{2}-\d{2} \d{2}:\d{2})([^`]{0,120}?)`([0-9a-f]{7,40})`/g;
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
    '记账条目写的时间 = 该提交的真实 commit 时间（三个记账文件全量比对）',
    bad.slice(0, 4).join('；') + (bad.length > 4 ? '（共 ' + bad.length + ' 处）' : ''));
  check(missing.length === 0,
    '记账引用的哈希在仓库里都真实存在（防 rebase 后忘记回填新哈希）',
    missing.slice(0, 4).join('；'));
}

// ---------- 21n. fix: 提交必须记进 README 相关页面 ----------
// 站长 2026-11-05：「根据 GitHub 规则，修复 bug 必须记录 README 相关页面」。
// GitHub 仓库首页展示的就是 README，只写进 CHANGELOG 等于访客看不见。
// 规则只写文档会漏（2026-10-19 血泪），这里按 Conventional Commits 的 fix:
// 类型取 git log 里最近一次 bug 修复提交，强制 README.md 与 最近更新.md 都引用它。
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

  const rd = exists('README.md') ? read('README.md') : '';
  const ru = exists(UPDATE_DOC) ? read(UPDATE_DOC) : '';
  check(!!fixHash && fixCount >= 5,
    '§21n 真的扫到了 fix: 提交（git 历史 + 修复提交数双重空集防护）',
    'fixHash=' + fixHash + ' / fixCount=' + fixCount + ' → 断言在空跑');
  check(rd.length > 1000 && ru.length > 1000,
    '§21n README.md 与 最近更新.md 都读到了内容（空集防护）',
    'README=' + rd.length + ' / 最近更新=' + ru.length);

  // 不许只是「正文碰巧出现这串哈希」：必须落在某个「近期 bug 根因」章节里，
  // 且至少要有两个这样的章节（新增章节被删掉也会判红）。
  const headings = [...rd.matchAll(/^### 近期 bug 根因[^\n]*$/gm)].map(m => m.index);
  check(headings.length >= 2,
    'README 至少有两个「近期 bug 根因」章节（章节被删也判红）',
    '当前 ' + headings.length + ' 个');
  let newest = '';
  if (headings.length) {
    const rest = rd.slice(headings[0] + 1);
    const nxt = rest.search(/\n#{2,3} /);
    newest = nxt > 0 ? rest.slice(0, nxt) : rest;
  }
  // 只认**章节标题行**：正文里碰巧提到旧哈希、或只在别处摘要里提一嘴，都不算
  // 「为这次 bug 立了条」。故障注入实测：从正文里删哈希容易被同串文本蒙混过关。
  check(!!fixHash && newest.split('\n')[0].includes(fixHash),
    `README「近期 bug 根因」最新章节标题记录了最近一次 fix 提交 ${fixHash}`,
    '最新 bug 根因章节标题没引用 ' + fixHash + ' → 修了 bug 却没在 README 立条');
  check(!!fixHash && rd.includes(fixHash) && ru.includes(fixHash),
    `README.md 与 最近更新.md 都引用了最近一次 fix 提交 ${fixHash}`,
    'README=' + rd.includes(fixHash) + ' / 最近更新=' + ru.includes(fixHash));
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
  const xmDetailHits = (xmDetail.match(/官方授权直营店/g) || []).length;
  const xmIndexHits = (xmIndex.match(/官方授权直营店/g) || []).length;
  check(/小米之家属于官方授权直营店/.test(xmDetail) && /上六休一/.test(xmDetail) && xmDetailHits >= 6,
    '§21p 详情页按站长口径写明「小米之家属于官方授权直营店，上六休一」（6 处口径全在）',
    `detailHits=${xmDetailHits}`);
  check(xmIndexHits >= 3,
    '§21p 首页卡片三处（休息制度 / 描述 / 红框）口径全在',
    `indexHits=${xmIndexHits}`);
  check(/不是本次 A 级评级的依据/.test(xmDetail) && /不代为合并/.test(xmDetail),
    '§21p 详情页标明门店备注不是 A 级评级依据、不代为合并口径');
  check(/recommendText: '⚠️ 小米之家（官方授权直营店）上六休一/.test(xmIndex) &&
        /小米之家（官方授权直营店）上六休一 \/ 客服轮班/.test(xmIndex),
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
  check(/<script defer src="\.\/luckin-note-patch\.js\?v=1"><\/script>/.test(idxS)
    && patchS.length > 800,
    '§21s 首页引入瑞幸提示语补丁且脚本真的存在（双重空集防护）',
    `scriptLen=${patchS.length}`);
  check(/var POLICY = '站长线下核实：上六休一（月休 4 天）'/.test(patchS)
    && /var NOTE = [^\n]*多家门店排班口径一致/.test(patchS),
    '§21s 工时政策栏写明线下核实上六休一（月休 4 天），红框写明多家门店口径一致');
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
    check(!/<img\b/i.test(plain22) && !/\.\/assets\//.test(plain22),
      '§22b 加密随笔正文不放图片、不引用仓库内素材（素材一律不上传）',
      '正文里出现 img 或仓库内素材路径 → 违反「素材不上传、只走 blob 解密渲染」');
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

  check(!/同日更早（2026-11-07 09:37）/.test(rd23)
    && !/上一批（2026-11-06）/.test(rd23)
    && !/再上一批（2026-11-04）/.test(rd23),
    '§23e README 不再堆叠逐批改动明细（完整版归 最近更新.md / CHANGELOG.md）',
    '旧的「同日更早 / 上一批 / 再上一批」整坨明细回流 README');
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
  check(/\/brand\/luxiyi\.html/.test(idx25) && /全部品牌详细页（174 个）/.test(idx25),
    '§25m noscript 清单含陆喜依且标题数字同步 174');
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
  check(/'双休红榜':\s*84/.test(read('rating-stats-patch.js')),
    '§25s 四格红榜补丁同步为 84（S 级 +1）');
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
    && /black-card-adslot\.js\?v=20/.test(idx29),
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

  check(p30.length > 0 && /<script defer src="\.\/byd-expose-patch\.js\?v=1"><\/script>/.test(idx30)
    && /不能改 bundle|不能改\s*bundle/.test(p30),
    '§30b 曝光补丁入库并挂进首页（?v=1），且写明不动压缩 bundle');

  check(/\^BYD\\s\*\\\(比亚迪\\\)/.test(p30) && /data-byd-expose/.test(p30)
    && /new MutationObserver\(schedule\)/.test(p30)
    && /requestAnimationFrame/.test(p30)
    && /div\.p-5\.space-y-3\\\\\.5/.test(p30),
    '§30c 补丁按标题定位 BYD 卡、幂等标记 + MutationObserver + rAF 兜底重渲染');

  check(/强制加班至晚十点/.test(p30) && /《劳动法》第九十六条/.test(p30)
    && /该视频现已删除/.test(p30) && /原链接已失效/.test(p30)
    && /受到了某种压力/.test(p30) && /不对指称内容作事实认定/.test(p30),
    '§30d 曝光框六条事实齐全（加班至晚十点 / 第96条 / 视频已删 / 链接失效 / 受压 / 不作事实认定）');

  check(/var NOTES_TEXT = '《站长随笔》第10章'/.test(p30)
    && /var NOTES_HREF = '\.\/notes\.html'/.test(p30)
    && !/日记/.test(p30) && !/v\.douyin\.com|https?:\/\//.test(p30),
    '§30e 随笔引用只写「详见《站长随笔》第10章」且指站内 notes.html；不抄口述、不写「日记」、不放死链外链');

  const evByd30 = (idx30.match(/<details id="ev-byd"[\s\S]*?<\/details>/) || [])[0] || '';
  const liByd30 = (byd30.match(/<li style="margin:0 0 12px"><strong>BYD 直营门店强制加班曝光[\s\S]*?<\/li>/) || [])[0] || '';
  check(liByd30.length > 0 && /该视频现已删除/.test(liByd30)
    && /原链接已失效/.test(liByd30) && /受到了某种压力/.test(liByd30)
    && /不对指称内容作事实认定/.test(liByd30)
    && !/<a href="https:\/\/v\.douyin\.com\/kKmeU180irU\//.test(byd30)
    && /v\.douyin\.com\/kKmeU180irU\//.test(liByd30),
    '§30f 详情页如实登记视频下架，失效抖音短链降级为纯文本、不再冒充可点来源');

  check(/data-n="4" data-l="2"/.test(evByd30)
    && evByd30.indexOf('该视频现已删除') !== -1
    && evByd30.indexOf('原链接已失效') !== -1
    && evByd30.indexOf('轮毂装反') !== -1
    && (evByd30.match(/（本条无可点原始链接/g) || []).length === 2,
    '§30g 公示区由生成器同步：ev-byd 4 条证据（新增澎湃轮毂装反报道）、可点链接 2 条、摘要仍写出视频下架');

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

  check(p31.length > 0 && /<script defer src="\.\/evidence-jump-patch\.js\?v=2"><\/script>/.test(idx31)
    && /不能改 bundle|不能改\s*bundle/.test(p31)
    && !/https?:\/\//.test(p31)
    && !/ev-patagonia|ev-icbc|ev-zhaoyiming|ev-byd/.test(p31),
    '§31b 跳转补丁入库并挂进首页（?v=1）；不动压缩 bundle、不写死品牌 URL / 品牌 id 清单');

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
    && /black-card-adslot\.js\?v=20/.test(idx32),
    '§32b 广告位所有可见文案统一「公益广告位」，旧「广告位招商中」/「品牌展示」清零，?v 升 13');

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
    && /douyin-prompt\.css\?v=13/.test(idx32),
    '§32d 广告位层级 9995 / 底部留白 14px；.dyp 遮罩减淡去模糊，弹窗引流功能原样保留');

  check(/var SEARCH_DURATION = 6000/.test(ff32)
    && /正在加载缓存，请稍后/.test(ff32)
    && /forcedUntil/.test(ff32) && /startCountdown/.test(ff32)
    && /filter-flash\.js\?v=7/.test(idx32)
    && /forcedUntil/.test(scof32)
    && /search-clear-order-fix\.js\?v=3/.test(idx32),
    '§32e 搜索删空强制 6 秒 + 倒计时 + 硬 deadline；两侧契约同改、缓存号都 bump');

  check(news32.length > 0
    && /<script defer src="\.\/news-incident-patch\.js\?v=2"><\/script>/.test(idx32)
    && /var ITEMS = \[/.test(news32) && /key: 'logitech'/.test(news32) && /key: 'xingyu'/.test(news32)
    && /new MutationObserver\(schedule\)/.test(news32)
    && /不能改 bundle/.test(news32)
    && !/https?:\/\//.test(news32),
    '§32f 新闻登记补丁配置驱动两张内置卡，幂等 + 重渲染兜底，卡片零外链、不碰 bundle');

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
  check(preload35 && /black-card-adslot\.js\?v=20/.test(idx35),
    '§35c 手机三图带 media 预热、?v 与脚本 *_MOBILE 常量一致，首页脚本已升 13',
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

  // ② 友链区新增 JEV 仓库链接 + 筛选摘要描述（边逛边猜工作制、疑似非双休盖 PASS）
  check(flf36f.indexOf('https://github.com/littlewindy123/jev-weekend-shopping-chrome') !== -1
    && flf36f.indexOf('JEV') !== -1
    && /边逛|盖章|双休筛选|PASS/.test(flf36f),
    '§36f 友链区新增 JEV 双休筛选浏览器插件链接 + 筛选摘要描述',
    '友链没加 JEV 仓库 / 描述不是筛选摘要 → 站长「给他做个友链 + 筛选摘要挂友链区」失守');

  // ③ 该友链为单向（对方无 Website，不要求互挂）；JEV 条目本身不写互惠/互挂口径。
  //    注意：friend-links-footer.js 第 83 行有一段历史注释「互惠链接」（解释源码块为何单放，
  //    与本站单向友链政策一致，不是互挂口径），所以只扫描 JEV 条目自身窗口，不扫全文件。
  const jevIdx36f = flf36f.indexOf('jev-weekend-shopping-chrome');
  const jevBlock36f = jevIdx36f === -1 ? '' : flf36f.slice(Math.max(0, jevIdx36f - 400), jevIdx36f + 400);
  check(!/互挂|互惠|reciprocal/i.test(jevBlock36f),
    '§36f 友链为单向（对方无 Website，不要求互挂），JEV 条目不写互惠口径',
    'JEV 条目写成互惠/互挂 → 与「不要求互挂」矛盾');

  // ④ 两个脚本在 index.html 的 ?v 随内容变更 bump，否则浏览器缓存旧脚本
  check(/black-card-adslot\.js\?v=20/.test(idx36f)
    && /friend-links-footer\.js\?v=16/.test(idx36f),
    '§36f 两个脚本在 index.html 的 ?v 已随内容变更 bump 到 16',
    '?v 没 bump → 浏览器缓存旧脚本，新文案 / 新友链不生效');
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
  check(/mobile-fixes\.css\?v=15/.test(idx36g),
    '§36g mobile-fixes.css 的 ?v 已随本次改动 bump 到 15',
    '?v 没 bump → 浏览器缓存旧 CSS，预留列宽不生效');
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
  check(/black-card-adslot\.js\?v=20/.test(idx36h),
    '§36h black-card-adslot.js 的 ?v 已 bump 到 18（浏览器缓存旧脚本会吃掉本次修复）',
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
  check(/black-card-adslot\.js\?v=20/.test(idx36k),
    '§36k black-card-adslot.js 的 ?v 已 bump 到 18（浏览器缓存旧脚本会吃掉本次改动）',
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
  check(/featured-douyin\.js\?v=5/.test(idx36m),
    '§36m featured-douyin.js 的 ?v 已 bump 到 5（浏览器缓存旧脚本会吃掉本次改动）',
    '?v 没 bump → 旧脚本仍按旧 VIDEOS 渲染，dead 标记与《磨囚》都不生效');
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
    /2026-11-11\s*起执行/.test(ad36n),
    '§36n 公益广告位底部免责脚注（AI 生成图 + 站长人工核实产线须双休 + 不靠联网 + issue 递交实证申请上刊 + 2026-11-11 起执行）',
    '脚注文案缺失 → 访客无法得知图片是 AI 生成、企业信息由站长人工核实、如何申请上刊');
  check(/black-card-adslot\.js\?v=20/.test(idx36n),
    '§36n black-card-adslot.js 的 ?v 已 bump 到 19（浏览器缓存旧脚本会吃掉本次脚注）',
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

// ---------- 36p. 窄屏左下两枚悬浮圆钮并入右侧 76px 留白列（2026-11-12 站长） ----------
{
  const mf36p = exists('mobile-fixes.css') ? stripCssComments(read('mobile-fixes.css')) : '';
  const idx36p = read('index.html');
  // §36j 只留了右列，左下角 #sxg-ai-fab / #sxg-nav 仍压住品牌卡与证据公示区正文。
  // 不能靠「整页再左留白」解决：真渲染实测内容 390-76-70=244px / 缩钮后 270px，
  // 品牌卡深色块内文字被挤成竖排。故两枚并入右列，内容仍 314px 满宽。
  const aiOk = /#sxg-ai-fab\s*\{[^}]*left:\s*auto\s*!important[^}]*right:\s*14px\s*!important[^}]*bottom:\s*calc\([^}]*210px/.test(mf36p);
  const navOk = /#sxg-nav\s*\{[^}]*left:\s*auto\s*!important[^}]*right:\s*14px\s*!important[^}]*bottom:\s*calc\([^}]*335px/.test(mf36p);
  const panelOk = /#sxg-ai-panel\s*\{[^}]*276px/.test(mf36p)
    && /#sxg-nav-panel\s*\{[^}]*right:\s*0\s*!important/.test(mf36p);
  check(aiOk && navOk && panelOk && !/body\s*\{[^}]*padding-left/.test(mf36p),
    '§36p 窄屏左下两枚圆钮并入右侧 76px 留白列（AI +210 / 菜单 +335），面板同步右锚定，整页不再左侧扣宽',
    '左钮仍在 left:14px 或又整页左留白 → 品牌卡正文被压 / 内容被夹成 244–270px 窄条');
  check(/mobile-fixes\.css\?v=15/.test(idx36p),
    '§36p mobile-fixes.css 的 ?v 已 bump 到 15（左钮并入右列靠新 CSS 生效）',
    '?v 没 bump → 浏览器缓存旧 CSS，左钮仍在左下角压内容');
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
