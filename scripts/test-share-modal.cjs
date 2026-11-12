/* ==========================================================================
   test-share-modal.cjs —— §36u 分享弹窗「平台一个都不能少、永不被误拦截」行为测试
   --------------------------------------------------------------------------
   被测：share-modal.js（浏览器 IIFE，jsdom 真跑）
   背景：2026-11-12 站长反馈分享平台变少。定位结论：外链平台原先渲染成
        <a href="…service.weibo.com/share…"> 这类节点，被浏览器扩展 / 手机浏览器
        跟踪防护按分享接口特征整块移除或隐藏，只剩复制类按钮。
        加固口径：外链平台全部改 <button data-share>，URL 只存在 JS 闭包里；
        点击走 window.open，新窗口若仍被拦则复制链接并明说。
   覆盖：
     ① 14 个平台恒定渲染（国内 5 + 海外 9），一个不少
     ② 弹窗 DOM 里 0 个 <a>，也不出现 href / target="_blank" / 分享接口明文
     ③ 外链平台 8 项带 data-share，且 URL 不在任何 DOM 属性里
     ④ 点击外链平台 → window.open(url, '_blank') 被调起
     ⑤ window.open 被拦（返回 null）→ 复制分享链接 + toast 明说「拦截」
     ⑥ 复制类平台 → 文案 + 链接一起复制（不光秃秃一个 URL）
     ⑦ 打赏页分享：链接剥掉 sponsor.html 后再交给外链（分享单一真相源）
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'share-modal.js'), 'utf8');

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name + (detail !== undefined ? ' → ' + JSON.stringify(detail) : '')); }
}

/* ---------- 环境：jsdom + window.open / clipboard 打桩 ---------- */
function mkEnv(opts) {
  opts = opts || {};
  const html = '<!DOCTYPE html><html><head>'
    + '<title>双休购 ShuangxiuGo</title>'
    + '<meta property="og:title" content="双休购 ShuangxiuGo">'
    + '<meta property="og:description" content="查公司双休制度、企业工时评级，避雷单休大小周。">'
    + '</head><body></body></html>';
  const dom = new JSDOM(html, {
    runScripts: 'outside-only',
    url: opts.url || 'https://dujeongil-galaxy.github.io/shuangxiugou/',
    pretendToBeVisual: true
  });
  const w = dom.window;

  // window.open 打桩：openFails=true 模拟「新窗口被拦截」，返回 null
  const opened = [];
  w.open = function (url, target) {
    opened.push({ url: url, target: target });
    if (opts.openFails) return null;
    // openClosed=true 模拟「返回了窗口句柄但立刻被关掉」（拦截器的另一种表现）
    if (opts.openClosed) return { closed: true, opener: w };
    return { closed: false, opener: w };
  };

  // clipboard 打桩：记录每次写入的文本
  const copied = [];
  Object.defineProperty(w.navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: function (text) { copied.push(text); return Promise.resolve(); }
    }
  });

  w.eval(SRC);
  const doc = w.document;
  return { dom: dom, w: w, doc: doc, opened: opened, copied: copied };
}

function openModal(env, opts) {
  env.w.SXGShare.open(opts);
  return env.doc.getElementById('sxg-share-mask');
}

/* ---------- ① 14 个平台恒定渲染 ---------- */
console.log('\n① 平台清单恒定渲染（国内 5 + 海外 9）');
{
  const env = mkEnv();
  const mask = openModal(env);
  const dom5 = mask.querySelectorAll('.sxg-share-domestic .sxg-sd');
  const frn9 = mask.querySelectorAll('.sxg-share-foreign .sxg-sf');
  check('国内平台 5 个（朋友圈/微信/抖音/小红书/微博）', dom5.length === 5, dom5.length);
  check('海外平台 9 个（Discord/Facebook/X/LinkedIn/Reddit/Telegram/KakaoTalk/Line/WhatsApp）',
    frn9.length === 9, frn9.length);
  check('平台合计 14 项，一个不少（拦截事故的核心症状是「变少」）',
    dom5.length + frn9.length === 14, dom5.length + frn9.length);
  check('末尾仍有独立「复制链接」按钮',
    !!mask.querySelector('.sxg-share-copy[data-copy="link"]'));
}

