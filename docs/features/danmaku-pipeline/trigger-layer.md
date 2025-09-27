# Trigger Layer Specification

## Goals
- Detect meaningful narrative beats while avoiding excessive LLM calls.
- Merge heterogeneous signals (dialogue, visual, audio, existing danmaku) into consistent trigger decisions.

## Signal Inputs
- **Dialogue windows**: subtitles or ASR text chunks with timestamps and speaker labels.
- **Visual cues**: shot change score, brightness delta, motion vectors, on-screen overlays.
- **Audio cues**: RMS level, spectral centroid (music vs dialogue), silence detection.
- **Context**: preceding danmaku density, user-configured intensity, playback state (pause, seek).

Normalize raw inputs inside `capture` to a common schema before they reach the trigger engine.

## Windowing Strategy
- Maintain 2 sliding windows: `narrativeWindow` (8–15 seconds) and `banterWindow` (3–5 seconds).
- Every 1 second, prune expired samples and evaluate classification rules.
- Ensure each `TimelineSample` is processed exactly once; guard against duplicate messages.

## Classification Rules
- **Narrative Event**
  - Minimum two speaker turns or one action cue + one dialogue.
  - Emotion shift detected (`abs(sentimentDelta) > 0.4`) or visual emphasis (shot change + audio spike).
  - Triggers `TriggerChannel.NARRATIVE` with `triggerReason = ["multi_turn", "emotion_spike"]` etc.
- **Lightweight Commentary**
  - Single dialogue line with high salience keyword (`wow`, `plot twist`, proper nouns) or notable visual cue.
  - Triggered if narrative cooldown > 5 seconds.
- **Banter / Idle**
  - Low-salience lines, filler dialogue, or steady-state scenes.
  - Only emits if user enabled "fill" mode and danmaku density < target.

Each emitted payload must include `cooldownApplied` flag and next eligible timestamp.

## Rate Controls
- Global budget: max 4 narrative triggers per minute, 8 lightweight, 10 banter.
- Maintain exponential backoff when upstream provider returns rate-limit errors.
- Persist rate counters in `chrome.storage.session` to survive background restarts.

## Extensibility Hooks
- `registerTriggerRule(ruleId, predicate)` allows experiments without redeploying core logic.
- Provide telemetry map: `triggerFired`, `triggerSuppressed`, `cooldownSkipped`, `rateLimitHit`.

## Implementation Steps
1. Scaffold `src/shared/pipeline/trigger-engine.ts` with pure functions for window state and rule evaluation.
2. Integrate with background service worker; subscribe to `TimelineSample` stream.
3. Add developer toggle in popup to dump current window state for debugging.
4. Ship fixture-driven tests in `src/test/trigger/trigger-engine.test.ts` to cover event windows, rate limits, and edge cases (seek, double pause).
