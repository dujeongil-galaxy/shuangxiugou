#!/usr/bin/env node
/**
 * 品牌详情页的「车外费用」备注注入（scripts/seo/inject-etc-fee-note.mjs）
 *
 * 用途：给站内新能源车品牌详情页统一加一条备注，指向站长的另一个项目
 * 「各车企 ETC / 城市 NOA / 附加费用对比」。买车的人除了看双休与工时，
 * 还要看车外要掏的钱：内置 ETC 开通费、城市 NOA 是一次性买断还是按月订阅、
 * 座椅加热等附加费用。
 *
 * 为什么单独写脚本而不改 generate-brand-pages.py：
 *   仓库里 brand/ 下的详情页是逐页维护的（title/h1 走「几点下班」口径，
 *   与生成脚本模板不一致，且脚本会先清空整个 brand/ 目录再全量重建），
 *   跑生成脚本会覆盖现有人工内容。这里只做**定点追加**，不碰任何既有内容。
 *
 * 目标页（8 个，与首页品牌卡一一对应）：
 *   xiaomi-auto / wenjie / jike / byd / lixiang / nio / xiaopeng / leapmotor
 *   小米集团页（xiaomi.html）不在列——那个站讲的是车，不是手机与 IoT。
 *
 * 幂等：注入块带 data-sxg-etc-fee-note 标记，重复执行不会重复插入。
 * 用法：node scripts/seo/inject-etc-fee-note.mjs [--check]
 *       --check 只检查不写文件（用于 CI / 回归）
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const MARK = 'data-sxg-etc-fee-note';
const LINK = 'https://dujeongil-galaxy.github.io/etc-fee-comparison/';

const TARGETS = [
  'xiaomi-auto',
  'wenjie',
  'jike',
  'byd',
  'lixiang',
  'nio',
  'xiaopeng',
  'leapmotor'
];

const NOTE_HTML =
  `<div ${MARK}="1" style="margin:16px 0;padding:10px 12px;border:1px solid #bbf7d0;` +
  `background:#f0fdf4;border-radius:10px;font-size:13.5px;line-height:1.8;color:#166534">` +
  `<strong>准备买这台车？</strong>先算清车外要掏的钱：内置 ETC 开通费、城市 NOA 是一次性买断还是按月订阅、` +
  `座椅加热等附加费用 → ` +
  `<a href="${LINK}" target="_blank" rel="noopener" style="color:#15803d;font-weight:700">` +
  `各车企 ETC / 城市 NOA 费用对比 ↗</a></div>`;

/** 把备注插在评级框之后；找不到评级框就退到 h1 之后。 */
function inject(html) {
  if (html.includes(MARK)) return { html, changed: false, reason: '已有备注' };
  const boxIdx = html.indexOf('<div class="box">');
  const h1Idx = html.indexOf('</h1>');
  let at = -1;
  if (boxIdx >= 0) {
    // 评级框是 <div class="box">…</div>，取它的结束位置
    const close = html.indexOf('</div>', boxIdx);
    at = close >= 0 ? close + 6 : -1;
  } else if (h1Idx >= 0) {
    at = h1Idx + 5;
  }
  if (at < 0) return { html, changed: false, reason: '找不到插入点' };
  return { html: html.slice(0, at) + NOTE_HTML + '\n' + html.slice(at), changed: true };
}

const checkOnly = process.argv.includes('--check');
const touched = [];
const missing = [];

for (const slug of TARGETS) {
  const file = join(ROOT, 'brand', `${slug}.html`);
  let html;
  try {
    html = readFileSync(file, 'utf8');
  } catch {
    missing.push(slug);
    continue;
  }
  const res = inject(html);
  if (res.changed) {
    touched.push(slug);
    if (!checkOnly) writeFileSync(file, res.html, 'utf8');
  }
}

if (missing.length) {
  console.error(`[车费备注] 目标页缺失：${missing.join(', ')}`);
  process.exit(1);
}

if (checkOnly) {
  console.log(
    touched.length
      ? `[车费备注] 以下页缺少备注，需重新注入：${touched.join(', ')}`
      : '[车费备注] 8 个目标页均已带备注'
  );
  process.exit(touched.length ? 1 : 0);
}

console.log(
  `[车费备注] 已注入 ${touched.length} 页：${touched.join(', ') || '（无变化）'}`
);
