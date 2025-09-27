# Phase 3 – Persona Diversification & Virtual Crowd Plan

## Objective
Deliver a believable "virtual crowd" that reduces mechanical repetition by layering sub-persona variety, individual speech habits, lightweight memory, and diversity-driven reranking on top of the existing four base personas described in `docs/issues/弹幕 Persona 优化问题与方案说明.md`.

### Status Update (2025-02)
- Virtual user roster implemented in `src/shared/persona/roster.ts`, merged via `src/background/personas.ts` to expand each base persona into multiple weighted virtual viewers.
- Prompt builder now threads virtual user traits, tone variants, and recent memory context (`src/background/orchestrator.ts#buildMessages`).
- Persona memory upgraded to retain per-user history snippets, feeding continuity cues back into generation.
- Candidate scoring/reranking incorporates tone diversity and weight bias to surface varied voices while keeping one output per base persona per window.

### Status Update (2025-09)
- Phase 3 replay档与人工评审基线已记录在 `docs/review/sessions/` 与 `docs/review/reports/2025-W39.md`，为 Phase 4 多样性优化提供重复度对照（trigram 重复率 78.51%）。

## Scope & Success Criteria
- [x] Introduce a configurable virtual user pool that maps base personas to sub-persona variants, speech tics, and weights.
- [x] Enrich generation prompts with per-user metadata (tone variant, verbal habits, prior context) following the guardrails documented in `docs/issues/提示词优化方向.md`.
- [x] Maintain short-term session memory per virtual user to continue jokes or reactions.
- [x] Generate multiple candidates per time window and select the most diverse set before displaying.
- [ ] Success: human review rates the new feed as ≥30% more "natural" than the current baseline and automated tests confirm varied tone and continuity across successive messages（pending human evaluation & automated tone coverage tests）.

## Phase Roadmap
### Phase A – Virtual User Pool Foundations (Week 1)
- Goals:
  - [x] Define data contracts for `VirtualUser`.
  - [x] Deliver default roster.
  - [x] Load/store from existing preferences storage.
- Key Tasks:
  - [x] Create `src/shared/persona/roster.ts`.
  - [x] Add serialization helpers.
  - [ ] Expose enable/weight toggles in popup（optional flag still pending implementation）.
- Deliverables:
  - [x] Type definitions.
  - [x] Seed configuration JSON。
  - [x] Unit tests for roster selection。
- Testing:
  - [x] `vitest run` on new factories。
  - [ ] Manual sanity check via mocked generation to ensure weighted random draw（not documented/tested）。
- Owners: Core backend developer for data, frontend dev for optional UI toggle.

### Phase B – Prompt Enrichment & Speech Habits (Week 2)
- Goals:
  - [x] Thread virtual user metadata through message dispatch so the LLM prompt receives persona, sub-persona, and `speechTics` tokens.
- Key Tasks:
  - [x] Extend message shaping utilities in `src/shared/messages.ts`（now used by `src/background/orchestrator.ts`）。
  - [x] Create speech habit pools.
  - [x] Add randomness guardrails.
- Deliverables:
  - [x] Updated prompt builder.
  - [x] Helper for injecting tics.
  - [x] Documentation snippet in `docs/issues/弹幕 Persona 优化问题与方案说明.md`.
  - [x] Cross-reference updates in `docs/issues/提示词优化方向.md`.
- Testing:
  - [x] New unit tests covering prompt scaffolding.
  - [x] Snapshot tests to lock expected template.
  - [ ] Manual check to ensure no empty tokens or skipped guardrails from `docs/issues/提示词优化方向.md`（not captured in repo docs）。
- Owners: Prompt engineer + developer familiar with messaging layer.

### Phase C – Session Memory Layer (Week 3)
- Goals:
  - [x] Persist recent utterances per virtual user within a viewing session using capped memories.
