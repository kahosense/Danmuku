# Netflix AI Danmaku — Module Implementation Status (MVP Framework)

## Background Messaging & Orchestration
- [x] `src/shared/messages.ts` 定义跨上下文消息协议。
- [x] 背景 Service Worker 路由内容/弹窗消息并维护偏好状态。
- [x] 人格注册表与 orchestrator 骨架（节奏、密度、缓存命中）。
- [ ] LLM streaming/并发优化与 seek 窗口化调度。

## Caching Layer
- [x] IndexedDB 缓存抽象（`src/background/cache-store.ts`）含 5MB/20MB LRU 驱逐。
- [x] `get` / `set` / `purgeFuture` / `clear*` API 接入 orchestrator。
- [ ] 大规模剧集场景下的性能验证与指标输出。

## LLM Client Scaffold
- [x] `src/background/llm-client.ts` 可配置端点 + stub 回退。
- [ ] 接入真实供应商（GPT-4o mini 等）含流式、重试与配额控制。

## Danmaku Renderer
- [x] Shadow DOM 覆盖层 + 四车道调度与动画。
- [x] 密度驱动的 lane 分配与重复弹幕去重。
- [ ] Seek / 暂停同步、历史弹幕复播策略。

## User Controls
- [x] 播放器控制面板（开关、密度、人设、重新生成、状态）。
- [x] 浏览器弹窗与偏好持久化/广播。
- [ ] 辅助功能（键盘导航、ARIA）与交互微调。

## Logging & Diagnostics
- [x] 统一 logger + 开发者模式切换日志级别。
- [x] Dev HUD 显示字幕批次与弹幕输出计数。
- [ ] 记录 LLM 调用耗时、缓存命中率并输出到 HUD/日志。

## Testing & QA Support
- [ ] 扩充单测（缓存驱逐、调度/密度逻辑、UI 事件）。
- [ ] 构建 Netflix API 模拟集成测试与手动 QA 脚本。
- [x] README 更新开发流程与调试功能说明。

该状态表可用于后续迭代跟踪剩余工作，优先完成待勾选项即可推动 MVP 内测。
