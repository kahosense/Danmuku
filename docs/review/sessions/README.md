# Review Sessions Archive

将 Phase 3 与后续阶段的离线回放 JSON 存放在此目录。建议命名格式：`YYYY-MM-Phase3-<segment>.json`。

每个文件遵循 `npm run replay:cues -- --out` 输出结构，包含字幕 cue 序列、persona 评论及指标。若有真人评审补充字段，可在保持原始字段基础上追加自定义属性。

上传准则：
- 使用 `npm run replay:cues -- path/to/cues.json --out docs/review/sessions/<file>.json` 生成。
- 若使用生产环境导出的真实弹幕，请保证已脱敏。
- 同一段素材如有多次回放，可使用 `-v1`, `-v2` 区分。
