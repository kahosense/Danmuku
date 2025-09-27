# Adaptive Danmaku Pipeline – Feature Dossier

This directory houses the working artifacts for the full-chain narrative-aware danmaku pipeline. Use it as the single source for engineering, product, and ops alignment while the system evolves from prototype to public plugin.

## Contents
- `architecture.md` – end-to-end diagram, runtime responsibilities, hand-off points.
- `trigger-layer.md` – event detection rules, signal aggregation, batching semantics.
- `narrative-engine.md` – storyline memory model, state schema, update policies.
- `generation-pipeline.md` – queue design, prompt contracts, LLM/runtime fallback.
- `moderation-and-safety.md` – content gating, abuse handling, audit logging.
- `storage-and-replay.md` – persistence model, cache retention, playback stitching.
- `configuration-and-ops.md` – user-facing settings, multi-tenant controls, rollout plan.
- `testing-strategy.md` – QA scope, fixture replay, instrumentation checkpoints.
- `implementation-checklist.md` – phased build steps, dependencies, exit criteria.

Update the relevant files as you make product or technical decisions. Once the feature reaches steady-state, migrate enduring knowledge to the canonical docs tree.
