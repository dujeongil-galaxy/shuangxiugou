// 2026-11-09 站长深夜批次回归：滚动广告位「天猫链接点不动 / 不居中 / 没有设计图」。
// 真 DOM 验证（jsdom 加载 black-card-adslot.js），不是只比对配置字符串——
// 这个站的默认静默失效方式就是「源码写得对、渲染出来是 <div> 不是 <a>」。
// 跑法：npm install --no-save jsdom && node scripts/test-adslot.cjs
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const TMALL = 'https://' + 'luxiyi.tmall.com/'; // 拼接避免本文件被参数红线误扫
// 站长 2026-11-11 01:48「链接不对，替换这个」：微信小程序口令，不是可点 URL。
// 以 # 开头、零参数；只有粘贴到微信聊天窗口发送后才会渲染成小程序卡片。
const PDL_LINK = '#小程序://胖东来/zxlej7hK8bNv5Sj';
const ART_BRAND = './assets/ad-luxiyi.svg?v=2';
const ART_PDL = './assets/ad-pangdonglai.svg?v=3';
const ART_RECRUIT = './assets/ad-recruit.svg?v=5';
const PDL_DETAIL = './brand/pdl.html';

let pass = 0, fail = 0;
const fails = [];
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else {
    fail++; fails.push(label);
    console.log('  ✗', label, extra !== undefined ? JSON.stringify(extra) : '');
  }
}

