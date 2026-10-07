/* 讨论广场「发布交流」→ GitHub Issues
 *
 * 背景：该表单原先只把内容写入 React 本地 state（刷新即丢），
 * 站点无后端，收不到任何提交。改为跳 Issues 才能真正收到内容，
 * 与顶部「提交爆料」按钮共用同一套 GitHub 议题征集机制。
 *
 * ⚠️ 关键实现要点（本项目踩过的坑，勿删）：
 * 1. 本项目是 React 19.2.8 + createRoot。React 18+ 不再把事件挂在 document 上，
 *    而是代理到 root 容器(#root)。因此只在 document 上监听 submit **收不到**
 *    React 内部表单的提交事件，必须同时监听 #root。
 * 2. 必须用捕获阶段(capture=true)，才能抢在 React 之前拿到并preventDefault。
 * 3. 弹窗是点击「匿名发帖交流」后动态渲染的，初始 DOM 中不存在，
 *    因此无法沿用 index.html 里 init() 那套「找到按钮替换成 a 标签」的写法。
 * 4. 另加 click 兜底：某些环境下表单可能不派发 submit 事件，
 *    直接拦「发布交流」按钮的点击并手动调用同一处理函数。
 */
(function () {
  'use strict';
  if (window.__discussionHooked) return;
  window.__discussionHooked = true;

  // 每次提交只处理一次，避免 submit + click 双路径重复打开。
  // 注意：去重窗口必须极短(50ms)，仅用于过滤同一次点击触发的 submit+click 双事件，
  // 不能太长，否则用户连续提交两次会被误吞。
  var lastHandledAt = 0;
  var DEDUP_MS = 50;

  function buildUrl(form) {
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

    return 'https://github.com/dujeongil-galaxy/shuangxiugou/issues/new'
      + '?title=' + encodeURIComponent('[' + topic + '] ' + (title || brand || '打工人茶水间投稿'))
      + '&body=' + encodeURIComponent(body);
  }

  function isTargetForm(form) {
    if (!form || form.tagName !== 'FORM') return false;
    var btn = form.querySelector('button[type="submit"]');
    return !!btn && btn.textContent.indexOf('发布交流') >= 0;
  }

  function handleSubmit(e) {
    var form = e.target;
    if (!isTargetForm(form)) return;

    var now = Date.now();
    if (now - lastHandledAt < DEDUP_MS) return;
    lastHandledAt = now;

    var url = buildUrl(form);
    if (e.cancelable) e.preventDefault();
    e.stopPropagation();
    window.open(url, '_blank', 'noopener');
  }

  function attach() {
    // 1. root 容器（React 事件代理落点）
    var root = document.getElementById('root');
    if (root && !root.__discussionBound) {
      root.addEventListener('submit', handleSubmit, true);
      root.__discussionBound = true;
    }
    // 2. document（覆盖非 React 表单）
    if (!document.__discussionBound) {
      document.addEventListener('submit', handleSubmit, true);
      // 3. click 兜底：表单未派发 submit 时直接接管
      document.addEventListener('click', function (e) {
        var b = e.target;
        if (!b || b.tagName !== 'BUTTON') return;
        if (b.type !== 'submit' || b.textContent.indexOf('发布交流') < 0) return;
        var form = b.closest ? b.closest('form') : null;
        if (!form) return;
        handleSubmit({
          target: form,
          cancelable: true,
          preventDefault: function () {},
          stopPropagation: function () {}
        });
      }, true);
      document.__discussionBound = true;
    }
  }

  // 立即挂载一次；DOMContentLoaded 后再挂一次以覆盖 React 尚未创建 root 的情况。
  // 两者都有幂等保护，不会重复绑定。
  attach();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attach);
  }
  window.addEventListener('load', attach);
})();