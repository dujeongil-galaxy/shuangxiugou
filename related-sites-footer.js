#!/usr/bin/env node
/**
 * 页脚友链注入
 *
 * 为什么用独立脚本而不是塞进 index.html 的补丁块：
 * 友链会变（换站点、调整锚文本），放独立文件里更好维护，
 * 改错了也能一眼看出问题在哪。
 *
 * 目标：在页面底部生成「相关站点」区块，含指向 shuangxiugou.top 的外链。
 *
 * 为什么需要注入到 DOM：
 * 本页正文由 React 客户端渲染，静态 HTML 里写footer 会被 React 覆盖。
 * 只能等渲染完成后追加。
 *
 * 幂等：用 data 标记避免 MutationObserver 反复触发时重复插入。
 */
(function () {
  var LINKS = [
    {
      href: 'https://shuangxiugou.top/',
      text: '各行业双休公司',
      desc: '按行业分类的双休企业名录，覆盖面较广，可与本站的品牌评级交叉比对',
    },
    {
      href: './projects.html',
      text: '同类项目导航页',
      desc: 'GitHub 上几个同名相关仓库的定位区分与对比说明',
    },
  ];

  var FOOTER_ID = 'related-sites-footer';

  function insert() {
    if (document.getElementById(FOOTER_ID)) return;

    var root = document.getElementById('root') || document.body;
    if (!root) return;

    // 页面底部容器：优先找最外层容器，找不到就用 body
    var host = root.querySelector('div.mx-auto') || root;
    if (!host) return;

    var footer = document.createElement('div');
    footer.id = FOOTER_ID;
    // 样式沿用站内现有的灰底白字风格，class 只用 CSS 里已生成过的
    footer.setAttribute('style',
      'max-width:1100px;margin:32px auto 0;padding:20px 22px;' +
      'border-top:1px solid #e2e8f0;font-size:13px;line-height:1.7;color:#64748b');

    var heading = document.createElement('div');
    heading.setAttribute('style', 'font-weight:600;color:#475569;margin-bottom:8px');
    heading.textContent = '相关站点';
    footer.appendChild(heading);

    var list = document.createElement('div');
    LINKS.forEach(function (item) {
      var line = document.createElement('div');
      line.setAttribute('style', 'margin:0 0 6px');

      var a = document.createElement('a');
      a.href = item.href;
      a.textContent = item.text;
      a.setAttribute('style', 'color:#059669;text-decoration:none;font-weight:500');
      // 站内链接不开新窗口；站外链接加 noopener 防止 tabnabbing
      if (/^https?:/.test(item.href)) {
        a.target = '_blank';
        a.rel = 'noopener noreferrer nofollow';
      }
      line.appendChild(a);

      var desc = document.createElement('span');
      desc.textContent = '—— ' + item.desc;
      line.appendChild(desc);

      list.appendChild(line);
    });

    footer.appendChild(list);

    // 追加到页面最底部
    host.appendChild(footer);
  }

  // React 渲染是异步的，第一次可能还没挂载，用 MutationObserver 兜底
  var scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(function () {
      scheduled = false;
      insert();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', schedule);
  } else {
    schedule();
  }

  var obs = new MutationObserver(schedule);
  try {
    obs.observe(document.body, { childList: true, subtree: true });
  } catch (e) {
    console.error('[双休购] 页脚友链注入失败：', e);
  }
})();