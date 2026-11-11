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

   2026-11-12 站长追加两条（按站内语气重写，不逐字照抄口述草稿，
   括号批注绝不上页面）：
     · 诉求不得含侮辱 / 人身攻击，否则不予审核；勿重复提交；劳动争议优先法律途径
     · GitHub 访问提示 + 按设备分流的帮助块
   帮助块只留一个 [data-sxg-gh-help] 空容器，内容由 github-access-help.js
   单一真相源填充（PC → Watt Toolkit；手机 / 平板 → 站点原有入口），
   本文件不维护第二份 URL、不写死设备判断。

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
    /* 2026-11-03 真浏览器实测：本组件全靠 hidden 属性切显隐，但上面 cssText 里有
       'display:flex' —— 内联样式会压过 UA 样式表的 [hidden]{display:none}，
       后果是弹窗一旦渲染就永远关不掉（拒绝/ESC/点遮罩全失效），且页面一加载
       bindModalButtons→buildModal 就把它渲染出来挡住整页。jsdom 测不出来
       （不做布局）。修法：显隐改用内联 display 直接控制，hidden 属性只留给
       无障碍语义。PITFALLS「hidden 属性切显隐须补兜底」教训的又一次实例。 */
    mask.style.display = 'none';

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
      '请提交客观佐证材料，我们将人工核验材料后重新运行评级流程。所有申诉线索严格脱敏保护，不会泄露提交者隐私。',
      '诉求请就事论事：夹带侮辱、人身攻击的提交一律不予审核，同一事项也请勿重复投递。若你正遇上劳动争议，建议先走劳动监察、仲裁等法定渠道维护权益，本站评级复核不能替代法律程序。',
      '另外，申诉、Star 与登录都要走 GitHub，大陆部分网络环境下可能无法直连；打不开时可按下方按设备给出的办法试一下。'
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

    /* 2026-11-12：访问帮助容器。内容由 github-access-help.js 的
       sweepSlots() 填充（脚本未加载时只是空块，不影响政策确认主流程）。 */
    var helpSlot = document.createElement('div');
    helpSlot.setAttribute('data-sxg-gh-help', '1');
    helpSlot.style.cssText = 'margin-top:14px;padding-top:12px;border-top:1px solid #f1f5f9';

    btnRow.appendChild(no);
    btnRow.appendChild(yes);
    card.appendChild(title);
    card.appendChild(body);
    card.appendChild(helpSlot);
    card.appendChild(btnRow);
    mask.appendChild(card);
    document.body.appendChild(mask);
    return mask;
  }

  function openModal(targetUrl) {
    var modal = buildModal();
    modal.dataset.targetUrl = targetUrl || '';
    modal.hidden = false;
    modal.style.display = 'flex'; // 同步内联 display（hidden 会被内联 flex 压过，见 buildModal 注释）
    var yes = document.getElementById(MODAL_ID + '-agree');
    if (yes) yes.focus();
  }

  function closeModal() {
    var modal = document.getElementById(MODAL_ID);
    if (modal) {
      modal.hidden = true;
      modal.style.display = 'none';
    }
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
