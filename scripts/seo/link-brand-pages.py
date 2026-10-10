"""把品牌详情页链接进首页 noscript 与 projects.html。

**为什么要独立成脚本**：详情页由 generate-brand-pages.py 产出，
但内链需要在页面生成之后注入。若只跑生成脚本而不跑本脚本，
首页与导航页不会链向新页面，爬虫就无法遍历到——这是最容易被忽略的一环。

用法（从任意目录均可）：
    python scripts/seo/link-brand-pages.py
"""
import os, sys, re, json, glob

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.chdir(ROOT)

SITE = 'https://dujeongil-galaxy.github.io/shuangxiugou'


def load_brand_index():
    """从 brand/*.html 反推索引（不依赖中间 JSON 文件）"""
    idx = []
    for f in sorted(glob.glob('brand/*.html')):
        t = open(f, encoding='utf-8').read()
        slug = os.path.basename(f)[:-5]
        h1 = re.search(r'<h1>(.*?)</h1>', t, re.S)
        name = re.sub(r'\s*双休率与加班情况\s*$', '', re.sub(r'<[^>]+>', '', h1.group(1))).strip() if h1 else slug
        tier = re.search(r'>([SABC]) 级评级<', t)
        rate = re.search(r'真实双休率</p><p class="v">([^<]*)<', t)
        off = re.search(r'平均下班时间</p><p class="v">([^<]*)<', t)
        idx.append({
            'slug': slug, 'name': name,
            'tier': tier.group(1) if tier else '?',
            'rate': (rate.group(1).replace('%', '') if rate and rate.group(1) != '未核实' else None),
            'off': (off.group(1) if off and off.group(1) != '—' else None),
        })
    return idx


def link_home(idx):
    """首页 noscript：品牌清单加链接 + 追加完整索引区"""
    s = open('index.html', encoding='utf-8').read()
    ns = re.search(r'<noscript>([\s\S]*?)</noscript>', s)
    if not ns:
        print('  ✗ 首页没有 noscript 兜底区，跳过')
        return False

    body = ns.group(1)
    if './brand/' in body:
        print('  · 首页已含详情页链接，跳过（避免重复注入）')
        return False

    slug_by_name = {}
    for b in idx:
        slug_by_name[b['name'].strip()] = b['slug']
        slug_by_name[b['name'].split('（')[0].split('(')[0].strip()] = b['slug']

    cnt = [0]

    def repl(m):
        whole, nm = m.group(0), m.group(1)
        plain = re.sub(r'&amp;', '&', nm).strip()
        slug = slug_by_name.get(plain) or slug_by_name.get(plain.split('(')[0].strip())
        if not slug:
            return whole
        cnt[0] += 1
        return (whole.replace('<li><strong>', '<li><strong><a href="./brand/%s.html">' % slug, 1)
                .replace('</strong>', '</a></strong>', 1) +
                ' <a href="./brand/%s.html" style="color:#0F766E">详细→</a>' % slug)

    body2 = re.sub(r'<li><strong>([^<]{2,40})</strong>：[^<]*</li>', repl, body)

    rows = '\n'.join(
        '          <li><a href="./brand/%s.html">%s</a> —— %s 级 · 双休率 %s · 平均下班 %s</li>'
        % (b['slug'], b['name'], b['tier'],
           (b['rate'] + '%') if b['rate'] else '未核实',
           b['off'] or '未核实')
        for b in idx)

    section = (
        '        <h2 style="font-size:18px;font-weight:600;margin:24px 0 8px">'
        '全部品牌详细页（%d 个）</h2>\n'
        '        <p style="margin:0 0 8px">每个品牌都有独立页面，'
        '含完整评级说明、判定依据与证据来源链接：</p>\n'
        '        <ul style="margin:0 0 16px;padding-left:22px">\n%s\n        </ul>\n\n'
    ) % (len(idx), rows)

    anchor = '        <h2 style="font-size:18px;font-weight:600;margin:24px 0 8px">同类项目导航</h2>'
    if anchor not in body2:
        print('  ✗ 未找到「同类项目导航」锚点，跳过索引区注入')
        return False
    body2 = body2.replace(anchor, section + anchor, 1)

    s = s[:ns.start(1)] + body2 + s[ns.end(1):]
    open('index.html', 'w', encoding='utf-8').write(s)
    print(f'  ✓ 首页已注入 {cnt[0]} 处清单链接 + {len(idx)} 条索引')
    return True


def link_projects(idx):
    """projects.html：追加品牌明细入口区"""
    s = open('projects.html', encoding='utf-8').read()
    if './brand/' in s:
        print('  ·导航页已含详情页链接，跳过')
        return False

    rows = '\n'.join(
        '          <li><a href="./brand/%s.html">%s</a> —— %s 级 · 双休率 %s · 平均下班 %s</li>'
        % (b['slug'], b['name'], b['tier'],
           (b['rate'] + '%') if b['rate'] else '未核实',
           b['off'] or '未核实')
        for b in idx)

    block = (
        '      <section>\n'
        '        <h2>本站收录的企业双休明细（%d 个品牌）</h2>\n'
        '        <p>\n'
        '          每个品牌都有独立页面，含评级说明、判定依据与证据来源链接。\n'
        '          如果你在上面某个项目里看到了想查的企业，可以从这里直接进入明细页；\n'
        '          或者 <a href="./">回到总表</a> 搜索企业名称。\n'
        '        </p>\n'
        '        <ul class="brand-index">\n%s\n        </ul>\n'
        '      </section>\n\n'
    ) % (len(idx), rows)

    anchor = '      <nav class="footer">'
    if anchor not in s:
        print('  ✗ 未找到 footer 锚点，跳过')
        return False
    s = s.replace(anchor, block + anchor, 1)

    if 'ul.brand-index' not in s:
        s = s.replace('</style>',
                      '    ul.brand-index { columns: 2; column-gap: 28px; }\n'
                      '    ul.brand-index li { margin: 0 0 6px; break-inside: avoid; }\n'
                      '    @media (max-width: 640px) { ul.brand-index { columns: 1; } }\n'
                      '  </style>', 1)
    open('projects.html', 'w', encoding='utf-8').write(s)
    print(f'  ✓ 导航页已注入 {len(idx)} 条明细入口')
    return True


if __name__ == '__main__':
    idx = load_brand_index()
    print(f'检测到 {len(idx)} 个详情页')
    if not idx:
        print('请先运行 generate-brand-pages.py')
        sys.exit(1)
    print('注入内链：')
    link_home(idx)
    link_projects(idx)
    print('完成。')
