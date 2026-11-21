# AI 劳动法小助手 · 部署教程（写给没部署过 Cloudflare 的你）

> 目标：10 分钟内让网站右下角的 🤖 机器人真的能回答问题。
> 全程免费（Workers AI 每天送 1 万 neurons ≈ 340 次问答），不需要绑卡。
> 你只需要：一个能上网的电脑 + 一个邮箱。

---

## 整个流程一共 5 步

```
① 注册 Cloudflare 账号（免费）
② 电脑上装 Node.js（如果还没有）
③ 用 wrangler 登录 + 一条命令部署
④ 把 Worker 网址填进 ai-config.js
⑤ push 上线，完事
```

下面每一步都拆到「点哪里、输什么」。

---

## 第 ① 步：注册 Cloudflare 账号（2 分钟）

1. 浏览器打开 **https://dash.cloudflare.com/sign-up**
2. 用邮箱注册（QQ 邮箱、Gmail 都行）
   - 密码随便设一个，记住它
   - 它可能问你要不要注册「Workers 免费」计划——**选免费的**（Free，$0/月）
   - **不需要**绑信用卡
3. 注册完进入控制台首页（Dashboard），能看到左边一排菜单就对了

> 不用添加任何网站/域名——我们只用它的 Workers 功能，跟域名无关。

---

## 第 ② 步：安装 Node.js（2 分钟，已装可跳过）

**Windows：**

1. 打开 **https://nodejs.org/zh-cn**
2. 点左边大绿按钮下载 **LTS 版**（长期支持版）
3. 双击安装包，一路「下一步」到底（默认选项不用改）
4. 验证：按 `Win + R`，输入 `powershell` 回车，在蓝窗口里输入：

```
node --version
```

看到 `v22.x.x` 或类似的版本号 = 装好了。

> 你电脑上已有 Node（我看到过 v22 和 v24），这步直接跳过。

---

## 第 ③ 步：登录 wrangler + 部署（3 分钟）

打开 PowerShell（`Win + R` → 输入 `powershell` 回车），逐条输入：

```powershell
cd "C:\Users\dujeo\WorkBuddy\2026-10-13-03-23-38\shuangxiugou\ai-worker"

npx wrangler login
```

- 会自动弹出浏览器，问你是否允许 wrangler 访问你的 Cloudflare 账号
- 点 **Allow / 允许**
- 浏览器显示 "Successfully logged in" 就回 PowerShell 继续

然后**一条命令部署**：

```powershell
npx wrangler deploy
```

成功时终端会输出类似：

```
Uploaded shuangxiugou-ai-worker (x.xx sec)
Published shuangxiugou-ai-worker (x.xx sec)
  https://shuangxiugou-ai-worker.你的子域名.workers.dev
```

**把这一行 `https://...workers.dev` 网址复制下来**——这就是你的 AI 服务地址。

> 第一次跑 npx 可能问 "Need to install the following packages, proceed? (y)"——输入 `y` 回车。
> 如果报错说 `wrangler.json` 里的 ai binding 有问题，先确认你用的是仓库最新版（ai-worker/wrangler.json 里应有 `"ai": { "binding": "AI" }`）。
>
> **两个 Windows 专属坑**（2026-11-21 实测）：
> ① 一定先 `cd` 进 `ai-worker` 再跑 deploy——在 `C:\Windows\System32` 下直接跑会报
> `Could not detect a directory containing static files`；最稳的是加绝对路径参数：
> `npx wrangler deploy --config "C:\Users\dujeo\WorkBuddy\2026-10-13-03-23-38\shuangxiugou\ai-worker\wrangler.json"`。
> ② 如果用 API Token 登录（token 里有 `#`），赋值时必须加英文双引号
> `$env:CLOUDFLARE_API_TOKEN = "token整串"`，否则 `#` 被 PowerShell 当注释符截断。
> ③ 浏览器 `wrangler login` 授权要在 **2 分钟内**点完 Allow，超时会报
> `Timed out waiting for authorization code`，浏览器那页变成 `localhost 拒绝连接`——重跑 login 并快点 Allow 即可。

**图片识别首次使用要做一次「同意协议」**（新账号必做，账号级一次就好）：
视觉模型受 Meta License 约束，第一次带图提问前要在 Cloudflare 控制台 →
**Workers AI → 模型 `@cf/meta/llama-3.2-11b-vision-instruct` → Agree** 点一次同意；
不做的话纯文本正常、但带图会报 `ai-upstream-error`。
（技术细节见 `README.md` 的「坑：视觉模型首次使用必须先同意 Meta 协议」。）

