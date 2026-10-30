# 2026-10-30：从流行项目借鉴可恢复的插件联动

## 查阅与选择

GitHub 当日快照（星数会变化）：

| 项目 | 星数 | 查阅内容 | 本轮采用 |
|---|---:|---|---|
| [AIRI](https://github.com/moeru-ai/airi) | 50,921 | [插件架构设计](https://github.com/moeru-ai/airi/blob/main/packages/plugin-sdk/docs/design/architecture.md) | 能力协商：旧协议继续可用，新联动能力单独声明并验证响应 |
| [LangGraph](https://github.com/langchain-ai/langgraph) | 44,143 | [持久化](https://docs.langchain.com/oss/python/langgraph/persistence)、pregel/_runner.py 的 commit/put_writes | 各项成果独立持久化，失败重试不重跑已经成功的项 |
| [Graphiti](https://github.com/getzep/graphiti) | 32,360 | graphiti_core/edges.py 区分有效时间和失效时间 | 区分原始有效期与迟到的处理时间；临时效果过期不补发。这是本插件的 TTL 策略，不等同于 Graphiti 的事实失效语义 |
| [Letta](https://github.com/letta-ai/letta) | 25,292 | 后台记忆与工作流方向 | 本轮不另装记忆系统，继续用已有记忆插件 |
| [Inngest](https://github.com/inngest/inngest) | 6,002 | [durable execution primitives](https://www.inngest.com/docs/durable-execution/primitives) | 稳定操作编号、分项结果和可见重试状态 |

AIRI/LangGraph 为 MIT，Graphiti/Letta 为 Apache-2.0；Inngest 仓库 LICENSE.md 是 SSPL 加未来 Apache 授权安排，不能笼统当作 MIT。AIRI 所引页面是架构设计文档，未将其所有设计宣称为已发布实现。本轮仅参考设计，代码为原创 JavaScript 适配，没有复制第三方源码，也没有安装额外数据库或工作流服务。直接引入这些运行时会增加后台服务与状态迁移；当前 DSH 已提供会话、持久化和记忆工具，原地适配更合适。

## 实际改动

- 生活插件声明 `capabilities.independentEffects=1`。独处提交 `effectsProtocol:1`，并保存原始载荷与有效期；生活逐项保存记忆、心情、意向回执。
- 一项失败，其他项继续；独处原有五分钟联动重试只补失败项。已完成项直接返回已有回执，不再调用接收逻辑。相同编号不能换内容。
- 心情额度登记时保存待发布候选，写入候选成功后再确认发布。两处之间中断，恢复时只补写同一候选，不重复扣额度；历史旧回执缺少载荷时保守去重。
- 原始有效期已过：尚未完成的心情、意向记为过期并停止补发；审核通过的历史自身记忆仍可进入原有写回队列。此处 queued 只表示入队，不表示所有记忆后端已经保存。
- 独处设置页分别显示各项已处理、待重试或已过期；记录仍遵守原有自身记忆来源隔离、审核、每日额度与分享去重。
- 没有增加 Gemini 调用，没有改变角色设定或随机判断，也不把感知联动等同于 QQ 发送。

## 边界与验证

生活回执最多保留约500个近期完成编号，未完成不淘汰，总上限1000；超过上限明确报错。旧版调用仍按原协议运行；新协议必须被响应确认。保证范围是当前本地持久化和既有接收端的去重机制，不宣称外部服务无限期 exactly-once。整体磁盘无法写入时不能保证继续保存后续项，故障仍会明确返回。

新增故障注入覆盖：记忆失败而心情继续、分项回执跨重启、编号内容不一致、重试期间过期、心情候选写盘中断、发布确认中断，以及独处端能力响应验证。全部测试使用临时目录，不向 QQ 发送测试消息、不修改真实心情。
