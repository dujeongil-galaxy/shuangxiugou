/* 验证随笔页 AI 文章里 <mark> 的实际渲染色
   ——「类名写对了」≠「生效了」。这里用无头 Edge 读 computed style，
      确认：红字生效、浏览器默认黄底被去掉、font-weight 为 700。
   注意：cwd 必须是仓库根目录。 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = process.cwd();
const PORT = 8943;
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

function serve() {
  return new Promise((res) => {
    const srv = http.createServer((req, rep) => {
      const u = decodeURIComponent(req.url.split('?')[0]);
      const f = path.join(ROOT, u === '/' ? '/notes.html' : u);
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
        rep.writeHead(404); return rep.end('nope');
      }
      rep.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      rep.end(fs.readFileSync(f));
    });
    srv.listen(PORT, '127.0.0.1', () => res(srv));
  });
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

(async () => {
  const srv = await serve();
  const prof = path.join(ROOT, 'edgeprof-mark-' + Date.now());
  const args = [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--user-data-dir=' + prof, '--disk-cache-size=1', '--disable-application-cache',
    '--remote-debugging-port=' + (PORT + 100),
    'http://127.0.0.1:' + PORT + '/?nocache=' + Date.now(),
  ];
  const proc = spawn(EDGE, args, { stdio: 'ignore' });
  let ws = null;
  try {
    // 拉 /json/list 拿页面 ws 端点
    let list = null;
    for (let i = 0; i < 40; i++) {
      await sleep(500);
      try {
        list = await new Promise((res, rej) => {
          const r = http.get({ host: '127.0.0.1', port: PORT + 100, path: '/json/list' }, (rp) => {
            let b = ''; rp.on('data', (d) => (b += d)); rp.on('end', () => res(JSON.parse(b)));
          });
          r.on('error', rej); r.setTimeout(1500, () => r.destroy());
        });
        if (list && list.find((t) => t.type === 'page')) break;
      } catch (e) { /* 还没起来 */ }
    }
    const page = list.find((t) => t.type === 'page');
    if (!page) throw new Error('拿不到 CDP 页面端点');

    const WebSocket = require(path.join(ROOT, 'node_modules', 'ws'));
    ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
    await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });

    let id = 0; const pend = new Map();
    ws.on('message', (raw) => {
      const m = JSON.parse(raw);
      if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    });
    const send = (method, params) => new Promise((res, rej) => {
      const i = ++id; pend.set(i, res);
      ws.send(JSON.stringify({ id: i, method, params }));
      setTimeout(() => { if (pend.has(i)) { pend.delete(i); rej(new Error('timeout ' + method)); } }, 15000);
    });
    const evalJs = async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.result && r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.text);
      return r.result.result.value;
    };

    // 等 DOM 落地
    for (let i = 0; i < 30; i++) {
      const n = await evalJs('document.querySelectorAll(".ai-essay mark").length');
      if (n > 0) break;
      await sleep(400);
    }

    const out = JSON.parse(await evalJs(`JSON.stringify((function(){
      var ms = [].slice.call(document.querySelectorAll('.ai-essay mark'));
      if (!ms.length) return { ok:false, reason:'没有找到 mark 元素' };
      var first = ms[0], cs = getComputedStyle(first);
      var lastP = document.querySelector('.ai-essay p:last-child');
      return {
        ok: true,
        count: ms.length,
        texts: ms.slice(0,3).map(function(m){ return m.textContent.slice(0,14); }),
        color: cs.color,
        fontWeight: cs.fontWeight,
        background: cs.backgroundColor,
        borderBottom: cs.borderBottomWidth + ' ' + cs.borderBottomColor,
        lastColor: getComputedStyle(lastP).color
      };
    })())`));

    const isRed = /^rgb\(\s*(\d+),\s*(\d+),\s*(\d+)/.exec(out.color);
    const redDominant = isRed && (+isRed[1] > +isRed[2] + 60) && (+isRed[1] > 120);
    const noYellowBg = /rgba\(0, 0, 0, 0\)|transparent/.test(out.background);

    const checks = [
      ['mark 数量 > 0', out.count > 0, String(out.count)],
      ['mark 是红色', !!redDominant, out.color],
      ['浏览器默认黄底被去掉', noYellowBg, out.background],
      ['字重加粗 700', String(out.fontWeight) === '700', out.fontWeight],
      ['有红色下划线', parseFloat(out.borderBottom) > 0, out.borderBottom],
    ];
    let bad = 0;
    checks.forEach(([n, ok, v]) => { if (!ok) bad++; console.log((ok ? 'PASS ' : 'FAIL ') + n + ' → ' + v); });
    console.log('mark 样本文字:', out.texts.join(' / '));
    console.log('结尾句颜色（保留绿）:', out.lastColor);
    console.log(bad === 0 ? 'ALL-PASS' : 'FAILED(' + bad + ')');
  } finally {
    try { if (ws) ws.close(); } catch (e) {}
    try { proc.kill(); } catch (e) {}
    try { srv.close(); } catch (e) {}
    setTimeout(() => process.exit(0), 600);
  }
})().catch((e) => { console.error('ERR', e.message); setTimeout(() => process.exit(1), 600); });
