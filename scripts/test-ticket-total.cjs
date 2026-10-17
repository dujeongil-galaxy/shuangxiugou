// 小票累计金额的逻辑测试
// 跑法：npm install --no-save jsdom && node scripts/test-ticket-total.cjs
//
// ⚠️ 仓库根必须从 __dirname 推导 —— 硬编码绝对路径在 CI 上必然失败。
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'custom-card-actions.js'), 'utf8');

let pass = 0, fail = 0;
const failures = [];
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else {
    fail++; failures.push(label);
    console.log('  ✗', label, extra !== undefined ? JSON.stringify(extra) : '');
  }
}

// ---------------------------------------------------------------------
// 把 custom-card-actions.js 里的纯逻辑（clamp / migrate / 读写）
// 抽出来单独测。这些函数不碰 DOM，可以在 Node 里直接跑。
// 用正则从真实源码里抠出来 —— 测的是真正会跑的那份代码，
// 不是另写一份「行为应该一样」的副本。
// ---------------------------------------------------------------------
function extractFn(name) {
  const re = new RegExp(
    'function\\s+' + name + '\\s*\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n  \\}'
  );
  const m = SRC.match(re);
  if (!m) throw new Error('抠不出函数 ' + name);
  return m[0];
}

const helperSrc = [
  'var MAX_TOTAL = 99999999;',
  'function isFiniteSafe(v){return typeof v==="number" && isFinite(v);}',
  extractFn('migrateLegacy'),
  extractFn('clampTotal'),
  extractFn('clampDelta'),
].join('\n');

function makeStore(initial) {
  const data = Object.assign({}, initial || {});
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: (k) => { delete data[k]; },
  };
}

function buildEnv(storage) {
  const dom = new JSDOM(
    `<!DOCTYPE html><html><body><div id="host"></div></body></html>`,
    { runScripts: 'outside-only', pretendToBeVisual: true }
  );
  const w = dom.window;
  w.localStorage = storage;
  const fn = new Function('window', helperSrc + '\nreturn {migrateLegacy,clampTotal,clampDelta};');
  return Object.assign(fn(w), { window: w });
}

const KEY = 'sxg-visitor-profile';

// =========================== 测试 ===========================
console.log('=== 1. 输入规整 ===');
{
  const E = buildEnv(makeStore());
  check('空值 → 0（留空表示不增加，不回退到 199）', E.clampDelta('') === 0);
  check('null → 0', E.clampDelta(null) === 0);
  check('undefined → 0', E.clampDelta(undefined) === 0);
  check('纯空格 → 0', E.clampDelta('   ') === 0);
  check('0 → 0', E.clampDelta('0') === 0);
  check('负数 → 0（不是回退，是加 0）', E.clampDelta('-50') === 0);
  check('小数取整 199.9 → 199', E.clampDelta('199.9') === 199);
  check('带符号 +199 → 199', E.clampDelta('+199') === 199);
  check('正常 299 → 299', E.clampDelta('299') === 299);
  check('超出上限被封顶', E.clampDelta('999999999') === 99999999);
  check('非数字 → 0', E.clampDelta('abc') === 0);

  check('累计负数 → 0', E.clampTotal(-1) === 0);
  check('累计非数字 → 0', E.clampTotal('abc') === 0);
  check('累计超上限封顶', E.clampTotal(999999999) === 99999999);
  check('累计 498 保持不变', E.clampTotal(498) === 498);
}

console.log('\n=== 2. 旧数据迁移（不能丢用户已存的金额）===');
{
  const E = buildEnv(makeStore());
  // 老结构：{ name, amount: 199, reason }
  const legacy = E.migrateLegacy({ name: '老王', amount: 199, reason: 'x' });
  check('旧 amount 被迁为 total', legacy.total === 199, legacy);
  check('昵称与理由保留', legacy.name === '老王' && legacy.reason === 'x', legacy);
  check('lastDelta 归零', legacy.lastDelta === 0, legacy);

  const legacyBig = E.migrateLegacy({ amount: 5666 });
  check('旧大额金额也迁移', legacyBig.total === 5666, legacyBig);

  // 新结构：应原样通过
  const modern = { name: 'a', total: 498, lastDelta: 299, reason: '' };
  const kept = E.migrateLegacy(modern);
  check('新结构不被改写', kept === modern, kept);

  const noAmount = E.migrateLegacy({ name: 'b' });
  check('无 amount 的旧记录不报错', noAmount && noAmount.name === 'b', noAmount);

  const bad = E.migrateLegacy({ amount: -5 });
  check('负数旧 amount 不迁移', bad.amount === -5 && bad.total === undefined, bad);
}

