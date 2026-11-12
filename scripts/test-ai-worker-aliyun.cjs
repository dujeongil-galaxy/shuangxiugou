/* ==========================================================================
   test-ai-worker-aliyun.cjs —— 阿里云函数计算线路逻辑测试（桩 fetch，不联网）
   --------------------------------------------------------------------------
   被测对象：ai-worker-aliyun/index.mjs（ESM export handler）

   覆盖路径：
     ① CORS：白名单 Origin 放行；未知 Origin 403；OPTIONS 预检 204
     ② 输入校验：缺 question / 超长 400；非法 JSON 400；GET 405
     ③ history 清洗：role 白名单、截 8 条、每条 200 字
     ④ 系统提示词含劳动法口径 + route 说明
     ⑤ 缺 DASHSCOPE_API_KEY → 500 missing-api-key
     ⑥ 正常链路：调百炼 → answer 透传 + route 回声
     ⑦ 上游 429/403 → 429 daily-quota-exhausted；上游 500 → 502
     ⑧ 每 IP 限流：第 21 次 429 rate-limited
     ⑨ 契约对齐：错误字符串与 Cloudflare 版完全一致（前端一套逻辑吃两条线路）
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CF_WORKER_SRC = fs.readFileSync(path.join(ROOT, 'ai-worker/src/worker.js'), 'utf8');

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name + (detail !== undefined ? ' → ' + JSON.stringify(detail) : '')); }
}

const SITE_ORIGIN = 'https://dujeongil-galaxy.github.io';

// 桩 fetch：记录调用，按 __nextResponse 决定回什么
const fetchCalls = [];
let nextResponse = null;
globalThis.fetch = async function (url, opts) {
  fetchCalls.push({ url, opts });
  if (!nextResponse) throw new Error('no stub response');
  const spec = nextResponse;
  nextResponse = null;
  return {
    status: spec.status || 200,
    ok: (spec.status || 200) >= 200 && (spec.status || 200) < 300,
    json: async () => spec.body || {},
  };
};

function ev(method, body, origin, ip) {
  const headers = { 'Content-Type': 'application/json' };
  if (origin) headers['Origin'] = origin;
  headers['x-forwarded-for'] = ip || '203.0.113.9';
  return {
    httpMethod: method,
    headers,
    body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

async function main() {
  const mod = await import('file://' + path.join(ROOT, 'ai-worker-aliyun/index.mjs').replace(/\\/g, '/'));
  const handler = mod.handler;

  console.log('== ① CORS 白名单 ==');
  {
    const pre = await handler(ev('OPTIONS', undefined, SITE_ORIGIN));
    check('OPTIONS 预检 204', pre.statusCode === 204, pre.statusCode);
    check('预检回显 Origin', pre.headers['Access-Control-Allow-Origin'] === SITE_ORIGIN);

    const bad = await handler(ev('POST', { question: '加班费' }, 'https://evil.example.com'));
    check('未知 Origin 403', bad.statusCode === 403, bad.statusCode);
    check('未知 Origin 回显空串', bad.headers['Access-Control-Allow-Origin'] === '');
    check('未知 Origin 不调上游', fetchCalls.length === 0);

    const noOrigin = await handler(ev('POST', { question: '加班费' }));
    check('无 Origin 也 403（对齐 CF 版）', noOrigin.statusCode === 403);
  }

  console.log('== ② 输入校验 ==');
  {
    fetchCalls.length = 0;
    const noQ = await handler(ev('POST', {}, SITE_ORIGIN));
    check('缺 question → 400', noQ.statusCode === 400);
    check('错误串与 CF 版一致',
      JSON.parse(noQ.body).error === 'question-required-1-to-500-chars', noQ.body);

    const long = await handler(ev('POST', { question: '长'.repeat(501) }, SITE_ORIGIN));
    check('超长 question → 400', long.statusCode === 400);

    const badJson = await handler(ev('POST', 'not-json', SITE_ORIGIN));
    check('非法 JSON → 400 invalid-json', badJson.statusCode === 400 && JSON.parse(badJson.body).error === 'invalid-json');

    const wrongMethod = await handler(ev('GET', undefined, SITE_ORIGIN));
    check('GET → 405', wrongMethod.statusCode === 405);
    check('以上全部未调上游', fetchCalls.length === 0);
  }

  console.log('== ③ 缺 API Key ==');
  {
    delete process.env.DASHSCOPE_API_KEY;
    fetchCalls.length = 0;
    const r = await handler(ev('POST', { question: '加班费' }, SITE_ORIGIN));
    check('缺 Key → 500 missing-api-key', r.statusCode === 500 && JSON.parse(r.body).error === 'missing-api-key');
    check('缺 Key 不打上游', fetchCalls.length === 0);
    process.env.DASHSCOPE_API_KEY = 'sk-test-key';
  }

  console.log('== ④⑤⑥ 正常链路 ==');
  {
    fetchCalls.length = 0;
    const history = [];
    for (let i = 0; i < 12; i++) history.push({ role: i % 2 ? 'assistant' : 'user', content: '历史' + i + ' ' + 'x'.repeat(300) });
    history.push({ role: 'system', content: '注入的角色' });

    nextResponse = { status: 200, body: { choices: [{ message: { content: '模拟回答：依据劳动法第四十四条…' } }] } };
    const r = await handler(ev('POST', { question: '加班费怎么算', history, route: 'cn' }, SITE_ORIGIN));
    check('200', r.statusCode === 200, r.statusCode);
    const data = JSON.parse(r.body);
    check('answer 透传', data.answer === '模拟回答：依据劳动法第四十四条…');
    check('route 回声 cn', data.route === 'cn', data.route);
    check('响应带 CORS 头', r.headers['Access-Control-Allow-Origin'] === SITE_ORIGIN);

    check('上游恰好调用一次', fetchCalls.length === 1);
    const call = fetchCalls[0];
    check('打到百炼兼容模式端点', /dashscope\.aliyuncs\.com\/compatible-mode\/v1\/chat\/completions/.test(call.url), call.url);
    check('Authorization 用 Bearer Key', /^Bearer sk-test-key$/.test(call.opts.headers.Authorization), call.opts.headers.Authorization);
    const sent = JSON.parse(call.opts.body);
    check('max_tokens = 2000（对齐 CF 版）', sent.max_tokens === 2000, sent.max_tokens);
    check('请求体不含 Key（Key 只在头里）', !/sk-test-key/.test(call.opts.body));

    const msgs = sent.messages;
    check('system 提示词在 messages[0]', msgs[0].role === 'system');
    check('提示词含 36 小时加班上限口径', /36/.test(msgs[0].content));
    check('提示词含加班费倍率口径', /150%/.test(msgs[0].content) && /300%/.test(msgs[0].content));
    check('提示词声明非法律意见', /不构成|不是法律意见|参考信息/.test(msgs[0].content));
    check('提示词含线路如实说明（cn / 阿里云）', /阿里云/.test(msgs[0].content) && /线路标识为 cn/.test(msgs[0].content));

    const histMsgs = msgs.slice(1, -1);
    check('history 截到 8 条', histMsgs.length === 8, histMsgs.length);
    check('role 白名单生效（system 注入被滤）', histMsgs.every(m => m.role === 'user' || m.role === 'assistant'));
    check('每条截 200 字', histMsgs.every(m => m.content.length <= 200));
    check('用户问题在末位', msgs[msgs.length - 1].content === '加班费怎么算');
  }

  console.log('== ⑦ 上游异常映射 ==');
  {
    nextResponse = { status: 429, body: {} };
    const r429 = await handler(ev('POST', { question: '问' }, SITE_ORIGIN, '198.51.100.1'));
    check('上游 429 → 429 daily-quota-exhausted',
      r429.statusCode === 429 && JSON.parse(r429.body).error === 'daily-quota-exhausted');

    nextResponse = { status: 403, body: {} };
    const r403 = await handler(ev('POST', { question: '问' }, SITE_ORIGIN, '198.51.100.2'));
    check('上游 403（Key 失效/欠费）→ 429 配额口径', r403.statusCode === 429);

    nextResponse = { status: 500, body: {} };
    const r500 = await handler(ev('POST', { question: '问' }, SITE_ORIGIN, '198.51.100.3'));
    check('上游 500 → 502 ai-upstream-error',
      r500.statusCode === 502 && JSON.parse(r500.body).error === 'ai-upstream-error');

    nextResponse = { status: 200, body: { choices: [{ message: { content: '' } }] } };
    const rEmpty = await handler(ev('POST', { question: '问' }, SITE_ORIGIN, '198.51.100.4'));
    check('空回答 → 502 empty-answer', rEmpty.statusCode === 502 && JSON.parse(rEmpty.body).error === 'empty-answer');
  }

  console.log('== ⑧ 每 IP 限流（20 次/小时）==');
  {
    const ip = '203.0.113.77';
    let last = null;
    for (let i = 0; i < 21; i++) {
      nextResponse = { status: 200, body: { choices: [{ message: { content: '答' } }] } };
      last = await handler(ev('POST', { question: '问' }, SITE_ORIGIN, ip));
    }
    check('第 21 次 → 429 rate-limited', last.statusCode === 429 && JSON.parse(last.body).error === 'rate-limited');
  }

  console.log('== ⑨ 与 Cloudflare 版契约对齐 ==');
  {
    const keys = [
      'question-required-1-to-500-chars', 'invalid-json', 'method-not-allowed',
      'origin-not-allowed', 'rate-limited', 'daily-quota-exhausted', 'ai-upstream-error',
    ];
    const aliyunSrc = fs.readFileSync(path.join(ROOT, 'ai-worker-aliyun/index.mjs'), 'utf8');
    keys.forEach(k => check('CF 版用到的 error 串「' + k + '」本实现也有', aliyunSrc.includes("'" + k + "'")));
    check('CF 版本身仍含 daily-quota-exhausted 口径', CF_WORKER_SRC.includes('daily-quota-exhausted'));
    check('两端 max_tokens 同为 2000', /max_tokens: 2000/.test(aliyunSrc) && /max_tokens: 2000/.test(CF_WORKER_SRC));
  }

  console.log('\n========== 结果：' + passed + ' 项通过，' + failed + ' 项失败 ==========');
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
