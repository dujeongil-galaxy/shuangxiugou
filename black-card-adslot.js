/* ==========================================================================
   首页黑色「全网打工人已转移消费额」卡片 → 滚动式「公益广告位」（轮播）
   --------------------------------------------------------------------------
   站长 2026-11-09 深夜指令（三处修正）：
   ① 「天猫链接也点不动啊」——CTA 提示词原先是 <div> 没有 href，只有左边 76px
      小 logo 可点。现在整张广告设计图 + CTA 提示词都是真 <a href=天猫零参数首页>。
   ② 「广告位为什么不是居中」——卡片内容一律水平居中；左右箭头从「绝对定位盖在
      卡片上」移到卡片下方导航条，彻底消除招商卡标题被箭头压住的问题。
   ③ 「广告位这个你不能设计一下图片吗」——新增两张站点自绘矢量设计稿：
      assets/ad-luxiyi.svg（品牌广告）/ assets/ad-recruit.svg（虚位以待衬底），
      与品牌 mascot 共用蓝红民族纹样 + 刺梨金黄配色，任意分辨率清晰。

   站长 2026-11-10 批次（三处）：
   ④ 「挡住了，你没发现？」——真渲染量出两类遮挡：
      a) 招商卡设计稿中央那个 r=102 的圆形印章把 HTML 文案圈在里面、弧线压字；
         现改为横向圆角白底横幅，文案区不放任何线条，副标题对比度加深。
      b) 右侧限时推广浮层 / 底部吸底条 / 悬浮按钮（z-index 9990、9000）在窄屏下
         会压住广告位；广告位是正常文档流内容，不抢 z-index——窄屏用
         keepClear() 在相交时临时隐藏这几个 fixed 圆钮（离开视口立即恢复），
         绝不高于全站固定的 frosted 闪屏遮罩（#sxg-flash-mask，z 8000）与
         首次访问劳工提醒弹窗 .dyp（z 100000）。2026-11-11 站长报障：广告位
         z-index 9995 高于闪屏遮罩 8000，搜索删空整屏模糊时广告位穿透磨砂
         露出尖角；现已把广告位降回文档流（无独立 z-index），闪屏 / FAB 自然
         盖在它之上，keepClear 也不再误伤闪屏遮罩（按 id 排除）。
   ⑤ 「广告位请优化一下，叫 公益广告位」——全站可见文案统一改为「公益广告位」，
      第二张卡由「广告位招商中」改为「公益广告位 · 虚位以待」，明确免费展示、
      非商业招商；品牌卡标记「公益展示」。两张 SVG 角标文案同步。
   ⑥ 「穿模了，所以手机端那边也会显示异常」——第二张卡文案层原是固定字号
      绝对定位叠在随宽度缩放的 SVG 白板上，手机端白板 44px 高装不下 66px+
      文案，上下穿出。照上游被替换黑卡的 flex 正常流写法重排：文案出
      art-wrap、改正常流 CSS 白板（随文字长高），SVG 写死的白板撤掉
      （ad-recruit.svg ?v=2），装饰框/角标保留。任何宽度不再穿模。

   ⑦ 站长 2026-11-10 二次纠正（两件事，一次解决）：
      a) 「广告图叫你重构，不是让你改成纯文字」——前一轮为了消灭穿模，把图里的
         白板交给 HTML/CSS 去画，结果卡片看上去就是两行字。本版**整张海报回到图里**：
         assets/ad-recruit.svg 重画（深蓝底 + 金色挂牌 + 印章 + 同心弧 + 聚光，
         1200×300），标题/副句/说明全部是 SVG <text>，与第 1 张陆喜依广告同语言。
      b) 「你这文字明显也重叠了」——他把「图没加载出来、只剩 HTML 文案」那个中间态
         看成了叠字。真正的修法是让文案不再有两个来源：**文案只在图里**，
         HTML 侧只留一行正常流 meta 说明。文字与图形同一坐标系、同一缩放比例，
         结构上不可能穿模/叠字（verify §32c 机器断言三条基线递增）。
      c) 顺带修图片失败态：旧代码 error 时直接 display:none → 卡片退化成纯文字；
         现在兜底成同色系海报底 + 金字（.sxg-adslot__art-wrap[data-art-error]）。

   三张卡：① 陆喜依品牌广告（整图点击跳天猫、品牌名跳站内详情页）；
   ② 胖东来（善待劳动者，整图与 CTA 挂京东站内搜索、品牌名跳站内详情页）；
   ③ 公益广告位虚位以待。支持箭头/圆点手动切换 + 5s 自动轮播（悬停暂停）。
   定位锚点：全站唯一文案「全网打工人已转移消费额」。沿用三重兜底替换。
   主站 bundle assets/index-*.js 不可改，所有页面微调一律走独立补丁脚本。

   ⑧ 站长 2026-11-10 晚（胖东来广告卡，首页推荐位）：
      「去给胖东来设计一条广告.....我是说首页推荐位，视频中提到的胖东来对待
       劳动者的态度，务必备注，这也是为什么挂上广告位的原因，但不得直接把
       视频链接挂在广告位」——轮播新增胖东来卡（第 2 张）：
      - assets/ad-pangdonglai.svg 自绘海报（与另两张同一套深蓝+金+挂牌语言，
        印章「敬」），文案画进图里、三条基线严格递增：「胖东来」/
        「备注 · 货车司机送货，也能体会到尊重」（对待劳动者的态度，务必备注）/
        「善待劳动者，正是它登上公益广告位的原因」（挂上广告位的原因）。
      - 品牌名与头像只链站内 brand/pdl.html + assets/pdl.png。
      - **广告位零视频链接**：短视频短链不进脚本、不进 SVG、不进 DOM
        （verify §29j/§29k 有反向断言；注释里也不拼写该域名，防自扫误判）。
      - 三卡角标改 03 体系（01/03 陆喜依、02/03 胖东来、03/03 虚位以待），
        两张旧图角标同步、?v 各 bump（ad-luxiyi ?v=2、ad-recruit ?v=4），
        防缓存里留着「01 / 02」旧角标。

   ⑨ 站长 2026-11-10 19:48 追加（原话）：
      「备注两个字去掉，这次优先挂京东链接，如果找不到，才考虑淘宝天猫的」
      - 海报第二行去掉「备注 · 」前缀，只留「货车司机送货，也能体会到尊重」；
        态度与「挂上公益广告位的原因」两条信息一条不少（verify §29j 同时反向
        钉死「可见文案里不许再出现备注两字」）。
      - 商城入口**京东优先**：胖东来在京东、淘宝天猫都没有可核实的官方店铺
        （官方口径只有微信小程序与抖音店；京东站内那个「胖东来官方旗舰店」
        资质存疑，多篇报道认定是假冒/代购），所以不指向任何具体第三方店铺，
        改挂京东站内搜索「胖东来」（零追踪参数、真可点）。淘宝天猫只在京东
        链接找不到时才作为备选，本次未启用。整张广告图 + CTA 都换成京东链接，
        **可见文案同步换「去京东搜胖东来」**，不许只改 href 留着旧来源标签。
        （本条 ⑪ 2026-11-11 00:46 已整体取代：链接换成站长指定的本地宝文章、
          点击复制 + 微信提示；保留在此仅作决策沿革，不是现行口径。）
      - 品牌名与头像仍只链站内 brand/pdl.html + assets/pdl.png。

   ⑪ 站长 2026-11-11 00:46（原话）：
      「胖东来的广告先改了吧，第一张也不要和第二张广告使用同一种风格
       （链接原文见 CHANGELOG 00:46 条目）链接换到这个，
       参考良配的广告，点了就自动复制，弹窗提醒用户自己去微信」
      - **链接**：京东站内搜索撤下，改挂站长指定的介绍文章（原文见记账）。
        该文说明胖东来官方线上入口是微信小程序与抖音专营店，并非京东/天猫
        店铺，因此不再把读者导向任何商城搜索页。链接写进常量 PDL_LINK
        （零参数），整图与 CTA 共用单一真相源。（本段 ⑫ 已整体取代。）
      - **交互**：照 liangpei-ad.js 的成熟做法（不是照抄，独立实现）：
        点击整图/CTA → 同步 execCommand('copy') 趁用户手势写入剪贴板 →
        navigator.clipboard 异步兜底 → 弹出 toast 提醒去微信粘贴（⑫ 已把
        「链接」改口为「小程序口令」），并把口令本体放在可点再复制的 <code> 里，
        自动复制万一被浏览器静默拒绝，用户仍有最后一条路。
        微信内置浏览器里曾在微信时放行默认跳转（本句 ⑫ 已撤销：口令不是
        URL，微信内也必须复制后粘贴到聊天窗口）。
      - **可见文案同步**：CTA / aria-label 都写「复制 + 去微信」，卡内零
        京东/淘宝/天猫字样（口径按 2026-11-07 教训：改 href 不换可见文案
        等于没做）。具体文案 ⑫ 已改口为「小程序口令」。
      - **风格**：三张海报两两互异。第 1 张陆喜依保持深蓝金字正式稿，
        第 3 张招商保持暖白纸面告示稿，第 2 张胖东来换成第三套
        「砖红纯色 + 米白运单/号外横条 + 橙色装订边 + 粗报头线」，
        桌面稿与手机稿同步（verify §36a/§36b 反向断言）。

   ⑫ 站长 2026-11-11 01:48（原话）：
      「链接不对，替换这个 #小程序://胖东来/zxlej7hK8bNv5Sj」
      - 站长看了点击后的 toast 截图：框里躺的是介绍文章 URL，不对。真正要复制的
        是**微信小程序口令**。⑪ 的文章链接整体撤下，不再出现在组件与 README。
      - 口令不是可点地址：以 # 开头，只有粘贴到微信聊天窗口并发送后才会渲染成
        小程序卡片。因此 ⑪ 的「微信内置浏览器里已在微信，放行默认跳转」一并撤销：
        **任何浏览器里点了都只复制 + 弹窗**，放行跳转既打不开小程序，还会让
        「点了就自动复制」静默失效。
      - 口令写进 PDL_LINK（唯一真相源），整图与 CTA 的 href 仍引用它作为可点载体；
        点击一律 preventDefault，绝不把 #fragment 写进地址栏。
      - **可见文案同步改口**：CTA「复制小程序口令」、aria-label、toast 标题与
        操作步骤里所有「链接」字样换成「口令/小程序卡片」，不许只换常量留旧标签。
   ⑬ 站长 2026-11-27（原话两段，后段覆盖前段）：
      「首页，胖东来广告，不再使用微信小程序，移除相关代码，并直接替换为淘宝链接」
      「算了，还是用之前那个风格弹窗吧，这样的话，既可以推荐去淘宝购物，
       也可以引导用户访问他们的抖音」
      - ⑫ 的微信小程序口令整体作废：口令常量、execCommand/clipboard 复制链路、
        黑色 toast、复制步骤文案全部删除，组件与 README 零「小程序/口令/微信」。
      - 点击整图/CTA → preventDefault → 弹出**居中弹窗**，照 liangpei-ad.js
        2026-11-19 那套 lp-modal 风格（遮罩 + 白卡 + × / 遮罩 / Esc 关闭），
        但独立类名 sxg-adslot__modal，不复用良配 DOM。
      - 弹窗里两个真 <a>：① 站长给的淘宝店（推荐去淘宝购物）；
        ② 站长给的抖音主页（引导访问他们的抖音）。两个链接都是完整原链接，
        一个字不改（淘宝链接里的 ali_* 参数是站长自己的推广码，不许删）。
      - 可见文案同步改口：CTA「点此查看淘宝店与抖音 →」、aria-label 同步，
        不许只换 href 留着「复制口令 / 去微信」旧标签。
   ⑭ 站长 2026-11-28（两段）：
       「算了，恢复吧」——胖东来卡恢复上架（PDL_ON 改回 true），编号体系随之从
         02 张（01/02、02/02）改回 4 张：陆喜依 01/04、胖东来 02/04、
         星巴克 03/04、招商 04/04。三张旧稿水印同步改、?v 各 bump。
       「但新增一个星巴克的，挂一下腾讯应用宝的星巴克 App 下载页面。
         学 AD1 陆喜依，需要明确告知用户，点击会跳转到哪里，不要做那种一声不吭的」
       - 新增第 3 张「星巴克」卡（assets/ad-starbucks.svg + -mobile.svg）：
         落地页是腾讯应用宝的星巴克 App 官方下载页（sj.qq.com/appdetail/com.starbucks.cn，
         开发者为星巴克企业管理（中国）有限公司），零参数。
       - **学 AD1 陆喜依**：跟第 1 张同一路数——整张广告图 + CTA 都是真 <a>，
         点了直接跳目标页（新标签），不玩弹窗二次确认（那是胖东来那套）。
       - **明确告知去向**：星巴克这一张额外要求「点之前就说清楚会跳到哪」。
         做法是在**可见文案**里写明落地页（海报 CTA 下方一行 + 卡片 meta 里的
         说明行 + aria-label），不是只塞在 title 里让人看不见。
       - 视觉与另三张两两互异（verify §36a/§36b 反向断言）：星巴克绿纯色 +
         白色手机轮廓 + 下载箭头，不含渐变/金色/深蓝/砖红/暖白/网格/虚线框。
    ========================================================================== */
