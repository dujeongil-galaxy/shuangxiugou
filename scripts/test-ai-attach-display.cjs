// 【本机专用 · 不挂 CI】当前 PAT 无 workflow scope，改 CI 会被远端拒推；故本机跑、不进 CI（verify §21o 咬此标记）。
/* ==========================================================================
   test-ai-attach-display.cjs —— labor-ai.html 附件/图片在气泡里的显示行为
   --------------------------------------------------------------------------
   2026-11-23 站长实测：上传 DOCX 后整段解析正文被回显进用户气泡，刷屏；
   图片也直接铺满气泡。新口径：
     ① 气泡只回显用户自己输入的问题，附件正文只发给 AI、不回显；
     ② 文档显示附件卡片（.a-file），图片固定缩略尺寸（.a-shot）；
     ③ 点击缩略图 → 新标签页看大图，大图临时缓存只写 sessionStorage；
     ④ pagehide（关标签页/浏览器）即清除该缓存，配额不足时直接开 data URL 兜底。
   抽真实函数源码用 new Function 跑，避免只做静态字符串断言。
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'labor-ai.html'), 'utf8');

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name + (detail !== undefined ? ' → ' + JSON.stringify(detail) : '')); }
}

function extract(name) {
  const start = HTML.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('缺少函数 ' + name);
  const end = HTML.indexOf('\n}', start);
  if (end < 0) throw new Error('函数未闭合 ' + name);
  return HTML.slice(start, end + 2);
}
const KEY_DECL = HTML.match(/var ZOOM_CACHE_KEY = '[^']+';/);
const PAGEHIDE = HTML.match(/window\.addEventListener\('pagehide', function\(\)\{[\s\S]*?\n\}\);/);
if (!KEY_DECL || !PAGEHIDE) throw new Error('缺少 ZOOM_CACHE_KEY 声明或 pagehide 清理钩子');
const SRC = KEY_DECL[0] + '\n' + PAGEHIDE[0] + '\n'
  + ['userTextForDisplay', 'openImageZoom', 'renderBubbleAttachments'].map(extract).join('\n');

function makeEnv(opts) {
  opts = opts || {};
  const store = {};
  const opened = [];
  const revoked = [];
  let pagehide = null;
  const sessionStorage = {
    setItem(k, v) { if (opts.quota) throw new Error('QuotaExceededError'); store[k] = String(v); },
    getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    removeItem(k) { delete store[k]; }
  };
  const window = {
    addEventListener(ev, fn) { if (ev === 'pagehide') pagehide = fn; },
    open(u) { opened.push(u); return {}; }
  };
  const URL = { createObjectURL() { return 'blob:fake-viewer'; }, revokeObjectURL(u) { revoked.push(u); } };
  function Blob(parts) { this.parts = parts; }
  function setTimeout() { /* 单测不真的等 15 秒后回收 blob URL */ }
  const document = {
    createElement(tag) {
      return {
        tagName: tag, className: '', src: '', alt: '', title: '', textContent: '', style: {},
        children: [], handlers: {},
        appendChild(c) { this.children.push(c); },
        addEventListener(ev, fn) { this.handlers[ev] = fn; }
      };
    }
  };
  const attachments = opts.attachments || [];
  const api = new Function(
    'sessionStorage', 'window', 'URL', 'Blob', 'setTimeout', 'document', 'attachments',
    SRC + '\nreturn { userTextForDisplay:userTextForDisplay, openImageZoom:openImageZoom, '
      + 'renderBubbleAttachments:renderBubbleAttachments, ZOOM_CACHE_KEY:ZOOM_CACHE_KEY };'
  )(sessionStorage, window, URL, Blob, setTimeout, document, attachments);
  return { api, store, opened, revoked, document, getPagehide() { return pagehide; } };
}

console.log('=== test-ai-attach-display.cjs ===');

// 1. 正文不回显：只显示用户自己输入的问题
{
  const env = makeEnv();
  const parts = [
    { type: 'text', text: '帮我看看这份合同' },
    { type: 'text', text: '【附件 合同.docx】\n甲方乙方阶梯加班费 12000 字的解析正文…' }
  ];
  const out = env.api.userTextForDisplay(parts);
  check('用户气泡只回显提问本身', out === '帮我看看这份合同', out);
  check('解析正文不再倒进气泡', out.indexOf('解析正文') < 0 && out.indexOf('【附件') < 0, out);
  check('无输入时显示默认问题的提示',
    env.api.userTextForDisplay([]) === '请分析我上传的附件');
}

// 2. 文档 → 附件卡片，卡片只带文件名
{
  const env = makeEnv({ attachments: [{ id: 1, name: '前女友那件事.docx', kind: 'docx', status: 'done', text: '正文一大段…' }] });
  const bub = env.document.createElement('div');
  env.api.renderBubbleAttachments(bub);
  const row = bub.children[0];
  check('附件统一挂在可换行的附件行里（不撑出气泡）', !!row && row.className === 'a-attach-row', row && row.className);
  const chip = row.children[0];
  check('文档显示为附件卡片 .a-file', !!chip && chip.className === 'a-file', chip && chip.className);
  check('卡片只含文件名，不含解析正文',
    !!chip && chip.children.some(c => c.className === 'a-fname' && c.textContent === '前女友那件事.docx')
      && !chip.children.some(c => (c.textContent || '').indexOf('正文一大段') >= 0));
}

// 3. 图片 → 缩略图；点击在新标签页看大图，缓存走 sessionStorage，关页清除
{
  const dataUrl = 'data:image/png;base64,AAAA';
  const env = makeEnv({ attachments: [{ id: 2, name: '工资条.png', kind: 'image', status: 'done', dataUrl: dataUrl }] });
  const bub = env.document.createElement('div');
  env.api.renderBubbleAttachments(bub);
  const row = bub.children[0];
  check('图片也挂在附件行里', !!row && row.className === 'a-attach-row', row && row.className);
  const im = row.children[0];
  check('图片显示为缩略图 .a-shot', !!im && im.className === 'a-shot', im && im.className);
  check('缩略图带点击放大提示', !!im && im.title.indexOf('新标签页') >= 0, im && im.title);
  im.handlers.click();
  check('点击缩略图在新标签页打开预览页',
    env.opened.length === 1 && env.opened[0].indexOf('blob:') === 0, env.opened);
  check('大图临时缓存写入 sessionStorage（不是 localStorage）',
    !!env.store[env.api.ZOOM_CACHE_KEY]
      && JSON.parse(env.store[env.api.ZOOM_CACHE_KEY]).img === dataUrl, Object.keys(env.store));
  const ph = env.getPagehide();
  check('注册了 pagehide 清理钩子', typeof ph === 'function');
  ph();
  check('关页面即清除临时缓存', !env.store[env.api.ZOOM_CACHE_KEY], Object.keys(env.store));
}

// 4. 缓存配额不足 → 直接开原图 data URL 兜底，不让用户点不动
{
  const dataUrl = 'data:image/jpeg;base64,BBBB';
  const env = makeEnv({ quota: true });
  env.api.openImageZoom(dataUrl, '兜底.jpg');
  check('缓存写不进去时仍能在新标签页看大图',
    env.opened.length === 1 && env.opened[0] === dataUrl, env.opened);
}

console.log(`结果：通过 ${passed} 项，失败 ${failed} 项`);
process.exit(failed ? 1 : 0);
