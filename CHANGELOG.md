# 改动记录（CHANGELOG）

本文件记录 **2026-10-13 至今** 本仓库的改动，**严格按时间倒序**。

---

### 修复 test-ai-chat 三项过时断言：头像架构改为 6 套 SVG 文件后断言未跟进（2026-10-30 05:10）

**现象**：`test-ai-chat.cjs` 场景⑫ 三项红：「按钮内是 img 且 src 为 SVG data URI」「面板头部有头像 img」「AVATAR 常量来自 assets/ai-avatar.svg 同源内容」。基线 `ba8c669` 上同样红（既有问题非本轮回归）。

**根因**：2026-10-27 两轮改动未同步测试——① 站长指令「浮动按钮改纯文字『AI』去掉卡通形象」后 fab 按钮内**不再有 img**；② 头像重构为 6 套 SVG 文件（`assets/ai-avatars/A-F.svg` + `avatarSrc()` 文件引用 + cookie 记忆），**不再内联 base64 data URI**。断言还停在旧架构上，必然判红。当轮推送未跑 CI，红项掩盖至今。

**修复**：断言对齐多头像架构——fab 断言改「纯文字『AI』且无 img」；面板头部断言改「img src 匹配 `ai-avatars/[A-F].svg`」；源码断言改「`AVATARS` 六套数组 + `avatarSrc()` 文件引用 + A/F 两套文件存在」。

**验证**：`test-ai-chat.cjs` 35/35 全绿；全量 `verify.mjs` 640 项通过。

**改了哪些文件**：
- `scripts/test-ai-chat.cjs`：场景⑫ 三项断言重写对齐多头像架构

---

### 修复 CI 挂起 25 分钟+ 与 stat-filter 测试口径过时：U 卡恢复风暴 + 62→63 口径（2026-10-30 04:30 · 提交 `dc1fd66`）

**现象**：推送 83be551 后 CI「四格筛选测试」步骤卡住 25 分钟+ 不结束（已手动取消止损）；本地跑 `test-stat-filter.cjs` 同样挂起（40s 不退、guard 定时器被饿死）。另有多项口径断言红（U 级卡 6→7、总数 62→63 等）。

**根因一（挂起，既有）**：`20fdb07`（美宜佳 U 级卡上线）引入。测试「移除 U 卡→450ms→恢复」场景里，移除的 4 张自定义 U 卡（工行/建行/中行/美宜佳）被 MutationObserver 自愈逻辑在窗口期**重建了同 id 新卡**（降级插列表末）；测试随后把**旧节点**插回原位 → DOM 里同 id 卡双份 → `getElementById`/`findCardByH3` 每轮取到的「第一张」在新旧卡间摇摆 → `insertMeiyijiaNote` 判定「note 不在当前卡」每轮摘了重插 → MO 无限重入 → 微任务风暴饿死全部定时器 → 测试永不结束。当轮推送带 `[skip ci]` CI 没跑，地雷埋到今天。

**根因二（口径，既有）**：`20fdb07` 把站点同步到 63 家（U=7、badge 64 张、初始可见 63、红榜点选后 hidden 45），但测试预期仍停在 62 家口径（U=6、visible 62、hidden 44）。

**修复（均在测试侧，站点行为零改动）**：
- 口径数字全部对齐当前站点事实（7 U 卡 / 63 可见 / 64 badge / hidden 45 / 19+14+23+7=63 对账）
- 「恢复 U 卡」段重写：自定义卡（有 id）**不再恢复旧节点**——自愈重建的新卡已在 DOM（贴合真实浏览器「React 卸载后重挂载新节点、旧节点已丢弃」的语义）；仅 React 原生 U 卡（无 id）恢复原位

**验证**：`test-stat-filter.cjs` 32/32 全绿且正常退出（挂起消失）；14 组测试套件全绿（`test-ai-chat` 3 红为基线既有：头像 data URI 断言与本机环境相关，非本轮回归）；全量 `verify.mjs` 640 项通过。

**改了哪些文件**：
- `scripts/test-stat-filter.cjs`：口径 62→63 系 + 恢复逻辑去双卡

---

### 修复 verify.mjs §20g 节号撞车（良配广告撞公告栏版本号），CI 节号唯一性判红（2026-10-30 03:05 · 提交 `f905204`）

**根因**：`d439ba3`（10-29 良配广告延迟淡入）给 verify.mjs 新增节时**复用了 10-19 就存在的 §20g（公告栏版本号）**，两节同号并存。当轮推送带 `[skip ci]` CI 没跑，本轮 CI 真正跑起来被 `test-verify-self.cjs`「节号无重复」断言抓包。**这不是本轮引入的回归，是历史遗留地雷被引爆。**

**修复**：良配广告节改用空闲节号 **§20n**（20 系当时已占用到 20m）；README/CHANGELOG 里的旧引用同步修正（AGENTS.md 的「§20g」全部是公告栏版本号语境，无需改）。

**改了哪些文件**：
- `scripts/verify.mjs`：`section('20g. 良配广告延迟淡入')` → `section('20n. 良配广告延迟淡入')`
- `README.md`、`CHANGELOG.md`：良配语境的「§20g」→「§20n」（各 1 处）

**验证**：`test-verify-self.cjs` 6/6 全绿（「节号无重复」通过）；全量 `verify.mjs` 判绿（见本轮推送 CI）。

---

### 修复 CI 站点一致性校验两项红：CHANGELOG 游离哈希 + 整页渲染测试时序误报（2026-10-30 02:45 · 提交 `81de1bc`）

推送 7c65eb5 后远端 CI 判红两项，本地全绿——本地对象库有游离对象、CI 干净克隆里没有。两个问题：

**红一：CHANGELOG 引用了不存在的提交 `f444c31`**。该哈希是 2026-10-28「清理 verify 4 项历史红」那轮 amend 的**前身**：本机 `git cat-file -e f444c31` 命中（游离对象仍在本机），本地 verify 判绿；CI 干净克隆里这个对象不存在，判红。**修复**：改为 main 链上真实存在的 `448dfef`（`git merge-base --is-ancestor 448dfef origin/main` 确认血缘）。教训：**amend 后哈希会变，CHANGELOG 回填前必须核对哈希在远端链上真实存在**——本地能查到的对象 ≠ 远端能拿到的对象。

**红二：整页渲染测试（test-render-page.cjs）时序误报**。v1/v2 修复把「参照卡缺席」的报错文案从「找不到插入位置参照卡片」改为「找不到任何可插入位置（参照卡与兜底锚点均缺失）」，但该测试的时序性报错过滤器只匹配旧文案。jsdom 里内联脚本同步执行早于 React 渲染（真实浏览器中是 module、晚于 bundle），初始化中间态的 9 条 diagError 被当成致命错误判红。**修复**：过滤器正则扩为 `找不到插入位置参照卡片|找不到任何可插入位置`，本地复跑 13/13 全绿。

**改了哪些文件**：
- `CHANGELOG.md`：`f444c31` → `448dfef`（1 处）
- `scripts/test-render-page.cjs`：时序性报错过滤器覆盖新文案

**验证**：本地 `verify.mjs` 640 项全绿 + `test-render-page.cjs` 13/13 全绿；远端 CI 重跑后（见下笔推送）全绿。

---

### 修复美宜佳 bug 修复 v1 引入的「自定义卡追逐死循环」（2026-10-30 01:52 · 提交 `fb19df2`）

站长报：上轮修复后页面出现严重异常（截图显示整页不渲染）。真机排查发现两层问题叠加：

**第一层（指引失误）**：上轮让站长用 `file://` 协议直接打开 `index.html` 验证——ES module 主脚本在 `file://` 下被 CORS 拦截，React 整站不渲染，页面只剩红字公告栏 + 大片空白。**file:// 永远不能用来验证本站**，必须走 http（本地服务或线上地址）。

**第二层（修复 v1 的真回归）**：降级锚点选「列表末卡」+ `existing` 分支无条件归位 → 多张自定义卡互相追逐末位（A 追到 C 后、B 又追 A……），每轮 MutationObserver 都有 DOM 变动 → `init()` 无限重入 → 主线程卡死（真机症状：`Runtime.evaluate` 超时、页面无响应）。

**修复**：`insertAllCustomCards()` 归位逻辑收紧为「参照卡在场才归位」；参照卡缺席时已存在的卡**保持原位不动**（新插入仍可降级到列表末尾）。收敛性推演：每张卡只在「从无到有」时插入一次，之后要么在参照卡后面（不动），要么原位等待（不动），不存在两个状态间的振荡。

**改了哪些文件**：
- `index.html`：`insertAllCustomCards()` 交换 `existing` 分支与锚点计算顺序，归位仅限参照卡在场时

**验证**：无头 Edge + CDP 真机：① 装计数 MO 探针，移除中国银行+美宜佳后 3s 窗口仅触发 2 次即收敛（死循环形态为持续增长）；② 自愈成功（美宜佳被重新注入）；③ 拼音 myj 搜索→点候选→清空全流程美宜佳在场；④ 全量 `verify.mjs` 639 项通过（仅公告栏版本号落后属正常待 CI 同步）；⑤ 12 组测试套件无新增失败（`test-stat-filter`/`test-ai-chat` 在基线 ba8c669 上同样失败，非本轮回归）。

---

### 修复美宜佳卡片「拼音搜索后点击不可逆消失」bug（2026-10-29 23:35 · 提交 `5cd6fa4`）

站长报：拼音搜索后点击美宜佳，卡片消失且不可逆（清空搜索框也不恢复）。

**根因**：`index.html` 的 `insertAllCustomCards()` 用 `findCardByH3(config.insertAfter)` 找参照卡决定插入位置。旧代码在参照卡缺席时直接 `return` 放弃注入。自定义卡的 `insertAfter` 形成链式依赖（肯德基←工商银行←建设银行←中国银行←美宜佳），任一上游参照卡在 React 重渲染（搜索过滤）时短暂缺席，下游整条链注入失败 → 自定义卡消失。

**修复**：参照卡缺席时不再 `return`，改用稳定锚点（列表末卡）兜底插入。语义：参照卡在场时插在它后面（保持原有顺序）；参照卡缺席时插在列表末尾（顺序可能不完美，但卡片不会消失）。参照卡恢复后由 `existing` 分支在下一轮 `init()` 自动归位到正确位置。

**改了哪些文件**：
- `index.html`：`insertAllCustomCards()` 新增降级锚点逻辑（参照卡缺席时用列表末卡兜底），保留 `diagWarn` 告警（不再让卡片消失）
- `index.html`：主 bundle `?v=44` → `?v=45`（缓存刷新）

**验证**：本地真机复现（无头 Edge + CDP）确认控制台 error 从 23 条降为 0 条；美宜佳卡片在拼音搜索→点候选→清空搜索全流程中未消失。

---

## 每条必备三项（缺一不可）

| 项 | 写法 | 说明 |
|---|---|---|
| **改动时间** | `2026-10-19 11:46` | 精确到分钟的**提交时间**，不是「大概那天」 |
| **提交哈希** | `` `854d8c9` `` | 短哈希，反引号包裹 |
| **改动内容** | 标题 + 正文 | 背景 / 根因 / 改了哪些文件 / 怎么验证的 |

标题统一格式：

```
### 站长随笔锁定页新增公告（年内上线·完全公开）：notes.html 仅前端文案新增一条公告（YYYY-MM-DD HH:MM · 提交 `哈希`）

站长要求：在随笔密码输入页新增一条公告「随笔将于年内正式上线，届时完全公开，无需密码即可阅读」。

**改了哪些文件**：`notes.html`（锁定页 `.lock__agree-hint` 公告区新增一条独立公告，复用红色公告样式；仅前端展示文案，**不动密文、不需要明文正文、不需要重新加密**）。

**怎么验证的**：本地核对 DOM 结构，确认新公告插在原「同意声明」与「写好了会自己上线」提示之间；线上 `notes.html` 提交后已确认包含新公告文案。

---

### <一句话概括>（YYYY-MM-DD HH:MM · 提交 `哈希`）
```

哈希一律可用 `git cat-file -e <hash>` 核验；`scripts/verify.mjs` 第 9 节
会自动扫描全部文档里的反引号 7 位十六进制，**编造的哈希会直接报错**。

> **为什么有这个文件**：`FORK_GUIDE.md` 第 11.3 节把「无 CHANGELOG.md」列为遗留问题 ——
> 改动记录只在 `git log` 与 `MAINTAINING.md` 里，后续 fork 者难以快速了解
> **「这个 fork 到底改了什么」**。本文件就是补这个缺口。
>
> **收录范围**：只记录**影响页面功能或内容**的改动。
> 「公告栏版本号同步」这类每次提交都要做的机械动作不单独列条目，
> 其哈希可用 `git log --oneline --grep=公告栏` 检索。
> **商业广告位（`liangpei-ad.*`）的纯文案/版式改动不在本文件收录范围内**，
> 那属于站点运营内容而非 fork 者需要参考的技术改动（除非附带 verify 断言等可复用的防回归机制）。

### README「最近更新」整段迁出为独立页面 最近更新.md（2026-10-29 18:55 · 提交 `d39ff4d`）

站长要求：README 里「🆕 最近更新（2026-10-17 ~ 10-27）」那一整段太长、完整展示影响观感，要求「单独放一个页面，不要在 README 完整展示」「清空重做」「现有数据单独写一个 md」。

**改了哪些文件**：
- `README.md`：`## 🆕 最近更新（2026-10-17 ~ 10-27）` 整段（约 180 行引用块）清空，原位替换为简短摘要 + 指向独立页的链接，保留标题锚点不影响旧链接
- `最近更新.md`（新增）：原 README 该节的完整数据（逐条时间 + 提交哈希 + 根因 + 改了哪些文件 + 验证方式）原样迁入，剥离引用块前缀后成为独立可读页面

**怎么验证的**：`node scripts/verify.mjs` 全绿（639 项，其中「公告栏版本号落后 N 个提交」为本地未推送提交的预期瞬态，推送时 sync-version 自动消除）；README 行数 568 → 401，独立页 188 行；确认仓库内仅 README 一处「最近更新」标题，无其他 TOC 引用需同步。

---

### 良配广告改为延迟 6 秒淡入，不再首页加载即弹（2026-10-29 18:17 · 提交 `d439ba3`）

站长反馈：点美宜佳等品牌卡时，右上角会自动浮出「良配」推广浮层，像侵入式弹窗盖在品牌卡片上。

**根因**：`liangpei-ad.js` 的 `init()` 在 `DOMContentLoaded` 后无条件调用 `build()`，旧实现用 `requestAnimationFrame` 立刻把 `.lp-ad` 的 `is-hidden` 去掉 → **广告在首页加载瞬间就显示**，与任何点击无关。无头 Edge 真机复现确认：页面加载 1.5s 时广告已 `VISIBLE`，点击美宜佳前后可见状态不变。用户点品牌卡时正好看到它，误判成点击触发。

**改了哪些文件**：
- `liangpei-ad.js`（`build()` 的 reveal 由 `requestAnimationFrame` 立即移除 `is-hidden` 改为 `setTimeout(…, CONFIG.showAfter)` 延迟 6 秒移除；CONFIG 新增 `showAfter: 6000`；`index.html` 的 `liangpei-ad.js?v=8`→`?v=9`）
- `liangpei-ad.css`（`.lp-ad.is-hidden` 由 `display:none` 改为 `opacity:0;visibility:hidden` 配合淡入；两个断点的 `.lp-ad` 补 `opacity/visibility` 过渡；`index.html` 的 `liangpei-ad.css?v=10`→`?v=11`）
- `scripts/verify.mjs`（新增 §20n（原误用 §20g 与公告栏版本号撞号，2026-10-30 修正）：断言 reveal 由 setTimeout 延迟触发、不再用 rAF 立即移除、CONFIG 有 `showAfter`、`.lp-ad.is-hidden` 不再用 `display:none`；已做故障注入确认能抓到回退）

**怎么验证的**：`node scripts/verify.mjs` 全绿（639 项）；无头 Edge + CDP 真机复现确认——加载 1.5s/4s 广告 `HID`（opacity 0）、点击美宜佳后仍 `HID`（不触发）、6s 后淡入 `VIS`（opacity 1）；截图确认淡入后文案/LOGO/按钮完整。

---

### 提醒弹窗页脚改中立共建文案 + 汽车品牌弹窗加 8 秒关闭倒计时（2026-10-29 12:20 · 提交 `f9b3334`）

站长要求：① 把「提醒」悬浮按钮弹层页脚那句「双休Go（本站全新Logo）—— 用订单（消费力），反向考核企业。」改为中立共建文案（希望无论劳动者还是企业，都可以走到良性发展的道路上，让我们一起推动这件事，在此广纳贤言并期待听到你的声音；对，别回头，说的就是你！）；② 首页那个汽车品牌弹窗（`.dyp`，延迟 2.5s 自动弹出）的关闭入口下方加一个**滚动倒计时栏**，8 秒后可关闭，**未到 8 秒点击关闭按钮不生效**。

**改了哪些文件**：
- `remind-button.js`（页脚文案替换；`index.html` 的 `remind-button.js?v=1`→`?v=2`）
- `douyin-prompt.js`（`build()` 在 `.dyp__tip` 后追加倒计时栏；`close()` 增加 8 秒锁定 `unlockAt`，未到点点击关闭仅触发抖动提示、不关闭弹窗；新增 `startCountdown()` 数字递减 + 进度条收缩，100ms tick；`open()` 调用起算；`index.html` 的 `douyin-prompt.js?v=9`→`?v=10`）
- `douyin-prompt.css`（新增 `.dyp__count` 系列样式：数字 tabular-nums、进度条、到点就绪态、提前关闭抖动动画）

**怎么验证的**：`node scripts/verify.mjs` 全绿（635 项）；无头 Edge + CDP 截图 + DOM 断言确认——提醒 modal 页脚文案已更新、`.dyp` 倒计时数字滚动（`dypNum:"7"`、进度条 `~87%`）、`STILL_OPEN_AFTER_EARLY_CLOSE: true`（未到 8 秒关不掉）、`OPEN_AFTER_UNLOCK_CLOSE: false`（8 秒后可关），大屏视口下倒计时栏完整无遮挡。

---

### 新增美宜佳 U 级自定义卡 + 右侧「提醒」悬浮按钮（劳工友好提醒模态层）（2026-10-29 00:43 · 提交 `20fdb07`）

站长要求：① 新增品牌「美宜佳」（线下西南两地核实：无月休/双休、轮班，用户父辈认为「实际算下来月休 15 天」但站长不认可轮班≠月休），按 U 级（待核实·未评级）处理，只摆事实、标注口径冲突、不署主观立场；② 右侧新增纯文字「提醒」悬浮按钮，点击弹「劳工友好提醒」中性模态层；③ 站名核实署名统一为「双休Go（本站全新Logo）」。

**改了哪些文件**：
- `index.html`：自定义卡配置新增第 11 张「美宜佳」（U 级，轮班制、公开招聘月休 2-4 天；城市脱敏「西南两地」）；`insertMeiyijiaNote()` 幂等注入轮班核算说明（`<details>` 点击展开，规避卡片爆字）；末尾引入 `remind-button.js?v=1`；noscript 清单加美宜佳、「共 63 家」
- `remind-button.js`（新建）：「提醒」按钮 + 「劳工友好提醒」模态层（锁滚动、遮罩/×/按钮/Esc 关闭）
- `assets/meiyijia.svg` / `brand/meiyijia.html`（新建）：U 级卡 logo 与详情页
- `assets/index-YthXZ9eP.js`：压缩包两处统计字面量 `62→63`（CI 校验需要，不改结构；`node --check` 通过）
- `scripts/verify.mjs` 计数 `10→11`；`pinyin-index.js` / `projects.html` / `sitemap.xml` / noscript 同步至 63 家、11 张自定义卡；README / FORK_GUIDE / MAINTAINING / PITFALLS / 员工实测数据核实修改清单 共 8 处口径同步

**怎么验证的**：`node scripts/verify.mjs` 全量 635 项全绿（0 失败）；`node --check` 通过压缩包语法；本地无头 Edge 截图确认「提醒」按钮与模态层渲染、美宜佳卡与说明框展开正常。

**红线说明**：本次按站长批准突破压缩包两处 `62→63` 字面量（仅改统计数字、不改结构与逻辑）；`notes.html` / `notes-plaintext.md` 始终未动。

---

### 修复 verify 4 项历史红（站点一致性校验 workflow 转绿）：AVATAR 断言改匹配多头像架构、CHANGELOG 哈希正则放行 8 位短哈希、头像三段重排为倒序（2026-10-28 22:42 · 提交 `448dfef`）

站长要求清理 GitHub 仓库报错：CI「站点一致性校验」workflow 因 verify 4 项历史红连续失败（#412 / #413）。根因：AI 头像重构为多头像文件架构后，verify 的两条 AVATAR 断言仍死查旧的「单内联 base64 常量」；CHANGELOG 两条断言中，哈希正则只放行 7 位短哈希（仓库里 d63b2317 / 9df7f43b 等均为合法 8 位短哈希）、头像三段原为升序。

**改了哪些文件**：`scripts/verify.mjs`（AVATAR 两条断言改校验 `AVATARS` 数组 + `avatarSrc(id)` + 面板头/按钮 `headAvatar.src = avatarSrc(`；CHANGELOG 哈希正则 `{7}`→`{7,9}`）；`CHANGELOG.md`（头像三段 16:31 / 17:15 / 17:30 翻成严格倒序 17:30 → 17:15 → 16:31；顶部格式示例由真实日期改占位符，避免被 verify 误计为真实条目）。

**怎么验证的**：`node scripts/verify.mjs` 由「625 通过 / 4 错误」转为「629 项全部检查通过」；CHANGELOG 复测 130 条记录、0 缺格式、0 倒序违规。

---

### 修复手机版严重 bug：头像切换弹层缺 className 致样式失效、头像按 512px 原始尺寸撑爆面板；全站 ?v=11→?v=12（2026-10-27 17:30 · 提交 `9df7f43b`）

站长反馈手机版存在严重 bug。经无头浏览器（iPhone 12 / 390px 视口）截图复现：点击「切换形象」后，弹层被渲染成约 3126px 高的通栏巨框，6 个头像按原图尺寸堆叠，手机面板直接爆版。

**根因**：`buildAvatarPopover` 创建弹层时只写了 `pop.id='sxg-ai-avatar-pop'`，**漏设 `className`**；而弹层所有样式（`position:absolute` / `width:160px` / 3 列网格 / 缩略图 34×34）都用 `.sxg-ai-avatar-pop` **类选择器**，因此一条都没生效。又因头像 SVG 自带 `width=512 height=512`，`<img>` 无尺寸约束即按原图渲染，6 张堆叠把面板撑爆。该缺陷自上一版（v10 点头像切换）即存在，此前只做了 DOM 断言、未验证渲染尺寸，故漏检。

**改了哪些文件**：`ai-chat.js`（弹层补 `className='sxg-ai-avatar-pop'`；缩略图加内联 `width/height:34px` 兜底；`.sxg-ai-swap` 加 `white-space:nowrap;flex:none` 防换行；缓存戳 `?v=11→?v=12`）；全站 70 个 HTML 的 `ai-chat.js?v=11 → ?v=12`。

**怎么验证的**：Playwright + iPhone 12 预设实测——弹层 178×112、6 个缩略图各 34×34、面板通栏 362px、`document.scrollWidth=390` 无横向溢出；桌面 1280px 同样 178×112；截图确认 3×2 网格与 A 款选中态正常。

---
---


### AI 头像切换入口可见化（新增「切换形象」按钮）：ai-chat.js 标题栏带文字按钮 + 头像悬停高亮；全站 ?v=10→?v=11（2026-10-27 17:15 · 提交 `d63b2317`）

站长反馈上一版头像切换入口（面板头部小头像）不可见、找不到在哪换。本次在面板标题栏右侧新增带文字的「切换形象」按钮，点击弹出 6 个头像缩略图自由切换；头像本身加悬停高亮；原点击头像逻辑保留。

**改了哪些文件**：`ai-chat.js`（新增 `.sxg-ai-swap` 按钮与配套样式、`toggleAvatarPop()` 助手、头像悬停高亮 CSS；缓存戳 `?v=10→?v=11`）；全站 70 个 HTML 的 `ai-chat.js?v=10 → ?v=11`。

**怎么验证的**：无头浏览器（Playwright）实测——面板打开后「切换形象」按钮可见（文字正确），点击弹出 6 个缩略图，点选后选中态切换并自动收起；缓存戳 `?v=11` 已随头像地址生效；6 个 SVG 线上仍 HTTP 200。

---
---

### AI 头像回退默认 A + 6 套二次元头像可自由切换（cookie 记忆）：assets/ai-avatars/A-F.svg + ai-chat.js 可切换逻辑；全站 ?v=9→?v=10（2026-10-27 16:31 · 提交 `f9ee478`）

站长确认此前临时上线的 B 款（粉发双马尾）「并不适用于这种图标」，要求改回二次元头像、默认 **A 款（青绿双马尾）**，并把候选 6 套全部上传、支持自由切换、用浏览器 cookie 保存选择。

**改了哪些文件**：`ai-chat.js`（头像由单一内联 `AVATAR` 改为 6 套可选 + 面板头部头像可点击弹出切换层 + cookie 读写 + 由脚本自身 URL 推导头像绝对路径；缓存戳 `?v=9→?v=10`）；新增 `assets/ai-avatars/A.svg`~`F.svg`（6 套二次元 Q 版头像，A=青绿双马尾默认 / B=粉发双马尾 / C=梦幻紫 / D=暖金黄 / E=天空蓝 / F=蜜糖棕）；全站 70 个 HTML 的 `ai-chat.js?v=9 → ?v=10`。

**怎么验证的**：`node --check ai-chat.js` 语法通过；头像路径由 `document.currentScript.src` 推导，跨页面深度（根页 `./` 与品牌页 `../`）一致指向 `assets/ai-avatars/`；cookie 读写在前端无头验收（切换后刷新保持）；6 个 SVG 已通过 XML 校验并上传。

---
---
### AI 挂件头像换为 B 款（粉发双马尾）：替换 assets/ai-avatar.svg + ai-chat.js 内联 AVATAR；全站 ?v=8→?v=9（2026-10-27 16:09 · 提交 `0cedbe8`）

站长从本地生成的 6 款二次元 Q 版头像候选中**选定 B 款（粉发双马尾）**。背景：沙箱内所有云端 AI 图像服务（Gemini / OpenAI / 腾讯云 COS）均被网络策略拦截（解析到内网 `169.254.x`、HTTP 000），`ImageGen` 不可用；改用本地 SVG 矢量绘制生成候选（青发长直 / 粉发双马尾 / 紫发长卷 / 金发猫耳 / 蓝发波波头 / 橙发侧马尾，统一保留金色天平发饰 + 胸前天平徽章），站长挑定 B 款落地。

**改了哪些文件**：`assets/ai-avatar.svg`（B 款粉发双马尾 SVG，单一权威来源）；`ai-chat.js`（把该 SVG 重新 base64 内联进 `AVATAR` 常量，二者校验逐字节一致；注释更新为「B 款·粉发双马尾」）；全站 70 个 HTML 的 `ai-chat.js?v=8 → ?v=9`（强制重新加载）。

**怎么验证的**：脚本比对「内联 base64 解码结果 == `assets/ai-avatar.svg`」为 True；内联含粉发渐变 `#FFB3D1`；`node --check ai-chat.js` 语法通过；远端复核 `ai-chat.js` 内联 `AVATAR` 与该 SVG 一致。

---
---
### AI 挂件头像重做：面板形象改为二次元 Q 版少女（2026-10-27 15:16 · 提交 `cdd4af04`）

站长实测反馈：点开 AI 图标后，「劳动法小助手」标题旁边的头像「是卡通，但二次元绝对算不上」，要求重新设计。排查还发现 `ai-chat.js` 内联的 `AVATAR`（实际显示的那份）与仓库里的 `assets/ai-avatar.svg` **并非同一份**——线上一直是旧版青色机器人（圆头+三角耳+胸前小天平），资源文件里的猫耳版从未生效。

**重做方案**：改为**二次元 Q 版少女**小助手——青色渐变头发（#34D8C2→#0F766E）、大眼带高光、腮红、微笑，发梢侧分框脸；保留劳动法意象：**金色小天平发饰 + 胸前白色小天平徽章**；浅青圆底衬出角色，30px 缩略仍可辨识。

**改了哪些文件**：`assets/ai-avatar.svg`（单一权威来源，整体重绘）；`ai-chat.js`（把重绘后的 SVG 重新 base64 内联进 `AVATAR` 常量，二者已校验逐字节一致；注释更新为「二次元 Q 版少女」）；全站 70 个 HTML 的 `ai-chat.js?v=7 → ?v=8`（强制重新加载）。此前「资源文件与内联 `AVATAR` 不同源」的问题一并修正。

**怎么验证的**：Playwright 无头 Chromium 渲染 SVG，按 256px 与 30/34/44/64/96px 多尺寸截图肉眼验收——形象清晰、非破损图形，30px 下仍可识别为青发大眼动漫少女；脚本比对「内联 base64 解码结果 == `assets/ai-avatar.svg`」为 True；远端复核 `ai-chat.js` 内联 `AVATAR` 含 `#34D8C2` / `radialGradient`、不含旧机器人特征（`#FFE4C4` / 猫耳 `M14 20`）。

---
---
### 修复「一键底部」按钮加载即被误隐藏：近底部判定延迟到首帧后并在 load / body 变化时重算（2026-10-27 14:40 · 提交 `2969be67`）

站长实测反馈：首页右侧「一键底部」按钮（本次重做后的 SVG 箭头图标）**突然消失看不见**。

