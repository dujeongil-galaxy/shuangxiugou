/**
 * 照片彩蛋 · 解密渲染 + 点击放大灯箱（photo-vault.js）
 *
 * 背景：2026-10-25 站长要求「照片在仓库中加密」——photo-kuromi.jpg /
 *   photo-melody.jpg 曾是 git 跟踪的明文（clone 即可得）。现在仓库里只有
 *   .enc 密文容器（scripts/encrypt-photos.mjs 生成，PBKDF2-SHA256 21 万次
 *   + AES-256-GCM，与 notes.html 同一套参数），访客页面在 Star 门禁通过后
 *   才在浏览器本地解密成 Blob 显示。
 *
 * ⚠️ 诚实的安全口径（别自欺欺人，也别在文案里吹）：
 *   解密口令写在本文件里（浏览器要用），所以「防得住翻仓库/clone 的人，
 *   防不住刻意读前端源码的人」——静态站零后端的先天上限。加密解决的是
 *   「仓库里不躺明文」；真正的门是 Star 门禁（photo-gate.js 真校验）。
 *
 * 分工（与 photo-gate.js 的契约）：
 *   - photo-gate.js 只管「这个人有没有 Star 本站」；验证通过后调用
 *     SXGPhotoVault.reveal(grid, statusEl, { fetch })，本文件负责
 *     取密文 → 解密 → 写 img.src（Blob URL）→ 显示网格；
 *   - 解密失败/组件没加载：状态位出红字，网格保持隐藏——不允许出现
 *     「解锁了却是一排空框」的静默失败；
 *   - 灯箱：点击网格里的照片放大查看，Esc / 遮罩 / ✕ 关闭，附带
 *     「图片来源于网络，请不要恶意传播」的免责提示（站长 2026-10-25 要求）。
 *
 * 页面契约（why-shuangxiugou.html）：
 *   - 照片节点：<img data-enc="./photo-xxx.jpg.enc" alt="…">，藏在
 *     hidden 的 #sxg-photo-grid 里；data-enc 指向 .enc 容器；
 *   - 状态位：#sxg-photo-status（.photo-status，[hidden] 有 CSS 兜底）；
 *   - 灯箱：#sxg-photo-lightbox（含 .photo-lightbox__x / [data-close]
 *     遮罩与 ✕ / #sxg-photo-lightbox-img / #sxg-photo-lightbox-cap）。
 *
 * 形态：UMD——浏览器里挂在 window.SXGPhotoVault 并自动 mount（只接灯箱，
 *   不自动解密）；Node 里 module.exports 供 test-photo-vault.cjs 测试。
 *
 * ⚠️ UMD 坑（photo-gate.js 2026-10-24 踩过）：工厂函数写在 IIFE 参数列表里，
 *   词法作用域在顶层，拿不到包装器的 root 参数——所以 root 必须作为工厂
 *   入参传进来（factory(root)），不能在工厂体内直接写 root.xxx。
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.SXGPhotoVault = api; if (typeof api.mount === 'function') api.mount(); }
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  /* 解密口令。与 scripts/encrypt-photos.mjs 的 PASSPHRASE 必须一致；
     换口令要两边一起改，然后重跑加密脚本。
     ⚠️ 它在前端源码里就等于公开——防仓库明文，不防刻意破解。 */
  var PASSPHRASE = 'sxg-photo-vault-5zsF6Hj06ETkOEQD';
  var CONTAINER_V = 1;

  /** 汇总运行环境依赖（浏览器用全局，测试可逐项注入桩） */
  function impls(opts) {
    opts = opts || {};
    var g = (typeof globalThis !== 'undefined') ? globalThis : root;
    return {
      fetch: opts.fetch || (root.fetch ? root.fetch.bind(root) : null),
      subtle: opts.subtle || (root.crypto && root.crypto.subtle)
        || (g.crypto && g.crypto.subtle) || null,
      atob: opts.atob || root.atob || g.atob || null,
      Blob: opts.Blob || root.Blob || g.Blob || null,
      TextEncoder: opts.TextEncoder || root.TextEncoder || g.TextEncoder || null,
      createObjectURL: opts.createObjectURL
        || (root.URL && root.URL.createObjectURL && root.URL.createObjectURL.bind(root.URL))
        || (g.URL && g.URL.createObjectURL && g.URL.createObjectURL.bind(g.URL))
        || null,
      revokeObjectURL: opts.revokeObjectURL
        || (root.URL && root.URL.revokeObjectURL && root.URL.revokeObjectURL.bind(root.URL))
        || (g.URL && g.URL.revokeObjectURL && g.URL.revokeObjectURL.bind(g.URL))
        || null,
      passphrase: opts.passphrase || PASSPHRASE
    };
  }

  /** base64 → Uint8Array（& 0xff 防 charCode 超 255 时高位污染） */
  function b64ToBuf(b64, atobImpl) {
    var bin = atobImpl(b64);
    var len = bin.length;
    var bytes = new Uint8Array(len);
    for (var i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i) & 0xff;
    return bytes;
  }

  /** PBKDF2-SHA256 派生 AES-256 密钥（与 encrypt-photos.mjs 同参数） */
  function deriveKey(passphrase, salt, iter, impl) {
    var enc = new impl.TextEncoder();
    return impl.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey'])
      .then(function (base) {
        return impl.subtle.deriveKey(
          { name: 'PBKDF2', salt: salt, iterations: iter, hash: 'SHA-256' },
          base,
          { name: 'AES-GCM', length: 256 },
          false,
          ['decrypt']
        );
      });
  }

  /**
   * decryptContainer(container, impl) → Promise<Blob>
   * container：.enc 文件的 JSON（{ v, alg, iter, name, type, salt, iv, tag, data }）
   * ⚠️ data 和 tag 必须分别 base64 解码再拼接（Web Crypto 的 AES-GCM 要求
   *    tag 附在密文尾部）——照抄 notes.html 的口径；直接拼 base64 字符串
   *    会因为各自的 padding 解出乱码。
   */
  function decryptContainer(container, impl) {
    if (!container || container.v !== CONTAINER_V) {
      return Promise.reject(new Error('容器版本不对（v=' + (container && container.v) + '）'));
    }
    var body = b64ToBuf(container.data, impl.atob);
    var tag = b64ToBuf(container.tag, impl.atob);
    var buf = new Uint8Array(body.length + tag.length);
    buf.set(body, 0);
    buf.set(tag, body.length);
    return deriveKey(impl.passphrase, b64ToBuf(container.salt, impl.atob), container.iter, impl)
      .then(function (key) {
        return impl.subtle.decrypt(
          { name: 'AES-GCM', iv: b64ToBuf(container.iv, impl.atob), tagLength: 128 },
          key,
          buf
        );
      })
      .then(function (plain) {
        return new impl.Blob([plain], { type: container.type || 'image/jpeg' });
      });
  }

  /** 取一个 .enc 并解密成 Blob URL */
  function loadOne(url, impl) {
    return impl.fetch(url).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).then(function (container) {
      return decryptContainer(container, impl);
    }).then(function (blob) {
      return impl.createObjectURL(blob);
    });
  }

  /**
   * reveal(grid, status, opts) → Promise
   * 网格里所有 img[data-enc] 全部解密成功才显示（半截照片比没有更糟）；
   * 任一失败：状态位出红字、网格保持隐藏、已建的 Blob URL 撤销。
   * 幂等：已成功显示过再调用直接返回（防重复解锁建一堆 Blob URL）。
   */
  function reveal(grid, status, opts) {
    opts = opts || {};
    var impl = impls(opts);
    if (!grid) return Promise.reject(new Error('照片网格节点缺失'));
    if (!impl.fetch || !impl.subtle || !impl.atob || !impl.Blob
      || !impl.TextEncoder || !impl.createObjectURL) {
      return Promise.reject(new Error('浏览器不支持 Web Crypto，无法解密照片'));
    }
    if (grid.hidden === false && grid.getAttribute('data-vault-done') === '1') {
      return Promise.resolve(); // 已解锁过：不重复取密文
    }

    function setStatus(text, kind) {
      if (!status) return;
      status.textContent = text || '';
      status.hidden = !text;
      status.className = 'photo-status' + (kind ? ' photo-status--' + kind : '');
    }

    var imgs = grid.querySelectorAll('img[data-enc]');
    if (imgs.length === 0) {
      setStatus('照片节点缺失（data-enc），刷新页面试试。', 'err');
      return Promise.resolve();
    }

    setStatus('正在解密照片…', 'check');
    var created = [];
    var jobs = [];
    for (var i = 0; i < imgs.length; i++) {
      jobs.push(loadOne(imgs[i].getAttribute('data-enc'), impl).then(function (url) {
        created.push(url);
        return url;
      }));
    }
    return Promise.all(jobs).then(function (urls) {
      for (var j = 0; j < imgs.length; j++) imgs[j].setAttribute('src', urls[j]);
      grid.hidden = false;
      grid.setAttribute('data-vault-done', '1');
      setStatus('', '');
    }).catch(function (err) {
      for (var k = 0; k < created.length; k++) {
        try { if (impl.revokeObjectURL) impl.revokeObjectURL(created[k]); } catch (e) {}
      }
      setStatus('照片解密失败（' + ((err && err.message) || '未知错误')
        + '）。刷新页面试试，反复失败就先取消再重新 Star。', 'err');
    });
  }

  /**
   * mount(opts)：接灯箱（点击网格照片放大；Esc/遮罩/✕ 关闭）。
   * 只负责灯箱交互，不自动解密——解密由 photo-gate.js 验证通过后触发。
   * 返回 { open, close } 或 null（页面没有灯箱元素时）。
   */
  function mount(opts) {
    opts = opts || {};
    var doc = opts.document || (typeof document !== 'undefined' ? document : null);
    if (!doc) return null;
    var grid = doc.getElementById('sxg-photo-grid');
    var box = doc.getElementById('sxg-photo-lightbox');
    if (!grid || !box) return null;
    var lbImg = doc.getElementById('sxg-photo-lightbox-img');
    var lbCap = doc.getElementById('sxg-photo-lightbox-cap');
    var lastFocus = null;

    function open(src, caption) {
      lastFocus = doc.activeElement || null;
      if (lbImg) { lbImg.setAttribute('src', src); lbImg.setAttribute('alt', caption || ''); }
      if (lbCap) lbCap.textContent = caption || '';
      box.hidden = false;
      if (doc.body) doc.body.style.overflow = 'hidden';
      var x = box.querySelector('.photo-lightbox__x');
      if (x && x.focus) { try { x.focus(); } catch (e) {} }
    }

    function close() {
      if (box.hidden) return; // 已经关着：别重复动焦点和滚动锁
      box.hidden = true;
      if (doc.body) doc.body.style.overflow = '';
      if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) {} }
    }

    // 事件委托：照片是解密后才出现的，监听绑在网格上才抓得到
    grid.addEventListener('click', function (e) {
      var t = e.target;
      var img = t && t.closest ? t.closest('img') : null;
      if (!img || !grid.contains(img)) return;
      var src = img.getAttribute('src');
      if (!src) return; // 还没解密完的点不得响应
      var cell = img.closest ? img.closest('.photo-cell') : null;
      var cap = cell && cell.querySelector ? cell.querySelector('figcaption') : null;
      open(src, cap ? cap.textContent : '');
    });

    var closers = box.querySelectorAll('[data-close]');
    for (var i = 0; i < closers.length; i++) {
      closers[i].addEventListener('click', close);
    }
    doc.addEventListener('keydown', function (e) {
      if (e && (e.key === 'Escape' || e.keyCode === 27)) close();
    });

    return { open: open, close: close };
  }

  return {
    decryptContainer: decryptContainer,
    reveal: reveal,
    mount: mount,
    b64ToBuf: b64ToBuf
  };
});
