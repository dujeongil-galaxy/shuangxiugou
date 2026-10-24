// photo-vault.js 的行为测试
// 跑法：node scripts/test-photo-vault.cjs（需要 jsdom，与其它 test-*.cjs 一致）
//
// 测的是真实上线的 photo-vault.js（UMD，Node 侧直接 require）：
//   decryptContainer 层：
//   1. 仓库里真实的 .enc + 源码里的真实口令 → 解出的字节与本机明文逐字节一致
//      （本机全量；CI 上没有明文原件，退而验「能解开且是 JPEG」）
//      —— 这条专防「加密脚本与前端口令漂移」：两边口令不一致时上线后
//      所有人都解不开，静态审查看不出来，只能真解密。
//   2. 口令不对 → 拒绝（GCM 认证失败，不是解出一团乱码）
//   3. 容器版本不对 → 拒绝
//   reveal 层（jsdom 真 DOM）：
//   4. 两张照片全部解密成功 → 才写 src、才显网格、状态位清空
//   5. 解密期间状态位显示「正在解密」
//   6. fetch 404 → 状态位红字、网格保持隐藏（不允许空框静默失败）
//   7. 口令/密文不匹配 → 红字、网格保持隐藏
//   8. 已解锁后再调 reveal → 不重复取密文（幂等）
//   9. 网格里没有 data-enc 节点 → 红字明说
//   10. reveal 不依赖 JSDOM 缺失的 URL.createObjectURL（桩注入）
//   mount 层（灯箱）：
//   11. 点击照片 → 灯箱打开、大图=被点照片、标题=图注、锁页面滚动
//   12. Esc / 遮罩 / ✕ 三种方式都能关，且恢复滚动
//   13. 没 src（未解密完）的照片点击不弹灯箱
//   14. 灯箱里带「图片来源于网络，请不要恶意传播」免责提示
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const vault = require(path.join(ROOT, 'photo-vault.js'));
const { webcrypto } = crypto;

let pass = 0, fail = 0;
const failures = [];
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else {
    fail++; failures.push(label);
    console.log('  ✗', label, extra !== undefined ? JSON.stringify(extra) : '');
  }
}

// 从源码里读真实口令——测试与上线代码用同一个值，防止口令漂移
const vaultSrc = fs.readFileSync(path.join(ROOT, 'photo-vault.js'), 'utf8');
const PASSPHRASE = /PASSPHRASE = '([^']+)'/.exec(vaultSrc);
if (!PASSPHRASE) {
  console.error('✗ photo-vault.js 里找不到 PASSPHRASE 定义，测试中止');
  process.exit(1);
}
const REAL_PASS = PASSPHRASE[1];

/** 按 .enc 容器格式加密一个 Buffer（iter 用小值，测试跑得快；容器自带 iter，解密方照用） */
function mkContainer(plainBuf, passphrase, opts) {
  opts = opts || {};
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const iter = opts.iter || 1000;
  const key = crypto.pbkdf2Sync(passphrase, salt, iter, 32, 'sha256');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plainBuf), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: opts.v === undefined ? 1 : opts.v,
    alg: 'PBKDF2-SHA256+AES-256-GCM',
    iter,
    name: 'test.jpg',
    type: 'image/jpeg',
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: data.toString('base64'),
  };
}

/** 桩 fetch：按 URL 返回容器 / 404 / 网络错误 */
function mkFetchEnc(map) {
  const calls = [];
  const impl = (url) => {
    calls.push(url);
    const entry = map[url];
    if (!entry) return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
    if (entry.netError) return Promise.reject(new Error('offline'));
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(entry.container),
    });
  };
  impl.calls = calls;
  return impl;
}

let blobSeq = 0;
function mkUrlFactory() {
  const made = [];
  const fn = (blob) => { blobSeq++; made.push(blob); return 'blob:test-' + blobSeq; };
  fn.made = made;
  return fn;
}

