/* 讨论广场「发布交流」→ GitHub Issues
 *
 * 该表单原先只把内容写入 React 本地 state（刷新即丢），站点无后端，
 * 收不到任何提交。改为跳转 GitHub Issues，与顶部「提交爆料」按钮同机制。
 *
 * 实现思路：把「发布交流」按钮直接替换成指向 Issues 的 <a> 标签。
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

  var REPO = 'https://github.com/dujeongil-galaxy/shuangxiugou';

  // Issues 预填内容：把表单的六个字段做成待填模板，引导用户在 GitHub 上补全
  function buildUrl() {
    var title = '[讨论广场] 匿名爆料 / 双休平替推荐';
    var body = [
      '## 来源：打工人茶水间 · 讨论广场',
      '',
      '<!-- 请补全下面各项后提交；未脱敏个人信息请先删除 -->',
      '',
      '| 字段 | 内容 |',
      '|---|---|',
      '| 主题类型 | 避雷单休曝光 / 良心双休平替 / 求扒企业工时 |',
      '| 针对品牌/企业 | （请填写） |',
      '| 身份标签 | 在职员工 / 离职员工 / 消费者 |',
      '| 帖子标题 | （请填写，一句话概括） |',
      '',
      '### 客观陈述内容',
      '',
      '（请填写：具体加班与休息情况，如工作日几点下班、周末是否上班、'
        + '月休几天、是否有加班补偿等。避免情绪化描述，聚焦可核实的事实。）',
      '',
      '### 佐证凭据',
      '',
      '（选填：劳动裁判文书网案号 / 官方通报文号 / 脱敏截图链接 / '
        + '员工社区交叉讨论地址）',
      '',
      '---',
      '本条由站点「讨论广场 · 发布交流」按钮跳转提交。',
      '数据仅供个人择业与消费偏好参考，不构成商业背书。'
    ].join('\n');

    return REPO + '/issues/new'
      + '?title=' + encodeURIComponent(title)
      + '&body=' + encodeURIComponent(body);
  }

  // 把「发布交流」按钮替换为等样式的 <a> 链接
  function swap() {
    var btns = document.querySelectorAll('button[type="submit"]');
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i];
      if (b.textContent.indexOf('发布交流') < 0) continue;
      if (b.getAttribute('data-issue-swapped') === '1') continue;
      b.setAttribute('data-issue-swapped', '1');

      var a = document.createElement('a');
      a.href = buildUrl();
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
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