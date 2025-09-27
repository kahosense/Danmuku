# Coach Persona – Decision Log

| Date | Decision | Rationale | Owner | Notes |
| --- | --- | --- | --- | --- |
| 2025-02-XX | Coach 功能默认关闭，通过 popup 开启 | 实验性功能，避免影响现有观众体验 | Product/Eng | 密度默认 `medium` |
| 2025-02-XX | 值得学习判定允许 200–300 ms 延迟 | 教学质量优先，先不做极限性能优化 | Eng | LLM judge 可用 `gpt-4o-mini` |
| 2025-02-XX | 生成模型初期使用 `gpt-4o` | 追求自然语气与准确度 | AI | 后续可视质量/成本改用 mini |
| 2025-02-XX | Coach 弹幕固定蓝色、`[Coach]` 前缀 | UI 上与观众 persona 区分 | Eng/UI | 颜色可与设计复核 |
| 2025-02-XX | 子风格权重 40/30/20/10 | 提供多样化又不过度打扰 | AI/Product | 允许 value judge 提供 style hint |
| 2025-02-XX | 中文说明模式暂不开放 | 先专注英文输出，后续做 A/B | Product | Prompt 中允许少量中英混合 |

> 更新本表时保持倒序时间，确保团队可以追踪变更背景。
