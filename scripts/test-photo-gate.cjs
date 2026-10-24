// photo-gate.js 真校验 Star 门禁的行为测试
// 跑法：node scripts/test-photo-gate.cjs（需要 jsdom，与其它 test-*.cjs 一致）
//
// 测的是真实上线的 photo-gate.js（UMD，Node 侧直接 require）：
//   1. checkStar：第 1 页就 Star 了 → 放行
//   2. checkStar：Star 在第 2 页（翻页）→ 放行
//   3. checkStar：翻完都没 Star → 不放行（nostar）
//   4. checkStar：用户名不存在（404）→ nouser
//   5. checkStar：限流（403/429）→ ratelimit
//   6. checkStar：网络断 → network
//   7. checkStar：空用户名 / 非法用户名 → 直接拒，且不打 API（省限流）
//   8. checkStar：超过 10 页还没找到 → toomany，且 API 调用恰好 10 次
//   9. mount：验证通过 → 门禁卡隐藏、照片网格显示、img.src 被写上、用户名入 localStorage
//  10. mount：没 Star → 门禁不消失、出提示、照片不加载
//  11. mount：记忆用户名 + 仍 Star → 进页面自动解锁（返回访问）
//  12. mount：记忆用户名 + 已取消 Star → 保持锁定并提示（取消 Star 会重新上锁）
//  13. mount：未解锁前 img 没有 src（不预载照片）
//  14. mount：表单 submit 触发校验（不是只有点按钮才行）
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const gate = require(path.join(ROOT, 'photo-gate.js'));
const REPO = gate.REPO;

let pass = 0, fail = 0;
const failures = [];
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else {
    fail++; failures.push(label);
    console.log('  ✗', label, extra !== undefined ? JSON.stringify(extra) : '');
  }
}

// ---------- 桩 fetch ----------
function mkRepo(name) { return { full_name: name }; }
// 满页要正好 100 个（checkStar 的翻页判据是 list.length === 100）
const OTHER = Array.from({ length: 100 }, (_, i) => mkRepo('someone/other-' + i));

// 按页表生成桩：pages 是数组，每页是仓库 full_name 数组
// ⚠️ 页码必须锚 ? / & 解析：URL 里 per_page=100 也含 "page=" 字样，
//    用 /page=(\d+)/ 会先命中 per_page=100，把页码解析成 100（本项目
//    PITFALLS 里「src= 误匹配 data-src=」的同款子串坑）。
function mkFetchByPages(pages, opts) {
  opts = opts || {};
  const calls = [];
  const impl = (url) => {
    calls.push(url);
    const m = /[?&]page=(\d+)/.exec(url);
    const page = m ? parseInt(m[1], 10) : 1;
    if (opts.status && opts.status[page]) {
      return Promise.resolve({ ok: false, status: opts.status[page], json: () => Promise.resolve({}) });
    }
    const list = (pages[page - 1] || []).map(mkRepo);
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(list) });
  };
  impl.calls = calls;
  return impl;
}

function mkFetchOnce(status, list) {
  const calls = [];
  const impl = () => {
    calls.push(1);
    return Promise.resolve({ ok: status === 200, status, json: () => Promise.resolve(list || []) });
  };
  impl.calls = calls;
  return impl;
}

function mkFetchReject() {
  const calls = [];
  const impl = () => { calls.push(1); return Promise.reject(new Error('offline')); };
  impl.calls = calls;
  return impl;
}

// ---------- checkStar 单测 ----------
console.log('============================================================');
console.log('photo-gate.js · checkStar 逻辑');
console.log('============================================================');

