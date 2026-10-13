# dsh-qq

QQ ↔ DeepSeek Harness 桥的 **DSH 侧**插件：让 QQ 里的对话落到一个**常驻** DSH 会话上，并让 DSH 主动往 QQ 推消息。

配套的 QQ 侧在 `qq-agent` fork 里：`/dsh` 前缀命中后走 `dsh.transport` 选择通道（`headless` 起进程 / `plugin` 走本插件）。

> ### ⚠️ 它不是"把 QQ Agent 绑回 DSH"
>
> 看到"DSH 侧插件"很容易以为：QQ Agent 从此要依赖 DSH 才能跑。**事实相反。**
>
> - **QQ Agent 仍是独立应用**：上游作者的重要工作之一就是把原本跑在 DSH 里的机器人**解耦**出来独立运行 —— 这一点没变。不装本插件、不配 DSH 地址，QQ Agent 照常工作，行为与上游一致；
> - 本插件只是给那台**独立应用**开了一个「**调用本机 DSH**」的入口：QQ 里发 `/dsh <指令>` 时，把**这一条指令**交给 DSH 的常驻会话执行，再把结果送回 QQ；
> - 桥不生效时（插件没装 / 地址没配）对 QQ Agent 零影响。

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
| `agentPreset` | `standard` | 常驻会话挂哪个 **agent 预设**（= 工具面）。留空 = 只拿全局插件工具 |
| `permissionPreset` | `''` | 常驻会话切到哪个**权限预设**。留空 = 用部署的 `defaultPreset` |
| `permissionAllowedChats` | `['private:85946573']` | **谁能拿到全权限**。不在名单里的会话一律走 `restrictedPermissionPreset`（裸 QQ 号按私聊算；群要显式写 `group:<群号>`；空数组 = 谁都不给） |
| `restrictedPermissionPreset` | `workspace-write` | 非白名单会话用哪一档 |
| `bridgeHint` | `true` | 是否在每条投递给 DSH 的消息后附加「QQ 桥提示」（见下节） |
| `decisionHint` | `''` | 自定义提示文案；留空 = 用 `hint.js` 里的内置文案 |
| `onPresetFailure` | `warn` | 恢复老会话时预设挂不上怎么办（`warn` / `recreate`），见"工具面与权限"一节 |

## 「QQ 桥提示」：为什么必须把"要问用户就用 qq_send"写进每条消息

**症状**：QQ 里发出一条消息后很久没有反应，最后超时；而 DSH 窗口里赫然躺着一个提问。

**成因**：常驻会话是 headless 的，模型看不到"用户其实在 QQ 里"。它一旦要用户做决策，最自然的动作是用
**界面询问**（`ask_user_question` 之类）—— 那个问题只出现在 DSH 窗口里，QQ 侧完全看不到；
而桥这边的 `ask()` 还在等这一轮结束，所以表现为"没反应"，直到 `replyTimeoutMs` 超时。

**修法**：每条投递给 DSH 的消息末尾附一段系统提示（`hint.js` 组装，用户正文一字不动）：

```
[QQ 桥提示：本次请求来自 private:85946573。若要把消息或文件发回该会话，调用 qq_send / qq_send_file 时 chat 参数填 "private:85946573"。
你的回复会自动发回该 QQ 会话 —— 需要用户确认/选择/补充信息时，直接把问题写进回复、然后结束本轮即可；
不要用界面询问（ask_user_question 之类 QQ 侧完全看不到，表现为"没反应"）。
若还要单独发额外内容或文件，用 qq_send / qq_send_file（chat 参数见上）。]
```

> 为什么强调"**直接把问题写进回复**"而不是"用 qq_send 问"：回复本来就会自动回到 QQ，
> 让模型用 qq_send 再问一遍会让用户收到两条一样的消息。qq_send 留给"额外内容/文件"。

