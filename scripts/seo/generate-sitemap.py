"""把 36 个详情页写入 sitemap.xml（带 lastmod，按 tier 排 priority）"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
os.chdir(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import json, re

idx = json.load(open('_brandindex.json', encoding='utf-8'))

PRIORITY = {'S': '0.8', 'A': '0.8', 'B': '0.7', 'C': '0.7'}

entries = []
for b in sorted(idx, key=lambda x: x['tier']):
    entries.append(f'''  <url>
    <loc>https://dujeongil-galaxy.github.io/shuangxiugou/brand/{b['slug']}.html</loc>
    <lastmod>2026-10-10</lastmod>
    <changefreq>monthly</changefreq>
    <priority>{PRIORITY.get(b['tier'], '0.6')}</priority>
  </url>''')

head = '''<?xml version="1.0" encoding="UTF-8"?>
<!--
  收录策略：
  - 首页 / projects.html：主要收录页
  - brand/*.html：每个品牌一个独立页，覆盖「XX公司 双休率」这类长尾搜索词
  - sponsor.html 与 404.html 声明了 noindex，故不列入
-->
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://dujeongil-galaxy.github.io/shuangxiugou/</loc>
    <lastmod>2026-10-10</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>https://dujeongil-galaxy.github.io/shuangxiugou/projects.html</loc>
    <lastmod>2026-10-10</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>'''

out = head + '\n' + '\n'.join(entries) + '\n</urlset>\n'
open('sitemap.xml', 'w', encoding='utf-8').write(out)

# 校验 XML
import xml.dom.minidom as m
d = m.parseString(out)
locs = d.getElementsByTagName('loc')
print(f'sitemap.xml 已更新：{len(locs)} 条 URL（含 {len(idx)} 个品牌详情页）')
