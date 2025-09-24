# Netflix AI Danmaku — Chrome Extension (MVP Scaffold)

This repository contains the engineering scaffold for the Netflix AI Danmaku Chrome extension MVP. It accompanies the product/technical documentation in `docs/`.

## Repository Layout

```
src/
  background/   # Service worker entry point
  content/      # Content scripts injected on Netflix watch pages
  popup/        # Browser action popup UI
  shared/       # Shared utilities and types
public/
  icons/        # Extension icon placeholders
```

Additional documentation:
- `docs/netflix-ai-danmaku-prd.md`
- `docs/netflix-ai-danmaku-tech-spec.md`
- `docs/mvp-task-breakdown.md`
- `docs/phase-0-setup-checklist.md`
- `docs/development-handoff.md`

## Getting Started

```bash
npm install
npm run dev        # Builds extension in watch mode
npm run build      # Production build to ./dist
npm run typecheck  # Run TypeScript compiler in no-emit mode
npm run lint       # ESLint against src/**/*.ts
npm run test       # Vitest unit tests
```

### Development Features

- 字幕捕获：内容脚本监听 Netflix 播放器字幕事件，并在失败时回退到 DOM 观察。
- 弹幕渲染：Shadow DOM 覆盖层（四条弹幕轨道）+ 控制面板、重新生成按钮、密度调节、人格多选。
- 偏好设置：统一由背景 Service Worker 管理，通过 `chrome.storage.local` 持久化，并向内容脚本/弹出层实时广播。
- 缓存策略：IndexedDB 缓存按 `contentId + cueId + persona` 存储，并执行 5MB/20MB LRU 驱逐。
- 开发者模式：在弹出层开启后，页面上将出现 Dev HUD 显示字幕批次与弹幕输出计数。

Load the unpacked build via `chrome://extensions/` → “Load unpacked” and select the generated `dist/` folder after running `npm run build`.

### 配置真实 LLM 服务

1. 在项目根目录创建 `.env.local`（不会被版本控制追踪），写入：

   ```env
   VITE_LLM_ENDPOINT=https://api.openai.com/v1/chat/completions
   VITE_LLM_API_KEY=sk-xxxxx
   ```

   - 变量名必须以 `VITE_` 开头，Vite 才会在构建时注入到 `import.meta.env`。
   - 注意：把密钥打包到浏览器扩展并不安全，正式发布前建议改用服务端代理或远程配置服务下发临时令牌。

2. 重新执行 `npm run build`，在 Chrome `chrome://extensions` 中重新加载 `dist/`。
3. 运行时背景脚本会通过 `import.meta.env.VITE_LLM_ENDPOINT` / `VITE_LLM_API_KEY` 配置 `llmClient`（见 `src/background/index.ts:130-138`）；缺少配置时会发出警告并退回占位响应。

## Notes
- Manifest and runtime configuration follow the MVP assumptions in the PRD/Tech Spec.
- Icons are temporary placeholders; replace with branded artwork before release.
- Update environment secrets (e.g., LLM API keys) using the approach defined in the tech spec before integrating network calls.
- 当前 LLM 客户端为占位实现，会在缺省配置下回退为调试文本；需要接入真实 OpenAI/GPT-4o mini 或其他模型时再补充密钥与提示词。
