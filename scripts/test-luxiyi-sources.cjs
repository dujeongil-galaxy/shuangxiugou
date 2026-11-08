// 2026-11-09 站长批次回归：卡面写了「另有腾讯新闻／济南时报／中国广告杂志／
// 联合新闻网交叉印证」，点开「详情证据」却一个链接都没有 —— 「说了要给证据来源」。
//
// 本测试直接跑真实的 custom-card-actions.js：把首页**真实**证据板里
// #ev-luxiyi 的 5 条链接喂进去，调弹窗用的同一个 buildSourcePanel()，
// 断言 5 条原文链接逐条与 data/imported-brands.json 真相源一致、可点开、
// 带 rel/target，并且没有证据链的卡不会凭空编造来源。
//
// 跑法：npm install --no-save jsdom && node scripts/test-luxiyi-sources.cjs
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

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
  console.log('=== 陆喜依详情证据弹窗：五条可点证据来源 ===\n');

  const idx = read('index.html');
  const imp = JSON.parse(read('data/imported-brands.json'));
  const lxy = imp.brands.find((b) => b.slug === 'luxiyi');
  check('真相源含 luxiyi 条目', !!lxy);
  if (!lxy) { console.log('\n失败 ' + fail + ' 项'); process.exit(1); }

  const expected = [lxy.sourceOverride.url].concat(
    (lxy.extraEvidence || []).map((e) => e.url));
  check('真相源恰好 5 条原文链接', expected.length === 5, expected.length);
  check('5 条链接都是 http(s) 绝对地址',
    expected.every((u) => /^https?:\/\//.test(u)));

  // 用首页真实证据板片段构造 DOM，不在测试里伪造 URL
  const boardMatch = idx.match(/<details id="ev-luxiyi"[\s\S]*?<\/details>/);
  check('首页证据链公示区有陆喜依条目（链接唯一真相源）', !!boardMatch);
  const page = '<!DOCTYPE html><html><body><div id="root"></div>' +
    '<section id="evidence-board">' + (boardMatch ? boardMatch[0] : '') +
    '</section></body></html>';

  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => {
    if (/Could not load|not implemented/i.test(e.message)) return;
    errors.push(e.message);
  });
  const dom = new JSDOM(page, {
    runScripts: 'dangerously', url: 'http://localhost/',
    virtualConsole: vc, pretendToBeVisual: true,
  });
  const w = dom.window;
  if (!w.matchMedia) {
    w.matchMedia = (q) => ({
      matches: false, media: q, onchange: null,
      addListener() {}, removeListener() {},
      addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; },
    });
  }
  w.scrollTo = w.scrollTo || (() => {});

  try { w.eval(read('custom-card-actions.js')); }
  catch (e) { errors.push('eval custom-card-actions.js: ' + e.message); }
  check('弹窗脚本在最小 DOM 下可执行（无静默失败）', errors.length === 0, errors.slice(0, 3));

  const hook = w.__sxgSourceLinks;
  check('弹窗脚本暴露证据来源测试钩子',
    !!hook && typeof hook.build === 'function' && typeof hook.read === 'function');
  if (!hook) { console.log('\n失败 ' + fail + ' 项'); process.exit(1); }

  const links = hook.read({ id: 'luxiyi-card' });
  check('从证据板读到 5 条链接（不是硬编码）', links.length === 5, links.length);
  check('读到的 URL 与真相源逐条一致',
    links.length === expected.length && links.every((l, i) => l.href === expected[i]),
    links.map((l) => l.href));

  const cfg = { id: 'luxiyi-card', name: '陆喜依', grade: 'S级', desc: lxy.sourceOverride.cardDesc };
  const built = hook.build(cfg);
  check('弹窗生成证据来源面板且条数 = 5', built.count === 5 && built.html.length > 200, built.count);
  check('面板带幂等标记 data-sxg-source-links', /data-sxg-source-links="1"/.test(built.html));

  const probe = w.document.createElement('div');
  probe.innerHTML = built.html;
  const anchors = Array.prototype.slice.call(probe.querySelectorAll('a[href^="http"]'));
  check('面板里恰好 5 条外链', anchors.length === 5, anchors.length);
  check('5 条外链 URL 与真相源逐条一致（esc 后仍可还原）',
    anchors.length === expected.length &&
    anchors.every((a, i) => a.getAttribute('href') === expected[i]),
    anchors.map((a) => a.getAttribute('href')));
  check('每条外链都带 rel="nofollow noopener" 与 target="_blank"',
    anchors.length > 0 && anchors.every((a) =>
      a.getAttribute('rel') === 'nofollow noopener' && a.getAttribute('target') === '_blank'));
  check('面板指向陆喜依完整详情页',
    !!probe.querySelector('a[href="./brand/luxiyi.html"]'));
  for (const media of ['腾讯新闻', '济南时报', '中国广告杂志', '联合新闻网', '华龙网']) {
    check('面板点名媒体「' + media + '」且可点开原文', built.html.indexOf(media) !== -1);
  }

  const none = hook.build({ id: 'no-evidence-card', name: '社区卡' });
  check('没有证据链公示条目的卡不编造来源',
    none.count === 0 && none.html === '');

  // 底部说明：有证据链时必须换口径，不能还写「尚未接入交叉核验」
  const src = read('custom-card-actions.js');
  check('弹窗底部说明按有无证据链分支', /src\.count \? 'sxg-note-green' : 'sxg-note'/.test(src));
  check('有证据链时写明「媒体报道／调查」与「不是榜单二手汇总」',
    /媒体报道／调查/.test(src) && /不是榜单二手汇总/.test(src));
  check('弹窗脚本不硬编码 5 条原文 URL（防与真相源漂移）',
    !/cqnews\.net|view\.inews\.qq\.com|jinantimes\.com\.cn|udn\.com/.test(src));

  // 卡面文案与真相源同步
  check('cardDesc 写明「5 条原文链接见「证据来源」」',
    /5 条原文链接见「证据来源」/.test(lxy.sourceOverride.cardDesc));
  check('首页卡的 desc 与真相源 cardDesc 逐字一致',
    idx.indexOf(lxy.sourceOverride.cardDesc) !== -1);
  check('custom-card-actions.js 缓存号已 bump 到 ?v=24（两处）',
    (idx.match(/custom-card-actions\.js\?v=24/g) || []).length === 2);

  // 详情页指引与真相源同步
  const detail = read('brand/luxiyi.html');
  check('详情页「数据口径说明」指向下方 5 条原文链接',
    /上述五条报道的原文链接均列在下方「证据来源」/.test(detail));
  check('详情页 scopeText 与真相源逐字一致',
    detail.indexOf(lxy.sourceOverride.scopeText) !== -1);
  const evBlock = (detail.match(/<h2>证据来源<\/h2>\s*<ul>([\s\S]*?)<\/ul>/) || ['', ''])[1];
  check('详情页「证据来源」仍是 5 条（没被新增链接挤成第 6 条）',
    (evBlock.match(/<li style="margin:0 0 12px">/g) || []).length === 5);
  // 证据板写 &amp;、详情页生成器写裸 &，渲染后等价，比对前统一还原
  const detailNorm = detail.replace(/&amp;/g, '&');
  check('详情页 5 条原文链接与真相源一致',
    expected.every((u) => detailNorm.indexOf('href="' + u + '"') !== -1),
    expected.filter((u) => detailNorm.indexOf('href="' + u + '"') === -1));

  console.log('\n通过 ' + pass + ' 项 / 失败 ' + fail + ' 项');
  if (fail) { console.log('失败项：' + fails.join('；')); process.exit(1); }
  process.exit(0);
})();
