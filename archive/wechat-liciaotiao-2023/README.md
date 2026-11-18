# 微信文章存档 · 李跳跳《无限期停止更新公告》与《谈谈我的看法》

## 为什么存档

2026-11-19 站长要求在微信侧随时可能下架删文之前，把两篇与"QQ 浏览器广告屏蔽"争议直接相关的文章做永久备份。
两篇均为公众号「大小姐李跳跳」于 **2023-08-24 05:52（广东）** 发布的**纯图片推文**——正文不是文字节点，而是一张长图，
所以本存档同时保留三样东西：**原页面完整 HTML + 原始长图 + 可检索文字转录**，任一份丢失都能互相印证。

这两篇也是本站从 2026-11-19 起把独立 QQ 浏览器纳入 UA 拦截层的**事实背景**：第一篇是腾讯方律师函，
主张「李跳跳」手机软件屏蔽、过滤 QQ 浏览器广告服务构成不正当竞争，要求 48 小时内停运下架；第二篇是作者逐条回应，
核心论点为"跳广告不等于屏蔽广告、无入侵破坏、公益单机应用无联网无盈利"。存档只记录事实与双方观点，不代表本站立场。

## 来源清单

| 项 | 值 |
|---|---|
| 公众号 | 大小姐李跳跳（李跳跳） |
| 发布时间 | 2023-08-24 05:52（原文 `ct=1692827574`） |
| 文章 A | 《无限期停止更新公告》 · https://mp.weixin.qq.com/s/ha6hHr40umlj-ExHdGFXXw |
| 文章 B | 《谈谈我的看法》 · https://mp.weixin.qq.com/s/gsC9STZlGrPNNEKUV4btkA |
| 抓取时间 | 2026-11-19 01:47（GMT+8） |
| 抓取方式 | 普通 HTTPS GET（无登录态、无 Cookie 注入），保留服务器返回原文 |

## 目录结构

```
archive/wechat-liciaotiao-2023/
├── README.md                    本说明（来源、口径、哈希）
├── 01-letter/
│   ├── page.html                文章 A 原页面完整 HTML（含微信全部脚本）
│   ├── body.jpg                 文章 A 正文长图原图 1080×3651
│   └── transcript.md            文章 A 逐段文字转录（原作者打码处标【遮挡】）
└── 02-my-view/
    ├── page.html                文章 B 原页面完整 HTML
    ├── body.png                 文章 B 正文长图原图 936×5562（无损 PNG）
    └── transcript.md            文章 B 逐段文字转录
```

## SHA-256 完整性表

| 文件 | 字节 | SHA-256 |
|---|---|---|
| `01-letter/page.html` | 3747226 | `1cc1c99d9b6b1c40e0a41700738f5824cf0ad2f68c5d1fe094f91210273d5684` |
| `01-letter/body.jpg` | 425226 | `b039668ca5d846ca4bd517a166df035136422b46e56c3fee88c1e4ddd65b4358` |
| `02-my-view/page.html` | 3746395 | `873b7379b5af09a2f5d1ca07453f7fe82b274a025079a24d12b3ef6f822b13b8` |
| `02-my-view/body.png` | 1431313 | `c986da366fa7500cb84a6c493eebbaa5b38968d8dacfbc390e95dbb845ffed6b` |

复核命令（在仓库根目录）：

```bash
sha256sum archive/wechat-liciaotiao-2023/01-letter/page.html \
          archive/wechat-liciaotiao-2023/01-letter/body.jpg \
          archive/wechat-liciaotiao-2023/02-my-view/page.html \
          archive/wechat-liciaotiao-2023/02-my-view/body.png
```

## 使用口径

- `page.html` 是微信服务器原样返回，内含大量微信自家脚本与样式，**离线打开只为取证**，不作为本站页面模板。
- `transcript.md` 为便于全文检索而人工照图录入；**法律效力以原图为准**， transcription 与原图冲突时以 `body.jpg` / `body.png` 为准。
- 原作者主动打码的当事人名称一律保留【遮挡】标记，本存档不还原、不推测。
- 本目录纳入 `verify.mjs` 完整性校验：文件缺失、字节数变化或哈希漂移都会判红。
