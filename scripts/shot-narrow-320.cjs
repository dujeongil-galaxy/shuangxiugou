/**
 * shot-narrow-320.cjs —— 首页窄屏（默认 320px，可传宽度参数）真渲染验收
 * --------------------------------------------------------------------------
 * 由 2026-11-03 的 320px 修复而来：良配吸底条在 320px 下竖排爆炸（356px 高），
 * 把 --sxg-bar-h 垫高、整组悬浮按钮顶出屏幕。本脚本量化三件事并截图：
 *   ① 吸底条实际高度（--sxg-bar-h）——320px 修复后应回落到 ~100px 以内
 *   ② 提醒按钮是否在视口内、底下压的是什么元素
 *   ③ 文档横向溢出（docOverflowX 必须 0）
 * 折叠态 / 公告栏展开态各测一轮、各截一张（含隐藏按钮的对照图）。
 * 跑法：node scripts/shot-narrow-320.cjs [宽度，默认 320]
 * 注意：必须走 http —— file:// 下 React 挂不上，测到的是 .sxg-boot 占位符。
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const WIDTH = parseInt(process.argv[2], 10) || 320;
const ROOT = path.resolve(__dirname, '..');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9477;
const SHOT_DIR = 'D:/WebArchive/_shots/remind-320';
fs.mkdirSync(SHOT_DIR, { recursive: true });

const getJson = (p) => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: PORT + 100, path: p }, (r) => {
    let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
  }).on('error', rej);
});

// 静态服务（file:// 下 React 挂不上，必须 http）
const server = http.createServer((req, res) => {
  let p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (p.endsWith('/') || p.endsWith('\\')) p = path.join(p, 'index.html');
  fs.readFile(p, (err, data) => {
    if (err) { res.writeHead(404); res.end('nf'); return; }
    const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' }[path.extname(p)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime + '; charset=utf-8' });
    res.end(data);
  });
});

(async () => {
  await new Promise((r) => server.listen(PORT, r));
  const prof = path.join(require('node:os').tmpdir(), 'edgeprof-320');
  const p = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${PORT + 100}`,
    `--user-data-dir=${prof}`, '--disable-gpu', '--hide-scrollbars',
    'about:blank'], { stdio: 'ignore' });

  let targets = null;
  for (let i = 0; i < 60; i++) {
    try { targets = await getJson('/json/list'); if (targets.length) break; } catch { }
    await new Promise((r) => setTimeout(r, 300));
  }
  const page = targets.find((t) => t.type === 'page');
  if (!page) { console.log('无 page target'); p.kill(); process.exit(1); }

  const WebSocket = require('ws');
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 64 * 1024 * 1024 });
  let id = 0; const pending = new Map();
  const send = (method, params) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  await new Promise((r) => ws.on('open', r));
  ws.on('message', (m) => { const d = JSON.parse(m); if (d.id && pending.has(d.id)) { pending.get(d.id)(d.result); pending.delete(d.id); } });

  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    return r && r.result ? r.result.value : null;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    if (r && r.data) fs.writeFileSync(path.join(SHOT_DIR, name + '.png'), Buffer.from(r.data, 'base64'));
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: 640, deviceScaleFactor: 2, mobile: true });
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });

  // 等 React 真挂载（.sxg-boot 占位消失），别只等静态公告栏
  let mounted = false;
  for (let i = 0; i < 150; i++) {
    mounted = await ev(`!document.querySelector('.sxg-boot')`);
    if (mounted) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  console.log('React 挂载:', mounted);
  if (!mounted) console.log('⚠️ 30s 内 .sxg-boot 未消失，测到的可能是占位符，数据不可信');
  await new Promise((r) => setTimeout(r, 1500));
  // 清抖音弹窗
  await ev(`[].slice.call(document.querySelectorAll('.dyp,.dyp-backdrop,[class*="dyp"]')).forEach(function(n){n.remove()})`);
  // file:// 下遮罩移除轮询可能没跑完，手动移除加载遮罩
  await ev(`[].slice.call(document.querySelectorAll('.sxg-loading')).forEach(function(n){n.remove()})`);
  // 申诉弹窗先「拒绝并关闭」（真实浏览器里 display:flex 压过 [hidden]，得连 display 一起动）
  await ev(`(function(){
    var r = [];
    if (window.__SXGAppealPolicy) { window.__SXGAppealPolicy.closeModal(); r.push('api'); }
    var m = document.getElementById('sxg-appeal-policy');
    if (m) { m.style.display = 'none'; r.push('style'); }
    return r.join(',') || 'no-modal';
  })()`);

  const probe = async (tag) => {
    const g = await ev(`(function(){
      var n = document.getElementById('evidence-notice');
      var b = document.getElementById('sxg-remind-btn');
      if (!n || !b) return { err: 'missing', n: !!n, b: !!b };
      var rb = b.getBoundingClientRect();
      // 按钮底下压着什么：中心点 + 左右两肩 elementFromPoint（先把按钮自己 pointer-events 关掉）
      b.style.pointerEvents = 'none';
      var cx = rb.left + rb.width/2, cy = rb.top + rb.height/2;
      function pick(x, y) {
        var el = document.elementFromPoint(x, y);
        if (!el) return null;
        var t = (el.textContent || '').replace(/\\s+/g, ' ').trim();
        return { tag: el.tagName + '.' + String(el.className).split(' ')[0], text: t.slice(0, 60) };
      }
      var under = { center: pick(cx, cy), left: pick(rb.left + 4, cy), right: pick(rb.right - 4, cy) };
      b.style.pointerEvents = '';
      var rn = n.getBoundingClientRect();
      // 公告栏以后的内容起点：紧跟公告栏的第一个可见块
      return {
        notice: { top: Math.round(rn.top), bottom: Math.round(rn.bottom), left: Math.round(rn.left), right: Math.round(rn.right), h: Math.round(rn.height) },
        btn: { left: Math.round(rb.left), right: Math.round(rb.right), top: Math.round(rb.top), bottom: Math.round(rb.bottom) },
        under: under,
        barH: getComputedStyle(document.documentElement).getPropertyValue('--sxg-bar-h'),
        checked: (document.getElementById('notice-more') || {}).checked,
        scrollY: Math.round(window.scrollY),
        docOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth
      };
    })()`);
    console.log(tag, JSON.stringify(g, null, 1));
    return g;
  };

  // 折叠态
  await ev(`window.scrollTo(0,0)`);
  await new Promise((r) => setTimeout(r, 300));
  await shot(`1-collapsed-${WIDTH}`);
  await probe('【折叠态】');
  // 折叠态：按钮盖住的区域（把按钮藏起来对照截图）
  await ev(`document.getElementById('sxg-remind-btn').style.display='none'`);
  await shot(`1b-collapsed-nobtn-${WIDTH}`);
  await ev(`document.getElementById('sxg-remind-btn').style.display=''`);

  // 展开态
  await ev(`var cb=document.getElementById('notice-more'); if(cb){cb.checked=true; cb.dispatchEvent(new Event('change',{bubbles:true}));}`);
  await new Promise((r) => setTimeout(r, 400));
  await shot(`2-expanded-${WIDTH}`);
  await probe('【展开态】');
  await ev(`document.getElementById('sxg-remind-btn').style.display='none'`);
  await shot(`2b-expanded-nobtn-${WIDTH}`);
  await ev(`document.getElementById('sxg-remind-btn').style.display=''`);

  ws.close();
  p.kill();
  server.close();
})();
