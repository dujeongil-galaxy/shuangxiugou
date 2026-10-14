"""提取全部品牌卡数据（含证据链）→ _brands.json"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
os.chdir(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import re, json

s = open('assets/index-YthXZ9eP.js', encoding='utf-8').read()
seg_start = s.find('brands:[')
seg_end = s.find('},{id:`post-1`')
seg = s[seg_start:seg_end if seg_end > seg_start else len(s)]

pat = re.compile(r'\{id:`([a-z0-9-]+)`,name:`([^`]+)`,companyName:')
cards = [(m.group(1), m.group(2), m.start()) for m in pat.finditer(seg)]

TIER_DESC = {'S': '模范标杆，严格双休', 'A': '合规双休，接近 965',
             'B': '大小周或数据存疑', 'C': '严重超时、存在通报违约记录'}

def f_str(chunk, key):
    m = re.search(rf'{key}:`([^`]*)`', chunk)
    return m.group(1) if m else None

def f_val(chunk, key):
    m = re.search(rf'{key}:`([^`]*)`', chunk)
    if m: return m.group(1)
    m = re.search(rf'{key}:(null|true|false|-?\d+(?:\.\d+)?)', chunk)
    return m.group(1) if m else None

def array_slice(chunk, key):
    """返回 `key:[...]` 的完整内容（含配对的括号）"""
    i = chunk.find(key + ':[')
    if i < 0: return None
    start = chunk.find('[', i)
    depth = 0
    for k in range(start, len(chunk)):
        if chunk[k] in '[{': depth += 1
        elif chunk[k] in ']}':
            depth -= 1
            if depth == 0:
                return chunk[start:k + 1]
    return None

def evidence_list(chunk):
    body = array_slice(chunk, 'evidence')
    if not body: return []
    out = []
    for m in re.finditer(r'\{id:`(ev-[a-z0-9-]+)`', body):
        st = m.start()
        # 用花括号配平切出单条
        depth = 0
        for k in range(st, len(body)):
            if body[k] == '{': depth += 1
            elif body[k] == '}':
                depth -= 1
                if depth == 0:
                    one = body[st:k + 1]
                    break
        else:
            one = body[st:]
        out.append({
            'id': m.group(1), 'date': f_str(one, 'date'), 'type': f_str(one, 'type'),
            'title': f_str(one, 'title'), 'caseNumber': f_str(one, 'caseNumber'),
            'summary': f_str(one, 'summary'), 'url': f_str(one, 'sourceUrl'),
        })
    return out

def reasons_list(chunk):
    body = array_slice(chunk, 'reasons')
    return re.findall(r'`([^`]{6,})`', body) if body else []

out = []
for i, (cid, name, pos) in enumerate(cards):
    end = cards[i + 1][2] if i + 1 < len(cards) else len(seg)
    chunk = seg[pos:end]
    t = f_str(chunk, 'tier')
    out.append({
        'id': cid, 'name': name, 'company': f_str(chunk, 'companyName'),
        'category': f_str(chunk, 'category'), 'tier': t, 'tierDesc': TIER_DESC.get(t, ''),
        'rate': f_val(chunk, 'realDoubleWeekendRate'), 'off': f_val(chunk, 'avgOffWorkTime'),
        'policy': f_str(chunk, 'weekendPolicyLabel'), 'overtime': f_str(chunk, 'overtimeLabel'),
        'summary': f_str(chunk, 'summary'),
        'reasons': reasons_list(chunk), 'evidence': evidence_list(chunk),
    })

out = [c for c in out if '虚构' not in c['name']]
json.dump(out, open('_brands.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

noev = [c['name'] for c in out if not c['evidence']]
nourl = [c['name'] for c in out for e in c['evidence'] if not e['url']]
print(f'品牌数 {len(out)} | 无证据 {len(noev)} | 证据缺 URL {len(set(nourl))}')
c = out[0]
print(f'\n抽样：{c["name"]}')
print(f'  {c["tier"]} 级 | 双休率 {c["rate"]} | 下班 {c["off"]}')
print(f'  理由 {len(c["reasons"])} 条')
for e in c['evidence']:
    print(f'  证据: {e["date"]} | {e["title"][:30]} | {(e["url"] or "无URL")[:44]}')
