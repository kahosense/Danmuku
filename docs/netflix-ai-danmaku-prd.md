# Netflix AI Danmaku Chrome Extension — MVP PRD

## 1. Product Overview
- **Vision**: Enable Netflix web viewers to experience AI-generated, human-like “virtual audience” commentary (danmaku) that reacts naturally to on-screen dialogue, enriching immersion in an English-language environment.
- **Target Platform**: Google Chrome desktop browser extension (Chromium-based compatibility considered post-MVP).
- **Primary Audience**: English-learning enthusiasts who want immersive, native-sounding conversational context while watching English Netflix content without formal instructional framing.

## 2. Goals & Non-Goals
- **Goals**
  - Deliver timely, contextually relevant danmaku generated from Netflix subtitles via an LLM.
  - Provide four distinct AI persona voices that mimic varied native-speaker reactions.
  - Allow users to control danmaku availability, persona selection, and comment density.
  - Persist generated danmaku per viewing session to avoid redundant LLM calls.
- **Non-Goals (MVP)**
  - Multi-language subtitle support (focus on English only).
  - Extensive visual customization (font size, opacity, color) beyond default right-to-left scrolling layout.
  - Content moderation or safety filtering for LLM outputs.
  - Per-genre personalization or automated density adjustments based on content type.

## 3. User Personas & Core Scenarios
- **Persona**: English enthusiast streaming Netflix on desktop; wants organic-sounding reactions to engage with content in near-real-time.
- **Scenario 1**: User enables danmaku, selects two preferred personas, watches a drama episode, and receives stream of comments aligned with dialogue.
- **Scenario 2**: User tweaks density to reduce comment load during intense scenes.
- **Scenario 3**: User revisits an episode; cached danmaku renders immediately until new subtitles trigger additional generation.

## 4. User Experience Summary
- **Entry Point**: Extension icon in Chrome toolbar with toggle to activate per Netflix tab.
- **Overlay Controls** (in-player UI panel):
  - Master on/off switch.
  - Persona multi-select (up to four pre-set personas; default all enabled).
  - Density slider (e.g., Low / Medium / High mapped to max comments per minute).
  - Regenerate button (optional backlog refresh; clears cache for upcoming segment while preserving past comments).
- **Danmaku Display**: Horizontal right-to-left scrolling text overlaying top third of video with collision avoidance, limited simultaneous rows (e.g., 4 lanes), auto-fade after traversal.

## 5. Functional Requirements
1. **Netflix Subtitle Capture**
   - Detect active Netflix playback tab and attach to the player.
   - Access English subtitle track via Netflix player APIs (`window.netflix.appContext.state.playerApp.getAPI().videoPlayer`) and listen for timed text events.
   - Buffer subtitle cues with timestamps and text payload for downstream processing.
2. **LLM Prompting & Generation**
   - Aggregate subtitle cues into prompt windows (configurable, default: recent 2–3 lines within ~6 seconds window).
   - Call cloud-hosted LLM completion endpoint (initial provider: OpenAI GPT-4o mini or equivalent low-latency model) with persona instructions and latest subtitle context.
   - Receive structured response containing persona ID, generated comment text, optional metadata (confidence/tone).
   - Enforce generation cadence per persona to avoid flooding (respect density setting caps).
3. **Persona Management**
   - Provide four predefined persona profiles including name, tone, vocabulary style.
   - Store persona definitions locally so prompts can be constructed consistently.
   - Allow users to enable/disable personas dynamically; disabled personas halt generation and rendering.
4. **Danmaku Scheduling & Rendering**
   - Queue generated comments with associated playback timestamps.
   - Schedule render to occur within target latency (≤3 seconds after subtitle cue) when video is playing.
   - Animate comments in overlay lanes with collision avoidance and expiration handling.
   - Pause/resume overlay when video playback status changes (pause, seek, lose focus).
   - Suppress generation during silent stretches without subtitle cues (no spontaneous interjections in MVP).
5. **User Controls & Settings Persistence**
   - Persist per-user preferences (enabled state, persona selection, density) via `chrome.storage.local`.
   - Auto-disable overlay when leaving Netflix domain, auto-restore last state upon return.
   - Provide visual indicator for LLM request status (e.g., subtle activity spinner in control panel).
6. **Data Persistence & Caching**
   - Store generated danmaku mapped to content ID + timestamp ranges to avoid duplicate LLM calls during the same session.
   - Cap cache at ~5 MB per content item and ~20 MB overall; apply LRU eviction when limits exceeded.
   - Cache invalidation triggered by manual regenerate action (future cues only) or upon episode change detection.
7. **Diagnostics & Logging**
   - Local development log stream (console) capturing subtitle ingestion, LLM requests/responses, render actions for QA.
   - Optional opt-in debug panel (developer flag) summarizing request counts and latency stats.

## 6. Non-Functional Requirements
- **Performance**
  - Subtitle-to-danmaku latency goal: average ≤2 seconds, max spike ≤5 seconds under normal network conditions.
  - Extension must not degrade Netflix playback performance (CPU usage <10% on baseline laptop during operation).
