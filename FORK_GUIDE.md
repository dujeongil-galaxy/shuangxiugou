# Fork 与二次开发指南

本文面向准备 Fork 本仓库、或基于本项目做二次开发的用户。重点说明**改之前必须知道的几件事**，其中数据合规部分请务必读完。

---

## 一、许可证与署名

本项目基于 [ZhiqingHeyi/shuangxiugou](https://github.com/ZhiqingHeyi/shuangxiugou) 修改，采用 **MIT License**。

MIT 允许你自由使用、修改、分发、商用，但**必须保留**：

- `LICENSE.md` 中原作者 `Copyright (c) 2026 ZhiqingHeyi` 的版权声明
- README 中的来源说明（`基于 ZhiqingHeyi/shuangxiugou 修改`）

MIT 只覆盖**代码**，不覆盖你发布的内容。详见下文「数据合规」。

---

## 二、⚠️ 数据合规（最重要，请务必读完）

本项目的核心内容是**对具名企业的劳动评价**——点名某公司单休、大小周、996、几点下班。

**这类内容一旦失实，可能涉及名誉权与商业诋毁风险。开源协议只管代码，不会替你免责，责任在发布者。**

### 必须遵守

1. **不要删除免责声明。** 站点当前载明：
   > 本站所有数据均来源于公开司法裁判文书、各地劳动监察部门行政处罚公开信息、上市公司公开 ESG 报告及社区打工人多方交叉验证。数据仅供个人择业与日常消费偏好参考，不构成商业排他或绝对背书。

   删掉它，风险全部由你承担。

2. **改数据必须同步更新证据说明。** 站内 31 张内置卡片的每一条数据都附带证据来源与置信度标注，改动请同步更新对应的 `desc` 字段，说明依据。

3. **优先采用可查证的公开来源：**
   - 政府/监管官方通报、劳动监察行政处罚决定书
   - 法院裁判文书、公益诉讼判决
   - 上市公司公开的 ESG 报告、年报
   - 招聘平台的企业自述（属"招聘方口径"，可信度低于官方通报）

   谨慎对待匿名爆料（论坛、社交平台吐槽），这类只能作为"员工反馈"参考，不能单独作为定性依据。

4. **查无证据时，标注"未核实"，不要编造数字。** 本项目现有做法是：26 张卡逐条核实，改不了的保持原值并标注未核实。

5. **区分总部与一线。** 同一家企业的办公室、工厂产线、门店的作息可能完全不同。给单一评分时须说明覆盖范围，否则容易误导。

### 已有数据的核实记录

26 张内置卡片的逐条核实过程（旧值 → 新值、证据 URL、置信度）见：

**[`docs-2026年10月-员工实测数据核实修改清单.md`](docs-2026年10月-员工实测数据核实修改清单.md)**

修改任何内置卡片前，建议先读这份文档，理解"平均下班"等口径的确切定义（员工实际离岗点众数，连锁门店取晚班打烊/交班点，不用营业时间冒充）。

---

## 三、⚠️ 部署架构：改错位置不生效

本项目**不是**常规的 Next.js 站点部署方式，弄清这点能避免绝大多数"改了没用"的问题。

### 线上部署的是什么

GitHub Pages **直接发布仓库根目录**，不经构建流程：

```
index.html                ← 部署入口
assets/index-YthXZ9eP.js ← 26 张内置品牌卡数据（压缩后的 React bundle）
assets/index-BgVofs0W.css
assets/*.svg|png          ← 各卡片 logo
```

**推送即上线，通常 1 分钟内生效。**

### 两个必须知道的坑

**1. 根目录有一份同名 js 副本是非部署文件**

```
assets/index-YthXZ9eP.js  ← 部署用，改这个
./index-YthXZ9eP.js       ← 副本，改它完全不生效
```

**2. 改 bundle 后必须递增版本号**

`index.html` 中引用形式为：

```html
<script src="./assets/index-YthXZ9eP.js?v=7">
```

改完 bundle 要把 `?v=7` 改成 `?v=8`，否则浏览器/CDN 会继续用旧缓存。

### 卡片数据分两处

| 卡片类型 | 数据位置 |
|---|---|
| 26 张内置品牌卡 | `assets/index-YthXZ9eP.js` |
| 自定义卡片（`customCardsConfig` 数组） | 根目录 `index.html` |

自定义卡片配置示例（肯德基/小米/兵立王/茶百道/赵一鸣等）：

```js
{
  id: 'kfc-card',
  name: '肯德基',
  company: '百胜中国控股有限公司',
  logo: './assets/kfc.svg',
  logoAlt: '肯德基',
  workPolicy: '综合工时制 / 早中晚三班倒',
  overtime: '周末节假日必上班 / 晚班到23点',
  doubleRestRate: '10',
  offWorkTime: '23:00',
  desc: '"……"',
  tags: ['快餐连锁', '餐饮', '百胜', 'KFC'],
  recommendText: '⚠️ 轮休制 / 周末节假日必上班',
  recommendColor: 'red',   // red=红框 / 其他=绿框
  insertAfter: '瑞幸',      // 插到哪张卡后面（用卡片的 h3 文字匹配）
  category: '食品饮品',
  grade: 'C级'// S/A/B/C，会影响卡片样式
}
```

字段说明：

- `grade` 决定克隆哪张模板卡，**同时决定红框能否渲染**（见下方「红框渲染机制」）
- `insertAfter` 填目标卡片的 h3 关键词
- 新增卡片需同步放入 `assets/` 下的 logo 文件

---

## 四、自定义卡片的红框渲染机制（易踩坑）

卡片底部的红框/绿框**不是**由配置字段直接生成的，而是**改造模板卡里已有的提示块**做出来的。

### 原��逻辑

```js
// 在新卡里找含"打工人推荐双休平替"文本的 div
var recommendBlock = null;
newCard.querySelectorAll('div').forEach(function(div) {
  if (div.textContent.includes('打工人推荐双休平替')) recommendBlock = div;
});
if (recommendBlock) { /* 替换成 recommendText */ }
```

### 已知限制与兜底

若模板卡内**没有**该绿框，`recommendBlock` 为 `null`，整段逻辑不执行，**红框不会显示**——此时配置里的 `recommendText` 完全不生效。

本仓库已加入兜底分支：当找不到模板绿框时，会主动创建一个与既有样式一致的警示框（`border-red-200 bg-red-50` / `#dc2626` / 14px），插入到标签行之后。

- 触发兜底：`data-recommend-box` 属性会出现在新建的红框上
- **注意**：S/A 级模板含绿框走原路径；B 级模板不含，需走兜底

---

## 五、SEO 相关注意

### 页面为纯客户端渲染

`index.html` 中 `<div id="root"></div>` 是空的，全部内容由 JS 注入。

- 搜索引擎爬虫若不执行 JS，只能读到 `<noscript>` 内的静态兜底正文（已内置 H1 + 3个 H2 + 36 家品牌清单）
- 若需彻底改善收录，需改造为 SSG/SSR，属框架级改动

### 标题层级（H2 修复）

页面可渲染部分原本是 `1 个 H1 + 36 个 H3`，缺失 H2 层。本仓库已用运行时方案修复：

- `scheduleHeadingFix()` 用 `requestAnimationFrame` 脱离 `MutationObserver` 回调栈执行
- 每张卡片用 `data-h2-checked` 做幂等标记，重复触发不会重复插入
- 只替换 h3 标签本身，保留原 className，外观零变化

> ⚠️ 修改这段时请务必保留上述安全措施。早期版本曾在 `MutationObserver` 回调中同步替换节点，导致卡片渲染异常（卡片数从 36 掉到 1）。任何改动此类运行时 DOM 逻辑后，**务必用无头浏览器 dump DOM 验证实际渲染结果**。

### 索引提交

站点已附 `submit-indexnow.mjs`，用于主动通知 Bing/Google 抓取：

1. 在 [Bing Webmaster Tools](https://www.bing.com/webmasters/) 添加站点并申请 IndexNow API Key
2. 把 Key 写入站点根目录的 `<key>.txt`
3. 执行 `set INDEXNOW_KEY=<key> && node submit-indexnow.mjs`

---

## 六、开发环境

```bash
npm install
npm run dev     # 开发
npm run build   # 构建
npm run lint    # 等同 tsc --noEmit
```

**但请注意**：`app/page.tsx` 渲染的是 `lib/companies.json`（28 家赞助商名单），**与线上 31 张双休评级卡完全是两套数据**。

> ⚠️ **不要执行 `npm run build` 后把产物部署到 GitHub Pages**，那会用赞助商名单页面覆盖现有的双休评级站点。如需修改线上内容，请直接编辑根目录 `index.html` 与 `assets/` 下的静态产物（见第三节）。

---

## 七、已知遗留问题

| 问题 | 现状 | 影响 |
|---|---|---|
| 纯客户端渲染 | 已有 noscript 兜底 | 收录速度仍慢，H1/H2/正文对爬虫依赖 JS |
| `app/` 源码与线上产物脱节 | 未同步 | 源码重建会覆盖线上数据，改动须走静态产物 |
| `/contact-developer`、`/sponsor` 页面 | 源码存在但未构建，线上 404 | 首页无入口链接，用户访问不到 |
| 静态产物手工程度高 | 无 CI | 每次改数据需手工提交 + 递增 `?v=N` |

---

## 八、一页速查

- [ ] 读完本文的**数据合规**部分
- [ ] 保留 `LICENSE.md` 中原作者版权声明
- [ ] 保留站内免责声明
- [ ] 改数据前先读核实清单文档，确认口径定义
- [ ] 改内置卡 → `assets/index-YthXZ9eP.js` + 递增 `index.html` 的 `?v=N`
- [ ] 改自定义卡 → 根目录 `index.html` 的 `customCardsConfig`
- [ ] 不要动根目录那份同名 js 副本
- [ ] 不要 `npm run build` 后部署（会覆盖线上数据）
- [ ] 改运行时 DOM 逻辑后，用无头浏览器 dump DOM 验证渲染结果

---

## 免责声明

本项目所有数据均来源于公开司法裁判文书、各地劳动监察部门行政处罚公开信息、上市公司公开 ESG 报告及社区多方交叉验证。数据仅供个人择业与日常消费偏好参考，**不构成商业排他或绝对背书**。

如发现信息有误，欢迎通过 [Issues](https://github.com/dujeongil-galaxy/shuangxiugou/issues) 提交反馈。