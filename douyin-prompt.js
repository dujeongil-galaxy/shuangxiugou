/* ==========================================================================
   首页「公益提醒」弹窗（2026-11-14 由「劳工友好提醒」更名）
   --------------------------------------------------------------------------
   2026-11-14 站长指令：弹窗内容整体替换为一篇公众号式长文
   《别让"跟风买车"，变成我们为"傲慢"买单》（比亚迪轮毂装反 / 500 万悬赏
   事件视角的消费者提醒）。要点：
     · 顶栏标签「劳工友好提醒」→「公益提醒」（站长原话「劳工友好提醒也不要了，
       直接替换为 公益提醒」）。
     · 弹窗旧版的所有其他内容（标题 / 摘要 / 要点 / 抖音短片按钮 / 站长随笔 /
       事实核查 / 切换旧版）全部撤掉——这些由 dyp-version-toggle.js 与
       factcheck-button.js 注入，本站用 .dyp--article 标记让它们自动不注入
       （保留脚本本体以便将来回退弹窗内容）。
     · 弹窗底部做成两枚按钮：①「去看看站长的新网站」（外链婚恋数据核查台）
       ②「我要分享此文章」（打开分享弹窗，文案带文章标题）。
   2026-11-14 站长追加指令：「已经有了按钮，就不要留那句话（绿色）」——
   原先挂在按钮上方那行绿色推荐小字（指向新站）撤下，引流交给按钮、不再重复；
   改为在文章末尾加一句整句加粗的备注，界定本文讨论的重点：
     「本文讨论的重点，不是反对悬赏打击黑公关这件事本身，而是在品控争议、
       车主质疑集中爆发的这个时间点高调发布悬赏，时机不妥，很容易引火烧身，
       造成舆论误解。」
   2026-11-14 站长再追加：「之前的版本也保留吧，关闭那个位置旁边（左），去做一个
   版本切换（切换新版、切换旧版）」——右上角 × 左侧加一枚药丸按钮，两态切换：
     · 新版：上面这篇公益提醒长文（含文末加粗备注）。
     · 旧版：13:49 整体替换前的「劳工友好提醒」弹窗内容，从 GitHub 仓库存档
       取回、按文章版式重排；底部附存档说明（口径由站长给、措辞已优化不照抄）。
       旧版只作留档查阅，不恢复抖音短片 / 事实核查 / 站长随笔等旧功能入口。
   2026-11-14 站长再追加（覆盖 15:39 的「不留那句话」）：底部第一枚按钮改挂
   轮毂事件相关抖音视频（https://v.douyin.com/uBwf2Fbt0d8/），第二枚仍是
   「我要分享此文章」；新站引流恢复「旧版本那样」——那行绿色推荐语重新挂回来，
   且**固定在滚动正文之外**（文章下方、两枚按钮上方），无论正文滚到哪里都可见。
   面板改 flex 列：正文可收缩并内部滚动，绿色行 / 按钮 / 倒计时常驻不被推走。

   弹出需求：每次刷新首页都必弹（站长 2026-11-13 指令「不要 15 分钟冷却，
   刷新首页必弹」）。不再用 localStorage 记时间戳、不再有冷却期，关掉再刷就再弹。

   关闭需求（2026-11-13 站长「先锁死」）：**只能点右上角 × 关闭**，遮罩点击与
   Esc 一律不绑 close；弹出后 8 秒内 × 不生效（倒计时）。
   ========================================================================== */
