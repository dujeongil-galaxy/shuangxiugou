/**
 * 等待自定义卡分批注入完成（2026-11-05）。
 *
 * 背景：80b8ffd（2026-11-04）把 122 张自定义卡从一次性同步注入改成
 * requestIdleCallback 分批渐进注入（修首屏 13s 白屏）。jsdom 没有 rIC，
 * 走 setTimeout(0) 兜底，每批 24 张重卡在 jsdom 里要 ~1s，
 * 122 张全部落齐要 5s+ —— CI/慢机上 1.5s 固定等待只能看到首批 24 张，
 * 这正是 CI 连红 36 次（run #490→#525）的根因。
 *
 * 等待判据（三个都满足才算稳）：
 *   1. window.__sxgInjectingBatch !== true（分批调度已收尾）
 *   2. 档位徽章卡数量 >= min（默认 175）
 *   3. 连续 2 次轮询数量不再增长（防「批次结束但 MO 补挂未完」）
 *
 * 用法：await waitCardsReady(window);  // 超时 throw，测试直接红
 */
module.exports = function waitCardsReady(window, opts) {
  opts = opts || {};
  const min = opts.min || 175;
  // 2026-11-08：30s → 90s。jsdom 里每插一批卡都会触发 MutationObserver 重跑
  // init()，复杂度接近 O(N²)；全套回归串行跑、或本机同时有 Edge 残留进程时，
  // 175 张卡落齐实测会超过 30s，固定短超时会把「慢」误判成「卡死」。
  // 上限放宽不影响快机（落齐即返回），只让慢机不再假红。
  const timeout = opts.timeout || 90000;
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
  // 2026-11-08：轮询从 200ms 放宽到 1000ms。
  // 本机实测：每轮 badgeCount() 要遍历 175 张卡的 span/div，200ms 一轮会把
  // Node 事件循环占满，反而把 index.html 里 setTimeout(0) 的分批注入饿住
  // —— 30s 超时时只落齐 151 张，而同一份页面空跑诊断 10s 就能落齐 175 张。
  // 放宽轮询后不再与注入链争抢主线程，慢机/CI 都不会误判为超时。
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    let last = -1, stable = 0, flagStall = 0;
    const timer = setInterval(() => {
      const n = badgeCount();
      const allIn = n >= min;
      const done = window.__sxgInjectingBatch !== true && allIn;
      if (done && n === last) {
        stable += 1;
        if (stable >= 2) { clearInterval(timer); resolve(n); return; }
      } else {
        stable = 0;
      }
      // 兜底：卡片已全部落齐且数量长时间不变，但 MutationObserver 重入会把
      // __sxgInjectingBatch 重新置 true（注入本身是幂等的，只会归位不重建）。
      // 2026-11-08 本机 test-stat-filter 实测「当前 175，batchFlag=true」卡到超时，
      // 此时已无任何新卡可落，不该让测试一直等这个瞬时标志。
      if (allIn && n === last) flagStall += 1; else flagStall = 0;
      if (flagStall >= 5) { clearInterval(timer); resolve(n); return; }
      last = n;
      if (Date.now() - t0 > timeout) {
        clearInterval(timer);
        reject(new Error('waitCardsReady 超时：' + min + ' 张未落齐（当前 ' + n + '，batchFlag=' + window.__sxgInjectingBatch + '）'));
      }
    }, 1000);
  });
};
