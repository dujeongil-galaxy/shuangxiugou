/**
 * 等待自定义卡分批注入完成（2026-11-05）。
 *
 * 背景：80b8ffd（2026-11-04）把 121 张自定义卡从一次性同步注入改成
 * requestIdleCallback 分批渐进注入（修首屏 13s 白屏）。jsdom 没有 rIC，
 * 走 setTimeout(0) 兜底，每批 24 张重卡在 jsdom 里要 ~1s，
 * 121 张全部落齐要 5s+ —— CI/慢机上 1.5s 固定等待只能看到首批 24 张，
 * 这正是 CI 连红 36 次（run #490→#525）的根因。
 *
 * 等待判据（三个都满足才算稳）：
 *   1. window.__sxgInjectingBatch !== true（分批调度已收尾）
 *   2. 档位徽章卡数量 >= min（默认 174）
 *   3. 连续 2 次轮询数量不再增长（防「批次结束但 MO 补挂未完」）
 *
 * 用法：await waitCardsReady(window);  // 超时 throw，测试直接红
 */
module.exports = function waitCardsReady(window, opts) {
  opts = opts || {};
  const min = opts.min || 174;
  const timeout = opts.timeout || 30000;
  const doc = window.document;
  const badgeCount = () => [...doc.querySelectorAll('div.bg-white.rounded-2xl.border')]
    .filter((c) => /^(S|A|B|C|D|U)\s*级/.test(someBadge(c))).length;
  function someBadge(card) {
    for (const n of card.querySelectorAll('span,div')) {
      const m = /^(S|A|B|C|D|U)\s*级/.exec((n.textContent || '').trim());
      if (m) return m[0];
    }
    return '';
  }
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    let last = -1, stable = 0;
    const timer = setInterval(() => {
      const n = badgeCount();
      const done = window.__sxgInjectingBatch !== true && n >= min;
      if (done && n === last) {
        stable += 1;
        if (stable >= 2) { clearInterval(timer); resolve(n); return; }
      } else {
        stable = 0;
      }
      last = n;
      if (Date.now() - t0 > timeout) {
        clearInterval(timer);
        reject(new Error('waitCardsReady 超时：' + min + ' 张未落齐（当前 ' + n + '，batchFlag=' + window.__sxgInjectingBatch + '）'));
      }
    }, 200);
  });
};
