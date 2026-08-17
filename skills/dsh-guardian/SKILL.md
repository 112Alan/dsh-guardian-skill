---
name: dsh-guardian
description: DSH 守护机制（看门狗 + 对话崩溃自动回退 + 设置卡片）的完整实现包与维护手册。resources 目录带全部源码，可整套重建/重装；含验证清单、故障排查、升级后补丁恢复、Windows 编码铁律。回退/看门狗异常、dsh 升级或重装后加载本 Skill。
---

# DSH 守护机制（Guardian）— 实现包 + 维护手册

本机（Windows，dsh 0.1.0-rc.6）的守护三件套：**对话崩溃自动回退（dsh-rollback）**、**看门狗自愈（watchdog.ps1 v2 + dsh-watchdog）**、**设置卡片**。本 Skill 的 `resources/` 目录携带全部已验证的实现，**任何时候都能整套重建**；其余章节是验证、排查与升级恢复手册。

## 一、机制总览

| 组件 | 作用 | 实现位置（resources 内） |
|---|---|---|
| **dsh-rollback** 插件 | 回合致命报错且无输出 → 自动 fork 干净会话 + 追加错误反馈消息（notice 形式）+ 归入原工作区；浏览器客户端轮询 `/rollback-api` 自动打开新会话 | `resources/plugins/dsh-rollback/`（lib/index.js 宿主 + lib/client.js 客户端） |
| **dsh-watchdog** 插件 | 设置卡片（watchdog 命名空间）+ 启动拉起看门狗 + 60s 补位定时器 + `/dsh-stop` 意向停止指令 | `resources/plugins/dsh-watchdog/` |
| **watchdog.ps1 v2** | 独立守护进程：读 `~/.dsh/settings.yaml` 的 `watchdog:` 段（enabled/intervalSeconds/watchVisionProxy）、30s 防抖重启 DSH、`watchdog.stop` 意向停止标记、单实例守卫中控制台模式优先接管 | `resources/watchdog.ps1` |
| **vision-restart.ps1** | 视觉代理（8083）重启命令，watchVisionProxy=true 时由看门狗调用 | `resources/vision-restart.ps1` |

工作原理要点：
- 回退触发：`agent/error` 且该回合**无任何输出**（assistant/message、assistant/chunk、tool/call、tool/result）；同会话 30s 防抖；只 fork 不删日志，零损坏风险；`cp.seq < 0`（首条消息）跳过。
- 看门狗由 `start-dsh.cmd`（控制台模式=关窗即退）或 dsh-watchdog 插件（node 父进程=detached）拉起；单实例守卫中**控制台模式优先接管** detached 实例。
- `/dsh-stop`：写 `watchdog.stop` 标记后退出进程，看门狗见标记不重启。

## 二、完整部署 / 重建（从 resources 恢复）

目标机器是**本机**（路径写死，见下文）。步骤如下：

1. **复制插件包**到源码目录（dsh-watchdog 需先 `npm install` 装依赖）：
   ```powershell
   $dst = 'C:\Users\16021\deepseek多模态'
   Copy-Item -Recurse "$skill\resources\plugins\dsh-rollback" $dst
   Copy-Item -Recurse "$skill\resources\plugins\dsh-watchdog" $dst
   Push-Location "$dst\dsh-watchdog"; npm install; Pop-Location
   ```
   （`$skill` = `~/.dsh/skills/dsh-guardian`；dsh-rollback 零依赖无需 install。）
2. **复制脚本**：
   ```powershell
   Copy-Item "$skill\resources\watchdog.ps1", "$skill\resources\vision-restart.ps1" 'C:\Users\16021\AppData\Local\dsh\' -Force
   ```
3. **装进 profile**（自动更新 package.json 依赖 + bundles）：
   ```powershell
   dsh plugin --profile web add "$dst\dsh-rollback"
   dsh plugin --profile web add "$dst\dsh-watchdog"
   ```
4. **打两个白名单补丁**（设置卡片可见必需）：
   ```powershell
   powershell -File "$skill\resources\patches\patch-apiproxy-allowlist.ps1"
   powershell -File "$skill\resources\patches\patch-webui-aliases.ps1"
   ```
5. **恢复 [dsh-mod] 图片分析补丁**（若目标 apiproxy 是纯净 npm 包）：按第五节说明，用 `resources/patches/dsh-mod-block.js.txt` 的代码块插入 `prompt()`。
6. **settings.yaml 追加**：
   ```yaml
   watchdog:
     enabled: true
     intervalSeconds: 10
     watchVisionProxy: false
   web_settings_namespaces:
     - dsh-ssh
     - task-board
     - remote-web-ui
     - live-stats
     - pet
     - describe-image
     - skin-background
     - community-plugins
     - watchdog
   ```
