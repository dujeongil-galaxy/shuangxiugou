#!/usr/bin/env node
/**
 * 首页「最新新增的企业」入口补丁（recent-brands.js）
 *
 * 站长 2026-11-15 指令：「在首页找个地方挂一下按钮，叫『最新新增的企业』；
 * 至于是展示最近 x 天的，还是最新 x 条，这个你决定」→ 取**最新 5 条**（按登记日期倒序）。
 * 理由：品牌新增不是每天都有，按天窗口会经常空面板；按条数永远有内容。
 *
 * 铁律：首页由压缩 bundle（assets/index-YthXZ9eP.js）渲染，**绝不改 bundle**。
 * 本脚本挂在 #site-notice 静态公告栏之后——该节点在 #root 之外，React 重渲染
 * 不会清掉，因此不需要 MutationObserver 自愈（2026-10-31 证据公示区同款做法）。
 *
 * 数据来自 recent-brands-data.js（由 scripts/gen-recent-brands.py 从
 * data/recent-brands.json 生成），本脚本不硬编码品牌清单，避免两处漂移。
 *
 * 幂等：按 id 判重，重复执行不会插出第二个按钮。
 */
(function () {
  'use strict';

  var DATA = window.__SXG_RECENT__;
  if (!DATA || !DATA.items || !DATA.items.length) return;

  var BAR_ID = 'sxg-recent-bar';
  var PANEL_ID = 'sxg-recent-panel';
  var STYLE_ID = 'sxg-recent-style';
  var N = DATA.displayCount || 5;

  var CSS = [
    '#sxg-recent-bar{background:#f0fdfa;border-bottom:1px solid #ccfbf1;',
    '  text-align:center;padding:7px 12px;font-size:12px;color:#115e59}',
    '#sxg-recent-btn{display:inline-block;background:#0f766e;color:#fff;border:0;',
    '  border-radius:999px;padding:5px 14px;font-size:12px;font-weight:700;',
    '  cursor:pointer;margin-right:10px;vertical-align:middle}',
    '#sxg-recent-btn:hover{background:#115e59}',
    '#sxg-recent-btn:focus-visible{outline:2px solid #0f766e;outline-offset:2px}',
    '.sxg-rec-hint{vertical-align:middle;color:#0f766e}',
    /* 层级必须高于首页自动弹出的「公益提醒」.dyp（100000）与广告位卡片（100010），
       否则点开面板会被那两层的全屏遮罩整块盖住（2026-11-15 无头 Edge 实拍踩到）。 */
    '#sxg-recent-panel{position:fixed;inset:0;z-index:100020;display:none}',
    '.sxg-rec-mask{position:absolute;inset:0;background:rgba(15,23,42,.55)}',
    '.sxg-rec-card{position:relative;max-width:560px;width:calc(100% - 32px);',
    '  max-height:82vh;overflow:auto;margin:7vh auto 0;background:#fff;',
    '  border-radius:14px;box-shadow:0 20px 60px rgba(0,0,0,.28);padding:20px 22px}',
    '.sxg-rec-hd{display:flex;align-items:center;justify-content:space-between;gap:12px;',
    '  border-bottom:1px solid #e5e7eb;padding-bottom:10px;margin-bottom:6px}',
    '.sxg-rec-hd b{font-size:17px;color:#0f766e;font-weight:800}',
    '#sxg-recent-close{background:#f3f4f6;border:0;border-radius:50%;width:28px;height:28px;',
    '  font-size:18px;line-height:1;cursor:pointer;color:#374151}',
    '.sxg-rec-sub{font-size:12px;color:#6b7280;margin:0 0 12px}',
    '.sxg-rec-list{list-style:none;margin:0;padding:0}',
    '.sxg-rec-item{border:1px solid #e5e7eb;border-radius:10px;padding:11px 13px;margin-bottom:9px}',
    '.sxg-rec-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
    '.sxg-rec-date{font-size:12px;color:#6b7280;font-variant-numeric:tabular-nums}',
    '.sxg-rec-name{font-size:15px;font-weight:800;color:#0f766e;text-decoration:none}',
    '.sxg-rec-name:hover{text-decoration:underline}',
    '.sxg-rec-grade{color:#fff;font-size:11px;font-weight:700;border-radius:999px;padding:2px 8px}',
    '.sxg-rec-kind{font-size:11px;color:#92400e;background:#fef3c7;border-radius:999px;padding:2px 8px}',
    '.sxg-rec-note{font-size:13px;color:#374151;line-height:1.7;margin:7px 0 0}',
    '.sxg-rec-foot{font-size:12px;color:#6b7280;border-top:1px dashed #e5e7eb;',
    '  padding-top:10px;margin:12px 0 0;line-height:1.7}',
    '@media(max-width:480px){.sxg-rec-card{padding:16px 14px;margin:5vh auto 0}',
    '  .sxg-rec-hint{display:none}}'
  ].join('\n');

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function gradeColor(g) {
    return { S: '#0f766e', A: '#059669', B: '#b45309', C: '#dc2626', D: '#9f1239', U: '#6b7280' }[g] || '#6b7280';
  }

  function itemHtml(it) {
    return '<li class="sxg-rec-item">' +
      '<div class="sxg-rec-row">' +
        '<span class="sxg-rec-date">' + esc(it.date) + '</span>' +
        '<a class="sxg-rec-name" href="' + esc(it.href) + '">' + esc(it.name) + '</a>' +
        '<span class="sxg-rec-grade" style="background:' + gradeColor(it.grade) + '">' +
          esc(it.grade) + ' 级</span>' +
        '<span class="sxg-rec-kind">' + esc(it.kind) + '</span>' +
      '</div>' +
      '<p class="sxg-rec-note">' + esc(it.note) + '</p>' +
    '</li>';
  }

  function panelHtml() {
    var items = DATA.items.map(itemHtml).join('');
    return '<div class="sxg-rec-mask" data-sxg-rec-close="1"></div>' +
      '<div class="sxg-rec-card" role="dialog" aria-modal="true" aria-label="最新新增的企业">' +
        '<div class="sxg-rec-hd"><b>最新新增的企业</b>' +
          '<button type="button" id="sxg-recent-close" aria-label="关闭">×</button></div>' +
        '<p class="sxg-rec-sub">按登记日期倒序 · 最新 ' + N + ' 条（共登记 ' +
          esc(DATA.total || DATA.items.length) + ' 条）</p>' +
        '<ul class="sxg-rec-list">' + items + '</ul>' +
        '<p class="sxg-rec-foot">「网传登记（待核实）」仅为公开线索记录，不作为评级依据；' +
          '评级与证据链以各品牌详情页为准。点击品牌名可查看档案。</p>' +
      '</div>';
  }

  function openPanel() {
    var p = document.getElementById(PANEL_ID);
    if (p) p.style.display = 'block';
  }
  function closePanel() {
    var p = document.getElementById(PANEL_ID);
    if (p) p.style.display = 'none';
  }

  function install() {
    if (document.getElementById(BAR_ID)) return true;
    var notice = document.getElementById('site-notice');
    if (!notice) return false;

    if (!document.getElementById(STYLE_ID)) {
      var st = document.createElement('style');
      st.id = STYLE_ID;
      st.textContent = CSS;
      document.head.appendChild(st);
    }

    var bar = document.createElement('div');
    bar.id = BAR_ID;
    bar.innerHTML = '<button type="button" id="sxg-recent-btn" aria-haspopup="dialog">' +
      '最新新增的企业</button>' +
      '<span class="sxg-rec-hint">按登记日期倒序 · 最新 ' + N + ' 条</span>';
    notice.parentNode.insertBefore(bar, notice.nextSibling);

    var panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.setAttribute('data-nosnippet', '');
    panel.innerHTML = panelHtml();
    document.body.appendChild(panel);

    document.getElementById('sxg-recent-btn').addEventListener('click', openPanel);
    document.getElementById('sxg-recent-close').addEventListener('click', closePanel);
    panel.addEventListener('click', function (ev) {
      if (ev.target && ev.target.getAttribute('data-sxg-rec-close') === '1') closePanel();
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') closePanel();
    });
    return true;
  }

  if (!install()) document.addEventListener('DOMContentLoaded', install);
})();
