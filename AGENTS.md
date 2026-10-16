# AGENTS.md

给在此仓库工作的 AI 助手（Claude Code、Cursor、Copilot 等）的协作说明。
人类维护者的意图若与本文冲突，以维护者当次明确指示为准。

---

## 项目是什么

**双休购 ShuangxiuGo** —— 开源的劳工友好品牌索引与购物决策工具。
查企业双休制度、工时评级、员工实测数据，帮助消费者避雷单休/大小周/996企业。

- 线上：https://dujeongil-galaxy.github.io/shuangxiugou/
- 仓库：https://github.com/dujeongil-galaxy/shuangxiugou
- 二次开发自 `ZhiqingHeyi/shuangxiugou`（MIT 协议），本仓库由 `dujeongil-galaxy` 维护

---

## 站点结构

| 路径 | 内容 |
|---|---|
| `index.html` | 首页。React 应用挂载在 `#root`，公告栏是静态 HTML |
| `projects.html` | 同类项目导航（静态页） |
| `sponsor.html` | 赞助页 |
| `jiahua-fact-check.html` | 云南嘉华事件核查页 |
| `notes.html` | 站长随笔。**正文加密**，见下方专节 |
| `brand/*.html` | 36 个品牌详情页，title 格式 `{品牌名} 几点下班 双休率X%｜双休购` |
| `friend-links-footer.js` | 首页页脚内容（友情链接、微博投票、搜索排名公示） |
| `custom-card-actions.js` | 打卡引导弹窗 + 自定义品牌卡按钮修复，见下方专节 |
| `scripts/` | 加密、校验、SEO 生成脚本 |

---

## 自定义品牌卡的技术约束（改前必读）

首页品牌卡分两种，**行为不一样**：

| 类型 | 来源 | 按钮能否点 |
|---|---|---|
| 内置品牌 |打包在 `index-YthXZ9eP.js` 的 React 组件里 | 能，React 直接绑 onClick |
| 自定义品牌 | `index.html` 里 `customCardsConfig` + `cloneNode(true)` | **不能**，克隆节点没有 React 事件 |

所以给自定义卡加功能，只能在外部脚本里自己绑事件 + 自绘弹窗，
不能指望改动 React 源码（那是构建产物，改了也会被下次构建覆盖）。

两个必须知道的坑：

1. **别直接套 Tailwind 类。**
   `index-BgVofs0W.css` 是构建时按源码实际用到的类生成的，
   `bg-slate-950/70`、`hover:bg-white/20`、`max-h-[85vh]` 这类
   **根本没有被输出**。套上去会静默没样式。
   `custom-card-actions.js` 因此自带一份 `sxg-` 前缀的样式表。

2. **拦截 React 按钮要用捕获阶段。**
   React 的事件委托在 `#root` 的冒泡阶段，所以在 `document` 上用
   `addEventListener(type, handler, true)` + `stopPropagation()` 才能拦下来。

### 已知未修的 bug

讨论广场帖子的「查验证据」按钮 `onClick:()=>t(i)` 写错了 ——
`t` 是帖子列表的 setState，`i` 是「已投票集合」对象，
点一下会把整个帖子列表覆盖成一个对象，广场直接空白。
维护者已知悉，暂未安排修复。

### 内置小票的写死值怎么处理的

内置品牌卡的小票里，「考核执行官」和「已转移/支持消费」在构建产物
`index-YthXZ9eP.js` 中是写死的（`清醒打工人 #7709`、固定 199）。

**没有改这个文件**（34 万字符的压缩包，改错整站白屏，且下次构建会被覆盖）。
做法是在 `custom-card-actions.js` 里等小票渲染完，用 DOM 找到那两个文本节点
换掉，并在小票前插入与自定义卡共用的填写区（`buildProfileForm`）。
压缩包 md5 全程未变，可作为回归基准。

**以后若要改小票的文案/字段，走DOM 层，不要动压缩包。**

### 暂不做的功能

