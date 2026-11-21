#!/usr/bin/env node
/**
 * gen-ai-seo.mjs —— 全站「专属 SEO + AI 可读」生成器（2026-11-21 站长指令）
 *
 * 背景
 * ----
 * 站长要求：不是只给华为 / 比亚迪 / 奶茶品牌做 SEO，而是**本站已收录的、
 * 包括未来收录的每一个页面**都要有专属 SEO，并让 Copilot / Gemini / ChatGPT
 * 这类 AI 能推荐本站。
 *
 * 为什么需要生成器（而不是手工补一遍）
 * ------------------------------------
 * 手工补一次，下一次新增页面必然漏。这个脚本把规则做成机器流程：
 *   ① 扫描根目录 + brand/ 下所有 HTML；
 *   ② 只处理「核心 SEO 缺项」的页面（title / description / og:title /
 *      canonical / JSON-LD 任一缺失）——核心已齐的品牌页一律不动，
 *      避免无意义地改写 190 个文件；
 *   ③ 用 <!-- SXG-AISEO:BEGIN/END --> 包住注入块，幂等可重跑；
 *   ④ 缺什么补什么：og:* / twitter:* / canonical / WebSite+Organization+
 *      WebPage 结构化数据，内容全部取自该页自己的 title/description；
 *   ⑤ noindex 页、Google 验证文件、notes.html 一律跳过；
 *   ⑥ --check 模式只报错不改文件，给 verify.mjs 与 CI 用。
 *
 * 诚实边界
 * --------
 * · 不写 og:image —— §25h 规定 qq-nainai.html 不得引用 assets；统一不注入图片。
 * · 不改已有 title / description / canonical —— 那是页面自己的真相源，只读不写。
 * · 不覆盖已有 JSON-LD —— 品牌页已有 Article schema，重复注入会互相打架。
 * · 本脚本 + llms.txt + robots.txt + verify 断言构成四层；但 Google 已公开
 *   表示不读 llms.txt，AI 是否推荐取决于索引、内容质量与站外提及，脚本只保证
 *   「机器能读懂、爬虫能进来」，不承诺排名。这点写进 llms.txt 的 Optional 段。
 *
 * 用法
 * ----
 *   node scripts/gen-ai-seo.mjs          写回缺项页面
 *   node scripts/gen-ai-seo.mjs --check  只检查，缺核心项则 exit 1（CI / verify 调用）
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK_ONLY = process.argv.includes('--check');
const BASE = 'https://dujeongil-galaxy.github.io/shuangxiugou/';
const SITE_NAME = '双休购 ShuangxiuGo';
const BEGIN = '<!-- SXG-AISEO:BEGIN -->';
const END = '<!-- SXG-AISEO:END -->';

// 与 verify.mjs 的 SEO 白名单同口径：noindex 页 / Google 验证文件 / 加密笔记跳过。
// 按「扫目录 + 排除名单」实现，将来新增页面自动纳入。
const SKIP = new Set([
  '404.html', 'discussion-closed.html', 'googlea540a6c2cd5f0e6c.html',
  'notes.html', 'notes-plaintext-preview.html', 'remind-original.html',
  'sponsor.html', 'ua-check.html', 'usdt-guide.html',
]);

function decodeEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ').trim();
}
function extract(html) {
  const titleTag = html.match(/<title>([\s\S]*?)<\/title>/i);
  const descTag = html.match(/<meta\s+name="description"\s+content="([^"]*)"[^>]*>/i)
    || html.match(/<meta\s+content="([^"]*)"\s+name="description"[^>]*>/i);
  const canonTag = html.match(/<link\s+rel="canonical"\s+href="([^"]*)"[^>]*>/i);
  const robotsTag = html.match(/<meta\s+name="robots"\s+content="([^"]*)"[^>]*>/i);
  return {
    title: decodeEntities(titleTag ? titleTag[1] : ''),
    description: decodeEntities(descTag ? descTag[1] : ''),
    canonical: canonTag ? canonTag[1].trim() : '',
    robots: robotsTag ? robotsTag[1].toLowerCase() : '',
  };
}
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 核心五要素是否齐全。齐全则本脚本不碰该页（品牌页 190 个全在此列）。 */
function coreComplete(html) {
  return /<title>[^<]{5,}<\/title>/i.test(html)
    && /<meta\s+name="description"\s+content="[^"]{20,}"/i.test(html)
    && /<meta\s+property="og:title"/i.test(html)
    && /<link\s+rel="canonical"/i.test(html)
    && /<script\s+type="application\/ld\+json"/i.test(html);
}

