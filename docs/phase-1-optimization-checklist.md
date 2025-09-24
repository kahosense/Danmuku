# Phase 1 — Danmaku Experience Optimization Checklist

> 目标：在真实 LLM 已上线的基础上，让弹幕输出更贴近“真人”观影体验，并提升运行稳定性与观测能力。建议在 2~3 周内完成，按板块逐项勾选。

## A. 提示词与人格调优（Week 1）
- [x] 审查近期真实弹幕样本，归纳"机械化"表现（重复句式、语气僵硬等），形成调优指导要点
- [x] 将 `personas.ts` 中 `systemPrompt` / `styleGuidelines` 更新为更细腻的语气说明，并为每个人设补充 1–2 条 few-shot 示例
- [x] 在 orchestrator 中构建 2–3 条字幕滑窗，包含角色名/情绪扩展信息，传入 LLM 请求
- [x] 在 `llm-client.complete` 请求体中应用 persona 的 `systemPrompt` / few-shot 示例、`maxWords`、`temperature` / `top_p` 等参数
- [x] 对返回文案做轻量后处理（去除舞台提示、首句重复等）并记录修剪率
- [x] 与产品/语言审校侧联合抽检 ≥30 条弹幕，确认语气差异与接受度

## B. 调度升级与播放同步（Week 1-2）
- [x] 在 `orchestrator.processCueBatch` 中维护滚动 cue buffer，依据密度/节奏规则决定是否触发请求（允许“跳评”）
- [x] 引入 persona 级别并发队列与最小间隔控制，避免多 persona 同时发声撞车
- [x] 监听内容脚本中的播放状态（暂停/seek），在后台同步状态并暂停/清空未渲染队列
- [x] 为 regenerate、seek 逻辑补充分段回放策略（只重放到当前播放点）
- [x] 记录实际延迟（字幕时间 → 渲染时间）并输出到 Dev HUD

## C. 稳定性与指标
- [x] 在 `llm-client` 中实现重试（指数退避 2/4/8s）、超时控制、配额剩余额日志
- [x] 当 LLM 调用失败或降级为 stub 时，在控制面板显示状态提示
- [x] 使用 `cacheStore.sizeReport()` 定时（如每 60s）写入命中率、LRU 驱逐次数、缓存尺寸
- [x] 将缓存/LLM 指标发送到背景 logger，并追加 Dev HUD 汇总字段
- [x] 设计简单的“人味”指标（重复率 <20%、平均字数范围等），每次构建输出带有快照

## D. 测试与发布准备（Week 2-3）
- [x] 编写针对 orchestrator 节奏/密度策略的单测（模拟不同字幕节奏）
- [x] 为 `cache-store` 的 LRU、`purgeFuture` 行为补充高负载单测
- [x] 构建 Netflix player mock（含 timedTextCueEntered、seek/pause），完成端到端集成测试
- [x] 增加控制面板与弹幕渲染的关键 UI 交互测试（如 persona 切换、重新生成）
- [x] 更新 `README` / `development-handoff.md` 添加 Phase 1 变更说明与操作指南
- [x] 完成内部观影走查并记录反馈，决定是否进入下一阶段优化（见 `docs/qa-smoke-checklist.md`）

## 里程碑与验收
- M1（Week 1 末）：演示新版提示词 & persona 调整后真实弹幕样例，确认语气改善；核心代码合入主干
- M2（Week 2 末）：调度与稳定性改动上线 Dev 构建，指标面板展示延迟/命中率；完成主要单测
- M3（Week 3 末）：端到端测试通过、文档更新完毕，输出人味评估报告与后续迭代建议

完成所有勾选项后，即可进入 Phase 2（例如扩展多语言、个人化配置等）。
