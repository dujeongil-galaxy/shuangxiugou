// 第三轮定向补抓：33 个 miss + ccb（站长点名建行）
import { execFileSync } from 'child_process';
import fs from 'fs';

const OUT = '_logo-fetch3';
fs.mkdirSync(OUT, { recursive: true });

// slug -> [官方域名]（国内可达，不用维基）
const DOMAINS = {
  ant: ['antgroup.com', 'www.antgroup.com'],
  google: ['google.cn', 'about.google', 'google.com.hk'],
  will: ['wills-semi.com', 'www.wills-semi.com'],
  tongyi: ['tongyi.aliyun.com', 'aliyun.com'],
  liangpin: ['liangpin.com', 'www.lppz.com'],
  semir: ['semir.co', 'www.semir.co', 'semirbiz.com'],
  pianzihuang: ['pianzihuang.com', 'www.pzs.com.cn'],
  junlebao: ['junlebao.com', 'www.junlebao.com.cn'],
  tsingtao: ['tsingtao.com.cn', 'www.tsingtao.com.cn'],
  snowbeer: ['snowbeer.com.cn', 'www.crsb.com.cn'],
  dreame: ['dreame.com', 'www.dreame-technology.com'],
  wentai: ['wentai.com', 'www.wentai.com.cn'],
  luxshare: ['luxshare-ict.com', 'www.luxshare.com.cn'],
  foxconn: ['foxconn.com', 'www.foxconn.com.cn'],
  lens: ['lens-tech.com', 'www.lens.com.cn'],
  goertek: ['goertek.com', 'www.goertek.com'],
  smic: ['smic.com', 'www.smics.com'],
  ymtc: ['ymtc.com', 'www.ymtc.com'],
  csot: ['csot.tcl.com', 'www.tclcsot.com'],
  hla: ['hla.com.cn', 'www.hla.com.cn'],
  peacebird: ['peacebird.com', 'www.peacebird.com.cn'],
  xibei: ['xibei.com.cn', 'www.xibei.com'],
  xiabu: ['xiabuxiabu.com', 'www.xiabu.com.cn'],
  wallace: ['wallace.cn', 'www.wallacefood.com'],
  xijiade: ['xijiade.com', 'www.xijiade.cn'],
  wumart: ['wumart.com', 'www.wumart.com'],
  cicc: ['cicc.com', 'www.cicc.com'],
  citicsec: ['citics.com', 'www.cs.ecitic.com'],
  gtja: ['gtja.com', 'www.gtjas.com'],
  cmb: ['cmbchina.com', 'www.cmbchina.com'],
  fotile: ['fotile.com', 'www.fotile.com'],
  jdb: ['jiaduobao.com', 'www.jdb.cn'],
  jml: ['jianlibao.com.cn', 'www.jianlibao.com'],
  ccb: ['ccb.com', 'www.ccb.com', 'www.ccb.cn'],
};

function curl(url, dest) {
  try {
    execFileSync('curl', ['-sSL', '--fail', '--max-time', '15', '-A',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
      '-o', dest, url], { stdio: 'pipe', timeout: 20000 });
    const b = fs.readFileSync(dest);
    const head = b.slice(0, 300).toString('utf8').toLowerCase();
    if (b.length < 120 || head.includes('<!doctype') || head.includes('<html')) return false;
    return true;
  } catch { return false; }
}

function sniff(b) {
  if (b[0] === 0xff && b[1] === 0xd8) return 'jpg';
  if (b[0] === 0x89 && b[1] === 0x50) return 'png';
  if (b[0] === 0x00 && b[1] === 0x00 && b[2] === 0x01) return 'ico';
  if (b.slice(0, 4).toString() === 'RIFF') return 'webp';
  if (b.slice(0, 400).toString('utf8').toLowerCase().includes('<svg')) return 'svg';
  return 'other';
}

const report = [];
for (const [slug, domains] of Object.entries(DOMAINS)) {
  let got = null;
  outer:
  for (const d of domains) {
    for (const p of ['apple-touch-icon.png', 'favicon.ico', 'favicon.png']) {
      const url = `https://${d}/${p}`;
      const dest = `${OUT}/${slug}_try.${p.split('.').pop()}`;
      if (curl(url, dest)) {
        const b = fs.readFileSync(dest);
        const kind = sniff(b);
        if (kind === 'other') continue;
        const f = `${OUT}/${slug}.${kind}`;
        fs.renameSync(dest, f);
        got = { slug, url, kind, size: b.length, file: `${slug}.${kind}` };
        break outer;
      }
      try { fs.unlinkSync(dest); } catch {}
    }
  }
  report.push(got || { slug, miss: true });
  console.log(got ? `OK   ${slug} <- ${got.file} ${got.size}B` : `MISS ${slug}`);
}
fs.writeFileSync(`${OUT}/report3.json`, JSON.stringify(report, null, 1));
