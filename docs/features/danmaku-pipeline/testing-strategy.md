# Testing Strategy

## Test Pyramid
- **Unit Tests**: Trigger rules, narrative state transitions, prompt templating, moderation filters.
- **Integration Tests**: End-to-end pipeline using fixture playback via `npm run replay:cues`.
- **System Tests**: Browser automation (Playwright) covering popup controls, content rendering, seek/pause behavior.

## Fixture Replay Harness
- Extend existing replay script to stream subtitles + cue metadata.
- Capture expected danmaku outputs for regression; store in `src/test/fixtures/danmaku-pipeline/`.
- Provide diff tooling to compare snapshot outputs with tolerances (tone only, small text diffs allowed).

## Key Scenarios
- Multi-turn dramatic scene → expect narrative trigger, memory update, moderated output.
- Rapid dialogue → ensure rate limits hold and queue drops low-priority items.
- Provider outage → verify fallback path and user notification.
- User toggles narrative mode off → pipeline stops emitting narrative entries.
- Seek backwards/forwards → renderer reloads from storage correctly.

## Tooling
- Vitest for unit/integration with jsdom.
- Playwright (headless) for UI coverage; gate behind optional CI job.
- ESLint/Prettier lint checks before merge.

## Metrics Validation
- Ensure analytics service logs expected counters; use mock transport for test assertions.
- Include tests for audit log rollover and retention cleanup.

## Release Checklist
- All unit/integration tests green.
- Manual exploratory run using at least two fixture episodes.
- Privacy notice + config verified in manifest preview build (`npm run build`).
