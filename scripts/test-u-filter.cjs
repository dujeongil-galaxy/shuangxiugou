// 【本机专用 · 不挂 CI】依赖本机无头 Edge 绝对路径，CI runner 无此文件；真渲染复现只在本机跑（verify §21o 咬此标记）。
const { cacheRoot, cacheDir } = require('./_cache-dir.cjs');
/* test-u-filter.cjs —— 真渲染复现「U级筛选下出现 C 级卡片」bug
 * 无头 Edge + CDP。启动本地静态服务器（根路径映射到 index.html），
 * 加载首页 → 等 React 渲染 → 点 U 级按钮 → 收集可见卡片及徽标。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const ROOT = path.resolve(__dirname, '..');
const SERVER_PORT = 8762;
const DEBUG_PORT = 8763;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.svg':'image/svg+xml', '.png':'image/png', '.ico':'image/x-icon' };

function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let rel = decodeURIComponent(req.url.split('?')[0]);
      if (rel === '/' || rel === '') rel = '/index.html';
      const fp = path.join(ROOT, rel);
      if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
        res.writeHead(404); res.end('nf'); return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
      fs.createReadStream(fp).pipe(res);
    });
    srv.listen(SERVER_PORT, () => resolve(srv));
  });
}

function cdpConnect() {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${DEBUG_PORT}/json/list`, (r) => {
      let d = ''; r.on('data', c => d += c); r.on('end', () => {
        const list = JSON.parse(d);
        const target = (list || []).find(t => t.type === 'page' && t.webSocketDebuggerUrl);
        if (!target) return reject(new Error('no page target: ' + d));
        const url = target.webSocketDebuggerUrl;
        const ws = new WebSocket(url);
        const pending = {};
        let id = 0;
        ws.on('open', () => resolve({
          send(method, params = {}) {
            return new Promise((res, rej) => {
              const mid = ++id; pending[mid] = { res, rej };
              ws.send(JSON.stringify({ id: mid, method, params }));
            });
          },
          on(event, cb) { ws.on('message', (m) => { const o = JSON.parse(m); if (o.method === event) cb(o.params); }); },
          close() { ws.close(); }
        }));
        ws.on('message', (m) => {
          const o = JSON.parse(m);
          if (o.id && pending[o.id]) { const p = pending[o.id]; delete pending[o.id]; o.error ? p.rej(new Error(o.error.message)) : p.res(o.result); }
        });
        ws.on('error', reject);
      });
    });
  });
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  const srv = await serve();
  const prof = path.join(cacheRoot(), 'sxg-u-filter-' + Date.now());
  const edge = spawn(EDGE, ['--headless=new','--no-sandbox','--disable-gpu','--no-proxy-server','--proxy-bypass-list=*','--proxy-server=direct://','--remote-debugging-port='+DEBUG_PORT,'--user-data-dir='+prof,'about:blank'], { stdio: 'ignore' });
  await sleep(2000);
  const cdp = await cdpConnect();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable');
  const pageLogs = [];
  cdp.on('Runtime.exceptionThrown', (e) => { pageLogs.push('EXC: ' + JSON.stringify(e.exceptionDetails && (e.exceptionDetails.exception && e.exceptionDetails.exception.description || e.exceptionDetails.text))); });
  cdp.on('Runtime.consoleAPICalled', (e) => { try { pageLogs.push(e.type + ': ' + e.args.map(a => (a.value !== undefined ? a.value : (a.description || ''))).join(' ')); } catch (_) {} });

  async function nav() {
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${SERVER_PORT}/?nocache=${Date.now()}` });
    await sleep(3500); // 等 React + 自定义卡 + 拼音索引 + 补丁多拍
  }
  async function evaluate(expr) {
    const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  }
  // 收集可见品牌卡及徽标
  const COLLECT = `(()=>{const cards=[...document.querySelectorAll('div.bg-white.rounded-2xl.border')];const out=[];for(const c of cards){if(!c.offsetParent)continue;if(/虚拟对比黑榜/.test(c.textContent))continue;let badge='';const hs=[...c.querySelectorAll('span,div')];for(const n of hs){if(badge)break;const m=/^(S|A|B|C|D|U)\\s*级/.exec((n.textContent||'').trim());if(m)badge=m[0];}const h=c.querySelector('h3,h2');const disp=c.style.display;out.push((h?h.textContent.slice(0,16):'?')+' | '+badge+' | display='+(disp||'')+(c.getAttribute('data-sxg-gf')?' [GF]':''));}return out;})()`;

  const report = {};
  // 先看 U 级按钮是否存在 + 当前评级条按钮
  await nav();
  report.structure = await evaluate(`(()=>{const spans=[...document.querySelectorAll('span')];const bar=spans.find(s=>(s.textContent||'').trim()==='评级过滤:');if(!bar)return 'no bar';const btns=[...bar.parentElement.querySelectorAll('button')].map(b=>b.textContent.trim());return {btns};})()`);
  // 确认 customCardsMeta 是否全局可访问，以及品牌卡是否落入其中
  report.metaCheck = await evaluate(`(()=>{
    const has = (typeof window.customCardsMeta !== 'undefined');
    const keys = has ? Object.keys(window.customCardsMeta) : [];
    const snack = document.getElementById('snack-card');
    return { hasMeta: has, metaCount: keys.length, sampleKeys: keys.slice(0,6), snackInMeta: has ? !!window.customCardsMeta['snack-card'] : 'n/a', snackExists: !!snack };
  })()`);

  async function clickRating(text) {
    return evaluate(`(()=>{const spans=[...document.querySelectorAll('span')];const bar=spans.find(s=>(s.textContent||'').trim()==='评级过滤:');if(!bar)return 'no bar';const btns=[...bar.parentElement.querySelectorAll('button')];const b=btns.find(x=>(x.textContent||'').trim()===${JSON.stringify(text)});if(!b)return 'no btn '+${JSON.stringify(text)};b.click();return 'clicked '+${JSON.stringify(text)};})()`);
  }

  // 场景 A：从全部直接点 U 级
  await clickRating('U 级');
  await sleep(1500);
  report.A_fromAll = await evaluate(COLLECT);
  // 场景 A 之后：检查品牌卡 id 是否带 -card 后缀
  report.A_cardIds = await evaluate(`(()=>{const cards=[...document.querySelectorAll('div.bg-white.rounded-2xl.border')].filter(c=>c.querySelector('h3,h2'));const out=[];for(const c of cards.slice(0,8)){const h=c.querySelector('h3,h2');out.push((h?h.textContent.slice(0,10):'?')+' => id='+(c.id||'(none)'));}return out;})()`);

  // 场景 B：先点 C 级，再点 U 级
  await clickRating('全部评级');
  await sleep(800);
  await clickRating('C 级');
  await sleep(800);
  await clickRating('U 级');
  await sleep(1500);
  report.B_fromC = await evaluate(COLLECT);

  // 再次全量核对：U 级按钮激活态、gfActive 推导（看哪些卡带 data-sxg-tier=U）
  report.uTierCards = await evaluate(`(()=>{const cards=[...document.querySelectorAll('div.bg-white.rounded-2xl.border')];return cards.filter(c=>c.getAttribute('data-sxg-tier')==='U').map(c=>{const h=c.querySelector('h3,h2');return h?h.textContent.slice(0,16):'?';});})()`);

  // 场景 C：先点四格「避雷预警」再点 U 级（stat-filter 与 u-grade-patch 两套筛选打架路径）
  await clickRating('全部评级');
  await sleep(600);
  await evaluate(`(()=>{const divs=[...document.querySelectorAll('div')];const box=divs.find(d=>d.children.length===0&&(d.textContent||'').trim()==='避雷预警');if(box&&box.parentElement)box.parentElement.click();return !!box;})()`);
  await sleep(600);
  report.C_beforeUBtn = await evaluate(`(()=>{const cards=[...document.querySelectorAll('div.bg-white.rounded-2xl.border')].filter(c=>c.querySelector('h3,h2'));const vis=cards.filter(c=>c.offsetParent);const lei=document.querySelector('[data-sxg-stat="lei"]');return {visibleAfterFourGrid:vis.length, leiActive: lei?lei.getAttribute('data-sxg-active'):'no-box'};})()`);
  await clickRating('U 级');
  await sleep(1500);
  report.C_fourGridThenU = await evaluate(COLLECT);
  // 诊断：U 按钮激活态、隐藏计数、四格是否仍 active、被隐藏卡是否带 GF_MARK
  report.C_diag = await evaluate(`(()=>{const uBtn=[...document.querySelectorAll('button')].find(b=>(b.textContent||'').trim()==='U 级');const cards=[...document.querySelectorAll('div.bg-white.rounded-2xl.border')].filter(c=>c.querySelector('h3,h2'));const hidden=cards.filter(c=>!c.offsetParent);const gfHidden=hidden.filter(c=>c.getAttribute('data-sxg-gf'));const lei=document.querySelector('[data-sxg-stat="lei"]');return {uBtnActive: uBtn?(uBtn.className||'').includes('bg-slate-900'):'no-btn', hiddenCount:hidden.length, gfMarked:gfHidden.length, leiActive: lei?lei.getAttribute('data-sxg-active'):'no-box'};})()`);
  // 复刻 gfApply 分类，找出可见非 U 卡为何没被藏
  report.C_classify = await evaluate(`(()=>{
    function gfIsCard(n){return !!n.querySelector('h3,h2');}
    function gfCardTier(card){
      if((card.textContent||'').indexOf('虚拟对比黑榜')!==-1)return 'V';
      var f=card.getAttribute('data-sxg-tier'); if(f)return f;
      var nodes=card.querySelectorAll('span,div');
      for(var i=0;i<nodes.length;i++){var s=(nodes[i].textContent||'').trim();var m=/^(S|A|B|C|D|U)\\s*级/.exec(s);if(m)return m[1];}
      return null;
    }
    const cards=[...document.querySelectorAll('div.bg-white.rounded-2xl.border')].filter(c=>c.querySelector('h3,h2'));
    const vis=cards.filter(c=>c.offsetParent);
    let branch={noCard:0,noTier:0,isU:0,willHide:0};
    const sample=[];
    const idSamples=[];
    let withCardId=0;
    for(const c of vis){
      const h=c.querySelector('h3,h2'); const name=h?h.textContent.slice(0,12):'?';
      if(c.id && /-card$/.test(c.id)) withCardId++;
      if(!gfIsCard(c)){branch.noCard++; if(sample.length<5)sample.push('noCard:'+name); continue;}
      const t=gfCardTier(c);
      if(!t){branch.noTier++; if(sample.length<8)sample.push('noTier:'+name); continue;}
      if(t==='U'){branch.isU++; continue;}
      branch.willHide++; if(sample.length<8)sample.push('willHide-but-visible:'+name+'['+t+']');
      if(idSamples.length<6 && /赵一鸣|阿里巴巴|零食有鸣|兵立王|一点点/.test(name)) idSamples.push(name+' => id='+(c.id||'(none)'));
    }
    return {visibleBrandCards:vis.length, withCardIdSuffix:withCardId, branch, sample, idSamples};
  })()`);

  // 场景 D：四格「避雷预警」+ React C 级 + 点 U 级
  await clickRating('全部评级');
  await sleep(400);
  await evaluate(`(()=>{const divs=[...document.querySelectorAll('div')];const box=divs.find(d=>d.children.length===0&&(d.textContent||'').trim()==='避雷预警');if(box&&box.parentElement)box.parentElement.click();return !!box;})()`);
  await sleep(400);
  await clickRating('C 级');
  await sleep(600);
  await clickRating('U 级');
  await sleep(1500);
  report.D_fourGridCThenU = await evaluate(COLLECT);

  console.log(JSON.stringify(report, null, 2));
  console.log('=== PAGE LOGS (console/exception) ===');
  console.log(pageLogs.slice(-25).join('\n'));
  cdp.close(); edge.kill('SIGKILL'); srv.close();
  try { fs.rmSync(prof, { recursive: true, force: true }); } catch (e) {}
}
main().catch(e => { console.error(e); process.exit(1); });
