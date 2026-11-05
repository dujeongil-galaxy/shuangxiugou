// logo-vault.js 的行为测试
// 跑法：node scripts/test-logo-vault.cjs（需要 jsdom，与其它 test-*.cjs 一致）
//
// 测的是真实上线的 logo-vault.js（UMD，Node 侧直接 require）：
//   decryptContainer 层：
//   1. 仓库里真实的 assets/logos.enc + logo-vault.js 源码里的真实口令 →
//      解出 59 张 PNG（PNG magic 抽验），防「加密脚本与前端口令漂移」
//      —— 两边口令不一致时上线后所有 LOGO 框全空，静态审查看不出来
//   2. 口令不对 → 拒绝（GCM 认证失败，不是解出一团乱码）
//   3. 容器版本不对 → 拒绝
//   4. encrypt-logos.mjs 与 logo-vault.js 两处 PASSPHRASE 字面一致
//   load 层（jsdom 真 DOM + 桩 createObjectURL）：
//   5. 全部解密成功 → 队列 + DOM 双回填、Blob URL 进 map、sxg-logos-ready 派发
//   6. 已就绪再 load → 不重复取密文（幂等，fetch 只 1 次）
//   7. fetch 404 → 拒绝 + sxg-logos-failed 派发 + logo 框恢复品牌文字（不留空框）
//   8. 口令/密文不匹配 → 同上失败路径
//   adopt 层：
//   9. 就绪后 adopt(img) 直接填 src 返回 true
//  10. 未就绪 adopt(img) 返回 false 并入队（load 完成后被回填）
//   页面接线（index.html 源码断言）：
//  11. logo-vault.js?v=1 脚本 + preload；59 处 'enc:' 配置；enc:ccb 存在、
//      ccb.svg 手绘旧标不再被引用；构建器有 data-sxg-enc / __sxgEncQueue /
//      object-contain；ENC_URL 的 ?v 与脚本标签一致
//  12. CI 已接线 test-logo-vault.cjs（写完不挂 CI = 只跑一次的测试）
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const VAULT_PATH = path.join(ROOT, 'logo-vault.js');
const vault = require(VAULT_PATH);
const { webcrypto } = crypto;

/** 全新模块实例：load 的幂等守卫挂在模块级状态上，失败场景必须用干净实例 */
function freshVault() {
  delete require.cache[require.resolve(VAULT_PATH)];
  return require(VAULT_PATH);
}

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
const vaultSrc = fs.readFileSync(path.join(ROOT, 'logo-vault.js'), 'utf8');
const mPass = /PASSPHRASE = '([^']+)'/.exec(vaultSrc);
if (!mPass) {
  console.error('✗ logo-vault.js 里找不到 PASSPHRASE 定义，测试中止');
  process.exit(1);
}
const REAL_PASS = mPass[1];

/** 浏览器侧 impl 桩：真 WebCrypto + 真 atob/Blob/TextEncoder + 桩 createObjectURL */
function mkImpl(overrides) {
  let n = 0;
  return Object.assign({
    fetch: () => Promise.reject(new Error('no fetch stub')),
    subtle: webcrypto.subtle,
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    Blob: globalThis.Blob,
    TextEncoder: globalThis.TextEncoder,
    TextDecoder: globalThis.TextDecoder,
    createObjectURL: () => 'blob:mock-' + (++n),
    passphrase: REAL_PASS,
    doc: null,
  }, overrides || {});
}

