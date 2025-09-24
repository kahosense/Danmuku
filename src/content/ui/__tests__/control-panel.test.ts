import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserPreferences } from '../../../shared/types';

vi.mock('../../playback-observer', () => ({
  getRealtimePlaybackPositionMs: vi.fn(() => 1_234)
}));

import { ControlPanel } from '../control-panel';
import { getRealtimePlaybackPositionMs } from '../../playback-observer';

const preferences: UserPreferences = {
  globalEnabled: true,
  density: 'medium',
  personaEnabled: { alex: true, jordan: true, sam: true, casey: true },
  developerMode: false,
  lastUpdated: Date.now()
};

describe('ControlPanel', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('sends regenerate requests with playback position', () => {
    new ControlPanel({ getPreferences: () => preferences });
    const button = document.querySelector<HTMLButtonElement>('.panel-button');

    button?.click();

    const runtimeSendMock = chrome.runtime.sendMessage as unknown as { mock: { calls: unknown[][] } };
    const regenerateCall = runtimeSendMock.mock.calls.find((call) => {
      const [message] = call as [{ type?: string }];
      return message?.type === 'REGENERATE_FROM_TIMESTAMP';
    });

    expect(regenerateCall).toBeDefined();
    const [message] = regenerateCall as [{ type: string; timestamp: number }];
    expect(message.type).toBe('REGENERATE_FROM_TIMESTAMP');
    expect(typeof message.timestamp).toBe('number');
    expect(getRealtimePlaybackPositionMs).toHaveBeenCalled();
  });

  it('updates LLM status badge', () => {
    const panel = new ControlPanel({ getPreferences: () => preferences });
    const badge = document.querySelector<HTMLSpanElement>('.panel-status-badge');
    expect(badge?.textContent).toBe('正常');

    panel.setLLMStatus({ level: 'degraded', detail: 'timeout' });

    expect(badge?.textContent).toBe('降级');
    expect(badge?.classList.contains('status-degraded')).toBe(true);
    expect(badge?.title).toBe('timeout');
  });
});
