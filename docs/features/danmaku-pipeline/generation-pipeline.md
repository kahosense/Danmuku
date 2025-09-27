# Generation Pipeline Guidelines

## Goals
- Produce natural, plot-aware danmaku while respecting provider quotas and latency limits.
- Provide deterministic fallbacks when LLM access is degraded.

## Queue Design
- `priorityQueue`: max-heap keyed by `NarrativeSnapshot.priority` (narrative > lightweight > banter).
- Concurrency: default 2 in-flight requests; configurable per provider.
- Debounce duplicates: identical `NarrativeSnapshot.summary` within 10 seconds share a single request.
- Task envelope `{ snapshot, providerHint, retryCount, firstEnqueuedAt }` stored in background memory.

## Prompt Contract
- Prompt template lives in `src/shared/narrative/prompts.ts` and expects variables:
  - `narrativeSummary`
  - `recentDanmaku` (last 3 entries)
  - `roleStates`
  - `visualCueSummary`
  - `styleDirective` (based on user configuration)
- Output format: JSON with `text`, `tone`, `safetyTags`, `debug` (optional). Use `zod` schema to validate.

## Provider Routing
1. Attempt preferred provider (user-selected or default cloud API).
2. On rate limit or timeout, retry up to 2 times with exponential backoff.
3. If all retries fail, route to fallback:
   - `localMiniModel` if packaged.
   - Otherwise run template-based stub (prewritten responses) with `tone = "neutral"`.
4. Record provider choice and latency for telemetry.

## Cost & Token Controls
- Clamp prompt tokens by trimming `recentDanmaku` and narrowing role state fields.
- Enforce global tokens/min budget; when exceeded, switch to low-cost template mode until window resets.

## Observability
- Emit events: `generation.start`, `generation.success`, `generation.failure`, `generation.fallback`.
- Capture provider responses (redacted) for offline evaluation using `npm run replay:cues` dataset.

## Implementation Steps
1. Define `GenerationTask` and queue helpers in `src/shared/narrative/generation.ts`.
2. Create background service worker loop that consumes queue using `chrome.alarms` or idle callbacks.
3. Implement prompt templating with tests verifying placeholder substitution.
4. Integrate response validation + transformation into moderation pipeline entry point.