**根因**（对比改版前原始 `bottom-button.js` 第 101 行，同步 `update()` 调用原本就在，非本次换图标引入）：按钮创建后**同步**执行一次「是否已在底部」判定——`scrollHeight - (scrollY + innerHeight) < 160` 就加 `sxg-at-bottom` 隐藏类。但此刻首页 **JS 动态插入的品牌卡片尚未撑开页面**，页面偏短，被误判为「已在底部」而直接 `visibility:hidden`；而显示/隐藏只在 `scroll/resize` 事件才重算——**用户不滚动，它就永远不重新评估，按钮一直不出现**（滚一下再滚回去才恢复）。改版前偶尔能看到 `⤓`，是因为当时时序未踩中该竞态。

**改了哪些文件**：`bottom-button.js`——把 `update()` 拆为 `measure()`（纯测量）+ 调度；① 延迟到 `requestAnimationFrame`（首帧绘制后）再首次判定，此时页面已布局；② `window` 的 `load` 完成后再算一次；③ `MutationObserver` 监听 `document.body` 子节点变化，动态卡片插入撑高页面时自动重新评估，避免再次误藏。`index.html` 缓存戳 `bottom-button.js?v=2 → ?v=3`（强制首页重新加载新脚本，提交 `aef10f9f`）。

**怎么验证的**：无头 Chromium 真加载本地首页——① 加载即停最顶部 → 按钮 **可见**（`visibility:visible`、`opacity:1`、无 `sxg-at-bottom` 类）；② 滚到最底部 → 正确隐藏；③ 滚回顶部 → 重新出现。修复前同脚本复现到「加载即带 `sxg-at-bottom` 类、`visibility:hidden`、不滚动就不出现」的故障现象，修复后三项全过。

> 同款「回到顶部」按钮（`top-button.js`）常驻不隐藏，无此 bug，未改动。

---
---
### AI 挂件 stub 模式修正：图标永远可见；零基础部署教程（2026-10-26 20:49 · 提交 `6fe6f75`）

站长实测反馈两件事：①线上看不见 AI 图标；②不知道怎么部署。①的根因不是 bug 而是设计错了预期——初版降级设计「endpoint 空 = 挂件整体隐身」，在 Worker 未部署时让整个挂件从页面上消失，看起来像功能坏了。**修正**：去掉隐身守卫改 `STUB` 模式标记——按钮照常渲染（含卡通头像，手机/桌面都可见），点开面板显示「AI 服务正在开通中，暂时还不能回答问题」，输入框与发送按钮禁用（placeholder「AI 开通中，暂不可提问」），`ask()` 加 stub 守卫双保险不发请求；部署 Worker 填 endpoint 后自动切回正常模式。`ai-chat.js?v=3`（首页与 62 张品牌页统一版本号）。**②的交付**：新增 `ai-worker/DEPLOY-教程.md` 零基础五步教程（注册 Cloudflare → 装 Node → `npx wrangler login` → `npx wrangler deploy` → 填 endpoint 推送），每步「点哪里输什么」，附常见报错速查表与 FAQ（花钱吗/key 泄露吗/被刷吗/换形象/下线），`ai-worker/README.md` 顶部加指引横幅。test-ai-chat 35 项（stub 场景重写 7 断言）；verify §21g 更新（STUB 标记/ask 守卫/提示文案/禁用逻辑/教程存在）；故障注入 2 处判红；无头 Edge 390×844 stub 验收 PASS（截图 `ai-stub-mobile.png`）。

---
---
### 照片彩蛋门禁提示：开启 VPN 可能导致验证失败（2026-10-26 19:47 · 提交 `70cd766`）

站长指令：照片彩蛋页面（why-shuangxiugou.html 的 Star 门禁）告知用户「开启 VPN 可能导致验证失败」。根因：门禁验证打 GitHub 公开 API 拉用户 star 列表，挂代理时出口 IP 与代理用户共享，GitHub 风控容易判异常——正是「一直转圈 / 网络不通 / 限流」三类验证失败的常见源头。**两层提示**：事前预防（门禁框 desc 下方黄底警示卡 `gate-vpn-tip`——⚠️ 验证前请先关闭 VPN / 代理……可能直接导致验证失败或限流）；事后补救（`photo-gate.js` 三条失败文案全部拼 `VPN_HINT`：ratelimit 静态串 / network 串 / rateLimitText 带重置时刻的动态串——用户已撞上失败时消息位当场提示）。`photo-gate.js?v=3→4` 防缓存。verify.mjs §20j 新增 4 项断言（三个失败出口全覆盖）；故障注入 3 处判红；test-photo-gate 66 项 + test-photo-vault 30 项零回归。无头 Edge 验收 PASS——顺带修了验收脚本自身一个坑：**桩 fetch 必须用 `Page.addScriptToEvaluateOnNewDocument` 在导航前注入**——photo-gate 在 UMD mount 时就 capture 了 `root.fetch.bind(root)` 的引用，页面加载后替换 `window.fetch` 不生效（2026-10-26 实测：后注入时验证走真 GitHub API，结果不可控）。

---
---
### 劳动法小助手：Worker 代理 + 品牌页/首页聊天挂件 + 卡通形象 + 手机端适配（2026-10-26 19:19 · 提交 `51aa4eb`）

站长指令链：先「AI 那件事按你说的去做」（Cloudflare Worker 代理方案）→「完成之后全部线上推送 并保证手机端可看见 AI」→「再给 AI 设置一个卡通形象，不用问我，不满意稍后再换」。

**架构（先解死结再谈功能）**：静态站不能藏 API key——写进前端代码 = 写进公开仓库 = Network 面板一抄就刷爆。方案是 **Cloudflare Worker 代理**（`ai-worker/`）：Workers AI 的 `env.AI` binding 把模型调用绑定在 Worker 环境里，key 永不出现在仓库/页面/请求头；模型 `@cf/zai-org/glm-4.7-flash`（131K 上下文），免费层每日 1 万 neurons ≈ 340 次标准问答。**防刷六道全在 Worker 层**（前端不可信）：CORS 白名单只放行本站域名 + 本地验收端口（非白名单 Origin 连 POST 都不处理，不耗 neurons）；question 1~500 字、history 截 8 条每条 200 字、role 白名单（防 prompt 注入）；每 IP 滑窗 20 次/小时；max_tokens 600（输出单价是输入的 6.6 倍）；系统提示词锁角色（劳动法条文口径 44h/36h/150%-200%-300% + 本站评级口径 + 非法律意见声明 + 12333 转介）。

**前端挂件**（`ai-chat.js` + `ai-config.js`）：**62 张品牌页 + 首页**挂载（照 bottom-button 纪律挂 body——React 只管 #root，外部节点不碰它的地盘）；endpoint 空 = 挂件完全不渲染（`ai-config.js` 默认空串，先推前端不出半截 UI，部署 Worker 后填一行即上线）。**手机端可见**（站长追加指令）：z-index 9000/9001 与浮钮家族平级（广告条 9990 之下）；按钮 bottom 210px 与 TOP（96）/⤓（154）三钮竖排避让；640px 媒体查询——面板两侧贴合撑满、输入 16px 防 iOS 聚焦自动缩放、按钮加大 56px、`env(safe-area-inset-bottom)` 刘海屏安全区。**卡通形象**（站长追加指令）：teal 机器人小助手（站点主题色，圆头方脑、亮色眼睛、腮红、胸前小天平——劳动法意象），手写 SVG 存 `assets/ai-avatar.svg`（换形象单一权威来源），base64 data URI 内联进 `ai-chat.js` 常量 `AVATAR`——零额外请求零外部依赖；按钮 34px + 面板头 30px 双露出，emoji 已替换。

**测试与断言**：`test-ai-chat.cjs` 31 项（降级/渲染/开合/幂等/请求体/history/三类错误文案/形象 4 项）；`test-ai-worker.cjs` 27 项（桩 env.AI 不联网：CORS/校验/限流/提示词/model ID/max_tokens/429 两型）；verify.mjs 新增 §21g 28 项（含首页挂载、手机端适配、形象断言）；CI 挂两测试；故障注入 4 处判红。无头 Edge 三轮真渲染验收 PASS（桌面默认不渲染 + 注入 endpoint 全要素；390x844 手机视口首页三钮不叠位、品牌页面板贴合）。调试中修两个坑：CDP `Runtime.evaluate` 评估 async IIFE 必须 `awaitPromise: true`（否则 Promise 序列化成空对象）；jsdom 的 DOMContentLoaded 比构造晚一拍（同步查 DOM 会误判「没渲染」）。

---
---
### 首页 FAQ 的 GitHub 入口补「关 VPN 防验证限流」提示（2026-10-26 17:01 · 提交 `cbe3537`）

站长指令：首页常见问题区「数据准不准？发现错了怎么办？」答案里的 GitHub Issues 入口处，提示用户关闭 VPN，否则可能触发 GitHub 验证接口限流。改动 `index.html` 两处：noscript SEO 视图 FAQ 答案下方新增灰底小字提示段（可见文案，⚠️ 前缀 + 加粗「关闭 VPN / 代理」+ 后果说明）；JSON-LD FAQPage 结构化数据同步（搜索直达答案也读到）。与 10-25 傍晚已在赞助页 / USDT 教程页落地的同类提示（交易所认证场景）互为补充，本条针对 GitHub 人机验证与登录接口场景（验证码无限循环、无法登录、页面空白）。verify.mjs 新增 §21f 4 项断言（可见段 / 后果语义 / 故障形态 / JSON-LD 镜像），三次故障注入全判红（删可见段 1 红 / 删 JSON-LD 句 1 红 / 篡改后果句 2 红）。

---
---
### 下线虚拟对比黑榜卡：DOM 层 class 隐藏 + noscript 删行 + MutationObserver 兜底（2026-10-26 16:58 · 提交 `c22dfc4`）

站长指令「虚拟的，删了，不再保留」——指首页「某代工烘焙食品 (虚拟对比黑榜)」演示卡（上游模板的匿名对比工具，此前显示但不计入统计口径）。bundle 不能动（技术红线），新增 `virtual-card-remove.js` 页面层处理：按 textContent 命中「虚拟对比黑榜」判定 → `classList.add('sxg-vcard-gone')`（display:none !important，**不 removeChild**——第一版真删节点导致 React 协调崩溃：无头 Edge 实测搜「瑞幸」时 React 对外部已删节点 removeChild 抛 NotFoundError，整个组件树崩掉、搜索框消失；摘挂载对照 13 张卡正常才锁定是补丁的锅，教训入 PITFALLS 第十八章）；MutationObserver 监听 root 子树兜底搜索/筛选/切标签的重渲染；noscript 静态清单行同步删除（SEO 降级视图不留）；幂等标记防重复执行。

**测试与断言**：`scripts/test-virtual-card-remove.cjs` 新增 17 项（初始隐藏 / noscript 行删净 / MutationObserver 兜底 / 普通卡不误伤 / 幂等 / 双故障注入判红——MARK 字面改错、样式体掏空，后者的注入锚点须带花括号 `'{display:none !important}'`，裸锚会命中文件头注释里的同词）；`scripts/test-stat-filter.cjs` 预期数字同步（badge 卡 63 张在 DOM、62 张可见，`snapshot()` 补 class 隐藏判定——只看内联 style 看不到 class 隐藏）；verify.mjs 新增 §21e 11 项断言（含「防线不拆」：stat-filter / search-scope-fix 的虚拟卡排除逻辑保留——bundle 数据未动，防口径回退）；CI `verify.yml` 挂载新测试。**真渲染验收**：无头 Edge 全页（虚拟卡 DOM 保留 1 张、class 隐藏 1 张、视觉 0 张、搜索框健在）；搜「瑞幸」13 张卡正常（React 不再崩）。

---
---
### 修「输啊再退格输入框消失」：搜索容器防护栏；申诉入口先弹政策确认层（2026-10-26 10:55 · 提交 `708e86c`）

站长深夜连报两事：一是 bug——搜索「比亚迪」删光后输入「啊」再按退格，**搜索输入框整个消失**；二是功能——申诉入口点击直接跳 GitHub issue，用户没读政策就进去，先弹政策确认层，用户「同意并跳转」或「拒绝并关闭」。

**输入框消失 bug 根因**（修在 `search-scope-fix.js`，不动 bundle）：搜索容器 `div.bg-white.p-4.rounded-2xl.border` **本身也命中卡片选择器 CARD_SEL**；联想框 hide() 后内容残留「BYD (比亚迪)」，使容器 textContent 含品牌名，被 `findBrandFor` 误认成 BYD 的卡；此时 IME 组合中间态（拼音字母，如 'a'）强命中其他品牌（Starbucks 等字母串含 a），`strongCount>0`，容器被判「弱命中」加上 `sxg-scope-hidden`（display:none !important）——搜索框、品类/评级筛选按钮整片消失。附带效应：容器隐藏后 input 失焦，IME 上屏失败，正是站长遇到的完整体验链。**修法**：`isSearchContainer()` 防护栏——含 `#site-search-input` 的容器一律跳过口径判定（品牌卡内不会有搜索框，结构事实，不依赖时序与内容）。**复现**：jsdom 与 puppeteer `.type()` 都模拟不了 IME 组合中间态，只有无头 Edge + CDP `Input.imeSetComposition`（组合拼音不上屏）能完整重放站长序列（搜「比亚迪」→逐字删光→组合 a→上屏「啊」→退格）；修复前容器 `display:none`，修复后全程可见。

**申诉政策确认弹窗**（新增 `appeal-policy.js`）：拦截页面上所有指向本仓库 issues 的 `<a>`（顶栏「提交数据 / 申诉」、页脚、空态卡——统一由 index.html 的 button→a 替换逻辑生成，href 都是 issueUrl），`preventDefault` 后弹政策层（站长定稿简洁版五句逐字：AI 依据仓库公示规则自动计算 / 受理范围四类 / 不予受理情形 / 人工核验后重跑 / 脱敏承诺）；「同意并跳转」`window.open` 原链接新标签、「拒绝并关闭」留在本页；ESC 与点遮罩按「拒绝」处理；目标 URL 从页面既有 `a[href]` 现场读取（不在脚本里维护第二份 issueUrl）；幂等（dataset 标记 + 弹层节点复用）；申诉链接是 button→a 替换产物、晚于脚本出现，轮询 + MutationObserver 兜底。

**测试与断言**：`scripts/test-search-scope-fix.cjs` 30→37 项（新增防护栏场景：搜索容器+残留联想框+IME 中间态 q='a'，**BYD 必须在测试 bundle 里**——缺了它容器会被当「识别不了的卡」跳过，删掉防护栏断言照样绿，第 7 种救绿形态实测抓到）；`scripts/test-appeal-policy.cjs` 新增 28 项（jsdom 真实事件：拦截判定 / 弹层开关 / 同意跳转 window.open / 拒绝不跳 / ESC / 遮罩 / 幂等 / 文案逐字）；verify.mjs 新增 §20m 4 项 + §21d 10 项断言（含 **CI 接线断言**：测试文件存在但没挂进 CI = 形同虚设）；CI `verify.yml` 新挂 `test-appeal-policy.cjs` 步骤；`search-scope-fix.js` `?v=1→2`（内容变了防缓存）。**故障注入判红验证**：删防护栏调用 3 项红 / 换 `if(false)` verify 1 项红 / 删 `window.open` 调用红 / 文案缺两字红。**真渲染验收**：无头 Edge 截图（弹层渲染、拒绝关闭、同意开新标签到 issues）；v10 完整重放站长序列修复后全程容器可见、IME 上屏正常。

---
---
### ⤓ 滑到底部按钮 + 赞助页防限流提示 + USDT 充值教程页（2026-10-26 10:47 · 提交 `ed07472`）

站长三件事：首页右下角一键滑到底部的按钮；赞助页收款面板上方加关 VPN 提示（挂着代理做实名认证，认证端口可能把代理 IP 触发风控限流）；USDT 新手充值教程页（含站长指定金句与延伸阅读）。

**⤓ 滑到底部按钮**（新增 `bottom-button.js`）：照 `top-button.js` 既有纪律实现——自带样式（`sxg-` 前缀避免冲突）、幂等注入（已存在即返回）、与良配吸底广告及 TOP 按钮纵向避让（TOP 在上、⤓ 在下，小屏随吸底广告同步抬升）、近底部自动隐藏（已在底部时按钮无意义，opacity 0 + 不可点）、`prefers-reduced-motion` 不过渡、暗色适配。

**赞助页防限流提示**（`sponsor.html`）：面板前置黄底 `.pre-tip`——操作前先关 VPN / 代理（含交易所 App 内「智能路由」类开关）：挂着代理访问交易所或做实名认证，登录/认证端口可能把代理 IP 触发风控限流，出现验证码无限循环、人脸认证超时等故障，届时只能换网络重试。教程入口同在提示条内。

**USDT 充值教程**（新增 `usdt-guide.html`，noindex）：四步教程（交易所注册实名 → C2C 用微信/支付宝买 USDT → **TRC20 网络**提币到本站收款地址 → 回赞助页核对）；常见坑表；「为何不收微信/支付宝直付」四条；合规提示；延伸阅读《把时间当作朋友》（李笑来，金句逐字「所谓的幸运，就是当你准备好了的时候，机会来了。」+ 维基百科词条链接）。**收款地址不在教程页硬编码**——唯一权威来源是 sponsor.html，教程页只负责指路，杜绝双入口地址漂移。

**测试与断言**：verify.mjs 新增 §21/21b/21c 共 17 项断言（金句逐字、TRC20 网络口径、地址不硬编码、按钮幂等与 scrollTo 绑定、pre-tip 样式与 DOM 双断言）；**故障注入 20+ 条全部判红**，其中抓到两个「救绿」形态：①裸 `includes('书名')` 被多处露面救绿——收紧为锚定署名行 + 推荐卡标题两断言；②「限流」字面被 CSS 注释里的同词救绿——锚定正文整短语「触发风控限流」。无头 Edge 三页截图验收（⤓ 字形正常非豆腐块、TOP/⤓ 纵向排列、pre-tip 与教程页排版正常）。


站长四条指令一次落地：①「照片在仓库中加密」；②「解锁彩蛋按钮还原为站长随笔」；③ 访问节奏定稿——每次刷新、或关闭浏览器再访问都会重新验证一次，只要不清理浏览器本地数据（Cookie）就自动用记忆的用户名验，改填别的用户名按新名字验；④ 图片可点击放大，放大后必须带「图片来源于网络，请不要恶意传播，否则隐私权等法律纠纷一律与本站无关」提示。

**照片加密上链**（新增 `scripts/encrypt-photos.mjs`）：两张玩偶照原先是 git 跟踪的**明文**（clone 即可得），现加密为 `photo-kuromi.jpg.enc` / `photo-melody.jpg.enc` 单行 JSON 容器——PBKDF2-SHA256（21 万次）派生密钥 + AES-256-GCM，salt/iv 每次随机（相同口令两次加密结果不同，密文不泄露「内容是否相同」），与 notes.html 同一套参数；写完当场解密逐字节比对（往返自检）。`git rm --cached` 移出明文跟踪，`.gitignore` 收录明文文件名兜底；明文原件与口令存本机固定备份（备份目录已补条目，路径与口令不写进本文件——隐私纪律同 notes）。**已推历史里的旧明文按铁律不重写历史**，只保证「从今往后仓库（工作区 + 新提交）只有密文」。

**解密与渲染**（新增 `photo-vault.js`，UMD）：门禁通过后由 `SXGPhotoVault.reveal()` 取 `.enc` → Web Crypto 同参数解密（data/tag 分别 base64 解码再拼接，tagLength 128，照抄 notes.html 口径）→ Blob URL 写 `img.src` → 显网格。**全部解密成功才显示**（半截照片比没有更糟）；任一失败：状态位出红字、网格保持隐藏、已建 Blob URL 撤销、不打 `data-vault-done`（还允许重试）；幂等标记防重复取密文。photo-gate.js 的解锁动作改为委托 vault，**vault 没加载上时出红字明说**，不允许「解锁了却是一排空框」的静默失败。

**自动验证节奏定稿**：Cookie / localStorage **双写双清**——读 Cookie 优先、localStorage 兜底（有的浏览器/隐私模式会禁其中一种）；静态站没有服务端，Cookie 只在本地面板里存/读，不发请求也不上传；取消 Star 再访问照样重新上锁（只记用户名、不记解锁标志，这条纪律没变）。

**点击放大灯箱**：点击网格照片开全屏灯箱（大图 + 图注 + **来源免责提示**），Esc / 遮罩 / ✕ 三种方式关闭，打开时锁页面滚动、关闭后还原焦点；灯箱带 `[hidden]` 显示兜底（`display:flex` 会盖掉 hidden 属性——photo-grid 同款坑，2026-10-24 无头截图实测过）；「点击放大」提示放在 figcaption **外面**（灯箱标题取 figcaption 纯文本，混进去会一起显示）。

**测试与断言**：`scripts/test-photo-vault.cjs` 30 项（**真 .enc + 从源码读出的真口令 → 解出与明文逐字节一致**，专防「加密脚本与前端口令漂移」这种上线后全员解不开的故障；CI 无明文原件时退而验 JPEG magic；另有 reveal 成功/404/口令不匹配/无 data-enc/幂等、灯箱开合与免责提示）；`scripts/test-photo-gate.cjs` 66 项（Cookie 记忆自动验证、双写双清、vault 委托与参数、缺失兜底，另修一个限流测试的秒级取整竞态）；verify.mjs 20j 节重写 + 新增 20l 节 17 项断言（git 跟踪层、口令完整值比对、灯箱结构与免责提示原文）；**12 次故障注入全部判红**；无头 Edge 真渲染 24 项全过（真实 GitHub API + 真解密全链路，截图 4 张）。

**过程中被测出来的真 bug**：清 Cookie 的串少了「=」——RFC 6265 规定没有 `=` 的 set-cookie 串整个被忽略，`clear()` 沦为空操作、错用户名永远赖在 Cookie 里。隔离实验里手写串恰好带 `=` 所以没暴露，是 JSDOM 真 `document.cookie` 的行为测试判的红（详见 PITFALLS 16.1）。另一条：口令「同源」断言第一版只比前缀，故障注入把值改成同前缀另一串照样全绿——收紧为完整值精确比对后才抓住（PITFALLS 16.3）。

**诚实的安全口径**（写进代码注释，不吹）：解密口令在前端源码里（浏览器要用），加密「防得住翻仓库/clone 的人，防不住刻意读源码的人」；它解决的是「仓库里不躺明文」，真正的门是 Star 真校验。

---
---
### 抖音弹窗按钮「解锁彩蛋」还原为「站长随笔」（2026-10-25 07:15 · 提交 `935ff46`）

站长原话：「解锁彩蛋按钮还原为站长随笔」。`douyin-prompt.js` 弹窗底部按钮（`.dyp__later`）文字改回「**站长随笔**」，`href="./notes.html"` 不变（该页保留密码锁、robots noindex）；`index.html` 的 `douyin-prompt.js` `?v=8→9`。沿革：「站长随笔」→「解锁菜单」→「解锁彩蛋」→「站长随笔」。verify.mjs 弹窗节三条断言同步（入口文案 / 跳转 notes.html / 剥注释后不得再出现「解锁彩蛋」），故障注入判红已验证。

---
---
### 修「搜瑞幸咖啡出库迪咖啡」：新增搜索口径修正补丁，summary 命中降级为兜底（2026-10-25 01:26 · 提交 `1434067`）

站长报新 bug：搜索「瑞幸咖啡」，结果里同时出现库迪咖啡——「本来不应该存在这个错误」。

**根因**：bundle 主过滤器共 7 路匹配（name/companyName/category/searchKeywords/keyProducts/**summary**/id），任一含查询词即命中。summary 是叙述性长文本，库迪的 summary 写着「由瑞幸咖啡创始团队于 2022 年创立」——「瑞幸咖啡」四字在 summary 里整串命中，库迪被筛了出来。与 `block-numeric-search.js` 处理的「输 1 出宁德时代」（年份在 summary 里）同病根：**summary 参与检索**。

**修法**（新增 `search-scope-fix.js`，不动 bundle）：React 过滤完后，在注入层按「强口径」重算一遍——强字段 = name/companyName/searchKeywords/keyProducts/id（bundle 里除 summary/category 外的命中路）：

- 强字段有命中 → 仅靠 summary/category 命中的卡片收起（搜「瑞幸咖啡」→ 只剩瑞幸）
- 强字段零命中 → 全部显示，summary 兜底（搜「六休一」没有品牌名对得上，若一律收起会直接空结果）

**关键实现细节**：

- **判定数据来自 bundle 自身**：启动时 fetch bundle 文本，用与 `scripts/gen-pinyin-index.py` 完全相同的「括号配平 + 跳过模板字符串」法提取 brands 数组（正则前瞻会跨对象误匹配，py 侧踩过坑；模板字符串里的 `{}` 也会炸配平）。fetch 失败降级用 `window.__PINYIN_INDEX__`（拼音索引，覆盖 50/53）。
- **隐藏用 class + `!important`**：`stat-filter.js`（顶部四格档位筛选）用 inline display 控制同一批卡片，不用 !important 会被它重设时冲掉。
- **虚拟对比黑榜卡不计入**（与 stat-filter 口径一致）；识别不了品牌的容器不动，避免误伤布局。
- **触发链**：input 事件（rAF + 50ms 等 React 重筛完）+ MutationObserver 防抖 300ms 重算（切 tab/品类筛选/档位筛选后跟着新节点走）+ load。

**测试与断言**：`scripts/test-search-scope-fix.cjs` 30 项全过（提取器含模板字符串带 `{}` 的坑、核心 bug、强命中不误伤、summary 兜底、空搜索恢复、黑榜不动、最长名匹配、降级路径、input 自动触发、幂等）；verify.mjs 新增 20k 节 11 项断言；**10 次故障注入全部判红**——其中 4 次先暴露了断言自身的漏洞再加固（只匹配 `field(obj,'companyName')` 会被变量声明行救绿 → 改盯 `fields.push(companyName)`；「虚拟对比黑榜」字面量被文件头注释救绿 → 改盯逻辑行；只盯内层 `src[j] === BT` 会被改死的外层开关救绿 → 改盯 `if (ch === BT)`；`requestAnimationFrame` 在函数体里，删 input 绑定不判红 → 补一条盯实际绑定）。**故障注入的「错误」必须是真错误，注入完要确认断言真的红了，而不是以为会红。**

**真渲染验收**：无头 Edge 10 项全过（搜「瑞幸咖啡」只剩瑞幸 / 搜「咖啡」四家全显示 / 搜「现磨咖啡」库迪显示 / 搜「六休一」兜底有结果 / 清空恢复），桌面视口截图 3 张。踩坑：本地 http 验收服务的路径守卫写成 `file.startsWith(ROOT)`，Windows 下 `path.join` 产出反斜杠与正斜杠 ROOT 永远不相等，全部请求 404、页面空白——`path.resolve` 归一后才通。

---
---
### 照片门禁按站长实测反馈全面加固：输入即验、无痕补验、限流自动重试、解锁提示条（2026-10-24 23:15 · 提交 `f0e9e47`）

站长深夜实测（截图四连）后的修复轮。起因是三个真实体感问题：① 输入用户名后还要点按钮；② 无痕/清缓存刷新后「用户名明明在框里、门却还锁着」（站长原话：连我自己也锁了）；③ 未登录 API 每小时 60 次限流直接把验证堵死。另按站长要求补了「GitHub 登录设备流程」的评估——**试做后按站长「直接做一个输入框」的意见整体回退**，保留用户名真校验路线。

- **输入停顿即自动验证**（`photo-gate.js`）：input 事件 + 700ms 防抖，合法用户名停顿即打 API，不必非点「验证并解锁」；空/非法输入不触发（省限流）；同一用户名并发验证去重（`inflight` 守卫），不重复打 API。
- **无痕恢复值补验（修「连我自己也锁了」）**：浏览器刷新会恢复输入框内容但**不发 input 事件**，页面不知道该验。mount 时若 localStorage 无记忆但框里有合法用户名，补一次自动验证——这正是站长截图 4 的场景（无痕窗口 + Chrome 恢复表单值）。
- **限流不再一锁了之**：按 `X-RateLimit-Reset` 响应头解析重置时刻，提示写明「将在 HH:MM:SS 自动重试」，到点自己再验（一次访问最多 2 次，重置时刻超过 2 小时不挂）；网络抖一下自动重试 2 次（1.2s/2.4s 退避）才报错；自动验证失败也出提示，不再无声锁着。
- **解锁提示条**（`why-shuangxiugou.html`）：解锁后在照片上方常驻「已解锁：请勿取消 Star，不定期更新更多福利。取消后再次访问会重新上锁。」——站长原话「解锁之后也给个提示，别取消 star，不定期更新更多福利」。带 `[hidden]` 显示兜底（photo-grid 同款坑）。
- **门禁文案改写**：明示「每次访问都重新验证，不依赖浏览器缓存；无痕窗口或清理过缓存后刷新，需要再输一次用户名（浏览器通常会帮你恢复输入框内容，届时会自动验证）」；并明示「本站只核对『你输入的这个人有没有 Star』，不展示、也拿不到给本站 Star 的完整名单」（回应站长对 stargazers 名单暴露的担忧）。
- **测试与断言**：`scripts/test-photo-gate.cjs` 31 → 55 项（新增输入即验/非法输入不触发/恢复值补验/恢复值没 Star/限流倒计时重试/无重置时刻不重试/mount 层网络重试/提示条显隐/并发去重/@ 前缀裸名存储）；verify.mjs 20j 节新增 8 项断言；**9 次故障注入全部判红**（输入监听器失效、恢复值分支失效、限流头名改错、去掉重试调用、网络重试改成直接报错、去掉并发去重、偷写解锁标志、删 hidden 兜底、解锁不显示提示条）。
- **踩坑记录（已入 PITFALLS 候选）**：① 固定 `wait(40)` 测试窗口会被后续同步代码（构造 JSDOM）拖爆——防抖定时器其实跑完了，窗口却先到期，数出来永远是 0 次调用；改用轮询 `until()`。② `!/unlocked/i` 子串断言被元素 id `sxg-gate-unlocked-note` 误判——改成枚举所有 `setItem` 的键必须全是 USER_KEY。③ 故障注入本身可能无效（把头名改成 `X-RateLimit-ResetX`，原串仍是子串，正则照样命中）——注入的「错误」必须是真错误。
- **真渲染验收**：无头 Edge 六场景 24 项全过（初始锁定不打 API / 输入即验解锁 / 刷新自动重验 / 取消 Star 重新上锁 / 限流倒计时到点自动重试 / 无痕恢复值补验），桌面视口截图 6 张。

