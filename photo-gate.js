/**
 * 照片彩蛋 Star 门禁（真校验版）
 *
 * 背景：2026-10-24 站长要求「Star on GitHub 必须验证，不是用户说 Star」——
 *   此前的荣誉门禁（点「已 Star」按钮就放行）作废。
 *
 * 原理：GitHub 的未登录 API 也能看任意用户的公开 star 列表：
 *   GET https://api.github.com/users/{用户名}/starred?per_page=100
 * 逐页查找 dujeongil-galaxy/shuangxiugou，找到才放行。
 * 无需 OAuth App、无需后端、无 secret；代价是不验账号归属
 * （填谁的昵称就查谁的 star 列表）——UI 上已明示。
 *
 * 「取消 Star 会重新上锁」：每次访问都重新拉列表验，不信本地 flag，
 *   Cookie / localStorage 只记「上次验证通过的用户名」，不记「已解锁」。
 *
 * 交互（2026-10-24 深夜站长实测反馈后补）：
 *   - 输入用户名停顿一下即自动验证，不必非点按钮；
 *   - 无痕窗口/清过缓存刷新时，浏览器会恢复输入框内容但不发 input 事件，
 *     mount 时发现框里有合法用户名就补一次自动验证——否则会出现
 *     「用户名明明在框里、门却还锁着」的假故障（站长原话：连我自己也锁了）；
 *   - 未登录 API 每小时 60 次限流：按 X-RateLimit-Reset 算出重置时刻，
 *     提示写明几点几分自动重试，到点自己再验（一次访问最多自动重试 2 次）；
 *   - 网络抖一下：自动重试 2 次再报错；
 *   - 验证失败（限流/断网）时自动验证也要出提示，不能无声锁着；
 *   - 解锁后给出「别取消 Star、不定期更新更多福利」的常驻提示。
 *
 * 访问节奏（2026-10-25 站长定稿）：每次刷新/关闭浏览器再访问都会重新验证一次；
 *   验证通过后，只要不清理浏览器本地数据（Cookie / localStorage），之后自动
 *   用记忆的用户名重新验证；用户改填别的用户名就按新名字验，没 Star 照样锁着。
 *   静态站没有服务端，Cookie 只在本地面板里存/读，不发请求也不上传。
 *
 * 照片解密不在本文件：2026-10-25 起照片在仓库里是 .enc 密文，验证通过后
 *   调用 SXGPhotoVault.reveal(grid, status, { fetch }) 由 photo-vault.js
 *   取密文→Web Crypto 解密→Blob URL 显示。vault 没加载上时出红字明说，
 *   不允许「解锁了却是一排空框」的静默失败。
 *
 * 形态：UMD——浏览器里挂在 window.SXGPhotoGate 并自动 mount；
 *   Node 里 module.exports 供 test-photo-gate.cjs 用桩 fetch 测试。
 *
 * ⚠️ UMD 坑（2026-10-24 踩过）：工厂函数写在 IIFE 的**参数列表**里，词法作用域
 *   在顶层，**拿不到包装器的 root 参数**——所以 root 必须作为工厂入参传进来
 *   （factory(root)），不能在工厂体内直接写 root.xxx。
 *   这个 bug 在 Node 测试里完全隐形（测试全部注入 opts，短路求值跳过了 root 分支），
 *   一到浏览器自动 mount 才抛 "root is not defined"。
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.SXGPhotoGate = api; api.mount(); }
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  var REPO = 'dujeongil-galaxy/shuangxiugou';
  var USER_KEY = 'sxg-photo-star-user';
  var MAX_PAGES = 10; // 最多翻 10 页（1000 个 star），防极端账号把限流刷爆
  var DEBOUNCE_MS = 700; // 输入停顿这么久才自动验证（省 API 调用）
  var RETRY_DELAYS = [1200, 2400]; // 网络错误自动重试的间隔（毫秒）
  var RATE_BUFFER_MS = 2000; // 限流重置时刻的缓冲（GitHub 时钟与本机可能有偏差）
  var RATE_RETRY_CAP = 2; // 一次访问里最多自动重试几次（防刷）
  var RATE_WAIT_CAP_MS = 2 * 60 * 60 * 1000; // 重置时刻太远（>2 小时）就不自动重试
  var USERNAME_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
  var COOKIE_MAX_AGE = 31536000; // 记忆用户名保留一年（秒）
  var COOKIE_RE = new RegExp('(?:^|;\\s*)' + USER_KEY + '=([^;]*)');

  /**
   * Cookie 记忆（站长口径：「不清理 Cookie 就自动用这个用户名验证」）。
   * 与 localStorage 双写：读的时候 Cookie 优先，localStorage 兜底
   * （有的浏览器/隐私模式会禁其中一种，两种都写才保险）。
   * 静态站没有服务端读 Cookie，它只在本地面板里存/读，不发请求也不上传。
   */
  function cookieJar(doc) {
    return {
      read: function () {
        try {
          var m = COOKIE_RE.exec(String(doc.cookie || ''));
          return m ? decodeURIComponent(m[1]) : null;
        } catch (e) { return null; }
      },
      write: function (u) {
        try {
          doc.cookie = USER_KEY + '=' + encodeURIComponent(u)
            + '; path=/; max-age=' + COOKIE_MAX_AGE + '; SameSite=Lax';
        } catch (e) {}
      },
      clear: function () {
        // ⚠️ 必须带「=」：RFC 6265 规定 set-cookie 串里没有 '=' 就整个忽略，
        //    少个等号 clear() 就是空操作（cookie 永远清不掉）——2026-10-25
        //    行为测试实测抓到这个bug，隔离实验里手写串是带 = 的所以没暴露。
        try { doc.cookie = USER_KEY + '=; path=/; max-age=0'; } catch (e) {}
      }
    };
  }

  // VPN 提示（2026-10-26 站长指令）：挂在代理 IP 上时出口与代理用户共享，
  // GitHub 风控容易判异常——限流/网络失败多半与 VPN 有关，失败当口要提示。
  var VPN_HINT = '若你开着 VPN / 代理，请先关掉再验证（代理 IP 容易被 GitHub 判定异常）。';

  var MSG = {
    checking: '正在拉取你的 GitHub Star 列表…',
    empty: '先填上你的 GitHub 用户名。',
    badname: '这不像 GitHub 用户名（字母/数字/连字符，不超过 39 位）。',
    nouser: 'GitHub 上没有这个用户名，检查下拼写？',
    ratelimit: 'GitHub 接口限流了（未登录每小时 60 次），稍后再试。' + VPN_HINT,
    network: '网络不通，没拉到 GitHub 数据，稍后再试。' + VPN_HINT,
    toomany: '你的 Star 列表太长了（前 1000 个里没有本站），先 Star 再来验证。',
    nostar: '这个用户名还没有 Star 本站——先去点 Star，回来再验证。',
    unstarred: '这个用户名取消 Star 了，门禁重新锁上。'
  };

  function normalize(user) {
    return String(user == null ? '' : user).trim().replace(/^@/, '');
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /** 毫秒时间戳 → 本地 HH:MM:SS（限流提示里给用户看重置时刻） */
  function hhmmss(ms) {
    var d = new Date(ms);
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
  }

  /** 从响应头读 X-RateLimit-Reset（unix 秒）→ 毫秒时间戳；读不到返回 0 */
  function readReset(res) {
    try {
      var getter = res.headers && res.headers.get;
      var raw = getter ? getter.call(res.headers, 'X-RateLimit-Reset') : null;
      var n = parseInt(raw, 10);
      if (n > 0) return n * 1000;
    } catch (e) { /* 拿不到就算了，退回普通限流提示 */ }
    return 0;
  }

  /**
   * checkStar(user, fetchImpl, cb, opts)
   * @param fetchImpl 可注入的 fetch（测试用桩）；返回 Promise<Response>
   * @param cb(found:boolean, errCode:string|undefined, info:{resetAt?:number}|undefined)
   * @param opts.retryDelays 网络错误重试间隔数组（测试注入小值）
   */
  function checkStar(user, fetchImpl, cb, opts) {
    opts = opts || {};
    var retryDelays = opts.retryDelays || RETRY_DELAYS;
    user = normalize(user);
    if (!user) return cb(false, 'empty');
    if (!USERNAME_RE.test(user)) return cb(false, 'badname');

    var page = 1;
    var pages = 0;
    var done = false;
    var netTry = 0;

    function finish(found, code, info) {
      if (!done) { done = true; cb(found, code, info); }
    }

    function next() {
      if (done) return;
      fetchImpl('https://api.github.com/users/' + encodeURIComponent(user)
        + '/starred?per_page=100&page=' + page)
        .then(onRes)
        .catch(function () {
          if (done) return;
          // 网络抖一下：自动重试，重试耗尽才报 network
          if (netTry < retryDelays.length) {
            var delay = retryDelays[netTry++];
            setTimeout(next, delay);
          } else {
            finish(false, 'network');
          }
        });
    }

    function onRes(res) {
      if (done) return;
      if (res.status === 404) return finish(false, 'nouser');
      if (res.status === 403 || res.status === 429) {
        var resetAt = readReset(res);
        return finish(false, 'ratelimit', resetAt ? { resetAt: resetAt } : undefined);
      }
      if (!res.ok) return finish(false, 'http' + res.status);
      return res.json().then(function (list) {
        if (done) return;
        pages++;
        for (var i = 0; i < list.length; i++) {
          if (list[i] && list[i].full_name === REPO) return finish(true);
        }
        if (list.length === 100) {
          if (pages < MAX_PAGES) { page++; return next(); }
          return finish(false, 'toomany');
        }
        return finish(false, 'nostar');
      }).catch(function () { finish(false, 'network'); });
    }

    next();
  }

  /**
   * mount(opts)：接线 DOM。opts 可注入 document / localStorage / cookie /
   *   fetch / vault / debounceMs / retryDelays / rateBufferMs（测试用）。
   * 返回 { verify, unlock, say } 或 null（页面没有门禁元素时）。
   */
  function mount(opts) {
    opts = opts || {};
    var doc = opts.document || (typeof document !== 'undefined' ? document : null);
    if (!doc) return null;
    var store = opts.localStorage || (root.localStorage || null);
    var fetchImpl = opts.fetch || (root.fetch ? root.fetch.bind(root) : null);
    var box = doc.getElementById('sxg-gate-box');
    var grid = doc.getElementById('sxg-photo-grid');
    var form = doc.getElementById('sxg-gate-form');
    var input = doc.getElementById('sxg-gate-user');
    var btn = doc.getElementById('sxg-gate-verify');
    var msg = doc.getElementById('sxg-gate-msg');
    var note = doc.getElementById('sxg-gate-unlocked-note');
    var status = doc.getElementById('sxg-photo-status'); // 可选：解密状态位（photo-vault 用）
    if (!box || !grid || !form || !input || !btn || !msg) return null;
    var debounceMs = opts.debounceMs == null ? DEBOUNCE_MS : opts.debounceMs;
    var retryDelays = opts.retryDelays || RETRY_DELAYS;
    var rateBufferMs = opts.rateBufferMs == null ? RATE_BUFFER_MS : opts.rateBufferMs;
    var cookie = opts.cookie || cookieJar(doc);

    function say(text, kind) {
      msg.textContent = text || '';
      msg.hidden = !text;
      msg.className = 'gate-msg' + (kind ? ' gate-msg--' + kind : '');
    }

    function unlock() {
      box.hidden = true;
      if (note) note.hidden = false;
      revealPhotos();
    }

    /**
     * 把照片交给 photo-vault 解密显示（仓库里只有 .enc 密文）。
     * vault 没加载上/调不通：状态位出红字、网格保持隐藏——
     * 不允许「解锁了却是一排空框」的静默失败。
     */
    function revealPhotos() {
      var vault = opts.vault || root.SXGPhotoVault || null;
      if (vault && typeof vault.reveal === 'function') {
        try {
          vault.reveal(grid, status, { fetch: fetchImpl });
          return;
        } catch (e) { /* 当作 vault 不可用，落到下面的明示分支 */ }
      }
      if (status) {
        status.textContent = '照片解密组件没有加载成功，刷新页面试试。';
        status.hidden = false;
        status.className = 'photo-status photo-status--err';
      }
      // 显式收回网格：解锁流程本身不显示网格（显示是 vault 的职责），
      // 但万一将来有人在 unlock 里提前 unhide，这里至少兜回隐藏态。
      grid.hidden = true;
    }

    var inflight = null; // 正在验证的用户名（同一用户不重复打 API）
    var debounceTimer = null;
    var rateTimer = null;
    var rateRetries = 0;

    function clearDebounce() {
      if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
    }

    function clearRateTimer() {
      if (rateTimer) { clearTimeout(rateTimer); rateTimer = null; }
    }

    function rateLimitText(info) {
      if (info && info.resetAt) {
        return 'GitHub 接口限流了（未登录每小时 60 次），将在 '
          + hhmmss(info.resetAt) + ' 自动重试，稍等一下。' + VPN_HINT;
      }
      return MSG.ratelimit;
    }

    /** 限流不是用户的错：按重置时刻挂一个到点自动重试 */
    function scheduleRateRetry(user, info) {
      clearRateTimer();
      if (!info || !info.resetAt) return;
      if (rateRetries >= RATE_RETRY_CAP) return;
      var wait = info.resetAt - Date.now() + rateBufferMs;
      if (wait <= 0) wait = rateBufferMs;
      if (wait > RATE_WAIT_CAP_MS) return;
      rateRetries++;
      rateTimer = setTimeout(function () {
        rateTimer = null;
        verify(user, false);
      }, wait);
    }

    /**
     * verify(user, silent, known)
     * @param silent 自动验证（mount 时）：不刷「正在拉取」，但失败要出提示
     * @param known  这个用户名是本站记忆的（取消过 Star 的人）——false 时
     *               nostar 用「还没 Star」口径，不用「取消 Star」口径
     */
    function verify(user, silent, known) {
      var u = normalize(user);
      if (!fetchImpl) { say(MSG.network, 'err'); return; }
      if (inflight === u) return; // 同一用户正在验，不重复打 API
      clearRateTimer();
      inflight = u;
      btn.disabled = true;
      if (!silent) say(MSG.checking, 'check');
      checkStar(u, fetchImpl, function (found, code, info) {
        if (inflight === u) inflight = null;
        btn.disabled = false;
        if (found) {
          rateRetries = 0;
          try {
            store && store.setItem(USER_KEY, u);
            cookie && cookie.write(u);
          } catch (e) {}
          say('', '');
          unlock();
          return;
        }
        if (note) note.hidden = true;
        if (code === 'nostar') {
          if (!silent) say(MSG.nostar, 'err');
          else say(known ? MSG.unstarred : MSG.nostar, 'err');
        } else if (code === 'ratelimit') {
          say(rateLimitText(info), 'err');
          scheduleRateRetry(u, info);
        } else {
          say(MSG[code] || MSG.network, 'err');
        }
        // 用户名本身不对时清掉记忆，避免每次访问都拿错名字去问 GitHub
        if (code === 'nouser' || code === 'badname' || code === 'empty') {
          try { store && store.removeItem(USER_KEY); } catch (e) {}
          try { cookie && cookie.clear(); } catch (e) {}
        }
      }, { retryDelays: retryDelays });
    }

    // 输入停顿即自动验证（站长：「每次输入用户名都会自动验证」）
    input.addEventListener('input', function () {
      clearDebounce();
      var v = normalize(input.value);
      if (!v || !USERNAME_RE.test(v)) return; // 空/非法：等用户继续输，不插旗
      debounceTimer = setTimeout(function () {
        debounceTimer = null;
        verify(v, false);
      }, debounceMs);
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      clearDebounce();
      verify(input.value, false);
    });

    // 返回访问：Cookie / localStorage 记忆里有用户名就自动重新校验。
    // 真校验不信本地 flag——取消 Star 的人再回来会重新看到门禁。
    // Cookie 优先读（站长口径「不清理 Cookie 就自动验证」），localStorage 兜底。
    var saved = null;
    try { saved = (cookie && cookie.read()) || (store && store.getItem(USER_KEY)); } catch (e) {}
    if (saved) {
      input.value = normalize(saved);
      verify(saved, true, true);
    } else {
      // 无痕窗口/清过缓存：浏览器刷新时会恢复输入框内容，但不发 input 事件，
      // 页面不知道该验——「用户名在框里却还锁着」就是这么来的。补一次自动验证。
      var restored = normalize(input.value);
      if (restored && USERNAME_RE.test(restored)) verify(restored, true, false);
    }

    return { verify: verify, unlock: unlock, say: say };
  }

  return {
    REPO: REPO,
    USER_KEY: USER_KEY,
    MAX_PAGES: MAX_PAGES,
    MSG: MSG,
    checkStar: checkStar,
    mount: mount
  };
});
