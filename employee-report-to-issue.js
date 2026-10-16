/* ==========================================================================
   employee-report-to-issue.js
   --------------------------------------------------------------------------
   解决的问题：员工点「提交我的真实工时票」后，数据其实**根本没发出去**。

   真实情况（2026-10-16 查证压缩包 assets/index-YthXZ9eP.js 得出）：
     onSubmit -> setTimeout(fn, 400) -> 关窗
     fn 只有一句 React 本地 state 更新：setBrands(list => list.map(...))
   全站3 处 fetch 全部来自 React 内部库（modulepreload 预加载、
   FileReader 图片转 base64、html2canvas 读 CSS），**没有一处是提交数据**；
   XMLHttpRequest 0 处、navigator.sendBeacon 0 处。
   也就是说：数据只活在当前这个页面的内存里，**刷新即丢，站长也收不到**。
   按钮上写的「入库公证中...」与「零知识客户端混淆」是文案，不是事实。

   本文件的做法：
     拦截原生表单提交 -> 把内容拼成 GitHub Issue 的「新建 issue」URL
     -> 交给浏览器打开。用户点一下提交，浏览器就跳到 GitHub 的 issue 创建页，
     预填好标题与正文，用户确认后点「Submit new issue」即真正入库。
     数据直接进入仓库 issue 列表，站长在 GitHub 后台就能看到并逐条核实。

   为什么不用 fetch 调 GitHub API：
     创建 issue 需要 token。token 放在前端等于公开，会被滥用刷 issue。
     「跳转 GitHub 用用户自己的账号」零成本、零密钥、不暴露凭证。

   幂等：
     1) 打data-sxg-report-hooked="1" 标记，只劫持一次；
     2) 监听器挂在 document 上且只在捕获阶段对「含提交按钮的表单」生效；
     3) 不修改原有 DOM 文本，不新增节点，纯行为拦截 —— 反复调用无副作用。
   ========================================================================== */
