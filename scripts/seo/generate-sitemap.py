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
# 首页单独维护 lastmod：首页几乎每次改动都会变，而 Bing 明确把 sitemap 的
# lastmod 当作「优先重抓」信号（changefreq / priority 则被忽略）。2026-11-14
# 修必应摘要时首页 lastmod 还停在 10-10，旧索引快照一直没被刷新。
# ⚠️ 这一天由 verify §36y 写死断言，别单方面改；要改就两条一起改并同步断言。
LASTMOD_HOME = '2026-11-14'
BASE = 'https://dujeongil-galaxy.github.io/shuangxiugou'

parts = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
]

# 首页
parts.append(
    f'  <url>\n    <loc>{BASE}/</loc>\n'
    f'    <lastmod>{LASTMOD_HOME}</lastmod>\n'
    f'    <changefreq>daily</changefreq>\n'
    f'    <priority>1.0</priority>\n  </url>'
)


# 导航页
parts.append(
    f'  <url>\n    <loc>{BASE}/projects.html</loc>\n'
    f'    <lastmod>{LASTMOD}</lastmod>\n'
    f'    <changefreq>weekly</changefreq>\n'
    f'    <priority>0.8</priority>\n  </url>'
)

# 成功案例合集 + QQ奶奶专题页（2026-11-09 站长要求：专题单独一页，不占案例序号）
# 2026-11-27：成功案例页新增「找茬」判据专题入口，lastmod 单独推进；
# QQ奶奶专题页本次没动，仍留在 2026-11-09（两者原本共用一个常量，现拆开）。
LASTMOD_CASES = '2026-11-09'
LASTMOD_STORIES = '2026-11-27'
parts.append(
    f'  <url>\n    <loc>{BASE}/success-stories.html</loc>\n'
    f'    <lastmod>{LASTMOD_STORIES}</lastmod>\n'
    f'    <changefreq>monthly</changefreq>\n'
    f'    <priority>0.7</priority>\n  </url>'
)
parts.append(
    f'  <url>\n    <loc>{BASE}/qq-nainai.html</loc>\n'
    f'    <lastmod>{LASTMOD_CASES}</lastmod>\n'
    f'    <changefreq>monthly</changefreq>\n'
    f'    <priority>0.7</priority>\n  </url>'
)
# 反面专题：万州公交坠江与「事不关己」的代价（2026-11-25 站长要求，不占案例序号）
parts.append(
    f'  <url>\n    <loc>{BASE}/bystander.html</loc>\n'
    f'    <lastmod>2026-11-25</lastmod>\n'
    f'    <changefreq>monthly</changefreq>\n'
    f'    <priority>0.7</priority>\n  </url>'
)
# 自述专题：50 元罚单与一场败诉的复议（站长亲身经历，不占案例序号；2026-11-27 起发布）
parts.append(
    f'  <url>\n    <loc>{BASE}/fifty-yuan.html</loc>\n'
    f'    <lastmod>2026-11-27</lastmod>\n'
    f'    <changefreq>monthly</changefreq>\n'
    f'    <priority>0.7</priority>\n  </url>'
)
# 比亚迪车主专题报道（2026-11-14 站长要求单独建页，双休购旗下独立 HTML）
parts.append(
    f'  <url>\n    <loc>{BASE}/byd-report.html</loc>\n'
    f'    <lastmod>2026-11-14</lastmod>\n'
    f'    <changefreq>monthly</changefreq>\n'
    f'    <priority>0.7</priority>\n  </url>'
)

# 消费争议判据专题：「找茬」怎么用才算数（2026-11-27 发布，不占案例序号）
parts.append(
    f'  <url>\n    <loc>{BASE}/chaocha-report.html</loc>\n'
    f'    <lastmod>2026-11-27</lastmod>\n'
    f'    <changefreq>monthly</changefreq>\n'
    f'    <priority>0.7</priority>\n  </url>'
)

# QQ 浏览器专题报道（2026-11-19：两篇微信文章的存档备份专题页）
parts.append(
    f'  <url>\n    <loc>{BASE}/qq-browser-report.html</loc>\n'
    f'    <lastmod>2026-11-19</lastmod>\n'
    f'    <changefreq>monthly</changefreq>\n'
    f'    <priority>0.7</priority>\n  </url>'
)

# 踏板支架争议专题（2026-11-20：网传短视频的逐字存档 + 待核实追问，不作事实认定）
parts.append(
    f'  <url>\n    <loc>{BASE}/zunjie-report.html</loc>\n'
    f'    <lastmod>2026-11-20</lastmod>\n'
    f'    <changefreq>monthly</changefreq>\n'
    f'    <priority>0.7</priority>\n  </url>'
)

# 法务与信息页（2026-11-17 AdSense 接入准备：隐私政策/免责声明/关于/联系）
LASTMOD_LEGAL = '2026-11-17'
for slug, pri in [('privacy.html', '0.3'), ('disclaimer.html', '0.3'),
                  ('about.html', '0.5'), ('contact.html', '0.3'),
                  ('community-rules.html', '0.3')]:
    parts.append(
        f'  <url>\n    <loc>{BASE}/{slug}</loc>\n'
        f'    <lastmod>{LASTMOD_LEGAL}</lastmod>\n'
        f'    <changefreq>monthly</changefreq>\n'
        f'    <priority>{pri}</priority>\n  </url>'
    )

# 品牌详情页
for b in sorted(idx, key=lambda x: x['tier']):
    parts.append(
        f'  <url>\n    <loc>{BASE}/brand/{b["slug"]}.html</loc>\n'
        f'    <lastmod>{LASTMOD}</lastmod>\n'
        f'    <changefreq>monthly</changefreq>\n'
        f'    <priority>{PRIORITY.get(b["tier"], "0.6")}</priority>\n  </url>'
    )

# 两个手工维护的品牌页：不在 _brandindex.json 里，历史上靠手改 sitemap 收录。
# 2026-11-25 重建时发现生成器会漏掉它们（verify「全部品牌页都在 sitemap」判红），
# 补进生成器，避免每次 seo:sitemap 都要再手补一次。
for slug, lastmod in [('unicom.html', '2026-11-02'), ('netease-games.html', '2026-11-20'),
                      ('tea-rest-board.html', '2026-11-21')]:
    parts.append(
        f'  <url>\n    <loc>{BASE}/brand/{slug}</loc>\n'
        f'    <lastmod>{lastmod}</lastmod>\n'
        f'    <changefreq>monthly</changefreq>\n'
        f'    <priority>0.7</priority>\n  </url>'
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