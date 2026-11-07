/**
 * 海比优广告文案排版优化补丁
 *
 * 问题：这段居中文字的容器太窄，导致换行很碎，最后一行只剩「告费。」两个字。
 * 优化：放宽最大宽度，让换行更均匀好看。
 */
(function () {
  function fixAdText() {
    // 已经修过了就不重复修
    if (document.querySelector('[data-ad-width-fixed]')) return;

    // 找包含「海比优」的最内层元素，然后向上找容器
    var all = document.querySelectorAll('p, div, span');
    var target = null;
    var bestLen = Infinity;

    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      var text = (el.textContent || '').trim();
      if (text.indexOf('海比优') === -1) continue;
      if (text.indexOf('限号注册') === -1) continue;

      if (text.length < bestLen) {
        bestLen = text.length;
        target = el;
      }
    }

    if (!target) return;

    // 向上找两层，找到包裹这两段文字的容器
    var container = target.parentNode;
    for (var j = 0; j < 3 && container; j++) {
      // 容器应该包含「海比优」和「广告费」两段文字
      var cText = container.textContent || '';
      if (cText.indexOf('海比优') !== -1 && cText.indexOf('广告费') !== -1) {
        container.setAttribute('data-ad-width-fixed', '1');
        // 放宽最大宽度，让文字换行更均匀
        container.style.maxWidth = '720px';
        container.style.marginLeft = 'auto';
        container.style.marginRight = 'auto';
        break;
      }
      container = container.parentNode;
    }
  }

  setTimeout(fixAdText, 1000);

  var observer = new MutationObserver(function () {
    fixAdText();
  });
  observer.observe(document.body, { childList: true, subtree: true });
})();
