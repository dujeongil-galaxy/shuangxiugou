#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
gen-evidence-board.py —— 首页「全站证据链公示」区块生成器

背景（2026-10-31 站长要求）：
    「证据链必须首页完整公示，口说无凭。」
    此前首页顶部公告栏写着「本站全部数据均附公开证据链…来源可查可溯」，
    但首页可见区一条证据都没有——174 条证据（含可点原始链接）全藏在
    brand/*.html 详情页里。口号与实况脱节 = 口说无凭。

做法：
    从 brand/*.html 抽取每一条证据（标题 / 类型 / 日期 / 文号 / 原始链接 / 摘要），
    生成 index.html 里 EVIDENCE-BOARD-START/END 两个注释锚点之间的静态 HTML。

为什么是静态 HTML 而不是 JS 渲染：
    1. 挂在 <div id="root"> 之后——React 只管 #root，静态节点不会被重渲染清掉，
       因此**不需要 MutationObserver 自愈**（2026-10-31 刚踩过 MO 锚点冲突自激的坑）。
    2. 无 JS 也能完整公示：用户禁用脚本、爬虫抓取，看到的都是同一份证据清单。
       若走 JS 渲染，「公示」本身就依赖被公示方的脚本可用性，逻辑上站不住。
    3. 用原生 <details> 折叠：默认紧凑（67 行品牌标题 + 统计条），展开看明细，
       不需要任何交互脚本。

单一真相源：
    本脚本**不维护第二份证据数据**。所有内容从 brand/*.html 现场解析。
    brand/ 页改了证据，重跑本脚本即同步；verify.mjs 有防漂移断言盯着
    （解析 brand/ 与 index.html 区块逐条比对，条数/链接/档位不一致即判红）。

用法：
    python scripts/gen-evidence-board.py           # 生成并写回 index.html
    python scripts/gen-evidence-board.py --check   # 只比对，不写（CI 用；有漂移 exit 1）
    python scripts/gen-evidence-board.py --dump    # 打印解析统计，不写

行尾纪律：
    仓库 .gitattributes 锁 LF，本脚本一律 'rb'/'wb' 字节级读写，内容只用 \\n。
"""

import os
import re
import sys
import html as htmlmod

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BRAND_DIR = os.path.join(ROOT, 'brand')
INDEX = os.path.join(ROOT, 'index.html')

START = '<!-- EVIDENCE-BOARD-START'
END = '<!-- EVIDENCE-BOARD-END -->'

# ---------------------------------------------------------------- 类型归并
# brand/ 页里的类型标注有 40 种字面变体（crowdsource / 社区清单（旁证）/
# 媒体报道（多源交叉）…）。公示板按「证据强度」归成 7 档展示，
# 但**原始字面标注一并保留**（不因为归并而丢掉细节，那等于篡改证据）。
#
# 强度分级依据：司法文书 > 官方处罚/公告 > 企业官方披露 > ESG/审计
#            > 媒体报道 > 招聘口径 > 社群/匿名反馈 > 旁证二手 > 站长一手
KIND_MAP = [
    # (归并后大类, 强度序, 匹配的字面标注集合)
    ('司法裁判', 1, {'judicial_record', 'court_doc'}),
    ('官方处罚/通报', 2, {'official_punishment'}),
    ('官方公示/备案', 3, {'official_notice', 'official_published', 'company_notice',
                     'company_filing', 'company_response', 'public_record',
                     '官方口径', '企业回应（媒体确认）', '企业回应（快照）',
                     '官方媒体报道（官宣级）', '企业信用信息', '官网披露'}),
    ('企业官方自述', 4, {'company_site', '公司自述'}),
    ('ESG/审计报告', 5, {'esg_report'}),
    ('媒体报道/调查', 6, {'media_report', '媒体报道', '媒体报道（快照）',
                     '媒体报道（多源交叉）', '媒体调查'}),
    ('招聘平台口径', 7, {'recruit_posting', '招聘快照', '招聘公告级',
                     '招聘公告级（多源互证）', '招聘公告级（企业直招）'}),
    ('站长一手实测', 8, {'first_hand'}),
    ('员工/社群反馈', 9, {'crowdsource', '员工自述（社区一手）', '员工自述（快照）',
                     '社区自述（快照）', '员工反馈'}),
    ('旁证/二手汇总', 10, {'社区清单（旁证）', '社区清单（二手）', '开源项目记录（旁证）',
                      '开源项目记录（线索登记）', '公开汇总（二手，未抓原文）',
                      '第三方百科'}),
]

# 大类 → 展示色（强度越高越冷、越权威；社群反馈用暖灰，旁证用浅灰）
KIND_COLOR = {
    '司法裁判': '#7c3aed',
    '官方处罚/通报': '#be123c',
    '官方公示/备案': '#0f766e',
    '企业官方自述': '#1d4ed8',
    'ESG/审计报告': '#0369a1',
    '媒体报道/调查': '#b45309',
    '招聘平台口径': '#4d7c0f',
    '站长一手实测': '#c2410c',
    '员工/社群反馈': '#57534e',
    '旁证/二手汇总': '#94a3b8',
}

# 档位 → 徽章色（与 brand/ 页、bundle 一致）
GRADE_COLOR = {'S': '#7c3aed', 'A': '#0f766e', 'B': '#b45309', 'C': '#be123c'}
GRADE_ORDER = {'S': 0, 'A': 1, 'B': 2, 'C': 3}


def norm_kind(raw):
    """把原始类型字面归并到大类；归并不了的按「未归类」处理并原样保留字面。"""
    raw = (raw or '').strip()
    for big, _order, aliases in KIND_MAP:
        if raw in aliases:
            return big
    return '未归类（%s）' % raw if raw else '未标注'


def strip_tags(s):
    """去 HTML 标签 + 反转义实体 + 压空白。"""
    s = re.sub(r'<br\s*/?>', ' ', s or '')
    s = re.sub(r'<[^>]+>', '', s)
    s = htmlmod.unescape(s)
    return re.sub(r'\s+', ' ', s).strip()