### 想先本地试试效果（可选，跳过也行）

```powershell
npx wrangler dev
```

然后**另开一个** PowerShell 窗口：

```powershell
curl.exe -X POST http://localhost:8787 -H "Origin: https://dujeongil-galaxy.github.io" -H "Content-Type: application/json" -d "{\"question\":\"加班费怎么算\"}"
```

能收到一段 JSON 回答（`{"answer":"..."}`）就说明 Worker 活了。`Ctrl+C` 停掉本地服务。
注意：本地测试也消耗当日 neurons（每次几十个，1 万的额度很经用）。

---

## 第 ④ 步：把网址填进配置文件（1 分钟）

用记事本（或任何编辑器）打开：

```
C:\Users\dujeo\WorkBuddy\2026-10-13-03-23-38\shuangxiugou\ai-config.js
```

把第 3 步复制的网址填到 `endpoint` 引号里：

```js
window.SXG_AI_CONFIG = {
  endpoint: 'https://shuangxiugou-ai-worker.你的子域名.workers.dev'
};
```

保存。

---

## 第 ⑤ 步：推送上线

告诉我「填好了，推」，我来提交推送（也可以你自己 `git add ai-config.js && git commit && git push`）。

上线后刷新网站，点右下角的 🤖 机器人，问一句「加班费怎么算」——
能回答就是全部搞定。🎉

---

## 部署之后你可能想问的

**Q：花钱吗？**
免费层每天 1 万 neurons，够约 340 次标准问答。超了当天就答不了
（挂件会提示「今日额度已用完，UTC 00:00 重置」），第二天自动恢复。
免费层**不会**自动扣费，不绑卡就花不了钱。

**Q：API key 会不会泄露？**
这套架构里**没有 key**。模型调用通过 Cloudflare 的 `env.AI` 绑定，
密钥逻辑在 Cloudflare 侧，仓库、网页、请求头里都不存在 key。
Worker 网址是公开的没关系——它自带防刷（CORS 白名单只放行本站、
每 IP 每小时 20 次、单问 500 字上限、输出 600 token 上限）。

**Q：有人恶意刷怎么办？**
撞的是 Worker 的限流墙，刷不爆你的额度上限（每天最多也就 1 万
neurons 的自然消耗，且超出就停）。

**Q：想换 AI 的回答风格 / 卡通形象？**
- 回答风格 → 改 `ai-worker/src/worker.js` 里的 `systemPrompt`（第
  「系统提示词」段），改完重新 `npx wrangler deploy`
- 卡通形象 → 改 `assets/ai-avatar.svg`，跟我说一声我重新内联编码

**Q：怎么看今天用了多少额度？**
Cloudflare 控制台左侧 → **Workers AI** → Overview，有每日用量图。

**Q：不想要了怎么下线？**
把 `ai-config.js` 的 endpoint 改回空串推上去即可（挂件会回到「开通中」
提示态）；彻底删除就到 Cloudflare 控制台删掉那个 Worker。

---

## 常见报速查

| 报错 | 原因 | 解法 |
|---|---|---|
| `wrangler: command not found` | 没用 npx 前缀 | 用 `npx wrangler ...` |
| `Authentication required` | 没登录或登录过期 | 重跑 `npx wrangler login` |
| `Could not detect a directory containing static files` | 没 cd 进 ai-worker，wrangler 在 System32 找不到配置 | 先 `cd` 进 ai-worker，或 deploy 时加 `--config 绝对路径` |
| `Timed out waiting for authorization code` + 浏览器拒绝连接 | wrangler login 超过 2 分钟没点 Allow | 重跑 login，2 分钟内点完 Allow；或改用 API Token 登录 |
| token 被截断 / 报 `ObjectNotFound` | token 含 `#`，PowerShell 当注释符吃掉 | 赋值必须加双引号：`$env:CLOUDFLARE_API_TOKEN = "整串"` |
| 纯文本正常但带图报 `ai-upstream-error` | 新账号没同意 Meta 视觉模型协议 | 控制台 Workers AI → 该模型 → Agree 点一次（见第③步） |
| 部署成功但挂件提示「连不上 AI 服务」 | endpoint 填错 / 没推上线 | 核对 ai-config.js 网址与推送状态 |
| 挂件提示「origin-not-allowed」 | 从非本站域名访问（本地文件等） | 正常，线上域名才放行 |
| 回答很慢 | 免费层排队 | 正常现象，高峰期等几秒 |
