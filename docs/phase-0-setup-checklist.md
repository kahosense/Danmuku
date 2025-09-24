# Phase 0 — Environment & Planning Checklist

## 1. Repo & Tooling Setup
- [x] Confirm repo structure for Chrome extension (src/background, src/content, src/popup, public).
- [x] Initialize shared TypeScript config (`tsconfig.json`) with strict settings and path aliases.
- [x] Configure bundler (Vite + `@crxjs/vite-plugin`) with build targets for service worker, content scripts, popup.
- [x] Set up ESLint + Prettier with project rules aligning with MVP coding standards.
- [ ] Add Husky/lint-staged (optional) for pre-commit checks.
- [x] Prepare testing scaffolding (Vitest + jsdom) and sample unit test.

## 2. Manifest & Permissions Baseline
- [x] Draft `manifest.json` skeleton with permissions: `scripting`, `storage`, `tabs`, `activeTab`, `alarms`, host `https://www.netflix.com/*`.
- [x] Define action popup entry point and icons placeholders.
- [x] Register background service worker entry (`dist/background.js`).
- [ ] Plan dynamic content script injection flow via `chrome.scripting` (optional; current build uses static content script entry).

## 3. API Credential Provisioning
- [ ] Create/OpenAI account access and generate API key dedicated to this project.
- [ ] Store API key securely (e.g., `.env.local`, 1Password); document injection strategy for build (not committed).
- [ ] Define hourly quota limits and monitoring plan (manual for MVP).
- [ ] Draft fallback plan if quota exceeded (persona throttling + user messaging).

## 4. Development Workflow
- [ ] Agree on branching model (e.g., main + feature branches) and PR review process.
- [ ] Set up project management board with Week 1–4 tasks mapped from `docs/mvp-task-breakdown.md`.
- [ ] Identify owners for subtitle pipeline, LLM orchestrator, renderer/UI workstreams.
- [ ] Schedule weekly sync + mid-week standup for MVP duration.

## 5. Local Dev & Testing Environment
- [x] Document Chrome Dev Mode load instructions (`chrome://extensions` → Load unpacked).
- [ ] Prepare sample Netflix test cases (dummy accounts/episodes) and note region availability.
- [ ] Create mock subtitle JSON fixtures for offline testing.
- [ ] Decide on logging verbosity defaults and enabling dev HUD via feature flag.

## 6. Documentation & Knowledge Sharing
- [ ] Link PRD, tech spec, and task breakdown in a single onboarding README.
- [ ] Set up shared drive or Notion page for meeting notes, decisions, and risk log.
- [ ] Define process for updating specs (e.g., change log appended to doc).
- [ ] Collect initial questions for Netflix DOM monitoring responsibilities.

## 7. Go/No-Go Gate
- [ ] Review checklist with team; ensure no blockers on tooling or access.
- [ ] Sign-off to begin Week 1 tasks once bundler build succeeds and API key tested via smoke script.
