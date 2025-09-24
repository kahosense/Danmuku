# Netflix AI Danmaku — Development Handoff Notes (as of MVP Scaffold)

_Last updated: 2025-09-23_

## 1. Environment Snapshot
- Node.js/npm based toolchain with Vite + `@crxjs/vite-plugin` (Manifest V3 build).
- TypeScript strict mode enabled; global path alias `@shared/*`.
- Linting (ESLint flat config + Prettier) and testing (Vitest + jsdom) in place.
- Baseline Chrome extension structure under `src/` with background, content, popup, shared modules.
- Build artifacts output to `dist/` via `npm run build` (validated).

## 2. Implemented Functionality
- **Extension Runtime**
  - MV3 manifest + Vite/CRX 构建体系，可直接 `npm run build` 后加载 `dist/`。
  - 背景 Service Worker 负责消息路由、偏好持久化、人格调度、缓存与 LLM 客户端封装。
- **字幕 & 弹幕框架**
  - Netflix 播放器 API 轮询 + DOM 观察 fallback，批量发送字幕提示至后台。
  - Orchestrator 根据密度/节奏规则和缓存命中决定是否触发 LLM 请求。
  - IndexedDB 缓存 (`cacheStore`) 实现 5MB/20MB LRU，支持未来时间段清理。
  - 弹幕渲染器（Shadow DOM 四车道）已实现右→左动画、冲突避免与重复去重。
- **控制面板与弹窗**
  - 播放器浮层控制面板（开关、密度、人格、多选、重新生成、状态提示）。
  - 浏览器弹窗 UI 同步展示设置，可开启开发者模式。
  - 偏好变更通过后台广播至所有上下文，实时刷新 UI。
- **调试能力**
  - 可选 Dev HUD 显示字幕批次数与弹幕输出数量。
  - 统一 logger 支持 debug/info/warn/error，随开发者模式切换日志级别。

## 3. Outstanding Work (per Tech Spec)
Reference `docs/netflix-ai-danmaku-tech-spec.md` sections。
- **真实 LLM 集成** (`§4`, `§10`)
  - 将 `src/background/llm-client.ts` 中的占位实现替换为真实 GPT-4o mini/OpenAI 客户端，配置密钥与模型参数，补充错误与配额处理。
  - 优化 prompt 构造为多字幕窗口 + few-shot 示例，必要时接入流式响应。
- **高级调度与质量控制**
  - 扩充 Orchestrator：多字幕窗口累积、针对 seek/暂停 的状态同步、密度自适应策略。
  - 对 LLM 输出做必要的安全/脏词过滤（若产品策略改变）。
- **缓存与性能验证**
  - 完整验证 IndexedDB LRU 行为，在大量剧集场景下做滚动测试。
  - 补充缓存命中率与 API 延迟统计，写入 Dev HUD/日志。
- **渲染增强** (`§5`)
  - 处理字幕 seek 后的历史弹幕复播/隐藏策略。
  - 引入动画时长随密度动态调整的细化逻辑。
- **用户体验 & 可访问性** (`§6`)
  - 为控制面板添加键盘导航、焦点保护、屏幕阅读器标签。
  - 允许用户在弹窗中查看/切换当前 Netflix 页面状态。
- **测试体系** (`§11`)
  - 新增单测：密度节奏计算、缓存驱逐逻辑、control panel 事件。
  - 建立模拟 Netflix 播放器 API 的 integration harness；编写手动测试脚本。
  - ✅ `npm run test` 覆盖 `src/background/__tests__` 与 `src/content` UI/observer 测试，使用 `fake-indexeddb` 模拟缓存 LRU。
  - ✅ `docs/qa-smoke-checklist.md` 汇总 Phase 1 手动验证步骤。

## 4. Suggested Next Steps for Incoming Team
1. 接入真实 LLM 服务：确认供应商、密钥管理方案，替换占位实现并跑通最小端到端弹幕生成。
2. 按 Tech Spec 细化 Orchestrator 的多字幕窗口/seek 处理，评估 API 调用频率与成本。
3. 为缓存与渲染编写覆盖性测试（包括大批量弹幕和 seek 反复操作），确保性能指标达标。
4. 补充控制面板可访问性与 UX 文案，与设计/Product 复审交互细节。
5. 按 `docs/mvp-task-breakdown.md` 建立看板并拆分剩余工作项，规划 LLM 集成与 QA 里程碑。

## 5. Useful Commands
```bash
npm install          # install dependencies
npm run dev          # dev/watch build
npm run build        # production build to dist/
npm run lint         # eslint
npm run typecheck    # typescript compiler
npm run test         # vitest unit tests
```

## 7. Testing & QA Snapshot
- 自动化：`npm run test`（Vitest）现包含 orchestrator 调度、缓存 LRU、播放状态观察器与控制面板 UI 交互测试（✅ 已跑通）。
- 手动：参照 `docs/qa-smoke-checklist.md` 完成播放流、密度切换、LLM 状态降级等走查（✅ 已完成）。
- 指标监控：Dev HUD 提供缓存命中率、Fallback 计数、LLM/生成延迟；控制面板展示实时 LLM 健康状态。

## 6. Contacts & Ownership
- Product vision and requirements: see PRD (`docs/netflix-ai-danmaku-prd.md`).
- Technical decisions & architecture: see Tech Spec (`docs/netflix-ai-danmaku-tech-spec.md`).
- Phase 0 checklist items pending: review `docs/phase-0-setup-checklist.md` (marked with open checkboxes).

Keep this document updated as milestones are completed.
