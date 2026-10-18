#!/usr/bin/env python3
"""
生成拼音/首字母搜索索引 pinyin-index.js

流程：解析 bundle 里的 brands 数组 + index.html 的 customCardsConfig
      → 汉字转拼音 → 排序规则自检 → 写文件

为什么需要它
------------
bundle 的搜索是纯 includes 硬匹配，输「ning」「ndsd」搜不到「宁德时代」。
真正的模糊搜索要改 React 内部数组，那只能手改压缩产物 —— 项目红线。
所以改为在注入层做联想回填，索引由本脚本离线生成。

自定义卡（肯德基/小米/兵立王/茶百道/赵一鸣/一点点/零食有鸣）不在 bundle 里，
而是 index.html 的 customCardsConfig（含 name/company/keywords/tags），
本脚本一并解析进索引，否则拼音联想永远查不到它们（2026-10-18 修复）。

依赖：pypinyin
    <managed python> -m pip install pypinyin

用法（仓库根目录执行）
    python scripts/gen-pinyin-index.py

新增品牌后必须重跑，否则该品牌没有拼音索引（页面仍能中文搜到，只是没有联想）。
本脚本自包含，不依赖任何中间产物文件。
"""
import json
import os
import re
import sys

from pypinyin import lazy_pinyin, Style

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUNDLE = os.path.join(ROOT, 'assets', 'index-YthXZ9eP.js')
INDEX_HTML = os.path.join(ROOT, 'index.html')
OUT = os.path.join(ROOT, 'pinyin-index.js')

BT = chr(96)


def extract_brands(src):
    """
    从压缩产物里取出 brands 数组。

    必须用括号配平，不能用固定步长的正则前瞻 —— 词条之间距离不固定，
    正则会跨过当前品牌去命中后面数组的内容（实测踩过：
    patagonia 被安上了 pair-vehicles 的关键词）。
    """
    marker = 'brands:['
    start = src.index(marker) + len(marker)

    objs = []
    depth = 0
    cur = None
    j = start
    while j < len(src):
        ch = src[j]
        if ch == BT:                      # 模板字符串，跳到结束
            j += 1
            while j < len(src):
                if src[j] == BT and src[j - 1] != '\\':
                    break
                j += 1
        elif ch == '{':
            if depth == 0:
                cur = j
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0:
                objs.append(src[cur:j + 1])
            elif depth < 0:
                break
        j += 1

    def field(obj, key):
        m = re.search(key + ':' + BT + r'([^' + BT + r']*)' + BT, obj)
        return m.group(1) if m else None

    def arr(obj, key):
        m = re.search(key + r':\[([^\]]*)\]', obj)
        return re.findall(BT + r'([^' + BT + r']*)' + BT, m.group(1)) if m else []

    out = []
    for o in objs:
        bid = field(o, 'id')
        if not bid:
            continue
        out.append({
            'id': bid,
            'name': field(o, 'name'),
            'company': field(o, 'companyName'),
            'category': field(o, 'category'),
            'tier': field(o, 'tier'),
            'kw': arr(o, 'searchKeywords'),
            'products': arr(o, 'keyProducts'),
        })
    return out