- 顺带修掉另一个老问题：模型以前不知道 chatKey，`qq_send` 的 `chat` 参数只能瞎编；
- 单测 `node test/hint.test.mjs`（15 项）：文案要点（含"回复会自动回到 QQ"与"别用界面询问"）、关掉开关、自定义文案、拼接格式；
- 想改语气就填 `decisionHint`；彻底不要提示就设 `bridgeHint: false`。

### 怎么确认它在运行中的实例里真的生效

投影缓存里的 prompt 是**截断的**，看不出文案版本。可靠办法是让模型复述原文：

```
POST /__dsh-qq/message  { chatKey, text: "把这条消息的原文一字不改地复述出来（包括末尾方括号里的那段提示）" }
```

本机实测（2026-10-11）模型确实原样吐出了含"你的回复会自动发回该 QQ 会话 / ask_user_question"的整段提示。

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
| `blockOnSecrets` | true | 密钥/口令类**整条拒发**；设为 `false` 时降级为**打码后照发**（`mode: 'block'` 时仍然拒发）。注意：键名含 `secret`，QQ Agent 控制台的 `sanitizeConfig` 会把它从 `/api/config` 的返回里抹掉（换成恒真的 `hasBlockOnSecrets`），所以这一项只能在 `data/config.json` 里改，界面上放不了 |
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


## 常驻会话的「工具面」与「权限」（`agentPreset` / `permissionPreset`）

`/dsh` 的常驻会话是**程序化创建**的 agent，它的能力由两件事决定，而且**都不吃 DSH 的全局默认**。
本机实测（2026-10-11）：用户问"让机器人帮我关机"，常驻会话回的是
「我没有命令执行能力——本次会话未给我任何 shell/PowerShell 工具」。查下来是下面两层。

### ① 工具面 = agent 预设（`agentPreset`）

`agentPreset` 为空时，会话只拿到**全局注册的插件工具**（qq_send / Blender / WorkBuddy /
workflow / timer / Steam++…）；而 `pwsh` / `fs` / `fs-search` / skills / plan-mode 这些核心工具
是 **agent 预设里的一组插件的组合**。预设由 `@deepseek-ai/dsh-agent-preset` 声明，
本机可选（直接读 `/__dsh-qq/status`）：`standard`、`ptc`、`minimal`、`cordis`、`webcode`。

| 场景 | 正确做法 | 实测结论 |
|---|---|---|
| **新建**会话 | `ctx.agents.create({ meta: { agentPreset } })` | ✅ 有效：投影 `agentPreset="standard"`，工具立刻可用 |
| **恢复**会话 | `ResumeAgentOptions` **没有** `meta`，只能事后挂：`ctx.agentPresets.mount(agent.ctx, id)` | ✅ `mount` 有效（`presetNote="mount 成功（恢复会话）"`）；❌ `agentPresets.select(agent, id)` 对**已存在的 agent 不起作用**（投影仍 `null`、工具也没有） |

所以插件两条路都做：create 带 `meta.agentPreset`；resume 依次试 `mount → select → recompose`，
结果写进 `entry.presetNote`。`mount` 会把预设里的插件挂进 `agent.ctx` —— **工具面就是在这一步出现的**
（实测不会崩宿主）。

### ② 权限 = 权限预设（`permissionPreset`）

常驻会话被播种为 `{ sandbox: workspace-write, approval: ask }`：越界命令（`shutdown`、改系统设置…）
会转成**审批请求**，而无人值守的常驻会话里**没有人应答审批 = 自动拒绝** —— 表现就是"没权限"。

| 层级 | 做法 | 生效范围 |
|---|---|---|
| 部署级默认 | `@deepseek-ai/dsh-permission-presets` 的 `defaultPreset: danger-full-access`（写进 profile 的 `cordis.patch.yml`） | 之后**新建**的会话；配置热重载，不用重启 |
| 单会话 | `ctx.permissionPresets.set(session, name)`（插件在 create / resume / **每一轮请求**各调一次） | 含**已存在**的会话 —— 就地切换，不丢上下文 |
| 单轮 | 请求体带 `permissionPreset` | 只影响这一轮，**且只对白名单会话有效** |

