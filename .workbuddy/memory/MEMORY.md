# 项目长期记忆 · shuangxiugou

## 硬红线

- `assets/index-YthXZ9eP.js` 是压缩产物，**禁改**。多一个字符就可能白屏且控制台无报错。
- 改 bundle 后**必须**递增 `?v=N`；只改注入脚本也要递增对应 `?v=N`。
- 不要对已推送的公开仓库做 git filter-repo / filter-branch 历史重写。
- 根目录另有一份同名 `index-YthXZ9eP.js` 副本，改它完全不生效。
- 隐私：小票档案只写 localStorage，不发任何网络请求（verify 第 17 节盯着）。

## 注入层架构（custom-card-actions.js / pinyin-search.js）

按文案定位 React 渲染出的 DOM。三条铁律：

1. **定位文案必须从压缩包抠出来**，不能凭印象写。
   判断某句文案在哪：先定位锚点，再切区间。例如内置小票纸面 =
   `d[bundle.find('receipt-tear-top') : bundle.find('本次投票消费金额:')]`。
2. **定位失败必须 diag() 告警**，不许静默 `return null`。
   静默失败是漏检事故的直接原因。
3. **有全局 MutationObserver 时，重绘必须同值不写**
   （`if (el.textContent.trim() !== want) el.textContent = want`），
   否则自己触发自己，死循环卡死页面。

## 内置小票纸面真实 DOM（2026-10-16 查实）

| 位置 | 真实标签 | 值元素 |
|---|---|---|
| 纸面金额行 | `转移撤销消费金额:` / `注入良心企业预算:`（按违规避雷二选一） | `<span class="text-xl font-black font-mono">`，改 textContent |
| 纸面署名行 | `考核执行官:` | span |
| 纸面评级行 | `工时健康评级:` | span |
| 纸面下方输入 | `本次投票消费金额:` | `<input type="number">` React 受控 |

⚠️ **`已转移/支持消费:` 只存在于复制文本模板字符串里，纸面 DOM 上没有。**
用它定位必然返回 null。

理由行挂在「工时健康评级」之后，**不能用 `.sxg-kv` 定位**（自定义卡才有的 class）。

## 测试纪律（血泪）

**源码字符串断言对「DOM 定位类」bug 零检出能力。**
凡是按文案定位 DOM 的代码，必须有 jsdom 真 DOM 端到端测试。

现有脚本（都从真实源码抠函数跑，不写副本）：

| 脚本 | 项数 | 覆盖 |
|---|---|---|
| `scripts/verify.mjs` | 369 | 静态校验，18 节 |
| `scripts/test-builtin-ticket-dom.cjs` | 30 | 内置卡小票真 DOM 端到端 |
| `scripts/test-ticket-total.cjs` | 41 | 小票累计结算 + 旧数据迁移 |
| `scripts/test-pinyin-search.cjs` | 30 | 拼音联想 DOM 行为 |
| `scripts/test-pinyin-e2e.cjs` | 21 | 拼音回填能被原生搜索命中 |

测试脚本**必须**用 `path.resolve(__dirname, '..')` 取仓库根，硬编码绝对路径在 CI 必失败。

改了注入层 DOM 逻辑 → 跑测试 + 真实浏览器点一遍，不能只靠脚本。