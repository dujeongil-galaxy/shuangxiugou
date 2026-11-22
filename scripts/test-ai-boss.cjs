// 【本机专用 · 不挂 CI】当前 PAT 无 workflow scope，改 CI 会被远端拒推；故本机跑、不进 CI（verify §21o 咬此标记）。
/* ==========================================================================
   test-ai-boss.cjs —— 「Boss直聘」关键词写死规则测试
   --------------------------------------------------------------------------
   2026-11-22 站长定规：任何提问只要含「Boss直聘」（大小写/空格/间隔变体），
   前端直接返回固定链接，不调用 AI、不受限流/附件/Key 影响；三线路提示词
   同步写死同一条规则作兜底。本测试从 labor-ai.html 抽 isBossHit() 源码真跑：
     ① 各种大小写/空格/间隔写法都命中
     ② 不含该词的普通问题不误伤
     ③ 固定文案里的裸网址经 md() 渲染成可点 <a>（带锚点、noopener）
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'labor-ai.html'), 'utf8');
const WORKER = fs.readFileSync(path.join(ROOT, 'ai-worker/src/worker.js'), 'utf8');
const ALI = fs.readFileSync(path.join(ROOT, 'ai-worker-aliyun/index.mjs'), 'utf8');

const BOSS_URL = 'https://dujeongil-galaxy.github.io/shuangxiugou/brand/bosszhipin.html#note-manual-override';
const RULE_FRAG = '特别写死：只要用户提问中出现「Boss直聘」';
let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name + (detail !== undefined ? ' → ' + JSON.stringify(detail) : '')); }
}

// 抽 isBossHit() 源码真跑
function extractIsBossHit() {
  const m = HTML.match(/function isBossHit\(text\)\{[\s\S]*?\n\}/);
  if (!m) throw new Error('isBossHit() 未找到');
  return new Function(m[0] + '\nreturn isBossHit;')();
}
// 抽 md() 与 esc()（复用与 test-ai-md.cjs 相同的提取法）
function extractMd() {
  const esc = HTML.match(/function esc\(s\)\{[\s\S]*?\n\}/);
  const md = HTML.match(/function md\(s\)\{[\s\S]*?\n\}/);
  if (!esc || !md) throw new Error('esc()/md() 未找到');
  return new Function(esc[0] + '\n' + md[0] + '\nreturn md;')();
}

const isBossHit = extractIsBossHit();
const md = extractMd();
// 常量源码含 \n 转义序列：必须在 new Function 里求值，不能拿源码文本（否则 \n 是字面两字符）
const fixedDecl = (HTML.match(/var BOSS_FIXED_ANSWER = "[^"]+";/) || [''])[0];
if (!fixedDecl) throw new Error('BOSS_FIXED_ANSWER 常量未找到');
const fixed = new Function(fixedDecl + '\nreturn BOSS_FIXED_ANSWER;')();

console.log('\n=== Boss直聘 写死规则测试 ===');

// ① 命中变体
{
  const hits = [
    'Boss直聘靠谱吗', 'boss直聘怎么样', 'BOSS直聘 加班多吗',
    '我在Boss 直聘上找工作靠谱吗', 'BOSS 直聘 的双休如何',
    'boss 直聘', 'Boss直聘', '请问 boss直 聘 这个平台',
  ];
  hits.forEach(function(q){
    check('命中：' + q, isBossHit(q) === true, q);
  });
}

// ② 不误伤普通问题
{
  const misses = [
    '华为加班吗', '苹果双休如何', '劳动法第几条规定的加班费',
    'Boss 这个英文名怎么样', '帮我写一份简历', '蜜雪冰城月休几天',
    '',
  ];
  misses.forEach(function(q){
    check('不误伤：' + (q || '（空）'), isBossHit(q) === false, q);
  });
}

// ③ 固定文案内容 + md 渲染成可点链接
{
  check('固定文案含裸网址且带锚点', fixed.includes(BOSS_URL), fixed);
  const html = md(fixed);
  check('md 渲染出 <a> 链接', /<a href=/.test(html), html);
  check('链接 href 带 #note-manual-override 锚点', html.includes('bosszhipin.html#note-manual-override'), html);
  check('外链带 target=_blank + rel=noopener noreferrer', /target="_blank" rel="noopener noreferrer"/.test(html), html);
  check('没有 markdown 源码残留 [](...)', !/\[[^\]]*\]\(http/.test(html), html);
}

// ④ 三线路提示词逐字写死同一规则
{
  [['前端', HTML], ['CF Worker', WORKER], ['阿里云', ALI]].forEach(function(pair){
    check(pair[0] + ' 提示词含写死规则 + 固定链接',
      pair[1].includes(RULE_FRAG) && pair[1].includes(BOSS_URL),
      pair[0]);
  });
}

console.log('\n========== 结果：' + passed + ' 项通过，' + failed + ' 项失败 ==========');
process.exit(failed ? 1 : 0);
