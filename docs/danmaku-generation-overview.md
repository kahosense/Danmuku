# Netflix AI Danmaku — 生成机制概览（面向产品/运营）

> 快速理解“为什么弹幕像真人”：系统如何筛场、挑人、组文案，并持续监控口味。

---

## 1. 整体流程（Scene → Crowd → Comment）
1. **字幕场景解析**：内容脚本实时收集最近 ~8 秒字幕，`scene-analyzer` 抽取情绪、能量、关键词、角色，判断“是否值得发声”。静场或无梗直接静默。
2. **虚拟观众抽签**：后台维护 4 个基础 persona（潮流影迷、分析派、共情派、吐槽派）+ 12 个虚拟子人格（见第 2 节）。每个场景根据能量、冷却时间、权重，挑选若干虚拟观众作为候选。
3. **候选生成**：对每位候选调用 LLM，提示词注入：场景摘要、字幕窗口、该虚拟观众的 traits/tone/speech tics、最近发言记忆、密度指示，并强调“无新观点请输出 [skip]”。缓存命中则直接复用。
4. **多样性筛选**：候选池进入 reranker，按照长度贴合度、关键词新鲜度、节奏冷却、tone 多样性、权重等打分；同一基础 persona 仅保留 1 条，确保观众谱系丰富。
5. **渲染节奏**：通过 `renderer/overlay` 分配车道与滚动速度，长句自动分段；高能场景允许两条交错，低能场景保持安静。所有输出都会写回短期记忆，避免下一次重复。

---

## 2. 虚拟观众池（Virtual Crowd）
| 基础 Persona | 子人格示例 | 口味设定 | 特殊偏好 |
|--------------|------------|----------|-----------|
| Alex 潮流影迷 | Meme Hunter / Watch Party Host / Hype Friend | 喜梗、复古、群聊氛围 | 喜高能场景，语气轻松，允许偶尔迷因词 |
| Jordan 分析派 | Story Analyst / Skeptical Critic / Film Nerd | 拆结构、讲逻辑、不啰嗦 | 喜中高能剧情；tone 偏 precise/skeptical |
| Sam 共情派 | Support Squad / Soft Fangirl / Grounded Empath | 捕捉情绪、温柔鼓励 | 静场多沉默，高能时延续情绪线 |
| Casey 吐槽派 | Quip Machine / Deadpan Roaster / Dramatic Roaster | 机智不刻薄、偶尔夸张 | 能量高时更活跃，tone 有 snark/deadpan |

- 虚拟观众权重（weight）影响被抽中的概率，同时受 persona 冷却与密度限制。
- 每位虚拟观众保留近 3 条发言记忆（文本+话题+时间），用于续梗或避免刚刚说过的点。
- 偏好开关仍以基础 persona 为单位，用户关闭 “Casey” 即所有 Casey 子人格同时静音。

---

## 3. 观感成果指标
- **有呼吸感**：每 8 秒最多 3 条；静场大概率无弹幕；高潮时可交错两条营造群聊。
- **多视角**：同一窗口同一基础 persona 不重复；tone 多样性分确保冷幽默、情绪派、分析派轮流上场。
- **口语自然**：提示词强调“朋友间聊天”及禁止句式，后处理再加轻微语气词拼贴，过度模板化会被记忆去重。
- **安全与可控**：禁用词、长度、节奏在后处理阶段再次校验；命中缓存、fallback 次数都会在指标里暴露。

---

## 4. Prompt 结构&示例
1. **System**：persona 主设定 + 虚拟观众 traits + tone 指示 + crowd 提醒 + 长度/语言规则 + 密度提示。
2. **Few-shot**：每个基础 persona 4 组高频场景示例（高潮、冷场、续梗、沉默），塑造语气。
3. **User**：
   ```text
   Scene summary: ……
   Subtitle window:
   [00:58] HERO: We need a miracle!
   …
   Traits to convey: dry wit, deadpan.
   Previously you reacted with "Door 1, patience 0" 12 seconds ago.
   Topics you touched recently: miracle, urgency.
   Recent remarks:
   - 12s ago you said "Door 1, patience 0"
   Instruction: Respond in one short spoken-style sentence. Keep it natural, as if chatting with friends.
   ```
4. **调用**：通过 `llmClient.complete` 请求 GPT‑4o mini / 兼容模型，内置温度、top_p、max_tokens。若网络失败则回退到占位文本并记入指标。

---

## 5. 监控与运营位
- **实时 HUD**：展示窗口弹幕数、候选数、lane 使用率、fallback 次数、tone 覆盖率。
- **日志指标**：缓存命中率、跳过率、重复率、tone 多样性得分、基础 persona 占比、LLM 时延。
- **人工评审**：每周抽 30+ 条，按自然度/幽默度/多样性打分，结合 quick feedback（太吵 / 太机械 / 很棒）优化 roster 或提示词。

---

## 6. 后续演进方向
1. **多语言适配**：根据字幕语言调整虚拟观众口癖、tone、禁用词。
2. **互动脚本**：设计“接梗链路”，让虚拟观众之间偶尔对话，同时控制频率避免刷屏。
3. **动态权重调优**：依据场景类型、评审得分实时调整虚拟观众权重，凸显表现最佳的子人格。
4. **用户个性化**：让用户选择偏好的 persona 组合或 tone 预设，逐步走向“自定义弹幕口味”。
5. **质量回传闭环**：接入评审面板与用户反馈，自动标注表现欠佳的提示词样本，供策略/提示词迭代。

---

通过“场景先行 + 虚拟观众池 + 多样性 reranker + 细节化提示词”，弹幕呈现出像真实观众的节奏与差异性。打法已经支撑下一阶段：更个性化的 crowd、跨语言扩展与商业化安全要求。
