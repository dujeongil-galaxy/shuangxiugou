/* ==========================================================================
   ai-worker-aliyun/index.mjs —— 双休购「劳动法小助手」阿里云函数计算版
   --------------------------------------------------------------------------
   定位
   ----
   与 ai-worker/src/worker.js（Cloudflare Worker）接口、校验、限流口径对齐的
   **第二条线路**。前端 ai-chat.js 按形象分流：
     形象 A/B/C（索引 0-2）→ Cloudflare Worker
     形象 D/E/F（索引 3-5）→ 本函数（阿里云 FC），地址填 ai-config.js 的 endpointCN

   为什么要有第二条线路
   --------------------
   Cloudflare workers.dev 在境内直连不稳（部分网络需代理）。阿里云函数计算
   + 百炼（DashScope）是境内直连，国内用户走这条线路不用 VPN。

   接口（与 Cloudflare 版完全一致）
   --------------------------------
   请求 POST application/json：
     { "question": "1~500 字", "history": [{"role":"user|assistant","content":"≤200字"}], "route": "cn" }
   响应：
     200 { "answer": "…", "route": "cn" }
     400 { "error": "question-required-1-to-500-chars" | "invalid-json" }
     403 { "error": "origin-not-allowed", "origin": "…" }
     405 { "error": "method-not-allowed" }
     429 { "error": "rate-limited", "retryAfter": 3600 } | { "error": "daily-quota-exhausted" }
     502 { "error": "ai-upstream-error" | "empty-answer" }
     500 { "error": "missing-api-key" }

   安全口径（与 Cloudflare 版逐条对齐）
   ------------------------------------
   ① CORS 白名单：只放行本站 GitHub Pages + 本地验收 localhost
   ② 输入校验：question 1~500 字、非法 JSON 400
   ③ history 清洗：role 白名单、最多 8 条（4 轮）、单条截 200 字
   ④ 系统提示词锁定角色（与 Worker 同一套文案，含 route 如实说明条款）
   ⑤ max_tokens 限制输出
   ⑥ 每 IP 滑窗限流 20 次/小时（内存版，见下方「已知限制」）
   ⑦ API Key 只从环境变量读：DASHSCOPE_API_KEY，代码与仓库里绝不落明文

   已知限制（诚实说明，别当它能扛量）
   ----------------------------------
   FC 实例会被回收、且多实例内存不共享，内存限流只是「够用的粗限流」，
   与 Cloudflare 版同级，防单 IP 脚本刷而非精确配额。真要精确配额请接
   Redis / Tablestore，把 checkRate 换成外部计数即可（本文件已隔离成单函数）。

   部署步骤见同目录 README.md。
   ========================================================================== */

const ALLOWED_ORIGINS = [
  'http://localhost:18970', // 本地验收服务（与 Cloudflare 版一致）
];
const SITE_ORIGIN = 'https://dujeongil-galaxy.github.io';

const DASHSCOPE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
const DEFAULT_MODEL = 'qwen-plus'; // 可在环境变量 DASHSCOPE_MODEL 覆盖
const RATE_LIMIT = 20; // 次
const RATE_WINDOW_MS = 3600 * 1000; // 每小时

// 线路说明（与 ai-worker/src/worker.js 的 routeNotice 保持同一套措辞）
const ROUTE_NAME = {
  cf: 'cf（Cloudflare Workers，海外线路）',
  cn: 'cn（阿里云函数计算，境内直连线路）',
};
function routeNotice(route) {
  if (!route || !ROUTE_NAME[route]) return '';
  return '\n7. 本次请求的线路标识为 ' + ROUTE_NAME[route] +
    '。若用户问及线路、访问方式或网络需要（VPN 等），请如实说明本次由该线路服务；' +
    '不要声称自己走的是其他线路，也不要把线路标识当成用户提供的事实依据去影响法律结论。';
}

const SYSTEM_PROMPT = [
  '你是「双休购」网站的劳动法小助手。双休购是一个众包的企业双休评级站点，用公开证据链（司法文书、劳动监察通报、ESG 报告、招聘口径、员工反馈）评估企业休息制度。',
  '你的职责：',
  '1. 重点回答《中华人民共和国劳动法》《劳动合同法》相关问题：工时（每日不超 8 小时、平均每周不超 44 小时）、休息日（每周至少一日）、加班上限（每月 36 小时）与加班费（平时 150%、休息日 200%、法定节假日 300%）、年休假、试用期约定、解除劳动合同的经济补偿等。',
  '2. 回答本站双休评级的口径问题：真实双休率=每周能完整休满两天的员工占比；大小周=单双周休；评级只反映休息制度不构成对企业的法律定性；数据有异议可通过 GitHub Issues 申诉。',
  '3. 回答尽量简洁（300 字以内），先给结论再给依据条文；涉及具体条文时写明第几条。',
  '4. 用户问具体企业时，如实说明：你只知道「双休购」站内的评级口径，最新数据以站点为准，可建议他去站点搜索该品牌。',
  '5. 与劳动法、双休、工时、职场权益无关的问题，礼貌说明你只聊劳动法与双休话题。',
  '6. 你提供的是参考信息不是法律意见；个案涉及争议，建议咨询当地劳动监察部门（12333）或律师。',
].join('\n');

