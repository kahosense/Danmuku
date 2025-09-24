# Netflix AI Danmaku Chrome Extension — Technical Specification (MVP)

## 0. Purpose & Scope
Detail the technical approach for delivering the MVP described in the PRD, covering architecture, core modules, data flow, integration with Netflix subtitles, LLM calling strategy, rendering, persistence, and testing. Non-MVP enhancements are noted but not elaborated.

## 1. System Architecture Overview
- **Runtime Model**: Chrome Extension (Manifest V3) with background service worker, content scripts, and browser action popup.
- **High-Level Flow**:
  1. Content script attaches to Netflix player, captures subtitle cues.
  2. Subtitle cues sent to background worker via `chrome.runtime.sendMessage`.
  3. Background worker aggregates cues, manages persona queues, calls LLM.
  4. Generated danmaku returned to content script for scheduling & rendering overlay.
  5. User interactions via popup & in-player control panel update settings persisted in `chrome.storage.local`.
- **Key Modules**:
  - `subtitle-observer`: content script module extracting cues.
  - `llm-orchestrator`: background queue manager & API client.
  - `persona-registry`: persona definitions and rate-limit metadata.
  - `renderer`: overlay component managing animation lanes.
  - `settings-store`: abstraction over storage for preferences & cache.
  - `control-panel`: in-player UI overlay hooking into renderer & settings.

## 2. Browser Extension Components
### 2.1 Manifest & Permissions
- `manifest_version: 3`.
- Permissions: `scripting`, `storage`, `activeTab`, `tabs`, `alarms` (for periodic cache cleanup), host permissions for `https://www.netflix.com/*`.
- Background: `service_worker` entry pointing to `/background/index.ts`.
- Content script registration via `chrome.scripting.registerContentScripts` at runtime when Netflix tab detected.
- Action popup: `/popup/index.html` with bundled script.

### 2.2 Build & Tooling
- Source in TypeScript; bundler Vite/Rollup configured for MV3.
- Shared utility package for logging, types, constants.
- ESLint + Prettier for linting, Vitest/Jest for unit tests (no DOM dependencies).

## 3. Subtitle Acquisition Pipeline
### 3.1 Netflix Player Hook
- On content script load, poll for `window.netflix?.appContext?.state?.playerApp` up to 5 seconds.
- Use documented community approach: `const player = window.netflix.appContext.state.playerApp.getAPI().videoPlayer; const sessionId = player.getAllPlayerSessionIds()[0]; const videoPlayer = player.getVideoPlayerBySessionId(sessionId);`.
- Subscribe to `videoPlayer.on('timedTextCueEntered', handler)` for subtitle cues. Each cue event provides `cue.text`, `cue.startTime`, `cue.endTime`.
- Fallback: MutationObserver on `.player-timedtext` DOM to capture when Netflix internal APIs unavailable.

### 3.2 Cue Normalization
- Normalize times to milliseconds relative to playback start.
- Strip HTML tags (italic markers) while preserving punctuation.
- Filter trivial cues: length <3 chars or only non-alphabetic tokens.
- Enrich payload: `{ contentId, timestamp, text, duration, trackLanguage, cueId }`.

### 3.3 Messaging
- Batched message dispatch: accumulate cues within 500ms window to reduce chatter.
- Use `chrome.runtime.sendMessage({ type: 'CUES', cues })`.
- Background acknowledges with `{ status: 'ok' }`. If no ack (service worker sleeping), queue resend after re-connection.

## 4. LLM Orchestration & Persona Handling
### 4.1 Persona Registry
- Static JSON definitions stored in background bundle: `{ id, name, tone, cadenceSeconds, systemPrompt, fewShotExamples[] }`.
- Cadence governs min interval between outputs per persona (e.g., 15s Alex, 20s Jordan).
- Registry exposes metadata retrieval for orchestrator.

### 4.2 Prompt Assembly
- Maintain sliding window of last N cues (default 3 within 6s).
- Prompt template structure:
  - **System**: persona tone, guardrails, request for concise, natural speech, PG-13.
  - **Context**: latest cues with timestamps; include stage directions if present.
  - **Instruction**: respond once in persona voice, <=35 words, reference current moment.
