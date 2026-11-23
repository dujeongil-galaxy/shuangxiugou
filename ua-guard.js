/* ua-guard.js — 浏览器分流：拦截页只针对微信 · 独立 QQ 浏览器跳专题页 · QQ 客户端放行 · App 内嵌只提示 · 厂商浏览器页头横幅
 *
 * v21（2026-11-23，现行口径，只加一条白名单）：
 *   悟空浏览器（字节系）自身也是 WebView 内核，UA 带 `; wv)` 与壳指纹，被误判成「App 内嵌」
 *   而弹了「别在 App 内打开」。v21 新增已知独立浏览器白名单（UA 尾部 `wkbrowser <版本号>`）：
 *   命中后按普通浏览器放行——不弹 App 提示、不算非标准壳（壳指纹分归零），也不进厂商横幅。
 *
 * v20（2026-11-23，拦截页只留给微信）：
 *   → ① 微信 / 企业微信 → 全屏硬拦截（复制地址到系统浏览器打开）；
 *     ② 独立 QQ 浏览器（手机 MQQBrowser / 电脑 QQBrowser 新内核）→ 自动跳 qq-browser-report.html；
 *     ③ QQ 客户端（手机 QQ、电脑 QQ、TIM）→ 正常放行，不拦、不提示、不跳专题页；
 *     ④ App 内嵌 WebView / 厂商浏览器横幅沿用 v17 口径。
 *
 * v19（2026-11-23，历史口径：QQ 客户端仍硬拦截；已被 v20 取代）：
 *   先认 IM 客户端标记（V1_AND_SQ_ / V1_IPH_SQ_ / 「QQ/x.x」 / Tim/ / TBS/）再判 QQ 浏览器，
 *   修掉「手机 QQ 的内置 WebView 带 MQQBrowser/6.2 + TBS，被误当 QQ 浏览器」的问题；
 *   电脑 QQ 与电脑版 QQ 浏览器同源（QBCore），按 Core/1.xx 内核年代兜底区分。
 *
 *
 * v17（2026-11-20 历史口径，其中「QQ 浏览器硬拦截」一条已被 v18 取代）：
 *   站长原话：不要再「不管」厂商浏览器——「能检测到的话，就在原本乌克兰那个位置，
 *   加一条黄色横幅提示，推荐使用 Chrome/Edge/Safari/Firefox。网站内容整体下移，
 *   防止被这个遮挡」；名单要含硬核联盟（华为/荣耀/OPPO·一加·realme/vivo·iQOO/
 *   小米/联想/魅族/金立/酷派/努比亚·红魔）与 360/UC/夸克/百度/搜狗/2345/傲游等，
 *   且「既针对 PC 也针对安卓和平板」；文案里不出现「国产 / 国内」字样。
 *   → ① 命中厂商浏览器特征：在 <header> 之后（若乌克兰声明条在场则排在它后面）
 *        插一条 #sxg-browser-notice 黄色横幅，非 sticky/fixed、走文档流，正文自然下移；
 *     ② 该判定只认「浏览器标识串」，不认机型号——`Xiaomi 13` / `realme` / `iQOO`
 *        也会出现在装了真 Chrome 的手机 UA 里，按机型判会把正常 Chrome 误伤成
 *        「建议换浏览器」（此红线写在 DOMESTIC_TOKENS 上方注释里）；
 *     ③ 微信/企微/QQ 内置 + 独立 QQ 浏览器仍全屏硬拦截，App 内嵌 WebView 仍只提示不拦；
 *     ④ 360 的两条老判据（360SE/QIHU 族 UA 与移动端壳指纹）继续保留，与 ① 并存。
 *
 * v16（2026-11-20，历史口径，已被 v17 取代）：
 *   「本站是 GitHub 纯静态页。其他国内浏览器不管了，但 QQ 浏览器拦死，不准进。
 *     还有就是 App 内访问一定是弹提示的，但不强制拦截。」
 *   → ① 微信 / 企业微信 / QQ 内置 / 独立 QQ 浏览器：全屏硬拦截（撤销原「跳专题页」，
 *        qq-browser-report.html 不再作为强制跳转目标，只留作说明页）；
 *     ② App 内嵌 WebView（Android 的 `; wv)` 壳 + iOS 的 WKWebView「无 Safari 尾巴」）：
 *        一定弹一条提示，但不拦内容；
 *     ③ 其它国产浏览器（UC/夸克/百度/搜狗/华为/小米/360 桌面等）：**不再单独提示**，
 *        一律放行。国产特征表保留，只在 ?ua-debug=1 面板里展示，不参与分流；
 *     ④ 360 保留两条判据：老版本 UA 特征（360SE / 360Chrome / QIHU / Safari/537.36/<版本号>）
 *        与「移动端非标准 Chromium 运行时」壳指纹（brands 空 / 无 window.chrome / `; wv)`+
 *        `Version/4.0`），命中任一即弹提示条；伪装成纯 Chrome 又读不出的，只剩公告栏兜底。
 *
 * v15（2026-11-20）：按站长口径把「App 内嵌」和「浏览器本体」彻底分开——
 *   带 `; wv)` + `Version/4.0` 的 Android WebView（小红书/知乎/贴吧…以及 360 手机普通版，
 *   两者指纹同类、无法区分）只弹一句「别在 App 内打开」，不贴国产标签、不劝换浏览器、
 *   没有任何按钮；没有 wv 标记的非标准 Chromium 浏览器（360 极速版这类）仍走原提示条。
 *
 * v14（2026-11-20，真机实测后加）：手机 360 两个版本 UA 里没有任何国产特征串——
 *   普通版是 `; wv)` 的 WebView 形态（Chrome/124），极速版是纯 `Chrome/141 Mobile`。
 *   但同一台真机读数显示：userAgentData 存在而 brands 为空、window.chrome 不存在，
 *   这两点真 Chrome 不会出现。故新增「移动端非标准 Chrome 运行时」壳指纹评分（≥3 弹提示），
 *   并在诊断面板/控制台暴露 uad.brands 与 window.chrome 的实读值。
 *
 * v13（2026-11-20）在 v12 基础上只做三处修补，口径一律不动：
 *   1. 【不压内容】提示条改为插到 body 最前面、走文档流的 sticky 条（不可关闭、不拦内容）：
 *      加载时它占自己的位置、把原有内容整体下推，结构上不可能遮住公告栏/页头；滚动后
 *      仍贴顶持续显示。放弃 v13 初版的「fixed + body padding 补偿」——实测线上页面内容
 *      在固定定位的应用外壳里，body padding 推不动它，顶部照样被盖。
 *   2. 【自助标记可撤销】仅当提示是由 ?force-domestic=1 自助声明触发时，条尾显示
 *      「已换用 Chrome / Edge 仍见此条？点此清除标记」；命中真实国产特征时仍不提供
 *      任何关闭入口（原口径）。撤销链接会把 ?force-domestic=0 带上并清掉本地标记。
 *   3. 【?ua-debug=1 诊断面板】显示原始 UA、platform / vendor、反伪装分、命中的国产
 *      特征项、force 标记、最终动作，可一键复制。用于站长在各版本 360 / 国产浏览器上
 *      采样实测，不再靠截图反推。debug 模式下硬拦截分支暂停，便于取样。
 *
 * 以下为 v12 及更早口径（部分已被 v16 覆盖，仅作沿革记录）：
 *   2026-11-18：站内所有页面在微信/QQ 内置浏览器里弹全屏拦截层，要求复制地址到系统浏览器打开。
 *   2026-11-19 前两轮：拦截扩到独立 QQ 浏览器、notes.html 不再豁免、PC 端也锁死。
 *   2026-11-19 第三轮：QQ 浏览器改走「引导看专题」——命中即 location.replace 到
 *     qq-browser-report.html（律师函 + 作者回应两篇存档），专题页自身放行、顶部亮说明条。
 *   2026-11-19 第四轮（v6→v8）：**不做白名单**——只认「国产浏览器黑名单」，UA 命中华为/
 *     小米/OPPO/vivo/UC/夸克/360/搜狗/百度/2345/傲游/支付宝/微博/钉钉/抖音/头条等国产
 *     特征才弹顶部说明（固定、不可关闭、不拦内容）；其余一切浏览器——包括 Safari/Chrome/
 *     Edge/Firefox 四大主流，以及韩国 Naver Whale、三星 Internet、Opera 等国际浏览器——
 *     一律放行、什么都不弹。
 *   2026-11-20（v9→v12）：新版 360 安全浏览器（v13+）UA 伪装成纯 Chrome，JS 层面已无法
 *     区分（UA / platform / vendor / window.external / documentMode / window.chrome /
 *     uad.brands 与本是真 Chromium 的机器逐项一致）。故只保留「Safari/537.36/<版本号>」
 *     这一变体特征，并加 ?force-domestic=1/0 自助声明（localStorage 持久化）作为兜底。
 *
 * 识别方式：UA 特征 + 运行时交叉验证，全程不发网络请求。
 *   - 微信 / 企业微信：MicroMessenger（wxwork 也会带它或单独出现）
 *   - QQ 内置浏览器：  QQ/x.x.x（「QQ/数字」形态）、Tim/x.x
 *   - 独立 QQ 浏览器： MQQBrowser / QQBrowser 任意形态
 *   - 反 UA 伪装：JSBridge 全局对象、Client Hints 品牌、UA 声称身份与 navigator.platform /
 *     vendor / chrome 对象是否自相矛盾，可疑分 ≥3 并入 QQ 浏览器专题页跳转分支。
 *
 * 实现要点：
 *   1. <head> 内同步 <script> 引入（无 defer/async），解析到即执行。
 *   2. 微信 / 企业微信 → <html> 打 data-sxg-ua-block + 注入 <style>，正文一个字不闪现。
 *   3. 独立 QQ 浏览器 → 立即 location.replace 到专题页（专题页自身不跳，只亮顶部说明条）。
 *   4. QQ 客户端（手机 QQ / 电脑 QQ / TIM）→ 直接放行，不拦不提示。
 *   5. App 内嵌 → 文档流顶部一条黄色提示（sticky，无按钮、不拦内容）。
 *   6. 拦截层 DOM 在 DOMContentLoaded 挂到 body（#sxg-ua-guard 豁免），z-index 满级。
 *   7. 复制按钮优先 navigator.clipboard，失败降级 textarea + execCommand。
 *   8. 任何异常都静默退出，不拖垮正常浏览器。
 */
