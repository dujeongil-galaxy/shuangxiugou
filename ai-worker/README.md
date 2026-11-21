# ai-worker —— 双休购「劳动法小助手」Cloudflare Worker

> **零基础部署看这里**：[`DEPLOY-教程.md`](./DEPLOY-教程.md)——从注册
> Cloudflare 到推上线的保姆级五步教程（含常见报错速查）。
> 本文件是技术视角的说明，部署只需要看教程那份。

品牌页右侧聊天挂件（`../ai-chat.js`）的后端。**这一层存在的唯一理由：
静态站不能藏 API key**——Workers AI 的 `env.AI` binding 把模型调用绑定
在 Worker 环境里，key 永不出现在仓库、页面、请求头（详见
`src/worker.js` 头注释）。

## 部署（两分钟，免费）

前提：一个 Cloudflare 账号（免费）+ 本机 Node 18+。

```bash
cd ai-worker
npx wrangler login        # 浏览器授权一次
npx wrangler deploy       # 部署，输出 https://shuangxiugou-ai-worker.<你的子域>.workers.dev
```

`wrangler.json` 已配好 `ai` binding；Workers AI 免费层每日 1 万
neurons。**注意：GLM-4.7-flash 是推理模型（Reasoning），实际消耗比估算高**——
单次问答约 20~30 neurons（含 reasoning 思考过程），每日约可支撑 300~500 次问答。
超出当日限额接口会明确返回 `daily-quota-exhausted`（UTC 00:00 重置），前端有对应文案。

### 图片/文档上传（2026-11-21 新增，需重新部署才生效）

Worker 现在支持 `parts` 数组（OpenAI 兼容的 `text` / `image_url` data URL）：

- `POST` 带 `parts` 且含 `image_url` → 自动切 `@cf/meta/llama-3.2-11b-vision-instruct`
  （视觉模型），`max_tokens` 压到 1200 省 neuron；纯文本仍走 glm-4.7-flash / 2000。
- `GET /api/capabilities` → `{ vision: true, ... }`。前端 `labor-ai.html` 带图提问前会先探测：
  **未部署新版的线上实例没有这个端点，前端会明确提示「请切国内直连重试」**，不会静默吞图。
- 安全：只收 `data:image/(jpeg|png|webp);base64,`，禁 http(s) 外链（防 SSRF），
  最多 8 段、单图 base64 ≤ 7MB。

⚠️ **改了 Worker 源码必须 `npx wrangler deploy` 重新部署**，否则线上跑的还是旧版，
图片功能不会生效。部署后打开 `/api/capabilities` 看到 `vision:true` 即为成功。

### 滥用溯源：Workers Logs（2026-11-21 新增）

`wrangler.json` 已开 `observability`（100% 采样），Worker 对每次成功调用写一条
结构化日志 `event=ai_call`（含 `ip`/`route`/`image`/`qlen`/`neurons`，**不记提问正文**），
限流命中写 `event=rate_limited`（含 `ip`/`hits`）。Cloudflare 免费层每天 20 万条、
保留 3 天，可在控制台按 IP / 事件聚合查询——**这是查「哪个 IP 在滥用」的正解**。

注意区分两者能力：
- **WAF 速率限制规则走不通**：Worker 跑在 `workers.dev`、没接入自定义域名（无 zone），
  且免费版 WAF 规则连 Source IP 计数都不支持。别去控制台找 WAF。
- **限流本身仍是粗粒度**：每 IP 20 次/小时的内存滑窗，边缘实例间不共享、重启清零，
  防单 IP 脚本刷、防不住分布式；但日志能事后追溯，两者互补。

**查日志步骤**：Cloudflare Dashboard → Workers & Pages → `shuangxiugou-ai-worker`
→ **Observability / Logs** → 搜 `ai_call` 或 `rate_limited`，按 `ip` 聚合。
命令行实时看：`npx wrangler tail shuangxiugou-ai-worker`（开着的窗口里实时打印）。
日志里还有 Cloudflare 自动附带的 `cf-connecting-ip`、国家/城市/ASN/CF-Ray 等元数据。

### 坑：视觉模型首次使用必须先同意 Meta 协议（2026-11-21 实测）

视觉模型 `@cf/meta/llama-3.2-11b-vision-instruct` 受 Meta License 约束，
**新账号第一次调用前必须同意一次协议**，否则带图请求一律返回 `ai-upstream-error`
（纯文本走 GLM 不受影响，所以症状很容易被误判成"图片代码没部署好"）。

同意方式——用已登录的 Wrangler 凭据发一次 `prompt=agree` 请求（账号级一次性，之后永久可用）：

```bash
# 在 ai-worker 目录，拿本机 wrangler 的 OAuth token（需先 wrangler login）
# 或用 Cloudflare 控制台 Workers AI → 该模型页的 "Agree" 按钮，二选一
curl https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/ai/run/@cf/meta/llama-3.2-11b-vision-instruct \
  -H "Authorization: Bearer $TOKEN" -d '{"prompt":"agree"}'
```

**注意**：同意请求本身会返回 HTTP 403，但错误内容是
`Model Agreement: Thank you for agreeing to this model's terms. You may now use the model.`
——这是 Cloudflare 的正常行为，**代表已同意成功**，不是失败。
之后带图请求应立即返回 200。若换账号部署，这一步要重做。

## 部署后接通前端（一步）

部署拿到 Worker URL 后，改仓库根目录 `ai-config.js`：

