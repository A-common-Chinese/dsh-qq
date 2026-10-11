// 投递给 DSH 的「QQ 桥提示」文案。
//
// 为什么需要它（两个真实故障）：
//   ① 模型不知道消息来自哪个 QQ 会话 → qq_send 的 chat 参数只能瞎编；
//   ② **用户看不见 DSH 窗口**：模型一旦用界面询问（ask_user_question 之类）去要用户决策，
//      问题只出现在窗口里，QQ 那边完全看不到；而 QQ 侧的 ask() 还在等这一轮结束，
//      表现就是"QQ 里没反应"。
// 所以每条消息都附一小段说明：要问用户就用 qq_send 把问题发回该会话，然后结束本轮等回复。
//
// 为了让"改文案"和"关掉提示"都不用改代码，文案可由配置覆盖（decisionHint），
// 也可以整体关掉（bridgeHint=false）。

export const DEFAULT_DECISION_HINT = [
  '你的回复会自动发回该 QQ 会话 —— 需要用户确认/选择/补充信息时，直接把问题写进回复、然后结束本轮即可；',
  '不要用界面询问（ask_user_question 之类 QQ 侧完全看不到，表现为"没反应"）。',
  '若还要单独发额外内容或文件，用 qq_send / qq_send_file（chat 参数见上）。'
].join('\n');

/**
 * 组装要附加到用户消息末尾的提示。
 *
 * @param {string} chatKey 形如 private:85946573 / group:759694210
 * @param {{ enabled?: boolean, custom?: string }} [options]
 * @returns {string} 空串表示不加提示
 */
export function buildBridgeHint(chatKey, options = {}) {
  if (options.enabled === false) return '';
  const key = String(chatKey ?? '').trim();
  if (!key) return '';
  const decision = String(options.custom ?? '').trim() || DEFAULT_DECISION_HINT;
  return [
    `[QQ 桥提示：本次请求来自 ${key}。若要把消息或文件发回该会话，调用 qq_send / qq_send_file 时 chat 参数填 "${key}"。`,
    decision + ']'
  ].join('\n');
}

/** 把提示接到用户文本后面（原文一字不动）。 */
export function withBridgeHint(text, chatKey, options = {}) {
  const hint = buildBridgeHint(chatKey, options);
  const body = String(text ?? '');
  return hint ? `${body}\n\n${hint}` : body;
}
