# Narrative Engine Specification

## Purpose
Encode evolving story arcs, role relationships, and emotional context so the generator can craft plot-aware danmaku without replaying raw dialogue.

## Core Concepts
- **Role State**: `{ roleId, displayName, goals, emotion, trustLevels, lastSeenMs }`
- **Event Node**: `{ eventId, actorIds[], targetIds[], action, modifiers, evidence }`
- **NarrativeSnapshot**: composed of current event node(s), summarized window text, and role state deltas.
- **Memory Ledger**: persistent store of role states and unresolved threads (promises, conflicts).

## Update Flow
1. Receive `TriggerPayload` from trigger layer.
2. Extract candidate events using lightweight extractor (rules + MiniLM classification).
3. Update role states:
   - Emotion decay over time (`emotion = lerp(emotion, neutral, dt/20s)`).
   - Goal and relationship changes based on detected verbs and sentiment.
4. Generate `NarrativeSnapshot.summary` using templated mini summarizer; clamp to 120 chars.
5. Emit snapshot and persist new memory ledger entry.

## Memory Management
- Cap role count per series to 12; archive least-recently-used roles with minimal state.
- Keep last 10 narrative events for context; older entries move to `history` bucket accessible on demand.
- Provide reset hook on episode change or manual user action.

## Data Surfaces
- Expose `useNarrativeState()` hook in `content` for optional UI overlays.
- Provide debugging endpoint in background (secured dev flag) that outputs current ledger for QA.

## Failure Handling
- If extractor fails, fallback to simple keyword summary and mark snapshot as `degraded = true`.
- On persistent failure (>5 degraded snapshots in 2 minutes), auto-disable narrative mode and notify user via toast.

## Implementation Notes
- All transformation functions should be deterministic for fixture replays; avoid Date.now() without injection.
- Persist memory ledger in `chrome.storage.session` with version stamp; add migration helper under `src/shared/narrative/migrations.ts`.
- Write unit tests covering emotion decay, role expiry, and ledger migrations.
