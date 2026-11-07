/**
 * AI 小助手开通公告补丁（ai-notice-patch.js）
 *
 * 在首页 hero 副标题（「买东西前查一眼...」）下面插入一行加粗公告：
 * 本站已于 2026-11-07 正式开通 AI 劳动法小助手，使用 GLM-4.7-flash。
 *
 * 为什么用补丁而不是改源码：
 * 首页是 Next.js 构建的 bundle，不能直接改压缩后的 JS。
 * 跟项目里其他 -patch.js 一样，运行时在渲染后的 DOM 上插入，bundle 零改动。
 *
 * 幂等：公告节点带 data-ai-notice 标记；MutationObserver 兜底 React 重渲染后重插。
 */
(function () {
  var NOTICE_TEXT = '📢 本站已于 2026-11-07 正式开通 AI 劳动法小助手（GLM-4.7-flash），点右下角 🤖 即可咨询劳动法问题';

  function insertNotice() {
    // 已经插过了就不重复插
    if (document.querySelector('[data-ai-notice]')) return;

    // 找 hero 副标题：包含「买东西前查一眼」的最内层（textContent 最短的）元素
    // 注意：外层大容器的 textContent 也包含这行字，所以要找最短的那个 = 叶子节点本身
    var all = document.querySelectorAll('p, div, span');
    var best = null;
    var bestLen = Infinity;

    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      var text = (el.textContent || '').trim();
      if (text.indexOf('买东西前查一眼') === -1) continue;

      // textContent 最短的就是最内层元素（就是副标题那一行本身）
      if (text.length < bestLen) {
        bestLen = text.length;
        best = el;
      }
    }

    if (!best) return;

    // 创建公告节点
    var notice = document.createElement('p');
    notice.setAttribute('data-ai-notice', '1');
    notice.style.cssText = 'font-weight:700;color:#0f766e;margin-top:16px;font-size:15px;line-height:1.6;text-align:center;';
    notice.textContent = NOTICE_TEXT;

    // 插在副标题后面
    best.parentNode.insertBefore(notice, best.nextSibling);
  }

  // 首次尝试（等页面渲染完再找）
  setTimeout(insertNotice, 800);

  // React 会重渲染，用 MutationObserver 兜底
  var observer = new MutationObserver(function () {
    insertNotice();
  });
  observer.observe(document.body, { childList: true, subtree: true });
})();
