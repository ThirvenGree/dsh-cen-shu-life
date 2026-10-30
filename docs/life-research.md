# 生活插件：高关注项目研究与落地

核对日期：2026-10-30。通过官方 GitHub 连接器读取仓库元数据、提交和源码；星标只是关注度，维护情况和与 DSH 的适配成本一并考虑。

| 项目 | 当时星标 | 最近推送 | 阅读重点 |
|---|---:|---|---|
| [AIRI](https://github.com/moeru-ai/airi) | 50,912 | 2026-10-30 | 角色、自动任务与场景分离；有来源的观察队列，按实际需要触发 |
| [LangGraph](https://github.com/langchain-ai/langgraph) | 44,134 | 2026-10-29 | 持久化检查点、失败恢复、与长期存储的区别 |
| [Letta](https://github.com/letta-ai/letta) | 25,291 | 2026-10-18 | 后台整理与主对话分离，保持持久状态；现有记忆插件已经承担长期存储，因此仅参考边界 |
| [Generative Agents](https://github.com/joonspk-research/generative_agents) | 22,312 | 2024-08-05 | 长期日程、当下行动和反应后调整分层；经典研究实现，不能视为近期持续维护的软件 |
| [AI Town](https://github.com/a16z-infra/ai-town) | 10,726 | 2026-08-26 | 推进模拟时保存输入进度和代次，防止旧结果覆盖新状态 |

元数据里的 pushed_at 表示仓库推送时间，可能包含其他分支；不等于默认分支最新提交时间。例如 Generative Agents 的默认分支提交仍为 2023 年。

## 阅读来源与对应改进

1. [Generative Agents plan.py](https://github.com/joonspk-research/generative_agents/blob/fe05a71d3e4ed7d10bf68aa4eda6dd995ec070f4/reverie/backend_server/persona/cognitive_modules/plan.py)：`_long_term_planning`、`generate_decide_to_react`、`generate_new_decomp_schedule` 将粗粒度规划与动作及反应后修改分开。DSH 采用轻量意向，不排满逐分钟日程，也不生成必须完成的任务。Gemini 随现有内容更新生成 0–6 条意向，结合人物、工作/假日、真实心情、联网天气及已有事件来决定适合考虑的时间、期限和倾向。
2. [AIRI 角色、后台任务和自动化 ADR](https://github.com/moeru-ai/airi/blob/08d0f01a014bc801924a02b34476bcf275f7bbaf/docs/ai/adr/2026-10-10-skills-automations-and-memory.md)、[scheduler.ts](https://github.com/moeru-ai/airi/blob/08d0f01a014bc801924a02b34476bcf275f7bbaf/integrations/satori-bot/src/core/loop/scheduler.ts)：观察、决定和真实动作分开，空闲检查不必每次都调用模型。生活意向与事件事实分开，只作为倾向临时注入；只有原生活引擎真正产生事件才建立关联。意向本身不写入变化流、不加心情分、不触发重复分享、不成为人物演化证据。
3. [AI Town abstractGame.ts](https://github.com/a16z-infra/ai-town/blob/8e05997f2409275669c8344b84a51692e83f3f33/convex/engine/abstractGame.ts)：状态推进带预期代次，防止重复消费或时间倒流。内容生成草稿保存人物、模型、时区和相关配置摘要；过期或配置不兼容的草稿丢弃，不覆盖新状态。模型提出的优先级只影响已有合法候选的权重，时间、冷却、分类、每日/同时进行上限仍由原引擎执行。
4. [LangGraph Persistence](https://docs.langchain.com/oss/python/langgraph/persistence)：将当前运行检查点与长期存储区分。生活内容在模型返回并完成基础验证后先持久化草稿；后续本地应用失败或重启，恢复该草稿而非再向模型付费生成。原生成时间和有效期不延长；人物补充的应用使用原证据、保留既有创建和到期时间，避免部分应用后重复延长。

## 实际行为

- `lifePlanningEnabled` 可在设置关闭；默认开启。它依赖现有的内容更新开关，单独关闭不会影响其他生活、心情或记忆功能。
- `intentions` 是既有生活内容生成请求中的额外字段，没有新增独立模型调用。仍沿用原自动更新周期，以及已有重大心情/记忆变化触发的重新生成。
- `priority=0` 表示在意向有效窗口内暂时避开关联模板；`1` 为普通倾向；`2` 更倾向，支持中间数值。从1.21.0起，多个同模板意向非零权重取平均；明确暂缓的0优先阻止抽取，回执显示实际乘数。
- 只影响自动随机抽取。用户直接启动的事件仍可执行；意向不能突破上班/假日条件、出行开关、特殊事件冷却、天气有效期等原约束。
- 未识别或重名的模板不参与权重计算，设置页会标出；文字仍可以作为未执行的轻量打算。实际事件与意向建立来源关联后，不继续为了同一意向提高该事件概率。
- 当天已过的窗口按未来 24 小时内的下一次出现安排；过期后不影响抽取、不进入提示。读取概览和上下文不会推进事件或写盘。
- 总览显示可考虑、稍后考虑和实际事件关联；显示最近一次抽取的候选倾向和选择。内容更新页显示生成检查点。

## 验证

单元测试覆盖真实事件权重变化、暂缓候选、时间/冷却/配额仍生效、手动操作优先、意向不作为已发生事实、窗口跨日、到期和关闭立即失效，以及只读不写盘。故障注入测试覆盖草稿恢复、模型/配置变化拒绝旧草稿、过期草稿不复活、人物补充部分应用后的幂等恢复。

以上为设计参考与原创 DSH 适配，没有把这些项目的运行时、数据库或现成角色引入本机，也未复制其源码到本公开插件。
