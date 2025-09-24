# Netflix AI Danmaku — 生成机制概览（面向产品/运营）

> 目标：介绍当前弹幕系统的工作流程与预期效果，帮助非技术同事理解“为什么弹幕看起来像真人”以及后续可优化的方向。

---

## 1. 整体流程

1. **字幕场景解析**（Scene Analyzer）
   - 系统监听 Netflix 字幕，收集最近约 6–8 秒内的文本。
   - 识别人物、关键词、情绪（紧张 / 搞笑 / 感动等）、能量强度（高 / 中 / 低）。
   - 输出“是否值得发声”的结论：如果场景平淡或无话可说，会让弹幕保持安静。

2. **候选弹幕生成**
   - 针对每个可用 persona（例如潮流影迷、分析派、共情派、吐槽派），在 **确实有话说** 的场景下调用 LLM。
   - Prompt（提示词）中带入：当前场景摘要、关键词、情绪标签、该 persona 最近说过的话题、以及“若无新观点请输出 [skip]”。
   - LLM 生成后，如果无意义或重复，会被丢弃或要求 [skip]（即什么都不发）。

3. **调度与筛选**
   - 系统设定每 8 秒窗口内最多 3 条弹幕，同一个 persona 同屏不超过 1 条。
   - 如果多个候选竞争，只保留“相关度更高、角度更新鲜”的那条，避免一群人重复吐槽同一句台词。
   - Persona 会记住最近谈过的话题，短时间内不重复，自然保持“有人接梗、有人沉默”的效果。

4. **渲染与节奏**
   - 每条弹幕分配车道（lane）和滚动速度：文案越长越慢，必要时自动切成 2~3 段依次播放。
   - 车道之间有安全间隔，避免文字互相覆盖；高能场景可以稍微多一些弹幕，平静片段则保持安静。

5. **监控与反馈**
   - Dev HUD 与日志记录命中率、窗口内弹幕数、已截断次数、平均长度、活跃车道等指标。
   - 如果 LLM 被迫回退为占位文案，系统会标记出来，方便回溯。
   - 支持后续人工评审/用户反馈，继续微调提示词与策略。

---

## 2. Persona 行为要点

| Persona | 风格定位 | 行为规则 |
|---------|----------|-----------|
| Alex — 潮流影迷 | 轻松、梗多 | 保持 15 秒节奏；不重复旧梗；没段子就 [skip] |
| Jordan — 分析派 | 精准点评剧情结构 | 用精简专业词汇（<20 字）；若无新观点则静默 |
| Sam — 共情派 | 情绪共鸣、鼓励式口吻 | 语气温暖但不过度；场景平淡时保持安静 |
| Casey — 吐槽派 | 机智、轻度毒舌 | 只能友好吐槽；场景无戏剧性时宁可不说 |

> 每个 persona 在生成前都会被提醒：使用日常口语、不要重复、要敢于沉默。

---

## 3. 预期效果

- **少但准确**：高能量或有共鸣的场景才会有弹幕，一般每 8 秒不超过 3 条，长时间看不会“被弹幕淹没”。
- **多视角**：不同 persona 轮换；同一时间不会出现 4 条同类型吐槽，系统会优先保留角度不同的声音。
- **口语自然**：文案以即兴表达为主，允许轻微语气词或缩写，但不反复“哈哈哈哈”；遇到没梗时直接 [skip]，像真人沉默。
- **有呼吸感**：系统记录最近对话主题，避免强行接梗；平静片段保持安静，高潮场景允许弹幕密集一点。
- **布局不拥挤**：长弹幕自动分段或调慢速度，同屏文字不会重叠，视觉上更清爽。

---

## 4. 验收与监控

- **自动指标**：平均弹幕长度、重复率、跳过率、静默时长、Fallback 占比、窗口内弹幕数等。
- **Dev HUD**：实时显示窗口弹幕数、活跃车道、分段次数、缓存命中率。
- **人工评审**：每周抽样 30 条，以“自然度、幽默度、多样性”打分，辅助微调策略。
- **用户反馈**：控制面板将提供“太多/太像机器人”等按钮，以便收集真实观感。

---

## 5. 提示词结构与调用示例

生成每条弹幕时，后台会向 LLM 发送一组消息（Chat Completion），结构如下：

1. **System Message** — 设定 persona 角色、口语要求、长度上限与“若无新观点请 [skip]”。
   ```text
   You are Casey, a witty observer with playful sarcasm. Deliver clever quips while keeping it kind-hearted and PG-13.
   Keep it under 28 words. Speak like a human watcher, not a narrator.
   Avoid quoting the subtitles verbatim; focus on your reaction or insight.
   Comment only if you have a fresh take; avoid repetition. Current density preference: medium.
   Scene tone: tense. Energy: high. Speakers in focus: HERO.
   Never use these phrases: As an AI, Haha, LOL. If you truly have nothing new or meaningful to add, respond with [skip].
   ```

2. **Few-shot Examples** — 针对该 persona 预置 1–2 组示例，展示语气和长度。系统会按 `user → assistant` 的顺序提供，帮助模型模仿风格。
   ```text
   USER: Context: [15:44] Character dramatically slams a door.
   Instruction: React as Casey.
   ASSISTANT: Door 1, patience 0—someone just rage-quit the hallway.
   ```

3. **上下文 User Message** — 带入最近字幕窗口、场景摘要、persona 记忆：
   ```text
   Scene summary: We need a miracle! (said with urgency).
   Subtitle window:
   [00:58] HERO: We need a miracle!
   [01:00] FRIEND: Then stop wasting time and move!
   Guidelines:
   1. Lean on irony and playful exaggeration
   2. Never be cruel; keep jokes friendly
   3. Stay snappy—one punchy sentence max
   Previously you reacted with "Guess we're in plot armor territory" about 12 seconds ago. Refer back only if it deepens your point.
   Topics you touched recently: miracle, plot, urgency.
   Instruction: Respond in one short spoken-style sentence. Keep it natural, as if chatting with friends.
   ```

4. **LLM 调用** — 所有消息组合后，通过 `llmClient.complete` 调用 OpenAI 兼容接口（`POST /chat/completions`），指定模型 `gpt-4o-mini`、`temperature`、`top_p` 等参数。

5. **返回与后处理**
   - 如果 LLM 返回 `[skip]`，系统视为“选择沉默”。
   - 输出会经过清理：去掉引号、控制长度、避免禁用词，并记录到 persona 记忆中。
   - 若文本超长，则渲染器按句子拆分成 2–3 段依次播放。

> 简而言之：系统先判断“该不该说”，再构造场景化提示词，让 LLM 用口语化方式输出弹幕；任何时候没梗，模型都会被鼓励说 `[skip]` 保持真实感。

---

## 5. 后续优化方向（供讨论）

1. **重点场景识别更细**：例如识别伏笔、反转、恋爱甜点等，再匹配更精准的 persona。
2. **互动式弹幕**：让 persona 之间偶尔对话（A 嘲讽→B 接梗→C 冷知识），营造“群聊”感觉。
3. **内容安全 & 审核**：为正式上线准备敏感词过滤、口味分级或用户自定义屏蔽词。
4. **个性化调节**：允许用户选择偏好（“只想听情绪派”或“多来一点冷知识”）。
5. **真实数据回流**：将评审打分/用户反馈与日志对接，形成低成本迭代闭环。

---

只要按上述机制运行，弹幕就能保持“像在 Reddit 群聊”的质感：不喧闹但有梗、每个人都有自己的观点、节奏上有冷有热。后续我们可以基于用户反馈继续打磨 persona、调度和语言风格，让“人味”持续提升。