(async () => {
  /* ---- 1. 真容器 + 真口令：解出 59 张 PNG ---- */
  const encPath = path.join(ROOT, 'assets', 'logos.enc');
  check('assets/logos.enc 存在', fs.existsSync(encPath));
  const container = JSON.parse(fs.readFileSync(encPath, 'utf8'));
  let logos = null;
  try {
    logos = await vault.decryptContainer(container, mkImpl());
    check('真容器+真口令解密成功', !!logos && typeof logos === 'object');
  } catch (e) {
    check('真容器+真口令解密成功', false, e.message);
  }
  const slugs = logos ? Object.keys(logos) : [];
  check('解出 59 张 LOGO', slugs.length === 59, slugs.length);
  check('建行 ccb 在容器里', slugs.includes('ccb'));
  let magicOk = true, allPng = true;
  for (const s of slugs) {
    const head = Buffer.from(logos[s].d, 'base64').slice(0, 4);
    if (head.toString('hex') !== '89504e47') allPng = false;
  }
  if (logos && logos.kfc) magicOk = Buffer.from(logos.kfc.d, 'base64').slice(0, 4).toString('hex') === '89504e47';
  check('抽验 kfc 是真 PNG（magic 89504e47）', magicOk);
  check('全部条目都是 PNG magic', allPng);

  /* ---- 2. 口令不对 → 拒绝 ---- */
  let wrongRejected = false;
  try { await vault.decryptContainer(container, mkImpl({ passphrase: 'wrong-passphrase' })); }
  catch (e) { wrongRejected = true; }
  check('口令不对 → 解密被拒绝', wrongRejected);

  /* ---- 3. 容器版本不对 → 拒绝 ---- */
  let verRejected = false;
  try { await vault.decryptContainer(Object.assign({}, container, { v: 2 }), mkImpl()); }
  catch (e) { verRejected = true; }
  check('容器版本不对 → 解密被拒绝', verRejected);

  /* ---- 4. 两处 PASSPHRASE 字面一致 ---- */
  const encScript = fs.readFileSync(path.join(ROOT, 'scripts', 'encrypt-logos.mjs'), 'utf8');
  const mScript = /PASSPHRASE = '([^']+)'/.exec(encScript);
  check('encrypt-logos.mjs 与 logo-vault.js 口令一致',
    !!mScript && mScript[1] === REAL_PASS);

  /* ---- 5-6. load 成功：双回填 + ready 事件 + 幂等 ---- */
  {
    const dom = new JSDOM('<!doctype html><html><body>'
      + '<div class="w-10 h-10 rounded-xl bg-slate-100"><img data-sxg-enc="kfc" alt="肯德基"></div>'
      + '</body></html>');
    const doc = dom.window.document;
    const fetchCalls = [];
    const impl = mkImpl({
      fetch: (u) => { fetchCalls.push(u); return Promise.resolve({ ok: true, json: () => Promise.resolve(container) }); },
      doc,
    });
    // 未就绪时 adopt：入队
    const queuedImg = doc.querySelector('img[data-sxg-enc]');
    const adoptedEarly = vault.adopt(queuedImg);
    check('未就绪 adopt → 返回 false 并入队', adoptedEarly === false);
    let readyEvent = false;
    doc.addEventListener('sxg-logos-ready', () => { readyEvent = true; });
    const n = await vault.load(impl);
    check('load 解析出回填数', typeof n === 'number' && n >= 1, n);
    check('队列里的 img 被回填 Blob URL', /^blob:mock-/.test(queuedImg.src));
    check('isReady() = true', vault.isReady() === true);
    check('url(kfc) 可取到 Blob URL', /^blob:mock-/.test(vault.url('kfc') || ''));
    check('url(不存在的slug) = null', vault.url('nope') === null);
    check('sxg-logos-ready 已派发', readyEvent);
    check('取密文只 1 次（幂等）', fetchCalls.length === 1, fetchCalls.length);
    let secondN = -1;
    try { secondN = await vault.load(impl); } catch (e) { secondN = -2; }
    check('第二次 load 幂等返回 0', secondN === 0, secondN);
    check('幂等后取密文仍 1 次', fetchCalls.length === 1, fetchCalls.length);
    // 就绪后 adopt：直接填
    const dom2 = new JSDOM('<div class="w-10"><img data-sxg-enc="ccb" alt="建设银行"></div>');
    const img2 = dom2.window.document.querySelector('img[data-sxg-enc]');
    const adoptedLate = vault.adopt(img2);
    check('就绪后 adopt → 直接填 src 返回 true', adoptedLate === true && /^blob:mock-/.test(img2.src));
  }

  /* ---- 7. fetch 404 → 失败路径：failed 事件 + 恢复文字（全新实例防幂等短路） ---- */
  {
    const v7 = freshVault();
    const dom = new JSDOM('<!doctype html><html><body>'
      + '<div class="w-10 h-10"><img data-sxg-enc="kfc" alt="肯德基"></div>'
      + '</body></html>');
    const doc = dom.window.document;
    let failedEvent = false;
    doc.addEventListener('sxg-logos-failed', () => { failedEvent = true; });
    let rejected = false;
    try {
      await v7.load(mkImpl({ fetch: () => Promise.resolve({ ok: false, status: 404 }), doc }));
    } catch (e) { rejected = true; }
    check('404 → load 拒绝（不静默）', rejected);
    const div = doc.querySelector('.w-10');
    check('失败 → logo 框恢复品牌文字', div.getAttribute('data-logo-fallback') === '1' && div.textContent === '肯德基',
      div.textContent);
    check('失败 → sxg-logos-failed 已派发', failedEvent);
  }

  /* ---- 8. 口令/密文不匹配 → 失败路径同上 ---- */
  {
    const v8 = freshVault();
    const dom = new JSDOM('<div class="w-10 h-10"><img data-sxg-enc="kfc" alt="肯德基"></div>');
    const doc = dom.window.document;
    let rejected = false;
    try {
      await v8.load(mkImpl({
        fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve(container) }),
        passphrase: 'mismatched-pass',
        doc,
      }));
    } catch (e) { rejected = true; }
    check('口令不匹配 → load 拒绝', rejected);
    check('口令不匹配 → 框恢复文字', doc.querySelector('.w-10').getAttribute('data-logo-fallback') === '1');
  }

  /* ---- 11. index.html 接线断言 ---- */
  const idx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  check('index.html 已挂 logo-vault.js?v=1', idx.includes('<script defer src="./logo-vault.js?v=1">'));
  check('logo-vault.js 有 preload', idx.includes('<link rel="preload" href="./logo-vault.js?v=1" as="script">'));
  const encCount = (idx.match(/logo: 'enc:/g) || []).length;
  check("index.html 有 59 处 logo: 'enc:' 配置", encCount === 59, encCount);
  check('enc:ccb 已接线（建行换官方标）', idx.includes("logo: 'enc:ccb'"));
  check('手绘旧标 ccb.svg 不再被引用', !idx.includes('./assets/ccb.svg'));
  check('构建器写 data-sxg-enc', idx.includes("setAttribute('data-sxg-enc'"));
  check('构建器接入 __sxgEncQueue 队列', idx.includes('__sxgEncQueue'));
  check('enc 分支用 object-contain（文字标不裁边）', /enc:\/\.test\(config\.logo\)[\s\S]{0,700}object-contain/.test(idx));
  check('占位用 1px 透明 GIF（不触发 onerror）', /enc:\/\.test\(config\.logo\)[\s\S]{0,400}TRANSPARENT_GIF/.test(idx));
  // ENC_URL 的缓存号与脚本标签一致（防「改了容器没 bump ?v」）
  const mEncUrl = /ENC_URL = '\.\/assets\/logos\.enc\?v=(\d+)'/.exec(vaultSrc);
  check('ENC_URL 带 ?v 缓存号', !!mEncUrl);
  const mTag = /logo-vault\.js\?v=(\d+)/.exec(idx);
  check('ENC_URL ?v 与脚本标签 ?v 一致', !!mEncUrl && !!mTag && mEncUrl[1] === mTag[1]);

  /* ---- 12. CI 接线 ---- */
  const ci = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'verify.yml'), 'utf8');
  check('CI 已接线 test-logo-vault.cjs', ci.includes('node scripts/test-logo-vault.cjs'));

  console.log(`\n通过 ${pass} / ${pass + fail}`);
  if (fail) {
    console.error('失败项：');
    failures.forEach((f) => console.error('  -', f));
    process.exit(1);
  }
})().catch((e) => { console.error(e); process.exit(1); });
