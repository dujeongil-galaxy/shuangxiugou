/* ==========================================================================
   notes.html 加密脚本
   --------------------------------------------------------------------------
   用途：把 notes.html 的正文加密后写回 notes.html。仓库里只留密文，
   访客在页面上输密码才能解开。密码不写进任何文件，也不进仓库。

   用法：
     node scripts/encrypt-notes.mjs            # 交互输入密码
     node scripts/encrypt-notes.mjs --key=xxx  # 直接给密码（仅本机调试用）

   ⚠️ 明文原文请自行留存在本地，不要提交。仓库里只应该有密文。
   ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const TARGET = path.join(ROOT, 'notes.html');
const SOURCE = path.join(ROOT, 'notes-plaintext.md');

/* ---- 加密参数 ----
   PBKDF2 迭代次数取得较高，是为了让暴力破解变慢。
   每次加密都重新随机生成 salt / iv —— 相同密码两次加密结果不同，
   这样密文本身不泄露「两次内容是否相同」。 */
const ITERATIONS = 210_000;
const KEYLEN = 32;
const SALT_BYTES = 16;
const IV_BYTES = 12;

function askPassword() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });
  return new Promise((resolve) => {
    process.stdout.write('请输入密码（至少 12 位，输入不回显）：');
    rl.question('', (pw) => {
      process.stdout.write('\n再输一次确认：');
      rl.question('', (pw2) => {
        rl.close();
        if (pw !== pw2) {
          console.error('\n两次输入不一致，已中止。');
          process.exit(1);
        }
        if (pw.length < 12) {
          console.error('\n密码太短，至少 12 位。');
          process.exit(1);
        }
        resolve(pw);
      });
    });
    // 关闭 echo
    rl._writeToOutput = function (str) {
      if (str.includes(pwEcho)) rl.output.write('*');
      else if (!str.includes(pwEcho)) rl.output.write(str);
    };
  });
}

let pwEcho = '';

/* ---- 主流程 ---- */

async function main() {
  if (!fs.existsSync(SOURCE)) {
    console.error(`找不到明文源文件：${SOURCE}`);
    console.error('请把正文原样存成 notes-plaintext.md（不要提交它）。');
    process.exit(1);
  }

  let password;
  const argKey = process.argv.find((a) => a.startsWith('--key='));
  if (argKey) {
    password = argKey.slice('--key='.length);
  } else {
    password = await askPassword();
  }

  const plaintext = fs.readFileSync(SOURCE, 'utf8');
  const salt = crypto.randomBytes(SALT_BYTES);
  const iv = crypto.randomBytes(IV_BYTES);

  const key = crypto.pbkdf2Sync(password, salt, ITERATIONS, KEYLEN, 'sha256');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  const payload = JSON.stringify({
    v: 1,
    kdf: 'pbkdf2-sha256',
    iter: ITERATIONS,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: ciphertext.toString('base64'),
  });

  // ⚠️ 2026-10-19 起废弃内嵌模板重建整页的做法。
  //    模板早已落后于手工打磨的 notes.html（卡片、徽标、格纹底、AI 习作、
  //    写作进度面板都是后来直接改页面的），重跑一次就会把新样式整页冲掉
  //    （2026-10-19 当天实际发生过，靠 git checkout 才救回来）。
  //    现在只把 notes.html 里的 PAYLOAD 密文行原位替换，页面其余部分一字不动。
  if (!fs.existsSync(TARGET)) {
    console.error(`找不到目标页面：${TARGET}`);
    process.exit(1);
  }
  const pageBefore = fs.readFileSync(TARGET, 'utf8');
  const PAYLOAD_RE = /var PAYLOAD = \{[\s\S]*?\};/;
  if (!PAYLOAD_RE.test(pageBefore)) {
    console.error('自查失败：notes.html 里找不到 PAYLOAD 密文行，已中止。');
    process.exit(1);
  }
  const html = pageBefore.replace(PAYLOAD_RE, `var PAYLOAD = ${payload};`);

  // 门禁自查：payload 若含 </script>，页面会提前闭合导致泄露
  if (/<\/script/i.test(payload)) {
    console.error('自查失败：密文中含 </script 序列，已中止。');
    process.exit(1);
  }

  // 门禁自查：只查「正文可见文字」。
  // head/style 里的 noindex、font-family 这类样板在密文页模板中也会出现，
  // 拿它们做判据会永远误报 —— 真正要保证的是读者看不到的那部分内容。
  const bodyText = plaintext
    .slice(plaintext.indexOf('<body>'))
    .replace(/<script[\s\S]*?<\/script>/g, '')  // 脚本样板不算正文
    .replace(/<[^>]+>/g, '\n');
  const sentences = bodyText
    .split('\n')
    .map((s) => s.trim())
    // 只查中文句子：JS 片段、短标签在密文页里也会出现，会误报
    .filter((s) => s.length >= 12 && /[一-龥]/.test(s));
  for (const s of sentences) {
    // 锁屏上有意明文展示的内容（如声明副本）不算泄露 —— 以加密前的页面为准
    if (pageBefore.includes(s)) continue;
    if (html.includes(s)) {
      console.error(`自查失败：明文句子出现在产物中 →「${s.slice(0, 40)}…」`);
      process.exit(1);
    }
  }
  // 关键内容必须查不到（与上面同理：锁屏有意展示的除外）
  for (const must of ['2025 川西自驾游', '伸出左手', '反手一句：再叫砍死你']) {
    if (pageBefore.includes(must)) continue;
    if (html.includes(must)) {
      console.error(`自查失败：产物中仍含「${must}」，已中止。`);
      process.exit(1);
    }
  }
  // 门禁自查：替换只允许发生一次，且页面其余行数不得变化
  const beforeCount = pageBefore.split('\n').length;
  const afterCount = html.split('\n').length;
  if (beforeCount !== afterCount) {
    console.error(`自查失败：替换前后行数不一致（${beforeCount} → ${afterCount}），已中止。`);
    process.exit(1);
  }

  fs.writeFileSync(TARGET, html, 'utf8');
  console.log(`已加密写入 ${path.relative(ROOT, TARGET)}（仅替换 PAYLOAD 行，页面结构不动）`);
  console.log(`明文长度 ${plaintext.length} 字符 → 密文 ${payload.length} 字符`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
