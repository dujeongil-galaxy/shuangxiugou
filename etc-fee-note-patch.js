#!/usr/bin/env node
/**
 * 车企品牌卡的「车外费用」备注（etc-fee-note-patch.js）
 *
 * 用途：给站内的新能源车品牌卡统一加一条备注，指向站长的另一个项目
 * 「各车企 ETC / 城市 NOA / 附加费用对比」。买车的人除了看双休，还要看车外要掏的钱：
 * 内置 ETC 开通费、城市 NOA 是一次性买断还是按月订阅、座椅加热等附加费用。
 *
 * 为什么走 DOM 层：品牌卡分内置与自定义两种，内置卡数据打包在
 * assets/index-YthXZ9eP.js 里，仓库铁律是不改 bundle；统一在渲染后的 DOM 上
 * 追加备注，bundle 零改动。
 *
 * 目标卡（标题文本取自卡面 h2/h3）：
 *   小米汽车 / 问界（赛力斯） / 极氪 / BYD (比亚迪) / 理想汽车 /
 *   蔚来 / 小鹏汽车 / 零跑汽车
 * 「小米」集团卡不在列——那个站讲的是车，不是手机与 IoT。
 * 比亚迪是内置卡，卡面标题写作「BYD (比亚迪)」。
 *
 * 三个已知坑（PITFALLS 1.10，与星巴克/苹果公告框同源）：
 *   bug ① 错位：备注框必须挂在**目标卡内部**，卡被换掉时框跟着走；
 *              绝不能挂在 #root 上，否则会漏进别的卡里。
 *   bug ③ 空面板残留：搜索过滤掉所有卡时，备注随卡一起卸载，不留孤儿节点。
 *   bug ④ 命中时被误摘：搜索命中目标卡时备注必须还在，因此本脚本
 *              不注册任何「清理非命中卡」的逻辑，只做幂等追加。
 *
 * 幂等：加过的卡打 data-sxg-etc-fee-note 标记；
 * MutationObserver 兜底 React 重建卡片（搜索/筛选会重建卡片节点）。
 */
(function () {
  'use strict';

  var LINK = 'https://dujeongil-galaxy.github.io/etc-fee-comparison/';
  var TEXT_HEAD =
    '准备买这台车？先算清车外要掏的钱：内置 ETC 开通费、城市 NOA 是买断还是按月订阅、座椅加热等附加费用 → ';
  var LINK_TEXT = '各车企 ETC / 城市 NOA 费用对比 ↗';

  // 标题前缀匹配，顺序无关。
  var TARGETS = [
    { key: 'xiaomi-auto', re: /^小米汽车/ },
    { key: 'wenjie', re: /^问界/ },
    { key: 'jike', re: /^极氪/ },
    { key: 'byd', re: /^BYD\s*\(/ },
    { key: 'lixiang', re: /^理想汽车/ },
    { key: 'nio', re: /^蔚来/ },
    { key: 'xiaopeng', re: /^小鹏汽车/ },
    { key: 'leapmotor', re: /^零跑汽车/ }
  ];

  function cards() {
    return Array.prototype.slice.call(
      document.querySelectorAll('div.bg-white.rounded-2xl.border')
    );
  }

  function titleOf(card) {
    var t = card.querySelector('h2, h3');
    return t ? (t.textContent || '').trim() : '';
  }

  function isTarget(card) {
    var title = titleOf(card);
    for (var i = 0; i < TARGETS.length; i++) {
      if (TARGETS[i].re.test(title)) return true;
    }
    return false;
  }

  function buildNote() {
    var box = document.createElement('div');
    box.setAttribute('data-sxg-etc-fee-note', '1');
    // 内联样式：卡片样式表是构建时按源码实际用到的类生成的，
    // 不能假设某个 Tailwind 组合类一定被输出（见 AGENTS.md「别直接套 Tailwind 类」）。
    box.setAttribute(
      'style',
      'margin-top:10px;padding:8px 10px;border:1px solid #bbf7d0;background:#f0fdf4;' +
        'border-radius:10px;font-size:12.5px;line-height:1.75;color:#166534;'
    );
    var head = document.createElement('span');
    head.textContent = TEXT_HEAD;
    var a = document.createElement('a');
    a.href = LINK;
    a.target = '_blank';
    a.rel = 'noopener';
    a.setAttribute('style', 'color:#15803d;font-weight:700;text-decoration:underline;');
    a.textContent = LINK_TEXT;
    box.appendChild(head);
    box.appendChild(a);
    return box;
  }

  function contentArea(card) {
    // 逐个直接子节点找卡面内容区（div.p-5.space-y-3.5）。
    // 不用 :scope> 选择器：jsdom 对它的支持不稳，测试会假失败。
    var kids = card.children || [];
    for (var i = 0; i < kids.length; i++) {
      var cn = (kids[i].className || '').toString();
      if (/(^|\s)p-5(\s|$)/.test(cn) && /space-y-3\.5/.test(cn)) return kids[i];
    }
    return null;
  }

  function insertInto(card) {
    if (card.querySelector('[data-sxg-etc-fee-note]')) return true;
    var box = buildNote();
    // 插到**卡面内容区**末尾；找不到就追加到卡片本身。
    //
    // ⚠️ 不要用「标签行之后」定位：实测各张卡的标签行父容器并不一致
    //   （有的是两列 grid，有的是 strong），插进去会把备注挤进卡面网格、
    //   甚至造成非法嵌套。内容区是所有卡一致的结构，最稳。
    var inner = contentArea(card);
    (inner || card).appendChild(box);
    return true;
  }

  function patchAll() {
    cards().forEach(function (card) {
      if (!isTarget(card)) return;
      try {
        insertInto(card);
      } catch (e) {
        console.error('[双休购] 车外费用备注注入失败：', e);
      }
    });
  }

  var scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(function () {
      scheduled = false;
      patchAll();
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
    console.error('[双休购] 车外费用备注监听失败：', e);
  }
})();
