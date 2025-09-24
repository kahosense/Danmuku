import { waitForNetflixVideoPlayer } from './netflix-player';
import type { NetflixVideoPlayer } from './netflix-types';
import { deriveContentId } from './subtitle-observer';
import { sendMessage } from '../shared/messages';
import type { PlaybackState } from '../shared/types';

const POLL_INTERVAL_MS = 200;
const PROGRESS_PING_INTERVAL_MS = 5000;

let progressTimer: number | null = null;
let lastState: PlaybackState | null = null;
let lastPositionMs = 0;
let latestKnownPositionMs = 0;

function wait(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function waitForVideoElement(): Promise<HTMLVideoElement | null> {
  const maxAttempts = 25;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const video = document.querySelector<HTMLVideoElement>('video');
    if (video) {
      return video;
    }
    await wait(POLL_INTERVAL_MS);
  }
  return document.querySelector<HTMLVideoElement>('video');
}

function getPositionMs(player: NetflixVideoPlayer | null, video: HTMLVideoElement | null) {
  const playerTime = player?.getCurrentTime?.();
  if (typeof playerTime === 'number' && Number.isFinite(playerTime)) {
    return Math.max(0, Math.round(playerTime * 1000));
  }
  if (video) {
    return Math.max(0, Math.round(video.currentTime * 1000));
  }
  return 0;
}

function emitStatus(
  state: PlaybackState,
  player: NetflixVideoPlayer | null,
  video: HTMLVideoElement | null,
  { force } = { force: false }
) {
  const positionMs = getPositionMs(player, video);
  const contentId = deriveContentId(player);
  const status = {
    state,
    positionMs,
    contentId,
    updatedAt: Date.now()
  };

  if (!force) {
    if (lastState === state && Math.abs(positionMs - lastPositionMs) < 750) {
      return;
    }
  }

  lastState = state;
  lastPositionMs = positionMs;
  latestKnownPositionMs = positionMs;

  sendMessage({ type: 'PLAYBACK_STATUS_UPDATE', status }).catch((error) => {
    console.warn('[content] Failed to send playback status', error);
  });
}

function startProgressPing(
  player: NetflixVideoPlayer | null,
  video: HTMLVideoElement | null
) {
  stopProgressPing();
  progressTimer = window.setInterval(() => {
    emitStatus('playing', player, video, { force: true });
  }, PROGRESS_PING_INTERVAL_MS);
}

function stopProgressPing() {
  if (progressTimer !== null) {
    window.clearInterval(progressTimer);
    progressTimer = null;
  }
}

export async function startPlaybackObserver() {
  try {
    const [player, video] = await Promise.all([
      waitForNetflixVideoPlayer(),
      waitForVideoElement()
    ]);

    if (!video) {
      console.warn('[content] No video element found for playback observer.');
      return;
    }

    const initialState: PlaybackState = video.paused ? 'paused' : 'playing';
    emitStatus(initialState, player, video, { force: true });
    if (initialState === 'playing') {
      startProgressPing(player, video);
    }

    video.addEventListener('playing', () => {
      emitStatus('playing', player, video, { force: true });
      startProgressPing(player, video);
    });

    video.addEventListener('pause', () => {
      emitStatus('paused', player, video, { force: true });
      stopProgressPing();
    });

    video.addEventListener('seeking', () => {
      emitStatus('seeking', player, video, { force: true });
      stopProgressPing();
    });

    video.addEventListener('seeked', () => {
      const stateAfterSeek: PlaybackState = video.paused ? 'paused' : 'playing';
      emitStatus(stateAfterSeek, player, video, { force: true });
      if (stateAfterSeek === 'playing') {
        startProgressPing(player, video);
      }
    });

    window.addEventListener('beforeunload', () => {
      stopProgressPing();
    });
  } catch (error) {
    console.error('[content] Failed to initialize playback observer', error);
  }
}

export function getLatestPlaybackPositionMs() {
  return latestKnownPositionMs;
}

export function getRealtimePlaybackPositionMs() {
  const video = document.querySelector<HTMLVideoElement>('video');
  if (video) {
    return Math.max(0, Math.round(video.currentTime * 1000));
  }
  return latestKnownPositionMs;
}
