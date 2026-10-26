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
  // 卡通形象（2026-10-26 站长指令）：teal 机器人小助手，SVG 内联 data URI——
  // 零额外请求、零外部依赖，与 assets/ai-avatar.svg 同源（想换形象改那一份再重编码）。
  var AVATAR = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NCA2NCIgcm9sZT0iaW1nIiBhcmlhLWxhYmVsPSLlj4zkvJHotK3lirPliqjms5XlsI/liqnmiYsiPgogIDwhLS0g5aS077ya5ZyG6KeS5pa577yMdGVhbCDkuLvoibIgLS0+CiAgPHJlY3QgeD0iMTIiIHk9IjE2IiB3aWR0aD0iNDAiIGhlaWdodD0iMzQiIHJ4PSIxMCIgZmlsbD0iIzBGNzY2RSIvPgogIDwhLS0g6ICz5L6n5aSp57q/IC0tPgogIDxsaW5lIHgxPSIzMiIgeTE9IjE2IiB4Mj0iMzIiIHkyPSI4IiBzdHJva2U9IiMwRjc2NkUiIHN0cm9rZS13aWR0aD0iMyIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIi8+CiAgPGNpcmNsZSBjeD0iMzIiIGN5PSI3IiByPSIzLjUiIGZpbGw9IiM1RUVBRDQiLz4KICA8IS0tIOmdouadv++8mua1heiJsuWGheiEuCAtLT4KICA8cmVjdCB4PSIxNyIgeT0iMjIiIHdpZHRoPSIzMCIgaGVpZ2h0PSIyMiIgcng9IjciIGZpbGw9IiMxMzRFNEEiLz4KICA8IS0tIOecvOedm++8mnRlYWwg5Lqu6Imy5ZyG54K5IC0tPgogIDxjaXJjbGUgY3g9IjI1IiBjeT0iMzEiIHI9IjMuNiIgZmlsbD0iIzVFRUFENCIvPgogIDxjaXJjbGUgY3g9IjM5IiBjeT0iMzEiIHI9IjMuNiIgZmlsbD0iIzVFRUFENCIvPgogIDwhLS0g55y86auY5YWJIC0tPgogIDxjaXJjbGUgY3g9IjI2LjIiIGN5PSIyOS44IiByPSIxLjEiIGZpbGw9IiNmZmYiLz4KICA8Y2lyY2xlIGN4PSI0MC4yIiBjeT0iMjkuOCIgcj0iMS4xIiBmaWxsPSIjZmZmIi8+CiAgPCEtLSDlvq7nrJHlmLTvvJrlnIblvKcgLS0+CiAgPHBhdGggZD0iTTI2IDM4IFEzMiA0MyAzOCAzOCIgc3Ryb2tlPSIjNUVFQUQ0IiBzdHJva2Utd2lkdGg9IjIuNCIgZmlsbD0ibm9uZSIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIi8+CiAgPCEtLSDoha7nuqLvvJrlj4vlpb3mhJ8gLS0+CiAgPGNpcmNsZSBjeD0iMjEuNSIgY3k9IjM2IiByPSIyLjIiIGZpbGw9IiNGOUE4RDQiIG9wYWNpdHk9Ii43Ii8+CiAgPGNpcmNsZSBjeD0iNDIuNSIgY3k9IjM2IiByPSIyLjIiIGZpbGw9IiNGOUE4RDQiIG9wYWNpdHk9Ii43Ii8+CiAgPCEtLSDkvqfogLMgLS0+CiAgPHJlY3QgeD0iNyIgeT0iMjgiIHdpZHRoPSI1IiBoZWlnaHQ9IjEwIiByeD0iMi41IiBmaWxsPSIjMEY3NjZFIi8+CiAgPHJlY3QgeD0iNTIiIHk9IjI4IiB3aWR0aD0iNSIgaGVpZ2h0PSIxMCIgcng9IjIuNSIgZmlsbD0iIzBGNzY2RSIvPgogIDwhLS0g6Lqr5L2T77ya5bCP5LiA54K577yM5ZCR5LiLIC0tPgogIDxyZWN0IHg9IjIwIiB5PSI1MCIgd2lkdGg9IjI0IiBoZWlnaHQ9IjEwIiByeD0iNSIgZmlsbD0iIzBGNzY2RSIvPgogIDwhLS0g5rOV5b6954K557yA77ya6IO45YmN5bCP5aSp5bmz77yI5Yqz5Yqo5rOV5oSP6LGh77yJIC0tPgogIDxjaXJjbGUgY3g9IjMyIiBjeT0iNTUiIHI9IjQiIGZpbGw9IiM1RUVBRDQiLz4KICA8cGF0aCBkPSJNMjkuNiA1NWg0LjhNMzIgNTMuMnYzLjYiIHN0cm9rZT0iIzEzNEU0QSIgc3Ryb2tlLXdpZHRoPSIxIiBzdHJva2UtbGluZWNhcD0icm91bmQiLz4KPC9zdmc+Cg==';
  var busy = false;
  var history = []; // [{role, content}] 仅当前会话内存

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
    btn.setAttribute('aria-label', '劳动法小助手');
    btn.title = '劳动法小助手';
    // 卡通形象（SVG data URI，见常量区 AVATAR 注释）
    var avatarImg = document.createElement('img');
    avatarImg.src = AVATAR;
    avatarImg.alt = '';
    avatarImg.setAttribute('aria-hidden', 'true');
    avatarImg.setAttribute('style', 'width:34px;height:34px;display:block;pointer-events:none');
    btn.appendChild(avatarImg);
    btn.addEventListener('click', function () { toggle(); });

    var panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.hidden = true;
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
  }

  function toggle() {
    var panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    panel.hidden = !panel.hidden;
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
