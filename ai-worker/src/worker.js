/* ==========================================================================
   ai-worker/src/worker.js —— 双休购「劳动法小助手」Cloudflare Worker
   --------------------------------------------------------------------------
   做什么
   ------
   品牌页右侧聊天挂件（ai-chat.js）的后端：接收用户问题，调 Workers AI
   的 GLM-4.7-flash 生成回答，重点回答劳动法、双休口径与简历撰写相关问题。

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
   ④ 系统提示词锁定角色：优先答劳动法/双休/简历，其他话题保持中立并避免无依据判断
   ⑤ max_tokens 限制输出（输出比输入贵 6.6 倍，输出是 neuron 大头）
   ⑥ 每 IP 内存限流（滑窗：登录 20 次/小时，未登录减半 10 次/小时）——
      免费层没 KV，够用的粗限流；quotaTier 是前端声明，不是鉴权凭据，
      伪造最多把额度从 10 抬到 20，恶意刷量仍由⑦的黑名单在边缘挡。
   ⑦ IP 黑名单（连接层 IP 精确匹配）——命中即在边缘挡掉，不调 AI、不烧额度

   跑法
   ----
   见 ai-worker/README.md（wrangler login → deploy，两分钟）。
   ========================================================================== */

/* ---------- IP 黑名单（2026-11-21 站长要求：真要动手可拦指定 IP）----------
   两种维护方式，改完都即时生效：
     ① 源码静态名单：把 IP 字符串加进下面的数组 → 需重新 deploy。
     ② 运行时名单：Worker secret BLOCKED_IPS（多个用英文逗号分隔）→ 免重新部署，
        用 `wrangler secret put BLOCKED_IPS` 改（见 README）。两者并集生效。
   只认连接层 IP（CF-Connecting-IP，前端伪造不了），精确匹配；命中返回 403，
   不消耗 neurons、不记 ai_call。边界：VPN/代理共用出口 IP 会连坐，用前先确认。 */
const BLOCKED_IPS = [
  // '1.2.3.4', // 示例：取消注释并换成要拦的 IP
];

// 每 IP 滑窗上限（2026-11-21 站长改版）：登录 20 次/小时，未登录一律减半 10 次。
const RATE_LIMIT_FULL = 20;
const RATE_LIMIT_HALF = 10;

/* ---------- Star 权益撤销记录（2026-11-21 站长定规）----------
   规则：靠 Star 领过额外权益的人，一旦撤掉 Star，这份权益永久作废；
   就算他再点回来也拿不到，服务端一律按「未 Star」回给前端。
    why：加密令牌只回答「此刻还 Star 吗」，答不了「他以前 Star 过又撤了」。
         GitHub 的 stargazers 记录带 starred_at，取消后重新点会换成新时间，
         所以把首次时间沉到 KV，之后对不上就判定为二次 Star，不必恰好撞见取消瞬间。
   两条留痕：
     star:first:<uid>   = 首次观察到的 starred_at（ISO 全串，含时分秒）
     star:revoked:<uid> = '1'，一旦观测到取消或二次 Star 就永久置位
   没绑 env.STAR_RECORD 时整段跳过，退回纯实时验签（取消即锁，再点回来会恢复）。
   uid 用 GitHub 数字 ID，不随用户改名漂移；前端拿不到也无法篡改 KV。 */
const STAR_FIRST_PREFIX = 'star:first:';
const STAR_REVOKED_PREFIX = 'star:revoked:';

