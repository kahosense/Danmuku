# Manual Evaluation & Crowd Playback Checklist

## Purpose
Provide a repeatable process for phase-2 reviewers to judge danmaku quality, capture qualitative feedback, and collect reproducible transcripts without streaming Netflix.

## Preparation
- Run `npm install` once if dependencies are missing. Then, for each evaluation session:
  1. `npm run dev` and load the extension in Chrome.
  2. Open the popup and confirm personas/density are set to the target profile (usually `medium`).
  3. Use the new feedback buttons to submit quick impressions (`弹幕太多`, `太像机器人`, `很不错`) whenever a session ends. These are logged in local storage for later triage.

## Offline Replay Workflow
- Generate deterministic transcripts when you can’t stream:
  - `npm run replay:cues -- --out replays/demo.json` uses `src/tools/replay-session.ts` and the cues under `src/tools/fixtures/sample-cues.json` by default.
  - Provide your own cue batches (`SubtitleCue[][]` JSON) to simulate episodes.
  - The command prints persona reactions to stdout and writes the structured transcript if `--out` is provided.
- Reviewers should annotate the saved JSON with pass/fail, notes on tone diversity, and suggested prompt tweaks. Store annotated files under `docs/review/sessions/` with date stamps.

## Live Session Review
1. Pick a 3–5 minute segment, ideally around a tonal shift (build-up → payoff).
2. Record observations:
   - **Density**: Are there >3 lines per 8s window?
   - **Variety**: Do personas overlap topics or echo phrasing?
   - **Human feel**: Note slang usage, pacing, and any robotic cadence.
3. Submit quick feedback via the popup buttons when the segment ends.
4. Collect metrics from the dev HUD (toggle Developer Mode). Screenshot the `candidatesGenerated`, `prunedByReranker`, and latency panel for the report.

## Weekly Reporting Template
- **Segment**: show, episode, timestamp range.
- **Overall verdict**: ✅ pass / ⚠ needs iteration.
- **Key findings**: bullets for density, tone variety, human-ness.
- **Prompt or persona tweaks**: references to `docs/issues/提示词优化方向.md` or new suggestions.
- **User feedback pulse**: summarize counts per category from `feedbackStore.list()`.

Store reports under `docs/review/reports/` with ISO week numbers.
