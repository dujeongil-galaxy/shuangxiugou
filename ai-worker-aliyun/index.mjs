/* ==========================================================================
   ai-worker-aliyun/index.mjs —— 双休购「劳动法小助手」阿里云函数计算版
   --------------------------------------------------------------------------
   定位
   ----
   与 ai-worker/src/worker.js（Cloudflare Worker）接口、校验、限流口径对齐的
   **第二条线路**。前端 ai-chat.js 按形象分流：
     形象 A/B/C（索引 0-2）→ Cloudflare Worker
     形象 D/E/F（索引 3-5）→ 本函数（阿里云 FC），地址填 ai-config.js 的 endpointCN

   为什么要有第二条线路
   --------------------
   Cloudflare workers.dev 在境内直连不稳（部分网络需代理）。阿里云函数计算
   + 百炼（DashScope）是境内直连，国内用户走这条线路不用 VPN。

   接口（与 Cloudflare 版完全一致）
   --------------------------------
   请求 POST application/json：
     { "question": "1~500 字", "history": [{"role":"user|assistant","content":"≤200字"}], "route": "cn", "quotaTier": "full|half" }
   响应：
     200 { "answer": "…", "route": "cn" }
     400 { "error": "question-required-1-to-500-chars" | "invalid-json" }
     403 { "error": "origin-not-allowed", "origin": "…" }
     405 { "error": "method-not-allowed" }
     429 { "error": "rate-limited", "retryAfter": 3600 } | { "error": "daily-quota-exhausted" }
     502 { "error": "ai-upstream-error" | "empty-answer" }
     500 { "error": "missing-api-key" }

   安全口径（与 Cloudflare 版逐条对齐）
   ------------------------------------
   ① CORS 白名单：只放行本站 GitHub Pages + 本地验收 localhost
   ② 输入校验：question 1~500 字、非法 JSON 400
   ③ history 清洗：role 白名单、最多 8 条（4 轮）、单条截 200 字
   ④ 系统提示词锁定角色（与 Worker 同一套文案，含 route 如实说明条款）
   ⑤ max_tokens 限制输出
   ⑥ 每 IP 滑窗限流：登录 20 次/小时、未登录减半 10 次/小时（内存版，见下方「已知限制」）
   ⑦ API Key 只从环境变量读：DASHSCOPE_API_KEY，代码与仓库里绝不落明文

   已知限制（诚实说明，别当它能扛量）
   ----------------------------------
   FC 实例会被回收、且多实例内存不共享，内存限流只是「够用的粗限流」，
   与 Cloudflare 版同级，防单 IP 脚本刷而非精确配额。真要精确配额请接
   Redis / Tablestore，把 checkRate 换成外部计数即可（本文件已隔离成单函数）。

   部署步骤见同目录 README.md。
   ========================================================================== */

const ALLOWED_ORIGINS = [
  'http://localhost:18970', // 本地验收服务（与 Cloudflare 版一致）
];
const SITE_ORIGIN = 'https://dujeongil-galaxy.github.io';

const DASHSCOPE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
const DEFAULT_MODEL = 'qwen-plus'; // 可在环境变量 DASHSCOPE_MODEL 覆盖
const RATE_LIMIT_FULL = 20; // 已登录：次/小时（与 Cloudflare 现行规则一致）
const RATE_LIMIT_HALF = 10; // 未登录：一律减半
const RATE_WINDOW_MS = 3600 * 1000; // 每小时

// 线路说明（与 ai-worker/src/worker.js 的 routeNotice 保持同一套措辞）
const ROUTE_NAME = {
  cf: 'cf（Cloudflare Workers，海外线路）',
  cn: 'cn（阿里云函数计算，境内直连线路）',
};
function routeNotice(route) {
  if (!route || !ROUTE_NAME[route]) return '';
  return '\n13. 本次请求的线路标识为 ' + ROUTE_NAME[route] +
    '。若用户问及线路、访问方式或网络需要（VPN 等），请如实说明本次由该线路服务；' +
    '不要声称自己走的是其他线路，也不要把线路标识当成用户提供的事实依据去影响法律结论。';
}

