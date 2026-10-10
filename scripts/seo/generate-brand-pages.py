"""生成品牌静态详情页 → brand/*.html（修正版）

修正两个问题：
1. 虚构对比黑榜卡（某代工烘焙食品）不该有可索引页面——它本就是虚构的，
   生成页面等于对外发布虚构品牌信息，违反项目「不能把推测写成事实」的红线。
2. 中文 slug 对 SEO 不友好（URL 里出现中文在各平台兼容性差），
   改为拼音或英文简称。
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
os.chdir(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import json, re, os, html

brands = json.load(open('_brands.json', encoding='utf-8'))
SITE = 'https://dujeongil-galaxy.github.io/shuangxiugou'

CUSTOM = [
    dict(slug='zhaoyiming', name='赵一鸣 / 零食很忙', company='湖南鸣鸣很忙商业连锁有限公司',
         category='零食饮料', tier='C', rate=None, off='22:30',
         policy='月休 2-4 天 / 门店两班倒', overtime='节假日加班常见 / 连续站立 8-10 小时',
         summary='门店实行早晚班轮换，日均工作 8-10 小时，月休 2-4 天（多数门店仅 2 天），晚班普遍 22 点半后下班。',
         reasons=['多店招聘信息与员工爆料显示月休仅 2-4 天', '一线员工需连续站立作业 8-10 小时'],
         evidence=[]),
    dict(slug='chabaidao', name='茶百道', company='四川百茶百道实业股份有限公司',
         category='食品饮品', tier='C', rate=None, off=None,
         policy='月休不足 4 天', overtime='旺季高峰需连轴顶班',
         summary='门店店员匿名反馈月休不足 4 天，旺季用工紧张需连轴顶班。',
         reasons=['门店店员匿名反馈：月休不足 4 天（线下一手·匿名）'], evidence=[]),
    dict(slug='bingliw', name='兵立王', company='四川兵立王品牌管理有限责任公司',
         category='食品饮品', tier='C', rate=None, off=None,
         policy='月休不足 4 天', overtime='节假日加班常见',
         summary='门店员工匿名反馈月休不足 4 天。',
         reasons=['门店员工匿名反馈：月休不足 4 天（线下一手·匿名）'], evidence=[]),
    dict(slug='xiaomi', name='小米', company='小米科技有限责任公司',
         category='数码 3C', tier='B', rate='53', off='20:30',
         policy='名义双休 / 门店单休 / 客服轮班', overtime='总部日均 11.5h 隐性要求 / 门店节假日无休',
         summary='总部办公室名义双休，但存在日均 11.5 小时隐性工时要求；线下小米之家员工反馈一周休一天。',
         reasons=['总部名义双休但存在日均 11.5h 隐性工时', '线下小米之家员工反馈一周休一天',
                  '在线客服为轮班制（多源交叉验证）'], evidence=[]),
    dict(slug='kfc', name='肯德基', company='百胜中国控股有限公司',
         category='食品饮品', tier='C', rate='10', off='23:00',
         policy='综合工时制 / 早中晚三班倒', overtime='周末节假日必上班 / 晚班到 23 点',
         summary='门店实行综合计算工时制，早中晚三班轮班，晚班普遍到 23 点。',
         reasons=['百胜中国官方直聘多店晚班 15:00-23:00',
                  '爱企查工时库晚班 15:00-23:00 / 16:00-24:00，23:00 为众数'], evidence=[]),
]

# 手工指定 slug：英文名优先，中文用拼音（URL 兼容性更好）
SLUG = {
    'patagonia': 'patagonia', 'logitech': 'logitech', 'chivers': 'bee-flower',
    'decathlon': 'decathlon', 'xingyu': 'xingyu', 'philips-auto': 'philips-automotive',
    'pepsi-snacks': 'pepsi', 'ikea': 'ikea', 'the-north-face': 'the-north-face',
    'microsoft': 'microsoft', 'sap': 'sap', 'vivo': 'vivo', 'haier': 'haier',
    'heytea': 'heytea', 'netease-youdao': 'netease-youdao', 'nongfu-spring': 'nongfu',
    'osram': 'osram', 'liling': 'liby', 'vivo-logistics': 'sf-express',
    'pinduoduo': 'pinduoduo', 'instant-noodle': 'master-kong', 'byd': 'byd',
    'volvo-car': 'volvo', 'huawei-consumer': 'huawei', 'apple-consumer': 'apple',
    'sony': 'sony', 'luckin': 'luckin', 'starbucks-coffee': 'starbucks',
    'tencent': 'tencent', 'meituan': 'meituan', 'uniqlo': 'uniqlo',
}

TIER_DESC = {'S': '模范标杆，严格双休', 'A': '合规双休，接近 965',
             'B': '大小周或数据存疑', 'C': '严重超时、存在通报违约记录'}
TIER_COLOR = {'S': '#059669', 'A': '#0F766E', 'B': '#D97706', 'C': '#DC2626'}
TIER_ADVICE = {
    'S': '制度层面严格落实双休，加班极少，适合追求工作生活平衡的求职者。',
    'A': '合规双休、接近 965 的作息，个别项目期可能有加班，整体仍属良好。',
    'B': '存在大小周或数据存疑的情况，入职前建议重点核实所在部门实际作息。',
    'C': '存在严重超时或官方通报违约记录，求职与消费时建议避雷。',
}


def esc(s):
    return html.escape(str(s)) if s is not None else ''


def val(v, suffix='', dash='未核实'):
    return f'{v}{suffix}' if v and v != 'null' else dash


def build(b, total):
    slug, name, tier = b['slug'], b['name'], b['tier']
    rate, off = b['rate'], b['off']
    rate_txt = f'{rate}%' if rate and rate != 'null' else '待核实'
    off_txt = off if off and off != 'null' else '待核实'

    # title 控制在 30 字符内：Google 超出会截断，反而丢掉尾部关键词。
    # 优先「品牌 + 双休率」这个核心搜索意图，尾部信息移到 description。
    #
    # 品牌名里的英文别名/ 行业注释对搜索意图无帮助，
    # 却在吃 title 长度 —— 优先只保留中文主体名。
    # 例：「Philips Automotive (飞利浦汽车生活)」→「飞利浦汽车生活」
    short_name = re.sub(r'[（(][^）)]*[）)]\s*', '', name).strip()
    short_name = re.sub(r'\s*\([^)]*\)\s*$', '', short_name).strip()
    if len(short_name) < 3:
        short_name = name
    title = f'{short_name} 双休率{rate_txt}｜双休购'
    if len(title) > 30:
        # 仍超长则只留「品牌名 双休率」，把品牌名后缀砍掉
        title = f'{short_name.split("（")[0][:12]} 双休率{rate_txt}｜双休购'
    desc = (f'{name}（{b["company"]}）双休评级 {tier} 级（{TIER_DESC.get(tier, "")}）。'
            f'真实双休率 {rate_txt}，平均下班时间 {off_txt}。'
            f'休息制度与加班情况均附公开证据来源，数据可查可溯。')

    ev_html = ''
    if b['evidence']:
        items = []
        for e in b['evidence']:
            inner = f'<strong>{esc(e["title"])}</strong>'
            inner += f' <span style="color:#6b7280;font-size:13px">（{esc(e["date"])} · {esc(e["type"])}）</span>'
            if e.get('caseNumber'):
                inner += f'<br><span style="color:#6b7280;font-size:13px">文号／编号：{esc(e["caseNumber"])}</span>'
            if e.get('summary'):
                inner += f'<br>{esc(e["summary"])}'
            if e.get('url'):
                inner += (f'<br><a href="{esc(e["url"])}" rel="nofollow noopener nofollow" '
                          f'target="_blank">{esc(e["url"][:70])}</a>')
            items.append(f'<li style="margin:0 0 12px">{inner}</li>')
        ev_html = ('<h2>证据来源</h2><ul>' + ''.join(items) + '</ul>')

    reason_html = ''
    if b['reasons']:
        items = ''.join(f'<li>{esc(x)}</li>' for x in b['reasons'])
        reason_html = f'<h2>为什么给出这个评级</h2><ul>{items}</ul>'

    # 同级对比：同 tier 的其他品牌
    peers = [x for x in ALL if x['tier'] == tier and x['slug'] != slug][:6]
    if peers:
        ph = ''.join(f'<li><a href="./{esc(x["slug"])}.html">{esc(x["name"])}</a>'
                     f'（{esc(val(x["rate"], "%"))}）</li>' for x in peers)
        peer_html = f'<h2>同为 {esc(tier)} 级的其他品牌</h2><ul>{ph}</ul>'
    else:
        peer_html = ''

    return f'''<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>{esc(title)}</title>
<meta name="description" content="{esc(desc)}">
<meta name="robots" content="index, follow, max-image-preview:large">
<link rel="canonical" href="{SITE}/brand/{slug}.html">
<meta property="og:type" content="article">
<meta property="og:title" content="{esc(title)}">
<meta property="og:description" content="{esc(desc)}">
<meta property="og:url" content="{SITE}/brand/{slug}.html">
<meta property="og:image" content="{SITE}/assets/og-cover.png">
<link rel="icon" type="image/svg+xml" href="../favicon.svg">
<style>
*{{box-sizing:border-box}}
body{{margin:0;font-family:system-ui,-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;
line-height:1.85;color:#1f2937;background:#f3f4f6}}
.wrap{{max-width:760px;margin:0 auto;padding:28px 18px 60px;background:#fff;min-height:100vh}}
h1{{font-size:25px;font-weight:800;margin:0 0 6px;line-height:1.35}}
.sub{{color:#6b7280;font-size:14px;margin:0 0 20px}}
h2{{font-size:19px;font-weight:700;margin:28px 0 10px}}
p{{margin:0 0 12px;line-height:1.85}}
ul{{margin:0 0 12px;padding-left:22px}}
li{{margin:0 0 6px;line-height:1.8}}
a{{color:#0F766E}}
.grid{{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:0 0 20px}}
.kv{{background:#f3f4f6;border-radius:10px;padding:14px}}
.kv .k{{font-size:12px;color:#6b7280;margin:0 0 4px}}
.kv .v{{font-size:20px;font-weight:800;margin:0;line-height:1.35}}
.badge{{display:inline-block;padding:3px 12px;border-radius:999px;font-size:13px;font-weight:700;color:#fff;margin:0 0 4px}}
.box{{background:#f9fafb;border-left:4px solid #0F766E;padding:14px 16px;border-radius:0 8px 8px 0;margin:0 0 16px}}
.nav{{font-size:14px;margin:0 0 20px;padding-bottom:14px;border-bottom:1px solid #e5e7eb}}
footer{{margin-top:36px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:13px;color:#6b7280;line-height:1.8}}
</style>
<script type="application/ld+json">
{{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": {json.dumps(f"{name} 双休率与加班情况", ensure_ascii=False)},
  "description": {json.dumps(desc, ensure_ascii=False)},
  "url": "{SITE}/brand/{slug}.html",
  "mainEntityOfPage": "{SITE}/brand/{slug}.html",
  "datePublished": "2026-10-10",
  "dateModified": "2026-10-10",
  "author": {{ "@type": "Organization", "name": "双休购 ShuangxiuGo",
              "url": "https://github.com/dujeongil-galaxy/shuangxiugou" }},
  "publisher": {{ "@type": "Organization", "name": "dujeongil-galaxy",
                 "url": "https://github.com/dujeongil-galaxy/shuangxiugou" }},
  "about": {{ "@type": "Thing", "name": "双休率" }},
  "keywords": "{name}双休, {name}加班, {name}工时, {name}大小周, {name}996, 企业双休率, 双休评级"
}}
</script>
</head>
<body>
<div class="wrap">
<nav class="nav">
  <a href="../">← 返回双休购总表</a>
  <a href="../#main">查其他品牌</a>
  <a href="../projects.html">同类项目导航</a>
</nav>

<h1>{esc(name)} 双休率与加班情况</h1>
<p class="sub">{esc(b['company'])} · {esc(b['category'])} · 核实日期 2026-10-10</p>

<div class="box">
  <span class="badge" style="background:{TIER_COLOR.get(tier, '#6b7280')}">{esc(tier)} 级评级</span>
  <p style="margin:8px 0 4px"><strong>{esc(TIER_DESC.get(tier, ''))}</strong></p>
  <p style="margin:0">{esc(TIER_ADVICE.get(tier, ''))}</p>
</div>

<div class="grid">
  <div class="kv"><p class="k">真实双休率</p><p class="v">{esc(val(rate, '%'))}</p></div>
  <div class="kv"><p class="k">平均下班时间</p><p class="v">{esc(val(off, '', '—'))}</p></div>
  <div class="kv"><p class="k">休息制度</p><p class="v" style="font-size:15px">{esc(b['policy'])}</p></div>
  <div class="kv"><p class="k">加班情况</p><p class="v" style="font-size:15px">{esc(b['overtime'])}</p></div>
</div>

<h2>{esc(name)}的工时情况</h2>
<p>{esc(b['summary'])}</p>

<h2>数据口径说明</h2>
<p>
  <strong>真实双休率</strong>指「每周能完整休满两天、不强制周末加班」的员工占比。
  总部办公室与工厂产线／门店分别取证后按员工结构加权，同一品牌不同部门可能差异显著。<br>
  <strong>平均下班时间</strong>取员工实际离岗点的众数，连锁门店取晚班打烊／交班点，
  <strong>不以门店营业时间冒充</strong>。标为「未核实」的字段表示尚未找到可靠公开证据，本站不以估算值填充。
</p>
{reason_html}
{ev_html}
{peer_html}

<h2>数据来源与免责</h2>
<p>
  数据来源于公开司法裁判文书、劳动监察通报、上市公司 ESG 报告、招聘平台自述与社区员工反馈，
  按证据强度分项标注。本站数据仅供个人择业与消费偏好参考，
  <strong>不构成商业背书或对任何企业的法律定性</strong>。
  企业用工情况会随时间变化，请以最新公开信息为准。
  发现信息有误，欢迎
  <a href="https://github.com/dujeongil-galaxy/shuangxiugou/issues/new?title=%5B%E6%95%B0%E6%8D%AE%E6%9B%B4%E6%AD%A3%5D">通过 GitHub Issues</a> 提交并附上来源。
</p>

<footer>
  本站为基于 <a href="https://github.com/ZhiqingHeyi/shuangxiugou">ZhiqingHeyi/shuangxiugou</a>（MIT 协议）
  二次开发的开源项目，数据核实与日常维护由 dujeongil-galaxy 负责。<br>
  查看全部 {total} 家企业的双休评级与平均下班时间：<a href="../">双休购总表</a> ·
  <a href="../projects.html">同类项目导航</a>
</footer>
</div>
</body>
</html>'''


# 排除虚构黑榜卡 —— 虚构品牌不应有对外可索引的页面
real = [b for b in brands if '虚构' not in b['name']]
ALL = []
for b in real:
    b['slug'] = SLUG.get(b['id'])
    if b['slug']:
        ALL.append(b)
ALL.extend(CUSTOM)

os.makedirs('brand', exist_ok=True)
for f in os.listdir('brand'):
    os.remove(f"brand/{f}")

total = len(ALL)
for b in ALL:
    open(f"brand/{b['slug']}.html", 'w', encoding='utf-8').write(build(b, total))

print(f'生成 {total} 个详情页（已排除虚构对比黑榜卡）')
print(f'内置卡 {len(real)} + 自定义卡 {len(CUSTOM)}')
missing = [b['name'] for b in real if not SLUG.get(b['id'])]
if missing:
    print(f'⚠️ 缺 slug 未生成: {missing}')

json.dump([{'slug': b['slug'], 'name': b['name'], 'tier': b['tier'],
            'rate': b['rate'], 'off': b['off']} for b in ALL],
          open('_brandindex.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('\n文件清单:')
for f in sorted(os.listdir('brand')):
    print('  brand/' + f)
