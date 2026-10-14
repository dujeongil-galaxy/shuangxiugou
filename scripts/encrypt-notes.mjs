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

  const html = buildHtml(payload);

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
    if (html.includes(s)) {
      console.error(`自查失败：明文句子出现在产物中 →「${s.slice(0, 40)}…」`);
      process.exit(1);
    }
  }
  // 关键内容必须查不到
  for (const must of ['2025 川西自驾游', '不代表本站立场', '伸出左手']) {
    if (html.includes(must)) {
      console.error(`自查失败：产物中仍含「${must}」，已中止。`);
      process.exit(1);
    }
  }

  fs.writeFileSync(TARGET, html, 'utf8');
  console.log(`已加密写入 ${path.relative(ROOT, TARGET)}`);
  console.log(`明文长度 ${plaintext.length} 字符 → 密文 ${payload.length} 字符`);
}

function buildHtml(payload) {
  // ⚠️ 这里必须原样嵌入 JS 对象字面量，不能 JSON.stringify 再塞进引号 ——
  //    那样会变成「字符串里的 JSON」，浏览器端拿到的会是带转义符的文本。
  //    payload 全部字段都是我们自己生成的 base64/数字，不含 </script> 等危险序列。
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
  /*锁屏只剩密码框，垂直居中才不会显得像页面崩了 */
  .lock {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }
  .lock__title {
    font-size: 1.5rem;
    font-weight: 700;
    letter-spacing: -0.01em;
    margin: 0 0 1.6rem;
  }
  .err { color: #b91c1c; min-height: 1.4em; margin: 0.8rem 0 0; font-size: 0.875rem; }
  /* ⚠️ 必须加 !important。
     下面 form { display: flex } 和 input 的样式都是类选择器，
     优先级高于浏览器默认的 [hidden] { display: none }，
     导致 JS 里 el.hidden = true 完全失效 —— 密码已输入、面板已显示，
     密码框却还杵在页面上。这里统一兜住。 */
  [hidden] { display: none !important; }
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

  /* ---- 写作进度面板 ---- */
  #panel { margin-top: 2.5rem; }
  #panel[hidden] { display: none; }
  .panel__tag {
    display: inline-block;
    font-size: 0.75rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    color: var(--accent);
    margin: 0 0 0.9rem;
  }
  .panel__title {
    font-size: 1.25rem;
    font-weight: 700;
    margin: 0 0 1rem;
  }
  .panel__stat { margin: 0 0 1.5rem; color: var(--ink-2); }
  .panel__list { margin: 0 0 2rem; padding-left: 0; list-style: none; }
  .panel__list li { margin: 0 0 0.7rem; }
  .panel__list .done { color: var(--ink); }
  .panel__list .todo { color: var(--ink-3); }
  .panel__list .mark {
    display: inline-block;
    min-width: 3.2rem;
    font-size: 0.8125rem;
    font-weight: 700;
  }
  .panel__list .done .mark { color: var(--accent); }
  .panel__list .todo .mark { color: var(--ink-3); }
  .panel__list .sub {
    margin: -0.25rem 0 0.7rem 1.1rem;
    font-size: 0.9375rem;
  }
  .panel__list .sub .mark { min-width: 2.8rem; font-size: 0.75rem; }
  /* 小节父标题：只作分组，不带已写/待写标记 */
  .panel__list .grp {
    margin: 0.2rem 0 0.9rem;
    color: var(--ink);
    font-weight: 700;
    border-top: 1px solid var(--line);
    padding-top: 0.9rem;
  }
  .panel__list .grp:first-child { border-top: 0; padding-top: 0; }
  .panel__nextlabel {
    display: block;
    font-size: 0.8125rem;
    font-weight: 700;
    color: var(--ink-2);
    margin: 0 0 0.5rem;
  }
  .panel__next {
    display: block;
    width: 100%;
    padding: 0.6rem 0.7rem;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: transparent;
    color: var(--ink);
    font-family: inherit;
    font-size: 0.9375rem;
    line-height: 1.7;
    resize: vertical;
  }
  .panel__next:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .panel__row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin: 0.75rem 0 0;
  }
  .panel__save {
    padding: 0.45rem 0.9rem;
    border: 1px solid var(--accent);
    background: transparent;
    color: var(--accent);
    font-size: 0.875rem;
  }
  .panel__saved { font-size: 0.8125rem; color: var(--ink-3); }
  .panel__hr {
    border: 0;
    border-top: 1px solid var(--line);
    margin: 2.5rem 0 1.5rem;
  }
  .panel__go { width: 100%; }
</style>
</head>
<body>
<div class="box">

  <!-- 锁屏只保留标题和密码框。「正在写 / 站长随笔还在写 / 半成品 / 暂不提供预览」
       这些提示已按站长要求全部删除，不再出现。 -->

  <div class="lock" id="lock">
    <h1 class="lock__title">站长随笔</h1>
    <form id="f" autocomplete="off">
      <input id="pw" type="password" placeholder="请输入访问密码" aria-label="访问密码" />
      <button type="submit">打开</button>
    </form>
    <p class="err" id="err" role="alert"></p>
  </div>

  <!-- ============ 写作进度面板（密码正确后显示） ============
       站长自己用：一眼看清写到哪了、下一节写什么。
       跟读者的「全文」分开，避免把工作界面混进正文。 -->
  <section id="panel" hidden>
    <div class="panel__head">
      <div class="panel__tag">写作进度</div>
      <h2 class="panel__title">站长随笔 · 进度</h2>
    </div>

    <div class="panel__stat">
      <span id="statDone"></span>
    </div>

    <ul class="panel__list" id="outline"></ul>

    <label class="panel__nextlabel" for="nextNote">下一步写什么（手写，随手记）</label>
    <textarea id="nextNote" class="panel__next" rows="4"
      placeholder="写到这里卡住了 / 下一节打算写…"></textarea>
    <div class="panel__row">
      <button type="button" class="panel__save" id="saveNote">保存备注</button>
      <span class="panel__saved" id="savedHint"></span>
    </div>

    <hr class="panel__hr" />

    <button type="button" class="panel__go" id="goRead">读全文</button>
  </section>

</div>

<script>
  // 正文是密文，密码不进 URL、不进 localStorage，仅在内存里解开一次。
  //
  // 解开后**不直接跳全文**，而是先停在「写作进度」面板上 ——
  // 站长要一眼看清写到哪、下一节写什么，再决定要不要读全文。
  // 点「读全文」才 document.write 换页。
  (function () {
    var PAYLOAD = ${P};
    var KDF_ITER = PAYLOAD.iter;
    var NOTE_KEY = 'notes_progress_note';   // 只存「下一步写什么」，不存正文

    var form = document.getElementById('f');
    var pw = document.getElementById('pw');
    var err = document.getElementById('err');
    var panel = document.getElementById('panel');
    var outline = document.getElementById('outline');
    var statDone = document.getElementById('statDone');
    var nextNote = document.getElementById('nextNote');
    var saveNote = document.getElementById('saveNote');
    var savedHint = document.getElementById('savedHint');
    var goRead = document.getElementById('goRead');
    var decrypted = null;   // 解开的正文，先存内存，等用户点「读全文」再用

    function b64ToBytes(b64) {
      var bin = atob(b64);
      var out = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }

    async function derive(password, salt) {
      // WebCrypto 的 PBKDF2 有迭代次数上限，用它推导 SHA-256
      var base = await crypto.subtle.importKey(
        'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
      );
      var bits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt: salt, iterations: KDF_ITER, hash: 'SHA-256' },
        base, 256
      );
      return crypto.subtle.importKey('raw', bits, 'AES-GCM', false, ['decrypt']);
    }

    // 从解密后的正文里抽出所有 h2 小节，作为写作大纲
    function buildOutline(html) {
      var box = document.createElement('div');
      box.innerHTML = html;
      // ⚠️ 必须限定 .wrap —— 明文里锁定提示的标题
      //    「站长随笔还在写」也是 <h2>，但它不在正文容器内。
      //    早先版本用 querySelectorAll('h2') 全量取，
      //    结果进度面板里多出一个不存在的「待写章节」。
      var nodes = Array.prototype.slice.call(box.querySelectorAll('.wrap h2, .wrap h3'));
      var out = [];
      var h2i = 0;
      var h3i = 0;
      nodes.forEach(function (h) {
        var isSub = h.tagName === 'H3';
        if (isSub) {
          h3i += 1;
        } else {
          h2i += 1;
          h3i = 0;
        }
        // 往回数到该小节的第一个 <p>：有内容算已写，只有标题算待写
        var hasBody = false;
        // 紧跟h3 的 h2 本身没有正文（如第四章、第五章），它是小节的父标题，
        // 不该被标成「待写」，单独作为分组标题处理
        var hasSubs = false;
        for (var n = h.nextElementSibling; n && n.tagName !== 'H2'; n = n.nextElementSibling) {
          if (n.tagName === 'H3') {
            if (!hasBody) { hasSubs = true; break; }
            continue;
          }
          if (n.tagName === 'P' && n.textContent.trim().length > 0) { hasBody = true; break; }
        }
        out.push({
          title: h.textContent.trim(),
          hasBody: hasBody,
          hasSubs: hasSubs,
          level: isSub ? 2 : 1,
          // h2 的序号已写进明文标题，目录不重复加；h3 需要补 4.1 / 4.2
          num: isSub ? (h2i + '.' + h3i) : ''
        });
      });
      return out;
    }

    function renderPanel(html) {
      var secs = buildOutline(html);
      outline.innerHTML = '';
      var done = 0;
      var total = 0;
      secs.forEach(function (s) {
        // 小节父标题（第四章、第五章）只作分组标题，不打「已写/待写」标记，也不计入统计
        if (s.hasSubs) {
          var gh = document.createElement('li');
          gh.className = 'grp';
          gh.appendChild(document.createTextNode(s.title));
          outline.appendChild(gh);
          return;
        }
        var li = document.createElement('li');
        li.className = (s.hasBody ? 'done' : 'todo') + (s.level === 2 ? ' sub' : '');
        var mark = document.createElement('span');
        mark.className = 'mark';
        mark.textContent = s.hasBody ? '已写' : '待写';
        li.appendChild(mark);
        li.appendChild(document.createTextNode(s.title));
        outline.appendChild(li);
        total += 1;
        if (s.hasBody) done++;
      });
      statDone.textContent = '共 ' + total + ' 项 · 已写 ' + done + ' 项 · 待写 ' + (total - done) + ' 项';

      // 恢复上次的手写备注
      try {
        var saved = localStorage.getItem(NOTE_KEY);
        if (saved) nextNote.value = saved;
      } catch (e) {}

      // 锁屏整块收起来，避免和面板并存显得杂乱
      document.getElementById('lock').hidden = true;
      panel.hidden = false;
      panel.scrollIntoView({ block: 'start' });
    }

    saveNote.addEventListener('click', function () {
      try {
        localStorage.setItem(NOTE_KEY, nextNote.value);
        savedHint.textContent = '已保存';
        setTimeout(function () { savedHint.textContent = ''; }, 2000);
      } catch (e) {
        savedHint.textContent = '保存失败';
      }
    });

    goRead.addEventListener('click', function () {
      if (!decrypted) return;
      document.open();
      document.write(decrypted);
      document.close();
    });

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      err.textContent = '';
      var password = pw.value;
      if (!password) return;

      try {
        var key = await derive(password, b64ToBytes(PAYLOAD.salt));
        // ⚠️ data 和 tag 必须**分别解码再拼接**。
        //    直接对 base64 字符串做 data + tag 再解码会因为
        //    两段各自的 '=' 填充导致字节错位，GCM 认证必然失败。
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
        // 认证通过（GCM 自带完整性校验，密码错会抛错）
        decrypted = new TextDecoder().decode(plain);
        renderPanel(decrypted);
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
