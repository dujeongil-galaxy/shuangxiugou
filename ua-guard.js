/* ua-guard.js — 浏览器分流：微信/QQ 内置拦截 · QQ 浏览器引导专题 · 国产浏览器顶部提示（2026-11-18 建立，11-19 四次调整）
 *
 * 背景与口径：
 *   2026-11-18：站内所有页面在微信/QQ 内置浏览器里弹全屏拦截层，要求复制地址
 *     到系统浏览器打开。
 *   2026-11-19 前两轮：拦截扩到独立 QQ 浏览器、notes.html 不再豁免、PC 端也锁死。
 *   2026-11-19 第三轮（现行）：QQ 浏览器改走「引导看专题」——命中 QQ 浏览器的
 *     访问直接跳转到 qq-browser-report.html（律师函 + 作者回应两篇存档），
 *     不再弹通用拦截层；专题页自身放行、顶部亮出说明条。依据是当日指定的
 *     两份微信文章存档（archive/wechat-liciaotiao-2023/）：腾讯方主张李跳跳
 *     屏蔽 QQ 浏览器广告构成不正当竞争，另一篇为作者回应，本站据此把争议
 *     本身作为说明内容呈现给 QQ 浏览器访客。微信/QQ 内置浏览器维持原硬拦截。
 *   2026-11-19 第四轮（v6→v8）：微信/QQ 内置与 QQ 浏览器两条口径完全不动。
 *     提示口径两次反转，最终定稿（站长 2026-11-19 明确）：**不做白名单**——
 *     只认「国产浏览器黑名单」，UA 命中华为/小米/OPPO/vivo/UC/夸克/360/搜狗/
 *     百度/2345/傲游/支付宝/微博/钉钉/抖音/头条等国产特征才弹顶部说明（固定、
 *     不可关闭、不拦内容）；其余一切浏览器——包括 Safari/Chrome/Edge/Firefox
 *     四大主流，以及韩国 Naver Whale、三星 Internet、Opera 等国际浏览器——
 *     一律放行、什么都不弹。理由：国内平台对本站曝光/检索受限，而这一现象
 *     只跟国产浏览器人群相关；海外浏览器访客不受此困扰，无提示必要。
 *
 * 识别方式：UA 特征 + 运行时交叉验证，全程不发网络请求。
 *   - 微信 / 企业微信：MicroMessenger（wxwork 也会带它或单独出现）
 *   - QQ 内置浏览器：  QQ/x.x.x（「QQ/数字」形态）、Tim/x.x
 *   - 独立 QQ 浏览器： MQQBrowser / QQBrowser 任意形态（手机 App 用 MQQBrowser/x.x，
 *     电脑版用 Chrome/... Safari/... QQBrowser/10.x；不绑定数字段）
 *   - 反 UA 伪装（v5 加固）：QQ 浏览器内置「浏览器标识」开关可把 UA 改成
 *     iPhone / iPad / 桌面，单看字符串会被绕过。故追加内核级信号交叉验证：
 *     JSBridge 全局对象、Client Hints 品牌、UA 声称平台与 navigator.platform /
 *     vendor / chrome 对象是否自相矛盾。可疑分 ≥3 即并入 QQ 浏览器分支。
 *     这些属性改 UA 字符串不会同步改变，属于引擎/运行时层面的身份痕迹。
 *
 * 实现要点：
 *   1. <head> 内同步 <script> 引入（无 defer/async），解析到即执行。QQ 浏览器
 *      分支在打 data-sxg-ua-block 之前分流，避免正文/专题页被隐藏。
 *   2. QQ 浏览器：非专题页 → location.replace 到专题页（不放行原页）；已在专题页
 *      → 不打拦截标记，只点亮顶部 #sxg-qq-notice 说明条，杜绝自跳死循环。
 *   3. 微信/QQ 内置：给 <html> 打 data-sxg-ua-block + 注入 <style> 把 body 下
 *      所有直接子元素 display:none —— 页面内容一个字都不会闪现。
 *   4. 拦截层 DOM 在 DOMContentLoaded 时挂到 body（#sxg-ua-guard 豁免），z-index 满级。
 *   5. 复制按钮优先 navigator.clipboard，失败自动降级 textarea + execCommand。
 *      微信/QQ 内置不提供「仍要继续访问」入口 —— 硬拦截口径不变。
 */
