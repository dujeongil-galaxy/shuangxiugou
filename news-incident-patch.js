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
    }
  ];

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
    if (card.querySelector('[data-sxg-news="' + item.key + '"]')) return true; // 幂等
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
      var card = findCard(item.title);
      if (card) {
        try { patchCard(card, item); } catch (e) {
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