def esc(s):
    """写进 HTML 前转义。"""
    return htmlmod.escape(s or '', quote=True)


# ---------------------------------------------------------------- 解析
def parse_brand(path):
    """解析单个 brand 页 → dict(brand, grade, items, weak_reasons)"""
    with open(path, 'rb') as fh:
        text = fh.read().decode('utf-8')

    name = ''
    m = re.search(r'<h1[^>]*>(.*?)</h1>', text, re.S)
    if m:
        # 「肯德基 几点下班与加班情况」→「肯德基」
        name = strip_tags(m.group(1))
        name = re.sub(r'\s*几点下班与加班情况\s*$', '', name).strip()

    grade = ''
    m = re.search(r'<span class="badge"[^>]*>\s*([SABC])\s*级', text)
    if m:
        grade = m.group(1)

    # 副标题里的公司主体
    company = ''
    m = re.search(r'<p class="sub">(.*?)</p>', text, re.S)
    if m:
        sub = strip_tags(m.group(1))
        parts = [p.strip() for p in sub.split('·')]
        if parts:
            company = parts[0]

    items = []
    m = re.search(r'<h2>证据来源</h2>\s*<ul>(.*?)</ul>', text, re.S)
    if m:
        for li in re.findall(r'<li style="margin:0 0 12px">(.*?)</li>', m.group(1), re.S):
            st = re.search(r'<strong>(.*?)</strong>', li, re.S)
            tag = re.search(r'<span style="color:#6b7280;font-size:13px">（(.*?)）</span>',
                            li, re.S)
            href = re.search(r'<a href="(https?://[^"]+)"', li)
            doc = re.search(r'文号／编号：(.*?)</span>', li, re.S)

            raw_tag = strip_tags(tag.group(1)) if tag else ''
            segs = [p.strip() for p in raw_tag.split('·')]
            date = segs[0] if len(segs) > 1 else ''
            kind_raw = segs[-1] if segs else ''

            # 摘要 = 去掉 strong / 标注 span / 文号 span / 链接之后的正文
            body = re.sub(r'<strong>.*?</strong>', '', li, flags=re.S)
            body = re.sub(r'<span style="color:#6b7280;font-size:13px">（.*?）</span>',
                          '', body, flags=re.S)
            body = re.sub(r'<span style="color:#6b7280;font-size:13px">文号／编号：.*?</span>',
                          '', body, flags=re.S)
            body = re.sub(r'<a href="[^"]*".*?</a>', '', body, flags=re.S)
            summary = strip_tags(body)

            items.append({
                'title': strip_tags(st.group(1)) if st else '(无标题)',
                'kind_raw': kind_raw,
                'kind': norm_kind(kind_raw),
                'date': date,
                'doc': strip_tags(doc.group(1)) if doc else '',
                'href': htmlmod.unescape(href.group(1)) if href else '',
                'summary': summary,
            })

    # 零证据页：退而取「为什么给出这个评级」的判据条，如实标注为「无公开链接」
    weak = []
    if not items:
        m = re.search(r'<h2>为什么给出这个评级</h2>\s*<ul>(.*?)</ul>', text, re.S)
        if m:
            for li in re.findall(r'<li[^>]*>(.*?)</li>', m.group(1), re.S):
                t = strip_tags(li)
                if t:
                    weak.append(t)

    return {
        'slug': os.path.basename(path)[:-5],
        'brand': name,
        'company': company,
        'grade': grade,
        'items': items,
        'weak': weak,
    }


