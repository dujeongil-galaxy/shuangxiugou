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

const WINDOWS_CACHE = 'D:/WorkBuddy-Cache';

function cacheBase() {
  return process.env.SXG_CACHE_DIR
    || (process.platform === 'win32'
      ? WINDOWS_CACHE
      : path.join(os.tmpdir(), 'sxg-cache'));
}

function cacheRoot() {
  // Windows 默认 D:/WorkBuddy-Cache/edge-profiles；CI / 非 Windows 用系统临时目录
  const root = process.env.SXG_CACHE_DIR
    ? path.join(process.env.SXG_CACHE_DIR, 'edge-profiles')
    : (process.platform === 'win32'
      ? 'D:/WorkBuddy-Cache/edge-profiles'
      : path.join(os.tmpdir(), 'sxg-edge-profiles'));
  try { fs.mkdirSync(root, { recursive: true }); } catch (e) { /* 只读环境忽略 */ }
  return root;
}

function cacheDir(name) {
  // 截图等产物落在缓存根的平级子目录（shots/），不塞进 edge-profiles/；
  // 同时自动建父目录，避免 shot-*.cjs / cdp-adcheck.cjs 写文件时报 ENOENT。
  const p = path.join(cacheBase(), name);
  try { fs.mkdirSync(path.dirname(p), { recursive: true }); } catch (e) { /* 只读环境忽略 */ }
  return p;
}

module.exports = { cacheRoot, cacheDir, WINDOWS_CACHE };
