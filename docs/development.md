# 开发与测试

[返回 README](../README.md) · [贡献约定](../CONTRIBUTING.md)

## 项目结构

```text
.claude-plugin/marketplace.json      marketplace 入口
plugins/capacity-guard/
  .claude-plugin/plugin.json        插件 manifest 与原生配置
  hooks/hooks.json                 Mods 模块入口
  hooks/register.ts                生命周期、暂停、恢复和命令
  hooks/policy.ts                  纯额度策略
  hooks/checkpoint.ts              记录校验与窗口合并
  types/index.d.ts                 自包含 state 类型
  tests/*.test.ts                  原生测试套件
dev/smoke-fixture/                 替身主模型与模拟额度
docs/                             产品和开发文档
openspec/changes/                  本地规格与审查记录，Git 忽略、不推送
```

没有运行时 npm 包或单独的服务进程。Claude Code 加载 TypeScript 模块并提供 `claude-code` 和 `claude-code/testing`。不要尝试用 Node 直接运行原生钩子。

## 自动测试

从仓库根目录执行：

```bash
claude plugin validate . --strict
claude plugin validate plugins/capacity-guard --strict
claude plugin test plugins/capacity-guard
```

测试为额度、时间、保存、停止、提交和流式模型结果提供替身，不调用真实模型。它们验证：严格阈值与耗尽、多个重置窗口、缺失和过期读数、记录校验、并发暂停防重、接受与拒绝的用户输入、取消、异常存储、未知交付、热重载和新进程记录。

新增功能先写失败测试，再实现；失败路径和并发条件应与正常路径一起评审。不会暴露到 mock 的宿主语义，需补原生流程证据，不能自行伪造保证。

## 类型检查

先以源目录启动一个交互式开发会话：

```bash
claude --plugin-dir "$PWD/plugins/capacity-guard"
```

Claude Code 会生成 `.claude-plugin/types/` 和插件根目录的开发 `tsconfig.json`。退出开发会话后执行：

```bash
npx --yes --package typescript@5.9.3 tsc --noEmit -p plugins/capacity-guard
```

这些宿主生成文件由 `.gitignore` 排除；它们可能包含本机连接的工具类型，不应发布。原生 state 契约 `types/index.d.ts` 则是手写、必须提交的自包含类型。

## 原生暂停与恢复流程

[开发测试插件](../dev/smoke-fixture/README.md)在真实交互式宿主里提供 99% 已用读数和固定主模型响应。先执行 `/quota-smoke` 设置重置时间，再立即发一条简短测试输入。

预期结果：请求被守卫拦截，出现等待；重置加缓冲后只有一条带插件来源的继续消息；替身主模型输出 `OFFLINE_RESUME_OK`；`/capacity` 随后没有待恢复任务。测试完成后退出会话，开发 fixture 不加入生产 marketplace。

fixture 只替换主模型，其他插件、设置钩子和 Claude 后台特性保留自己的行为。示例命令对当前测试进程禁用已安装的生产实例和翻译插件，避免重复加载与不相关后端调用；不会改写用户永久设置。

## 翻译来源互操作检查

如果本机有可信的交互翻译插件源码，可以执行：

```bash
python3 dev/check_translator.py ../claude-interaction-translator/plugins/interaction-translator
```

辅助脚本从守卫 manifest 读取默认继续文本，并额外加入中文“继续”，复制对方的模块到临时目录，运行四项来源测试。分别使用对方的 `api` 和 `codex-cli` 设置，验证 `plugin` 来源文本与来源信息不变，HTTP 和进程翻译调用数均为零。原项目与本机永久设置不会被修改，临时目录测试后清理。

这是对指定翻译插件版本的实际钩子测试，不代替两个完整会话共用时所有输出路径的验证，也不能推广到未来版本。只对你信任的源码执行原生插件测试。

## CI 与发布准备

[GitHub Actions](../.github/workflows/ci.yml)固定使用 Ubuntu 24.04 和 Claude Code 2.1.325，运行严格 manifest 验证和原生 mock 测试。只有实际运行并通过的远程任务才能记为远程验证通过。

发版前还应检查两份 README、配置表、manifest 和 marketplace 版本一致，运行本机严格类型检查和相关原生流程。外部 Actions 或账号故障与代码测试失败需要分别报告。当前兼容性结论见[验证范围](compatibility.md)。

## 原生 API 约束

`on` 的事件名必须可被静态分析。`$` 的命名空间调用保持完整；需要传递 `$` 时使用同文件顶层函数，不通过对象方法或外部工厂隐藏宿主能力。钩子内不能依赖 Node 文件系统或全局定时器。

公开参考：[Mods reference](https://code.claude.com/docs/en/plugins/mods/reference.md)、[Mods API](https://code.claude.com/docs/en/plugins/mods/api.md)、[原生测试](https://code.claude.com/docs/en/plugins/mods/test.md)。版本冲突时优先核对本机生成的声明。
