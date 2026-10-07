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

  // Issues 预填内容：纯文本填空式，不用 Markdown 表格。
  // GitHub 对表格语法之外的内容直接以行文渲染，表格反而显得杂乱，
  // 用户在输入框里看到一堆竖线和横线很难快速定位要填哪里。
  //
  // ⚠️ 重要：弹窗内的所有原文（标题、说明句、字段名、选项、placeholder 提示语）
  //    全部原样保留，只在其后追加填写说明，不得删改或省略。
  function buildUrl() {
    var title = '[讨论广场] 匿名爆料 / 双休平替推荐';
    var body = [
      '发起匿名讨论 / 爆料 / 种草',
      '全过程不记录IP，支持提供客观事实案号与打卡体验。',
      '',
      '═══════════════════════════════════════',
      '',
      '讨论主题类型:',
      '',
      '  ○ 避雷单休曝光',
      '  ○ 良心双休平替',
      '  ○ 求扒企业工时',
      '',
      '（以上三项单选，圈出或删除其余两项即可）',
      '',
      '-----------------------------------------------',
      '',
      '针对品牌/企业: ____________________',
      '（如：某汽车厂 / 某咖啡连锁）',
      '',
      '-----------------------------------------------',
      '',
      '你的身份标签: ____________________',
      '（如：在职技术 / 离职员工 / 消费者）',
      '',
      '-----------------------------------------------',
      '',
      '帖子标题: ____________________',
      '（简洁有力的标题，吸引更多打工人关注...）',
      '',
      '-----------------------------------------------',
      '',
      '客观陈述内容:',
      '',
      '',
      '',
      '',
      '（客观写明部门、作息、下班时间、加班费是否发放，'
        + '或为什么推荐/避雷该品牌...）',
      '',
      '可参考以下维度补充：',
      '  · 工作日几点下班，是否常态化加班',
      '  · 周末与法定节假日是否上班',
      '  · 每月实际休息天数（月休 4 天还是 2 天）',
      '  · 是否有加班补偿、调休安排',
      '  · 劳动合同、工时制度是否与实际一致',
      '',
      '',
      '-----------------------------------------------',
      '',
      '佐证凭据标签 (可选): ____________________',
      '（如：劳动裁判文书网案号 / 工牌脱敏 / 官方通报链接）',
      '（可补充：劳动裁判文书网案号 / 官方通报文号 / 脱敏截图链接 / '
        + '员工社区交叉讨论地址）',
      '',
      '',
      '═══════════════════════════════════════',
      '',
      '填写说明（提交前请确认）：',
      '  1. 请勿填写未脱敏的个人信息（姓名、手机号、工号、住址、'
        + '工牌照片等）。',
      '  2. 优先使用可公开查证的依据（裁判文书、官方通报、上市公司 ESG 报告）。',
      '  3. 描述聚焦可核实的事实，避免情绪化或侮辱性表述。',
      '  4. 本条由站点「打工人茶水间 · 讨论广场」按钮跳转提交。',
      '  5. 数据仅供个人择业与消费偏好参考，不构成商业背书。'
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