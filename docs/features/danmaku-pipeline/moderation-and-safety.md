# Moderation & Safety Framework

## Principles
- Protect users and distribution platforms from disallowed or high-risk content.
- Keep auditability for post-hoc review when operating as a public plugin.

## Pipeline Stages
1. **Schema Validation** – ensure generation output matches expected JSON schema; reject malformed entries.
2. **Content Filters**
   - Pattern blacklist (regex) for known slurs, PII, spoilers.
   - Context-aware classifier (MiniLM or external API) for toxicity, hate, sexual content.
3. **Policy Rules**
   - Enforce length, tone, channel-specific directives.
   - Drop entries referencing sensitive metadata (real user info, meeting IDs, etc.).
4. **Deduplication**
   - Compute embedding via lightweight model; compare cosine similarity against recent accepted danmaku.
   - Reject if similarity > 0.92 within 30s window.
5. **Audit Logging**
   - Record rejected entries with reason codes in `chrome.storage.local` rolling buffer (capped, daily purge).

## Configurability
- Maintain default policy preset (`policy.default.json`).
- Allow advanced users to opt into `policy.relaxed` or stricter variants via popup settings.
- Enable remote policy updates via signed config fetch (future enhancement).

## User Controls
- Inline options: hide channel, report danmaku (sends hashed content + metadata to background).
- Provide "panic button" to disable all generated danmaku; clears queues immediately.

## Compliance Notes
- Document data retention: audit logs <= 7 days, anonymized.
- Add consent checkpoint on first run; highlight data captured (subtitles, cues) and provider usage.
- If external moderation API is used, ensure request payload excludes raw user identifiers; use content hashes.

## Testing
- Maintain red-team fixture list in `src/test/moderation/unsafe-fixtures.json`.
- Write Vitest cases covering borderline language, duplicates, and audit record rollover.
