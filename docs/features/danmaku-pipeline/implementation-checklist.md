# Implementation Checklist

## Phase 0 – Foundations
- [ ] Define shared TypeScript types (`TimelineSample`, `TriggerPayload`, `NarrativeSnapshot`).
- [ ] Scaffold storage helpers (session store, IndexedDB) with migration hooks.
- [ ] Add feature flags and popup toggle placeholders.

## Phase 1 – Trigger Engine
- [ ] Implement capture layer enhancements (dialogue + cue ingestion).
- [ ] Build trigger engine with unit tests and telemetry hooks.
- [ ] Ship background integration behind flag; verify `npm run replay:cues` compatibility.

## Phase 2 – Narrative Engine
- [ ] Create narrative memory ledger and update routines.
- [ ] Integrate lightweight extractor (rules + MiniLM) and handle degraded mode.
- [ ] Add developer debugging surfaces and ledger reset.

## Phase 3 – Generation Pipeline
- [ ] Implement queue scheduler with provider routing and fallbacks.
- [ ] Finalize prompt templates, add schema validation.
- [ ] Capture telemetry + cost tracking; add UI warning for quota.

## Phase 4 – Moderation & Storage
- [ ] Build moderation pipeline with policy presets and audit logging.
- [ ] Wire write/read path to IndexedDB with retention enforcement.
- [ ] Update renderer to consume new store format.

## Phase 5 – Configuration & Release Prep
- [ ] Complete popup settings panel, manifest updates, and consent screens.
- [ ] Finalize telemetry transport and privacy notice.
- [ ] Run regression suite + manual QA, prepare rollout comms.

Update the checklist as tasks complete; link PRs or issues next to each item when applicable.
