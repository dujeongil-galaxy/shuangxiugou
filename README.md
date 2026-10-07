# 双休购 · ShuangxiuGo

把老板考核你的 KPI，变成打工人考核老板的货币选票。

> **项目定位：本仓库是「双休购」主站**（线上应用，GitHub Pages 部署）。请与账号下另外两个双休购相关仓库区分：
>
> - **shuangxiugou-guide**（[仓库](https://github.com/dujeongil-galaxy/shuangxiugou-guide)）→ 独立的「双休购 2.0」公开资料与消费决策工具站（246 条企业/品牌记录 + 证据护照评分），与本主站是不同形态的产品；
> - **shuangxiu-go-archive**（[仓库](https://github.com/dujeongil-galaxy/shuangxiu-go-archive)）→ 第三方网站「双休GO」(shuangxiu-go.cn) 的全量静态存档备份，与本主站数据无关联。

> 基于 [ZhiqingHeyi/shuangxiugou](https://github.com/ZhiqingHeyi/shuangxiugou) 修改，MIT License

## 在线使用

打开 **https://dujeongil-galaxy.github.io/shuangxiugou/**

---

## 📋 数据核实文档

- [员工实测数据核实修改清单（2026年10月）](docs-2026年10月-员工实测数据核实修改清单.md)：31 张品牌卡「真实双休率 / 平均下班」逐卡证据核实记录，含旧值→新值、证据来源与置信度标注
- [仓库维护说明（MAINTAINING.md）](MAINTAINING.md)：本仓库 fork 后的改动记录、部署架构要点与已知遗留问题

---

## ☕ 赞助本项目

本站基于 [ZhiqingHeyi/shuangxiugou](https://github.com/ZhiqingHeyi/shuangxiugou) 开源修改（MIT）搭建。

如果你认可这个项目，欢迎支持它继续维护：**[`sponsor.html`](https://dujeongil-galaxy.github.io/shuangxiugou/sponsor.html)**

> 更推荐的做法是**提交你所在企业的真实双休数据**——这个项目的可持续性不靠赞助，靠更多人把数据补进来：
>[提交 Issues](https://github.com/dujeongil-galaxy/shuangxiugou/issues/new)

---

## 🍴 Fork 与二次开发

**准备 Fork 或基于本项目改数据？请先读 [`FORK_GUIDE.md`](FORK_GUIDE.md)。**

三件最容易踩坑的事：

1. **数据合规优先**：本项目内容是对具名企业的劳动评价，MIT协议只管代码不管内容合法性。改数据必须同步更新证据说明，**不要删除站内免责声明**。
2. **改错位置不生效**：26 张内置卡数据在 `assets/index-YthXZ9eP.js`，自定义卡在 `index.html`；根目录另有一份同名 js 是**非部署副本**，改它无效；改 bundle 后须递增 `?v=N` 防缓存。
3. **不要 `npm run build` 后部署**：`app/` 源码与线上产物是两套数据，重建会覆盖现有站点。

---

"用消费者的订单投票，反向考核企业良心；把老板考核你的 KPI，变成打工人考核老板的货币选票。"

受常州星宇股份违法解除数百名应届毕业生及劳动法合规议题启发，本项目旨在打破企业工时黑盒，通过开源众包与真实司法/监管记录，让消费者能一眼识别哪些品牌真正践行周末双休、尊重员工劳动权益。

## 🌟 核心功能

**双休品牌白名单与避雷库：**
- 涵盖数码外设、户外服饰、个人护理、运动器材、零食饮料、汽车生活等常见消费品类。
- 提供 S级（模范标杆）、A级（合规双休 965）、B级（大小周/存疑）、C级（严重超时/通报违约）清晰评级。

**良心平替自动推荐：**
- 当查询到避雷单休企业时，自动推荐同品类、价格亲民且严格落实双休的国货/外企替代品。

**"用脚投票"消费打卡与小票生成：**
- 生成打工人专属复古热敏打印小票凭证，方便在小红书、朋友圈分享态度。

**双休透镜 Chrome/Edge 浏览器扩展：**
- 在逛京东、淘宝、拼多多时，自动识别商品所属企业工时状况，弹出悬浮避雷与平替提示。

## 📱 做成手机 APP（网页套壳）

本项目是纯静态网页，可用「一个木函」APP 一键套成 APK：

1. 下载安装「一个木函」（Android）
2. 打开 → 工具箱 → 网页转应用
3. 填入网址：`https://dujeongil-galaxy.github.io/shuangxiugou/`
4. 应用名称和包名自定义即可
5. 生成 APK 安装即可

## 🚀 本地开发与启动

```bash
# 1. 克隆项目并安装依赖
npm install

# 2. 启动本地开发服务
npm run dev

# 3. 构建生产包（Next.js standalone 输出）
npm run build
```

> ⚠️ **架构说明（2026-10 修正）**：本仓库存在两套产物，请勿混淆——
>
> - **线上实际部署**的是仓库根目录的**静态产物**：`index.html` + `assets/index-YthXZ9eP.js` + `assets/index-BgVofs0W.css` + `assets/*.logo`。GitHub Pages 直接发布仓库根目录，**不经过构建步骤**，推送即生效（约 60 秒）。
> - `app/` 下的 Next.js 源码（`app/page.tsx` 等）**并未构建成线上页面**。`npm run build` 的产物也没有部署到 GitHub Pages。
>
> **改数据前必看**：公司卡片数据分散在两处，改错位置不生效——
>
> | 卡片类型 | 数据位置 |
> |---|---|
> | 26 张内置品牌卡（迪卡侬、瑞幸、星巴克、优衣库等） | `assets/index-YthXZ9eP.js` |
> | 自定义卡片（`customCardsConfig` 数组：肯德基、小米、兵立王、茶百道、赵一鸣等） |根目录 `index.html` |
>
> 仓库根目录另有一份同名 `index-YthXZ9eP.js` 副本属**非部署文件**，改它不生效。
>
> 修改 `assets/` 下的 bundle 后，还需把 `index.html` 中的 `?v=N` 版本号加1 防浏览器缓存。

## 🧩 浏览器插件说明

> ⚠️ 插件功能（`extension/` 目录）**当前不在本仓库中**，README 历史版本中的安装说明已移除。

## 🌐 在线访问与部署

本项目主站通过 **GitHub Pages** 部署：

- 在线地址：https://dujeongil-galaxy.github.io/shuangxiugou/
- 部署方式：仓库根目录静态产物直发，无需构建
- 更新方式：修改静态产物后推送 `main` 分支，约 60 秒生效

>历史版本的「Vercel 一键部署 + vercel.json」说明已移除：仓库中**不存在** `vercel.json`，且项目实际框架为 Next.js 而非 Vite。

---

## 推荐

VPN机场推荐：

https://74.82.196.10:8000/register?aff=v17mHNYv

点击[这里](https://github.com/dujeongil-galaxy)关注我的其他项目

## ⚖️ 免责声明

本项目所有数据均来源于公开司法裁判文书、各地劳动监察部门行政处罚公开信息、上市公司公开 ESG 报告及社区打工人多方交叉验证。数据仅供个人择业与日常消费偏好参考，不构成商业排他或绝对背书。

如发现信息有误或需要更正，欢迎通过 GitHub Issues 提交反馈：

https://github.com/dujeongil-galaxy/shuangxiugou/issues

## License

MIT License © 2026 ZhiqingHeyi / dujeongil-galaxy

仅供消费与择业参考，数据为社区众包汇总，请理性看待。