(function () {
  // 1. 第 1 页就 Star
  const f = mkFetchByPages([['a/b', REPO, 'c/d']]);
  gate.checkStar('someone', f, (found, code) => {
    check('第 1 页就 Star 了 → 放行', found === true && code === undefined, { found, code });
    check('请求打的是 api.github.com 的 starred 列表',
      /^https:\/\/api\.github\.com\/users\/someone\/starred\?per_page=100&page=1$/.test(f.calls[0]), f.calls[0]);
  });

  // 2. Star 在第 2 页
  const f2 = mkFetchByPages([OTHER, [REPO]]);
  gate.checkStar('paged', f2, (found, code) => {
    check('Star 在第 2 页 → 翻页后放行', found === true, { found, code });
    check('第 1 页满 100 才翻页（共 2 次请求）', f2.calls.length === 2, f2.calls.length);
  });

  // 3. 翻完都没 Star
  const f3 = mkFetchByPages([OTHER, ['a/b']]);
  gate.checkStar('nostar', f3, (found, code) => {
    check('两页都没 Star → 不放行', found === false && code === 'nostar', { found, code });
  });

  // 4. 用户名不存在
  const f4 = mkFetchByPages([], { status: { 1: 404 } });
  gate.checkStar('ghost', f4, (found, code) => {
    check('404 → nouser', found === false && code === 'nouser', { found, code });
  });

  // 5. 限流
  const f5 = mkFetchByPages([], { status: { 1: 403 } });
  gate.checkStar('limited', f5, (found, code) => {
    check('403 → ratelimit', found === false && code === 'ratelimit', { found, code });
  });
  const f5b = mkFetchByPages([], { status: { 1: 429 } });
  gate.checkStar('limited2', f5b, (found, code) => {
    check('429 → ratelimit', found === false && code === 'ratelimit', { found, code });
  });

  // 6. 网络断
  const f6 = mkFetchReject();
  gate.checkStar('offline', f6, (found, code) => {
    check('网络断 → network', found === false && code === 'network', { found, code });
  });

  // 7. 空 / 非法用户名：不打 API
  const f7 = mkFetchByPages([[REPO]]);
  gate.checkStar('   ', f7, (found, code) => {
    check('空用户名 → 直接拒（empty）', found === false && code === 'empty', { found, code });
  });
  gate.checkStar('坏 名字!', f7, (found, code) => {
    check('非法用户名 → 直接拒（badname）', found === false && code === 'badname', { found, code });
  });
  check('空/非法用户名没有打 API（省限流）', f7.calls.length === 0, f7.calls.length);
  gate.checkStar('@someone', f7, (found, code) => {
    check('用户名带 @ 前缀也能验（自动剥掉）', found === true, { found, code });
  });

  // 8. 超过 MAX_PAGES
  const bigPages = Array.from({ length: 20 }, () => OTHER);
  const f8 = mkFetchByPages(bigPages);
  gate.checkStar('starriver', f8, (found, code) => {
    check('超过 10 页还没找到 → toomany', found === false && code === 'toomany', { found, code });
    check('API 调用恰好 10 次（不无限翻页刷限流）', f8.calls.length === gate.MAX_PAGES, f8.calls.length);
  });
})();

// ---------- mount 行为测试（jsdom） ----------
console.log('============================================================');
console.log('photo-gate.js · mount 行为（jsdom 真 DOM）');
console.log('============================================================');

const GATE_HTML = `
<!DOCTYPE html><html><body>
  <div class="gate-box" id="sxg-gate-box">
    <form class="gate-form" id="sxg-gate-form">
      <input class="gate-input" id="sxg-gate-user" type="text" />
      <button id="sxg-gate-verify" type="submit">验证并解锁</button>
    </form>
    <p class="gate-msg" id="sxg-gate-msg" hidden></p>
  </div>
  <div class="photo-grid" id="sxg-photo-grid" hidden>
    <img data-src="./photo-kuromi.jpg" alt="a" />
    <img data-src="./photo-melody.jpg" alt="b" />
  </div>
</body></html>`;

function mkEnv(savedUser) {
  const dom = new JSDOM(GATE_HTML, { runScripts: 'outside-only', pretendToBeVisual: true });
  const data = {};
  const store = {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: (k) => { delete data[k]; },
  };
  if (savedUser) data[gate.USER_KEY] = savedUser;
  const doc = dom.window.document;
  return { dom, doc, store, data };
}

(function () {
  // 9. 验证通过 → 全套解锁动作
  const env = mkEnv();
  const f = mkFetchByPages([[REPO]]);
  const api = gate.mount({ document: env.doc, localStorage: env.store, fetch: f });
  check('mount 返回 API（元素齐全）', !!api);
  env.doc.getElementById('sxg-gate-user').value = 'starfan';
  env.doc.getElementById('sxg-gate-form').dispatchEvent(
    new env.dom.window.Event('submit', { bubbles: true, cancelable: true })
  );
  return Promise.resolve().then(() => new Promise((r) => setTimeout(r, 20))).then(() => {
    check('验证通过 → 门禁卡隐藏', env.doc.getElementById('sxg-gate-box').hidden === true);
    check('验证通过 → 照片网格显示', env.doc.getElementById('sxg-photo-grid').hidden === false);
    const imgs = env.doc.querySelectorAll('#sxg-photo-grid img');
    check('验证通过 → 两张照片 src 都被写上',
      imgs[0].getAttribute('src') === './photo-kuromi.jpg' && imgs[1].getAttribute('src') === './photo-melody.jpg');
    check('验证通过 → 用户名写入 localStorage', env.data[gate.USER_KEY] === 'starfan', env.data);
  });
})();

