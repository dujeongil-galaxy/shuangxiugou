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
 *  ④ 失效的抖音短链不写进卡片，也不写进任何外链；随笔只引用章节号，不抄口述原话。
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
  // 悬赏 50 万–500 万征集「黑公关」线索。站长原话入框。外链不进卡面（§30e 口径），
  // 抖音视频链接落在详情页证据来源与首页公示区（站规：备注栏内容同步证据链）。
  var LEGAL_TITLE = '⚑ 站长点评 · 法务部悬赏征集「黑公关」线索（2026-11-13）';
  var LEGAL_P1 = '2026-11-11 澎湃新闻刚报道多位车主投诉比亚迪「唐」前后轮毂装反（本页公示区在册），11-13 法务部即发文：为打击网络黑公关乱象，对通过 MCN 等有组织、有策划抹黑比亚迪的线索，一经查实给予 50 万元至 500 万元奖励。';
  var LEGAL_P2 = '站长原话：「你大唐刚出事，你就开始发动法务部技能，那你确实很牛逼了。」——本条为站长主观点评，仅登记可核查事实（法务部发文）与公开报道（澎湃），不作事实认定；抖音视频线索（红V账号）已按站规同步登记进详情页证据链。';
  var LEGAL_HREF = './brand/byd.html';
  var LEGAL_LINK_TEXT = '查看证据链与视频链接';

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

    var link = makePara('');
    var a = document.createElement('a');
    a.setAttribute('href', LEGAL_HREF);
    a.setAttribute('style', 'color:#b45309;font-weight:700;text-decoration:underline');
    a.textContent = LEGAL_LINK_TEXT;
    link.appendChild(a);
    box.appendChild(link);
    return box;
  }

  function patchCard(card) {
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
