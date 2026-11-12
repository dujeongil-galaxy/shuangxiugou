# 阿里云函数计算线路（ai-worker-aliyun）

「劳动法小助手」的**第二条线路**。Cloudflare Worker 那条不变，这个目录是阿里云侧的等价实现，
给境内直连用户用（workers.dev 在国内部分网络需要代理，阿里云函数计算 + 百炼是直连）。

## 分流规则（谁走哪条）

| 形象 | 索引 | 线路 | 落点 |
| --- | --- | --- | --- |
| A / B / C | 0 / 1 / 2 | `cf` | `ai-config.js` 的 `endpoint`（Cloudflare Worker） |
| D / E / F | 3 / 4 / 5 | `cn` | `ai-config.js` 的 `endpointCN`（本目录部署出的地址） |

- `endpointCN` 留空 → D/E/F 自动**回落** Cloudflare，面板线路条会写明「已回落」并在对话里提示一句（不静默）。
- 挂件面板头部始终显示当前线路，切换形象后同步更新。
- 请求体带 `route: 'cf' | 'cn'`，服务端只用它让 AI 在**被问到时**如实说明本次由哪条线路服务，不参与鉴权/配额/模型选择（前端字段不可信）。
- 两条线路的网络异常文案分开写：阿里云线路失败**不会**再提示「需要开启 VPN」。

## 接口契约（与 Cloudflare 版逐字对齐）

请求 `POST`，`Content-Type: application/json`：

```json
{
  "question": "1~500 字的提问",
  "history": [{ "role": "user", "content": "≤200 字" }],
  "route": "cn"
}
```

响应：

| 状态 | body | 含义 |
| --- | --- | --- |
| 200 | `{ "answer": "…", "route": "cn" }` | 正常 |
| 400 | `{ "error": "question-required-1-to-500-chars" }` / `{ "error": "invalid-json" }` | 入参不合法 |
| 403 | `{ "error": "origin-not-allowed" }` | 来源不在白名单 |
| 405 | `{ "error": "method-not-allowed" }` | 非 POST |
| 429 | `{ "error": "rate-limited", "retryAfter": 3600 }` / `{ "error": "daily-quota-exhausted" }` | 限流 / 额度 |
| 500 | `{ "error": "missing-api-key" }` | 环境变量没配 |
| 502 | `{ "error": "ai-upstream-error" }` / `{ "error": "empty-answer" }` | 上游异常 |

安全口径与 Worker 版一致：CORS 白名单只放 github.io 子域 + `localhost:18970`；`question` 1~500 字；
`history` 只收 user/assistant、最多 8 条、单条截 200 字；每 IP 滑窗 20 次/小时；`max_tokens: 2000`。

> 已知限制（说实话）：FC 实例会被回收、多实例内存不共享，内存限流只是「够用的粗限流」，
> 与 Worker 版同级，防单 IP 脚本刷而非精确配额。要精确配额把 `checkRate()` 换成 Redis / Tablestore 计数即可。

---

## 部署步骤

### 第 1 步：开通百炼，拿 API Key

