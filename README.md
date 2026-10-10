# dsh-qq

QQ ↔ DeepSeek Harness 桥的 **DSH 侧**插件：让 QQ 里的对话落到一个**常驻** DSH 会话上，并让 DSH 主动往 QQ 推消息。

配套的 QQ 侧在 `qq-agent` fork 里：`/dsh` 前缀命中后走 `dsh.transport` 选择通道（`headless` 起进程 / `plugin` 走本插件）。

## 它做什么

| 入口 | 行为 |
|---|---|
| `POST /__dsh-qq/message` | body `{ chatKey, text }`。插件按 `chatKey` 找（或建）一个常驻 agent，追加一轮对话，等它跑完，返回 `{ ok, reply, sessionId, elapsedMs, turns }`。**同一个 chatKey 的多轮共享上下文**，不新起进程。 |
| `GET /__dsh-qq/status` | 列出当前常驻会话（chatKey / sessionId / busy / turns）。 |
| 工具 `qq_send` | 任意 DSH 会话都能调用：`{ chat: "private:<QQ号>" \| "group:<群号>", text }` → 调 QQ Agent 的 `POST /api/inbound` 发出去。 |
| 工具 `qq_send_file` | 同上，但发**文件**：`{ chat, path, name? }` → QQ Agent 的 `POST /api/inbound-file` → OneBot `upload_group_file` / `upload_private_file`。`path` 必须是本机（跑 QQ Agent 那台）上存在的绝对路径，受 `dsh.maxFileBytes` 与 `dsh.fileRoots` 约束。 |

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
| `privacy` | 见下 | 出站隐私过滤（白名单外会话不许收到隐私信息） |

## 隐私过滤（`privacy`）

**目的**：DSH 的内容送往**非白名单会话**时不得携带隐私信息；白名单会话（默认 `private:85946573`）原样放行、一个字都不动。
实现见 [`privacy.js`](privacy.js)，单测 `node test/privacy.test.mjs`（26 项）。

覆盖三处出口：**桥回传给 QQ 的回复**（主要泄漏面）、工具 `qq_send`、工具 `qq_send_file`（文件名 + 文本类文件内容）。

| 级别 | 命中后 | 规则（内置） |
|---|---|---|
| **拒发**（fail-closed） | 整条不发；`qq_send` 抛错并告诉模型改写 | 私钥块、`sk-…`/`sk-ant-…`/`ghp_…`/`AIza…`/`AKIA…`/`xox…`/JWT、`token/password/密码/口令/密钥: xxx` 赋值、带凭据的连接串（mysql/redis/mongo…） |
| **打码** | 就地替换成 `[已隐去:类型]` 后照发 | 邮箱、手机号、身份证、银行卡号、`C:\Users\<用户名>\…`、UNC 主机、内网 IP、**本机用户名/主机名**字面量 |
| **拒发** | 打码后只剩下占位符（整条消息就是一个手机号之类）→ 不发送 | — |

| 字段 | 默认 | 说明 |
|---|---|---|
| `enabled` | true | 关掉 = 所有会话都原样收到（不建议） |
| `allowedChats` | `['private:85946573']` | 可收到原样内容的会话；裸 QQ 号按 `private:<号>` 算。**组永远不在白名单里**，除非你显式写 `group:<群号>` |
| `mode` | `redact` | `redact` = 打码后照发；`block` = 任何命中都整条拒发 |
| `blockOnSecrets` | true | 密钥/口令类永不外发（即使 `mode=redact`） |
| `blockedReply` | 一句中文提示 | 回程被拒发时，替换成这句话发给对方 |
| `noticeSuffix` | false | 打码时是否在末尾附一句"已隐去 N 处" |
| `logMatches` | true | 命中时在日志留痕：**只记规则名和次数，不记内容** |
| `scanFileContents` | true | 发文件前扫文本类扩展名（txt/md/json/env/js/ps1…，≤ `maxScanBytes`）的**内容**，命中拒发级规则就不发；读不了或不认识的扩展名只判文件名 |
| `maxScanBytes` | 2097152 | 内容扫描上限 |
| `extraPatterns` | `[]` | 自定义规则 `[{ id, regex, flags?, action: 'redact'\|'block', replace? }]`，用于封自己项目里的代号/域名等 |

> 说明：插件层的过滤会在**模型面前**直接失败（`qq_send` 抛错、回程被替换），便于模型自我改写；
> QQ Agent（fork）侧 [src/privacy.js](https://github.com/A-common-Chinese/QQ-agent) 有一份**同源同规则**的实现，
> 因为 fork 才是所有 DSH 内容落到 QQ 的咽喉（`/api/inbound` + 桥回传回复都经它的 sender 出去），
> 而且改 fork 只要重启 QQ Agent、不必重启 DSH。两层互为兜底。


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
