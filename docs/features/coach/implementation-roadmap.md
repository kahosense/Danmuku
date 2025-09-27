# Coach Persona – Implementation Roadmap

## Phase 0 – Scaffolding (1 sprint)
- 新建 feature flag + popup UI（开关 + 密度）与 renderer 蓝色样式。
- 更新 shared preferences schema，确保老版本兼容。
- 在 orchestrator 中注册 Coach persona 占位，默认 `skip`。

## Phase 1 – Candidate Detection MVP (1 sprint)
- 构建字幕启发式过滤器（长度阈值、黑名单、重复检测）。
- 写入 skip reason 日志结构，确保 metrics pipeline 就绪。
- 实装 LLM 价值判定 (`gpt-4o-mini`)，序列化输出结构，控制 200–300 ms SLA。

## Phase 2 – Coach Persona Prompting (1 sprint)
- 在 roster 中新增 `coach` 基 persona + 4 child virtual users，补齐 Few-shot。
- Prompt builder：接入 style hint + fallback 随机权重逻辑。
- Orchestrator：cadence 管理、子风格去重、LLM 生成（`gpt-4o`）。
- 后处理：`[Coach]` 前缀、长度限制、重复清理。

## Phase 3 – Rendering & UX (0.5 sprint)
- Renderer：`persona-coach` 样式、可选专属车道（配置化）。
- Popup 文案 / Beta 标识及 hover 说明。
- Dev HUD 指标：触发、skip 原因、平均延迟、子风格占比。

## Phase 4 – QA & Experiment Launch (0.5 sprint)
- 自动化测试：
  - Vitest：cadence 控制、子风格轮换、skip 类型。
  - Prompt snapshot：4 子风格模板。
- 手动 QA：
  - 字幕样本（高价值 vs. trivial）
  - 长时间播放中的频率感受
  - 与其他 persona 共存表现
- 准备实验方案（默认关闭，仅 flag 受控），产出回滚策略。

## Dependencies / Risks
- 启发式可能不足以过滤 trivial 表达 → 需快速迭代词表与 LLM prompt。
- 价值判定的模型选择需与平台成本策略同步。
- UI 需协调设计资源确认 Coach 颜色/文案。