// ---------- 站内双休数据快照（2026-11-22 从 brand/*.html 提取，190 家） ----------
// 与 ai-worker/src/worker.js 的 BRAND_DATA_SNIPPET 保持一致（verify.mjs 有断言对齐）。
// 更新方法：跑 scripts/extract-brand-prompt.mjs 重新生成，两边同步替换。
const BRAND_DATA_SNIPPET = [
  '- 361 度：A级（口径换算）｜页:361du\n- 农业银行 (ABC)：C级，主体月休约 4-5 天｜页:abc\n- 宏碁 (Acer)：U级，证据不足｜页:acer\n- 广汽埃安：B级，职能岗双休、一线倒班、取消加班费为负面信号，按本站口径判 B 级｜页:aion\n- 阿里巴巴：A级（口径换算）｜页:alibaba\n- 安克创新：A级（口径换算）｜页:anker\n- 蚂蚁集团：A级（口径换算）｜页:ant\n- 安踏：B级（口径换算）｜页:anta\n- 苹果 (Apple)：S级，双休率92%，下班18:00，严格双休标杆｜页:apple\n- 亚马逊云科技：A级（口径换算）｜页:aws\n- 百度：A级（口径换算）｜页:baidu\n- 白云山：A级（口径换算）｜页:baiyunshan',
  '- 巴奴毛肚火锅：C级（口径换算）｜页:banana\n- 蜂花 (Bee & Flower)：A级，双休率92%，下班18:20，合规双休接近965｜页:bee-flower\n- 哔哩哔哩：A级（口径换算）｜页:bilibili\n- 兵立王：C级，西南地区门店线下一手核实：月休 4 天｜页:bingliw\n- 蓝月亮：A级（口径换算）｜页:bluemoon\n- 中国银行 (BOC)：A级，轮休制做五休二｜页:boc\n- 京东方：C级（口径换算）｜页:boe\n- 波司登：B级（口径换算）｜页:bosideng\n- BOSS直聘：D级（站长人工介入）｜页:bosszhipin\n- 光明乳业：A级（口径换算）｜页:bright\n- 公牛集团：A级（口径换算）｜页:bull\n- 比亚迪 (BYD)：C级，双休率15%，下班20:00，严重超时、存在通报违约记录｜页:byd',
  '- 字节跳动 (ByteDance)：B级，数据存疑｜页:bytedance\n- 宁德时代 (CATL)：C级，公开招聘公示一线两班倒｜页:catl\n- 建设银行 (CCB)：A级，轮休制做五休二｜页:ccb\n- 茶百道：C级，西南地区门店线下一手核实：月休 4 天｜页:chabaidao\n- 霸王茶姬 (CHAGEE)：C级，避雷预警｜页:chagee\n- 长安启源：B级，无品牌专门一手证据，按长安汽车整体口径暂记 B 级并明确标注、待补启源专门证据｜页:changan-qiyuan\n- 成都银行 (BOCD)：A级，轮休制做五休二｜页:chengdubank\n- 奇瑞汽车 (CHERY)：C级，曾定 D 级，2026-11-03 站长回退为 C 级｜页:chery\n- 中国人寿：A级（口径换算）｜页:chinalife\n- 中金公司：C级（口径换算）｜页:cicc\n- 中信证券：C级（口径换算）｜页:citicsec\n- 招商银行：C级｜页:cmb',
  '- 可口可乐：A级（口径换算）｜页:coke\n- 库迪咖啡 (COTTI COFFEE)：C级，站长西南地区门店线下一手核实：月休 4 天 / 做六休一｜页:cotti\n- TCL 华星：C级（口径换算）｜页:csot\n- 携程 (Ctrip)：A级，合规双休｜页:ctrip\n- 大华股份：B级（口径换算）｜页:dahua\n- 迪卡侬 (Decathlon)：A级，双休率85%，下班20:30，合规双休接近965｜页:decathlon\n- 得物：A级（口径换算）｜页:dewu\n- 大疆 DJI：B级，数据存疑｜页:dji\n- 追觅科技：C级（口径换算）｜页:dreame\n- 东方财富：A级（口径换算）｜页:eastmoney\n- 科沃斯：A级（口径换算）｜页:ecovacs\n- 方太：C级（口径换算）｜页:foto',
  '- 富士康：C级（口径换算）｜页:foxconn\n- 广汽丰田：B级，双休不稳｜页:gac-toyota\n- 吉利汽车：C级｜页:geely\n- 元气森林：A级（口径换算）｜页:genki\n- 歌尔股份：C级（口径换算）｜页:goertek\n- 好孩子：A级（口径换算）｜页:goodbaby\n- 谷歌：A级（口径换算）｜页:google\n- 格力 (GREE)：A级，合规双休｜页:gree\n- 国泰海通：C级（口径换算）｜页:gtja\n- 广发银行 (CGB)：A级，网点周末轮值、员工周休 2 天｜页:guangfa\n- 长城汽车 (GWM)：C级，双休率51%，双休不稳｜页:gwm\n- 海底捞：C级，避雷预警｜页:haidilao',
  '- 海尔 (Haier)：B级，双休率50%，下班19:40，大小周或数据存疑｜页:haier\n- 海天味业：B级（口径换算）｜页:haitian\n- 盒马 (Freshippo)：C级，避雷预警｜页:hema\n- 恒瑞医药：A级（口径换算）｜页:hengrui\n- 喜茶 (HEYTEA)：C级，严重超时、存在通报违约记录｜页:heytea\n- 海康威视：B级（口径换算）｜页:hikvision\n- 海信：B级（口径换算）｜页:hisense\n- 海澜之家：C级（口径换算）｜页:hla\n- 荣耀：A级（口径换算）｜页:honor\n- 华泰证券：A级（口径换算）｜页:htsec\n- 华为终端：C级，双休率35%，下班20:30，严重超时、存在通报违约记录｜页:huawei\n- 沪上阿姨：C级，依据多地门店公开招聘 JD 交叉印证「月休 2 天」与 10–12 小时班次，按本站月休口径判 C 级｜页:hushangayi',
  '- IBM：A级（口径换算）｜页:ibm\n- 工商银行 (ICBC)：A级，轮休制做五休二｜页:icbc\n- 宜家 (IKEA)：S级，双休率98%，下班17:45，严格双休标杆｜页:ikea\n- 影石 Insta360：A级（口径换算）｜页:insta360\n- 英特尔：A级（口径换算）｜页:intel\n- 上海家化：A级（口径换算）｜页:jahwa\n- 京东：A级（口径换算）｜页:jd\n- 加多宝：C级（口径换算）｜页:jdb\n- 极氪：B级，双休与加班打卡绑定、岗位分化，按本站口径判 B 级｜页:jike\n- 今麦郎：C级（口径换算）｜页:jml\n- 九阳：B级（口径换算）｜页:joyoung\n- 君乐宝：B级（口径换算）｜页:junlebao',
  '- 九州通：A级（口径换算）｜页:jzt\n- 肯悦咖啡 (KCOFFEE)：C级，站长西南地区门店线下一手核实：月休 4 天 / 做六休一｜页:kenyue\n- 肯德基：C级，双休率10%，下班23:00，严重超时、存在通报违约记录｜页:kfc\n- 快手 (Kuaishou)：B级，数据存疑｜页:kuaishou\n- 顾家家居：C级（口径换算）｜页:kuka\n- 岚图：C级，一线多份 JD「上六休一」接近单休，按本站月休口径判 C 级｜页:lantu\n- 老乡鸡：C级（口径换算）｜页:laoxiangji\n- 零跑汽车：C级｜页:leapmotor\n- 联想：A级（口径换算）｜页:lenovo\n- 蓝思科技：C级（口径换算）｜页:lens\n- 良品铺子：B级（口径换算）｜页:liangpin\n- 立白 (Liby)：B级，双休率45%，下班19:40，大小周或数据存疑｜页:liby',
  '- 莉莉丝游戏：A级（口径换算）｜页:lilith\n- 零食有鸣：C级｜页:lingshiyouming\n- 李宁：A级（口径换算）｜页:lining\n- 理想汽车：B级，按本站月休天数口径｜页:lixiang\n- 罗技 (Logitech)：A级，双休率92%，下班18:00，合规双休接近965｜页:logitech\n- 瑞幸咖啡：C级，双休率40%，下班21:30，严重超时、存在通报违约记录｜页:luckin\n- 陆喜依：S级，站长 2026-11-08 指定 S 级｜页:luxiyi\n- 立讯精密：C级（口径换算）｜页:luxshare\n- 毛戈平：A级（口径换算）｜页:maogeping\n- 康师傅：B级，双休率30%，下班19:40，大小周或数据存疑｜页:master-kong\n- 麦当劳：A级（口径换算）｜页:mcd\n- 美团 (Meituan)：C级，双休率25%，下班21:00，严重超时、存在通报违约记录｜页:meituan',
  '- 美宜佳：C级｜页:meiyijia\n- 微软 (Microsoft)：S级，双休率98%，下班17:45，严格双休标杆｜页:microsoft\n- 美的 (Midea)：B级，数据存疑｜页:midea\n- 米哈游 (miHoYo)：B级，数据存疑｜页:mihoyo\n- 名创优品 (MINISO)：C级，避雷预警｜页:miniso\n- 蜜雪冰城 (MIXUE)：C级，西南地区大部分门店月休 4 天｜页:mixue\n- 茉莉奶白：C级｜页:molina\n- 慕思股份：A级（口径换算）｜页:musie\n- 北方华创：A级（口径换算）｜页:naura\n- 网易游戏：B级，大小周观察｜页:netease-games\n- 网易有道：B级，双休率70%，下班19:30，大小周或数据存疑｜页:netease-youdao\n- 网易：A级（口径换算）｜页:netease',
  '- 蔚来：B级（口径换算）｜页:nio\n- 农夫山泉：B级，双休率35%，下班17:45，大小周或数据存疑｜页:nongfu\n- 英伟达：A级（口径换算）｜页:nvidia\n- 欧派家居：A级（口径换算）｜页:oppein\n- 欧司朗 (OSRAM)：A级，双休率88%，下班18:20，合规双休接近965｜页:osram\n- Patagonia：S级，双休率98%，下班17:45，严格双休标杆｜页:patagonia\n- 胖东来：A级，合规善待标杆｜页:pdl\n- 百事食品：A级，双休率88%，下班18:00，合规双休接近965｜页:pepsi\n- 飞利浦车用 (Philips)：A级，双休率90%，下班18:20，合规双休接近965｜页:philips-automotive\n- 片仔癀：A级（口径换算）｜页:pianzihuang\n- 拼多多：C级，双休率12%，下班22:00，严重超时、存在通报违约记录｜页:pinduoduo\n- 中国平安：A级（口径换算）｜页:pingan',
  '- 珀莱雅：A级（口径换算）｜页:proya\n- 洽洽食品：A级（口径换算）｜页:qiaqia\n- 老板电器：B级（口径换算）｜页:robam\n- 三星 (Samsung)：U级，证据不足｜页:samsung\n- SAP（思爱普）：S级，双休率95%，下班18:00，严格双休标杆｜页:sap\n- 森马：A级（口径换算）｜页:semir\n- 顺丰速运：C级，双休率15%，下班19:30，严重超时、存在通报违约记录｜页:sf-express\n- 深蓝汽车：B级，职能双休公示与产线综合工时并存、岗位分化，按本站口径判 B 级｜页:shenlan\n- 国药控股：A级（口径换算）｜页:sinopharm\n- 中芯国际：C级（口径换算）｜页:smic\n- 华润雪花：B级（口径换算）｜页:snowbeer\n- 索菲亚：A级（口径换算）｜页:sofia',
  '- 索尼 (Sony)：A级，双休率90%，下班18:00，合规双休接近965｜页:sony\n- 星巴克 (Starbucks)：A级，双休率98%，下班22:30，合规双休接近965｜页:starbucks\n- 苏泊尔：A级（口径换算）｜页:supor\n- 太二酸菜鱼：C级（口径换算）｜页:taier\n- 太平鸟：C级（口径换算）｜页:taipingniao\n- 淘宝闪购 (饿了么)：C级，无双休｜页:taobao-shanguang\n- 腾讯 (Tencent)：B级，双休率82%，下班20:30，大小周或数据存疑｜页:tencent\n- 财付通：A级（口径换算）｜页:tenpay\n- 北面 (The North Face)：A级，双休率88%，下班21:00，合规双休接近965｜页:the-north-face\n- 四川天府银行：A级，网点周末对私营业、员工轮班周休 2 天｜页:tianfu\n- 天马微电子：A级（口径换算）｜页:tianma\n- 同仁堂：A级（口径换算）｜页:tongrentang',
  '- 统一：B级（口径换算）｜页:tongyi\n- 传音控股：A级（口径换算）｜页:transmion\n- 青岛啤酒：B级（口径换算）｜页:tsingtao\n- 绿联：A级（口径换算）｜页:ugreen\n- 中国联通：B级｜页:unicom\n- 中国银联：A级（口径换算）｜页:unionpay\n- 优衣库 (Uniqlo)：A级，双休率82%，下班23:00，合规双休接近965｜页:uniqlo\n- vivo：B级，双休率60%，下班19:30，大小周或数据存疑｜页:vivo\n- 沃尔沃 (Volvo)：S级，双休率92%，下班18:05，严格双休标杆｜页:volvo\n- 华莱士：C级（口径换算）｜页:wallace\n- 问界（赛力斯）：C级，劳动监察官方回复口径为「平均每周至少休息一天」｜页:wenjie\n- 闻泰科技：C级（口径换算）｜页:wentai',
  '- 韦尔股份：A级（口径换算）｜页:will\n- 金山办公：A级（口径换算）｜页:wps\n- 上汽通用五菱：B级，官方 JD 较规范但「每周至少休一天」非双休、一线倒班，按本站口径判 B 级｜页:wuling\n- 物美：C级（口径换算）｜页:wumart\n- 药明康德：B级（口径换算）｜页:wuxiapptec\n- 极米科技：A级（口径换算）｜页:xgimi\n- 呷哺呷哺：C级（口径换算）｜页:xiabu\n- 小红书 (REDnote)：B级，数据存疑｜页:xiaohongshu\n- 小米汽车：B级（站长人工介入）｜页:xiaomi-auto\n- 小米：B级，双休率53%，下班20:30，双休不稳，2026-11-13 站长要求下调｜页:xiaomi\n- 小鹏汽车：B级，岗位分化：研发/白领口径双休但加班重，工厂 JD 写大小周｜页:xiaopeng\n- 西贝餐饮：C级（口径换算）｜页:xibei',
  '- 喜家德：C级（口径换算）｜页:xijiade\n- 心动网络：A级（口径换算）｜页:xindong\n- 常州星宇股份：C级，双休率12%，下班20:00，严重超时、存在通报违约记录｜页:xingyu\n- 特步：C级（口径换算）｜页:xtep\n- 逸仙电商：B级（口径换算）｜页:yatsen\n- 一点点 (1点点)：C级，站长西南地区门店线下一手核实：淡季月休 8 天 / 旺季月休 4 天，季节波动、非大小周｜页:yidiandian\n- 伊利：A级（口径换算）｜页:yili\n- 长江存储：C级（口径换算）｜页:ymttc\n- 云南白药：A级（口径换算）｜页:yunnanbaiyao\n- 赵一鸣 / 零食很忙：C级，下班22:30，严重超时、存在通报违约记录｜页:zhaoyiming',
].join('\n');

