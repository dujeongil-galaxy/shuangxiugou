# -*- coding: utf-8 -*-
# 临时脚本：同步喜茶详情页与两处 noscript 清单
import subprocess, sys

ROOT = r'C:\Users\dujeo\WorkBuddy\2026-10-13-03-23-38\shuangxiugou'

edits = {
    'brand/heytea.html': [
        # meta / og / ld+json 里的描述
        ('真实双休率 待核实，平均下班时间 待核实。',
         '真实双休率 0%（由公示的做六休一口径换算，非实测投票），平均下班时间待核实。'),
        # 数据格
        ('<div class="kv"><p class="k">真实双休率</p><p class="v">未核实</p></div>',
         '<div class="kv"><p class="k">真实双休率</p><p class="v">0%</p></div>'),
        ('<div class="kv"><p class="k">休息制度</p><p class="v" style="font-size:15px">门店做六休一（月休 4 天）/ 加盟门店执行不一</p></div>',
         '<div class="kv"><p class="k">休息制度</p><p class="v" style="font-size:15px">官网口径月休 6 天 / 门店实际做六休一（月休 4 天）</p></div>'),
        # 评级理由补官网对照
        ('<li>「不满工时不可吃饭」属连锁茶饮行业通病：午晚饭点正是爆单期，非喜茶独有</li></ul>',
         '<li>「不满工时不可吃饭」属连锁茶饮行业通病：午晚饭点正是爆单期，非喜茶独有</li>'
         '<li>喜茶官网招聘首页公示「门店配备月休 6 天制」，与广州黄埔直营店招聘页、'
         '站长线下核实的「月休 4 天」不一致。官网属总部招聘口径，门店实际执行更紧；'
         '本站采信两个独立来源一致的 4 天，官网 6 天一并列出供读者对照</li></ul>'),
    ],
    'index.html': [
        ('<li><strong><a href="./brand/heytea.html">喜茶 (HEYTEA)</a></strong>：C 级 · 真实双休率 null% · 平均下班 null</li>',
         '<li><strong><a href="./brand/heytea.html">喜茶 (HEYTEA)</a></strong>：C 级 · 真实双休率 0%（口径换算） · 平均下班 null</li>'),
        ('<li><a href="./brand/heytea.html">喜茶 (HEYTEA)</a> —— C 级 · 双休率 null% · 平均下班 null</li>',
         '<li><a href="./brand/heytea.html">喜茶 (HEYTEA)</a> —— C 级 · 双休率 0%（口径换算） · 平均下班 null</li>'),
    ],
    'projects.html': [
        ('<li><a href="./brand/heytea.html">喜茶 (HEYTEA)</a> —— C 级 · 双休率 null% · 平均下班 null</li>',
         '<li><a href="./brand/heytea.html">喜茶 (HEYTEA)</a> —— C 级 · 双休率 0%（口径换算） · 平均下班 null</li>'),
    ],
}

for rel, pairs in edits.items():
    path = ROOT + '\\' + rel.replace('/', '\\')
    b = open(path, 'rb').read()
    orig = b
    for old, new in pairs:
        o = old.encode('utf-8')
        n = new.encode('utf-8')
        c = b.count(o)
        if c == 0:
            print('  跳过（未找到）%s :: %s' % (rel, old[:50]))
            continue
        b = b.replace(o, n)
        print('  ok(%d) %s :: %s' % (c, rel, old[:46]))
    if b != orig:
        open(path, 'wb').write(b)
        print('已写入', rel)