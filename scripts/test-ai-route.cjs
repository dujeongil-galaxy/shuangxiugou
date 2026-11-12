/* ==========================================================================
   test-ai-route.cjs —— 「AI 形象按线路分流」行为测试（2026-11-13 站长指令）
   --------------------------------------------------------------------------
   被测对象：ai-chat.js（分流逻辑）+ ai-config.js（endpoint / endpointCN）

   分流规则：
     形象 A/B/C（索引 0-2）→ endpoint   （Cloudflare）
     形象 D/E/F（索引 3-5）→ endpointCN （阿里云函数计算）
     endpointCN 为空 → D/E/F 回落 Cloudflare，且面板必须明说（不许静默）

   覆盖路径：
     ① A 形象 → 请求打到 CF，route='cf'，线路条说 Cloudflare
     ② D 形象（CN 已配）→ 请求打到 CN，route='cn'，线路条说阿里云
     ③ D 形象（CN 未配）→ 回落 CF，route='cf'，线路条/对话都出现「回落」
     ④ 切换形象（A→D）→ 线路条同步更新
     ⑤ 网络异常文案分线路：CN 线路失败不提 VPN；CF 线路失败提 VPN
     ⑥ 两条线路都空 → 仍是 stub（按钮在、表单禁用、零 fetch）
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const CHAT_SRC = fs.readFileSync(path.join(ROOT, 'ai-chat.js'), 'utf8');

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name + (detail !== undefined ? ' → ' + JSON.stringify(detail) : '')); }
}

const BRAND_PAGE = `<!doctype html><html><head></head>
<body><div class="wrap"><h1>宏碁 (Acer) 双休</h1><p>正文</p></div></body></html>`;

const CF = 'https://ai.example.workers.dev';
const CN = 'https://ai.example.cn-hangzhou.fcapp.run';

function makeDom(configScript, cookie) {
  const dom = new JSDOM(BRAND_PAGE, { url: 'https://dujeongil-galaxy.github.io/shuangxiugou/brand/acer.html', runScripts: 'outside-only' });
  const { window } = dom;
  if (cookie) window.document.cookie = cookie + '; path=/';
  window.fetchCalls = [];
  window.fetch = function (url, opts) {
    window.fetchCalls.push({ url, opts });
    if (window.__fetchReject) return Promise.reject(new Error('network down'));
    return Promise.resolve(window.__fetchResponse || { ok: true, json: () => Promise.resolve({}) });
  };
  if (configScript) window.eval(configScript);
  window.eval(CHAT_SRC);
  return dom;
}

async function askOne(w, doc, q) {
  const form = doc.querySelector('.sxg-ai-form');
  const input = doc.querySelector('.sxg-ai-in');
  input.value = q;
  form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise(r => setTimeout(r, 50));
}

function lastBody(w) { return JSON.parse(w.fetchCalls[w.fetchCalls.length - 1].opts.body); }

async function main() {
  console.log('== ① 形象 A（索引 0）→ Cloudflare ==');
  {
    const dom = makeDom(`window.SXG_AI_CONFIG={endpoint:"${CF}",endpointCN:"${CN}"}`);
    const w = dom.window, doc = w.document;
    await new Promise(r => setTimeout(r, 30));
    check('线路条存在', !!doc.getElementById('sxg-ai-route'));
    check('线路条说 Cloudflare', /Cloudflare/.test(doc.getElementById('sxg-ai-route').textContent),
      doc.getElementById('sxg-ai-route').textContent);
    await askOne(w, doc, '加班费怎么算');
    check('请求打到 CF endpoint', w.fetchCalls[0].url === CF, w.fetchCalls[0].url);
    check('请求体 route=cf', lastBody(w).route === 'cf', lastBody(w));
  }

  console.log('== ② 形象 D（索引 3，CN 已配）→ 阿里云 ==');
  {
    const dom = makeDom(`window.SXG_AI_CONFIG={endpoint:"${CF}",endpointCN:"${CN}"}`, 'sxg_ai_avatar=D');
    const w = dom.window, doc = w.document;
    await new Promise(r => setTimeout(r, 30));
    check('线路条说阿里云', /阿里云/.test(doc.getElementById('sxg-ai-route').textContent),
      doc.getElementById('sxg-ai-route').textContent);
    check('线路条不含「回落」', !/回落/.test(doc.getElementById('sxg-ai-route').textContent));
    await askOne(w, doc, '年休假几天');
    check('请求打到 CN endpoint', w.fetchCalls[0].url === CN, w.fetchCalls[0].url);
    check('请求体 route=cn', lastBody(w).route === 'cn', lastBody(w));
  }

  console.log('== ③ 形象 D 但 CN 未配 → 回落 CF 且可见 ==');
  {
    const dom = makeDom(`window.SXG_AI_CONFIG={endpoint:"${CF}",endpointCN:""}`, 'sxg_ai_avatar=D');
    const w = dom.window, doc = w.document;
    await new Promise(r => setTimeout(r, 30));
    const badge = doc.getElementById('sxg-ai-route').textContent;
    check('线路条标明「回落」', /回落/.test(badge), badge);
    check('线路条同时点出 Cloudflare 与阿里云', /Cloudflare/.test(badge) && /阿里云/.test(badge), badge);
    check('线路条带 warn 样式', /warn/.test(doc.getElementById('sxg-ai-route').className));
    check('欢迎语说明回落（不静默）', /回落/.test(doc.querySelector('.sxg-ai-log').textContent));
    await askOne(w, doc, '试用期多久');
    check('回落时请求打到 CF', w.fetchCalls[0].url === CF, w.fetchCalls[0].url);
    check('回落时 route 记实际线路 cf', lastBody(w).route === 'cf', lastBody(w));
  }

  console.log('== ④ 切换形象 A → D：线路条同步 + 回落提示 ==');
  {
    const dom = makeDom(`window.SXG_AI_CONFIG={endpoint:"${CF}",endpointCN:""}`);
    const w = dom.window, doc = w.document;
    await new Promise(r => setTimeout(r, 30));
    check('初始（A）线路条说 Cloudflare', /Cloudflare/.test(doc.getElementById('sxg-ai-route').textContent));
    const dBtn = doc.querySelector('#sxg-ai-avatar-pop button[data-id="D"]');
    check('切换弹层有 D 形象按钮', !!dBtn);
    dBtn.dispatchEvent(new w.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 20));
    const badge = doc.getElementById('sxg-ai-route').textContent;
    check('切到 D 后线路条更新为回落态', /回落/.test(badge), badge);
    check('面板里出现一句回落提示', /已切到形象 D/.test(doc.querySelector('.sxg-ai-log').textContent));
    await askOne(w, doc, '试用期多久');
    check('切到 D 后请求仍打 CF（回落）', w.fetchCalls[0].url === CF, w.fetchCalls[0].url);
  }

  console.log('== ⑤ 网络异常文案分线路措辞 ==');
  {
    // CN 线路失败：不得再提 VPN
    const dom = makeDom(`window.SXG_AI_CONFIG={endpoint:"${CF}",endpointCN:"${CN}"}`, 'sxg_ai_avatar=D');
    const w = dom.window, doc = w.document;
    await new Promise(r => setTimeout(r, 30));
    w.__fetchReject = true;
    await askOne(w, doc, '加班费怎么算');
    const errCn = [...doc.querySelectorAll('.sxg-ai-msg.err')].map(m => m.textContent).join('|');
    check('CN 失败有错误气泡', errCn.length > 0);
    check('CN 失败文案不提 VPN', !/VPN/i.test(errCn), errCn);
    check('CN 失败文案说明是阿里云线路', /阿里云/.test(errCn), errCn);
  }
  {
    // CF 线路失败：保留 VPN 指引
    const dom = makeDom(`window.SXG_AI_CONFIG={endpoint:"${CF}",endpointCN:"${CN}"}`);
    const w = dom.window, doc = w.document;
    await new Promise(r => setTimeout(r, 30));
    w.__fetchReject = true;
    await askOne(w, doc, '加班费怎么算');
    const errCf = [...doc.querySelectorAll('.sxg-ai-msg.err')].map(m => m.textContent).join('|');
    check('CF 失败文案含 VPN 指引', /VPN/.test(errCf), errCf);
    check('CF 失败文案提 Cloudflare', /Cloudflare/.test(errCf), errCf);
  }

  console.log('== ⑥ 两条线路都空 → 仍是 stub ==');
  {
    const dom = makeDom('window.SXG_AI_CONFIG={endpoint:"",endpointCN:""}');
    const w = dom.window, doc = w.document;
    await new Promise(r => setTimeout(r, 30));
    check('按钮仍渲染', !!doc.getElementById('sxg-ai-fab'));
    check('输入框禁用', doc.querySelector('.sxg-ai-in').disabled === true);
    check('线路条说未开通', /未开通/.test(doc.getElementById('sxg-ai-route').textContent),
      doc.getElementById('sxg-ai-route').textContent);
    check('零 fetch', w.fetchCalls.length === 0);
  }
  {
    // 只有 CN 配了、CF 空 → 不算 stub（A/B/C 会回落 CN）
    const dom = makeDom(`window.SXG_AI_CONFIG={endpoint:"",endpointCN:"${CN}"}`);
    const w = dom.window, doc = w.document;
    await new Promise(r => setTimeout(r, 30));
    check('仅配 CN 不算未开通（表单可用）', doc.querySelector('.sxg-ai-in').disabled === false);
    await askOne(w, doc, '加班费怎么算');
    check('A 形象回落打到 CN', w.fetchCalls[0].url === CN, w.fetchCalls[0].url);
    check('A 回落 route 记 cn', lastBody(w).route === 'cn', lastBody(w));
  }

  console.log('\n========== 结果：' + passed + ' 项通过，' + failed + ' 项失败 ==========');
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
