#!/usr/bin/env node
/**
 * 把首页公告栏的「当前版本号 xxxxxxx」写回为上一次推送提交的短哈希。
 *
 * 为什么需要：版本号写死在 index.html 里，靠人记得改必然会漏。
 * 2026-10-19 站长指出它停在 2db67d9，落后了 6 个提交才发现。
 * AGENTS.md 其实早就写了这条规则（「两条硬规则 · 一」），
 * 但文档没有强制力 —— 所以它这次被做成了可执行脚本 + CI。
 *
 * 语义：显示的永远是「上一次推送」的哈希。
 *   哈希由文件内容算出，把哈希写进文件会改变内容、进而改变哈希 —— 无法自指。
 *   所以做不到「显示当前版本」，只能退而求其次显示上一版。见 AGENTS.md。
 *
 * 用法：
 *   node scripts/sync-version.mjs              # 写回 HEAD~1（默认）
 *   node scripts/sync-version.mjs 0c65eef      # 写回指定提交
 *   node scripts/sync-version.mjs --check      # 只检查是否已同步，不改文件
 *
 * 退出码：0 = 已同步或写回成功；1 = 未同步/失败（CI 会标红）
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const INDEX_HTML = join(ROOT, 'index.html');

const args = process.argv.slice(2);
const CHECK_ONLY = args.includes('--check');
const REV = args.find((a) => !a.startsWith('--')) || 'HEAD~1';

function shortHash(rev) {
  try {
    return execSync(`git rev-parse --short=7 ${rev}`, {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim();
  } catch {
    return null;
  }
}

const target = shortHash(REV);

if (!target) {
  console.error(`✗ 取不到 ${REV} 的短哈希（仓库历史可能不足）`);
  process.exit(1);
}

const src = readFileSync(INDEX_HTML, 'utf8');

// 锚定到 </span> 为止。只匹配 `当前版本号 xxxxxxx` 不限定尾部的话，
// 会误命中本段注释里出现的「当前版本号」四个字。
const RE = /(当前版本号\s*)([0-9a-f]{7})(\s*<\/span>)/;
const m = RE.exec(src);

if (!m) {
  console.error('✗ index.html 里找不到「当前版本号 xxxxxxx</span>」这个锚点');
  process.exit(1);
}

const current = m[2];

if (current === target) {
  console.log(`✓ 公告栏版本号已是最新：${target}（= ${REV}）`);
  process.exit(0);
}

if (CHECK_ONLY) {
  console.error(`✗ 公告栏版本号 ${current} ≠ ${REV} 的 ${target}`);
  process.exit(1);
}

writeFileSync(INDEX_HTML, src.replace(RE, `$1${target}$3`), 'utf8');
console.log(`✓ 公告栏版本号 ${current} → ${target}（= ${REV}）`);
