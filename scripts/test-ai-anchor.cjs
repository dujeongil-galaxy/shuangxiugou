// 验收：AI 挂件重新锚定到真正右下角后的真渲染断言
// 覆盖：①宽屏自动展开态面板位置（不得漂到中部盖住 Hero）②展开时右列三钮隐藏 ③收起后复原
const http = require('http'), fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const WS = require('ws');
const PORT = 19515, DBG = 19615, ROOT = path.resolve(__dirname, '..');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const server = http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/' || rel === '') rel = '/index.html';
  const p = path.join(ROOT, rel);
  fs.readFile(p, (e, d) => {
    if (e) { res.writeHead(404); res.end('nf'); return; }
    const ext = path.extname(p);
    const ct = ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }[ext] || 'application/octet-stream') + '; charset=utf-8';
    res.writeHead(200, { 'Content-Type': ct }); res.end(d);
  });
});
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function runCase(w, h, autoExpand, label) {
  const edge = spawn(EDGE, ['--headless=new', '--disk-cache-size=1', `--remote-debugging-port=${DBG}`,
    '--no-first-run', '--user-data-dir=' + path.join(__dirname, 'edgeprof-anchor' + Date.now())], { stdio: 'ignore' });
  await sleep(4000);
  const list = await (await fetch(`http://127.0.0.1:${DBG}/json`)).json();
  const page = list.find(t => t.type === 'page' && /127\.0\.0\.1/.test(t.url)) || list.find(t => t.type === 'page');
  const ws = new WS(page.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
  await new Promise(r => ws.on('open', r));
  let mid = 0; const pending = new Map();
  ws.on('message', raw => { const m = JSON.parse(raw); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
  const call = (m, p) => new Promise(res => { const i = ++mid; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p || {} })); });
  const ev = async x => { const r = await call('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); return r.result && r.result.result && r.result.result.value; };
  await call('Page.enable');
  await call('Runtime.enable');
  // 强制视口宽度，避免 headless window-size 与 innerWidth 不一致导致 isCompact 误判
  await call('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await call('Page.navigate', { url: `http://127.0.0.1:${PORT}/?nocache=${Date.now()}` });
  // 轮询等待面板挂载；宽屏会在 8s 后自动收起，故在收起前抓首帧展开态
  let ready = false;
  for (let i = 0; i < 40; i++) {
    const st = await ev(`(()=>{const p=document.getElementById('sxg-ai-panel');return p?(!p.hidden):'no'})()`);
    if (st === true || (!autoExpand && st !== 'no')) { ready = true; break; }
    await sleep(200);
  }
  if (!ready) { console.log('  ⚠️ 面板未在超时内就绪'); }
  if (!autoExpand) {
    await ev(`(()=>{const b=document.getElementById('sxg-ai-fab');if(b)b.click();return 'clicked';})()`);
    await sleep(600);
  }
  const open = await ev(`(()=>{
    const vh=innerHeight, vw=innerWidth;
    const panel=document.getElementById('sxg-ai-panel');
    const fab=document.getElementById('sxg-ai-fab');
    if(!panel||!fab) return JSON.stringify({missing:true});
    const pr=panel.getBoundingClientRect(), fr=fab.getBoundingClientRect();
    const disp=id=>{const e=document.getElementById(id);return e?getComputedStyle(e).display:'MISSING';};
    return JSON.stringify({
      vw,vh,
      panelHidden:panel.hasAttribute('hidden'),
      panelRect:{top:Math.round(pr.top),bottom:Math.round(pr.bottom),h:Math.round(pr.height),w:Math.round(pr.width),right:Math.round(pr.right)},
      fabRect:{top:Math.round(fr.top),bottom:Math.round(fr.bottom)},
      distBottomPanel:Math.round(vh-pr.bottom),
      topFromViewportPct:Math.round(pr.top/vh*100),
      bodyOpen:document.body.classList.contains('sxg-ai-open'),
      videoDisp:disp('sxg-video-btn'), bottomDisp:disp('sxg-bottom-btn'), remindDisp:disp('sxg-remind-btn')
    });
  })()`);
  const o = JSON.parse(open);
  console.log(`\n[${label}] ${w}x${h} 展开态:`);
  if (o.missing) { console.log('  ❌ panel/fab 未渲染'); ws.close(); edge.kill(); return ['panel/fab 未渲染']; }
  console.log('  vw/vh =', o.vw, '/', o.vh, '| panelHidden =', o.panelHidden, '| bodyOpen =', o.bodyOpen);
  console.log('  panelRect =', JSON.stringify(o.panelRect), '| 距底', o.distBottomPanel + 'px', '| 顶端占屏', o.topFromViewportPct + '%');
  console.log('  fabRect =', JSON.stringify(o.fabRect));
  console.log('  video/bottom/remind 显示 =', o.videoDisp, '/', o.bottomDisp, '/', o.remindDisp);
  const fail = [];
  if (o.panelHidden) fail.push('面板未展开');
  if (!o.bodyOpen) fail.push('body 未加 sxg-ai-open');
  if (o.topFromViewportPct < 25) fail.push('面板顶端进入首屏上部(Hero区)，占屏比' + o.topFromViewportPct + '%');
  if (o.distBottomPanel > 170) fail.push('面板距底' + o.distBottomPanel + 'px，未真正贴右下角(应≈152)');
  if (o.videoDisp !== 'none' || o.bottomDisp !== 'none' || o.remindDisp !== 'none') fail.push('展开时应隐藏的右列钮未被隐藏');
  await ev(`(()=>{const b=document.getElementById('sxg-ai-fab');if(b)b.click();return 'closed';})()`);
  await sleep(400);
  const closed = await ev(`(()=>{
    const panel=document.getElementById('sxg-ai-panel');
    return JSON.stringify({hidden:panel.hasAttribute('hidden'),bodyOpen:document.body.classList.contains('sxg-ai-open'),
      video:getComputedStyle(document.getElementById('sxg-video-btn')).display,
      bottom:getComputedStyle(document.getElementById('sxg-bottom-btn')).display,
      remind:getComputedStyle(document.getElementById('sxg-remind-btn')).display});
  })()`);
  const c = JSON.parse(closed);
  console.log('  收起后: hidden =', c.hidden, '| bodyOpen =', c.bodyOpen, '| 三钮显示 =', c.video, '/', c.bottom, '/', c.remind);
  if (!c.hidden) fail.push('收起后面板仍显示');
  if (c.bodyOpen) fail.push('收起后 body 仍带 sxg-ai-open');
  if (c.video === 'none' || c.bottom === 'none' || c.remind === 'none') fail.push('收起后右列钮未复原（仍被隐藏）');
  ws.close(); edge.kill();
  return fail;
}

(async () => {
  await new Promise(r => server.listen(PORT, r));
  let allFail = [];
  allFail = allFail.concat(await runCase(1680, 950, true, '宽屏自动展开'));
  allFail = allFail.concat(await runCase(1280, 900, false, '窄屏点开'));
  server.close();
  if (allFail.length) { console.log('\n❌ 断言失败:'); [...new Set(allFail)].forEach(f => console.log('  -', f)); process.exit(1); }
  console.log('\n✅ 全部断言通过：AI 面板已重新锚定到右下角，不盖 Hero，右列钮正确隐藏/复原');
  process.exit(0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
