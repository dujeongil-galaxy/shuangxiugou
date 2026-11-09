/* ==========================================================================
   统一缓存根：站长 2026-11-09「以后把缓存放在 D 盘，我 C 盘再搞要炸了」
   --------------------------------------------------------------------------
   本机 Windows 一律落 D:/WorkBuddy-Cache/edge-profiles/，不再往 C 盘的
   scripts/ 或 %TEMP% 写无头 Edge profile（历史上堆过 523 个目录）。
   CI / 非 Windows 环境回落到 os.tmpdir()，保持原有行为不变。
   可用 SXG_CACHE_DIR 覆盖（绝对路径，指向自定义缓存根）。
   用法：const { cacheRoot } = require('./_cache-dir.cjs');
         path.join(cacheRoot(), 'edgeprof-xxx')
   ========================================================================== */
const fs = require('fs');
const os = require('os');
const path = require('path');

const WINDOWS_CACHE = 'D:/WorkBuddy-Cache/edge-profiles';

function cacheRoot() {
  const root = process.env.SXG_CACHE_DIR
    || (process.platform === 'win32'
      ? WINDOWS_CACHE
      : path.join(os.tmpdir(), 'sxg-edge-profiles'));
  try { fs.mkdirSync(root, { recursive: true }); } catch (e) { /* 只读环境忽略 */ }
  return root;
}

function cacheDir(name) {
  return path.join(cacheRoot(), name);
}

module.exports = { cacheRoot, cacheDir, WINDOWS_CACHE };