(function () {
  'use strict';

  var SIG = '全网打工人已转移消费额';
  var TMALL = 'https://luxiyi.tmall.com/';
  var DETAIL = './brand/luxiyi.html';
  var IMG = './assets/luxiyi.jpg';
  var PDL_DETAIL = './brand/pdl.html';
  var PDL_IMG = './assets/pdl.png';
  /* 站长 2026-11-27 后续口径：淘宝入口不挂任何推广/追踪参数，裸店址能打开
     店铺即可；陆喜依天猫店同理（TMALL 本就是零参数）。抖音是官方主页，
     不是短视频单链。单一真相源，两条店铺链接都不带查询串。 */
  var PDL_TAOBAO = 'https://n3sf0tqhvhbw60ae2xdq4nodo2g4kxl.taobao.com/';
  var PDL_DOUYIN = 'https://www.douyin.com/user/MS4wLjABAAAANjHa0B-e7JAX89HjRiCnSLRbFYYG3b0wrt7397e7IBA';
  /* ⑭ 星巴克卡（2026-11-28 站长指令）：落地腾讯应用宝的星巴克 App 官方下载页。
     包名 com.starbucks.cn，开发者为星巴克企业管理（中国）有限公司；零参数裸链接。 */
  var SBX_APP = 'https://sj.qq.com/appdetail/com.starbucks.cn';
  var SBX_DETAIL = './brand/starbucks.html';
  var SBX_IMG = './assets/starbucks.svg';
  /* 三张广告设计图。?v 必须与 index.html 里的 <link rel=preload as=image> 完全一致，
     否则浏览器会把它当两个资源（预热的白预了）。改了图就同步升这里和 index.html。 */
  var ART = './assets/ad-luxiyi.svg?v=4';
  var ART_PDL = './assets/ad-pangdonglai.svg?v=4';
  var ART_SBX = './assets/ad-starbucks.svg?v=1';
  var ART_RECRUIT = './assets/ad-recruit.svg?v=7';
  /* ⑩ 站长 2026-11-10 23:40「手机端你检查了吗？新建的公益广告位，都穿模了」：
     桌面稿 1200×300 等比压到 356px 宽后，14~26px 的小字只剩 4~8px，糊成一团。
     窄屏改用 400×240 的手机专用稿（字号放大 2 倍以上、三条基线重新排开），
     用 <picture> 的 media 切换。⑪ 胖东来两稿换风格，?v 同时升 3 / 2。 */
  var ART_MOBILE = './assets/ad-luxiyi-mobile.svg?v=3';
  var ART_PDL_MOBILE = './assets/ad-pangdonglai-mobile.svg?v=3';
  var ART_SBX_MOBILE = './assets/ad-starbucks-mobile.svg?v=1';
  var ART_RECRUIT_MOBILE = './assets/ad-recruit-mobile.svg?v=3';
  var AUTOPLAY_MS = 5000;

  /* ⑭ 胖东来卡恢复上架（2026-11-28 站长「算了，恢复吧」）：
     轮播回到 4 张：陆喜依 01/04、胖东来 02/04、星巴克 03/04、招商 04/04。
     开关仍留着（改回 false 即可再下架），但当前为 true。 */
  var PDL_ON = true;

  /* ⑬ 居中弹窗（照 liangpei-ad.js 2026-11-19 lp-modal 那套风格：
     遮罩 + 白卡 + × / 点遮罩 / Esc 三种关闭；display:none↔flex 硬切换，
     不碰 opacity/visibility 过渡，避免 2026-11-18 卡帧老坑）。
     弹窗里两条真 <a>：淘宝购物 + 抖音主页，target=_blank + rel=noopener。
     本站不判定「哪个是真的胖东来」，只把站长给的两个入口如实摆出来。 */
  var modalEl = null;

  function ensureModal() {
    if (modalEl) return modalEl;
    modalEl = document.createElement('div');
    modalEl.className = 'sxg-adslot__modal';
    modalEl.setAttribute('role', 'dialog');
    modalEl.setAttribute('aria-modal', 'true');
    modalEl.setAttribute('aria-label', '胖东来 · 淘宝购物与抖音主页');
    modalEl.setAttribute('data-sxg-pdl-modal', '1');
    modalEl.innerHTML =
      '<div class="sxg-adslot__modal-mask"></div>' +
      '<div class="sxg-adslot__modal-card">' +
        '<button type="button" class="sxg-adslot__modal-close" aria-label="关闭弹窗">&times;</button>' +
        '<div class="sxg-adslot__modal-title">胖东来 · 善待劳动者</div>' +
        '<div class="sxg-adslot__modal-steps">' +
          '<p>货车司机送货，也能体会到尊重——这是它登上公益广告位的原因。</p>' +
          '<p>想逛线上店、或看看他们的抖音，下面两个入口自己选。</p>' +
        '</div>' +
        '<a class="sxg-adslot__modal-link sxg-adslot__modal-taobao" href="' + PDL_TAOBAO + '" target="_blank" rel="noopener">去淘宝店逛逛 →</a>' +
        '<a class="sxg-adslot__modal-link sxg-adslot__modal-douyin" href="' + PDL_DOUYIN + '" target="_blank" rel="noopener">看他们的抖音 →</a>' +
        '<div class="sxg-adslot__modal-note">链接由站长提供 · 直达店铺主页</div>' +
      '</div>';
    document.body.appendChild(modalEl);

    function close() { modalEl.classList.remove('is-show'); }
    modalEl.querySelector('.sxg-adslot__modal-close').addEventListener('click', close);
    modalEl.querySelector('.sxg-adslot__modal-mask').addEventListener('click', close);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && modalEl.classList.contains('is-show')) close();
    });
    return modalEl;
  }

  function openModal() {
    var el = ensureModal();
    el.classList.add('is-show');
    var closeBtn = el.querySelector('.sxg-adslot__modal-close');
    if (closeBtn && typeof closeBtn.focus === 'function') closeBtn.focus();
  }

  function bindShare(root) {
    var links = root.querySelectorAll('[data-sxg-share]');
    for (var i = 0; i < links.length; i++) {
      (function (a) {
        a.addEventListener('click', function (e) {
          e.preventDefault(); // 不在这里直接跳转，统一走居中弹窗让用户选淘宝/抖音
          openModal();
        });
      })(links[i]);
    }
  }

  function injectStyle() {
    if (document.getElementById('sxg-adslot-style')) return;
    var css =
      /* 2026-11-11 §36i：外观令牌对齐站点品牌卡（bundle 里的
         rounded-2xl + border-slate-200/80 + shadow-xs）。
         站长「广告位应该写在原有框架内」——只统一观感令牌（边框半透明、加 1px 浅阴影），
         内部结构一律不动：三张海报仍满宽出血、顶栏/导航/脚注分层照旧。 */
      '.sxg-adslot{box-sizing:border-box;position:relative;margin:0;padding:0;' +
      'border:1px solid rgba(226,232,240,.8);border-radius:16px;background:#fff;overflow:hidden;' +
      'box-shadow:0 1px 2px 0 rgba(0,0,0,.05);' +
      'font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;width:100%}' +
      '.sxg-adslot__head{display:flex;align-items:center;justify-content:center;gap:6px;' +
      'padding:9px 16px;font-size:12px;font-weight:700;color:#94a3b8;letter-spacing:.12em;' +
      'border-bottom:1px solid #f1f5f9;text-align:center}' +
      '.sxg-adslot__head::before{content:"";width:6px;height:6px;border-radius:50%;background:#f59e0b}' +
      '.sxg-adslot__viewport{overflow:hidden}' +
      '.sxg-adslot__track{display:flex;transition:transform .45s ease;will-change:transform}' +
      '.sxg-adslot__card{flex:0 0 100%;box-sizing:border-box;display:flex;flex-direction:column;' +
      'align-items:center;justify-content:center;text-align:center;color:#0f172a}' +
      '.sxg-adslot__art-wrap{position:relative;width:100%;line-height:0}' +
      '.sxg-adslot__art-wrap picture{display:block;line-height:0}' +
      '.sxg-adslot__art{display:block;width:100%;height:auto}' +
      /* 广告设计图加载失败时的兜底海报：同色系底 + 金字，绝不再退回「纯文字」 */
      '.sxg-adslot__art-wrap[data-art-error]{min-height:132px;line-height:1.5;display:flex;' +
      'align-items:center;justify-content:center;border-radius:12px;' +
      'background:linear-gradient(135deg,#0a1b47,#1d3f9e 52%,#0e2a68)}' +
      '.sxg-adslot__art-wrap[data-art-error]::after{content:attr(data-art-error-text);' +
      'color:#f7d774;font-size:16px;font-weight:700;letter-spacing:.12em}' +
      '.sxg-adslot__banner{display:block;width:100%;line-height:0;text-decoration:none;cursor:pointer}' +
      '.sxg-adslot__banner:hover .sxg-adslot__art{filter:brightness(1.06)}' +
      '.sxg-adslot__meta{box-sizing:border-box;width:100%;min-height:46px;display:flex;' +
      'align-items:center;justify-content:center;flex-wrap:wrap;gap:6px 10px;' +
      'padding:8px 16px;text-align:center}' +
      '.sxg-adslot__avatar{flex:0 0 auto;width:26px;height:26px;border-radius:8px;' +
      'object-fit:contain;background:#fff;box-shadow:0 1px 6px rgba(15,23,42,.14)}' +
      '.sxg-adslot__name{font-size:14px;font-weight:800;color:#0f172a;text-decoration:none}' +
      '.sxg-adslot__name:hover{text-decoration:underline}' +
      '.sxg-adslot__mark{flex:0 0 auto;padding:2px 8px;border-radius:999px;' +
      'background:#f1f5f9;color:#94a3b8;font-size:11px;font-weight:700;white-space:nowrap}' +
      '.sxg-adslot__tag{font-size:12px;color:#64748b;line-height:1.5}' +
      '.sxg-adslot__cta{font-size:13px;font-weight:700;color:#2563eb;line-height:1.5;' +
      'text-decoration:none;cursor:pointer}' +
      '.sxg-adslot__cta:hover{text-decoration:underline}' +
      '.sxg-adslot__hint{font-size:12px;color:#94a3b8;line-height:1.5}' +
      /* ⑭ 星巴克卡：把「点击会跳到哪里」写成一整行放在卡面下方（不是塞进
         title/aria-label 里让人看不见）。链接本身是真 <a>，可点可读。 */
      '.sxg-adslot__jump{box-sizing:border-box;width:100%;padding:0 16px 10px;' +
      'text-align:center;font-size:12px;line-height:1.7;color:#64748b}' +
      '.sxg-adslot__jump a{color:#2563eb;font-weight:700;text-decoration:none}' +
      '.sxg-adslot__jump a:hover{text-decoration:underline}' +
      /* ⑭ 卡面下方新增的备注行（排名不分先后），与免责脚注分层。 */
      '.sxg-adslot__ranknote{box-sizing:border-box;width:100%;padding:9px 16px;' +
      'border-top:1px solid #f1f5f9;font-size:11.5px;line-height:1.7;color:#94a3b8;' +
      'text-align:left;letter-spacing:.01em}' +
      /* 站长 2026-11-11 新增：整块公益广告位的免责脚注（AI 生成图 + 站长人工核实 +
         申请上刊方式）。作为 .sxg-adslot 的最后一个子元素，紧贴 foot 下方，做成
         占满整卡宽度的小字浅灰脚注；不进任何一张海报 SVG（那是 §32 锁死的「文案只在图里」）。
         视觉上仍是同一张白卡，与 foot 各带一条 border-top 自然分层（导航层 / 说明层）。 */
      '.sxg-adslot__disclaimer{box-sizing:border-box;width:100%;padding:10px 16px 14px;' +
      'border-top:1px solid #f1f5f9;font-size:11px;line-height:1.7;color:#94a3b8;' +
      'text-align:left;letter-spacing:.01em}' +
      '.sxg-adslot__issue{color:#2563eb;text-decoration:none;font-weight:700}' +
      '.sxg-adslot__issue:hover{text-decoration:underline}' +
      /* 执行日期整句不折行：否则在 718px 卡宽下会被拆成「…起」/「执行。」，
         末行只剩两个字，读着像被截断。 */
      '.sxg-adslot__date{white-space:nowrap}' +
      /* 站长 2026-11-10 二次纠正「广告图叫你重构，不是让你改成纯文字 / 文字明显重叠」：
         前两版都在跟「HTML 文案压在图上」这个结构较劲（绝对叠层 → 正常流白板），
         只要文案还在图外，就永远要跟图的缩放对账。本版直接换结构：
         **文案全部画进 ad-recruit.svg 的 <text> 里**，与图形同一坐标系、同一缩放
         比例 —— 结构上不可能再出现「文字比底板高」的穿模或叠字。
         所以这里不再有 recruit-copy / recruit-title / recruit-sub 三个类，
         HTML 只保留一行正常流的 meta 说明（手机端可读，字号见下方媒体查询）。 */
      '.sxg-adslot__foot{display:flex;align-items:center;justify-content:center;gap:12px;' +
      'padding:7px 0 14px;border-top:1px solid #f1f5f9}' +
      '.sxg-adslot__nav{width:26px;height:26px;border:none;border-radius:50%;box-shadow:0 1px 3px rgba(15,23,42,.18);' +
      'background:#e2e8f0;color:#334155;font-size:17px;line-height:1;cursor:pointer;' +
      'display:flex;align-items:center;justify-content:center;padding:0}' +
      '.sxg-adslot__nav:hover{background:#1d3f9e;color:#fff}' +
      '.sxg-adslot__dots{display:flex;align-items:center;gap:6px}' +
      '.sxg-adslot__dot{width:7px;height:7px;border-radius:50%;background:#cbd5e1;' +
      'cursor:pointer;transition:background .2s}' +
      '.sxg-adslot__dot.is-active{background:#1d3f9e}' +
      /* 手机端：广告位进入视口时，压在卡片上的 fixed 悬浮圆钮临时避让
         （真渲染量出 z-index 9000 的两个按钮与卡片边界相交 47×46，
           被卡片 z-index 9995 切掉一半，看着就是「穿模的半个圆」）。
         只隐藏「与广告位几何相交」的那几个，离开视口立刻恢复，不动站内其它交互。 */
      '@media (max-width:480px){' +
      '.sxg-adslot__cta{font-size:12px}.sxg-adslot__meta{gap:5px 8px}' +
      '.sxg-adslot__disclaimer{font-size:10.5px;padding:9px 14px 12px}' +
      'html.sxg-adslot-near [data-sxg-adslot-avoid]{visibility:hidden!important;pointer-events:none!important}}' +
      /* ⑬ 居中弹窗：照 liangpei-ad.js lp-modal 的结构与观感，独立类名。
         display:none↔flex 硬切换（不碰 opacity/visibility 过渡，避开 2026-11-18
         卡帧老坑）；z=100010 高于提醒弹窗，也不被 keepClear() 当成要避让的悬浮圆钮
         （它只管 1000~9994）。 */
      '.sxg-adslot__modal{display:none;position:fixed;inset:0;z-index:100010;' +
      'align-items:center;justify-content:center;padding:20px;' +
      'font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif}' +
      '.sxg-adslot__modal.is-show{display:flex}' +
      '.sxg-adslot__modal-mask{position:absolute;inset:0;background:rgba(20,17,13,.55)}' +
      '.sxg-adslot__modal-card{position:relative;box-sizing:border-box;width:min(92vw,380px);' +
      'max-height:calc(100vh - 40px);overflow:auto;padding:26px 22px 18px;border-radius:16px;' +
      'background:#fff;color:#2a2620;text-align:center;box-shadow:0 18px 60px rgba(0,0,0,.28);' +
      'animation:sxg-adslot-modal-in .24s ease}' +
      '@keyframes sxg-adslot-modal-in{from{opacity:0;transform:translateY(14px) scale(.97)}' +
      'to{opacity:1;transform:translateY(0) scale(1)}}' +
      '.sxg-adslot__modal-close{position:absolute;top:8px;right:8px;width:28px;height:28px;' +
      'padding:0;border:0;border-radius:999px;background:transparent;color:#9b8f80;' +
      'font-size:19px;line-height:1;cursor:pointer}' +
      '.sxg-adslot__modal-close:hover{background:rgba(42,38,32,.06);color:#2a2620}' +
      '.sxg-adslot__modal-title{margin-bottom:12px;font-size:17px;font-weight:800;color:#2a2620}' +
      '.sxg-adslot__modal-steps{margin-bottom:14px;padding:12px 14px;border-radius:12px;' +
      'background:#f6f4ef;text-align:left}' +
      '.sxg-adslot__modal-steps p{margin:0;font-size:13px;line-height:1.7;color:#5c554a}' +
      '.sxg-adslot__modal-steps p+p{margin-top:6px}' +
      '.sxg-adslot__modal-link{display:block;margin-bottom:10px;padding:12px 15px;border-radius:10px;' +
      'color:#fff;font-size:15px;font-weight:700;text-decoration:none;transition:filter .15s ease,transform .15s ease}' +
      '.sxg-adslot__modal-link:hover{filter:brightness(1.06)}' +
      '.sxg-adslot__modal-link:active{transform:scale(.97)}' +
      '.sxg-adslot__modal-taobao{background:linear-gradient(135deg,#f97316,#ea580c);' +
      'box-shadow:0 4px 12px rgba(249,115,22,.3)}' +
      '.sxg-adslot__modal-douyin{background:linear-gradient(135deg,#111827,#000);' +
      'box-shadow:0 4px 12px rgba(0,0,0,.28)}' +
      '.sxg-adslot__modal-note{margin-top:10px;font-size:11.5px;color:#9b8f80}' +
      '@media (max-width:374px){.sxg-adslot__modal{padding:12px}' +
      '.sxg-adslot__modal-card{padding:22px 16px 14px}}';
    var st = document.createElement('style');
    st.id = 'sxg-adslot-style';
    st.textContent = css;
    (document.head || document.documentElement).appendChild(st);
  }

  function buildSlot() {
    var root = document.createElement('div');
    root.className = 'sxg-adslot';
    root.setAttribute('data-adslot', '1');
    root.setAttribute('data-adslot-reserved', '1'); // 兼容 cdp-adcheck 验收
    root.setAttribute('data-adslot-kind', 'public-welfare');
    root.setAttribute('aria-label', '公益广告位');
    /* 必应摘要排除（2026-11-14 站长「广告位的这个被抓取了，之前不是改过吗」）：
       Bing 会渲染 JS 后从页面可见文本里算法挑一段当搜索结果摘要，meta
       description 只是候选之一——首屏广告位文字密集，于是又被选中。
       Bing 自 2025-10-15 起官方支持 data-nosnippet（官方用例明确点名
       「把广告 / 推广内容排除出中性预览」），Google 同样支持：标记区块
       照常被索引、照常参与排名，但不出现在摘要与 AI 回答里。
       注意：Google 要求属性必须在元素**首次加入页面时**就带上，不许事后
       用 JS 在已有节点上增删——这里 root 是新建节点、append 前设置，合规。
       属性挂在根节点上，卡片、CTA、免责声明、alt/兜底文字整体覆盖。 */
    root.setAttribute('data-nosnippet', '');
    root.innerHTML =
      '<div class="sxg-adslot__head">公益广告位 排名不分先后</div>' +
      '<div class="sxg-adslot__viewport">' +
        '<div class="sxg-adslot__track">' +
          '<div class="sxg-adslot__card sxg-adslot__card--brand">' +
            '<a class="sxg-adslot__banner" href="' + TMALL + '" target="_blank" rel="noopener" ' +
              'aria-label="进入陆喜依天猫旗舰店，支持真实双休企业">' +
              '<div class="sxg-adslot__art-wrap" data-art-error-text="陆喜依 · 真实双休标杆品牌">' +
                '<picture>' +
                  '<source media="(max-width:480px)" srcset="' + ART_MOBILE + '">' +
                  '<img class="sxg-adslot__art" src="' + ART + '" ' +
                    'alt="陆喜依 · 真实双休标杆品牌 · 点击进入天猫旗舰店">' +
                '</picture>' +
              '</div>' +
            '</a>' +
            '<div class="sxg-adslot__meta">' +
              '<img class="sxg-adslot__avatar" src="' + IMG + '" alt="陆喜依">' +
              '<a class="sxg-adslot__name" href="' + DETAIL + '" rel="noopener">陆喜依</a>' +
              '<span class="sxg-adslot__mark">公益展示</span>' +
              '<span class="sxg-adslot__tag">真实双休标杆品牌 · 站长指定 S 级</span>' +
              '<a class="sxg-adslot__cta" href="' + TMALL + '" target="_blank" rel="noopener">' +
                '点此进入天猫旗舰店，支持真实双休企业 →</a>' +
            '</div>' +
          '</div>' +
          /* 胖东来卡（⑬ 2026-11-27 修订，⑭ 2026-11-28 恢复上架）：
             劳动者态度与挂广告位的原因都在图里；整图 + CTA 点击一律 preventDefault
             打开居中弹窗，弹窗里给淘宝店与抖音主页两个真链接；品牌名与头像只链站内
             详情页。data-sxg-share 是弹窗交互的唯一接线点。 */
          (PDL_ON ? (
            '<div class="sxg-adslot__card sxg-adslot__card--pdl">' +
              '<a class="sxg-adslot__banner" data-sxg-share="pdl" href="#" ' +
                'aria-label="打开胖东来淘宝店与抖音主页入口">' +
                '<div class="sxg-adslot__art-wrap" data-art-error-text="胖东来 · 善待劳动者">' +
                  '<picture>' +
                    '<source media="(max-width:480px)" srcset="' + ART_PDL_MOBILE + '">' +
                    '<img class="sxg-adslot__art" src="' + ART_PDL + '" ' +
                      'alt="胖东来 · 善待劳动者 · 货车司机送货也能体会到尊重">' +
                  '</picture>' +
                '</div>' +
              '</a>' +
              '<div class="sxg-adslot__meta">' +
                '<img class="sxg-adslot__avatar" src="' + PDL_IMG + '" alt="胖东来">' +
                '<a class="sxg-adslot__name" href="' + PDL_DETAIL + '" rel="noopener">胖东来</a>' +
                '<span class="sxg-adslot__mark">公益展示</span>' +
                '<span class="sxg-adslot__tag">善待劳动者 · 货车司机送货也能体会到尊重</span>' +
                '<a class="sxg-adslot__cta" data-sxg-share="pdl" href="#">' +
                  '点此查看淘宝店与抖音 →</a>' +
              '</div>' +
            '</div>'
          ) : '') +
          /* 星巴克卡（⑭ 2026-11-28 站长：「新增一个星巴克的，挂一下腾讯应用宝的
             星巴克 App 下载页面。学 AD1 陆喜依，需要明确告知用户，点击会跳转到哪里，
             不要做那种一声不吭的」）：
             - 学 AD1：整图 + CTA 都是真 <a href>，点了直接跳目标页（新标签），
               不做弹窗二次确认（那是胖东来那套）。
             - 明确告知去向：可见文案三处写明落地页——海报 CTA 下方一行、
               卡片 meta 的说明行、aria-label；不只藏在 title 里。
             - 品牌名与头像只链站内 brand/starbucks.html。 */
          '<div class="sxg-adslot__card sxg-adslot__card--sbx">' +
            '<a class="sxg-adslot__banner" href="' + SBX_APP + '" target="_blank" rel="noopener" ' +
              'aria-label="前往腾讯应用宝，打开星巴克 App 官方下载页（新标签页打开）">' +
              '<div class="sxg-adslot__art-wrap" data-art-error-text="星巴克 · 官方 App 下载">' +
                '<picture>' +
                  '<source media="(max-width:480px)" srcset="' + ART_SBX_MOBILE + '">' +
                  '<img class="sxg-adslot__art" src="' + ART_SBX + '" ' +
                    'alt="星巴克 · 官方 App 下载 · 点击前往腾讯应用宝">' +
                '</picture>' +
              '</div>' +
            '</a>' +
            '<div class="sxg-adslot__meta">' +
              '<img class="sxg-adslot__avatar" src="' + SBX_IMG + '" alt="星巴克">' +
              '<a class="sxg-adslot__name" href="' + SBX_DETAIL + '" rel="noopener">星巴克</a>' +
              '<span class="sxg-adslot__mark">公益展示</span>' +
              '<span class="sxg-adslot__tag">A 级 · 真实双休率 98% · 官方 App</span>' +
              '<a class="sxg-adslot__cta" href="' + SBX_APP + '" target="_blank" rel="noopener">' +
                '点此前往腾讯应用宝下载星巴克 App（新标签页打开）→</a>' +
            '</div>' +
            /* 「点击会跳到哪里」独立成行、放在卡面显眼处：站长 2026-11-28
               「不要做那种一声不吭的」——落点写明白，不让人猜。 */
            '<div class="sxg-adslot__jump">点击整张广告图或上面这个按钮，将在新标签页打开' +
              '<a href="' + SBX_APP + '" target="_blank" rel="noopener">腾讯应用宝 · 星巴克 App 官方下载页</a>' +
              '（sj.qq.com）。</div>' +
          '</div>' +
          '<div class="sxg-adslot__card sxg-adslot__card--recruit">' +
            '<div class="sxg-adslot__art-wrap" data-art-error-text="公益广告位 · 虚位以待">' +
              '<picture>' +
                '<source media="(max-width:480px)" srcset="' + ART_RECRUIT_MOBILE + '">' +
                '<img class="sxg-adslot__art" src="' + ART_RECRUIT + '" ' +
                  'alt="公益广告位 · 虚位以待 · 真实双休标杆品牌可申请免费展示">' +
              '</picture>' +
            '</div>' +
            '<div class="sxg-adslot__meta">' +
              '<span class="sxg-adslot__tag">真实双休标杆品牌可申请免费展示 · 欢迎联系站长</span>' +
              '<span class="sxg-adslot__hint">左右箭头 / 圆点切换 · 自动轮播 5 秒</span>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="sxg-adslot__foot">' +
        '<button type="button" class="sxg-adslot__nav sxg-adslot__prev" aria-label="上一张">‹</button>' +
        '<div class="sxg-adslot__dots"></div>' +
        '<button type="button" class="sxg-adslot__nav sxg-adslot__next" aria-label="下一张">›</button>' +
      '</div>' +
      /* ⑭ 2026-11-28 站长：「同时广告页下方，也新增一行备注，排名不分先后」。
         标题栏已有一句「排名不分先后」，这里在卡面下方再加一条独立备注行——
         轮播有 4 张卡（上架先后不同），把「顺序不代表评级高低」写明，免得读者
         以为排在前面就等于本站推荐它。 */
      '<div class="sxg-adslot__ranknote">备注：以上广告位排名不分先后，上架顺序与本站给出的双休评级高低无关。</div>' +
      '<div class="sxg-adslot__disclaimer">公益广告位图片由 AI 绘制；企业信息全部由站长人工核实——线上自营、线下门店，只要有一条产线做不到双休，就上不了这一栏。核实结论来自站长亲自查证，不是联网搜一句「是否双休」得出的。想让自家企业上首页，请到 <a class="sxg-adslot__issue" href="https://github.com/dujeongil-galaxy/shuangxiugou/issues/new" target="_blank" rel="noopener">issue</a> 递交实证材料。<span class="sxg-adslot__scope">适用范围只到中国大陆的品牌与门店：这一栏盯的是自家门口的用工状况，先把身边的事改好，比给远方打分要紧。</span><span class="sxg-adslot__date">本政策自 2026 年 11 月起实行。</span></div>';
    initCarousel(root);
    // ⑬ 胖东来整图 + CTA 的「点击开居中弹窗」交互，只绑带 data-sxg-share 的两个 <a>
    bindShare(root);
    /* 图片缺失兜底（站长 2026-11-10「还不是纯文字吗」）：
       旧写法在 <img> 出错时直接 display:none，于是卡片只剩标题栏 + 一行字，
       看上去就是「纯文字广告位」——他在慢网下截到的正是这个状态。
       现在：广告设计图兜底成一个同色系海报底色 + 金字的「广告牌」，
       至少还是图；品牌头像才降级成文字（文字取 img alt，三张卡通用）。 */
    var imgs = root.querySelectorAll('img');
    for (var j = 0; j < imgs.length; j++) {
      (function (img) {
        img.addEventListener('error', function () {
          img.setAttribute('data-adslot-img-error', '1');
          img.style.display = 'none';
          /* 海报 img 现在包在 <picture> 里，父节点不再是 art-wrap；
             closest 才能拿到真正要降级的容器（否则图片失败兜底会静默失效）。 */
          var wrap = img.closest ? img.closest('.sxg-adslot__art-wrap') : img.parentNode;
          if (wrap && wrap.className && wrap.className.indexOf('sxg-adslot__art-wrap') !== -1) {
            wrap.setAttribute('data-art-error', '1');
            if (!wrap.getAttribute('data-art-error-text')) {
              wrap.setAttribute('data-art-error-text', '公益广告位');
            }
          }
          if (img.className.indexOf('sxg-adslot__avatar') !== -1) {
            var span = document.createElement('span');
            span.className = 'sxg-adslot__name';
            span.textContent = img.getAttribute('alt') || '公益展示';
            if (img.parentNode) img.parentNode.insertBefore(span, img.nextSibling);
          }
        });
      })(imgs[j]);
    }
    return root;
  }

  /* 手机端悬浮圆钮避让（站长 2026-11-10 23:40「新建的公益广告位，都穿模了」）：
     真渲染量出两个 z-index:9000 的 fixed 悬浮按钮与广告位卡片边界相交约 47×46，
     被 z-index:9995 的卡片切掉一半，看着就是「半个圆贴在卡片边上」。
     广告位进入视口时只把几何相交的那几个临时隐藏、离开立刻恢复；
     不碰首次访问提醒弹窗（z-index 100000），也不改站内任何交互逻辑。 */
  function keepClear(root) {
    if (typeof IntersectionObserver === 'undefined' || !document.body ||
        !window.matchMedia || !window.matchMedia('(max-width:480px)').matches) return;
    var avoided = [];
    function restore() {
      for (var i = 0; i < avoided.length; i++) {
        avoided[i].removeAttribute('data-sxg-adslot-avoid');
      }
      avoided = [];
    }
    function scan(active) {
      restore();
      var html = document.documentElement;
      if (!active) { html.classList.remove('sxg-adslot-near'); return; }
      html.classList.add('sxg-adslot-near');
      var sr = root.getBoundingClientRect();
      var nodes = document.body.querySelectorAll('*');
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        if (root.contains(n) || n.contains(root)) continue;
        var s = getComputedStyle(n);
        if (!s || (s.position !== 'fixed' && s.position !== 'absolute')) continue;
        // 排除全站固定的 frosted 闪屏遮罩：它 z-index=8000 落在本函数
        // [1000,9995) 的避让区间内，但它是「搜索删空整屏模糊」的覆盖层，
        // 必须盖在所有内容（含广告位）之上。若误把它当悬浮钮隐藏，整页磨砂
        // 会破洞、广告位穿透露出尖角（站长 2026-11-11 报障）。按 id 精确排除。
        if (n.id === 'sxg-flash-mask') continue;
        var z = parseInt(s.zIndex, 10);
        if (!(z >= 1000 && z < 9995)) continue;
        var r = n.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;
        var ox = Math.min(sr.right, r.right) - Math.max(sr.left, r.left);
        var oy = Math.min(sr.bottom, r.bottom) - Math.max(sr.top, r.top);
        if (ox > 4 && oy > 4) {
          n.setAttribute('data-sxg-adslot-avoid', '1');
          avoided.push(n);
        }
      }
    }
    var io = new IntersectionObserver(function (entries) {
      scan(entries[0].isIntersecting);
    }, { threshold: 0 });
    io.observe(root);
    // React 异步渲染的悬浮按钮可能晚于首次观察，3 秒后按当前可见性补扫一次
    setTimeout(function () {
      var r = root.getBoundingClientRect();
      scan(r.bottom > 0 && r.top < window.innerHeight);
    }, 3000);
  }

  function initCarousel(root) {
    var track = root.querySelector('.sxg-adslot__track');
    var cards = root.querySelectorAll('.sxg-adslot__card');
    var dotsWrap = root.querySelector('.sxg-adslot__dots');
    var prevBtn = root.querySelector('.sxg-adslot__prev');
    var nextBtn = root.querySelector('.sxg-adslot__next');
    var viewport = root.querySelector('.sxg-adslot__viewport');
    var n = cards.length;
    var cur = 0;
    var timer = null;

    var dots = [];
    for (var i = 0; i < n; i++) {
      (function (idx) {
        var d = document.createElement('span');
        d.className = 'sxg-adslot__dot' + (idx === 0 ? ' is-active' : '');
        d.addEventListener('click', function () { go(idx); });
        dotsWrap.appendChild(d);
        dots.push(d);
      })(i);
    }

    function render() {
      track.style.transform = 'translateX(' + (-cur * 100) + '%)';
      for (var k = 0; k < dots.length; k++) {
        if (k === cur) dots[k].classList.add('is-active');
        else dots[k].classList.remove('is-active');
      }
    }
    function go(i) {
      cur = (i % n + n) % n;
      render();
      restart();
    }
    function next() { go(cur + 1); }
    function prev() { go(cur - 1); }
    function restart() {
      if (timer) clearInterval(timer);
      timer = setInterval(next, AUTOPLAY_MS);
    }

    nextBtn.addEventListener('click', next);
    prevBtn.addEventListener('click', prev);
    viewport.addEventListener('mouseenter', function () { if (timer) clearInterval(timer); });
    viewport.addEventListener('mouseleave', restart);

    render();
    restart();
  }

  // 找到黑卡就把它换成滚动式公益广告位；已换过的（锚点文字消失）自动跳过
  function transformCard() {
    var nodes = document.querySelectorAll('div');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var cls = (el.className || '');
      if (typeof cls === 'string' &&
          cls.indexOf('bg-slate-900') !== -1 &&
          el.textContent &&
          el.textContent.indexOf(SIG) !== -1) {
        var slot = buildSlot();
        if (el.parentNode) {
          el.parentNode.replaceChild(slot, el);
        } else {
          el.replaceWith(slot);
        }
        // 只在替换进 DOM 之后才观察，IntersectionObserver 才拿得到真实包围盒
        keepClear(slot);
        return true;
      }
    }
    return false;
  }

  // 廉价守卫：整页还含锚点时才动手，避免每次 mutation 都全量扫描
  function maybeTransform() {
    if (document.body && document.body.innerHTML.indexOf(SIG) !== -1) {
      transformCard();
    }
  }

  injectStyle();

  // ① 立即试一次 + 异步渲染后多次兜底
  transformCard();
  setTimeout(transformCard, 500);
  setTimeout(transformCard, 1500);
  setTimeout(transformCard, 3000);
  setTimeout(transformCard, 5000);

  // ② 持续 60 秒每秒兜底，覆盖任何延迟渲染 / 重渲染
  var iv = setInterval(maybeTransform, 1000);
  setTimeout(function () { clearInterval(iv); }, 60000);

  // ③ MutationObserver：DOM 增删或文字回填（characterData）出现锚点立即再换
  if (typeof MutationObserver !== 'undefined') {
    var mo = new MutationObserver(maybeTransform);
    mo.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }
})();
