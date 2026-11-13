#!/usr/bin/env node
/**
 * 品牌卡「新闻事件登记」补丁（news-incident-patch.js）
 *
 * 站长 2026-11-10 指令：「关于罗技辱骂消费者事件，需要在卡片中进行说明」；
 * 「常州星宇股份后续事件，网络上应该有报道吧，说的是遭到了报应，也请记载」；
 * 「我们需要吃新闻的流量来曝光网站」。
 *
 * 为什么单独写脚本：这两张都是内置卡，数据在压缩 bundle
 * （assets/index-YthXZ9eP.js）里，按仓库铁律**不能改 bundle**。
 * 本脚本在渲染后的 DOM 上按标题定位卡片并插入登记框；写法与
 * byd-expose-patch.js / luckin-note-patch.js 同构：幂等标记 +
 * requestAnimationFrame 合帧 + MutationObserver 兜底 React 重渲染
 * （搜索、评级筛选都会重建卡片）。
 *
 * 口径（站长是 INTJ，文案只给可核查的事实链，不煽情、不抄口述原话）：
 *  ① 罗技是 A 级（合规双休），这条是品牌营销／消费者关系争议，
 *     **与工时、双休数据无关，不据此调整评级**，卡片里必须写清；
 *  ② 星宇「遭到报应」是站长的口语判断，本站不作因果认定，只按公开报道
 *     登记后续进展：官方通报 → 致歉 → 二次道歉 → 内部处罚 → 下游车企
 *     供应链调查 → 港股上市节奏受影响；并写明客户调查／交易所核查
 *     不等于认定企业违规、官方通报亦未认定违法解除；
 *  ③ 卡片不放任何外链，原始报道链接统一放详情页与首页公示区（可被搜索引擎收录，
 *     这才是「吃新闻流量」的正确落点）；卡片只链站内详情页。
 *  ④ 事实来自中国经济网／光明网／中新经纬／南方+／中国新闻周刊／
 *     封面新闻／中国能源网等公开报道，日期与主体逐条对齐，不编造、不夸大。
 *
 * 2026-11-10 全站检查补记（站长：「让你写一个常州星宇，你把所有自定义卡片
 * 都写了？」「罗技的也是，到处乱飞」）：
 *   自定义卡是 index.html 用 templateCard.cloneNode(true) 从内置卡克隆的，
 *   A 级模板 = 罗技卡、C 级模板 = 星宇卡，于是本补丁插在模板上的登记框被
 *   整块复制进了 103 张无关自定义卡。两层修复：
 *     ① 克隆侧（根本）：index.html 克隆后统一剥离所有品牌专属注入节点；
 *     ② 本补丁侧（自愈兜底）：每次运行都按「卡片标题归属」清理——
 *        凡是标题不匹配的卡里的登记框一律删除，只在自己的卡上保留一份。
 *   只插不清是这类补丁的通病：DOM 节点被复用／克隆后，补丁留在旧节点上，
 *   内容就跟着别的品牌跑了。verify §34b 钉死这段自愈逻辑。
 */
