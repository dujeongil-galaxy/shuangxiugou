#!/usr/bin/env node
/* ============================================================
 * 从 brand/*.html 提取 190 家企业评级摘要，生成 AI 提示词数据快照。
 *
 * 站长要求（2026-11-22）：AI 能查双休数据（引用本站数据）、支持找工作；
 * 快照要同步进三处：labor-ai.html 的 SYSTEM_PROMPT、ai-worker/src/worker.js
 * 的 BRAND_DATA_SNIPPET、ai-worker-aliyun/index.mjs 的 BRAND_DATA_SNIPPET。
 *
 * 用法：node scripts/extract-brand-prompt.mjs
 *   默认只打印 diff 概要；--write 同时写入三个目标文件。
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BRAND_DIR = path.join(ROOT, 'brand');

function clean(s) {
  if (!s) return '';
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
}

const NAME_FIX = {
  '- Meituan：': '- 美团 (Meituan)：', '- Tencent：': '- 腾讯 (Tencent)：',
  '- BYD：': '- 比亚迪 (BYD)：', '- Apple：': '- 苹果 (Apple)：',
  '- Microsoft：': '- 微软 (Microsoft)：', '- IKEA：': '- 宜家 (IKEA)：',
  '- SAP：': '- SAP（思爱普）：', '- Volvo：': '- 沃尔沃 (Volvo)：',
  '- Starbucks：': '- 星巴克 (Starbucks)：', '- Logitech：': '- 罗技 (Logitech)：',
  '- Sony：': '- 索尼 (Sony)：', '- Decathlon：': '- 迪卡侬 (Decathlon)：',
  '- Uniqlo：': '- 优衣库 (Uniqlo)：', '- The North Face：': '- 北面 (The North Face)：',
  '- Philips Automotive：': '- 飞利浦车用 (Philips)：', '- OSRAM：': '- 欧司朗 (OSRAM)：',
};

function extractOne(file) {
  const html = fs.readFileSync(file, 'utf-8');
  const slug = path.basename(file, '.html');
  const rate = (html.match(/双休率([0-9.]+)%/) || [])[1] || null;
  const off = (html.match(/平均下班时间\s*([0-9]{1,2}:[0-9]{2})/) || [])[1] || null;
  const nameM = html.match(/<title>([^<｜]+?)(\s*几点下班|\s*双休率)/);
  let name = nameM ? clean(nameM[1]) : slug;
  name = name.replace(/\s+双休吗$/, '');
  let tier = null, tierDesc = null;
  const d = html.match(/name="description" content="[^"]*?([SABCDU])\s*级[^。"]{0,80}/);
  if (d) {
    tier = d[1];
    const m2 = html.match(/name="description" content="[^"]*?[SABCDU]\s*级\s*[·（]([^。"）]*)/);
    if (m2) tierDesc = clean(m2[1]);
  } else {
    const b2 = html.match(/本卡档位为\s*([SABCDU])\s*级（([^）]*)）/);
    const b = html.match(/class="badge"[^>]*>([SABCDU])\s*级/);
    if (b2) { tier = b2[1]; tierDesc = clean(b2[2]); }
    else if (b) tier = b[1];
  }
  // 奇瑞：曾定 D 级，2026-11-03 站长回退为 C 级（首页口径以 C 为准）
  if (slug === 'chery' && html.includes('回退为 C 级')) { tier = 'C'; tierDesc = '曾定 D 级，2026-11-03 站长回退为 C 级（避雷预警）'; }
  return { slug, name, tier, tierDesc, rate, off };
}

function buildLines(rows) {
  const lines = [];
  for (const r of rows) {
    if (!r.tier) continue;
    const parts = [r.tier + '级'];
    if (r.rate) parts.push('双休率' + r.rate + '%');
    if (r.off) parts.push('下班' + r.off);
    let td = r.tierDesc || '';
    const firstSeg = td.split(/[（。；]/)[0].trim();
    const isBoiler = /按本站月休口径换算/.test(td) || /站长人工介入/.test(td);
    if (!isBoiler && firstSeg && !['模范标杆，严格双休', '合规双休，接近 965', '数据存疑'].includes(firstSeg)) {
      parts.push(firstSeg);
    }
    if (firstSeg === '模范标杆，严格双休') parts.push('严格双休标杆');
    if (firstSeg === '合规双休，接近 965') parts.push('合规双休接近965');
    if (firstSeg === '数据存疑') parts.push('数据存疑');
    let suffix = '';
    if (/按本站月休口径换算/.test(td)) suffix = '（口径换算）';
    if (/站长人工介入/.test(td)) suffix = '（站长人工介入）';
    // 品牌专属页 slug（2026-11-22 站长要求）：用户问具体品牌时 AI 要给该品牌的
    // 专属页面链接，不能只给首页。这里把文件名带进快照，让 AI 照抄 slug 拼链接，
    // 而不是自己按中文名猜（此前有过 AI 拼造假网址的教训）。
    lines.push('- ' + r.name + '：' + parts.join('，') + suffix + '｜页:' + r.slug);
  }
  let text = lines.join('\n');
  for (const [a, b] of Object.entries(NAME_FIX)) text = text.replace(a, b);
  return text;
}

/* ---------- 三处注入 ---------- */
function chunkLines(text, per = 12) {
  const ls = text.split('\n');
  const out = [];
  for (let i = 0; i < ls.length; i += per) out.push(ls.slice(i, i + per).join('\\n'));
  return out;
}