1. 打开 [阿里云百炼控制台](https://bailian.console.aliyun.com/)（需实名认证的阿里云账号）。
2. 首次进入会提示开通「百炼大模型服务」，按引导开通（有免费额度，通常新用户 100 万 tokens 级）。
3. 左侧「API-KEY 管理」→「创建我的 API-KEY」→ 复制 `sk-...` 开头的字符串。
   **这个 Key 只显示一次，务必立刻存好；它绝不写进仓库**（本仓库是公开的）。
4. 记下要用的模型名：默认 `qwen-plus`，想更省可换 `qwen-flash` / `qwen-turbo`。

### 第 2 步：创建函数（路线 A：命令行，推荐）

```bash
npm i -g @serverless-devs/s      # 装 Serverless Devs
s config add                     # 选 alibaba，填 AK/SK（阿里云控制台→右上头像→AccessKey 管理）
export DASHSCOPE_API_KEY=sk-你的key    # Windows PowerShell: $env:DASHSCOPE_API_KEY="sk-你的key"
cd ai-worker-aliyun
s deploy                         # 部署，输出里会给出 HTTP 触发器的公网地址
```

`s.yaml` 已把 `nodejs20` 运行时、`index.handler`、256MB 内存、60s 超时、
`instanceConcurrency: 10`、匿名 HTTP 触发器（POST/OPTIONS）都写好了，一般不用改。

### 第 2 步（备选）：创建函数（路线 B：控制台手点）

1. 进 [函数计算 FC 控制台](https://fc.console.aliyun.com/) → 「函数」→「创建函数」→ 选「Web 函数 / 使用示例创建」里的 **Node.js 20**。
2. 函数名 `shuangxiugou-ai-cn`，地域建议**华东1（杭州）**或离你用户近的。
3. 代码：把本目录的 `index.mjs` 内容贴进在线编辑器（或上传目录），**入口**填 `index.handler`。
4. 规格：内存 256MB、超时 60 秒、单实例并发 10（够小站用，也省冷启动）。
5. 触发器：创建 **HTTP 触发器**，请求方法勾 `POST` 和 `OPTIONS`，认证方式选**匿名（无需签名）**。
   安全由代码里的 CORS 白名单 + 限流兜着，不要开签名认证（开了浏览器直接调会 403）。

### 第 3 步：配环境变量

函数 → 「配置」→「环境变量」新增：

| 变量名 | 值 | 说明 |
| --- | --- | --- |
| `DASHSCOPE_API_KEY` | `sk-...` | 必填，第 1 步拿的 Key |
| `DASHSCOPE_MODEL` | `qwen-plus` | 可选，不填默认 `qwen-plus` |

保存后**重新部署/发布一次版本**环境变量才生效（控制台改完点「部署」，`s deploy` 的话再跑一次即可）。

### 第 4 步：拿到公网地址（自定义域名可选）

- 默认地址形如：`https://shuangxiugou-ai-cn-xxxxxxxx.cn-hangzhou.fcapp.run`
  （HTTP 触发器详情页「公网访问地址」可复制）。
- 想用自己的域名：触发器 →「自定义域名」→ 绑一个已备案域名（国内节点必须备案），
  配好路径 `/` 转发到本函数即可。**不绑也能用**，默认 `fcapp.run` 地址足够。
- 自测一发（把地址换成你的）：

```bash
curl -X POST "https://shuangxiugou-ai-cn-xxx.cn-hangzhou.fcapp.run" \
  -H "Content-Type: application/json" \
  -H "Origin: https://dujeongil-galaxy.github.io" \
  -d '{"question":"加班费怎么算","route":"cn"}'
```

返回 `{"answer":"...","route":"cn"}` 就通了。返回 403 说明 `Origin` 头没带或不在白名单。

### 第 5 步：把地址填进前端

打开根目录 `ai-config.js`，把地址填进 `endpointCN`（注意末尾不要多空格）：

```js
window.SXG_AI_CONFIG = {
  endpoint: 'https://shuangxiugou-ai-worker.ovpj01-hk.workers.dev', // 线路 cf
  endpointCN: 'https://shuangxiugou-ai-cn-xxx.cn-hangzhou.fcapp.run', // 线路 cn
};
```

改完按仓库纪律把 `index.html` 里 `ai-config.js?v=` 的版本号 +1（否则线上一堆缓存读旧值），
再跑 `node scripts/verify.mjs` 与 `node scripts/test-ai-route.cjs`，全绿再提交。

### 回滚（应急）

把 `endpointCN` 改回 `''` 并 bump `?v`，D/E/F 立刻回落 Cloudflare，功能不中断；
阿里云函数可以在控制台直接「停用」或删掉，不影响任何现有功能。

---

## 本地自测（不联网、不花钱）

```bash
node scripts/test-ai-worker-aliyun.cjs
```

桩掉 `fetch` 与 `process.env.DASHSCOPE_API_KEY`，覆盖：CORS 白名单、OPTIONS 预检、
输入校验、history 清洗、限流 429、缺 Key 500、上游 429/502、`route` 提示词与回声、
以及**输出契约与 Cloudflare 版一致**（同样的 error 字符串，前端才能一套逻辑吃两条线路）。

## 费用与配额

- 函数计算：每月免费额度含 100 万 GB·秒 + 200 万次调用，本站量根本跑不完。
- 百炼：按 token 计费，`qwen-plus` 有免费额度；额度用尽时上游会回 429，前端提示「稍后再试」。
- 两处都是「免费额度内基本零成本」，与现有的 Cloudflare 免费层定位一致。
