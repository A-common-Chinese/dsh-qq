// hint.js 的单测：node test/hint.test.mjs
import { buildBridgeHint, withBridgeHint, DEFAULT_DECISION_HINT } from '../hint.js';

let pass = 0;
const failures = [];
function check(name, cond, extra = '') {
  if (cond) pass += 1; else failures.push(name + (extra ? '\n      ' + extra : ''));
}

const hint = buildBridgeHint('private:85946573');

check('包含来源会话', hint.includes('private:85946573'), hint);
check('包含 qq_send 与 chat 参数填法', hint.includes('qq_send') && hint.includes('chat 参数填 "private:85946573"'), hint);
check('说明回复会自动回到 QQ', hint.includes('你的回复会自动发回该 QQ 会话'), hint);
check('说明需要决策时把问题写进回复', hint.includes('直接把问题写进回复'), hint);
check('点名 ask_user_question 不行', hint.includes('ask_user_question'), hint);
check('解释为什么（QQ 侧看不到/没反应）', hint.includes('没反应'), hint);
check('以 ] 收尾（方括号闭合）', hint.trimEnd().endsWith(']'), hint.slice(-20));

// 关掉开关
check('enabled:false → 空串', buildBridgeHint('private:1', { enabled: false }) === '');
// 没有 chatKey（不该拼出半截提示）
check('chatKey 为空 → 空串', buildBridgeHint('', {}) === '' && buildBridgeHint(null, {}) === '');
// 自定义文案覆盖默认
const custom = buildBridgeHint('group:123', { custom: '遇到提问就 qq_send 回来。' });
check('自定义文案生效', custom.includes('遇到提问就 qq_send 回来。') && !custom.includes(DEFAULT_DECISION_HINT.slice(0, 10)), custom);
check('自定义文案仍然带 chatKey', custom.includes('group:123'), custom);

// 拼接到正文
const merged = withBridgeHint('帮我关机', 'private:85946573');
check('正文原样保留', merged.startsWith('帮我关机\n\n[QQ 桥提示：'), merged.slice(0, 40));
check('正文与提示之间空一行', merged.includes('帮我关机\n\n'), merged.slice(0, 20));
check('关掉时不改动正文', withBridgeHint('原文', 'private:1', { enabled: false }) === '原文');
check('空正文也不炸', withBridgeHint('', 'private:1').startsWith('\n\n[QQ 桥提示：'));

console.log(`\n通过 ${pass} 项`);
if (failures.length) {
  console.log(`\n失败 ${failures.length} 项：`);
  for (const f of failures) console.log('  ✗ ' + f);
  process.exit(1);
}
console.log('全部通过 ✅');
