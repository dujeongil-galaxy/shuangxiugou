/* ua-guard.js — 微信 / QQ 内置浏览器 / 独立 QQ 浏览器拦截层（2026-11-18 建立，11-19 扩围）
 *
 * 背景与口径：
 *   2026-11-18：根页面自身不拦，站内所有页面（notes.html 除外）在微信/QQ 内置
 *     浏览器里一律弹全屏拦截层，要求复制地址到系统浏览器打开。
 *   2026-11-19：拦截范围扩到独立的「QQ 浏览器」App。依据是当日站长指定的两份
 *     微信文章存档（archive/wechat-liciaotiao-2023/）：一份为腾讯方律师函，
 *     主张「李跳跳」屏蔽 QQ 浏览器广告构成不正当竞争；另一份为作者回应。
 *     本站据此把 QQ 浏览器与微信/QQ 内置浏览器同等对待，统一要求系统浏览器打开。
 *
 * 识别方式：纯 UA 特征，不做任何网络请求。
 *   - 微信 / 企业微信：MicroMessenger（wxwork 也会带它或单独出现）
 *   - QQ 内置浏览器：  QQ/x.x.x（「QQ/数字」形态）
 *   - 独立 QQ 浏览器： MQQBrowser/x.x（手机 QQ 浏览器 App 的标识）
 *   - TIM：            Tim/x.x
 *
 * 实现要点：
 *   1. 本脚本以 <head> 内同步 <script> 引入（无 defer/async），解析到即执行：
 *      命中 UA 立刻给 <html> 打 .sxg-ua-block 类 + 注入 <style> 把 body 下
 *      所有直接子元素 display:none —— 页面内容一个字都不会闪现。
 *   2. 拦截层 DOM 在 DOMContentLoaded 时挂到 body（#sxg-ua-guard 是 body 直接
 *      子元素，被上面的选择器豁免），z-index 用满级 2147483647。
 *   3. 复制按钮优先 navigator.clipboard，失败自动降级 textarea + execCommand
 *      （微信 X5 内核对 clipboard API 支持不全，必须留降级）。
 *   4. 不提供「仍要继续访问」入口 —— 站长要求就是硬拦截。
 */
(function () {
  'use strict';
  try {
    var ua = navigator.userAgent || '';
    var isWeChat = /MicroMessenger/i.test(ua) || /wxwork/i.test(ua);
    var isQQ = /\bQQ\/[\d.]+/.test(ua) || /\/Tim\//.test(ua);
    var isQQBrowser = /MQQBrowser\/[\d.]+/i.test(ua) || /QQBrowser\/[\d.]+/i.test(ua);
    if (!isWeChat && !isQQ && !isQQBrowser) return; // 正常浏览器：什么都不做

    var doc = document;
    var root = doc.documentElement;
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
