#!/usr/bin/env node
/**
 * 瑞幸卡片提示语补丁（luckin-note-patch.js）
 *
 * 站长 2026-11-07 口述：线下走访过多家瑞幸门店，排班口径一致，都是上六休一
 * （月休 4 天）；成都地区的情况稍宽松，但门店没有正面回答休息怎么安排，
 * 所以不拿这一条单独改判。要求「别套用我原话，可以保留成都地区」——
 * 因此这里只写核实结论与「未给出明确排班口径」，不复述门店的推脱说法。
 *
 * 为什么单独写脚本：瑞幸是内置卡，数据在压缩 bundle
 * （assets/index-YthXZ9eP.js）里，按仓库铁律**不能改 bundle**。
 * 本脚本在渲染后的 DOM 上改「工时政策」一行，并加一条红框提示语，
 * bundle 零改动。同站库迪 / 蜜雪冰城 / 肯悦的「站长线下核实六休一（月休 4 天）」
 * 是同一口径，这里补齐瑞幸，避免同一类咖啡门店两种写法。
 *
 * 渲染结构（bundle）：
 *   <div class="flex items-center justify-between text-slate-700">
 *     <span class="text-slate-400">工时政策：</span>
 *     <span class="font-semibold">…旧文案…</span>
 *   </div>
 * 提示语插在标签行之后，样式与 customCardsConfig 的 recommendText 红框一致。
 *
 * 幂等：改过的行打 data-luckin-policy 标记、提示框打 data-luckin-note；
 * MutationObserver 兜底 React 重渲染（搜索/筛选会重建卡片）。
 */
(function () {
  var POLICY = '站长线下核实：上六休一（月休 4 天）';
  var NOTE = '⚠️ 多家门店排班口径一致；成都地区门店答复略宽松，但没给出明确排班口径，本站不据此改判。';

  function findLuckinCard() {
    var cards = document.querySelectorAll('div.bg-white.rounded-2xl.border');
    for (var i = 0; i < cards.length; i++) {
      var h = cards[i].querySelector('h2, h3');
      if (h && /^瑞幸咖啡/.test((h.textContent || '').trim())) return cards[i];
    }
    return null;
  }

  function patchPolicy(card) {
    var rows = card.querySelectorAll('div.flex.items-center.justify-between');
    for (var i = 0; i < rows.length; i++) {
      var spans = rows[i].querySelectorAll('span');
      if (spans.length < 2) continue;
      if ((spans[0].textContent || '').trim() !== '工时政策：') continue;
      var val = spans[1];
      if (val.textContent !== POLICY) val.textContent = POLICY;
      rows[i].setAttribute('data-luckin-policy', '1');
      return true;
    }
    return false;
  }

  function patchNote(card) {
    if (card.querySelector('[data-luckin-note]')) return true;
    var box = document.createElement('div');
    box.className = 'mt-3 rounded-xl border px-3 py-2 text-xs leading-relaxed border-red-200 bg-red-50';
    box.style.color = '#dc2626';
    box.style.fontWeight = '700';
    box.style.fontSize = '13px';
    box.setAttribute('data-luckin-note', '1');
    box.textContent = NOTE;
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
    var card = findLuckinCard();
    if (!card) return;
    try {
      patchPolicy(card);
      patchNote(card);
    } catch (e) {
      console.error('[双休购] 瑞幸提示语补丁执行失败：', e);
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
    console.error('[双休购] 瑞幸提示语补丁监听失败：', e);
  }
})();
