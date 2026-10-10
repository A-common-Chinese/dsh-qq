// dsh-qq：QQ ↔ DeepSeek Harness 桥的 DSH 侧。
//
// 做两件事：
//   1. POST /__dsh-qq/message —— QQ 侧把一条消息交给本插件，插件在**同一个常驻 agent** 上
//      追加一轮对话并等它跑完，把最后一条 assistant 文本回给 QQ。每个 QQ 会话（群/私聊）
//      对应一个常驻 agent，多轮之间共享上下文；空闲超时后回收。
//   2. 注册 qq_send 工具 —— 任意 DSH 会话都能主动往 QQ 推一条消息（长任务跑完播报等）。
//
// 设计约束（都是这台机器上实测过的）：
//   · 插件路由**不受 /api 那道 401 网关保护**，所以自带 bridgeToken 校验；留空只靠回环。
//   · `inject` 里绝对不能写 webServer：headless 等 profile 没有它，写进去整条插件会 pending。
//     路由改走嵌套 ctx.inject(['webServer'], …)（dsh-webcode-bridge 的教训）。
//   · 不 import 任何 @deepseek-ai/* 包：插件装进 profile 后那些包不一定解析得到。
//     只动态 import schemastery（profile 里确实有），拿不到就退化成无 Config 校验。
//   · 造 user 消息不用 dsh-llm 的 createUserMessage，直接按它的形状造：
//     { id: uuid, role: 'user', content: [...], source: { kind: 'user' } }。

import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createPrivacyFilter } from './privacy.js';

/**
 * chatKey → sessionId 的持久映射。有了它，DSH 重启/插件重载后同一个 QQ 会话还能
 * 用 ctx.agents.resume() 接上原来的上下文，而不是另起一条会话。
 */
const STATE_FILE = join(homedir(), '.dsh-qq-sessions.json');

function loadChatState() {
  try {
    const parsed = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveChatState(state) {
  try {
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n', 'utf8');
  } catch (error) {
    console.log('[dsh-qq] 会话映射写入失败：' + (error?.message ?? error));
  }
}

/** 与 cordis.patch.yml 里的默认值保持一致（补丁只给用户可改的那份）。 */
const DEFAULTS = {
  enabled: true,
  routePath: '/__dsh-qq/message',
  statusPath: '/__dsh-qq/status',
  bridgeToken: '',
  cwd: '',
  provider: '',
  model: '',
  reasoningEffort: '',
  maxTokens: 0,
  replyTimeoutMs: 900000,
  idleDisposeMs: 1800000,
  qqBaseUrl: 'http://127.0.0.1:3310',
  qqToken: '',
  enableSendTool: true,
  sendToolName: 'qq_send',
  enableSendFileTool: true,
  sendFileToolName: 'qq_send_file',
  /**
   * 隐私过滤（细节在 privacy.js）：
   *   · allowedChats 里的会话（默认只有你的私聊）—— 原样放行，一个字都不动；
   *   · 其他任何会话（所有群 + 其他私聊）—— 命中即处理：
   *       密钥/口令/连接串等高置信秘密 → 整条拒发；
   *       邮箱/手机/身份证/卡号/用户名·主机名/用户目录路径/IP → 就地打码后照发；
   *       打码后只剩占位符 → 拒发。
   * 覆盖三处出口：桥回传给 QQ 的回复、qq_send、qq_send_file。
   */
  privacy: {
    enabled: true,
    allowedChats: ['private:85946573'],
    mode: 'redact',
    blockOnSecrets: true,
    blockedReply: '（这条回复含不宜发往该会话的隐私信息，已被隐私过滤拦截）',
    noticeSuffix: false,
    logMatches: true,
    scanFileContents: true,
    maxScanBytes: 2097152,
    extraPatterns: []
  }
};

let Schema = null;
try {
  Schema = (await import('schemastery')).default;
} catch {
  // 没有 schemastery 也能跑：Config 缺省时宿主不校验、GUI 不给表单，但补丁里的 config 照样传进来
}

export const name = 'dsh-qq';
export const inject = ['agents', 'sessions', 'tools', 'agentDefaultModel'];
export const Config = Schema
  ? Schema.object({
      enabled: Schema.boolean().default(true),
      routePath: Schema.string().default(DEFAULTS.routePath),
      statusPath: Schema.string().default(DEFAULTS.statusPath),
      bridgeToken: Schema.string().default(''),
      cwd: Schema.string().default(''),
      provider: Schema.string().default(''),
      model: Schema.string().default(''),
      reasoningEffort: Schema.string().default(''),
      maxTokens: Schema.number().default(0),
      replyTimeoutMs: Schema.number().default(DEFAULTS.replyTimeoutMs),
      idleDisposeMs: Schema.number().default(DEFAULTS.idleDisposeMs),
      qqBaseUrl: Schema.string().default(DEFAULTS.qqBaseUrl),
      qqToken: Schema.string().default(''),
      enableSendTool: Schema.boolean().default(true),
      sendToolName: Schema.string().default(DEFAULTS.sendToolName),
      enableSendFileTool: Schema.boolean().default(true),
      sendFileToolName: Schema.string().default(DEFAULTS.sendFileToolName),
      // 注意：profile 里只有 @deepseek-ai/schemastery，裸名 import 会失败 → Config 实际为
      // undefined，配置原样传入。这里仍然声明一遍，是为了将来 schema 真能解析时不被剥掉字段。
      privacy: Schema.object({
        enabled: Schema.boolean().default(true),
        allowedChats: Schema.array(Schema.string()).default(['private:85946573']),
        mode: Schema.string().default('redact'),
        blockOnSecrets: Schema.boolean().default(true),
        blockedReply: Schema.string().default(DEFAULTS.privacy.blockedReply),
        noticeSuffix: Schema.boolean().default(false),
        logMatches: Schema.boolean().default(true),
        scanFileContents: Schema.boolean().default(true),
        maxScanBytes: Schema.number().default(DEFAULTS.privacy.maxScanBytes),
        extraPatterns: Schema.array(Schema.any()).default([])
      })
    })
  : undefined;

/** 造一条与 dsh-llm createUserMessage 等价的消息（不 import 那个包）。 */
function userMessage(text) {
  return {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text: String(text ?? '') }],
    source: { kind: 'user' }
  };
}