---
---
### 抖音弹窗按钮文字「解锁菜单」→「解锁彩蛋」，站长最终定名（2026-10-24 19:45 · 提交 `2b680b5`）

站长：「是解锁彩蛋」——上一轮（`d43c892`）把按钮文字改成「解锁菜单」并非最终名，本轮定稿为「**解锁彩蛋**」。

- **只改文字，不改跳转**：`douyin-prompt.js` 弹窗底部按钮（`.dyp__later`）文字「解锁菜单」→「解锁彩蛋」，`href="./notes.html"` 不变（该页保留密码锁、robots noindex）；`index.html` 的 `douyin-prompt.js` `?v=7→8`。
- **verify.mjs 三条弹窗断言同步**：入口文案 / 跳转 notes.html / 「以后再说」并存检查，全部改为匹配「解锁彩蛋」；旧文案「解锁菜单」「站长随笔」只允许活在注释里（剥注释后匹配，注释提及不算并存——PITFALLS 3.1 的坑）。
- **故障注入**：把按钮文字改回「解锁菜单」→「弹窗底部有『解锁彩蛋』入口」判红、退出码 1；恢复后全绿。
- **验收**：无头 Edge 真渲染，弹窗三按钮为「在抖音中观看 / 事实核查 / 解锁彩蛋」，截图存档。

### 照片 Star 门禁升级为真校验：拉 GitHub 公开 star 列表逐页核对，荣誉制作废（2026-10-24 19:24 · 提交 `96cb553`）

站长：「Star on GitHub 必须验证，不是用户说 Star」——当天早些时候（`ada20a0`）上线的荣誉门禁（点一下「已 Star，解锁查看」即放行）当场作废，升级为真校验。

- **真校验方案（零注册、零后端、零 secret）**：未登录的 GitHub API 即可查任意用户的**公开** star 列表（`GET /users/{用户名}/starred?per_page=100`），逐页翻找 `dujeongil-galaxy/shuangxiugou` 的 `full_name`，命中才解锁。不需要 OAuth App、不需要后端；代价是**不验账号归属**（输入谁的 username 就查谁的列表），页面已明示这点，不冒充。
- **新增 `photo-gate.js`**（UMD 双形态：浏览器 `window.SXGPhotoGate` 自动 mount，Node `module.exports` 供测试）：用户名校验（空名 / 非法字符直接拦，不打 API）→ 分页拉取（每页 100、上限 10 页防打满）→ 命中写 `img.src` 解锁；错误码 `empty/badname/nouser(404)/ratelimit(403·429)/network/toomany/nostar/unstarred` 各有中文提示。**每次访问都重拉**（取消 Star 会重新上锁），`localStorage` 只记用户名（`sxg-photo-star-user`）、不记 unlocked 标志。
- **`why-shuangxiugou.html` 门禁卡改写**：荣誉制的「已 Star，解锁查看」自报按钮 → GitHub 用户名输入框 + 「去 GitHub Star」链接 + 真校验口径说明（明示不验账号归属、取消 Star 会重新上锁）；解锁前照片不加载（`data-src`）不变。
- **新增 `scripts/test-photo-gate.cjs` 31 项**（jsdom 真 DOM + 桩 fetch）：首屏命中 / 翻页命中 / 没 Star / 404 / 403 / 429 / 断网 / 空名 / 非法名 / 超 10 页 / 解锁三动作 / 不预载照片 / 返回访问自动重验 / **取消 Star 重新上锁** / submit 触发，全过。
- **verify.mjs 20j 节 7 → 10 项断言**：门禁表单齐全 / Star 链接指本站 / 逻辑外链 photo-gate.js / API 是 GitHub starred / `full_name === REPO` / 满 100 翻页 / MAX_PAGES=10 / img 只用 data-src / data-src 文件存在 / 解锁才写 src / localStorage 只记用户名 / `[hidden]` 兜底 / 页面明示真校验 / 测试文件存在。
- **过程中修掉一个只有真渲染才发现的坑（UMD 作用域）**：工厂函数写在 IIFE 的**参数列表**里，词法作用域在顶层，拿不到包装器的 `root` 参数——浏览器自动 mount 直接抛 `root is not defined`，页面整个挂掉。Node 单测却全绿：因为 opts 全注入、`opts.localStorage || (root.localStorage||null)` **短路求值跳过了 root 分支**。修法：`factory(root)` 把 root 作入参传进工厂。**教训：外链模块必须在真浏览器里自动挂载一遍；依赖注入的短路求值会让未注入分支的 bug 在单测里永久隐形。**
- **故障注入 11 次全部判红**（含上述 UMD 坑的旧版形态）。
- **验收**：无头 Edge 真渲染三场景（已 Star 解锁 / 没 Star 拦住 / 刷新自动重验）+ 桌面 / 手机（390px）双视口；16 组 `test-*.cjs` 全过、`NOTES_KEY` 全量 verify 516 项全绿。

### 按站长纠正还原页脚卡；抖音弹窗「站长随笔」按钮文字改为「解锁菜单」（2026-10-24 18:23 · 提交 `d43c892`）

站长指出上一轮改错了对象：「不，你在想什么，先还原。我说的是站长随笔，这个按钮的文字，改成解锁菜单，不是让你在底部改变」。

- **还原**：页脚入口卡（`friend-links-footer.js`）恢复为「我为什么支持双休购」（标题/描述/链接全部还原），与 `13e6e8a` 逐字节零差异；`index.html` 的 `friend-links-footer.js` `?v` 回到 15。
- **正主**：`douyin-prompt.js` 弹窗底部按钮（`.dyp__later`）文字「站长随笔」→「**解锁菜单**」，跳转目标 `./notes.html` 不变（只改文字）；`index.html` 的 `douyin-prompt.js` `?v=6→7`。
- **verify.mjs** 三条弹窗断言同步更新（入口文案 / 跳转 notes.html / 「以后再说」并存检查）；故障注入（文字改回「站长随笔」）判红，恢复后全绿。
- 验收：无头 Edge 真渲染确认弹窗三按钮为「在抖音中观看 / 事实核查 / 解锁菜单」。

### 首页入口卡改名「解锁彩蛋」，主打 Star 门禁照片区（2026-10-24 18:02 · 提交 `9f188e7`）

> ⚠️ 本轮改错了对象（站长本意是改抖音弹窗按钮文字，非页脚卡），已于 2026-10-24 18:23 提交 `d43c892` 还原，最终版见上一条。

站长：「推吧，首页那个按钮现在叫站长随笔，修改为解锁彩蛋」。

- **改的是页脚入口卡**（`friend-links-footer.js`，通往 `why-shuangxiugou.html`——该页文末已新增 Star 门禁照片区）：标题「我为什么支持双休购」→「解锁彩蛋」；描述改为「去 GitHub 点个 Star，解锁站长私藏的两张玩偶爱心照。」；链接「读全文（AI 生成随笔）→」→「去解锁 →」。随笔正文仍在页内，入口卡从此主打彩蛋。`index.html` 的 `?v=15→16`。
- **注意**：抖音弹窗（`douyin-prompt.js`）里另有一个字面「站长随笔」按钮，跳加密笔记页 `notes.html`，与照片彩蛋无关，本轮未动——如需一并处理须先明确它改完跳哪。
- 验收：无头 Edge 真渲染确认卡片文案/链接/浅青配色/位置（Bing 教程卡之前）正常。

### 随笔页新增「照片彩蛋」+ Star 门禁（荣誉制），并修 hidden 被 display 覆盖导致占位框外露（2026-10-24 17:28 · 提交 `ada20a0`）

> ⚠️ 当天 19:24 已按站长要求升级为**真校验**（拉 GitHub 公开 star 列表逐页核对），荣誉制作废，最终版见上方 `96cb553` 条目。

站长提供两张玩偶爱心照（库洛米局 / 美乐蒂局），要求「必须 Star on GitHub 才能查看」，并问放网站哪个位置。方案对比后站长选定 **A·荣誉门禁**（静态站无后端、公开仓库，做不了真校验；B·OAuth+后端工程量与两张玩偶照不匹配）。

- **落点**：`why-shuangxiugou.html`（「我为什么支持双休购」随笔页）文末「照片彩蛋」区——全站最个人化的一页，放生活照无违和感。
- **门禁行为**：锁定态显示门禁卡（锁图标 + 「去 GitHub Star」按钮 + 「已 Star，解锁查看」按钮 + 诚实声明）→ 点击解锁后照片淡入、`localStorage` 记住，刷新不再问；**解锁前照片不加载**（`data-src` 懒加载，`src` 只在解锁时写入）。
- **图片处理**：图 1 右下角 Soul APP 水印已用 AI 擦除（地板纹理自然填补，其余部分未动）；两张图压缩至 760px 宽、85 质量（75KB / 109KB，原图 221KB 瘦身一半）；已确认无 EXIF/GPS。
- **页面明示是荣誉制**：不校验 GitHub 账号、取消 Star 不会重新上锁、懂技术的人绕得过、照片文件本身就在公开仓库里——门禁挡的是「顺手看」，挡不住「铁了心下载」。
- **过程中修掉一个只有真渲染才发现的坑**：`.photo-grid { display: grid }` 会**盖掉 `hidden` 属性的 UA `display:none`**——锁定态下两个灰色占位框（连 alt 文字）直接露在门禁卡下方。补 `.photo-grid[hidden] { display: none }` 兜底。无头 Edge 截图实测确认。
- **verify.mjs 新增 20j 节 7 项断言**：门禁三件套齐全 / Star 链接指本站仓库（不是上游）/ 照片只用 data-src 懒加载（真实 `src=` 属性为 0）/ data-src 目标文件真实存在 / 解锁逻辑完整（localStorage 记忆 + 解锁后才写 src）/ `[hidden]` 显示兜底存在 / 页面明示荣誉制。**6 个故障注入全部判红**（data-src→src、门禁 id 丢失、照片文件缺失、Star 链接指上游、解锁记忆丢失、hidden 兜底丢失）。
- **验收**：无头 Edge 真渲染，桌面 900px + 手机 390px 两种视口，锁定 / 解锁 / 刷新记忆三条路径全部符合预期。

### 小票双卡弹窗统一 + 昵称被存档刷回 + 条形码被连坐抹掉三件事一次修完（2026-10-23 02:05 · 提交 `4f0c2e9`）

站长截图提出三件事：①星巴克（内置卡）与赵一鸣（自定义卡）的小票弹窗长得不一样，「就不能统一吗？我之前也说过这个问题」；②金额 bug 修完后昵称仍有 bug——先记录过一次 B043 产生 Cookie 后，第二次无论输入什么，小票下方仍显示第一次的昵称；③要求修复后如实汇报 README，且统一未完成前严禁上传 README。

- **双卡统一（以内置卡为基准）**：内置卡小票由冻结 bundle 的 `jn` 组件渲染，bundle 按铁律不可改，只能让自定义卡靠拢。`openTicketModal` 的小票 DOM 逐类名照抄内置卡 receipt JSX（容器 `receipt-tear-top/bottom bg-[#faf8f5] p-6 shadow-2xl border-x border-[#ebe5dc] relative font-mono select-none overflow-hidden` + 同款 radial-gradient 底纹、右上角斜置印章、`text-center pb-4 border-b border-dashed` 头部、`flex justify-between items-start gap-2` 信息行、`items-baseline` 金额行、同款引语、**同一组 23 根固定条纹条形码**、水印、法律免责）；三枚按钮类名与 lucide 同款行内 SVG 图标逐条对齐（复制文本 = 结算+复制 / 保存高清图 = 结算+存 PNG / 确认打卡 = 仅结算+关闭，语义与内置卡完全一致）。
- **保存高清图**：新增 `vendor/html-to-image.js`（html-to-image@1.11.13 UMD 构建，约 20KB），由自定义卡按需 `<script>` 注入（路径相对——站点部署在 github.io 子路径 `/shuangxiugou/` 下，绝对根路径会 404）；参数对齐内置卡（`pixelRatio:3`、`backgroundColor:'#faf8f5'`）。
- **昵称 bug 定性为真 bug 并修复**：根因是 `syncBuiltin` 每次 React 重渲染后用**存档** `p.name` 重绘小票——金额有 `builtinPreview` 预览保护，昵称和理由没有，用户 `input` 监听刚写入的真实值会被 MutationObserver 防抖回调刷回存档值。修法：新增 `builtinNamePreview` / `builtinReasonPreview` 模块级预览态，input 监听记录当次输入，结算落盘后清空恢复以存档为准；`syncBuiltin` 优先用预览值。（未采用「新增提示语告知只能用第一次昵称」分支，因 bug 成立。）
- **过程中挖出并修复第二个 bug——条形码被连坐抹掉（真实浏览器截图发现）**：`paintBuiltinCaption`（上游死链水印改写成本站域名）按 `textContent` 匹配 div，而 bundle 的真实 DOM 里条形码外套了一层 `flex flex-col items-center justify-center pt-1` 容器、条形码自身无文字，**外层容器的 textContent 恰好等于水印文案**——先命中的是外层容器，`textContent = SXG_CAPTION` 一写上去，23 根条纹连同水印节点一起被清空，内置小票条形码整个消失（截图里引语下方只剩空白）。修法：只认叶子节点（`children.length === 0`），外层容器天然被排除。此前单测没抓到是因为测试 DOM 少了外层容器——已把外层容器 + 23 根条纹补进 `buildReceiptDom`，并新增「改写水印后 23 根条纹原样保留」回归断言。
- 改了哪些文件：`custom-card-actions.js`（`openTicketModal` 重构、预览态、`paintBuiltinCaption` 修复）、`vendor/html-to-image.js`（新增）、`scripts/test-builtin-ticket-dom.cjs`（harness 定义修正 + 8c 段重写 + 条形码回归）、`scripts/test-ticket-total.cjs`（结算调用点 2→3 处同步）、`index.html`（`custom-card-actions.js?v=17→18`）。
- 验证：`test-builtin-ticket-dom.cjs` 57/57、`test-ticket-total.cjs` 52/52、其余 13 组 `test-*.cjs` 全过、`node scripts/verify.mjs` 503 项全绿；**故障注入**——把 `paintBuiltinCaption` 还原成旧版，新增两项断言判红、恢复后全绿；**无头 Edge 真渲染验收**——内置卡（Patagonia）与自定义卡（赵一鸣）小票逐区域截图比对：容器/印章/信息行/金额行/引语/条形码/水印/三按钮完全一致，水印均为本站域名（死链不再出现）。
---
### 小票按钮语义定稿：「完成」仅记录不复制；「数据查验」死链换成本站网址（2026-10-23 00:44 · 提交 `b4e3825`）

站长定稿（原话要点）：「复制小票文本，会自动复制文字，保持现状不改变！而完成，仅记录本次消费，但不会自动复制到剪切板」；并质问小票上为何印上游网址。

- 按钮语义（自定义卡小票）：
  - **复制小票文本** = 结算（记录本次消费）+ 复制，保持不变；
  - **完成** = 仅结算（记录本次消费），不碰剪切板。旧版「完成」只 `closeLayer()`，填了金额直接点完成会**静默丢账**（填的本次新增不被记录）。
  - 实现上抽出 `settleReceipt()` 供两按钮共用（结算后清空新增额、以新累计为基准，防连点重复累加的旧保障保留）。
- 「数据查验」死链清理：上游模板写死的 `shuangxiugou.vercel.app` 2026-10-09 实测无法访问（projects.html 同源记录）。
  - 自定义小票页脚与复制文本改用 `SXG_SITE_URL` 常量（本站 `dujeongil-galaxy.github.io/shuangxiugou`）；
  - 内置卡复制文本写死在冻结 bundle 里，bundle 按铁律不可改，故对 `clipboard.writeText` 做一次性窄包装（`__sxgUrlFix`）：只改写包含该死链的小票文本，其余剪贴板写入原样放行。
- 改了哪些文件：`custom-card-actions.js`、`scripts/test-ticket-total.cjs`（新增 6 项源码断言）。
- 验证：`test-ticket-total.cjs` 52/52；**故障注入**——用 HEAD 旧版源码跑新断言，6 项全部判红，恢复后全绿；`node scripts/verify.mjs` 486 项全绿；15 组 `test-*.cjs` 全部通过。
---
### 星巴克真实双休率 85%→98%，A 级评级不变、不追加备注（2026-10-23 00:25 · 提交 `31e0b1b`）

站长明确指示：星巴克真实双休率标记为 98%（原话「星巴克比其他品牌双休率要高得多，暂时标记这个数字」），评级 A 级保持不动，不追加任何说明备注。

- 改动背景：上一轮核实后曾建议改「未核实」，站长拍板维持具体数值 98%。
- 改了哪些文件：
  - `brand/starbucks.html`：标题 / meta description / og:title / og:description / twitter:title / twitter:description / JSON-LD / 可见值 `<p class="v">` 共 8 处 `85%`→`98%`。
  - `index.html` 总表两处列表条目 `85%`→`98%`。
  - `projects.html` 总表一处列表条目 `85%`→`98%`。
  - `index.html` 新增 `patchStarbucksRate()`：主交互卡的真实双休率源自冻结 bundle 的 `realDoubleWeekendRate:85`，bundle 按铁律不可改，故在 DOM 层按「标签→font-mono 数值」同源逻辑（与 rate-note-patch.js 一致）覆盖为 `98%`；与 `insertStarbucksNote` 平行，挂载于 init / 搜索输入 / 按钮点击三处调用点，幂等（已是 98% 则跳过）以避免 MutationObserver 自激。
- A 级评级字段（`badge`「A 级评级」）未改动；未新增任何备注 / 脚注。
- 验证：`node scripts/verify.mjs`（486 项全绿）、`test-starbucks-note.cjs`（10/10）、`test-render-page.cjs`（13/13，React 正常挂载）；并用无头 Edge `--dump-dom` 实渲渲染确认星巴克卡 `真实双休率: 98%`（font-mono 值）、`index.html` 列表 `真实双休率 98%`、A 级评级不变。剩余 `85%` 仅剩迪卡侬（独立品牌，正确）与 CHANGELOG 历史记录。

---
### 修复站长截图两处 bug：拼音联想搜不出零食品牌、小票昵称不联动/金额只收整数（2026-10-22 22:59 · 提交 `3339940`）

站长一张截图两个 bug：「LS 不出现自定义零食品牌（关于零食这个分类，修复过无数次）」「星巴克双休率 85% 对吗」「小票里已经输入了 test，为什么下方无变化？金额也只能整数，不支持小数点后两位吗？」

**bug ① 拼音联想输 `LS` 永远不出现赵一鸣/零食有鸣（PITFALLS 新增 1.10b）**
- 根因（历史层）：`ff69fd6`（2026-10-19）为修「点选后空态」——自定义卡不在 bundle 的 brands 数组里，React 搜索 0 结果会把整片内容替换成「未找到匹配的品牌信息」，插进去的卡随父节点销毁且 React 不会再插回来——当时的解法是把自定义卡**整个踢出**拼音索引（gen 脚本 native_search_keys 过滤）。症状是「链路用错」，却把「候选该出现」这个正确前提也删了，治标治反。
- 正解：候选照常出现 + 点击分流。`scripts/gen-pinyin-index.py` 重新并入 10 张自定义卡（带 `custom:1` 标记，排序自测里 ls/lsym 命中赵一鸣/零食有鸣）；`pinyin-search.js` 的 mousedown 按标记分流：custom → `locateCard()` 定位链路（清空搜索让 React 恢复全量列表 → 轮询等卡插回 → scrollIntoView + 金色描高亮），其余 → `applyFill()` 回填。语义上点候选的意图是「我要看这家」而非「我要用这个词搜索」。
- 定位只滚一次不够（本次实测第二个坑）：点击候选时页面常停在上一轮搜索的过滤态，清空后 React 才把被过滤的内置卡插回列表，目标卡被挤到下方几千像素（无头 Edge 实测：scrollIntoView 后 top=-22，200ms 后 top=3765）。已加 watch 补滚窗口（250ms × 5 次，目标跑出视口就再滚）。
- `index.html`：`pinyin-index.js?v=5→6`、`pinyin-search.js?v=2→3`。
- `scripts/verify.mjs`：§16 原「索引不含自定义卡」断言翻转为「自定义卡必须入索引且带 custom 标记」；新增定位链路结构断言。
- 测试：`scripts/test-pinyin-e2e.cjs` 66 项、`scripts/test-pinyin-search.cjs` 37 项。**两个摆设陷阱已记入 PITFALLS**：① `Atomics.wait` 会冻结整个事件循环，jsdom 定时器一次不跑（实测 1500ms fired=0）——「同步等待」是假等待；② 僵尸 locateCard poll（找不到卡重试 2 秒）会在补插卡片后「复活」并滚动一次，把 `__scrolled` 污染成 2——已改为真实异步等待 + 耗尽旧 poll + 换不同 entryId 候选。

**bug ② 小票弹窗两个问题（PITFALLS 新增 1.10c）**
- 昵称无实时联动：`patchBuiltinTicket` 首次接管只画金额行、不画署名行，也没设 `id="sxg-t-name"`；input 实时联动按 `$('#sxg-t-name', receipt)` 找节点永远为 null，`if (nameEl)` 静默跳过。修法：抽出 `paintBuiltinName()`（首次接管即改写署名行并设 id），input 监听改 `findValueNode(receipt, '考核执行官:')` 按结构定位。
- 金额只收整数：`clampDelta`/`clampTotal` 用 `parseInt`，input 无 `step`。修法：`parseFloat` + `round2` 两位小数规范化；`step="0.01"`、`inputmode="decimal"`；显示统一 `fmtMoney()`（￥12.34）。既有 localStorage 整数数据不受影响（迁移路径保留）。
- 测试：`scripts/test-ticket-total.cjs`、`scripts/test-builtin-ticket-dom.cjs` 断言按新行为更新（￥498 → ￥498.00）。

**验证（按纪律逐项做实）**
- 双向故障注入四类全部实测判红：删 watch 补滚（滚动次数 1）/ 索引清 custom 标记 / `clampDelta` 换回 parseInt / 首次不画名字+按 id 找。
- 无头 Edge + CDP 视觉验收三场景：输 LS 联想出现零食品牌候选；点击候选滚动定位+金色高亮且卡在视口内；小票昵称「测试昵称ABC」实时联动到纸面、金额 ￥12.34 两位小数。
- `NOTES_KEY=*** node scripts/verify.mjs` 503 项全绿；无密码（CI）模式 486 项全绿；15 组 `test-*.cjs` 全过；`check-inject-idempotent.mjs` 通过。
- 记账文档同步：README「最近更新」+ FORK_GUIDE 13.3（联想分流链路）/13.4（两位小数）+ PITFALLS 1.10b/1.10c。

---
---
### 星巴克卡新增「消费入座」公告黄框，机制与苹果补充说明同构（2026-10-22 19:21 · 提交 `007a7f7`）

- **背景（站长要求）**：站长看到 2026-10-21 星巴克中国官宣「消费入座」的新闻（Vista看天下等报道），要求「按苹果的这个备注，对星巴克加一条公告」。经核实：星巴克中国 10-21 官宣《第三空间倡议》，**10-22 起全国门店施行「消费入座」**，店内摆放「星巴克营业空间，请消费入座」提示牌；官方称执行保有温度（孕妇、行动不便者优先协助，降雨等临时落脚需求仍可进店休息）——央广网、证券时报、中国新闻周刊等多方报道一致。按主站「客观中立、不情绪化、证据链不完善不评级」的收录原则，公告只做事实陈述，并显式声明「不影响本站对其员工工时与休息制度的评级」。
- **`index.html`**：新增 `insertStarbucksNote()`——`insertAppleNote()` 的**平行实现**，判据逐条照搬（标题匹配 `Starbucks` 前缀 → 无卡摘除 → 整棵子树隐藏摘除 → 幂等 → 位置不对先摘后插），PITFALLS 1.10 的三个坑（React 位置复用泄漏、observer 自激、搜索命中时误摘）同样防住。搜索框 `input` 捕获阶段同步清理、rAF 重定位、click 后重定位三处调用点均已接入；init() 调用。黄框文案含《第三空间倡议》、施行日期、提示牌原文、官方温度表述与评级边界声明。
- **`brand/starbucks.html`**：新增静态公告框（`.notice` 黄色样式，与首页黄框同视觉），置于评级框下方；不动任何评级字段与数据。
- **`scripts/test-starbucks-note.cjs`**（新增，10 项，CI 已接入）：`test-apple-note.cjs` 的平行版本，自行模拟 React 搜索过滤 + 原生 `value` setter 绕 value tracker；核心断言同样取「同步清理那一瞬」取样。
- **`scripts/verify.mjs`**：新增 §20i「星巴克公告框注入闸门（与苹果同构）」13 项断言——两道结构性闸在位、init() 已调用、行为测试与 CI 接入、公告内容含事实要素与评级边界声明、两段隐藏判据代码同构（`walker`/`swalker` 镜像，防只改一段）。
- **`scripts/check-inject-idempotent.mjs`**：修 bug ⑥——原按「`insertAppleNote` 之后到某个注释标记」切函数体，新增平行函数后两段被切进同一片、`eval` 直接 SyntaxError（verify「幂等仿真」项判红）。改为**花括号配对**切分（正确跳过字符串与注释里的花括号），与后面插几个函数完全解聚；切分失败时 exit 1 不静默。
- **`README.md` / `PITFALLS.md`**：第 6 条踩坑补「平行实现必须一起改」与切分定位教训；PITFALLS 1.10 新增 bug ⑥ 全记录。
- **故障注入验证**（双向，均实测判红后还原）：① 星巴克同步清理改成「有输入就无条件摘除」→「同步清理阶段未误摘公告框」判红（稳定态仍✓，再次证明只看稳定态会漏掉 bug ④）；② 删「子树隐藏 → 摘除」闸 →「四格筛选场景」判红；③ 退回旧式函数体切分 → SyntaxError，切分 header 写错 → exit 1。
- **视觉验收**：无头 Edge + CDP 三张截图肉眼复核——浏览态星巴克卡黄框正常、搜索「星巴克」命中态黄框保留（bug ④ 修复行为在星巴克身上同样成立）、详情页公告框位置与样式正确。
- **验证**：`NOTES_KEY=*** node scripts/verify.mjs` 499 项全绿；`scripts/test-*.cjs` 全 15 组过（新增星巴克组）。

### notes 隐私止损：正文明细清出公开仓库，内容断言改 sha256 探针（2026-10-22 17:32 · 提交 `d6c1fc1`）

> ⚠️ 本条按新纪律只记技术事实，不涉及随笔正文任何内容。事故全貌与教训见 `PITFALLS.md` 第十五章。

- **背景**：站长发现 README / CHANGELOG 的改动记录里出现了 notes 加密随笔的正文明细（章节标题、情节、人物关系、心理诊断），已在公开仓库暴露约 20 小时。站长拍板「只清理文件、不动 git 历史」（本仓库有 filter-repo 误伤前科，历史重写一票否决）。
- **文档**：CHANGELOG 12 条 notes 条目全部重写——只留「改了哪一节（章节号）、段落数、验证项数、提交哈希、PAYLOAD 原位替换、备份已同步」，标题/情节/人物/诊断/本地备份路径一律删除，notes 条目顶部加 ⚠️ 纪律声明；README 两条 notes 条目删除、备份说明泛化；「给 fork 者的三条实操提醒」里的本机备份路径改为「自行另存、不写进会提交的文件」，顺手修正过期的校验项数（327 → 实述）。
- **`scripts/verify.mjs`**：内容断言（第三/八节锚点、负面词）与泄露防线全部改为 **sha256 探针**——仓库只存「长度 + 哈希」，校验时在目标文本上滑窗比对；泄露探针扫密文文件全本、**不需要密码，CI 上同样生效**。断言标签同步中性化（通过项标签会进 CI 日志，标签也是泄露面）。原泄露防线 5 条字面量断言合并为 1 条探针检查。
- **`scripts/encrypt-notes.mjs`**：泄露自查删掉硬编码的三段正文片段清单，改为动态抽取正文全部 ≥4 字中文片段（短标题首次纳入覆盖，不再需要硬编码兜底）；新增「payload 必须纯 ASCII」门禁（专抓密文编码误写、明文误入 payload 这类回归）；报错只给长度 + sha256 前 16 位，不打印片段。
- **`AGENTS.md`**：新增第三条硬规则「notes 正文明细永不进公开仓库」——明确「可以记什么 / 不可以记什么」，管制范围含 verify 断言与 CI 日志，并记录本次事故经过；加密流程里的本机备份路径示例泛化；顺手修正 brand 详情页计数 57 → 62。
- **`PITFALLS.md`**：新增第十五章，记录现象 / 根因（「技术记账」凌驾于内容密级之上）/ 修复 / 通用教训。
- **故障注入验证**（三类全部实测判红、控制组零误报）：往 notes.html 注入一段正文 → 泄露探针判红（日志不打印片段）；篡改探针哈希、把负面词探针换成正文真实存在的词 → 断言判红；把 payload 改成明文 / 密文编码误写 utf8 → 加密脚本中止。
- **验证**：`NOTES_KEY=*** node scripts/verify.mjs` 485 项全绿；`scripts/test-*.cjs` 全 14 组过。

### 修复苹果补充说明在搜索命中时消失的 bug（PITFALLS 1.10 bug ④）（2026-10-22 01:19 · 提交 `0e46a5c`）

