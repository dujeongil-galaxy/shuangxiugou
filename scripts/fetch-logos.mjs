/**
 * 抓取品牌真 LOGO（2026-11-05 站长指令：新增品牌 LOGO 逐一核实替换，
 * 建行仍错；落库为加密 blob 后不再引用站外来源）。
 *
 * 抓取源（按优先级）：
 *   1. 官网 /apple-touch-icon.png（180px 高清，多数品牌官网有）
 *   2. 官网 /favicon.ico
 *   3. 国内 favicon 聚合 API（api.iowen.cn）
 * 输出：_logo-fetch/<slug>.<ext>（原始字节）+ _logo-fetch/report.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const OUT = path.join(process.cwd(), '_logo-fetch');
fs.mkdirSync(OUT, { recursive: true });

// slug → [官网域名候选]（slug 与 index.html assets/logo 文件名一致）
import { MAP } from './_logo-domains.mjs';

const report = [];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36';

function tryFetch(url, file) {
  try {
    // -k：部分公司站证书配置不规范；-L 跟随跳转；-m 20 超时
    execFileSync('curl', ['-skL', '-m', '20', '-A', UA, url, '-o', file, '--fail'],
      { stdio: 'pipe' });
    const sz = fs.existsSync(file) ? fs.statSync(file).size : 0;
    if (sz < 200) { fs.unlinkSync(file); return 0; } // 占位/空响应
    return sz;
  } catch (e) {
    if (fs.existsSync(file)) fs.unlinkSync(file);
    return 0;
  }
}

function sniff(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'jpg';
  if (buf[0] === 0x00 && buf[1] === 0x00 && buf[2] === 0x01) return 'ico';
  if (buf.slice(0, 4).toString() === 'RIFF') return 'webp';
  if (buf.slice(0, 5).toString().includes('<svg') || buf.slice(0, 40).toString().includes('<svg')) return 'svg';
  if (buf[0] === 0x1f && buf[1] === 0x8b) return 'gzip';
  return 'bin';
}

const slugs = process.argv[2] ? process.argv[2].split(',') : Object.keys(MAP);
for (const slug of slugs) {
  const domains = MAP[slug] || [];
  const rec = { slug, sources: [] };
  let done = false;
  for (const d of domains) {
    if (typeof d !== 'string') continue;
    if (done) break;
    const cands = [
      ['touch', `https://${d}/apple-touch-icon.png`],
      ['fav', `https://${d}/favicon.ico`],
      ['api', `https://api.iowen.cn/favicon/${d}.png`],
    ];
    for (const [kind, url] of cands) {
      const file = path.join(OUT, `${slug}.tmp`);
      const sz = tryFetch(url, file);
      if (sz) {
        const buf = fs.readFileSync(file);
        let ext = sniff(buf);
        if (ext === 'gzip') { // 有些站返回 gzip html，重新当失败处理
          fs.unlinkSync(file); continue;
        }
        const final = path.join(OUT, `${slug}.${ext}`);
        fs.renameSync(file, final);
        rec.sources.push({ domain: d, kind, url, ext, size: sz });
        rec.file = path.basename(final);
        rec.domain = d;
        rec.kind = kind;
        done = true;
        break;
      }
    }
  }
  report.push(rec);
  console.log((done ? 'OK ' : 'MISS ') + slug + (done ? ' <- ' + rec.file + ' (' + rec.domain + '/' + rec.kind + ', ' + rec.sources[0].size + 'B)' : ''));
}
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
const ok = report.filter((r) => r.file).length;
console.log(`\n完成：${ok}/${report.length} 抓到`);
