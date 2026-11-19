/* ==========================================================================
   良配 · 限时推广广告位 —— 渲染与交互
   --------------------------------------------------------------------------
   ⚠️ 关键点：推广链接是微信小程序 scheme（#小程序://良配/B1ZcfI0N4ii3skj）。
      这种链接无法在网页里直接打开，微信的玩法是：
      复制口令 → 粘贴到任意聊天窗口并发送 → 点自己刚发出的那条消息，
      微信会把它识别成小程序卡片并唤起。
      所以按环境分支：
        · 微信内 → 直接跳转 scheme，唤起小程序
        · 微信外 → 复制口令，并弹居中弹窗给出上述发送步骤
          （2026-11-19 站长指令：原黑色小 toast 改为正经弹窗，
           上文步骤提示、下文口令链接，常驻不自动消失）
   ========================================================================== */
(function () {
  'use strict';

  var CONFIG = {
    // aria-label 与 LOGO 用的短名，保持「良配」两字
    brand: '良配',
    // 品牌行（LOGO 下方的第一行文字）。
    // 2026-10-18 用户要求拆成两行：
    //   第 1 行「限时推广」—— 左对齐，压在 LOGO 上方；
    //   第 2 行「良配 - AI婚恋」—— 继续居中，LOGO 与它的位置不动。
    // 两行都必须是 nowrap（品牌行 14 个字符在竖排 176px 卡片里放不下会被挤断）。
    // 2026-10-19 站长指示：去掉「（限时推广）」外层的全角括号，只留「限时推广」四个字。
    limitLine: '限时推广',
    brandLine: '良配 - AI婚恋',
    // 官方未公布活动结束时间，故不设倒计时
    // 2026-10-16 去掉徽标（CONFIG.badge 及其 DOM 节点已一并删除），
    // 「AI 婚恋」这类品类标签不再单独占一行，
    // 并入上方的品牌行，省下的空间给正文，把字号放大。
    title: '注册即送<br>喜茶 20 元<br>无门槛消费红包',
    cta: '立即注册',
    note: '微信小程序 · 推广合作',
    scheme: '#小程序://良配/B1ZcfI0N4ii3skj',
    storageKey: 'lp_ad_dismissed_at',
    // 2026-11-18 站长要求：LOGO 用站内现成的喜茶 logo（首页品牌卡同一份），
    // 不再自己画紫底白字「良配」。图片加载失败才退回文字。
    logoSrc: './assets/heytea.png',
    // 关闭后多久再展示（毫秒），7 天
    reappearAfter: 7 * 24 * 60 * 60 * 1000,
    // 2026-11-18 站长反馈：恢复上线后广告仍要等一会儿才出现，要求秒级显示。
    // 6000ms 是 2026-10-29 为躲「加载即弹」误判设的，如今首屏渲染早已稳定。
    // 沿用 0da3a15（星巴克推广条）已真渲染验证的方案：200ms 近乎即时，
    // 仍留约一帧 + CSS opacity 淡入，不回退到 0ms 的「加载即弹」老坑。
    showAfter: 200
  };

  var LOGO_TEXT = '良配';
  var LOGO_ALT = '喜茶';

  /* 品牌 LOGO：优先用站内现成喜茶图（assets/heytea.png），
     加载失败退回文字「良配」，离线或换图时不至于开天窗。
     onerror 必须在 img 标签内联：外部 JS 兜底时图片往往已经报过错。 */
  function logoHtml() {
    return '<img class="lp-ad__logo__img" src="' + CONFIG.logoSrc + '" alt="' + LOGO_ALT + '" ' +
      'onerror="this.style.display=\'none\';this.parentNode.classList.add(\'is-fallback\');this.parentNode.textContent=\'' + LOGO_TEXT + '\'">';
  }

  // 2026-10-18 站长指示：不再做「关闭后 7 天不再显示」的记忆 ——
  // 点关闭只隐藏本次页面，刷新后广告重新出现（原 localStorage 逻辑停用）。
  function isDismissedRecently() {
    return false;
  }

  function markDismissed() {
    // 空操作：不再写 localStorage
  }

  function isWeChat() {
    return /MicroMessenger/i.test(navigator.userAgent);
  }

  /* 把文本写入剪贴板。
     ⚠️ 这里有两个实测踩到的坑，顺序不能改：

     1) document.execCommand('copy') 的返回值不可信。选区为空、元素不可聚焦
        时它照样返回 true，但剪贴板里什么都没有。结果就是 UI 提示「已复制」，
        用户粘贴出来是空的。

     2) 用户手势只在「点击事件的同步执行栈」内有效。一旦写成
        promise.then(...) 或 setTimeout，浏览器就认为手势已结束，
        真正的复制会被静默拒绝。所以 execCommand 必须同步调用，
        不能放进 Promise 链里。

     因此这里的顺序是：同步 execCommand 打头（趁手势还在），
     异步 clipboard API 兜底（现代浏览器里最稳），最后手动复制提示。 */
  function copyText(text) {
    // 第 1 级：同步执行，必须留在点击回调的同步栈里
    var syncOk = copySync(text);

    // 第 2 级：clipboard API。已在异步阶段，只能作为补充。
    return tryClipboardApi(text)
      .then(function () { return true; })
      .catch(function () { return syncOk; });
  }

  /* 同步复制：接管 copy 事件用 setData 显式写入。
     这是本次实测中最可靠的一条——不依赖选区状态，
     clipboardData 在事件内可完整回读验证内容。 */
  function copySync(text) {
    try {
      var onCopy = function (e) {
        if (!e.clipboardData) return;
        e.clipboardData.setData('text/plain', text);
        e.preventDefault();
      };
      document.addEventListener('copy', onCopy);
      var ok = document.execCommand('copy');
      document.removeEventListener('copy', onCopy);
      return !!ok;
    } catch (err) {
      return false;
    }
  }

  // clipboard API 兜底（iOS Safari / 移动端 WebView 下 execCommand 常被禁）
  function tryClipboardApi(text) {
    if (!navigator.clipboard || !navigator.clipboard.writeText) {
      return Promise.reject(new Error('clipboard api unavailable'));
    }
    return navigator.clipboard.writeText(text);
  }

  /* ---------- 复制口令后的居中弹窗 ----------
     2026-11-19 站长指令：原黑色小 toast 又小又挤、压在正文上还 15 秒自动消失，
     改成正经弹窗，结构按站长口径「上文提示，下文给链接」：
       上文 = 怎么用口令打开小程序的步骤说明；
       下文 = 小程序口令本体（可点再复制）+「复制口令」按钮。
     常驻显示不自动消失；× / 点遮罩 / Esc 三种方式关闭。
     隐藏方案用 display:none↔flex 硬切换 + card animation 播放入场：
     不碰 opacity/visibility 过渡（.lp-ad.is-hidden 2026-11-18 卡帧老坑不复发）。 */
  var modalEl = null;

  function ensureModal() {
    if (modalEl) return modalEl;
    modalEl = document.createElement('div');
    modalEl.className = 'lp-modal';
    modalEl.setAttribute('role', 'dialog');
    modalEl.setAttribute('aria-modal', 'true');
    modalEl.setAttribute('aria-label', '打开' + CONFIG.brand + '小程序');
    modalEl.innerHTML =
      '<div class="lp-modal__mask"></div>' +
      '<div class="lp-modal__card">' +
        '<button class="lp-modal__close" type="button" aria-label="关闭弹窗">&times;</button>' +
        '<div class="lp-modal__title"></div>' +
        '<div class="lp-modal__caution" role="note">' +
          '<strong>⚠ 注册须知</strong>' +
          '<p>小程序由 AI 审核注册资料，资料填写请真实完整。若过于敷衍，可能被判定「与平台价值观不符」而封禁账号，邀请也不算成功。</p>' +
        '</div>' +
        '<div class="lp-modal__steps">' +
          '<p>① 复制下方口令，粘贴到微信任意聊天窗口并发送</p>' +
          '<p>② 点自己刚发出的那条消息，微信会把它识别成小程序卡片并唤起</p>' +
        '</div>' +
        '<code class="lp-modal__code">' + CONFIG.scheme + '</code>' +
        '<button class="lp-modal__copy" type="button">复制口令</button>' +
        '<div class="lp-modal__note">微信小程序 · ' + CONFIG.brand + '（推广合作）</div>' +
      '</div>';
    document.body.appendChild(modalEl);

    function closeModal() {
      modalEl.classList.remove('is-show');
    }
    modalEl.querySelector('.lp-modal__close').addEventListener('click', closeModal);
    modalEl.querySelector('.lp-modal__mask').addEventListener('click', closeModal);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && modalEl.classList.contains('is-show')) closeModal();
    });

    // 口令本体支持点击再复制：自动复制万一没生效，点口令也能立刻补上
    modalEl.querySelector('.lp-modal__code').addEventListener('click', function () {
      copyText(CONFIG.scheme);
    });
    var copyBtn = modalEl.querySelector('.lp-modal__copy');
    copyBtn.addEventListener('click', function () {
      copyText(CONFIG.scheme).then(function (ok) {
        copyBtn.textContent = ok
          ? '✓ 已复制，去微信粘贴发送'
          : '复制失败，请长按选中上方口令手动复制';
        copyBtn.classList.add('is-done');
        setTimeout(function () {
          copyBtn.textContent = '复制口令';
          copyBtn.classList.remove('is-done');
        }, 2200);
      });
    });
    return modalEl;
  }

  function showModal(autoCopied) {
    var el = ensureModal();
    el.querySelector('.lp-modal__title').textContent = autoCopied
      ? '✓ 已自动复制小程序口令'
      : '自动复制未生效，请点下方按钮复制';
    el.classList.add('is-show');
    // 弹窗打开后把焦点交给关闭按钮：键盘用户可直接 Esc / Enter 关闭
    var closeBtn = el.querySelector('.lp-modal__close');
    if (closeBtn && typeof closeBtn.focus === 'function') closeBtn.focus();
  }

  function build() {
    var aside = document.createElement('aside');
    aside.className = 'lp-ad is-hidden';
    aside.setAttribute('aria-label', '推广：' + CONFIG.brand);

    // 无障碍：整块可读屏朗读，关闭按钮单独可聚焦
    aside.innerHTML =
      '<button class="lp-ad__close" type="button" aria-label="关闭广告">&times;</button>' +
      '<div class="lp-ad__body">' +
        // 限时推广：竖排卡片里独立一行、靠左，压在 LOGO 上方（不是品牌行的一部分）
        '<div class="lp-ad__limit">' + CONFIG.limitLine + '</div>' +
        '<div class="lp-ad__logo" aria-hidden="true">' + logoHtml() + '</div>' +
        '<div class="lp-ad__text">' +
          '<div class="lp-ad__brand">' + CONFIG.brandLine + '</div>' +
          '<div class="lp-ad__title">' + CONFIG.title + '</div>' +
        '</div>' +
      '</div>' +
      '<a class="lp-ad__cta" role="button"></a>' +
      '<div class="lp-ad__note">' + CONFIG.note + '</div>';

    var cta = aside.querySelector('.lp-ad__cta');
    // 微信外点击会被 JS 拦下改成「复制口令」，href 只在微信内真正生效
    cta.href = CONFIG.scheme;
    cta.textContent = CONFIG.cta;
    cta.addEventListener('click', function (e) {
      if (isWeChat()) return; // 微信内放行默认行为，唤起小程序

      e.preventDefault();
      // copyText 统一 resolve 成布尔值：同步 execCommand 或 clipboard API 任一成功即为 true
      copyText(CONFIG.scheme).then(function (ok) {
        // 无论自动复制成功与否都弹窗：自动成功 → 标题「已自动复制」；
        // 失败 → 标题提示点下方按钮复制。弹窗里口令常驻 + 复制按钮兜底，
        // 用户永远有出路（自动复制在各家浏览器可用性差异很大，不能只信一次）。
        showModal(ok);
      });
    });

    aside.querySelector('.lp-ad__close').addEventListener('click', function () {
      markDismissed();
      aside.classList.add('is-hidden');
      aside.style.visibility = '';   // 清掉 reveal 写的内联值，让 is-hidden 生效
      updateBarVar();
    });

    document.body.appendChild(aside);

    // 2026-11-01：把广告条真实高度发布成 CSS 变量 --sxg-bar-h，供左侧悬浮按钮组
    // （top / bottom / remind / ai-link / featured-douyin 五个脚本）动态避让。
    // 2026-11-18：原 ai-chat 已彻底删除，改为 ai-link（全站 AI 跳转圆钮）。
    // 移动端广告条会随推广文案折行而变高（390px 下实测 113px，不再是固定的 76px），
    // 固定偏移会让最下方的视频 / TOP 按钮压到条上。各 FAB 用
    // calc(var(--sxg-bar-h, 0px) + Npx) 即随条高自动上移，且彼此间距保持不变。
    //
    // ⚠️ 2026-11-02 修正：≥1440px 时广告是**右上竖排卡片**（top:88px），根本不在底部，
    //    却照样把卡片高度（实测 279px）写进了 --sxg-bar-h。后果是整列悬浮按钮 + AI 面板
    //    被整体抬高 279px 飘到页面中部，面板又被广告卡压住右半屏（站长截图指出）。
    //    变量语义是「底部吸底条占位」，桌面没有吸底条 → 必须写 0。
    //    断点切换由下面的 wideQuery change 监听触发重算，窗口 resize 也有兜底。
    function updateBarVar() {
      var wide = !!(window.matchMedia && window.matchMedia('(min-width: 1440px)').matches);
      var h = (wide || aside.classList.contains('is-hidden')) ? 0 : aside.offsetHeight;
      document.documentElement.style.setProperty('--sxg-bar-h', h + 'px');
    }
    updateBarVar();
    var _lpResizeTimer = null;
    window.addEventListener('resize', function () {
      clearTimeout(_lpResizeTimer);
      _lpResizeTimer = setTimeout(updateBarVar, 150);
    });

    // 竖排（≥1440px）靠 <br> 手动断行；窄屏横排时 <br> 会把文案截断，
    // 这里按当前视口宽度移除 <br>，交由 CSS 的 -webkit-line-clamp 控制行数。
    // 用 matchMedia 而非 resize 监听：只随断点切换时执行，无需频繁重排。
    var wideQuery = window.matchMedia('(min-width: 1440px)');

    function syncBreaks(mq) {
      var titleEl = aside.querySelector('.lp-ad__title');
      if (!titleEl) return;
      if (mq.matches) {
        if (!titleEl.querySelector('br')) {
          titleEl.innerHTML = CONFIG.title;
        }
      } else if (titleEl.querySelector('br')) {
        // 用空格替换掉 <br>，语义不变但可自然折行
        titleEl.innerHTML = titleEl.innerHTML.replace(/<br\s*\/?>/gi, ' ');
      }
      updateBarVar();
    }

    syncBreaks(wideQuery);
    if (typeof wideQuery.addEventListener === 'function') {
      wideQuery.addEventListener('change', syncBreaks);
    } else if (typeof wideQuery.addListener === 'function') {
      // 旧版 Safari
      wideQuery.addListener(syncBreaks);
    }

    // 2026-11-18：与星巴克推广条同一套机制，这里一并修掉 visibility 卡帧。
    // 只 remove('is-hidden') 时，computed visibility 会卡在 hidden（DOM 在、
    // opacity 已 1，但永远不可见）——0da3a15 真根因。强制重排打断过渡帧，
    // 再写内联 visible 兜底，两道一起才稳定放出来。
    function reveal() {
      aside.classList.remove('is-hidden');
      void aside.offsetWidth;                                  // 强制 reflow
      aside.style.setProperty('visibility', 'visible', 'important');
      updateBarVar();
    }
    setTimeout(reveal, CONFIG.showAfter);
    /* 兜底：万一 reveal 那帧被浏览器合并/延后，load 后再强制一次 */
    window.addEventListener('load', function () {
      if (aside.classList.contains('is-hidden')) reveal();
      else aside.style.visibility = 'visible';
    }, { once: true });
  }

  function init() {
    // 官方未公布活动结束时间，不做倒计时与过期隐藏
    if (isDismissedRecently()) return; // 用户刚关闭过：7 天内不再打扰
    build();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