7. **重启 DSH**（关闭快捷方式窗口 → 重新双击「DeepSeek Harness」），然后跑第三节验证清单。

## 三、验证清单

1. **看门狗**：`Get-Content C:\Users\16021\AppData\Local\dsh\watchdog.log -Tail 3` 应有 `watchdog v2 started`；`watchdog.pid` 对应进程存活。
2. **回退路由**：`Invoke-WebRequest http://127.0.0.1:3080/rollback-api` 返回 JSON（非 HTML）。
3. **设置卡片**：浏览器 设置 → 插件 → 插件配置 → 「看门狗」卡片（启用 / 检测间隔 / 视觉代理兜底）。
4. **/dsh-stop**：聊天输入 `/` 命令菜单有 `dsh-stop`。
5. **配置**：settings.yaml 有 `watchdog:` 段 + `web_settings_namespaces:`（含 watchdog）。
6. **插件诊断**：`C:\Users\16021\AppData\Local\dsh\dsh-watchdog-plugin.log` 应有 `apply start → settings section installed → re-arm timer installed → command /dsh-stop registered`。

## 四、排查与修复

- **插件没加载**：读 `dsh-watchdog-plugin.log` 看 apply 走到哪。缺 `re-arm timer installed` = timer/commands 未挂载——插件必须用 `ctx.inject(['timer'], cb)` / `ctx.inject(['commands'], cb)`，不能 apply 时直接 `ctx.get` 判断（服务挂载晚于 apply）。
- **看门狗不补位**：杀 watchdog → 等 60s → 应被插件重拉。不补位 = 插件 fiber 失败。
- **卡片「不可用」**：命名空间未暴露——查两个白名单补丁是否还在（升级会冲掉）+ `web_settings_namespaces` 是否含 watchdog。
- **回退没生效**：回合有输出（不触发）或 `cp.seq < 0`（首条消息）。宿主日志出现 `[dsh-rollback] ... forked clean child ...` 即触发过。
- **fork 会话进「未分组」**：`workspace.attachSession` 未执行——查 `~/.dsh/storages/workspace.json` 的 `tables.workspaces.<id>.sessionIds`。
- **看门狗是 detached 版（关窗仍会重启）**：控制台模式优先接管规则在 watchdog.ps1 的单实例守卫里；下次正常重启自动恢复。

## 五、升级恢复（dsh 升级 / 重装后必做）

npm 升级会覆盖：apiproxy 白名单、web-ui-settings 别名、[dsh-mod] 补丁。按序处理：

1. 运行 `resources/patches/patch-apiproxy-allowlist.ps1`（字节安全，自动备份 + node --check）。
2. 运行 `resources/patches/patch-webui-aliases.ps1`。
3. **[dsh-mod] 恢复**（npm 原始包没有）：编辑 apiproxy `lib/index.js` 的 `async prompt(request)`：
   - `const { sessionId, mode, content, clientTimeZone } = request.payload;` → `const { sessionId, mode, clientTimeZone } = request.payload; let content = request.payload.content;`
   - `const hasImage = ...` → `let hasImage = ...`
   - 在 `let hasImage` 行后插入 `resources/patches/dsh-mod-block.js.txt` 的代码块（已含正确 tab 缩进）。
   - `node --check` 验证。
4. 若插件源码目录丢失：按第二节 1-3 步从 resources 重建。
5. 重启 DSH + 验证清单。

## 六、编码铁律（血的教训，2026-08-17 事故）

1. **.ps1 / .cmd 脚本**：一律纯 ASCII（英文注释）。必须含中文（如路径 `deepseek多模态`）时，存成 **UTF-8 with BOM**（PowerShell 5.1 无 BOM 按 GBK 读 → 中文乱码 → 可能解析崩溃）。
2. **node_modules 里的 JS 文件**：编辑含中文的 UTF-8 文件**绝不能用** `Get-Content` / `Set-Content` / `WriteAllLines`（GBK 读会损坏中文、字符串字面量可能被引号截断 → 文件无法解析）。必须：
   ```powershell
   $t = [System.IO.File]::ReadAllText($f, [System.Text.Encoding]::UTF8)
   # ...修改 $t...
   [System.IO.File]::WriteAllText($f, $t, (New-Object System.Text.UTF8Encoding($false)))
   ```
   编辑前 `Copy-Item $f "$f.bak"`。
3. 改完验证：`node --check <file>` 语法通过 + 中文完好。
4. 还原被 GBK 损坏的文件：先试 `resources/patches/` 相关备份；npm 原始包用 `npm pack @deepseek-ai/dsh-host-apiproxy@0.1.0-rc.6` 获取，再重打 [dsh-mod]。