// 记录一次首次 Star 时间（已存在则不覆盖，保持"首次"语义）；失败只记日志不打断主流程
async function rememberFirstStar(kv, subject, iso) {
  if (!kv || !subject || !iso) return;
  try {
    const key = STAR_FIRST_PREFIX + subject;
    if (!(await kv.get(key))) await kv.put(key, iso);
  } catch (e) {
    console.log('写首次 Star 记录失败:', e && e.message);
  }
}
// 判断是否已被永久撤销：KV 里带撤销标记，或当前 starred_at 与首次记录不一致。
// 两种入口都覆盖：① 取消当下被 check-star 撞见 → 写撤销标记；
//                ② 取消没被撞见、但再 Star 后时间变了 → 这里也能判出来。
async function starRightRevoked(kv, subject, currentIso, observedNotStarred) {
  if (!kv || !subject) return false;
  try {
    const revokedKey = STAR_REVOKED_PREFIX + subject;
    const firstKey = STAR_FIRST_PREFIX + subject;
    if (observedNotStarred) {
      // 只有此前确实领过（有首次记录）才留撤销痕迹，避免把从未 Star 的人误伤
      const first = await kv.get(firstKey);
      if (first) await kv.put(revokedKey, '1');
      return false; // 此刻本来就是未 Star，无需再改 hasStar
    }
    if (!currentIso) return false;
    const revoked = await kv.get(revokedKey);
    if (revoked === '1') return true;
    const first = await kv.get(firstKey);
    if (!first) {
      await kv.put(firstKey, currentIso); // 老访客：首次纳入记录
      return false;
    }
    if (first !== currentIso) {
      await kv.put(revokedKey, '1'); // 取消过又点回来：时间对不上，永久作废
      return true;
    }
    return false;
  } catch (e) {
    // KV 故障不能把合法用户锁在门外：安全降级为本次不判定撤销
    console.log('读取 Star 撤销记录失败:', e && e.message);
    return false;
  }
}