/** 读会话里最后一条非空 assistant 文本（deriveMessages 是公开的非废弃读法）。 */
function lastAssistantText(session) {
  let messages;
  try {
    messages = session.deriveMessages();
  } catch {
    return null;
  }
  if (!Array.isArray(messages)) return null;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (!message || message.role !== 'assistant') continue;
    const blocks = Array.isArray(message.content) ? message.content : [];
    const text = blocks
      .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('')
      .trim();
    if (text) return text;
  }
  return null;
}

function readJsonBody(req, limitBytes = 262144) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(new Error(`请求体不是 JSON：${error?.message ?? error}`));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(text);
}

function withTimeout(promise, ms, onTimeout) {
  if (!(ms > 0)) return promise;
  let timer;
  const guard = new Promise((_, reject) => {
    timer = setTimeout(() => {
      try { onTimeout?.(); } catch { /* 取消失败也要把超时报出去 */ }
      reject(new Error(`等待回复超时（${Math.round(ms / 1000)}s）`));
    }, ms);
    timer.unref?.();
  });
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
}

export function apply(ctx, config) {
  const cfg = { ...DEFAULTS, ...(config && typeof config === 'object' ? config : {}) };
  if (cfg.enabled === false) return;

  // privacy 是嵌套对象：浅合并会把默认值整体顶掉，所以单独再合一层。
  const privacyCfg = {
    ...DEFAULTS.privacy,
    ...((config && typeof config === 'object' && config.privacy) || {})
  };
  const privacy = createPrivacyFilter(privacyCfg);

  /** chatKey -> { handle, agent, busy, lastUsed, turns, sessionId } */
  const chats = new Map();
  const log = (msg) => console.log(`[dsh-qq] ${msg}`);

  /** 本轮没有 assistant 文本时，把 turn/end 的原因挖出来，方便 QQ 侧看到真因。 */
  function lastTurnReason(session) {
    try {
      const seq = Number(session?.seq) || 0;
      const events = session.snapshotEvents(Math.max(0, seq - 20));
      for (let i = events.length - 1; i >= 0; i -= 1) {
        if (events[i]?.type === 'turn/end') return events[i].data?.reason ?? null;
      }
    } catch { /* 诊断失败不影响主流程 */ }
    return null;
  }

  /** 新 agent 的模型路由：显式配置优先，其次问 DSH 的默认模型服务。 */
  function resolveAgentOptions() {
    let options = {};
    try {
      const selection = ctx.agentDefaultModel?.currentSelection?.();
      if (selection && typeof selection === 'object') options = { ...selection };
    } catch (error) {
      log(`读取默认模型失败：${error?.message ?? error}`);
    }
    if (cfg.provider) options.provider = String(cfg.provider);
    if (cfg.model) options.model = String(cfg.model);
    if (cfg.reasoningEffort) options.reasoningEffort = String(cfg.reasoningEffort);
    if (Number(cfg.maxTokens) > 0) options.maxTokens = Number(cfg.maxTokens);
    return options;
  }

  const chatState = loadChatState();

  function rememberSession(chatKey, sessionId) {
    chatState[chatKey] = { sessionId, updatedAt: Date.now() };
    saveChatState(chatState);
  }

  async function createChat(chatKey) {
    const safe = String(chatKey).replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 48);
    const sessionId = `qq-${safe}-${randomUUID().slice(0, 8)}`;
    const agentOptions = resolveAgentOptions();
    const handle = await ctx.agents.create({
      sessionId,
      meta: cfg.cwd ? { cwd: String(cfg.cwd) } : {},
      ...(Object.keys(agentOptions).length ? { agentOptions } : {})
    });
    const model = `${agentOptions.provider ?? '?'}/${agentOptions.model ?? '?'}`;
    const entry = { handle, agent: handle.agent, busy: false, lastUsed: Date.now(), turns: 0, sessionId, model };
    chats.set(chatKey, entry);
    rememberSession(chatKey, sessionId);
    log(`新建常驻会话 ${chatKey} → ${sessionId}（model=${model}）`);
    return entry;
  }

  async function ensureChat(chatKey) {
    const existing = chats.get(chatKey);
    if (existing) return existing;
    const saved = chatState[chatKey]?.sessionId;
    if (saved) {
      try {
        const agentOptions = resolveAgentOptions();
        const handle = await ctx.agents.resume({
          resumeSessionId: saved,
          ...(Object.keys(agentOptions).length ? { agentOptions } : {})
        });
        const model = `${agentOptions.provider ?? '?'}/${agentOptions.model ?? '?'}`;
        const entry = { handle, agent: handle.agent, busy: false, lastUsed: Date.now(), turns: 0, sessionId: saved, model };
        chats.set(chatKey, entry);
        log(`复用持久会话 ${chatKey} → ${saved}（model=${model}）`);
        return entry;
      } catch (error) {
        log(`恢复会话 ${saved} 失败（${error?.message ?? error}），改建新会话`);
      }
    }
    return createChat(chatKey);
  }

  /** 一轮问答：追加 user 消息 → 等空闲 → 取最后一条 assistant 文本。 */
  async function ask(chatKey, text) {
    const entry = await ensureChat(chatKey);
    if (entry.busy) throw new Error('这个会话上一轮还没跑完（QQ 侧可以发 /dsh 停）');
    entry.busy = true;
    entry.lastUsed = Date.now();
    const startedAt = Date.now();
    try {
      // 桥注入上下文：告诉模型"这次请求来自哪个 QQ 会话"。没有它模型就没有 chatKey，
      // qq_send / qq_send_file 只能瞎编或反过来问用户。方括号里是系统提示，不是用户的话。
      entry.agent.followup(userMessage(
        text + '\n\n[QQ 桥提示：本次请求来自 ' + chatKey
        + '。若要把消息或文件发回该会话，调用 qq_send / qq_send_file 时 chat 参数填 \"' + chatKey + '\"。]'
      ));
      await withTimeout(entry.agent.whenIdle(), Number(cfg.replyTimeoutMs) || 0, () => {
        try { entry.agent.cancel({ kind: 'user' }); } catch { /* 尽力取消 */ }
      });
      const session = entry.agent.session ?? ctx.sessions.get(entry.agent.id);
      const reply = lastAssistantText(session);
      entry.turns += 1;
      entry.lastUsed = Date.now();
      if (!reply) {
        const reason = lastTurnReason(session);
        throw new Error(`本轮没有产生 assistant 文本（model=${entry.model ?? '?'}，turn/end=${JSON.stringify(reason)}）`);
      }
      return { reply, sessionId: entry.sessionId, elapsedMs: Date.now() - startedAt, turns: entry.turns };
    } finally {
      entry.busy = false;
    }
  }

  /** DSH → QQ：把本机文件发到 QQ（走 QQ Agent 的 /api/inbound-file）。 */
  async function sendFileToQQ(chat, filePath, name) {
    const base = String(cfg.qqBaseUrl || '').replace(/\/+$/, '');
    if (!base) throw new Error('dsh-qq: qqBaseUrl 未配置');
    const response = await fetch(base + '/api/inbound-file', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(cfg.qqToken ? { 'x-console-token': String(cfg.qqToken) } : {})
      },
      body: JSON.stringify({ chat: String(chat), path: String(filePath), ...(name ? { name: String(name) } : {}) }),
      // 上传可能是几百 MB，超时给足
      signal: AbortSignal.timeout(300000)
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.ok === false) {
      throw new Error(body?.error ? String(body.error) : `HTTP ${response.status}`);
    }
    return body;
  }

  /** DSH → QQ：调用 QQ Agent 的 /api/inbound。 */
  async function pushToQQ(chat, text) {
    const base = String(cfg.qqBaseUrl || '').replace(/\/+$/, '');
    if (!base) throw new Error('dsh-qq: qqBaseUrl 未配置');
    const response = await fetch(`${base}/api/inbound`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(cfg.qqToken ? { 'x-console-token': String(cfg.qqToken) } : {})
      },
      body: JSON.stringify({ chat: String(chat), text: String(text) }),
      signal: AbortSignal.timeout(30000)
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.ok === false) {
      throw new Error(body?.error ? String(body.error) : `HTTP ${response.status}`);
    }
    return body;
  }

  // ── HTTP 路由（webServer 是可选依赖，用嵌套 inject 挂载）────────────────
  if (typeof ctx.inject === 'function') {
    ctx.inject(['webServer'], (wctx) => {
      const webServer = wctx.webServer ?? wctx.get?.('webServer');
      if (!webServer || typeof webServer.register !== 'function') return;

      const authorized = (req, url) => {
        const token = String(cfg.bridgeToken || '');
        if (!token) return true;
        return req.headers['x-dsh-qq-token'] === token || url.searchParams.get('token') === token;
      };

      const mount = (path, handler) => {
        const dispose = webServer.register({ kind: 'exact', path, handler });
        wctx.effect?.(() => dispose);
      };

      mount(String(cfg.routePath), async (req, res) => {
        const url = new URL(req.url || '/', 'http://127.0.0.1');
        if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: '只用 POST' });
        if (!authorized(req, url)) return sendJson(res, 401, { ok: false, error: 'bridgeToken 不匹配' });
        let body;
        try {
          body = await readJsonBody(req);
        } catch (error) {
          return sendJson(res, 400, { ok: false, error: String(error?.message ?? error) });
        }
        const chatKey = String(body.chatKey ?? body.chat ?? '').trim();
        const text = String(body.text ?? '').trim();
        if (!chatKey || !text) return sendJson(res, 400, { ok: false, error: '缺少 chatKey 或 text' });
        try {
          const result = await ask(chatKey, text);
          log(`← ${chatKey} 一轮完成（${result.elapsedMs}ms，第 ${result.turns} 轮）`);
          // ── 隐私闸门：这条回程是主要泄漏面（别人问，DSH 答，答案落进那个会话）──
          const gate = privacy.filterText(chatKey, result.reply);
          if (!gate.bypass && !gate.ok) {
            const reason = `隐私过滤拦截（${gate.blockedBy}）`;
            log(`← ${chatKey} ${reason}，已替换为通用提示`);
            return sendJson(res, 200, {
              ok: true,
              ...result,
              reply: String(privacyCfg.blockedReply || DEFAULTS.privacy.blockedReply),
              privacy: { blocked: true, reason, rules: gate.hits.map((h) => h.id) }
            });
          }
          if (!gate.bypass && gate.hits.length) {
            const summary = gate.hits.map((h) => `${h.id}×${h.count}`).join('、');
            log(`← ${chatKey} 隐私打码：${summary}`);
            return sendJson(res, 200, {
              ok: true,
              ...result,
              reply: gate.text,
              privacy: { blocked: false, redacted: gate.hits.map((h) => ({ id: h.id, count: h.count })) }
            });
          }
          return sendJson(res, 200, { ok: true, ...result });
        } catch (error) {
          log(`← ${chatKey} 出错：${error?.message ?? error}`);
          return sendJson(res, 500, { ok: false, error: String(error?.message ?? error) });
        }
      });

      mount(String(cfg.statusPath), (req, res) => {
        const url = new URL(req.url || '/', 'http://127.0.0.1');
        if (!authorized(req, url)) return sendJson(res, 401, { ok: false, error: 'bridgeToken 不匹配' });
        sendJson(res, 200, {
          ok: true,
          cwd: cfg.cwd || process.cwd(),
          privacy: privacy.describe(),
          chats: [...chats.entries()].map(([chatKey, e]) => ({
            chatKey,
            sessionId: e.sessionId,
            busy: e.busy,
            turns: e.turns,
            lastUsed: e.lastUsed
          }))
        });
      });

      log(`路由已挂载：POST ${cfg.routePath}，GET ${cfg.statusPath}`);
    });
  } else {
    log('ctx.inject 不可用，跳过路由挂载');
  }

  // ── qq_send 工具：任意 DSH 会话都能往 QQ 推消息 ──────────────────────────
  if (cfg.enableSendTool !== false) {
    ctx.effect(() =>
      ctx.tools.register({
        name: String(cfg.sendToolName || 'qq_send'),
        description:
          'Send a plain-text message into a QQ chat through the local QQ Agent (the bot account). ' +
          'Use it to push a result or a progress notice to the human on QQ. ' +
          '`chat` must be "group:<群号>" or "private:<QQ号>", and the target must already be in the QQ Agent whitelist.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          required: ['chat', 'text'],
          properties: {
            chat: { type: 'string', description: '"group:<群号>" 或 "private:<QQ号>"' },
            text: { type: 'string', description: '要发送的纯文本（会做 Markdown 降级与长度分片）' }
          }
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['ok', 'chat', 'messageId'],
            properties: {
              ok: { type: 'boolean' },
              chat: { type: 'string' },
              messageId: { type: 'string' },
              note: { type: 'string' }
            }
          },
          render: (_args, value) => [
            {
              type: 'text',
              text: value?.ok
                ? `已发送到 ${value.chat}${value?.note ? `（${value.note}）` : ''}`
                : `发送失败：${value?.chat ?? ''}`
            }
          ]
        },
        isConcurrencySafe: () => true,
        async execute(args) {
          const gate = privacy.filterText(args.chat, args.text);
          if (!gate.bypass && !gate.ok) {
            throw new Error(
              `隐私过滤：这条消息含不宜发往 ${args.chat} 的内容（命中 ${gate.blockedBy}），已拦截。` +
              `请改写后重发；白名单会话为 ${privacy.allowedChats.join('、')}。`
            );
          }
          const result = await pushToQQ(args.chat, gate.text);
          return {
            ok: true,
            chat: String(args.chat),
            messageId: String(result?.messageId ?? ''),
            ...(gate.hits.length
              ? { note: `已打码 ${gate.hits.map((h) => `${h.id}×${h.count}`).join('、')}` }
              : {})
          };
        }
      })
    );
    log(`工具已注册：${cfg.sendToolName}（→ ${cfg.qqBaseUrl}/api/inbound）`);
  }

  // ── qq_send_file 工具：把本机文件发到 QQ（群文件 / 私聊文件）────────────
  if (cfg.enableSendFileTool !== false) {
    ctx.effect(() =>
      ctx.tools.register({
        name: String(cfg.sendFileToolName || 'qq_send_file'),
        description:
          'Send a local file to a QQ chat through the local QQ Agent (group file / private file). ' +
          'Use it to deliver a document, archive, screenshot or build artifact to the human on QQ. ' +
          '`chat` must be "group:<群号>" or "private:<QQ号>" and already whitelisted; ' +
          '`path` must be an absolute path to an existing file on the machine running the QQ Agent.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          required: ['chat', 'path'],
          properties: {
            chat: { type: 'string', description: '"group:<群号>" 或 "private:<QQ号>"' },
            path: { type: 'string', description: '本机文件的绝对路径（必须存在）' },
            name: { type: 'string', description: '在 QQ 里显示的文件名；留空用原文件名' }
          }
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['ok', 'chat', 'name', 'fileId'],
            properties: {
              ok: { type: 'boolean' },
              chat: { type: 'string' },
              name: { type: 'string' },
              fileId: { type: 'string' },
              note: { type: 'string' }
            }
          },
          render: (_args, value) => [
            {
              type: 'text',
              text: value?.ok
                ? `已发送文件 ${value.name} 到 ${value.chat}${value?.note ? `（${value.note}）` : ''}`
                : `发送失败：${value?.chat ?? ''}`
            }
          ]
        },
        isConcurrencySafe: () => true,
        async execute(args) {
          // 隐私闸门：文件名按文本规则判，文本类文件的内容只做 block 级扫描（命中即拒发）
          const gate = privacy.filterFile(args.chat, args.path);
          if (!gate.bypass && !gate.ok) {
            const why = String(gate.blockedBy || '').startsWith('file-content:')
              ? '文件内容命中密钥/口令类规则'
              : `文件名/路径命中 ${gate.blockedBy}`;
            throw new Error(`隐私过滤：${why}，已拦截，未发送到 ${args.chat}。`);
          }
          const safeName = gate.bypass ? args.name : (gate.safeName || args.name);
          const result = await sendFileToQQ(args.chat, args.path, safeName);
          return {
            ok: true,
            chat: String(args.chat),
            name: String(result?.name ?? safeName ?? ''),
            fileId: String(result?.fileId ?? ''),
            ...(gate.hits.length
              ? { note: `文件名/内容已处理 ${gate.hits.map((h) => `${h.id}×${h.count}`).join('、')}` }
              : {})
          };
        }
      })
    );
    log(`工具已注册：${cfg.sendFileToolName}（→ ${cfg.qqBaseUrl}/api/inbound-file）`);
  }

  // ── 空闲回收 + 卸载清理 ─────────────────────────────────────────────────
  const idleMs = Number(cfg.idleDisposeMs) || 0;
  if (idleMs > 0) {
    const sweeper = setInterval(() => {
      const now = Date.now();
      for (const [chatKey, entry] of chats) {
        if (entry.busy || now - entry.lastUsed < idleMs) continue;
        chats.delete(chatKey);
        entry.handle.dispose().catch((error) => log(`回收 ${chatKey} 失败：${error?.message ?? error}`));
        log(`空闲回收常驻会话 ${chatKey}`);
      }
    }, Math.min(60000, Math.max(5000, Math.floor(idleMs / 4))));
    sweeper.unref?.();
    ctx.effect(() => () => clearInterval(sweeper));
  }

  ctx.effect(() => () => {
    for (const [chatKey, entry] of chats) {
      entry.handle.dispose().catch((error) => log(`卸载时释放 ${chatKey} 失败：${error?.message ?? error}`));
    }
    chats.clear();
  });

  log(`已加载（route=${cfg.routePath}，cwd=${cfg.cwd || '(继承)'}，qq=${cfg.qqBaseUrl}）`);
  if (privacy.enabled) {
    log(
      `隐私过滤已启用：白名单=[${privacy.allowedChats.join('、')}]，mode=${privacy.mode}` +
      `，密钥类=拒发，其他=${{ redact: '打码', block: '拒发' }[privacy.mode]}`
    );
  } else {
    log('⚠️ 隐私过滤已关闭（privacy.enabled=false）：任何会话都会收到原样内容');
  }
}
