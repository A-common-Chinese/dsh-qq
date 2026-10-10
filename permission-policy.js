// 谁能拿到"全权限"的判定。
//
// 抽成独立纯模块是为了**能单测**：`index.js` 里的逻辑要跑起来得先有 DSH 宿主，
// 而"哪个会话能关机"这种事必须能在没有宿主的情况下被断言。
//
// 背景：部署级 `defaultPreset` 已经是 danger-full-access（为了让常驻会话能做越界操作），
// 所以**非白名单会话必须显式降级**，否则它们也会跟着拿到全权限。

/** `85946573` / `private:85946573` 统一成 chatKey 形状。 */
export function normalizeChatKey(entry) {
  const raw = String(entry ?? '').trim();
  if (!raw) return '';
  if (/^(group|private):/.test(raw)) return raw;
  if (/^\d+$/.test(raw)) return `private:${raw}`;   // 裸 QQ 号按私聊算（最保守的解读）
  return raw;
}

/**
 * 决定某会话该用哪个权限预设。
 *
 * 规则（fail-closed）：
 *   · 白名单里的会话 → 用 `full`（请求里带的优先，其次配置的 permissionPreset）
 *   · 其他任何会话   → 用 `restricted`（默认 workspace-write），**绝不放行请求里的全权限**
 *   · 白名单为空     → 所有人都走 restricted
 *
 * @returns {{ name: string, reason: string, whitelisted: boolean }}
 */
export function pickPermissionPreset(chatKey, options = {}) {
  const allowed = (Array.isArray(options.allowedChats) ? options.allowedChats : [])
    .map(normalizeChatKey)
    .filter(Boolean);
  const key = normalizeChatKey(chatKey);
  const whitelisted = Boolean(key) && allowed.includes(key);
  const full = String(options.full || '').trim();
  const restricted = String(options.restricted || '').trim();

  if (!whitelisted) {
    return {
      name: restricted,
      reason: `非白名单会话（白名单：${allowed.join('、') || '空'}）→ 受限`,
      whitelisted: false
    };
  }
  if (!full) {
    return { name: restricted, reason: '白名单会话但未配全权限预设 → 受限', whitelisted: true };
  }
  return { name: full, reason: '白名单会话 → 全权限', whitelisted: true };
}
