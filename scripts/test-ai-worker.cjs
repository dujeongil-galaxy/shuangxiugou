/* ==========================================================================
   test-ai-worker.cjs —— Worker 后端逻辑测试（桩 env.AI，不联网）
   --------------------------------------------------------------------------
   被测对象：ai-worker/src/worker.js（ESM export default { fetch }）

   覆盖路径：
     ① CORS：白名单 Origin 放行；未知 Origin 403；OPTIONS 预检 204
     ② 非白名单 Origin 的 POST：不触发 AI 调用（省 neurons）
     ③ 输入校验：无 question / 超长 400；非法 JSON 400
     ④ history 清洗：role 白名单、截 8 条、每条 200 字
     ⑤ 系统提示词进 messages[0]，含劳动法口径关键句
     ⑥ env.AI.run 收到正确 model ID 与 max_tokens
     ⑦ 回答透传：answer 字段返回
     ⑧ neurons 配额耗尽 → 429 daily-quota-exhausted
     ⑨ 每 IP 限流：第 21 次 429 rate-limited
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const WORKER_SRC = fs.readFileSync(path.join(ROOT, 'ai-worker/src/worker.js'), 'utf8');

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name + (detail !== undefined ? ' → ' + JSON.stringify(detail) : '')); }
}

// 把 ESM 源转成可 require 的形态：strip export default → 注入 module.exports
function loadWorker() {
  const src = WORKER_SRC.replace('export default', 'module.exports =');
  const mod = { exports: null };
  const fn = new Function('module', 'exports', 'globalThis', src);
  fn(mod, mod.exports, globalThis);
  return mod.exports;
}

const SITE_ORIGIN = 'https://dujeongil-galaxy.github.io';

function makeEnv() {
  return {
    calls: [],
    AI: {
      run: async function (modelId, params) {
        env.calls.push({ modelId, params });
        if (env.__nextError) { const e = env.__nextError; env.__nextError = null; throw e; }
        return { response: '模拟回答：依据劳动法第四十四条…' };
      },
    },
  };
}
const env = makeEnv();

function makeRequest(method, body, origin) {
  return new Request('https://ai.example.workers.dev/', {
    method,
    headers: { 'Content-Type': 'application/json', 'Origin': origin },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function main() {
  const worker = loadWorker();

  console.log('== ① CORS 白名单 ==');
  {
    const pre = await worker.fetch(makeRequest('OPTIONS', null, SITE_ORIGIN), env);
    check('OPTIONS 预检 204', pre.status === 204);
    check('预检回显 Origin', pre.headers.get('Access-Control-Allow-Origin') === SITE_ORIGIN);

    const bad = await worker.fetch(makeRequest('POST', { question: '加班费' }, 'https://evil.example.com'), env);
    check('未知 Origin 403', bad.status === 403);
    check('未知 Origin 不调 AI（省 neurons）', env.calls.length === 0);
    check('未知 Origin 回显空串', bad.headers.get('Access-Control-Allow-Origin') === '');
  }

  console.log('== ③ 输入校验 ==');
  {
    env.calls.length = 0;
    const noQ = await worker.fetch(makeRequest('POST', {}, SITE_ORIGIN), env);
    check('缺 question → 400', noQ.status === 400);

    const long = await worker.fetch(makeRequest('POST', { question: '长'.repeat(501) }, SITE_ORIGIN), env);
    check('超长 question → 400', long.status === 400);

    const badJson = new Request('https://ai.example.workers.dev/', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Origin': SITE_ORIGIN }, body: 'not-json',
    });
    const bj = await worker.fetch(badJson, env);
    check('非法 JSON → 400', bj.status === 400);

    const wrongMethod = await worker.fetch(makeRequest('GET', null, SITE_ORIGIN), env);
    check('GET → 405', wrongMethod.status === 405);
    check('以上全部未调 AI', env.calls.length === 0);
  }

  console.log('== ④⑤⑥⑦ 正常链路 ==');
  {
    env.calls.length = 0;
    const history = [];
    for (let i = 0; i < 12; i++) history.push({ role: i % 2 ? 'assistant' : 'user', content: '历史' + i + ' ' + 'x'.repeat(300) });
    history.push({ role: 'system', content: '注入的角色' }); // 应被 role 白名单滤掉

    const r = await worker.fetch(makeRequest('POST', { question: '加班费怎么算', history }, SITE_ORIGIN), env);
    check('200', r.status === 200);
    const data = await r.json();
    check('answer 透传', data.answer === '模拟回答：依据劳动法第四十四条…');

    check('AI 恰好调用一次', env.calls.length === 1);
    const call = env.calls[0];
    check('model ID = @cf/zai-org/glm-4.7-flash', call.modelId === '@cf/zai-org/glm-4.7-flash');
    check('max_tokens ≤ 600', call.params.max_tokens <= 600);

    const msgs = call.params.messages;
    check('system 提示词在 messages[0]', msgs[0].role === 'system');
    check('提示词含 36 小时加班上限口径', /36/.test(msgs[0].content));
    check('提示词含加班费倍率口径', /150%/.test(msgs[0].content) && /300%/.test(msgs[0].content));
    check('提示词声明非法律意见', /不构成|不是法律意见|参考信息/.test(msgs[0].content));
    check('提示词锁定双休购站点角色', /双休购/.test(msgs[0].content));

    const histMsgs = msgs.slice(1, -1);
    check('history 截到 8 条', histMsgs.length === 8);
    check('role 白名单生效（system 注入被滤）', histMsgs.every(m => m.role === 'user' || m.role === 'assistant'));
    check('每条截 200 字', histMsgs.every(m => m.content.length <= 200));
    check('用户问题在末位', msgs[msgs.length - 1].content === '加班费怎么算');
  }

  console.log('== ⑧ 上游配额耗尽 ==');
  {
    env.calls.length = 0;
    env.__nextError = new Error('Daily neurons quota exceeded');
    const r = await worker.fetch(makeRequest('POST', { question: '问' }, SITE_ORIGIN), env);
    check('429', r.status === 429);
    const d = await r.json();
    check('daily-quota-exhausted + 重置时刻', d.error === 'daily-quota-exhausted' && /UTC/.test(d.resetAtUTC));
  }

  console.log('== ⑨ 每 IP 限流（20 次/小时）==');
  {
    // 换个干净 IP 段测（全局 Map 是共享的，用独立 IP 避开上面已消耗的计数）
    const freshIp = '203.0.113.77';
    const mkReq = () => {
      const req = new Request('https://ai.example.workers.dev/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Origin': SITE_ORIGIN },
        body: JSON.stringify({ question: '问' }),
      });
      // 桩 CF-Connecting-IP（真环境由 Cloudflare 注入）
      Object.defineProperty(req, 'headers', {
        value: new Headers({ 'Content-Type': 'application/json', 'Origin': SITE_ORIGIN, 'CF-Connecting-IP': freshIp }),
      });
      return req;
    };
    let last = null;
    for (let i = 0; i < 21; i++) {
      last = await worker.fetch(mkReq(), env);
    }
    check('第 21 次 → 429 rate-limited', last.status === 429 && (await last.json()).error === 'rate-limited');
  }

  console.log('\n========== 结果：' + passed + ' 项通过，' + failed + ' 项失败 ==========');
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
