#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
gen-recent-brands.py —— 首页「最新新增的企业」面板数据生成器

站长 2026-11-15 指令：「在首页找个地方挂一下按钮，叫『最新新增的企业』；
至于是展示最近 x 天的，还是最新 x 条，这个你决定」→ 采用**最新 5 条**（按登记日期
倒序），因为品牌新增不是每天都有，按天窗口会经常空面板；按条数永远有内容。

单一真相源：data/recent-brands.json
产出文件：recent-brands-data.js（纯数据，定义 window.__SXG_RECENT__）
渲染脚本：recent-brands.js（DOM 补丁，挂按钮与面板，不碰压缩 bundle）

为什么拆两步：首页 index.html 由 React 大包渲染，不能直接改 bundle；
补丁脚本读全局数据渲染，数据文件由本脚本从 JSON 生成，避免两处手写清单漂移。

用法：
    python scripts/gen-recent-brands.py            # 生成并写回
    python scripts/gen-recent-brands.py --check    # 只比对，不写（CI / verify 用）

行尾纪律：仓库 .gitattributes 锁 LF，本脚本一律字节级 'rb'/'wb'，内容只用 \\n。
"""

import io
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'data', 'recent-brands.json')
OUT = os.path.join(ROOT, 'recent-brands-data.js')
BRAND_DIR = os.path.join(ROOT, 'brand')

FIELDS = ('slug', 'name', 'date', 'kind', 'grade', 'note', 'href')
GRADES = ('S', 'A', 'B', 'C', 'D', 'U')


def fail(msg):
    print('ERROR: ' + msg)
    sys.exit(1)


def validate(data):
    n = data.get('displayCount')
    if not isinstance(n, int) or n < 1:
        fail('displayCount 必须是正整数')
    entries = data.get('entries')
    if not isinstance(entries, list) or len(entries) < n:
        fail('entries 条数不足 displayCount（%s）' % n)

    for i, e in enumerate(entries):
        for k in FIELDS:
            if not isinstance(e.get(k), str) or not e[k].strip():
                fail('第 %d 条缺少字段 %s' % (i + 1, k))
        if not re.match(r'^\d{4}-\d{2}-\d{2}$', e['date']):
            fail('第 %d 条日期格式必须是 YYYY-MM-DD：%s' % (i + 1, e['date']))
        if e['grade'] not in GRADES:
            fail('第 %d 条评级非法：%s' % (i + 1, e['grade']))
        page = os.path.join(BRAND_DIR, e['slug'] + '.html')
        if not os.path.isfile(page):
            fail('第 %d 条 slug 对应详情页不存在：%s' % (i + 1, page))
        href_file = e['href'].split('#')[0].lstrip('./')
        target = os.path.join(ROOT, href_file)
        if not os.path.isfile(target):
            fail('第 %d 条 href 指向的文件不存在：%s' % (i + 1, e['href']))

    # 日期必须倒序（同日允许并列，保持文件内顺序）
    dates = [e['date'] for e in entries]
    if dates != sorted(dates, reverse=True):
        fail('entries 必须按 date 倒序排列')
    return n, entries


def build(data):
    n, entries = validate(data)
    # Python sorted 是稳定排序：同日条目保持 JSON 里的先后
    picked = sorted(entries, key=lambda e: e['date'], reverse=True)[:n]
    payload = {
        'displayCount': n,
        'total': len(entries),
        'items': [{k: e[k] for k in FIELDS} for e in picked],
    }
    body = json.dumps(payload, ensure_ascii=False, indent=2)
    text = (
        '/* 本文件由 scripts/gen-recent-brands.py 自动生成，请勿手改。\n'
        '   真相源：data/recent-brands.json（新增登记后重跑生成器）。*/\n'
        'window.__SXG_RECENT__ = ' + body + ';\n'
    )
    return text.encode('utf-8')


def main():
    try:
        raw = io.open(SRC, 'r', encoding='utf-8').read()
        data = json.loads(raw)
    except Exception as ex:
        fail('读取/解析 data/recent-brands.json 失败：%s' % ex)
    out = build(data)

    if '--check' in sys.argv:
        cur = open(OUT, 'rb').read() if os.path.isfile(OUT) else b''
        if cur != out:
            fail('recent-brands-data.js 与 JSON 不一致，请重跑 python scripts/gen-recent-brands.py')
        print('CHECK OK: recent-brands-data.js 与 data/recent-brands.json 一致')
        return

    open(OUT, 'wb').write(out)
    print('生成完成：展示最新 %d 条 / 共 %d 条，%d 字节' % (
        data['displayCount'], len(data['entries']), len(out)))


if __name__ == '__main__':
    main()
