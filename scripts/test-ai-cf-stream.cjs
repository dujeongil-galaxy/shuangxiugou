/* ==========================================================================
   test-ai-cf-stream.cjs —— 前端 askCF() 流式 SSE 解析逻辑测试（jsdom 桩 fetch）
   --------------------------------------------------------------------------
   为什么单独测：Worker 端 SSE 端点由 test-ai-worker.cjs 测过，但「前端怎么解析
   每一帧」是独立的逻辑——帧格式写错（Workers AI 老式 response / OpenAI choices
   两种都可能）、首字标记漏传、老 Worker 降级失效，都会让逐字输出静默坏掉。
   这里把 labor-ai.html 里的 askCF 源码抽出来，注入桩 fetch 真实跑一遍。

   覆盖：
     ① Workers AI 老式帧 {response:"..."} → 逐字回调 + first 标记
     ② OpenAI 兼容帧 {choices:[{delta:{content}}]} → 逐字回调（GLM-4.7-flash 实际格式）
     ③ reasoning_content 不显示（推理模型的思考链不外泄）
     ④ data: [DONE] 收尾、半行跨帧拼接
     ⑤ 老 Worker 回 JSON（content-type 非 event-stream）→ 自动降级取 answer
     ⑥ limit 429 / 上游错误 → 温和中文提示，不泄漏错误码
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

// 从 HTML 抽出 askCF 函数源码（到函数结束的换行 `}`）
function extractAskCF() {
  const m = HTML.match(/async function askCF\([\s\S]*?\n\}/);
  if (!m) throw new Error('askCF 未找到');
  return m[0];
}

// 用桩环境构造一个可调用的 askCF
function makeAskCF(fetchImpl) {
  const src = extractAskCF() + '\nreturn askCF;';
  const CFG = { cf: { endpoint: 'https://worker.example/worker', route: 'cf' } };
  const starStatus = () => ({ logged: false });
  // eslint-disable-next-line no-new-func
  const fn = new Function('CFG', 'starStatus', 'fetch', 'AbortController', 'setTimeout', 'clearTimeout', 'TextDecoder', src);
  return fn(CFG, starStatus, fetchImpl, AbortController, setTimeout, clearTimeout, TextDecoder);
}

// 把若干字符串帧编码成 SSE ReadableStream（可拆半行模拟网络分包）
function sseStream(chunks, { contentType = 'text/event-stream' } = {}) {
  const enc = new TextEncoder();
  return {
    status: 200,
    ok: true,
    headers: { get: (k) => (k.toLowerCase() === 'content-type' ? contentType : null) },
    body: {
      getReader() {
        let i = 0;
        return {
          async read() {
            if (i >= chunks.length) return { done: true };
            return { done: false, value: enc.encode(chunks[i++]) };
          },
        };
      },
    },
  };
}

async function main() {
  console.log('== ① Workers AI 老式帧 {response} ==');
  {
    const pieces = [], firsts = [];
    const askCF = makeAskCF(async () => sseStream([
      'data: {"response":"加班"}\n\n',
      'data: {"response":"费按"}\n\n',
      'data: {"response":"150%计算"}\n\n',
      'data: [DONE]\n\n',
    ]));
    const full = await askCF('q', [], [], (p, first) => { pieces.push(p); firsts.push(first); });
    check('逐字回调收到 3 片', pieces.length === 3, pieces);
    check('拼接成完整答案', full === '加班费按150%计算', full);
    check('first 标记仅首片为 true', JSON.stringify(firsts) === '[true,false,false]', firsts);
  }

  console.log('\n== ② OpenAI 兼容帧 {choices[].delta.content} ==');
  {
    const pieces = [];
    const askCF = makeAskCF(async () => sseStream([
      'data: {"choices":[{"delta":{"content":"你"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"好"}}]}\n\n',
      'data: [DONE]\n\n',
    ]));
    const full = await askCF('q', [], [], (p) => pieces.push(p));
    check('OpenAI 格式逐字收到', pieces.join('') === '你好', pieces);
    check('OpenAI 格式返回完整答案', full === '你好', full);
  }

  console.log('\n== ③ 推理思考链不外泄 ==');
  {
    const pieces = [];
    const askCF = makeAskCF(async () => sseStream([
      'data: {"choices":[{"delta":{"reasoning_content":"内部思考过程"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"正式回答"}}]}\n\n',
      'data: [DONE]\n\n',
    ]));
    const full = await askCF('q', [], [], (p) => pieces.push(p));
    check('reasoning_content 不进答案', full === '正式回答' && !full.includes('内部思考'), full);
    check('只回调正式内容', pieces.join('') === '正式回答', pieces);
  }

  console.log('\n== ④ 半行跨帧拼接 ==');
  {
    const askCF = makeAskCF(async () => sseStream([
      'data: {"res',           // 半行开头
      'ponse":"跨帧"}\n\ndata: {"response":"完成"}\n\n', // 补上并带第二帧
      'data: [DONE]\n\n',
    ]));
    const full = await askCF('q', [], [], () => {});
    check('跨帧半行正确拼接', full === '跨帧完成', full);
  }

  console.log('\n== ⑤ 老 Worker 降级（非 SSE → JSON answer）==');
  {
    const askCF = makeAskCF(async () => sseStream('', { contentType: 'application/json' }));
    // 用可返回 json() 的桩替换
    const jsonRes = {
      status: 200, ok: true,
      headers: { get: (k) => (k.toLowerCase() === 'content-type' ? 'application/json' : null) },
      json: async () => ({ answer: '老 Worker 回答', route: 'cf' }),
    };
    const ask2 = makeAskCF(async () => jsonRes);
    const full = await ask2('q', [], [], () => {});
    check('降级取 JSON answer', full === '老 Worker 回答', full);
  }

  console.log('\n== ⑥ 限流/上游错误温和提示 ==');
  {
    const err429 = {
      status: 429, ok: false,
      headers: { get: () => 'application/json' },
      text: async () => 'rate-limited',
    };
    const ask429 = makeAskCF(async () => err429);
    let msg = '';
    try { await ask429('q', [], [], () => {}); } catch (e) { msg = e.message; }
    check('429 → 温和限流文案、不露 rate-limited', /短时限流/.test(msg) && !/rate-limited/.test(msg), msg);
  }

  console.log('\n========== 结果：' + passed + ' 项通过，' + failed + ' 项失败 ==========');
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