- **Reliability**
  - Handle network retries/backoff when LLM API fails; degrade gracefully by reusing cached comments when available.
  - Ensure overlay detaches cleanly when Netflix DOM updates or user navigates away.
- **Compatibility**
  - Chrome latest stable (desktop). Plan cross-browser evaluation post-MVP.
- **Security & Privacy**
  - Minimal data collection; only subtitle text and session metadata transmitted to LLM endpoint.
  - Highlight absence of profanity filtering; rely on trusted LLM provider safeguards if available.
- **Maintainability**
  - Modular architecture with clear separation among subtitle ingestion, LLM integration, rendering, and UI control modules.

## 7. AI Personas (MVP Set)
1. **Alex — Casual Movie Buff**: Relaxed, humorous, colloquial expressions, pop-culture references.
2. **Jordan — Analytical Critic**: Observational, references character motivations and plot structure.
3. **Sam — Emotional Empath**: Reacts to emotional beats, empathic language.
4. **Casey — Sarcastic Wit**: Light sarcasm, playful jabs, keeps remarks PG-13.

Each persona definition includes: short bio, tone descriptors, sample lexicon, pacing guidance (e.g., max 1 comment every 15 seconds).

## 8. Technical Architecture Overview
- **Extension Structure**
  - Background service worker: manages LLM requests, caching, persona profiles, global state.
  - Content script injected into Netflix playback pages: hooks subtitle events, renders overlay, communicates with background via `chrome.runtime` messaging.
  - Popup UI (browser action): quick-toggle, persona selectors, density slider.
- **Subtitle Event Pipeline**
  1. Content script subscribes to Netflix player state; obtains timed text via internal APIs or MutationObservers fallback.
  2. Subtitle cue packaged with metadata and sent to background worker.
  3. Background aggregates cues per active persona and dispatches LLM requests asynchronously.
  4. Responses returned to content script for scheduling and rendering.
- **LLM Integration**
  - Use HTTPS REST API (initially OpenAI GPT-4o mini or similar) with streaming support for low latency and configured per-hour request caps.
  - Prompt template contains: persona system message, recent subtitle snippet, high-level style guardrails.
  - Implement rate limiting per persona and global concurrency limit to stay within API quotas.
  - Future-proof interface to swap providers (abstract client module).
- **Danmaku Rendering Engine**
  - Canvas or absolutely positioned div layers; evaluate performance trade-offs.
  - Collision avoidance algorithm ensures new comment lane availability; fall back to queue if all lanes occupied.
  - Density control adjusts maximum simultaneous comments and LLM request frequency.
- **Storage Strategy**
  - Use `chrome.storage.local` or IndexedDB for per-session caches keyed by `contentId:timestamp`, respecting the 5 MB per-content / 20 MB global limits.
  - Expire caches after 24 hours or explicit regenerate.

## 9. Data Handling & Telemetry
- **Stored Data**: Subtitle text snippets, generated danmaku, persona selection, timestamps.
- **Transient Data**: LLM prompts/responses kept in memory except when cached for reuse.
- **Metrics (Post-MVP Consideration)**
  - LLM call success rate, average latency.
  - Density adjustments frequency.
  - Persona usage distribution.
- **MVP Logging**: Local console logs and optional downloadable JSON session log for QA (no automatic uploads).

## 10. Latency & Quality Strategy
- Implement sliding window batching (up to 3 recent subtitle lines) to balance context richness vs. speed.
- Leverage streaming responses; commence rendering once first sentence arrives.
- Pre-fetch persona introductions (prompt skeletons) at session start to reduce per-call payload size.
- Use heuristic to skip LLM call for trivial cues (e.g., single-word subtitles like "Yeah").

## 11. Risks & Mitigations
- **Netflix DOM/API Changes**: Monitor and abstract subtitle hook logic; implement fallback via MutationObserver.
- **LLM Response Quality Variance**: Iterate prompt design, include persona guardrails, optionally augment with few-shot examples.
- **Latency Spikes**: Cache reuse, degrade to fewer personas when network slow, surface status indicator.
- **User Overwhelm**: Provide default medium density and easy toggle to reduce noise quickly.
- **Content Safety**: Document no-filter stance; add optional future safeguard if business needs shift.

## 12. Open Questions
- None for MVP at this stage; revisit once user testing reveals new requirements.

## 13. MVP Delivery Plan (Indicative)
1. **Week 1** — Technical Spike: Validate subtitle access, prototype overlay rendering, evaluate LLM latency.
2. **Week 2** — Core Implementation: Build subtitle pipeline, persona prompts, danmaku renderer, caching baseline.
3. **Week 3** — Polishing & QA: UX refinements, performance tuning, edge-case handling, developer logging.
4. **Week 4** — Internal Alpha: Run closed testing on select episodes, gather feedback for next iteration.

## 14. Future Enhancements (Post-MVP)
- Multi-language subtitle and translation support.
- User-generated persona profiles and sharing.
- Advanced styling controls (font size, opacity, color themes).
- Sentiment-based density modulation.
- Mobile/tablet browser compatibility.
