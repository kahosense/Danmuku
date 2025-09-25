# 系统架构概览

## 项目定位
Netflix AI Danmaku 是一款 Chrome 扩展，面向 Netflix 播放页面实时生成并渲染 AI 弹幕。项目采用 TypeScript + Vite + @crxjs/vite-plugin 打包成 Manifest V3 扩展，围绕背景 Service Worker、内容脚本与弹出层三层结构协同工作。

## 技术栈与构建
- 构建：`npm run dev`（开发 watch）、`npm run build`（产物输出到 `dist/`）、`npm run preview`（本地预览）。
- 质量：`npm run typecheck` / `npm run lint` / `npm run test`（Vitest）。`npm run replay:cues` 用于重放采集的字幕会话复现弹幕逻辑。
- 配置：通过 `.env.local` 注入 `VITE_LLM_*` 环境变量，背景端在 `src/background/llm-client.ts` 读取。

## 目录速览
- `src/background/`：扩展 Service Worker 入口，负责提示词变体、弹幕生成与缓存。
- `src/content/`：注入 Netflix watch 页面，监听播放/字幕并渲染弹幕覆盖层。
- `src/popup/`：浏览器工具栏弹窗，提供开关、密度、人格勾选与反馈。
- `src/shared/`：跨层公用的消息协议、设置封装、日志、类型定义。
- `src/tools/`：CLI 脚本与开发辅助（如字幕重放）。
- `public/` 与 `manifest.config.ts`：静态资源与 manifest 生成配置。
- `docs/`：产品、阶段拆解与 QA 文档，支撑迭代计划。

## 核心运行流程
1. `src/content/index.ts` 注册 `playback-observer.ts` 与 `subtitle-observer.ts`，从 Netflix Player API 或 DOM 捕获 cue 批次。
2. 捕获到的 `CUES_BATCH` 通过 `chrome.runtime.sendMessage` 发送到 `src/background/index.ts`。
3. `orchestrator.processCueBatch`（`src/background/orchestrator.ts`）整合用户偏好、场景分析（`scene-analyzer.ts`）、缓存（`cache-store.ts`）与 LLM 请求，生成候选弹幕。
4. 结果返回内容脚本，由 `renderer/overlay.ts` 将弹幕注入 Shadow DOM 轨道，`ui/control-panel.ts` 提供页面内控制栏与调试 HUD。
5. 背景端同时更新 `chrome.storage` 偏好（`src/shared/settings.ts`），供弹窗与内容脚本实时同步。

## 模块要点
- **Persona 与提示词管理**：`src/background/personas.ts` 负责变体注册、虚拟观众合成与偏好同步，`src/background/persona-variants.json` 描述基准 persona，`src/shared/persona/roster.ts` 则为每个变体组装虚拟用户池与口癖、权重等差异化参数。
- **缓存策略**：`cache-store.ts` 利用 IndexedDB（缺省内存回退）按 `contentId + cueId + persona` 命中，控制单内容/全局容量并在拖动回放时通过 `cacheStore.purgeFuture` 清理未来记录。
- **偏好与反馈**：`src/shared/settings.ts` 封装 `chrome.storage.local`，`feedback-store.ts` 为用户反馈打点；弹窗通过 `sendMessage` 更新设置。
- **日志与开发者模式**：`src/shared/logger.ts` 控制日志级别，开发者模式下内容脚本的 `ui/developer-hud.ts` 会渲染实时指标。

## 配置与部署
- 构建产物位于 `dist/`，通过 `chrome://extensions` → “加载已解压的扩展程序” 引入。
- 缺省 LLM 调用使用占位实现，如需真实接口需在 `.env.local` 配置 API 端点与密钥。
- 任何涉及 persona/提示词更新，应同时调整 `docs/` 内对应阶段文档与 `persona-variants.json`，保持产品预期一致。

## 测试与验证建议
- 单元测试集中在 `src/*/__tests__/`，Vitest 运行时会使用 `src/test/setup.ts` 注册 jsdom 环境。
- 对弹幕生成逻辑的回归，可使用 `npm run replay:cues` 重放 `src/tools/sessions/` 下的录制样本，避免在真实页面上频繁操作。
