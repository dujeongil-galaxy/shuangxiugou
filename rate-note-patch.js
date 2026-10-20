#!/usr/bin/env node
/**
 * 双休率口径补丁（rate-note-patch.js）
 *
 * 为什么需要这个脚本：
 * 内置 39 张卡的数据在压缩 bundle（assets/index-YthXZ9eP.js）里，按仓库铁律**不能改 bundle**。
 * 但卡面上「双休率」只有三种形态，读者分不清两种「没数字」的区别：
 *   ① 「0%」——制度口径换算（官方写明做六休一/月休 2 天，按定义双休员工占比为零），数据层挂
 *      rateSource:derived 与证据 id，是算术不是估算；
 *   ② 「—」——公开渠道查无分岗位月休数据（rateNote 里有查证记录），本站规矩：不以估算值填充。
 * 本脚本在渲染后的 DOM 上给两种形态各加一个可见小标注，让「查到了换算为零」与「查过但没有」
 * 一眼可分。不改任何数据字段，bundle 零改动。
 *
 * 渲染结构（bundle）：卡片统计区里
 *   <div class="text-slate-400">真实双休率:</div><div class="font-mono font-bold ...">0% 或 —</div>
 * 自定义卡（customCardsConfig 克隆内置模板）结构相同，一并处理。
 *
 * 幂等：标注节点带 data-rate-note 标记；MutationObserver 兜底 React 重渲染后重插。
 */
