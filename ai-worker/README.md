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
| 输入 | question 1~500 字；history 最多 8 条、每条截 200 字、role 白名单 |
| 限流 | 每 IP 滑窗 20 次/小时（内存级，防脚本刷；精确配额需 KV，免费层够用） |
| 输出 | max_tokens 2000（GLM-4.7-flash 是推理模型，reasoning 会吃掉大量 tokens，必须留够空间输出正式回答） |
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

- 内存限流在边缘节点间不共享：是「防单 IP 脚本刷」的粗限流，不是精确配额。
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
- `ai-upstream-error` → Cloudflare Workers AI 临时故障，等几分钟重试
