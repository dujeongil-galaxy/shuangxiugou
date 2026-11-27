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
// 站长 2026-11-27：小程序口令整套撤掉，改成居中弹窗里两条真链接；
// 同日后续口径：淘宝只留裸店址、零参数，陆喜依天猫店同理。
const PDL_TAOBAO = 'https://n3sf0tqhvhbw60ae2xdq4nodo2g4kxl.taobao.com/';
const PDL_DOUYIN = 'https://www.douyin.com/user/MS4wLjABAAAANjHa0B-e7JAX89HjRiCnSLRbFYYG3b0wrt7397e7IBA';
const ART_BRAND = './assets/ad-luxiyi.svg?v=3';
const ART_PDL = './assets/ad-pangdonglai.svg?v=3';
const ART_RECRUIT = './assets/ad-recruit.svg?v=6';
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
  check('当前在展示 2 张卡（胖东来暂时下架），各挂一张设计图', arts.length === 2,
    [...arts].map((x) => x.getAttribute('src')));
  check('下架后不挂胖东来设计稿',
    ![...arts].some((x) => /pangdonglai/.test(x.getAttribute('src') || '')));
  check('招商卡设计稿引用正确',
    !!arts[1] && arts[1].getAttribute('src') === ART_RECRUIT);

  // ─────────── 1b. 胖东来卡暂时下架（2026-11-27 站长「删一下胖东来广告，暂时下架」） ───────────
  console.log('\n--- 1b. 胖东来卡：暂时下架，设计图与代码留着待恢复 ---');
  const pdlName = slot.querySelector('.sxg-adslot__card--pdl .sxg-adslot__name');
  const pdlAvatar = slot.querySelector('.sxg-adslot__card--pdl .sxg-adslot__avatar');
  const pdlTag = slot.querySelector('.sxg-adslot__card--pdl .sxg-adslot__tag');
  const pdlBanner = slot.querySelector('.sxg-adslot__card--pdl .sxg-adslot__banner');
  const pdlCta = slot.querySelector('.sxg-adslot__card--pdl .sxg-adslot__cta');
  check('下架后卡面不再渲染胖东来卡（品牌名/头像/标签/整图/CTA 全没有）',
    !pdlName && !pdlAvatar && !pdlTag && !pdlBanner && !pdlCta
    && !slot.querySelector('.sxg-adslot__card--pdl'));
  check('下架开关在源码里且为 false（恢复上架只改这一处）',
    /var PDL_ON = false;/.test(src) && /\(PDL_ON \? \(/.test(src) && /\) : ''\) \+/.test(src));
  check('胖东来卡片 HTML 与设计图仍留在源码/素材里（随时可恢复）',
    /sxg-adslot__card--pdl/.test(src) && /data-sxg-share="pdl"/.test(src)
    && fs.existsSync(path.join(ROOT, 'assets/ad-pangdonglai.svg'))
    && fs.existsSync(path.join(ROOT, 'assets/ad-pangdonglai-mobile.svg'))
    && src.indexOf("var ART_PDL = '" + ART_PDL + "'") !== -1);
  check('源码已无小程序口令常量 / 微信复制链路（旧口径全撤）',
    (function () {
      // 历史沿革注释保留决策链（本站惯例），只扫剥掉注释后的真代码
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
      return !/var PDL_LINK/.test(code) && !/小程序:\/\//.test(code)
        && !/copySync\(|execCommand\('copy'\)/.test(code)
        && !/bendibao/.test(code);
    })());
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
  // 2026-11-27 站长明确要挂抖音主页（www.douyin.com/user/...），所以「零视频链接」
  // 收窄为「零短视频单链」：v.douyin.com / b23.tv 仍禁止；主页链接允许且只出现在
  // 弹窗的 sxg-adslot__modal-douyin 里，不进卡片、不进海报。
  const videoRe = /v\.douyin\.com|b23\.tv/i;
  check('广告位零短视频单链（主页链接只在弹窗出口，脚本/三张设计图/卡片 DOM 干净）',
    !videoRe.test(src)
    && !videoRe.test(read('assets/ad-luxiyi.svg'))
    && !videoRe.test(read('assets/ad-pangdonglai.svg'))
    && !videoRe.test(read('assets/ad-recruit.svg'))
    && !videoRe.test(slot.innerHTML)
    && !/douyin\.com/i.test(slot.innerHTML),
    '广告位卡片/海报出现了短视频单链或抖音链接');

  // ─────────── 1c. 点击开居中弹窗（真点击，不是只比对字符串） ───────────
  // 站长 2026-11-27「还是用之前那个风格弹窗吧，既可以推荐去淘宝购物，
  // 也可以引导用户访问他们的抖音」。当日晚些时候改为「胖东来广告暂时下架」：
  // 卡面不再渲染这张卡，弹窗（连同它的两条真链接）也就不会被触发；
  // 弹窗代码本身留着，恢复上架即可用。
  console.log('\n--- 1c. 下架后弹窗不会被触发（代码留着待恢复） ---');
  check('下架后弹窗 DOM 根本不会被创建', !doc.querySelector('[data-sxg-pdl-modal]'));
  check('弹窗代码仍在源码里（恢复上架即可用）',
    /function ensureModal\(/.test(src) && /function openModal\(/.test(src)
    && /function bindShare\(/.test(src)
    && /sxg-adslot__modal-taobao/.test(src) && /sxg-adslot__modal-douyin/.test(src)
    && /href="' \+ PDL_TAOBAO \+ '" target="_blank" rel="noopener"/.test(src)
    && /href="' \+ PDL_DOUYIN \+ '" target="_blank" rel="noopener"/.test(src));
  const codeAd = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  check('弹窗文案仍写淘宝店与抖音，且不再出现小程序/口令/微信',
    !/小程序|口令|微信|复制/.test(codeAd)
    && /淘宝店/.test(codeAd) && /抖音/.test(codeAd));

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
  check('共 2 张广告卡（胖东来暂时下架）', slot.querySelectorAll('.sxg-adslot__card').length === 2);
  check('2 个圆点且首张高亮',
    slot.querySelectorAll('.sxg-adslot__dot').length === 2
    && slot.querySelector('.sxg-adslot__dot').className.indexOf('is-active') !== -1);
  check('初始 transform 为 translateX(0%)', /translateX\(0%\)/.test(track.style.transform),
    track.style.transform);
  next.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  check('点「下一张」后滚动到第 2 张（虚位以待）', /translateX\(-100%\)/.test(track.style.transform),
    track.style.transform);
  const dots = slot.querySelectorAll('.sxg-adslot__dot');
  check('圆点高亮同步到第 2 个', dots[1].className.indexOf('is-active') !== -1);
  prev.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  check('点「上一张」回到第 1 张', /translateX\(0%\)/.test(track.style.transform),
    track.style.transform);
  next.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  check('再点「下一张」又回到第 2 张（只有两张，不再有第 3 张）',
    /translateX\(-100%\)/.test(track.style.transform), track.style.transform);
  check('自动轮播间隔仍是 5 秒', /var AUTOPLAY_MS = 5000/.test(src));

  check('渲染期无 JS 异常', errors.length === 0, errors.slice(0, 3));

  console.log('\n' + '='.repeat(52));
  console.log(`通过 ${pass} 项，失败 ${fail} 项`);
  if (fail) console.log('失败项：\n  - ' + fails.join('\n  - '));
  try { dom.window.close(); } catch (e) { /* ignore */ }
  process.exit(fail ? 1 : 0);
})();
