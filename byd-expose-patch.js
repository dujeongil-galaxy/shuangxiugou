#!/usr/bin/env node
/**
 * 比亚迪卡片「直营门店强制加班曝光」登记补丁（byd-expose-patch.js）
 *
 * 站长 2026-11-09 提供线索：抖音账号「BYD直营员工维权」的作品指称某直营门店
 * 店长要求员工强制加班至晚十点，发布者援引《劳动法》第九十六条作为维权依据；
 * 要求登记到比亚迪卡片、公开曝光，并注明「详见站长随笔第10章」。
 * 2026-11-10 站长补正：视频已被删除、原链接已经挂了，发布者受到了某种压力，
 * 要求直接如实登记、不再把失效链接当可点来源。
 *
 * 为什么单独写脚本：BYD 是内置卡，数据在压缩 bundle
 * （assets/index-YthXZ9eP.js）里，按仓库铁律**不能改 bundle**。
 * 本脚本在渲染后的 DOM 上给 BYD 卡插一条红框曝光登记，bundle 零改动。
 * 写法与 luckin-note-patch.js / rate-note-patch.js 同构：
 * 幂等标记 + requestAnimationFrame 合帧 + MutationObserver 兜底 React 重渲染
 * （搜索、评级筛选都会重建卡片）。
 *
 * 口径：
 *  ① 按标题「BYD (比亚迪)」定位卡片，向上找 .bg-white.rounded-2xl.border 根节点；
 *  ② 曝光框插在标题行之后、工时政策栏之前，保证一眼可见；
 *  ③ 只写线索与已发生的事实（视频已删、链接失效），不对指称内容作事实认定；
 *  ④ 失效的抖音短链不写进卡片；2026-11-13 站长指令后，卡面备注栏**只挂一条**当日抖音
 *     短链（rel="nofollow noopener" target="_blank"），其余外链仍不进卡面；
 *     随笔只引用章节号，不抄口述原话；
 *  ⑤ 卡面标签区把比亚迪旗下子品牌全部写完（王朝网/海洋网/腾势/方程豹/仰望/弗迪/比亚迪电子）。
 */
