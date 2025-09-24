# Netflix AI Danmaku — MVP Task Breakdown

## Phase 0 — Environment & Planning (1–2 days)
- Confirm team tooling (Chrome extension boilerplate, bundler, lint/test setup).
- Define coding standards and PR workflow; create initial Git branches/boards.
- Provision LLM API credentials, set hourly quota thresholds, and stub API client wrappers.

## Week 1 — Subtitle Pipeline & Platform Integration
- Implement content-script bootstrap on netflix.com watch pages; verify manifest V3 permissions.
- Spike on Netflix player APIs to hook timed-text events; provide fallback via DOM observers.
- Build subtitle cue buffer module with timestamp normalization and session identifiers.
- Establish message channel between content script and background worker for cue relay.
- Add developer logging toggles to trace subtitle ingestion in real time.

## Week 2 — LLM Orchestration & Persona Logic
- Finalize persona prompt templates, including system and few-shot examples per persona.
- Implement background worker queue that batches recent cues and dispatches LLM calls.
- Integrate OpenAI GPT-4o mini API (or equivalent) with streaming response handling.
- Enforce persona-specific rate limits and global density controls; surface error states.
- Implement per-session cache store keyed by `contentId:timestamp`, with 5 MB/20 MB limits and LRU eviction.

## Week 3 — Danmaku Renderer & User Controls
- Prototype overlay layer (canvas or positioned div) with four-lane collision avoidance.
- Animate right-to-left comment flow with adjustable duration based on density setting.
- Build in-player control panel: toggle, persona multi-select, density slider, regenerate button.
- Persist user preferences via `chrome.storage.local`; restore on tab revisit.
- Handle regenerate behavior (clear future cache, keep history) and playback state changes (pause/seek).

## Week 4 — QA, Telemetry & Launch Readiness
- Exercise end-to-end flow across multiple Netflix titles; measure subtitle-to-comment latency.
- Optimize performance (memoize prompts, trim payloads, throttle observers) to keep CPU <10%.
- Validate cache eviction and regenerate scenarios; ensure no duplicate API calls after reload.
- Polish UI (loading indicators, error toasts), review accessibility basics (keyboard focus, contrast).
- Compile developer QA checklist, known issues log, and MVP release notes for internal alpha.

## Parallel/Ongoing Tasks
- Maintain risk log for Netflix DOM changes; document mitigation playbook.
- Track LLM usage costs and latency metrics manually until automated telemetry arrives.
- Collect qualitative feedback from early testers to feed post-MVP roadmap.
