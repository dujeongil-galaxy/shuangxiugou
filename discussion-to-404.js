/* 讨论广场「发布交流」→ 专属说明页（功能暂未开放）
 *
 * 背景：该表单原先只把内容写入 React 本地 state（刷新即丢），站点无后端，
 * 收不到任何提交。曾尝试改为跳转 GitHub Issues 预填表单，现决定暂缓——
 * 先把按钮指向一个如实告知「暂未开放」的页面，不做假提交，也不做半成品入口。
 *
 * ⚠️ 为什么不用 404.html：
 *    根目录的 404.html 是**全站兜底**，GitHub Pages 会把它显示给
 *    任何访问了不存在网址的人。若把「你点的『发布交流』暂未开放」
 *    写在那儿，别人只是输错一个字母，也会被告知他点了这个按钮——
 *    那是错的。所以这里另开discussion-closed.html 放专属说明。
 *
 * 实现思路：把「发布交流」按钮直接替换成指向该页的 <a> 标签。
 * 不监听任何事件——href 本身就是跳转，浏览器原生行为最可靠。
 *
 * 为什么需要 MutationObserver：
 * 弹窗是点击「匿名发帖交流」后才渲染的，页面初始 DOM 里没有这个按钮，
 * 所以要持续监测它出现，一旦出现就替换。
 */
(function () {
  'use strict';
  if (window.__discussionReady) return;
  window.__discussionReady = true;

  var TARGET = 'discussion-closed.html';

  // 把「发布交流」按钮替换为等样式的 <a> 链接
  function swap() {
    var btns = document.querySelectorAll('button[type="submit"]');
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i];
      if (b.textContent.indexOf('发布交流') < 0) continue;
      if (b.getAttribute('data-404-swapped') === '1') continue;
      b.setAttribute('data-404-swapped', '1');

      var a = document.createElement('a');
      a.href = TARGET;
      a.className = b.className;   // 沿用原样式，外观不变
      a.textContent = b.textContent;
      b.parentNode.replaceChild(a, b);
    }
  }

  // 持续监测弹窗渲染出来
  var target = document.getElementById('root') || document.body;
  if (target) {
    new MutationObserver(swap).observe(target, { childList: true, subtree: true });
  }
  swap();
})();