function replaceBetween(src, startMarker, endMarker, replacement, label) {
  const s = src.indexOf(startMarker);
  if (s < 0) throw new Error(label + ': start marker not found');
  const e = src.indexOf(endMarker, s);
  if (e < 0) throw new Error(label + ': end marker not found');
  return src.slice(0, s) + replacement + src.slice(e + endMarker.length);
}

function makeSnippetArray(text) {
  return 'const BRAND_DATA_SNIPPET = [\n  ' +
    chunkLines(text).map(l => "'" + l + "'").join(',\n  ') +
    ",\n].join('\\n');";
}

function makeLaborChunk(text) {
  const header = '  "【双休数据查询】用户想了解某公司/品牌的双休情况、下班时间、评级时，以下面这份数据为准回答（收录 190 家企业，S/A/B/C/D 为评级档，U 为证据不足未评级；「口径换算」表示由月休天数推算而非实测双休率）：",';
  const chunks = chunkLines(text).map(l => '  "' + l + '",').join('\n');
  // 网址约束（2026-11-22 fix 55143c65）：AI 曾编造 www.shuangxiugou.com 假网址；
  // footer1 必须带真实官方地址与禁拼造声明，--write 重生成时才不会把这条冲掉。
  const bossRule = '特别写死：只要用户提问中出现「Boss直聘」（包括 Boss 直聘、BOSS直聘、boss直聘、boss 直聘、Boss直聘 等大小写或空格变体），无论他问的是什么，都不要自行组织回答，直接只给这一个固定链接 https://dujeongil-galaxy.github.io/shuangxiugou/brand/bosszhipin.html#note-manual-override ，不要套用上面的普通品牌页规则、不要丢掉 #note-manual-override 锚点、不要改成首页或其它链接、不要添加多余解释；这条优先级最高，压过上面所有关于品牌链接和回答方式的说明。';
  const footer1 = '  "这份数据可能滞后，回答时注明「数据以双休购站点实时页面为准」；用户问到站点未收录的企业时，如实说明未收录，不要编造评级，可建议他用站内搜索或等站长补录。本站唯一官方地址是 https://dujeongil-galaxy.github.io/shuangxiugou/ ，提到本站或引导查询时只能用这个完整地址，不要自行拼造、猜测或改写域名（包括把站名拼成看似合理的 .com 网址），拿不准就不写网址。用户问到上面收录的某个具体品牌/企业时，回答末尾附上该品牌的专属页面链接，格式为 https://dujeongil-galaxy.github.io/shuangxiugou/brand/页.html ——其中「页」严格照抄该品牌数据行末尾「｜页:」后面的英文 slug（如华为是 huawei、苹果是 apple），不得按中文名自行拼写或改写；只给首页不算，这个链接是品牌专属详情页、不是首页底部的证据链公示入口。' + bossRule + '",';
  const footer2 = '  "引用数据时说明出处是双休购的证据链评级（司法文书、劳动监察通报、ESG 报告、招聘口径、员工反馈等），评级只反映休息制度、不构成对企业的法律定性；数据有异议可走 GitHub Issues 申诉。",';
  return header + '\n' + chunks + '\n' + footer1 + '\n' + footer2;
}

function main() {
  const write = process.argv.includes('--write');
  const files = fs.readdirSync(BRAND_DIR).filter(f => f.endsWith('.html')).sort()
    .map(f => path.join(BRAND_DIR, f));
  const rows = files.map(extractOne);
  const tiers = {};
  for (const r of rows) tiers[r.tier] = (tiers[r.tier] || 0) + 1;
  const text = buildLines(rows);
  const count = text.split('\n').length;
  console.log('brand pages:', rows.length, '→ prompt lines:', count);
  console.log('tiers:', JSON.stringify(tiers));
  if (count !== rows.length) throw new Error('some pages lost tier info!');

  if (!write) {
    console.log('\n(dry-run) 快照前 5 行：');
    console.log(text.split('\n').slice(0, 5).join('\n'));
    console.log('\n加 --write 写入 labor-ai.html / ai-worker/src/worker.js / ai-worker-aliyun/index.mjs');
    return;
  }

  // 1) labor-ai.html：【双休数据查询】块（从块头到申诉行）
  const laPath = path.join(ROOT, 'labor-ai.html');
  let la = fs.readFileSync(laPath, 'utf-8');
  const laStart = '  "【双休数据查询】用户想了解某公司/品牌的双休情况、下班时间、评级时，以下面这份数据为准回答';
  const laEnd = '引用数据时说明出处是双休购的证据链评级（司法文书、劳动监察通报、ESG 报告、招聘口径、员工反馈等），评级只反映休息制度、不构成对企业的法律定性；数据有异议可走 GitHub Issues 申诉。",';
  la = replaceBetween(la, laStart, laEnd, makeLaborChunk(text), 'labor-ai.html');
  fs.writeFileSync(laPath, la, 'utf-8');
  console.log('✓ labor-ai.html');

  // 2) CF worker / 3) 阿里云 worker：替换 BRAND_DATA_SNIPPET 数组
  for (const rel of ['ai-worker/src/worker.js', 'ai-worker-aliyun/index.mjs']) {
    const p = path.join(ROOT, rel);
    let src = fs.readFileSync(p, 'utf-8');
    src = replaceBetween(src, 'const BRAND_DATA_SNIPPET = [', "].join('\\n');", makeSnippetArray(text), rel);
    fs.writeFileSync(p, src, 'utf-8');
    console.log('✓ ' + rel);
  }
  console.log('三处快照已同步，记得跑 node scripts/test-ai-worker.cjs 与 verify.mjs。');
}

main();