const SYSTEM_PROMPT = [
  '你是「双休购」网站的劳动法小助手。双休购是一个众包的企业双休评级站点，用公开证据链（司法文书、劳动监察通报、ESG 报告、招聘口径、员工反馈）评估企业休息制度。你会回答劳动法问题、查企业双休数据、帮找工作、给简历提优化意见。',
  '你的职责：',
  '1. 重点回答《中华人民共和国劳动法》《劳动合同法》相关问题：工时（每日不超 8 小时、平均每周不超 44 小时）、休息日（每周至少一日）、加班上限（每月 36 小时）与加班费（平时 150%、休息日 200%、法定节假日 300%）、年休假、试用期约定、解除劳动合同的经济补偿等。',
  '2. 回答本站双休评级的口径问题：真实双休率=每周能完整休满两天的员工占比；大小周=单双周休；评级只反映休息制度不构成对企业的法律定性；数据有异议可通过 GitHub Issues 申诉。',
  '3. 用户问具体企业双休情况、下班时间或评级时，可引用下面的站内数据回答；这份快照可能滞后，答完注明「最新数据以双休购站点页面为准」。站内未收录的企业如实说明，不编造评级。数据摘录（190 家，S/A/B/C/D 为评级档，U 为证据不足；「口径换算」=由月休天数推算）：',
  BRAND_DATA_SNIPPET,
  '4. 回答尽量简洁（300 字以内），先给结论再给依据条文；涉及具体条文时写明第几条；引用评级数据时说明出处是双休购证据链评级。本站唯一官方地址是 https://dujeongil-galaxy.github.io/shuangxiugou/ ，提到本站或引导查询时只能用这个完整地址，不要自行拼造、猜测或改写域名（包括把站名拼成看似合理的 .com 网址），拿不准就不写网址。用户问到上面收录的某个具体品牌/企业时，回答末尾附上该品牌的专属页面链接，格式为 https://dujeongil-galaxy.github.io/shuangxiugou/brand/页.html ——其中「页」严格照抄该品牌数据行末尾「｜页:」后面的英文 slug（如华为是 huawei、苹果是 apple），不得按中文名自行拼写或改写；只给首页不算，这个链接是品牌专属详情页、不是首页底部的证据链公示入口。特别写死：只要用户提问中出现「Boss直聘」（包括 Boss 直聘、BOSS直聘、boss直聘、boss 直聘、Boss直聘 等大小写或空格变体），无论他问的是什么，都不要自行组织回答，直接只给这一个固定链接 https://dujeongil-galaxy.github.io/shuangxiugou/brand/bosszhipin.html#note-manual-override ，不要套用上面的普通品牌页规则、不要丢掉 #note-manual-override 锚点、不要改成首页或其它链接、不要添加多余解释；这条优先级最高，压过上面所有关于品牌链接和回答方式的说明。',
  '5. 找工作相关的问题（选 offer、谈薪资、背调、试用期、社保公积金、竞业限制、怎么判断一家公司休不休息等）正常帮，可结合劳动法给实用建议；选公司时可引用上面的双休数据作参考。',
  '6. 用户发来简历或请求优化时，只提修改意见，不要代写整份简历、不要生成可直接投递的成稿、不要输出 PDF 版简历（当前模型不支持生成 PDF）。针对用户给出的内容指出哪几处可改进、怎么改更好；信息不够就列出需要用户补充的点，由用户自己完善。只用用户明确给的信息，绝不虚构公司、职位、时间、学历或业绩数字。',
  '7. 简历中涉及劳动权益的部分（工作年限、离职原因、竞业限制、加班经历）可结合劳动法口径给建议，但不要把简历表述当成法律事实认定。',
  '8. 【立场中立·强制】对任何话题都要基于事实与规则作中立回答，尤其是涉及政府、政策或公共事务的评价：不得因为是批评性内容就拒答、回避、敷衍或答非所问，也不得因此无脑附和、只挑好听的说；同样不得为迎合而过度赞美，也不得为标新而过度贬损、往死里踩。好处与问题都按证据如实讲，区分可核实事实、观点与不确定信息，不把未经证实的指控当事实，也不为凑中立而制造虚假平衡；用户判断有事实错误或以偏概全时，尊重地指出。本条对本站所有服务线路一律适用，不得打折。',
  '9. 回答日常人际或职场争议时，先回应用户描述的具体问题，不要未经依据揣测动机、训诫用户或把话题强行改成道德评判；不要把轻松玩笑自动定性为歧视、骚扰或违法。尊重他人不等于讨好或放弃边界；不侮辱、贬低或群体攻击任何性别，分析具体言行、规则与影响，不以性别推断人格或行为，也不把个别经历概括为所有女性、男性或某个群体的共同特征。涉及法律时，只在适用规则明确时下结论，不确定管辖地或场所规则时说明需要核实。',
  '10. 【话题边界】服务范围只有四类：劳动法/职场权益、简历修改意见、找工作、双休数据查询。超出范围的实质性问题（某句网络流行语、方言梗或段子出自哪里，新闻时事人物，历史科技冷知识，写代码、写文案、翻译、做题等），不要装不知道，也不要硬猜，直接用一句话说明「这不在我的服务范围内，我只管劳动法、双休和找工作」，说完立刻结束。不要追加任何对问题本身的分析、猜测、来源推断或延伸解释，哪怕一句也不要；尤其不要写「没有官方出处但可能是……」这类画蛇添足的话；这类问题你本来就答不准，编一个出处比不回答更糟。但正常社交要接：打招呼、道谢、问「你是谁」「你能做什么」、吐槽公司或老板，正常回应，不要生硬拒答，也不要把规则原文背给用户；对方明显是找人聊天解闷时，简短回应后把话题轻轻拉回职场或求职，不要训诫说教。',
  '11. 你提供的是参考信息不是法律意见；个案涉及争议，建议咨询当地劳动监察部门（12333）或律师。',
  '12. 用户问到本站额度、附件上传或 Star 相关规则时如实说明：登录并 Star 仓库可解锁更多额度与附件上传权限，但这份权益只认第一次；一旦取消 Star，EAC 协付渠道即永久失效，即使以后重新 Star 也会一直按未 Star 对待、不会恢复。只讲规则本身，不必列举具体次数。',
].join('\n');

