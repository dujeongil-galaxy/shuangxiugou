/* ==========================================================================
   notes.html 加密脚本
   --------------------------------------------------------------------------
   用途：把 notes.html [中文内容已移除] notes.html[中文内容已移除]
   [中文内容已移除]

   用法：
     node scripts/encrypt-notes.mjs            # 交互输入密码
     node scripts/encrypt-notes.mjs --key=xxx  # [中文内容已移除]

   ⚠️ [中文内容已移除]
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
   PBKDF2 [中文内容已移除]
   [中文内容已移除] salt / iv —— [中文内容已移除]
   [中文内容已移除] */
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
    process.stdout.write('[中文内容已移除] 12 [中文内容已移除]');
    rl.question('', (pw) => {
      process.stdout.write('\n再输一次确认：');
      rl.question('', (pw2) => {
        rl.close();
        if (pw !== pw2) {
          console.error('\n[中文内容已移除]');
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
    console.error(`[中文内容已移除]${SOURCE}`);
    console.error('[中文内容已移除] notes-plaintext.md[中文内容已移除]');
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

  const html = buildHtml(payload);

  // 门禁自查：payload 若含 </script>[中文内容已移除]
  if (/<\/script/i.test(payload)) {
    console.error('[中文内容已移除] </script 序列，已中止。');
    process.exit(1);
  }

  // [中文内容已移除]
  // head/style 里的 noindex、font-family [中文内容已移除]
  // [中文内容已移除] —— [中文内容已移除]
  const bodyText = plaintext
    .slice(plaintext.indexOf('<body>'))
    .replace(/<script[\s\S]*?<\/script>/g, '')  // [中文内容已移除]
    .replace(/<[^>]+>/g, '\n');
  const sentences = bodyText
    .split('\n')
    .map((s) => s.trim())
    // 只查中文句子：JS [中文内容已移除]
    .filter((s) => s.length >= 12 && /[一-龥]/.test(s));
  for (const s of sentences) {
    if (html.includes(s)) {
      console.error(`[中文内容已移除] →「${s.slice(0, 40)}…」`);
      process.exit(1);
    }
  }
  // [中文内容已移除]
  for (const must of ['2025 川西自驾游', '不代表本站立场', '伸出左手']) {
    if (html.includes(must)) {
      console.error(`[中文内容已移除]${must}」，已中止。`);
      process.exit(1);
    }
  }

  fs.writeFileSync(TARGET, html, 'utf8');
  console.log(`已加密写入 ${path.relative(ROOT, TARGET)}`);
  console.log(`明文长度 ${plaintext.length} 字符 → 密文 ${payload.length} 字符`);
}

function buildHtml(payload) {
  // ⚠️ [中文内容已移除] JS [中文内容已移除] JSON.stringify 再塞进引号 ——
  //    [中文内容已移除] JSON[中文内容已移除]
  //    payload [中文内容已移除] base64/数字，不含 </script> 等危险序列。
  const P = payload;
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow, noarchive, nosnippet" />
<title>站长随笔 · 双休购</title>
<style>
  :root {
    --ink: #1a1a1a;
    --ink-2: #4b5563;
    --ink-3: #6b7280;
    --line: #e5e7eb;
    --bg: #ffffff;
    --accent: #0f766e;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --ink: #e8e8e8;
      --ink-2: #b0b6bf;
      --ink-3: #8d949e;
      --line: #2a2f36;
      --bg: #14171a;
      --accent: #5eead4;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 3rem 1.25rem 5rem;
    background: var(--bg);
    color: var(--ink);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
                 "Hiragino Sans GB", "Microsoft YaHe", sans-serif;
    line-height: 1.9;
    -webkit-font-smoothing: antialiased;
  }
  .box { max-width: 42rem; margin: 0 auto; }
  .locked__tag {
    display: inline-block;
    font-size: 0.75rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    color: var(--accent);
    margin: 0 0 0.9rem;
  }
  h1 {
    font-size: 1.5rem;
    font-weight: 700;
    letter-spacing: -0.01em;
    margin: 0 0 1.6rem;
  }
  .desc { color: var(--ink-2); margin: 0 0 1.6rem; }
  .tip { font-size: 0.8125rem; color: var(--ink-3); margin: 2rem 0 0; }
  .err { color: #b91c1c; min-height: 1.4em; margin: 0.8rem 0 0; font-size: 0.875rem; }
  @media (prefers-color-scheme: dark) {
    .err { color: #fca5a5; }
  }
  form { display: flex; gap: 0.5rem; flex-wrap: wrap; }
  input {
    flex: 1 1 12rem;
    padding: 0.55rem 0.7rem;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: transparent;
    color: var(--ink);
    font-family: inherit;
    font-size: 0.9375rem;
  }
  input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  button {
    padding: 0.55rem 1.1rem;
    border: 1px solid var(--accent);
    border-radius: 6px;
    background: var(--accent);
    color: #fff;
    font-family: inherit;
    font-size: 0.9375rem;
    cursor: pointer;
  }
  button:hover { opacity: 0.9; }
  button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
</style>
</head>
<body>
<div class="box">

  <div class="locked__tag">正在写</div>
  <h1>站长随笔还在写</h1>
  <div class="desc">[中文内容已移除]
  [中文内容已移除]</div>

  <form id="f" autocomplete="off">
    <input id="pw" type="password" placeholder="输入访问密码" aria-label="访问密码" />
    <button type="submit">打开</button>
  </form>
  <p class="err" id="err" role="alert"></p>
  <p class="tip">暂不提供预览</p>

</div>

<script>
  // [中文内容已移除] URL、不进 localStorage[中文内容已移除]
  // [中文内容已移除] —— 从地址栏和 DOM [中文内容已移除]
  (function () {
    var PAYLOAD = ${P};
    var KDF_ITER = PAYLOAD.iter;

    var form = document.getElementById('f');
    var pw = document.getElementById('pw');
    var err = document.getElementById('err');

    function b64ToBytes(b64) {
      var bin = atob(b64);
      var out = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }

    async function derive(password, salt) {
      // WebCrypto 的 PBKDF2 [中文内容已移除] SHA-256
      var base = await crypto.subtle.importKey(
        'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
      );
      var bits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt: salt, iterations: KDF_ITER, hash: 'SHA-256' },
        base, 256
      );
      return crypto.subtle.importKey('raw', bits, 'AES-GCM', false, ['decrypt']);
    }

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      err.textContent = '';
      var password = pw.value;
      if (!password) return;

      try {
        var key = await derive(password, b64ToBytes(PAYLOAD.salt));
        // ⚠️ data 和 tag 必须**分别解码再拼接**。
        //    直接对 base64 字符串做 data + tag 再解码会因为
        //    两段各自的 '=' [中文内容已移除]GCM 认证必然失败。
        var body = b64ToBytes(PAYLOAD.data);
        var tag = b64ToBytes(PAYLOAD.tag);
        var buf = new Uint8Array(body.length + tag.length);
        buf.set(body, 0);
        buf.set(tag, body.length);

        var plain = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: b64ToBytes(PAYLOAD.iv), tagLength: 128 },
          key,
          buf
        );
        // [中文内容已移除] catch
        document.open();
        document.write(new TextDecoder().decode(plain));
        document.close();
      } catch (err2) {
        err.textContent = '密码不对。';
        pw.select();
      }
    });

    pw.focus();
  })();
</script>
</body>
</html>
`;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
