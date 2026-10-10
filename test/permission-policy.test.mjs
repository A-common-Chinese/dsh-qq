// permission-policy.js 的单测：node test/permission-policy.test.mjs
import { pickPermissionPreset, normalizeChatKey } from '../permission-policy.js';

let pass = 0;
const failures = [];
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) pass += 1; else failures.push(`${name}\n      实际: ${a}\n      期望: ${e}`);
}

const base = {
  allowedChats: ['private:85946573'],
  full: 'danger-full-access',
  restricted: 'workspace-write'
};

check('裸号归一化', normalizeChatKey('85946573'), 'private:85946573');
check('带前缀不变', normalizeChatKey('group:123'), 'group:123');
check('空值', normalizeChatKey(null), '');

// 白名单 → 全权限
check('白名单（带前缀）', pickPermissionPreset('private:85946573', base),
  { name: 'danger-full-access', reason: '白名单会话 → 全权限', whitelisted: true });
check('白名单（裸号写法）', pickPermissionPreset('private:85946573', { ...base, allowedChats: ['85946573'] }).name,
  'danger-full-access');

// 非白名单 → 受限，且**请求里硬塞全权限也没用**（这条是安全底线）
const other = pickPermissionPreset('private:103751885', base);
check('非白名单 → 受限', [other.name, other.whitelisted], ['workspace-write', false]);
check('非白名单 + 请求塞全权限 → 仍受限',
  pickPermissionPreset('private:103751885', { ...base, full: 'danger-full-access' }).name, 'workspace-write');
check('群一律受限', pickPermissionPreset('group:759694210', base).name, 'workspace-write');

// 边界
check('白名单为空 → 所有人都受限', pickPermissionPreset('private:85946573', { ...base, allowedChats: [] }).name, 'workspace-write');
check('白名单不是数组 → 所有人都受限', pickPermissionPreset('private:85946573', { ...base, allowedChats: null }).name, 'workspace-write');
check('白名单里混脏值也能用', pickPermissionPreset('private:85946573', { ...base, allowedChats: ['', ' 85946573 ', null] }).name, 'danger-full-access');
check('没配全权限预设 → 白名单也受限', pickPermissionPreset('private:85946573', { ...base, full: '' }).name, 'workspace-write');
check('restricted 为空 → 由上层决定（不动权限）', pickPermissionPreset('private:1', { ...base, restricted: '' }).name, '');

// 与隐私白名单互不影响：使用 group 作为权限白名单（显式写才放行）
check('显式把群加进权限白名单 → 该群可全权限',
  pickPermissionPreset('group:759694210', { ...base, allowedChats: ['group:759694210'] }).name, 'danger-full-access');

console.log(`\n通过 ${pass} 项`);
if (failures.length) {
  console.log(`\n失败 ${failures.length} 项：`);
  for (const f of failures) console.log('  ✗ ' + f);
  process.exit(1);
}
console.log('全部通过 ✅');