(function () {
  'use strict';

  // 站长新站外链（2026-11-01 站长要求「这里挂一下 url，推我的新网站」）。
  // 2026-11-14 17:00 站长最新口径「至于新网站，保持旧版本那样」：第一枚按钮让位给
  // 视频后，新站引流重新交回下面这行绿色推荐语（与 15:39 之前的旧版本同款文案）。
  // 它挂在 .dyp__article 滚动容器**外面**，随面板 flex 布局常驻，不随正文滚走。
  var SITE_LINK = 'https://dujeongil-galaxy.github.io/dating-data-factcheck/';
  var SITE_LINK_TEXT = '顺便推荐站长的新站「婚恋数据核查台」：给相亲数据做溯源核查 ↗';

  /* ── 搜索引擎确认块（2026-11-20 站长指令，同日二次修订）───────────────
     位置：正文滚动区之下、绿色推荐语之上的那一块空白（站长截图红框处），
     同样挂在 .dyp__article 外面，随面板固定、不随文章滚动。
     交互二选一（radiogroup），回执按选项给，不照抄口语稿：
       · 选「是的」→「好，那你在 Bing 里搜「双休购」就能找到我们，慢慢逛。」
       · 选「不是」→「没关系，关掉后我把设置步骤摆出来，照着点两下就行。」
       · 什么都没选就点 × → 提醒「先选一下上面的问题，选完就能关」，
         **永远不放行**（2026-11-21 站长实测反馈：第二次或多按几次 × 仍能直接
         关闭，锁死形同虚设——改为不选就只能一直点，选了才让关）。
     关闭后的落点：只有选「不是」才滚到页脚「如何用 Bing 搜到本站」
     （#sxg-bing-guide）；选「是的」说明已经是 Bing，关掉就停原地，
     不再把访客往下拽。 */
  var SE_ASK_TEXT = '你的浏览器默认搜索引擎是 Bing 必应吗';
  var SE_YES_HINT = '好，那你在 Bing 里搜「双休购」就能找到我们，慢慢逛。';
  var SE_NO_HINT = '没关系，关掉后我把设置步骤摆出来，照着点两下就行。';
  var SE_NUDGE_HINT = '先选一下上面的问题，选完就能关。';
  var BING_GUIDE_ID = 'sxg-bing-guide';
  var seChoice = '';      // '' | 'yes' | 'no'（'' = 未选择，未选择不许关）

  // 底部第一枚按钮：轮毂事件相关视频（站长 2026-11-14 提供的抖音短链）。
  // 第二枚「我要分享此文章」保持不动；按钮文字由本站自定，只说功能不堆叠标题。
  var VIDEO_LINK = 'https://v.douyin.com/uBwf2Fbt0d8/';
  var VIDEO_BTN_TEXT = '看轮毂事件相关视频';

  // 底部「我要分享此文章」打开分享弹窗时，临时写进 og:description 的分享文案
  // （分享弹窗 info() 读 og:description 作为分享说明，开完即还原）。
  var SHARE_TEXT =
    '双休购·公益提醒《别让“跟风买车”变成我们为“傲慢”买单》：比亚迪轮毂装反、' +
    '500 万悬赏黑公关事件背后，消费者该如何清醒选车。';

  // 文末号召语（2026-11-14 站长追加，20:28 改配色）：整句加粗。
  // 抽成单一真相源：新版文末与旧版存档里那句同文文案共用，避免两份口径漂移。
  // 颜色不在这里写：CSS 基础规则给新版绿色，.dyp--legacy 下覆盖回旧版红色。
  // 逐字照抄站长原话，不优化、不改标点。
  var CALL_TEXT =
    '希望无论劳动者还是企业，都可以走到良性发展的道路上，让我们一起推动这件事，' +
    '在此广纳贤言并期待听到你的声音；对，别回头，说的就是你！';
  var CALL_HTML =
    '<p class="dyp__note dyp__note--call"><strong>' + CALL_TEXT + '</strong></p>';

  // 弹窗正文：一篇公众号式长文（站长 2026-11-14 提供，忠实转写）。
  // 用模板字符串保留换行与中文标点；粗体 **x** 已转成 <strong>。
  var ARTICLE_HTML = [
    '<h1 class="dyp__h1">别让“跟风买车”，变成我们为“傲慢”买单</h1>',
    '<p>各位家人、各位朋友：</p>',
    '<p>最近有一件事，我觉得必须拿出来和大家好好聊聊。因为我发现，身边很多 60 后、' +
      '70 后的长辈，甚至不少同龄人，买车的逻辑特别简单——「身边人买比亚迪，我就买比亚迪；' +
      '身边人买华为，我就买华为」。你跟他说华为没有双休、加班严重，他会立刻反驳你' +
      '「人家技术牛逼」；你跟他说比亚迪出了品控问题，他会觉得「那都是别人在黑它」。</p>',
    '<p>但这次，我想借着最近发生的一件事，给大家提个醒：<strong>技术再强，也掩盖不了' +
      '“傲慢”；品牌再响，也不能把消费者当“韭菜”</strong>。</p>',
    '<h2>一、先给大家捋清楚这件事的来龙去脉</h2>',
    '<p>11 月 11 号，比亚迪因为部分车型的轮毂前后装反了，刚发过致歉信。大家心里的火' +
      '都还没有消，正琢磨着你这么大的车企，层层质检居然没有发现，这是一个极其低级又致命的问题。</p>',
    '<p>结果仅仅相隔一天，11 月 13 号，比亚迪的法务部直接掏出一份悬赏公告，最高 500 万' +
      '征集黑公关线索。</p>',
    '<p>这个时间点卡的可太寸了，就像是刚刚「认罪认罚」，转头就掏出一张传票捂嘴。</p>',
    '<h2>二、我为什么觉得这件事值得所有消费者警惕？</h2>',
    '<p>得承认一个事实，现在车圈的黑公关早就不是几个网友发帖骂街了，而是真金白银的产业链。' +
      '这种工业化造谣，哪家车企看了都烧心，所以比亚迪掏出 500 万来反击。</p>',
    '<p>单从商业逻辑上讲没什么毛病，但问题出在大众观感上。当几万个真实的车主正在网上' +
      '吐槽自己的轮毂被装反，这个时候高调宣布要花 500 万抓黑公关，这就好比在火药桶旁边吸烟。</p>',
    '<p>甚至还有人发现，轮毂事件发酵期间，比亚迪还顺手投诉了一些批评的文章，理由是：' +
      '「片面渲染，放大风险」。</p>',
    '<p>这两件事一叠加，法务部重拳出击的形象算是彻底立住了，但同时也彻底把消费者的心给凉了。</p>',
    '<p>「有这 500 万还不如给工人加鸡腿呢」。这看似是一句废话，但是大家为什么要这么比？' +
      '因为大家感受到了一种分配的割裂感。</p>',
    '<p>一方面，比亚迪这两年员工总数减了十来万，一线工人底薪不高，靠加班费拼收入，' +
      '食堂伙食也被内部吐槽，这些消息时不时的传出来。</p>',
    '<p>另一方面，对外部黑粉的悬赏动辄百万，大家不是真的在乎工人差那一口肉，而是觉得' +
      '这个企业对外重拳出击，对内却斤斤计较。</p>',
    '<h2>三、我想告诉大家：真正的“靠谱车企”，不会这么干</h2>',
    '<p>当你在质量体系上出了娄子，公众最希望看到的是你向内开刀，对生产线的员工更好一点，' +
      '保证产品的品质，结果你却把聚光灯打向了外面，这种姿态在工人和消费者的眼里就是傲慢。</p>',
    '<p>轮毂装反这件事，核心根本不是有没有人在黑比亚迪，核心是你这么大的车企，层层质检' +
      '居然没有发现，这是一个极其低级又致命的问题。</p>',
    '<p>正确的危机公关应该怎么做？是老老实实承认错误，用足够的时间去展示你如何整改，' +
      '让公众看得到你在向内开刀。但比亚迪偏偏这个时候选择了把打击黑公关放在了前台。</p>',
    '<p>比亚迪的 500 万悬赏从事实层面看确实是在打击真实的造谣黑产，这无可厚非。但从大众的' +
      '情绪层面看，它刚好撞在了品控翻车的事件上。</p>',
    '<p>消费者能接受一个制造企业偶尔犯错，只要你足够真诚，但他们很难接受一个企业在犯错' +
      '之后第一反应却是去堵别人的嘴。</p>',
    '<p>这 500 万悬赏也许最终能抓到几个黑公关，但在这之前，它已经先伤到了那些真金白银' +
      '支持你的消费者。</p>',
    '<h2>四、最后，我想给所有准备买车的朋友提 3 个醒</h2>',
    '<ol>',
    '<li><strong>别把“跟风”当“靠谱”</strong>：身边人买什么你就买什么，本质上是把' +
      '自己的选择权交了出去。你不知道别人买车的真实需求，也不知道他们有没有遇到问题，' +
      '最后买单的是你自己。</li>',
    '<li><strong>别把“技术”当“免死金牌”</strong>：技术牛逼确实值得骄傲，但技术牛逼不代表' +
      '可以忽略品控、不代表可以不尊重员工、不代表可以不把消费者的声音当回事。</li>',
    '<li><strong>别把“沉默”当“支持”</strong>：你今天替它的品控问题说话，明天它就可能' +
      '把你的合理投诉当成“黑公关”。真正的支持，是让它变得更好，而不是替它掩盖问题。</li>',
    '</ol>',
    '<p>作为双休购的站长，我一直想做的，就是让大家在消费的时候，能多一份清醒，少一份盲从。' +
      '因为我始终相信：<strong>一个真正值得尊重的企业，不是靠“技术牛逼”来让你闭嘴，' +
      '而是靠“真诚靠谱”来让你放心</strong>。</p>',
    '<p>如果你们身边也有准备买车、或者已经买了比亚迪 / 华为相关产品的家人朋友，欢迎把这篇' +
      '文章转发给他们。我们一起，做一个清醒的消费者。</p>',
    '<p class="dyp__sign">双休购站长 dujeongil-galaxy<br>2026 年 11 月 14 日</p>',
    // 文末备注（2026-11-14 站长追加）：整句加粗，界定本文讨论的重点，
    // 避免被误读成「反对悬赏打击黑公关」。
    '<p class="dyp__note"><strong>备注：本文讨论的重点，不是反对悬赏打击黑公关这件事' +
      '本身，而是在品控争议、车主质疑集中爆发的这个时间点高调发布悬赏，时机不妥，' +
      '很容易引火烧身，造成舆论误解。</strong></p>',
    // 加粗号召语压轴（2026-11-14 站长指定，新版绿色）；在上一条立场备注之后收尾。
    CALL_HTML
  ].join('');

  var box = null;

  // ── 第二篇公益提醒长文（2026-11-16 站长指令：最早的旧版存档彻底不要，
  //    换成 Hy4 写的《买车之前，先看清谁在替比亚迪说话》）────────────────
  //    · 不再是最早那份「压榨员工」存档，也没有「仓库留存 / 随时清理」字样；
  //      这里是正式的第二篇提醒文章，与新版并列，切换机制共用。
  //    · 站长澄清：不是「朋友分享」，是「我自己刷到的」——首句照此改正。
  //    · 底部签名沿用双休购，不写具体日期（口径同旧存档的「删掉日期」）。
  // 换内容只需改 LEGACY_HTML 这一个常量，切换机制与新版共用。
  var LEGACY_SHARE_TEXT =
    '双休购·公益提醒《买车之前，先看清谁在替比亚迪说话》：' +
    '看清谁在替车企发声，做一个清醒的消费者。';
  var LEGACY_HTML = [
    '<h1 class="dyp__h1">买车之前，先看清谁在替比亚迪说话（2026-11-16 晚）</h1>',
    '<p>最近我自己刷到一个抖音号，叫「比亚迪王朝丨都江堰安吉」，381 个粉丝，' +
      '574 条作品，置顶三条：一条是发布会镜头配字幕「市场和应用技术走在全球最前，' +
      '还有人睁眼说瞎话」；一条是销售和客户的「客旦满意 我们荣幸」合影牌；' +
      '一条是「二代宋Pro 新旧对比、价格对对碰」。</p>',
    '<p>我看着挺感慨。这不是对比亚迪经销商有意见——门店要获客、要福利引流，' +
      '天经地义。我只是突然意识到一件事：围绕比亚迪的信息场，结构已经变了。' +
      '一边是法务部的公告，一边是门店的福利海报和「技术全球最前」的剪辑，' +
      '中间本该有的那个声音——车主真实的使用反馈、品控复盘、整改过程——越来越小。</p>',
    '<p>所以借着最近这事，把话说明白。</p>',
    '<h2>一、事情本身：轮毂装反，和一份「刚好撞上」的悬赏</h2>',
    '<p>11 月 11 日，比亚迪为大唐部分车辆轮辋错装致歉。官方说法是轮辋分装供应商' +
      '编码录入失误，经专项检测不影响操控、无安全风险，车主可免费检测调换、' +
      '拿交通补偿，整车质保重新起算。</p>',
    '<p>车主的说法不太一样：有人是自己在网上刷到、跑去 4S 店才查出来的，' +
      '厂家和门店都没主动通知；处理方式就是把轮子换回来，没有补偿；' +
      '而投诉量在一天里集中冒出十几条。</p>',
    '<p>两天后，11 月 13 日，比亚迪法务部公布一批维权案件进展，并再度明确：' +
      '对 MCN 等有组织抹黑线索，给 50 万到 500 万奖励。需要说明的是，举报悬赏' +
      '不是新东西，2022 年就定过 5 万—500 万且长期有效，这次只是细化。</p>',
    '<p>但大众不看政策沿革，大众看时间线。前脚为装配失误道歉，后脚高调宣布' +
      '「最高五百万抓黑公关」，这种观感，企业自己得认。你可以说这是巧合、是' +
      '例行公示，可当几万个车主正在网上问「我的轮子是不是也装反了」的时候，' +
      '你把聚光灯打向「外面」，姿态本身就说明了一切。</p>',
    '<h2>二、真正让人凉心的，不是悬赏，是次序</h2>',
    '<p>打黑公关对不对？对。造谣黑产是真金白银的产业链，用法律手段反击，' +
      '没毛病，「龙哥讲电车」被判赔 200 万并公开致歉，就是典型例子。</p>',
    '<p>问题从来不在「该不该打」，而在「什么时候打、先打什么」。</p>',
    '<p>一家车企在品控翻车、车主质疑集中爆发的当口，第一反应是向外挥拳而不是' +
      '向内开刀，公众读到的潜台词就是：我更在意别人怎么说，而不是你们开得安不安全。</p>',
    '<p>更微妙的是，法务动作之外，还伴随着对部分批评内容的投诉。于是「重拳出击」' +
      '的形象是立住了，消费者的心也凉了。网上那句「有这五百万不如给工人加鸡腿」，' +
      '其实不是真的在乎那口肉，而是感受到了一种分配的割裂：对内斤斤计较，' +
      '对外挥金如土。</p>',
    '<h2>三、别把「技术强」当免死金牌</h2>',
    '<p>比亚迪的技术确实强，这点不用质疑。但技术再强，也掩盖不了一个低级错误' +
      '的分量——一辆车出厂前后轮毂装反，意味着层层质检全部失效。这不是黑粉编的，' +
      '是车主自己拆着看、钢印「20×9J」「20×8J」明晃晃在那儿拍出来的。</p>',
    '<p>消费者能接受制造企业偶尔犯错，只要足够真诚。但「真诚」有具体标准：</p>',
    '<ul>',
    '<li>主动召回、主动告知，而不是等车主自己上论坛比对；</li>',
    '<li>把整改过程摊开给人看——视觉防错、编码复核、供应商追责，一条条亮出来；</li>',
    '<li>对已经受损的轮胎、悬架、传感器部件，给明确的检测和延保承诺，' +
      '而不是「换回来就行」。</li>',
    '</ul>',
    '<p>这份声明里，「视觉防错」「重新起算质保」是有的。可它们被放在了' +
      '「不影响操控、无安全风险」后面，被放在了「五百万悬赏」前面——次序错了，' +
      '诚意就打了折。</p>',
    '<h2>四、给准备买单的人三个提醒</h2>',
    '<p><strong>第一，别把「跟风」当「靠谱」。</strong>身边人买什么你就买什么，' +
      '本质是把选择权交出去。你不知道他买车的真实需求，也不知道他有没有踩过坑。' +
      '尤其在一个「门店号只讲技术领先和到店福利、法务号只讲抓了多少黑公关」的' +
      '信息环境里，跟风的成本最后是你自己扛。</p>',
    '<p><strong>第二，别把「技术」当免票。</strong>技术牛不代表品控可以放松，' +
      '不代表员工可以不被尊重，更不代表消费者的合理投诉可以被一句「黑公关」' +
      '盖过去。判赔 200 万说明造谣该被罚；反过来，真问题被说成造谣，也会把' +
      '真车主推远。</p>',
    '<p><strong>第三，别把「沉默」当「支持」。</strong>你今天替它掩盖品控问题，' +
      '明天它就有底气把你的投诉划进「有组织抹黑」。真正的支持，是让它变得更好，' +
      '而不是替它闭嘴。</p>',
    '<h2>结语</h2>',
    '<p>一个值得尊重的企业，不是靠「技术牛逼」让你闭嘴，而是靠「真诚靠谱」' +
      '让你放心。</p>',
    '<p>比亚迪有过硬的东西，也确实在被围攻。但越是被围攻的时候，越该知道' +
      '刀口朝哪儿——朝外能赢官司，朝内才能赢人心。而对准备掏钱的那个人来说，' +
      '看清这一点，比看清任何一个「技术全球最前」的剪辑，都重要。</p>',
    '<p class="dyp__sign">双休购 · 公益提醒</p>'
  ].join('');

  // ── 版本切换（按钮在 × 左侧；每次刷新都从新版开始，不做 localStorage 记忆）──
  var currentVersion = 'new';

  // 2026-11-16 定稿：右上角按钮控制在 4 字以内，旧存档已删，
  // 两态都是正式公益文章，不再叫「旧版」。按钮 4 字，随当前态翻转、指向目标。
  function versionLabel(v) { return v === 'new' ? '看另一篇' : '看回前篇'; }
  function versionTitle(v) {
    return v === 'new'
      ? '当前：《别让“跟风买车”…》。点击看另一篇《买车之前，先看清谁在替比亚迪说话》'
      : '当前：《买车之前，先看清谁在替比亚迪说话》。点击看回前一篇';
  }
  function versionShareText(v) { return v === 'new' ? SHARE_TEXT : LEGACY_SHARE_TEXT; }

  function setVersion(v) {
    currentVersion = v === 'old' ? 'old' : 'new';
    if (!box) return;
    var art = box.querySelector('.dyp__article');
    if (art) {
      art.innerHTML = currentVersion === 'new' ? ARTICLE_HTML : LEGACY_HTML;
      art.scrollTop = 0;
    }
    var btn = box.querySelector('.dyp__version-toggle');
    if (btn) {
      btn.textContent = versionLabel(currentVersion);
      btn.setAttribute('title', versionTitle(currentVersion));
      btn.setAttribute('aria-label', versionTitle(currentVersion));
    }
    box.classList.toggle('dyp--legacy', currentVersion === 'old');
  }

  function onToggleVersion(ev) {
    if (ev) { ev.preventDefault(); ev.stopPropagation(); }
    setVersion(currentVersion === 'new' ? 'old' : 'new');
  }

  function build() {
    box = document.createElement('div');
    box.className = 'dyp';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'false');
    box.setAttribute('aria-labelledby', 'dyp-title');
    /* 必应摘要排除（2026-11-14）：弹窗是一整篇长文，2.5 秒后自动弹出且
       渲染进 DOM，Bing 渲染 JS 时同样可能把文章段落挑成站点搜索摘要
       （11-04 那次抓的是卡片备注、这次抓的是广告位，同一个坑）。
       data-nosnippet 由 Bing 2025-10-15 起官方支持：只挡摘要，不影响收录
       与排名；属性在新建节点 append 前写入，符合 Google 的合规要求。 */
    box.setAttribute('data-nosnippet', '');
    box.innerHTML =
      '<div class="dyp__mask"></div>' +
      '<div class="dyp__panel dyp--article">' +
        '<button class="dyp__version-toggle" type="button" ' +
          'title="当前：《别让“跟风买车”…》。点击看另一篇《买车之前，先看清谁在替比亚迪说话》">看另一篇</button>' +
        '<button class="dyp__x" type="button" aria-label="关闭">&times;</button>' +
        '<div class="dyp__tag">公益提醒</div>' +
        '<div class="dyp__article" id="dyp-title">' + ARTICLE_HTML + '</div>' +
        '<div class="dyp__se" role="radiogroup" aria-label="浏览器默认搜索引擎确认">' +
          '<p class="dyp__se__q">' + SE_ASK_TEXT + '</p>' +
          '<div class="dyp__se__opts">' +
            '<button type="button" class="dyp__se__opt" data-se="yes" role="radio" aria-checked="false">' +
              '<span class="dyp__se__box" aria-hidden="true"></span>是的</button>' +
            '<button type="button" class="dyp__se__opt" data-se="no" role="radio" aria-checked="false">' +
              '<span class="dyp__se__box" aria-hidden="true"></span>不是</button>' +
          '</div>' +
          '<p class="dyp__se__hint" aria-live="polite"></p>' +
        '</div>' +
        '<p class="dyp__tip" id="dyp-sitelink"></p>' +
        '<div class="dyp__acts">' +
          '<a class="dyp__video" target="_blank" rel="noopener noreferrer"></a>' +
          '<button type="button" class="dyp__share"></button>' +
        '</div>' +
        '<div class="dyp__count" aria-live="polite">' +
          '<span class="dyp__count__num">8</span>' +
          '<span class="dyp__count__label">秒后可关闭</span>' +
          '<span class="dyp__count__bar"><i></i></span>' +
        '</div>' +
      '</div>';

    // 底部第一枚按钮：轮毂事件相关视频（外链抖音短链，新窗口打开）
    var video = box.querySelector('.dyp__video');
    video.href = VIDEO_LINK;
    video.textContent = VIDEO_BTN_TEXT;

    // 底部第二枚「我要分享此文章」——打开分享弹窗，文案带文章标题
    var share = box.querySelector('.dyp__share');
    share.textContent = '我要分享此文章';
    share.addEventListener('click', onShareArticle);

    // 绿色推荐语：放在 .dyp__article 滚动容器之外，文章下方 / 两枚按钮上方，
    // 由面板 flex 列布局固定住——正文滚到文末或回到开头，这一行都在原位。
    var tipEl = box.querySelector('.dyp__tip');
    var sl = document.createElement('a');
    sl.className = 'dyp__sitelink';
    sl.href = SITE_LINK;
    sl.target = '_blank';
    sl.rel = 'noopener noreferrer';
    sl.textContent = SITE_LINK_TEXT;
    tipEl.appendChild(sl);

    // 版本切换（× 左侧）：切正文、切按钮文字、切分享文案，不动倒计时与关闭锁。
    box.querySelector('.dyp__version-toggle')
      .addEventListener('click', onToggleVersion);

    // 搜索引擎确认块（2026-11-20）：二选一，选中后下方给一句小字回执。
    // 只做「问一句 + 给回执」，不做任何自动跳转或浏览器设置改动。
    var seBtns = box.querySelectorAll('.dyp__se__opt');
    var seHint = box.querySelector('.dyp__se__hint');
    function onPickSE(ev) {
      var btn = ev.currentTarget;
      var which = btn.getAttribute('data-se');
      seChoice = which;
      for (var i = 0; i < seBtns.length; i++) {
        var b = seBtns[i];
        var on = b === btn;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-checked', on ? 'true' : 'false');
      }
      if (seHint) {
        seHint.textContent = which === 'yes' ? SE_YES_HINT : SE_NO_HINT;
        seHint.className = 'dyp__se__hint' + (which === 'yes' ? ' is-yes' : ' is-no');
      }
      var seBox = box.querySelector('.dyp__se');
      if (seBox) seBox.classList.remove('dyp__se--nudge');
    }
    for (var j = 0; j < seBtns.length; j++) {
      seBtns[j].addEventListener('click', onPickSE);
    }

    // 关闭方式（2026-11-13 站长指令「先锁死」）：**只能点右上角 × 关闭**。
    // 原先遮罩点击、×、Esc 三条路都能关；现在遮罩与 Esc 一律不绑定 close，
    // 避免误点空白就把弹窗关掉。键盘用户仍可 Tab 到 ×（原生 <button>）按
    // Enter 关闭，可访问性不丢。
    box.querySelector('.dyp__x').onclick = close;

    document.body.appendChild(box);
  }

  // 底部「我要分享此文章」：打开分享弹窗，分享文案按当前版本取（开完即还原）。
  // 分享弹窗 info() 读 og:description 作为分享说明，故开之前临时改写该 meta，
  // open() 同步 build 时会捕获到新文案，随后立即还原，无闪烁。
  function onShareArticle() {
    if (!window.SXGShare || !window.SXGShare.open) return;
    var od = document.querySelector('meta[property="og:description"]');
    var prev = od ? od.getAttribute('content') : '';
    if (od) od.setAttribute('content', versionShareText(currentVersion));
    try { window.SXGShare.open(); } finally {
      if (od) od.setAttribute('content', prev);
    }
  }

  function open() {
    if (!box) build();
    resetSE();            // 每次弹出都从「未选择」开始（弹窗节点复用，不清会带上次的选择）
    box.classList.add('is-open');
    keepCloseVisible();   // 2026-11-21 窄屏兜底：把 × 拉回可视区，防溢出无法关闭
    startCountdown();     // 8 秒倒计时：未到则 × 不生效
  }

  /* 2026-11-21 窄屏关闭按钮越界的运行时兜底说明：
     真机上 layout viewport 可能被横向内容撑宽（documentElement.clientWidth > innerWidth），
     position:absolute 的 × 顶在 panel 右侧会落到可视区外。这里在弹出后 /
     resize / 横竖屏切换时用 getBoundingClientRect 实测，若 × 超出可视区，
     改为 position:fixed 钉在视口右上角内侧（仍保留 8 秒锁与必选逻辑）。
     只在真的溢出时才改，正常机型完全不干预。 */
  function keepCloseVisible() {
    if (!box || !box.classList.contains('is-open')) return;
    var x = box.querySelector('.dyp__x');
    if (!x) return;
    // 先撤掉上一次的内联兜底，再按当前布局实测
    x.style.position = ''; x.style.top = ''; x.style.right = ''; x.style.left = '';
    var r = x.getBoundingClientRect();
    var vw = window.innerWidth || document.documentElement.clientWidth;
    var vh = window.innerHeight || document.documentElement.clientHeight;
    // 顶/右越界（含触摸目标一半）才兜底；left 越界说明面板整体错位，交给 CSS max-width
    if (r.right > vw - 4 || r.top < 4 || r.bottom > vh - 4) {
      x.style.position = 'fixed';
      x.style.top = 'max(10px, env(safe-area-inset-top, 0px))';
      x.style.right = 'max(10px, env(safe-area-inset-right, 0px))';
      x.style.zIndex = '100001';
    }
  }
  // 旋转 / 窗口缩放后重新测量，防止转屏后 × 被顶出去
  window.addEventListener('resize', keepCloseVisible);
  if (window.screen && window.screen.orientation) {
    if (window.screen.orientation.addEventListener) window.screen.orientation.addEventListener('change', keepCloseVisible);
  }

  // 确认块复位：清选择、清回执、清提醒态
  function resetSE() {
    seChoice = '';
    if (!box) return;
    var btns = box.querySelectorAll('.dyp__se__opt');
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.remove('is-on');
      btns[i].setAttribute('aria-checked', 'false');
    }
    var hint = box.querySelector('.dyp__se__hint');
    if (hint) { hint.textContent = ''; hint.className = 'dyp__se__hint'; }
    var seBox = box.querySelector('.dyp__se');
    if (seBox) seBox.classList.remove('dyp__se--nudge');
  }

  // 关闭锁定：弹出后 8 秒内，点 × 不生效（遮罩与 Esc 本来就不关闭）
  var unlockAt = 0;
  var countTimer = null;
  function close() {
    if (Date.now() < unlockAt) {
      // 未到 8 秒：点击关闭不生效，给一个轻提示（抖动）
      if (box) {
        var c = box.querySelector('.dyp__count');
        if (c) {
          c.classList.remove('dyp__count--shake');
          void c.offsetWidth; // 触发重排以重启动画
          c.classList.add('dyp__count--shake');
        }
      }
      return;
    }
    // 2026-11-20 站长反馈「没勾选也能关弹窗」→ 2026-11-21 二次反馈「第二次或者
    // 多按继续关闭按钮，就可以直接关闭」：第一次的「提醒一次后放行」等于没锁死。
    // 现在改为真正锁死：没选就点 ×，每次都只抖提醒，**永远不放行**；
    // 选了「是的 / 不是」任一个才允许关。
    if (!seChoice) {
      if (box) {
        var seBox = box.querySelector('.dyp__se');
        var hint = box.querySelector('.dyp__se__hint');
        if (hint) {
          hint.textContent = SE_NUDGE_HINT;
          hint.className = 'dyp__se__hint is-nudge';
        }
        if (seBox) {
          seBox.classList.remove('dyp__se--nudge');
          void seBox.offsetWidth;
          seBox.classList.add('dyp__se--nudge');
        }
      }
      return;
    }
    if (box) box.classList.remove('is-open');
    // 落点按选择走（2026-11-20 站长第二次反馈，2026-11-21 收紧后无「没选放行」分支）：
    //   · 选「是的」= 已经是 Bing，关掉就停原地，不再把访客往下拽；
    //   · 选「不是」→ 带到页脚「如何用 Bing 搜到本站」。
    // #sxg-bing-guide 由 friend-links-footer.js 注入，可能比弹窗晚挂载，
    // 拿不到时 150ms 轮询重试、最多 3 秒。
    if (seChoice !== 'yes') jumpToBingGuide();
  }

  function jumpToBingGuide() {
    var tries = 0;
    function seek() {
      var target = document.getElementById(BING_GUIDE_ID);
      if (target && target.scrollIntoView) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      if (tries++ < 20) setTimeout(seek, 150);
    }
    setTimeout(seek, 60); // 先让关闭动画/布局落一帧，再算目标位置
  }

  // ── 8 秒锁定窗口的资源预热（2026-11-05 站长指令）────────────────────
  // 站长原话大意：8 秒的时间内，也能预加载很多了吧？
  // 实现：弹窗弹出即开始低优先级并发预热首页品牌卡 LOGO 图片
  // （含后续 logo 加密 blob .enc 容器），并发 4 路、每 2s 重扫一遍
  // 捡漏（自定义卡是分批渐进注入的，弹窗时点可能还没注完），
  // 倒计时结束停止。用户关掉弹窗往下滚时 LOGO 已在 HTTP 缓存里。
  var warmSeen = {};
  var warmTimer = null;
  var warmUrls = [];
  var warmIdx = 0;
  /* 加密 LOGO 容器地址（与 logo-vault.js 的 ENC_URL 同一个文件；改容器缓存号
     时两边的 ?v 要一起 bump）。预热它 = 一次请求覆盖全部 59 张 LOGO。 */
  var ENC_LOGO_URL = './assets/logos.enc?v=1';
  function warmScan() {
    var imgs = document.querySelectorAll('div.bg-white.rounded-2xl.border img[src]');
    for (var i = 0; i < imgs.length; i++) {
      var u = imgs[i].getAttribute('src');
      if (u && !/^data:/.test(u) && !warmSeen[u]) {
        warmSeen[u] = 1;
        warmUrls.push(u);
      }
    }
    // 加密 LOGO 容器（logo-vault 流程）：data-sxg-enc 存的是裸 slug（如 'kfc'）
    // 而不是 URL——真正要预热的是容器文件 ./assets/logos.enc（一个请求覆盖全部
    // LOGO）。2026-11-05 事故：曾把裸 slug 当 URL 预加载，每轮 59 个 404。
    if (!warmSeen[ENC_LOGO_URL]) {
      warmSeen[ENC_LOGO_URL] = 1;
      warmUrls.push(ENC_LOGO_URL);
    }
  }
  function warmNext() {
    if (warmIdx >= warmUrls.length) return;
    var u = warmUrls[warmIdx];
    warmIdx += 1;
    if (/\.enc$/.test(u)) {
      fetch(u, { priority: 'low' }).catch(function () {});
      warmNext(); // fetch 无 onload，链式取下一个
    } else {
      var img = new Image();
      img.onload = img.onerror = warmNext;
      img.src = u;
    }
  }
  function warmStart() {
    warmScan();
    warmNext(); // 并发 4 路：4 个 Image 同时跑，各自 onload 链式取下一个
    warmNext();
    warmNext();
    warmNext();
    // 每 2s 重扫一遍捡漏（分批注入的后到卡片），倒计时到点清掉
    clearInterval(warmTimer);
    warmTimer = setInterval(warmScan, 2000);
  }
  function warmStop() {
    clearInterval(warmTimer);
    warmTimer = null;
  }

  // 8 秒滚动倒计时：数字递减 + 进度条收缩；到点后放行关闭
  function startCountdown() {
    unlockAt = Date.now() + 8000;
    var numEl = box.querySelector('.dyp__count__num');
    var barEl = box.querySelector('.dyp__count__bar > i');
    var labelEl = box.querySelector('.dyp__count__label');
    if (countTimer) clearInterval(countTimer);
    warmStart(); // 锁定窗口开场即预热
    function tick() {
      var left = unlockAt - Date.now();
      if (left <= 0) {
        clearInterval(countTimer);
        countTimer = null;
        warmScan(); // 收尾再扫一遍，把分批注入的后到卡片也预热掉
        warmNext(); warmNext(); warmNext(); warmNext();
        setTimeout(warmStop, 3000); // 留 3s 给最后一批拉完，然后停摆
        if (numEl) numEl.textContent = '0';
        if (labelEl) labelEl.textContent = '点右上角 × 关闭';
        if (barEl) barEl.style.width = '0%';
        if (box) {
          var rd = box.querySelector('.dyp__count');
          if (rd) rd.classList.add('dyp__count--ready');
        }
        return;
      }
      if (numEl) numEl.textContent = String(Math.ceil(left / 1000));
      if (barEl) barEl.style.width = (left / 8000 * 100) + '%';
    }
    tick();
    countTimer = setInterval(tick, 100);
  }

  function init() {
    // 每次刷新首页都自动弹（无冷却）：延迟 autoDelayMs 后弹出
    setTimeout(function () {
      open();
    }, 2500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
