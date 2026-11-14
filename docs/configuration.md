# 安装、配置与更新

[返回 README](../README.md)

## GitHub marketplace 安装

在系统终端执行：

```bash
claude plugin marketplace add whiteCcinn/claude-capacity-guard
claude plugin install capacity-guard@claude-capacity-guard
claude plugin list
```

已有会话运行 `/reload-plugins`，或新开会话。插件从自定义 marketplace 安装，不代表已列入 Anthropic 官方目录。

首次安装时也可指定设置：

```bash
claude plugin install capacity-guard@claude-capacity-guard \
  --config enabled=true \
  --config remaining_threshold=20 \
  --config reset_buffer_seconds=60 \
  --config check_interval_seconds=30 \
  --config resume_text=continue
```

用户范围安装用于当前机器的各个项目。组织策略、禁用钩子的启动选项及其他安装范围仍可能影响加载。

## 修改配置

在 Claude 会话输入：

```text
/plugin configure capacity-guard@claude-capacity-guard
```

也可在 `/plugin` 的 Installed 页面选择插件再 Configure。保存后按提示重新加载，新模块读取新参数。

| 配置键 | 类型 | 默认值 | 有效范围与说明 |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | 开关。false 时请求直接通过，不建立新的等待 |
| `remaining_threshold` | number | `10` | 0–99；剩余严格低于该值时暂停，耗尽总会触发 |
| `reset_buffer_seconds` | number | `60` | 1–3600 秒，避免刚到重置时间就立即恢复 |
| `check_interval_seconds` | number | `30` | 5–300 秒，决定后台检查频率 |
| `resume_text` | string | `continue` | 自动发送的完整文本；去除首尾空白后最多 4096 个 JavaScript 字符串单位，空白或超长值回退默认值 |

参数由原生配置系统提供。策略层遇到越界或非有限的数字会使用该参数默认值，不会猜测用户原本想填多少。原生数值输入和 `--settings` 的 `options` 使用对应的数值类型。

系统终端可以检查配置项目，或写入明确的 JSON：

```bash
claude plugin configure capacity-guard@claude-capacity-guard
claude plugin configure capacity-guard@claude-capacity-guard --values-stdin <<'JSON'
{"enabled":"true","remaining_threshold":"20","reset_buffer_seconds":"60","check_interval_seconds":"30","resume_text":"continue"}
JSON
```

`configure --values-stdin` 的 CLI 契约要求单行字符串值，由宿主按 manifest 解析。它与直接写 `--settings` JSON 时的类型要求不同；以本机 `claude plugin configure --help` 为准。

插件自身不直接修改用户的设置文件。原生 `pluginConfigs` 由 Claude 管理，组织锁定的配置仍由宿主控制。

### 自定义自动继续文本

在「自动继续文本」中填写 `continue`、`继续`，或例如“请先核对已有结果，再继续未完成的步骤”。发送时不拼接旧的固定长指令；只有首尾空白会被去除。空白、错误类型或超过长度限制的值回退为 `continue`，不会截断后发送。

升级后没有保存过此配置的用户也默认发送 `continue`。修改后重新加载插件；仍在当前会话等待的记录会使用重新加载后的文本。它不定义外部自动化消息的识别词，外部发送的内容仍按 Claude 原生输入来源和其他插件的规则处理。

Team 恢复使用相同的 `resume_text` 逐一发送给暂停前活动的原成员，再续接主会话。无需开启额外配置；原生成员标记自动决定是否启用队伍协调。`/capacity` 查看成员状态，`/capacity resume` 重试明确的团队控制失败，`/capacity cancel` 取消后续控制而不唤醒成员。详见[队伍协调](team-coordination.md)。

## 源码与本地开发

从仓库根目录运行：

```bash
claude --plugin-dir "$PWD/plugins/capacity-guard"
```

此时配置 ID 为 `capacity-guard@inline`，与 marketplace 安装的设置分别存放：

```text
/plugin configure capacity-guard@inline
```

长期跟随本地源码，也可以将仓库目录添加为本地 marketplace：

```bash
claude plugin marketplace add "$PWD"
claude plugin install capacity-guard@claude-capacity-guard
```

同名 marketplace 的本地来源和 GitHub 来源是不同管理方式；先用 `claude plugin marketplace list` 确认现有来源，避免在不知情的情况下切换它。开发流程见[开发文档](development.md)。

## 更新、禁用与卸载

系统终端执行：

```bash
claude plugin marketplace update claude-capacity-guard
claude plugin update capacity-guard@claude-capacity-guard
```

然后重新加载插件或会话。查看 [CHANGELOG](../CHANGELOG.md) 与[兼容性](compatibility.md)，尤其关注原生宿主版本和恢复语义变化。

暂停等待期间可以先运行 `/capacity cancel`，再禁用或卸载：

```bash
claude plugin disable capacity-guard@claude-capacity-guard
claude plugin enable capacity-guard@claude-capacity-guard
claude plugin uninstall capacity-guard@claude-capacity-guard
```

禁用和卸载是不同操作，用户设置或宿主保存的插件数据不应假定会被彻底擦除。一个新进程读取旧磁盘暂停记录时会要求手动继续。不要通过删除 Claude 全部状态目录来处理普通的等待问题。