点赞/点踩（内置卡和自定义卡都一样）只改内存 state，刷新即归零。
要做持久化必须上数据库，因此当前置灰并加了「暂未开放」提示。
**不要**在没接数据库的情况下把它做成「看起来能用」。

---

## 两条硬规则

### 一、公告栏版本号：取上一次提交的哈希

`index.html` 顶部公告栏末尾有「当前版本号 xxxxxxx」。

**该值永远等于「上一次提交」的 short hash，不是当前 HEAD。**

原因：哈希由内容算出，把哈希写进文件会改变内容、进而改变哈希 —— 无法自指。
维护者已确认接受这个语义：**页面上显示的是上一版内容的版本号。**

每次推送后要做的事：

1. `git log --oneline -1` 拿到本次提交哈希
2. 把公告栏里的版本号改成**这个**哈希（本次提交前的那个）
3. 提交并推送这次改动

**不要**试图把版本号写成当前 HEAD 的哈希，那会导致每次都落后两拍。

### 二、notes.html 加密流程

正文永远不提交明文，仓库里只留密文。改完 notes 必须走这条链：

```bash
# 1. 改明文源
#    本地文件：shuangxiugou/notes-plaintext.md（已在 .gitignore）
# 2. 立刻同步到固定备份（工作区目录会被清理，备份不能只放那里）
cp notes-plaintext.md "C:/Users/dujeo/WorkBuddy/notes-备份/notes-plaintext-current.md"
# 3. 加密
node scripts/encrypt-notes.mjs --key=<密码>
# 4. 只提交 notes.html
git add notes.html && git commit -m "..." && git push origin main
```

- 算法：PBKDF2-SHA256（21 万次）+ AES-256-GCM
- 密码同时是访客访问密码，**不要写进任何文件或提交信息**
- 校验：`node scripts/verify.mjs`
- ⚠️ 明文**只在本地磁盘上改**。不要用浏览器 F12 改线上密文页面 —— 刷新即丢，
  从未落盘，改过的东西找不回来（已经发生过一次）

---

## 改动纪律

### 正文一个字都不能改写

维护者的文字是他本人的表达，不是草稿。

- **只誊写，不润色。** 除非明确要求，否则不要改他的措辞、断句、标点
- **不删除任何词**，除非他明确说删哪一句
- 「优化」「顺一下」这类指令，先确认要改哪里，再动手
- 涉及主体、动作、因果的改动尤其危险：曾经把「跳舞的时候老师会看女生的脚底板」
  自行改成「老师会看女生的脚心」，主体和动作全变了，还直接上线。**不要自作主张重构句子。**

### 括号要逐条确认

维护者截图里的括号有两种含义，不能默认：

| 例子 | 含义 |
|---|---|
| （注意是某些）（上面还有领导在群里看着我们） | **正文**，是事件的补充注，要保留 |
| （那个词语，很有侮辱性） （保持之前的原文，我懒得再写了） | **写给 AI 的说明**，不属正文，要删或照办 |

判断依据：带「词语 / 注意 / 之前 / 懒得」这类**对 AI 说话的口吻**的是说明；
对事件本身做补充注的是正文。看不准就问，别猜。

### 数据不可编造

品牌页的「双休率 XX%」「平均下班 XX:XX」都来自可追溯的公开证据。
新增或修改数据前先确认来源，没有依据就不要写具体数字。

---

## 提交与验证

```bash
# 改完先看改了什么
git status --short
git diff

# 提交信息用中文，说清改了什么、为什么
git add <具体文件>      # 不要 git add .
git commit -m "..."
git push origin main
```

- 只暂存真正改动的文件（尤其别把明文正文提交进去）
- 推送后如果改了 index.html 公告栏，见上文规则一

---

## 环境说明

- 运行时用托管版 node：`C:/Users/dujeo/.workbuddy/binaries/node/versions/22.22.2-6/node.exe`
- `gh` CLI 在本机不可用，GitHub 操作走 API 或网页
- Vercel 在国内打不通，不要建议迁移过去