def collect():
    rows = []
    for fn in sorted(os.listdir(BRAND_DIR)):
        if fn.endswith('.html'):
            rows.append(parse_brand(os.path.join(BRAND_DIR, fn)))
    # 档位优先（S→A→B→C），同档按证据条数倒序（证据多的排前面，便于核查）
    rows.sort(key=lambda r: (GRADE_ORDER.get(r['grade'], 9), -len(r['items']), r['brand']))
    return rows


# ---------------------------------------------------------------- 渲染
# 摘要截断字数。取值依据：够说明「这条证据讲了什么」，又不至于把首页变成
# 第二份详情页正文（完整摘要在 brand/ 页里）。174 条 × 90 字 ≈ 16K 字。
SUMMARY_MAX = 90

# 为什么用 class + 一个样式块，而不是逐元素内联 style：
#   内联写法下每条证据要重复 6 段 style 字符串（约 350 字节/条纯样式开销），
#   174 条就是 60KB 的重复文本——index.html 实测因此从 133KB 涨到 394KB。
#   改成 class 后样式只写一次，体量降一半以上，且改配色只动一处。
CSS = """
#evidence-board{max-width:960px;margin:0 auto;padding:28px 16px 40px;font-family:system-ui,-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;line-height:1.75;color:#1f2937;font-size:14px}
#evidence-board h2{font-size:20px;font-weight:700;margin:0 0 6px;color:#0f172a;line-height:1.4}
#evidence-board a{color:#0f766e}
#evidence-board code{background:#f1f5f9;padding:1px 4px;border-radius:4px;font-size:12px}
#evidence-board .ev-lead{margin:0 0 14px;font-size:13px;color:#475569}
#evidence-board .ev-stats{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 16px}
#evidence-board .ev-stat{flex:1 1 150px;background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:10px 12px}
#evidence-board .ev-stat b{display:block;font-size:18px;font-weight:700;line-height:1.3}
#evidence-board .ev-stat i{display:block;font-style:normal;font-size:12px;color:#64748b}
#evidence-board .ev-legend{background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px;margin:0 0 18px;font-size:12.5px;color:#475569}
#evidence-board .ev-legend>div:first-child{font-weight:700;color:#0f172a;margin:0 0 6px}
#evidence-board .ev-pills{display:flex;flex-wrap:wrap;gap:6px}
#evidence-board .ev-pill{background:#fff;border:1px solid #94a3b8;border-radius:999px;padding:2px 10px;font-weight:600}
#evidence-board .ev-note{margin:8px 0 0;color:#64748b}
#evidence-board .ev-weak{background:#fff1f2;border:1px solid #fecdd3;border-left:4px solid #be123c;border-radius:10px;padding:14px 16px;margin:0 0 18px}
#evidence-board .ev-weak h3{font-size:15px;font-weight:700;color:#9f1239;margin:0 0 6px}
#evidence-board .ev-weak>p{margin:0 0 10px;font-size:13px;color:#7f1d1d}
#evidence-board .ev-weak ul{margin:0;padding-left:20px;font-size:13px;color:#7f1d1d}
#evidence-board .ev-weak li{margin:0 0 6px}
#evidence-board .ev-weak .r{color:#9f1239;font-size:12.5px}
#evidence-board .ev-g{color:#be123c;font-weight:700}
#evidence-board .ev-list{border:1px solid #e2e8f0;border-radius:12px;background:#fff;overflow:hidden}
#evidence-board .ev-listhead{background:#f1f5f9;padding:10px 14px;font-size:13px;font-weight:700;color:#334155;border-bottom:1px solid #e2e8f0}
#evidence-board details{border-bottom:1px solid #f1f5f9}
#evidence-board summary{cursor:pointer;padding:11px 14px;list-style:none;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
#evidence-board summary::-webkit-details-marker{display:none}
#evidence-board summary:hover{background:#f8fafc}
#evidence-board .g{border-radius:6px;padding:1px 7px;font-size:11.5px;font-weight:700;color:#fff;background:#64748b}
#evidence-board .bn{font-size:14px;color:#0f172a;font-weight:700}
#evidence-board .co{font-size:12px;color:#94a3b8}
#evidence-board .ct{margin-left:auto;font-size:12px;font-weight:600;color:#64748b}
#evidence-board .ct.w{color:#be123c}
#evidence-board .ev-body{padding:2px 14px 14px;background:#fcfcfd}
#evidence-board .ev-nolink{background:#fff1f2;border:1px solid #fecdd3;border-radius:8px;padding:10px 12px;font-size:13px;color:#7f1d1d}
#evidence-board .ev-reasons{margin:8px 0 0;padding-left:20px;font-size:13px;color:#7f1d1d}
#evidence-board ol.ev-items{margin:8px 0 0;padding-left:22px}
#evidence-board ol.ev-items>li{margin:0 0 10px;font-size:13px}
#evidence-board .t{font-weight:600;color:#0f172a}
#evidence-board .m{margin:3px 0;display:flex;flex-wrap:wrap;gap:6px;align-items:center;font-size:11.5px}
#evidence-board .k{background:#fff;border:1px solid #94a3b8;border-radius:999px;padding:0 8px;font-weight:600;color:#475569}
#evidence-board .d{color:#64748b}
#evidence-board .raw{color:#94a3b8}
#evidence-board .s{color:#475569;font-size:12.5px}
#evidence-board .u{margin-top:3px;font-size:12px;word-break:break-all}
#evidence-board .nl{margin-top:3px;color:#b45309;font-size:12px}
#evidence-board .ev-more{margin-top:10px;font-size:12px}
#evidence-board .ev-foot{margin:16px 0 0;font-size:12.5px;color:#64748b}
@media(max-width:640px){#evidence-board{padding:20px 12px 32px}#evidence-board .ev-stat{flex:1 1 44%}#evidence-board .ct{margin-left:0;width:100%}}
""".strip()


