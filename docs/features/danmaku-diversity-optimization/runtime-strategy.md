# 运行时策略细化

## 阶段 1（已完成）
- **重复检测**：
  - 4-gram 哈希 + 90 秒窗口。
  - Jaccard 语义近似 + 300 秒窗口。
  - 统一通过 `#evaluateCandidateText` 执行，命中则计入 metrics，并在 rerank 前直接拒绝。
- **候选评估**：
  - 计算 `relevance`（关键词/角色/标点）与 `styleFit`（长度、标点、禁用词）。
  - 阈值 (`MIN_RELEVANCE_SCORE=0.4`, `MIN_STYLE_FIT_SCORE=0.5`) 以下直接丢弃。
  - Rerank 权重更新，纳入相关度与风格项。

## 阶段 2（已上线，监控调优中）
- **长度/节奏分布**：
  - `src/background/persona-variants.json` 补齐 `lengthProfile`、`stateCadenceSeconds`，运行时根据 persona 均值/方差做软 nudging。
  - `#computeLengthScore` 在偏差较大时仅衰减 30%-40%，结合状态 bias 避免拉扯过猛。
  - Orchestrator 维护滑窗字数历史，指标新增 `lengthMean`、`lengthStdDev`、`lengthDeviation` 方便复盘。
- **能量状态机**：
  - 引入 CALM / ACTIVE / PEAK / COOLDOWN 状态机，综合 scene energy、弹幕密度、tone streak。
  - 每个状态对应独立 rerank 权重包与 cadence 下限；`skipBias` 让 `[skip]` 协同状态偏好。
  - 指标新增 `energyState`、`stateOccupancy`、`stateSoftSkips`，窗口默认 120 秒。

## 阶段 3（已上线）
- **口头禅频控 + 动态禁词**：
  - `speech_tic` 滑窗阈值触发 10 分钟 TTL 的动态禁词，随生成更新并在候选枯竭时按 LRU 释放。
  - 候选命中禁词时在评估阶段直接降权/拒绝，避免事后替换。
  - 指标新增 `speechTicBans` / `speechTicViolations` / `dynamicBanReleases`。
- **Tone 参数化**：
  - Persona 配置 `toneAdjustments`，按场景 tone 调整长度、标点、偏好词汇与 style bias。
  - `#computeToneAlignment` 将 tone 配置折算进 style-fit，并输出命中/未命中计数。
- **few-shot 冷却**：
  - few-shot 示例补充 `sceneTag`、`energy`、`lexicalShape` 元数据，`#selectFewShotExamples` 依据匹配度与冷却时间挑选。
  - 保证多句式覆盖，并追踪 `fewShotSelections` / `fewShotCooldownSkips` 监控多样性。

## 阶段 4（规划中）
- **监控面板**：
  - Dev HUD、Grafana/Looker 等仪表。
  - A/B 模板：明确基线、实验、观察窗口与判定标准。
- **回退机制**：
  - 策略层配置化，支持快速关闭特定子策略。
  - 在 metrics 中持续跟踪拒绝原因、沉默率，作为回退触发条件。

## 集成注意事项
- 所有策略函数保持幂等，避免重复评估带来状态膨胀。
- 与缓存（cacheStore）联动时，确保缓存文本也经过最新策略校验。
- 按阶段提交，逐步开启指标，方便溯源。
