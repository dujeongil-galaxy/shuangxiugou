/**
 * AI 小助手开通公告补丁（ai-notice-patch.js）
 *
 * 在首页 hero 副标题（「买东西前查一眼...」）下面插入一行加粗公告：
 * 本站已于 2026-11-07 正式开通 AI 劳动法小助手，使用 GLM-4.7-flash。
 *
 * 为什么用补丁而不是改源码：
 * 首页是 Next.js 构建的 bundle，不能直接改压缩后的 JS。
 * 跟项目里其他 -patch.js 一样，运行时在渲染好的 DOM 上插入，bundle 零改动。
 *
 * 幂等：公告节点带 data-ai-notice 标记；MutationObserver 兜底 React 重渲染后重插。
 */
(function () {
  var NOTICE_TEXT = '📢 本站已于 2026-11-07 正式开通 AI 劳动法小助手（GLM-4.7-flash），点右下角 🤖 即可咨询劳动法问题';

  function insertNotice() {
    // 已经插过了就不重复插
    if (document.querySelector('[data-ai-notice]')) return;

    // 找 hero 副标题：包含「买东西前查一眼」的 <p> 或 <div>
    var all = document.querySelectorAll('p, div, span');
    var target = null;
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      var text = el.textContent || '';
      // 精确匹配副标题关键词，避免匹配到其他地方的相同文字
      if (text.indexOf('买东西前查一眼') !== -1 && text.indexOf('守法严产者') !== -1) {
        target = el;
        break;
      }
    }

    if (!target) return;

    // 创建公告节点
    var notice = document.createElement('p');
    notice.setAttribute('data-ai-notice', '1');
    notice.style.cssText = 'font-weight:700;color:#0f766e;margin-top:16px;font-size:15px;line-height:1.6;';
    notice.textContent = NOTICE_TEXT;

    // 插在副标题后面
    target.parentNode.insertBefore(notice, target.nextSibling);
  }

  // 首次尝试
  insertNotice();

  // React 会重渲染，用 MutationObserver 兜底
  var observer = new MutationObserver(function () {
    insertNotice();
  });
  observer.observe(document.body, { childList: true, subtree: true });
})();
