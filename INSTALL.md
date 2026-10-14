# dsh-qq 安装说明（v0.1.1）

## 这是什么

**DSH（DeepSeek Harness）侧的桥插件**：让 QQ 里的对话落到一个**常驻**的 DSH 会话上，并让 DSH 反过来往 QQ 推消息和文件。

配套的 QQ 侧是 **QQ Agent 的一个改造版**（`/dsh <指令>` 由它转发；安装包单独发）。两边都装好才是一条完整的桥。

> 它不是"把 QQ Agent 绑进 DSH" —— QQ Agent 始终是独立应用；这个插件只是给它开了一个"调用本机 DSH"的入口。

## 前置条件

- 已安装 **DeepSeek Harness**（DSH），能正常启动
- 已安装 **QQ Agent**（对端），并且 QQ 已登录、能收发消息

## 安装（3 步）

**① 放进 DSH 的 profile**

把本目录整个复制（或链接）到你的 profile 插件目录，**目录名必须是 `dsh-qq`**：

```
<你的 DSH profile>\node_modules\dsh-qq\      ← index.js 等就在这一层
```

也可以用 DSH 的插件管理器 / GUI 插件页，从本目录安装。

**② 合并配置**

把 `cordis.patch.yml.example` 的内容按你的环境改好（**至少要改 `cwd`**），合并进：

```
<你的 DSH profile>\cordis.patch.yml
```

**③ 重启 DSH**

插件的 `index.js` 是 ESM，宿主会缓存模块 —— **改源码必须重启 DSH**；之后改配置（含 GUI 里改）不用重启。

## 最小配置示例

```yaml
- insert:
    - id: dsh-qq
      name: dsh-qq
      config:
        enabled: true
        cwd: D:\你的工作目录              # 常驻会话的工作目录，必填建议
        qqBaseUrl: http://127.0.0.1:3310  # QQ Agent 控制台地址（DSH → QQ 推送用）
        agentPreset: standard             # 工具面（没有它就没有 pwsh/fs 工具）
        permissionPreset: danger-full-access
        permissionAllowedChats:           # 只有名单里的会话能拿全权限
          - 'private:<你的QQ号>'
        restrictedPermissionPreset: workspace-write
```

- `enabled: false` = 整插件静默（不挂路由、不注册工具）
- `bridgeToken` 留空 = 只靠回环地址保护（本机任何进程可调）；跨机部署请务必设置
- `pluginToken` / `qqToken` 对应两边的共享密钥

## 怎么用

- QQ 里发 **`/dsh <指令>`** → 指令进入 DSH 常驻会话 → 结果回到 QQ
- QQ 里发 **`/dsh 状态`** → 看当前第几轮、自动轮换阈值
- QQ 里发 **`/dsh 新 <任务>`** → 丢掉旧上下文，开一条新会话
- 任意 DSH 会话都能调 **`qq_send`** / **`qq_send_file`** 往 QQ 推消息 / 文件

## 功能一览

| 功能 | 说明 |
|---|---|
| 常驻会话 | 每个 chatKey 一条会话，多轮共享上下文（不等于每次新进程） |
| **会话轮换** | 满 `maxTurnsPerSession`(默认 20) 或 空闲 `maxSessionIdleHours`(默认 12h) 自动换新会话；`rotateNotice` 控制是否在回复里附一句说明；`POST /__dsh-qq/reset` 可手动重置；轮数持久化在 `~/.dsh-qq-sessions.json` |
| 权限白名单 | `permissionAllowedChats`（默认 `private:85946573`）；不在名单里的会话显式降级 |
| 出站隐私过滤 | 非白名单会话：邮箱/手机/身份证/银行卡/用户目录路径等**打码**，密钥类**整条拒发**；支持自定义规则 |
| 桥注入提示 | 告诉模型"用户看不见 DSH 窗口"，需要决策时用 `qq_send` 或直接写进回复，别用界面询问 |

## 自检

```powershell
# 插件是否挂上（应先启动 DSH）
curl http://127.0.0.1:19387/__dsh-qq/status

# 单测（需要 Node 20+）
node test\rotation-policy.test.mjs
node test\hint.test.mjs
node test\permission-policy.test.mjs
node test\privacy.test.mjs
```

`/__dsh-qq/status` 能返回 JSON（含 `presets` 与 `rotation`）就说明装好了。

## 常见问题

| 现象 | 原因 / 处理 |
|---|---|
| 改了 `index.js` 没生效 | 宿主缓存 ESM 模块 → **必须重启 DSH** |
| DSH 里没有 `pwsh` / `fs` 工具 | 常驻会话的 `agentPreset` 为空 → 配 `agentPreset: standard` |
| 越界命令（关机等）被拒 | 会话权限是 `workspace-write + approval=ask`，而无人应答审批=拒绝 → 配 `permissionPreset` |
| QQ 那边"没反应" | 模型可能在 DSH 窗口里问了 → 本插件会注入提示；仍出现请看 `hint.js` 文案 |
| 上下文越用越贵 | 会话轮换阈值调小（`maxTurnsPerSession`），或用 `/dsh 新` 手动重置 |

## 目录结构

```
dsh-qq/
  index.js              插件主体（路由 / 常驻会话 / 工具）
  hint.js               桥注入提示（含"要问用户就用 qq_send"）
  permission-policy.js  按会话的权限白名单判定（纯函数，有单测）
  rotation-policy.js    会话轮换策略（纯函数，有单测）
  privacy.js            出站隐私过滤
  test/                 4 个单测文件
  README.md             完整文档
  cordis.patch.yml.example  配置示例（改完合并进 profile）
```
