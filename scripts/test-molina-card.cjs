// 茉莉奶白 C 级卡 + 提醒按钮《双休购》文案 回归测试（2026-10-30）
//
// 任务一：「茉莉奶白」第 12 张自定义卡（2026-10-30 下午 U→C 升级）。
//   站长提出复核后定级：线下核实「月休 4 天」（单休形态），
//   按站内口径「单休归为 C 级」定 C 级（此前曾以「单店样本不足」
//   记为 U 级，经复核与茶百道/兵立王匿名反馈即定 C 级的口径一致，故更正为 C 级）。
//   联名水杯易爆裂新闻必须带可查证链接。
//   断言：
//     1. customCardsConfig 含 molina-card 配置（grade C级 / doubleRestRate null / insertAfter 美宜佳）
//     2. desc 与 recommendText 写明 C 级口径与定级依据
//     3. insertMolinaNote 存在且挂在 init/input/click 三个触发点（漏挂 = 静默失效）
//     4. 说明框 HTML 含新闻链接（南方+ / 腾讯新闻，target=_blank）
//     5. noscript 两处清单 + sitemap + projects.html 均含 molina（爬虫可见）
//     6. bundle 统计常数 64 + tab 角标 64（改回 63 = 判红）
//     7. pinyin-index 含 molina-card 条目（拼音搜索可达）
//     8. brand/molina.html 存在、canonical 正确、含新闻链接与 C 级评级口径
//
// 任务二：提醒按钮模态文案替换为站长亲笔《双休购》长文。
//   断言：
//     9. remind-button.js 标题为「双休购」，正文首段与末段逐字命中
//    10. 旧文案（消费也是投票 / 劳动者权益是法定底线 / 劳工友好提醒标题）全部移除
//    11. 正文区有 max-height 滚动（八段长文不撑爆小屏）
//    12. index.html 引用 ?v=3（缓存刷新）
//
// 故障注入红线（独立验证过）：删 insertMolinaNote 函数体 / 删说明框链接 /
// 把 grade 改回 U级 → 对应断言必须判红。
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

let pass = 0, fail = 0;
const fails = [];
const check = (label, cond, extra) => {
  if (cond) { pass++; console.log('  ✓', label); }
  else { fail++; fails.push(label); console.log('  ✗', label, extra !== undefined ? JSON.stringify(extra) : ''); }
};

const html = read('index.html');
const remindSrc = read('remind-button.js');

