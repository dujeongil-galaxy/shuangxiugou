/* ==========================================================================
   LOGO 规范化脚本（build-logos.mjs）
   --------------------------------------------------------------------------
   把 _logo-fetch / _logo-fetch3 里的候选图（ico/png/jpg/svg）统一解码成
   ≤128px 的透明底 PNG，写到 _logo-norm/（临时目录，不入库）。
   ICO 内嵌全是 BMP DIB（本机 libvips 不带 ico 支持），手写解码：
   40 字节 BITMAPINFOHEADER + 自下而上 BGRA 像素 + 1bpp AND 掩码。
   常见坑：不少 favicon 的 32bpp alpha 全 0（透明），此时改用 AND 掩码。
   ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const NORM = path.join(ROOT, '_logo-norm');
fs.mkdirSync(NORM, { recursive: true });

/** slug -> 源文件（相对仓库根） */
const SRC = {
  kfc: '_logo-fetch/kfc.ico', unicom: '_logo-fetch/unicom.png', bosszhipin: '_logo-fetch/bosszhipin.ico',
  baidu: '_logo-fetch/baidu.ico', netease: '_logo-fetch/netease.png',
  jd: '_logo-fetch/jd.ico', dewu: '_logo-fetch/dewu.ico', bilibili: '_logo-fetch/bilibili.ico',
  lilith: '_logo-fetch/lilith.png', xindong: '_logo-fetch/xindong.ico', nvidia: '_logo-fetch/nvidia.ico',
  intel: '_logo-fetch/intel.png', ibm: '_logo-fetch/ibm.png', wps: '_logo-fetch/wps.ico',
  lenovo: '_logo-fetch/lenovo.ico', honor: '_logo-fetch/honor.svg', insta360: '_logo-fetch/insta360.png',
  anker: '_logo-fetch/anker.png', ugreen: '_logo-fetch/ugreen.ico',
  xgimi: '_logo-fetch/xgimi.ico', naura: '_logo-fetch/naura.ico', tianma: '_logo-fetch/tianma.svg',
  genki: '_logo-fetch/genki.png', yili: '_logo-fetch/yili.ico', qiaqia: '_logo-fetch/qiaqia.jpg',
  bright: '_logo-fetch/bright.ico', mcd: '_logo-fetch/mcd.ico', proya: '_logo-fetch/proya.png',
  jahwa: '_logo-fetch/jahwa.ico', maogeping: '_logo-fetch/maogeping.ico', lining: '_logo-fetch/lining.png',
  '361du': '_logo-fetch/361du.png', bull: '_logo-fetch/bull.png', goodbaby: '_logo-fetch/goodbaby.ico',
  oppein: '_logo-fetch/oppein.ico', pingan: '_logo-fetch/pingan.png', chinalife: '_logo-fetch/chinalife.ico',
  eastmoney: '_logo-fetch/eastmoney.png', unionpay: '_logo-fetch/unionpay.png', hengrui: '_logo-fetch/hengrui.ico',
  tongrentang: '_logo-fetch/tongrentang.ico', baiyunshan: '_logo-fetch/baiyunshan.png',
  sinopharm: '_logo-fetch/sinopharm.png', jzt: '_logo-fetch/jzt.ico', lixiang: '_logo-fetch/lixiang.ico',
  nio: '_logo-fetch/nio.ico', anta: '_logo-fetch/anta.ico', yatsen: '_logo-fetch/yatsen.png',
  joyoung: '_logo-fetch/joyoung.png', hisense: '_logo-fetch/hisense.ico', haitian: '_logo-fetch/haitian.png',
  boe: '_logo-fetch/boe.ico', banu: '_logo-fetch/banu.png', xtep: '_logo-fetch/xtep.ico',
  foxconn: '_logo-fetch3/foxconn.png', csot: '_logo-fetch3/csot.png', peacebird: '_logo-fetch3/peacebird.ico',
  xibei: '_logo-fetch3/xibei.png', ccb: '_ccb-logo.png',
};

