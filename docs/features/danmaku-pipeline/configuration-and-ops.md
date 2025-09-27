# Configuration & Ops Plan

## User-Facing Settings
Expose settings in popup UI with two tiers:
- **Basic**: toggle narrative mode, danmaku density slider, language preferences.
- **Advanced**: provider selection (cloud vs local), max tokens per minute, policy preset, audit logging opt-in.

Persist settings in `chrome.storage.sync` with schema validation at load time.

## Permissions & Manifest
- Update `manifest.config.ts` to request the minimal host permissions (subtitles domain, activeTab).
- Document data usage in privacy description; highlight capture of subtitles/audio-derived metrics.
- For public release, add `optional_permissions` for experimental signals (camera/mic) and request at runtime.

## Provider Management
- Accept user-provided API keys; encrypt at rest using `chrome.storage.local` + Web Crypto.
- Track usage quotas per provider and surface warnings when approaching limits.
- Implement fallback hierarchy: user key → shared key (if provided) → offline template.

## Telemetry & Monitoring
- `background/analytics.service.ts` to emit:
  - trigger counts, generation latency, moderation reject reasons, user overrides.
  - error events with hashed identifiers for privacy.
- Provide local dashboard (popup tab) summarizing last session metrics.
- Plan for optional remote telemetry endpoint; gate behind explicit opt-in and document payload format.

## Release Management
- Feature flag names: `narrativePipeline.capture`, `.trigger`, `.narrative`, `.generation`, `.moderation`, `.replay`.
- Stage rollout: internal (flag on), beta channel (flag default on but reversible), public (flag removed).
- Keep rollback plan: ability to disable generation and revert to legacy keyword flow via remote config.

## Support & Compliance
- Draft privacy notice and ToS excerpt for extension store submission.
- Define incident response playbook (see `moderation-and-safety.md` for thresholds) and on-call rotation.
- Prepare FAQ covering token usage, data storage, customization, and opt-out procedures.
