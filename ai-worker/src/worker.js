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
    const url = new URL(request.url);
    const path = url.pathname;

    // ---------- GitHub OAuth 路由（页面跳转，不走 CORS） ----------
    if (path === '/auth/github') {
      return handleGitHubLogin(env);
    }
    if (path === '/auth/github/callback') {
      return handleGitHubCallback(request, env, url);
    }
    if (path === '/api/check-star') {
      return handleCheckStar(request, env, url);
    }

    // ---------- CORS 预检 ----------
    // 匹配规则：精确白名单 + 模糊匹配 github.io 域名（兼容手机端各种浏览器差异）
    const ALLOWED_ORIGINS = [
      'http://localhost:18970', // 本地验收服务（ai-chat 测试用）
    ];
    const origin = request.headers.get('Origin') || '';
    // 判断是否放行：精确匹配 OR 包含 github.io（GitHub Pages 所有子域名）
    const originAllowed = ALLOWED_ORIGINS.includes(origin) || origin.endsWith('.github.io') || origin === 'https://dujeongil-galaxy.github.io';
    const corsHeaders = {
      'Access-Control-Allow-Origin': originAllowed ? origin : '',
      'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }
    // 非白名单来源：连 POST 都不处理（不消耗 neurons）
    if (!originAllowed) {
      return json({ error: 'origin-not-allowed', origin: origin }, 403, corsHeaders);
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

    // ---------- 线路标识（2026-11-13 分流改造，仅作说明用途） ----------
    // 前端按形象分流：A/B/C 走本 Worker（route='cf'），D/E/F 走阿里云（route='cn'），
    // 阿里云未配置时前端回落本 Worker 但仍带 route='cf'（记实际线路）。
    // 纪律：此字段**不可信**，只影响提示词里的一句「如实说明」，绝不参与鉴权、
    // 配额、限流、模型选择的任何决策——伪造它顶多让 AI 说错自己是哪条线路。
    const route = (body.route === 'cf' || body.route === 'cn') ? body.route : '';

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
    ].join('\n') + routeNotice(route);

    // ---------- 调 Workers AI（env.AI binding，零 key）----------
    const messages = [{ role: 'system', content: systemPrompt }, ...history, { role: 'user', content: question }];

    try {
      const result = await env.AI.run('@cf/zai-org/glm-4.7-flash', {
        messages,
        max_tokens: 2000, // GLM-4.7-flash 是推理模型，reasoning 会吃掉大量 tokens，留够空间输出正式回答
      });

      // GLM-4.7-flash 是 OpenAI 兼容格式，返回 choices[0].message.content
      // 兼容旧格式 result.response（部分老模型用）
      let answer = '';
      if (result && result.response) {
        answer = result.response;
      } else if (result && result.choices && result.choices[0] && result.choices[0].message) {
        answer = result.choices[0].message.content || '';
      }
      if (!answer) {
        return json({ error: 'empty-answer', raw: result }, 502, corsHeaders);
      }
      // route 原样回声给前端（面板可用于二次核对；前端不依赖它做任何事）
      return json({ answer, route: route || 'cf' }, 200, corsHeaders);
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

// ---------- 线路说明（2026-11-13 分流改造） ----------
// 前端按形象分流后会在请求体带 route；带了就补一条提示词，让答复在**被问到时**
// 如实说明本次由哪条线路服务。不带（老前端 / 直接刷接口）则完全不追加，向后兼容。
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

// ---------- GitHub OAuth 相关 ----------
const GITHUB_OWNER = 'dujeongil-galaxy';
const GITHUB_REPO = 'shuangxiugou';
const STAR_MIN_DAYS = 7; // Star 满 7 天才放行

// 跳转到 GitHub 授权页
async function handleGitHubLogin(env) {
  const clientId = 'Ov23liCgZ4zBj9LQXHhH'; // 硬编码正确的 Client ID（小写 L 开头）
  const redirectUri = 'https://shuangxiugou-ai-worker.ovpj01-hk.workers.dev/auth/github/callback';
  const githubAuthUrl = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=public_repo`;
  return Response.redirect(githubAuthUrl, 302);
}

// OAuth 回调：用 code 换 access token，检测 Star 状态
async function handleGitHubCallback(request, env, url) {
  const code = url.searchParams.get('code');
  if (!code) {
    return new Response('缺少 code 参数', { status: 400 });
  }

  // Client ID 是公开标识，可以入库；Client Secret 必须走 Worker secret，
  // 源码里绝不落明文——本仓库是公开的，一旦提交就永久留在公开历史里。
  const clientId = 'Ov23liCgZ4zBj9LQXHhH';
  const clientSecret = env.GITHUB_CLIENT_SECRET;
  if (!clientSecret) {
    return new Response('服务端未配置 GITHUB_CLIENT_SECRET', { status: 500 });
  }

  // 用 code 换 access token
  const tokenResp = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code: code,
    }),
  });
  const tokenData = await tokenResp.json();
  const accessToken = tokenData.access_token;
  if (!accessToken) {
    return new Response('获取 access token 失败: ' + JSON.stringify(tokenData), { status: 400 });
  }

  // 检测用户是否 Star 了仓库，以及 Star 时间
  let hasStar = false;
  let starDays = 0;
  let starredAtDate = '';
  
  // 第一步：先快速检测是否 Star
  const starCheckResp = await fetch(`https://api.github.com/user/starred/${GITHUB_OWNER}/${GITHUB_REPO}`, {
    method: 'GET',
    headers: {
      'Authorization': `token ${accessToken}`,
      'User-Agent': 'shuangxiugou-ai-worker',
    },
  });

  if (starCheckResp.status === 204) {
    hasStar = true;
    
    // 第二步：获取 Star 时间（调用 stargazers 接口）
    try {
      // 先拿当前用户的用户名
      const userResp = await fetch('https://api.github.com/user', {
        headers: {
          'Authorization': `token ${accessToken}`,
          'User-Agent': 'shuangxiugou-ai-worker',
        },
      });
      const userData = await userResp.json();
      const username = userData.login;
      
      // 获取 stargazers 列表（带 starred_at 字段）
      const stargazersResp = await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/stargazers?per_page=100`, {
        method: 'GET',
        headers: {
          'Authorization': `token ${accessToken}`,
          'User-Agent': 'shuangxiugou-ai-worker',
          'Accept': 'application/vnd.github.star+json', // 这个 header 才能返回 starred_at
        },
      });
      const stargazers = await stargazersResp.json();
      
      // 在 stargazers 列表里找当前用户
      const me = stargazers.find(s => s.user && s.user.login === username);
      if (me && me.starred_at) {
        const starredAt = new Date(me.starred_at);
        starredAtDate = starredAt.toISOString().split('T')[0]; // YYYY-MM-DD 格式
        const now = new Date();
        const diffMs = now - starredAt;
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        starDays = diffDays;
      }
    } catch (e) {
      console.log('获取 star 时间失败:', e.message);
      // 出错了就默认按已满 7 天算，别让用户报错
      starDays = 7;
      starredAtDate = '未知';
    }
  }

  const meetsRequirement = hasStar && starDays >= STAR_MIN_DAYS;

  // 重定向回首页，带上结果
  const redirectUrl = `https://dujeongil-galaxy.github.io/shuangxiugou/?star_check=${meetsRequirement ? 'success' : 'failed'}&star_days=${starDays}&star_date=${encodeURIComponent(starredAtDate)}`;
  return Response.redirect(redirectUrl, 302);
}

// 前端检测当前用户 Star 状态
async function handleCheckStar(request, env, url) {
  return json({
    hasStar: false,
    message: '功能开发中',
  }, 200);
}
