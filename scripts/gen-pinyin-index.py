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
            # 2026-10-22：自定义卡重新进入联想，但候选点击走「定位」而非
            # 「回填搜索词」—— 详见 pinyin-search.js 的 locateCard。
            # 2026-10-30：定位链路改为「回填品牌词再滚动」（不再清空搜索），
            # fill_kw = keywords[0]（核心品牌名，必命中自身 keywords）。
            'custom': True,
            'fill_kw': kw_items[0] if kw_items else '',
        })
    return out


def native_search_keys(brands):
    """
    返回 bundle 原生搜索「真正能命中」的所有小写字面串。

    React 首页过滤只查三个字段：
        name / companyName / keyProducts
    （压缩后：ne = n.filter(e => e.name.includes(kw) || e.companyName.includes(kw)
      || e.keyProducts.some(p => p.includes(kw)))）

    为什么需要：拼音联想是「用拼音找到中文名，再回填给 React」的两步走。
    第一步命中、第二步回填却没命中，用户看到的就是
    「候选里有这家，点进去却说未找到匹配的品牌信息」（2026-10-19 用户截图）。

    ⚠️ 入参必须是 extract_brands() 的结果，不要自己再解析一遍 bundle。
       压缩产物里同一个 id 还会出现在 alternatives / recommendedAlternatives
       等引用位置，二次解析会拿错对象（实测华为被读成「华为终端 (huawei)」），
       合法品牌因此被误判「不可搜」而踢出联想。
    """
    keys = set()
    for b in brands:
        for v in (b['name'], b['company'], b['category'], b['id']):
            if v:
                keys.add(v.lower())
        for v in b['products']:
            keys.add(v.lower())
        # searchKeywords 不在 React 过滤里，但保留进来只会让判定更宽松，
        # 反而是安全隐患（放了搜不到的词）。所以不加。
    return keys


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
            # 自定义卡标记：pinyin-search.js 据此把候选点击切成「定位」语义
            'custom': bool(b.get('custom')),
            # 定位链路的回填词（仅自定义卡有）：keywords[0]，核心品牌名，
            # 必命中该卡 keywords → filterCustomCards 保持卡片显示
            'fill_kw': b.get('fill_kw') or '',
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
// 来源：assets/index-YthXZ9eP.js 的 brands 数组（剔除「虚拟对比黑榜」卡）
//       + index.html 的 customCardsConfig（自定义卡）
// 生成：scripts/gen-pinyin-index.py（依赖 pypinyin）
// 字段 t = [原文, 全拼, 首字母, 重要度]
// 重要度：0 主名 / 1 英文名 / 2 公司全称 / 3 关键词 / 4 产品名
// 字段 kw：自定义卡的定位回填词（keywords[0]），内置卡为空串
//
// ⚠️ 本文件只做「输入联想」，不改 React 原生搜索逻辑。
//    改动后必须重跑 scripts/gen-pinyin-index.py。
// ============================================================
window.__PINYIN_INDEX__ = """


if __name__ == '__main__':
    if not os.path.exists(BUNDLE):
        sys.exit('找不到 bundle：' + BUNDLE)

    brands = extract_brands(open(BUNDLE, encoding='utf-8').read())
    # 虚构对比黑榜卡（某代工烘焙食品）不对外联想 —— 它不是真实企业，
    # 也不计入收录口径，进了联想会误导「查品牌」的用户（2026-10-18 修复）。
    # 识别口径与 verify.mjs 的 FICTIONAL 一致：名称含「虚拟对比黑榜」。
    brands = [b for b in brands if '虚拟对比黑榜' not in (b['name'] or '')]
    print('从 bundle 解析出品牌数（已剔除虚拟对比卡）：', len(brands))

    if os.path.exists(INDEX_HTML):
        customs = parse_custom_configs(open(INDEX_HTML, encoding='utf-8').read())
        print('从 index.html 解析出自定义卡数：', len(customs))
    else:
        customs = []
        print('警告：找不到 index.html，自定义卡不入索引')

    # 自定义卡并入联想（2026-10-22，理由见下方 index_custom 处的长注释）：
    # 不走回填链路，候选点击走「定位」链路，因此不经过 native_keys 回查过滤。
    print('自定义卡进入联想候选（点击走定位链路，不走回填）')

    index = build_index(brands)
    # 回查 bundle：只保留真实能被原生搜索命中的回填词，避免「点了变空态」。
    native_keys = native_search_keys(brands)
    # 用来验证「这个中文字面串确实能在某条记录里搜到」，
    # 而不是「某个字段刚好等于它」—— cn 是从 name 里抽出来的，
    # 未必等于 name 或 company 全串（如「罗技」vs「Logitech (罗技)」）。
    haystack = '\n'.join(sorted(native_keys))
    safe, dropped = [], []
    for e in index:
        if e['cn'] and e['cn'].lower() in haystack:
            safe.append(e)
        else:
            dropped.append((e['id'], e['name'], e['cn']))
    index = safe
    if dropped:
        print('\n=== 以下品牌的主名不是 bundle 原生可搜字面串，已排除联想 ===')
        for did, dname, dcn in dropped:
            print('  - %s(%s)  cn=%r' % (dname, did, dcn))
    # ⚠️ 自定义卡 2026-10-22 重新进入联想候选（此前 10-19 因「点选后空态」
    #    被整体剔除，导致输「ls」永远搜不出赵一鸣/零食有鸣等零食品牌，
    #    站长截图：「关于零食这个分类，修复过无数次」）。
    #
    #    空态的根因不是「自定义卡不该被搜到」，而是「回填链路用错了」：
    #    自定义卡不在 bundle 的 brands 数组里，回填中文名给 React 必然 0 结果，
    #    而 React 的 0 结果会把整片内容替换成空态、把注入的卡片一起销毁。
    #    正确解法是换链路：自定义卡候选点击后走「定位」——（2026-10-30 起）
    #    把 keywords[0] 品牌词填进搜索框（页面进入与手动输入该词相同的
    #    稳定态：卡片显示、空态块隐藏），再滚动过去并高亮（见
    #    pinyin-search.js 的 locateCard）。旧版「清空搜索恢复全量再定位」
    #    会把用户眼前的搜索态打回 65 张全量——站长实测「点击美宜佳后
    #    自动回退」——已废弃。
    #    因此自定义卡**不经过**下面的 native_keys 回查过滤（那个过滤是
    #    为「回填链路」设计的），直接并入索引并打 custom 标记。
    index_custom = build_index(customs)
    index_all = index + index_custom

    slim = [{
        'id': e['id'], 'name': e['name'], 'cn': e['cn'],
        'custom': 1 if e['custom'] else 0,
        'kw': e['fill_kw'] if e['custom'] else '',
        't': [[x['t'], x['f'], x['i'], x['w']] for x in e['terms']],
    } for e in index_all]

    print('\n=== 排序自测（L层级/W重要度/命中词条）===')
    for q in ['ning', 'ndsd', 'byd', 'hw', 'ping', 'mt', 'sf', 'ms', '苹果', 'logi', 'ls', 'lsym', 'ydd']:
        r = [((h[1]['name'], h[1]['custom']), h[0]) for h in search(q, index_all)][:4]
        print(' ', q.ljust(8), '->',
              ' | '.join('%s [L%d/W%d 命中「%s」]%s' % (n, lv, w, hit, '（自定义·定位）' if cust else '')
                         for (n, cust), (lv, w, p, hit) in r))

    payload = json.dumps(slim, ensure_ascii=False, separators=(',', ':'))
    open(OUT, 'w', encoding='utf-8').write(HEADER + payload + ';\n')

    print()
    print('词条数：', sum(len(e['terms']) for e in index_all))
    print('已写出：', os.path.relpath(OUT, ROOT),
          '(%d 字符, %d 品牌，其中自定义卡 %d 张)'
          % (len(payload), len(slim), len(index_custom)))