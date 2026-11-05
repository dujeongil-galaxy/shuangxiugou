/**
 * 二轮抓取：官网首页 HTML 解析真实 LOGO（2026-11-05）。
 * 一轮（fetch-logos.mjs 固定路径）只有 33/107 命中；大量公司站
 * favicon 在别的路径或干脆没有，但首页 HTML 里必然有 logo 引用。
 *
 * 候选优先级（每个域名依次尝试，取到图片即停）：
 *   1. <link rel="apple-touch-icon" / apple-touch-icon-precomposed>
 *   2. <link rel="icon" / shortcut icon / mask-icon>
 *   3. <img> src/class/父链含 "logo" 的图
 *   4. <meta property="og:image">
 *   5. 常见路径兜底 /favicon.ico /static/img/favicon.png 等
 * 相对 URL 解析后下载，sniff 收 png/jpg/svg/webp/ico（svg≥200B，位图≥800B）。
 */
import fs from 'node:fs';
import { MAP as MAP2 } from './_logo-domains.mjs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const OUT = path.join(process.cwd(), '_logo-fetch');
const report = JSON.parse(fs.readFileSync(path.join(OUT, 'report.json'), 'utf8'));
const byslug = Object.fromEntries(report.map((r) => [r.slug, r]));



const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36';

function curl(url, out, accept) {
  try {
    const args = ['-skL', '-m', '20', '-A', UA, url, '-o', out];
    if (accept) args.push('-H', 'Accept: ' + accept);
    execFileSync('curl', args, { stdio: 'pipe' });
    return fs.existsSync(out) ? fs.statSync(out).size : 0;
  } catch (e) { return 0; }
}

function sniff(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'jpg';
  if (buf[0] === 0x00 && buf[1] === 0x00 && buf[2] === 0x01) return 'ico';
  if (buf.slice(0, 4).toString() === 'RIFF') return 'webp';
  if (buf.slice(0, 200).toString('utf8').includes('<svg')) return 'svg';
  return null;
}

function abs(base, u) {
  if (!u) return null;
  u = u.trim().replace(/^["']|["']$/g, '');
  if (/^data:/i.test(u)) return null;
  if (/^https?:\/\//i.test(u)) return u;
  if (/^\/\//.test(u)) return 'https:' + u;
  try { return new URL(u, base).href; } catch (e) { return null; }
}

function pickFromHtml(html, baseUrl) {
  const cands = [];
  // 1/2. link rel 图标（apple-touch 最优先）
  const linkRe = /<link[^>]*>/gi;
  let m;
  while ((m = linkRe.exec(html))) {
    const tag = m[0];
    const rel = (/rel\s*=\s*["']([^"']*)["']/i.exec(tag) || [])[1] || '';
    const href = (/href\s*=\s*["']([^"']*)["']/i.exec(tag) || [])[1];
    if (!href) continue;
    const r = rel.toLowerCase();
    if (r.includes('apple-touch-icon')) cands.push({ kind: 'touch', url: abs(baseUrl, href) });
    else if (r.includes('icon')) cands.push({ kind: 'icon', url: abs(baseUrl, href) });
  }
  // 3. 含 logo 字样的 <img>
  const imgRe = /<img[^>]*>/gi;
  while ((m = imgRe.exec(html))) {
    const tag = m[0].toLowerCase();
    if (!/logo/.test(tag)) continue;
    const src = (/src\s*=\s*["']([^"']*)["']/i.exec(m[0]) || [])[1];
    const u = abs(baseUrl, src);
    if (u) cands.push({ kind: 'imglogo', url: u });
  }
  // 4. og:image
  const og = (/property\s*=\s*["']og:image["'][^>]*content\s*=\s*["']([^"']+)["']/i.exec(html)
    || /content\s*=\s*["']([^"']+)["'][^>]*property\s*=\s*["']og:image["']/i.exec(html));
  if (og) cands.push({ kind: 'og', url: abs(baseUrl, og[1]) });
  return cands.filter((c) => c.url);
}

const only = process.argv[2] ? process.argv[2].split(',') : null;
const results = [];
for (const slug of (only || Object.keys(MAP2))) {
  if (!only) {
    const have = fs.existsSync(path.join(OUT, slug + '.png')) || fs.existsSync(path.join(OUT, slug + '.jpg'))
      || fs.existsSync(path.join(OUT, slug + '.svg')) || fs.existsSync(path.join(OUT, slug + '.webp'))
      || fs.existsSync(path.join(OUT, slug + '.ico'));
    // .bin 是假响应，重抓；真图片跳过
    if (have && !(byslug[slug] && byslug[slug].file && byslug[slug].file.endsWith('.bin'))) continue;
    if (have && !fs.existsSync(path.join(OUT, slug + '.bin'))) continue;
  }
  const domains = MAP2[slug] || [];
  const rec = { slug, tried: [] };
  let hit = null;
  outer:
  for (const d of domains) {
    for (const scheme of ['https://', 'https://www.']) {
      const base = scheme + d + '/';
      const htmlFile = path.join(OUT, slug + '.html');
      const sz = curl(base, htmlFile);
      let html = '';
      if (sz > 1500) {
        html = fs.readFileSync(htmlFile, 'utf8').toString();
        if (!/<html|<!doctype/i.test(html)) html = '';
      }
      const cands = html ? pickFromHtml(html, base) : [];
      cands.push({ kind: 'path', url: base + 'favicon.ico' });
      for (const c of cands) {
        rec.tried.push(c.kind + ':' + c.url.slice(0, 90));
        const f = path.join(OUT, slug + '.tmp');
        const isz = curl(c.url, f);
        if (!isz) continue;
        const buf = fs.readFileSync(f);
        const ext = sniff(buf);
        if (!ext) continue;
        if (ext === 'svg' ? buf.length < 200 : buf.length < 800) continue; // 占位小图跳过
        fs.renameSync(f, path.join(OUT, `${slug}.${ext}`));
        hit = { domain: scheme + d, kind: c.kind, ext, size: buf.length, file: `${slug}.${ext}` };
        break outer;
      }
    }
  }
  if (fs.existsSync(path.join(OUT, slug + '.html'))) fs.unlinkSync(path.join(OUT, slug + '.html'));
  rec.hit = hit;
  results.push(rec);
  console.log((hit ? 'OK  ' : 'MISS') + ' ' + slug + (hit ? ' <- ' + hit.file + ' (' + hit.kind + ', ' + hit.size + 'B)' : ''));
  if (fs.existsSync(path.join(OUT, slug + '.tmp'))) fs.unlinkSync(path.join(OUT, slug + '.tmp'));
}
fs.appendFileSync(path.join(OUT, 'report2.json'), JSON.stringify(results, null, 1));
const ok = results.filter((r) => r.hit).length;
console.log(`\n二轮完成：${ok}/${results.length}`);
