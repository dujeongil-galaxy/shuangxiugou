// 2026-11-10 23:40 站长：「手机端你检查了吗？新建的公益广告位，都穿模了」。
// 挂 CI 的 jsdom 回归：手机专用海报必须真的被 <picture> 接上、图片失败兜底
// 不能因为多了一层 <picture> 而静默失效、悬浮层避让规则写死在组件里。
// 真几何 / 真遮挡由本机 scripts/cdp-adslot-mobile-audit.cjs 负责（CI 无 Edge）。
// 跑法：npm install --no-save jsdom && node scripts/test-adslot-mobile.cjs
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
// 第三列是各自 ?v：⑪ 只重画了胖东来手机稿（升 2），其余仍是 1。
const MOBILE = [
  ['assets/ad-luxiyi-mobile.svg', 'ART_MOBILE', 1],
  ['assets/ad-pangdonglai-mobile.svg', 'ART_PDL_MOBILE', 2],
  ['assets/ad-recruit-mobile.svg', 'ART_RECRUIT_MOBILE', 1]
];

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else { fail++; console.log('  ✗', label, extra !== undefined ? JSON.stringify(extra) : ''); }
}

(async () => {
  console.log('=== 公益广告位：手机端专用海报 / 图片兜底 / 悬浮层避让 ===\n');
  const src = read('black-card-adslot.js');
  const idx = read('index.html');

  console.log('--- 0. 三张手机专用设计稿 ---');
  for (const [f, name, ver] of MOBILE) {
    const okFile = fs.existsSync(path.join(ROOT, f));
    check(f + ' 真实存在', okFile);
    if (!okFile) continue;
    const svg = read(f);
    check(f + ' 是 400×240 有效 SVG',
      /<svg[\s\S]*?viewBox="0 0 400 240"/.test(svg) && /<\/svg>\s*$/.test(svg));
    const noNs = svg.replace(/xmlns(?::[a-zA-Z]+)?="[^"]*"/g, '');
    check(f + ' 零外链（xmlns 是命名空间，不算 URL）',
      !/https?:\/\//.test(noNs) && !/<image\b/i.test(svg));
    const texts = [...svg.matchAll(/<text[^>]*?y="(\d+)"[^>]*?font-size="(\d+)"[^>]*>/g)]
      .map((m) => ({ y: Number(m[1]), size: Number(m[2]) }));
    const main = texts.filter((t) => t.y >= 100 && t.y <= 220).sort((a, b) => a.y - b.y);
    check(f + ' 三条主文案基线递增且字号 ≥14（不再糊成 5px）',
      main.length >= 3 && main.every((t, i) => i === 0 || t.y > main[i - 1].y)
      && main[0].size >= 38 && Math.min(...main.map((t) => t.size)) >= 14, main);
    check(f + ' 脚本里有对应 *_MOBILE 常量',
      src.indexOf("var " + name + " = './" + f + "?v=" + ver + "'") !== -1);
    check(f + ' 首页带 media 预热且 ?v 一致',
      idx.indexOf('<link rel="preload" as="image" href="./' + f +
        '?v=' + ver + '" media="(max-width:480px)" />') !== -1);
  }

  // 站长 2026-11-11 00:46「第一张也不要和第二张广告使用同一种风格」：
  // 手机端三稿同样两两互异，只认剥注释后的图本体。
  console.log('\n--- 0b. 手机三稿风格两两互异 ---');
  const strip = (s) => s.replace(/<!--[\s\S]*?-->/g, '');
  const brandMark = /linearGradient|#e5a336|#f9df8b|#0a1b47|#1d3f9e/;
  // 用招商稿的精确虚线值：泛化的 stroke-dasharray 会误伤别的稿的装饰圆点
  const recruitMark = /rwm-grid|rwm-hatch|stroke-dasharray="9 7"|VACANCY|#fbf7ee/;
  const dispatchMark = /#8f3325|#f7efe0|#e9a45c|nd-ink/;
  const [artA, artB, artC] = MOBILE.map(([f]) => strip(read(f)));
  check('手机稿：第 1 张仍是深蓝金字，不含另两套特征',
    brandMark.test(artA) && !dispatchMark.test(artA) && !recruitMark.test(artA));
  check('手机稿：第 2 张是砖红号外稿，不与第 1 张同风格',
    dispatchMark.test(artB) && !brandMark.test(artB) && !recruitMark.test(artB));
  check('手机稿：第 3 张仍是暖白网格虚线稿，不含另两套特征',
    recruitMark.test(artC) && !brandMark.test(artC) && !dispatchMark.test(artC));

  console.log('\n--- 1. 真 DOM：<picture> 真的接上三张卡 ---');
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
  check('黑卡仍被正常替换成滚动广告位', !!slot);
  if (!slot) { console.log('渲染失败，后续断言跳过'); process.exit(1); }

  const pics = slot.querySelectorAll('picture');
  const sources = slot.querySelectorAll('source[media="(max-width:480px)"]');
  const arts = slot.querySelectorAll('img.sxg-adslot__art');
  check('三张卡各有一个 <picture>', pics.length === 3, pics.length);
  check('三张卡各有窄屏 <source>', sources.length === 3, sources.length);
  check('三张桌面原稿仍然挂在 <img src> 上（桌面不受影响）',
    arts.length === 3
    && arts[0].getAttribute('src') === './assets/ad-luxiyi.svg?v=2'
    && arts[1].getAttribute('src') === './assets/ad-pangdonglai.svg?v=3'
    && arts[2].getAttribute('src') === './assets/ad-recruit.svg?v=5',
    [...arts].map((x) => x.getAttribute('src')));
  check('三个 <source> 分别指向对应手机稿',
    sources[0] && sources[0].getAttribute('srcset') === './assets/ad-luxiyi-mobile.svg?v=1'
    && sources[1] && sources[1].getAttribute('srcset') === './assets/ad-pangdonglai-mobile.svg?v=2'
    && sources[2] && sources[2].getAttribute('srcset') === './assets/ad-recruit-mobile.svg?v=1',
    [...sources].map((x) => x.getAttribute('srcset')));
  check('海报 <img> 的父节点是 <picture>（结构没退化）',
    [...arts].every((x) => x.parentNode && x.parentNode.tagName === 'PICTURE'));

  // 图片失败兜底：父节点从 art-wrap 变成 picture 后，旧 img.parentNode 写法会静默失效
  const wrap = arts[0].closest('.sxg-adslot__art-wrap');
  check('<img> 能 closest 到 art-wrap（兜底容器定位没断）', !!wrap);
  arts[0].dispatchEvent(new window.Event('error'));
  check('图片加载失败时兜底仍落在 art-wrap 上（不会退化成纯文字）',
    !!wrap && wrap.getAttribute('data-art-error') === '1');

  console.log('\n--- 2. 悬浮层避让规则 ---');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  check('组件有 keepClear 且在替换进 DOM 之后调用',
    /function keepClear\(/.test(code) && /keepClear\(slot\);/.test(code));
  check('用 IntersectionObserver 且只避让 1000~9994 级浮层（不碰 100000 弹窗）',
    /new IntersectionObserver\(/.test(code) && /z >= 1000/.test(code) && /z < 9995/.test(code));
  check('避让只在手机端生效、离开视口恢复',
    /max-width:480px/.test(code) && /html\.classList\.remove\('sxg-adslot-near'\)/.test(code)
    && /removeAttribute\('data-sxg-adslot-avoid'\)/.test(code));
  check('CSS 里真有 visibility 避让规则',
    /html\.sxg-adslot-near \[data-sxg-adslot-avoid\]\{visibility:hidden!important/.test(src));
  check('运行期无 JS 异常', errors.length === 0, errors);

  console.log('\n====================================================');
  console.log(`通过 ${pass} 项，失败 ${fail} 项`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
