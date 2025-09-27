# Architecture Overview

## Objectives
- Preserve narrative continuity by capturing multi-turn dialogue, visual cues, and previous danmaku context before the LLM call.
- Keep the pipeline modular so trigger, narrative, generation, and moderation layers can evolve independently.
- Support both self-use and public plugin deployment with explicit privacy and compliance boundaries.

## Runtime Layers
1. **Capture** (`content/` + `background/trigger.service.ts`)
   - Subscribes to timeline, subtitle tracks, audio energy levels, and viewport state.
   - Normalizes raw events into `TimelineSample` objects and pushes to `shared/session.store.ts`.
2. **Trigger Engine** (`shared/pipeline/trigger-engine.ts`)
   - Maintains sliding windows over subtitles + cues; classifies windows into `narrative`, `lightweight`, `banter` channels.
   - Emits `TriggerPayload` via message bus or shared store queue.
3. **Narrative Engine** (`shared/narrative/`)
   - Collapses payloads into `NarrativeSnapshot` objects (event list, role state, emotion vectors).
   - Updates role memory store and calculates deltas for prompt consumption.
4. **Generation Queue** (`background/generation.queue.ts`)
   - Prioritizes `NarrativeSnapshot` items, applies rate limits, selects provider (cloud, local, rule-based fallback).
   - Invokes prompt templates defined in `shared/narrative/prompts.ts`.
5. **Moderation Pipeline** (`shared/filters/moderation-pipeline.ts`)
   - Runs synchronous checks (safety filters, dedupe, tone adjustments) before committing to storage.
6. **Storage & Replay** (`shared/storage/danmaku-history.ts` + IndexedDB)
   - Persists approved danmaku with metadata (channel, timestamp, source); exposes query API for rendering.
7. **Presentation** (`content/danmaku-renderer/`)
   - Renders queue, handles user overrides, surfaces optional narrative summary bubble.
8. **Operator Surfaces** (`popup/`, `background/analytics.service.ts`)
   - User configuration panel, feature flags, telemetry sinks.

## Data Contracts
- `TimelineSample`: `{ timestampMs, dialogueLines[], visualCue[], audioLevel, activeDanmaku[] }`
- `TriggerPayload`: `{ id, windowStartMs, windowEndMs, channel, rawDialogue[], cues[], triggerReason }`
- `NarrativeSnapshot`: `{ id, events[], roleStates[], summary, priority, promptContext }`
- `DanmakuDraft`: `{ id, channel, text, sourceModel, confidence, moderationFlags[] }`
- `DanmakuEntry`: `{ id, timestampMs, text, channel, priority, origin, createdAt }`

Store contract definitions in `src/shared/narrative/types.ts` alongside runtime enums. Maintain backward-compatible migrations for storage schemas.

## Control Flow
1. `content` injects capture script → sends `TimelineSample` to background every 250ms or on cue change.
2. Trigger engine buffers samples; on threshold fire, it emits `TriggerPayload`.
3. Narrative engine enriches payload, updates memory, sends `NarrativeSnapshot` to generation queue.
4. Generation queue selects provider and produces `DanmakuDraft`.
5. Moderation pipeline either rejects (logging reason) or approves and writes to history store.
6. Renderer subscribes to store; when playback time crosses `DanmakuEntry.timestampMs`, it displays the entry.

## Deployment Notes
- Keep each layer behind its own feature flag (`narrativePipeline.capture`, `narrativePipeline.trigger`, etc.) so staged rollouts can fall back to the legacy keyword system.
- All cross-layer communication should run through `chrome.runtime.sendMessage` or shared indexed storage; avoid tight coupling between background and content modules.
- Document provider configuration (`LLMProviderConfig`) under `configuration-and-ops.md`.
