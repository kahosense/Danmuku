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

## 阶段 2（规划中）
- **长度/节奏分布**：
  - 定义 persona 级目标：`mean`、`stdev`、`min/max`。
  - 采用软 nudging：偏差超过阈值时仅施加 30-40% 校正。
  - 引入“自由采样回弹”避免锯齿。
- **能量状态机**：
  - 状态 CALM / ACTIVE / PEAK / COOLDOWN。
  - 输入：scene energy、近期弹幕密度、tone 重复。
  - 输出：rerank 权重包、允许的 cadence/长度范围、最低出声率约束。

## 阶段 3（规划中）
- **口头禅频控**：
  - 滑窗统计 + 阈值，超限时加入临时禁用列表并提示 LLM 避免。
  - 避免后处理替换，改为评分阶段降权。
- **动态禁词**：
  - 10 分钟 TTL，最大列表长度 + LRU。
  - 候选枯竭时优先释放动态禁词。
- **Tone 参数化**：
  - 配置 lengthShift、punctuationMode、词汇偏好等。
  - style-fit 扩展 tone 校验，监控命中率。
- **few-shot 冷却**：
  - few-shot 元数据增加 `sceneTag`、`energy`、`lexicalShape`。
  - 采样时保证多句式、多视角，并对同类示例加冷却。

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