def short_url(u):
    """链接显示文本缩短：去 scheme、去 www、长路径截断。
    href 里始终保留完整 URL（可点性不能打折），只缩短可见文本。
    这样既让用户不点也能看清来源域名，又不把 134 条长 URL 双写一遍。"""
    s = re.sub(r'^https?://', '', u or '')
    s = re.sub(r'^www\.', '', s)
    if len(s) > 62:
        s = s[:62].rstrip('/') + '…'
    return s


def render_board(rows, generated_note):
    total_items = sum(len(r['items']) for r in rows)
    linked = sum(1 for r in rows for i in r['items'] if i['href'])
    unlinked = total_items - linked
    weak_rows = [r for r in rows if not r['items']]
    grades = {}
    kinds = {}
    for r in rows:
        grades[r['grade']] = grades.get(r['grade'], 0) + 1
        for i in r['items']:
            kinds[i['kind']] = kinds.get(i['kind'], 0) + 1

    out = []
    w = out.append

    w('<!-- EVIDENCE-BOARD-START')
    w('     本区块由 scripts/gen-evidence-board.py 自动生成，请勿手改。')
    w('     改证据请改 brand/*.html 详情页，然后重跑：python scripts/gen-evidence-board.py')
    w('     单一真相源在 brand/ 页；scripts/verify.mjs 有防漂移断言逐条比对。')
    w('     %s -->' % generated_note)
    # 档位徽章色只能内联（10 种颜色，写死在 CSS 里反而更难维护）
    w('<style>%s</style>' % CSS)
    # data-ev-* 是机器可读锚点：verify.mjs 用纯 Node 独立解析 brand/ 页得到实况，
    # 再与这里的数字逐项对账（总数/每家条数/带链接数/薄弱家数）。
    # 为什么要 data 属性而不是让 verify 去正则刮 HTML 文本：
    #   文本刮取会把「展示文案」和「校验数据」耦在一起，改个措辞就可能打红；
    #   data 属性是专门给机器看的契约，人看的文案怎么改都不影响校验。
    w('<section id="evidence-board" data-ev-brands="%d" data-ev-total="%d" '
      'data-ev-linked="%d" data-ev-weak="%d">'
      % (len(rows), total_items, linked, len(weak_rows)))

    # ---- 标题 + 站长口径引言
    w('  <h2>全站证据链公示（%d 家企业 · %d 条证据）</h2>' % (len(rows), total_items))
    w('  <p class="ev-lead">'
      '站长要求「证据链必须首页完整公示，口说无凭」——以下是站内每一条评级的取证清单，'
      '含证据类型、取证日期、文书编号与可点击的原始来源链接。'
      '数据由各品牌详情页（<code>brand/*.html</code>）自动汇总生成，'
      '两处不一致会被 <code>scripts/verify.mjs</code> 判红。</p>')

    # ---- 统计条
    w('  <div class="ev-stats">')
    stat = [
        ('证据总条数', str(total_items), '#0f766e'),
        ('带原始链接', str(linked), '#1d4ed8'),
        ('无可点链接', str(unlinked), '#b45309'),
        ('S/A/B/C 家数', '%d/%d/%d/%d' % (grades.get('S', 0), grades.get('A', 0),
                                     grades.get('B', 0), grades.get('C', 0)), '#475569'),
        ('证据薄弱企业', '%d 家' % len(weak_rows), '#be123c'),
    ]
    for label, val, color in stat:
        w('    <div class="ev-stat"><b style="color:%s">%s</b><i>%s</i></div>'
          % (color, esc(val), esc(label)))
    w('  </div>')

    # ---- 证据强度图例
    w('  <div class="ev-legend">')
    w('    <div>证据强度分级（强 → 弱）</div>')
    w('    <div class="ev-pills">')
    ordered = [k for k, _o, _a in KIND_MAP if kinds.get(k)]
    ordered += sorted(x for x in kinds if x not in KIND_COLOR)
    for k in ordered:
        c = KIND_COLOR.get(k, '#94a3b8')
        w('      <span class="ev-pill" style="border-color:%s;color:%s">%s <b>%d</b></span>'
          % (c, c if c != '#94a3b8' else '#475569', esc(k), kinds[k]))
    w('    </div>')
    w('    <div class="ev-note">司法裁判文书与劳动监察通报为最高强度证据；'
      '招聘平台自述属「招聘方口径」，只证明企业怎么说、不证明实际怎么排班；'
      '社群匿名反馈与旁证汇总强度最低，本站不用它们单独定档。</div>')
    w('  </div>')

    # ---- 薄弱清单（站长要求单列，不遮掩）
    if weak_rows:
        w('  <div class="ev-weak">')
        w('    <h3>⚠️ 证据薄弱清单：%d 家企业无可点公开链接</h3>' % len(weak_rows))
        w('    <p>以下企业的评级依据是线下一手核实或门店员工匿名反馈，'
          '<strong>拿不出可点击的公开原始链接</strong>。'
          '本站如实标注、不伪造来源、不用截图冒充链接。这几家的档位置信度低于其余企业，'
          '欢迎通过 GitHub Issues 补充可查证来源，核实后即更正。</p>')
        w('    <ul>')
        for r in weak_rows:
            w('      <li><strong>%s</strong><span class="ev-g"> %s 级</span> · '
              '<a href="./brand/%s.html">详情页</a>'
              % (esc(r['brand']), esc(r['grade']), esc(r['slug'])))
            for reason in r['weak']:
                w('        <div class="r">— %s</div>' % esc(reason))
            w('      </li>')
        w('    </ul>')
        w('  </div>')

    # ---- 逐品牌证据（<details> 折叠，无 JS 可展开）
    w('  <div class="ev-list">')
    w('    <div class="ev-listhead">按档位排列 · 点击企业名展开该企业的全部证据条目'
      '（共 %d 家）</div>' % len(rows))

    for r in rows:
        gc = GRADE_COLOR.get(r['grade'], '#64748b')
        n = len(r['items'])
        nl = sum(1 for i in r['items'] if i['href'])
        # data-b/data-g/data-n/data-l：verify.mjs 逐家对账用的契约
        # （品牌 slug / 档位 / 证据条数 / 带链接条数）
        w('    <details id="ev-%s" data-b="%s" data-g="%s" data-n="%d" data-l="%d">'
          % (esc(r['slug']), esc(r['slug']), esc(r['grade']), n, nl))
        w('      <summary><span class="g" style="background:%s">%s</span>'
          '<span class="bn">%s</span><span class="co">%s</span>'
          '<span class="ct%s">%s</span></summary>'
          % (gc, esc(r['grade']), esc(r['brand']), esc(r['company']),
             ' w' if n == 0 else '',
             '证据薄弱 · 0 条可点链接' if n == 0 else '%d 条证据' % n))
        w('      <div class="ev-body">')
        if n == 0:
            w('        <div class="ev-nolink"><strong>本页无可点公开链接。</strong>'
              '评级判据如下（线下一手／匿名反馈，无法给出原始来源 URL）：</div>')
            w('        <ul class="ev-reasons">')
            for reason in r['weak']:
                w('          <li>%s</li>' % esc(reason))
            w('        </ul>')
        else:
            w('        <ol class="ev-items">')
            for it in r['items']:
                kc = KIND_COLOR.get(it['kind'], '#94a3b8')
                w('          <li>')
                w('            <div class="t">%s</div>' % esc(it['title']))
                meta = ['<span class="k" style="border-color:%s;color:%s">%s</span>'
                        % (kc, kc if kc != '#94a3b8' else '#475569', esc(it['kind']))]
                if it['kind_raw'] and it['kind_raw'] != it['kind']:
                    meta.append('<span class="raw">原标注：%s</span>' % esc(it['kind_raw']))
                if it['date']:
                    meta.append('<span class="d">%s</span>' % esc(it['date']))
                if it['doc']:
                    meta.append('<span class="d">文号／编号：%s</span>' % esc(it['doc']))
                w('            <div class="m">%s</div>' % ' '.join(meta))
                if it['summary']:
                    s = it['summary']
                    if len(s) > SUMMARY_MAX:
                        s = s[:SUMMARY_MAX].rstrip() + '…'
                    w('            <div class="s">%s</div>' % esc(s))
                if it['href']:
                    w('            <div class="u"><a href="%s" rel="nofollow noopener" '
                      'target="_blank">%s</a></div>'
                      % (esc(it['href']), esc(short_url(it['href']))))
                else:
                    w('            <div class="nl">（本条无可点原始链接，详见详情页说明）</div>')
                w('          </li>')
            w('        </ol>')
        w('        <div class="ev-more"><a href="./brand/%s.html">查看 %s 完整详情页 →</a></div>'
          % (esc(r['slug']), esc(r['brand'])))
        w('      </div>')
        w('    </details>')
    w('  </div>')

    # ---- 免责与纠错入口
    w('  <p class="ev-foot">'
      '以上证据均来自公开渠道，本站只做汇总与标注，<strong>不构成对任何企业的法律定性</strong>。'
      '企业用工情况会随时间变化；如认为某条证据过时、不实或属个案误判，欢迎通过 '
      '<a href="https://github.com/dujeongil-galaxy/shuangxiugou/issues">GitHub Issues</a> '
      '提交可查证的来源，核实后同步更新本页与详情页。</p>')
    w('</section>')
    w(END)
    return '\n'.join(out)