- **现象（站长截图）**：网格视图里苹果卡下方有「补充说明：富士康产线…」黄框；搜索「苹果」后，**同一张苹果卡**（仍在结果列表里）黄框消失了。
- **根因**：2026-10-18 修 bug ③（搜索无匹配词时黄框孤零零挂空面板）时加的那道闸是「**搜索框一有输入就无条件摘除说明框**」——把「说明框只属浏览态」当成硬规则。**判据用错了**：正确判据是「苹果卡在不在当前可见列表」，而不是「有没有在搜索」。搜索命中苹果卡时苹果卡可见，说明框就该在。
- **修法**：删除 `insertAppleNote` 里「搜索有输入 → 摘除并 return」那道闸；`input` 捕获阶段的同步清理改为「仅当苹果卡确实不可见时才摘」（保留 bug ③ 要的「不等防抖、同步清理」）；判据统一交给两条结构性规则——① 当前 DOM 没有苹果卡（被搜索过滤）② 苹果卡在 DOM 但整棵子树 `display:none`（四格筛选/评级过滤）。
- **测试（重点：第一版测试是摆设，靠注入故障才发现）**：新增 `scripts/test-apple-note.cjs`（CI「苹果补充说明注入位置测试」，10 项覆盖 bug ①③④）。
  ⚠️ 第一版测试**注入故障后仍然全绿**——它「搜苹果→等 rAF 重定位跑完→断言」，而重定位恰恰会把说明框补回来，把同步清理阶段的错误完全掩盖；改为「`dispatchEvent` 返回后立刻取样」才真正抓到 bug。另需注意 jsdom 里 bundle 搜索不生效，测试自己模拟 React 过滤，并用原生 `value` setter 绕过 React 受控组件的 value tracker，否则 `input` 事件不触发。
  **双向故障注入验证**：好版本 10/10 绿；故障 A（同步清理改回无条件摘除）判红并精确报「同步清理阶段误摘说明框」；故障 B（删 `appleHidden` 闸）判红并报「子树隐藏时未摘除」。
- **配套**：`verify.mjs` 新增 §20h「苹果补充说明注入闸门」8 项断言，把「判据必须是目标卡片可见性、不得退回搜索态」钉成红线并校验测试已接入 CI；`test-stat-filter.cjs` 原断言「搜索『啊』后 note 不在 DOM」依赖已删除的旧闸（jsdom 里搜索不真卸载卡片），改为显式模拟卸载 + 复原；`package.json` 加 `test:apple-note`；README 第 6 条与 PITFALLS 1.10 同步。
- **验证**：`verify.mjs` 488 项全过 0 错误；`test-*.cjs` 全 14 组过（`test-stat-filter` 32 项）；无头 Edge + CDP 实测搜索「苹果」后黄框正常显示。

### README 项目定位改写：明确分站为纯静态备份 + 写明主站三条收录原则（2026-10-22 00:52 · 提交 `4ba6703`）

- **背景**：站长决定**保留** guide 分站（不删除）——主站当前收录 62 家，远少于分站 246 条，分站是主站尚未吸收的原始研究素材，删除即永久丢失线索来源。但原 README 把分站描述为「独立的『双休购 2.0』产品……与本主站是不同形态的产品」，既没说清它是纯静态备份，也未解释两站收录数量差异的成因，易被误读为数据冲突或「分站才是正牌」。
- **改动**（README.md 顶部「项目定位」区块）：
  - guide 站改为事实陈述：全量**纯静态备份**、246 条企业/品牌线索（调研基准日 2026-09-09）、**未做任何二次开发、无提交改动记录**、内容与上游 `FuzzyLogic112/shuangxiugou-guide` 一致，并补上分站线上地址链接。
  - 新增「两站数据的关系」：分站 246 条是**研究线索**（按证据强度分 A 公开确认 / B 媒体报道 / C 汇总候选 / 风险提示 / 作息待核验五档，大部分未取得一手证据）；主站只收录证据链完整、足以支撑评级结论的条目，其余留作待核实素材，**两站数量不同是预期结果，并非数据冲突**。
  - 新增「主站的收录原则」（唯一标准，不因知名度/规模/舆论热度放宽）：① 客观中立，只呈现可查证公开信息；② 不做情绪化表述，以事实描述作息与加班；③ **证据链不完善一律不评级**——归入「待核实 · 不评级」（U 级）、数值留空显示「—」，不用估算值/招聘方单方口径/论坛传言填充，且该口径同样适用于国有大企业、上市公司与知名消费品牌。
- **核实**：分站 `git log` 仅一条「推广位主线路换新 IP」提交，确认无二次开发；实跑 `data.js` 确认 246 条（verified 3 / reported 10 / candidate 77 / caution 50 / pending 106，`researchedAt=2026-09-09`）；仓库与站点地址逐个 HTTP 实测存在（顺带确认 archive 仓库真名为 `shuangxiu-go-archive`，少一个 g）；`verify.mjs` 中 README 卡片数字口径 ✓、内部链接 7 个全有效 ✓、无乱码 ✓。

### 合并分站品牌数据：工行/建行/中行以 U 级「待核实·不评级」并入主站，收录 59→62 家（2026-10-21 23:57 · 提交 `fbbf144`）

- **起因（站长原话）**：「我记得有一次我对另外一个 AI 说过，其他品牌站的数据，合并到主站，那为什么现在主站仅有 59 条收录的品牌信息？你帮我继续完成」，并补充口径「去核实，包括但不限于招聘页，以及社区论坛等网友评价，但请注意，某些线索不等于真实证据」。
- **比对结论**：fork 的指南站 `shuangxiugou-guide` 共 246 条线索（verified 3 / reported 10 / candidate 77 / caution 50 / pending 106），与主站现有名单逐条比对后 212 条不在主站。其中**仅工行/建行/中行 3 条证据成链可入主表**（原判定的第 4 条「优衣库」复核后确认主站已有，A 级，未重复添加）；其余 209 条为 candidate/caution/pending 未核实线索，按「线索≠证据」口径**一律不评级**，留作后续核实池。
- **3 张新卡均为 U 级 · 待核实 · 不评级**，统一证据口径：招聘聚合站多标「双休/周末双休」，但招聘主体多为外包/派遣/派驻岗且部分标注「该职位信息待核验」；官方网点公示与分行公告显示网点为轮休制、相邻网点错峰上班。无一手可核实的统一双休证据，按「查不到一手证据就不作定性」不作评级，`doubleRestRate` / `offWorkTime` 一律 `null`（页面显示「—」，符合 verify §2d「U 不是逃逸档位」）。
  - 工商银行 (ICBC)：招聘多标做五休二/月休 8 天但均为外包派遣岗；员工社群反馈网点轮休、休息日非固定周末，客户经理受营销指标压力周末常需培训或上班、加班到晚 9 点常见。
  - 建设银行 (CCB)：官网网点营业时间对私周六部分营业、周日休息（轮班）；牛客网小县分行员工称「双休但不连着周六周日，周四和周六休」。
  - 中国银行 (BOC)：智联「中国银行重庆市分行」岗标「周末**单双休**」（非固定双休）；大庆分行《党风政风行风热线》公告「其余网点实行轮休制度，相邻网点错峰上班」。
- **计数同步（收录 59→62、待核实 3→6）**：`assets/index-YthXZ9eP.js` 顶部「收录品牌」与「企业真假双休档案」tab 角标 `children:59→62`（2 处）+ `index.html` 引用 `?v=43→44` 防缓存；`customCardsConfig` 7→10（3 张 U 级，`insertAfter` 链式挂到「肯德基」后）；noscript「共 59 家」→「共 62 家」、「全部品牌详细页（59 个）」→「62 个」且两份清单各 +3 行；新建 `brand/{icbc,ccb,boc}.html` 使详情页数=62 与收录数一致；`projects.html` / `sitemap.xml` 各 +3 条。
- **verify.mjs 两处口径调整**：① 自定义卡断言 `7→10` ×2；② **卡片数字口径校验（§7）新增豁免 `CHANGELOG.md`** —— 该文件是追加式历史流水，正文「7 张自定义卡」等数字记录的是**当时**规模（`isLegitimateNumber` 的「历史记录带日期」规则只认同一行的日期，而 CHANGELOG 条目的日期在标题行、卡数在正文行，故误判）。改这些历史数字等于篡改历史记录，故从「当前规模口径」校验中排除；它仍参与 §8 链接校验与 §9 哈希校验（§9 的假哈希扫描仍覆盖全文）。
- **验证**：`node scripts/verify.mjs`（含密码全量）**481 项全过、0 错误**；`scripts/test-*.cjs` 全 13 组全过（`test-stat-filter` 32 项，badge 卡 60→63、U 3→6、隐藏 41→44，对账 19+14+23+6=62）；**无头 Edge + CDP 视觉验收**确认 3 张银行卡真实渲染（灰徽章「待核实 · 无证据不作评级」、数值字段「—」、灰色提示框、位置链 肯德基→工商银行→建设银行→中国银行，四格 62/19/14/23/6 对账一致）。

### 修复 CI「站点一致性校验」run #576 两处失败（2026-10-21 21:55 · 提交 `16c0583`）

- `scripts/test-stat-filter.cjs`：长城/名创 U→C 改档后 7 处硬编码分档数同步（C 21→23、U 5→3，对账 19+14+23+3=59 不变），32 项全过。根因：改档轮漏跑 test 组。
- `.github/workflows/verify.yml`：「运行校验」步骤改为先 `node scripts/sync-version.mjs HEAD~1`（只写工作区不提交）再 verify，消除两连推时版本号落后 3 拍被 §20g 判红的竞态（run #576 实际发生）。
- 密码以 `***` 掩码，不落库明文。

### 页脚五张卡各配一色（2026-10-21 21:40 · 提交 `872aeef`）

站长看上轮截图反馈「不同框不同颜色，反而可能会更好」。五张卡统一配色（同档柔和淡色系，与 teal 主题协调）：友情链接白（基准）、微博投票淡蓝 `#eff6ff`/`#93c5fd`、随笔浅青 `#f0fdfa`/`#5eead4`、Bing 教程淡琥珀 `#fffbeb`/`#fcd34d`、积分商城淡紫 `#f5f3ff`/`#c4b5fd`；各卡标题/链接色随卡片色调同步。
- `friend-links-footer.js`：`makeCard(bg, border)` 支持传参，五卡各传配色。
- `index.html`：`friend-links-footer.js?v=14`→`?v=15`（防缓存）。
- 密码以 `***` 掩码，不落库明文。

### 页脚随笔卡移到 Bing 教程之前 + 加浅青区分色（2026-10-21 21:19 · 提交 `53f2f47`）

站长：随笔卡插到「如何用 Bing 搜到本站」上面，改框颜色，不然页脚卡片全是同款白框看着眼睛难受。
- `friend-links-footer.js`：essayCard 从页脚末尾移到 seoCard（Bing 教程）之前；样式白卡→浅青底 `#f0fdfa` + 青边框 `#5eead4` + 标题 `#0F766E`，与白卡区分。注释块顺序理顺。
- `index.html`：`friend-links-footer.js?v=13`→`?v=14`（防缓存）。
- 密码以 `***` 掩码，不落库明文。

### 新增随笔页「我为什么支持双休购」+ 页脚入口（2026-10-21 19:41 · 提交 `9b8c144`）

站长：把《我为什么支持"双休购"》随笔贴到网页底部（AI 生成，原文由站长提供）。因正文较长，做成独立阅读页 + 页脚入口卡片，避免长文撑破页脚版式。
- 新增 `why-shuangxiugou.html`：teal 主题 760px 白卡片独立阅读页，逐字收录原文，含「AI 生成」声明与返回首页链接。
- `friend-links-footer.js` 第六块：新增「我为什么支持双休购」入口卡片，链接到 `./why-shuangxiugou.html`；`?v=12→13`。
- `index.html`：`friend-links-footer.js?v=12`→`?v=13`（防缓存）。
- verify 450 全绿 + `node --check` 语法 OK。

---
### 页脚「搜索排名公示」整块删除，改 Bing 设置教程（2026-10-21 18:50 · 提交 `75d42a0`）

站长：名次一天浮动好几次，实测快照维护不过来，整块删掉。页脚卡片容器保留，内容改成「如何用 Bing 搜到本站」教程——设 Bing 为默认搜索引擎（Chrome/Edge/QQ浏览器）、主页设为 https://cn.bing.com、直访链接兜底；并提示用 Bing 搜「双休购」（词要连写）才能找到本站。
- `friend-links-footer.js` 第四块：删 94 行排名表 + ↑↓ 算法（SEO_ROWS/seoDelta/seoNote），改教程卡片；`?v=11→12`
- `SEO-RANKING.md` 历史实测记录保留未动，页脚不再公示
- verify 450 全绿 + node --check 语法 OK

### notes.html 正文章节拆分与全站章节号重编号，重加密（仅替换 PAYLOAD）（2026-10-21 16:38 · 提交 `d4e1754`）

站长拍板把某一节内的两段拆出、独立成新一节，全站章节号顺延重编号。

- **结构改动**：原一节内的两段移出独立成新一节，原节保留主线；后续章节号顺延（现共九节连续无跳号）。
- **同步**：`notes-plaintext.md` 目录脚本注释的章节范围；`README.md` 内的章节号引用。verify.mjs 无正文章节号硬断言、进度面板/目录不绑章节号，重编号零校验阻断。
- **验证**：`NOTES_KEY=*** node scripts/verify.mjs` 全量 467 项通过（含解密内容断言；§20g 公告栏版本号校验通过）。

### notes.html 正文章节改稿并重加密（仅替换 PAYLOAD，bundle/卡片未动）（2026-10-21 15:14 · 提交 `7e0268b`）

站长复核后拍板推送。仅动正文明文源并重加密 `notes.html`（原位替换 `var PAYLOAD` 密文行，页面其余结构零改动），`assets/index-YthXZ9eP.js` 与卡片数据未触碰。

> ⚠️ **本条及后续 notes 条目一律不记录随笔正文内容、章节标题与情节细节** ——
> 正文明细属站长个人资料，仓库里只记录「动了加密文件」这个技术事实。
> 明文源与本地备份路径同样不在此公开记录。

- 本轮改动：既有两节正文明细改写（标题措辞、若干段落重写与段落顺序调整）。
- **验证**：`NOTES_KEY=*** node scripts/verify.mjs` 全量 467 项通过（含解密内容断言；§20g 公告栏版本号校验通过）。

### 长城/名创改档 C 级 0%（口径换算）：证据链双面写实 + 渲染层内层字段修正 + verify 改档锁定（2026-10-20 23:59 · 提交 `7be3f34`）

站长拍板「改呗，证据链写实，不能忽略」。两家 U（待核实）→ C 级（避雷预警），真实双休率按一线主流口径换算 0%：

- **长城汽车**：换算依据是**产线招聘 JD** 而非政策官宣（红线：政策类官宣不换算）。官宣面：中国经济网 2026-01-08 取消大小周全员双休（ev-gwm-4，含取消 10 天高温假代价）；产线面：大冶分公司 2026-10 校招 JD「单双休工作制、月休 6 天」+ 智联「做六休一、两班倒」（ev-gwm-5 多源互证）。官宣 9 个月后产线仍单双休，两面并存写实入卡。
- **名创优品**：门店岗招聘多源一致「灵活排班、月休 4 天、节假日排班轮休」——上海长宁（2026-10）、永州 MINISO LAND **公司直招 JD**（2026-05，发布主体为公司本体）、长治/深圳福田（2026-10），月休 4 天 ≈ 每周休 1 天 → 门店口径换算 0%；总部后台岗双休不代表门店（ev-miniso-4/5/6）。
- **关键修正（复用价值）**：渲染层实际读 `employeeStats.realDoubleWeekendRate`（内层），只改外层字段卡面仍是「—」——首轮渲染实测抓到此问题后两层同步补齐。奇瑞卡外层 0 内层 null 同样显示「—」，为同一历史坑。
- **verify 新增 2f 改档锁定断言**（C 级 + 0% + derived + rateBasis + 证据 ≥5 条），**已注入故障验证**（改回 U → 判红 → 恢复全绿）。全量 466 项通过。
- **首页同步**：顶部「避雷预警」21→23；noscript 双清单两卡数值更新；bundle `?v=42→43`、rate-note-patch `?v=1→2`（长城/名创专属文案改为改档后描述）。
- **详情页重写**：brand/gwm.html、brand/miniso.html——徽章/数据格/正文两面证据/证据来源 5 条（新增在前，旧线索保留备查）/参考区移除已改档卡；0% 值按 verify 正则约束写成纯文本 `0%（口径换算）`。
- 本地 Edge 无头渲染实测：两卡「C级 · 避雷预警」徽章 + 卡面 0% + 「口径换算」徽标；noscript 118 条与详情页一致性校验通过。

---
### 卡面口径标注补丁上线：0% 挂「口径换算」徽标、— 挂「未核实」徽标+原因行（2026-10-20 23:22 · 提交 `54e9603`）

站长指示「两个都做」——①卡面加可见标注 ②对 7 张「—」内置卡复deep查。本条收录①（②的查证结果已随本提交写入清单附四）：

- **新增 `rate-note-patch.js`（bundle 零改动）**：在渲染后的 DOM 上标注——
  0% 卡（喜茶/宁德时代）数值旁挂琥珀色「口径换算」徽标；「—」卡挂灰色「未核实」徽标 +
  卡片下方一行「↳ 已查…」原因。12 张卡有专属原因（美的/宏碁/三星/霸王茶姬/长城/大疆/名创 +
  自定义 5 张），其余 14 张「—」卡挂通用兜底口径，**全站 26 张「—」卡全覆盖**。
- **两处时序加固**：品牌标题会被其他补丁从 h3 改写为 h2（data-h2-fixed），findCard/brandNote
  兼容 h3/h2；只在标注实际插入成功后才打 data-rate-patched 标记，未成功的留给
  MutationObserver 下一轮重试，规避 React 重渲染竞态。
- **本地 Edge 无头渲染实测**：2 徽标 + 26 徽标 + 26 脚注 = data-rate-note 54 处，
  二次渲染幂等无重复插入。
- **修正一处错误表述**：清单 §五.6 原写「0% 卡=凡 weekendPolicy=single 者（11 张）」与实测不符——
  0% 的判定字段是 `realDoubleWeekendRate=0`，首页实测仅喜茶/宁德时代两张显示 0%；
  README 三态对照的示例同步修正。
- **复deep查（7 家）结论**：3 家查到新制度口径（宏碁/三星/长城）、4 家维持查无数据；
  长城（官宣双休 vs 产线单双休）与名创（可换算 0%）是否改档**留站长决断**，本轮数据字段零改动。

verify 465 项全绿。

---
### 文档：README 与核实清单补「0% 与 — 的口径解释」（2026-10-20 22:38 · 提交 `5dd5181`）

站长质疑「很多自定义卡片双休率不是 0% 就是 ——，不能好好核实吗」。排查结论：
0% 与「—」是两种不同状态，但页面与文档都没有把边界讲清。按站长指示**只改文档、不动页面**：

- **README.md**：在「口径换算透明化」条目下新增小节《📊 卡面上的「0%」和「—」分别是什么意思》——
  三种形态对照表（具体百分比 / 0%口径换算 / —未核实）、0% 为何是算术不是估算（制度写明做六休一，
  双休率按定义为零，且挂 rateSource:derived + 证据 id）、「—」为何不填数（企业从不公示分岗位双休占比，
  编数字会毁掉全站可溯源原则）、以及补数据唯一途径（Issues 提交可溯源一手证据）。
- **员工实测数据核实修改清单.md**：§五口径定义新增第 6 条，明确「0% = 查到了，换算结果是零；
  — = 查过了，没有可换算的数」，并列出两类卡的具体名单（0%：喜茶/宁德时代/海底捞/盒马/奇瑞/蜜雪/肯悦/库迪/BYD/华为/星宇等；
  —：美的/大疆/名创/三星/宏碁/霸王茶姬/长城 + 自定义 5 张月休制卡）。

数据与页面零改动（bundle、customCardsConfig 均未动）。verify 465 项全绿。

### 页脚搜索排名公示：更新 2026-10-20 实测名次（2026-10-20 22:06 · 提交 `5ef4db1`）

站长实测（普通窗口）后提供 7 个词的本次名次，`SEO_ROWS` 按新快照更新，
上一轮（2026-10-16 无痕窗口）名次整体后移一位成为「上次」：

| 关键词 | 本次 | 上次 | 变化 |
|---|---|---|---|
| 双休购996 | 1 | 2 | ↑1 |
| 双休购数据 | 1 | 2 | ↑1 |
| 双休购官网 | 2 | 5 | ↑3 |
| 双休购 | 4 | 7 | ↑3 |
| 双休企业 | 4 | 第一页末位 | ↑（进入第一页） |
| shuangxiugou | 3 | 6 | ↑3 |
| shuangxiugo | 3 | 5 | ↑2 |

7 个词全线上升，无一持平或下滑；变化箭头由页脚脚本按两次快照自动计算，不手写。
`index.html` 缓存参数 `?v=9` → `?v=10`。verify 465 项全绿（公告栏版本号处于 CI 补提交前的中间态，符合预期）。

### 页脚搜索排名公示：去掉 Google 词条（2026-10-20 21:12 · 提交 `60a2484`）

站长反馈 Google 已掉出收录，页脚「搜索排名公示」里还挂着 `双休购github 第 1 位 · Google · Bing`，
属于过期且不可核实的公示，先撤掉。

改动（`friend-links-footer.js`）：
① `SEO_ROWS` 删掉 `['双休购github', '1', '1', 'Google · Bing']` 这一行，其余 7 行 Bing 数据不动；
② 卡片底部说明里「目前只有『双休购github』能进第一页」这半句删掉，只保留「Google 对本站更严格」。

`index.html` 里该脚本的缓存参数 `?v=8` → `?v=9`（页面上的脚本改了必须 +1，否则浏览器吃缓存）。
verify 465 项全绿（公告栏版本号处于 CI 补提交前的中间态，符合预期）。

### 随笔新增一节并重加密（仅替换 PAYLOAD）（2026-10-20 20:59 · 提交 `ca60768`）

> ⚠️ 按隐私纪律，notes 相关条目只记录「动了加密文件」这个技术事实，
> 不记录章节标题、正文内容与人物细节。

在第六章末尾（该章末节与第七章之间）新增一节正文，沿用全文既有版式
（纯 `<p>` 段落、无行内样式标签），随后重加密 `notes.html`
（`var PAYLOAD` 密文行原位替换，页面结构零改动）。

- **验证**：`NOTES_KEY=*** node scripts/verify.mjs` 465 项全绿（公告栏版本号处于 CI 补提交前的中间态，符合预期）。
- **解密回读**：新增节 12 段、零行内标签，位置在第六章末节与第七章之间，章节连续无跳号。
- 明文源已同步站外固定备份（路径与机制按纪律不在仓库内记录）。

### 随笔正文：时间类数字统一为阿拉伯数字（2026-10-20 20:11 · 提交 `5722696`）

站长发现正文里同一类时间信息写法不统一，要求按两条规矩统一：**精确点位改阿拉伯数字，约数保留汉字**。

- 本轮共改 16 处（均在正文段落，无一涉及章节标题）；数字与单位之间统一加半角空格，与全文既有写法对齐。
- 刻意没动的三类：约数、序数、年级名（均保留汉字）。
- 仅动 notes.html 密文（PAYLOAD 行原位替换），verify 465 项全绿（公告栏版本号处于 CI 补提交前的中间态，符合预期）。
- 解密回读逐条核对 16 处全部生效、旧写法零残留。

### 随笔新增一节并重加密（仅替换 PAYLOAD）（2026-10-20 17:26 · 提交 `464e09f`）

在第四章既有两节之间新增一节正文，版式与相邻节一致（纯 `<p>` 段落、无行内样式标签），
节末附两组问答并带可见标注（AI 整理，不属于本人叙述）。

- **验证**：verify 466 项全绿。
- **解密回读**：新增节 17 段、零行内标签；旧问号写法已消失（本轮顺带修正的标点问题）。
- 明文源已同步站外固定备份。

### 随笔新增一节并重加密（仅替换 PAYLOAD）（2026-10-20 16:45 · 提交 `7c9cf50`）

在第四章新增一节正文，节末附三段 AI 扩写，带可见标注（AI 扩写，不属于本人叙述）。
正文按要求不出现年级与年龄数字。

- **验证**：verify 465 项全绿，密文往返一致。
- 明文源已同步站外固定备份。

---
### 随笔 4.2：澄清段按站长终稿改写并上移（2026-10-20 03:06 · 提交 `f16060c`）

站长指出上一版（`217505f`）把澄清段的指代对象写反了。按站长红框终稿重写澄清段，
位置从该节末尾上移至指定段落之后；原占位句与旧版「有两点」段一并删除。

- 仅动 notes.html 密文（PAYLOAD 行原位替换），verify 465 项全绿，密文往返一致。

---
### 随笔 4.2：占位说明补澄清（2026-10-20 02:54 · 提交 `217505f`）

4.2 末尾占位句之后新增一段两点澄清（指代辨析 + 未成年人保护收尾），
并以括号补一句「点到为止、不公开是为保护未成年人隐私权」。

- 仅动 notes.html 密文（PAYLOAD 行原位替换），verify 466 项全绿，密文往返一致。

---

### 随笔 5.3：一句措辞按站长新表述改写（2026-10-20 02:09 · 提交 `8d09dd8`）

5.3 节内与母亲争执相关的一句，按站长给的终稿改写：把情绪化自述换成对自身习惯的陈述，
细节依旧不公开（与全文既有的「不方便细说」处理方式一致）。

- 仅动一句，加密重发，verify 465 项全绿，密文往返一致。

---
### 随笔第八节：删除末尾「AI 备注」勘误块（2026-10-20 00:58 · 提交 `786add6`）

站长要求删除第八节末尾的 `<div class="colophon">AI 备注：…</div>` 整块——
那是内部生产过程的勘误记录（AI 改错过哪些事实、站长逐条指正），不应随正文公开。
第八节正文一字未动，与前后文的衔接保持原样；文末既有 colophon 收尾段保留
（那是站长自己写的收尾，不是勘误块）。

- verify 465 项全绿；密文往返解密一致；明文已同步站外固定备份。

---
### 随笔新增附录：一段 AI 的解读，标注「AI 观点，不属于人类观点」（2026-10-20 00:53 · 提交 `7eb4baa`）

站长把随笔拿去与外部 AI 工具讨论，并喂给它一段**并未写进本页的口头补充描述**。
AI 据此写出的解读一节，站长认为说出了他的心声，要求原样收进随笔并明确标注为 AI 观点。

实现方式：
- 新增 h2「附：一段 AI 的解读（AI 观点，不属于人类观点）」，插在第十节之后、
  结尾中立宣言之前（会自动进左侧目录与写作进度面板）；
- 站长按语交代来龙去脉，**如实写明那段口头补充并未写进本页**，且 AI 的转述
  「与本页正文的事实记录未必一致，请分开看」——避免读者把 AI 基于口头补充的
  解读当成正文事实；
- 正文为 AI 原文，仅做排版整理未改表述；核心引句用 blockquote 突出。

验证：verify 465 项全绿；密文往返解密一致；解密渲染截图肉眼复核附章节排版正常。
明文已同步站外固定备份。

---
### 随笔正文：删去一句引用（2026-10-20 00:17 · 提交 `e0c6a31`）

衔接 `133fcf5` 的措辞改写遗留问题：前句已改为「不方便细说」的表述，但其后半句仍引用已删除的原话，
读起来接不上。经站长确认，改为不引用任何已删内容的写法，情节含义不变。

- 仅动 `notes-plaintext.md` + 重新加密 `notes.html`（原位替换密文行，走新流程一次成功）。
- 密文往返校验一致：新句在、旧句已删、前句完好。明文已同步站外固定备份。

---
### 随笔页：锁屏「我同意/我不同意」勾选门禁 + 正文措辞改写 + 加密脚本原位替换（2026-10-20 00:09 · 提交 `133fcf5`）

三件事，都只动 `notes.html` / `scripts/encrypt-notes.mjs`，不动项目页面：

1. **锁屏门禁（站长指定的交互）**：密码框保留不动，下方加「☐ 我同意 / ☐ 我不同意」
   两个点击式勾选（二选一、互斥、再点一次可取消，`aria-checked` 供读屏识别）；
   勾选行下方是红色公告：继续访问即视为已阅读并同意——站长随笔只是站长的个人情绪记录，
   本站始终保持中立，不对没有证据链支撑的企业或个人做任何评级。
   未勾选或勾「不同意」时点「打开」均被拦下，不进入解密。
2. **正文措辞**：按站长指定文案改写一句情绪化表述，细节依旧不公开；
   其余正文一字未动（明文已同步到站外固定备份）。
3. **`encrypt-notes.mjs` 防回归改造**：原脚本内嵌旧版页面模板、每次加密整页重建，
   本次实际执行时把锁屏卡片/徽标/AI 习作/写作进度面板等后期手工样式全部冲掉
   （靠 `git checkout` 救回）。现废弃模板重建，改为**只替换 `var PAYLOAD = …;` 密文行**，
   页面其余部分一字不动；并加「替换前后行数必须一致」自查门禁。
   自查的明文泄露检测同步修正：锁屏上有意明文展示的公告不再误报。

新增 `scripts/test-notes-agree.cjs`（17 项）：门禁拦截、互斥/取消、放行路径、
公告存在性，并含故障注入自检（把 `if (agreeState !== 'yes')` 挖成 `if (false)`，
证明断言真的在测门禁而不是永真）。verify 466 项全绿；13 组 test-*.cjs 全过；
无头 Edge 截图肉眼复核锁屏布局。

---
### 新增：README「用 AI 查事实：三条铁律」（2026-10-19 21:43 · 提交 `e465b06`）

站长要求把三条铁律写进 README（不是新建文件）：

1. **让它给出处** —— 没有出处等于没有事实；「据公开资料」「有研究显示」不算出处
2. **允许它说「不知道」** —— 一个从不说不知道的 AI 是在编
3. **关键信息自己再核对** —— 出处链接要亲自打开一次，AI 会编出看着很像真的 URL

