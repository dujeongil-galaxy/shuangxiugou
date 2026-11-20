#!/usr/bin/env node
/**
 * 奶茶/咖啡内置卡「西南地区」限定补丁（tea-region-note.js）
 *
 * 站长 2026-11-20 明确：本人线下一手走访只覆盖西南地区门店。
 * 此前喜茶 / 库迪 / 肯悦三张内置卡的「工时政策」栏写着「站长线下核实…
 * 月休 4 天」，未限定地区，容易被读成全国核实结论。本补丁把这三处文案
 * 改为「站长西南地区门店线下核实…」，只加地区限定，保留已确证的
 * 月休 4 天数字与原有 C 级 / 双休率 0%（口径换算）结论不变。
 *
 * 为什么单独写脚本：这三张是内置卡，数据在压缩 bundle
 * （assets/index-YthXZ9eP.js）里，按仓库铁律**不能改 bundle**。
 * 本脚本只在渲染后的 DOM 上改「工时政策」一行文案，bundle 零改动。
 *
 * 幂等：改过的行打 data-tea-region 标记；MutationObserver 兜底
 * React 重渲染（搜索/筛选会重建卡片）。
 */
(function () {
  // 品牌标题前缀 → 工时政策栏「旧文案 → 新文案」（精确匹配，不误伤其他卡）
  var RULES = [
    [/^喜茶/, '官网招聘口径月休 6 天 / 门店实际做六休一（月休 4 天）',
      '官网招聘口径月休 6 天 / 西南地区门店实际做六休一（月休 4 天）'],
    [/^库迪/, '站长线下核实六休一（月休 4 天）',
      '站长西南地区门店线下核实六休一（月休 4 天）'],
    [/^肯悦/, '站长线下核实六休一（月休 4 天） / 公开招聘口径不一',
      '站长西南地区门店线下核实六休一（月休 4 天） / 公开招聘口径不一']
  ];

  function patchOnce() {
    var cards = document.querySelectorAll('div.bg-white.rounded-2xl.border');
    for (var c = 0; c < cards.length; c++) {
      var card = cards[c];
      var h = card.querySelector('h2, h3');
      if (!h) continue;
      var name = (h.textContent || '').trim();
      var rule = null;
      for (var r = 0; r < RULES.length; r++) {
        if (RULES[r][0].test(name)) { rule = RULES[r]; break; }
      }
      if (!rule) continue;
      var rows = card.querySelectorAll('div.flex.items-center.justify-between');
      for (var i = 0; i < rows.length; i++) {
        var spans = rows[i].querySelectorAll('span');
        if (spans.length < 2) continue;
        if ((spans[0].textContent || '').trim() !== '工时政策：') continue;
        var val = spans[1];
        var txt = (val.textContent || '').trim();
        // 已是新文案（含地区限定）或已被别的补丁改过：跳过，不反复写
        if (txt.indexOf('西南地区') >= 0) continue;
        if (txt !== rule[1]) continue; // 只改预期旧文案，避免误伤
        val.textContent = rule[2];
        rows[i].setAttribute('data-tea-region', '1');
      }
    }
  }

  var scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(function () {
      scheduled = false;
      try { patchOnce(); }
      catch (e) { console.error('[双休购] 奶茶地区限定补丁执行失败：', e); }
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
    console.error('[双休购] 奶茶地区限定补丁监听失败：', e);
  }
})();
