# 兼容性与验证范围

[返回 README](../README.md)

以下是截至 0.1.1、2026-11-14 的验证记录，区分“已验证”和“设计上可能适用”。Mods API 会随 Claude Code 更新，不能把一个版本的通过结果视作通用保证。

| 项目 | 状态 |
| --- | --- |
| Claude Code 2.1.325，macOS Apple Silicon，原生终端交互式会话 | 已验证加载、真实额度读取、状态命令与取消 |
| 原生暂停到定时继续的完整流程 | 已用模拟额度与替身主模型验证；继续消息只提交一次，结束后无待恢复记录 |
| 阈值、多个额度窗口、空读数、存储故障、并发请求、热重载、重新打开记录 | 原生 mock 测试覆盖 |
| 严格 TypeScript 检查 | 使用安装的 Claude Code 生成的声明验证 |
| `interaction-translator` 0.7.0 | 来源过滤源码核对；四项独立原生测试覆盖 `continue` / “继续”与 API / CLI 组合，验证输入翻译零调用；共用会话中的命令已验证。输出翻译仍由对方配置决定 |
| `resume_text` 配置 | 默认、中文、自定义文本、边界回退和热重载等待记录由原生 mock 测试覆盖 |
| Linux | CI 工作流使用 `ubuntu-24.04`；首次远程任务受 GitHub 账号限制，未执行任何步骤，尚不能宣称 Linux CI 已通过，见 [Actions](https://github.com/whiteCcinn/claude-capacity-guard/actions/runs/43572110246) |
| Windows、其他 Claude Code 版本、IDE / Desktop / mobile 界面 | 未完成原生端到端验证 |
| Agent Teams | 部分请求检查；没有完整整队暂停与逐成员恢复验证 |
| `claude -p` / SDK | 无界面低额度路径有 mock 测试；不提供退出进程后的自动恢复 |
| 实际账号重置后的多小时持续运行 | 未完成独立长时间实测，当前证据为原生替身流程 |

本版只有单一的剩余百分比阈值，对所有原生报告的窗口保守生效，没有按模型或窗口配置不同阈值。API Key、网关或第三方服务只有在宿主提供可用的 `rateLimits` 时才能做百分比检查。

本地测试通过与远程 CI 通过是不同证据。CI 无法启动、账号额度或外部服务故障不应写成测试通过，也不应自动通过禁用验证来掩盖。维护者会在改动描述中列出实际执行的检查。

## 宿主升级后的检查

1. 对照新宿主生成的 Mods 类型检查钩子、state 和返回值契约。
2. 运行 manifest 验证、测试和类型检查。
3. 验证 `/capacity`、取消、模拟暂停与恢复。
4. 使用翻译或 Agent Teams 时，单独验证它们的消息来源和生命周期。

原生替身流程与自动化步骤见[开发文档](development.md)，已知行为限制见[架构](architecture.md)和[集成](integrations.md)。
