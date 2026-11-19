// 良配口令弹窗行为测试（2026-11-19 站长指令：toast → 居中弹窗）。
// 真 DOM 验证（jsdom 加载 liangpei-ad.js），钉死「上文步骤 + 下文口令」结构、
// 复制按钮反馈、三通道关闭、口令常驻可见——源码写得对、渲染失效的老坑不复发。
// 跑法：node scripts/test-lp-modal.cjs（需 jsdom，仓库已装）
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const css = fs.readFileSync(path.join(ROOT, 'liangpei-ad.css'), 'utf8');
const jsSrc = fs.readFileSync(path.join(ROOT, 'liangpei-ad.js'), 'utf8');

let pass = 0, fail = 0;
const fails = [];
const check = (l, c, x) => {
  if (c) { pass++; console.log('  ✓', l); }
  else { fail++; fails.push(l); console.log('  ✗', l, x !== undefined ? JSON.stringify(x).slice(0, 140) : ''); }
};

console.log('=== 良配口令弹窗行为验证 ===\n');

// ---------- 1. 静态结构 ----------
console.log('--- 弹窗结构 ---');
check('JS 用 showModal（旧 showToast 清零）',
  /showModal/.test(jsSrc) && !/showToast/.test(jsSrc));
check('旧 .lp-ad-toast 类名零残留',
  !/lp-ad-toast/.test(jsSrc) && !/lp-ad-toast/.test(css));
check('弹窗结构：步骤(steps)+口令(code)+复制按钮(copy)',
  /lp-modal__steps/.test(jsSrc) && /lp-modal__code/.test(jsSrc) && /lp-modal__copy/.test(jsSrc));
check('弹窗口令渲染 CONFIG.scheme',
  /lp-modal__code">' \+ CONFIG\.scheme/.test(jsSrc));
check('口令是真实小程序 scheme（#小程序:// 开头）',
  /scheme:\s*'#小程序:\/\//.test(jsSrc));
check('三通道关闭：× / 遮罩 / Esc',
  /lp-modal__close/.test(jsSrc) && /lp-modal__mask/.test(jsSrc) && /Escape/.test(jsSrc));
check('复制按钮有完成反馈态（is-done）',
  /is-done/.test(jsSrc));
check('弹窗 CSS 用 display:none↔flex 显隐（无 visibility 过渡）',
  /\.lp-modal\s*\{[^}]*display:\s*none/s.test(css)
    && /\.lp-modal\.is-show\s*\{[^}]*display:\s*flex/s.test(css)
    && !/\.lp-modal[^_]*\{[^}]*visibility:\s*hidden/s.test(css));
check('弹窗层级 10001（高于广告卡 9990，低于 .dyp 100000）',
  /z-index:\s*10001/.test(css.match(/\.lp-modal\s*\{[\s\S]*?\}/)[0]));

// ---------- 2. jsdom 真渲染：CTA 点击 → 弹窗出现 ----------
console.log('\n--- 浏览器行为实测 ---');
const schemeM = /scheme:\s*'([^']*)'/.exec(jsSrc);
const SCHEME = schemeM ? schemeM[1] : '';

const dom = new JSDOM(`<!doctype html><html><body></body></html>`, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'https://dujeongil-galaxy.github.io/shuangxiugou/index.html',
});
const w = dom.window;
// jsdom 无剪贴板 API：让 copyText 走同步 execCommand 分支且可判定
w.document.execCommand = () => true;
// UA 固定非微信（微信内 CTA 直接放行跳转，不走弹窗分支）
Object.defineProperty(w.navigator, 'userAgent', {
  value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0 Safari/537.36',
  configurable: true,
});

// 用 window.eval 直接执行：jsdom 构造完成后 readyState 已是 complete，
// init() 同步 build，CTA 立即在 DOM 里。（document.write 注入会把 init
// defer 到 DOMContentLoaded，同步检查时广告还没 build——老写法的坑。）
// jsdom 不实现 matchMedia：liangpei-ad.js build() 里 wideQuery 一行无保护直调，
// 不 mock 会在 DOMContentLoaded 回调里抛 TypeError（Uncaught，广告 build 半途而废）
w.matchMedia = () => ({
  matches: false,
  addEventListener() {}, addListener() {},
  removeEventListener() {}, removeListener() {},
});

w.eval(jsSrc);
// jsdom 构造完成后 readyState 仍是 loading，init() 被 defer 到 DOMContentLoaded；
// 必须等它触发后 CTA 才 build 完成——eval 后同步 querySelector 必然为空。
w.document.addEventListener('DOMContentLoaded', function () {
const cta = w.document.querySelector('.lp-ad__cta');
check('广告 CTA 存在', !!cta);
if (cta) {
  cta.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  // copyText 内部 tryClipboardApi 是 Promise，放微任务队列
  Promise.resolve().then(() => Promise.resolve()).then(() => {
    const modal = w.document.querySelector('.lp-modal');
    check('点击 CTA 后弹窗出现', !!modal);
    check('弹窗带 is-show（可见）', modal && modal.classList.contains('is-show'));
    check('上文步骤含「粘贴到微信」', modal && /粘贴到微信/.test(modal.textContent));
    check('上文步骤含「点自己刚发出」', modal && /点自己刚发出/.test(modal.textContent));
    const code = modal && modal.querySelector('.lp-modal__code');
    check('下文口令渲染 scheme 本体', code && code.textContent === SCHEME, code && code.textContent);
    check('口令含 #小程序:// 前缀', code && /^#小程序:\/\//.test(code.textContent));
    const copyBtn = modal && modal.querySelector('.lp-modal__copy');
    check('复制按钮存在', !!copyBtn);
    // 点复制按钮 → 文字反馈
    if (copyBtn) {
      copyBtn.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
      Promise.resolve().then(() => Promise.resolve()).then(() => {
        check('复制后按钮出现「已复制」反馈',
          /已复制/.test(copyBtn.textContent), copyBtn.textContent);
        // 三通道关闭逐一验证
        const closeBtn = modal.querySelector('.lp-modal__close');
        closeBtn.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
        check('点 × 关闭（is-show 移除）', !modal.classList.contains('is-show'));
        // 再开 → 遮罩关闭
        // copyText 链路（reject→catch→then showModal）要 4 个微任务 tick，
        // 等待也用两层 .then(() => Promise.resolve())（同首次点击），否则 check 跑在 showModal 之前
        cta.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
        Promise.resolve().then(() => Promise.resolve()).then(() => {
          check('再次点击 CTA 弹窗重开', modal.classList.contains('is-show'));
          modal.querySelector('.lp-modal__mask').dispatchEvent(
            new w.MouseEvent('click', { bubbles: true, cancelable: true }));
          check('点遮罩关闭', !modal.classList.contains('is-show'));
          // 再开 → Esc 关闭
          cta.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
          Promise.resolve().then(() => Promise.resolve()).then(() => {
            check('第三次点击 CTA 弹窗重开', modal.classList.contains('is-show'));
            w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            check('Esc 关闭', !modal.classList.contains('is-show'));

            console.log('\n' + '='.repeat(52));
            console.log(`通过 ${pass} 项，失败 ${fail} 项`);
            if (fail) console.log('失败项：\n  - ' + fails.join('\n  - '));
            process.exit(fail ? 1 : 0);
          });
        });
      });
    } else {
      finishEarly();
    }
  });
} else {
  finishEarly();
}
}); // ——— DOMContentLoaded 回调结束 ———

function finishEarly() {
  console.log('\n' + '='.repeat(52));
  console.log(`通过 ${pass} 项，失败 ${fail} 项`);
  process.exit(fail ? 1 : 0);
}