def parse_custom_configs(html):
    """
    从 index.html 解析 customCardsConfig 数组，返回与 extract_brands 同构的列表
    （id/name/company/category/tier/kw/products）。自定义卡没有 products，
    用 keywords + tags 并成 kw。
    """
    m = re.search(r'var customCardsConfig = \[([\s\S]*?)\n      \];', html)
    if not m:
        print('警告：未在 index.html 找到 customCardsConfig，自定义卡不入索引')
        return []
    body = m.group(1)
    out = []
    # 按配置项切片：与 verify.mjs §3 同一套切法（read() 已归一化为 LF）
    item_re = re.compile(r"\{\s*id:\s*'([^']+)',([\s\S]*?)\n\s*\},?\n")
    for im in item_re.finditer(body):
        cid, chunk = im.group(1), im.group(2)
        f = lambda key: (re.search(key + r":\s*'([^']*)'", chunk) or [None, None])[1]
        name = f('name') or cid
        company = f('company') or ''
        category = f('category') or ''
        grade = f('grade') or ''
        tier = {'S级': 's', 'A级': 'a', 'B级': 'b', 'C级': 'c',
                'U级': 'u', '待核实（未评级）': 'u'}.get(grade, '')
        kw = re.findall(r"keywords:\s*\[([^\]]*)\]", chunk)
        kw_items = []
        if kw:
            kw_items = re.findall(r"'([^']*)'", kw[0])
        tags = re.findall(r"tags:\s*\[([^\]]*)\]", chunk)
        tag_items = []
        if tags:
            tag_items = re.findall(r"'([^']*)'", tags[0])
        merged = []
        for t in kw_items + tag_items:
            t = t.strip()
            if t and t not in merged:
                merged.append(t)
        out.append({
            'id': cid, 'name': name, 'company': company,
            'category': category, 'tier': tier, 'kw': merged, 'products': [],
        })
    return out


def to_pinyin(text):
    return (''.join(lazy_pinyin(text, style=Style.NORMAL)),
            ''.join(lazy_pinyin(text, style=Style.FIRST_LETTER)))


# 词条重要度 W：数字越小越优先。
#
# 为什么必须分层：输「ms」时星巴克「美式」(ms, W3) 和微软「微软」(wr, W3)
# 其实后者首字母是 wr 不是 ms —— 微软根本不该出现在 ms 结果里。
# 真正的问题是「ms」只可能命中「美式」，这是数据决定的，不是排序 bug。
# 两字母缩写本身高度歧义，正确做法是并列展示 + 标出命中词条让用户选，
# 而不是靠排序猜用户意图。
W_CNAME, W_ENAME, W_COMPANY, W_KW, W_PRODUCT = 0, 1, 2, 3, 4

CJK = re.compile(r'[一-鿿]+')


def split_name(name):
    cn = ''.join(CJK.findall(name))
    en = CJK.sub('', name).replace('(', '').replace(')', '').strip()
    return cn, en


def build_index(brands):
    index = []
    for b in brands:
        cn, en = split_name(b['name'])
        buckets = [
            (W_CNAME, [cn]),
            (W_ENAME, [en] if en else []),
            (W_COMPANY, [b['company'] or '']),
            (W_KW, b['kw']),
            (W_PRODUCT, b['products']),
        ]
        seen = {}
        for weight, items in buckets:
            for t in items:
                t = t.strip()
                if not t:
                    continue
                fp, ini = to_pinyin(t)
                if not fp:
                    continue
                key = (fp, ini)
                # 同一读音只保留最重要的来源
                if key not in seen or weight < seen[key][0]:
                    seen[key] = (weight, t, fp, ini)
        terms = [{'t': t, 'f': fp, 'i': ini, 'w': w}
                 for w, t, fp, ini in sorted(seen.values(), key=lambda x: (x[0], x[1]))]
        index.append({
            'id': b['id'], 'name': b['name'], 'cn': cn or b['name'],
            'cat': b['category'], 'tier': b['tier'], 'terms': terms,
        })
    return index