- Include density parameter: instruct persona to skip if nothing meaningful to add.

### 4.3 Orchestrator Flow
1. `llmQueue.enqueue(cueBatch)` triggered when new cues arrive.
2. For each active persona: check last output time + cadence constraint and density budget.
3. If eligible, create `GenerationTask` with prompt payload and metadata.
4. Use concurrency pool (max 2 concurrent LLM calls) to avoid rate-limit.
5. Call GPT-4o mini streaming endpoint via fetch; accumulate tokens until newline or stream end.
6. On response, parse to ensure persona ID present. If missing, attribute to originating persona.
7. Package as `{ personaId, text, createdAt, renderAtTimestamp }` and send to content script.

### 4.4 Density Management
- Density slider maps to persona budgets:
  - Low: max 1 comment / 25s per persona.
  - Medium: 1 / 15s.
  - High: 1 / 8s.
- Global cap: no more than 3 simultaneous comments onscreen.
- If density exhausted, skip generation but log reason.

### 4.5 Cache Coordination
- Before enqueuing new LLM task, query cache for `[contentId, cueId, personaId]` entry.
- If cached, return stored text immediately (respect density/time gating).
- Regenerate command clears cache entries with `timestamp >= currentVideoTime`.

## 5. Danmaku Rendering Engine
### 5.1 Overlay Bootstrap
- Inject shadow DOM root appended to `.watch-video--player-view` to avoid CSS conflicts.
- Shadow DOM contains:
  - `div.danmaku-lane-container` with 4 flex rows.
  - Control panel container positioned bottom-right (toggleable).
- Styles scoped via CSS modules.

### 5.2 Lane Management
- Maintain lane state array: `[{ id, occupiedUntil, queue: [] }]`.
- On new comment, find lane with earliest `occupiedUntil` < current time.
- If all busy, enqueue comment in lane with earliest availability; poll every 300ms.

### 5.3 Animation
- Each comment element width measured post-insert; translate from right (100%) to left (-width) using `transform` CSS animation.
- Duration derived from density: `baseDuration = 6s`, add 1s per extra 50 chars.
- On animation end, remove node, update lane state.
- Provide `prefers-reduced-motion` check to disable animation and fade-in/out instead.

### 5.4 Playback Sync
- Listen to playback state events (play/pause/seek) via Netflix player API.
- Pause animation (toggle CSS class) when playback paused; resume on play.
- On seek backward, fetch cached comments for new timestamp range; forward seek clears queued comments before new time.

## 6. User Interface & Controls
### 6.1 Popup (Browser Action)
- Components: master toggle (per domain), persona multi-select checkboxes, density slider, link to settings modal (future).
- Sync state with background via `chrome.runtime.sendMessage({type:'POPUP_STATE_REQUEST'})` and response.

### 6.2 In-Player Control Panel
- Floating card anchored top-right (avoid overlapping Netflix controls).
- Elements:
  - Toggle switch (mirrors main toggle).
  - Persona pills with avatar + name; click toggles active state.
  - Density slider with textual labels.
  - Regenerate button with confirmation tooltip (warns clearing future cache).
  - Status indicator: spinner while LLM call in-flight; fallback icon on error.
- Panel collapsible; collapsed icon shows active persona count + density.

### 6.3 Settings Persistence
- `settings-store` handles read/write to `chrome.storage.local` with schema versioning.
- Structure:
  ```json
  {
    "globalEnabled": true,
    "personaEnabled": {"alex": true, "jordan": true, "sam": true, "casey": true},
    "density": "medium",
    "lastUpdated": 1710000000000
  }
  ```
- Debounced writes (250ms) to avoid storage quota hits.

## 7. Data Storage, Caching & Persistence
### 7.1 Cache Strategy
- Storage layer uses IndexedDB via idb library for asynchronous large payloads; fallback to `chrome.storage.local` if IDB unavailable.
- Data model:
  - `contentSessions`: `{ contentId, title, expiresAt }`.
  - `comments`: `{ contentId, cueId, personaId, text, generatedAt, promptHash }`.
