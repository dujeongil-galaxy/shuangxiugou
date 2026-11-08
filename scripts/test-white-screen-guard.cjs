// 白屏崩溃兜底行为测试（2026-11-08 站长报「删空搜索后整站白屏，怕用户误退出」）
//
// 背景：整站 React 没有错误边界，任何渲染抛错都会让 React 18 卸载整棵 #root，
//       表现为纯白屏；用户会当成卡死直接关掉网页。flash 遮罩内已加「加载中…」
//       加载态，本脚本是最后一道防线：#root 被卸载时显示可点击的恢复卡片。
//
// 断言：
//   1. 首屏 #root 为空不误报（booted 门槛），error / unhandledrejection 同理
//   2. 挂载过之后 #root 变空 → 显示恢复卡片（role=alert、说明文案、按钮、样式）
//   3. 幂等：反复卸载不重复注入；重新挂载后自动移除
//   4. 静态：纯 DOM 补丁、不发请求、不碰压缩产物、层级与 boot 层不打架、无 emoji
// 故障注入红线：
//   a. 去掉 booted 门槛 → 「首屏不误报」判红
//   b. 去掉 MutationObserver / 卸载分支 → 「显示恢复卡片」判红
//   c. 去掉 shown 幂等 → 「不重复注入」判红
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'white-screen-guard.js'), 'utf8');
const GUARD_ID = 'sxg-white-guard';
let pass = 0, fail = 0;
const fails = [];
const check = (label, cond, extra) => {
  if (cond) { pass++; console.log('  ✓', label); }
  else { fail++; fails.push(label); console.log('  ✗', label, extra !== undefined ? JSON.stringify(extra) : ''); }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function makeDom(inner) {
  const dom = new JSDOM('<!doctype html><html><head></head><body>' + inner + '</body></html>',
    { runScripts: 'outside-only', url: 'http://localhost/' });
  const w = dom.window;
  w.eval(SRC);
  // 等 jsdom 把 readyState 推到 complete 并派发 DOMContentLoaded（guard 在 loading 时挂监听）
  await sleep(30);
  return { w, document: w.document, root: w.document.getElementById('root') };
}

(async () => {
  console.log('=== 白屏崩溃兜底（恢复卡片）===\n');

  // --- 1. 首屏未挂载：绝不误报 ---
  {
    const { w, document } = await makeDom('<div id="root"></div>');
    check('首屏 #root 为空时不误报崩溃（booted 门槛）', !document.getElementById(GUARD_ID));
    w.dispatchEvent(new w.Event('error'));
    check('★ 未挂载过时收到 window error 也不误报恢复卡片', !document.getElementById(GUARD_ID));
    w.dispatchEvent(new w.Event('unhandledrejection'));
    check('★ 未挂载过时收到 unhandledrejection 也不误报', !document.getElementById(GUARD_ID));
  }

  // --- 2. 挂载 → 卸载（真白屏）→ 恢复卡片 ---
  {
    const { w, document, root } = await makeDom('<div id="root"></div>');
    root.appendChild(document.createElement('div'));   // React 已挂载
    await sleep(10);
    check('应用正常挂载时不显示恢复卡片', !document.getElementById(GUARD_ID));

    root.innerHTML = '';                                // React 卸载 → 整站白屏
    await sleep(10);
    const g = document.getElementById(GUARD_ID);
    check('★ #root 从「已挂载」变空 → 显示恢复卡片（不再永久白屏）', !!g);
    check('恢复卡片带 role=alert（屏幕阅读器可播报）',
      !!g && g.getAttribute('role') === 'alert');
    check('★ 卡片文案明确「无需关闭网页」并给出「重新加载页面」按钮',
      !!g && /无需关闭网页/.test(g.textContent) && /重新加载页面/.test(g.textContent)
      && !!g.querySelector('.sxg-wg-btn'));
    check('配套样式已注入（sxg- 前缀、幂等 id）',
      !!document.getElementById('sxg-white-guard-style'));

    // 幂等：再来一次卸载，不该出现第二张卡片
    root.appendChild(document.createElement('div'));
    root.innerHTML = '';
    await sleep(10);
    check('★ 反复卸载不重复注入恢复卡片（shown 幂等）',
      document.querySelectorAll('#' + GUARD_ID).length === 1,
      document.querySelectorAll('#' + GUARD_ID).length);
    w.dispatchEvent(new w.Event('error'));
    check('已显示后再收到 error 仍只有一张卡片',
      document.querySelectorAll('#' + GUARD_ID).length === 1);

    // 应用恢复 → 卡片自动让位
    root.appendChild(document.createElement('div'));
    await sleep(10);
    check('★ React 重新挂载后恢复卡片自动移除（不挡住已恢复的页面）',
      !document.getElementById(GUARD_ID));
  }

  // --- 3. 静态口径 ---
  check('兜底是纯 DOM 补丁：不 fetch、不 XHR、不碰压缩产物',
    !/fetch\(|XMLHttpRequest|assets\/index-/.test(SRC));
  check('恢复卡片层级 2147483646 低于首屏加载层（2147483647）',
    /z-index:2147483646/.test(SRC));
  check('恢复卡片 UI 不依赖 emoji（CSS 图形，跨平台字形一致）',
    !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(SRC));
  check('按钮走 window.location.reload()，不自己拼 URL',
    /window\.location\.reload\(\)/.test(SRC));

  console.log(`\n${pass} 通过, ${fail} 失败`);
  if (fail) { console.log('FAIL:', fails.join(' | ')); process.exit(1); }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
