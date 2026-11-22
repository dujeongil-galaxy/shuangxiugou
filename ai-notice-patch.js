/**
 * AI 小助手开通公告补丁（ai-notice-patch.js）
 *
 * 在首页 hero 副标题（「买东西前查一眼...」）下面插入一行公告：
 * 第一行动态显示站点已运行时长（天/时/分/秒），第二行从 2026-11-21 开始写升级与附件上传。
 *
 * 文案沿革：
 * - 初版只写开通日期；2026-11-18 补上当日全面升级 + 旧版遗留代码清除。
 * - 2026-11-22 站长要求彻底重写：改为运行时长 + 2026-11-21 升级 + 附件上传 + 欢迎 Star，
 *   两行显示，第二行从「2026」开始换行。
 *
 * 建仓时刻取自 GitHub API created_at = 2026-09-29T16:54:35Z（时分秒齐全，无需按 0 点兜底）。
 * 这里写 UTC 时刻，由浏览器按访问者本地时区自行换算，中国访客看到的是 2026-09-30 00:54:35 起算。
 *
 * 为什么用补丁而不是改源码：
 * 首页是 Next.js 构建的 bundle，不能直接改压缩后的 JS。
 * 跟项目里其他 -patch.js 一样，运行时在渲染后的 DOM 上插入，bundle 零改动。
 *
 * 幂等：公告节点带 data-ai-notice 标记；MutationObserver 兜底 React 重渲染后重插。
 * 计时只改文本节点（characterData），不新增/删除节点，不会触发 observer 反复插入。
 */
(function () {
  var SITE_START = new Date('2026-09-29T16:54:35Z');
  var NOTICE_HEAD = '📢 本站已运行 ';
  var NOTICE_TAIL = '2026-11-21再次升级AI劳动法小助手，当前已支持附件上传。欢迎Star on GitHub，谢谢~！';

  function elapsedText() {
    var seconds = Math.max(0, Math.floor((Date.now() - SITE_START.getTime()) / 1000));
    var days = Math.floor(seconds / 86400); seconds -= days * 86400;
    var hours = Math.floor(seconds / 3600); seconds -= hours * 3600;
    var minutes = Math.floor(seconds / 60); seconds -= minutes * 60;
    return days + '天' + hours + '时' + minutes + '分' + seconds + '秒';
  }

  var timeLine = null;

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

    // 创建公告节点：圆角矩形、浅绿底，两行布局（第一行动态时长，第二行从 2026 起）
    var notice = document.createElement('p');
    notice.setAttribute('data-ai-notice', '1');
    notice.style.cssText = 'display:inline-block;font-weight:600;color:#0f766e;background:#f0fdfa;border:1px solid #99f6e4;border-radius:14px;padding:8px 20px;margin:20px auto 0;font-size:14px;line-height:1.6;text-align:center;box-shadow:0 1px 2px rgba(15,118,110,0.08);';

    timeLine = document.createElement('span');
    timeLine.textContent = NOTICE_HEAD + elapsedText();

    var upgradeLine = document.createElement('span');
    upgradeLine.textContent = NOTICE_TAIL;

    notice.appendChild(timeLine);
    notice.appendChild(document.createElement('br'));
    notice.appendChild(upgradeLine);

    // 包一层 div 实现居中
    var wrapper = document.createElement('div');
    wrapper.style.cssText = 'text-align:center;';
    wrapper.appendChild(notice);

    // 插在副标题后面
    best.parentNode.insertBefore(wrapper, best.nextSibling);
  }

  // 首次尝试（等页面渲染完再找）
  setTimeout(insertNotice, 800);

  // 每秒刷新运行时长（只改文本，不碰节点结构）
  setInterval(function () {
    if (timeLine && timeLine.parentNode) timeLine.textContent = NOTICE_HEAD + elapsedText();
  }, 1000);

  // React 会重渲染，用 MutationObserver 兜底
  var observer = new MutationObserver(function () {
    insertNotice();
  });
  observer.observe(document.body, { childList: true, subtree: true });
})();