(function () {
  // 每个品牌的「—」原因（一句话，可溯源要点写进 员工实测数据核实修改清单.md 附四）
  var NOTE_BY_BRAND = [
    [/美的/, '已查官方回应与媒体报道：2025-03 集团「六条禁令」禁形式主义加班；网传「18:20 强制下班」未获集团确认。无双休制度口径'],
    [/宏碁|Acer/i, '已查官方招聘页：台湾总部「週休二日、彈性上下班」；大陆法人无统一公开月休口径'],
    [/三星|Samsung/i, '已查招聘口径：办公岗「周一至周五、周末双休」（苏州半导体等）；产线校招 JD「三班倒」。分岗位差异大，不填单一值'],
    [/霸王茶姬/, '已查媒体与招聘多源：门店茶饮师月休 4 天轮休（新浪新闻等多源）、总部后台岗双休。岗位双轨，不填单一值'],
    [/长城汽车|GWM/i, '总部 2026-01 官宣取消大小周、全员双休（中国经济网/大河报）；产线招聘 2026-10 仍「单双休、月休 6 天」（大冶 JD）。已改档 C 级 0%（按产线口径换算）'],
    [/大疆|DJI/i, '已查媒体与员工反馈：2025-02-27 起「强制 21 点下班」；2026-05 多名员工证实周末零打扰（真双休体验）。无双休率抽样数据'],
    [/名创优品|MINISO/i, '门店岗招聘多源「灵活排班、月休 4 天、节假日排班轮休」（2026-05~10，含公司直招 JD）。已改档 C 级 0%（按门店口径换算）'],
    [/赵一鸣|零食很忙/, '门店月休 2 天为主（部分 4 天），分店差异大，不填单一换算值'],
    [/零食有鸣/, '门店月休 2 天与 4 天并存（内江/成都口径不一），不填单一换算值'],
    [/茶百道/, '门店月休不足 4 天（媒体口径）；成都总部后台岗双休。岗位双轨，不填单一值'],
    [/兵立王/, '门店月休不足 4 天，公开渠道无双休率数据'],
    [/一点点/, '淡季月休 8 天 / 旺季月休 4 天，季节双轨，不填单一换算值']
  ];
  // 无专属映射的「—」卡兜底原因（与核实清单 §五.5/§五.6 口径一致，不编数字）
  var GENERIC_NOTE = '该品牌双休率暂未核实（公开渠道查无可换算的分岗位双休数据），本站不以估算值填充';

  function brandNote(cardEl) {
    var h = cardEl ? cardEl.querySelector('h3, h2') : null;
    if (!h) return null;
    var name = h.textContent || '';
    for (var i = 0; i < NOTE_BY_BRAND.length; i++) {
      if (NOTE_BY_BRAND[i][0].test(name)) return NOTE_BY_BRAND[i][1];
    }
    return null;
  }

  // 从标注点向上找包含品牌标题的卡片根。
  // 注意：卡面品牌标题原始是 h3，但站点另有补丁会改写成 h2（data-h2-fixed="1"），
  // 所以这里同时匹配 h3/h2，不依赖两个补丁的执行先后。
  function findCard(el) {
    var cur = el;
    var depth = 0;
    while (cur && cur !== document.body && depth < 12) {
      if (cur.querySelector && cur.querySelector('h3, h2')) return cur;
      cur = cur.parentElement;
      depth++;
    }
    return null;
  }

  function makeBadge(text, color, title) {
    var s = document.createElement('span');
    s.setAttribute('data-rate-note', '1');
    s.textContent = text;
    s.setAttribute('title', title || '');
    s.setAttribute('style',
      'display:inline-block;margin-left:6px;padding:1px 6px;border-radius:999px;' +
      'font-size:10px;font-weight:600;vertical-align:middle;line-height:1.6;' +
      'color:' + color + ';border:1px solid ' + color + '55;background:transparent');
    return s;
  }

  function makeFootnote(text) {
    var d = document.createElement('div');
    d.setAttribute('data-rate-note', '1');
    d.textContent = '↳ ' + text;
    d.setAttribute('title', text);
    d.setAttribute('style',
      'margin-top:4px;font-size:10px;line-height:1.5;color:#94a3b8');
    return d;
  }

  function patchOnce() {
    // 找所有「真实双休率」标签行
    var labels = document.querySelectorAll('div');
    for (var i = 0; i < labels.length; i++) {
      var el = labels[i];
      if (!el.childNodes || el.childNodes.length !== 1) continue;
      var t = (el.textContent || '').trim();
      if (t.indexOf('真实双休率') !== 0) continue;
      if (el.getAttribute('data-rate-patched') === '1') continue;

      var row = el.parentElement; // 标签与数值的公共容器
      if (!row) continue;
      var valueEl = null;
      for (var j = 0; j < row.children.length; j++) {
        var c = row.children[j];
        if (c !== el && /font-mono/.test(c.className || '')) { valueEl = c; break; }
      }
      if (!valueEl) continue; // 未找到数值节点：不打标记，留给下轮重试
      var v = (valueEl.textContent || '').trim();
      var card = findCard(el);
      var note = brandNote(card);
      var done = false;

      function badgePresent() {
        var sib = valueEl.nextElementSibling;
        return !!(sib && sib.getAttribute && sib.getAttribute('data-rate-note') === '1');
      }
      function footPresent() {
        var key = row.parentElement;
        return !!(key && key.querySelector && key.querySelector('[data-rate-note="foot"]'));
      }

      if (/^\d+(\.\d+)?%$/.test(v) && v !== '0%') {
        // 普通百分比：无需标注
        done = true;
      } else if (v === '0%') {
        // 制度口径换算：挂可见徽标（title 里带解释）
        if (!badgePresent()) {
          valueEl.insertAdjacentElement('afterend', makeBadge(
            '口径换算', '#b45309',
            '按官方排班口径换算：做六休一/月休制下，每周能休满两天的员工占比为零。'
            + '这是算术结论不是员工抽样；证据 id 见该品牌详情页'));
        }
        done = badgePresent(); // 插入成功才打标记
      } else if (v === '—') {
        var note2 = note || GENERIC_NOTE;
        // 查无数据：数值旁小徽标 + 卡片内一行原因（有专属映射用专属，否则用兜底口径）
        if (!badgePresent()) {
          valueEl.insertAdjacentElement('afterend', makeBadge('未核实', '#64748b', note2));
        }
        var footKey = row.parentElement;
        if (footKey && !footPresent()) {
          var fn = makeFootnote(note2);
          fn.setAttribute('data-rate-note', 'foot');
          row.insertAdjacentElement('afterend', fn);
        }
        done = badgePresent() && footPresent(); // 两者都插入成功才打标记
      }
      if (done) el.setAttribute('data-rate-patched', '1');
    }
  }

  var scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(function () {
      scheduled = false;
      try { patchOnce(); } catch (e) { console.error('[双休购] 口径补丁执行失败：', e); }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', schedule);
  } else {
    schedule();
  }
  // React 重渲染会重建 DOM，全局监听兜底重打
  try {
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  } catch (e) {
    console.error('[双休购] 口径补丁监听失败：', e);
  }
})();
