// rotation-policy.js 的单测：node test/rotation-policy.test.mjs
import { decideRotation, rotationText } from '../rotation-policy.js';

let pass = 0;
const fail = [];
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass += 1; console.log('  ✅ ' + name); }
  else { fail.push(name); console.log(`  ❌ ${name}\n      实际 ${JSON.stringify(actual)}\n      期望 ${JSON.stringify(expected)}`); }
};

const HOUR = 3600000;
const now = 1_700_000_000_000;

// 轮数阈值
check('未到轮数阈值 → 不轮换', decideRotation({ turns: 19, maxTurns: 20, now }).rotate, false);
check('到达轮数阈值 → 轮换', decideRotation({ turns: 20, maxTurns: 20, now }),
  { rotate: true, reason: 'turns', detail: '20 轮' });
check('超过阈值也轮换', decideRotation({ turns: 25, maxTurns: 20, now }).reason, 'turns');
check('阈值 0 = 关掉轮数规则', decideRotation({ turns: 999, maxTurns: 0, now }).rotate, false);

// 空闲时长
check('空闲未到 → 不轮换', decideRotation({ turns: 1, lastUsedAt: now - 11 * HOUR, maxIdleHours: 12, now }).rotate, false);
check('空闲到达 → 轮换（带小时数）', decideRotation({ turns: 1, lastUsedAt: now - 13 * HOUR, maxIdleHours: 12, now }),
  { rotate: true, reason: 'idle', detail: '空闲 13.0 小时' });
check('阈值 0 = 关掉空闲规则', decideRotation({ turns: 1, lastUsedAt: now - 999 * HOUR, maxIdleHours: 0, now }).rotate, false);
check('没有 lastUsedAt（新会话）→ 不轮换', decideRotation({ turns: 0, lastUsedAt: 0, maxIdleHours: 12, now }).rotate, false);

// 优先级：轮数先于空闲
check('两条都命中 → 报轮数', decideRotation({ turns: 30, lastUsedAt: now - 99 * HOUR, maxTurns: 20, maxIdleHours: 12, now }).reason, 'turns');

// 脏值容错
check('脏值不炸', decideRotation({ turns: 'x', lastUsedAt: null, maxTurns: 'y', maxIdleHours: undefined, now }).rotate, false);
check('空对象不炸', decideRotation().rotate, false);

// 文案
check('轮数文案', rotationText({ rotate: true, reason: 'turns', detail: '20 轮' }),
  '本会话已累计 20 轮，为避免上下文越滚越大，已开新会话');
check('空闲文案', rotationText({ rotate: true, reason: 'idle', detail: '空闲 13.0 小时' }),
  '本会话已空闲 13.0 小时没用过，已开新会话');
check('手动文案', rotationText({ rotate: true, reason: 'manual', detail: 'x' }), '按你的要求开了新会话');
check('不轮换 → 空串', rotationText({ rotate: false }) === '', true);

console.log(`\n通过 ${pass} 项，失败 ${fail.length}`);
if (fail.length) process.exit(1);
