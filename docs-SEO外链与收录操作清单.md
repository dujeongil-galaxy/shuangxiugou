# 外链与收录操作清单

> 这份文档里的操作**需要你本人在浏览器/控制台完成**（涉及第三方账号登录、本机密钥生成）。
> 我无法代为执行。每条都写清了「在哪做、复制什么、为什么」。
>
> 前提：`BingSiteAuth.xml` 已就位于线上，`IndexNow` 的workflow 已接好，
> 只差密钥；Google 侧需在 Search Console 手动验证（GitHub 无MCP 权限）。

---

## 一、IndexNow 密钥（必做，Bing 收录最快的方式）

IndexNow 是 Bing/Yandex 官方支持的推送协议，内容更新后主动通知搜索引擎，
比等爬虫回访快得多。

### 步骤

1. 打开 <https://www.bing.com/webmasters/> 并登录（微软账号）
2. 添加站点 `https://dujeongil-galaxy.github.io/shuangxiugou`
   - 若提示验证方式，优先选「**导入的文件**」或XML sitemap
   - sitemap 路径：`https://dujeongil-galaxy.github.io/shuangxiugou/sitemap.xml`
3. 进入 **站点管理 → 索引 API / IndexNow**
4. 点「创建」，复制生成的 key（形如 `a1b2c3d4e5f6...` 的十六进制串）
5. 把key 文件放到本地仓库根目录，文件名就是 key 本身，内容也写 key：
   ```bash
   # 在仓库根目录执行，把<YOUR_KEY> 换成上一步拿到的值
   echo -n "<YOUR_KEY>" > "<YOUR_KEY>.txt"
   ```
6. 把这个文件提交推送到 GitHub：
   ```bash
   git add "<YOUR_KEY>.txt" && git commit -m "chore: 添加 IndexNow 密钥文件" && git push
   ```
7. 在仓库 **Settings → Secrets and variables → Actions → New repository secret**：
   - Name：`INDEXNOW_KEY`
   - Value：粘贴你的 key
   - 点 **Add secret**

搞定后，每次 push 到 `main` 会自动推送全部 sitemap 里的 URL 给 Bing。
日志可在 Actions 页查看，不成功也不会阻塞提交。

---

## 二、Google Search Console（必做，Bing 之外的第二大来源）

1. 打开 <https://search.google.com/search-console>
2. 添加属性 → 选 **URL 前缀** → 填 `https://dujeongil-galaxy.github.io/shuangxiugou/`
3. 验证方式选 **标签**：在 `index.html` 的 `<head>` 里加一行
   ```html
   <meta name="google-site-verification" content="这里填 Google 给你的字符串" />
   ```
   （Google 会给一段 `content="xxxxx"` 的字符串）
4. 加完后告诉我，我帮你把它补进校验脚本的检查项，避免以后误删
5. 验证通过后，在 Search Console **网址检查** 里提交
   `https://dujeongil-galaxy.github.io/shuangxiugou/sitemap.xml`

---

## 三、Sitemap 提交与主动推送

### Bing

Search Console 验证完成后顺手做，或直接在 IndexNow 页面提交 sitemap 文本。

### Google

在 Search Console 后台的 **Sitemaps** 区域填入上述路径即可。

**当前 sitemap 含38 条 URL**（首页 + 同类项目导航 + 36 个品牌详情页），
`/brand/huawei.html`、`/brand/pinduoduo.html` 这类页面就是为长尾搜索准备的。

---

## 四、给同类项目提互链 issue（重要，这是站外权重的唯一来源）

实测数据（2026-10-10）：

| 站点 | 定位 | 「双休」词频 | 是否有外链指向 |
|---|---|---|---|
| `tdwc.luomor.com` | 双休企业名录（92 家） | **208** | ✅ 两篇博客推荐 |
| `luomor/shuangxiugou` | 同名 GitHub 仓库 | 34 | ✅ 两篇博客推荐 |
| `zhangchunsheng/two-day-weekend-companies` | 双休企业名录 | 60 | ✅ |
| **本主站** | 品牌评级 + 消费透镜 | 74 | ❌ **零外链** |

**「双休」这个词的搜索结果里，中文博客与技术站占了大头。**
主站的技术 SEO 已不差（title/description/noscript 正文/详情页都到位），
但**站外零外链**让它进不了前列。这是页面改动解决不了的。

下面三段文案可直接复制。**发 issue 前请自行确认措辞是否代表你的意愿**，
我不了解你与这些项目维护者的关系。

### 4.1 给 `luomor/shuangxiugou`

> 标题：`[合作提议] 同名项目互链：按品牌评级 vs 按城市名录，定位互补`
>
> 你好，注意到我们都在做「双休购」相关的开源项目：
>
> - **你的**：`luomor/shuangxiugou` —— 开源劳工友好品牌索引与网购透镜
> - **我的**：`dujeongil-galaxy/shuangxiugou` —— 同名项目的二次开发版
>   https://dujeongil-galaxy.github.io/shuangxiugou/
>
> 我注意到你的站点实际部署版本走的是 `tdwc.luomor.com`（按省/市筛选的企业名录），
> 而我这版做的是**按品牌评级 + 消费决策透镜**（S/A/B/C 四档 + 真实双休率 + 平均下班时间 + 证据链），
> 收录 32 个内置品牌 + 5 个自定义卡，每条数据都带公开来源链接。
>
> 两边定位其实不太重叠：你的强项是「找工作时按城市查哪些公司双休」，
> 我的强项是「买东西前查这个牌子背后的公司对员工好不好」。
>
> 想提个建议：**在彼此的项目页/README 里加一条互链说明**，
> 让两个项目被搜到时能互相导流。你觉得如何？
>
> 如果你更希望各做各的、不做互链，也完全没关系，我只是提一下。
> 另外如果你有兴趣，我这边每个品牌都有独立的可索引详情页
> （如 `https://dujeongil-galaxy.github.io/shuangxiugou/brand/huawei.html`），
> 如果你的名录需要按品牌反查，可以直接用。