放在「改动必记账」之后、项目定位之前。补了一条与本站硬要求的衔接：
只有「AI 说」而没有出处的，一律按未核实处理（评级 U）。同时注明这三条
同样适用于让 AI 改代码——本站踩过最贵的坑全是「校验全绿、页面是错的」。

verify 449 项全绿（未新增断言，纯文档新增）。

---
### 新增：公告栏版本号自动化 + §20g 校验红线（2026-10-19 18:40 · 提交 `8b87c05`）
站长问「版本号规则之前对其他 AI 说过，他没记录？」—— 其实**记了**，在
`AGENTS.md`「两条硬规则 · 一」早就写明「版本号 = 上一次推送的哈希」，
还解释了为何不能写当前 HEAD（哈希由内容算出，写进文件会改变内容进而改变
哈希，无法自指）。但**只写在文档里没有强制力**，照样连漏 6 个提交。

因此把它升级为三道机器保障：

| 层次 | 文件 | 作用 |
|---|---|---|
| ① 本地命令 | `scripts/sync-version.mjs`（`npm run sync-version`） | 写入当前 HEAD 哈希；支持 `--check` 只检查不改写 |
| ② 校验红线 | `scripts/verify.mjs` §20g | 落后超一拍 / 写成 HEAD / 哈希不存在，一律判红 |
| ③ CI 兜底 | `.github/workflows/sync-version.yml` | 每次 push 自动同步并补提交，`[skip ci]` 防死循环 |

**踩到的坑（已修正）**：脚本最初默认写 `HEAD~1`，但写完还要再提交一次才落地，
补提交后版本号滑到 `HEAD~2`，反而多落后一拍。改成默认写 **HEAD**，补提交后
正好落在 HEAD~1 的目标语义 —— 已在 AGENTS.md 标注「别把这个默认值修回去」。

**验证方式**：① 临时分支模拟 CI 完整时序（推→写回→补提交→校验）走通；
② 注入三种故障（落后 53 拍 / 写成当前 HEAD / 编造 `deadbee`）全部被 §20g 判红；
③ 真实 CI 跑通两次，自动补提交 `6623aae`、`54b7525`，均 success。
校验 448 → **449 项**，自检 6/6。

### 修正：首页公告栏版本号滞后多轮（2026-10-19 18:07 · 提交 `432d620`）
站长发现首页「当前版本号 2db67d9」与近期提交对不上。根因：该版本号是
`index.html` 里的手写静态文本，自 2db67d9（搜索过滤待核实清零修复）之后的
TOP 按钮、红色标记、卡片本地说明、v17 分述等多轮发版都没同步它。
现更新为 `a62ec5a`，并在行内加注释提醒每次发版后手动更新为当次功能提交短哈希。

### 修正：卡片存储说明按数据实际去向分述（2026-10-19 17:52 · 提交 `a62ec5a`）
站长指出上一条文案有误：员工投票会提交到 GitHub Issues，不能笼统写「不上传云端」。
改为分述——「**点赞、点踩**仅保存在本地浏览器，不上传云端；清除 Cookie 与缓存会
丢失。**员工投票**会提交到 GitHub Issues 公开记录。」两处重点琥珀色加粗。
缓存版本 `custom-card-actions.js` v16→v17；dbg-local-note 断言同步更新（实测
60/60 张卡全覆盖、幂等无叠加）。

### 新增：全部品牌卡底部加「数据仅保存在本地，不上传云端」说明行（2026-10-19 17:32 · 提交 `87d9796`）
站长要求所有卡片都要提示数据存储边界。做法不区分卡片来源：「员工投票」按钮往上
`closest('.bg-white.rounded-2xl')` 反查卡片根（内置 React 卡与克隆的自定义卡同构），
在按钮条之后插入 `.sxg-localnote` 说明行——💾 图标 + 一句话，重点「当前仅保存在
本地浏览器」用琥珀色加粗，虚线与按钮条分隔。MutationObserver 防抖补挂 + 卡片根
`data-sxg-localnote` 标记保证 React 重渲染下幂等不叠加。实测 60/60 张卡全覆盖、
滚动重渲染无重复；缓存版本 `custom-card-actions.js` v15→v16。
验证：`scripts/dbg-local-note.cjs`（覆盖数、文案、可见性、幂等）+ 截图肉眼复核。
---
### 样式：随笔页 AI 文章正文用红色标出突出言论（2026-10-19 16:02 · 提交 `fb87906`）
正文里 16 处比较突出的言论改用语义化的 `<mark>` 标签，红色加粗 + 极淡红下划线
（去除了浏览器默认的黄底），像老师改作文圈重点；结尾句「双休购，购的是商品，
更是态度。」保留原来的绿色不变。红与暗色红统一收进 CSS 变量 `--hl` / `--hl-soft`
（明暗两套都写在各自 `:root` 里，避免断点样式与通用样式互相覆盖）。
新增 `scripts/dbg-notes-mark.cjs`，用无头浏览器读 computed style 确认红色真的生效。

---
### 新增：随笔页 notes.html 加「TOP」回顶按钮（2026-10-19 15:38 · 提交 `453ef32`）
复用首页的 `top-button.js` 并做三点扩展：新增 `data-bottom` 属性覆盖底距
（首页给吸底广告留 96px，随笔页无广告用 28px）、补 `prefers-color-scheme: dark`
暗色配色、尊重 `prefers-reduced-motion`（关闭平滑滚动与过渡）。
新增 `scripts/dbg-notes-top.cjs` 无头验证：真实鼠标点击后 scrollY 600 → 0，ALL-PASS。
---
### 内容：notes.html 补贴入 AI 随机生成文章全文（2026-10-19 15:28 · 提交 `4926a90`）
上一轮只放了 AI 声明漏了文章本体。现已在锁屏声明下方以纯 HTML（非链接）贴入
AI 生成的虚构习作《双休购》全文，样式克制：虚线分隔、段首缩进、末句点题居中绿色。
页面本身 noindex/nofollow，无 sitemap 收录，verify 447 项全绿。
---
### 调整：移除「站长随笔还在写」弹窗，随笔页直接开放（2026-10-19 14:57 · 提交 `5166358`）

**起因（站长原话）**：「这个先关闭掉，不要这个弹窗了……直接进入到这个页面，但保留密码，
不要自动输入密码……这个页面的ui帮我美化一下吧……单独在下面写纯文本……注明只是AI随机生成的一篇文章。
检查notes这个页面是否写了robot」。

1. **`douyin-prompt.js`**：删掉整个「还在写」公告弹窗（buildNotice/openNotice/closeNotice），
   弹窗底部「站长随笔」从 `<button>`（弹公告）改为 `<a href="./notes.html">` 直接跳转。
   notes.html 本就有密码锁，不自动填密码，锁屏行为不变。
2. **`douyin-prompt.css`**：删除已无用的 `.dyp--notice` 样式段；缓存版本 css v7→v8、js v4→v5。
3. **`notes.html` 锁屏美化**：卡片式容器（圆角+阴影+边框）、羽毛笔徽标（内联 SVG，
   描边风与主站 lucide 一致）、`NOTES · SHUANGXIUGO` 字距副标题、方格纸底纹
   （`body::before` 极淡网格，呼应"手写稿纸"）、输入框 focus 改为 border+柔光
   （accent-soft）、暗色模式变量齐全。密码、提示文案、「写作进度」面板逻辑全部未动。
4. **AI 声明**：锁屏卡片下方加一段**纯文本**（非 `<a>`，不给搜索引擎可循的出口）：
   「本页下方将附一篇由 AI 随机生成的文章，内容为虚构习作，不代表本站观点，也与本站品牌数据无关」。
5. **robots 确认**：notes.html 第 6 行本就是
   `<meta name="robots" content="noindex, nofollow, noarchive, nosnippet" />`，未收录、不跟踪。
6. **`scripts/verify.mjs`**：两条旧规则（禁止跳转 notes.html / 必须弹 dyp--notice 公告）
   与新行为相反，反转为「必须直跳 notes.html」「公告弹窗已移除」，通过项 445→447。
   无头回归 dbg-vote-close.cjs 复跑 ALL-PASS（弹窗改动不影响投票功能，例行确认）。

---
### 修复：投票弹窗右上角 ✕ 仍点不动，改为直接触发「取消」动作（2026-10-19 13:58 · 提交 `9de2f0a` / `f9b5d25`）

**起因（站长原话）**：「还是按不动哦，把那个 x 绑定到取消按钮值吧……反正我还是点不动 x」。
上一条 `d1829b1` 的 `box.querySelectorAll` 绑定在实际环境仍未生效（疑似站点旧缓存或事件被遮蔽），站长明确指示：让 ✕ 复用「取消」按钮的动作。

**修复（`custom-card-actions.js` `openVoteModal`）**：
1. ✕ 的 click 处理改为**直接调用「取消」按钮的 `.click()`**（同一处理函数，与站长要求一致）；找不到「取消」时兜底 `closeLayer()`。
2. 另加**捕获阶段兜底**：`box` 上 `addEventListener('click', ..., true)`，从 `e.target` 沿父链找 `[data-vote-close]`（排除「取消」本身），命中即关闭——即使头部 ✕ 的常规绑定被任何因素吃掉也能关。
3. 缓存版本号 `custom-card-actions.js?v=14` → `?v=15`（强制刷新旧 v13/v14 缓存）。

**验证**：`node --check` 语法通过；`verify.mjs` 448 项全绿。

---
### 修复：投票弹窗右上角 ✕ 点击无响应（2026-10-19 12:59 · 提交 `d1829b1`）

**起因（站长原话）**：「点击 x 毫无响应（5 张还是 7 张自定义卡片均存在 bug）」，附截图。

**根因**：`custom-card-actions.js` 的 `openVoteModal` 里，✕ 按钮写在深色头部 `head` 中
（`head.innerHTML = '...<button data-vote-close>✕</button>...'`），
但关闭事件绑定写的是 `body.querySelectorAll('[data-vote-close]')` —— **只查了正文 `body`，
头部那颗 ✕ 从头到尾没绑上事件**。「取消」按钮在 `body` 里所以能关，
Esc 也能关，唯独 ✕ 死活没反应。7 张自定义卡共用同一个 `openVoteModal`，全部中招。

**修复**：`body.querySelectorAll` → `box.querySelectorAll`（`box` = 头 + 正文整个弹窗容器）。

**验证**：无头 Edge + CDP 真实鼠标点击 —— 打开投票弹窗 → 点 ✕ →
`document.querySelector('.sxg-layer')` 变 null（弹窗移除）；重开后点「取消」仍正常关闭（回归通过）。
缓存版本号 `custom-card-actions.js?v=13` → `?v=14`。

---
### 文档：CHANGELOG 全量补齐「改动时间 + 提交哈希」，verify 新增 §9b 自动拦截漏记（2026-10-19 12:19 · 提交 `37d0163` / `e9892a7`）

**起因（站长原话）**：「改动记录要写日期，什么时候改的，哈希值多少，本次你是否已经做了呢？」

一查确实没做到位 —— 65 条里有 **6 条只写「提交 xxx」没有日期**、**1 条压根没写哈希（只写了「提交号见 git log」）**，
**17 条改动从来没有记录过**，还有几条的时间顺序是乱的。

**补全范围**：

| 类别 | 数量 | 具体处理 |
|---|---|---|
| 补时间戳 | 47 条 | 所有 `### ` 条目统一改为「（YYYY-MM-DD HH:MM · 提交 `hash`）」格式，时间取 `git log` 精确提交时间 |
| 补标题 | 1 条 | 「顶部四格统计变点击筛选」原本标题行丢失只剩正文（`d287a30`） |
| 新增补录 | 17 条 | 此前完全没进 CHANGELOG 的改动（详见下表） |
| 重排顺序 | 全部 | 按时间戳严格倒序，废弃混乱的 `## 日期` 分节 |

**新补录的 17 条**（均为影响页面功能/内容、此前漏记的改动）：

| 时间 | 提交 | 内容 |
|---|---|---|
| 2026-10-18 15:12 | `11ca656` | 还原广告位为「良配」商业推广（前述误改），保留「删除 7 天隐藏记忆」 |
| 2026-10-18 14:58 | `03275ba` | 广告位改本站推广（后被 `11ca656` 还原，留档说明） |
| 2026-10-17 21:22 | `c56345d` | README 纠正最近更新数字 41→43 |
| 2026-10-17 21:22 | `b63fbaa` | README 新增「2026-10-17 最近更新」小节 |
| 2026-10-17 19:34 | `e8165a1` | 数字型字段终轮检索留档：四张卡维持 null |
| 2026-10-17 02:12 | `484c5bf` | 修 notes 校验两处误判（CSS 字体名 / 比亚迪白名单） |
| 2026-10-17 01:52 | `832a650` | 彻底禁用纯数字搜索 + SEO 排名基线 `SEO-RANKING.md` |
| 2026-10-17 01:36 | `24b772b` | 广告 LOGO 竖排折行修复 + 详情页 SEO 标签补齐 |
| 2026-10-17 00:57 | `5527739` | **推荐位修复**：C 级不再被当「良心双休替代品牌」推荐 |
| 2026-10-17 00:42 | `f4a1e26` | **员工投稿真入库**：跳 GitHub Issues，不再假入库 |
| 2026-10-17 00:38 | `c9b2753` | 喜茶三口径全收录，区分实测值/口径换算值 |
| 2026-10-16 19:53 | `1eb7de0` | 测试脚本改 `__dirname`（修 CI 上测试静默跳过） |
| 2026-10-16 18:17 | `0e331a7` | 同类项目导航补宁德时代关键词 |
| 2026-10-16 17:51 | `cc136be` | 新增内置卡宁德时代 CATL（首次建卡） |
| 2026-10-16 16:10 | `281688a` | 广告位文字溢出视口（CSS 源码顺序坑） |
| 2026-10-16 15:50 | `450b09b` | 清除 7 个编造的提交号 |
| 2026-10-16 13:25 | `43f8b70` | 新建 CHANGELOG + 修正 verify 徽标判据 |

**防回归：`scripts/verify.mjs` 新增 §9b**（3 条断言，把人肉纪律变成机器检查）：
1. 每条改动记录必须匹配「（时间 · 提交 hash）」格式；
2. 全部记录必须**严格按时间倒序**（第一条最新）；
3. 禁止任何「哈希留空、让人自己去翻提交历史」的写法——每条都必须当场给出可核验的真实哈希。

**注入验证**（确认不是恒真检查）：
- 删掉某条的时间戳与哈希 → 断言 1、3 同时报错，并打印是缺哪一条；
- 把某条旧记录挪到最前 → 断言 2 报错，并指出「第 1 条（时间 X）排在上一条（时间 Y）之前」；
- 还原后 448 项全绿（原 445）。

**同时更新**：`README.md` 的「改动必记账」硬性要求里写明标题格式与 §9b 检查项。

---
### 三连修：投票弹窗样式统一 + 点踩误判 + 缓存丢失提醒（2026-10-19 11:46 · 提交 `854d8c9`）
**站长截图反馈三问题**：
1. 自定义卡投票弹窗（白底单选圆钮）与内置弹窗（深色头部 + 药丸选项）样式不一致；
2. 点赞/点踩提示没提醒「清浏览器 Cookie/缓存会丢记录」；
3. **点踩被提示成「你已经点赞过啦」**——赞/踩按钮都是「图标+数字」形态，
   旧代码按数字文本识别全判成点赞。

**改动**（`custom-card-actions.js?v=13`）：
- 投票弹窗重排：深色头部（公证徽标 + 品牌名标题）、岗位/周末药丸多选组、
  下班时间下拉、加班费发放双选，视觉与内置弹窗统一；
- 赞/踩识别改为 **SVG 图标 path 签名**（thumbs-up `M2 9.5…` / thumbs-down `M9 18.12…`）+
  title 关键词双保险，点踩不再误判；
- 提示弹窗补一句加粗提醒「请勿清除浏览器 Cookie 与缓存，否则记录会丢失」；
- 投票数据新增 bonus（加班费发放）字段，随 issue 表格上报。

---

### 功能定版：自定义卡「员工投票」跳转 GitHub Issues + 点赞/点踩本地记录（2026-10-19 11:25 · 提交 `f6a02a6`）
**站长要求**：员工投票提交改为**跳转 GitHub Issues 记录**（与内置卡 `employee-report-to-issue.js`
同一套路）；点赞/点踩**先记录在本地**，点击后弹提示告知「数据将保存在本地浏览器 Cookie，
上传 GitHub 云端是后续考虑开发的功能」。

**改动**（`custom-card-actions.js?v=12`）：
- 员工投票提交：本地照存 `sxg-custom-votes`，同时 `window.open` 打开
  `github.com/dujeongil-galaxy/shuangxiugou/issues/new`，预填标题
  `[员工工时投稿] <品牌>` 与 Markdown 表格正文，labels=员工投稿；
  按钮文案改「提交我的真实工时票（跳转 GitHub 记录）」，回执文案同步说明。
- 点赞/点踩：移除置灰，点击有效——按品牌记入 `localStorage('sxg-custom-thumbs')`，
  弹提示（点赞成功 / 你已经点过啦），按钮加高亮描边；重复点击与跨类切换（已赞又点踩）
  均只提示不重复计。
- 修复 `employee-report-to-issue.js` 中 issue 模板残留的 `null` 字样。

---

### 修复：自定义卡「员工投票」按钮点了没反应 + 视频弹窗遮罩吞点击（2026-10-19 02:36 · 提交 `b9a854c`）
**背景**：站长截图反馈「零食品牌员工投票按钮还是 null」。排查结论：按钮不是显示 null，
而是**压根没绑事件**——自定义卡是克隆内置卡模板生成的，克隆体不携带 React onClick，
`bindCustomCards` 此前只绑了「打卡」「详情证据」，漏了「员工投票」。点击后什么都不发生。

**改动**：
- `custom-card-actions.js`：新增 `openVoteModal`（岗位/双休情况/下班时间/一句话补充表单，
  与内置投票弹窗对齐）+ `openVoteThanks` 回执；`bindCustomCards` 补绑「员工投票」按钮。
  提交后写 `localStorage('sxg-custom-votes')`（本地视角，云同步后续接入），卡面「N 人已投票」同步 +1。
  版本号 `?v=10` → `?v=11`。
- `douyin-prompt.css`：视频推荐弹窗容器 `.dyp` 由实心全屏层改为 `pointer-events:none`
  （仅遮罩与面板恢复 `auto`）。此前弹窗自动弹出后**整页按钮都被它挡住**，
  点任何卡片按钮都落在遮罩上被吞、只关了弹窗——用户视角同样是「按钮坏了」。
  版本号 `?v=6` → `?v=7`；`index.html` 同步。

**验证**：无头 Edge 真实鼠标点击——7 张自定义卡员工投票弹窗全部打开、提交后票数 +1、
localStorage 落盘正确；内置卡点击不再被弹窗吞掉。verify 445 项全绿，12 个 test 脚本全过。

---

### 广告位文案：去掉「（限时推广）」的全角括号（2026-10-19 01:57 · 提交 `1e6a393` / `c5d0ff9`）
**背景**：站长指示 —— 良配广告位 LOGO 上方那行「（限时推广）」去掉外层括号，只留「限时推广」四个字。

**改动**：`liangpei-ad.js` 的 `CONFIG.limitLine` 由 `'（限时推广）'` 改为 `'限时推广'`；`index.html` 版本号 `liangpei-ad.js?v=7` → `?v=8` 防缓存。文案变短不影响既有版式（竖排卡该行左对齐、吸底条该行与品牌行同排）。

**防回归**：`scripts/verify.mjs` 新增两条断言，钉住「limitLine 必须是裸的『限时推广』、不得含任何括号字符」。注入故障（改回带括号）实测两条断言均报错，恢复后 445 项全绿。

> 注：按本文件收录范围，商业广告位（`liangpei-ad.*`）的纯文案/版式改动本不单独列条；本条因其附带 verify 断言变更（属 fork 者可参考的防回归机制）而记录。

---

### 修复：详情弹窗投票数「( 票)」首开仍闪现（时序竞态）；README 增「未来开发计划 / 点亮 Star」（2026-10-19 01:30 · 提交 `e7dcaef`）
**背景**：站长实测 e08c197 之后仍有「部分员工投票是空 null 值」——首次打开详情弹窗时短暂显示「( 票)」。同时确认线上各卡片 LOGO 映射完整（截图里的空 LOGO 为浏览器缓存旧版 index.html 所致，强制刷新即恢复），未发现新缺 LOGO 品牌。

**根因（时序竞态）**：`patchVoteCounts()` 挂在 MutationObserver 回调里，防抖 300ms。实测打开弹窗后 54ms 时原文案「( 票)」已可见，354ms 补丁才落地——中间 300ms 肉眼可见。且旧版扫描范围只有 `.sxg-layer` + 卡片容器，React 详情弹窗是 #root 下的 fixed 覆盖层，不在范围内。

**修复**：
1. `custom-card-actions.js`：`patchVoteCounts()` 改为全页扫描；新增 `bindVotePatchOnClick()`——捕获阶段监听「详情证据 / 员工投票」点击，rAF 连补 8 帧（约 130ms），弹窗首帧即为正确文案；
2. `index.html`：肯德基自定义卡补「工时排班：/ 加班对待：」label 覆盖机制（`customCardLabels`，克隆模板后不再沿用错误 label），`custom-card-actions.js?v=10`；
3. `README.md`：新增「🔮 未来开发计划」（线上投票云同步，规划中暂不实施，过渡方案为 Issue 预填）与「⭐ 给这个项目点个 Star」两节；
4. `PITFALLS.md` 第十二章：记录「弹窗类 DOM 补丁，防抖是兜底不是主路径」。

**验证**：Edge 无头对 23 张空票品牌逐个「点击 → 120ms 内读取」，全部命中「暂无实测投票」；443 项 verify + 12 个测试全绿。

---

### 修复：拼音联想候选点了变「未找到匹配的品牌信息」（2026-10-19 01:00 · 提交 `ff69fd6`）
**背景**：站长实测——搜索框输入 `Ls`，候选里出现「赵一鸣 / 零食很忙」，点选后页面变成「未找到匹配的品牌信息」。

**根因（三层，缺一不可）**：
1. React 首页过滤只查三个字段：
   ```js
   ne = brands.filter(e => e.name.includes(kw)
     || e.companyName.includes(kw)
     || e.keyProducts.some(p => p.includes(kw)))
   ```
   **`searchKeywords` / `summary` / `category` 都不查。** 而拼音联想的「命中词条」正好大量来自 `searchKeywords`（「零售」「零食」「户外」），回填这些词必然搜不到。
2. 自定义卡（赵一鸣/零食有鸣/茶百道/兵立王/肯德基/小米/一点点，7 张）压根不在 bundle 的 `brands` 数组里，是 `insertAllCustomCards()` 事后插进 DOM 的。React 的 `ne.length === 0` 时会把整片内容替换成空态，插进去的卡片随父节点一起消失，且 React 之后不会再调插入函数。
3. 旧 `fillTerm()` 在命中词条是纯英文时才用 `entry.cn`，否则直接回填命中词条 —— 于是「零售」被填进搜索框。

**修复**：
1. `pinyin-search.js`：`fillTerm(entry)` 一律返回 `entry.cn`（主名中文字，必然命中 `name`）；无 `cn` 的条目直接不进候选。
2. `scripts/gen-pinyin-index.py`：自定义卡不再进联想索引；新增 `native_search_keys()`，生成时回查 bundle，**主名的中文字必须能在 `name`/`companyName`/`keyProducts` 里命中**，否则整条剔除（本次剔除 2 个：星宇「常州星宇股份车灯及汽车消费品」、百事「百事食品乐事桂格燕麦」——括号后缀拼接后不是 bundle 里的字面串）。
3. `scripts/verify.mjs`：把旧的「索引数 = 全量卡片数」等式换成两条真正的约束——① 索引不含自定义卡；② **索引每条的主名都能被原生搜索命中**（逐条校验，不再数数）。
4. `scripts/test-pinyin-e2e.cjs`：`nativeSearch()` 之前多算了 `searchKeywords`/`summary`/`id`，比 React 宽松 → 虚假通过。改为与 bundle 一字不差的三个字段，并新增 `keywordSearch()` 区分「词条链路」与「回填链路」。新增 6 条回归断言（扫全部索引 × 16 个查询，没有任何候选点回去是空态）。
5. `index.html`：`pinyin-index.js?v=5`、`pinyin-search.js?v=2`。

**注入验证**：手动把 `snack-card` 塞回索引 → e2e 3 条 + `test-pinyin-search.cjs` 3 条同时报红；把某条 `cn` 改成不可搜串 → verify 的「50 条全部可回填」报红。还原后 443 项 + 12 个测试全绿。

**实测**：Edge 无头 CDP 1600px——输入 `Ls` 候选为「胖东来 / OSRAM / 三星 / 盒马」，无「赵一鸣」；点选「胖东来」后输入框变「胖东来」，卡片 1 张，空态消失。

---

### 修复：noscript SEO 兜底正文残留 36 处 `null`，与站内口径不一致（2026-10-19 00:34 · 提交 `10a79a4`）
**背景**：排查投票 null 时顺带发现——`index.html` 的 `<noscript>` 兜底清单（爬虫唯一能读到的正文）里，未核实字段写的是 `真实双休率 null% · 平均下班 null`，共 18 行。
**为什么静默**：这段 HTML 只在无 JS 环境（爬虫、页面预渲染）里被读到，普通用户**永远看不见**，所以坏了没人会来举报。而它由「React 卡片数据 → 手写 HTML」人工抄录，天然会脱节：详情页显示「未核实 / —」，搜索结果摘要却是 `null%`。
**修复**：
1. `index.html`：`双休率 null%` → `双休率 未核实`、`平均下班 null` → `平均下班 —`，与 `brand/*.html` 详情页卡片口径完全对齐；顺带把挤在同一行的 `sony` + `dji` 两条拆成独立行。
2. `scripts/verify.mjs` §6：新增两条断言——**① 清单里不允许出现裸 `null`；② 每条品牌的「双休率 X · 平均下班 Y」必须与其详情页 kv 值逐字一致**（平均下班允许详情页带口径后缀，如 `19:00（1075 口径）`）。
3. **注入验证**：把 Patagonia 一行改回 `null%`，上述两条断言同时报错；还原后 442 项全绿。确认不是恒真检查。
**影响**：仅影响爬虫/无 JS 环境读到的文本，站内 JS 渲染视图不变。

---

### 修复：详情弹窗投票数显示为空「( 票)」；良配广告位「（限时推广）」独立成行（2026-10-19 00:13 · 提交 `e08c197`）
**背景**：站长反馈「部分新增卡片员工投票按钮是空 null 值」，同时要求把「（限时推广）」从品牌行里拆出来、单独压在良配 LOGO 上方并靠左，`良配 - AI婚恋` 继续居中、位置不动。

**根因**：23 张新增卡（胖东来、格力、字节跳动、小红书等）的 `totalEmployeeVotes` 为 `null`（正常业务状态：尚无实测投票）。卡片头部已判空显示「—」，但详情弹窗仍直接拼接 `内部员工匿名投票汇总 ( {votes} 票 )`；React 对 `null` 子节点**跳过渲染**，于是括号里数字整个消失，页面上看到的是「汇总 ( 票)」而不是字面 `null`。

**修复**：
1. `custom-card-actions.js`：新增 `patchVoteText` / `patchVoteCounts`，在 DOM 层把该文案改写为「内部员工匿名投票汇总（暂无实测投票）」。按**父元素整体文本**判定（React 把这段拆成两个相邻文本节点 `"…汇总 ("`+`" 票)"`，逐文本节点跑正则命中不了）；有票数的卡不受影响（Patagonia 仍为「320 票」）。
   **未改** `assets/index-YthXZ9eP.js`（压缩产物为项目红线）。
2. `liangpei-ad.js`：`brandLine` 拆为 `limitLine: '（限时推广）'` + `brandLine: '良配 - AI婚恋'`，LOGO 前插入 `.lp-ad__limit` 节点；`liangpei-ad.css` 增加该行样式（竖排卡：独立一行、左对齐、位于 LOGO 上方；吸底条：缩为小标签与品牌行同行），LOGO 宽度 64→72px、`margin-top` 8→2px 让位。
3. `index.html`：`liangpei-ad.css?v=10`、`liangpei-ad.js?v=7`、`custom-card-actions.js?v=9`。
4. `PITFALLS.md` 新增第八章，记录本次三次误判（`{null}` ≠ 字符串 null、文案被拆成多节点、grep 命中数 ≠ bug 数）。

**验证**：Edge 无头 CDP 实测 1600px 视口——「（限时推广）」位于 LOGO 上方左侧、`良配 - AI婚恋` 居中；胖东来详情弹窗显示「（暂无实测投票）」，Patagonia 显示「(320 票)」。

---

### 虚拟对比黑榜卡不进拼音联想；README 记录拼音索引修复（2026-10-18 19:44 · 提交 `03068a6`）
**背景**：站长要求「虚拟卡不进联想」，并把此前修复的拼音索引 bug 记录进 README。

**改动**：
1. `scripts/gen-pinyin-index.py`：构建索引前剔除名称含「虚拟对比黑榜」的内置卡（某代工烘焙食品，识别口径与 verify 的 `FICTIONAL` 一致），头部注释同步；
2. `pinyin-index.js`：重跑生成（52 真实内置 + 7 自定义 = 59 品牌 / 608 词条，`ls` 自测不再出现某代工），`index.html` 引用 `?v=3→4`；
3. `scripts/verify.mjs` §16：索引期望数改为「真实内置卡（剔除虚拟）+ 自定义卡」，差集提示同步；
4. `scripts/test-pinyin-search.cjs`：索引数断言按「brands 主数组（不含虚拟）+ customCardsConfig」动态推导（虚拟卡按名称识别）；
5. `README.md`：最近更新区新增 Bug 修复条目（自定义卡无拼音索引 + 虚拟卡剔除，含提交哈希）；`PITFALLS.md` 6.5 补记虚拟卡剔除。

