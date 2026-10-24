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

  // 每块内容套一张卡片，边框+圆角+内边距。
  // 为什么加：几块内容原本是直接贴在灰底页脚上的纯文本行，
  // 标题一多就糊成一片，扫读时找不到边界（站长 2026-10-16 要求加框）。
  // 2026-10-21 支持自定义配色：站长反馈五张卡全是同款白框
  // 「不同框不同颜色，反而可能会更好」，各卡配柔和淡色系互相区分。
  function makeCard(bg, border) {
    var box = document.createElement('div');
    box.setAttribute('data-fcard', '1');
    box.setAttribute('style',
      'background:' + (bg || '#fff') + ';border:1px solid ' + (border || '#e2e8f0') +
      ';border-radius:12px;' +
      'padding:16px 18px;margin:0 0 16px');
    return box;
  }

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
    var linksCard = makeCard();
    var heading = document.createElement('div');
    heading.setAttribute('style', 'font-weight:600;color:#334155;margin:0 0 10px;font-size:14px');
    heading.textContent = '友情链接';
    linksCard.appendChild(heading);

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

    linksCard.appendChild(list);
    footer.appendChild(linksCard);

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
    var pollCard = makeCard('#eff6ff', '#93c5fd'); // 淡蓝底 + 蓝边框
    var pollHeading = document.createElement('div');
    pollHeading.setAttribute('style', 'font-weight:600;color:#1d4ed8;margin:0 0 4px;font-size:14px');
    pollHeading.textContent = '你愿意为双休企业的产品多花钱吗';
    pollCard.appendChild(pollHeading);

    var pollMeta = document.createElement('div');
    pollMeta.setAttribute('style', 'margin:0 0 12px;color:#94a3b8');
    pollMeta.textContent = '微博投票 · 305 人参与 · 投票已结束';
    pollCard.appendChild(pollMeta);

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

      pollCard.appendChild(wrap);
    });

    var pollSource = document.createElement('div');
    pollSource.setAttribute('style', 'color:#94a3b8');
    pollSource.textContent = '数据来源：微博投票 @Vista看天下创建';
    pollCard.appendChild(pollSource);

    footer.appendChild(pollCard);

    /* ----------------------------------------------------------------
       照片彩蛋入口（2026-10-21 作为「站长随笔」入口新增，同日移到 Bing 教程之前；
       2026-10-24 站长要求改名为「解锁彩蛋」——该页文末新增了 Star 门禁照片区，
       入口卡从此主打彩蛋，随笔正文仍在页内）
       卡片改浅青底+青边框：站长反馈页脚卡片全是同款白框「很眼睛难受」，
       用底色把它和其余白卡区分开。
       ---------------------------------------------------------------- */
    var essayCard = makeCard('#f0fdfa', '#5eead4'); // 浅青底 + 青边框
    var essayHeading = document.createElement('div');
    essayHeading.setAttribute('style', 'font-weight:600;color:#0F766E;margin:0 0 4px;font-size:14px');
    essayHeading.textContent = '解锁彩蛋';
    essayCard.appendChild(essayHeading);

    var essayDesc = document.createElement('div');
    essayDesc.setAttribute('style', 'margin:0 0 8px;color:#64748b');
    essayDesc.textContent = '去 GitHub 点个 Star，解锁站长私藏的两张玩偶爱心照。';
    essayCard.appendChild(essayDesc);

    var essayLink = document.createElement('a');
    essayLink.href = './why-shuangxiugou.html';
    essayLink.textContent = '去解锁 →';
    essayLink.setAttribute('style',
      'display:inline-block;color:#0F766E;font-weight:700;text-decoration:underline');
    essayCard.appendChild(essayLink);

    footer.appendChild(essayCard);

    /* ----------------------------------------------------------------
       第四块：Bing 设置教程（替代已删除的「搜索排名公示」）
       ----------------------------------------------------------------
       站长 2026-10-21 要求：搜索排名公示整块删掉（名次一天浮动好几次，
       实测快照维护不过来）；页脚卡片保留，改成「如何把浏览器设为 Bing」教程，
       引导访客用 Bing 搜本站。完整历史实测记录在仓库 SEO-RANKING.md。
       ---------------------------------------------------------------- */
    var seoCard = makeCard('#fffbeb', '#fcd34d'); // 淡琥珀底 + 琥珀边框

    var seoHeading = document.createElement('div');
    seoHeading.setAttribute('style', 'font-weight:600;color:#b45309;margin:0 0 6px;font-size:14px');
    seoHeading.textContent = '如何用 Bing 搜到本站';
    seoCard.appendChild(seoHeading);

    var seoIntro = document.createElement('div');
    seoIntro.setAttribute('style', 'margin:0 0 8px;color:#64748b');
    seoIntro.textContent = '其他搜索引擎对本站收录不全。把浏览器设为 Bing、用 Bing 搜「双休购」（词要连写，不要空格）就能找到。';
    seoCard.appendChild(seoIntro);

    var seoOl = document.createElement('ol');
    seoOl.setAttribute('style', 'margin:0 0 8px;padding-left:18px;color:#334155;line-height:1.7');
    seoOl.innerHTML =
      '<li style="margin:0 0 6px">把默认搜索引擎设为 <b>Bing</b>：' +
      '<br>· Chrome：设置 → 搜索引擎 → 地址栏使用的搜索引擎 → 选 Bing' +
      '<br>· Edge：设置 → 隐私、搜索和服务 → 地址栏 → 搜索引擎 → 选 Bing' +
      '<br>· QQ浏览器：设置 → 搜索引擎 → 选 Bing</li>' +
      '<li style="margin:0 0 6px">把主页（启动时打开的页）设为 <b>https://cn.bing.com</b>：' +
      '<br>· Chrome / Edge：设置 → 启动时 → 打开特定网页或一组网页 → 添加 https://cn.bing.com</li>' +
      '<li style="margin:0 0 6px">不想改设置？直接打开 ' +
      '<a href="https://cn.bing.com" target="_blank" rel="nofollow noopener" ' +
      'style="color:#b45309;font-weight:700">cn.bing.com</a> 也行。</li>';
    seoCard.appendChild(seoOl);

    footer.appendChild(seoCard);

    /*第五块：Bing 积分商城邀请（放在搜索引导下面） */
    var bingCard = makeCard('#f5f3ff', '#c4b5fd'); // 淡紫底 + 紫边框
    var bingHeading = document.createElement('div');
    bingHeading.setAttribute('style', 'font-weight:600;color:#6d28d9;margin:0 0 4px;font-size:14px');
    bingHeading.textContent = '推荐朋友加入 Bing 积分商城';
    bingCard.appendChild(bingHeading);

    var bingDesc = document.createElement('div');
    bingDesc.setAttribute('style', 'margin:0 0 8px;color:#64748b');
    bingDesc.textContent = '每月最多可获得额外 7,500 积分，积分能换礼品卡和优惠券。';
    bingCard.appendChild(bingDesc);

    var bingLink = document.createElement('a');
    bingLink.href = 'https://rewards.bing.com/welcome?rh=pFnTzt_G80U&ref=rafsrchae';
    bingLink.target = '_blank';
    bingLink.rel = 'nofollow noopener';
    bingLink.textContent = '通过我的链接加入 →';
    bingLink.setAttribute('style',
      'display:inline-block;color:#6d28d9;font-weight:700;text-decoration:underline');
    bingCard.appendChild(bingLink);

    footer.appendChild(bingCard);

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