预设名：`read-only` / `workspace-write` / `danger-full-access`（后者 = 沙箱全开 + `approval: never`）。

#### 按会话白名单分档（`permissionAllowedChats`）

只有白名单里的会话能拿到全权限，其他会话**显式降级**。判定在
[`permission-policy.js`](permission-policy.js)（纯函数，单测 `node test/permission-policy.test.mjs`，14 项）：

| 会话 | 结果 |
|---|---|
| 在 `permissionAllowedChats` 里 | 用 `permissionPreset`（或请求参数），即全权限 |
| 不在名单里（**所有群** + 其他私聊） | 用 `restrictedPermissionPreset`（默认 `workspace-write`） |
| 名单为空数组 | 所有会话都受限（fail-closed） |

关键点：**非白名单会话即使请求里硬塞 `permissionPreset: danger-full-access` 也会被降到受限档**（单测里有这条）。
之所以必须显式降级：部署的 `defaultPreset` 已经是 `danger-full-access`，不降的话非白名单会话会跟着吃满权限。

⚠️ 别把它和 `privacy.allowedChats` 混为一谈：那个管"谁能收到隐私信息"，这个管"谁能驱动这台机器"，
两者互相独立（各自默认都是 `private:85946573`）。

⚠️ **安全含义**：`danger-full-access` 等于把这台机器交给能从白名单 QQ 号下指令的人。
QQ 侧的 `dsh.allowedSenderIds` 是唯一的门，务必只填自己的号。

### 诊断接口（宿主不落盘插件的 console 输出，所以状态都搬到 HTTP 上）

`GET /__dsh-qq/status` 会多返回：

```jsonc
{
  "presets": {
    "agentPreset": "standard",
    "permissionPreset": "danger-full-access",
    "availableAgentPresets": ["standard", "ptc", "minimal", "cordis", "webcode"],
    "availablePermissionPresets": ["workspace-write", "danger-full-access"],
    "defaultPermissionPreset": "danger-full-access"
  },
  "chats": [{ "chatKey": "private:85946573", "agentPreset": "standard",
              "presetNote": "mount 成功（恢复会话）", "permissionNote": "danger-full-access（已是）" }]
}
```

`POST /__dsh-qq/message` 的每轮响应里也带 `agentPreset` / `presetNote` / `permissionNote`，
不用翻日志就能看出"这一轮到底挂上了什么"。

### 排查清单（按顺序）

1. `/__dsh-qq/status` → `presets.availableAgentPresets` 里有没有你配的那个名字；
2. 发一条消息看响应里的 `presetNote`：`mount 成功（恢复会话）` / `全部失败 —— mount: …`；
3. 会话投影 `<.dsh>/storages/session_projcache/sessions/<sessionId>.json`：
   `agentPreset.val` 应为预设名，`permissions.val` 应为 `danger-full-access` + `never`；
4. 安全的能力验证：让它执行 `shutdown /s /t 300` 再 `shutdown /a` —— 两行退出码都应为 0，
   之后外部再跑 `shutdown /a` 应回 `(1116) no shutdown was in progress`（反证前面真排程过）。

### 已知坑

- **改 `index.js` 必须重启 DSH**（宿主缓存 ESM 模块）；改 `cordis.patch.yml` 的配置热重载即可。
- **`select()` ≠ 挂预设**：对已存在的 agent 必须用 `mount`（这条卡了一晚上）。
- **审批无人应答 = 拒绝**：任何走 `approval: ask` 的越界操作，在常驻会话里都等于直接失败。
- **插件 `console.log` 不落盘**（Electron 主进程脱离控制台启动，stdout 丢掉）—— `logMatches`
  曾经"看不出效果"就是这个原因（现已改成注入式 logger，并把状态搬到 HTTP）。
- **重启 DSH 的拉起动作必须活在别的进程里**（本机用 WMI 创建 + 等待窗口要留足，如 600 秒），
  否则"杀了没人拉起"会被误判成"Dsh 崩溃"。

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