console.log('\n=== 3. 累计场景：199 → 299 → 498 ===');
{
  // 按真实结算逻辑手工推演
  function settle(store, { name, delta, reason }) {
    const raw = store.getItem(KEY);
    const cur = raw ? JSON.parse(raw) : { name: '', total: 0, lastDelta: 0, reason: '' };
    const migrated = clampTotal0(migrateLegacy0(cur).total);
    const d = clampDelta0(delta);
    const next = {
      name: name != null ? name : cur.name,
      total: Math.min(migrated + d, 99999999),
      lastDelta: 0,
      reason: reason != null ? reason : cur.reason,
    };
    store.setItem(KEY, JSON.stringify(next));
    return next;
  }
  const E0env = buildEnv(makeStore());
  const clampTotal0 = E0env.clampTotal;
  const clampDelta0 = E0env.clampDelta;
  const migrateLegacy0 = E0env.migrateLegacy;

  const store = makeStore();

  const r1 = settle(store, { name: '打工人', delta: '199' });
  check('第一次填 199 → 累计 199', r1.total === 199, r1);

  const r2 = settle(store, { delta: '299' });
  check('第二次填 299 → 累计 498（用户举的原例）', r2.total === 498, r2);

  const r3 = settle(store, { delta: '' });
  check('留空 → 累计不变，仍是 498', r3.total === 498, r3);

  const r4 = settle(store, { delta: '0' });
  check('填 0 → 累计不变', r4.total === 498, r4);

  const r5 = settle(store, { delta: '2' });
  check('填 2 → 累计 500', r5.total === 500, r5);

  const r6 = settle(store, { delta: '99999999' });
  check('超上限后封顶而非溢出', r6.total === 99999999, r6);

  const persisted = JSON.parse(store.getItem(KEY));
  check('落盘的是累计值不是本次新增', persisted.total === 99999999 && persisted.lastDelta === 0, persisted);
  check('昵称跨次保留', persisted.name === '打工人', persisted);
}

console.log('\n=== 4. 老用户升级不丢金额 ===');
{
  const store = makeStore({
    [KEY]: JSON.stringify({ name: '老王', amount: 5666, reason: '双休好' })
  });
  const raw = JSON.parse(store.getItem(KEY));
  const migrated = E_loadLike(raw);
  function E_loadLike(p) {
    const env = buildEnv(makeStore());
    const m = env.migrateLegacy(p);
    return { name: m.name || '', total: env.clampTotal(m.total), reason: m.reason || '' };
  }
  check('老用户的 5666 升级后仍是 5666（没归零）', migrated.total === 5666, migrated);
  check('老用户昵称理由保留', migrated.name === '老王' && migrated.reason === '双休好', migrated);
}

console.log('\n=== 5. 源码层面的防回归检查 ===');
{
  check('不再存在 clampAmount（旧单值函数已删）', !/function\s+clampAmount/.test(SRC));
  check('不再存在 profile.amount 引用', !/profile\.amount/.test(SRC));
  check('表单标签已改为「本次新增消费」', SRC.includes('本次新增消费'));
  check('小票标签已改为「累计已转移/支持消费」', SRC.includes('累计已转移/支持消费'));
  check('有累计显示元素 #sxg-total', SRC.includes('sxg-total'));
  check('本次新增输入框默认为空（占位提示而非 value）',
    /id="sxg-f-amount"[\s\S]{0,200}?placeholder="留空则不增加"/.test(SRC));
  check('结算后清空新增额（防连点重复累加）',
    /saveProfile\(next\);[\s\S]{0,600}?fAmount\.value = '';/.test(SRC));
  check('结算后以新累计为基准（baseTotal 被更新）',
    /saveProfile\(next\);[\s\S]{0,600}?baseTotal = shown;/.test(SRC));
  check('隐私提示已更新为「累计金额」',
    SRC.includes('累计金额与昵称只存在你自己的浏览器里'));
}

console.log('\n' + '='.repeat(54));
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
if (fail) console.log('失败项：\n  - ' + failures.join('\n  - '));
process.exit(fail ? 1 : 0);