// 测试 DOM 必须照抄线上 why-shuangxiugou.html 的真实嵌套层级
// （PITFALLS：少一层容器 = 少一类 bug）——状态位、网格、灯箱都在里面。
const VAULT_HTML = `
<!DOCTYPE html><html><body>
  <p class="photo-status" id="sxg-photo-status" hidden></p>
  <div class="photo-grid" id="sxg-photo-grid" hidden>
    <figure class="photo-cell">
      <img data-enc="./photo-kuromi.jpg.enc" alt="a" />
      <figcaption>库洛米 · 爱心局</figcaption>
      <span class="photo-zoom-hint">点击放大</span>
    </figure>
    <figure class="photo-cell">
      <img data-enc="./photo-melody.jpg.enc" alt="b" />
      <figcaption>美乐蒂 · 爱心局</figcaption>
      <span class="photo-zoom-hint">点击放大</span>
    </figure>
  </div>
  <div class="photo-lightbox" id="sxg-photo-lightbox" hidden>
    <div class="photo-lightbox__mask" data-close="1"></div>
    <div class="photo-lightbox__panel" role="dialog" aria-modal="true" aria-label="照片放大查看">
      <button class="photo-lightbox__x" type="button" data-close="1" aria-label="关闭">&times;</button>
      <img class="photo-lightbox__img" id="sxg-photo-lightbox-img" alt="" />
      <p class="photo-lightbox__cap" id="sxg-photo-lightbox-cap"></p>
      <p class="photo-lightbox__disclaimer">图片来源于网络，请不要恶意传播，否则隐私权等法律纠纷一律与本站无关</p>
    </div>
  </div>
</body></html>`;

function mkVaultEnv() {
  const dom = new JSDOM(VAULT_HTML, { runScripts: 'outside-only', pretendToBeVisual: true });
  const doc = dom.window.document;
  return {
    dom,
    doc,
    grid: doc.getElementById('sxg-photo-grid'),
    status: doc.getElementById('sxg-photo-status'),
    box: doc.getElementById('sxg-photo-lightbox'),
  };
}

function mkImpls(env, fetchImpl, passphrase) {
  const urlFactory = mkUrlFactory();
  return {
    urlFactory,
    impls: {
      fetch: fetchImpl,
      subtle: webcrypto.subtle,
      atob,
      Blob,
      TextEncoder,
      createObjectURL: urlFactory,
      passphrase: passphrase || REAL_PASS,
    },
  };
}

