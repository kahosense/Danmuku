# Coach Persona – Technical Plan

## 1. High-level Architecture
```
Subtitle stream ──► Heuristic filter ──► LLM 价值评估 ──► Coach orchestrator
        │                               │
        └──────► Skip log/metrics ◄─────┘
                                 │
                              Prompt builder (子风格) ──► LLM 生成
                                 │
                     Post-process (质量/长度/标签) ──► Renderer (蓝色轨道)
```

### Core Components
| Module | Responsibility | Owner |
| --- | --- | --- |
| Subtitle Heuristic Filter | 首轮判定是否值得教学（停用词、长度、重复度） | background/orchestrator |
| LLM Value Judge | 小模型判断字幕学习价值与推荐子风格 | background/orchestrator + ai |
| Coach Orchestrator | 节奏控制、子风格轮换、缓存 skip 原因 | background/orchestrator |
| Prompt Builder | 组合 System prompt + Few-shot + 用户内容 | background/orchestrator |
| Response Post-processor | `[Coach]` 前缀、字数限制、重复检测 | background/orchestrator |
| Renderer Adjustments | 专属颜色/轨道、metrics 发射 | content/renderer |
| Popup Settings | 开关、密度调节、未来语言切换预留 | popup/main |

## 2. Data Flow Details
1. **字幕批次**：现有 `analyzeScene` 输出基础语义，新增 `evaluateCoachCandidate()` 进行学习价值判定。
2. **价值判定**：
   - 输入：当前字幕文本、最近 3条字幕、历史解释缓存。
   - 输出：`{shouldExplain: boolean, rationale: string, styleHint?: 'concise' | 'cultural' | ...}`。
   - 实现：先跑启发式（正则/黑名单），通过则调用 LLM（`gpt-4o-mini`）产生产值。
3. **Coach Orchestrator**：
   - 维护 cadence 定时器（30–60 s）；
   - 根据 styleHint + 最近使用记录选择子风格 persona；
   - 构造 prompt（System 模板 = 子风格 + 通用规则，User = 字幕 + 场景 + 解释需求）。
4. **生成响应**：
   - 生产模型：建议 `gpt-4o`（第一阶段质量优先）；
   - 结果进入 post-process（trim、替换、skip）。
5. **渲染**：
   - `comment.personaId` = `coach`；
   - renderer 识别 `coach` → 使用固定蓝色样式，可选专属 lane。
6. **监控**：
   - 记录 skip 原因（trivial / repeat / no_value / judge_skip / value_judge_false）；
   - metrics 发送至 Dev HUD（触发次数、成功次数、子风格占比、平均延迟）。

## 3. Storage / State
- `coachSettings`: `{ enabled: boolean, density: 'low' | 'medium' | 'high' }` 持久化到现有 preferences store。
- `coachHistory`: Recent expressions explained（Map<phraseHash, timestamp>）。
- `coachCadence`: 最后输出时间，基于 user density 调整窗口阈值。

## 4. UI Considerations
- Popup：新增 Coach 卡片（开关 + 密度 select + Beta badge）。
- Renderer：`persona-coach` class → 颜色 #2563EB（示例） + `[Coach]` 前缀。
- Dev HUD：增加 Coach 行；当 Coach 关闭时显示 `--`。

## 5. Error Handling & Fallbacks
- LLM 判定失败：默认 `skip` 并记录 `judge_error`。
- Coach 生成失败：亦 `skip`，避免回退到观众 persona。
- 用户在播放中关闭 Coach：清理 `coach` 输出历史，停止后续调用。

## 6. Security / Privacy
- 仅使用字幕文本（不涉及用户个人数据）传给模型；
- 与现有 orchestrator 共享的缓存遵循 current TTL 规则。

## 7. Future Hooks
- 字幕语言切换（中文讲解模式）可在 prompt builder 中基于设置动态选择模板。
- 收藏/生词本需额外的 UI + 存储，不在 MVP。
- 价值判定可引入专用微模型或 fine-tuned classifier。
