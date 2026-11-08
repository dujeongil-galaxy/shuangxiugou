#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
import-brands.py —— 把「双休公司推荐名单 2026」榜单里的品牌批量落进本站数据链

上游：data/imported-brands.json（人工从榜单抄录 + 关键品牌补充公开来源）
下游：一次生成五处，缺一处就会被 verify 判红：

  1. brand/<slug>.html        详情页（含证据来源，供 gen-evidence-board.py 解析）
  2. index.html               自定义卡配置（clone 模板渲染）+ <noscript> 爬虫清单
  3. projects.html            同类项目导航页的品牌索引
  4. sitemap.xml              重建全部 /brand/ 条目（保留非品牌页）
  5. （另跑）gen-evidence-board.py / gen-pinyin-index.py

幂等：所有插入点都带 START/END 注释锚点，重复执行只替换锚点之间，
不会越插越多。行尾按各文件原样保留（仓库 .gitattributes 锁 LF，
mobile-fixes.css 等少数文件是 CRLF）。

用法（2026-11-08 起）：
    python -X utf8 scripts/import-brands.py --only <slug>   # 增量新增，唯一允许的方式
    python -X utf8 scripts/import-brands.py                 # 全量重建，已被 guard_full_rebuild 拒绝

为什么不能全量重跑：导入之后 brand/ 详情页又人工补了招聘证据与 data-evchain
证据链区块，index.html 的卡片补了 logo、并把 insertAfter 锚点从有 bug 的
'nongfu' 修成 '茶百道'；模板里没有这些后续成果，全量重跑会把它们一起抹掉。
详见 guard_full_rebuild() 与 incremental()。
"""
import json
import os
import re
import sys
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)

DATA = 'data/imported-brands.json'
SRC_URL = 'https://interviewasssistant.com/zh/blog/company-work-schedule-2026'
SRC_TITLE = '双休公司推荐名单 2026（270+ 家持续更新）· 即答侠编辑部（HireMe AI）'
SRC_DATE = '2026-07-11'

GRADE_COLOR = {'S': '#7c3aed', 'A': '#0f766e', 'B': '#b45309', 'C': '#be123c'}
GRADE_DESC = {'S': '模范标杆，严格双休', 'A': '合规双休，接近 965',
              'B': '大小周或双休不稳', 'C': '月休不足 6 天或严重超时'}
GRADE_ADVICE = {
    'S': '制度层面严格落实双休，加班极少。',
    'A': '按榜单口径为双休／职能岗双休，个别部门项目期可能加班。',
    'B': '存在大小周或「纸面双休」情况，入职前建议核实所在部门真实作息。',
    'C': '按榜单口径为单休／月休不足 6 天／严重超时，求职与消费时建议谨慎。',
}

EVID_KIND = '公开汇总（二手，未抓原文）'   # → gen-evidence-board 归到「旁证/二手汇总」


def esc(s):
    return (s or '').replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('"', '&quot;')


def jsq(s):
    """单引号 JS 字符串转义"""
    return (s or '').replace('\\', '\\\\').replace("'", "\\'")


def read_text(path):
    with open(path, 'rb') as fh:
        raw = fh.read()
    crlf = b'\r\n' in raw
    text = raw.decode('utf-8').replace('\r\n', '\n')
    return text, crlf


def write_text(path, text, crlf):
    if crlf:
        text = text.replace('\n', '\r\n')
    with open(path, 'wb') as fh:
        fh.write(text.encode('utf-8'))


def splice(text, start_mark, end_mark, payload):
    """把 payload 放到 START/END 锚点之间；锚点不存在则报错（由调用方保证先插入）"""
    i = text.find(start_mark)
    j = text.find(end_mark)
    if i < 0 or j < 0 or j < i:
        return None
    return text[:i + len(start_mark)] + payload + text[j:]


def ensure_comma_before(text, marker):
    """确保 marker 之前最后一个有效字符是逗号（跳过空行与 // 注释行）。

    数组元素之间少一个逗号就会整段 SyntaxError：真浏览器里首页直接白屏，
    jsdom 只报 "Unexpected token '{'"，从报错位置根本看不出是逗号。
    2026-11-02 批量导入时就踩了这一下，所以做成幂等的机械补齐。
    """
    i = text.find(marker)
    if i < 0:
        return text
    k = len(text[:i].rstrip())
    while True:
        line_start = text.rfind('\n', 0, k) + 1
        if text[line_start:k].strip().startswith('//'):
            k = len(text[:line_start].rstrip())
            continue
        break
    if k == 0:
        return text
    if text[k - 1] == ',':
        return text
    if text[k - 1] == '}':
        return text[:k] + ',' + text[k:]
    return text


# ---------------------------------------------------------------- 详情页
PAGE = '''<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>{name} 几点下班 双休吗 月休几天｜双休购</title>
<meta name="description" content="{desc}">
<meta name="robots" content="index, follow, max-image-preview:large">
<link rel="canonical" href="https://dujeongil-galaxy.github.io/shuangxiugou/brand/{slug}.html">
<meta property="og:type" content="article">
<meta property="og:title" content="{name} 几点下班 双休吗 月休几天｜双休购">
<meta property="og:description" content="{desc}">
<meta property="og:url" content="https://dujeongil-galaxy.github.io/shuangxiugou/brand/{slug}.html">
<meta property="og:image" content="https://dujeongil-galaxy.github.io/shuangxiugou/assets/og-cover.png">
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
  "headline": "{name} 双休率与加班情况",
  "description": "{desc}",
  "url": "https://dujeongil-galaxy.github.io/shuangxiugou/brand/{slug}.html",
  "mainEntityOfPage": "https://dujeongil-galaxy.github.io/shuangxiugou/brand/{slug}.html",
  "datePublished": "2026-11-02",
  "dateModified": "2026-11-02",
  "author": {{ "@type": "Organization", "name": "双休购 ShuangxiuGo",
              "url": "https://github.com/dujeongil-galaxy/shuangxiugou" }},
  "publisher": {{ "@type": "Organization", "name": "dujeongil-galaxy",
                 "url": "https://github.com/dujeongil-galaxy/shuangxiugou" }},
  "about": {{ "@type": "Thing", "name": "双休率" }},
  "keywords": "{name}双休, {name}加班, {name}工时, {name}大小周, 企业双休率, 双休评级"
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

<h1>{name} 几点下班与加班情况</h1>
<p class="sub">{name} · {category} · 榜单口径导入 2026-11-02</p>

<div class="box">
  <span class="badge" style="background:{color}">{grade} 级评级</span>
  <p style="margin:8px 0 4px"><strong>{grade_desc}</strong></p>
  <p style="margin:0">{advice}</p>
</div>

<div class="grid">
  <div class="kv"><p class="k">真实双休率</p><p class="v">未核实</p></div>
  <div class="kv"><p class="k">平均下班时间</p><p class="v">—</p></div>
  <div class="kv"><p class="k">休息制度</p><p class="v" style="font-size:15px">{policy}</p></div>
  <div class="kv"><p class="k">加班情况</p><p class="v" style="font-size:15px">{overtime}</p></div>
</div>

<h2>{name}的工时情况</h2>
<p>{quote}</p>
<p>代表产品／业务：{products}。</p>

<h2>数据口径说明</h2>
<p>
  本页评级来自<strong>榜单口径</strong>，不是本站实测：上游榜单由编辑部汇总
  官方通知、媒体报道与脉脉／小红书／知乎／牛客等社区反馈整理而成，其自身声明
  「绝大多数员工反馈类信息可信度为中／低，仅供参考」。本站据此按<strong>月休天数口径</strong>
  换算档位（A = 月休 8 天以上；B = 月休 6–8 天；C = 月休不足 6 天或严重超时），
  <strong>未对工资、工时做独立实测</strong>。<br>
  「真实双休率」一律留空为<strong>未核实</strong>——榜单没有给出比例，
  本站不以估算值填充（估算会变成别人引用时的「事实」）。
  同一家公司总部职能岗与一线生产／门店／销售岗作息可能天差地别，本页只反映榜单给出的
  大致印象，<strong>不构成对任何企业的法律定性或求职建议</strong>。
</p>

<h2>为什么给出这个评级</h2>
<ul>
{reasons}
</ul>

{trademark}
<h2>证据来源</h2>
<ul>
{evidence}
</ul>

<h2>同为 {grade} 级的其他品牌</h2>
<ul>
{peers}
</ul>

<h2>数据来源与免责</h2>
<p>
  本站数据来源于公开司法裁判文书、劳动监察通报、上市公司 ESG 报告、招聘平台自述与社区员工反馈，
  按证据强度分项标注。本页为<strong>榜单口径导入</strong>，证据强度归入「旁证／二手汇总」一档。
  本站数据仅供个人择业与消费偏好参考，
  <strong>不构成商业背书或对任何企业的法律定性</strong>。
  企业用工情况会随时间变化，请以最新公开信息为准。
  如对该页数据有异议，欢迎
  <a href="https://github.com/dujeongil-galaxy/shuangxiugou/issues">通过 GitHub Issues</a> 提交并附上可查证的来源（如司法文书、官方通报、公开报告）。核实后同步更新。
</p>

<footer>
  本站为基于 <a href="https://github.com/ZhiqingHeyi/shuangxiugou">ZhiqingHeyi/shuangxiugou</a>（MIT 协议）
  二次开发的开源项目，数据核实与日常维护由 dujeongil-galaxy 负责。<br>
  查看全部 {total} 家企业的双休评级与平均下班时间：<a href="../">双休购总表</a> ·
  <a href="../projects.html">同类项目导航</a>
</footer>
</div>
  <script src="../ai-config.js?v=1"></script>
  <script src="../ai-chat.js?v=18"></script>
</body>
</html>
'''


def build_page(b, total, peers):
    # 2026-11-08：站长新增「陆喜依」这类**非榜单来源**品牌 —— 它没有出现在
    # 即答侠榜单里，硬套 SRC_TITLE/SRC_URL 会在详情页写出一条并不存在的证据
    # （口说无凭，正是证据链公示要防的事）。这类品牌用 sourceOverride 自带
    # 一手来源；未带该字段的 104 张榜单卡输出逐字不变，保证幂等、零 diff。
    so = b.get('sourceOverride')
    if so:
        desc = ('%s 休息制度与加班情况：%s。%s。评级 %s 级（%s）。证据来源随页公示。'
                % (b['name'], b['policy'], b['overtime'], b['grade'], so['descNote']))
        reasons = '\n'.join('<li>%s</li>' % esc(x) for x in so['reasons'])
        evidence = (
            '<li style="margin:0 0 12px"><strong>%s</strong> '
            '<span style="color:#6b7280;font-size:13px">（%s · %s）</span><br>'
            '%s <a href="%s">原文</a></li>'
            % (esc(so['title']), so['date'], so['kind'], esc(so['summary']), so['url']))
    else:
        desc = ('%s 休息制度与加班情况：%s。%s。评级 %s 级（按本站月休口径换算，'
                '榜单口径导入，真实双休率未核实）。证据来源随页公示。'
                % (b['name'], b['policy'], b['overtime'], b['grade']))
        reasons = '\n'.join(
            '<li>%s</li>' % esc(x) for x in [
                '上游榜单原话：%s' % b['quote'],
                '按本站月休口径换算：%s → %s 级（%s）' % (b['policy'], b['grade'], GRADE_DESC[b['grade']]),
                '本站未对该品牌做独立实测，评级可能随新证据调整',
            ])
        evidence = (
            '<li style="margin:0 0 12px"><strong>%s</strong> '
            '<span style="color:#6b7280;font-size:13px">（%s · %s）</span><br>'
            '%s <a href="%s">原文</a></li>'
            % (esc(SRC_TITLE), SRC_DATE, EVID_KIND, esc(b['quote']), SRC_URL))
    for extra in b.get('extraEvidence', []):
        evidence += (
            '\n<li style="margin:0 0 12px"><strong>%s</strong> '
            '<span style="color:#6b7280;font-size:13px">（%s · %s）</span><br>'
            '%s <a href="%s">原文</a></li>'
            % (esc(extra['title']), extra['date'], extra['kind'],
               esc(extra['summary']), extra['url']))
    peer_html = '\n'.join(
        '<li><a href="./%s.html">%s</a></li>' % (p['slug'], esc(p['name'])) for p in peers)
    tm = b.get('trademark')
    trademark = '' if not tm else (
        '<h2 id="trademark-note">商标提示（™ / ®）</h2>\n'
        '<div class="box" style="border-left-color:#b45309">\n'
        '  <p style="margin:0 0 8px">看到「一桶半」「1 袋半」这类像是在说分量的大字，'
        '先看右上角那个小标：<strong>®</strong> 是已核准注册的商标，'
        '<strong>™</strong> 是「正在作为商标使用、但尚未注册成功」。两者都不是商品描述。'
        '（本条与作息评级无关，属消费提示。）</p>\n'
        '  <p style="margin:0 0 8px">本站核到的记录：%s。%s</p>\n'
        '  <p style="margin:0">国家知识产权局商标局已累计依职权宣告 <strong>1782 件</strong>'
        '「带有欺骗性的商标」无效（截至 2026-08-13，央视新闻报道）；'
        '官方名单可在商标局「心机商标」治理专栏查询，报道与举报入口见文末「证据来源」。</p>\n'
        '  <p style="margin:8px 0 0">▶ <a href="https://v.douyin.com/MRH7AWoBVyA/" '
        'target="_blank" rel="noopener noreferrer">前往抖音查看官方报道（教你识别心机商标）</a></p>\n'
        '</div>' % (esc(tm['marks']), esc(tm['status'])))
    page = PAGE.format(trademark=trademark,
        slug=b['slug'], name=esc(b['name']), desc=esc(desc), category=esc(b['category']),
        grade=b['grade'], color=GRADE_COLOR[b['grade']], grade_desc=GRADE_DESC[b['grade']],
        advice=GRADE_ADVICE[b['grade']], policy=esc(b['policy']), overtime=esc(b['overtime']),
        quote=esc(b['quote']), products=esc(b['products']),
        reasons=reasons, evidence=evidence, peers=peer_html, total=total)
    if so:
        page = apply_source_override(page, so, b['grade'])
    return page


def apply_source_override(page, so, grade):
    """非榜单来源品牌：模板里的「榜单口径导入」是假的，必须换成真实口径。

    采用**事后精确替换**而不是给模板加占位符 —— 默认（榜单）路径完全不走这里，
    既有 104 张页输出逐字不变；每个替换都 assert 命中，锚点失效立刻报错，
    不会静默留下不实表述。
    """
    def rep(old, new, label):
        nonlocal page
        assert old in page, 'sourceOverride 替换锚点失效：%s' % label
        page = page.replace(old, new, 1)

    rep('榜单口径导入 2026-11-02', so['subNote'], '副标题')

    m = re.search(r'<h2>数据口径说明</h2>\s*<p>[\s\S]*?</p>', page)
    assert m, 'sourceOverride 找不到「数据口径说明」段'
    page = page.replace(m.group(0),
                        '<h2>数据口径说明</h2>\n<p>%s</p>' % esc(so['scopeText']), 1)

    rep('本页为<strong>榜单口径导入</strong>，证据强度归入「旁证／二手汇总」一档。',
        esc(so['sourceNote']), '免责段来源说明')

    chain = '\n'.join('    <li><strong>%s</strong>：%s</li>' % (esc(k), esc(v))
                      for k, v in so['chain'])
    chain_html = ('<div class="box" id="evidence-chain" data-evchain="1" style="margin:14px 0">\n'
                  '  <p style="margin:0 0 8px"><strong>证据链（本页 %s 级判据的来源与缺口）</strong></p>\n'
                  '  <ol style="margin:0;padding-left:20px;font-size:14px;line-height:1.7">\n'
                  '%s\n  </ol>\n</div>\n\n' % (grade, chain))
    rep('<h2>证据来源</h2>', chain_html + '<h2>证据来源</h2>', '证据链插入点')
    return page


# ---------------------------------------------------------------- 卡片配置
def build_card(b, anchor):
    # 第三个标签不能用产品名：模板卡有 3 个标签位必须全部覆盖，
    # 但产品线（「理想 L 系列」「Magic 系列手机」）进索引后，输「xl」会命中
    # 一堆产品线（2026-11-02 导入时 test-pinyin-e2e 判红）。改用状态词。
    tags = [b['category'], b['name'], '待复核']
    # keywords 只放品牌名与品类：拼音联想是「跨品牌抢首位」的战场，
    # 把 slug（如 ymttc）和产品长串塞进去会让短查询（mt/hw/ping）命中一堆
    # 本该排在后面的卡，把主名命中的老品牌挤掉（2026-11-02 导入时实测踩到）。
    kws = [b['name'], b['category']]
    so = b.get('sourceOverride')
    # 2026-11-08：新增 S 级（站长指定「陆喜依」）。原 tip 字典只有 A/B/C，
    # 直接给 S 会 KeyError；颜色也只认 A 为绿，S 会误标成红。
    color = 'green' if b['grade'] in ('S', 'A') else 'red'
    tip = {'S': '✅ 公开双休制度 · 站长指定 S 级（员工实测待补）',
           'A': '✅ 榜单口径双休（待独立复核）',
           'B': '⚠️ 大小周 / 双休不稳',
           'C': '⚠️ 单休或严重超时'}[b['grade']]
    if so:
        desc = so['cardDesc']
        company = so.get('company', b['name'])
    else:
        desc = ('%s。榜单口径：%s；%s。代表产品／业务：%s。'
                '（来源：双休公司推荐名单 2026，媒体聚合口径，本站未独立实测；真实双休率未核实）'
                % (b['quote'], b['policy'], b['overtime'], b['products']))
        company = b['name'] + '（集团主体，未独立核实）'
    return '''        {
          id: '%s',
          name: '%s',
          company: '%s',
          logo: null,
          logoAlt: '%s',
          workPolicy: '%s',
          overtime: '%s',
          doubleRestRate: null,
          offWorkTime: null,
          voteCount: '0',
          desc: '%s',
          tags: [%s],
          likeCount: '0',
          dislikeCount: '0',
          recommendText: '%s',
          recommendColor: '%s',
          insertAfter: '%s',
          keywords: [%s],
          category: '%s',
          grade: '%s级'
        }''' % (
        b['slug'] + '-card', jsq(b['name']), jsq(company), jsq(b['name']),
        jsq(b['policy']), jsq(b['overtime']), jsq(desc),
        ', '.join("'%s'" % jsq(t) for t in tags),
        jsq(tip), color, jsq(anchor),
        ', '.join("'%s'" % jsq(k) for k in kws),
        jsq(b['category']), b['grade'])


def build_noscript_li(b):
    return ('          <li><strong><a href="./brand/%s.html">%s</a></strong>'
            '：%s 级 · 真实双休率 未核实 · 平均下班 —</li> '
            '<a href="./brand/%s.html" style="color:#0F766E">详细→</a>'
            % (b['slug'], esc(b['name']), b['grade'], b['slug']))


def build_project_li(b):
    return ('          <li><a href="./brand/%s.html">%s</a> —— %s 级 · '
            '双休率 未核实 · 平均下班 —</li>'
            % (b['slug'], esc(b['name']), b['grade']))


# ---------------------------------------------------------------- 主流程
CARDS_START = '        // ==IMPORTED-CARDS-START==\n'
CARDS_END = '        // ==IMPORTED-CARDS-END==\n'
NS_START = '<!-- IMPORTED-NOSCRIPT-START -->'
NS_END = '<!-- IMPORTED-NOSCRIPT-END -->'
PJ_START = '<!-- IMPORTED-PROJECTS-START -->'
PJ_END = '<!-- IMPORTED-PROJECTS-END -->'


def guard_full_rebuild():
    """2026-11-08：全量重建会把导入之后人工补进 brand/ 页的成果抹掉。

    实测踩到：brand/tongyi.html 里后补的两条招聘证据 + data-evchain 证据链区块
    被模板覆盖；index.html 卡片的 logo 从 ./assets/logo/*.svg 退回 null；
    修过 bug 的 insertAfter: '茶百道' 退回 'nongfu'（verify §21i 会判红）。
    所以全量模式一律拦下，新增品牌必须走 --only 增量。
    """
    probe = 'brand/tongyi.html'
    if os.path.exists(probe):
        text = open(probe, encoding='utf-8').read()
        if 'data-evchain' in text or '汇博招聘' in text:
            sys.exit('拒绝全量重建：brand/ 详情页含导入模板不会生成的补充证据／证据链区块，'
                     '重跑会连 logo 与 insertAfter 锚点一起回退。'
                     '新增单个品牌请用：python -X utf8 scripts/import-brands.py --only <slug>')


def incremental(only, brands, existing, total):
    """只把 --only 指定的品牌追加进五处；既有 104 张卡／页逐字不动。"""
    target = [b for b in brands if b['slug'] == only]
    if len(target) != 1:
        sys.exit('--only 指定的 slug 在数据集里必须恰好 1 条：%s' % only)
    b = target[0]
    slug = b['slug']

    # 同级互链从全量 brands 取，保证新页不是孤儿页
    peers = [p for p in brands if p['grade'] == b['grade'] and p['slug'] != slug][:5]
    if len(peers) < 3:
        peers += [p for p in brands if p['slug'] != slug and p not in peers][:3 - len(peers)]

    # 1. 详情页（只写这一页）
    with open('brand/%s.html' % slug, 'wb') as fh:
        fh.write(build_page(b, total, peers).encode('utf-8'))
    print('详情页：新增 brand/%s.html（共 %d 家）' % (slug, total))

    # 2. index.html：卡片 + noscript + 标题数字
    html, crlf_html = read_text('index.html')
    card_id = "id: '%s-card'" % slug
    bi = brands.index(b)
    prev = brands[bi - 1]['slug'] + '-card' if bi > 0 else 'nongfu'
    new_card = build_card(b, prev)
    if card_id in html:
        # 2026-11-08：原实现直接「跳过」，数据文件改了字段（如 company）却不会
        # 同步到页面，单一真相源就断了。改为重新生成该卡块，仍然幂等。
        pos = html.find(card_id)
        start = html.rfind('        {\n', 0, pos)
        end = html.find('\n        }', pos) + len('\n        }')
        assert start > 0 and end > start, '找不到已存在卡片的完整块'
        assert html.find(CARDS_START) < start < html.find(CARDS_END), '卡片不在导入锚点内'
        html = html[:start] + new_card + html[end:]
        print('index.html：重新生成已存在的卡片配置（数据变更同步）')
    else:
        i = html.find(CARDS_END)
        assert i > 0, '找不到 IMPORTED-CARDS-END 锚点'
        prefix = html[:i].rstrip('\n')
        assert prefix.rstrip().endswith('}'), '卡片块结尾不是 }，拒绝盲插'
        html = prefix + ',\n' + new_card + '\n' + html[i:]
    ns_i = html.find(NS_END)
    assert ns_i > 0, '找不到 IMPORTED-NOSCRIPT-END 锚点'
    ns_start = html.find(NS_START)
    if ('brand/%s.html' % slug) not in html[ns_start:ns_i]:
        html = html[:ns_i] + build_noscript_li(b) + '\n' + html[ns_i:]
    html = re.sub(r'全部品牌详细页（\d+ 个）',
                  '全部品牌详细页（%d 个）' % total, html)
    # 2026-11-08 补：noscript 里还有一处手写「（共 N 家）」标题，生成器原先
    # 只改「N 个」那处，导致 verify「全部共 N 家一致」判红（174 / 173 并存）。
    html = re.sub(r'已收录企业双休评级与平均下班时间（共 \d+ 家）',
                  '已收录企业双休评级与平均下班时间（共 %d 家）' % total, html)
    write_text('index.html', html, crlf_html)
    print('index.html：卡片 +1、noscript +1、标题 %d 个' % total)

    # 3. projects.html
    pj, crlf_pj = read_text('projects.html')
    pj_i = pj.find(PJ_END)
    assert pj_i > 0, '找不到 IMPORTED-PROJECTS-END 锚点'
    pj_start = pj.find(PJ_START)
    if ('brand/%s.html' % slug) not in pj[pj_start:pj_i]:
        pj = pj[:pj_i] + build_project_li(b) + '\n' + pj[pj_i:]
    pj = re.sub(r'本站收录的企业双休明细（\d+ 个品牌）',
                '本站收录的企业双休明细（%d 个品牌）' % total, pj)
    write_text('projects.html', pj, crlf_pj)
    print('projects.html：索引 +1、标题 %d 个品牌' % total)

    # 4. sitemap.xml：只追加，绝不重建（重建会把既有 lastmod 全刷成旧日期）
    sm = open('sitemap.xml', encoding='utf-8').read()
    if ('/brand/%s.html' % slug) not in sm:
        pr = '0.8' if b['grade'] in ('S', 'A') else '0.7'
        block = ('  <url>\n    <loc>https://dujeongil-galaxy.github.io/shuangxiugou/brand/%s.html</loc>\n'
                 '    <lastmod>2026-11-08</lastmod>\n    <changefreq>monthly</changefreq>\n'
                 '    <priority>%s</priority>\n  </url>\n' % (slug, pr))
        sm = sm.replace('</urlset>', block + '</urlset>')
        with open('sitemap.xml', 'wb') as fh:
            fh.write(sm.encode('utf-8'))
        print('sitemap.xml：追加 /brand/%s.html' % slug)


def main():
    data = json.load(open(DATA, encoding='utf-8'))
    brands = data['brands']
    if not brands:
        sys.exit('数据集为空')

    # --only 必须在 collide 检查之前分流：新增品牌的 slug 尚未有详情页，
    # 原 collide 逻辑会把「104 个已存在 + 1 个新增」误判成冲突并退出。
    if len(sys.argv) >= 3 and sys.argv[1] == '--only':
        all_pages = sorted(f[:-5] for f in os.listdir('brand') if f.endswith('.html'))
        slugs = {x['slug'] for x in brands}
        existing = [s for s in all_pages if s not in slugs]
        return incremental(sys.argv[2], brands, existing, len(existing) + len(brands))

    guard_full_rebuild()
    existing = sorted(f[:-5] for f in os.listdir('brand') if f.endswith('.html'))
    imported_slugs = {b['slug'] for b in brands}
    collide = imported_slugs & set(existing)
    if collide and len(collide) < len(imported_slugs):
        sys.exit('slug 与既有品牌页冲突：%s' % ', '.join(sorted(collide)))
    # 二次执行时 brand/ 里已经有本批次的页，必须排掉，否则总数会被重复累加
    existing = [s for s in existing if s not in imported_slugs]

    total = len(existing) + len(brands)

    # 同级品牌（用于互链，取前后各若干保证每人至少 3 条）
    by_grade = {}
    for b in brands:
        by_grade.setdefault(b['grade'], []).append(b)

    # ---------- 1. 详情页 ----------
    for b in brands:
        peers = [p for p in by_grade[b['grade']] if p['slug'] != b['slug']][:5]
        if len(peers) < 3:  # 同级不足就补别的档位，保证不是孤儿页
            peers += [p for p in brands if p['slug'] != b['slug'] and p not in peers][:3 - len(peers)]
        with open('brand/%s.html' % b['slug'], 'wb') as fh:
            fh.write(build_page(b, total, peers).encode('utf-8'))
    print('详情页：%d 页' % len(brands))

    # ---------- 2. index.html ----------
    html, crlf_html = read_text('index.html')

    # 2a. 卡片配置
    # ⚠️ 数组元素之间必须有逗号：join('\n') 会生成 `}\n{`，整段脚本直接 SyntaxError
    # （真渲染表现为首页白屏，且 jsdom 只报「Unexpected token '{'」，很难一眼看出是逗号）。
    cards = ',\n'.join(build_card(b, 'nongfu' if i == 0 else brands[i - 1]['slug'] + '-card')
                       for i, b in enumerate(brands))
    block = CARDS_START + cards + '\n' + CARDS_END
    if CARDS_START in html:
        new = splice(html, CARDS_START, CARDS_END, cards + '\n')
        assert new
        html = new
    else:
        i = html.find('var customCardsConfig = [')
        assert i > 0, '找不到 customCardsConfig'
        j = html.find('\n      ];', i)
        assert j > i, '找不到 customCardsConfig 结尾'
        html = html[:j + 1] + block + html[j + 1:]
    # 上一张手工卡以 `}` 收尾且没有尾逗号，紧跟一个 `{` 同样会 SyntaxError。
    # 只在紧贴 IMPORTED-CARDS-START 的那一处补逗号：从锚点往前跳过注释行/空行，
    # 若前一个有效字符是 `}` 就补 `,`（已是 `,` 则不动，保证幂等）。
    html = ensure_comma_before(html, CARDS_START)

    # 2b. noscript 清单
    ns = '\n'.join(build_noscript_li(b) for b in brands) + '\n'
    if NS_START in html:
        html = splice(html, NS_START, NS_END, '\n' + ns)
    else:
        anchor = '<h2 style="font-size:18px;font-weight:600;margin:24px 0 8px">同类项目导航</h2>'
        k = html.find(anchor)
        assert k > 0, '找不到 noscript 里的「同类项目导航」锚点'
        close = html.rfind('</ul>', 0, k)
        assert close > 0, '找不到 noscript 品牌清单的 </ul>'
        html = (html[:close] + NS_START + '\n' + ns + NS_END + '\n        '
                + html[close:])
    # noscript 里「全部品牌详细页（N 个）」的 N 必须等于 brand/ 页数。
    # 2026-11-02 踩坑：导入 104 条 li 进的是这个 <ul>，标题却还写着旧的 64，
    # 结果是「标题说 64、列表列 172」的爬虫可见矛盾（用户看到的是 JS 渲染的 172 张卡，
    # 爬虫看到的却是一个自相矛盾的 noscript）。
    html = re.sub(r'全部品牌详细页（\d+ 个）',
                  '全部品牌详细页（%d 个）' % total, html)
    # 2026-11-08 补：noscript 里还有一处手写「（共 N 家）」标题，生成器原先
    # 只改「N 个」那处，导致 verify「全部共 N 家一致」判红（174 / 173 并存）。
    html = re.sub(r'已收录企业双休评级与平均下班时间（共 \d+ 家）',
                  '已收录企业双休评级与平均下班时间（共 %d 家）' % total, html)
    write_text('index.html', html, crlf_html)
    print('index.html：卡片 %d 张 + noscript %d 行' % (len(brands), len(brands)))

    # ---------- 3. projects.html ----------
    pj, crlf_pj = read_text('projects.html')
    pl = '\n'.join(build_project_li(b) for b in brands) + '\n'
    if PJ_START in pj:
        pj = splice(pj, PJ_START, PJ_END, '\n' + pl)
    else:
        k = pj.find('<ul class="brand-index">')
        assert k > 0, '找不到 brand-index 列表'
        close = pj.find('</ul>', k)
        assert close > k
        pj = pj[:close] + PJ_START + '\n' + pl + PJ_END + '\n        ' + pj[close:]
    # 标题里的品牌数同步（正文写死的旧数字会与列表对不上）
    pj = re.sub(r'本站收录的企业双休明细（\d+ 个品牌）',
                '本站收录的企业双休明细（%d 个品牌）' % total, pj)
    write_text('projects.html', pj, crlf_pj)
    print('projects.html：%d 条索引' % len(brands))

    # ---------- 4. sitemap.xml ----------
    sm = open('sitemap.xml', encoding='utf-8').read() if os.path.exists('sitemap.xml') else ''
    head = sm.split('</urlset>')[0]
    blocks = re.findall(r'  <url>\s*<loc>([^<]+)</loc>[\s\S]*?</url>\n', head)
    others = [b for b in blocks if '/brand/' not in b]
    out = ['<?xml version="1.0" encoding="UTF-8"?>',
           '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for loc in others:
        m = re.search(r'<loc>%s</loc>\s*<lastmod>([^<]*)</lastmod>\s*'
                      r'<changefreq>([^<]*)</changefreq>\s*<priority>([^<]*)</priority>' % re.escape(loc), head)
        lm, cf, pr = (m.group(1), m.group(2), m.group(3)) if m else ('2026-10-10', 'monthly', '0.6')
        out.append('  <url>\n    <loc>%s</loc>\n    <lastmod>%s</lastmod>\n'
                   '    <changefreq>%s</changefreq>\n    <priority>%s</priority>\n  </url>' % (loc, lm, cf, pr))
    for slug in sorted(existing + [b['slug'] for b in brands]):
        grade = next((b['grade'] for b in brands if b['slug'] == slug), 'B')
        pr = '0.8' if grade in ('S', 'A') else '0.7'
        out.append('  <url>\n    <loc>https://dujeongil-galaxy.github.io/shuangxiugou/brand/%s.html</loc>\n'
                   '    <lastmod>2026-11-02</lastmod>\n    <changefreq>monthly</changefreq>\n'
                   '    <priority>%s</priority>\n  </url>' % (slug, pr))
    out.append('</urlset>\n')
    with open('sitemap.xml', 'wb') as fh:
        fh.write('\n'.join(out).encode('utf-8'))
    print('sitemap.xml：%d 条（非品牌 %d + 品牌 %d）'
          % (len(others) + len(existing) + len(brands), len(others), len(existing) + len(brands)))

    # ---------- 统计 ----------
    g = Counter(b['grade'] for b in brands)
    print('导入档位：S=%d A=%d B=%d C=%d（共 %d）'
          % (g['S'], g['A'], g['B'], g['C'], len(brands)))


if __name__ == '__main__':
    main()
