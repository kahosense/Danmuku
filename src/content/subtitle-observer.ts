import { waitForNetflixVideoPlayer } from './netflix-player';
import type { NetflixTimedTextCue, NetflixVideoPlayer } from './netflix-types';
import type { SubtitleCue } from '../shared/types';

export type ObservedSubtitleCue = SubtitleCue;

export type SubtitleCallback = (cues: ObservedSubtitleCue[]) => void;

const BATCH_WINDOW_MS = 400;
const MIN_TEXT_LENGTH = 3;
const TIMED_TEXT_SELECTOR = '.player-timedtext, [data-uia="player-timedtext"]';

interface ObserverState {
  player: NetflixVideoPlayer | null;
  teardownFns: Array<() => void>;
  batch: ObservedSubtitleCue[];
  batchTimer: number | null;
  lastDomCueSignature: string | null;
}

export function createSubtitleObserver() {
  const state: ObserverState = {
    player: null,
    teardownFns: [],
    batch: [],
    batchTimer: null,
    lastDomCueSignature: null
  };

  function enqueue(cue: ObservedSubtitleCue, callback: SubtitleCallback) {
    if (!cue.text.trim() || cue.text.trim().length < MIN_TEXT_LENGTH) {
      return;
    }

    state.batch.push(cue);
    if (state.batchTimer === null) {
      state.batchTimer = window.setTimeout(() => {
        const payload = [...state.batch];
        state.batch = [];
        state.batchTimer = null;
        if (payload.length > 0) {
          callback(payload);
        }
      }, BATCH_WINDOW_MS);
    }
  }

  function attachNetflixHook(callback: SubtitleCallback) {
    const handler = (cue: NetflixTimedTextCue) => {
      const text = cue.text?.trim() ?? '';
      if (!text) {
        return;
      }

      const contentId = deriveContentId(state.player);
      const normalized = normalizeCue(cue, contentId, 'netflix-api');
      enqueue(normalized, callback);
    };

    if (!state.player || typeof state.player.on !== 'function') {
      return;
    }

    state.player.on('timedTextCueEntered', handler);
    state.teardownFns.push(() => {
      try {
        state.player?.off?.('timedTextCueEntered', handler);
      } catch (error) {
        console.warn('[content] Failed to detach Netflix cue handler', error);
      }
    });
  }

  function attachDomFallback(callback: SubtitleCallback) {
    let currentContainer: HTMLElement | null = null;

    const containerObserver = new MutationObserver(() => {
      const container = document.querySelector<HTMLElement>(TIMED_TEXT_SELECTOR);
      if (!container || container === currentContainer) {
        return;
      }

      currentContainer = container;
      lineObserver.disconnect();
      lineObserver.observe(container, {
        childList: true,
        subtree: true
      });
    });

    const lineObserver = new MutationObserver(() => {
      const container = currentContainer ?? document.querySelector<HTMLElement>(TIMED_TEXT_SELECTOR);
      if (!container) {
        return;
      }

      const text = collectSubtitleText(container);
      if (!text) {
        return;
      }

      const signature = `${text}::${Math.floor(Date.now() / 1000)}`;
      if (state.lastDomCueSignature === signature) {
        return;
      }
      state.lastDomCueSignature = signature;

      const startTime = state.player?.getCurrentTime?.() ?? performance.now();
      const cue: NetflixTimedTextCue = {
        text,
        startTime,
        endTime: startTime + 3000
      };
      const normalized = normalizeCue(cue, deriveContentId(state.player), 'dom-fallback');
      enqueue(normalized, callback);
    });

    containerObserver.observe(document.body, {
      childList: true,
      subtree: true
    });

    const initialContainer = document.querySelector<HTMLElement>(TIMED_TEXT_SELECTOR);
    if (initialContainer) {
      currentContainer = initialContainer;
      lineObserver.observe(initialContainer, {
        childList: true,
        subtree: true
      });
    }

    state.teardownFns.push(() => {
      containerObserver.disconnect();
      lineObserver.disconnect();
      currentContainer = null;
    });
  }

  async function start(callback: SubtitleCallback) {
    state.player = await waitForNetflixVideoPlayer();
    if (!state.player) {
      console.warn('[content] Netflix video player not detected within timeout. Falling back to DOM observer.');
    } else {
      console.info('[content] Netflix video player attached.');
      attachNetflixHook(callback);
    }

    attachDomFallback(callback);

    return () => {
      if (state.batchTimer !== null) {
        window.clearTimeout(state.batchTimer);
        state.batchTimer = null;
      }
      state.teardownFns.forEach((fn) => {
        try {
          fn();
        } catch (error) {
          console.warn('[content] Error during subtitle observer teardown', error);
        }
      });
      state.teardownFns = [];
      state.player = null;
      state.lastDomCueSignature = null;
    };
  }

  return { start };
}

function normalizeCue(
  cue: NetflixTimedTextCue,
  contentId: string,
  source: ObservedSubtitleCue['source']
): ObservedSubtitleCue {
  const startTime = Math.max(0, cue.startTime ?? 0);
  const endTime = cue.endTime ?? startTime;
  const duration = Math.max(0, endTime - startTime);
  const baseId = cue.id || `${Math.round(startTime)}-${Math.round(endTime)}-${hashText(cue.text)}`;

  return {
    contentId,
    text: cue.text.trim(),
    startTime,
    endTime,
    duration,
    cueId: `${contentId}-${baseId}`,
    source
  };
}

function hashText(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

export function deriveContentId(player: NetflixVideoPlayer | null): string {
  const videoData = player?.getVideoData?.();
  const candidate = videoData?.movieId ?? videoData?.title ?? 'unknown';
  return String(candidate);
}

function collectSubtitleText(container: HTMLElement): string {
  const texts = Array.from(container.querySelectorAll<HTMLElement>('span'))
    .map((el) => el.textContent?.trim() ?? '')
    .filter(Boolean);
  return texts.join(' ').trim();
}
