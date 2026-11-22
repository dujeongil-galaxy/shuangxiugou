// 【本机专用 · 不挂 CI】当前 PAT 无 workflow scope，改 CI 会被远端拒推；故本机跑、不进 CI（verify §21o 咬此标记）。
/* ==========================================================================
   test-ai-md.cjs —— labor-ai.html 的 md() 链接渲染安全测试
   --------------------------------------------------------------------------
   为什么要单独测：2026-11-22 站长发现 AI 返回的 [文字](网址) 原样显示成文本、
   点不开。根因是 md() 只处理加粗/列表、不认识链接语法。修复后必须锁死：
     ① [文字](http(s)网址) → 可点 <a>（target=_blank + rel=noopener）
     ② 裸网址 http(s)://... → 可点
     ③ javascript:/data:/vbscript: 等危险协议 → 原样文本、绝不成链
     ④ href 引号注入被转义，不能逃出属性
     ⑤ 已有加粗/数字列表不被破坏，流式逐字片段渲染不报错
   抽 HTML 里的 esc()/md() 源码用 new Function 真跑，避免只做静态字符串断言。
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'labor-ai.html'), 'utf8');

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name + (detail !== undefined ? ' → ' + JSON.stringify(detail) : '')); }
}

// 抽取 esc() 与 md() 两个函数源码，拼成一个可调用的 md
function extractMd() {
  const esc = HTML.match(/function esc\(s\)\{[\s\S]*?\n\}/);
  const md = HTML.match(/function md\(s\)\{[\s\S]*?\n\}/);
  if (!esc || !md) throw new Error('esc() 或 md() 未找到');
  // md() 内含嵌套函数与多行，非贪婪 \n\} 在第一个顶格 } 停——确认抽到的是完整函数
  if (!/held\[\+i\]/.test(md[0]) || !/safeUrl/.test(md[0])) {
    throw new Error('md() 抽取不完整（缺占位符还原段）：' + md[0].slice(-80));
  }
  return new Function(esc[0] + '\n' + md[0] + '\nreturn md;')();
}

const md = extractMd();

console.log('\n=== md() 链接渲染安全测试 ===');

// ① Markdown 链接
{
  const out = md('请见 [本站](https://dujeongil-galaxy.github.io/shuangxiugou/) 核实。');
  check('① Markdown 链接生成 <a> 标签',
    /<a href="https:\/\/dujeongil-galaxy\.github\.io\/shuangxiugou\/"/.test(out), out);
  check('① 外链带 target=_blank + rel=noopener noreferrer',
    /target="_blank" rel="noopener noreferrer"/.test(out), out);
  check('① 链接文字保留', /<a [^>]+>本站<\/a>/.test(out), out);
}

// 截图里的真实格式：[长网址](长网址)
{
  const url = 'https://dujeongil-galaxy.github.io/shuangxiugou/';
  const out = md('请进站核实最新数据：[' + url + '](' + url + ')。');
  const aCount = (out.match(/<a /g) || []).length;
  check('① 截图格式 [网址](网址) 只生成一个 <a>（占位符防二次包裹）', aCount === 1, { aCount, out });
  check('① 标签后中文句号不在 href 内', /<\/a>。/.test(out), out);
}

// ② 裸网址
{
  const out = md('数据来自 https://example.com/a/b，仅供参考。');
  check('② 裸网址生成 <a>', /<a href="https:\/\/example\.com\/a\/b"/.test(out), out);
  check('② 裸网址结尾中文逗号被剔除（不在 href 内）', /<\/a>，仅供参考/.test(out), out);
}

// ③ 危险协议绝不成链
{
  const cases = [
    '[点我](javascript:alert(1))',
    '[点我](data:text/html;base64,PHNjcmlwdD4=)',
    '[点我](vbscript:msgbox(1))',
    'javascript:alert(1)',
  ];
  let allSafe = true, detail = [];
  for (const c of cases) {
    const out = md(c);
    const hasA = /<a\b/i.test(out);
    if (hasA) { allSafe = false; detail.push({ input: c, out }); }
  }
  check('③ javascript:/data:/vbscript: 等危险协议一律不成链', allSafe, detail);
}

// ④ 属性注入（引号/尖括号）
{
  const out = md('[x](https://a.com/" onmouseover="alert(1))');
  // 单引号/双引号被转义成实体，无法逃出 href 属性
  check('④ href 内引号被转义，无法注入 onmouseover',
    !/onmouseover="alert\(1\)"/.test(out) || /&quot;/.test(out), out);
  // 判据：onmouseover 不出现在任何 <a ...> 开标签内部（出现在标签外的普通文本里无害）
  check('④ 危险注入串未进入 <a> 标签属性',
    !/<a[^>]*onmouseover/i.test(out), out);
}

// ⑤ 加粗/列表共存 + 流式片段
{
  const out = md('**重点**：\n1. 第一步，见 [官网](https://example.com)。');
  check('⑤ 加粗仍在', /<b>重点<\/b>/.test(out), out);
  check('⑤ 数字列表仍在', /<b>1\.<\/b>/.test(out), out);
  check('⑤ 链接仍在', /<a href="https:\/\/example\.com"/.test(out), out);
  // 流式逐字：每次喂半截都应产生合法字符串（不抛异常）
  let threw = false;
  try {
    const full = '见 [本站](https://example.com) 核实。';
    for (let i = 0; i <= full.length; i++) md(full.slice(0, i));
  } catch (e) { threw = true; }
  check('⑤ 流式逐字片段渲染全程不抛异常', !threw);
}

console.log('\n========== 结果：' + passed + ' 项通过，' + failed + ' 项失败 ==========');
process.exit(failed ? 1 : 0);
