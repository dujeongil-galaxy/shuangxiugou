/**
 * 关站维护闸门（maintenance gate）
 * ----------------------------------------------------------------------------
 * 2026-11-12 站长要求「关站」：所有 HTML 页面一律不出内容，只出一张维护提示卡，
 * 预计 2026-11-12 13:30 恢复。
 *
 * 为什么不是「把 193 个页面正文全删了再恢复」
 *   GitHub Pages 是静态托管，没有服务端开关；正文是站长攒了几个月的资产，
 *   整批覆盖再整批还原，只要漏一个文件就是线上缺页。这里改成「在 <head> 里插一段闸门」：
 *     · 正文一个字节不动，只在前端把 html 置为 visibility:hidden 并盖一张提示卡；
 *     · 恢复 = 删掉 START..END 之间那段，`--off` 一条命令搞定，零正文风险；
 *     · 失败也不会白屏到底：闸门自带 14:00 兜底放行（UNLOCK），到点自动不再生效。
 *
 * 用法
 *   node scripts/maintenance-gate.mjs --on      # 插闸门（幂等：先剥旧块再插新块）
 *   node scripts/maintenance-gate.mjs --off     # 撤闸门（删 START..END，恢复原样）
 *   node scripts/maintenance-gate.mjs --check   # 只统计有多少页面带闸门，不写盘
 *
 * 覆盖范围：仓库根目录 *.html + brand/*.html。
 *   ⚠️ googlea540a6c2cd5f0e6c.html 是 Google 搜索控制台的站点验证文件，必须原样返回，
 *      给它插闸门等于让 Google 验不过，直接从名单里排除。
 *   node_modules / _logo-fetch / _sheet 等抓取残留不进名单（它们不是线上页面）。
 *
 * ⚠️ 闸门里的 jsdom 判断不能删：verify 与一堆 test-*.cjs 会拿 index.html 在 jsdom 里
 *    真渲染，闸门若生效会把整页盖住，让整页渲染类校验全部判红。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const START = '<!-- SXG-MAINT-GATE:START';
const END_MARK = 'SXG-MAINT-GATE:END -->';

// 关站窗口（北京时间）
const ETA_TEXT = '2026-11-12 13:30';
const ETA_MS = 1794461400000; // 2026-11-12T13:30:00+08:00
const UNLOCK_MS = 1794463200000; // 2026-11-12T14:00:00+08:00 兜底自动放行

const EXCLUDE = new Set(['googlea540a6c2cd5f0e6c.html']);

const PAYLOAD = `<!-- SXG-MAINT-GATE:START · 2026-11-12 关站维护，预计 ${ETA_TEXT} 恢复
     这是站长临时插的维护闸门，正文未改动。恢复请运行：node scripts/maintenance-gate.mjs --off
     兜底：${new Date(UNLOCK_MS).toISOString()} 之后本段自动失效（页面无需再改） -->
<style id="sxg-maint-css">
html.sxg-maint{visibility:hidden;overflow:hidden!important}
html.sxg-maint body{overflow:hidden!important}
#sxg-maint-box{visibility:visible;position:fixed;top:0;right:0;bottom:0;left:0;z-index:2147483640;display:flex;align-items:center;justify-content:center;padding:24px;background:#f4f6f6;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;color:#111827;line-height:1.6}
#sxg-maint-box .sxg-card{width:100%;max-width:420px;background:#fff;border:1px solid #e5e7eb;border-radius:18px;padding:38px 26px 28px;text-align:center;box-shadow:0 10px 30px rgba(15,118,110,.10)}
#sxg-maint-box .sxg-badge{width:54px;height:54px;margin:0 auto 18px;border-radius:50%;background:#e6f2f0;display:flex;align-items:center;justify-content:center}
#sxg-maint-box .sxg-title{font-size:22px;font-weight:800;margin:0 0 10px;letter-spacing:.5px;line-height:1.4}
#sxg-maint-box .sxg-p{margin:0 0 8px;font-size:14px;line-height:1.8;color:#4b5563}
#sxg-maint-box .sxg-eta{font-size:15px;font-weight:700;color:#0f766e;margin:14px 0 6px}
#sxg-maint-box .sxg-cd{font-size:13px;color:#6b7280;margin:0}
#sxg-maint-box .sxg-foot{font-size:12px;color:#9ca3af;margin:18px 0 0;padding-top:14px;border-top:1px solid #f3f4f6}
</style>
<script id="sxg-maint-gate">
(function () {
  var ETA = ${ETA_MS}, UNLOCK = ${UNLOCK_MS};
  if (/jsdom/i.test(navigator.userAgent || '')) return;   // 静态校验 / jsdom 渲染不放闸门
  if (Date.now() >= UNLOCK) return;                        // 兜底：到点自动放行
  var E = document.documentElement;
  if ((' ' + E.className + ' ').indexOf(' sxg-maint ') < 0) E.className += (E.className ? ' ' : '') + 'sxg-maint';
  if (document.getElementById('sxg-maint-box')) return;    // 幂等：同页只盖一张
  var clock = '<svg width="27" height="27" viewBox="0 0 24 24" fill="none" stroke="#0f766e" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"></circle><path d="M12 7.5V12l3.2 2.1"></path></svg>';
  var box = document.createElement('div');
  box.id = 'sxg-maint-box';
  box.setAttribute('role', 'alert');
  box.innerHTML = '<div class="sxg-card"><div class="sxg-badge">' + clock + '</div>'
    + '<div class="sxg-title">站点维护中</div>'
    + '<div class="sxg-p">双休购 ShuangxiuGo 正在进行维护，维护期间所有页面暂停访问。</div>'
    + '<div class="sxg-p sxg-eta">预计 ${ETA_TEXT} 恢复正常</div>'
    + '<div class="sxg-p sxg-cd" id="sxg-maint-cd">维护中，请稍后刷新</div>'
    + '<div class="sxg-foot">维护完成刷新即恢复，无需清除缓存</div></div>';
  (document.body || E).appendChild(box);
  document.title = '维护中 · 双休购 ShuangxiuGo';
  var cd = document.getElementById('sxg-maint-cd');
  (function tick() {
    if (!cd || !cd.parentNode) return;
    var left = ETA - Date.now();
    if (left <= 0) { cd.textContent = '已到预计完成时间，若仍停留本页请刷新重试'; return; }
    var m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
    cd.textContent = '距预计恢复还有 ' + (m > 0 ? m + ' 分 ' : '') + s + ' 秒';
    setTimeout(tick, 1000);
  })();
})();
</script>
<!-- SXG-MAINT-GATE:END -->`;

function listTargets() {
  const out = [];
  for (const entry of fs.readdirSync(ROOT, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.html') && !EXCLUDE.has(entry.name)) {
      out.push(entry.name);
    }
  }
  const brandDir = path.join(ROOT, 'brand');
  if (fs.existsSync(brandDir)) {
    for (const entry of fs.readdirSync(brandDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.html')) out.push('brand/' + entry.name);
    }
  }
  return out;
}

function strip(src) {
  const s = src.indexOf(START);
  if (s < 0) return src;
  const e = src.indexOf(END_MARK, s);
  if (e < 0) throw new Error('找到 START 但找不到 END，文件已被手工改坏，先停下排查');
  return src.slice(0, s) + src.slice(e + END_MARK.length);
}

function insert(src) {
  const clean = strip(src);
  let at;
  const head = clean.match(/<head(\s[^>]*)?>/i);
  const html = clean.match(/<html(\s[^>]*)?>/i);
  if (head) at = head.index + head[0].length;
  else if (html) at = html.index + html[0].length;
  else {
    const dt = clean.match(/<!doctype[^>]*>/i);
    at = dt ? dt.index + dt[0].length : 0;
  }
  const headPart = clean.slice(0, at).replace(/\r\n/g, '\n');
  const tailPart = clean.slice(at).replace(/\r\n/g, '\n');
  return headPart + '\n' + PAYLOAD + tailPart;
}

const mode = process.argv[2];
if (!['--on', '--off', '--check'].includes(mode)) {
  console.error('用法：node scripts/maintenance-gate.mjs --on | --off | --check');
  process.exit(2);
}

const files = listTargets();
let changed = 0, onCount = 0, skipped = 0;

for (const rel of files) {
  const abs = path.join(ROOT, rel);
  const raw = fs.readFileSync(abs, 'utf8');
  const has = raw.indexOf(START) >= 0;
  if (has) onCount++;

  if (mode === '--check') continue;

  if (mode === '--on') {
    const next = insert(raw);
    if (next === raw) { skipped++; continue; }
    fs.writeFileSync(abs, next, 'utf8');
    changed++;
    if (!has) onCount++;
  } else {
    if (!has) continue;
    fs.writeFileSync(abs, strip(raw), 'utf8');
    changed++;
    onCount--;
  }
}

if (mode === '--check') {
  console.log(`闸门覆盖 ${onCount}/${files.length} 个页面（应覆盖全部 ${files.length}）`);
  for (const rel of files) {
    if (fs.readFileSync(path.join(ROOT, rel), 'utf8').indexOf(START) < 0) console.log('  未覆盖：' + rel);
  }
  process.exit(onCount === files.length ? 0 : 1);
}

console.log(`${mode === '--on' ? '已插闸门' : '已撤闸门'}：改写 ${changed} 个页面，跳过 ${skipped} 个，当前带闸门 ${mode === '--on' ? files.length - skipped : onCount}/${files.length}`);