(function () {
  'use strict';
  try {
    var ua = navigator.userAgent || '';
    var isWeChat = /MicroMessenger/i.test(ua) || /wxwork/i.test(ua);
    var isQQ = /\bQQ\/[\d.]+/.test(ua) || /\/Tim\//.test(ua);
    var isQQBrowser = /MQQBrowser/i.test(ua) || /QQBrowser/i.test(ua);
    var doc = document;
    var root = doc.documentElement;

    // —— 国产浏览器黑名单判定（2026-11-19 定稿，v8；站长口径：不做白名单）——
    // 只弹给命中国产特征的浏览器；其余（Safari/Chrome/Edge/Firefox、韩国
    // Naver Whale、三星 Internet、Opera 等一切非国产）一律放行、什么都不显示。
    // 关键点：UC / 夸克 / 360 等国产浏览器基于 Chromium，UA 里也带 Chrome/ 字样，
    // 所以「弹公告」的判据必须是国产特征串本身，绝不能用「不在某白名单里」反推——
    // 反推会把 Naver Whale / 三星 Internet 这类没进白名单的正常国际浏览器误伤。
    // 韩国两大主流浏览器（Naver Whale / Samsung Internet）特征串刻意不进黑名单。
    function sxgIsDomesticBrowser(u) {
      // 新版 360 安全浏览器（13/14）UA 去掉了 QIHU/360SE，改成在 Safari/537.36 后
      // 直接续一段斜杠版本号（Safari/537.36/13.0.10000.0）。标准 Chrome 以
      // Safari/537.36 结束、三星/Whale 在 Safari 前带自家 token，都不会命中这条。
      // 2026-11-19 站长 PC 360 看不到国产提示条的真根因就是这个变体漏判。
      return /(UCBrowser|UCWEB|Quark|360SE|360Chrome|360EE|360browser|360Browser|360Safe|360安全|QIHU|360 Aphone|SogouMobileBrowser|MetaSr|SE 2\.X|baidubrowser|BIDUBrowser|baidu|LBBROWSER|2345Explorer|2345chrome|Maxthon|HuaweiBrowser|HMSCore|MiuiBrowser|VivoBrowser|HeyTapBrowser|OPPOBrowser|OppoBrowser|AlipayClient|Weibo|DingTalk|aweme|ToutiaoNews|NewsArticle|CoolMarket|Meizu|SogouIE|QQBrowser|MQQBrowser|MicroMessenger|wxwork|Safari\/537\.36\/\d)/i.test(u);
    }

    // —— 国产浏览器顶部持续提示：固定于每个页面顶部、不提供关闭按钮、不影响正常浏览 ——
    function sxgShowBrowserNotice() {
      var css = [
        '#sxg-browser-notice{position:fixed;top:0;left:0;right:0;z-index:2147483000;',
        '  background:#fef3c7;color:#7f1d1d;box-shadow:0 2px 10px rgba(120,53,15,.18);',
        '  font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;',
        '  font-size:13px;line-height:1.6;padding:10px 16px;text-align:center;box-sizing:border-box}',
        '#sxg-browser-notice a{color:#991b1b;text-decoration:underline;font-weight:700}',
        '#sxg-browser-notice a:focus-visible{outline:2px solid #92400e;outline-offset:2px}',
        '@media (max-width:640px){#sxg-browser-notice{font-size:12px;padding:8px 14px;line-height:1.5}}'
      ].join('');
      function buildNotice() {
        if (doc.getElementById('sxg-browser-notice')) return;
        var style = doc.createElement('style');
        style.id = 'sxg-browser-notice-style';
        style.setAttribute('data-sxg-browser-notice', 'css');
        style.textContent = css;
        (doc.head || root).appendChild(style);
        var bar = doc.createElement('div');
        bar.id = 'sxg-browser-notice';
        bar.setAttribute('role', 'note');
        bar.appendChild(doc.createTextNode('当前浏览器环境可能无法稳定浏览本站。国内部分平台对双休购相关内容鲜有曝光，个别平台甚至让相关话题的检索结果完全消失。本站不作强制拦截，是否改用 Safari、Chrome、Edge 或 Firefox 由访客自行决定。若继续沿用当前浏览器，可点'));
        var link = doc.createElement('a');
        link.href = 'https://dujeongil-galaxy.github.io/shuangxiugou/#sxg-bing-guide';
        link.textContent = '这里';
        bar.appendChild(link);
        bar.appendChild(doc.createTextNode('了解如何把默认搜索引擎设为 Bing 必应。'));
        (doc.body || root).appendChild(bar);
      }
      if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', buildNotice);
      else buildNotice();
    }

    // —— 反伪装交叉验证：UA 说自己是 iPhone/iPad/PC，但内核痕迹露馅 ——
    // 可疑分制（≥3 命中）。每项都是真浏览器难以伪造、且改 UA 字符串不会变的属性。
    // 只有 UA 声称「苹果移动设备」或「桌面」时才检查，避免误伤正常的安卓 Chrome。
    function sxgSpoofScore() {
      try {
        var plat = navigator.platform || '';
        var vendor = navigator.vendor || '';
        var score = 0;
        var claimsAppleMobile = /iPhone|iPad|iPod/i.test(ua) && !/Android/i.test(ua);
        var claimsDesktop = /Windows NT|Macintosh|X11|Linux x86_64/i.test(ua) && !/Android|Mobile/i.test(ua);

        // 1) 引擎注入对象：X5/QQ 浏览器内核会在 window 挂这些全局，普通浏览器没有。
        //    用键名存在性判断，且加 UA 声称身份的前提，减少第三方 SDK 误伤。
        if ((claimsAppleMobile || claimsDesktop) && (
            typeof window.mqq !== 'undefined' || typeof window.MQQBrowser !== 'undefined'
            || typeof window.mqqbrowser !== 'undefined'
        )) score += 4;

        // 2) Client Hints 品牌串：Chromium 系 n.userAgentData 带品牌列表，
        //    iOS Safari 根本没有该对象；伪装 UA 时这里仍暴露真实内核。
        if (claimsAppleMobile && navigator.userAgentData) {
          score += 3;
          try {
            var brands = navigator.userAgentData.brands || [];
            for (var bi = 0; bi < brands.length; bi++) {
              if (/QQ|X5|Tencent|MQQ/i.test(brands[bi].brand || '')) { score += 2; break; }
            }
          } catch (e) {}
        }

        // 3) 桌面 Chromium 独有的 chrome 对象：真 iOS Safari 没有 window.chrome。
        if (claimsAppleMobile && window.chrome && (window.chrome.runtime || window.chrome.loadTimes)) score += 3;

        // 4) 平台字符串与 UA 声称身份自相矛盾：
        //    声称 iPhone/iPad 却报 Win32/MacIntel/Linux；声称 PC 却报 iPhone/Linux arm。
        if (claimsAppleMobile && plat && !/iPhone|iPad|iPod/i.test(plat)) score += 3;
        if (claimsDesktop && /iPhone|iPad|iPod|Linux arm|Android/i.test(plat)) score += 3;

        // 5) vendor 串：真 iPhone/iPad Safari 的 vendor 恒为 Apple Computer, Inc.
        if (claimsAppleMobile && vendor && !/Apple/i.test(vendor)) score += 2;

        return score;
      } catch (e) { return 0; /* 探测失败一律按正常浏览器放行，不误伤 */ }
    }
    if (!isWeChat && !isQQ && !isQQBrowser && sxgSpoofScore() >= 3) isQQBrowser = true;
    if (!isWeChat && !isQQ && !isQQBrowser) {
      // 微信/QQ 内置、QQ 浏览器之外：只给命中国产特征的浏览器弹持续顶部提示；
      // 其余（含韩日/欧美一切国际浏览器）一律放行、什么都不显示（站长 2026-11-19 定稿）。
      if (sxgIsDomesticBrowser(ua)) sxgShowBrowserNotice();
      return;
    }

    // —— QQ 浏览器：不分页面内容，一律引导到专题报道页看争议存档 ——
    // 专题页自身放行（只点亮顶部说明条），否则会在专题页上再跳一次形成死循环。
    if (isQQBrowser && !isWeChat && !isQQ) {
      function sxgOnReport() { return /(?:^|\/)qq-browser-report\.html$/.test(location.pathname); }
      if (sxgOnReport()) {
        root.setAttribute('data-sxg-qq-browser', '1'); // 供顶部说明条按 UA 显示
        return;
      }
      // 从当前脚本 src 推导站点根，兼容根目录首页与 brand/ 等子目录页
      var script = doc.currentScript;
      if (!script) {
        var ss = doc.getElementsByTagName('script');
        for (var si = ss.length - 1; si >= 0; si--) {
          if (/ua-guard\.js/.test(ss[si].src || '')) { script = ss[si]; break; }
        }
      }
      var src = script && script.src ? script.src : '';
      var base = src ? src.replace(/(?:^|\/)ua-guard\.js(?:\?.*)?$/, '/') : '/';
      location.replace(base + 'qq-browser-report.html');
      return;
    }

    // —— 微信 / QQ 内置浏览器：维持原全屏硬拦截 ——
    if (root.getAttribute('data-sxg-ua-block')) return;
    root.setAttribute('data-sxg-ua-block', '1');

    var css = [
      'html[data-sxg-ua-block] body > *:not(#sxg-ua-guard){display:none!important}',
      'html[data-sxg-ua-block], html[data-sxg-ua-block] body{overflow:hidden!important;background:#eef7f2!important}',
      '#sxg-ua-guard{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:22px;',
      '  background:linear-gradient(165deg,#ecfdf5 0%,#f0fdfa 55%,#d1fae5 100%);',
      '  font-family:system-ui,-apple-system,"PingFang SC","HarmonyOS Sans SC","Microsoft YaHei",sans-serif}',
      '#sxg-ua-guard .sxg-ua-card{max-width:360px;width:100%;box-sizing:border-box;background:#fff;border-radius:22px;',
      '  box-shadow:0 24px 64px rgba(15,118,110,.20);padding:30px 24px 22px;text-align:center}',
      '#sxg-ua-guard .sxg-ua-logo{width:52px;height:52px;margin:0 auto 14px;border-radius:16px;background:#0F766E;color:#fff;',
      '  font-size:26px;font-weight:800;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 16px rgba(15,118,110,.35)}',
      '#sxg-ua-guard .sxg-ua-title{font-size:18px;font-weight:800;color:#064E3B;line-height:1.4;margin:0 0 10px}',
      '#sxg-ua-guard .sxg-ua-reason{font-size:13px;color:#64748B;line-height:1.7;margin:0 0 16px}',
      '#sxg-ua-guard .sxg-ua-steps{list-style:none;margin:0 0 16px;padding:0;text-align:left}',
      '#sxg-ua-guard .sxg-ua-steps li{font-size:13.5px;color:#334155;line-height:1.9}',
      '#sxg-ua-guard .sxg-ua-steps b{color:#0F766E}',
      '#sxg-ua-guard .sxg-ua-url{background:#F1F5F9;border-radius:10px;padding:9px 11px;margin:0 0 14px;font-size:12px;',
      '  color:#475569;word-break:break-all;user-select:all;-webkit-user-select:all;text-align:left;line-height:1.5}',
      '#sxg-ua-guard .sxg-ua-copy{display:block;width:100%;height:46px;border:none;border-radius:999px;cursor:pointer;',
      '  background:#0F766E;color:#fff;font-size:16px;font-weight:700;letter-spacing:1px;',
      '  box-shadow:0 8px 20px rgba(15,118,110,.30);-webkit-appearance:none;appearance:none}',
      '#sxg-ua-guard .sxg-ua-copy:active{transform:translateY(1px)}',
      '#sxg-ua-guard .sxg-ua-hint{font-size:12px;color:#94A3B8;line-height:1.6;margin:12px 0 0}',
      '#sxg-ua-guard .sxg-ua-foot{font-size:12px;font-weight:600;color:#0F766E;margin:16px 0 0}'
    ].join('');

    var style = doc.createElement('style');
    style.setAttribute('data-sxg-ua-guard', 'css');
    style.textContent = css;
    (doc.head || root).appendChild(style);

    function build() {
      if (doc.getElementById('sxg-ua-guard')) return;
      var wrap = doc.createElement('div');
      wrap.id = 'sxg-ua-guard';
      wrap.setAttribute('role', 'dialog');
      wrap.setAttribute('aria-modal', 'true');
      wrap.setAttribute('aria-label', '请在系统浏览器打开双休购');

      var card = doc.createElement('div');
      card.className = 'sxg-ua-card';

      var logo = doc.createElement('div');
      logo.className = 'sxg-ua-logo';
      logo.textContent = '休';

      var title = doc.createElement('p');
      title.className = 'sxg-ua-title';
      title.textContent = '请在系统浏览器打开「双休购」';

      var reason = doc.createElement('p');
      reason.className = 'sxg-ua-reason';
      reason.textContent = '你正在用微信 / QQ 的内置浏览器，或 QQ 浏览器访问，本站在这里容易被拦截或显示异常。复制地址到系统浏览器，一步就能正常打开：';

      var steps = doc.createElement('ul');
      steps.className = 'sxg-ua-steps';
      var stepTexts = [
        ['① ', '点下面的按钮，复制本页地址'],
        ['② ', '打开系统自带的浏览器（Safari / Chrome / Edge 均可）'],
        ['③ ', '粘贴地址并访问，即可正常浏览']
      ];
      for (var i = 0; i < stepTexts.length; i++) {
        var li = doc.createElement('li');
        var mark = doc.createElement('b');
        mark.textContent = stepTexts[i][0];
        li.appendChild(mark);
        li.appendChild(doc.createTextNode(stepTexts[i][1]));
        steps.appendChild(li);
      }

      var urlBox = doc.createElement('div');
      urlBox.className = 'sxg-ua-url';
      urlBox.textContent = location.href;

      var btn = doc.createElement('button');
      btn.type = 'button';
      btn.className = 'sxg-ua-copy';
      btn.setAttribute('data-sxg-ua-state', 'idle');
      btn.textContent = '复制本页地址';

      var hint = doc.createElement('p');
      hint.className = 'sxg-ua-hint';
      hint.textContent = '复制按钮无效时，可长按上方地址手动复制；微信内也可点右上角「···」→「复制链接」。';

      var foot = doc.createElement('p');
      foot.className = 'sxg-ua-foot';
      foot.textContent = '双休购 ShuangxiuGo · 劳动者友好品牌索引';

      function copyText(text) {
        return new Promise(function (resolve) {
          function legacy() {
            try {
              var ta = doc.createElement('textarea');
              ta.value = text;
              ta.setAttribute('readonly', 'readonly');
              ta.style.cssText = 'position:fixed;top:-999px;left:-999px;opacity:0';
              doc.body.appendChild(ta);
              var sel = doc.getSelection();
              var saved = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
              ta.select();
              var ok = false;
              try { ok = doc.execCommand('copy'); } catch (e) { ok = false; }
              doc.body.removeChild(ta);
              if (saved && sel) { sel.removeAllRanges(); sel.addRange(saved); }
              resolve(ok);
            } catch (e) { resolve(false); }
          }
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(
              function () { resolve(true); },
              function () { legacy(); }
            );
          } else { legacy(); }
        });
      }

      btn.addEventListener('click', function () {
        if (btn.getAttribute('data-sxg-ua-state') === 'done') return;
        copyText(location.href).then(function (ok) {
          if (ok) {
            btn.setAttribute('data-sxg-ua-state', 'done');
            btn.textContent = '✓ 已复制，去系统浏览器粘贴打开';
            btn.style.background = '#059669';
          } else {
            btn.setAttribute('data-sxg-ua-state', 'error');
            btn.textContent = '复制失败，请长按上方地址手动复制';
          }
        });
      });

      card.appendChild(logo);
      card.appendChild(title);
      card.appendChild(reason);
      card.appendChild(steps);
      card.appendChild(urlBox);
      card.appendChild(btn);
      card.appendChild(hint);
      card.appendChild(foot);
      wrap.appendChild(card);
      doc.body.appendChild(wrap);
    }

    if (doc.readyState === 'loading') {
      doc.addEventListener('DOMContentLoaded', build);
    } else {
      build();
    }
  } catch (e) {
    /* 任何异常都不能把正常浏览器拖垮：静默退出 */
  }
})();