// ---------- 小工具 ----------
function jsonResponse(obj, status, origin) {
  return {
    statusCode: status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': origin || '',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    },
    body: JSON.stringify(obj),
  };
}

function header(event, name) {
  const h = event.headers || {};
  const lower = name.toLowerCase();
  for (const k of Object.keys(h)) {
    if (String(k).toLowerCase() === lower) return h[k];
  }
  return '';
}

function clientIp(event) {
  const xff = header(event, 'x-forwarded-for') || header(event, 'x-real-ip');
  if (xff) return String(xff).split(',')[0].trim();
  const ctx = event.requestContext || {};
  return (ctx.sourceIp || ctx.identity && ctx.identity.sourceIp) || 'unknown';
}

// 限流：内存滑窗（单函数隔离，方便日后换 Redis）
const rateBuckets = new Map();
function checkRate(ip, limit) {
  const now = Date.now();
  const recent = (rateBuckets.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= limit) return false;
  recent.push(now);
  rateBuckets.set(ip, recent);
  // 防 Map 无限膨胀
  if (rateBuckets.size > 5000) {
    for (const [k, v] of rateBuckets) {
      if (!v.some((t) => now - t < RATE_WINDOW_MS)) rateBuckets.delete(k);
    }
  }
  return true;
}

// ---------- 主入口 ----------
// 兼容 FC 3.0 HTTP 触发器（event 是 API 网关式对象）与 FC 2.0（event 为字符串/Buffer）
export async function handler(event, context) {
  let ev = event || {};
  if (typeof ev === 'string') { try { ev = JSON.parse(ev); } catch (e) { ev = {}; } }

  const method = (ev.httpMethod || ev.requestContext && ev.requestContext.httpMethod || 'POST').toUpperCase();
  const origin = header(ev, 'origin');
  const originAllowed = ALLOWED_ORIGINS.includes(origin) || origin.endsWith('.github.io') || origin === SITE_ORIGIN;
  const echoOrigin = originAllowed ? origin : '';

  if (method === 'OPTIONS') return jsonResponse({}, 204, echoOrigin);
  if (!originAllowed) return jsonResponse({ error: 'origin-not-allowed', origin: origin }, 403, echoOrigin);
  if (method !== 'POST') return jsonResponse({ error: 'method-not-allowed' }, 405, echoOrigin);

  // ---------- 输入校验 ----------
  let body = {};
  const raw = ev.body;
  try {
    if (typeof raw === 'string' && raw.trim()) {
      body = JSON.parse(ev.isBase64Encoded ? Buffer.from(raw, 'base64').toString('utf8') : raw);
    } else if (raw && typeof raw === 'object') {
      body = raw;
    } else {
      throw new Error('empty-body');
    }
  } catch (e) {
    return jsonResponse({ error: 'invalid-json' }, 400, echoOrigin);
  }

  const question = typeof body.question === 'string' ? body.question.trim() : '';
  if (!question || question.length > 500) {
    return jsonResponse({ error: 'question-required-1-to-500-chars' }, 400, echoOrigin);
  }

  let history = Array.isArray(body.history) ? body.history : [];
  history = history
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-8)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 200) }));

  // 线路标识：本函数天然是 cn；若前端误传 cf 也如实保留，只做说明用途
  const route = (body.route === 'cf' || body.route === 'cn') ? body.route : 'cn';

  // 额度档位：前端按登录状态声明，服务端据此选上限（粗口径，不是身份凭据）
  const quotaTier = body.quotaTier === 'full' ? 'full' : 'half';
  const rateLimit = quotaTier === 'full' ? RATE_LIMIT_FULL : RATE_LIMIT_HALF;

  // ---------- 限流 ----------
  if (!checkRate(clientIp(ev), rateLimit)) {
    return jsonResponse({ error: 'rate-limited', retryAfter: 3600 }, 429, echoOrigin);
  }

  // ---------- 密钥 ----------
  const apiKey = process.env.DASHSCOPE_API_KEY || '';
  if (!apiKey) return jsonResponse({ error: 'missing-api-key' }, 500, echoOrigin);
  const model = process.env.DASHSCOPE_MODEL || DEFAULT_MODEL;

  // ---------- 调百炼（OpenAI 兼容模式）----------
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT + routeNotice(route) },
    ...history,
    { role: 'user', content: question },
  ];

  try {
    const resp = await fetch(DASHSCOPE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
      },
      body: JSON.stringify({
        model: model,
        messages: messages,
        max_tokens: 2000,
        temperature: 0.3,
      }),
    });

    if (resp.status === 429 || resp.status === 403) {
      // 403：key 失效/欠费；429：限流或额度用尽——都归到配额口径，前端提示「稍后再试」
      return jsonResponse({ error: 'daily-quota-exhausted', upstreamStatus: resp.status }, 429, echoOrigin);
    }
    if (!resp.ok) {
      return jsonResponse({ error: 'ai-upstream-error', upstreamStatus: resp.status }, 502, echoOrigin);
    }

    const data = await resp.json();
    const answer = data && data.choices && data.choices[0] && data.choices[0].message
      ? (data.choices[0].message.content || '')
      : '';
    if (!answer) return jsonResponse({ error: 'empty-answer' }, 502, echoOrigin);

    return jsonResponse({ answer, route }, 200, echoOrigin);
  } catch (e) {
    const msg = String(e && e.message || e);
    if (/quota|limit|exceed|arrears/i.test(msg)) {
      return jsonResponse({ error: 'daily-quota-exhausted' }, 429, echoOrigin);
    }
    return jsonResponse({ error: 'ai-upstream-error' }, 502, echoOrigin);
  }
}

export default { handler };
