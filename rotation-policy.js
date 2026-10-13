// 常驻会话的轮换策略（纯函数，便于单测）
//
// 背景：DSH 桥的 plugin 通道给每个 chatKey 复用**同一条**会话（ctx.agents.resume），
// 而每轮都要把整条上下文重新发给模型 —— 轮数一多，成本近似二次增长。
// 所以要有两条自动轮换规则（都可关）：
//   · maxTurnsPerSession：累计轮数到达阈值 → 换新会话
//   · maxSessionIdleHours：距上次使用超过阈值 → 换新会话
// 手动重置走 options.fresh（/dsh 新 … 或 POST /__dsh-qq/reset），不在这里判断。

/** 人类可读的轮换说明（回给 QQ 时用） */
export function rotationText(decision) {
  if (!decision?.rotate) return '';
  if (decision.reason === 'manual') return '按你的要求开了新会话';
  if (decision.reason === 'turns') return `本会话已累计 ${decision.detail}，为避免上下文越滚越大，已开新会话`;
  if (decision.reason === 'idle') return `本会话已${decision.detail}没用过，已开新会话`;
  return '已开新会话';
}

/**
 * 判断是否该轮换。
 * @param {{turns?: number, lastUsedAt?: number, now?: number, maxTurns?: number, maxIdleHours?: number}} p
 * @returns {{rotate: boolean, reason: string, detail: string}}
 */
export function decideRotation(p = {}) {
  const turns = Math.max(0, Number(p.turns) || 0);
  const maxTurns = Math.max(0, Number(p.maxTurns) || 0);
  const maxIdleHours = Math.max(0, Number(p.maxIdleHours) || 0);
  const now = Number(p.now) || Date.now();
  const lastUsedAt = Number(p.lastUsedAt) || 0;

  if (maxTurns > 0 && turns >= maxTurns) {
    return { rotate: true, reason: 'turns', detail: `${turns} 轮` };
  }
  if (maxIdleHours > 0 && lastUsedAt > 0) {
    const hours = (now - lastUsedAt) / 3600000;
    if (hours >= maxIdleHours) {
      return { rotate: true, reason: 'idle', detail: `空闲 ${hours.toFixed(1)} 小时` };
    }
  }
  return { rotate: false, reason: '', detail: '' };
}