def score(query, entry):
    """
    返回 (层级, 词条重要度, 命中位置, 命中词条原文)，不命中返回 None。

    ⚠️ 首字母匹配只对「品牌级」词条生效（主名/英文名/公司全称/关键词），
       产品名一律不参与。这不是优化，是修 bug：

       几乎每个品牌都有以「系列」「冷链」结尾的产品名，它们的首字母
       天然以 xl / yxl 之类收尾。实测输「xl」会同时命中
       「vivo X 系列」「纯茶饮系列」「夜行者系列」「生鲜冷链」——
       全是产品线，用户搜 xl 是想找品牌，不是找产品。
       所以产品名只参与原文与全拼匹配，不参与首字母。
    """
    best = None
    for t in entry['terms']:
        tl, fl, il = t['t'].lower(), t['f'].lower(), t['i'].lower()
        w = t['w']
        # 纯英文词条的首字母索引没有意义（Microsoft 的首字母就是 Microsoft）
        has_cjk = bool(CJK.search(t['t']))
        # W_PRODUCT = 4，产品名不参与首字母匹配
        initials_ok = has_cjk and w < W_PRODUCT
        cands = []
        if query in tl:
            cands.append((0, w, tl.index(query), t['t']))
        if query in fl:
            pos = fl.find(query)
            # 全拼按音节边界优先：nd 命中「宁德」，而不是「跑步」里的 bu
            at_boundary = pos == 0 or fl[pos - 1] in 'aeiou'
            cands.append((1 if at_boundary else 4, w, pos, t['t']))
        if initials_ok:
            if query == il:
                cands.append((2, w, 0, t['t']))
            else:
                p = il.find(query)
                if p != -1:
                    cands.append((3, w, p, t['t']))
        if cands:
            c = min(cands, key=lambda x: (x[0], x[1], x[2]))
            if best is None or c[:3] < best[:3]:
                best = c
    return best


def search(q, index):
    q = (q or '').strip().lower().replace(' ', '')
    if not q:
        return []
    hits = []
    for e in index:
        s = score(q, e)
        if s:
            hits.append((s, e))
    hits.sort(key=lambda x: x[0])
    return hits


HEADER = """// ============================================================
// 拼音/首字母模糊搜索索引 —— 自动生成，请勿手改
//
// 来源：assets/index-YthXZ9eP.js 的 brands 数组
//       + index.html 的 customCardsConfig（自定义卡）
// 生成：scripts/gen-pinyin-index.py（依赖 pypinyin）
// 字段 t = [原文, 全拼, 首字母, 重要度]
// 重要度：0 主名 / 1 英文名 / 2 公司全称 / 3 关键词 / 4 产品名
//
// ⚠️ 本文件只做「输入联想」，不改 React 原生搜索逻辑。
//    改动后必须重跑 scripts/gen-pinyin-index.py。
// ============================================================
window.__PINYIN_INDEX__ = """


if __name__ == '__main__':
    if not os.path.exists(BUNDLE):
        sys.exit('找不到 bundle：' + BUNDLE)

    brands = extract_brands(open(BUNDLE, encoding='utf-8').read())
    print('从 bundle 解析出品牌数：', len(brands))

    if os.path.exists(INDEX_HTML):
        customs = parse_custom_configs(open(INDEX_HTML, encoding='utf-8').read())
        print('从 index.html 解析出自定义卡数：', len(customs))
    else:
        customs = []
        print('警告：找不到 index.html，自定义卡不入索引')

    index = build_index(brands + customs)
    slim = [{
        'id': e['id'], 'name': e['name'], 'cn': e['cn'],
        't': [[x['t'], x['f'], x['i'], x['w']] for x in e['terms']],
    } for e in index]

    print('\n=== 排序自测（L层级/W重要度/命中词条）===')
    for q in ['ning', 'ndsd', 'byd', 'hw', 'ping', 'mt', 'sf', 'ms', '苹果', 'logi', 'ls', 'lsym', 'ydd']:
        r = [(h[1]['name'], h[0]) for h in search(q, index)][:4]
        print(' ', q.ljust(8), '->',
              ' | '.join('%s [L%d/W%d 命中「%s」]' % (n, lv, w, hit)
                         for n, (lv, w, p, hit) in r))

    payload = json.dumps(slim, ensure_ascii=False, separators=(',', ':'))
    open(OUT, 'w', encoding='utf-8').write(HEADER + payload + ';\n')

    print()
    print('词条数：', sum(len(e['terms']) for e in index))
    print('已写出：', os.path.relpath(OUT, ROOT),
          '(%d 字符, %d 品牌)' % (len(payload), len(slim)))