(async function main() {
  // ================= decryptContainer =================
  console.log('============================================================');
  console.log('photo-vault.js · decryptContainer 解密');
  console.log('============================================================');

  // 1. 仓库真实 .enc + 源码真实口令 → 解开
  {
    const encPath = path.join(ROOT, 'photo-kuromi.jpg.enc');
    const plainPath = path.join(ROOT, 'photo-kuromi.jpg');
    if (fs.existsSync(encPath)) {
      const container = JSON.parse(fs.readFileSync(encPath, 'utf8'));
      const blob = await vault.decryptContainer(container, {
        passphrase: REAL_PASS,
        subtle: webcrypto.subtle,
        atob, Blob, TextEncoder,
      });
      const buf = Buffer.from(await blob.arrayBuffer());
      check('真 .enc + 真口令 → 解得开', buf.length > 0, buf.length);
      check('解密结果是 JPEG（magic FF D8 FF）',
        buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff,
        [buf[0], buf[1], buf[2]].map((n) => n.toString(16)).join(' '));
      if (fs.existsSync(plainPath)) {
        const plain = fs.readFileSync(plainPath);
        check('解密字节与明文原件逐字节一致（口令没漂移）', buf.equals(plain),
          `解出 ${buf.length} B / 明文 ${plain.length} B`);
      } else {
        console.log('  - （CI 环境无明文原件，跳过逐字节比对；magic 已验）');
      }
    } else {
      console.log('  - （没有 photo-kuromi.jpg.enc，跳过真密文测试）');
    }
  }

  // 2. 口令不对 → 拒绝（GCM 认证失败必须显式炸，不能返回乱码）
  {
    const container = mkContainer(Buffer.from([0xff, 0xd8, 0xff, 1, 2, 3]), REAL_PASS);
    let rejected = false;
    try {
      await vault.decryptContainer(container, {
        passphrase: 'wrong-pass-phrase',
        subtle: webcrypto.subtle, atob, Blob, TextEncoder,
      });
    } catch (e) { rejected = true; }
    check('口令不对 → 解密拒绝（GCM 认证失败）', rejected);
  }

  // 3. 容器版本不对 → 拒绝
  {
    const container = mkContainer(Buffer.from([1, 2, 3]), REAL_PASS, { v: 99 });
    let rejected = false;
    try {
      await vault.decryptContainer(container, {
        passphrase: REAL_PASS,
        subtle: webcrypto.subtle, atob, Blob, TextEncoder,
      });
    } catch (e) { rejected = true; }
    check('容器版本不对 → 解密拒绝', rejected);
  }

  // ================= reveal =================
  console.log('============================================================');
  console.log('photo-vault.js · reveal 解密渲染');
  console.log('============================================================');

  // 4/5. 全部成功 → 写 src + 显网格；期间有「正在解密」状态
  {
    const env = mkVaultEnv();
    const PA = 'reveal-pass';
    const fetchImpl = mkFetchEnc({
      './photo-kuromi.jpg.enc': { container: mkContainer(Buffer.from('AAAA-jpeg-a'), PA) },
      './photo-melody.jpg.enc': { container: mkContainer(Buffer.from('BBBB-jpeg-b'), PA) },
    });
    const { urlFactory, impls } = mkImpls(env, fetchImpl, PA);
    const p = vault.reveal(env.grid, env.status, impls);
    check('解密开始 → 状态位显示「正在解密」',
      env.status.hidden === false && /正在解密/.test(env.status.textContent),
      env.status.textContent);
    await p;
    const imgs = env.grid.querySelectorAll('img');
    check('两张照片都拿到 blob src',
      imgs[0].getAttribute('src') === 'blob:test-1' && imgs[1].getAttribute('src') === 'blob:test-2',
      [imgs[0].getAttribute('src'), imgs[1].getAttribute('src')]);
    check('全部成功 → 网格显示', env.grid.hidden === false);
    check('成功标记 data-vault-done（幂等依据）', env.grid.getAttribute('data-vault-done') === '1');
    check('成功 → 状态位清空并隐藏',
      env.status.hidden === true && env.status.textContent === '', env.status.textContent);
    check('解密产物是 image/jpeg Blob',
      urlFactory.made.length === 2 && urlFactory.made.every((b) => b.type === 'image/jpeg'));

    // 8. 幂等
    await vault.reveal(env.grid, env.status, impls);
    check('已解锁 → 重复 reveal 不重复取密文', fetchImpl.calls.length === 2, fetchImpl.calls.length);
  }

  // 6. fetch 404 → 红字、网格仍藏
  {
    const env = mkVaultEnv();
    const fetchImpl = mkFetchEnc({}); // 两个 URL 都 404
    const { impls } = mkImpls(env, fetchImpl, 'any-pass');
    await vault.reveal(env.grid, env.status, impls);
    check('404 → 状态位红字说明失败',
      /解密失败/.test(env.status.textContent) && /photo-status--err/.test(env.status.className),
      env.status.textContent);
    check('404 → 网格保持隐藏（不许空框静默失败）', env.grid.hidden === true);
    check('404 → 没写 data-vault-done（还允许重试）', env.grid.getAttribute('data-vault-done') !== '1');
  }

  // 7. 口令/密文不匹配 → 红字、网格仍藏
  {
    const env = mkVaultEnv();
    const fetchImpl = mkFetchEnc({
      './photo-kuromi.jpg.enc': { container: mkContainer(Buffer.from('AAAA'), 'another-pass') },
      './photo-melody.jpg.enc': { container: mkContainer(Buffer.from('BBBB'), 'another-pass') },
    });
    const { impls } = mkImpls(env, fetchImpl, 'right-pass'); // 与容器口令不一致
    await vault.reveal(env.grid, env.status, impls);
    check('口令不匹配 → 解密失败红字（GCM 认证失败）',
      /解密失败/.test(env.status.textContent), env.status.textContent);
    check('口令不匹配 → 网格保持隐藏', env.grid.hidden === true);
  }

  // 9. 网格里没有 data-enc 节点 → 红字明说
  {
    const env = mkVaultEnv();
    env.grid.innerHTML = '<img alt="no-enc" />';
    const fetchImpl = mkFetchEnc({});
    const { impls } = mkImpls(env, fetchImpl, 'any');
    await vault.reveal(env.grid, env.status, impls);
    check('没有 data-enc 节点 → 红字明说（不是静默无反应）',
      /data-enc/.test(env.status.textContent) && env.grid.hidden === true,
      env.status.textContent);
  }

  // ================= mount 灯箱 =================
  console.log('============================================================');
  console.log('photo-vault.js · mount 灯箱');
  console.log('============================================================');

  // 10-14. 灯箱开合与免责提示
  {
    const env = mkVaultEnv();
    const imgs = env.grid.querySelectorAll('img');
    imgs[0].setAttribute('src', 'blob:test-1');
    const api = vault.mount({ document: env.doc });
    check('mount 返回灯箱 API（元素齐全）', !!api && typeof api.open === 'function');

    // 11. 点击照片 → 打开
    imgs[0].dispatchEvent(new env.dom.window.MouseEvent('click', { bubbles: true }));
    check('点击照片 → 灯箱打开', env.box.hidden === false);
    check('灯箱大图 = 被点照片的 src',
      env.doc.getElementById('sxg-photo-lightbox-img').getAttribute('src') === 'blob:test-1');
    check('灯箱标题 = 照片图注',
      env.doc.getElementById('sxg-photo-lightbox-cap').textContent === '库洛米 · 爱心局',
      env.doc.getElementById('sxg-photo-lightbox-cap').textContent);
    check('打开时锁页面滚动', env.doc.body.style.overflow === 'hidden');

    // 12. Esc 关 + 恢复滚动
    env.doc.dispatchEvent(new env.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    check('Esc → 灯箱关闭', env.box.hidden === true);
    check('关闭后恢复页面滚动', env.doc.body.style.overflow === '');

    // 遮罩关
    api.open('blob:test-2', '美乐蒂 · 爱心局');
    check('open() 直接开灯箱', env.box.hidden === false);
    env.box.querySelector('.photo-lightbox__mask')
      .dispatchEvent(new env.dom.window.MouseEvent('click', { bubbles: true }));
    check('点遮罩 → 关闭', env.box.hidden === true);

    // ✕ 关
    api.open('blob:test-2', 'x');
    env.box.querySelector('.photo-lightbox__x')
      .dispatchEvent(new env.dom.window.MouseEvent('click', { bubbles: true }));
    check('点 ✕ → 关闭', env.box.hidden === true);

    // 13. 没 src 的点不弹
    imgs[1].dispatchEvent(new env.dom.window.MouseEvent('click', { bubbles: true }));
    check('未解密（无 src）的照片点击不弹灯箱', env.box.hidden === true);

    // 14. 免责提示
    check('灯箱带「图片来源于网络，请不要恶意传播」免责提示',
      /图片来源于网络，请不要恶意传播，否则隐私权等法律纠纷一律与本站无关/.test(env.box.textContent),
      env.box.textContent.slice(0, 80));
  }

  console.log('============================================================');
  if (fail === 0) {
    console.log(`通过 ${pass} 项，全部通过`);
    process.exit(0);
  } else {
    console.log(`通过 ${pass} 项，失败 ${fail} 项：`);
    failures.forEach((f) => console.log('  -', f));
    process.exit(1);
  }
})().catch((e) => {
  console.error('测试框架异常：', e);
  process.exit(1);
});
