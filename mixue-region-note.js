#!/usr/bin/env node
/**
 * 蜜雪冰城卡片地区差异提示补丁（mixue-region-note.js）
 *
 * 站长 2026-11-20 补充：西南地区大部分门店实行月休 4 天；华北地区门店员工自述
 * （2024-06 聊天记录，经员工同意脱敏登记，页面不展示截图与个人信息）月休 2 天。
 * 华北口径只有员工自述、暂无可核验的一手证据，按「员工自述、待核实」
 * 单列登记，不替换西南已核实口径，也不据此单独改判评级。
 *
 * 为什么单独写脚本：蜜雪冰城是内置卡，数据在压缩 bundle
 * （assets/index-YthXZ9eP.js）里，按仓库铁律**不能改 bundle**。
 * 本脚本只在渲染后的 DOM 上挂一条红框提示，bundle 零改动。
 *
 * 幂等：提示框打 data-mixue-region-note 标记；MutationObserver 兜底
 * React 重渲染（搜索/筛选会重建卡片）。
 *
 * 2026-11-25：红框根节点在首次加入 DOM 前打 data-nosnippet —— 这段 NOTE 被
 * Google 渲染 JS 后抓成首页搜索摘要（与 11-04 大疆卡、11-13 广告位同一类坑），
 * 标记只排除摘要、不影响收录；script 缓存号 v2→v3 让旧缓存换新。
 */
(function () {
  var NOTE = '⚠️ 地区差异：西南地区大部分门店月休 4 天；华北地区门店员工自述（2024-06 聊天记录，脱敏登记）月休 2 天（待核实）。两地均不足双休，C 级与双休率 0%（口径换算）不变。';

  function findMixueCard() {
    var cards = document.querySelectorAll('div.bg-white.rounded-2xl.border');
    for (var i = 0; i < cards.length; i++) {
      var h = cards[i].querySelector('h2, h3');
      if (h && /^蜜雪冰城/.test((h.textContent || '').trim())) return cards[i];
    }
    return null;
  }

  function patchNote(card) {
    if (card.querySelector('[data-mixue-region-note]')) return true;
    var box = document.createElement('div');
    box.className = 'mt-3 rounded-xl border px-3 py-2 text-xs leading-relaxed border-red-200 bg-red-50';
    box.style.color = '#dc2626';
    box.style.fontWeight = '700';
    box.style.fontSize = '13px';
    box.setAttribute('data-mixue-region-note', '1');
    box.textContent = NOTE;
    // 2026-11-25 站长：这段地区差异文案被 Google 抓成首页搜索摘要（「月休 2 天」那段），
    // 与 11-04 大疆卡 / 11-13 公益广告位同一个坑——搜索引擎渲染 JS 后从可见文本里
    // 算法挑摘要。照 §36y 的成熟做法在节点首次加入 DOM **之前** 打 data-nosnippet：
    // 只挡摘要、不影响收录与排名；不许事后增删（Google 要求首次加入时就带上）。
    box.setAttribute('data-nosnippet', '');
    // 标签行之后、绿色平替块之前；找不到标签行就退到卡片内容区末尾
    var tagRow = card.querySelector('.flex.flex-wrap.gap-1\\.5');
    if (tagRow && tagRow.parentElement) {
      tagRow.parentElement.insertBefore(box, tagRow.nextSibling);
    } else {
      var inner = card.querySelector('div.p-5.space-y-3\\.5');
      (inner || card).appendChild(box);
    }
    return true;
  }

  function patchOnce() {
    var card = findMixueCard();
    if (!card) return;
    try {
      patchNote(card);
    } catch (e) {
      console.error('[双休购] 蜜雪冰城地区差异补丁执行失败：', e);
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
    console.error('[双休购] 蜜雪冰城地区差异补丁监听失败：', e);
  }
})();
