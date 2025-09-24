import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../netflix-player', () => ({
  waitForNetflixVideoPlayer: vi.fn(() =>
    Promise.resolve({
      getCurrentTime: () => 1.25
    })
  )
}));

import { startPlaybackObserver } from '../playback-observer';
import { waitForNetflixVideoPlayer } from '../netflix-player';

describe('playback observer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '<video></video>';
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('emits status updates for playback events', async () => {
    await startPlaybackObserver();

    const runtimeSendMock = chrome.runtime.sendMessage as unknown as { mock: { calls: unknown[][] } };
    expect(runtimeSendMock.mock.calls.length).toBeGreaterThan(0);
    const initialCall = runtimeSendMock.mock.calls[0][0] as { type: string; status: { state: string } };
    expect(initialCall.type).toBe('PLAYBACK_STATUS_UPDATE');
    expect(['paused', 'playing']).toContain(initialCall.status.state);

    const video = document.querySelector('video');
    expect(video).not.toBeNull();
    video?.dispatchEvent(new Event('playing'));

    const afterPlayCall = runtimeSendMock.mock.calls[runtimeSendMock.mock.calls.length - 1][0] as {
      status: { state: string };
    };
    expect(afterPlayCall.status.state).toBe('playing');

    vi.advanceTimersByTime(5_000);
    const pingCall = runtimeSendMock.mock.calls[runtimeSendMock.mock.calls.length - 1][0] as {
      status: { state: string };
    };
    expect(pingCall.status.state).toBe('playing');

    video?.dispatchEvent(new Event('seeking'));
    const seekingCall = runtimeSendMock.mock.calls[runtimeSendMock.mock.calls.length - 1][0] as {
      status: { state: string };
    };
    expect(seekingCall.status.state).toBe('seeking');

    expect(waitForNetflixVideoPlayer).toHaveBeenCalled();
  });
});