/** 解码 ICO：取最大的一帧，返回 {width,height,rgba:Buffer} */
function decodeIco(buf) {
  const count = buf.readUInt16LE(4);
  let best = null;
  for (let i = 0; i < count; i++) {
    const o = 6 + i * 16;
    const w = buf[o] || 256, h = buf[o + 1] || 256;
    const size = buf.readUInt32LE(o + 8), off = buf.readUInt32LE(o + 12);
    const frame = buf.slice(off, off + size);
    if (frame.slice(0, 4)[0] === 0x89) {
      // PNG 压缩帧：直接扔给 sharp
      return { pngFrame: frame };
    }
    if (!best || w * h > best.w * best.h) best = { w, h, frame };
  }
  if (!best) throw new Error('ICO 无有效帧');
  const dib = best.frame;
  const width = dib.readInt32LE(4);
  const dibH = dib.readInt32LE(8);
  const height = dibH / 2; // ICO DIB biHeight = 像素高 + 掩码高
  const bpp = dib.readUInt16LE(14);
  const rowBytes = Math.ceil(width * bpp / 32) * 4;
  const maskRowBytes = Math.ceil(width / 32) * 4;
  let px, palette = null;
  if (bpp === 32) {
    px = dib.slice(40, 40 + rowBytes * height);
  } else {
    // 调色板 ICO（8bpp/4bpp/1bpp）：头后跟 2^bpp 个 BGRA 调色板项
    const colors = dib.readUInt32LE(16) || (1 << bpp);
    palette = Buffer.alloc(colors * 4);
    for (let i = 0; i < colors; i++) {
      const po = 40 + i * 4;
      palette[i * 4] = dib[po + 2]; // B→R
      palette[i * 4 + 1] = dib[po + 1];
      palette[i * 4 + 2] = dib[po]; // R→B
      palette[i * 4 + 3] = 255; // 调色板项的 alpha 保留位通常为 0，透明度看 AND 掩码
    }
    px = dib.slice(40 + colors * 4, 40 + colors * 4 + rowBytes * height);
  }
  const maskOff = 40 + (palette ? palette.length : 0) + rowBytes * height;
  const rgba = Buffer.alloc(width * height * 4);
  let allAlphaZero = true;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const di = (y * width + x) * 4;
      if (bpp === 32) {
        const si = (height - 1 - y) * rowBytes + x * 4; // 自下而上
        rgba[di] = px[si + 2]; // B→R
        rgba[di + 1] = px[si + 1]; // G
        rgba[di + 2] = px[si]; // R→B
        rgba[di + 3] = px[si + 3];
        if (px[si + 3] !== 0) allAlphaZero = false;
      } else {
        const si = (height - 1 - y) * rowBytes;
        let idx;
        if (bpp === 8) idx = px[si + x];
        else if (bpp === 4) idx = (x % 2 === 0) ? (px[si + (x >> 1)] >> 4) : (px[si + (x >> 1)] & 0x0f);
        else idx = (px[si + (x >> 3)] >> (7 - (x & 7))) & 1;
        rgba[di] = palette[idx * 4];
        rgba[di + 1] = palette[idx * 4 + 1];
        rgba[di + 2] = palette[idx * 4 + 2];
        rgba[di + 3] = 255;
      }
    }
  }
  // AND 掩码（1=透明 0=不透明）无条件应用：很多 32bpp favicon 的 alpha
  // 通道全 255（不透明黑底），真正的透明信息只在掩码里。
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const byte = dib[maskOff + (height - 1 - y) * maskRowBytes + (x >> 3)];
      if ((byte >> (7 - (x & 7))) & 1) rgba[(y * width + x) * 4 + 3] = 0;
    }
  }
  return { width, height, rgba };
}

const report = [];
for (const [slug, src] of Object.entries(SRC)) {
  const abs = path.join(ROOT, src);
  try {
    let img;
    if (src.endsWith('.ico')) {
      const d = decodeIco(fs.readFileSync(abs));
      if (d.pngFrame) img = sharp(d.pngFrame);
      else img = sharp(d.rgba, { raw: { width: d.width, height: d.height, channels: 4 } });
    } else if (src.endsWith('.svg')) {
      img = sharp(abs, { density: 150 });
    } else {
      img = sharp(abs);
    }
    // 建行：官网 logo.png 是 200x40 文字标，40px 卡片里文字不可读，
    // 只裁左侧 37x40 的双 C 符号（2026-11-05 与站长需求「建行 LOGO 仍然错误」对应）
    if (slug === 'ccb') img = img.extract({ left: 0, top: 0, width: 37, height: 40 });
    const out = path.join(NORM, `${slug}.png`);
    await img.resize(128, 128, { fit: 'inside', withoutEnlargement: true })
      .png()
      .toFile(out);
    const meta = await sharp(out).metadata();
    report.push({ slug, src, w: meta.width, h: meta.height, bytes: fs.statSync(out).size });
    console.log(`OK   ${slug.padEnd(12)} ${meta.width}x${meta.height} ${fs.statSync(out).size}B`);
  } catch (e) {
    report.push({ slug, src, error: e.message });
    console.log(`FAIL ${slug.padEnd(12)} ${e.message.slice(0, 80)}`);
  }
}
fs.writeFileSync(path.join(NORM, 'report.json'), JSON.stringify(report, null, 1));
const fail = report.filter(r => r.error);
console.log(`done: ${report.length - fail.length}/${report.length}` + (fail.length ? ` FAIL=${fail.map(f => f.slug)}` : ''));
