# Storage & Replay Design

## Persistence Goals
- Support seamless playback, pause, and seek without losing generated danmaku.
- Retain minimal yet sufficient metadata for analytics and moderation audits.

## Data Stores
- **Session Store** (`chrome.storage.session`)
  - Live queues, rate counters, narrative ledger snapshots.
- **History DB** (IndexedDB via `shared/storage/danmaku-history.ts`)
  - Object store `entries`: `id`, `episodeId`, `timestampMs`, `text`, `channel`, `priority`, `origin`, `createdAt`, `policyVersion`.
  - Secondary indexes on `episodeId+timestampMs` for playback lookup.
- **Audit Log** (`chrome.storage.local`) – limited retention for moderation outcomes.

## Write Path
1. Moderation-approved `DanmakuEntry` inserted into history DB.
2. Notify content renderer through message channel with delta payload.
3. Update session store caches to keep fast access in sync.

## Read Path
- Content renderer queries upcoming entries within `[currentTime, currentTime + horizonMs]` (default horizon 6s).
- On seek, drop cached entries and rehydrate from DB using `episodeId` + time range.
- Provide offline prefetch for `npm run replay:cues` test harness.

## Retention & Cleanup
- For self-use: keep entries per episode up to 2 weeks or 5k records.
- For public plugin: default to 48h retention unless user opts in for longer; expose purge button.
- Background scheduled job runs daily to delete expired entries and shrink audit logs.

## Export & Debugging
- Developer command (flagged) to dump session state as JSON for offline analysis.
- Provide redacted export that excludes raw subtitles but keeps derived metadata.

## Testing Considerations
- Add integration tests using fake IndexedDB to ensure seek/pause/resume flows.
- Verify cleanup routine respects retention policy and does not block main thread.