(function () {
  'use strict';
  try {
    var ua = navigator.userAgent || '';
    var doc = document;
    var root = doc.documentElement;
    var VERSION = 'v21';

    // —— 微信 / QQ 客户端标记（先判，避免把 QQ 误当成 QQ 浏览器）——
    // 手机 QQ 的内置 WebView 用的是 QQ 浏览器 X5 内核，UA 里同样带 MQQBrowser，
    // 只认「QQBrowser」字样会把 QQ 误当成 QQ 浏览器。所以先认 IM 客户端自己的标记：
    //   · 安卓 QQ：V1_AND_SQ_… / 「QQ/x.x.x」 / X5 内核的 MQQBrowser/6.2 + TBS/
    //   · 苹果 QQ：V1_IPH_SQ_… / 「QQ/x.x.x」
    //   · TIM：    Tim/
    // 这些标记只出现在客户端内嵌环境，独立 QQ 浏览器客户端不会带（手机版是
    // MQQBrowser/<新版本> + COVC，电脑版是 Core/1.xx + QQBrowser/1x）。
    // 电脑 QQ 与电脑版 QQ 浏览器同源（同为 QBCore），UA 只差内核年代：客户端长期停在
    // Core/1.53~1.86（Chromium 53~86），独立 QQ 浏览器 12/13 已是 Core/1.94 以上，
    // 故电脑端按 Core 内核版本兜底，旧内核的 QQBrowser 归到 QQ 客户端。
    // v20 口径：拦截页只针对微信；QQ（含 TIM）与电脑 QQ 一律正常放行，
    // 只有独立 QQ 浏览器跳专题页。
    // 纯函数，便于自检脚本原样抠出来做判定矩阵。
    function sxgQQClassify(ua) {
      var wechat = /MicroMessenger/i.test(ua) || /wxwork/i.test(ua);
      var inApp = /\bV1_[A-Z]+_SQ_/i.test(ua) || /\bQQ\/[\d.]+/.test(ua) || /\bTim\//.test(ua)
        || /MQQBrowser\/6\.2/i.test(ua) || /\bTBS\/[\d.]+/i.test(ua);
      var core = 0;
      var coreM = ua.match(/Core\/1\.(\d{2,3})/);
      if (coreM) core = parseInt(coreM[1], 10);
      var desktopApp = /Windows NT|Macintosh/i.test(ua) && /QQBrowser/i.test(ua)
        && core > 0 && core <= 90;
      var qqClient = inApp || desktopApp;
      // 独立 QQ 浏览器：手机版 MQQBrowser + 电脑版 QQBrowser/10.x（电脑版不带 M 前缀，须一并覆盖）
      var browser = (/MQQBrowser/i.test(ua) || /QQBrowser/i.test(ua))
        && !wechat && !qqClient;
      return { wechat: wechat, inApp: inApp, desktopApp: desktopApp, qqClient: qqClient,
        browser: browser, core: core };
    }
    var qqClass = sxgQQClassify(ua);
    var isWeChat = qqClass.wechat;
    var isQQ = qqClass.qqClient;
    var isDesktopQQApp = qqClass.desktopApp;
    var isQQBrowser = qqClass.browser;
    var coreChromium = qqClass.core;
    // 命中来源：UA 明确标识为真，反伪装可疑分兜底也算（两者都按 QQ 浏览器处理，仅诊断面板区分）
    var qqBrowserByUA = isQQBrowser;
    // 独立 QQ 浏览器判定的 UA 依据（诊断面板用）
    var qqBrowserToken = /MQQBrowser/i.test(ua) || /QQBrowser/i.test(ua);

    // —— 专题页地址推导（v18）——
    // 用本脚本自己的 src 反推仓库根，而不是拼相对路径：目录页 / index.html / brand 子目录
    // 各页的 ua-guard 引用前缀不同（./ 与 ../），靠 src 反推才能都落到同一个专题页。
    var REPORT_NAME = 'qq-browser-report.html';
    function sxgScriptBase() {
      try {
        var s = doc.currentScript;
        if (!s || !s.src) {
          var ss = doc.getElementsByTagName('script');
          for (var i = ss.length - 1; i >= 0; i--) {
            if (/ua-guard\.js(?:[?#]|$)/.test(ss[i].src || '')) { s = ss[i]; break; }
          }
        }
        var src = (s && s.src) || '';
        if (!src) return '';
        return src.replace(/[?#][\s\S]*$/, '').replace(/[^/]*$/, '');
      } catch (e) { return ''; }
    }
    var reportBase = sxgScriptBase();
    var onReportPage = false;
    try { onReportPage = new RegExp(REPORT_NAME.replace(/\./g, '\\.') + '$', 'i').test(location.pathname); }
    catch (ePath) { onReportPage = false; }

    // —— 浏览器特征表（v17 重建）——
    // 覆盖范围：硬核联盟（M.H.A，2014 年由华为/OPPO/vivo/金立/联想/酷派发起，后并入魅族 2016、
    //   努比亚(红魔) 2019、荣耀 2024）各厂商自带浏览器 + 传统「5+7」渠道里的 UC/夸克/360/
    //   百度/搜狗/2345 等，PC 端与安卓手机、平板同一张表（平板 UA 尾部多 `DeviceType/tablet`，
    //   厂商浏览器标识串本身不变，所以一套规则通吃三端）。
    // ⚠️ 只认「浏览器标识」，**不认机型号**：像 `XiaoMi` / `realme` / `iQOO` 这类会同时出现在
    //    装了真 Chrome 的小米/OPPO/vivo 手机 UA 里，按机型判定会把正常 Chrome 误伤成
    //    「建议换浏览器」，所以只用 MiuiBrowser / HeyTapBrowser / VivoBrowser 这类浏览器串。
    var DOMESTIC_TOKENS = [
      ['UC', /UCBrowser|UCWEB/i],
      ['夸克', /Quark/i],
      ['360 安全浏览器', /360SE|360Chrome|360EE|360browser|360Browser|360Safe|360安全|QIHU|360 Aphone/i],
      // 新版 360（13/14）UA 去掉了 QIHU/360SE，改成在 Safari/537.36 后直接续斜杠版本号。
      // 标准 Chrome 以 Safari/537.36 结束，三星/Whale 在 Safari 前带自家 token，都不会命中。
      ['360 浏览器', /Safari\/537\.36\/\d/i],
      ['搜狗', /SogouMobileBrowser|MetaSr|SE 2\.X|SogouIE/i],
      ['百度', /baidubrowser|BIDUBrowser/i],
      ['2345', /LBBROWSER|2345Explorer|2345chrome/i],
      ['傲游', /Maxthon/i],
      ['华为（硬核联盟）', /HuaweiBrowser|HMSCore|ArkWeb|OpenHarmony/i],
      ['荣耀（硬核联盟）', /HonorBrowser|HONORBrowser/i],
      ['OPPO/一加/realme（硬核联盟）', /HeyTapBrowser|OPPOBrowser|OppoBrowser/i],
      ['vivo/iQOO（硬核联盟）', /VivoBrowser/i],
      ['小米/Redmi（非联盟）', /MiuiBrowser/i],
      ['联想（硬核联盟）', /LenovoBrowser|LBBrowser|ZUI/i],
      ['魅族（硬核联盟）', /MeizuBrowser|MZBrowser/i],
      ['金立（硬核联盟）', /GioneeBrowser|GIONEE/i],
      ['酷派（硬核联盟）', /CoolpadBrowser|YulongBrowser/i],
      ['努比亚/红魔（硬核联盟）', /NubiaBrowser|RedMagic/i],
      ['支付宝', /AlipayClient/i],
      ['微博', /Weibo/i],
      ['钉钉', /DingTalk/i],
      ['抖音', /aweme/i],
      ['头条', /ToutiaoNews|NewsArticle/i],
      ['酷安', /CoolMarket/i],
      ['QQ 浏览器', /QQBrowser|MQQBrowser/i],
      ['微信', /MicroMessenger/i],
      ['企业微信', /wxwork/i]
    ];
    function sxgMatchDomestic(u) {
      var hits = [];
      for (var i = 0; i < DOMESTIC_TOKENS.length; i++) {
        if (DOMESTIC_TOKENS[i][1].test(u)) hits.push(DOMESTIC_TOKENS[i][0]);
      }
      return hits;
    }
    var domesticHits = sxgMatchDomestic(ua);
    function sxgIsDomesticBrowser(u) {
      return sxgMatchDomestic(u).length > 0;
    }

    // v16：除 QQ 浏览器外，其它国产浏览器不再单独提示（站长 2026-11-20：其他国内浏览器不管了）。
    // 唯一例外是 360 家族 —— 站里专门写了 360 公告，且这条是「能识别出来就提示」的可控判据：
    //   老版本 UA 直给 360SE / 360Chrome / QIHU；13/14 版改成 Safari/537.36/<斜杠版本号>。
    // 识别不出（新版伪装纯 Chrome 的）就交给壳指纹与公告栏，不再猜。
    var is360UA = /360SE|360Chrome|360EE|360browser|360Browser|360Safe|360安全|QIHU|360 Aphone|Safari\/537\.36\/\d/i.test(ua);

    // —— 反伪装交叉验证：UA 说自己是 iPhone/iPad/PC，但内核痕迹露馅 ——
    function sxgSpoofScore() {
      try {
        var plat = navigator.platform || '';
        var vendor = navigator.vendor || '';
        var score = 0;
        var claimsAppleMobile = /iPhone|iPad|iPod/i.test(ua) && !/Android/i.test(ua);
        var claimsDesktop = /Windows NT|Macintosh|X11|Linux x86_64/i.test(ua) && !/Android|Mobile/i.test(ua);

        // 1) 引擎注入对象：X5/QQ 浏览器内核会在 window 挂这些全局，普通浏览器没有。
        if ((claimsAppleMobile || claimsDesktop) && (
            typeof window.mqq !== 'undefined' || typeof window.MQQBrowser !== 'undefined'
            || typeof window.mqqbrowser !== 'undefined'
        )) score += 4;

        // 2) Client Hints 品牌串：Chromium 系带品牌列表，iOS Safari 没有该对象。
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

        // 4) 平台字符串与 UA 声称身份自相矛盾。
        if (claimsAppleMobile && plat && !/iPhone|iPad|iPod/i.test(plat)) score += 3;
        if (claimsDesktop && /iPhone|iPad|iPod|Linux arm|Android/i.test(plat)) score += 3;

        // 5) vendor 串：真 iPhone/iPad Safari 的 vendor 恒为 Apple Computer, Inc.
        if (claimsAppleMobile && vendor && !/Apple/i.test(vendor)) score += 2;

        return score;
      } catch (e) { return 0; /* 探测失败一律按正常浏览器放行，不误伤 */ }
    }
    var spoofScore = (isWeChat || isQQ || isQQBrowser) ? 0 : sxgSpoofScore();
    if (!isWeChat && !isQQ && !isQQBrowser && spoofScore >= 3) isQQBrowser = true;

    // —— 移动端「非标准 Chrome 运行时」指纹（v14，2026-11-20 真机实测后加）——
    // 背景：手机 360 两个版本 UA 里一个国产特征串都没有 ——
    //   普通版：`...; wv) ... Version/4.0 Chrome/124.0.6367.82 Mobile Safari/537.36`（WebView 壳）
    //   极速版：`... Chrome/141.0.0.0 Mobile Safari/537.36`（纯 Chrome 形态）
    // 但同一台真机上的读数暴露了两处真 Chrome 不会出现的差异：
    //   1) navigator.userAgentData 存在、但 brands 为空 —— 真 Chrome / Edge / 三星 / Brave
    //      都会返回 Chromium + 自家品牌；只有 Android WebView 与魔改内核才是空数组。
    //      这是主判据（+3），真 Chrome 基本不可能为空。
    //   2) window.chrome 缺失（+1，只作加分，单独不足以判定，避免误伤个别真机）。
    //   3) UA 带 `; wv)` 且 `Version/4.0`（+1，标准 Android WebView 标记）。
    // 只对「Android + Mobile + UA 自称 Chrome」生效：桌面 Chrome、iOS Safari、
    // 三星 Internet / Naver Whale / Edge 都拿不到分，不会被误判。
    function sxgShellScore() {
      try {
        if (!/Android/i.test(ua) || !/Mobile/i.test(ua)) return 0;
        if (!/Chrome\/[\d.]+/.test(ua)) return 0;
        var score = 0;
        var uad = navigator.userAgentData;
        if (uad && (!uad.brands || uad.brands.length === 0)) score += 3;
        if (typeof window.chrome === 'undefined') score += 1;
        if (/;\s*wv\)/.test(ua) && /Version\/4\.0/.test(ua)) score += 1;
        return score;
      } catch (e) { return 0; }
    }
    // —— 明确已知的「独立浏览器客户端」白名单（v21，2026-11-23）——
    // 这些客户端本身也是 WebView 内核，UA 里带 `; wv)` / 壳指纹，会被误判成「App 内嵌」。
    // 悟空浏览器（字节系，字节自有品牌）UA 尾部带 `wkbrowser <版本号>`；
    // 它不是 App 壳，是用户自己在用的浏览器，必须当普通浏览器放行，不弹「别在 App 内打开」。
    var isKnownBrowserApp = /wkbrowser|wukong\s?browser|wukong\//i.test(ua);
    var shellScore = (isWeChat || isQQ || isKnownBrowserApp) ? 0 : sxgShellScore();

    // 「被装进某个 App 里打开」——标准 Android WebView 标记：`; wv)` + `Version/4.0`。
    // 微信 / QQ 内置已被前面两档接管（硬拦截），这里只覆盖剩下的 App 壳
    // （小红书、知乎、贴吧、淘宝等点开链接的情形）。360 手机版普通版也走 WebView，
    // 指纹与这些 App 壳完全同类、无法区分 —— 站长口径（2026-11-20）：这类一律只提示
    // 「别在 App 内打开」，不贴国产标签、不劝换浏览器。360 极速版等独立浏览器没有 wv
    // 标记，走下面的「非标准 Chromium 浏览器」分支。
    //
    // v16（2026-11-20 定稿：「App 内访问一定是弹提示的，但不强制拦截」）：
    //   Android 侧仍靠 `; wv)` + `Version/4.0`；
    //   iOS 的 WKWebView 不带 wv 标记，改用「带 AppleWebKit、却没有 Safari/ 尾巴，
    //   也不是 CriOS / FxiOS / EdgiOS 这些真浏览器」来认定 —— 宁可漏判不放行误伤。
    var isAndroidWebView = /Android/i.test(ua) && /Mobile/i.test(ua) &&
      /Chrome\/[\d.]+/.test(ua) && /;\s*wv\)/i.test(ua) && /Version\/4\.0/i.test(ua);
    var isIosWebView = /iPhone|iPad|iPod/i.test(ua) && !/Android/i.test(ua) &&
      /AppleWebKit/i.test(ua) && !/Safari\//i.test(ua) &&
      !/CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo/i.test(ua);
    var isInAppWebView = !isWeChat && !isQQ && !isQQBrowser && !isKnownBrowserApp &&
      (isAndroidWebView || isIosWebView);

    // —— 强制国产提示开关（自助兜底，2026-11-20 加，v13 起可撤销）——
    // 新版 360（v13+）UA 伪装成纯 Chrome，JS 已无法区分，故给一条不靠猜身份的自助出路：
    //   ?force-domestic=1  →  localStorage 永久写入，本站所有页面显示国产提示条；
    //   ?force-domestic=0  →  同时清除 localStorage + sessionStorage，撤销标记。
    var forceDomestic = false;
    var FD_KEY = 'sxg-force-domestic';
    try {
      var fdLs = null, fdSs = null;
      try { fdLs = localStorage.getItem(FD_KEY); } catch (eLs) {}
      try { fdSs = sessionStorage.getItem(FD_KEY); } catch (eSs) {}
      if (/[?&]force-domestic=1(?:&|$)/.test(location.search)) {
        try { localStorage.setItem(FD_KEY, '1'); } catch (eSetLs) {}
        try { sessionStorage.setItem(FD_KEY, '1'); } catch (eSetSs) {}
        fdLs = '1'; fdSs = '1';
      } else if (/[?&]force-domestic=0(?:&|$)/.test(location.search)) {
        try { localStorage.removeItem(FD_KEY); } catch (eDelLs) {}
        try { sessionStorage.removeItem(FD_KEY); } catch (eDelSs) {}
        fdLs = null; fdSs = null;
      } else if (fdSs === '1' && fdLs !== '1') {
        // 旧版会话标记迁移到永久存储：上次会话点过的访客自动升级，不用再点一次
        try { localStorage.setItem(FD_KEY, '1'); } catch (eMig) {}
        fdLs = '1';
      }
      forceDomestic = fdLs === '1' || fdSs === '1';
    } catch (e) { /* 存储全禁用：本页不标记，不抛错拖垮页面 */ }

    var debugOn = /[?&]ua-debug(?:=1)?(?:&|$)/.test(location.search);

    // 最终动作（诊断面板要用）
    // v20 口径（2026-11-23 站长定稿）：拦截页**只针对微信**；QQ（手机 QQ、电脑 QQ、TIM）
    // 一律正常放行，不拦不提示；只有独立 QQ 浏览器跳专题页。
    //   ① 微信 / 企业微信 → hard-block（复制地址到系统浏览器打开的全屏拦截层）；
    //   ② 独立 QQ 浏览器 → qq-report-redirect：立即跳 qq-browser-report.html；
    //      已经在专题页上 → qq-report-page：不跳，只亮顶部说明条；
    //   ③ QQ 客户端（含电脑 QQ）→ pass：不拦、不弹提示、不跳专题页；
    //   ④ App 内嵌 WebView → app-notice（一定弹提示，但不拦内容）；
    //   ⑤ **能检测到的其它浏览器**（UC/夸克/360/搜狗/百度/2345/傲游 + 硬核联盟各家自带浏览器
    //      + 华为·荣耀·OPPO·vivo·小米·联想·魅族·金立·酷派·努比亚）→ notice：
    //      在页头 <header> 下方加一条黄色横幅，正文整体下移，不遮挡；
    //   ⑥ 识别不出（如新版 360 把 UA 洗成标准 Chrome）→ 什么都弹不出来，靠公告栏兜底。
    var action = 'pass';
    if (isWeChat) action = 'hard-block';
    else if (isQQBrowser) action = onReportPage ? 'qq-report-page' : 'qq-report-redirect';
    else if (isQQ) action = 'pass';
    else if (isInAppWebView) action = 'app-notice';
    else if (forceDomestic || shellScore >= 3 || is360UA || domesticHits.length > 0) action = 'notice';

    // 诊断信息挂到 window，方便站长在控制台 / 远程调试直接读
    var diag = {
      version: VERSION,
      action: action,
      ua: ua,
      platform: (navigator.platform || ''),
      vendor: (navigator.vendor || ''),
      spoofScore: spoofScore,
      shellScore: shellScore,
      inAppWebView: isInAppWebView,
      androidWebView: isAndroidWebView,
      knownBrowserApp: isKnownBrowserApp,
      iosWebView: isIosWebView,
      domesticHits: domesticHits,      // v16 起仅作诊断展示，不再触发提示
      is360: is360UA,                  // 360 家族仍保留提示
      forceDomestic: forceDomestic,
      wechat: isWeChat,
      qqInApp: isQQ,
      qqDesktopApp: isDesktopQQApp,
      qqBrowser: isQQBrowser,
      qqBrowserByUA: qqBrowserByUA,
      qqBrowserToken: qqBrowserToken,
      coreChromium: coreChromium,
      onReportPage: onReportPage,
      reportTarget: reportBase + REPORT_NAME
    };
    try { window.__SXG_UA__ = diag; } catch (e) {}

    // —— 复制工具（拦截层与诊断面板共用）——
    function sxgCopyText(text) {
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

    // —— App 内嵌 WebView：只提示「别在 App 内打开」，仅此而已 ——
    // 站长 2026-11-20 定稿：不贴国产标签、不劝换浏览器、不给撤销或关闭入口。
    // 文案只有一句，控件一个都没有。
    function sxgShowAppNotice() {
      var css = [
        '#sxg-app-notice{position:sticky;top:0;left:0;right:0;width:100vw;max-width:100vw;margin:0;',
        '  z-index:2147483000;background:#fef3c7;color:#7f1d1d;',
        '  box-shadow:0 2px 10px rgba(120,53,15,.18);',
        '  font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;',
        '  font-size:12.5px;line-height:1.55;padding:8px 14px;text-align:center;box-sizing:border-box}',
        '@media (max-width:400px){#sxg-app-notice{font-size:12px;padding:7px 12px}}'
      ].join('');
      function build() {
        if (doc.getElementById('sxg-app-notice')) return;
        var style = doc.createElement('style');
        style.id = 'sxg-app-notice-style';
        style.setAttribute('data-sxg-app-notice', 'css');
        style.textContent = css;
        (doc.head || root).appendChild(style);
        var bar = doc.createElement('div');
        bar.id = 'sxg-app-notice';
        bar.setAttribute('role', 'note');
        bar.textContent = '你正在 App 内打开本页。App 内置浏览器常会限制保存、分享和数据留存，建议复制链接到系统浏览器（Safari / Chrome / Edge）打开。';
        if (doc.body) doc.body.insertBefore(bar, doc.body.firstChild);
        else root.appendChild(bar);
        try {
          var hh = Math.round(bar.getBoundingClientRect().height);
          if (hh) root.setAttribute('data-sxg-app-notice-h', String(hh));
        } catch (e) {}
      }
      if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', build);
      else build();
    }

    // —— 浏览器横幅：插在页头 <header> 之后（原「乌克兰声明条」那一行），走文档流 ——
    // 站长 2026-11-20 定稿：「能检测到的话，就在原本乌克兰那个位置加一条黄色横幅提示，
    // 推荐使用 xx 浏览器。网站内容整体下移，防止被这个遮挡。」
    // 所以这里和 v13 的 sticky 顶部条彻底分开：不 fixed、不 sticky、不覆盖任何内容，
    // 横幅占自己的高度，下面的正文自然被推下去。命中范围见 DOMESTIC_TOKENS（含硬核联盟成员）。
    function sxgShowBrowserNotice() {
      var css = [
        '#sxg-browser-notice{width:100%;max-width:1100px;margin:0 auto;background:#fffbeb;color:#7f1d1d;',
        '  border-top:2px solid #f59e0b;border-bottom:1px solid #f59e0b;text-align:center;font-weight:700;',
        '  font-size:13px;line-height:1.6;padding:8px 16px;box-sizing:border-box;',
        '  font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif}',
        '#sxg-browser-notice a{color:#991b1b;text-decoration:underline;font-weight:700}',
        '#sxg-browser-notice a:focus-visible{outline:2px solid #92400e;outline-offset:2px}',
        '#sxg-browser-notice .sxg-revoke{display:inline-block;margin:2px 0 0;font-size:11.5px;',
        '  font-weight:400;color:#92400e;text-decoration:none;border-bottom:1px dashed #b45309;opacity:.9}',
        '@media (max-width:640px){#sxg-browser-notice{font-size:12px;padding:7px 14px;line-height:1.6;text-align:left}}'
      ].join('');

      // 横幅里报出「具体是哪一家的浏览器」，识别不出具体品牌时用兜底说法
      function brandLabel() {
        // 表里的括号只是给维护者看的（硬核联盟归属、非联盟备注），不往用户面前放
        if (domesticHits.length) return domesticHits[0].replace(/（[^）]*）/g, '');
        if (is360UA) return '360 浏览器';
        if (shellScore >= 3) return '非标准 Chromium 内核浏览器（如 360 极速版一类）';
        return '当前浏览器';
      }

      function buildNotice() {
        if (doc.getElementById('sxg-browser-notice')) return;
        var style = doc.getElementById('sxg-browser-notice-style');
        if (!style) {
          style = doc.createElement('style');
          style.id = 'sxg-browser-notice-style';
          style.setAttribute('data-sxg-browser-notice', 'css');
          style.textContent = css;
          (doc.head || root).appendChild(style);
        }
        var bar = doc.createElement('div');
        bar.id = 'sxg-browser-notice';
        bar.setAttribute('role', 'note');
        // v16/v17：不提「国产」，只说浏览器本身；也不挂任何外链（原先那条 #sxg-bing-guide 是死链，已删）
        bar.appendChild(doc.createTextNode(
          '检测到你正在使用「' + brandLabel() + '」。这类浏览器可能改写页面内容、限制部分功能，本站是 GitHub 纯静态页、没有服务端，无法逐一核实这些行为。建议改用 Chrome、Edge、Safari 或 Firefox 浏览本站；本站不强制拦截，继续留在这里也可以。'
        ));
        // 仅「自助声明」触发时给撤销入口：避免误点一次后永久消不掉
        if (forceDomestic && domesticHits.length === 0) {
          var wrap = doc.createElement('div');
          var revoke = doc.createElement('a');
          revoke.className = 'sxg-revoke';
          revoke.href = sxgRevokeHref();
          revoke.textContent = '已换用 Chrome / Edge 仍见此条？点此清除标记';
          wrap.appendChild(revoke);
          bar.appendChild(wrap);
        }
        // 位置：<header> 之后的那一行（原乌克兰声明条所在地）；header 还没渲染就先挂在 body 最前，
        // 等 MutationObserver 下一轮再挪到 header 后面 —— 两种情况都是文档流，都不会遮挡正文。
        var header = null;
        try { header = doc.querySelector('header'); } catch (e) {}
        if (bar.parentNode) bar.parentNode.removeChild(bar);
        // 乌克兰声明条（policy-notice.js）也在 header 后面，两个都留着时让政策条在前、本横幅紧随其后
        var policy = null;
        try { policy = doc.getElementById('sxg-policy-notice'); } catch (e) {}
        var anchor = header;
        if (header && policy && policy.parentNode === header.parentNode) anchor = policy;
        if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(bar, anchor.nextSibling);
        else if (doc.body) doc.body.insertBefore(bar, doc.body.firstChild);
        else root.appendChild(bar);
        try {
          var hh = Math.round(bar.getBoundingClientRect().height);
          if (hh) root.setAttribute('data-sxg-browser-notice-h', String(hh));
        } catch (e) {}
      }

      if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', buildNotice);
      else buildNotice();
      // React 渲染 <header> 要等，与 policy-notice.js 同批重试；超时后不再折腾
      window.setTimeout(buildNotice, 300);
      window.setTimeout(buildNotice, 900);
      window.setTimeout(buildNotice, 2200);
      if (window.MutationObserver && doc.body) {
        var tries = 0;
        var obs = new MutationObserver(function () {
          buildNotice();
          if (++tries > 60) obs.disconnect();
        });
        try { obs.observe(doc.body, { childList: true, subtree: true }); } catch (e) {}
      }
    }

    // 撤销链接：去掉已有 force-domestic 参数再写 =0，保留其余查询串
    function sxgRevokeHref() {
      try {
        var u = new URL(location.href);
        u.searchParams.delete('force-domestic');
        u.searchParams.set('force-domestic', '0');
        return u.toString();
      } catch (e) {
        return location.pathname + '?force-domestic=0';
      }
    }

    // —— ?ua-debug=1 诊断面板：站长采样用，不参与正常分流判断 ——
    function sxgDrawDebug() {
      if (doc.getElementById('sxg-ua-debug')) return;
      var css = [
        '#sxg-ua-debug{position:fixed;left:8px;bottom:8px;z-index:2147483647;',
        '  max-width:min(92vw,520px);max-height:52vh;overflow:auto;',
        '  background:rgba(15,23,42,.95);color:#e2e8f0;border-radius:10px;padding:10px 12px;',
        '  font:11.5px/1.65 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;',
        '  box-shadow:0 10px 28px rgba(0,0,0,.35);white-space:pre-wrap;word-break:break-all;',
        '  text-align:left;-webkit-user-select:text;user-select:text}',
        '#sxg-ua-debug .sxg-dbg-ok{color:#86efac;font-weight:700}',
        '#sxg-ua-debug .sxg-dbg-no{color:#fca5a5;font-weight:700}',
        '#sxg-ua-debug .sxg-dbg-bar{display:flex;gap:8px;margin-top:9px}',
        '#sxg-ua-debug button{cursor:pointer;border:none;border-radius:6px;padding:5px 11px;',
        '  font:11.5px system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;',
        '  background:#0F766E;color:#fff}',
        '#sxg-ua-debug button.sxg-dbg-close{background:#334155}'
      ].join('');
      var text = [
        '双休购 UA 诊断 ' + VERSION,
        '动作：' + action,
        'UA：' + (ua || '(空)'),
        'platform：' + (diag.platform || '(空)'),
        'vendor：' + (diag.vendor || '(空)'),
        '反伪装分：' + spoofScore,
        '壳指纹分：' + shellScore + (shellScore >= 3 ? '（判定为非标准 Chrome 运行时）' : ''),
        'App 内嵌 WebView：' + (isInAppWebView ? '是' : '否') +
          '（Android ' + (isAndroidWebView ? '是' : '否') + ' / iOS ' + (isIosWebView ? '是' : '否') + '）',
        'uad.brands：' + (function () {
          try {
            var u = navigator.userAgentData;
            if (!u) return '不存在';
            var b = u.brands || [];
            return b.length ? b.map(function (x) { return x.brand + ' ' + x.version; }).join(' / ') : '空数组';
          } catch (e) { return '读取失败'; }
        })(),
        'window.chrome：' + (typeof window.chrome === 'undefined' ? '不存在' : '存在'),
        'UA 特征命中：' + (domesticHits.length ? domesticHits.join('、') + '（仅展示，v16 起除 360 外不据此提示）' : '无'),
        '360 家族 UA：' + (is360UA ? '是' : '否'),
        'force-domestic：' + (forceDomestic ? '是' : '否'),
        '微信/企业微信：' + (isWeChat ? '是' : '否'),
        'QQ 内置：' + (isQQ ? '是' : '否'),
        'QQ 浏览器：' + (isQQBrowser ? '是' : '否')
      ].join('\n');

      function build() {
        var style = doc.createElement('style');
        style.textContent = css;
        style.setAttribute('data-sxg-ua-debug', 'css');
        (doc.head || root).appendChild(style);

        var box = doc.createElement('div');
        box.id = 'sxg-ua-debug';
        box.setAttribute('role', 'region');
        box.setAttribute('aria-label', 'UA 诊断面板');
        box.textContent = text;

        var bar = doc.createElement('div');
        bar.className = 'sxg-dbg-bar';
        var copy = doc.createElement('button');
        copy.type = 'button';
        copy.textContent = '复制诊断信息';
        var close = doc.createElement('button');
        close.type = 'button';
        close.className = 'sxg-dbg-close';
        close.textContent = '收起';
        close.addEventListener('click', function () {
          box.textContent = '双休购 UA 诊断 ' + VERSION + '（已收起，刷新可再显示）';
          bar.parentNode && bar.parentNode.removeChild(bar);
        });
        copy.addEventListener('click', function () {
          sxgCopyText(text).then(function (ok) {
            copy.textContent = ok ? '✓ 已复制' : '复制失败，请长按选择';
          });
        });
        bar.appendChild(copy);
        bar.appendChild(close);
        box.appendChild(bar);
        (doc.body || root).appendChild(box);
      }
      if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', build);
      else build();
    }

    // —— 分流执行 ——
    // 1) 独立 QQ 浏览器：立即跳专题页（专题页自身不再跳，只给 <html> 打
    //    data-sxg-qq-browser="1"，由专题页自己的 CSS 亮出顶部说明；debug 模式暂停跳转）。
    if (isQQBrowser && !isWeChat && !isQQ) {
      if (debugOn) {
        sxgDrawDebug();
        return;
      }
      try { root.setAttribute('data-sxg-qq-browser', '1'); } catch (eAttr) {}
      if (!onReportPage) {
        try { location.replace(reportBase + REPORT_NAME); } catch (eJump) {}
      }
      return;
    }

    // 2) QQ 客户端（手机 QQ / 电脑 QQ / TIM）：v20 起一律正常放行——不拦、不弹提示、
    //    不跳专题页，站点内容原样展示；debug 模式仍可看判定依据。
    if (isQQ) {
      if (debugOn) sxgDrawDebug();
      return;
    }

    // 3) 其余浏览器：App 壳只提示「别在 App 内打开」；自助声明 / 非标准壳才弹提示条。
    if (!isWeChat) {
      if (isInAppWebView) sxgShowAppNotice();
      else if (forceDomestic || sxgIsDomesticBrowser(ua) || shellScore >= 3 || is360UA) sxgShowBrowserNotice();
      if (debugOn) sxgDrawDebug();
      return;
    }

    // 4) 微信 / 企业微信：全屏硬拦截（v20 起拦截页只留给微信，QQ 浏览器与 QQ 已在上游分流）
    if (root.getAttribute('data-sxg-ua-block')) return;
    root.setAttribute('data-sxg-ua-block', '1');

    var css = [
      'html[data-sxg-ua-block] body > *:not(#sxg-ua-guard):not(#sxg-ua-debug){display:none!important}',
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

      btn.addEventListener('click', function () {
        if (btn.getAttribute('data-sxg-ua-state') === 'done') return;
        sxgCopyText(location.href).then(function (ok) {
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
    if (debugOn) sxgDrawDebug();
  } catch (e) {
    /* 任何异常都不能把正常浏览器拖垮：静默退出 */
  }
})();