- Size limits enforced by monitoring aggregate size with estimate API; when >20MB total, evict oldest `contentSessions` and associated comments (LRU by `expiresAt`).
- Per-content limit 5MB tracked via per-session metadata; disallow new writes when limit hit until eviction.

### 7.2 Cache Lifecycle
- Entries expire after 24h or when regenerate triggered for future cues.
- Cache warm start: on subtitle cue arrival, query comments store; if hit, reuse text and skip LLM call.
- After LLM success, store text plus prompt hash for dedupe.

### 7.3 Preference Storage
- As per §6.3; keep schema migration plan (e.g., `settingsVersion`).

## 8. Error Handling, Logging & Diagnostics
### 8.1 Error Categories
- Subtitle capture failures (Netflix API unavailable).
- LLM API errors (network, rate limit, validation).
- Rendering issues (DOM exceptions, exceeded lanes).

### 8.2 Handling Strategies
- Subtitle failure: fallback to DOM observer; if both fail, surface toast advising reload.
- LLM error: exponential backoff (2,4,8s) up to 3 retries; if still failing, display status icon and use cached content where possible.
- Rate limit: temporarily disable persona for 60s, show tooltip in panel.
- Rendering overflow: drop comment with log entry, avoid crashing.

### 8.3 Logging
- `logger` utility writing to `console` with levels (debug/info/warn/error).
- Dev mode flag (popup toggle) enabling verbose logs and overlay debug HUD (counts cues, API calls, average latency).
- Provide `Download Logs` button in popup (developer flag) exporting JSON of last session events.

## 9. Performance & Reliability Considerations
- Keep content script lightweight; heavy work (LLM calls, caching) in background worker.
- Use streaming fetch to minimize wait; render once first sentence available.
- Debounce DOM observers to 250ms to reduce layout thrash.
- Monitor CPU by limiting simultaneous DOM nodes (<20) and using requestAnimationFrame for manual animations if Canvas fallback needed.
- Background service worker uses `chrome.alarms` to keep alive during playback (ping every 4min) yet respect power constraints.

## 10. Security & Privacy Notes
- Transmit only necessary subtitle snippets and metadata to LLM provider; redact personal info if ever detected (not expected).
- Store API keys using Chrome `chrome.runtime.getManifest().key`? No; use web accessible resources? Instead rely on remote config fetched via HTTPS (future). For MVP, embed key via build secret injection and keep repo private.
- Document no profanity filtering; rely on provider guardrails.
- Ensure overlay sandbox prevents script injection (shadow DOM, sanitized text nodes).

## 11. Testing Strategy
- **Unit Tests**: persona registry, density gating, cache eviction logic, prompt builder.
- **Integration Tests** (Puppeteer/Playwright in CI): mock Netflix player API to emit cues, verify background worker receives and returns comments.
- **Manual QA Checklist**:
  - Toggle on/off; personas enable/disable.
  - Density slider effect on frequency.
  - Regenerate clears future comments only.
  - Offline mode: simulate network failure; ensure cached comments display.
  - Seek/refresh behavior retains preferences and cached outputs.
- **Performance Test**: log latency delta between cue time and render time; goal avg ≤2s.

## 12. Implementation Milestones & Dependencies
- Alignment with MVP task breakdown (Weeks 1–4) — ensure spec references deliverables.
- Dependencies:
  - OpenAI API key & quota configuration.
  - Netflix DOM stability check; if APIs change, update observer fallback.
  - Decision on bundler & testing framework finalized in Phase 0.
- Deliverables per week align with spec sections (subtitle pipeline, LLM orchestrator, renderer, UI, QA).

## 13. Open Items & Future Considerations
- Evaluate Canvas-based renderer for higher comment densities post-MVP.
- Plan for secrets management (remote config service) ahead of public beta.
- Consider adding optional content filters if future user feedback demands.
- Explore telemetry pipeline for automated metrics once privacy policy defined.