function isBlockedIp(ip, env) {
  if (!ip || ip === 'unknown') return false;
  if (BLOCKED_IPS.indexOf(ip) !== -1) return true;
  const secretList = env && env.BLOCKED_IPS ? String(env.BLOCKED_IPS).split(',') : [];
  return secretList.some((s) => s.trim() === ip);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // ---------- IP 黑名单：最前置拦截，早于 OAuth / CORS / 能力探测 / AI ----------
    // 放最前面是为了「真拦住」：命中后连 429 计数、ai_call 日志都不产生。
    const clientIp = request.headers.get('CF-Connecting-IP') || request.headers.get('x-forwarded-for') || '';
    if (isBlockedIp(clientIp, env)) {
      console.log(JSON.stringify({ event: 'ip_blocked', ip: clientIp, ts: new Date().toISOString() }));
      return json({ error: 'ip-blocked' }, 403, { 'Access-Control-Allow-Origin': request.headers.get('Origin') || '' });
    }

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

    // ---------- 能力探测（2026-11-21 图片上传）----------
    // 前端带图提问前先 GET 这个端点：新版 Worker 部署后返回 vision:true，
    // 未部署新版的线上实例返回 404/旧逻辑 → 前端诚实降级，不静默吞图。
    if (request.method === 'GET' && path === '/api/capabilities') {
      return json({
        vision: true,
        visitorIp: request.headers.get('CF-Connecting-IP')
          || request.headers.get('x-forwarded-for') || '未知',
        textModel: '@cf/zai-org/glm-4.7-flash',
        visionModel: '@cf/meta/llama-3.2-11b-vision-instruct',
        maxParts: 8,
        maxImageBase64: 7 * 1024 * 1024,
      }, 200, corsHeaders);
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
    // 纪律：route 字段**不可信**，只影响提示词里的一句「如实说明」，绝不参与鉴权、
    // 配额、模型选择——伪造它顶多让 AI 说错自己是哪条线路。
    const route = (body.route === 'cf' || body.route === 'cn') ? body.route : '';

    // 额度档位（2026-11-21）：前端按登录状态声明 full / half，服务端据此选上限。
    // 这是粗口径的额度提示，不是身份凭据：静态站没有服务端会话，无法验签登录态；
    // 伪造只能把 10 抬到 20，真正恶意刷量由 IP 黑名单与上游 neurons 日额度兜底。
    const quotaTier = body.quotaTier === 'full' ? 'full' : 'half';
    const rateLimit = quotaTier === 'full' ? RATE_LIMIT_FULL : RATE_LIMIT_HALF;

    // ---------- 每 IP 限流（内存滑窗：登录 20 / 未登录 10 次每小时） ----------
    // 注意：Worker 实例在边缘节点间不共享内存，这是「够用的粗限流」——
    // 防的是单 IP 脚本刷，不是精确配额。真要精确配额上 KV/Durable Object。
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const now = Date.now();
    if (!globalThis.__sxgRate) globalThis.__sxgRate = new Map();
    const bucket = globalThis.__sxgRate.get(ip) || [];
    const recent = bucket.filter((t) => now - t < 3600 * 1000);
    if (recent.length >= rateLimit) {
      // 滥用溯源（2026-11-21）：限流命中写结构化日志，Cloudflare 控制台 Workers Logs 可按 IP 查。
      // 只记 IP/档位/时间/计数，不记提问正文（避免把用户隐私写进日志）。
      console.log(JSON.stringify({ event: 'rate_limited', ip, tier: quotaTier, limit: rateLimit, hits: recent.length, ts: new Date().toISOString() }));
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
      '5. 用户请求写简历、改简历、求职信或润色工作经历时，正常提供帮助：梳理经历、按目标岗位突出相关经验、给出中英文表述与排版建议；信息不够就先追问。写简历只用用户明确给的信息，绝不虚构公司、职位、时间、学历或业绩数字。',
      '6. 简历中涉及劳动权益的部分（工作年限、离职原因、竞业限制、加班经历）可结合劳动法口径给建议，但不要把简历表述当成法律事实认定。',
      '7. 对于公共政策、社会议题或政府评价问题，不预设赞扬或批评任何政府或阵营；可以有依据地讨论中国政府及其政策，也允许提出批评，不因对象是政府而回避。区分可核实事实、观点与不确定信息，考虑相关的不同观点，不把未经证实的指控当事实，也不为了显得中立而制造虚假平衡。不要默认用户的判断正确；有事实错误或以偏概全时，尊重地指出。',
      '8. 回答日常人际或职场争议时，先回应用户描述的具体问题，不要未经依据揣测动机、训诫用户或把话题强行改成道德评判；不要把轻松玩笑自动定性为歧视、骚扰或违法。尊重他人不等于讨好或放弃边界；避免把个别经历概括为所有女性、男性或某个群体的共同特征。涉及法律时，只在适用规则明确时下结论，不确定管辖地或场所规则时说明需要核实。',
      '9. 你提供的是参考信息不是法律意见；个案涉及争议，建议咨询当地劳动监察部门（12333）或律师。',
      '10. 用户问到本站额度、附件上传或 Star 相关规则时如实说明：登录并 Star 仓库可解锁更多额度与附件上传权限，但这份权益只认第一次；一旦取消 Star，额外权益即永久失效，即使以后重新 Star 也会一直按未 Star 对待、不会恢复。只讲规则本身，不必列举具体次数。',
    ].join('\n') + routeNotice(route);

    // ---------- 多模态 parts（2026-11-21 站长要求支持图片/文档）----------
    // 前端在浏览器本地把 JPG/PNG/WEBP 与 PDF 扫描页解析成 data URL，DOCX/PDF
    // 文本层抽成 text；这里只收 OpenAI 兼容的 {type:'text'|'image_url'} 数组。
    // 安全：禁止 http(s) 外链（会被当成 SSRF 通道）、限制条数与 base64 体积。
    let parts = [];
    if (Array.isArray(body.parts)) {
      parts = body.parts
        .filter((p) => p && (p.type === 'text' || p.type === 'image_url'))
        .slice(0, 8)
        .map((p) => {
          if (p.type === 'text') {
            return { type: 'text', text: String(p.text || '').slice(0, 4000) };
          }
          const url = p.image_url && typeof p.image_url.url === 'string' ? p.image_url.url : '';
          // 只接受 data:image/(jpeg|png|webp);base64,...；其它一律丢弃（含 http 外链）
          if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(url) || url.length > 7 * 1024 * 1024) {
            return null;
          }
          return { type: 'image_url', image_url: { url } };
        })
        .filter(Boolean);
    }
    const hasImage = parts.some((p) => p.type === 'image_url');

    // ---------- 调 Workers AI（env.AI binding，零 key）----------
    // 纯文本仍走 glm-4.7-flash（免费层够用）；带图切 llama-3.2-11b-vision-instruct。
    const MODEL_TEXT = '@cf/zai-org/glm-4.7-flash';
    const MODEL_VISION = '@cf/meta/llama-3.2-11b-vision-instruct';
    const model = hasImage ? MODEL_VISION : MODEL_TEXT;
    const userContent = parts.length
      ? parts
      : [{ type: 'text', text: question }];
    const messages = [
      { role: 'system', content: systemPrompt },
      ...history,
      { role: 'user', content: userContent },
    ];

    try {
      const result = await env.AI.run(model, {
        messages,
        // 视觉模型输出单价约 6.1 万 neurons/M，是文本模型的 1.7 倍，带图时压低输出省额度
        max_tokens: hasImage ? 1200 : 2000,
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
      // 访问日志（2026-11-21）：成功调用记 IP / 线路 / 是否带图 / 提问字数，
      // 不记正文。控制台 Workers Logs 可按 event=ai_call 聚合，看出哪些 IP 高频调用。
      console.log(JSON.stringify({ event: 'ai_call', ip, route: route || 'cf',
        image: hasImage, qlen: question.length, neurons: (result && result.usage && result.usage.neurons) || null }));
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

/* ---------- Star 会话令牌（2026-11-21：实现实时验签，替代空壳 /api/check-star）----------
   为什么需要：本站是静态站，localStorage 里的 Star 状态是 OAuth 登录那一刻的快照，
   用户取消 Star 后不会自动失效，且懂技术的人可直接改 localStorage 伪造。
   做法：OAuth 回调拿到 access_token 后，用服务端 secret 把它加密成自包含令牌（AES-GCM，
   前端解不开、改不了），随重定向带回前端保存；之后 labor-ai 页打开时把令牌发给
   /api/check-star，服务端解密并用 token 实时问 GitHub「这人现在还 Star 吗」。
   令牌自带过期时间（30 天），到期后需重新登录；密钥只在 Worker secret 里，不入库。
   没有 env.STAR_SESSION_SECRET 时全部安全降级：OAuth 照常、只是不签发令牌，
   check-star 返回 session-unavailable，前端保留原有快照行为不受影响。 */
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 天

function b64urlEncode(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(str) {
  let s = String(str).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
// 用 secret 派生 256-bit AES key（先 SHA-256 摘要，再 importKey），
// 这样任意长度的 secret 都能用；直接把原始字符串当 key 会因长度不对报 Invalid key length。
async function sessionKey(secret) {
  const raw = new TextEncoder().encode(String(secret));
  const digest = await crypto.subtle.digest('SHA-256', raw);
  return await crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}
// 加密载荷 → base64url(iv + ciphertext)，前端无法读取/篡改
async function sealSession(payload, secret) {
  const key = await sessionKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(payload));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data));
  const merged = new Uint8Array(iv.length + ct.length);
  merged.set(iv, 0); merged.set(ct, iv.length);
  return b64urlEncode(merged);
}
// 解密 → 校验过期 → 返回载荷；任何异常返回 null（当作无效令牌）
async function openSession(token, secret) {
  try {
    const key = await sessionKey(secret);
    const merged = b64urlDecode(token);
    const iv = merged.slice(0, 12);
    const ct = merged.slice(12);
    const data = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    const payload = JSON.parse(new TextDecoder().decode(data));
    if (!payload.t || !payload.u || !payload.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch (e) {
    return null;
  }
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
  return '\n11. 本次请求的线路标识为 ' + ROUTE_NAME[route] +
    '。若用户问及线路、访问方式或网络需要（VPN 等），请如实说明本次由该线路服务；' +
    '不要声称自己走的是其他线路，也不要把线路标识当成用户提供的事实依据去影响法律结论。';
}

// ---------- GitHub OAuth 相关 ----------
const GITHUB_OWNER = 'dujeongil-galaxy';
const GITHUB_REPO = 'shuangxiugou';
// 2026-11-21 站长改：国内线路 Star 即开（不再攒天数）；只有附件功能需要满 3 天，
// 该门槛由前端按 star_days 判定，Worker 只负责如实回传 Star 状态与天数。
const ATTACH_MIN_DAYS = 3;

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
  let starredAtISO = ''; // 完整 ISO，KV 判定二次 Star 用（日期粒度会漏掉同日重 Star）
  let username = '';
  let uid = ''; // GitHub 数字 ID，不受改名影响，做 KV 主键

  // 先拿当前用户用户名（2026-11-21 实时验签需要：无 Star 用户也要签发令牌，
  // 这样他后来点了 Star，labor-ai 页复核时也能查出新状态）。失败不致命，降级为空。
  try {
    const userResp = await fetch('https://api.github.com/user', {
      headers: {
        'Authorization': `token ${accessToken}`,
        'User-Agent': 'shuangxiugou-ai-worker',
      },
    });
    if (userResp.ok) {
      const userData = await userResp.json();
      username = userData.login || '';
      uid = userData.id ? String(userData.id) : '';
    }
  } catch (e) {
    console.log('获取用户名失败:', e.message);
  }
  
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
        starredAtISO = me.starred_at; // 保留完整 ISO：同一天撤了再点，日期相同但时间不同
        const starredAt = new Date(me.starred_at);
        starredAtDate = starredAt.toISOString().split('T')[0]; // YYYY-MM-DD 格式
        const now = new Date();
        const diffMs = now - starredAt;
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        starDays = diffDays;
      }
    } catch (e) {
      console.log('获取 star 时间失败:', e.message);
      // 拿不到 Star 日期时不让用户卡住：按已满足附件 3 天门槛算
      starDays = ATTACH_MIN_DAYS;
      starredAtDate = '未知';
    }
  }

  // 2026-11-21 新口径：Star 不再决定文字问答，只决定附件上传；
  // 前端首页回调按 star_check 写登录/Star 状态，AI 页再据此判附件门禁。
  const meetsRequirement = hasStar;

  // 首次确认 Star 就把 starred_at 沉到 KV（仅首次，后续不覆盖）：
  // 这样「撤了再点回来」靠时间对不上就能识别，不必撞见他取消的那一刻。
  if (hasStar) await rememberFirstStar(env.STAR_RECORD, uid || username, starredAtISO);

  // 签发实时验签令牌：把 access_token 加密后随重定向带回前端保存。
  // 只有配了 STAR_SESSION_SECRET 且拿到 username 才签发；否则前端走降级路径。
  let satParam = '';
  if (env.STAR_SESSION_SECRET && username) {
    try {
      const sat = await sealSession(
        { u: username, uid: uid, t: accessToken, exp: Date.now() + SESSION_TTL_MS },
        env.STAR_SESSION_SECRET
      );
      satParam = '&sat=' + encodeURIComponent(sat);
    } catch (e) {
      console.log('签发 Star 会话令牌失败:', e.message);
    }
  }

  // 重定向回首页，带上结果（sat 为加密令牌，不含明文 token）
  const redirectUrl = `https://dujeongil-galaxy.github.io/shuangxiugou/?star_check=${meetsRequirement ? 'success' : 'failed'}&star_days=${starDays}&star_date=${encodeURIComponent(starredAtDate)}${satParam}`;
  return Response.redirect(redirectUrl, 302);
}

// 实时验签：解密前端带来的会话令牌，用它实时问 GitHub 当前是否仍 Star。
// 返回 {hasStar, starDays, username}；令牌缺失/无效/过期/未配密钥 → 明确状态让前端安全降级。
async function handleCheckStar(request, env, url) {
  const cors = {
    'Access-Control-Allow-Origin': request.headers.get('Origin') || '',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  // 预检单独短路：本路由在全局 CORS/OPTIONS 处理之前，必须自己回 204，
  // 否则 OPTIONS 会被当成带空 body 的查询返回 invalid-session（虽也能过预检，但语义错）。
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (!env.STAR_SESSION_SECRET) {
    return json({ hasStar: false, status: 'session-unavailable' }, 200, cors);
  }
  // 令牌从 POST JSON body 或 GET query 取（GET 便于手工排查，POST 为前端常规路径）
  let token = '';
  if (request.method === 'POST') {
    try { token = (await request.json()).sat || ''; } catch (e) { token = ''; }
  } else {
    token = url.searchParams.get('sat') || '';
  }
  const session = token ? await openSession(token, env.STAR_SESSION_SECRET) : null;
  if (!session) {
    return json({ hasStar: false, status: 'invalid-session' }, 200, cors);
  }

  // 拿令牌里的 token 实时查 GitHub：204 = 仍 Star，404 = 已取消，其它按未 Star 处理
  let hasStar = false;
  try {
    const r = await fetch(`https://api.github.com/user/starred/${GITHUB_OWNER}/${GITHUB_REPO}`, {
      method: 'GET',
      headers: {
        'Authorization': `token ${session.t}`,
        'User-Agent': 'shuangxiugou-ai-worker',
      },
    });
    hasStar = r.status === 204;
  } catch (e) {
    // 网络抖动时不能把已 Star 用户判成未 Star：返回 error 让前端保留旧快照
    return json({ hasStar: false, status: 'upstream-error', username: session.u }, 200, cors);
  }

  // 天数只用于展示；拿不到就沿用前端已有值（前端自行处理 0 的情况）
  let starDays = 0;
  let starredAtDate = '';
  let currentStarIso = ''; // 本次实际查到的 starred_at，跟首次记录比对用
  if (hasStar) {
    try {
      const userResp = await fetch('https://api.github.com/user', {
        headers: { 'Authorization': `token ${session.t}`, 'User-Agent': 'shuangxiugou-ai-worker' },
      });
      const userData = await userResp.json();
      const stargazersResp = await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/stargazers?per_page=100`, {
        headers: {
          'Authorization': `token ${session.t}`,
          'User-Agent': 'shuangxiugou-ai-worker',
          'Accept': 'application/vnd.github.star+json',
        },
      });
      const stargazers = await stargazersResp.json();
      const login = userData.login || session.u;
      const me = Array.isArray(stargazers) && stargazers.find(s => s.user && s.user.login === login);
      if (me && me.starred_at) {
        currentStarIso = me.starred_at;
        starredAtDate = me.starred_at.split('T')[0];
        starDays = Math.floor((Date.now() - new Date(me.starred_at)) / 86400000);
      }
    } catch (e) {
      console.log('实时验签取 Star 日期失败:', e.message);
    }
  }

  // 2026-11-21 站长定规：撤过 Star 的人即使再点回来，Star 权益也永久作废。
  // KV 未绑时 starRightRevoked 直接返回 false，行为退回纯实时验签，不阻塞现有部署。
  const subject = session.uid || session.u;
  let permanentRevoked = false;
  if (env.STAR_RECORD) {
    permanentRevoked = await starRightRevoked(env.STAR_RECORD, subject, currentStarIso, !hasStar);
    if (permanentRevoked) hasStar = false; // 强制压成未 Star：前端据此锁死附件
  }

  return json({
    hasStar,
    starDays,
    starredAtDate,
    username: session.u,
    status: hasStar ? 'starred' : 'not-starred',
    starRevoked: permanentRevoked, // 供前端/单测区分「没 Star」和「曾 Star 后撤销」
  }, 200, cors);
}