# ---------------------------------------------------------------- 写回
# 公告栏那句话的处理（2026-10-31）：
#   原文「本站全部数据均附公开证据链：招聘口径、员工反馈与官方通报分项标注，
#   来源可查可溯，欢迎核实纠错」是纯口号——首页当时看不到任何一条证据，
#   口号与实况脱节，正是站长说的「口说无凭」。
#   现在改成可点入口 + 真实条数，并把整句包进 <span id="evidence-notice">。
#
# 为什么用 marker span 而不是直接正则替换原句：
#   替换必须幂等——第二次跑生成器时原句已经不存在了，直接匹配原句会报错。
#   包一层固定 id 的 span，之后每轮只换 span 的内容，跑几次都收敛到同一结果。
NOTICE_ID = 'evidence-notice'
NOTICE_SPAN_RE = re.compile(r'<span id="%s">.*?</span>' % NOTICE_ID, re.S)
NOTICE_ORIG = ('本站全部数据均附公开证据链：招聘口径、员工反馈与官方通报分项标注，'
               '来源可查可溯，欢迎核实纠错')


def render_notice(total_brands, total_items, weak_count):
    """公告栏句子内容。数字全部由 brand/ 实况算出，不手写、不硬编码。"""
    return ('本站全部数据均附公开证据链：'
            '<a href="#evidence-board" style="color:#0f766e;text-decoration:underline">'
            '%d 家企业 %d 条证据已在本页完整公示</a>'
            '（招聘口径、员工反馈与官方通报分项标注，来源可查可溯；'
            '其中 %d 家暂无可点公开链接，已在公示区如实单列），欢迎核实纠错'
            % (total_brands, total_items, weak_count))