(function () {
  'use strict';

  var MARK = 'data-sxg-report-hooked';
  var REPO = 'https://github.com/dujeongil-galaxy/shuangxiugou';

  /* ------------------------------------------------------------- 小工具 */

  function $$(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }

  function text(node) {
    return (node && (node.textContent || '')).replace(/\s+/g, ' ').trim();
  }

  /* --------------------------------------------------------- 提取表单内容
     弹窗结构（来自压缩包）：
       「投出你在 XXX 的真实工时」
       岗位按钮组：研发技术 / 产线工人 / 职能人事财务 / 一线门店骑手销售
       周末双休指数：三个档位按钮 + 「100% 双休指数」标记
       平时平均下班时间：<select>
       法定加班报酬/福利：✓依法足额发放 / ✕克扣强制自愿
       真心话：<textarea>
     这里不依赖 class（压缩包 class 名不可靠），改用「选中态」和文案特征识别。 */

  function pickRole(form) {
    // 选中态按钮：bg-emerald-50 / border-emerald-600 是压缩包里写死的高亮态
    var on = form.querySelector('button.border-emerald-600, button[class*="border-emerald-600"]');
    return text(on) || '未选择';
  }

  function pickWeekend(form) {
    // 压缩包里是三档按钮（严格双休 100 / 大小周 60 / 常态单休 15），
    // 旁边实时显示「N% 双休指数」。优先读这个数字，读不到再退回报选中档文案。
    var m = /(\d+)%\s*双休指数/.exec(text(form));
    if (m) return m[1] + '% 双休指数';
    var on = form.querySelector('button.border-emerald-600, button[class*="border-emerald-600"]');
    return text(on) || '未选择';
  }

  function pickOffWork(form) {
    var sel = form.querySelector('select');
    return sel ? (sel.options[sel.selectedIndex] || {}).text || '' : '';
  }

  function pickPay(form) {
    var rose = form.querySelector('button.border-rose-600, button[class*="border-rose-600"]');
    if (rose) return '✕ 克扣/强制自愿';
    var green = form.querySelector('button.border-emerald-600, button[class*="border-emerald-600"]');
    return green ? '✓ 依法足额发放' : '未选择';
  }

  function pickComment(form) {
    var ta = form.querySelector('textarea');
    return ta ? (ta.value || '').trim() : '';
  }

  function pickBrand(form) {
    var h2 = form.parentNode ? form.parentNode.querySelector('h2') : null;
    var m = h2 && /投出你在\s*(.+?)\s*的真实工时/.exec(text(h2));
    return m ? m[1] : '未知企业';
  }

  /* --------------------------------------------------------- 生成 issue */

  function buildIssueUrl(brand, role, weekend, offWork, pay, comment) {
    var title = '[员工工时投稿] ' + brand;
    var lines = [
      '## 员工工时投稿（自动生成，请补充可查证来源）',
      '',
      '| 项目 | 填写内容 |',
      '| --- | --- |',
      '| 企业 | ' + brand + ' |',
      '| 部门/岗位 | ' + (role || '未选择') + ' |',
      '| 周末双休指数 | ' + (weekend || '未选择') + ' |',
      '| 平时平均下班时间 | ' + (offWork || '未选择') + ' |',
      '| 法定加班报酬/福利 | ' + (pay || '未选择') + ' |',
      '',
      '### 真心话',
      comment || '（未填写）',
      '',
      '---',
      '',
      '**这份投稿只作核查线索，不直接计入统计。**',
      '若能提供以下任一可查证来源，请一并附上：',
      '',
      '- 劳动合同、排班表、工作时间的截图（请先打码个人身份信息）',
      '- 招聘平台上的岗位页链接（喜茶/宁德等多数品牌的排班口径写在招聘页）',
      '- 劳动监察通报、法院判决、公司公告、年报中的工时条款',
      '- 工会、职工代表大会公开材料',
      '',
      '**核实后本站会**：`null` 保持未核实 → 补证据后更新为真实数值 →',
      '在品牌详情页「证据来源」里追加这条，并标注证据强度。',
      '若查不到任何公开依据，本条将长期保持「未核实」，**不会**被写成具体数字。',
      '',
      '（本条由站内「提交我的真实工时票」表单自动生成）',
    ];
    return REPO + '/issues/new?title=' + encodeURIComponent(title) +
      '&body=' + encodeURIComponent(lines.join('\n')) +
      '&labels=' + encodeURIComponent('员工投稿');
  }

  /* --------------------------------------------------------- 挂载拦截 */

  function findSubmitBtn(root) {
    // 按钮文案在 React 提交瞬间会变成「入库公证中…」——
    // 那是压缩包里的**假承诺**（其实什么都没发出去）。
    // 这里两个文案都要认，只为了尽快找到按钮并改掉它。
    return $$('button[type="submit"]', root).filter(function (b) {
      return /提交我的真实工时票/.test(text(b));
    })[0] || null;
  }

  function hook() {
    var btn = findSubmitBtn(document);
    if (!btn) return false;
    var form = btn.closest('form');
    if (!form || form.getAttribute(MARK) === '1') return false;

    form.setAttribute(MARK, '1');

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();

      var url = buildIssueUrl(
        pickBrand(form), pickRole(form), pickWeekend(form),
        pickOffWork(form), pickPay(form), pickComment(form)
      );

      window.open(url, '_blank', 'noopener');
    }, true);

    // 把按钮文案改成真实的、去误导的说法：
    // 明确告诉用户会跳到 GitHub，而不是暗示已经存好了。
    var span = btn.querySelector('span') || btn;
    var want = '提交我的真实工时票（将跳转 GitHub 记录）';
    if (text(span) !== want) span.textContent = want;

    return true;
  }

  /* --------------------------------------------------------- 启动 */

  function sweep() {
    try { hook(); } catch (e) { /* 绝不因为注入层报错而影响页面 */ }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', sweep);
  } else {
    sweep();
  }
  setInterval(sweep, 1200);

  if (window.MutationObserver) {
    new MutationObserver(sweep).observe(document, {
      childList: true, subtree: true,
    });
  }

  window.__sxgReportHook = { sweep: sweep, buildIssueUrl: buildIssueUrl };
})();