/* ==========================================================================
   ai-worker/src/worker.js —— 双休购「劳动法小助手」Cloudflare Worker
   --------------------------------------------------------------------------
   做什么
   ------
   品牌页右侧聊天挂件（ai-chat.js）的后端：接收用户问题，调 Workers AI
   的 GLM-4.7-flash 生成回答，重点回答劳动法与本站双休口径相关问题。

   为什么必须有这一层（而不是前端直调大模型 API）
   ------------------------------------------------
   本站是 GitHub Pages 纯静态站。静态站的死结：API key 写进前端代码
   = 写进公开仓库 = 任何人 Network 面板一抄就能刷爆额度。
   Cloudflare Worker 的 env.AI binding 不经过任何 key——模型调用
   绑定在 Worker 环境里，前端只 fetch 本 Worker 的 URL，key 永不
   出现在仓库、页面、请求头。免费层每日 1 万 neurons（GLM-4.7-flash
   约 340 次标准对话）够本站用量。

   安全设计（全部在此层做，前端不可信）
   ------------------------------------
   ① CORS 白名单：只放行本站 GitHub Pages 域名（+ localhost 本地验收）
   ② 输入校验：question 长度 1~500 字，非字符串直接 400
   ③ 上下文截断：历史消息最多带 4 轮，单条 200 字，防 prompt 注入拉爆 token
   ④ 系统提示词锁定角色：只答劳动法/双休/本站数据口径，拒绝无关话题
   ⑤ max_tokens 限制输出（输出比输入贵 6.6 倍，输出是 neuron 大头）
   ⑥ 每 IP 内存限流（滑窗 20 次/小时）——免费层没 KV，够用的粗限流

   跑法
   ----
   见 ai-worker/README.md（wrangler login → deploy，两分钟）。
   ========================================================================== */

export default {
  async fetch(request, env) {
    // ---------- CORS 预检 ----------
    const ALLOWED_ORIGINS = [
      'https://dujeongil-galaxy.github.io',
      'http://localhost:18970', // 本地验收服务（ai-chat 测试用）
    ];
    const origin = request.headers.get('Origin') || '';
    const corsHeaders = {
      'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : '',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }
    // 非白名单来源：连 POST 都不处理（不消耗 neurons）
    if (!ALLOWED_ORIGINS.includes(origin)) {
      return json({ error: 'origin-not-allowed' }, 403, corsHeaders);
    }

    if (request.method !== 'POST') {
      return json({ error: 'method-not-allowed' }, 405, corsHeaders);
    }

    // ---------- 输入校验 ----------
    let body;
    try {
      body = await request.json();
    } catch (e) {
      return json({ error: 'invalid-json' }, 400, corsHeaders);
    }

    const question = typeof body.question === 'string' ? body.question.trim() : '';
    if (!question || question.length > 500) {
      return json({ error: 'question-required-1-to-500-chars' }, 400, corsHeaders);
    }

    // 历史消息（可选）：最多 4 轮，每条截 200 字，role 白名单
    let history = Array.isArray(body.history) ? body.history : [];
    history = history
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
      .slice(-8) // 4 轮 = 8 条
      .map((m) => ({ role: m.role, content: m.content.slice(0, 200) }));

    // ---------- 每 IP 限流（内存滑窗，20 次/小时） ----------
    // 注意：Worker 实例在边缘节点间不共享内存，这是「够用的粗限流」——
    // 防的是单 IP 脚本刷，不是精确配额。真要精确配额上 KV/Durable Object。
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const now = Date.now();
    if (!globalThis.__sxgRate) globalThis.__sxgRate = new Map();
    const bucket = globalThis.__sxgRate.get(ip) || [];
    const recent = bucket.filter((t) => now - t < 3600 * 1000);
    if (recent.length >= 20) {
      return json({ error: 'rate-limited', retryAfter: 3600 }, 429, corsHeaders);
    }
    recent.push(now);
    globalThis.__sxgRate.set(ip, recent);
    // 顺手清理过期条目，防 Map 无限膨胀
    if (globalThis.__sxgRate.size > 5000) {
      for (const [k, v] of globalThis.__sxgRate) {
        if (!v.some((t) => now - t < 3600 * 1000)) globalThis.__sxgRate.delete(k);
      }
    }

    // ---------- 系统提示词（角色锁定）----------
    // 本站口径：数据均附证据链、不构成法律定性、申诉走 GitHub Issues。
    // AI 定位：劳动法与双休咨询的「参考信息提供者」，不是律师。
    const systemPrompt = [
      '你是「双休购」网站的劳动法小助手。双休购是一个众包的企业双休评级站点，用公开证据链（司法文书、劳动监察通报、ESG 报告、招聘口径、员工反馈）评估企业休息制度。',
      '你的职责：',
      '1. 重点回答《中华人民共和国劳动法》《劳动合同法》相关问题：工时（每日不超 8 小时、平均每周不超 44 小时）、休息日（每周至少一日）、加班上限（每月 36 小时）与加班费（平时 150%、休息日 200%、法定节假日 300%）、年休假、试用期约定、解除劳动合同的经济补偿等。',
      '2. 回答本站双休评级的口径问题：真实双休率=每周能完整休满两天的员工占比；大小周=单双周休；评级只反映休息制度不构成对企业的法律定性；数据有异议可通过 GitHub Issues 申诉。',
      '3. 回答尽量简洁（300 字以内），先给结论再给依据条文；涉及具体条文时写明第几条。',
      '4. 用户问具体企业时，如实说明：你只知道「双休购」站内的评级口径，最新数据以站点为准，可建议他去站点搜索该品牌。',
      '5. 与劳动法、双休、工时、职场权益无关的问题，礼貌说明你只聊劳动法与双休话题。',
      '6. 你提供的是参考信息不是法律意见；个案涉及争议，建议咨询当地劳动监察部门（12333）或律师。',
    ].join('\n');

    // ---------- 调 Workers AI（env.AI binding，零 key）----------
    const messages = [{ role: 'system', content: systemPrompt }, ...history, { role: 'user', content: question }];

    try {
      const result = await env.AI.run('@cf/zai-org/glm-4.7-flash', {
        messages,
        max_tokens: 600, // 输出是 neuron 大头（约为输入单价 6.6 倍），600 字够答一条劳动法问题
      });

      const answer = result && result.response ? result.response : '';
      if (!answer) {
        return json({ error: 'empty-answer' }, 502, corsHeaders);
      }
      return json({ answer }, 200, corsHeaders);
    } catch (e) {
      // 常见故障：当日 neurons 用尽（免费层 10k）→ 明确告知重置时间
      const msg = String(e && e.message || e);
      if (/neuron|quota|limit|exceed/i.test(msg)) {
        return json({ error: 'daily-quota-exhausted', resetAtUTC: '00:00 UTC' }, 429, corsHeaders);
      }
      return json({ error: 'ai-upstream-error' }, 502, corsHeaders);
    }
  },
};

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors },
  });
}
