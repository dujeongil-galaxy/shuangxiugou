/* ==========================================================================
   顶栏下方 · 站点政策声明条（policy-notice.js）
   --------------------------------------------------------------------------
   站长 2026-11-18 指令：在首页顶栏（logo + 那排按钮）正下方的空白横条加一条
   社区治理声明，措辞由站长给定；其中「这里」两字是**可点击链接**，指向
   https://dujeongil-galaxy.github.io/

   为什么不塞进 #site-notice 滚动公告栏：
     · 那条是单行横向无缝滚动（notice-marquee.js/.css），项目有硬约定
       「零超链接」—— 移动的文字上的链接点不准，2026-11-02 当年就因此否掉
       过带链接的公告。本条含可点的「这里」，必须做成**静态**条，另起一行。
     · #site-notice 在 #root 之外，本条插在 React 渲染的 <header> 之后。

   技术红线：只插静态 DOM、不动压缩 bundle（assets/index-YthXZ9eP.js）。
   文案用 textContent 分段 + <a> 元素拼装，不写 innerHTML，避免注入面。
   2026-11-18 再改：① 文案「零容忍」补全为「零容忍原则」（站长强调是原则）；
   ② 配色先由白底红字换深红底白字（站长当时怕浅底看不清），同日站长看真渲染后
      改口「不如换成浅黄色背底，真的」——最终为浅黄底 + 深红字/深红链接，
      浅底配深色文字，既有浅黄观感又不牺牲可读性。

   幂等 / 自愈：按 id 判重；header 由 React 渲染，脚本执行时可能还没挂载，
   故用定时重试 + MutationObserver 等待；若后续 React 重渲染清掉了声明条，
   下一轮 sweep 会重新插回（有次数上限，避免与宿主互相触发自激）。
   ========================================================================== */
(function () {
  'use strict';

  var BAR_ID = 'sxg-policy-notice';
  var STYLE_ID = 'sxg-policy-notice-style';
  var LINK_HREF = 'https://dujeongil-galaxy.github.io/';

  /* 站长给定原文，按「这里」切成三段；两段纯文本 + 中间一个真 <a>。 */
  var TEXT_BEFORE = '因乌克兰发生战争，对于利用、无视或纵容这场战争的言论（包括但不限于issues、匿名邮箱来信等），我们将采取零容忍原则，点击';
  var LINK_TEXT = '这里';
  var TEXT_AFTER = '查看本站政策';

  var CSS = [
    '#' + BAR_ID + '{',
    /* 2026-11-18 站长看完深红底后改口：「不如换成浅黄色背底，真的」。
       浅黄底 #fef3c7 + 深红字 #7f1d1d，对比度约 8:1；链接同色系更深一档
       #991b1b + 下划线，浅底上清楚可点（旧亮黄在浅底会消失，故一并改掉）。 */
    '  max-width:1100px;margin:0 auto;background:#fef3c7;color:#7f1d1d;',
    '  text-align:center;font-size:13px;line-height:1.6;font-weight:700;',
    '  padding:8px 16px;border-bottom:1px solid #f59e0b;',
    '  position:relative;z-index:1;',
    '}',
    '#' + BAR_ID + ' a{color:#991b1b;text-decoration:underline;font-weight:700;}',
    '#' + BAR_ID + ' a:hover{color:#7f1d1d;}',
    '#' + BAR_ID + ' a:focus-visible{outline:2px solid #92400e;outline-offset:2px;}',
    '@media (max-width:640px){',
    '  #' + BAR_ID + '{font-size:12px;padding:7px 12px;line-height:1.55;}',
    '}'
  ].join('');

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  function buildBar() {
    var bar = document.createElement('div');
    bar.id = BAR_ID;
    bar.setAttribute('role', 'note');
    bar.appendChild(document.createTextNode(TEXT_BEFORE));
    var a = document.createElement('a');
    a.href = LINK_HREF;
    a.textContent = LINK_TEXT;
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
    bar.appendChild(a);
    bar.appendChild(document.createTextNode(TEXT_AFTER));
    return bar;
  }

  function sweep() {
    try {
      var header = document.querySelector('header');
      if (!header) return;                       // React 还没挂载，下一轮再来
      ensureStyle();
      var bar = document.getElementById(BAR_ID);
      if (bar && bar.parentNode === header.parentNode && bar.previousSibling === header) return; // 已在位
      if (!bar) bar = buildBar();
      // 插在 <header> 之后、#root 内其余内容之前 —— 真渲染里正是红框那条空白。
      header.parentNode.insertBefore(bar, header.nextSibling);
    } catch (e) { /* 下游补丁不因宿主状态异常抛错 */ }
  }

  window.addEventListener('resize', sweep);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', sweep);
  } else {
    sweep();
  }
  /* React 渲染 header 要等；与同类补丁同批重试 */
  window.setTimeout(sweep, 300);
  window.setTimeout(sweep, 900);
  window.setTimeout(sweep, 2200);
  if (window.MutationObserver) {
    var tries = 0;
    var obs = new MutationObserver(function () {
      sweep();                                   // 幂等：已在位则空转，不自激
      if (++tries > 90) obs.disconnect();
    });
    try { obs.observe(document.body, { childList: true, subtree: true }); } catch (e) {}
  }

  window.SXGPolicyNotice = {
    sweep: sweep, BAR_ID: BAR_ID, LINK_HREF: LINK_HREF,
    TEXT_BEFORE: TEXT_BEFORE, LINK_TEXT: LINK_TEXT, TEXT_AFTER: TEXT_AFTER
  };
})();
