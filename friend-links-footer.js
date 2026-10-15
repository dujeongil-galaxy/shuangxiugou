#!/usr/bin/env node
/**
 * 页脚友链注入
 *
 * 为什么用独立脚本而不是塞进 index.html 的补丁块：
 * 友链会变（换站点、调整锚文本），放独立文件里更好维护，
 * 改错了也能一眼看出问题在哪。
 *
 * 目标：在页面底部生成「友情链接」区块，含指向 shuangxiugou.top 的外链。
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
      desc: '按行业分类的双休企业名录，可与本站的品牌评级交叉比对',
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
    // 导航栏/首屏，不是页面底部，append 进去后「友情链接」跑到了顶部。
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

    /* ----------------------------------------------------------------
       第一块：源代码
       ----------------------------------------------------------------
       为什么单独一块、不放在「友情链接」里：
       友情链接是**别人的**站点，本仓库是**本站自己的**代码。
       混在一起会让人以为这是互惠链接，也容易被访客当成广告。

       为什么必须有：
       搜「双休购 GitHub」时，Google 排在前面的
       ZhiqingHeyi/shuangxiugou、MoFeng/shuangxiugou 都是 GitHub 仓库页，
       而本站此前**正文里没有任何一处指向自己的仓库**——
       想找源码的人翻到最底部也找不到，只能去猜。
       （实测确认：index.html 里 github.com 链接只有
         「提交更正用的 Issues」和「别人的仓库」，没有自己的）

       放最底部是刻意的：它对只想查数据的访客是干扰，
       但翻到底部的人正是要源码的那批人 —— 与 favicon 之外的
       「同类项目把仓库放页脚」做法一致。
       ---------------------------------------------------------------- */
    var heading = document.createElement('div');
    heading.setAttribute('style', 'font-weight:600;color:#475569;margin-bottom:10px;font-size:14px');
    heading.textContent = '友情链接';
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

    /* ----------------------------------------------------------------
       「数据来源分级说明」已移到 projects.html 底部
       ----------------------------------------------------------------
       这四档说明是给「想核实数据的人」看的，属于导航页的补充材料，
       放首页页脚会挤在友情链接和投票中间，抢首页的注意力。
       现在整段迁到 projects.html（同类项目导航页）末尾，
       读者查证数据时去那里找，首屏和页脚都清爽了。
       ---------------------------------------------------------------- */

    /* ----------------------------------------------------------------
       第三块：微博投票
       ----------------------------------------------------------------
       外部平台的公开投票结果，作为读者态度的参考放在底部。
       票数与百分比一并标注，避免读者自己心算占比。
       ---------------------------------------------------------------- */
    var pollHeading = document.createElement('div');
    pollHeading.setAttribute('style', 'font-weight:600;color:#475569;margin:26px 0 4px;font-size:14px');
    pollHeading.textContent = '你愿意为双休企业的产品多花钱吗';
    footer.appendChild(pollHeading);

    var pollMeta = document.createElement('div');
    pollMeta.setAttribute('style', 'margin:0 0 12px;color:#94a3b8');
    pollMeta.textContent = '微博投票 · 305 人参与 · 投票已结束';
    footer.appendChild(pollMeta);

    var POLL = [
      ['愿意，贵一点也要支持双休', 212, '69.5%', '#0F766E', '#99f6e4'],
      ['看情况，贵太多就不考虑', 56, '18.4%', '#0F766E', '#5eead4'],
      ['不愿意，买东西更关注价格', 32, '10.5%', '#64748b', '#cbd5e1'],
      ['其他，评论区聊聊～', 5, '1.6%', '#64748b', '#fca5a5'],
    ];
    POLL.forEach(function (row) {
      var wrap = document.createElement('div');
      wrap.setAttribute('style', 'margin:0 0 10px');

      var label = document.createElement('div');
      label.setAttribute('style', 'display:flex;justify-content:space-between;margin-bottom:4px');
      var labelText = document.createElement('span');
      labelText.textContent = row[0];
      var labelNum = document.createElement('span');
      labelNum.textContent = row[1] + '（' + row[2] + '）';
      labelNum.setAttribute('style', 'color:' + row[3] + ';font-weight:700');
      label.appendChild(labelText);
      label.appendChild(labelNum);
      wrap.appendChild(label);

      var track = document.createElement('div');
      track.setAttribute('style', 'height:12px;background:#e2e8f0;border-radius:6px;overflow:hidden');
      var bar = document.createElement('div');
      bar.setAttribute('style', 'width:' + row[2] + ';height:100%;background:' + row[4]);
      track.appendChild(bar);
      wrap.appendChild(track);

      footer.appendChild(wrap);
    });

    var pollSource = document.createElement('div');
    pollSource.setAttribute('style', 'margin-top:10px;color:#94a3b8');
    pollSource.textContent = '数据来源：微博投票 @Vista看天下创建';
    footer.appendChild(pollSource);

    /* ----------------------------------------------------------------
       第四块：搜索排名公示
       ----------------------------------------------------------------
       把本站实测过的搜索词与名次直接挂在页脚，不藏起来。
       两点说明写在下面：
       一、名次随时间浮动，只代表某一天的实测快照；
       二、词形必须连写（「双休购github」），加空格会搜不到。
       ---------------------------------------------------------------- */
    var seoHeading = document.createElement('div');
    seoHeading.setAttribute('style', 'font-weight:600;color:#475569;margin:26px 0 4px;font-size:14px');
    seoHeading.textContent = '搜索排名公示';
    footer.appendChild(seoHeading);

    var seoMeta = document.createElement('div');
    seoMeta.setAttribute('style', 'margin:0 0 12px;color:#94a3b8');
    seoMeta.textContent = '2026-10-16 实测 · 无痕窗口';
    footer.appendChild(seoMeta);

    var SEO_ROWS = [
      ['双休购github', '1', 'Google · Bing'],
      ['双休购996', '2', 'Bing'],
      ['双休购数据', '2', 'Bing'],
      ['双休购官网', '5', 'Bing'],
      ['双休购', '7', 'Bing'],
      ['双休企业', '第一页末位', 'Bing'],
    ];
    SEO_ROWS.forEach(function (row) {
      var line = document.createElement('div');
      line.setAttribute('style', 'display:flex;justify-content:space-between;margin:0 0 6px;gap:12px');

      var kw = document.createElement('span');
      kw.textContent = row[0];
      kw.setAttribute('style', 'color:#334155;font-weight:600');

      var val = document.createElement('span');
      val.textContent = row[1] + ' · ' + row[2];
      val.setAttribute('style', 'color:#0F766E;font-weight:700;white-space:nowrap');

      line.appendChild(kw);
      line.appendChild(val);
      footer.appendChild(line);
    });

    var seoNote = document.createElement('div');
    seoNote.setAttribute('style', 'margin-top:8px;color:#94a3b8');
    seoNote.textContent =
      '词形要连写，加空格就搜不到；Google 对本站更严格，目前只有「双休购github」能进第一页。以上为 2026-10-16 当天的实测结果，名次会随时间浮动。';
    footer.appendChild(seoNote);

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