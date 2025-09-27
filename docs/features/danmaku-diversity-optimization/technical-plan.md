# 技术方案

## 分层视角

| 层级 | 目标 | 主要改动 |
| --- | --- | --- |
| Prompt 层 | 提供差异化语境与样本 | few-shot 轮换、tone 提示、动态禁词注入（延续现有实现） |
| 运行时策略层 | 硬约束重复、调节分布、平衡节奏 | **本项目核心：去重索引、状态机、长度/节奏 nudging、rerank 多因子评分** |
| 观测层 | 可视化与报警 | 新增 metrics 字段、HUD 仪表、A/B 报告 |

## 关键模块设计

### 1. 去重与候选评估
- **4-gram Trie + 时间窗**：近 90 秒内严格阻断重复片段。
- **语义近似**：5 分钟窗口内使用 Jaccard / embedding 近似；目前落地 Jaccard，后续视需求接入向量服务。
- **`#evaluateCandidateText`**：统一执行去重、相关度、style-fit 判断，并记录对应 metrics。
- **候选结构扩展**：`CandidateEntry` 新增 `relevance`、`styleFit` 以参与 rerank。

### 2. Rerank 多因子评分
- 加入 `relevance`、`styleFit` 权重，并重新分配长度、novelty、energy 等系数。
- `dup_penalty` 在评估阶段硬拒绝，减少高重复句进入排序。
- 后续阶段将进一步引入 `novelty` 与 `diversity` 交叉奖励、状态机权重包。

### 3. 索引与记忆
- `#recentNGramIndex`：`Map<string, number[]>`，记录 4-gram -> 时间戳数组，随候选落地更新。
- `#recentSemanticHistory`：维护近 300 秒 token 列表，实现语义近似。
- `#rememberOutput` 中写入上述索引，确保缓存命中路径也参与去重。

### 4. Metrics 扩展
- `duplicateHardRejects`、`semanticRejects`、`lowRelevanceDrops`、`styleFitDrops` 等指标写入 `OrchestratorMetrics`。
- 为后续仪表盘准备数据基础。

### 5. 未来阶段钩子（预留）
- 状态机、长度分布、口头禅频控等逻辑将在后续提交中挂接到同一策略层。
- 相关函数接口（例如 `#scoreCandidate`）已具备扩展空间，可继续注入新因子。

## 数据流
1. **输入**：字幕窗口 + 场景分析 (`SceneAnalysis`)。
2. **候选生成**：缓存优先，fallback 到 LLM 调用。
3. **评估环节**：
   - `#evaluateCandidateText` → 去重 & 关联度 & 风格检查。
   - 通过则写入 `CandidateEntry` 并进入 rerank。
4. **Rerank 排序**：依据新权重排序，并执行 persona/base 限流。
5. **持久化**：`#rememberOutput` 更新缓存 & 去重索引。
6. **Metrics 汇总**：`#finalizeMetrics` 输出观测值。

## 性能预估
- 4-gram 检查：平均 O(1)，每条弹幕 1-3 微秒。
- Jaccard 相似度：窗口规模受限，最坏 50 次比较；后续如需向量化，会迁移至 worker。
- 额外对象创建：约 5-10KB/条评论，可接受。

## 回退策略
- 所有新增逻辑挂在单独函数，保留旧逻辑以便 `feature flag` 切换。
- metrics 中持续统计拒绝原因，若异常升高可快速定位。
- 如需临时关闭，可在 orchestrator 配置中绕过 `#evaluateCandidateText`（未来可接入偏好开关）。
