/* ==========================================================================
   品牌 LOGO 加密脚本（encrypt-logos.mjs）
   --------------------------------------------------------------------------
   背景：2026-11-05 站长要求「将 LOGO 的图标缓存存放在 GitHub 仓库（要求使用
   blob 容器，不得在 GitHub 仓库明文），优化之后不要再引用站外来源」。
   把 scripts/build-logos.mjs 规范化出的 _logo-norm/*.png（临时目录不入库）
   打包加密成单个 assets/logos.enc 容器提交进仓库；页面侧 logo-vault.js
   在浏览器本地解密成 Blob URL 再填进卡片。

   容器与 photo-*.jpg.enc / notes.html 同一套参数：
   PBKDF2-SHA256（21 万次）+ AES-256-GCM，单行 JSON：
     { v, alg, iter, name, type, salt, iv, tag, data }
   data 解密后是 JSON：{ logos: { <slug>: { t: 'image/png', d: '<b64>' } } }
   59 张图一个容器 = 访客只发一次请求；PBKDF2 只算一次（~0.1s）。

   用法：
     node scripts/encrypt-logos.mjs            # 全量重加密（默认口令）
     node scripts/encrypt-logos.mjs --key=xxx  # 换口令（需同步改 logo-vault.js）

   ⚠️ 诚实的安全口径（与 photo-vault 相同，别自欺欺人）：
     口令写在 logo-vault.js 里（浏览器解密要用）——「防得住翻仓库/clone 的人
     拿到明文图片文件，防不住刻意读前端源码的人」。加密解决的是
     「仓库里不躺明文」，别吹成军事级。
   ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const NORM_DIR = path.join(ROOT, '_logo-norm');
const OUT = path.join(ROOT, 'assets', 'logos.enc');

const ITERATIONS = 210_000;
const KEYLEN = 32;
const SALT_BYTES = 16;
const IV_BYTES = 12;

/* ---- 口令：与 logo-vault.js 的 PASSPHRASE 必须一致；换口令两边一起改 ---- */
const PASSPHRASE = 'sxg-logo-vault-K7m2QpW9xRt4';

function deriveKey(passphrase, salt) {
  return crypto.pbkdf2Sync(passphrase, salt, ITERATIONS, KEYLEN, 'sha256');
}

function encryptBuffer(plaintext, name, type, passphrase) {
  const salt = crypto.randomBytes(SALT_BYTES);
  const iv = crypto.randomBytes(IV_BYTES);
  const key = deriveKey(passphrase, salt);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    v: 1,
    alg: 'PBKDF2-SHA256+AES-256-GCM',
    iter: ITERATIONS,
    name,
    type,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  };
}

function decryptContainer(container, passphrase) {
  const key = deriveKey(passphrase, Buffer.from(container.salt, 'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(container.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(container.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(container.data, 'base64')), decipher.final()]);
}

/* ---- 主流程 ---- */
const args = process.argv.slice(2);
const keyArg = args.find(a => a.startsWith('--key='));
const passphrase = keyArg ? keyArg.slice(6) : PASSPHRASE;

const files = fs.readdirSync(NORM_DIR).filter(f => f.endsWith('.png')).sort();
if (!files.length) throw new Error('_logo-norm/ 里没有规范化 PNG，先跑 scripts/build-logos.mjs');

const logos = {};
for (const f of files) {
  const slug = f.replace(/\.png$/, '');
  logos[slug] = { t: 'image/png', d: fs.readFileSync(path.join(NORM_DIR, f)).toString('base64') };
}
const payload = JSON.stringify({ v: 1, logos });

const container = encryptBuffer(Buffer.from(payload, 'utf8'), 'logos', 'application/json', passphrase);
fs.writeFileSync(OUT, JSON.stringify(container));

/* ---- 往返自检：解不开/内容不一致直接判红退出 ---- */
const back = JSON.parse(decryptContainer(JSON.parse(fs.readFileSync(OUT, 'utf8')), passphrase).toString('utf8'));
for (const slug of Object.keys(logos)) {
  if (Buffer.from(back.logos[slug].d, 'base64').toString('base64') !== logos[slug].d) {
    throw new Error('往返自检失败：' + slug + ' 内容不一致');
  }
}
console.log(`OK assets/logos.enc：${Object.keys(logos).length} 张，容器 ${fs.statSync(OUT).size}B，往返自检通过`);
