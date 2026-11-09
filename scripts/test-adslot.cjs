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
const ART_BRAND = './assets/ad-luxiyi.svg';
const ART_RECRUIT = './assets/ad-recruit.svg';

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

  // ─────────── 0. 两张站点自绘设计稿 ───────────
  console.log('--- 0. 广告位专用设计图 ---');
  for (const [f, label] of [['assets/ad-luxiyi.svg', '品牌广告设计稿'],
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
  check('组件引用了两张设计稿（单一真相源）',
    src.indexOf("var ART = '" + ART_BRAND + "'") !== -1
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
  check('两张卡各挂一张设计图', arts.length === 2,
    [...arts].map((x) => x.getAttribute('src')));
  check('招商卡设计稿引用正确',
    !!arts[1] && arts[1].getAttribute('src') === ART_RECRUIT);

  // ─────────── 2. 居中 & 箭头不再压住文案 ───────────
  console.log('\n--- 2. 内容居中 / 箭头位置 ---');
  check('卡片本身 align-items:center + text-align:center',
    /\.sxg-adslot__card\{[^}]*align-items:center[^}]*text-align:center/.test(src));
  check('信息条 justify-content:center',
    /\.sxg-adslot__meta\{[^}]*justify-content:center/.test(src));
  check('招商卡文案 padding/居中（absolute 叠在设计图上、水平垂直都居中）',
    /\.sxg-adslot__recruit-copy\{[^}]*align-items:center[^}]*justify-content:center[^}]*text-align:center/.test(src));
  const gcs = window.getComputedStyle(slot.querySelector('.sxg-adslot__recruit-copy'));
  check('真 DOM 计算样式：招商文案 textAlign=center', gcs.textAlign === 'center', gcs.textAlign);
  const foot = slot.querySelector('.sxg-adslot__foot');
  const prev = slot.querySelector('.sxg-adslot__prev');
  const next = slot.querySelector('.sxg-adslot__next');
  check('左右箭头移到了卡片下方导航条（不再绝对定位盖住标题）',
    !!foot && !!prev && !!next && foot.contains(prev) && foot.contains(next));
  check('箭头 CSS 已无 position:absolute',
    !/\.sxg-adslot__nav\{[^}]*position:absolute/.test(src));
  check('招商卡标题与副标题仍在 DOM 里（未被图片吞掉）',
    /广告位招商中/.test(slot.textContent) && /欢迎联系站长/.test(slot.textContent));

  // ─────────── 3. 轮播交互没被改坏 ───────────
  console.log('\n--- 3. 手动切换 / 自动轮播 ---');
  const track = slot.querySelector('.sxg-adslot__track');
  check('共 2 张广告卡', slot.querySelectorAll('.sxg-adslot__card').length === 2);
  check('2 个圆点且首张高亮',
    slot.querySelectorAll('.sxg-adslot__dot').length === 2
    && slot.querySelector('.sxg-adslot__dot').className.indexOf('is-active') !== -1);
  check('初始 transform 为 translateX(0%)', /translateX\(0%\)/.test(track.style.transform),
    track.style.transform);
  next.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  check('点「下一张」后滚动到第 2 张', /translateX\(-100%\)/.test(track.style.transform),
    track.style.transform);
  const dots = slot.querySelectorAll('.sxg-adslot__dot');
  check('圆点高亮同步到第 2 个', dots[1].className.indexOf('is-active') !== -1);
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