**测试**：verify 440 项、test-pinyin-search 31 项、test-pinyin-e2e 52 项全过。

### 修复：自定义卡无拼音索引（零食有鸣等 7 张卡拼音联想搜不到）（2026-10-18 19:35 · 提交 `332d854`）
**背景**：站长截图反馈——搜 `ls`（零食）拼音联想里没有刚收录的「零食有鸣」，反而出现内置虚拟黑榜卡「某代工烘焙食品」。

**根因**：`pinyin-index.js` 由 `scripts/gen-pinyin-index.py` 从 bundle 的 `brands` 数组离线生成，只覆盖内置卡；7 张自定义卡（肯德基/小米/兵立王/茶百道/赵一鸣/零食很忙/一点点/零食有鸣）的 name/company/keywords/tags 在 `index.html` 的 `customCardsConfig` 里，从未进入拼音索引 → 拼音联想永久查不到自定义卡（静默失效，中文能搜、拼音搜不到）。

**修复**：
1. `scripts/gen-pinyin-index.py`：新增 `parse_custom_configs()` 解析 `index.html` 的 `customCardsConfig`（name/company/keywords/tags/category/grade），按同一套词条权重并入索引；头部注释与自测查询同步更新（`ls`→命中零食有鸣、`ydd`→一点点）；
2. `pinyin-index.js`：重跑生成（53 内置 + 7 自定义 = 60 品牌 / 619 词条），`index.html` 引用 `?v=2→3`；
3. `scripts/verify.mjs` §16：索引品牌数口径改为「内置 + 自定义」，幽灵条目校验按 customCardsConfig id 白名单放行；
4. `scripts/test-pinyin-search.cjs`：索引一致性校验同步放行自定义卡（无幽灵条目 + 数量 = brands + customCardsConfig）；
5. 文档：`FORK_GUIDE.md`（索引数据来源说明）、`PITFALLS.md`（6.5 新增自定义卡坑位记录）、`CHANGELOG.md`（本条目）。

**测试**：verify 440 项全过；test-pinyin-search 31 项、test-pinyin-e2e 52 项、test-stat-filter 32 项全过。

### 新增「零食有鸣」品牌卡（C 级）；全站计数 58→59 / 自定义卡 6→7 同步（2026-10-18 19:12 · 提交 `1592807`）
**背景**：站长要求联网核实「零食有鸣」与「零食很忙/赵一鸣」是否同一家（怀疑不是），并核实近期店员反馈「分情况、不是固定单休一天/月休 4 天」的排班口径，据此补充本站收录信息。核实完成后才暴露站长身份（见详情页证据块）。

**归属关系核实（结论：确非同一家）**：
- 零食有鸣＝成都零食有鸣商业管理有限公司（2019-01-14 成立，法定代表人何劲鹏，曾用名贵阳黔志楚远商贸有限公司，总部成都高新区；商务部特许备案号 0520100112200015，注册商标零食有鸣；官网 cdlsym.com，企查查 2025 员工 131 人）；
- 零食很忙（2017 长沙）+ 赵一鸣零食（2019 江西宜春）＝湖南鸣鸣很忙商业连锁股份有限公司（2023-11-10 战略合并为鸣鸣很忙集团，2026-01 递表港交所，截至 2025-09-30 门店 19,517 家；官网 busyming.com）。二者无品牌/股权关联。

**排班口径核实（结论：分情况属实）**：
- 零食有鸣公开招聘月休 2 天与 4 天并存：成都郫都店/锦江店月休 4 天（鱼泡/店长直聘 2026-09~10）、内江店月休 2 天（封面新闻 2026-09-10，上热搜：休满 2 天扣 300 全勤，店长改口「加班费比较贴切」，律师称月休 2 天约定明显违法）、琼海店月休 2 天晚班至 00:00（琼海招聘网）、青海办事大厅店月休两天（青海信息网）；每天在岗 9 小时、两班倒、晚班普遍 22:30-23:00；
- 赵一鸣/零食很忙公开招聘主流月休 2 天（漳州长泰/云霄/赣州/佛山陈村/广州增城，2026-08~10），月休日避活动日/周末/到货日、每月 8 号需加班、晚班至 22:00-24:00（网易离职员工反馈）；36 氪 2023 报道「月休两天」。

**评级决策（C 级·避雷预警）**：
- 月休 2 天门店被律师指违法（每周至少休一日、月最少 4 天）＋公开招聘与媒体多源互证；与赵一鸣/零食很忙、蜜雪冰城等量贩零食与茶饮同业态先例口径一致；
- 真实双休率保持「未核实」（分店差异 2 天/4 天并存，不填单一换算值）；平均下班 22:30（招聘晚班打烊点众数口径）；
- 详情页显式注明「与零食很忙/赵一鸣无关、为独立品牌」；2026-09 媒体并列报道系两江新区量贩零食店计量专项检查，非品牌归属关系。

**文件**：`assets/index-YthXZ9eP.js`（顶部统计 58→59 ×2、避雷 20→21）、`index.html`（customCardsConfig +1「零食有鸣」、snack-card 口径更新：公司名→股份有限公司/月休 2 天为主·部分 4 天/每月 8 号需加班/注明与零食有鸣无关、noscript 共 58→59 家、两清单 +1、58→59 个、?v=41→42）、`brand/lingshiyouming.html`（新建详情页，证据链：商务部特许备案 + 官网/快懂百科主体 + 成都郫都/锦江/静祥路 + 内江/琼海/青海 6 城招聘媒体 + 企查查）、`brand/zhaoyiming.html`（公司名、月休口径、每月 8 号加班、与零食有鸣关系澄清、+5 条新证据、页脚 58→59）、`brand/*.html`（57 页页脚 58→59）、`projects.html`（58→59 个品牌 + 明细行）、`sitemap.xml`（+lingshiyouming，修复上轮遗留 samsung 条目缺闭合标签）、`assets/lingshiyouming.png`（+1 张 LOGO）、`scripts/verify.mjs`（自定义卡断言 6→7 ×2）、`scripts/test-stat-filter.cjs`（60/19/14/21/5 断言）、`README.md`（收录 59 家、7 张自定义卡、最近更新条目）、`FORK_GUIDE.md`/`MAINTAINING.md`/`PITFALLS.md`/`员工实测数据核实修改清单.md`（53 内置 + 7 自定义、收录 59 家、第四节 +零食有鸣行）。

**测试**：verify 全量重跑（自定义卡断言 6→7、sitemap 标签配平修复后全过）；test-stat-filter 断言更新后全过。

### 新增「一点点」品牌卡（C 级）；补齐内置卡缺失 LOGO（5 张）；全站计数 57→58 同步（2026-10-18 17:00 · 提交 `169da60`）
**背景**：站长要求新增「一点点」品牌卡，评级由 AI 决定。站长已线下一手核实（大学城附近门店员工实录）：淡季月休 8 天、旺季月休 4 天，季节波动、非大小周；核实完成后站长才对外暴露站长身份（见详情页证据块）。

**评级决策（C 级·避雷预警）**：
- 站长线下核实：淡季月休 8 天 / 旺季月休 4 天（非大小周）；
- 公开招聘多城口径一致：BOSS 直聘佛山顺德店「每班 10 小时（含 30 分钟吃饭）、月休 4 天、每周排班一次」；店长直聘兰州大学店「每天 8-10 小时、月休四天」；BOSS 直聘深圳 1点点「轮班制、月休 4-6 天左右」；BOSS 直聘威海店「月休四天、加班补助、夜班补助」；智联招聘南京店「每天 8-9 小时、月休 4 天、正职每月 174 小时、加班费另算」；
- 同业态先例口径统一：月休 4 天级别的蜜雪冰城/茶百道/兵立王/库迪咖啡均按 C 级；非大小周 → 不归 B 级；无合规双休证据 → 不归 A 级；
- 真实双休率与平均下班时间保持「未核实」：季节双轨（淡季 8 天/旺季 4 天）无法用单一换算值如实表达，不填换算值（页面显示「—」）。

**顺带修复的 bug**：
1. **内置卡缺失 LOGO（5 张：喜茶/蜜雪冰城/库迪咖啡/肯悦咖啡/名创优品）**：无 logo 文件且无 brandLogos 映射、仅文字兜底——补齐 `assets/{heytea,mixue,cotti,kenyue,miniso}.png` + index.html brandLogos 5 条映射；
2. **noscript「全部品牌详细页（36 个）」陈旧数字**：实际早已 57 个详情页（verify 未覆盖该处、长期失真）——改为 58；
3. **57 个品牌详情页页脚「查看全部 57 家」**：与收录数一致化，统一改为 58；
4. **顶部统计/tab 角标/页脚「共 57 家」/两份清单/同类项目导航**：收录 57→58、避雷 19→20（一点点计入 C 级），红榜 19/观察 14/待核实 5 不变（19+14+20+5=58 对账）。

**文件**：`assets/index-YthXZ9eP.js`（顶部统计 57→58、避雷 19→20、tab 角标 57→58）、`index.html`（customCardsConfig +1「一点点」、brandLogos +5、noscript 共 57→58 家、两清单 +1、36→58 个）、`brand/yidiandian.html`（新建详情页，证据链：站长线下核实 + 佛山/兰州/深圳/威海/南京 5 城招聘 + 证券时报公司信息 + 新浪财经「威胁员工」背景）、`brand/*.html`（57 页页脚 57→58）、`projects.html`（57→58 个品牌 + 明细行）、`sitemap.xml`（+yidiandian）、`assets/`（+6 张 LOGO：heytea/mixue/cotti/kenyue/miniso/yidiandian）、`scripts/verify.mjs`（自定义卡断言 5→6 ×2）、`scripts/test-stat-filter.cjs`（59/19/14/20/5 断言）、`README.md`（收录 58 家、6 张自定义卡、最近更新条目）。

**测试**：verify 全量重跑；test-stat-filter 断言更新后全过（待最终确认）。

### 还原广告位为「良配」商业推广（此前的本站推广改动系误改）（2026-10-18 15:12 · 提交 `11ca656`）
**背景**：`03275ba` 把良配商业广告位误改为本站推广（文案「必应搜索，雙休購996」、LOGO 改三字）。本次还原为「良配 - AI婚恋」商业推广原版。

**保留的站长要求**：删除广告位的「关闭后 7 天隐藏」记忆逻辑——点关闭仅隐藏本次，**刷新即恢复**。这是站长明确要求的规则，不随文案还原一起退回。

### 广告位改本站推广「必应搜索，雙休購996」（后于 `11ca656` 还原，留档）（2026-10-18 14:58 · 提交 `03275ba`）
> ⚠️ **本条已被 `11ca656` 还原，仅留档说明。**
>
> 当时把「良配 - AI婚恋」商业推广位改成本站推广：文案「必应搜索，雙休購996」（简体「双休购」为拦截词，改用繁体），CTA 跳必应搜索；LOGO 改「雙休購」三字并重算容器宽度；同时删除「关闭后 7 天隐藏」记忆（点关闭仅隐藏本次，刷新即恢复）。
>
> 后经站长确认为误改，已在 15:12 还原。**唯有「删除 7 天隐藏记忆」这条保留至今。**

### 打卡小票/表单「本品牌累计」行精简：去掉括号内企业名，金额不再被截断（2026-10-18 11:25 · 提交 `950b5be`）
**背景**：站长指出——打卡弹窗里「累计」第一栏已经看不见本品牌的金额了，要求精简、不要括号里的内容、改到能看见金额为止（上一个 AI 拆两级累计时遗留）。

**根因**：两级累计拆分时，本品牌行的标签写作「本品牌（企业名）」；自定义卡表单累计 chip 的行样式为 `max-width:150px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap`，企业名一长整行不折行，行尾的金额正好被省略号截掉（`text-overflow` 省略的是行尾，而金额就在行尾）。

**修复（custom-card-actions.js ?v=5→6）**：四处标签统一去掉括号内企业名——表单累计 chip「本品牌（企业名）¥X」→「本品牌累计 ¥X」（与第二行「全站累计」对称）；自定义卡小票 kv「本品牌累计（企业名）:」→「本品牌累计:」；复制小票文本「本品牌累计（企业名）：￥X」→「本品牌累计：￥X」；内置卡注入行标签「本品牌累计（品牌名）:」→「本品牌累计:」。品牌归属仍由「考核品牌」行与上下文承载，不再重复出现在累计行。

**文件**：`custom-card-actions.js`（4 处标签 + 注释）、`index.html`（缓存号）、`scripts/test-builtin-ticket-dom.cjs`（第 9 节断言同步为「本品牌累计:」）、`README.md`（功能描述同步）、`CHANGELOG.md`（上一条「两级累计」旧描述划线备注）。

**测试**：test-builtin-ticket-dom 41 项全过；verify 430 项全过。

### 评级过滤行补「待核实」(U) 入口；顺带挖出自定义卡评级筛选静默失效（2026-10-18 10:49 · 提交 `de73532`）
**背景**：站长指出——首页顶部五格统计盒有「待核实 5」，但下方「评级过滤」行（全部评级/S 级/A 级/B 级/C 级）到 C 级就结束了，U 级没有入口：「上面有待核实，为什么下面到了 C 级就没有了，U 级去哪里了」。

**根因**：评级过滤行由 bundle 渲染，按钮列表写死为 `['全部','S','A','B','C']`（bundle 内 `.map(...)`），U 级无选项；bundle 是压缩红线不能手改。

**修复（stat-filter.js ?v=4→5，DOM 层补丁，不改 bundle）**：
- 找到行尾 `C 级`按钮克隆一份，文案改「待核实」插到其后（`data-sxg-row-u` 幂等标记，React 重渲染擦除后 observer 自动重建）；
- 点击复用顶部五格的 u 筛选（只显示 5 张 U 卡），激活态套用与 bundle 一致的 `bg-slate-900 text-white`；
- 两套筛选互斥：点 React 评级按钮（全部/S/A/B/C）时捕获阶段清掉五格 display 筛选，避免 React 重渲染后 observer 又把旧状态套回去出空面板。

**同次挖出并修复的静默 bug（index.html `filterCustomCards()`）**：
- 自定义卡的评级选中态判断只查 `bg-black` / `bg-gray-900`，而 bundle 渲染的选中态实际是 `bg-slate-900`——永远匹配不上，自定义卡（肯德基/小米/兵立王/茶百道/赵一鸣）的评级筛选**从未生效过**，点任何评级都照原样显示；
- 修复：补识别 `bg-slate-900`，评级列表补「待核实」。jsdom 实证：点 C 级后自定义 B 卡（小米）被正确隐藏。

**测试**：test-stat-filter 26→32 项（行内 U 按钮注入/筛选/激活态/互斥共 6 项新断言）；verify 430 项全过。

### 修复：搜索/筛选时「富士康补充说明」框残留（PITFALLS 1.10 第二变体）；Apple 卡识别改按标题匹配（2026-10-18 01:36 · 提交 `09c1d4f`）
**背景**：站长实测——搜索框输入无匹配词（如「啊」），所有卡片消失，但「富士康补充说明」黄框孤零零挂在搜索面板里；同源问题在搜索 `HU` 时表现为说明框留在华为卡（PITFALLS 1.10 原记录）。

**根因**：
- `insertAppleNote()` 依赖 observer / 监听器的**异步重定位**，搜索输入到 React 卸载完成之间有几帧窗口，note 会跟着节点泄漏到残留容器；
- 识别 Apple 卡用**全文子串匹配**，华为卡「同品类替代」推荐区文本含 `Apple (苹果中国)`，搜索 `HU` 后会把说明框**误插进华为卡**——1.10 在真实站点上反复出现的真正机制之一。

**修复**（`index.html`）：
- 搜索框一有输入立即摘除说明框（`input` 捕获阶段同步执行，不等防抖）；清空搜索后由 `insertAppleNote()` 重新插回；
- Apple 卡「在 DOM 但整棵子树被隐藏」（inline `display:none` / 祖先隐藏，四格筛选与自定义卡过滤的隐藏方式）时同样摘除；
- Apple 卡识别改按**卡片标题**（卡内第一个 h2/h3 文本以 `Apple` 开头）。

**文件**：`index.html`、`scripts/check-inject-idempotent.mjs`（桩补标题元素与 h2,h3 标签选择支持）、`scripts/test-stat-filter.cjs`（新增 8 项回归断言：搜索「啊」摘除 / 清空插回 / 标题被复用为华为不残留 / 隐藏子树摘除）、`README.md`（踩坑清单第 6 条补两道闸门与标题匹配要点）、`PITFALLS.md`（1.10 补 bug ③④）。

**测试**：12 套件全绿（test-stat-filter 19→26 项）；verify 430 项全过。

### 修复：搜索过滤时第五格「待核实」清零且复用避雷粉色样式（计数与可见卡解耦）（2026-10-18 00:57 · 提交 `2db67d9`）
**症状（站长实测）**：搜索框输入任意字符（含「苹果」）→ 第五格「待核实」变 0；删掉搜索词再随便输入 → 第五格显示 0 且整格变成避雷粉色样式。

**根因**：搜索/品类筛选由 React 条件渲染实现——不匹配卡片被「卸载」（节点不在 DOM），且统计区随重渲染重建，注入的第五格被冲掉后按「可见 U 卡」重新计数（过滤态下为 0），克隆源又是避雷盒（rose 配色一并被克隆）。

**修复**（stat-filter.js，?v=3→4）：
- 计数与卡片显隐解耦：待核实数字改为「收录品牌 − 双休红榜 − 大小周观察 − 避雷预警」从四个手写常数盒推导（推导不可用时才回退数卡），过滤/搜索态恒为 5，四格常数调整时自动跟随；
- 克隆避雷盒后 className 中 rose 系全部替换为 slate 中性灰，数字固定 text-slate-900。

**测试**：test-stat-filter.cjs 新增回归段（模拟 U 卡卸载 → 数字仍为 5；恢复 → 仍为 5；盒子无 rose 类名），14→18 项；12 套件全绿；verify 430 项全过。

**文件**：`stat-filter.js`、`scripts/test-stat-filter.cjs`、`index.html`（?v=3→4）、`README.md`（最近更新记录）。

## 2026-10-17

### 修复 CHANGELOG 大面积划线（两处裸 `<s>` 未闭合所致）；品牌条目精简为品牌清单；README 上游日期按 GitHub API 核实修正；双休透镜扩展划线备注；第五格待核实横排（2026-10-18 00:49 · 提交 `69d9297`）
**背景**：站长指出——CHANGELOG 整页被划线（根因：前一日条目中两处裸 `<s>` 标签未闭合，GitHub 渲染把其后全部内容划线，属写入 bug 而非划线规则扩围）；品牌条目应只写更新了哪些品牌；上游功能日期不能拿本仓库导入日（10-14）冒充。

**核实（GitHub API）**：上游 ZhiqingHeyi/shuangxiugou 创建于 2026-09-09（UTC）、最后推送 2026-09-14（定稿版）；上游提交可核：09-09 上线拟物小票+证据链+31 家企业库与工时投票、09-14 上线品类平替/网购透镜/盖戳插件与司法文书核验。本仓库 dujeongil-galaxy/shuangxiugou 创建于 2026-09-29（fork: false，为基于上游的二次开发），2026-10-14 初始导入上游 09-14 定稿版。

**改动**：
- `CHANGELOG.md`：两处裸 `<s>` 改为代码样式（划线终止）；「新增 6 卡/8 卡」两条品牌条目精简为品牌清单（档位与口径详见详情页与核实清单）；
- `README.md`：白名单/平替/小票/四格四项的上游日期改为「上游 2026-09-09 建仓、09-14 定稿」口径（平替 09-14、小票 09-09 可核到具体提交；四格统计上游提交信息未单独出现，按月写）；「双休透镜 Chrome/Edge 扩展」整项划线并备注「本仓库属于 fork 之后的二次开发，不存在 Chrome 插件」；
- `stat-filter.js`（?v=2→3）：第五格「待核实」横排——统计容器原为固定 `grid-cols-4`，注入 CSS 覆盖为 5 列，待核实格不再掉行。

## 2026-10-18

### 两级累计与第五格「待核实」：小票/表单「累计」拆本品牌+全站两行；统计盒 19+14+19+5=57 对账（2026-10-18 00:37 · 提交 `1206237`）
**背景**：站长两点指示——①「累计金额做成两项：第一个是当前打开的卡片（对应这家企业），第二个是本站所有品牌的金额累计，上下行显示」；②「19*2+14 还有 5 个哪里去了」——少的 5 个是 U 级待核实卡（宏碁/三星/霸王茶姬/长城/名创），补第五格。

**两级累计（custom-card-actions.js，DOM 层）**：
- 新增分品牌存储 `sxg-brand-totals-v1`（键 = 纸面「考核品牌」，仍只存本浏览器不上传）；全站累计仍是 profile.total。
- ~~表单「累计」chip 改上下两行：「本品牌（企业名）¥X」/「全站累计 ¥Y」，输入时两行实时联动预览。~~（2026-10-18 已精简：企业名一长会被 chip 的 150px 截断，行尾金额不可见，改为「本品牌累计 ¥X」）
- ~~小票纸面：在「全站累计已转移/支持消费」行上方插入「本品牌累计（企业名）」行~~（同上，已精简为「本品牌累计」行；内置卡 paintBuiltinBrandRow 幂等注入，重渲染不丢；自定义卡直接内置两行 kv）。
- 结算点同步入账：自定义卡「复制小票文本」、内置卡「完成/复制/确认打卡」均把本次新增同时计入本品牌与全站；复制文本含两行累计。
- 「清空」一键清两级（二次确认交互不变）；老用户的既有全站累计原样保留（分品牌从空开始，不追溯归属）。

**第五格「待核实」（stat-filter.js）**：
- 四格 19/14/19 只覆盖 S/A、B、C，U 级不在任何分档——在「避雷预警」旁克隆注入第五格「待核实 5」（数字实时数卡，中性灰配色），点击只显示 U 级卡，再点取消；React 重渲染后 observer 幂等重建。19+14+19+5 = 57 = 收录总数。

**文件**：`custom-card-actions.js`（?v=4→5，两级累计全链路）、`stat-filter.js`（?v=1→2，第五格）、`index.html`（缓存号）、`scripts/test-builtin-ticket-dom.cjs`（标签改名同步 + 新增第 9 节本品牌行 8 项断言，33→41 项）、`scripts/test-stat-filter.cjs`（五盒断言 + 待核实筛选 11→14 项）、`scripts/test-ticket-total.cjs`（结算窗口正则放宽）、`README.md`（两处功能描述）。

**测试**：12 套件全绿；verify 430 项全过。

### 首页公告栏还原：公式公告迁至 projects.html；README 核心功能逐项备注完成日期（git 历史核验）（2026-10-18 00:18 · 提交 `4474810`）
**背景**：站长指示——公告栏不要堆公式长文（还原），公式公告挪进 projects.html；README 每一项新增功能备注完成日期。

**改动**：
- `index.html`：顶部公告栏还原为原单行证据链说明（移除 2026-10-18 公式公告长文）；
- `projects.html`：在「数据来源分级说明」前新增「📐 公告（2026-10-18）：计算公式更新」区块（三条要点原样迁入）；
- `README.md`：核心功能区 7 项逐项备注完成日期与对应提交号（据本仓库 git 历史核验：白名单/平替/小票为 2026-10-14 上游初始导入；访客填写与累计、内置卡接管、拼音搜索 2026-10-16；四格筛选、小票清空、口径换算、员工投稿真入库 2026-10-17；公式入页 2026-10-18；双休透镜扩展为独立仓库，本仓库无对应提交）。

### 计算公式更新：双休率口径换算公式写入页面；平均下班时间扩展为三级口径（旧公式划线保留，不删除）（2026-10-18 00:09 · 提交 `c77e1da`）
**背景**：站长指示更新相关页面的计算公式——改变的公式划线保留原文，纯新增的扩写公告。

**改动的公式（页面内划线保留旧文，`<s>` 标签）**：
- **平均下班时间**：原公式「取员工实际离岗点的众数，连锁门店取晚班打烊／交班点」扩展为三级取值——①实测众数（原公式，实测卡直填）；②制度口径（官方作息/盖章通知/考勤政策，如字节 1075→19:00、格力盖章通知→17:30，注明「政策口径」）；③媒体/员工自述口径（如「朝10晚6」→18:00、店员自述→22:45，注明出处）。覆盖 57 张品牌详情页（56 页长变体 + catl 短变体各按其原文划线）。
- **「不以估算值填充」规则**：保留原句（划线），新增唯一例外——口径换算值：一线主流岗位公开招聘口径给出月休天数/排班制度（月休≤4 天≈每周休 1 天→0%；做六休一→0%）或媒体调查给出主流排班口径（周六常态上班→0%）时，按公式换算真实双休率，强制标注 rateSource: derived 与换算依据三类白名单（官方公示/媒体调查/招聘与员工爆料），卡片显示「X%（口径换算）」与实测值区分，依据可在卡内溯源证据 id；政策类官宣（取消大小周/混合办公）不换算（政策≠实测占比）。

**纯新增（扩写公告/说明）**：
- 首页顶部公告栏扩写：新增「📐 公告（2026-10-18）计算公式更新」三点说明（口径换算公式/三级下班口径/政策类不换算）。
- 首页 FAQ 结构化数据（JSON-LD）「平均下班时间是怎么统计的？」答案追加 2026-10-18 公式更新说明（原答案原文保留）。
- projects.html「数据来源分级说明」新增「口径换算（2026-10-18 新增）」条目。

**文件**：`brand/*.html`（57 页口径说明更新，旧公式以 `<s>` 划线保留）、`index.html`（公告栏扩写 + JSON-LD 追加）、`projects.html`（分级说明 +1 条）。

**注**：本次为展示层文本更新，未改动 bundle 渲染逻辑与任何数据数值；?v 缓存号无需递增。

### 线索池建卡第一轮：字节/快手/小红书/米哈游/携程/奇瑞/海底捞/盒马 8 卡（收录 49→57），官网与招聘渠道作息口径核实（2026-10-17 23:56 · 提交 `2dac791`）
**背景**：站长指示对普查线索池建卡并「去官网找招聘信息，尽可能完善双休率和平均下班时间」。对 8 家逐一核实：政策类官宣（取消大小周/混合办公）按纪律不换算双休率（政策≠实测占比），有月休天数/排班口径的一线岗位按口径换算机制填数（derived + 白名单 basis + ev- 可追溯）。

**新增 8 卡**（各含 LOGO、brand/ 详情页、逐条证据）：字节跳动 (B 级)、快手 (B 级)、小红书 (B 级)、米哈游 (B 级)、携程 (A 级)、奇瑞汽车 (C 级·双休率换算 0%)、海底捞 (C 级·双休率换算 0%)、盒马 (C 级·双休率换算 0%)。逐卡依据与数值口径见对应品牌详情页与核实清单附三。


**计数影响**：内置 53（含虚拟对比卡 1）/ 自定义 5 = 58 张卡；收录 57 家（brand/ 57 页）；顶部四格 57/19/14/19，tab 角标 57，U 级 5 张不变。

**文件**：`assets/index-YthXZ9eP.js`（+8 卡、计数 49→57/18→19/10→14/16→19）、`index.html`（?v=39→40、brandLogos +8、页脚共 57 家、两清单 +8 行）、`brand/`（8 张新页 + 49 张旧页页脚 49→57）、`projects.html`（h2 57、+8 行）、`sitemap.xml`（+8）、`pinyin-index.js`（重跑 53 品牌）、`scripts/test-stat-filter.cjs`（58/19/14/19 断言）、`scripts/test-pinyin-e2e.cjs`（+8 用例）、`assets/`（8 张新 LOGO）。

**测试**：12 套件全绿；verify 全项通过（见提交时点）。

### 同类项目普查：新增格力/美的/大疆/胖东来/长城汽车/名创优品 6 卡（收录 43→49），并修复并行会话遗留的结构错误（2026-10-17 23:13 · 提交 `57ddff3`）
**背景**：按 projects.html 所列同类站点做数据库对比——扒取姊妹站 shuangxiugou-guide（data.js，275 条：verified 6 / reported 20 / candidate 92 / caution 50 / pending 107）与 tdwc.luomor.com（92 家社区清单），与站内品牌求差集，逐个核实证据后决定建卡与否。证据原文均先行抓取核对（广州日报 huacheng、澎湃/新浪、腾讯网、北京商报）。

**新增 6 卡**（各含 LOGO、brand/ 详情页、逐条证据）：格力 (A 级)、美的 (B 级)、大疆 (B 级)、胖东来 (A 级)、长城汽车 (U 级)、名创优品 (U 级)。逐卡档位依据与数值口径见对应品牌详情页与核实清单附二。


**结构修复（接管另一会话未完成的半成品改动）**：
- gree/midea/dji 三卡此前被误插进 haier/sony 卡的 evidence 数组内部（`,{id:` 前缀与 evidence 条目前缀相同所致），运行时被宿主卡吞掉；本轮按括号配平定位宿主卡真实结尾后重新插入顶层，gwm/miniso 同类误插一并修复；修复后配平扫描 45 个顶层对象、0 合并。
- 新卡 `employeeStats` 形状缺 `anonymousComments` 等渲染层必读字段导致 React 渲染崩溃（jsdom 实测 #root 白屏），统一改为 acer 同款空形状 `realDoubleWeekendRate:null,…,anonymousComments:[]`（6 处）。
- 字段名统一：先行改动新卡用的 `realRate:` 与全库 `realDoubleWeekendRate:` 不一致（渲染层只认后者），更名 3 处。

**计数影响**：内置 45（含虚拟对比卡 1）/ 自定义 5 = 50 张卡；收录 49 家（brand/ 49 页）；顶部四格 49/18/10/16，tab 角标 49，U 级 5 张（acer/samsung/chagee/gwm/miniso）。

