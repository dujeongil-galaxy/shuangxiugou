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
neurons（GLM-4.7-flash 约 340 次标准问答），超出当日限额接口会明确
返回 `daily-quota-exhausted`（UTC 00:00 重置），前端有对应文案。

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
| 输出 | max_tokens 600（输出单价是输入的 6.6 倍，掐输出省 neurons） |
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
