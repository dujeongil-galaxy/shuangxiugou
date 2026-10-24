// photo-gate.js 真校验 Star 门禁的行为测试
// 跑法：node scripts/test-photo-gate.cjs（需要 jsdom，与其它 test-*.cjs 一致）
//
// 测的是真实上线的 photo-gate.js（UMD，Node 侧直接 require）：
//   checkStar 层：
//   1. 第 1 页就 Star 了 → 放行
//   2. Star 在第 2 页（翻页）→ 放行
//   3. 翻完都没 Star → 不放行（nostar）
//   4. 用户名不存在（404）→ nouser
//   5. 限流（403/429）→ ratelimit；带 X-RateLimit-Reset → 解析出重置时刻
//   6. 网络断 → 自动重试 2 次后才报 network
//   7. 空用户名 / 非法用户名 → 直接拒，且不打 API（省限流）
//   8. 超过 10 页还没找到 → toomany，且 API 调用恰好 10 次
//   mount 层（jsdom 真 DOM）：
//   9.  验证通过 → 门禁卡隐藏、照片网格显示、img.src 被写上、用户名入 localStorage
//   10. 没 Star → 门禁不消失、出提示、照片不加载
//   11. 记忆用户名 + 仍 Star → 进页面自动解锁（返回访问）
//   12. 记忆用户名 + 已取消 Star → 保持锁定并提示（取消 Star 会重新上锁）
//   13. 未解锁前 img 没有 src（不预载照片）
//   14. 表单 submit 触发校验（不是只有点按钮才行）
//   15. 输入停顿即自动验证（站长：「每次输入用户名都会自动验证」）
//   16. 非法/空输入不触发自动验证（省限流）
//   17. 无痕/清缓存刷新：输入框被浏览器恢复但 localStorage 空 → mount 补验并解锁
//       （修站长实测的「刷新一下连我自己也锁了」——恢复值不发 input 事件）
//   18. 恢复值没 Star → 保持锁定且出提示（不无声锁着）
//   19. 限流 → 提示带重置时刻 → 到点自动重试 → 解锁
//   20. 限流但读不到重置时刻 → 普通提示，不挂自动重试
//   21. mount 层网络断 → 自动重试 2 次才报错
//   22. 解锁后出现「别取消 Star / 更多福利」提示条；解锁前是藏的
//   23. 同一用户并发验证只打一次 API（防刷限流）
//   24. 用户名带 @ 前缀也按裸名存储、也能解锁
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

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// 轮询等条件成立。为什么不能只用固定 wait(N)：后续测试块的同步代码
// （构造 JSDOM）会把事件循环拖住，N 毫秒的到期时间可能早于防抖定时器
// 的执行——2026-10-24 实测 wait(40) 里数出来永远是 0 次调用，而定时器
// 其实早就跑完了。轮询等到为止，最多等到 timeoutMs。
function until(condFn, timeoutMs) {
  const start = Date.now();
  return new Promise((resolve) => {
    (function poll() {
      let ok = false;
      try { ok = condFn(); } catch (e) { ok = false; }
      if (ok) return resolve(true);
      if (Date.now() - start >= timeoutMs) return resolve(false);
      setTimeout(poll, 5);
    })();
  });
}

// ---------- 桩 fetch ----------
function mkRepo(name) { return { full_name: name }; }
// 满页要正好 100 个（checkStar 的翻页判据是 list.length === 100）
const OTHER = Array.from({ length: 100 }, (_, i) => mkRepo('someone/other-' + i));

/**
 * 造一个响应桩。resetUnixSec 有值时就带上 X-RateLimit-Reset 响应头
 * （限流提示的「几点几分自动重试」靠它）。
 */
