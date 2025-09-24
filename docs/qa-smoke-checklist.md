# Netflix AI Danmaku — Phase 1 QA Smoke Checklist

> 使用真实 LLM 配置（或调试 stub）完成以下手动验收，建议在每次主干合并前执行。

## 设置准备
- Chrome 加载最新 `dist/` 构建，确保已启用开发者模式。
- Netflix 账号登录，准备带英文字幕的剧集（建议《小妇人》S1E1 作为基准）。
- `.env.local` 配置有效的 LLM endpoint/API key，或确认 fallback 文案可接受。

## 功能走查
1. **播放启动**：打开剧集，启用扩展，确认弹幕控制面板与 Dev HUD 出现。
2. **字幕捕获**：观察 Dev HUD 字幕批次数递增，控制台无 `subtitle` 相关报错。
3. **弹幕生成**：确认至少三条 persona 弹幕在 3 秒内出现，语气区别明显。
4. **密度切换**：在控制面板切换 `低/中/高`，观察弹幕频率变化并校对 Dev HUD 统计。
5. **Persona 过滤**：禁用任意 persona，确认 HUD 及页面仅剩激活的 persona 文案。
6. **重新生成**：在播放中点击“重新生成”，确认未来片段的缓存被清空且新的弹幕重新生成。
7. **播放同步**：暂停、seek 前后，确认弹幕不会堆叠；切换剧集时缓存清零。
8. **LLM 状态**：拔掉网络或制造 429，查看面板 LLM 状态标记转为“降级/错误”。

## 稳定性验证
- 在 10 分钟连续播放中监控控制台，确保无未捕获异常。
- Dev HUD 中的缓存命中率、LLM 延迟、Fallback 计数符合预期（fallback ≤5%）。
- 关闭标签页后重新打开 Netflix，确认扩展自动恢复上次偏好。

## 回归项
- Chrome 控制台 `chrome.runtime` 无持久错误；Service Worker 保持活动（查看 chrome://serviceworker-internals）。
- `npm run test` 和 `npm run typecheck` 均通过。
- README 中开发指引、文档链接可正常访问。

记录任何异常现象与时间戳，并附带控制台/网络日志以便诊断。
