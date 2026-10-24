/* ==========================================================================
   照片彩蛋加密脚本
   --------------------------------------------------------------------------
   用途：把两张玩偶照加密成 .enc 容器写进仓库，访客页面上只拿得到密文，
   验证通过（Star 门禁）后才在浏览器本地解密展示。

   背景：2026-10-25 站长要求「照片在仓库中加密」——此前 photo-kuromi.jpg /
   photo-melody.jpg 是以明文形式跟踪在 git 里的（clone 即可得）。

   用法：
     node scripts/encrypt-photos.mjs            # 加密全部照片（默认口令）
     node scripts/encrypt-photos.mjs --key=xxx  # 换口令（需同步改 photo-vault.js）

   加密参数与 notes.html 同一套：PBKDF2-SHA256（21 万次）派生密钥，
   AES-256-GCM 加密，salt/iv 每次随机。容器是单行 JSON：
     { v, alg, iter, name, type, salt, iv, tag, data }（后四者 base64）

   ⚠️ 诚实的安全口径（写代码前想清楚，别自欺欺人）：
     口令同时写在 photo-vault.js 里（浏览器解密要用），所以「防得住翻仓库/
     clone 的人，防不住刻意读前端源码的人」——这是静态站零后端的先天上限。
     真正的门是 Star 门禁（photo-gate.js 真校验），加密解决的是
     「仓库里不躺明文」这一件事，别在文案里吹成军事级。

   ⚠️ 已推历史里的旧明文：照片曾以明文推送过，按本项目铁律不重写历史，
     只能保证「从今往后仓库（工作区 + 新提交）只有密文」。
     明文原件请留在本机备份（notes-备份/），不要删。
   ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

/* ---- 加密参数（与 scripts/encrypt-notes.mjs 保持一致） ---- */
const ITERATIONS = 210_000;
const KEYLEN = 32;
const SALT_BYTES = 16;
const IV_BYTES = 12;

/* ---- 口令 ----
   与 photo-vault.js 的 PASSPHRASE 必须一致（前端解密要用）。
   换口令：改这里 + 改 photo-vault.js，然后重跑本脚本。 */
const PASSPHRASE = 'sxg-photo-vault-5zsF6Hj06ETkOEQD';

/* ---- 照片清单（src = 仓库内的明文文件名，out = 密文容器） ---- */
const PHOTOS = [
  { src: 'photo-kuromi.jpg', out: 'photo-kuromi.jpg.enc', type: 'image/jpeg' },
  { src: 'photo-melody.jpg', out: 'photo-melody.jpg.enc', type: 'image/jpeg' },
];

/** PBKDF2-SHA256 派生 AES-256 密钥 */
function deriveKey(passphrase, salt) {
  return crypto.pbkdf2Sync(passphrase, salt, ITERATIONS, KEYLEN, 'sha256');
}

/** 加密一个文件 → 容器对象 */
function encryptBuffer(plaintext, name, type, passphrase) {
  const salt = crypto.randomBytes(SALT_BYTES);
  const iv = crypto.randomBytes(IV_BYTES);
  const key = deriveKey(passphrase, salt);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: 1,
    alg: 'PBKDF2-SHA256+AES-256-GCM',
    iter: ITERATIONS,
    name,
    type,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: data.toString('base64'),
  };
}

/** 解密一个容器对象 → Buffer（脚本内自检用：确认参数真的对得上） */
function decryptContainer(container, passphrase) {
  const key = deriveKey(passphrase, Buffer.from(container.salt, 'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(container.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(container.tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(container.data, 'base64')),
    decipher.final(),
  ]);
}

async function main() {
  const argKey = process.argv.find((a) => a.startsWith('--key='));
  const passphrase = argKey ? argKey.slice('--key='.length) : PASSPHRASE;

  let failed = 0;
  for (const photo of PHOTOS) {
    const srcPath = path.join(ROOT, photo.src);
    const outPath = path.join(ROOT, photo.out);
    if (!fs.existsSync(srcPath)) {
      console.error(`✗ ${photo.src} 不存在——明文照片应留在仓库根目录（不入库，只在本机）。`);
      failed++;
      continue;
    }
    const plaintext = fs.readFileSync(srcPath);
    const container = encryptBuffer(plaintext, photo.src, photo.type, passphrase);

    // 自检：当场解回来，字节必须一致（参数写错的话这里就炸，不会带着错密文上线）
    const roundtrip = decryptContainer(container, passphrase);
    if (!roundtrip.equals(plaintext)) {
      console.error(`✗ ${photo.src} 加密自检失败：解密结果与原文不一致，已中止。`);
      failed++;
      continue;
    }

    fs.writeFileSync(outPath, JSON.stringify(container));
    const ratio = ((container.data.length / plaintext.length - 1) * 100).toFixed(0);
    console.log(`✓ ${photo.src} → ${photo.out}`);
    console.log(`  明文 ${plaintext.length} B → 密文容器 ${fs.statSync(outPath).size} B（base64 膨胀约 ${ratio}%），往返自检通过`);
  }

  if (failed > 0) {
    console.error(`\n${failed} 个照片加密失败。`);
    process.exit(1);
  }
  console.log('\n全部照片加密完成。仓库里只应有 .enc 密文；明文照片请留在本机备份，勿提交。');
}

main();
