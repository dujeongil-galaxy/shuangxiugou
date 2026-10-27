/* ==========================================================================
   ai-chat.js —— 品牌页右侧「劳动法小助手」聊天挂件
   --------------------------------------------------------------------------
   做什么
   ------
   在品牌详情页右侧外缘挂一个圆按钮（🤖）；点击展开聊天面板：
   用户提问 → POST 到 ai-config.js 配的 Worker URL → 展示回答。
   重点答劳动法与本站双休口径问题（角色锁定在 Worker 的系统提示词）。

   降级纪律（首要）
   ----------------
   - window.SXG_AI_CONFIG.endpoint 为空 → 整个挂件不渲染（功能未开）
   - Worker 不可达 / 429 / 5xx → 气泡里给对应中文文案，不影响页面其余部分
   - 任何本脚本的异常都 try-catch 吞掉：挂件绝不允许拖挂品牌页本身

   为什么挂在 brand/*.html（而不是首页）
   -------------------------------------
   首页是 React bundle 的地盘（#root 会被整树重绘），外部节点要么被
   冲掉要么得靠 MutationObserver 苦撑；品牌页是纯静态 HTML，body 下
   直接 append 即可，稳定且零冲突。站长指认的位置也是品牌页右侧。

   隐私口径
   --------
   对话历史只存当前页面会话内存（刷新即清），不写 localStorage、
   不发任何标识符去 Worker（请求体只有 question + history 文本）。

   样式纪律（与 top-button / bottom-button 一致）
   ----------------------------------------------
   sxg- 前缀 class、自带样式注入、幂等标记、暗色适配、
   prefers-reduced-motion 不过渡。
   ========================================================================== */
