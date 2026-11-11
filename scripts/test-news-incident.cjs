// 2026-11-10 站长批次回归：罗技「辱骂消费者」事件 + 常州星宇股份后续进展登记。
// 真 DOM 验证（jsdom 加载 news-incident-patch.js），不是只比对配置字符串——
// 这个站的默认静默失效方式就是「源码写了、渲染出来的卡片上啥也没有」。
// 跑法：npm install --no-save jsdom && node scripts/test-news-incident.cjs
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const exists = (f) => fs.existsSync(path.join(ROOT, f));

let pass = 0, fail = 0;
const fails = [];
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else {
    fail++; fails.push(label);
    console.log('  ✗', label, extra !== undefined ? JSON.stringify(extra) : '');
  }
}
const tick = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  console.log('=== 新闻事件登记：罗技 / 常州星宇股份 ===\n');

  // ─────────── 0. 静态接线（三层强制的第三层） ───────────
  console.log('--- 0. 文件与接线 ---');
  const src = read('news-incident-patch.js');
  const html = read('index.html');
  const logi = read('brand/logitech.html');
  const xing = read('brand/xingyu.html');
  const wf = read('.github/workflows/verify.yml');
  const rd = read('README.md');

  check('新闻登记补丁文件存在', exists('news-incident-patch.js'));
  check('首页挂了新闻登记补丁（?v=3 防缓存）',
    /<script defer src="\.\/news-incident-patch\.js\?v=3"><\/script>/.test(html));
  check('真 DOM 测试挂进 CI 的 pinyin job', /test-news-incident\.cjs/.test(wf));
  check('README 写死新闻登记口径',
    /新闻事件登记/.test(rd) && /不作因果认定|不写「报应」/.test(rd));

  // ─────────── 1. 罗技：详情页证据（权威媒体可点链接） ───────────
  console.log('\n--- 1. 罗技事件证据链 ---');
  const logiEv = (logi.match(/<h2>证据来源<\/h2>\s*<ul>([\s\S]*?)<\/ul>/) || [])[1] || '';
  for (const [label, needle] of [
    ['罗技中国致歉声明', '罗技中国就授权店铺侮辱消费者广告致歉'],
    ['运营方致歉信 / 视频永久删除', '视频已被永久删除'],
    ['不推诿责任的承诺', '不把责任推诿于任何个人或单一团队'],
    ['与评级无关的口径说明', '与工时、双休数据无关'],
    ['光明网链接', 'https://m.gmw.cn/2026-03/27/content_1304393629.htm'],
    ['中新经纬链接', 'https://m.chinanews.com/wap/detail/cht/zw/jw664756.shtml'],
  ]) {
    check('罗技详情页写了「' + label + '」', logiEv.indexOf(needle) !== -1);
  }
  check('罗技新增两条都标注 media_report（媒体报道强度档）',
    (logiEv.match(/media_report/g) || []).length === 2);
  check('罗技原有 955.WLB 证据条未被删改',
    /955\.WLB 开源清单收录企业/.test(logiEv));
  const ebLogi = (html.match(/<details id="ev-logitech"[\s\S]*?<\/details>/) || [])[0] || '';
  check('公示区 ev-logitech 由 1 条如实升为 3 条（2 条带链接）',
    /data-n="3" data-l="2"/.test(ebLogi), ebLogi.slice(0, 120));
  check('公示区能搜到「侮辱消费者广告致歉」标题（吃新闻流量的落点）',
    ebLogi.indexOf('侮辱消费者广告致歉') !== -1);

  // ─────────── 2. 星宇：后续进展证据（多家权威媒体） ───────────
  console.log('\n--- 2. 星宇后续进展证据链 ---');
  const xingEv = (xing.match(/<h2>证据来源<\/h2>\s*<ul>([\s\S]*?)<\/ul>/) || [])[1] || '';
  for (const [label, needle] of [
    ['9/6 内部处罚决定', '总经理扣薪 12 个月、人力资源总监免职'],
    ['处罚文件名号', '星宇字(2026)第(007)号'],
    ['下游车企供应链调查', '下游车企启动供应链用工调查'],
    ['奔驰 BPO 受理举报', '奔驰 BPO'],
    ['大众中国专项调查', '已第一时间启动专项调查'],
    ['港交所核查 / 上市节奏', '上市节奏被打乱'],
    ['中国新闻周刊再调查', '中国新闻周刊再调查'],
    ['不作因果推断的口径说明', '本站不作因果推断'],
    ['客户调查不等于认定违规', '启动审查不等于认定供应商违规'],
    ['中国能源网链接', 'https://www.cnenergynews.cn/article/4T6t8bUs6hE'],
    ['南方+ 链接', 'https://static.nfnews.com/content/202609/02/c12780009.html'],
    ['中国新闻周刊链接', 'https://www.inewsweek.cn/finance/2026-09-11/32073.shtml'],
  ]) {
    check('星宇详情页写了「' + label + '」', xingEv.indexOf(needle) !== -1);
  }
  check('星宇新增三条都标注 media_report',
    (xingEv.match(/media_report/g) || []).length === 3);
  check('星宇原有两条证据（人社局通报 / 法院判决）未被删改',
    /常州市人社局情况通报/.test(xingEv) && /常州市新北区人民法院民事判决书/.test(xingEv));
  // 只判纯代码与详情页：补丁文件头的说明注释会引用站长口述「遭到报应」，
  // 那是解释为什么不用这个词，不是对外文案，拿全文比对会误判红。
  const newsCode = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  check('口径不写「报应」这类定性（站长口述已优化为可核查事件链）',
    !/报应/.test(xingEv) && !/报应/.test(newsCode));
  const ebXing = (html.match(/<details id="ev-xingyu"[\s\S]*?<\/details>/) || [])[0] || '';
  check('公示区 ev-xingyu 由 2 条如实升为 5 条（5 条带链接）',
    /data-n="5" data-l="5"/.test(ebXing), ebXing.slice(0, 120));
  check('公示区能搜到「扣薪 12 个月」与「供应链用工调查」',
    ebXing.indexOf('扣薪 12 个月') !== -1 && ebXing.indexOf('供应链用工调查') !== -1);

  // ─────────── 3. 补丁源码口径 ───────────
  console.log('\n--- 3. 补丁源码口径 ---');
  check('两份登记用同一个配置数组驱动（不写两份逻辑）',
    /var ITEMS = \[/.test(src) && /key: 'logitech'/.test(src) && /key: 'xingyu'/.test(src));
  check('按标题定位两张内置卡',
    /\^Logitech\\s\*\\\(罗技\\\)/.test(src) && /\^常州星宇股份/.test(src));
  check('幂等标记 + MutationObserver + rAF 合帧',
    /data-sxg-news/.test(src) && /new MutationObserver\(schedule\)/.test(src)
    && /requestAnimationFrame/.test(src));
  check('卡片里不放任何外链（原始报道链接只放详情页/公示区）',
    !/https?:\/\//.test(src));
  check('卡片只链站内详情页',
    /\.\/brand\/logitech\.html/.test(src) && /\.\/brand\/xingyu\.html/.test(src));
  check('罗技卡写明与评级无关、不调整 A 级',
    /不据此调整 A 级评级/.test(src));
  check('星宇卡写明不作因果推断、官方通报未认定违法解除',
    /本站不作因果推断/.test(src) && /官方通报亦未认定违法解除/.test(src));
  check('不碰压缩 bundle', /不能改 bundle/.test(src));

  // ─────────── 4. 真 DOM：渲染后卡片上真的挂了登记框 ───────────
  console.log('\n--- 4. 真 DOM 渲染 ---');
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => {
    if (/Could not load|not implemented/i.test(e.message)) return;
    errors.push(e.message);
  });
  const CARD = (title, id) => `<div class="bg-white rounded-2xl border" id="${id}">` +
    '<div class="p-5 space-y-3.5">' +
    '<div class="flex items-start justify-between gap-3"><div><h2>' + title + '</h2>' +
    '<p>示例公司</p></div><span>评级徽章</span></div>' +
    '<div class="bg-slate-50 rounded-xl p-2.5"><span>工时政策：</span><span>—</span></div>' +
    '<div class="flex flex-wrap gap-1.5 pt-1"><span>标签</span></div>' +
    '</div></div>';
  const dom = new JSDOM(
    '<!doctype html><html><head></head><body>' +
    CARD('Logitech (罗技)', 'logi-card') +
    CARD('常州星宇股份 (车灯及汽车消费品)', 'xing-card') +
    CARD('Patagonia (巴塔哥尼亚)', 'other-card') +
    '</body></html>',
    { runScripts: 'outside-only', url: 'http://localhost/', virtualConsole: vc, pretendToBeVisual: true }
  );
  const { window } = dom;
  const doc = window.document;
  try { window.eval(src); } catch (e) { errors.push('eval patch: ' + e.message); }
  await tick(140);

  const logiBox = doc.querySelector('#logi-card [data-sxg-news="logitech"]');
  const xingBox = doc.querySelector('#xing-card [data-sxg-news="xingyu"]');
  check('★ 罗技卡渲染后真的出现登记框', !!logiBox);
  check('★ 星宇卡渲染后真的出现登记框', !!xingBox);
  check('★ 罗技框标题写明「品牌行为登记」与日期',
    !!logiBox && /品牌行为登记/.test(logiBox.textContent) && /2026-03-26/.test(logiBox.textContent));
  check('★ 星宇框标题写明「后续进展登记」',
    !!xingBox && /后续进展登记/.test(xingBox.textContent));
  check('罗技框正文含致歉与「与评级无关」',
    !!logiBox && /罗技中国/.test(logiBox.textContent) && /与工时、双休数据无关/.test(logiBox.textContent));
  check('星宇框正文含扣薪、车企调查与不作因果推断',
    !!xingBox && /扣薪 12 个月/.test(xingBox.textContent)
    && /奔驰、大众、宝马/.test(xingBox.textContent) && /不作因果推断/.test(xingBox.textContent));
  check('两张框都插在标题行之后（inner.children[1]）',
    doc.querySelector('#logi-card div.p-5.space-y-3\\.5').children[1] === logiBox
    && doc.querySelector('#xing-card div.p-5.space-y-3\\.5').children[1] === xingBox);
  check('★ 卡片内链接都是站内详情页，没有 http 外链',
    [logiBox, xingBox].every((b) => b && [].slice.call(b.querySelectorAll('a'))
      .every((a) => /^\.\/brand\//.test(a.getAttribute('href') || ''))));
  check('★ 无关的 Patagonia 卡没被误挂',
    doc.querySelectorAll('#other-card [data-sxg-news]').length === 0);
  check('两张卡各只有一个登记框（幂等初态）',
    doc.querySelectorAll('#logi-card [data-sxg-news]').length === 1
    && doc.querySelectorAll('#xing-card [data-sxg-news]').length === 1);

  // ─────────── 5. 重渲染自愈 + 幂等 ───────────
  console.log('\n--- 5. 重渲染自愈 / 幂等 ---');
  doc.body.appendChild(doc.createElement('div'));
  await tick(140);
  check('重复触发 DOM 变动不会重复插框',
    doc.querySelectorAll('#logi-card [data-sxg-news]').length === 1
    && doc.querySelectorAll('#xing-card [data-sxg-news]').length === 1);

  const oldInner = doc.querySelector('#logi-card div.p-5.space-y-3\\.5');
  const rebuilt = doc.createElement('div');
  rebuilt.className = 'p-5 space-y-3.5';
  rebuilt.innerHTML = '<div class="flex"><h2>Logitech (罗技)</h2></div>'
    + '<div class="bg-slate-50">工时政策</div>';
  oldInner.parentNode.replaceChild(rebuilt, oldInner);
  await tick(160);
  check('★ React 重渲染替换卡片内容后自动补挂登记框',
    !!doc.querySelector('#logi-card [data-sxg-news="logitech"]'));
  check('补挂后仍插在标题行之后',
    rebuilt.children[1] === doc.querySelector('#logi-card [data-sxg-news="logitech"]'));
  check('重渲染期间星宇框没被重复插入',
    doc.querySelectorAll('#xing-card [data-sxg-news]').length === 1);
  check('运行期无 JS 异常', errors.length === 0, errors.slice(0, 3));

  console.log('\n' + '='.repeat(52));
  console.log(`通过 ${pass} 项，失败 ${fail} 项`);
  if (fail) console.log('失败项：\n  - ' + fails.join('\n  - '));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