/** 给核心缺项的页面算注入块（内容取自页面自身 title/description）。 */
function blockFor(html, rel, info) {
  const url = info.canonical || (BASE + rel);
  const lines = [];
  if (!/<meta\s+property="og:title"/i.test(html)) {
    lines.push('<meta property="og:title" content="' + esc(info.title) + '" />');
  }
  if (info.description && !/<meta\s+property="og:description"/i.test(html)) {
    lines.push('<meta property="og:description" content="' + esc(info.description) + '" />');
  }
  if (!/<meta\s+property="og:url"/i.test(html)) {
    lines.push('<meta property="og:url" content="' + esc(url) + '" />');
  }
  if (!/<meta\s+property="og:type"/i.test(html)) {
    lines.push('<meta property="og:type" content="' + (rel.startsWith('brand/') || /report/.test(rel) ? 'article' : 'website') + '" />');
  }
  if (!/<meta\s+property="og:site_name"/i.test(html)) {
    lines.push('<meta property="og:site_name" content="' + SITE_NAME + '" />');
  }
  if (!/<meta\s+name="twitter:card"/i.test(html)) {
    lines.push('<meta name="twitter:card" content="summary" />');
  }
  if (!/<meta\s+name="twitter:title"/i.test(html)) {
    lines.push('<meta name="twitter:title" content="' + esc(info.title) + '" />');
  }
  if (info.description && !/<meta\s+name="twitter:description"/i.test(html)) {
    lines.push('<meta name="twitter:description" content="' + esc(info.description) + '" />');
  }
  if (!info.canonical) {
    lines.push('<link rel="canonical" href="' + esc(url) + '" />');
  }
  if (!/<script\s+type="application\/ld\+json"/i.test(html)) {
    const graph = {
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'Organization', '@id': BASE + '#organization', name: SITE_NAME, url: BASE },
        { '@type': 'WebSite', '@id': BASE + '#website', url: BASE, name: SITE_NAME,
          publisher: { '@id': BASE + '#organization' }, inLanguage: 'zh-CN' },
        { '@type': 'WebPage', '@id': url + '#webpage', url: url, name: info.title,
          description: info.description, inLanguage: 'zh-CN',
          isPartOf: { '@id': BASE + '#website' } },
      ],
    };
    lines.push('<script type="application/ld+json">\n' + JSON.stringify(graph, null, 2) + '\n</script>');
  }
  return lines.length ? BEGIN + '\n' + lines.join('\n') + '\n' + END : '';
}

function stripOld(html) {
  const b = BEGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const e = END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return html.replace(new RegExp(b + '[\\s\\S]*?' + e + '\\s*', 'g'), '');
}

const targets = [];
for (const f of readdirSync(ROOT)) {
  if (!f.endsWith('.html') || SKIP.has(f)) continue;
  targets.push(f);
}
if (existsSync(join(ROOT, 'brand'))) {
  for (const f of readdirSync(join(ROOT, 'brand'))) {
    if (f.endsWith('.html')) targets.push('brand/' + f);
  }
}

const incomplete = [];
let written = 0, complete = 0;
for (const rel of targets) {
  const abs = join(ROOT, rel);
  const before = readFileSync(abs, 'utf8');
  const info = extract(before);
  if (info.robots.includes('noindex')) continue;
  if (coreComplete(before)) { complete++; continue; }
  incomplete.push(rel);
  if (CHECK_ONLY) continue;
  const clean = stripOld(before);
  const block = blockFor(clean, rel, extract(clean));
  if (block && /<\/head>/i.test(clean)) {
    writeFileSync(abs, clean.replace(/<\/head>/i, '  ' + block + '\n</head>'), 'utf8');
    written++;
  }
}

if (CHECK_ONLY) {
  if (incomplete.length) {
    console.error('[gen-ai-seo --check] ' + incomplete.length + ' 页缺核心 SEO：');
    console.error(incomplete.join('\n'));
    console.error('修复：node scripts/gen-ai-seo.mjs');
    process.exit(1);
  }
  console.log('[gen-ai-seo --check] ' + targets.length + ' 页扫描完成，核心 SEO 全齐（核心已齐 ' + complete + ' 页未改）');
} else {
  console.log('[gen-ai-seo] 扫描 ' + targets.length + ' 页：核心已齐跳过 ' + complete + '，补齐 ' + written + '，跳过名单 ' + SKIP.size);
}