(function () {
  'use strict';

  var ITEMS = [
    {
      key: 'logitech',
      title: /^Logitech\s*\(罗技\)/,
      head: '⚠️ 品牌行为登记 · 授权店铺侮辱消费者广告（2026-03-26）',
      paras: [
        '抖音「罗技G官方旗舰店」发布产品推广视频，配文把降价后回购的消费者比作狗，引发大量质疑。罗技中国当晚发布声明致歉，称该店由授权运营商上海百事得电子有限公司运营、系其员工跳过品牌方营销审核流程擅自发布；运营方同时致歉，说明视频已永久删除、团队已被严肃处理。',
        '这属于品牌营销与消费者关系争议，与工时、双休数据无关，本站不据此调整 A 级评级，仅按公开报道如实登记。'
      ],
      href: './brand/logitech.html',
      linkText: '查看证据与原始报道链接',
      tone: 'blue'
    },
    {
      key: 'xingyu',
      title: /^常州星宇股份/,
      head: '⚠️ 后续进展登记 · 应届生解约事件（2026-08 至 09）',
      paras: [
        '常州市人社局 8 月 25 日通报后，企业 8 月 27 日致歉并承诺求职生活补贴，9 月 2 日业绩说明会上董事长再次道歉、称将整改用工制度。据媒体报道，9 月 6 日公司内部下发处罚决定（总经理扣薪 12 个月、分管副总扣薪 6 个月并调整分工、人力资源负责人免职）；奔驰、大众、宝马等下游车企先后受理举报或启动供应链用工调查；港股上市进程亦因投诉核查受到影响。',
        '以上均为公开报道的后续进展。客户调查与交易所核查不等于认定企业违规，官方通报亦未认定违法解除；本站不作因果推断，只登记可核查的事件链。'
      ],
      href: './brand/xingyu.html',
      linkText: '查看证据与原始报道链接',
      tone: 'red'
    },
    {
      key: 'geely',
      title: /^吉利汽车/,
      head: '⚠️ 最新事件 · 银河星舰7 车机芯片口径（2026-10-31）',
      paras: [
        '2026-10-31 吉利银河发布《关于2025款银河星舰7车机芯片的说明》，首次以官方口径承认 2025 款星舰7 全系搭载亿咖通 E02 座舱平台，而非上市前后宣传的「龙鹰一号」（内部代号 E04）；官方解释称搭载 E04 的版型因辅助驾驶体验未达预期，推迟至 2025 年四季度随新年款上市，并就「技术传播和产品传播的节奏不同」致歉。',
        '随致歉公布：自 2026-11-15 起，2025 款星舰7 首任车主车机相关部件额外延保 5 年，另附 10000 元本品置换尾款抵扣券与 3000 元集团通用置换／增购券；车主关心的 E02 升级 E04 仍在「专项技术评估」，尚无结论。',
        '该事件属产品宣传与消费者权益争议，与工时、双休数据无关，本站不据此调整 C 级评级，仅按公开报道如实登记。'
      ],
      href: './brand/geely.html',
      linkText: '查看证据与原始报道链接',
      tone: 'red'
    },
    {
      key: 'lixiang',
      title: /^理想汽车/,
      head: '⚠️ 最新事件 · 新一代 MEGA 降价上市与老用户权益（2026-09-02）',
      paras: [
        '2026-09-02 新一代理想 MEGA 上市，仅提供 Home 一个版本，全国统一零售价 50.98 万元；上一代 MEGA Home 家庭特别版（2025-04-23）官方指导价 55.98 万元，两代同名义版本官方指导价相差 5 万元。',
        '同代硬件为换代级增配：标配线控转向与后轮转向（转弯半径 6.2→5.5 米）、800V 主动防倾魔毯底盘、骁龙 8797 座舱、双马赫 M100 芯片与四颗激光雷达。老用户可查权益仅「理想汽车用户复购赠 15,000 元后舱 270° 电动调光玻璃」，公开材料未见现金补偿或免费硬件升级。',
        '该事件属产品定价与老用户权益争议，与工时、双休数据无关，本站不据此调整 B 级评级，仅按公开报道如实登记。'
      ],
      href: './brand/lixiang.html',
      linkText: '查看证据与原始报道链接',
      tone: 'blue'
    },
    {
      key: 'chery',
      title: /^奇瑞汽车/,
      head: '⚑ 站长备注 · 冒充招聘声明与「周六奋斗日」（2026-11-13）',
      paras: [
        '站长两条抖音线索：① 奇瑞法务部发声明称「这场招聘跟奇瑞没关系」——有人冒充奇瑞员工和供应商、伪造材料，在河南工学院等高校拉群招聘，已经报警；② 同校同期流传校招现场视频「江山代有才人出」。两条视频原始链接已按站规（备注栏内容同步证据链，2026-11-13 新规）登记进详情页证据来源。',
        '站长点评：本卡 C 级的核心证据是 2023-03 财联社曝光的高管内部邮件——「周六是奋斗者的正常工作日」「请想办法（规避法律风险）」。法务部忙着撇清山寨招聘，邮件里那个「周六奋斗日」倒是没人否认。'
      ],
      href: './brand/chery.html',
      linkText: '查看证据链与原始视频链接',
      tone: 'red'
    }
  ];

  var MARK = 'data-sxg-news';

  var TONES = {
    blue: {
      box: 'margin:2px 0 0;padding:10px 12px;border:1px solid #bfdbfe;' +
        'border-left:4px solid #2563eb;border-radius:10px;background:#eff6ff;' +
        'color:#1e3a8a;font-size:12.5px;line-height:1.75',
      head: 'font-weight:800;font-size:13px;color:#1d4ed8;margin:0 0 4px',
      link: 'color:#1d4ed8;font-weight:700;text-decoration:underline'
    },
    red: {
      box: 'margin:2px 0 0;padding:10px 12px;border:1px solid #fecaca;' +
        'border-left:4px solid #dc2626;border-radius:10px;background:#fef2f2;' +
        'color:#991b1b;font-size:12.5px;line-height:1.75',
      head: 'font-weight:800;font-size:13px;color:#b91c1c;margin:0 0 4px',
      link: 'color:#b91c1c;font-weight:700;text-decoration:underline'
    }
  };

  function isCardRoot(el) {
    return !!(el && el.classList && el.classList.contains('bg-white')
      && el.classList.contains('rounded-2xl') && el.classList.contains('border'));
  }

  /** 按标题找卡：h2/h3 都可能被别的补丁改写，两种都认。 */
  function findCard(re) {
    var hs = document.querySelectorAll('h2, h3');
    for (var i = 0; i < hs.length; i++) {
      var t = (hs[i].textContent || '').trim();
      if (!re.test(t)) continue;
      var cur = hs[i].parentElement;
      for (var d = 0; cur && d < 8 && cur !== document.body; d++) {
        if (isCardRoot(cur)) return cur;
        cur = cur.parentElement;
      }
    }
    return null;
  }

  /** 从任意注入节点向上找到它所在的卡片根（与 findCard 同一套判据）。 */
  function cardRootOf(el) {
    var cur = el && el.parentElement;
    for (var d = 0; cur && d < 8 && cur !== document.body; d++) {
      if (isCardRoot(cur)) return cur;
      cur = cur.parentElement;
    }
    return null;
  }

  /** 卡片自己的品牌标题（自定义卡克隆后 h2/h3 会被改成新品牌名）。 */
  function cardTitle(card) {
    var h = card && card.querySelector('h2, h3');
    return h ? (h.textContent || '').trim() : '';
  }

  /**
   * 品牌绑定自愈：只准在自己的卡上留登记框。
   * 克隆模板 / React 复用 DOM 节点时，本补丁插进去的框会跟着节点跑到
   * 别的品牌下（这次 65 个罗技框 + 40 个星宇框就是这么来的）。每轮先清后插，
   * 挂错卡的框一律删除；找不到卡片根的孤儿节点也删。
   */
  function cleanupMisplaced(item) {
    var boxes = document.querySelectorAll('[' + MARK + '="' + item.key + '"]');
    for (var i = 0; i < boxes.length; i++) {
      var box = boxes[i];
      var card = cardRootOf(box);
      if (!card || !item.title.test(cardTitle(card))) {
        if (box.parentNode) box.parentNode.removeChild(box);
      }
    }
  }

  /** 同一张卡上历史残留的重复框只留一份（幂等的补强）。 */
  function dedupeOn(card, item) {
    var boxes = card.querySelectorAll('[' + MARK + '="' + item.key + '"]');
    for (var i = boxes.length - 1; i > 0; i--) {
      if (boxes[i].parentNode) boxes[i].parentNode.removeChild(boxes[i]);
    }
  }

  function buildBox(item) {
    var style = TONES[item.tone] || TONES.blue;
    var box = document.createElement('div');
    box.setAttribute('data-sxg-news', item.key);
    box.setAttribute('style', style.box);

    var head = document.createElement('div');
    head.setAttribute('style', style.head);
    head.textContent = item.head;
    box.appendChild(head);

    for (var i = 0; i < item.paras.length; i++) {
      var p = document.createElement('p');
      p.setAttribute('style', 'margin:3px 0 0');
      p.textContent = item.paras[i];
      box.appendChild(p);
    }

    var last = document.createElement('p');
    last.setAttribute('style', 'margin:5px 0 0');
    var a = document.createElement('a');
    a.setAttribute('href', item.href);
    a.setAttribute('style', style.link);
    a.textContent = item.linkText;
    last.appendChild(a);
    last.appendChild(document.createTextNode(' →'));
    box.appendChild(last);
    return box;
  }

  function patchCard(card, item) {
    if (card.querySelector('[' + MARK + '="' + item.key + '"]')) return true; // 幂等
    var inner = card.querySelector('div.p-5.space-y-3\\.5');
    var host = inner || card;
    var anchor = inner && inner.children.length > 1 ? inner.children[1] : null;
    try {
      if (anchor) host.insertBefore(buildBox(item), anchor);
      else host.appendChild(buildBox(item));
    } catch (e) {
      console.error('[双休购] 新闻事件登记插入失败：', item.key, e);
      return false;
    }
    return true;
  }

  function patchOnce() {
    for (var i = 0; i < ITEMS.length; i++) {
      var item = ITEMS[i];
      try { cleanupMisplaced(item); } catch (e) {
        console.error('[双休购] 新闻事件登记清理失败：', item.key, e);
      }
      var card = findCard(item.title);
      if (card) {
        try {
          dedupeOn(card, item);
          patchCard(card, item);
        } catch (e) {
          console.error('[双休购] 新闻事件登记补丁执行失败：', item.key, e);
        }
      }
    }
  }

  var scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(function () {
      scheduled = false;
      patchOnce();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', schedule);
  } else {
    schedule();
  }
  try {
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  } catch (e) {
    console.error('[双休购] 新闻事件登记监听失败：', e);
  }
})();