(function () {
  // 10. 没 Star → 不解锁
  const env = mkEnv();
  const f = mkFetchByPages([['a/b']]);
  const api = gate.mount({ document: env.doc, localStorage: env.store, fetch: f });
  env.doc.getElementById('sxg-gate-user').value = 'lurker';
  api.verify('lurker', false);
  return Promise.resolve().then(() => new Promise((r) => setTimeout(r, 20))).then(() => {
    check('没 Star → 门禁卡不隐藏', env.doc.getElementById('sxg-gate-box').hidden === false);
    check('没 Star → 出提示文案', /还没有 Star 本站/.test(env.doc.getElementById('sxg-gate-msg').textContent));
    const imgs = env.doc.querySelectorAll('#sxg-photo-grid img');
    check('没 Star → 照片不加载（src 不写）', !imgs[0].getAttribute('src') && !imgs[1].getAttribute('src'));
    check('没 Star → 不写 localStorage 解锁记忆', !(gate.USER_KEY in env.data));
  });
})();

(function () {
  // 11. 返回访问：记忆用户名 + 仍 Star → 自动解锁
  const env = mkEnv('starfan');
  const f = mkFetchByPages([[REPO]]);
  gate.mount({ document: env.doc, localStorage: env.store, fetch: f });
  return Promise.resolve().then(() => new Promise((r) => setTimeout(r, 20))).then(() => {
    check('返回访问（仍 Star）→ 自动解锁', env.doc.getElementById('sxg-photo-grid').hidden === false);
    check('返回访问 → 用户名回填输入框', env.doc.getElementById('sxg-gate-user').value === 'starfan');
  });
})();

(function () {
  // 12. 返回访问：已取消 Star → 重新上锁
  const env = mkEnv('quitter');
  const f = mkFetchByPages([['a/b']]);
  gate.mount({ document: env.doc, localStorage: env.store, fetch: f });
  return Promise.resolve().then(() => new Promise((r) => setTimeout(r, 20))).then(() => {
    check('取消 Star 再回来 → 保持锁定', env.doc.getElementById('sxg-photo-grid').hidden === true);
    check('取消 Star 再回来 → 提示重新锁上',
      /取消 Star/.test(env.doc.getElementById('sxg-gate-msg').textContent),
      env.doc.getElementById('sxg-goto-msg') || env.doc.getElementById('sxg-gate-msg').textContent);
  });
})();

(function () {
  // 13. 未解锁前不预载
  const env = mkEnv();
  const f = mkFetchByPages([['a/b']]);
  gate.mount({ document: env.doc, localStorage: env.store, fetch: f });
  const imgs = env.doc.querySelectorAll('#sxg-photo-grid img');
  check('未解锁前 img 没有 src（不预载照片）', !imgs[0].getAttribute('src') && !imgs[1].getAttribute('src'));

  // 14. submit 事件触发校验
  const f2 = mkFetchByPages([[REPO]]);
  const env2 = mkEnv();
  const api2 = gate.mount({ document: env2.doc, localStorage: env2.store, fetch: f2 });
  env2.doc.getElementById('sxg-gate-user').value = 'formfan';
  env2.doc.getElementById('sxg-gate-form').dispatchEvent(
    new env2.dom.window.Event('submit', { bubbles: true, cancelable: true })
  );
  return Promise.resolve().then(() => new Promise((r) => setTimeout(r, 20))).then(() => {
    check('表单 submit 即触发校验（无需单独绑按钮）', f2.calls.length === 1, f2.calls.length);
    check('submit 校验通过 → 解锁', env2.doc.getElementById('sxg-photo-grid').hidden === false);
  });
})();

// ---------- 等所有异步断言落地后汇总 ----------
setTimeout(() => {
  console.log('============================================================');
  if (fail === 0) {
    console.log(`通过 ${pass} 项，全部通过`);
    process.exit(0);
  } else {
    console.log(`通过 ${pass} 项，失败 ${fail} 项：`);
    failures.forEach((f) => console.log('  -', f));
    process.exit(1);
  }
}, 300);