// ---------- 小工具 ----------
function jsonResponse(obj, status, origin) {
  return {
    statusCode: status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': origin || '',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    },
    body: JSON.stringify(obj),
  };
}

function header(event, name) {
  const h = event.headers || {};
  const lower = name.toLowerCase();
  for (const k of Object.keys(h)) {
    if (String(k).toLowerCase() === lower) return h[k];
  }
  return '';
}

function clientIp(event) {
  const xff = header(event, 'x-forwarded-for') || header(event, 'x-real-ip');
  if (xff) return String(xff).split(',')[0].trim();
  const ctx = event.requestContext || {};
  return (ctx.sourceIp || ctx.identity && ctx.identity.sourceIp) || 'unknown';
}

// 限流：内存滑窗（单函数隔离，方便日后换 Redis）
const rateBuckets = new Map();
function checkRate(ip) {
  const now = Date.now();
  const recent = (rateBuckets.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) return false;
  recent.push(now);
  rateBuckets.set(ip, recent);
  // 防 Map 无限膨胀
  if (rateBuckets.size > 5000) {
    for (const [k, v] of rateBuckets) {
      if (!v.some((t) => now - t < RATE_WINDOW_MS)) rateBuckets.delete(k);
    }
  }
  return true;
}

// ---------- 主入口 ----------
// 兼容 FC 3.0 HTTP 触发器（event 是 API 网关式对象）与 FC 2.0（event 为字符串/Buffer）
export async function handler(event, context) {
  let ev = event || {};
  if (typeof ev === 'string') { try { ev = JSON.parse(ev); } catch (e) { ev = {}; } }

  const method = (ev.httpMethod || ev.requestContext && ev.requestContext.httpMethod || 'POST').toUpperCase();
  const origin = header(ev, 'origin');
  const originAllowed = ALLOWED_ORIGINS.includes(origin) || origin.endsWith('.github.io') || origin === SITE_ORIGIN;
  const echoOrigin = originAllowed ? origin : '';

  if (method === 'OPTIONS') return jsonResponse({}, 204, echoOrigin);
  if (!originAllowed) return jsonResponse({ error: 'origin-not-allowed', origin: origin }, 403, echoOrigin);
  if (method !== 'POST') return jsonResponse({ error: 'method-not-allowed' }, 405, echoOrigin);

  // ---------- 输入校验 ----------
  let body = {};
  const raw = ev.body;
  try {
    if (typeof raw === 'string' && raw.trim()) {
      body = JSON.parse(ev.isBase64Encoded ? Buffer.from(raw, 'base64').toString('utf8') : raw);
    } else if (raw && typeof raw === 'object') {
      body = raw;
    } else {
      throw new Error('empty-body');
    }
  } catch (e) {
    return jsonResponse({ error: 'invalid-json' }, 400, echoOrigin);
  }

  const question = typeof body.question === 'string' ? body.question.trim() : '';
  if (!question || question.length > 500) {
    return jsonResponse({ error: 'question-required-1-to-500-chars' }, 400, echoOrigin);
  }

  let history = Array.isArray(body.history) ? body.history : [];
  history = history
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-8)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 200) }));

  // 线路标识：本函数天然是 cn；若前端误传 cf 也如实保留，只做说明用途
  const route = (body.route === 'cf' || body.route === 'cn') ? body.route : 'cn';

  // ---------- 限流 ----------
  if (!checkRate(clientIp(ev))) {
    return jsonResponse({ error: 'rate-limited', retryAfter: 3600 }, 429, echoOrigin);
  }

  // ---------- 密钥 ----------
  const apiKey = process.env.DASHSCOPE_API_KEY || '';
  if (!apiKey) return jsonResponse({ error: 'missing-api-key' }, 500, echoOrigin);
  const model = process.env.DASHSCOPE_MODEL || DEFAULT_MODEL;

  // ---------- 调百炼（OpenAI 兼容模式）----------
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT + routeNotice(route) },
    ...history,
    { role: 'user', content: question },
  ];

  try {
    const resp = await fetch(DASHSCOPE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
      },
      body: JSON.stringify({
        model: model,
        messages: messages,
        max_tokens: 2000,
        temperature: 0.3,
      }),
    });

    if (resp.status === 429 || resp.status === 403) {
      // 403：key 失效/欠费；429：限流或额度用尽——都归到配额口径，前端提示「稍后再试」
      return jsonResponse({ error: 'daily-quota-exhausted', upstreamStatus: resp.status }, 429, echoOrigin);
    }
    if (!resp.ok) {
      return jsonResponse({ error: 'ai-upstream-error', upstreamStatus: resp.status }, 502, echoOrigin);
    }

    const data = await resp.json();
    const answer = data && data.choices && data.choices[0] && data.choices[0].message
      ? (data.choices[0].message.content || '')
      : '';
    if (!answer) return jsonResponse({ error: 'empty-answer' }, 502, echoOrigin);

    return jsonResponse({ answer, route }, 200, echoOrigin);
  } catch (e) {
    const msg = String(e && e.message || e);
    if (/quota|limit|exceed|arrears/i.test(msg)) {
      return jsonResponse({ error: 'daily-quota-exhausted' }, 429, echoOrigin);
    }
    return jsonResponse({ error: 'ai-upstream-error' }, 502, echoOrigin);
  }
}

export default { handler };
