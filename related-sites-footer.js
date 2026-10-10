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

    // 等React 渲染出内容再插。
    // 原因：#root 为空时插进去，页脚会孤零零挂在空白页上，
    // 而且之后 React 渲染会把前面的内容全替换掉，页脚也可能被覆盖。
    if (!root.firstElementChild) return; // React 还没渲染完，等 MutationObserver 再触发

    // 挂载位置：#root 自身的末尾。
    //
    // ⚠️ 早先写成 root.querySelector('div.mx-auto')—— 那个容器是
    // 导航栏/首屏，不是页面底部，append 进去后「相关站点」跑到了顶部。
    // 页脚必须挂在 #root 的**最后一个子节点之后**，
    // 这样无论 React 内部结构怎么变，都永远在页面末尾。
    var host = root;

    var footer = document.createElement('div');
    footer.id = FOOTER_ID;
    footer.setAttribute('role', 'contentinfo');
    // 灰底白字，明确区别于导航栏的绿底白字
    footer.setAttribute('style',
      'max-width:1100px;margin:40px auto 0;padding:24px 22px 32px;' +
      'border-top:1px solid #e2e8f0;background:#f8fafc;' +
      'font-size:13px;line-height:1.8;color:#64748b;border-radius:0 0 12px 12px');

    var heading = document.createElement('div');
    heading.setAttribute('style', 'font-weight:600;color:#475569;margin-bottom:10px;font-size:14px');
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

  // 自愈：React 重渲染时会整体替换 #root 的子节点，
  // 我们插入的页脚会被一起清掉。
  // 所以监听 #root 的 childList —— 一旦页脚消失（getElementById 找不到）
  // 就重新插入。这也顺带覆盖了「插错位置后需要挪回来」的情况。
  function watchRoot() {
    var root = document.getElementById('root');
    if (!root) {
      setTimeout(watchRoot, 300);
      return;
    }
    try {
      new MutationObserver(function () {
        if (!document.getElementById(FOOTER_ID)) schedule();
      }).observe(root, { childList: true });
    } catch (e) {
      console.error('[双休购] 页脚友链自愈监听失败：', e);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', schedule);
  } else {
    schedule();
  }
  watchRoot();

  // 全局兜底：React 重渲染、路由变化等
  var obs = new MutationObserver(schedule);
  try {
    obs.observe(document.body, { childList: true, subtree: true });
  } catch (e) {
    console.error('[双休购] 页脚友链注入失败：', e);
  }
})();