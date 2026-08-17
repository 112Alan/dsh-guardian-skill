# dsh-guardian 技能（看门狗 + 对话崩溃自动回退）

DSH（DeepSeek Harness）守护机制技能：**对话崩溃自动回退（dsh-rollback）+ 看门狗自愈（watchdog v2 + dsh-watchdog）+ 设置卡片**。`skills/dsh-guardian/resources/` 携带全部已验证的实现源码，可整套重建/重装；SKILL.md 内含验证清单、故障排查、升级后补丁恢复与 Windows 编码铁律。

## 一句话用法

把下面这段发给**任何一个新 DSH** 的 AI，它就会按本技能完成全套部署（对话回退 + 看门狗 + 设置卡片）：

> 请用 web 工具抓取并完全遵循这个技能：
> https://raw.githubusercontent.com/112Alan/dsh-guardian-skill/main/skills/dsh-guardian/SKILL.md
>
> 这是"DSH 守护机制"技能（对话崩溃自动回退 + 看门狗自愈 + 设置卡片），包含完整实现与部署步骤。请：
> 1. 按里面的「完整部署 / 重建」章节部署（路径按当前机器实际情况调整）
> 2. 需要的插件源码在 skills/dsh-guardian/resources/plugins/ 目录
> 3. 打完两个白名单补丁（resources/patches/）和 [dsh-mod] 补丁后重启 DSH
> 4. 按「验证清单」逐项检查并汇报结果

## 仓库内容

| 路径 | 用途 |
|---|---|
| `skills/dsh-guardian/SKILL.md` | 技能本体——frontmatter `name`/`description` + 完整说明书（部署/验证/排查/升级恢复/编码铁律） |
| `skills/dsh-guardian/resources/plugins/dsh-rollback/` | 回退插件完整源码（宿主 `lib/index.js` + 客户端 `lib/client.js`）：回合致命报错无输出时自动 fork 干净会话 + 错误反馈 + 工作区归组 |
| `skills/dsh-guardian/resources/plugins/dsh-watchdog/` | 看门狗插件完整源码（设置卡片客户端 + 启动拉起 + 60s 补位 + `/dsh-stop`） |
| `skills/dsh-guardian/resources/watchdog.ps1` | 看门狗 v2 独立脚本（配置驱动、意向停止标记、控制台模式优先接管） |
| `skills/dsh-guardian/resources/vision-restart.ps1` | 视觉代理（8083）重启脚本 |
| `skills/dsh-guardian/resources/patches/` | 升级后一键重打的两个白名单补丁脚本 + `[dsh-mod]` 图片分析补丁代码块 |

## 功能简介

- **回退**：发消息遇致命报错（如 `yield* not async iterable`）且无任何输出时，自动在「发送前」位置派生干净会话并打开，附错误反馈（出错位置/错误信息/询问修复或换方式），新会话留在原工作区。同会话 30 秒防抖，有真实输出的回合不回退。
- **看门狗**：DSH 崩溃 10 秒内自动拉起（30 秒防抖）；检测间隔、启用开关、视觉代理兜底均可在设置页「看门狗」卡片配置；`/dsh-stop` 意向停止不会被重启；关窗即退、崩溃即拉。
- **设置卡片**：设置 → 插件 → 插件配置 → 「看门狗」（enabled / intervalSeconds / watchVisionProxy）。

## 安装技能

把 `skills/dsh-guardian/` 放到 DSH 的技能查找目录（例如 `~/.dsh/skills/`），或保留在本仓库并让 agent 指向该路径。

## 注意事项

- 源码中的路径（`C:\Users\16021\deepseek多模态`、`~/.dsh/profiles/web` 等）面向作者主机的原始部署；部署到其他机器时按实际情况调整。
- `vision-restart.ps1` 中的 `--admin-token dsh-vision-2026` 与 `--api-key sk-gemini-test-123` 是**本机视觉代理的测试值**，非真实密钥。
- dsh 升级（`npm i -g @deepseek-ai/dsh`）会覆盖白名单补丁，升级后按 SKILL.md「升级恢复」章节重打。