(async () => {
  console.log('=== 滚动广告位：可点 / 居中 / 设计图 ===\n');
  const src = read('black-card-adslot.js');

  // ─────────── 0. 三张站点自绘设计稿 ───────────
  console.log('--- 0. 广告位专用设计图 ---');
  for (const [f, label] of [['assets/ad-luxiyi.svg', '品牌广告设计稿'],
                            ['assets/ad-pangdonglai.svg', '胖东来广告设计稿'],
                            ['assets/ad-recruit.svg', '招商卡设计稿']]) {
    const okFile = fs.existsSync(path.join(ROOT, f));
    check(label + '真实存在', okFile, f);
    if (okFile) {
      const svg = read(f);
      check(label + '是有效矢量 SVG（带 viewBox）',
        /<svg[\s\S]*?viewBox="0 0 \d+ \d+"/.test(svg) && /<\/svg>\s*$/.test(svg));
      // xmlns="http://www.w3.org/2000/svg" 是 SVG 命名空间声明，不是外链；先剥掉再判
      const svgNoNs = svg.replace(/xmlns(?::[a-zA-Z]+)?="[^"]*"/g, '');
      check(label + '不含任何外链 / URL（素材不上传、不放外链）',
        !/https?:\/\//.test(svgNoNs) && !/<image\b/i.test(svgNoNs)
        && !/\b(?:xlink:)?href\s*=\s*['"]https?:/i.test(svgNoNs));
    }
  }
  check('组件引用了三张设计稿（单一真相源）',
    src.indexOf("var ART = '" + ART_BRAND + "'") !== -1
    && src.indexOf("var ART_PDL = '" + ART_PDL + "'") !== -1
    && src.indexOf("var ART_RECRUIT = '" + ART_RECRUIT + "'") !== -1);
  check('品牌 mascot 仍复用 luxiyi.jpg（不重复入库明文素材）',
    src.indexOf("var IMG = './assets/luxiyi.jpg'") !== -1);

  // ─────────── 1. 真 DOM：加载补丁、替换黑卡 ───────────
  console.log('\n--- 1. 真 DOM 渲染 ---');
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => {
    if (/Could not load|not implemented/i.test(e.message)) return;
    errors.push(e.message);
  });
  const dom = new JSDOM(
    '<!doctype html><html><head></head><body>' +
    '<div class="bg-slate-900" id="blackcard">全网打工人已转移消费额 · 174 家企业</div>' +
    '</body></html>',
    { runScripts: 'outside-only', url: 'http://localhost/', virtualConsole: vc, pretendToBeVisual: true }
  );
  const { window } = dom;
  const doc = window.document;
  try { window.eval(src); } catch (e) { errors.push('eval adslot: ' + e.message); }
  const slot = doc.querySelector('[data-adslot-reserved]');
  check('黑卡已被替换成滚动广告位', !!slot);
  if (!slot) { console.log('渲染失败，后续断言跳过'); process.exit(1); }

  const banner = slot.querySelector('.sxg-adslot__banner');
  const cta = slot.querySelector('.sxg-adslot__cta');
  const name = slot.querySelector('.sxg-adslot__name');
  const avatar = slot.querySelector('.sxg-adslot__avatar');
  const arts = slot.querySelectorAll('.sxg-adslot__art');

  // 站长：「天猫链接也点不动啊」——CTA 必须是真 <a>，整张广告图也必须是真 <a>
  check('CTA 提示词是真 <a>（不再是没 href 的 <div>）',
    !!cta && cta.tagName === 'A', cta && cta.tagName);
  check('CTA href 指向天猫零参数店铺首页',
    !!cta && cta.getAttribute('href') === TMALL, cta && cta.getAttribute('href'));
  check('CTA 新窗口打开且带 noopener',
    !!cta && cta.getAttribute('target') === '_blank' && cta.getAttribute('rel') === 'noopener');
  check('整张广告设计图被 <a> 包裹（点图片就能跳）',
    !!banner && banner.tagName === 'A' && banner.getAttribute('href') === TMALL,
    banner && banner.tagName + ':' + banner.getAttribute('href'));
  check('广告图 src 就是新设计的品牌广告稿',
    !!banner && banner.querySelector('img.sxg-adslot__art')
    && banner.querySelector('img.sxg-adslot__art').getAttribute('src') === ART_BRAND);
  check('品牌名仍指向站内详情页',
    !!name && name.getAttribute('href') === './brand/luxiyi.html',
    name && name.getAttribute('href'));
  check('品牌卡小头像仍用 mascot 单一真相源',
    !!avatar && avatar.getAttribute('src') === './assets/luxiyi.jpg',
    avatar && avatar.getAttribute('src'));
  check('三张卡各挂一张设计图', arts.length === 3,
    [...arts].map((x) => x.getAttribute('src')));
  check('胖东来卡设计稿引用正确',
    !!arts[1] && arts[1].getAttribute('src') === ART_PDL);
  check('招商卡设计稿引用正确',
    !!arts[2] && arts[2].getAttribute('src') === ART_RECRUIT);

  // ─────────── 1b. 胖东来卡（01:48 修订：小程序口令 / 点击复制 / 零视频链接） ───────────
  console.log('\n--- 1b. 胖东来卡：站内链 + 小程序口令 + 零视频链接 ---');
  const pdlName = slot.querySelector('.sxg-adslot__card--pdl .sxg-adslot__name');
  const pdlAvatar = slot.querySelector('.sxg-adslot__card--pdl .sxg-adslot__avatar');
  const pdlTag = slot.querySelector('.sxg-adslot__card--pdl .sxg-adslot__tag');
  check('胖东来品牌名链站内详情页',
    !!pdlName && pdlName.getAttribute('href') === PDL_DETAIL,
    pdlName && pdlName.getAttribute('href'));
  check('胖东来头像用站内 pdl.png',
    !!pdlAvatar && pdlAvatar.getAttribute('src') === './assets/pdl.png',
    pdlAvatar && pdlAvatar.getAttribute('src'));
  check('胖东来信息行带劳动者态度备注',
    !!pdlTag && /劳动者/.test(pdlTag.textContent) && /尊重/.test(pdlTag.textContent),
    pdlTag && pdlTag.textContent);
  const pdlBanner = slot.querySelector('.sxg-adslot__card--pdl .sxg-adslot__banner');
  const pdlCta = slot.querySelector('.sxg-adslot__card--pdl .sxg-adslot__cta');
  const pdlCardHtml = slot.querySelector('.sxg-adslot__card--pdl').innerHTML;
  check('胖东来整张广告图挂站长指定的小程序口令（真 <a>、新窗口 noopener）',
    !!pdlBanner && pdlBanner.tagName === 'A' && pdlBanner.getAttribute('href') === PDL_LINK
    && pdlBanner.getAttribute('target') === '_blank'
    && pdlBanner.getAttribute('rel') === 'noopener',
    pdlBanner && pdlBanner.tagName + ':' + pdlBanner.getAttribute('href'));
  check('复制内容是 # 开头的小程序口令，不是 http 链接（旧文章链接已撤下）',
    PDL_LINK.charAt(0) === '#' && !/^https?:/.test(PDL_LINK)
    && !/bendibao/.test(src), PDL_LINK);
  check('胖东来 CTA 是真 <a> 且同挂 PDL_LINK（单一真相源）',
    !!pdlCta && pdlCta.tagName === 'A' && pdlCta.getAttribute('href') === PDL_LINK
    && pdlCta.getAttribute('target') === '_blank'
    && pdlCta.getAttribute('rel') === 'noopener',
    pdlCta && pdlCta.tagName + ':' + pdlCta.getAttribute('href'));
  check('可见文案同步换「复制小程序口令 / 去微信」（不许只改常量留旧来源标签）',
    !!pdlCta && /小程序口令/.test(pdlCta.textContent)
    && /复制/.test(pdlCta.textContent) && /微信/.test(pdlCta.textContent)
    && !/天猫|淘宝|京东/.test(pdlCta.textContent)
    && !!pdlBanner && /复制/.test(pdlBanner.getAttribute('aria-label') || '')
    && /微信/.test(pdlBanner.getAttribute('aria-label') || '')
    && !/天猫|淘宝|京东/.test(pdlBanner.getAttribute('aria-label') || ''),
    pdlCta && pdlCta.textContent);
  check('整图与 CTA 都带 data-sxg-share 接线点',
    !!pdlBanner && pdlBanner.getAttribute('data-sxg-share') === 'pdl'
    && !!pdlCta && pdlCta.getAttribute('data-sxg-share') === 'pdl');
  check('胖东来卡零京东 / 淘宝 / 天猫链接与来源标签',
    !/tmall|taobao|天猫|淘宝|京东|jd\.com/i.test(pdlCardHtml));
  // 文案进图里：劳动者态度（站长 19:48「备注两个字去掉」，可见文案不许再带该前缀）
  // + 挂上广告位的原因，缺一不可。关键词只认 <text> 可见文案
  //（aria-label/注释里写满原话也能逃逸断言的坑）。
  const pdlSvg = read('assets/ad-pangdonglai.svg');
  const pdlWords = [...pdlSvg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]).join(' ');
  check('胖东来海报去掉「备注」两字，劳动者态度仍写进图里',
    !/备注/.test(pdlWords) && /货车司机送货/.test(pdlWords) && /尊重/.test(pdlWords),
    pdlWords);
  check('胖东来海报写明这正是挂上公益广告位的原因',
    /公益广告位的原因/.test(pdlWords) && /善待劳动者/.test(pdlWords));
  // 「但不得直接把视频链接挂在广告位」——脚本 / 三张海报 / 渲染 DOM 三侧都不许出现
  // 短链域名。按源码原文扫（含注释）：剥注释的 // 正则会把 https:// 当行注释吃掉
  // URL 尾巴（故障注入实测静默放行）；域名模式带点，避免误伤 douyin-prompt.css。
  const videoRe = /douyin\.com|b23\.tv/i;
  check('广告位零视频链接（脚本 / 三张设计图 / 渲染 DOM 都不许挂）',
    !videoRe.test(src)
    && !videoRe.test(read('assets/ad-luxiyi.svg'))
    && !videoRe.test(read('assets/ad-pangdonglai.svg'))
    && !videoRe.test(read('assets/ad-recruit.svg'))
    && !videoRe.test(slot.innerHTML),
    '广告位出现了短视频链接域名');

  // ─────────── 1c. 点击复制 + 微信提示（真点击，不是只比对字符串） ───────────
  // 站长 2026-11-11 00:46「参考良配的广告，点了就自动复制，弹窗提醒用户自己去微信」。
  // jsdom 没有 execCommand / clipboard，先补一个记录调用的桩，再真派发 click，
  // 检查：阻止默认跳转、同步复制被调用、toast 可见且写着微信与链接本体。
  console.log('\n--- 1c. 点击胖东来广告：自动复制 + 弹窗提醒去微信 ---');
  const copyCalls = [];
  doc.execCommand = function (cmd) { copyCalls.push(cmd); return true; };
  const clickEvt = new window.MouseEvent('click', { bubbles: true, cancelable: true });
  pdlCta.dispatchEvent(clickEvt);
  check('点击 CTA 阻止默认跳转（点了不直接打开链接）', clickEvt.defaultPrevented);
  check('点击时同步调用 execCommand copy（趁用户手势栈）',
    copyCalls.indexOf('copy') !== -1, copyCalls);
  // toast 在 copyText 的 Promise 链末端出现，放掉整个微任务队列再查
  await new Promise((r) => setTimeout(r, 0));
  const toast = doc.querySelector('[data-sxg-share-toast]');
  check('弹出提示且可见（is-show）', !!toast && toast.classList.contains('is-show'));
  check('提示明确要求用户自己去微信', !!toast && /微信/.test(toast.textContent));
  check('提示标题写「已复制小程序口令」，不再把口令叫链接',
    !!toast && /已复制小程序口令/.test(toast.textContent)
    && !/已复制链接/.test(toast.textContent), toast && toast.textContent);
  check('提示里有操作步骤（粘贴 → 发送 → 点开小程序卡片）',
    !!toast && /粘贴/.test(toast.textContent) && /点开/.test(toast.textContent)
    && /小程序卡片/.test(toast.textContent));
  const toastCode = toast && toast.querySelector('.sxg-adslot__toast-code');
  check('提示里放的是可点再复制的小程序口令本体',
    !!toastCode && toastCode.textContent === PDL_LINK,
    toastCode && toastCode.textContent);
  const bannerEvt = new window.MouseEvent('click', { bubbles: true, cancelable: true });
  pdlBanner.dispatchEvent(bannerEvt);
  check('整张广告图也绑了同一套复制交互', bannerEvt.defaultPrevented);
  check('不再按 UA 放行跳转（微信内置浏览器里也必须复制口令）',
    !/isWeChat/.test(src) && !/MicroMessenger/.test(src)
    && bannerEvt.defaultPrevented);
  check('提示里的链接可点再复制（code 点击不报错）', (function () {
    if (!toastCode) return false;
    try { toastCode.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); return true; }
    catch (e) { return false; }
  })());

  // ─────────── 2. 居中 & 箭头不再压住文案 ───────────
  console.log('\n--- 2. 内容居中 / 箭头位置 ---');
  check('卡片本身 align-items:center + text-align:center',
    /\.sxg-adslot__card\{[^}]*align-items:center[^}]*text-align:center/.test(src));
  check('信息条 justify-content:center',
    /\.sxg-adslot__meta\{[^}]*justify-content:center/.test(src));
  check('招商卡不再有 HTML 文案层（文案只画在设计图里，杜绝两套文案叠字）',
    !/sxg-adslot__recruit-copy|sxg-adslot__recruit-title|sxg-adslot__recruit-sub/.test(src)
    && !slot.querySelector('.sxg-adslot__recruit-copy'));
  // 文案在图里 → 直接看 SVG 里三条主文案的基线是否严格递增（叠字唯一能机器判红的抓手）
  const recTexts = [...read('assets/ad-recruit.svg').matchAll(/<text[^>]*?y="(\d+)"[^>]*?font-size="(\d+)"/g)]
    .map((m) => ({ y: Number(m[1]), size: Number(m[2]) }))
    .filter((t) => t.y >= 100 && t.y <= 260)
    .sort((a, b) => a.y - b.y);
  check('设计图里三条主文案基线严格递增（不叠字）',
    recTexts.length >= 3 && recTexts.every((t, i) => i === 0 || t.y > recTexts[i - 1].y)
    && recTexts[0].size >= 60, JSON.stringify(recTexts));
  const pdlTexts = [...read('assets/ad-pangdonglai.svg').matchAll(/<text[^>]*?y="(\d+)"[^>]*?font-size="(\d+)"/g)]
    .map((m) => ({ y: Number(m[1]), size: Number(m[2]) }))
    .filter((t) => t.y >= 100 && t.y <= 260)
    .sort((a, b) => a.y - b.y);
  check('胖东来海报三条主文案基线严格递增（不叠字）',
    pdlTexts.length >= 3 && pdlTexts.every((t, i) => i === 0 || t.y > pdlTexts[i - 1].y)
    && pdlTexts[0].size >= 60, JSON.stringify(pdlTexts));
  const tag = slot.querySelector('.sxg-adslot__card--recruit .sxg-adslot__tag');
  check('招商卡信息行仍是正常流文字（手机端可读），不是图片里的小字',
    !!tag && /可申请免费展示/.test(tag.textContent));
  const foot = slot.querySelector('.sxg-adslot__foot');
  const prev = slot.querySelector('.sxg-adslot__prev');
  const next = slot.querySelector('.sxg-adslot__next');
  check('左右箭头移到了卡片下方导航条（不再绝对定位盖住标题）',
    !!foot && !!prev && !!next && foot.contains(prev) && foot.contains(next));
  check('箭头 CSS 已无 position:absolute',
    !/\.sxg-adslot__nav\{[^}]*position:absolute/.test(src));
  check('招商卡的信息行与切换提示仍在 DOM 里（未被图片吞掉）',
    /可申请免费展示/.test(slot.textContent) && /欢迎联系站长|自动轮播/.test(slot.textContent));

  // ─────────── 3. 轮播交互没被改坏 ───────────
  console.log('\n--- 3. 手动切换 / 自动轮播 ---');
  const track = slot.querySelector('.sxg-adslot__track');
  check('共 3 张广告卡', slot.querySelectorAll('.sxg-adslot__card').length === 3);
  check('3 个圆点且首张高亮',
    slot.querySelectorAll('.sxg-adslot__dot').length === 3
    && slot.querySelector('.sxg-adslot__dot').className.indexOf('is-active') !== -1);
  check('初始 transform 为 translateX(0%)', /translateX\(0%\)/.test(track.style.transform),
    track.style.transform);
  next.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  check('点「下一张」后滚动到第 2 张（胖东来）', /translateX\(-100%\)/.test(track.style.transform),
    track.style.transform);
  const dots = slot.querySelectorAll('.sxg-adslot__dot');
  check('圆点高亮同步到第 2 个', dots[1].className.indexOf('is-active') !== -1);
  next.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  check('再点「下一张」滚动到第 3 张（虚位以待）', /translateX\(-200%\)/.test(track.style.transform),
    track.style.transform);
  check('圆点高亮同步到第 3 个', dots[2].className.indexOf('is-active') !== -1);
  prev.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  check('点「上一张」回到第 2 张', /translateX\(-100%\)/.test(track.style.transform),
    track.style.transform);
  prev.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  check('点「上一张」回到第 1 张', /translateX\(0%\)/.test(track.style.transform),
    track.style.transform);
  check('自动轮播间隔仍是 5 秒', /var AUTOPLAY_MS = 5000/.test(src));

  check('渲染期无 JS 异常', errors.length === 0, errors.slice(0, 3));

  console.log('\n' + '='.repeat(52));
  console.log(`通过 ${pass} 项，失败 ${fail} 项`);
  if (fail) console.log('失败项：\n  - ' + fails.join('\n  - '));
  try { dom.window.close(); } catch (e) { /* ignore */ }
  process.exit(fail ? 1 : 0);
})();