(async () => {
  console.log('=== 茉莉奶白 C 级卡 + 提醒按钮《双休购》文案 ===\n');

  // ── 任务一：卡片配置 ──
  const cfgStart = html.indexOf("id: 'molina-card'");
  check('customCardsConfig 含 molina-card 配置', cfgStart !== -1);
  const cfgChunk = html.slice(cfgStart, cfgStart + 1600);
  check('★ 茉莉奶白卡为 C 级（2026-10-30 U→C 升级）', /grade:\s*'C级'/.test(cfgChunk));
  check('茉莉奶白卡双休率 null（C 级不留数值）', /doubleRestRate:\s*null/.test(cfgChunk));
  check('茉莉奶白卡下班时间 null', /offWorkTime:\s*null/.test(cfgChunk));
  check('insertAfter 美宜佳（紧跟其后）', /insertAfter:\s*'美宜佳'/.test(cfgChunk));
  check('logo 路径有效（assets/molina.svg?v=2 存在，2026-10-30 换真 logo 后 bump）',
    /logo:\s*'\.\/assets\/molina\.svg\?v=2'/.test(cfgChunk) && fs.existsSync(path.join(ROOT, 'assets/molina.svg')));

  // 定级依据：站长线下核实「月休 4 天」（单休形态）
  check('★ desc 写明线下核实「月休 4 天」（单休形态）', /月休 4 天/.test(cfgChunk) && /单休形态/.test(cfgChunk));
  check('★ desc 写明「单休归为 C 级」定级口径', /单休归为 C 级/.test(cfgChunk));
  check('recommendText 写明 C 级警示（红框）', /C 级 · 线下核实月休 4 天/.test(cfgChunk));
  check('recommendColor 为 red（升 C 后警示色）', /recommendColor:\s*'red'/.test(cfgChunk));

  // ── 说明框 ──
  const fnStart = html.indexOf('function insertMolinaNote()');
  check('insertMolinaNote 函数存在', fnStart !== -1);
  const fnBody = html.slice(fnStart, html.indexOf('var SBUX_RATE_OVERRIDE', fnStart));
  check('★ 说明框含联名水杯易爆裂·紧急下架事实', /联名水杯易爆裂·紧急下架/.test(fnBody));
  check('★ 说明框含南方+ 新闻链接', /https:\/\/www\.nfnews\.com\/content\/5yppgW0nyp\.html/.test(fnBody));
  check('★ 说明框含腾讯新闻链接', /https:\/\/news\.qq\.com\/rain\/a\/20261030A05B0C00/.test(fnBody));
  check('新闻链接均新窗口打开（target=_blank）',
    (fnBody.match(/target="_blank"/g) || []).length >= 2);
  check('说明框含「单休归为 C 级」定级口径',
    /单休归为 C 级/.test(fnBody));
  check('说明框 id 为 molina-note', /note\.id = 'molina-note'/.test(fnBody));

  // 三个触发点全挂（漏挂 = 静默失效，PITFALLS 教训）
  const initBody = html.slice(html.indexOf('function init()'), html.indexOf('observer.observe'));
  check('insertMolinaNote 挂在 init() 里', /insertMolinaNote\(\);/.test(initBody));
  check('insertMolinaNote 挂在 input 监听里',
    /try \{ insertMolinaNote\(\); \} catch \(err\) \{ diagError\('insertMolinaNote 抛异常'/.test(html));
  const callCount = (html.match(/insertMolinaNote\(\);/g) || []).length;
  check('insertMolinaNote 全部触发点 = 3 处（init + input + click）', callCount === 3, callCount);

  // ── 爬虫可见性 ──
  const ns = html.match(/<noscript>([\s\S]*?)<\/noscript>/)?.[1] ?? '';
  const nsMolinaLines = ns.split('\n').filter((l) => /<li[^>]*>.*brand\/molina\.html/.test(l.replace(/\n/g, '')) && l.includes('molina')).length;
  check('noscript 两处清单均含 molina（爬虫兜底，每处一行）', nsMolinaLines === 2, nsMolinaLines);
  check('sitemap.xml 含 molina 详情页', /brand\/molina\.html/.test(read('sitemap.xml')));
  check('projects.html 含 molina（互链网）', /brand\/molina\.html/.test(read('projects.html')));
  check('页脚「共 67 家」口径', /（共 67 家）/.test(html));

  // ── bundle 统计常数 ──
  const bundle = read('assets/index-YthXZ9eP.js');
  check('★ bundle「收录品牌」常数 = 67', /text-base`,children:67\}/.test(bundle));
  check('★ bundle tab 角标常数 = 67', /rounded-full`,children:67\}/.test(bundle));
  check('bundle 引用已 bump（?v=50，2026-10-31 U 分支死代码清理 + 银行月休口径改判）', /index-YthXZ9eP\.js\?v=50/.test(html));

  // ── 拼音索引 ──
  const pi = read('pinyin-index.js');
  check('pinyin-index 含 molina-card 条目（custom:1）',
    /"id":"molina-card","name":"茉莉奶白","cn":"茉莉奶白","custom":1/.test(pi));
  check('拼音索引含 mlnb 首字母缩写', /"mlnb","mlnb","mlnb",3/.test(pi));

  // ── 详情页 ──
  const detail = read('brand/molina.html');
  check('详情页存在且 canonical 指向自身', /rel="canonical" href="[^"]*\/brand\/molina\.html"/.test(detail));
  check('★ 详情页为 C 级评级（徽章红底）', /badge" style="background:#DC2626">C 级评级/.test(detail));
  check('详情页含定级口径「单休归为 C 级」', /单休归为 C 级/.test(detail));
  check('详情页含新闻链接（南方+ / 腾讯）',
    /nfnews\.com\/content\/5yppgW0nyp\.html/.test(detail) && /news\.qq\.com\/rain\/a\/20261030A05B0C00/.test(detail));
  check('详情页链向其他品牌页（非孤儿页）', /href="\.\/(chabaidao|meiyijia)\.html"/.test(detail));

  // ── 任务二：提醒按钮《双休购》文案 ──
  check('模态标题为「双休购」', /sxg-rm-title">双休购</.test(remindSrc));
  check('★ 正文首段逐字命中（当“996”从互联网圈的调侃变成…）',
    /当“996”从互联网圈的调侃变成无数打工人的日常/.test(remindSrc));
  check('★ 正文末段逐字命中（此刻，你手握这粒火种…）',
    /此刻，你手握这粒火种。别回头，向前走，去消费，去休息，去生活。因为推动这件事的人，正是你。/.test(remindSrc));
  check('正文含「不要问篝火该不该燃烧」引用段',
    /不要问篝火该不该燃烧，先问寒冷是否存在/.test(remindSrc));
  check('★ 旧文案「消费也是投票」已删除', !/消费也是投票/.test(remindSrc));
  check('★ 旧文案「劳动者权益是法定底线」已删除', !/劳动者权益是法定底线/.test(remindSrc));
  check('★ 旧标题「劳工友好提醒」已从模态移除（仅注释留史）',
    (remindSrc.match(/劳工友好提醒/g) || []).length === 1);
  check('正文区有滚动（max-height，八段长文不撑爆小屏）',
    /sxg-rm-body\{'[^}]*max-height:52vh;overflow-y:auto/.test(remindSrc));
  check('index.html 引用 remind-button.js?v=3（缓存刷新）', /remind-button\.js\?v=3/.test(html));

  // ── jsdom 行为断言：卡片真渲染 + 说明框真出现 ──
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => {
    if (/Could not load|not implemented/i.test(e.message)) return;
    errors.push(e.message);
  });
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    resources: undefined,
    url: 'http://localhost/',
    virtualConsole: vc,
    pretendToBeVisual: true,
  });
  const { window } = dom;
  const doc = window.document;
  if (!window.matchMedia) {
    window.matchMedia = (q) => ({ matches: false, media: q, onchange: null,
      addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } });
  }
  window.scrollTo = window.scrollTo || (() => {});
  if (!window.requestAnimationFrame) {
    window.requestAnimationFrame = (cb) => window.setTimeout(() => cb(Date.now()), 16);
    window.cancelAnimationFrame = (h) => window.clearTimeout(h);
  }
  // 手动注入脚本（对齐 test-empty-state-sync 做法）
  const order = [
    ...html.matchAll(/<script[^>]*\bsrc="([^"]+)"/g),
    ...html.matchAll(/<link[^>]*\bas="script"[^>]*\bhref="([^"]+)"/g),
  ].map((m) => m[1]);
  for (const srcPath of [...new Set(order)]) {
    const clean = srcPath.split('?')[0];
    if (clean.startsWith('http')) continue;
    const file = path.join(ROOT, clean);
    if (!fs.existsSync(file)) continue;
    try { window.eval(read(clean)); } catch (e) { errors.push('eval ' + clean + ': ' + e.message); }
  }
  await new Promise((r) => setTimeout(r, 800));
  if (typeof window.insertAllCustomCards === 'function') {
    try { window.insertAllCustomCards(); } catch (e) {}
    await new Promise((r) => setTimeout(r, 400));
  }

  const mlCard = doc.getElementById('molina-card');
  check('★ jsdom 渲染出茉莉奶白卡（molina-card 在 DOM）', !!mlCard);
  if (mlCard) {
    const title = (mlCard.querySelector('h2') || mlCard.querySelector('h3') || {}).textContent || '';
    check('卡标题为「茉莉奶白」', title.trim() === '茉莉奶白', title);
    check('卡徽章为 C 级（避雷预警红徽章）', /C级 · 避雷预警|C 级/.test(mlCard.textContent));
    check('★ 卡内不再有待核实徽章文案（升 C 后）', !/待核实 · 无证据不作评级/.test(mlCard.textContent));
    check('★ 卡内说明框已注入（molina-note）', !!doc.getElementById('molina-note'));
    const note = doc.getElementById('molina-note');
    if (note) {
      const noteHtml = note.innerHTML;
      check('说明框渲染出南方+ 链接', /nfnews\.com\/content\/5yppgW0nyp\.html/.test(noteHtml));
      check('说明框渲染出腾讯新闻链接', /news\.qq\.com\/rain\/a\/20261030A05B0C00/.test(noteHtml));
      check('说明框链接可点（a 标签 ≥ 2）', (note.querySelectorAll('a').length) >= 2);
    }
    // 说明框位置：插在标签行之后（与美宜佳同款）
    const tagsRow = mlCard.querySelector('.flex-wrap');
    check('说明框紧跟标签行（位置正确）',
      !!(tagsRow && tagsRow.nextSibling && tagsRow.nextSibling.id === 'molina-note'));
  }

  // 提醒按钮：jsdom 里渲染 + 点开验证
  const btn = doc.getElementById('sxg-remind-btn');
  check('提醒按钮在 DOM（sxg-remind-btn）', !!btn);
  const modal = doc.getElementById('sxg-remind-modal');
  check('提醒模态在 DOM（sxg-remind-modal）', !!modal);
  if (btn && modal) {
    btn.click();
    await new Promise((r) => setTimeout(r, 100));
    check('★ 点提醒按钮 → 模态打开', modal.hidden === false);
    check('★ 模态标题渲染为「双休购」',
      (modal.querySelector('.sxg-rm-title') || {}).textContent === '双休购');
    const bodyText = (modal.querySelector('.sxg-rm-body') || {}).textContent || '';
    check('★ 模态正文含首段关键词', bodyText.indexOf('996') !== -1);
    check('★ 模态正文含末段关键词（正是你）', bodyText.indexOf('正是你') !== -1);
    check('模态正文为八段（8 个 p）', (modal.querySelectorAll('.sxg-rm-body p') || []).length === 8);
    check('★ 模态正文不含旧文案', bodyText.indexOf('消费也是投票') === -1);
    // 关闭
    (modal.querySelector('.sxg-rm-ok') || {}).click && modal.querySelector('.sxg-rm-ok').click();
    await new Promise((r) => setTimeout(r, 100));
    check('点「我知道了」→ 模态关闭', modal.hidden === true);
  }

  console.log('\n' + '='.repeat(52));
  console.log(`通过 ${pass} 项，失败 ${fail} 项`);
  if (fail) console.log('失败项：\n  - ' + fails.join('\n  - '));
  process.exit(fail ? 1 : 0);
})();
