# 实施检查清单

- [x] **阶段 1：硬去重与候选评估**
  - 4-gram + 语义重复检测索引
  - 候选 `relevance` / `styleFit` 评分与 rerank 权重调整
  - Metrics 扩展（重复/相关度/风格拒绝计数）
- [x] **阶段 2：长度 & 节奏分布控制 + 能量状态机**
  - 已上线：persona `lengthProfile` / `stateCadenceSeconds` 配置与软 nudging
  - 已上线：能量状态机（CALM/ACTIVE/PEAK/COOLDOWN）与最低出声率门控
  - 已上线：状态权重包、`skipBias` 与 rerank 协调
- [x] **阶段 3：风格细节调制**
  - 已上线：口头禅频率滑窗监测 + 10 分钟 TTL 动态禁词，支持优先释放与指标统计
  - 已上线：Tone 参数化（长度偏移、标点偏好、词汇倾向/避讳）并纳入 style-fit 校验
  - 已上线：few-shot 增补 `sceneTag`/`energy`/`lexicalShape` 元数据与冷却采样逻辑
- [ ] **阶段 4：监控与验证**
  - HUD/日志指标打点（熵、重复率、口头禅命中等）
  - A/B 实验设计与回归测试
  - 回退开关与配置化策略

> 更新说明：阶段 1 已合入 `src/background/orchestrator.ts`，后续阶段将基于该策略层继续扩展。