(function () {
  var TITLE = '⚠️ 直营门店强制加班曝光（员工／社群反馈）';
  var P1 = '抖音账号「BYD直营员工维权」曾发布视频指称：某 BYD 直营门店店长要求员工强制加班至晚十点；发布者援引《劳动法》第九十六条（以暴力、威胁或者非法限制人身自由的手段强迫劳动，以及侮辱、体罚、殴打、非法搜查和拘禁劳动者的处罚规定）作为维权依据。';
  var P2 = '该视频现已删除、原链接已失效；站长判断发布者受到了某种压力，本站无从核实，也不作进一步推断。视频本体无法回看，这一条只按线索如实登记，不对指称内容作事实认定。';
  var P3_PREFIX = '相关经历详见';
  var NOTES_HREF = './notes.html';
  var NOTES_TEXT = '《站长随笔》第10章';

  // 2026-11-13 站长第二条首页备注（卡面第二只框，琥珀色区分）：
  // 「给比亚迪的证据链加备注……你大唐刚出事，你就开始发动法务部技能」。
  // 事实：11-11 澎湃报道车主投诉「唐」前后轮毂装反（公示区在册）；11-13 法务部发文
  // 悬赏 50 万–500 万征集「黑公关」线索。站长原话入框。
  //
  // 2026-11-13 站长第三条指令（口径变更）：卡面备注栏里的链接**直接挂当天那条抖音短链**，
  // 原 11-13 那条旧短链（NrP3UMT8Y-4）作废不再使用；框里只挂链接与子品牌，不作推广。
  // 旧口径（备注栏零外链、外链只落详情页/公示区）自此按站长本次指令放开：**仅此一条**，
  // 且必须 rel="nofollow noopener" + target="_blank"，其余卡片仍执行零外链（§30e 已按此收窄）。
  var LEGAL_TITLE = '⚑ 站长点评 · 法务部悬赏征集「黑公关」线索（2026-11-13）';
  var LEGAL_P1 = '2026-11-11 澎湃新闻刚报道多位车主投诉比亚迪「唐」前后轮毂装反（本页公示区在册），11-13 法务部即发文：为打击网络黑公关乱象，对通过 MCN 等有组织、有策划抹黑比亚迪的线索，一经查实给予 50 万元至 500 万元奖励。';
  var LEGAL_P2 = '站长原话：「你大唐刚出事，你就开始发动法务部技能，那你确实很牛逼了。」——本条为站长主观点评，仅登记可核查事实（法务部发文）与公开报道（澎湃），不作事实认定；抖音视频线索已按站规同步登记进详情页证据链与首页公示区。';
  var LEGAL_P3 = '抖音视频（站长 2026-11-13 提供，5 秒短视频）：文案「摊牌了！彻底撕开了网络黑公关的遮羞布」「花五百万找『说它坏话的人』，评论区第一句话却是：这钱不如改善食堂。」话题 #比亚迪 #MCN #公司。本站只挂线索、不作推广，视频内容未核实。';
  var LEGAL_HREF = 'https://v.douyin.com/3oI-7tZ12R8/';
  var LEGAL_LINK_TEXT = '打开抖音看这条 5 秒短视频 → v.douyin.com/3oI-7tZ12R8';

  // 2026-11-13 站长第四条指令：卡面标签区（截图里只有「秦/汉/海鸥电动车 / 车载储能 /
  // 汽车周边」）要把比亚迪旗下子品牌**全部写完**。
  // 归属口径：王朝网（秦·汉·唐·宋·元）、海洋网（海鸥/海豚/海豹/驱逐舰/护卫舰）为自营
  // 产品线；腾势 DENZA、方程豹、仰望为全资子品牌；弗迪电池（弗迪系）、比亚迪电子为集团
  // 全资子公司；车载储能/汽车周边为在售业务线。标签是 bundle 渲染出来的 span，
  // bundle 不能改 → 就地改写这一行（首项替换 + 追加），幂等靠文本判断，不新增 data 标记。
  var BRANDS = ['王朝网 · 秦/汉/唐/宋/元', '海洋网 · 海鸥/海豚/海豹/驱逐舰/护卫舰',
    '腾势 DENZA（全资）', '方程豹（全资）', '仰望 YANGWANG（全资）',
    '弗迪电池（弗迪系）', '比亚迪电子', '车载储能', '汽车周边'];
  var BRANDS_ORIGIN = '秦/汉/海鸥电动车';

  var BOX_STYLE = 'margin:2px 0 0;padding:10px 12px;border:1px solid #fecaca;' +
    'border-left:4px solid #dc2626;border-radius:10px;background:#fef2f2;' +
    'color:#991b1b;font-size:12.5px;line-height:1.75';
  var TITLE_STYLE = 'font-weight:800;font-size:13px;color:#b91c1c;margin:0 0 4px';
  var P_STYLE = 'margin:3px 0 0';
  var LINK_STYLE = 'color:#b91c1c;font-weight:700;text-decoration:underline';

  function isCardRoot(el) {
    return !!(el && el.classList && el.classList.contains('bg-white')
      && el.classList.contains('rounded-2xl') && el.classList.contains('border'));
  }

  /** 按标题找 BYD 卡：h2/h3 可能被别的补丁改写，两种都认。 */
  function findBydCard() {
    var hs = document.querySelectorAll('h2, h3');
    for (var i = 0; i < hs.length; i++) {
      var t = (hs[i].textContent || '').trim();
      if (!/^BYD\s*\(比亚迪\)/.test(t)) continue;
      var cur = hs[i].parentElement;
      for (var d = 0; cur && d < 8 && cur !== document.body; d++) {
        if (isCardRoot(cur)) return cur;
        cur = cur.parentElement;
      }
    }
    return null;
  }

  function makePara(text) {
    var p = document.createElement('p');
    p.setAttribute('style', P_STYLE);
    p.textContent = text;
    return p;
  }

  function buildBox() {
    var box = document.createElement('div');
    box.setAttribute('data-byd-expose', '1');
    box.setAttribute('style', BOX_STYLE);

    var head = document.createElement('div');
    head.setAttribute('style', TITLE_STYLE);
    head.textContent = TITLE;
    box.appendChild(head);

    box.appendChild(makePara(P1));
    box.appendChild(makePara(P2));

    var last = makePara(P3_PREFIX);
    var a = document.createElement('a');
    a.setAttribute('href', NOTES_HREF);
    a.setAttribute('style', LINK_STYLE);
    a.textContent = NOTES_TEXT;
    last.appendChild(a);
    last.appendChild(document.createTextNode('。'));
    box.appendChild(last);
    return box;
  }

  /* 2026-11-13 第二只框（琥珀色·站长点评）：法务部悬赏 + 站长原话。
     与红色曝光框共用 data-byd-exose 幂等标记（同一容器一次插入两只框），
     不新增标记 → 无需登记克隆剥离表。 */
  function buildLegalBox() {
    var box = document.createElement('div');
    box.setAttribute('data-byd-expose', '1');
    box.setAttribute('style', 'margin:6px 0 0;padding:10px 12px;border:1px solid #fde68a;' +
      'border-left:4px solid #d97706;border-radius:10px;background:#fffbeb;' +
      'color:#92400e;font-size:12.5px;line-height:1.75');

    var head = document.createElement('div');
    head.setAttribute('style', 'font-weight:800;font-size:13px;color:#b45309;margin:0 0 4px');
    head.textContent = LEGAL_TITLE;
    box.appendChild(head);

    box.appendChild(makePara(LEGAL_P1));
    box.appendChild(makePara(LEGAL_P2));
    box.appendChild(makePara(LEGAL_P3));

    var link = makePara('');
    var a = document.createElement('a');
    a.setAttribute('href', LEGAL_HREF);
    a.setAttribute('rel', 'nofollow noopener');
    a.setAttribute('target', '_blank');
    a.setAttribute('style', 'color:#b45309;font-weight:700;text-decoration:underline');
    a.textContent = LEGAL_LINK_TEXT;
    link.appendChild(a);
    box.appendChild(link);
    return box;
  }

  /* 标签区补全：把 bundle 渲染的「秦/汉/海鸥电动车」改写成完整子品牌清单。
     只动这一个 span（首项改名 + 追加同级 span），同行的其他标签（车载储能/汽车周边等）
     保持原样；幂等判断看第二项是否已在行内。 */
  function patchBrandTags(card) {
    var spans = card.querySelectorAll('span');
    var origin = null;
    for (var i = 0; i < spans.length; i++) {
      if ((spans[i].textContent || '').trim() === BRANDS_ORIGIN) { origin = spans[i]; break; }
    }
    if (!origin) return false;
    var row = origin.parentElement;
    if (!row) return false;
    for (var k = 1; k < row.children.length; k++) {
      if ((row.children[k].textContent || '').trim() === BRANDS[1]) return true; // 已写过
    }
    origin.textContent = BRANDS[0];
    var proto = origin.cloneNode(false);
    for (var j = 1; j < BRANDS.length; j++) {
      // bundle 里本来就有「车载储能」「汽车周边」两个 span，别追加成重复项
      var dup = false;
      for (var m = 0; m < row.children.length; m++) {
        if ((row.children[m].textContent || '').trim() === BRANDS[j]) { dup = true; break; }
      }
      if (dup) continue;
      var s = proto.cloneNode(false);
      s.textContent = BRANDS[j];
      row.appendChild(s);
    }
    return true;
  }

  function patchCard(card) {
    // 标签补全与框独立：先补标签（自身幂等），再判框是否已插
    try { patchBrandTags(card); } catch (e) {
      console.error('[双休购] 比亚迪子品牌标签补全失败：', e);
    }
    if (card.querySelector('[data-byd-expose]')) return true; // 幂等
    var inner = card.querySelector('div.p-5.space-y-3\\.5');
    var host = inner || card;
    var anchor = inner && inner.children.length > 1 ? inner.children[1] : null;
    try {
      // 2026-11-13 起一次插两只框（红色曝光登记 + 琥珀色站长点评）
      var frag = document.createDocumentFragment();
      frag.appendChild(buildBox());
      frag.appendChild(buildLegalBox());
      if (anchor) host.insertBefore(frag, anchor);
      else host.appendChild(frag);
    } catch (e) {
      console.error('[双休购] 比亚迪曝光登记插入失败：', e);
      return false;
    }
    return true;
  }

  function patchOnce() {
    var card = findBydCard();
    if (!card) return;
    try { patchCard(card); } catch (e) {
      console.error('[双休购] 比亚迪曝光登记补丁执行失败：', e);
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
    console.error('[双休购] 比亚迪曝光登记监听失败：', e);
  }
})();