/* ---------- ② 弹窗 DOM 零外链特征 ---------- */
console.log('\n② 弹窗 DOM 不含任何外链特征（拦截规则无从匹配）');
{
  const env = mkEnv();
  const mask = openModal(env);
  const html = mask.innerHTML;
  check('弹窗内 <a> 节点数为 0', mask.querySelectorAll('a').length === 0,
    mask.querySelectorAll('a').length);
  check('弹窗内不出现 href= 属性', !/href\s*=/.test(html));
  check('弹窗内不出现 target="_blank"', !/target\s*=\s*["']?_blank/.test(html));
  const leak = ['service.weibo.com/share', 'facebook.com/sharer', 'twitter.com/intent',
    'linkedin.com/sharing', 'reddit.com/submit', 't.me/share',
    'social-plugins.line.me', 'wa.me/?text'];
  const hit = leak.filter(function (s) { return html.indexOf(s) !== -1; });
  check('8 个分享接口地址一个都没写进 DOM（含 encode 后形态）',
    hit.length === 0 && html.indexOf(encodeURIComponent(leak[0])) === -1, hit);
}

/* ---------- ③ 外链按钮走 data-share ---------- */
console.log('\n③ 外链平台按钮化（data-share 键名，不带 URL）');
{
  const env = mkEnv();
  const mask = openModal(env);
  const btns = mask.querySelectorAll('button[data-share]');
  const keys = Array.prototype.map.call(btns, function (b) { return b.getAttribute('data-share'); });
  const expect = ['weibo', 'facebook', 'x', 'linkedin', 'reddit', 'telegram', 'line', 'whatsapp'];
  check('8 个外链平台都是 <button data-share>', btns.length === 8, keys);
  check('键名与清单一一对应（微博 FB X LinkedIn Reddit TG Line WhatsApp）',
    expect.every(function (k) { return keys.indexOf(k) !== -1; }), keys);
  check('data-share 里只有键名，没有 http 串',
    keys.every(function (k) { return k.indexOf('http') === -1; }));
  check('分享 URL 只能从闭包取（SXGShare.info 不暴露 urls）',
    typeof env.w.SXGShare === 'object' && env.w.SXGShare.info().url === 'https://dujeongil-galaxy.github.io/shuangxiugou/');
}

/* ---------- ④ 点击外链 → window.open ---------- */
console.log('\n④ 点击外链平台调起 window.open');
{
  const env = mkEnv();
  const mask = openModal(env);
  const weibo = mask.querySelector('[data-share="weibo"]');
  weibo.dispatchEvent(new env.w.MouseEvent('click', { bubbles: true }));
  check('window.open 被调起 1 次', env.opened.length === 1, env.opened.length);
  check('目标为新窗口（第二参 _blank）', env.opened[0] && env.opened[0].target === '_blank',
    env.opened[0]);
  check('打开的是微博分享接口', !!env.opened[0] && /service\.weibo\.com\/share\/share\.php/.test(env.opened[0].url),
    env.opened[0] && env.opened[0].url);
  check('成功后不误报拦截（未复制、无拦截提示）', env.copied.length === 0, env.copied);

  // 其余 7 个平台逐个点，伞形覆盖
  const others = ['facebook', 'x', 'linkedin', 'reddit', 'telegram', 'line', 'whatsapp'];
  others.forEach(function (k) {
    mask.querySelector('[data-share="' + k + '"]')
      .dispatchEvent(new env.w.MouseEvent('click', { bubbles: true }));
  });
  check('7 个海外外链平台点击全部调起 window.open（累计 8 次）',
    env.opened.length === 8, env.opened.length);
  check('海外平台 URL 指向各自分享接口',
    env.opened.slice(1).every(function (o) { return /^https:\/\/(www\.)?(facebook\.com|twitter\.com|linkedin\.com|reddit\.com|t\.me|social-plugins\.line\.me|wa\.me)\//.test(o.url); }),
    env.opened.slice(1).map(function (o) { return o.url; }));
}

/* ---------- ⑤ window.open 被拦 → 复制兜底 ---------- */
console.log('\n⑤ 新窗口被拦时退化：复制链接 + 明说原因');
async function sec5() {
  const env = mkEnv({ openFails: true });
  const mask = openModal(env);
  mask.querySelector('[data-share="telegram"]')
    .dispatchEvent(new env.w.MouseEvent('click', { bubbles: true }));
  check('window.open 返回 null 时仍调用了一次 open', env.opened.length === 1, env.opened.length);
  check('自动把分享链接写进剪贴板', env.copied.length === 1 && /t\.me\/share\/url/.test(env.copied[0]),
    env.copied);
  // clipboard.writeText 是 Promise，toast 在 then 里出；这里让出微任务队列再断言
  await new Promise(function (r) { setTimeout(r, 0); });
  const toast = env.doc.getElementById('sxg-share-toast');
  check('toast 明说「被拦截」而不是静默没反应',
    !!toast && /拦截/.test(toast.textContent) && /已复制/.test(toast.textContent),
    toast && toast.textContent);
  check('兜底文案不冒充成功打开', !!toast && !/已打开|正在跳转/.test(toast.textContent),
    toast && toast.textContent);

  // 拦截器的另一种形态：window.open 返回了句柄、窗口立刻被关掉。也算被拦，必须兜底。
  const env2 = mkEnv({ openClosed: true });
  const mask2 = openModal(env2);
  mask2.querySelector('[data-share="line"]')
    .dispatchEvent(new env2.w.MouseEvent('click', { bubbles: true }));
  await new Promise(function (r) { setTimeout(r, 0); });
  check('窗口被立刻关掉（closed=true）时照样复制链接', env2.copied.length === 1
    && /social-plugins\.line\.me/.test(env2.copied[0]), env2.copied);
  const toast2 = env2.doc.getElementById('sxg-share-toast');
  check('窗口被立刻关掉时同样明说被拦', !!toast2 && /拦截/.test(toast2.textContent),
    toast2 && toast2.textContent);
}

/* ---------- ⑥ 复制类平台文案 ---------- */
// ⑤ 的 toast 断言依赖 clipboard Promise，后续段落串在它后面跑
sec5().then(function () {
console.log('\n⑥ 复制类平台：文案 + 链接一起复制');
{
  const env = mkEnv();
  const mask = openModal(env);
  mask.querySelector('.sxg-share-domestic [data-copy="1"]')
    .dispatchEvent(new env.w.MouseEvent('click', { bubbles: true }));
  check('复制内容含说明文案与链接两段', env.copied.length === 1
    && env.copied[0].split('\n').length === 2, env.copied);
  check('复制内容含站点链接', !!env.copied[0] && env.copied[0].indexOf('dujeongil-galaxy.github.io/shuangxiugou/') !== -1,
    env.copied[0]);
  check('复制类平台不调 window.open（没网页接口就不假装能跳）', env.opened.length === 0, env.opened.length);
}

/* ---------- ⑦ 打赏页链接规整仍然生效 ---------- */
console.log('\n⑦ 打赏页分享：剥掉 sponsor.html 再交给外链');
{
  const env = mkEnv({ url: 'https://dujeongil-galaxy.github.io/shuangxiugou/sponsor.html#donate' });
  const mask = openModal(env);
  mask.querySelector('[data-share="x"]')
    .dispatchEvent(new env.w.MouseEvent('click', { bubbles: true }));
  const u = env.opened[0] && env.opened[0].url;
  check('外链分享 URL 不含 sponsor.html', !!u && u.indexOf('sponsor.html') === -1, u);
  check('剥完指向站点首页（含其后的 hash 一并剥掉）',
    !!u && decodeURIComponent(u).indexOf('url=https://dujeongil-galaxy.github.io/shuangxiugou/&') !== -1,
    u && decodeURIComponent(u));
}

/* ---------- 汇总 ---------- */
console.log('\n' + '='.repeat(60));
if (failed) {
  console.log('\x1b[31m失败 ' + failed + ' 项\x1b[0m / 通过 ' + passed + ' 项');
  process.exit(1);
}
console.log('\x1b[32m全部通过\x1b[0m（' + passed + ' 项）');
}).catch(function (e) {
  console.error('\x1b[31m测试脚本异常\x1b[0m', e);
  process.exit(1);
});