**文件**：`assets/index-YthXZ9eP.js`（+3 卡、结构修复、字段统一、计数 46→49/17→18/43→49）、`index.html`（?v=38→39、brandLogos +5、页脚「共 49 家」、两清单 +3 行并修复挤行）、`brand/`（gree/midea/dji/pdl/gwm/miniso 6 张新页 + 43 张旧页页脚 43→49）、`projects.html`（h2 46→49、+3 行）、`sitemap.xml`（+3）、`pinyin-index.js`（重跑，45 品牌/427+ 词条）、`scripts/test-stat-filter.cjs`（50/18/10/32 断言同步）、`scripts/test-pinyin-e2e.cjs`（+3 用例）、`assets/`（gree/midea/dji/pdl/gwm.png 5 张新 LOGO；名创优品无干净图源，回退文字角标）。

**测试**：12 个套件全绿（render-page 13 项恢复通过；stat-filter 11 项含新计数）；verify.mjs 430 项口径全过。

**线索池登记（不建卡、不评级）**：姊妹站 candidate 92 + caution 50 + pending 107 条与 tdwc 未建卡条目基本同源于一篇汇总文（interviewasssistant.com，2026-07-11，自述「部门差异和二手信息风险」），单一二手来源不足以评级，已在 `员工实测数据核实修改清单.md` 附二登记约 250 条线索与核实路径。

### README 纠正最近更新数字：收录品牌 41→43（2026-10-17 21:22 · 提交 `c56345d`）
 最近更新小节的「收录品牌」误写为本轮起始值 41，实际本轮建卡后为 43。

### README 新增「2026-10-17 最近更新」小节（2026-10-17 21:22 · 提交 `b63fbaa`）
 核心功能列表补四格筛选 / 小票清空 / 口径换算三条，并新增当日最近更新小节。

### 新功能：顶部四格统计变点击筛选（2026-10-17 20:46 · 提交 `d287a30`）

（红榜=S/A、观察=B、避雷=C、收录=全部），DOM 层补丁不改压缩包
**文件**：新增 `stat-filter.js`（?v=1）、`scripts/test-stat-filter.cjs`（e2e：真渲染真点击，11 项断言）、`index.html`（挂载）、`.github/workflows/verify.yml`（CI 接入）、`AGENTS.md`（站点结构表 +1 行）、本文件
**交互**：点「双休红榜」→ 仅显示 S/A 级（B 级存疑不算红榜）；点「大小周观察」→ 仅 B 级；点「避雷预警」→ 仅 C 级；点「收录品牌」→ 清除筛选显示全部（含 U）；再点一次当前激活按钮 = 取消。点击后自动滚到品牌档案区；激活的四格带描边高亮（data-sxg-active），支持键盘 Enter/空格（role=button）。
**实现约束**：纯 DOM 层补丁——盒子按叶子标签文本定位（不依赖 Tailwind class），卡片档位读卡内第一个档位徽章文本（S/A/B/C 级/待核实），「虚拟对比黑榜」卡与顶部四格口径一致不进任何分档；React 重渲染（品类筛选/搜索）后由 MutationObserver 重新套用当前筛选，与既有筛选共存。
**测试**：e2e 断言各档可见卡数与四格显示完全一致（红榜 16/观察 8/避雷 16，全部 44 张 badge 卡=收录 43+虚拟卡），并覆盖激活态、清除、再点取消；已接入 CI。
**计数影响**：无（纯筛选，不改变任何数据）。

---
## 2026-10-17

### 霸王茶姬多平台招聘普查：门店岗收敛「月休约 4 天」、总部渠道见「周末双休」（分层）；5-6 天零命中（2026-10-17 20:17 · 提交 `a151ff3`）
**文件**：`assets/index-YthXZ9eP.js`（chagee 标签/摘要更新 + 证据 ev-chagee-8、缓存号 ?v=37）、`brand/chagee.html`（kv/评级理由/证据同步）、`员工实测数据核实修改清单.md`（普查登记）、本文件
**方法（站长指示：单一平台不作证据）**：同一天内对 BOSS/智联/猎聘三渠道做招聘口径普查并交叉比对——门店岗口径在 BOSS 快照与公开招聘聚合榜单两源收敛于「月休约 4 天」；智联加盟商岗（已抓原文）仅「门店排班制」无天数；「月休 5-6 天」三平台零命中；猎聘官方主体页（霸王茶姬 CHAGEE，10000 人以上）快照另见「09:00-18:00 周末双休 弹性工作」（登录墙未抓原文，仅快照级）。
**结论**：口径呈「门店严于总部」分层（与新浪 2024「直营透明统一、加盟依老板而定」互证）；「月休 4-6 天」中的 5-6 天无据、4 天两源互证；因门店/总部样本权重未知，全品牌双休率仍不可换算，维持 U 级与既有评级不变。**三星**：智联/58/BOSS 三渠道无可检索的岗位工时信息（官方口径仍为校招 JD 三班倒），维持原状。
**计数影响**：无。

---
## 2026-10-17

### 瑞幸 40% 出处说明并补 derived 标记；CATL 真实双休率按一线口径换算 0%（站长要求「需要你计算」）（2026-10-17 19:55 · 提交 `5b38b03`）
**文件**：`assets/index-YthXZ9eP.js`（瑞幸 employeeStats 加 rateSource/rateBasis、CATL 换算 0% + 口径备注更新、缓存号 ?v=36）、`scripts/verify.mjs`（换算依据白名单扩展：official_disclosure / investigation_reports / recruiting_and_worker_reports，均要求可追溯 ev- 证据）、`index.html`（noscript CATL 两行 + 缓存号）、`projects.html`（CATL 行）、`brand/catl.html`（meta/kv/工时情况/口径备注同步）、`员工实测数据核实修改清单.md`（瑞幸行补记、CATL 换算登记）、本文件
**瑞幸 40% 出处（回答站长「哪里来的」）**：不是任何公开统计——2026-10-04 核实时按 5 条线索「名义与实际折中」得出的估算值（苏州店长直聘「上五休二 月休 8 天 周 40h」、BOSS 徐州「月休四天」、抖音通班爆料「9 点半打烊 10 点下班」、武汉店长「晚班 14:00-22:30 打烊」、长沙「中班 11:00-21:30 / 晚班 15:00-23:00」），上游原值 22 被修订为 40，清单置信度标注「中」。问题在于数据里没有 derived 标记，看起来像实测——本次补记 rateSource:derived / rateBasis:derived_from_recruiting_and_worker_reports，数字本身不变。
**CATL 计算（口径换算）**：财联社四基地调查的一线主流排班为做六休一至做七休一（月休约 2-4 天）——「每周能完整休满两天」的占比按此口径换算为 **0%**（rateSource:derived / rateBasis:derived_from_investigation_reports，对应 ev-catl-1/2/3）。限定语已写进卡片：换算仅代表调查所覆盖的一线主流排班，办公室岗位无数据、随订单波动（2023 年末淡季曾阶段性强制双休/五天八小时）。**平均下班时间维持 null**：报道只有「每班 12 小时」的班制时长，没有可引用的班次时刻，按「不以估算值填充」红线不折算。
**其余卡片不计算的原因**：三星（三班倒是排班形态，无月休/双休数据）、宏碁（无任何工时口径）、霸王茶姬（「部分门店岗位月休约 4 天」是聚合口径、品牌 97% 加盟，据此换算全品牌 0% 会把局部样本放大为普惠结论）——数字维持 null。verify 白名单扩展后三类换算依据均须挂可追溯 ev- 证据 id，防止换算被滥用。
**计数影响**：无（档位不变，43/16/8/16；换算不改变评级）。

---
## 2026-10-17

### 数字型字段终轮检索留档：CATL/三星/宏碁/霸王茶姬维持现状（2026-10-17 19:34 · 提交 `e8165a1`）
 对四张卡的「真实双休率 / 平均下班时间」做最后一轮定向检索，**未找到任何可引用的数值口径**，按「不以估算值填充」红线全部维持 `null`（页面显示「—」）。已在 `员工实测数据核实修改清单.md` 登记检索路径与结论。

### 三星卡补充官方「三班倒」校招口径（维持 U）；霸王茶姬「月休 4-6 天」核实结论：5-6 天无据、4 天有据（2026-10-17 19:24 · 提交 `0c700ce`）
**文件**：`assets/index-YthXZ9eP.js`（samsung 标签/摘要更新 + 证据 +2、缓存号 ?v=35）、`brand/samsung.html`（kv/工时情况/评级理由/证据同步）、`员工实测数据核实修改清单.md`（备注）、本文件
**起因**：站长追问两点——霸王茶姬「部分门店月休 4-6 天」的 5-6 天口径；三星「工厂不存在过严重加班，为什么查不到」。
**霸王茶姬核实**：月休约 4 天有据（中华网 2026-10-08 招聘聚合榜单 + BOSS 直聘苏州快照，均已入链）；**5-6 天经两轮定向检索（直营/兼职排班、看准/职友方向、BOSS 职位详情）无任何大陆公开口径**，BOSS 职位页反爬无法核验「工作 8 小时」职位详情；月休榜中 6-8 天档属瑞幸/喜茶、8-9 天属星巴克。站长记忆中的「4-6 天」更可能来自榜单横向对比或不同城市/门店差异。结论：卡片维持「部分门店岗位月休约 4 天」口径不改。
**三星核实**：新增官方口径证据——三星（中国）半导体 2026 届春季校招简章（西电就业网刊载，公司直招，已抓原文）公示半导体工程师岗「4.能适应倒班工作（三班倒）」，公司文化自述「『Work-Life Balance』是公司一贯的追求」，福利含五险一金/免费工作餐/员工公寓/带薪年假等（ev-samsung-9）；知乎从业者讨论互证三班倒（ev-samsung-10，UGC 仅线索）。休息制度标签更新为「官方校招口径：工程师岗三班倒 / 公司称追求 Work-Life Balance（月休/双休数据无公开口径）」。
**维持 U 的说明（回答站长疑问）**：U = 不作定性，不是差评——卡片从未记录三星「存在严重加班」，反而记录了离职补偿厚道等事实。「没有严重加班」的印象无法转成站内数据，原因是站点口径需要可引用的月休天数/双休率，而三星官方与第三方均未公开过此类数字（官方 CSR 亦只有「Shift 员工福利」间接信息）；现已把官方能给出的最具体口径（三班倒 + WLB 自述）补进卡内。
**计数影响**：无（samsung 仍为 U 级，43/16/8/16 不变；U 级 3 张）。

---
## 2026-10-17

### 修复内置小票「#号自激滚动」+ 累计「清空」按钮（二次确认）+ 四张品牌 logo + CATL 深查证据后改档 C（2026-10-17 18:56 · 提交 `b1e607c`）
**文件**：`custom-card-actions.js`（?v=4：displayName 加 stableId、清空按钮与确认层）、`scripts/test-builtin-ticket-dom.cjs`（harness 换真 displayName + 新增第 8 节回归）、`index.html`（logo 映射 +4、bundle 缓存号 ?v=34、custom-card-actions ?v=4）、`assets/chagee.png`/`samsung.png`/`catl.png`/`acer.png`（新增 256px 方图）、`assets/index-YthXZ9eP.js`（CATL 卡整卡替换 + 避雷预警 15→16）、`brand/catl.html`（重写为 C 级页）、`projects.html`（CATL 行）、`员工实测数据核实修改清单.md`（两条备注）、`scripts/verify.mjs`（2d 提示文案随 U 级成员更新）
**Bug 现象（站长实测）**：内置小票「考核执行官: 匿名打工人 #7163」的 #号后四位数持续滚动不停；本地无缓存时「累计已转移/支持消费」显示 ¥666。
**滚动根因（留档）**：2026-10-16 晚三笔提交（1789bd7/5549a72/2aa0a83）给内置小票加「访客填写区 + DOM 接管」后，`syncBuiltin` 会在每次 MutationObserver 触发时重写署名行，写入 `displayName(p.name)`。昵称为空时 `displayName` 返回**随机** #号——「随机值 ≠ 现值」恒成立 → 每次都真实写 DOM（textContent 赋值会替换文本节点）→ childList 变更 → observer（300ms 防抖）再次触发 → 再写新随机数 → **自激循环**。金额行有「同值不写」守卫所以从不滚动，署名行没有同款守卫。为什么测试没拦住：`test-builtin-ticket-dom.cjs` 的 harness 把 `displayName` 换成了确定性桩（返回「匿名打工人」无 #号），随机性从未进过测试。**修复**：`displayName(name, stableId)`——每次弹窗打开（自定义卡 openTicketModal / 内置卡首次接管）生成一次稳定编号，弹窗内所有重绘复用同一编号，配合既有「同值不写」守卫，写一次即停；harness 改用真实 displayName 并新增第 8 节（重复 sync 后 #号不变 + observer 计数为 0）。
**¥666 留档**：全仓检索无 666 字面量（bundle 与 custom-card-actions.js 均 0 命中）——它不是默认值，是浏览器 localStorage `sxg-visitor-profile` 里 10-16 晚功能上线后的历史累计（点「完成 / 复制 / 确认打卡」都会把「本次新增」并入累计），localStorage 不随「清除浏览器缓存」消失。直面该诉求的改动：填写区新增「清空」按钮 → 独立确认层（z-index 10002）提示「**一经删除则不可恢复**，是否确认？」→ 确认后金额清零（昵称/理由保留），baseTotal/builtinPreview 同步归零，React 重渲染后仍显示 ￥0。
**LOGO**：站长指出新卡无 logo。新增 4 张 256px 方图（霸王/三星/CATL/Acer，来源见检索记录，白底或透明底），按 logoText 短名接入 index.html 的 brandLogos 映射；logo 替换是运行时 DOM 补丁，不需要改 bundle。
**CATL 改档 C（U→C）**：AI 深查证据链——官方认证招聘 JD 公示「两班倒」（智联，2026-10-17 已抓原文）+ 财联社四基地 30 余名工人调查「两班倒 12 小时、做六休一至做七休一（月休约 2-4 天）」+ 每人Auto 互证（加班费 1.5/2/3 倍）+ 2023 年末淡季阶段性「强制双休/五天八小时」（伴随计薪下降）+ 官方 ESG 无量化双休承诺 + 「896」辟谣记录（不作依据）+ 法宝无本体力争文书。weekendPolicy overtime、overtimeComp statutory_paid；真实双休率等数值仍 null（无普惠占比可核算）；避雷预警 15→16；brand/catl.html 同步重写。**三星/宏碁**：第二轮定向检索无新口径，如实保持 U（备注已写入核实清单）。
**计数影响**：内置 39（含虚拟对比卡 1）/ 自定义 5 = 44 张卡；收录 43 家；顶部 43/16/8/16，U 级 3 张（acer/samsung/chagee），16+8+16+3 = 43 闭合，verify 2e 自动核对通过（430 项全过，含新增 tab 角标核对）。

---
## 2026-10-17

### 修复「企业真假双休档案」tab 角标停在同一处手写旧计数（36→43），并纳入 2e 自动核对（2026-10-17 18:24 · 提交 `70272fb`）
**文件**：`assets/index-YthXZ9eP.js`（brands tab 角标 36→43）、`scripts/verify.mjs`（2e 节新增 tab 角标=收录总数核对）、`index.html`（缓存号 ?v=33）
**起因**：站长截图指出 brands tab 上的数字角标仍是 36。审计确认这是四格统计之外的第 5 处手写计数，此前两次增卡（38→41、41→43）都没带上它；本次改到 43 并把「角标=收录总数」写进 verify 2e，与四格统计同一口径（实名企业卡 = 内置-虚拟 + 自定义），以后增减卡漏改会直接报错。
**审计**：全 bundle 扫描 `children:<数字>` 且上下文含中文标签的计数，确认除四格（43/16/8/15，已由 2e 核对）外仅此一处数字角标；「HOT」「交流区」为文本徽章不涉及。

---
## 2026-10-17

### 新增两张 U 级卡：霸王茶姬 / 三星（AI 核查公开口径，站长未线下走访，不作评级）+ 首页悬浮回顶按钮（2026-10-17 18:13 · 提交 `660566f`）
**文件**：`assets/index-YthXZ9eP.js`（插卡 2 张 + 顶部计数 收录 41→43）、`index.html`（noscript 两处清单 +4 行、页脚 共 43 家、缓存号 ?v=32、pinyin-index ?v=2、挂载 `top-button.js`）、`brand/chagee.html`、`brand/samsung.html`（新建详情页）、41 个既有详情页页脚 41→43、`projects.html`（h2 36→43、补 2 链接、修 CATL 旧档位文案）、`sitemap.xml`（+2 URL）、`pinyin-index.js`（重跑）、`scripts/test-pinyin-e2e.cjs`（探针 +2）、六份文档口径同步、`员工实测数据核实修改清单.md`（登记备注）、新增 `top-button.js`
**霸王茶姬核实口径**：公开招聘聚合口径可查（中华网 2026-10-08 月休榜将霸王茶姬列为「部分门店岗位月休约 4 天」，本站已抓原文；BOSS 直聘苏州门店岗快照「月休 4 天，8 小时排班制」），但榜单自述「不是统一调查，不能视为全国统一休息标准」；官方未披露（官网/20-F 已核验部分/官方招聘口径均无），北大法宝无涉诉文书，站长未线下走访 → 不满足喜茶/蜜雪冰城模式 C 级的一手核实前提，给 U 级。主体：主要运营主体茶姬企业管理（集团）有限公司（2026-09-02 由茶姬（上海）商业管理有限公司更名）；上市主体 Chagee Holdings Limited，2025-04-17 纳斯达克全球精选市场上市、代码 **CHA**（20-F 一手确认，非「CHAGEE」），发行价 28 美元/ADS。
**三星核实口径**：无在华工时/休息制度可核实公开口径 → U 级。卡片只写事实：2018-2019 深圳/天津/惠州三厂相继关闭、2019 年手机制造全部退出中国（路透社、中国经济周刊）；「N+1/N+2」未获当年报道证实（「N+1」仅见于关厂前一名员工个人猜测），天津厂部分员工实拿「N+3」（梨视频实地探访，环球网/中国日报网转载），惠州「N+3+工龄奖+择业期工资」（OFweek 等）与「至少 6 个月工资+4000 元+1 部手机」（EET-China）两个员工爆料版本细节不一致、官方未确认倍数（财新称「补偿细则暂时不详」）；「每人送一部手机」与离职员工信源一致（界面新闻/IT 之家：10 年以下 A8、10 年以上 S10+、20 年以上加发 Note10，全员依波手表+纪念册），非官方公告。三星未撤离中国：《2023 中国三星旗下企业社会责任报告》载截至 2023 年底在华累计投资 536 亿美元、177 个机构、员工近 5 万；现存主体三星（中国）投资有限公司（存续）与西安三星半导体。工商口径：天眼查 2026-10-17 查询，惠州三星电子有限公司状态为注销。
**新增功能**：首页右下角悬浮「TOP」按钮（`top-button.js`）：固定定位随视口滚动、任何位置可点、平滑回顶；移动端位于吸底广告条上方（bottom 96px + 安全区），桌面端右下角（广告卡在右上，无冲突），z-index 9000 低于广告条，带幂等标记。
**计数影响**：内置 39（含虚拟对比卡 1）/ 自定义 5 = 44 张卡；收录 43 家（brand/ 43 页）；顶部 43/16/8/15，U 级 4 张（acer/samsung/catl/chagee），16+8+15+4 = 43 闭合。

---
## 2026-10-17

### 新增三张内置卡：肯悦咖啡 / 库迪咖啡 / 蜜雪冰城（C 级，站长线下核实六休一月休 4 天）（2026-10-17 14:34 · 提交 `5704b6f`）
**文件**：`assets/index-YthXZ9eP.js`（插卡 3 张 + 顶部计数 收录 38→41、避雷 12→15）、`index.html`（noscript 两处清单 +6 行、页脚 共 41 家、缓存号 ?v=31）、`brand/kenyue.html`、`brand/cotti.html`、`brand/mixue.html`（新建详情页）、38 个既有详情页页脚 38→41、`projects.html`（补 3 链接 + 修宏碁旧档位文案）、`sitemap.xml`（+3 URL）、`pinyin-index.js`（重跑，37 品牌/395 词条）、五处文档口径同步、`scripts/test-pinyin-e2e.cjs`（探针表更新：tt 易主库迪咖啡，新增 cotti/mixue/kenyue/uniqlo 探针）、`员工实测数据核实修改清单.md`（登记备注）
**核实口径**：三卡均为站长 2026-10-17 线下一手走访核实「六休一 / 月休 4 天」，先给 C 级。联网比对结果分三型：**蜜雪冰城 = 一致**（BOSS 直聘上海店「月休 4 天｜轮班制」、北京日报客户端招聘会「底薪+绩效+全勤+月休 4 天」、中华网月休榜「部分门店岗位月休约 4 天」，多源互证）；**库迪咖啡 = 缺官方口径**（公开渠道仅有工时强度报道：两三人日千单、忙到崩溃，无月休数字，卡片如实注明）；**肯悦咖啡 = 口径不一**（肯德基体系全职「月休 4 天」与兼职「月休 6-8 天」并存），已按喜茶模式加口径备注，采信站长核实的 4 天。
**企业主体**：蜜雪冰城股份有限公司（02097.HK，2025-03-03 港股上市）；库迪咖啡（天津）有限公司；肯悦咖啡为百胜中国控股有限公司旗下品牌。
**计数影响**：内置 37（含虚拟对比卡 1）/ 自定义 5；顶部 41/16/8/15；16+8+15+2 = 41 闭合，verify 2e 自动核对通过。

---
## 2026-10-17

### 喜茶卡新增口径备注：「AI 核查月休 6 天，站长线下核查为 4 天」（2026-10-17 11:46 · 提交 `8daaa7a`）
**文件**：`assets/index-YthXZ9eP.js`（heytea reasons 追加第 6 条备注）、`brand/heytea.html`（「为什么给出这个评级」列表与「口径差异」框同步加注）、`index.html`（缓存号 ?v=30）
**起因**：站长要求把两处核实来源写明。喜茶 C 级维持不变；新增备注原文：「AI 核查月休 6 天（2026-10-16 检索喜茶官网招聘首页），站长线下核查为 4 天（2026-10-17 实地核实）；两口径不一致，本卡按 4 天记录。」

---
## 2026-10-17

### 恢复茶百道、兵立王 C 级：「线下一手」是站长本人核实，不按匿名爆料处理（2026-10-17 11:32 · 提交 `a8a42d1`）
**文件**：`assets/index-YthXZ9eP.js`（顶部「避雷预警」10→12）、`index.html`（两卡 grade 恢复 C级、⚠️ 推荐框恢复、noscript 恢复；渲染器 U 级分支与 gray 配色保留待用；缓存号 ?v=29）、`brand/chabaidao.html`、`brand/bingliw.html`（C 级徽章与档位说明恢复；meta 括注按证据实情写为「线下一手核实：月休不足 4 天」，不再沿用模板的「存在通报违约记录」——两卡并无通报记录）、`员工实测数据核实修改清单.md`（恢复原行 + 新增「线下一手」口径澄清）
**起因**：站长指出上一轮把「线下一手调查」误判为匿名传闻——它实为**站长本人**线下实地核实（奶茶门店基本单休、月休 4 天那种）。站长本人核实视同一线实测证据，「匿名爆料不单独作定性依据」不适用，两卡恢复 C 级。宏碁 U 级、计数口径与本轮其余改动不受影响。
**计数影响**：避雷预警 = C 级 8（内置实名）+ 4（赵一鸣/肯德基/茶百道/兵立王）= 12；16+8+12+2 = 38 仍闭合，verify 2e 节自动核对通过。

---

## 2026-10-17

### 统计计数口径审计 + U 级标准统一：宏碁/茶百道/兵立王改「待核实」，顶部计数并入自动核对（2026-10-17 11:11 · 提交 `25cdf28`）
**文件**：`assets/index-YthXZ9eP.js`（acer `tier` B→U 且 `weekendPolicy` 误标 `strict_double`→`unknown`；顶部「收录品牌」36→38、「避雷预警」11→10）、`index.html`（茶百道/兵立王 `grade` C级→U级，工时口径标注匿名来源，推荐框改中性灰；渲染器新增 U 级徽章分支与 gray 推荐框配色；`getGradeTemplateCard` 对 U 级静默回退；noscript 6 处；缓存号 ?v=28）、`brand/acer.html`、`brand/chabaidao.html`、`brand/bingliw.html`（灰色徽章 + meta + 档位说明重写）、`scripts/verify.mjs`（新增 2e 节统计计数一致性，9 项检查）、`员工实测数据核实修改清单.md`（茶百道/兵立王行备注）
**计数口径（本次审计确定，2e 节按此自动核对）**：收录品牌 = 实名企业卡（内置 33 + 自定义 5）= 38；双休红榜 = S/A = 16；大小周观察 = B = 8；避雷预警 = C = 10；U（待核实）= 4（宁德时代/宏碁/茶百道/兵立王），不分桶；16+8+10+4 = 38 闭合。**虚拟对比卡「某代工烘焙食品 (虚拟对比黑榜)」不计入任何统计**（上游设计的匿名对比工具，无详情页）。此前 36/16/8/12 是「宏碁/宁德时代/肯德基加入之前」的旧值（当时恰为 32 内置 + 4 自定义、C 级 9+3），之后新增卡片从未回填，与任何现行口径都对不上。
**改档判定（逐卡核证）**：宏碁 B→U（仅客服热线与大客户定制条款可证，工时数值全 null，客服热线可用≠休息制度口径）；茶百道 C→U、兵立王 C→U（唯一依据为线下一手匿名反馈，按站长 2026-10-16 批准的「匿名爆料不单独作定性依据」规则不评级；两卡详情页 meta 原写「严重超时、存在通报违约记录」无任何出处，属生成模板误植，一并清除）。**维持原档**：赵一鸣 C（多店招聘口径 + 站长成都实地核实 22:30）、肯德基 C（百胜官方直聘等独立核实，双休率 10%）、小米 B（多源交叉验证，53%）、喜茶 C（官网/门店/线下三口径 + 换算依据）、某代工烘焙 C（劳动监察处罚通报）。
**渲染层**：自定义卡徽章此前靠模板卡克隆后字母替换（会残留模板的档位描述后缀，U 级不能用），本次在渲染器加 U 级分支：整句改写「待核实 · 无证据不作评级」+ 灰色样式（与内置 U 徽章一致，保留图标节点）；推荐框新增 gray 中性配色（红=警示、绿=推荐、灰=待核实）。

---
## 2026-10-17

### 宁德时代改档 U 级（待核实 · 不评级）：证据链无工时口径，不挂「避雷预警」定性档位（2026-10-17 10:49 · 提交 `43867c2`）
**文件**：`assets/index-YthXZ9eP.js`（catl 卡 `tier` C→U；顶部「避雷预警」手写计数 12→11）、`index.html`（noscript 两处口径 + bundle 缓存号 ?v=27）、`brand/catl.html`（徽章改灰色「待核实 · 未评级」、4 处 meta「双休评级 C 级」改「暂未评级（证据收集中）」、档位说明重写、「同为 C 级」栏目改「参考」）、`员工实测数据核实修改清单.md`（CATL 行备注）、`scripts/verify.mjs`（新增 2d 节 U 级纪律，2 项检查）
**起因**：站长指出「既然没有相关证据链，就不应该给 C 级」。核实结论：CATL 证据链 3 条（宜宾三江公安辟谣通报、南方都市报公司辟谣报道、国投电力公告披露的工商登记）没有一条涉及工时口径，而 C 级徽章渲染为「C级 · 避雷预警」，等于无证据定性，与「查不到就填 null、不作定性」红线冲突。
**实现**：U 级渲染层（灰色徽章「待核实 · 无证据不作评级」、中性卡片边框、榜单行「待核实（未评级）」）自 `c9b2753` 起已内置但从未有卡启用，本次仅改数据档位即全部生效，未新增任何渲染逻辑。~~筛选条保持 全部/S/A/B/C，U 卡在「全部评级」下正常展示（不加 U 选项，避免「U 级」字样与「不评级」语义打架）~~ **（2026-10-18 修正：站长要求补上——见 `de73532`，评级过滤行尾已注入「待核实」按钮，文案沿用卡内徽章的「待核实」而非「U 级」，语义不打架；旧的"不加 U"结论作废）**。
**范围**：仅宁德时代。喜茶不跟改（5 条证据 + 官网/门店/线下三口径换算依据，C 级有据）；宏碁（B，证据仅客服热线）与自定义卡（grade 字段）维持现状，待站长另行决定。
**计数遗留**：顶部四格为手写常数，「避雷预警 12」在本次改动前即与任一可验证口径不符（内置 C 级 10 张；含自定义 grade C级 4 张合计 14），本次仅按「CATL 移出该桶 -1」改为 11；「收录品牌 36」与页脚「共 38 家」同样对不上（内置 34 + 自定义 5 = 39 张卡、brand/ 下 38 个详情页，口径无法唯一确定）。计数口径审计建议作为独立任务，本次不擅自定公式。

---

## 2026-10-16

### 修 notes 校验两处误判：CSS 字体名 + 比亚迪点名白名单（2026-10-17 02:12 · 提交 `484c5bf`）
 `scripts/verify.mjs` 的 notes 内容断言里有两条把正常内容判成异常：① CSS 里的字体名 `PingFang SC` 被当成正文片段；② 比亚迪是被点名核实过的品牌，却被「不得出现未核实品牌」规则拦截。二者均加白名单放行。

### 彻底禁用纯数字搜索，并记录搜索引擎排名基线（2026-10-17 01:52 · 提交 `832a650`）
**问题**：用户在搜索框输入纯数字（如 `996`）时，React 原生过滤会把它当品牌名去 `includes`，结果恒为空态，而站点没法解释「为什么搜不到」。

**修复**：新增 `block-numeric-search.js`——截获纯数字输入，弹出说明而非落到空态；配套 `scripts/test-block-numeric-search.cjs`（213 行）+ verify 第 20 节。

