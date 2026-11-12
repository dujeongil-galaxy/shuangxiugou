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

  // ---------- 双线路接入点（2026-11-13 分流改造） ----------
  // endpoint   → 线路 cf：Cloudflare Worker（ai-worker/）——形象 A/B/C 走这条
  // endpointCN → 线路 cn：阿里云函数计算 FC（ai-worker-aliyun/）——形象 D/E/F 走这条
  // 只有「两条线路都不可用」才算未开通；仅 cn 空 → D/E/F 回落 cf 并在面板明说。
  function normUrl(v) {
    return (typeof v === 'string' && /^https?:\/\//.test(v.trim())) ? v.trim() : '';
  }
  var CFG = window.SXG_AI_CONFIG || {};
  var ENDPOINT = normUrl(CFG.endpoint);      // 线路 cf（Cloudflare）
  var ENDPOINT_CN = normUrl(CFG.endpointCN); // 线路 cn（阿里云函数计算）

  // ---------- 两条线路都不可用：按钮照常显示（stub 模式） ----------
  // 2026-10-26 站长实测反馈：endpoint 空 = 整个隐身的设计错了——用户以为
  // 功能坏了。改为按钮永远显示；stub 模式下点开面板提示「AI 开通中」，
  // 引导部署（部署教程在 ai-worker/README.md 与 ai-worker-aliyun/README.md）。
  var STUB = !ENDPOINT && !ENDPOINT_CN;

  var BTN_ID = 'sxg-ai-fab';
  var PANEL_ID = 'sxg-ai-panel';
  var STYLE_ID = 'sxg-ai-style';
  var MAX_HISTORY = 8; // 发给 Worker 的历史条数上限（Worker 侧还有二道截断）
  // ---------- 卡通形象：6 套二次元头像，可自由切换，cookie 记忆 ----------
  // 2026-10-27 站长指令：此前临时上线的 B 款（粉发双马尾）「并不适用于这种图标」，
  // 改回二次元头像、默认 A 款（青绿双马尾）；其余 5 套一并上传，共 6 套可选。
  // 面板头部头像可点击，弹出 6 个缩略图自由切换，选择写入浏览器 Cookie（1 年），刷新/换页不丢。
  // 头像文件置于仓库根 assets/ai-avatars/{A..F}.svg，由脚本自身 URL 推导绝对路径，
  // 避免品牌页（../ai-chat.js）等不同页面深度下 404；SVG 矢量，任意尺寸清晰。
  var SCRIPT_SRC = '';
  try {
    if (document.currentScript && document.currentScript.src) SCRIPT_SRC = document.currentScript.src;
    else { var _s = document.querySelector('script[src*="ai-chat.js"]'); if (_s) SCRIPT_SRC = _s.src; }
  } catch (e) {}
  function avatarBase() {
    if (!SCRIPT_SRC) return 'assets/ai-avatars/';
    try { return new URL('assets/ai-avatars/', SCRIPT_SRC).href; } catch (e) { return 'assets/ai-avatars/'; }
  }
  var AVATAR_BASE = avatarBase();
  var AVATAR_VER = '12'; // 与 ai-chat.js?v= 同步，便于强制刷新头像缓存
  var AVATARS = [
    { id: 'A', name: '青绿双马尾' },
    { id: 'B', name: '粉发双马尾' },
    { id: 'C', name: '梦幻紫' },
    { id: 'D', name: '暖金黄' },
    { id: 'E', name: '天空蓝' },
    { id: 'F', name: '蜜糖棕' }
  ];
  var AVATAR_COOKIE = 'sxg_ai_avatar';
  var AVATAR_DEFAULT = 'A';
  function avatarSrc(id) { return AVATAR_BASE + id + '.svg?v=' + AVATAR_VER; }
  function getCookie(n) {
    try {
      var m = document.cookie.match(new RegExp('(?:^|; )' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '=([^;]*)'));
      return m ? decodeURIComponent(m[1]) : '';
    } catch (e) { return ''; }
  }
  function setCookie(n, v, days) {
    try {
      var t = new Date();
      t.setTime(t.getTime() + days * 864e5);
      document.cookie = n + '=' + encodeURIComponent(v) + '; expires=' + t.toUTCString() + '; path=/; SameSite=Lax';
    } catch (e) {}
  }
  function currentAvatarId() {
    var c = getCookie(AVATAR_COOKIE);
    for (var i = 0; i < AVATARS.length; i++) if (AVATARS[i].id === c) return c;
    return AVATAR_DEFAULT;
  }

  // ---------- 线路分流（形象 A/B/C → cf，D/E/F → cn；cn 空则回落 cf） ----------
  // 2026-11-13 站长指令：前三个形象走 Cloudflare、后三个走阿里云，让国内用户少开 VPN。
  // 三条纪律：① 回落后请求体里的 route 记**实际**线路（服务端要据此说明）；
  //          ② 回落必须在面板里可见（线路条 + 一句话），不许静默；
  //          ③ 网络异常文案按线路分别措辞——阿里云是境内直连，不能叫用户开 VPN。
  var ROUTE_SPLIT = 3; // 索引 0/1/2 → cf；3/4/5 → cn
  var ROUTE_LABEL = { cf: 'Cloudflare', cn: '阿里云' };
  var ROUTE_FULL = { cf: 'Cloudflare Workers · 海外节点', cn: '阿里云函数计算 · 境内直连' };
  function avatarIndex(id) {
    for (var i = 0; i < AVATARS.length; i++) if (AVATARS[i].id === id) return i;
    return 0;
  }
  // 形象「本应」走哪条线：只看索引，不看是否配置
  function wantedRoute(id) {
    return avatarIndex(id) < ROUTE_SPLIT ? 'cf' : 'cn';
  }
  function hasRoute(r) { return r === 'cn' ? !!ENDPOINT_CN : !!ENDPOINT; }
  function endpointOf(r) { return r === 'cn' ? ENDPOINT_CN : ENDPOINT; }
  // 实际走哪条线：期望线路没配 → 回落另一条（fallback=true，供 UI 明说）
  function resolveRoute(id) {
    var want = wantedRoute(id);
    if (hasRoute(want)) return { want: want, route: want, fallback: false };
    var other = want === 'cf' ? 'cn' : 'cf';
    if (hasRoute(other)) return { want: want, route: other, fallback: true };
    return { want: want, route: '', fallback: false };
  }
  function routeBadgeText(rs) {
    if (!rs.route) return '线路：未开通（两条线路都还没配接入点）';
    if (rs.fallback) return '线路：' + ROUTE_LABEL[rs.route] + '（' + ROUTE_LABEL[rs.want] + ' 接入点未配置，本次已回落）';
    return '线路：' + ROUTE_LABEL[rs.route] + '（' + (rs.route === 'cn' ? '境内直连，通常无需 VPN' : '海外节点，国内网络需 VPN') + '）';
  }
  // 切换形象后必须跟着变，否则线路对用户是「看不见的黑盒」
  function syncRouteBadge(rs) {
    var el = document.getElementById('sxg-ai-route');
    if (!el) return;
    el.textContent = routeBadgeText(rs);
    if (rs.fallback || !rs.route) el.className = 'sxg-ai-route warn';
    else el.className = 'sxg-ai-route';
  }

  // 网络异常文案按线路分别措辞（模型/线路不同，自救办法本来就不同）
  var NET_ERR = {
    cf: '⚠️ 网络异常——连不上 AI 服务。本站 Cloudflare 线路由 Cloudflare Workers 提供，国内网络无法直接访问，需开启 VPN：https://47.112.97.173:8000/register?aff=v17mHNYv ',
    cn: '⚠️ 网络异常——连不上 AI 服务。当前走的是阿里云线路（境内直连），一般无需代理，请稍后重试；若持续失败，可点右上角「切换形象」换回 A/B/C 形象改走 Cloudflare 线路。'
  };

  var busy = false;
  var history = []; // [{role, content}] 仅当前会话内存
  var autoCloseTimer = null; // 加载后自动收起面板的定时器

  // ---------- 样式注入（一次） ----------
  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = [
      /* 2026-11-05 站长拍板：AI 挂件整体挪到左下角。
         右下角那格本来住着「回到顶部」钮（≥1440 时距底 6px），
         2026-11-04 把 AI 钮锚到距底 14px 后两钮几乎同心叠住（暗色模式下
         回顶部钮是深黑圆，站长截图指出）；窄屏档还会与「视频」钮重叠。
         挪左下后：按钮贴左下角（距底 14px），面板从按钮正上方起长
         （距底 76px = 14 + 52 按钮高 + 10 间隙），max-height 用 100vh 减去
         广告条高度再留 200px 顶边距，面板顶端永不进入首屏 Hero/统计卡区。
         面板改左锚定后与右上良配广告卡不再同列，旧的 :has() 避让规则已拔除。 */
      '#' + BTN_ID + '{position:fixed;left:14px;',
      'bottom:calc(var(--sxg-bar-h, 0px) + 14px + env(safe-area-inset-bottom, 0px));width:52px;height:52px;border-radius:50%;',
      'background:#0F766E;color:#fff;border:none;cursor:pointer;font-size:24px;line-height:1;',
      'box-shadow:0 4px 14px rgba(15,118,110,.35);z-index:9000;',
      'display:flex;align-items:center;justify-content:center;transition:transform .15s ease;',
      '-webkit-tap-highlight-color:transparent}',
      '#' + BTN_ID + ':hover{transform:scale(1.08)}',
      '#' + PANEL_ID + '{position:fixed;left:14px;',
      'bottom:calc(var(--sxg-bar-h, 0px) + 76px + env(safe-area-inset-bottom, 0px));width:min(340px,calc(100vw - 28px));',
      'max-height:min(480px, calc(100vh - var(--sxg-bar-h, 0px) - 200px));display:flex;flex-direction:column;',
      'background:#fff;border:1px solid #e5e7eb;border-radius:14px;box-shadow:0 12px 32px rgba(0,0,0,.16);',
      'z-index:9001;overflow:hidden;font-family:system-ui,-apple-system,\'PingFang SC\',\'Microsoft YaHei\',sans-serif}',
      /* 手机端：首页左下住着导航折叠主按钮（nav-menu.js，bar-h+48 起 46px 高），
         AI 钮抬高到它上方（bar-h+104），面板再从 AI 钮上方起长（bar-h+170），
         高度钳制同步多让 90px，面板顶端同样不进首屏上部。 */
      '@media (max-width:640px){',
      '#' + BTN_ID + '{left:14px;bottom:calc(var(--sxg-bar-h, 0px) + 104px + env(safe-area-inset-bottom, 0px))}',
      '#' + PANEL_ID + '{left:14px;right:14px;width:auto;bottom:calc(var(--sxg-bar-h, 0px) + 170px + env(safe-area-inset-bottom, 0px));max-height:min(480px, calc(100vh - var(--sxg-bar-h, 0px) - 290px))}',
      '.sxg-ai-in{font-size:16px}',
      '#' + BTN_ID + '{width:56px;height:56px}',
      '}',
      '#' + PANEL_ID + '[hidden]{display:none}',
      '.sxg-ai-head{background:#0F766E;color:#fff;padding:10px 14px;font-size:14px;font-weight:600}',
      '.sxg-ai-head small{display:block;font-weight:400;font-size:11px;opacity:.85;margin-top:2px}',
      /* 线路条：面板头部下沿一整行，永远看得见当前走的是哪条线路（切换形象即同步） */
      '.sxg-ai-route{padding:5px 14px;font-size:11px;line-height:1.45;background:#ecfdf5;color:#0F766E;border-bottom:1px solid #d1fae5}',
      '.sxg-ai-route.warn{background:#fef3c7;color:#92400e;border-bottom-color:#fde68a}',
      '@media (prefers-color-scheme:dark){.sxg-ai-route{background:#064e3b;color:#6ee7b7;border-bottom-color:#065f46}.sxg-ai-route.warn{background:#451a03;color:#fcd34d;border-bottom-color:#78350f}}','#sxg-ai-head-avatar{transition:box-shadow .12s,transform .12s;border-radius:50%}','#sxg-ai-head-avatar:hover{box-shadow:0 0 0 2px rgba(255,255,255,.8)}','.sxg-ai-swap{margin-left:auto;display:inline-flex;align-items:center;gap:4px;background:rgba(255,255,255,.16);color:#fff;border:1px solid rgba(255,255,255,.45);border-radius:8px;padding:4px 9px;font-size:12px;font-weight:500;cursor:pointer;line-height:1.2;font-family:inherit;white-space:nowrap;flex:none}','.sxg-ai-swap:hover{background:rgba(255,255,255,.3)}',
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
      '.sxg-ai-avatar-pop{position:absolute;top:48px;left:10px;z-index:9002;background:#fff;border:1px solid #e5e7eb;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.18);padding:8px;display:grid;grid-template-columns:repeat(3,1fr);gap:6px;width:160px}',
      '.sxg-ai-avatar-pop[hidden]{display:none}',
      '.sxg-ai-avatar-pop button{padding:0;border:2px solid transparent;border-radius:8px;background:#f3f4f6;cursor:pointer;width:44px;height:44px;display:flex;align-items:center;justify-content:center;transition:border-color .12s,transform .12s}',
      '.sxg-ai-avatar-pop button:hover{border-color:#94a3b8;transform:scale(1.05)}',
      '.sxg-ai-avatar-pop button.sel{border-color:#0F766E;background:#ecfdf5}',
      '.sxg-ai-avatar-pop img{width:34px;height:34px;display:block}',
      '@media (prefers-color-scheme:dark){.sxg-ai-avatar-pop{background:#1f2937;border-color:#374151}.sxg-ai-avatar-pop button{background:#374151}.sxg-ai-avatar-pop button.sel{background:#064e3b}}',
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

    // 移动端（<1440px）：AI 面板默认收起。
    // 首访全宽自动展开在中小屏上会一次性盖住近半屏内容，且手机端用户
    // 多半只是路过；桌面端（≥1440px）保持「首访展开 + 8 秒收起」。
    // 判定用 matchMedia，jsdom（无 matchMedia）会短路为 false → 走桌面逻辑，单测稳定。
    var isCompact = !!(window.matchMedia && window.matchMedia('(max-width: 1439px)').matches);
    var panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.hidden = isCompact;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', '劳动法小助手对话');

    var head = document.createElement('div');
    head.className = 'sxg-ai-head';
    head.setAttribute('style', 'display:flex;align-items:center;gap:10px');
    var headAvatar = document.createElement('img');
    headAvatar.id = 'sxg-ai-head-avatar';
    headAvatar.src = avatarSrc(currentAvatarId());
    headAvatar.alt = '';
    headAvatar.setAttribute('aria-hidden', 'true');
    headAvatar.setAttribute('style', 'width:30px;height:30px;flex:none;cursor:pointer');
    headAvatar.title = '点击更换头像（当前：' + currentAvatarId() + '）';
    headAvatar.addEventListener('click', function (ev) {
      ev.stopPropagation();
      toggleAvatarPop();
    });
    headAvatar.onerror = function () { headAvatar.style.visibility = 'hidden'; };
    var headText = document.createElement('div');
    headText.innerHTML = '劳动法小助手<small style=\"display:block;font-weight:400;font-size:11px;opacity:.85;margin-top:2px\">劳动法与双休咨询 · 回答仅供参考，不构成法律意见</small>';
    head.appendChild(headAvatar);
    head.appendChild(headText);

    // 可见的「切换形象」入口：标题栏右侧带文字按钮，点开同一弹层（解决“找不到在哪换”）
    var swapBtn = document.createElement('button');
    swapBtn.type = 'button';
    swapBtn.className = 'sxg-ai-swap';
    swapBtn.textContent = '切换形象';
    swapBtn.setAttribute('aria-label', '切换 AI 形象');
    swapBtn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      toggleAvatarPop();
    });
    head.appendChild(swapBtn);

    // 头像切换弹层（点击面板头部头像弹出，6 个缩略图自由切换）
    buildAvatarPopover(panel);
    document.addEventListener('click', function () {
      var p = document.getElementById('sxg-ai-avatar-pop');
      if (p) p.hidden = true;
    });

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

    // 线路条（头部下沿，全宽）：首次打开即告知当前走 Cloudflare 还是阿里云
    var routeEl = document.createElement('div');
    routeEl.id = 'sxg-ai-route';
    routeEl.className = 'sxg-ai-route';
    routeEl.setAttribute('role', 'status');
    panel.appendChild(routeEl);
    panel.appendChild(log);
    panel.appendChild(form);

    // 首次打开的欢迎语（本地生成，不耗 neurons）
    var hello = document.createElement('div');
    hello.className = 'sxg-ai-msg bot';
    if (STUB) {
      // stub 模式：AI 服务未接入——明说 + 引导，不发请求不装死
      hello.innerHTML = linkify('你好，我是双休购的劳动法小助手。AI 服务正在开通中，暂时还不能回答问题——开通后会在这里为你解答劳动法（工时、加班费、年休假、试用期、解除补偿）与本站双休评级口径相关问题。');
    } else {
      var rs0 = resolveRoute(currentAvatarId());
      var routeLine;
      if (rs0.route === 'cn') {
        routeLine = '当前形象走阿里云线路（' + ROUTE_FULL.cn + '），境内网络直连、通常不需要 VPN。';
      } else if (rs0.fallback) {
        routeLine = '当前形象本应走阿里云线路，但阿里云接入点（endpointCN）尚未配置，已自动回落 Cloudflare 线路；想境内直连请等站长把空填上。';
      } else {
        routeLine = '当前形象走 Cloudflare 线路（' + ROUTE_FULL.cf + '），模型 GLM-4.7-flash，国内网络需开启 VPN（站长推荐：https://47.112.97.173:8000/register?aff=v17mHNYv ）；或 Login GitHub 并 Starred 本仓库满 7 天，解锁阿里云通义千问国内高速服务。想要境内直连：点右上角「切换形象」换到 D / E / F 三个形象，走阿里云线路。';
      }
      hello.innerHTML = linkify('你好，我是双休购的劳动法小助手。可以问我劳动法相关问题（工时、加班费、年休假、试用期、解除补偿），也可以问本站双休评级的口径。具体企业的最新数据请以站内搜索为准。\n\n' + routeLine);
    }
    log.appendChild(hello);
    if (STUB) {
      input.disabled = true;
      input.placeholder = 'AI 开通中，暂不可提问';
      send.disabled = true;
    }

    document.body.appendChild(panel);
    document.body.appendChild(btn);
    // 线路条首帧文案：必须在 panel 挂进 body 之后（此前 getElementById 还查不到）
    syncRouteBadge(resolveRoute(currentAvatarId()));

    // 手机端几何：实测站点 header 下沿写进 --sxg-ai-top，面板贴在它下面；
    // visualViewport 高度写进 --sxg-ai-vh，软键盘弹出时只缩高不挪位
    // （手机端原来按 bottom + 100vh 反推，键盘一来面板就被顶出屏幕）。
    if (isCompact) setupMobileGeometry(panel);
    // 加载即展开面板（展示欢迎语），8 秒后自动收起，避免一直遮挡页面；
    // 用户一旦在面板内交互（点击/输入）即取消自动收起。
    // 移动端默认已收起（panel.hidden=isCompact），不再启动自动收起计时。
    panel.addEventListener('pointerdown', clearAutoClose);
    if (!isCompact) startAutoClose();
  }

  // ---------- 手机端面板几何 ----------
  // 只用两个变量：--sxg-ai-top（header 下沿，像素）与 --sxg-ai-vh（可视视口高）。
  // 不量 header 高度硬编码：菜单折叠、公告条出现都会改高度，写死 64px 必然错位。
  function setupMobileGeometry(panel) {
    var root = document.documentElement;
    function headerBottom() {
      var best = 0;
      // 站点顶栏不是 <header> 标签就是 .sxg-header* 容器；取「贴顶且最高」的那个
      var sels = ['.sxg-header', 'header', '#sxg-header-menu', '.sxg-header-bar'];
      for (var i = 0; i < sels.length; i++) {
        var el = document.querySelector(sels[i]);
        if (!el) continue;
        var r = el.getBoundingClientRect();
        // 站点 header 不在 y=0：手机浏览器顶部还有地址栏/状态条，实测 header 顶边
        // 会落在 40~120 之间（站长截图里是 49）。门槛放到 140，否则量不到 → 面板压住 header。
        if (r.height > 0 && r.top <= 140 && r.bottom > best && r.bottom <= 200) best = r.bottom;
      }
      return best || 64;
    }
    function apply() {
      var top = headerBottom();
      root.style.setProperty('--sxg-ai-top', Math.round(top) + 'px');
      var vv = window.visualViewport;
      var vh = (vv && vv.height) ? vv.height : window.innerHeight;
      root.style.setProperty('--sxg-ai-vh', Math.round(vh) + 'px');
    }
    apply();
    // 面板展开时再量一次：键盘已经弹起、地址栏收起等都会改变可用高度
    var btn = document.getElementById(BTN_ID);
    if (btn) btn.addEventListener('click', apply);
    panel.addEventListener('focusin', apply);
    window.addEventListener('resize', apply);
    window.addEventListener('orientationchange', apply);
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', apply);
      window.visualViewport.addEventListener('scroll', apply);
    }
  }

  // 切换头像弹层显隐（头像与「切换形象」按钮共用）
  function toggleAvatarPop() {
    var pop = document.getElementById('sxg-ai-avatar-pop');
    if (pop) pop.hidden = !pop.hidden;
  }

  // ---------- 头像切换（cookie 记忆） ----------
  function buildAvatarPopover(panel) {
    var pop = document.createElement('div');
    pop.id = 'sxg-ai-avatar-pop';
    pop.className = 'sxg-ai-avatar-pop'; // 关键：CSS 用 .sxg-ai-avatar-pop 类选择器，缺这行会导致样式全失效、头像按 512px 原始尺寸撑爆面板
    pop.hidden = true;
    pop.setAttribute('role', 'menu');
    pop.setAttribute('aria-label', '选择头像');
    AVATARS.forEach(function (a) {
      var b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('data-id', a.id);
      b.setAttribute('role', 'menuitem');
      b.title = a.name + '（' + a.id + '）';
      if (a.id === currentAvatarId()) b.classList.add('sel');
      var im = document.createElement('img');
      im.src = avatarSrc(a.id);
      im.alt = '';
      im.setAttribute('aria-hidden', 'true');
      im.setAttribute('style', 'width:34px;height:34px;display:block');
      im.onerror = function () { this.style.visibility = 'hidden'; };
      b.appendChild(im);
      b.addEventListener('click', function (ev) {
        ev.stopPropagation();
        selectAvatar(a.id);
      });
      pop.appendChild(b);
    });
    panel.appendChild(pop);
  }

  function selectAvatar(id) {
    var valid = false;
    for (var i = 0; i < AVATARS.length; i++) if (AVATARS[i].id === id) valid = true;
    if (!valid) return;
    var img = document.getElementById('sxg-ai-head-avatar');
    if (img) {
      img.src = avatarSrc(id);
      img.title = '点击更换头像（当前：' + id + '）';
      img.style.visibility = '';
    }
    setCookie(AVATAR_COOKIE, id, 365);
    // 线路跟着形象走：切完立刻刷线路条；若发生回落，在对话里再说一句（不许静默）
    var rs = resolveRoute(id);
    syncRouteBadge(rs);
    if (rs.fallback) {
      var lg = document.querySelector('.sxg-ai-log');
      if (lg) {
        addMsg(lg, 'bot', '已切到形象 ' + id + '：该形象应走阿里云线路，但阿里云接入点（endpointCN）尚未配置，本次已自动回落 Cloudflare 线路，国内网络可能仍需 VPN。');
      }
    }
    var pop = document.getElementById('sxg-ai-avatar-pop');
    if (pop) {
      var btns = pop.querySelectorAll('button');
      for (var j = 0; j < btns.length; j++) {
        btns[j].classList.toggle('sel', btns[j].getAttribute('data-id') === id);
      }
      pop.hidden = true;
    }
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
      if (p && !p.hidden) {
        p.hidden = true;
      }
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
  // 把文本里的 URL 自动转成可点击链接
  function linkify(text) {
    return text.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" rel="noopener" style="color:inherit;text-decoration:underline;word-break:break-all">$1</a>');
  }

  function addMsg(log, role, text) {
    var m = document.createElement('div');
    m.className = 'sxg-ai-msg ' + role;
    m.innerHTML = linkify(text);
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
    // 分流：按当前形象的索引选线路（cn 未配 → 回落 cf），route 记**实际**线路
    var rs = resolveRoute(currentAvatarId());
    if (!rs.route) return; // 兜底：理论上 STUB 已拦住
    var route = rs.route;
    busy = true;
    send.disabled = true;
    addMsg(log, 'user', q);

    var thinking = addMsg(log, 'bot', '思考中…');

    // route 字段给服务端做「如实说明本次由哪条线路服务」的依据（前端只说明用）
    var payload = { question: q, history: history.slice(-MAX_HISTORY), route: route };

    fetch(endpointOf(route), {
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
        // 阿里云是境内直连，失败文案里绝不出现「需要开 VPN」——那是 Cloudflare 的自救法
        addMsg(log, 'err', NET_ERR[route] || NET_ERR.cf);
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
