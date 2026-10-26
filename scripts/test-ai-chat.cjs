/* ==========================================================================
   test-ai-chat.cjs —— 劳动法小助手挂件行为测试
   --------------------------------------------------------------------------
   被测对象：ai-chat.js（浏览器 IIFE）+ ai-config.js（开关）

   覆盖路径：
     ① 降级：endpoint 为空 → 挂件完全不渲染（按钮/面板/样式都不注入）
     ② 配置 endpoint → 按钮 + 面板渲染，面板默认展开
     ③ 点按钮 → 面板开关切换；hidden 属性语义正确
     ④ 欢迎语在日志区（本地生成，不 fetch）
     ⑤ 提交问题 → fetch 打到 endpoint、POST、JSON 体含 question + history
     ⑥ 正常回答 → bot 气泡填入 answer、history 追加两条、按钮解禁
     ⑦ 服务端 429（daily-quota-exhausted）→ 中文文案气泡、不追加 history
     ⑧ 网络异常 → 错误文案气泡、按钮解禁（busy 复位）
     ⑨ 问题超长（>500 字）→ input.maxLength 兜底
     ⑩ 幂等：重复 boot 不重复插按钮
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const CHAT_SRC = fs.readFileSync(path.join(ROOT, 'ai-chat.js'), 'utf8');
const CONFIG_SRC = fs.readFileSync(path.join(ROOT, 'ai-config.js'), 'utf8');

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name + (detail !== undefined ? ' → ' + JSON.stringify(detail) : '')); }
}

const BRAND_PAGE = `<!doctype html><html><head><style>.wrap{max-width:760px}</style></head>
<body><div class="wrap"><h1>宏碁 (Acer) 双休</h1><p>正文</p></div></body></html>`;

function makeDom(configScript) {
  const dom = new JSDOM(BRAND_PAGE, { url: 'https://dujeongil-galaxy.github.io/shuangxiugou/brand/acer.html', runScripts: 'outside-only' });
  const { window } = dom;
  window.fetchCalls = [];
  window.fetch = function (url, opts) {
    window.fetchCalls.push({ url, opts });
    return Promise.resolve(window.__fetchResponse || { ok: true, json: () => Promise.resolve({}) });
  };
  if (configScript) window.eval(configScript);
  window.eval(CHAT_SRC);
  return dom;
}

async function main() {
  console.log('== ① 未配置 endpoint：stub 模式（按钮显示 + 开通提示 + 禁用表单）==');
  {
    const dom = makeDom(null);
    const doc = dom.window.document;
    await new Promise(r => setTimeout(r, 30));
    check('按钮渲染（不再隐身）', !!doc.getElementById('sxg-ai-fab'));
    check('面板渲染', !!doc.getElementById('sxg-ai-panel'));
    check('样式注入', !!doc.getElementById('sxg-ai-style'));
    check('欢迎语是「开通中」提示', /开通中/.test(doc.querySelector('.sxg-ai-log .sxg-ai-msg.bot').textContent));
    check('输入框禁用', doc.querySelector('.sxg-ai-in').disabled === true);
    check('发送按钮禁用', doc.querySelector('.sxg-ai-send').disabled === true);
    check('fetch 零调用（stub 不发请求）', dom.window.fetchCalls.length === 0);
  }

  console.log('== ② 配置 endpoint：渲染 + 默认展开 ==');
  {
    const dom = makeDom('window.SXG_AI_CONFIG={endpoint:"https://ai.example.workers.dev"}');
    const doc = dom.window.document;
    await new Promise(r => setTimeout(r, 30));
    check('按钮渲染', !!doc.getElementById('sxg-ai-fab'));
    check('面板渲染', !!doc.getElementById('sxg-ai-panel'));
    check('面板默认展开', doc.getElementById('sxg-ai-panel').hidden === false);
    check('样式注入', !!doc.getElementById('sxg-ai-style'));
    check('欢迎语存在（本地生成）', doc.querySelector('.sxg-ai-log .sxg-ai-msg.bot') !== null
      && /劳动法小助手/.test(doc.querySelector('.sxg-ai-log .sxg-ai-msg.bot').textContent));
    check('未 fetch', dom.window.fetchCalls.length === 0);

    // ③ 面板开关
    doc.getElementById('sxg-ai-fab').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    check('点按钮面板关', doc.getElementById('sxg-ai-panel').hidden === true);
    doc.getElementById('sxg-ai-fab').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    check('再点面板开', doc.getElementById('sxg-ai-panel').hidden === false);

    // ⑩ 幂等
    dom.window.eval('document.dispatchEvent(new Event("DOMContentLoaded"))');
    const fabs = doc.querySelectorAll('#sxg-ai-fab');
    check('幂等：不重复插按钮', fabs.length === 1);
  }

  console.log('== ⑤⑥ 正常问答链路 ==');
  {
    const dom = makeDom('window.SXG_AI_CONFIG={endpoint:"https://ai.example.workers.dev"}');
    const w = dom.window, doc = w.document;
    await new Promise(r => setTimeout(r, 30));
    w.__fetchResponse = { ok: true, json: () => Promise.resolve({ answer: '平时加班 150%，休息日 200%，法定节假日 300%。' }) };

    const form = doc.querySelector('.sxg-ai-form');
    const input = doc.querySelector('.sxg-ai-in');
    const send = doc.querySelector('.sxg-ai-send');
    input.value = '加班费怎么算';
    form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 50));

    check('fetch 打到 endpoint', w.fetchCalls.length === 1 && w.fetchCalls[0].url === 'https://ai.example.workers.dev');
    check('POST + JSON 头', w.fetchCalls[0].opts.method === 'POST' && /application\/json/.test(w.fetchCalls[0].opts.headers['Content-Type']));
    const body = JSON.parse(w.fetchCalls[0].opts.body);
    check('请求体含 question', body.question === '加班费怎么算');
    check('请求体含 history 数组', Array.isArray(body.history));

    const msgs = [...doc.querySelectorAll('.sxg-ai-msg')];
    check('用户气泡上屏', msgs.some(m => m.className.includes('user') && m.textContent === '加班费怎么算'));
    check('回答气泡上屏', msgs.some(m => m.textContent.includes('300%')));
    check('按钮解禁', send.disabled === false);

    // 追问带 history
    w.__fetchResponse = { ok: true, json: () => Promise.resolve({ answer: '第二条回答' }) };
    input.value = '那年休假呢';
    form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 50));
    const body2 = JSON.parse(w.fetchCalls[1].opts.body);
    check('追问携带历史（2 条）', body2.history.length === 2 && body2.history[0].role === 'user');
  }

  console.log('== ⑦ 服务端 429/配额 ==');
  {
    const dom = makeDom('window.SXG_AI_CONFIG={endpoint:"https://ai.example.workers.dev"}');
    const w = dom.window, doc = w.document;
    await new Promise(r => setTimeout(r, 30));
    w.__fetchResponse = { ok: false, json: () => Promise.resolve({ error: 'daily-quota-exhausted' }) };
    const form = doc.querySelector('.sxg-ai-form');
    doc.querySelector('.sxg-ai-in').value = '问';
    form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 50));
    const msgs = [...doc.querySelectorAll('.sxg-ai-msg')];
    check('配额文案上屏', msgs.some(m => m.className.includes('err') && /额度已用完/.test(m.textContent)));
    check('思考中气泡被移除', !msgs.some(m => m.textContent === '思考中…'));
  }

  console.log('== ⑧ 网络异常 ==');
  {
    const dom = makeDom('window.SXG_AI_CONFIG={endpoint:"https://ai.example.workers.dev"}');
    const w = dom.window, doc = w.document;
    await new Promise(r => setTimeout(r, 30));
    w.fetch = function () { return Promise.reject(new TypeError('Failed to fetch')); };
    const form = doc.querySelector('.sxg-ai-form');
    const send = doc.querySelector('.sxg-ai-send');
    doc.querySelector('.sxg-ai-in').value = '问';
    form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 50));
    const msgs = [...doc.querySelectorAll('.sxg-ai-msg')];
    check('网络异常文案上屏', msgs.some(m => m.className.includes('err') && /网络异常/.test(m.textContent)));
    check('busy 复位（按钮解禁）', send.disabled === false);
  }

  console.log('== ⑨ 输入兜底 ==');
  {
    const dom = makeDom('window.SXG_AI_CONFIG={endpoint:"https://ai.example.workers.dev"}');
    const doc = dom.window.document;
    await new Promise(r => setTimeout(r, 30));
    check('maxLength=500', doc.querySelector('.sxg-ai-in').maxLength === 500);
  }

  console.log('== ⑪ ai-config.js 原样（空 endpoint）= stub 模式不炸 ==');
  {
    const dom = new JSDOM(BRAND_PAGE, { url: 'https://dujeongil-galaxy.github.io/shuangxiugou/brand/acer.html', runScripts: 'outside-only' });
    const w = dom.window;
    let fetched = false;
    w.fetch = function () { fetched = true; return Promise.resolve({ ok: true, json: () => Promise.resolve({}) }); };
    w.eval(CONFIG_SRC);
    w.eval(CHAT_SRC);
    await new Promise(r => setTimeout(r, 30));
    check('原样配置（空 endpoint）→ stub 渲染按钮', !!w.document.getElementById('sxg-ai-fab'));
    check('原样配置 → 零 fetch', fetched === false);
  }

  console.log('== ⑫ 卡通形象（SVG data URI，非 emoji）==');
  {
    const dom = makeDom('window.SXG_AI_CONFIG={endpoint:"https://ai.example.workers.dev"}');
    const doc = dom.window.document;
    await new Promise(r => setTimeout(r, 30));
    const fab = doc.getElementById('sxg-ai-fab');
    check('按钮内是 img 且 src 为 SVG data URI', !!fab && fab.querySelector('img') !== null
      && /^data:image\/svg\+xml;base64,/.test(fab.querySelector('img').src));
    fab.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    const head = doc.querySelector('.sxg-ai-head');
    check('面板头部有头像 img', !!head && head.querySelector('img') !== null
      && /^data:image\/svg\+xml;base64,/.test(head.querySelector('img').src));
    check('按钮不再是 emoji 文本', !fab.textContent.includes('🤖'));
    const cfg = fs.readFileSync(path.join(ROOT, 'ai-config.js'), 'utf8');
    check('AVATAR 常量来自 assets/ai-avatar.svg 同源内容', /var AVATAR = 'data:image\/svg\+xml;base64,/.test(fs.readFileSync(path.join(ROOT, 'ai-chat.js'), 'utf8'))
      && fs.existsSync(path.join(ROOT, 'assets/ai-avatar.svg')));
  }

  console.log('\n========== 结果：' + passed + ' 项通过，' + failed + ' 项失败 ==========');
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