def update_notice(index_text, total_brands, total_items, weak_count):
    inner = render_notice(total_brands, total_items, weak_count)
    if NOTICE_SPAN_RE.search(index_text):
        return NOTICE_SPAN_RE.sub(
            lambda _m: '<span id="%s">%s</span>' % (NOTICE_ID, inner), index_text, count=1)
    if NOTICE_ORIG not in index_text:
        raise SystemExit('公告栏原句找不到、marker span 也不存在——index.html 结构变了？'
                         '请更新 NOTICE_ORIG / NOTICE_SPAN_RE')
    return index_text.replace(
        NOTICE_ORIG, '<span id="%s">%s</span>' % (NOTICE_ID, inner), 1)


def splice(index_text, board):
    """把 board 塞进 START/END 锚点之间；锚点不存在则插到 <div id="root"></div> 之后。
    board 自身首尾就是 START/END 注释锚点，这里不再额外包一层注释（会重复）。"""
    si = index_text.find(START)
    ei = index_text.find(END)
    if si >= 0 and ei > si:
        return index_text[:si] + board + index_text[ei + len(END):]
    anchor = '<div id="root"></div>'
    ai = index_text.find(anchor)
    if ai < 0:
        raise SystemExit('找不到挂载锚点 <div id="root"></div>，index.html 结构变了？')
    cut = ai + len(anchor)
    # 挂载说明写在 START 注释里（render_board 已生成），这里只补一行「为什么挂这」
    block = ('\n\n    <!-- 全站证据链公示：挂在 #root 之后，React 只管 #root，静态节点不会被\n'
             '         重渲染清掉，因此不需要 MutationObserver 自愈（避免 MO 锚点冲突自激）。\n'
             '         内容由 scripts/gen-evidence-board.py 从 brand/*.html 自动生成。 -->\n    '
             + board + '\n')
    return index_text[:cut] + block + index_text[cut:]


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else ''
    rows = collect()
    total = sum(len(r['items']) for r in rows)
    linked = sum(1 for r in rows for i in r['items'] if i['href'])
    weak = [r['slug'] for r in rows if not r['items']]

    if mode == '--dump':
        print('品牌页 %d | 证据条目 %d | 带链接 %d | 无链接 %d'
              % (len(rows), total, linked, total - linked))
        print('证据薄弱页（0 条）: %s' % ', '.join(weak))
        kinds = {}
        for r in rows:
            for i in r['items']:
                kinds[i['kind']] = kinds.get(i['kind'], 0) + 1
        print('类型分布: %s' % kinds)
        un = [k for k in kinds if k.startswith('未归类') or k == '未标注']
        if un:
            print('⚠️ 未归类类型: %s' % un)
        return 0

    with open(INDEX, 'rb') as fh:
        cur = fh.read().decode('utf-8')

    note = ('由 scripts/gen-evidence-board.py 从 brand/*.html 自动汇总：%d 家企业 / %d 条证据 / '
            '%d 条带原始链接 / %d 家证据薄弱。' % (len(rows), total, linked, len(weak)))
    board = render_board(rows, note)
    want_notice = render_notice(len(rows), total, len(weak))

    if mode == '--check':
        si, ei = cur.find(START), cur.find(END)
        if si < 0 or ei < si:
            print('FAIL: index.html 缺证据公示区块锚点')
            return 1
        old = cur[si:ei + len(END)]
        # 比对时忽略生成说明行（含统计数字/时间戳会导致永远不等）
        strip_note = lambda s: re.sub(r'<!-- EVIDENCE-BOARD-START.*?-->',
                                      '<!-- EVIDENCE-BOARD-START -->', s, flags=re.S)
        bad = []
        if strip_note(old) != strip_note(board):
            bad.append('公示区块与 brand/ 页实况不一致（证据已改但未重跑生成器）')
        # 公告栏那句的条数也要跟实况一致，否则又是「口说无凭」
        m = NOTICE_SPAN_RE.search(cur)
        if not m:
            bad.append('公告栏缺 evidence-notice 标记（证据链口号未变成可点入口）')
        elif m.group(0) != '<span id="%s">%s</span>' % (NOTICE_ID, want_notice):
            bad.append('公告栏证据条数与 brand/ 实况不一致')
        if bad:
            print('FAIL: ' + '；'.join(bad))
            print('      修：python scripts/gen-evidence-board.py')
            return 1
        print('OK: 证据公示区块 + 公告栏入口均与 brand/ 页一致（%d 家 / %d 条）'
              % (len(rows), total))
        return 0

    new = splice(cur, board)
    new = update_notice(new, len(rows), total, len(weak))
    if '\r' in new:
        raise SystemExit('生成内容含 CR，违反仓库 LF 纪律')
    with open(INDEX, 'wb') as fh:
        fh.write(new.encode('utf-8'))
    print('已写入 index.html：%d 家企业 / %d 条证据（%d 条带原始链接）/ 证据薄弱 %d 家'
          % (len(rows), total, linked, len(weak)))
    print('index.html 体量 %.1f KB' % (len(new.encode('utf-8')) / 1024))
    if weak:
        print('证据薄弱（已如实标注+单列清单）: %s' % ', '.join(weak))
    return 0


if __name__ == '__main__':
    sys.exit(main())
