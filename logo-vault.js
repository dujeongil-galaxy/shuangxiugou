/**
 * 品牌 LOGO 解密加载器（logo-vault.js）
 *
 * 背景：2026-11-05 站长要求「LOGO 图标缓存放 GitHub 仓库，blob 容器、
 *   不得明文，优化后不再引用站外来源」。59 张核实过的品牌 LOGO 经
 *   scripts/build-logos.mjs（规范化 ≤128px PNG）+ scripts/encrypt-logos.mjs
 *   （PBKDF2-SHA256 21 万次 + AES-256-GCM，与 photo-*.enc / notes.html
 *   同一套参数）打包成单个 assets/logos.enc 容器；本文件在浏览器本地
 *   解密成 Blob URL 填进卡片的 logo 框。
 *
 * ⚠️ 诚实的安全口径（与 photo-vault.js 相同）：
 *   解密口令写在本文件里（浏览器要用），「防得住翻仓库/clone 拿到明文
 *   图片文件，防不住刻意读前端源码的人」——静态站零后端的先天上限。
 *   加密解决的是「仓库里不躺明文」，别在文案里吹。
 *
 * 页面契约（index.html）：
 *   - 加密 LOGO 的卡片：config.logo 写成 'enc:<slug>'（如 'enc:kfc'）；
 *     卡片构建器给 logo <img> 标 data-sxg-enc="<slug>"，src 先放一张
 *     1px 透明 GIF 占位（不会触发 onerror 破图）；
 *   - 构建早于解密完成时，img 被推进 window.__sxgEncQueue；本文件解密
 *     成功后统一回填（队列 + 全 DOM 扫描双保险）；
 *   - 成功：document 派发 'sxg-logos-ready'；失败：派发 'sxg-logos-failed'
 *     并把没填上的 logo 框恢复成品牌文字（img.alt），不留空框。
 *
 * 形态：UMD——浏览器挂 window.SXGLogoVault 并自动 mount；Node 里
 *   module.exports 供 test-logo-vault.cjs 注入桩测试。
 *
 * ⚠️ UMD 坑（photo-gate.js 2026-10-24 踩过）：工厂函数写在 IIFE 参数列表里
 *   拿不到包装器的 root——root 必须作为工厂入参传进来（factory(root)）。
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.SXGLogoVault = api; if (typeof api.mount === 'function') api.mount(); }
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  /* 解密口令。与 scripts/encrypt-logos.mjs 的 PASSPHRASE 必须一致；
     换口令要两边一起改，然后重跑加密脚本。
     ⚠️ 它在前端源码里就等于公开——防仓库明文，不防刻意破解。 */
  var PASSPHRASE = 'sxg-logo-vault-K7m2QpW9xRt4';
  var CONTAINER_V = 1;

  /* 密文容器地址。重新加密过容器就把 v=N 的 N +1 防缓存。 */
  var ENC_URL = './assets/logos.enc?v=1';

  var TRANSPARENT_GIF =
    'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

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
      TextDecoder: opts.TextDecoder || root.TextDecoder || g.TextDecoder || null,
      createObjectURL: opts.createObjectURL
        || (root.URL && root.URL.createObjectURL && root.URL.createObjectURL.bind(root.URL))
        || (g.URL && g.URL.createObjectURL && g.URL.createObjectURL.bind(g.URL))
        || null,
      passphrase: opts.passphrase || PASSPHRASE,
      encUrl: opts.encUrl || ENC_URL,
      doc: opts.doc || (root.document || null)
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

  /** PBKDF2-SHA256 派生 AES-256 密钥（与 encrypt-logos.mjs 同参数） */
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
   * decryptContainer(container, impl) → Promise<Object>
   * container：logos.enc 的 JSON（{ v, alg, iter, name, type, salt, iv, tag, data }）
   * ⚠️ data 和 tag 必须分别 base64 解码再拼接（Web Crypto 的 AES-GCM 要求
   *    tag 附在密文尾部）——照抄 notes.html / photo-vault.js 的口径。
   * 解密结果是 JSON 文本：{ logos: { <slug>: { t, d } } }
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
        var parsed = JSON.parse(new impl.TextDecoder('utf-8').decode(plain));
        if (!parsed || !parsed.logos) throw new Error('容器明文缺 logos 字段');
        return parsed.logos;
      });
  }

  /* ---- 状态：slug → Blob URL；ready 后不再二次请求 ---- */
  var urlMap = {};
  var readyPromise = null;

  function isReady() { return readyPromise !== null && Object.keys(urlMap).length > 0; }

  /** 取某 slug 的 Blob URL；未就绪/没有该 slug 返回 null */
  function url(slug) {
    return Object.prototype.hasOwnProperty.call(urlMap, slug) ? urlMap[slug] : null;
  }

  /** 把一个 [data-sxg-enc] img 填上真图（就绪时）或排队（未就绪时） */
  function adopt(img) {
    if (!img || img.getAttribute('data-sxg-enc') === null) return false;
    var slug = img.getAttribute('data-sxg-enc');
    var u = url(slug);
    if (u) { img.src = u; return true; }
    if (isReady() === false && readyPromise) {
      (root.__sxgEncQueue = root.__sxgEncQueue || []).push(img);
    }
    return false;
  }

  /** 全量回填：队列 + 全 DOM 扫描双保险（两处来源，漏一处就空框） */
  function fillAll(impl) {
    var filled = 0;
    var queue = root.__sxgEncQueue || [];
    for (var i = 0; i < queue.length; i++) {
      var q = queue[i];
      var u = url(q.getAttribute && q.getAttribute('data-sxg-enc'));
      if (u) { q.src = u; filled++; }
    }
    root.__sxgEncQueue = [];
    if (impl.doc) {
      var imgs = impl.doc.querySelectorAll('img[data-sxg-enc]');
      for (var j = 0; j < imgs.length; j++) {
        var u2 = url(imgs[j].getAttribute('data-sxg-enc'));
        if (u2) { imgs[j].src = u2; filled++; }
      }
    }
    return filled;
  }

  /** 解密失败：没填上的 logo 框恢复品牌文字（img.alt），不留空框 */
  function restoreFallbacks(impl) {
    root.__sxgEncQueue = [];
    if (!impl.doc) return;
    var imgs = impl.doc.querySelectorAll('img[data-sxg-enc]');
    for (var i = 0; i < imgs.length; i++) {
      (function (img) {
        var div = img.parentElement;
        if (!div || div.getAttribute('data-logo-fallback')) return;
        div.setAttribute('data-logo-fallback', '1');
        div.textContent = img.alt || '';
      })(imgs[i]);
    }
  }

  /**
   * load(opts) → Promise<number 回填数>
   * 幂等：已就绪再调用直接 resolve(0)，不重复取密文/建 Blob URL。
   */
  function load(opts) {
    if (readyPromise && Object.keys(urlMap).length > 0) return Promise.resolve(0);
    var impl = impls(opts);
    if (!impl.fetch || !impl.subtle || !impl.atob || !impl.Blob
      || !impl.TextEncoder || !impl.TextDecoder || !impl.createObjectURL) {
      return Promise.reject(new Error('浏览器不支持 Web Crypto，无法解密 LOGO'));
    }
    var p = impl.fetch(impl.encUrl).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).then(function (container) {
      return decryptContainer(container, impl);
    }).then(function (logos) {
      var map = {};
      Object.keys(logos).forEach(function (slug) {
        var item = logos[slug];
        var blob = new impl.Blob([b64ToBuf(item.d, impl.atob)], { type: item.t || 'image/png' });
        map[slug] = impl.createObjectURL(blob);
      });
      urlMap = map;
      var n = fillAll(impl);
      if (impl.doc && typeof impl.doc.dispatchEvent === 'function') {
        impl.doc.dispatchEvent(new (root.Event || impl.doc.defaultView.Event)('sxg-logos-ready'));
      }
      return n;
    }, function (err) {
      restoreFallbacks(impl);
      if (impl.doc && typeof impl.doc.dispatchEvent === 'function') {
        impl.doc.dispatchEvent(new (root.Event || impl.doc.defaultView.Event)('sxg-logos-failed'));
      }
      throw err;
    });
    readyPromise = p;
    return p;
  }

  /** 浏览器自动挂载：解密 + 回填（Node 里不自动跑） */
  function mount() {
    return load().catch(function (err) {
      // 静默失败会留下一排空 logo 框——降级成文字已在 restoreFallbacks 里做，
      // 这里只把错误打到 console 供排查（不要吞掉，测试要靠它抓回归）。
      if (root.console && root.console.warn) root.console.warn('[logo-vault]', err && err.message);
    });
  }

  return {
    load: load,
    mount: mount,
    adopt: adopt,
    fillAll: fillAll,
    restoreFallbacks: restoreFallbacks,
    url: url,
    isReady: isReady,
    decryptContainer: decryptContainer,
    TRANSPARENT_GIF: TRANSPARENT_GIF,
    ENC_URL: ENC_URL,
    PASSPHRASE: PASSPHRASE,
    _state: function () { return { urlMap: urlMap, ready: !!readyPromise }; }
  };
});
