# dsh-qq

QQ ↔ DeepSeek Harness 桥的 **DSH 侧**插件：让 QQ 里的对话落到一个**常驻** DSH 会话上，并让 DSH 主动往 QQ 推消息。

配套的 QQ 侧在 `qq-agent` fork 里：`/dsh` 前缀命中后走 `dsh.transport` 选择通道（`headless` 起进程 / `plugin` 走本插件）。

## 它做什么

| 入口 | 行为 |
|---|---|
| `POST /__dsh-qq/message` | body `{ chatKey, text }`。插件按 `chatKey` 找（或建）一个常驻 agent，追加一轮对话，等它跑完，返回 `{ ok, reply, sessionId, elapsedMs, turns }`。**同一个 chatKey 的多轮共享上下文**，不新起进程。 |
| `GET /__dsh-qq/status` | 列出当前常驻会话（chatKey / sessionId / busy / turns）。 |
| 工具 `qq_send` | 任意 DSH 会话都能调用：`{ chat: "private:<QQ号>" \| "group:<群号>", text }` → 调 QQ Agent 的 `POST /api/inbound` 发出去。 |

## 配置（profile 的 cordis.patch.yml，或 GUI 插件页）

| 字段 | 默认 | 说明 |
|---|---|---|
| `enabled` | true | 关掉后不挂路由、不注册工具 |
| `routePath` / `statusPath` | `/__dsh-qq/message` / `/__dsh-qq/status` | 挂在本机 webServer（默认 127.0.0.1:19387） |
| `bridgeToken` | `''` | QQ 侧用 `x-dsh-qq-token` 带；**留空 = 只靠回环地址保护，本机任何进程可调** |
| `cwd` | `''` | 常驻会话的工作目录（空 = 继承宿主 cwd）。注意 DSH 的 workspace-write 沙箱要求该目录及其祖先对你有 `WRITE_DAC`（一般用户目录下没问题，`D:\` 上那种只有 Modify 的目录会让写文件失败） |
| `provider` / `model` / `reasoningEffort` / `maxTokens` | 空 | 留空用 DSH 的默认模型选择 |
| `replyTimeoutMs` | 900000 | 单条消息等待上限；超时会对该 agent 调 `cancel({kind:'user'})` |
| `idleDisposeMs` | 1800000 | 常驻会话空闲多久被回收（dispose） |
| `qqBaseUrl` / `qqToken` | `http://127.0.0.1:3310` / `''` | DSH → QQ 推送的目标（QQ Agent 控制台）。qqToken 对应 QQ 侧的 `server.token` |
| `enableSendTool` / `sendToolName` | true / `qq_send` | 是否注册推送工具 |

## 安装 / 生效

```powershell
# 装进 desktop profile（用 DSH 的 plugin-manager，热装）
# 也可以在 GUI 的插件页里装；target 传本目录
```

**改 `index.js` 后必须重启 DSH**：宿主会缓存 ESM 模块，禁用/启用、改文件字节都不会重新导入（本机实测）。改配置（含 GUI 里改）不需要重启。

## 依赖与约束

- 只动态 import `schemastery`（拿不到就退化成无 Config 校验），**不 import 任何 `@deepseek-ai/*`**：插件装进 profile 后那些包不一定解析得到。
- `inject` 里没有 `webServer`：headless 等 profile 没这个服务，写进去整条插件会 pending；路由改走嵌套 `ctx.inject(['webServer'], …)`。
- 造 user 消息不用 `dsh-llm` 的 `createUserMessage`，直接按它的形状造 `{ id, role:'user', content, source:{kind:'user'} }`。
- 工具 schema 用标准 JSON Schema：**`required` 必须是对象级数组**，属性级 `required: true` 会被 dsh-tools 的 `assertSupportedJsonSchema` 拒绝。