- Key Tasks:
  - [x] Add `VirtualMemoryStore`（implemented via in-memory maps inside `src/background/orchestrator.ts`).
  - [x] Manage lifecycle hooks on session start/end.
  - [x] Expose the memory layer to the prompt builder.
- Deliverables:
  - [x] Memory cache implementation.
  - [x] Integration tests simulating sequential events.
  - [x] Logging toggles.
- Testing:
  - [x] Vitest integration scenario covering persona memory continuity and resets.
  - [ ] Manual devtools validation that memories clear between sessions（not recorded）。
- Owners: Background engineer.

### Phase D – Candidate Pool & Reranking (Week 4)
- Goals:
  - [x] Generate multiple candidates per window, score for novelty/diversity, output top-N.
- Key Tasks:
  - [x] Update generation pipeline to request K messages.
  - [x] Craft heuristic reranker (length variance, persona variety, recent-topic penalty).
  - [x] Emit metrics.
- Deliverables:
  - [x] Reranker module.
  - [x] Configuration for K/N values.
  - [x] Telemetry hooks.
- Testing:
  - [x] Deterministic reranker tests.
  - [x] Load test with synthetic data.
  - [x] Manual review session comparing baseline vs reranked outputs（见 `docs/review/reports/2025-W39.md`）。
- Owners: Algorithm specialist plus QA for scenario scripts.

### Phase E – Stabilization & Launch Prep (Week 5)
- Goals:
  - [ ] Harden the feature.
  - [ ] Capture telemetry.
  - [ ] Prepare release notes.
- Key Tasks:
  - [ ] Instrument logging with opt-out.
  - [ ] Build feature flag toggle.
  - [ ] Update onboarding docs.
  - [ ] Run regression pass using `docs/qa-phase-2-generation.md` as baseline with added crowd cases.
- Deliverables:
  - [ ] Release checklist.
  - [ ] Updated `AGENTS.md`.
  - [ ] Sign-off report.
- Testing:
  - [ ] Full regression.
  - [ ] Production dry-run build (`npm run build`).
  - [ ] Metrics dashboard spot-check.
- Owners: Release manager, QA, PM.

## Timeline & Milestones
| Week | Milestone | Exit Criteria |
| ---- | --------- | ------------- |
| 1 | Virtual user pool merged | Roster available, tests passing |
| 2 | Prompt enrichment live | Prompt templates include sub-persona data |
| 3 | Memory layer enabled | Sequential tests confirm continuity |
| 4 | Reranker active | Candidate diversity metrics ≥ target |
| 5 | Launch readiness | QA sign-off, documentation updated |

### Milestone Status
- [ ] Week 1 – Virtual user pool merged（Roster live; targeted roster tests still missing）。
- [x] Week 2 – Prompt enrichment live.
- [x] Week 3 – Memory layer enabled（functional; regression tests pending）。
- [x] Week 4 – Reranker active.
- [ ] Week 5 – Launch readiness（telemetry, documentation, QA sign-off outstanding）。

## Risks & Mitigations
- **Prompt Drift:** Increased prompt complexity may degrade response quality → keep prompts parameterized, capture before/after samples each week.
- **Performance Impact:** Extra candidate generation could stress quotas → add configuration for per-window max calls and monitor usage.
- **State Bugs:** Session memory may leak across tabs → write integration tests for lifecycle hooks and expose manual reset command.

## Decision Points & Open Questions
- How many virtual users are needed for target diversity? (Decide by end of Week 1.)
- Should speech habit pools be localized per language? (Requires PM decision before Phase B.)
- Is heuristic reranking sufficient or do we need an LLM-based scorer? (Evaluate after Phase D dry run.)

## Communication & Reporting
- Weekly sync to review progress, prompt samples, and metrics.
- Maintain a shared changelog in `docs/issues/弹幕 Persona 优化问题与方案说明.md` for prompt tweaks.
- Notify release/QA once Phase C hits staging so regression planning can begin.