```js
window.SXG_AI_CONFIG = { endpoint: 'https://shuangxiugou-ai-worker.xxx.workers.dev' };
```

**未配置 endpoint 时前端挂件自动不显示**（优雅降级）——所以可以先推
前端代码、再慢慢部署 Worker，站点不会出半截 UI。

## 安全清单（都在 Worker 层做，前端不可信）

| 层 | 措施 |
|---|---|
| CORS | 白名单只放行本站 GitHub Pages 域名 + 本地验收端口 |
| 输入 | question 1~500 字；history 最多 8 条、每条截 200 字、role 白名单；parts 最多 8 段、禁 http 外链、单图 base64 ≤ 7MB |
| 限流 | 每 IP 滑窗 20 次/小时（内存级，防脚本刷；精确配额需 KV，免费层够用） |
| 输出 | 纯文本 max_tokens 2000（GLM-4.7-flash 推理需留余量）；带图 1200（视觉模型单价约 1.7 倍） |
| 角色 | 系统提示词锁定劳动法/双休口径，拒绝无关话题，声明非法律意见 |

## 本地试跑

```bash
cd ai-worker
npx wrangler dev          # 起在 http://localhost:8787
curl -X POST http://localhost:8787 -H "Origin: http://localhost:18970" \
  -H "Content-Type: application/json" \
  -d '{"question":"加班费怎么算"}'
```

注意：`wrangler dev` 也会消耗账号的每日 neurons（哪怕本地测试）。

## 已知边界（诚实口径）

- 内存限流在边缘节点间不共享：是「防单 IP 脚本刷」的粗限流，不是精确配额；
  但每次调用和限流命中都会写 Workers Logs（见上「滥用溯源」），可事后按 IP 追溯。
- Worker 是无状态的：对话历史存在浏览器端（前端 localStorage 不存，仅当前会话内存），Worker 不记任何用户数据。
- AI 回答是参考信息不是法律意见——系统提示词里已声明，前端挂件里也有同款文案。

## 部署踩坑记录（GLM-4.7-flash 专属）

> 2026-11-07 首次部署实测踩过的两个坑，后来者不用再踩一遍。

### 坑 1：返回格式是 OpenAI 兼容，不是旧的 `result.response`

GLM 系列在 Cloudflare Workers AI 上用的是 **OpenAI Chat Completions 格式**，返回结构是：

```json
{
  "choices": [{
    "message": {
      "role": "assistant",
      "content": "正式回答内容",
      "reasoning": "思考过程（推理模型专属）"
    },
    "finish_reason": "stop"
  }],
  "usage": { "neurons": 23.6 }
}
```

**错误写法**（旧版 Llama 模型的格式，对 GLM 不生效）：
```js
const answer = result.response;  // GLM 里这个字段是 undefined
```

**正确写法**：
```js
let answer = result?.choices?.[0]?.message?.content || '';
```

### 坑 2：max_tokens 太小会导致 content 为 null（全被 reasoning 吃完）

GLM-4.7-flash 是**推理模型（Reasoning Model）**，生成时会先输出一大段思考过程（`message.reasoning`），再输出正式回答（`message.content`）。

如果 `max_tokens` 设太小（比如 600），思考过程就把 token 额度用完了，`finish_reason` 会是 `"length"`，此时 `content` 还是 `null`——你拿到的是空回答。

**解法**：把 `max_tokens` 调到至少 2000，给推理留够空间。虽然消耗 neurons 多一点，但能正常出结果。

### 坑 3：国内联通/移动手机网络访问不到 workers.dev 域名

`xxx.workers.dev` 这个默认域名在国内**电信宽带/Wi-Fi 下正常，但联通/移动的 5G 手机网络下经常连不上**——不是代码问题，是运营商线路对 workers.dev 域名的连通性问题。

**现象**：
- 电脑上（电信宽带）正常对话
- 手机上（联通 5G）报「网络异常：连不上 AI 服务」
- 手机开 VPN 后恢复正常

**前端应对**：错误提示里明确告知「由 Cloudflare 提供，国内部分运营商手机网络可能无法直接访问，请切换网络或开 VPN」。

**彻底解法**：给 Worker 绑定自定义域名（不用 workers.dev 默认域名），只要域名是国内可正常访问的就行。需要你有一个域名并接入 Cloudflare。

### 快速排障：直接 curl 看原始返回

部署后如果前端报「服务暂时不可用」，先直接 curl Worker 看原始错误：

```bash
curl -X POST https://your-worker.workers.dev \
  -H "Origin: https://your-github-pages-domain.github.io" \
  -H "Content-Type: application/json" \
  -d '{"question":"test"}'
```

- `origin-not-allowed` → CORS 白名单没加你的站点域名
- `empty-answer` + raw 里有 `reasoning` → max_tokens 太小，调大
- `daily-quota-exhausted` → 当日 neurons 用完了，等 UTC 0 点重置
- `ai-upstream-error` → 两种可能：① 纯文本也失败时多为 Workers AI 临时故障，等几分钟重试；
  ② **仅带图失败时，多半是 Meta 视觉模型协议未同意**——见上一节「坑：视觉模型首次使用必须先同意 Meta 协议」，
  发一次 `prompt=agree` 即可（这是 2026-11-21 实测到的真实根因，不是"临时故障"）
- 前端报「连不上」但 curl 正常 → 手机运营商网络访问不到 workers.dev，见坑 3
