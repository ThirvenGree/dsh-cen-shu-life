# 逐项注意判断：2026-10-30 第二轮研究

本轮继续查阅 [Generative Agents](https://github.com/joonspk-research/generative_agents)（22,311 星，Apache-2.0）和 [AIRI](https://github.com/moeru-ai/airi)（50,922 星，MIT）。星数为本日查询快照。

- Generative Agents 的 [reflect.py](https://github.com/joonspk-research/generative_agents/blob/main/reverie/backend_server/persona/cognitive_modules/reflect.py)，blob 2daf2fd9a0b4fc8ee670a20294bc86e63db85117：模型先选择反思焦点，再检索和产生有来源的认识。借鉴焦点与来源分离，不照搬它的固定重要性总分触发器。
- AIRI 的 [scheduler.ts](https://github.com/moeru-ai/airi/blob/main/integrations/satori-bot/src/core/loop/scheduler.ts)：事件先进入未读队列，处理中保留新到事件。借鉴排队与处理解耦，不引入它的聊天平台或角色。

## 落地

生活1.24.0提供只读attentionContext：按明确事件编号提供当前阶段、进行中/已结束/未知状态、历史阶段与心情回执。读取不会推进事件或修改状态，不把未执行计划变成经历。

独处0.6.0让Gemini在原有注意调用里逐项返回：现在关注、稍后、不确定、只记下，以及理由和1–1440分钟复看建议。语义、重要性和时机均由模型判断，没有关键词分类或重要性分数门槛。事件阶段不再因种类被排除在合并触发之外。

暂缓只影响该项；新变化在满足合并窗口、调用间隔、休息和每日预算后仍能进入判断。遗漏项仍待处理，未知编号拒绝采用；逐项记录与复看时间跨重启保存。到期是最早可复看时间，仍受既有休息和调用预算约束，不能承诺精确到分钟执行。原有无新事件时的独处定时思考继续保留。

界面展示逐项决定和理由；生活提供事实，Gemini决定怎样关注。原有DSH角色模型写日记，Gemini审核来源和联动候选；并未把DSH主模型换成Gemini。

## 调用与验证

采用原注意调用返回更多决策，不逐项单独发请求；新阶段和新事件可能更早触发下一次合并调用，所以允许调用量适度增加，现有每日预算和最短间隔不变。结构化响应不在Google schema中展开maxItems=80（实测会导致HTTP400），本地仍严格验证最多80项和合法编号。

临时目录测试覆盖不同条目独立暂缓、遗漏不清空、新阶段不被旧暂缓阻塞、重启保持、无效编号拒绝，以及生活上下文只读和事件结束状态。真实Gemini测试对“整理结束后犹豫是否保留旧票根”返回attend，对“顺手擦灰”返回record；仅验证判断，无写入正式记忆、心情或QQ发送。该例不构成固定规则，其他情境允许不同判断。

仅借鉴设计并编写本机适配，未复制第三方源码或安装额外服务。
