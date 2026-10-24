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
 *   localStorage 只记「上次验证通过的用户名」，不记「已解锁」。
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

  var MSG = {
    checking: '正在拉取你的 GitHub Star 列表…',
    empty: '先填上你的 GitHub 用户名。',
    badname: '这不像 GitHub 用户名（字母/数字/连字符，不超过 39 位）。',
    nouser: 'GitHub 上没有这个用户名，检查下拼写？',
    ratelimit: 'GitHub 接口限流了（未登录每小时 60 次），稍后再试。',
    network: '网络不通，没拉到 GitHub 数据，稍后再试。',
    toomany: '你的 Star 列表太长了（前 1000 个里没有本站），先 Star 再来验证。',
    nostar: '这个用户名还没有 Star 本站——先去点 Star，回来再验证。',
    unstarred: '这个用户名取消 Star 了，门禁重新锁上。'
  };

  /**
   * checkStar(user, fetchImpl, cb)
   * @param fetchImpl 可注入的 fetch（测试用桩）；返回 Promise<Response>
   * @param cb(found:boolean, errCode:string|undefined)
   */
  function checkStar(user, fetchImpl, cb) {
    user = String(user || '').trim().replace(/^@/, '');
    if (!user) return cb(false, 'empty');
    if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(user)) return cb(false, 'badname');

    var page = 1;
    var pages = 0;
    var done = false;

    function finish(found, code) {
      if (!done) { done = true; cb(found, code); }
    }

    function next() {
      if (done) return;
      fetchImpl('https://api.github.com/users/' + encodeURIComponent(user)
        + '/starred?per_page=100&page=' + page)
        .then(function (res) {
          if (res.status === 404) return finish(false, 'nouser');
          if (res.status === 403 || res.status === 429) return finish(false, 'ratelimit');
          if (!res.ok) return finish(false, 'http' + res.status);
          return res.json().then(function (list) {
            pages++;
            for (var i = 0; i < list.length; i++) {
              if (list[i] && list[i].full_name === REPO) return finish(true);
            }
            if (list.length === 100) {
              if (pages < MAX_PAGES) { page++; return next(); }
              return finish(false, 'toomany');
            }
            return finish(false, 'nostar');
          });
        })
        .catch(function () { finish(false, 'network'); });
    }

    next();
  }

  /**
   * mount(opts)：接线 DOM。opts 可注入 document / localStorage / fetch（测试用）。
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
    if (!box || !grid || !form || !input || !btn || !msg) return null;

    function say(text, kind) {
      msg.textContent = text || '';
      msg.hidden = !text;
      msg.className = 'gate-msg' + (kind ? ' gate-msg--' + kind : '');
    }

    function unlock() {
      box.hidden = true;
      grid.hidden = false;
      var imgs = grid.querySelectorAll('img[data-src]');
      for (var i = 0; i < imgs.length; i++) {
        imgs[i].src = imgs[i].getAttribute('data-src');
      }
    }

    function verify(user, silent) {
      if (!fetchImpl) { say(MSG.network, 'err'); return; }
      btn.disabled = true;
      if (!silent) say(MSG.checking, 'check');
      checkStar(user, fetchImpl, function (found, code) {
        btn.disabled = false;
        if (found) {
          try { store && store.setItem(USER_KEY, user); } catch (e) {}
          say('', '');
          unlock();
          return;
        }
        if (code === 'nostar') {
          say(input.value.trim() && !silent ? MSG.nostar : MSG.unstarred, 'err');
        } else if (!silent) {
          say(MSG[code] || MSG.network, 'err');
        }
        // 用户名本身不对时清掉记忆，避免每次访问都拿错名字去问 GitHub
        if (code === 'nouser' || code === 'badname' || code === 'empty') {
          try { store && store.removeItem(USER_KEY); } catch (e) {}
        }
      });
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      verify(input.value, false);
    });

    // 返回访问：记忆里有用户名就自动重新校验。
    // 真校验不信本地 flag——取消 Star 的人再回来会重新看到门禁。
    var saved = null;
    try { saved = store && store.getItem(USER_KEY); } catch (e) {}
    if (saved) {
      input.value = saved;
      verify(saved, true);
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