function mkRes(status, list, resetUnixSec) {
  const res = {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(list || []),
  };
  if (resetUnixSec) {
    res.headers = {
      get: (name) => (String(name).toLowerCase() === 'x-ratelimit-reset' ? String(resetUnixSec) : null),
    };
  }
  return res;
}

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
      const st = opts.status[page];
      const reset = (st === 403 || st === 429) && opts.resetAt
        ? Math.floor(opts.resetAt / 1000) : null;
      return Promise.resolve(mkRes(st, {}, reset));
    }
    const list = (pages[page - 1] || []).map(mkRepo);
    return Promise.resolve(mkRes(200, list));
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

/** 第 1 次限流（带重置时刻），之后正常返回「已 Star」——测到点自动重试 */
function mkFetchRateThenStar(resetInMs) {
  const calls = [];
  let n = 0;
  const impl = () => {
    calls.push(1);
    n++;
    if (n === 1) {
      return Promise.resolve(mkRes(403, {}, Math.floor((Date.now() + resetInMs) / 1000)));
    }
    return Promise.resolve(mkRes(200, [mkRepo(REPO)]));
  };
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
  // 5c. 限流带头 → 解析出重置时刻（提示「几点几分自动重试」靠它）
  const f5c = mkFetchByPages([], { status: { 1: 403 }, resetAt: Date.now() + 300000 });
  gate.checkStar('limited3', f5c, (found, code, info) => {
    check('403 带 X-RateLimit-Reset → 解析出重置时刻',
      found === false && code === 'ratelimit' && !!info && info.resetAt > Date.now(),
      { code, info });
  });

  // 6. 网络断：自动重试 2 次才报错
  const f6 = mkFetchReject();
  gate.checkStar('offline', f6, (found, code) => {
    check('网络断 → 自动重试后才报 network', found === false && code === 'network', { found, code });
    check('网络重试次数 = 2（共 3 次请求）', f6.calls.length === 3, f6.calls.length);
  }, { retryDelays: [10, 20] });

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

// ⚠️ 测试 DOM 必须照抄线上 why-shuangxiugou.html 的真实嵌套层级
//    （PITFALLS：少一层容器 = 少一类 bug）——解锁提示条也在里面。
const GATE_HTML = `
<!DOCTYPE html><html><body>
  <div class="gate-box" id="sxg-gate-box">
    <form class="gate-form" id="sxg-gate-form">
      <input class="gate-input" id="sxg-gate-user" type="text" />
      <button id="sxg-gate-verify" type="submit">验证并解锁</button>
    </form>
    <p class="gate-msg" id="sxg-gate-msg" hidden></p>
  </div>
  <p class="gate-unlocked-note" id="sxg-gate-unlocked-note" hidden>已解锁：请勿取消 Star，不定期更新更多福利。取消后再次访问会重新上锁。</p>
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

function el(env, id) { return env.doc.getElementById(id); }
function submit(env) {
  el(env, 'sxg-gate-form').dispatchEvent(
    new env.dom.window.Event('submit', { bubbles: true, cancelable: true })
  );
}
function type(env, value) {
  const input = el(env, 'sxg-gate-user');
  input.value = value;
  input.dispatchEvent(new env.dom.window.Event('input', { bubbles: true }));
}

(function () {
  // 9. 验证通过 → 全套解锁动作
  const env = mkEnv();
  const f = mkFetchByPages([[REPO]]);
  const api = gate.mount({ document: env.doc, localStorage: env.store, fetch: f });
  check('mount 返回 API（元素齐全）', !!api);
  el(env, 'sxg-gate-user').value = 'starfan';
  submit(env);
  return wait(40).then(() => {
    check('验证通过 → 门禁卡隐藏', el(env, 'sxg-gate-box').hidden === true);
    check('验证通过 → 照片网格显示', el(env, 'sxg-photo-grid').hidden === false);
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
  el(env, 'sxg-gate-user').value = 'lurker';
  api.verify('lurker', false);
  return wait(40).then(() => {
    check('没 Star → 门禁卡不隐藏', el(env, 'sxg-gate-box').hidden === false);
    check('没 Star → 出提示文案', /还没有 Star 本站/.test(el(env, 'sxg-gate-msg').textContent));
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
  return wait(40).then(() => {
    check('返回访问（仍 Star）→ 自动解锁', el(env, 'sxg-photo-grid').hidden === false);
    check('返回访问 → 用户名回填输入框', el(env, 'sxg-gate-user').value === 'starfan');
  });
})();

(function () {
  // 12. 返回访问：已取消 Star → 重新上锁
  const env = mkEnv('quitter');
  const f = mkFetchByPages([['a/b']]);
  gate.mount({ document: env.doc, localStorage: env.store, fetch: f });
  return wait(40).then(() => {
    check('取消 Star 再回来 → 保持锁定', el(env, 'sxg-photo-grid').hidden === true);
    check('取消 Star 再回来 → 提示重新锁上',
      /取消 Star/.test(el(env, 'sxg-gate-msg').textContent),
      el(env, 'sxg-gate-msg').textContent);
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
  gate.mount({ document: env2.doc, localStorage: env2.store, fetch: f2 });
  el(env2, 'sxg-gate-user').value = 'formfan';
  submit(env2);
  return wait(40).then(() => {
    check('表单 submit 即触发校验（无需单独绑按钮）', f2.calls.length === 1, f2.calls.length);
    check('submit 校验通过 → 解锁', el(env2, 'sxg-photo-grid').hidden === false);
  });
})();

(function () {
  // 15. 输入停顿即自动验证（不用点按钮）
  const env = mkEnv();
  const f = mkFetchByPages([[REPO]]);
  gate.mount({ document: env.doc, localStorage: env.store, fetch: f, debounceMs: 0 });
  type(env, 'typefan');
  return until(() => f.calls.length === 1, 500).then((ok) => {
    check('输入即自动验证（打了 API）', ok, f.calls.length);
    return until(() => el(env, 'sxg-photo-grid').hidden === false, 500);
  }).then((ok) => {
    check('自动验证通过 → 解锁', ok);
  });
})();

(function () {
  // 16. 非法/空输入不触发自动验证
  const env = mkEnv();
  const f = mkFetchByPages([[REPO]]);
  gate.mount({ document: env.doc, localStorage: env.store, fetch: f, debounceMs: 0 });
  type(env, '坏 名字!');
  type(env, '');
  return wait(40).then(() => {
    check('非法/空输入不触发自动验证（省限流）', f.calls.length === 0, f.calls.length);
  });
})();

(function () {
  // 17. 无痕/清缓存刷新：输入框被浏览器恢复，但 localStorage 是空的。
  //     浏览器恢复值不发 input 事件——mount 时必须补一次自动验证，
  //     否则就是站长实测的「用户名在框里、门还锁着」（连我自己也锁了）。
  const env = mkEnv();
  el(env, 'sxg-gate-user').value = 'dujeongil-galaxy'; // 模拟浏览器恢复的输入值
  const f = mkFetchByPages([[REPO]]);
  gate.mount({ document: env.doc, localStorage: env.store, fetch: f });
  return wait(40).then(() => {
    check('刷新恢复的输入值 → mount 时自动补验', f.calls.length === 1, f.calls.length);
    check('补验通过 → 直接解锁', el(env, 'sxg-photo-grid').hidden === false);
  });
})();

(function () {
  // 18. 恢复值没 Star → 保持锁定且出提示（不能无声锁着）
  const env = mkEnv();
  el(env, 'sxg-gate-user').value = 'lurker';
  const f = mkFetchByPages([['a/b']]);
  gate.mount({ document: env.doc, localStorage: env.store, fetch: f });
  return wait(40).then(() => {
    check('恢复值没 Star → 保持锁定', el(env, 'sxg-photo-grid').hidden === true);
    check('恢复值没 Star → 出提示（不无声锁着）',
      /还没有 Star 本站/.test(el(env, 'sxg-gate-msg').textContent),
      el(env, 'sxg-gate-msg').textContent);
  });
})();

(function () {
  // 19. 限流 → 提示带重置时刻 → 到点自动重试 → 解锁
  const env = mkEnv();
  const f = mkFetchRateThenStar(1050);
  const api = gate.mount({ document: env.doc, localStorage: env.store, fetch: f, rateBufferMs: 0 });
  api.verify('starfan', false);
  return until(() => /自动重试/.test(el(env, 'sxg-gate-msg').textContent), 150).then((ok) => {
    const text = el(env, 'sxg-gate-msg').textContent;
    check('限流提示写明重置时刻和自动重试', ok && /\d{2}:\d{2}:\d{2}/.test(text), text);
    check('限流时门禁保持锁定', el(env, 'sxg-photo-grid').hidden === true);
    return until(() => el(env, 'sxg-photo-grid').hidden === false, 2500);
  }).then((ok) => {
    check('到点自动重试 → 解锁', ok);
    check('自动重试真的打了第二次 API', f.calls.length >= 2, f.calls.length);
  });
})();

(function () {
  // 20. 限流但读不到重置时刻 → 普通提示，不挂自动重试
  const env = mkEnv();
  const f = mkFetchByPages([], { status: { 1: 403 } });
  const api = gate.mount({ document: env.doc, localStorage: env.store, fetch: f });
  api.verify('starfan', false);
  return wait(60).then(() => {
    check('限流（无重置时刻）→ 普通限流提示',
      /稍后再试/.test(el(env, 'sxg-gate-msg').textContent),
      el(env, 'sxg-gate-msg').textContent);
    check('没有重置时刻就不挂自动重试', f.calls.length === 1, f.calls.length);
  });
})();

(function () {
  // 21. mount 层网络断 → 自动重试 2 次才报错
  const env = mkEnv();
  const f = mkFetchReject();
  const api = gate.mount({ document: env.doc, localStorage: env.store, fetch: f, retryDelays: [10, 20] });
  api.verify('starfan', false);
  return wait(150).then(() => {
    check('网络断 → 自动重试 2 次后才报错', f.calls.length === 3, f.calls.length);
    check('重试耗尽 → 网络提示', /网络不通/.test(el(env, 'sxg-gate-msg').textContent));
    check('网络断 → 门禁不解锁', el(env, 'sxg-photo-grid').hidden === true);
  });
})();

(function () {
  // 22. 解锁提示条：解锁前藏、解锁后显示
  const env = mkEnv();
  const f = mkFetchByPages([[REPO]]);
  const api = gate.mount({ document: env.doc, localStorage: env.store, fetch: f });
  check('解锁前提示条是藏的', el(env, 'sxg-gate-unlocked-note').hidden === true);
  api.verify('starfan', false);
  return wait(40).then(() => {
    const note = el(env, 'sxg-gate-unlocked-note');
    check('解锁后提示条显示（别取消 Star / 更多福利）',
      note.hidden === false && /请勿取消 Star/.test(note.textContent) && /更多福利/.test(note.textContent),
      note.textContent);
  });
})();

(function () {
  // 23. 同一用户并发验证只打一次 API
  const env = mkEnv();
  const f = mkFetchByPages([[REPO]]);
  const api = gate.mount({ document: env.doc, localStorage: env.store, fetch: f });
  api.verify('starfan', false);
  api.verify('starfan', false); // 同一个正在验 → 不再打 API
  return wait(40).then(() => {
    check('同一用户并发验证只打一次 API（防刷限流）', f.calls.length === 1, f.calls.length);
    check('去重后照样解锁', el(env, 'sxg-photo-grid').hidden === false);
  });
})();

(function () {
  // 24. 用户名带 @ 前缀：按裸名存储、也能解锁
  const env = mkEnv();
  const f = mkFetchByPages([[REPO]]);
  gate.mount({ document: env.doc, localStorage: env.store, fetch: f });
  el(env, 'sxg-gate-user').value = '@starfan';
  submit(env);
  return wait(40).then(() => {
    check('带 @ 也按裸名存储', env.data[gate.USER_KEY] === 'starfan', env.data);
    check('带 @ 也能解锁', el(env, 'sxg-photo-grid').hidden === false);
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
}, 2600);