(function () {
  'use strict';

  var CFG = window.SXG_AI_CONFIG || {};
  var ENDPOINT = typeof CFG.endpoint === 'string' ? CFG.endpoint.trim() : '';

  // ---------- 未配置 endpoint：按钮照常显示（stub 模式） ----------
  // 2026-10-26 站长实测反馈：endpoint 空 = 整个隐身的设计错了——用户以为
  // 功能坏了。改为按钮永远显示；stub 模式下点开面板提示「AI 开通中」，
  // 引导部署（部署教程在 ai-worker/README.md）。
  var STUB = !ENDPOINT || !/^https?:\/\//.test(ENDPOINT);

  var BTN_ID = 'sxg-ai-fab';
  var PANEL_ID = 'sxg-ai-panel';
  var STYLE_ID = 'sxg-ai-style';
  var MAX_HISTORY = 8; // 发给 Worker 的历史条数上限（Worker 侧还有二道截断）
  // 卡通形象（B 款·粉发双马尾，2026-10-27 选定）：二次元 Q 版少女小助手（粉发双马尾+大眼高光+腮红+天平发饰/胸章），SVG 内联 data URI——
  // 零额外请求、零外部依赖，与 assets/ai-avatar.svg 同源（想换形象改那一份再重编码）。
  var AVATAR = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NCA2NCIgcm9sZT0iaW1nIiBhcmlhLWxhYmVsPSJhdmF0YXIiPgo8ZGVmcz4KPHJhZGlhbEdyYWRpZW50IGlkPSJiZyIgY3g9IjUwJSIgY3k9IjM2JSIgcj0iNjglIj4KPHN0b3Agb2Zmc2V0PSIwJSIgc3RvcC1jb2xvcj0iI2ZmZmZmZiIvPjxzdG9wIG9mZnNldD0iMTAwJSIgc3RvcC1jb2xvcj0iI2VlZjBmMyIvPgo8L3JhZGlhbEdyYWRpZW50Pgo8bGluZWFyR3JhZGllbnQgaWQ9ImhhaXIiIHgxPSIwIiB5MT0iMCIgeDI9IjAiIHkyPSIxIj4KPHN0b3Agb2Zmc2V0PSIwJSIgc3RvcC1jb2xvcj0iI0ZGQjNEMSIvPjxzdG9wIG9mZnNldD0iMTAwJSIgc3RvcC1jb2xvcj0iI0U4NEE4QSIvPgo8L2xpbmVhckdyYWRpZW50Pgo8L2RlZnM+CjxjaXJjbGUgY3g9IjMyIiBjeT0iMzIiIHI9IjMxIiBmaWxsPSJ1cmwoI2JnKSIvPgo8cGF0aCBkPSJNMTYgMzMgQzE0IDE2IDIyIDExIDMyIDExIEM0MiAxMSA1MCAxNiA0OCAzMyBDNDggNDcgNDUgNTMgNDEgNTYgTDIzIDU2IEMxOSA1MyAxNiA0NyAxNiAzMyBaIiBmaWxsPSJ1cmwoI2hhaXIpIi8+CjxyZWN0IHg9IjI4IiB5PSI0NiIgd2lkdGg9IjgiIGhlaWdodD0iOCIgcng9IjMiIGZpbGw9IiNGMEMzQTgiLz4KPHBhdGggZD0iTTIxIDY0IEMyMSA1NiAyNiA1MyAzMiA1MyBDMzggNTMgNDMgNTYgNDMgNjQgWiIgZmlsbD0iI2ZmZmZmZiIvPgo8cGF0aCBkPSJNMzIgNTMgTDI4IDU5IEwzMiA2NCBMMzYgNTkgWiIgZmlsbD0iI0U4NEE4QSIvPgo8ZWxsaXBzZSBjeD0iMzIiIGN5PSIzMyIgcng9IjEzLjUiIHJ5PSIxNC41IiBmaWxsPSIjRkZFM0QyIi8+CjxwYXRoIGQ9Ik0xOCAyNyBDMTUgNDAgMTggNTEgMjQgNTMgQzIwIDQzIDIwIDMzIDIxIDI3IFoiIGZpbGw9InVybCgjaGFpcikiLz48cGF0aCBkPSJNMTMgMzAgQzYgMzEgNCA0MCA5IDQ3IEMxMyA1MiAxOCA0OSAyMCA0MyBDMTYgMzggMTcgMzMgMTkgMzAgWiIgZmlsbD0idXJsKCNoYWlyKSIvPgo8cGF0aCBkPSJNNDYgMjcgQzQ5IDQwIDQ2IDUxIDQwIDUzIEM0NCA0MyA0NCAzMyA0MyAyNyBaIiBmaWxsPSJ1cmwoI2hhaXIpIi8+PHBhdGggZD0iTTUxIDMwIEM1OCAzMSA2MCA0MCA1NSA0NyBDNTEgNTIgNDYgNDkgNDQgNDMgQzQ4IDM4IDQ3IDMzIDQ1IDMwIFoiIGZpbGw9InVybCgjaGFpcikiLz4KPHBhdGggZD0iTTE2IDMxIEMxNiAxNiAyNCAxMiAzMyAxMiBDNDIgMTIgNDkgMTYgNDggMzEgQzQ0IDI3IDM4IDI2IDMzIDI3IEMyOCAyNiAyMiAyNyAxNiAzMSBaIiBmaWxsPSJ1cmwoI2hhaXIpIi8+CjxwYXRoIGQ9Ik0yMSAyMSBDMjUgMTUgMzEgMTMgMzYgMTQgQzMxIDE1IDI2IDE4IDIzIDIzIFoiIGZpbGw9IiNGRkQ2RTYiIG9wYWNpdHk9IjAuNTUiLz4KPHBhdGggZD0iTTIyIDI4IFEyNS41IDI2IDI5IDI4IiBzdHJva2U9IiNCMjNBNkIiIHN0cm9rZS13aWR0aD0iMS4xIiBmaWxsPSJub25lIiBzdHJva2UtbGluZWNhcD0icm91bmQiLz4KPHBhdGggZD0iTTM1IDI4IFEzOC41IDI2IDQyIDI4IiBzdHJva2U9IiNCMjNBNkIiIHN0cm9rZS13aWR0aD0iMS4xIiBmaWxsPSJub25lIiBzdHJva2UtbGluZWNhcD0icm91bmQiLz4KPGVsbGlwc2UgY3g9IjI1LjUiIGN5PSIzNCIgcng9IjMuOCIgcnk9IjQuOCIgZmlsbD0iIzJCMkIzQSIvPgo8ZWxsaXBzZSBjeD0iMzguNSIgY3k9IjM0IiByeD0iMy44IiByeT0iNC44IiBmaWxsPSIjMkIyQjNBIi8+CjxjaXJjbGUgY3g9IjI0LjEiIGN5PSIzMiIgcj0iMS42IiBmaWxsPSIjZmZmIi8+CjxjaXJjbGUgY3g9IjM3LjEiIGN5PSIzMiIgcj0iMS42IiBmaWxsPSIjZmZmIi8+CjxjaXJjbGUgY3g9IjI2LjYiIGN5PSIzNi4yIiByPSIwLjkiIGZpbGw9IiNmZmYiIG9wYWNpdHk9IjAuODUiLz4KPGNpcmNsZSBjeD0iMzkuNiIgY3k9IjM2LjIiIHI9IjAuOSIgZmlsbD0iI2ZmZiIgb3BhY2l0eT0iMC44NSIvPgo8cGF0aCBkPSJNMjEuNCAzMS4yIFEyNS41IDI4LjYgMjkuNiAzMS4yIiBzdHJva2U9IiMxNTE1MWYiIHN0cm9rZS13aWR0aD0iMS4yIiBmaWxsPSJub25lIiBzdHJva2UtbGluZWNhcD0icm91bmQiLz4KPHBhdGggZD0iTTM1LjQgMzEuMiBRMzkuNSAyOC42IDQzLjYgMzEuMiIgc3Ryb2tlPSIjMTUxNTFmIiBzdHJva2Utd2lkdGg9IjEuMiIgZmlsbD0ibm9uZSIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIi8+CjxlbGxpcHNlIGN4PSIyMSIgY3k9IjQwIiByeD0iMi40IiByeT0iMS41IiBmaWxsPSIjRkY5RUI1IiBvcGFjaXR5PSIwLjU1Ii8+CjxlbGxpcHNlIGN4PSI0MyIgY3k9IjQwIiByeD0iMi40IiByeT0iMS41IiBmaWxsPSIjRkY5RUI1IiBvcGFjaXR5PSIwLjU1Ii8+CjxwYXRoIGQ9Ik0yOS41IDQxIFEzMiA0My42IDM0LjUgNDEiIHN0cm9rZT0iI0M3NkI3QSIgc3Ryb2tlLXdpZHRoPSIxLjEiIGZpbGw9Im5vbmUiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIvPgoKPGcgdHJhbnNmb3JtPSJ0cmFuc2xhdGUoNDUsMTgpIj4KPGNpcmNsZSByPSIzLjQiIGZpbGw9IiNGRkU5QTgiIHN0cm9rZT0iI0U4NEE4QSIgc3Ryb2tlLXdpZHRoPSIwLjkiLz4KPHBhdGggZD0iTS0yLjQgMCBIMi40IE0tMi40IDAgTC0zLjMgLTEuOCBNMi40IDAgTDMuMyAtMS44IE0wIC0xLjggVjEuNiIgc3Ryb2tlPSIjRTg0QThBIiBzdHJva2Utd2lkdGg9IjAuNyIgZmlsbD0ibm9uZSIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIi8+CjxjaXJjbGUgY3g9IjAiIGN5PSIxLjkiIHI9IjAuNyIgZmlsbD0iI0U4NEE4QSIvPgo8L2c+CjxnIHRyYW5zZm9ybT0idHJhbnNsYXRlKDMyLDU5KSI+CjxjaXJjbGUgcj0iMy40IiBmaWxsPSIjZmZmZmZmIiBzdHJva2U9IiNFODRBOEEiIHN0cm9rZS13aWR0aD0iMC45Ii8+CjxwYXRoIGQ9Ik0tMi40IDAgSDIuNCBNLTIuNCAwIEwtMy4zIC0xLjggTTIuNCAwIEwzLjMgLTEuOCBNMCAtMS44IFYxLjYiIHN0cm9rZT0iI0U4NEE4QSIgc3Ryb2tlLXdpZHRoPSIwLjciIGZpbGw9Im5vbmUiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIvPgo8Y2lyY2xlIGN4PSIwIiBjeT0iMS45IiByPSIwLjciIGZpbGw9IiNFODRBOEEiLz4KPC9nPgo8L3N2Zz4=';
  var busy = false;
  var history = []; // [{role, content}] 仅当前会话内存
  var autoCloseTimer = null; // 加载后自动收起面板的定时器

  // ---------- 样式注入（一次） ----------
  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = [
      '#' + BTN_ID + '{position:fixed;right:14px;',
      'bottom:calc(210px + env(safe-area-inset-bottom, 0px));width:52px;height:52px;border-radius:50%;',
      'background:#0F766E;color:#fff;border:none;cursor:pointer;font-size:24px;line-height:1;',
      'box-shadow:0 4px 14px rgba(15,118,110,.35);z-index:9000;',
      'display:flex;align-items:center;justify-content:center;transition:transform .15s ease;',
      '-webkit-tap-highlight-color:transparent}',
      '#' + BTN_ID + ':hover{transform:scale(1.08)}',
      '#' + PANEL_ID + '{position:fixed;right:14px;',
      'bottom:calc(270px + env(safe-area-inset-bottom, 0px));width:min(340px,calc(100vw - 28px));',
      'max-height:min(520px,calc(100vh - 300px));display:flex;flex-direction:column;',
      'background:#fff;border:1px solid #e5e7eb;border-radius:14px;box-shadow:0 12px 32px rgba(0,0,0,.16);',
      'z-index:9001;overflow:hidden;font-family:system-ui,-apple-system,\'PingFang SC\',\'Microsoft YaHei\',sans-serif}',
      /* 手机端：小屏面板两侧撑满、输入 16px 防 iOS 聚焦自动缩放、按钮加大到 56px */
      '@media (max-width:640px){',
      '#' + PANEL_ID + '{left:14px;right:14px;width:auto}',
      '.sxg-ai-in{font-size:16px}',
      '#' + BTN_ID + '{width:56px;height:56px}',
      '}',
      '#' + PANEL_ID + '[hidden]{display:none}',
      '.sxg-ai-head{background:#0F766E;color:#fff;padding:10px 14px;font-size:14px;font-weight:600}',
      '.sxg-ai-head small{display:block;font-weight:400;font-size:11px;opacity:.85;margin-top:2px}',
      '.sxg-ai-log{flex:1;overflow-y:auto;padding:10px 12px;display:flex;flex-direction:column;gap:8px;background:#f9fafb}',
      '.sxg-ai-msg{max-width:86%;padding:8px 11px;border-radius:10px;font-size:13px;line-height:1.6;white-space:pre-wrap;word-break:break-word}',
      '.sxg-ai-msg.user{align-self:flex-end;background:#0F766E;color:#fff;border-bottom-right-radius:3px}',
      '.sxg-ai-msg.bot{align-self:flex-start;background:#fff;border:1px solid #e5e7eb;border-bottom-left-radius:3px;color:#1f2937}',
      '.sxg-ai-msg.err{align-self:flex-start;background:#fef2f2;border:1px solid #fecaca;color:#b91c1c}',
      '.sxg-ai-form{display:flex;gap:8px;padding:10px;border-top:1px solid #e5e7eb;background:#fff}',
      '.sxg-ai-in{flex:1;border:1px solid #d1d5db;border-radius:8px;padding:7px 10px;font-size:13px;outline:none;font-family:inherit}',
      '.sxg-ai-in:focus{border-color:#0F766E}',
      '.sxg-ai-send{background:#0F766E;color:#fff;border:none;border-radius:8px;padding:0 14px;font-size:13px;cursor:pointer}',
      '.sxg-ai-send:disabled{background:#9ca3af;cursor:not-allowed}',
      '@media (prefers-reduced-motion:reduce){#' + BTN_ID + '{transition:none}}',
      '@media (prefers-color-scheme:dark){',
      '#' + PANEL_ID + '{background:#1f2937;border-color:#374151}',
      '.sxg-ai-log{background:#111827}',
      '.sxg-ai-msg.bot{background:#1f2937;border-color:#374151;color:#e5e7eb}',
      '.sxg-ai-in{background:#111827;border-color:#374151;color:#e5e7eb}}',
    ].join('');
    document.head.appendChild(s);
  }

  // ---------- UI ----------
  function buildUI() {
    if (document.getElementById(BTN_ID)) return;

    var btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.type = 'button';
    btn.setAttribute('aria-label', 'AI 小助手');
    btn.title = 'AI 小助手';
    // 浮动按钮直接显示纯文字「AI」（2026-10-27 站长指令：去掉卡通形象，改纯文字）
    btn.textContent = 'AI';
    btn.addEventListener('click', function () { toggle(); });

    var panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.hidden = false;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', '劳动法小助手对话');

    var head = document.createElement('div');
    head.className = 'sxg-ai-head';
    head.setAttribute('style', 'display:flex;align-items:center;gap:10px');
    var headAvatar = document.createElement('img');
    headAvatar.src = AVATAR;
    headAvatar.alt = '';
    headAvatar.setAttribute('aria-hidden', 'true');
    headAvatar.setAttribute('style', 'width:30px;height:30px;flex:none');
    var headText = document.createElement('div');
    headText.innerHTML = '劳动法小助手<small style=\"display:block;font-weight:400;font-size:11px;opacity:.85;margin-top:2px\">劳动法与双休咨询 · 回答仅供参考，不构成法律意见</small>';
    head.appendChild(headAvatar);
    head.appendChild(headText);

    var log = document.createElement('div');
    log.className = 'sxg-ai-log';

    var form = document.createElement('form');
    form.className = 'sxg-ai-form';
    var input = document.createElement('input');
    input.className = 'sxg-ai-in';
    input.type = 'text';
    input.placeholder = '问点劳动法的，如：加班费怎么算';
    input.maxLength = 500;
    input.setAttribute('aria-label', '输入你的问题');
    var send = document.createElement('button');
    send.className = 'sxg-ai-send';
    send.type = 'submit';
    send.textContent = '发送';
    form.appendChild(input);
    form.appendChild(send);
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var q = input.value.trim();
      if (!q || busy) return;
      input.value = '';
      ask(q, log, send);
    });

    panel.appendChild(head);
    panel.appendChild(log);
    panel.appendChild(form);

    // 首次打开的欢迎语（本地生成，不耗 neurons）
    var hello = document.createElement('div');
    hello.className = 'sxg-ai-msg bot';
    if (STUB) {
      // stub 模式：AI 服务未接入——明说 + 引导，不发请求不装死
      hello.textContent = '你好，我是双休购的劳动法小助手。AI 服务正在开通中，暂时还不能回答问题——开通后会在这里为你解答劳动法（工时、加班费、年休假、试用期、解除补偿）与本站双休评级口径相关问题。';
    } else {
      hello.textContent = '你好，我是双休购的劳动法小助手。可以问我劳动法相关问题（工时、加班费、年休假、试用期、解除补偿），也可以问本站双休评级的口径。具体企业的最新数据请以站内搜索为准。';
    }
    log.appendChild(hello);
    if (STUB) {
      input.disabled = true;
      input.placeholder = 'AI 开通中，暂不可提问';
      send.disabled = true;
    }

    document.body.appendChild(panel);
    document.body.appendChild(btn);

    // 加载即展开面板（展示欢迎语），8 秒后自动收起，避免一直遮挡页面；
    // 用户一旦在面板内交互（点击/输入）即取消自动收起
    panel.addEventListener('pointerdown', clearAutoClose);
    startAutoClose();
  }

  // 取消「加载后自动收起」计时（用户一旦主动交互就不再强收）
  function clearAutoClose() {
    if (autoCloseTimer) {
      clearTimeout(autoCloseTimer);
      autoCloseTimer = null;
    }
  }

  // 加载后 8 秒自动收起面板，避免一直遮挡页面；只收起仍处于展开态的面板
  function startAutoClose() {
    clearAutoClose();
    autoCloseTimer = setTimeout(function () {
      var p = document.getElementById(PANEL_ID);
      if (p && !p.hidden) p.hidden = true;
      autoCloseTimer = null;
    }, 8000);
  }

  function toggle() {
    var panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    if (panel.hidden) {
      // 用户手动点开：保持展开，不触发自动收起
      panel.hidden = false;
      clearAutoClose();
    } else {
      panel.hidden = true;
      clearAutoClose();
    }
  }

  // ---------- 对话 ----------
  function addMsg(log, role, text) {
    var m = document.createElement('div');
    m.className = 'sxg-ai-msg ' + role;
    m.textContent = text;
    log.appendChild(m);
    log.scrollTop = log.scrollHeight;
    return m;
  }

  function errMsg(data) {
    if (!data || !data.error) return '服务暂时不可用，请稍后再试。';
    if (data.error === 'rate-limited') return '提问太频繁了，请一小时后再试。';
    if (data.error === 'daily-quota-exhausted') return '今日 AI 额度已用完（UTC 00:00 重置），明天再来问我吧。';
    if (data.error === 'question-required-1-to-500-chars') return '问题长度需在 1 到 500 字之间。';
    if (data.error === 'origin-not-allowed') return '本站未授权调用此服务。';
    return '服务暂时不可用，请稍后再试。';
  }

  function ask(q, log, send) {
    if (STUB) return; // 未接入：不 fetch（表单已禁用，这是双保险）
    busy = true;
    send.disabled = true;
    addMsg(log, 'user', q);

    var thinking = addMsg(log, 'bot', '思考中…');

    var payload = { question: q, history: history.slice(-MAX_HISTORY) };

    fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(function (r) {
        return r.json().then(function (data) { return { ok: r.ok, data: data }; });
      })
      .then(function (res) {
        if (res.ok && res.data && typeof res.data.answer === 'string' && res.data.answer) {
          history.push({ role: 'user', content: q });
          history.push({ role: 'assistant', content: res.data.answer });
          thinking.textContent = res.data.answer;
        } else {
          thinking.remove();
          addMsg(log, 'err', errMsg(res.data));
        }
      })
      .catch(function () {
        thinking.remove();
        addMsg(log, 'err', '网络异常：连不上 AI 服务（若页面在本地或存档环境，属正常——服务只对本站线上域名开放）。');
      })
      .then(function () {
        busy = false;
        send.disabled = false;
      });
  }

  // ---------- 启动 ----------
  function boot() {
    try {
      injectStyle();
      buildUI();
    } catch (e) {
      // 挂件绝不允许拖挂品牌页：任何异常静默退出
      if (window.console && console.warn) console.warn('[ai-chat] init failed:', e);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // 自测导出（Node 行为测试用；浏览器正常走上面的启动链）
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { MAX_HISTORY: MAX_HISTORY };
  }
})();
