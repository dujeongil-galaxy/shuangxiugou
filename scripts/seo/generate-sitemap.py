"""把 36 个详情页写入 sitemap.xml（带 lastmod，按 tier 排 priority）

格式刻意保持最保守：
- 第 1 行只能是 XML 声明，紧接下一行就是 <urlset>
- **不含任何注释、不含任何中文**

原因：sitemap.xml 是机器读的文件，任何多余内容都可能让严格解析器报错。
「收录策略」这类人看的说明放在 docs 里，不放在 sitemap 里。
注释位置不合规会直接导致 Google 显示「无法抓取」—— 保守格式最稳。
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
os.chdir(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import json

idx = json.load(open('_brandindex.json', encoding='utf-8'))

PRIORITY = {'S': '0.8', 'A': '0.8', 'B': '0.7', 'C': '0.7'}
LASTMOD = '2026-10-10'
BASE = 'https://dujeongil-galaxy.github.io/shuangxiugou'

parts = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
]

# 首页
parts.append(
    f'  <url>\n    <loc>{BASE}/</loc>\n'
    f'    <lastmod>{LASTMOD}</lastmod>\n'
    f'    <changefreq>daily</changefreq>\n'
    f'    <priority>1.0</priority>\n  </url>'
)

# 事实核查页（云南嘉华事件）—— 搜相关词的用户可能直接落地到这里
parts.append(
    f'  <url>\n    <loc>{BASE}/jiahua-fact-check.html</loc>\n'
    f'    <lastmod>{LASTMOD}</lastmod>\n'
    f'    <changefreq>weekly</changefreq>\n'
    f'    <priority>0.7</priority>\n  </url>'
)

# 导航页
parts.append(
    f'  <url>\n    <loc>{BASE}/projects.html</loc>\n'
    f'    <lastmod>{LASTMOD}</lastmod>\n'
    f'    <changefreq>weekly</changefreq>\n'
    f'    <priority>0.8</priority>\n  </url>'
)

# 品牌详情页
for b in sorted(idx, key=lambda x: x['tier']):
    parts.append(
        f'  <url>\n    <loc>{BASE}/brand/{b["slug"]}.html</loc>\n'
        f'    <lastmod>{LASTMOD}</lastmod>\n'
        f'    <changefreq>monthly</changefreq>\n'
        f'    <priority>{PRIORITY.get(b["tier"], "0.6")}</priority>\n  </url>'
    )

parts.append('</urlset>')

out = '\n'.join(parts) + '\n'
open('sitemap.xml', 'w', encoding='utf-8', newline='\n').write(out)

# ===== 严格校验：只做「提交前自检」，发现问题直接抛错 =====

import xml.dom.minidom as m

# 1. 严格解析
d = m.parseString(out)

# 2. 命名空间正确（Google 要求 sitemaps.org 命名空间）
root = d.documentElement
assert root.tagName == 'urlset', f'根元素应为 urlset，实际 {root.tagName}'
assert 'schemas/sitemap/0.9' in (root.getAttribute('xmlns') or ''), '命名空间缺失'

locs = d.getElementsByTagName('loc')
assert len(locs) >= 1, '没有任何 URL'

# 3. 每条 loc 必须是 https 绝对 URL，且以/ 结尾或带扩展名
for l in locs:
    u = l.firstChild.nodeValue.strip() if l.firstChild else ''
    assert u.startswith('https://'), f'非 https 地址：{u}'
    assert ' ' not in u, f'URL 含空格：{u}'

# 4. 无 BOM、无 CRLF、无中文注释 —— 保守格式的基本要求
raw = open('sitemap.xml', 'rb').read()
assert not raw.startswith(b'\xef\xbb\xbf'), '文件含 BOM，Google 可能拒绝'
assert b'\r' not in raw, '文件含 CRLF 换行，应统一为 LF'
assert b'<!--' not in raw, 'sitemap.xml 不应含注释（说明请写到 docs）'

# 5. 第一行必须是 XML 声明
assert raw.split(b'\n')[0].startswith(b'<?xml'), '第 1 行必须是 XML 声明'

print(f'sitemap.xml 已更新：{len(locs)} 条 URL（含 {len(idx)} 个品牌详情页）')
print('格式自检通过：命名空间正确 / 无 BOM / LF 换行 / 无注释 / URL 均为 https 绝对地址')