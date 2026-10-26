/* ==========================================================================
   appeal-policy.js —— 申诉入口政策确认弹窗
   --------------------------------------------------------------------------
   解决的问题（2026-10-25 站长要求）：申诉（提交数据 / 申诉）入口点击后
   直接跳转 GitHub issue，用户没读过申诉政策就进去了，产生大量无效申诉。

   做法：拦截页面上所有指向 GitHub issues 的申诉链接（顶栏「提交数据 /
   申诉」、页脚入口、空态卡的「+ 我来提供这家企业信息」——统一由
   index.html 的 button→a 替换逻辑生成，href 都是 issueUrl）。点击改为：
   先弹政策确认层（简洁版文案），两个按钮——
     · 同意并跳转：window.open 原链接（新标签）
     · 拒绝并关闭：关掉弹层，留在本页
   ESC / 点击遮罩也按「拒绝」处理。

   目标链接不写死：从被拦截的 a[href] 现场读取（页面里 issueUrl 是唯一
   真相源，本文件不维护第二份 URL）。

   政策文案（站长 2026-10-25 定稿，简洁版——适合弹窗体量）：
     本项目评级由AI依据GitHub仓库公示的判定规则自动计算得出。
     申诉仅受理证据过时、信息不实、个案误判、规则发生变更类复核申请；
     仅对评级结果不满意、无有效佐证材料的申诉不予受理。
     请提交客观佐证材料，我们将人工核验材料后重新运行评级流程。
     所有申诉线索严格脱敏保护，不会泄露提交者隐私。

   幂等：dataset.sxgAppealBound 标记；弹层节点按 id 判重复用。
   不动 bundle、不删原生链接节点（只接管 click）。
   ========================================================================== */
(function () {
  'use strict';

  var MODAL_ID = 'sxg-appeal-policy';
  var MARK = 'sxgAppealBound';
  var BT = String.fromCharCode(96);

  /* 判定：这个 <a> 是不是申诉入口（指向本仓库 issues 的链接） */
  function isAppealLink(a) {
    if (!a || a.tagName !== 'A') return false;
    var href = a.getAttribute('href') || '';
    return /github\.com\/[^/]+\/[^/]+\/issues/.test(href);
  }

  /* ---------------------------------------------------------- 弹层 */
  function buildModal() {
    var old = document.getElementById(MODAL_ID);
    if (old) return old;

    var mask = document.createElement('div');
    mask.id = MODAL_ID;
    mask.setAttribute('role', 'dialog');
    mask.setAttribute('aria-modal', 'true');
    mask.setAttribute('aria-label', '评级申诉政策确认');
    mask.hidden = true;
    mask.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:9999',
      'display:flex', 'align-items:center', 'justify-content:center',
      'background:rgba(15,23,42,.55)',
      'padding:16px'
    ].join(';');

    var card = document.createElement('div');
    card.style.cssText = [
      'background:#fff', 'border-radius:16px', 'max-width:560px', 'width:100%',
      'box-shadow:0 24px 60px rgba(15,23,42,.25)', 'padding:24px 26px',
      'max-height:82vh', 'overflow-y:auto'
    ].join(';');

    var title = document.createElement('h3');
    title.textContent = '评级申诉政策';
    title.style.cssText = 'margin:0 0 12px;font-size:18px;font-weight:700;color:#0f172a';

    var body = document.createElement('div');
    body.style.cssText = 'font-size:13.5px;line-height:1.75;color:#334155;white-space:pre-line';
    body.textContent = [
      '本项目评级由AI依据GitHub仓库公示的判定规则自动计算得出。',
      '申诉仅受理证据过时、信息不实、个案误判、规则发生变更类复核申请；仅对评级结果不满意、无有效佐证材料的申诉不予受理。',
      '请提交客观佐证材料，我们将人工核验材料后重新运行评级流程。所有申诉线索严格脱敏保护，不会泄露提交者隐私。'
    ].join('\n');

    var btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:12px;justify-content:flex-end;margin-top:20px;flex-wrap:wrap';

    var no = document.createElement('button');
    no.type = 'button';
    no.id = MODAL_ID + '-deny';
    no.textContent = '拒绝并关闭';
    no.style.cssText = [
      'padding:10px 18px', 'border-radius:10px', 'cursor:pointer',
      'border:1px solid #e2e8f0', 'background:#f8fafc', 'color:#475569',
      'font-size:13.5px', 'font-family:inherit'
    ].join(';');

    var yes = document.createElement('button');
    yes.type = 'button';
    yes.id = MODAL_ID + '-agree';
    yes.textContent = '同意并跳转';
    yes.style.cssText = [
      'padding:10px 18px', 'border-radius:10px', 'cursor:pointer',
      'border:1px solid #16a34a', 'background:#16a34a', 'color:#fff',
      'font-size:13.5px', 'font-weight:600', 'font-family:inherit'
    ].join(';');

    btnRow.appendChild(no);
    btnRow.appendChild(yes);
    card.appendChild(title);
    card.appendChild(body);
    card.appendChild(btnRow);
    mask.appendChild(card);
    document.body.appendChild(mask);
    return mask;
  }

  function openModal(targetUrl) {
    var modal = buildModal();
    modal.dataset.targetUrl = targetUrl || '';
    modal.hidden = false;
    var yes = document.getElementById(MODAL_ID + '-agree');
    if (yes) yes.focus();
  }

  function closeModal() {
    var modal = document.getElementById(MODAL_ID);
    if (modal) modal.hidden = true;
  }

  /* ---------------------------------------------------------- 绑定 */
  function bindLinks() {
    document.querySelectorAll('a[target="_blank"]').forEach(function (a) {
      if (a.dataset[MARK] === '1') return;
      if (!isAppealLink(a)) return;
      a.dataset[MARK] = '1';
      a.addEventListener('click', function (ev) {
        ev.preventDefault();
        openModal(a.href);
      });
    });
  }

  function bindModalButtons() {
    var modal = buildModal();
    if (modal.dataset.sxgModalBound === '1') return;
    modal.dataset.sxgModalBound = '1';
    modal.addEventListener('click', function (ev) {
      if (ev.target === modal) closeModal(); // 点遮罩 = 拒绝
    });
    document.getElementById(MODAL_ID + '-agree').addEventListener('click', function () {
      var url = modal.dataset.targetUrl;
      closeModal();
      if (url) window.open(url, '_blank', 'noopener');
    });
    document.getElementById(MODAL_ID + '-deny').addEventListener('click', closeModal);
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') closeModal();
    });
  }

  function sweep() {
    try {
      bindModalButtons();
      bindLinks();
    } catch (e) { /* 注入层绝不影响页面 */ }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', sweep);
  } else {
    sweep();
  }
  // 申诉链接是 button→a 替换产物，晚于本脚本出现；轮询 + observer 兜底
  setInterval(sweep, 1000);
  if (window.MutationObserver) {
    new MutationObserver(sweep).observe(document, { childList: true, subtree: true });
  }

  /* ---------------------------------------------------------- 自测导出 */
  window.__SXGAppealPolicy = {
    isAppealLink: isAppealLink,
    buildModal: buildModal,
    openModal: openModal,
    closeModal: closeModal,
    MODAL_ID: MODAL_ID
  };
})();