### 4.2 给 `zhangchunsheng/two-day-weekend-companies`

> 标题：`[合作提议] 双休购同名项目互链 + 数据口径想请教`
>
> 你好，我是 `dujeongil-galaxy/shuangxiugou` 的维护者
> （https://dujeongil-galaxy.github.io/shuangxiugou/），
> 同样是基于 ZhiqingHeyi/shuangxiugou 二次开发，也在做双休相关的收录工具。
>
> 看到你的项目收录了 92 家全国性企业，按省份城市筛选，做得很扎实。
> 我这版走的是另一个方向：按品牌评级（S/A/B/C 四档）+ 真实双休率 + 平均下班时间 + 证据链，
> 收录 32 个内置品牌，每个品牌有独立的可索引详情页。
>
> 想请教两个问题：
>
> 1. **你们的「双休」判定口径是什么？** 我看到分类里有「名义双休」「职能岗双休」
>    这类细分，而我的口径是「每周能完整休满 2 天的员工占比」。
>    如果能对齐口径，对用户判断更有帮助。
> 2. **是否考虑互相加个链接？** 搜索「双休购」时我们经常一起出现，
>    如果在各自 README 或项目页说明一下定位差异，用户能各取所需。
>
> 不方便的话也完全理解，只是觉得同名的项目互相认知一下比较有益。

### 4.3 给 `tdwc.luomor.com`（如果能找到其GitHub 仓库）

> 标题：`[建议] 双休购相关项目互相导流：三个项目的定位对比`
>
> 你好，我在整理「双休购」相关的中文项目，发现目前至少有四个同源或相关项目：
>
> | 项目 | 定位 | 在线站点 |
> |---|---|---|
> | `ZhiqingHeyi/shuangxiugou` | 原始项目（品牌评级） | 已下架 |
> | `dujeongil-galaxy/shuangxiugou`（本项目） | 品牌评级 + 消费透镜 + 证据链 | https://dujeongil-galaxy.github.io/shuangxiugou/ |
> | `luomor/shuangxiugou` / tdwc.luomor.com | 按省市筛选的企业名录 | https://tdwc.luomor.com/ |
> | `zhangchunsheng/two-day-weekend-companies` | 双休企业名录 | 需自行确认 |
>
> 我们已经在自己的 [同类项目导航页](https://dujeongil-galaxy.github.io/shuangxiugou/projects.html)
> 做了区分标注，注明每个项目是「按品牌评级」还是「按城市名录」，
> 避免用户点进去发现只有代码、或发现定位不符合预期。
>
> 建议各项目也互相标注一下差异。**如果你的仓库地址与此不同，请告诉我，我更新导航页。**
>
> 另外想提一个建议：用户搜索「双休购」时，容易被2025 年 9 月那波小程序热点新闻
> （BBC、极目等报道）淹没，实际可用的工具类站点不容易被找到。
> 如果大家能互相引用、在 README 里写清「本项目提供XX 功能」，
> 对整个生态的用户都有好处。

---

## 五、可提交到 awesome-list 的项目介绍

如果你的PR 权限可用，下面这段可直接用：

> **双休购 ShuangxiuGo**
> https://github.com/dujeongil-galaxy/shuangxiugou
>
> 基于 ZhiqingHeyi/shuangxiugou 二次开发的开源劳工友好品牌索引。
> 收录 32 个内置品牌 + 5 个自定义卡，按 S/A/B/C 四档标注真实双休率与平均下班时间，
> 每条数据附公开证据链（司法文书、劳动监察通报、ESG 报告、招聘自述、员工爆料）。
> 无需安装，浏览器直接打开：https://dujeongil-galaxy.github.io/shuangxiugou/
>
> 特点：
> - 每个品牌有独立的可索引详情页，含评级依据与证据链接
> - 未核实的字段一律标「未核实」，不用估算值填充
> - 提供核实时数据校验脚本（零依赖，130+ 项检查）与 GitHub Actions
> - MIT 协议

---

## 六、已由我完成、无需你操作的项

- ✅ 36 个品牌静态详情页（含 title / description / canonical / Article schema / 证据链 / 互链）
- ✅ 首页 noscript 正文从 1462 → 4762 字符（爬虫唯一可读正文，含全量品牌数据）
- ✅ sitemap.xml 从 2 条 → 38 条，覆盖全部详情页
- ✅ 首页与 `projects.html` 各链向全部 36 个详情页（共144 条内链）
- ✅ IndexNow 脚本改为**自动读取 sitemap.xml**，sitemap 变了它自动跟着变
- ✅ `IndexNow` 的 GitHub Actions（等密钥到位即生效）
- ✅ 校验脚本新增「13d 品牌详情页」检查（11 项，防回归）
- ✅ 生成脚本归档到 `scripts/seo/`，`npm run seo:brands` 一键重跑

**预期效果**：详情页上线后，搜索「XX公司 双休率」「XX 加班」这类长尾词会开始有入口。
但**主词「双休购」的排名提升主要取决于上面第四节的外链**，
技术 SEO 已经做到位，剩下的权重得靠站外链接。
