# Coach Persona – Testing Plan

## 1. Unit / Integration
- **Heuristic Filter**: Vitest cases for trivial phrases, long idioms, repeated phrases.
- **Value Judge Bridge**: Mock LLM outputs (true/false) to ensure orchestrator obeys decisions.
- **Cadence & Density**: Ensure user-set `low|medium|high` translates to expected min interval thresholds.
- **Prompt Builder**: Snapshot tests for 4 子风格 System/User messages.
- **Post-processing**: Verify `[Coach]` prefix, 25-word clamp, duplicate suppression.

## 2. Manual QA Checklist
- 启动/关闭 Coach，确认弹幕颜色与标签正确；与其他 persona 共存时不抢车道。
- 连续播放 30 分钟样本片段，观察频率是否符合密度设置。
- 字幕案例：
  - 高价值表达 → 应触发 Coach。
  - 简单确认句 → 应 skip。
  - 短时间内重复同一短语 → 仅首条解释。
- 错误注入：
  - 禁用 LLM judge → fallback 行为。
  - LLM 返回 `[skip]` → 不渲染。

## 3. Metrics / Telemetry (MVP)
- `coach_candidates_total`
- `coach_candidates_filtered`（按 skip reason 分组）
- `coach_comments_rendered`
- `coach_avg_latency_ms`（judge + generation）
- `coach_style_distribution`

## 4. Experiment Validation
- 内测名单（开发/QA）开启 feature flag。
- 收集主观反馈：学习价值、干扰度、语气自然度。
- 若通过，则准备灰度：逐步扩大用户队列，监控指标波动。

## 5. Release Gate
- 所有单元/集成测试通过。
- 手动 QA 清单完成并归档。
- 指标看板确认数据可用、无异常峰值。
- feature flag 默认仍关闭，待 PM 决策后对用户可见。
