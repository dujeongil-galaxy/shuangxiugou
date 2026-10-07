/*讨论广场「发布交流」→ GitHub Issues
 *
 * 背景：该表单原先只把内容写入 React 本地 state（刷新即丢），
 * 站点无后端，收不到任何提交。改为跳 Issues 才能真正收到内容，
 * 与顶部「提交爆料」按钮共用同一套 GitHub 议题征集机制。
 *
 * 实现要点：
 * 1. 弹窗是点击「匿名发帖交流」后动态渲染的，初始 DOM 中不存在，
 *    因此不能用 init() 那套「找到按钮就替换成 a 标签」的写法，
 *    改用捕获阶段的全局 submit 监听——React 会preventDefault 掉默认跳转，
 *    在提交瞬间读取用户已填内容并组装 Issues 链接。
 * 2. 按 label 文本精确配对取值，避免依赖脆弱的 class 名或字段顺序。
 * 3. 主题类型取选中态按钮（选中时 class 含 border-emerald-600）。
 */
(function () {
  'use strict';
  if (window.__discussionHooked) return;
  window.__discussionHooked = true;

  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (!form || form.tagName !== 'FORM') return;

    var submitBtn = form.querySelector('button[type="submit"]');
    if (!submitBtn || submitBtn.textContent.indexOf('发布交流') < 0) return;

    // 按 label 文本定位同区块内的表单控件
    function fieldValue(labelText) {
      var labels = form.querySelectorAll('label');
      for (var i = 0; i < labels.length; i++) {
        if (labels[i].textContent.trim() !== labelText) continue;
        var box = labels[i].parentNode;
        while (box && box !== form) {
          var c = box.querySelector('input, textarea');
          if (c) return c.value.trim();
          box = box.parentNode;
        }
      }
      return '';
    }

    var topic = '行业交流';
    form.querySelectorAll('button[type="button"]').forEach(function (b) {
      if (b.className.indexOf('border-emerald-600') >= 0 && b.textContent.trim()) {
        topic = b.textContent.trim();
      }
    });

    var brand    = fieldValue('针对品牌/企业:');
    var ident    = fieldValue('你的身份标签:');
    var title    = fieldValue('帖子标题:');
    var content  = fieldValue('客观陈述内容:');
    var evidence = fieldValue('佐证凭据标签 (可选):');

    var body = [
      '## 来源：打工人茶水间 · 讨论广场（匿名发帖交流）',
      '',
      '| 字段 | 内容 |',
      '|---|---|',
      '| 主题类型 | ' + topic + ' |',
      '| 针对品牌/企业 | ' + (brand || '（未填写）') + ' |',
      '| 身份标签 | ' + (ident || '（未填写）') + ' |',
      '| 帖子标题 | ' + (title || '（未填写）') + ' |',
      '',
      '### 客观陈述内容',
      '',
      content || '（未填写）',
      '',
      '### 佐证凭据',
      '',
      evidence || '（未提供）',
      '',
      '---',
      '本条由站点「讨论广场 · 发布交流」自动跳转提交，正文由用户填写。',
      '如含未脱敏个人信息，请先删除后再公开提交。'
    ].join('\n');

    var url = 'https://github.com/dujeongil-galaxy/shuangxiugou/issues/new'
      + '?title=' + encodeURIComponent('[' + topic + '] ' + (title || brand || '打工人茶水间投稿'))
      + '&body=' + encodeURIComponent(body);

    e.preventDefault();
    window.open(url, '_blank', 'noopener');
  }, true);
})();