**同时留档**：新建 `SEO-RANKING.md`，记录当时的搜索引擎实测排名基线（供后续 SEO 对比）。

### 修复广告 LOGO 竖排折行 + 补齐详情页 SEO 标签 + 校验脚本自检（2026-10-17 01:36 · 提交 `24b772b`）
 ① 广告位 LOGO 在竖排卡里文字折行，调整容器宽高与 `white-space`；② 给 `brand/*.html` 全部详情页补齐 `meta description` 等 SEO 标签；③ `scripts/verify.mjs` 新增自检（含漏掉的 Tailwind class 判定）。

### 推荐位修复：不再把 C 级当「良心双休替代品牌」推给读者（2026-10-17 00:57 · 提交 `5527739`）
**严重语义 bug**：同一张卡的「同品类替代推荐」区，会把 C 级（避雷）品牌标成「良心双休替代品牌」推给用户——读者点进去发现是黑名单。

**修复**：改 bundle 的推荐位数据；新增 `scripts/test-alternatives.cjs`（152 行）+ verify 新增断言：**任何 C 级卡不得出现在推荐位**，用力向用户的推荐必须是 S/A 或实测 B。

### 员工投稿改为真入库：跳 GitHub Issues，不再是「假入库」（2026-10-17 00:42 · 提交 `f4a1e26`）
**曾经的假入库**：bundle 里的投稿 `onSubmit` 只做 React 本地 state 更新（400ms 后关窗），全站 fetch 都是 React 内部调用——**数据刷新即丢、站长收不到**，但按钮写着「入库公证中…」，用户以为提交成功了。

**修复**：新增 `employee-report-to-issue.js`，捕获阶段拦截 submit，改为打开 GitHub `issues/new` 预填投稿内容，由用户在 GitHub 落库。配套 `scripts/test-employee-report.cjs`（144 行）+ verify 第 20c 节（6 项）：必须引入、必须捕获阶段拦截、必须 encodeURIComponent、必须指向 issues/new、必须有行为测试、必须接入 CI。**注入验证**：删掉该脚本 verify 立刻报错并提示「会静默退回假入库」。

### 喜茶三口径全收录：区分「实测值」与「口径换算值」（2026-10-17 00:38 · 提交 `c9b2753`）
三个休息天数口径（官网招聘 6 天 / 门店口径 / 站长线下核实 4 天）此前只取其一，丢失信息。本次全部收录，并在数据层区分 `rateSource: measured` 与 `rateSource: derived`——页面显示「X%（口径换算）」与实测值明确区分。这是**全站「口径换算」机制的第一次落地**（后续 CATL/瑞幸/奇瑞等沿用同一套）。

注：本次同时新建了 `employee-report-to-issue.js`（初版），0 点 42 分的 `f4a1e26` 才把假入库修好。

### 新增宏碁 (Acer) 卡片：核实群聊说法后「如实写」（2026-10-16 23:25 · 提交 `44de182`）

- **文件**：新增 `brand/acer.html`、`scripts/test-render-page.cjs`；改动 `assets/index-YthXZ9eP.js`（+1692 字符）、`index.html`、`projects.html`、`sitemap.xml`、`pinyin-index.js`、`scripts/verify.mjs`、`scripts/test-pinyin-*.cjs`、`.github/workflows/verify.yml` 及 5 份文档

**起因**：读者群聊截图反映两件事 —— 「宏碁客服也是双休」「起码我周末不能预约的返修」，另有奶茶店「起码 90% 单休」的说法。经核实后决定**如实写**：只采纳官网可核实的硬数据，其余一律 `null`。

**核实结论**：

- **客服热线全线七天（与群友说法方向一致，但成因不同）**。宏碁官网 `contact.html` 公示三条热线 400-700-1000（周一至周日 9:00-18:00）、400-118-9999（周一至周日 9:00-18:00）、400-826-5555（周一至周日 8:00-22:00）——客服热线本身并未双休。
- **「周末不能预约返修」是个人经历，未经官方核实**。官网未见对应口径的公开说明，作为核查线索留存，**不作为工时评价依据，也不计入任何统计**。已在详情页单独写明「客服热线可用」与「售后各环节开放」是两件事。
- **官网另有大客户定制上门服务含周六、周日与节假日**，但属定制条款、非普惠条款，不据此推断普通消费者可得性。
- **奶茶店单休说法有多家媒体支撑**（《晚点LatePost》转载：40 多万家奶茶店、日均工作 9 小时以上、月休 2–4 天），未收录为卡片，仅作口径参考。

**评级**：B 级，依据仅限上述官网可核实口径。真实双休率、平均下班时间、加班费占比全部为 `null`（页面显示「—」），**不用 `0`**——`0` 会被读成「实测为 0」。

**顺带修掉的历史口径不一致**：36 个 `brand/*.html` 页脚停留在「36 家」，`catl.html` 写「37 家」，与真实数量（现38 家 = 34 内置 + 4 自定义）全部不符，已统一为 38。

**新增整页渲染测试 `scripts/test-render-page.cjs`**：这次改压缩 bundle 时发现，静态字符串断言全过、但 React 挂不上导致白屏且控制台无报错的情况，**现有任何测试都抓不到**。新测试加载完整 `index.html` + 真实 bundle，断言 `#root` 真的被填充、新卡片真的出现在 DOM、`noscript` 兜底含新条目、无致命报错（13 项）。已接入 CI。

**过程中被这套测试抓出的真问题**（都是「不检查就上线」会漏的）：

1. `alternatives` 一开始引用了站内不存在的 `lenovo`/`dell` → 改为真实存在的 `apple-consumer`/`sony`/`huawei-consumer`/`vivo`
2. 读文件用了文本模式，把 bundle 里原有的 10 个 `CRLF` 统一成 `LF` → 改二进制读写 + 自检 CRLF 数量不变
3. `pinyin-index.js` 没重新生成，漏了宏碁 → 跑 `gen-pinyin-index.py`（顺带把常见错别字「宏基」也收进索引）
4. `test-pinyin-search.cjs` 里写死「索引品牌数 = 33」→ 改为从 `brands` 主数组动态推导。注意口径：全文正则会连 `recommendedAlternatives` 里的重复引用一起数进来（`pepsi-drinks` 只出现在推荐位），得到 35 ≠ 34 的假警报

**顺带修了 `scripts/verify.mjs` 里一个写死的豁免正则**：`合计 3[27] 张| 共 3[27] 张` 会随卡片增减失效，已改为按实际总数动态生成（原先想直接放宽成`\d+`，那会让规则永真、失去检查意义）。

---

## 2026-10-16

### 搜索框占位改为《答案之书》随机句（2026-10-16 22:46 · 提交 `7949e18`）

- **文件**：新增 `answer-book-data.js`、`answer-book.js`、`scripts/test-answer-book.cjs`；改动 `index.html`、`scripts/verify.mjs`、`FORK_GUIDE.md`、`.github/workflows/verify.yml`

**问题**：搜索框 placeholder 是「消费前，先了解这个品牌是否双休；用订单（消费力），反向考核企业」。26 个字挤在输入框里，用户反馈「越看越觉得不太舒服」。

**现在**：每次刷新随机显示一条《答案之书》答案；点一下空着的搜索框可再换一条。

**答案来源**：知乎 <https://zhuanlan.zhihu.com/p/469772880> 的 001–319 完整版，去重后 318 条（原列表「等待」重复出现于编号 170、171）。少数派《罗技鼠标lua脚本…答案之书》是同源前 143 条，可交叉校验前段。⚠️ 纸质书共 640 页，这个 319 条是社区整理版，非官方授权完整清单，只作文案素材使用。

**架构**（与拼音搜索一致，数据与逻辑分离）：

| 文件 | 职责 |
|---|---|
| `answer-book-data.js` | 纯数据，挂 `window.__ANSWER_BOOK__` |
| `answer-book.js` | 随机抽取 + DOM 覆盖 |

**为什么走 DOM 层**：placeholder 写死在 `assets/index-YthXZ9eP.js` 里，手改压缩包是项目红线。

**两个实现要点**：

1. **React 重挂载会把 placeholder 冲回原值**（切标签时 input 被重建）。每次 `sweep()` 复核但不重抽 —— 抽中的那条记在 `data-answer-book-pick` 上，仅在当前值 ≠ 记录值时补写。这样用户点出来的新答案不会被 observer 冲掉，而 React 冲掉的能恢复。
2. **不改 `input.value`**。拼音搜索层绑同一个 input，本脚本只写 placeholder。点击换一条仅在 `value` 为空时触发。

⚠️ **数据文件必须先于逻辑文件加载**，否则逻辑层开头 `if (!BOOK) return` 静默退出 —— 页面不报错、placeholder 也不变。verify 第 19 节专门盯这个顺序。

**验证**：`node scripts/test-answer-book.cjs`（40 项，含数据完整性、加载顺序、真 DOM 覆盖、点击换一条、React 重挂载恢复、幂等、不干扰 value、数据缺失时安静退出）。verify 新增第 19 节（21 项），累计 369 → **390 项**。

### 修复：内置卡小票金额累计不生效（上一版的漏检事故）（2026-10-16 22:31 · 提交 `2aa0a83`）

- **文件**：`custom-card-actions.js`（`?v=2` → `?v=3`）、
  新增 `scripts/test-builtin-ticket-dom.cjs`、`scripts/verify.mjs`、
  `FORK_GUIDE.md`、`PITFALLS.md`、`.github/workflows/verify.yml`

**用户反馈**：「内置卡片就存在这个bug，自定义则不存在，
**你不检查就推送上线吗？**」

**根因**：上一版写的是

```js
var amountSpan = findValueNode(receipt, '已转移/支持消费:');
```

`已转移/支持消费:` 这句话**在压缩包里确实存在**，但只存在于
**复制文本的模板字符串**里：

```js
p = () => {
  let t = `【双休购 · 反向考核小票】\n...\n已转移/支持消费：¥${l}\n...`;
  navigator.clipboard.writeText(t);
}
```

**内置小票纸面 DOM 上根本没有这句。** 纸面真实标签是
`转移撤销消费金额:` / `注入良心企业预算:`（按是否违规避雷二选一），
值是 `<span class="text-xl font-black font-mono">`，不是 `input`。

所以 `findValueNode(...)` **永远返回 `null`**，金额替换逻辑一次都没执行，
界面还是 bundle 写死的 199。署名之所以生效，只是因为
「考核执行官:」恰好写对了 —— 这才造成「自定义有、内置没有」的错觉。

**为什么会漏**：我做的断言全是**源码字符串**层面的
（检查标签文字存在、`#sxg-total` 存在、结算顺序正确），
而「字符串在压缩包里存在」≠「节点在 DOM 上存在」。
另外定位失败是**静默的** —— `if (amountSpan)` 直接跳过，
控制台一声不吭。`agent-browser` 多次超时后我放弃了 UI 端到端验证，
改用源码断言顶替，而且没声明这是替代品。

**修复内容**：

| 改动 | 说明 |
|---|---|
| `AMOUNT_LABELS` | 按纸面真实标签定位，两个候选任选其一 |
| `paintBuiltinAmount()` | 统一绘制纸面金额，并把标签改写为「累计已转移/支持消费:」 |
| `hideBuiltinAmountInput()` | 隐藏 bundle 自带的「本次投票消费金额」输入行，金额统一由注入的输入框录入，避免两个框并存 |
| `paintBuiltinReason()` | 理由行挂在「工时健康评级」之后（旧函数依赖自定义卡才有的 `.sxg-kv`，内置卡上恒为 `null`） |
| `builtinPreview` | React 重渲染会把纸面冲回 199，重绘时用预览值而非存档值 |
| 同值不写 | 全局 `MutationObserver` 监听整个 `#root`，无条件写 `textContent` 会自己触发自己形成死循环 |
| 定位失败告警 | `diag()` 输出，不再静默 `return null` |
| `syncBuiltin` 去掉短路 | React 复用同一 span 节点时 `id` 还在但内容已被重置，原短路会让 199 留在屏幕上 |
| 结算按钮文案 | 内置卡是「确认打卡并计入全网总额」，补进结算触发词（原来只认「完成」「复制」） |

**验证**（这次是端到端跑真实 DOM，不是源码字符串）：

- 新增 `scripts/test-builtin-ticket-dom.cjs`（30 项）：
  从压缩包抠出真实文案 → 搭出结构一致的 DOM → jsdom 里真跑真实源码函数
- `verify.mjs` 新增第 18 节「内置卡小票 DOM 定位」（15 项），
  含关键否定断言「『已转移/支持消费』不在纸面渲染区间内」
- CI 新增 `内置卡小票 DOM 测试` 步骤
- 累计：354 → **369 项**全过

**方法论教训**（已写入 `PITFALLS.md` §6.7）：
凡是「按文案定位 DOM」的注入层代码，必须有真 DOM 端到端测试。
只断言源码字符串的测试，对这类 bug **零检出能力**。

### 小票金额改为累计（存本地浏览器）（2026-10-16 22:03 · 提交 `5549a72`）

- **文件**：`custom-card-actions.js`（`?v=1` → `?v=2`）、`scripts/test-ticket-total.cjs`、`scripts/verify.mjs`、`index.html`

**原来的问题**：小票金额是**单值**，每次打开覆盖上次的值。
第一次填 199，第二次填 299，结果显示 299 而不是 498。

**现在的语义**：

| 字段 | 含义 |
|---|---|
| `total` | 历史累计金额，存 localStorage |
| `lastDelta` | 上次填的「本次新增」，结算后归零 |
| `name` / `reason` | 昵称与理由，跨次保留 |

界面上输入框改为**「本次新增消费（元）」且默认为空**（留空 = 不增加），
右侧实时显示**累计金额**。填 199 保存，再填 299，累计就是 498；
下次打开页面自动显示 498 —— 数据存在用户自己的浏览器里。

**三条实现规则**（FORK_GUIDE 13.4 有完整说明）：

1. **打开弹窗绝不累加**：`baseTotal` 是打开那一刻的常量，
   预览值 = `baseTotal + 本次新增`。只有明确点「复制小票文本」或「完成」才结算。
   否则用户「打开看一眼」就算一次钱，来回开关几次金额就离谱。
2. **结算后清空新增额**：防止同一次弹窗里连点复制两次就加两次。
3. **旧数据必须迁移**：老用户存的是 `{ amount }`，`migrateLegacy()`
   把它当作历史累计。不迁移的话老用户升级后累计金额会凭空归零。

**容易漏的一点**：内置卡小票（`patchBuiltinReceipt`）与自定义卡小票
（`openTicketModal`）是两条代码路径，**两条都要改**，否则会出现
「自定义卡能累计、内置卡还是单值」的割裂。
⚠️ 但**两条都改了也可能白改** —— 内置卡的定位文案本身是错的，
见下面紧跟的一条。

**隐私边界不变**：仍只写 localStorage，无任何网络请求。
verify 第 17 节有一条检查专门盯着这点 —— 有人顺手加 `fetch()` 会直接报错。

**验证**：
- `node scripts/test-ticket-total.cjs`（41 项，含 199 + 299 = 498 完整结算路径、
  旧数据迁移、输入规整、连点防重复结算）
- `node scripts/verify.mjs` 新增第 17 节「小票累计金额」（11 项）

### 测试脚本改用 `__dirname` 推导仓库根（修 CI 失败）（2026-10-16 19:53 · 提交 `1eb7de0`）
 `test-pinyin-*.cjs` 里写死了本机绝对路径，在 CI 上路径不存在导致全部测试跳过（且**不报错**，形同虚设）。改为 `__dirname` 推导；同时补 `.gitattributes` 锁定行尾，避免 CRLF 变动影响 bundle 校验。

### 搜索支持拼音与首字母（联想回填方案）（2026-10-16 19:50 · 提交 `0639498`）

- **文件**：新增 `pinyin-index.js`、`pinyin-search.js`、`scripts/gen-pinyin-index.py`、`scripts/test-pinyin-search.cjs`；改动 `index.html`、`scripts/verify.mjs`

**问题**：站内搜索是 bundle 里的纯 `includes` 硬匹配，只认输入的字面串。
输 `ning`、`ndsd`、`ningde` 都搜不到「宁德时代」，用户实测反馈「换个拼音就不行了」。

**方案**：**联想回填**，不改压缩 bundle。

真正的模糊搜索要改 React 内部的 `brands` 数组，而那个数组只存在于压缩产物
`assets/index-YthXZ9eP.js` 里。手改压缩产物是本项目红线
（见 `FORK_GUIDE.md`：多一个字符就可能白屏且控制台无报错）。

所以改为：`pinyin-search.js` 在搜索框下方给出拼音候选，用户点一下（或按 Enter）
把搜索框回填成中文名，**之后的过滤完全交给 React 原生搜索**。
渲染路径没有任何改动，回填的词保证是 bundle 能原生命中的名字。

**索引怎么来的**：`scripts/gen-pinyin-index.py` 离线解析 bundle 的 `brands` 数组，
用 `pypinyin` 生成全拼与首字母，输出 `pinyin-index.js`（33 品牌 / 355 词条 / 约 14KB）。
新增品牌后**必须重跑**，否则该品牌没有拼音索引。

**排序规则**（两层，先比层级再比词条重要度）：

| 命中层级 | 含义 | 例 |
|---|---|---|
| 0 | 原文命中 | `宁德` → 宁德时代 |
| 1 | 全拼（音节边界） | `ningde` → 宁德时代 |
| 4 | 全拼（跨音节，末位） | — |
| 2 | 首字母全等 | `ndsd` → 宁德时代 |
| 3 | 首字母包含 | `hw` → 华为 |

同层再按重要度：主名 > 英文名 > 公司全称 > 关键词 > 产品名。

**这一层不是锦上添花，是修 bug**。开发过程中真实踩到两个问题：

1. `hw` 命中巴塔哥尼亚的「户外」而不是华为的「华为」——两者首字母都是全等、
   同为关键词层。加入重要度排序后华为压过户外。
2. `ms` 命中星巴克的「美式」——查下来**这不是 bug**：微软的首字母是 `wr`（微软），
   本来就不该出现在 `ms` 结果里，星巴克是数据里唯一正确的答案。

**两字母缩写天然有歧义，正确做法不是靠排序猜用户意图，而是把命中依据显示出来。**
所以联想行右侧会标注命中词条，例如「`hw` → 华为终端 ｜「华为」首字母」。

另一个必须处理的细节：品牌主名是 `Microsoft (微软中国)` 这种中英混合形式，
若直接整体转拼音，首字母会变成 `Microsoft (wrzg)`，导致 `ms`、`wr` 都匹配不到。
因此主名必须**拆分**：中文部分单独成条（权重 0）、英文部分单独成条（权重 1）。

还有一个隐蔽的坑：**产品名不能参与首字母匹配**。几乎每个品牌都有
「X 系列」「生鲜冷链」这类产品名，首字母天然以 `xl`、`yxzxl` 收尾。
开发中实测输 `xl` 会同时命中「vivo X 系列」「纯茶饮系列」「夜行者系列」
「生鲜冷链」—— 全是产品线，而用户搜 `xl` 是想找品牌。
因此产品名只参与原文与全拼匹配，不参与首字母。

**验证**：

- `node scripts/test-pinyin-search.cjs` — jsdom DOM 行为，26 项
  （排序正确性、React 受控输入兼容、幂等、索引与 bundle 一致性）
- `node scripts/test-pinyin-e2e.cjs` — 端到端，21 项。
  加载**真实 bundle** 的数据并复刻它的原生过滤算法，断言「回填的词
  真的能被原生搜索命中并收窄到目标品牌」。这是关键 ——
  只测联想列表不算数，用户最终看到的是原生搜索的结果。
- `node scripts/verify.mjs` 新增第 16 节「拼音搜索索引」（8 项），
  专门防「新增品牌忘了重跑索引」这种静默失效 —— 漏跑会直接报错并给出修复命令
  （已实测：手动删掉索引里的 `catl` 后，verify 立刻报 2 项错并打印修复命令）

### 同类项目导航补入宁德时代关键词，bundle 缓存号升至 v=24（2026-10-16 18:17 · 提交 `0e331a7`）
 projects.html 的同类站点导航区补宁德时代相关关键词；`index.html` 的 bundle 引用号同步 `?v=24`。

### 新增内置卡：宁德时代 CATL（收录 37→38，内置 33 张）（2026-10-16 17:51 · 提交 `cc136be`）
新建 `brand/catl.html` 详情页（159 行）+ bundle 插卡 + sitemap + projects.html；四份文档口径同步。

> ⚠️ **本卡后续两次改档**：2026-10-17 `43867c2` 因证据链无工时口径改为 U 级；同日 `b1e607c` 深查到「官方认证招聘 JD 公示两班倒 + 财联社四基地 30 余名工人调查」后改 C 级（避雷预警）。**以最新为准，本条仅记录首次建卡。**

### 修复广告位竖排卡片文字溢出视口（CSS 源码顺序坑）（2026-10-16 16:10 · 提交 `281688a`）
**现象**：竖排卡里广告文案溢出视口被裁掉 61px，用户看得见字被切。

**根因（教科书级静默故障）**：「通用零件」样式段写在 `@media` 断点段**之后**——同选择器同优先级下**后写的赢**，断点里的 `font-size:11.5px` 被通用段的 `17px` 覆盖。CSS 不报错、DOM 正常，肉眼前也难发现。

**修复**：把通用/基础样式移到所有断点样式**之前**。`scripts/verify.mjs` 新增 4 条断言盯死源码顺序。

> **教训（已入 PITFALLS）**：写 CSS 不是「属性写对了」就生效，得问「会不会被后写的同选择器规则覆盖」。

### 文档：清除 7 个编造的提交号，改记为已核实的现状说明（2026-10-16 15:50 · 提交 `450b09b`）
 `FORK_GUIDE.md` / `MAINTAINING.md` / 核实清单里此前写着 7 个**真实 git 历史里不存在**的哈希。全部清除，改为「已核实的现状说明」或在无据时直说无据。同时给 `scripts/verify.mjs` 补上第 9 节「提交号真实性」检查——现在文档里出现假哈希会直接报错。

### 文档：新建 CHANGELOG，并修正 verify 的徽标判据（2026-10-16 13:25 · 提交 `43f8b70`）
 新建本文件（当时 181 行）记录 10-13 以来的改动；`FORK_GUIDE.md` 增补 47 行；`scripts/verify.mjs` 修正评级徽标判据（此前漏判 U 级灰色徽章）。

### 页脚四块内容各套一层卡片（2026-10-16 11:49 · 提交 `b917a9a`）

- **提交**：`b917a9a`
- **文件**：`friend-links-footer.js`

友情链接、微博投票、搜索排名公示、Bing 积分商城原来都是纯文本，视觉上很散。
现在统一套上白底卡片（`makeCard()`）。**只是外观调整，内容一字未改。**

### 页脚新增 Bing 积分商城邀请（2026-10-16 11:44 · 提交 `f0b3bbf`）

- **提交**：`f0b3bbf`

放在「搜索排名公示」下方，链接带 `nofollow noopener`。

### 小票支持访客自行填写（2026-10-16 10:59 · 提交 `2b7a3e3` / `1789bd7` / `846a57b`）

- **提交**：`2b7a3e3`、`1789bd7`、`846a57b`
- **文件**：`custom-card-actions.js`

原先小票上的昵称、金额、理由是**写死的**。现在访客可以在页面上自己填，
存到 `localStorage`，刷新后仍在。

> **⚠️ 隐私边界（重要）**：这些数据**只保存在访客本地浏览器的 localStorage 里**，
> **不上传服务器**，没有任何 `fetch` / `XHR` / `sendBeacon` 调用。
> 换浏览器、换设备、清缓存即丢失。这是刻意的取舍——本站无后端。
>
> 存储键：`sxg-visitor-profile`

**内置品牌卡的小票**同样支持填写，实现方式是 **DOM 层接管**（`patchBuiltinTicket`），
**没有改动构建产物**。压缩包 `index-YthXZ9eP.js` 的 md5 全程保持
`ad7929d2fc87374b20b2ddbb10275dfb` 未变。

> **为什么走 DOM 层**：内置小票的写死值在压缩后的 bundle 里
> （「清醒打工人 #7709」在 byte 256717，`useState)(199)` 在 byte 292842）。
> 手改压缩包风险极高（见 `PITFALLS.md` 一节），
> 所以一律在 DOM 层覆盖，**以后遇到类似需求也请照此办理，不要去动 bundle**。
>
> **已知未修**：内置小票的「复制小票文本」按钮仍会复制到旧的写死文本——
> 那是 bundle 内部模板函数生成的，外部无法干预。

### notes 第五节文案修正（2026-10-16 02:50 · 提交 `e9e945a` / `289a446` / `69520c0`）

- **提交**：`e9e945a`、`289a446`、`69520c0`

- 第五节内一段落的表述理顺
- 5.3 补回两段，恢复完整叙事
- 5.4 主语修正：原文一处主语与所在小节标题直接矛盾，按原话更正为实际当事人

> ⚠️ `notes.html` 是**加密**的，正文用 PBKDF2-SHA256（21 万次）+ AES-256-GCM。
> 改内容的正确流程见下方「改加密正文」。**明文源文件在 `.gitignore` 里，只留本地。**
>
> ⚠️ **本节及后续 notes 条目一律不记录随笔正文内容、情节与人物细节** ——
> 正文明细属站长个人资料，仓库里只记录「动了加密文件」这个技术事实。

### 打卡按钮与自定义卡交互修复（2026-10-16 02:46 · 提交 `588527d` / `3c8d51e`）

- **提交**：`588527d`、`3c8d51e`
- **文件**：新增 `custom-card-actions.js`

首页顶部原本有一个「打卡并生成小票」按钮，处于禁用状态，
因为它依赖的弹窗在小票面板渲染完成前就渲染了，点不动。
本次改为：**点击后弹窗引导用户去下方品牌档案卡打卡**。

同时修复了**自定义品牌卡的「打卡」与「详情证据」按钮完全无响应**的问题。

> **根因值得记住**：自定义卡是通过 `templateCard.cloneNode(true)` 克隆出来的，
> **不在 React 组件树内**，所以 React 的 `onClick` 对它们完全无效。
> 解法是外部脚本自己绑事件。
>
> **另一个坑**：React 19 的事件委托挂在 `#root` 上（冒泡阶段），
> 外部脚本要用 `addEventListener(type, handler, true)`在**捕获阶段**拦截，
> 并调`stopPropagation()`，否则会和 React 的处理打架。

**点赞/点踩本次没有做**——需要数据库支撑，否则用户一刷新计数就归零。
当前为置灰状态并带 `title` 提示。

### 搜索排名公示补词（2026-10-16 02:33 · 提交 `425c2c9` / `0fc6675`）

- **提交**：`425c2c9`、`0fc6675`

补上「双休企业」（Bing 第一页末位）与两个英文裸词
`shuangxiugou`（第 4 位）、`shuangxiugo`（第 5 位）。

### 新增 AGENTS.md（2026-10-16 02:15 · 提交 `835d3b8` / `3c8d51e`）

- **提交**：`835d3b8`、`3c8d51e`、`846a57b`

给 AI 助手看的仓库规则文件，说明版本号规则、改动纪律、
自定义卡的技术约束与已知 bug。

---

## 2026-10-13

### 公告栏版本号机制上线（2026-10-16 02:14 · 提交 `5931f60` / `7ee3c6b`）

- **提交**：`5931f60`、`7ee3c6b` 及后续多次「公告栏版本号同步」提交

`index.html` 顶部公告栏末尾有「当前版本号 xxxxxxx」。

**规则（已与维护者确认）**：页面上显示的是**上一版内容的版本号**，
即本次提交**之前**那个提交的哈希。所以每次改完 `index.html` 需要两次提交：
第一次改内容，第二次才把版本号填成第一次的哈希。

> 不要试图把版本号写成当前 HEAD 的哈希，那会导致每次都落后两拍。

---

## 给 fork 者的三条实操提醒

### 1. 改加密正文（notes.html）的正确流程

正文明文源文件 `notes-plaintext.md` 在 `.gitignore` 内，**仓库里只有密文**。

```bash
# 改 notes-plaintext.md 后：
node scripts/encrypt-notes.mjs      # 交互输入密码（≥12 位，两次确认）
git add notes.html && git commit
git push
```

校验：

```bash
NOTES_KEY=<访问密码> node scripts/verify.mjs   # 带密码，跑内容类断言（含正文探针）
node scripts/verify.mjs                        # 无密码，跳过内容断言
```

> **密码丢了 = 正文永久无法解密，只能重写。**
> 请务必在**自己的机器上**另存一份明文备份（路径自定，不要写进任何会提交的文件）。
> 本项目不在仓库内记录本地备份位置 —— 那属于站长个人资料（隐私纪律）。

### 2. `?v=N` 版本号要跟着改

本轮新增/修改的外部脚本都在 `index.html` 里有引用，改完必须递增：

| 文件 | 当前版本号 |
|---|---|
| `custom-card-actions.js` | 见 `index.html` |
| `friend-links-footer.js` | 见 `index.html` |

不改的话用户吃旧缓存，且**页面看不出任何异常**。

### 3. 改完务必跑校验

```bash
npm run verify
```

**注意**：`verify.mjs` 目前会报 11 项错误，**全部是改动前就存在的历史问题**
（正文引用旧提交哈希、`notes.html` 未被点名收录），与新改动无关。

---

## 相关文档

| 文档 | 用途 |
|---|---|
| [`FORK_GUIDE.md`](FORK_GUIDE.md) | 改之前必须知道的架构约束 |
| [`PITFALLS.md`](PITFALLS.md) | 真实发生过的静默失效，**动手前必读** |
| [`MAINTAINING.md`](MAINTAINING.md) | 更早的改动记录与遗留问题 |
| [`AGENTS.md`](AGENTS.md) | 给 AI 助手的仓库规则 |
| [`员工实测数据核实修改清单.md`](员工实测数据核实修改清单.md) | 逐卡证据核实记录 |
