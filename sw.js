/*
 * shuangxiugou Service Worker
 * ----------------------------------------------------------------------------
 * 站长 2026-11-09 担心的根因：GitHub Pages 给 HTML 设了 ~10 分钟 CDN 缓存，
 * 站点刚部署的几分钟里，部分用户还会拿到「旧版 index.html」——旧版可能还引用着
 * 旧的黑卡脚本，于是屏幕上先冒出「全网用户总计消费投票」那个旧黑弹窗。
 *
 * 修法（底层架构，而非打补丁）：
 *   - 对所有「文档导航」请求（mode === 'navigate'）做 network-first：
 *     在线就永远拉最新 HTML，绝不让 10 分钟 CDN 缓存把旧版顶在前面；
 *     离线才回落到上次缓存的 HTML（保证断网也能看）。
 *   - 其余请求（JS / CSS / 图片 / notes.html 的 .enc 密文拉取 / 跨域资源）一律
 *     **不拦截、不接管、不缓存**：直接 return，交给浏览器默认处理。
 *     特别关键：notes.html 解密靠 fetch 同域 .enc 文件，那是一条非 navigate 的
 *     普通 GET，本 SW 碰都不碰它，密文解锁链路零影响。
 *   - install 立即 skipWaiting，activate 清理旧缓存并 clients.claim，
 *     让新 SW 尽快接管；页面侧监听 controllerchange 自动刷新一次以用上新版本。
 */

const NAV_CACHE = 'sxg-nav-v1';

self.addEventListener('install', function () {
  // 不等旧 SW、立即激活，缩短「部署 → 生效」的空窗
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil((async function () {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== NAV_CACHE).map((k) => caches.delete(k)));
    } catch (e) { /* 清理失败不影响激活 */ }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', function (event) {
  const req = event.request;
  if (req.method !== 'GET') return;            // 只处理 GET
  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return; // 跨域（图床/字体等）不碰

  // ★ 只接管「文档导航」：保证 HTML 永远取最新，旧黑弹窗不再残留
  if (req.mode === 'navigate') {
    event.respondWith((async function () {
      try {
        const fresh = await fetch(req);
        const cp = fresh.clone();
        caches.open(NAV_CACHE).then((c) => c.put(req, cp)).catch(() => {});
        return fresh;
      } catch (err) {
        const cached = await caches.match(req);
        if (cached) return cached;
        // 连缓存也没有（首次离线且从未访问过该路径）：退回站点首页缓存
        const idx = await caches.match('index.html');
        return idx || Response.error();
      }
    })());
    return;
  }

  // ★ 其余一切（含 notes.html 的 .enc 解密 fetch）全部放行，绝不拦截
  return;
});

// 页面侧可 postMessage('SKIP_WAITING') 强制新 SW 立即接管（调试用）
self.addEventListener('message', function (event) {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
