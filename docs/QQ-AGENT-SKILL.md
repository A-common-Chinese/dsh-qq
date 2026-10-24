# 配套：QQ Agent 技能（dsh-agent）

> 本文件说明 **第二个 Release 资产**：给 QQ Agent 用的技能包。
> dsh 侧插件的安装见 [INSTALL.md](../INSTALL.md)。

## 为什么是两个包

| 包 | 装在哪 | 作用 |
|---|---|---|
| `dsh-qq-plugin-<version>.zip` | **DSH 侧**（`<DSH>/resources/app/plugins/dsh-qq/`） | 提供 `/__dsh-qq/message` 路由：接收 QQ 侧转来的任务，在常驻 DSH 会话里执行并回传结果 |
| `dsh-agent-skill-<version>.zip` | **QQ Agent 侧**（`<QQAgent>/resources/app/skills/dsh-agent/`） | 注册 `dsh_task` 工具，让 QQ 里的**模型自己**能调 DSH（而不是只有 `/dsh` 命令） |

两者独立：只装插件 = 你手动发 `/dsh` 才能用；只装技能 = 技能会报"桥不通"。
**要"机器人自己会干活"，两个都要装。**

## 安装技能

1. 解压 `dsh-agent-skill-<version>.zip`，把里面的 `dsh-agent/` 整个目录放进：
   ```
   <QQ Agent 安装目录>/resources/app/skills/dsh-agent/
   ```
   （热重载默认开启，放进去几秒后自动生效，无需重启）
2. 控制台「技能」页应出现 **DSH 远程执行 v1.0.0**
3. 打开 **设置 → 技能 → DSH 远程执行**，按需配置：

| 键 | 默认 | 建议 |
|---|---|---|
| `scope` | `whitelist` | 保守就保持；`mention` = 只在被点名时可用 |
| `permissionMode` | `read-only` | 先只读跑一段时间，确认行为可控再提权 |
| `maxPerHour` | `3` | 聊天多的群建议 2~3 |
| `timeoutSec` | `25` | 任务重可以调到 60 |
| `bridgeUrl` | `http://127.0.0.1:19387/__dsh-qq/message` | 与 dsh-qq 插件路由一致 |
| `bridgeToken` | 空 | 插件里设了 `bridgeToken` 就必须填一致 |

> QQ Agent 安装包会内置一份本技能（`mode=off`）；这个 zip 用于手动安装/升级。

## 它会怎么用

- 群里有人说「去我电脑上看看昨天的构建日志」「把这批图片压一下」，模型自己判断是否调 `dsh_task`
- 结果以**摘要**（≤1200 字）回到对话；超时会提示"可能仍在后台执行"
- 每次调用写日志：`[dsh-agent] ✅ <会话> 1234ms · 第 2 轮 · 权限=read-only`

## 安全边界（默认值就是底线）

- **默认关闭**：安装包自带但技能默认禁用，启用才会出现工具
- **默认只读**：模型不能改文件、不能装东西
- **只在白名单会话**：非白名单消息根本不进模型
- 每小时限额 + 单次超时，避免长任务卡住对话
- 想更严：`scope=mention`（只在被 @ 时可用），或在技能页把本技能禁用（工具会从模型列表消失）

## 打包

```powershell
powershell -File scripts/pack-release.ps1
# 产出：dist/dsh-qq-plugin-<version>.zip  和  dist/dsh-agent-skill-<version>.zip
```
