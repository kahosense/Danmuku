import { createSubtitleObserver } from './subtitle-observer';
import { ensureRendererHost } from './renderer/overlay';
import { ensureControlPanel } from './ui/control-panel';
import { setDeveloperHUDEnabled, updateDeveloperHUD } from './ui/developer-hud';
import { sendMessage, type RuntimeMessage } from '../shared/messages';
import type { SubtitleCue, UserPreferences, LLMStatus } from '../shared/types';
import { startPlaybackObserver } from './playback-observer';

const markerId = 'danmaku-extension-marker';

let currentContentId: string | null = null;
let currentPreferences: UserPreferences | null = null;
const renderer = ensureRendererHost();
const controlPanel = ensureControlPanel({
  getPreferences: () => currentPreferences
});

function attachMarker(): boolean {
  if (document.getElementById(markerId)) {
    return false;
  }

  const marker = document.createElement('div');
  marker.id = markerId;
  marker.style.display = 'none';
  document.documentElement.appendChild(marker);
  return true;
}

function applyPreferences(preferences: UserPreferences) {
  currentPreferences = preferences;
  renderer.setEnabled(preferences.globalEnabled);
  controlPanel.update(preferences);
  setDeveloperHUDEnabled(preferences.developerMode);
}

async function handleCueBatch(cues: SubtitleCue[]) {
  if (cues.length === 0) {
    return;
  }

  currentContentId = cues[cues.length - 1]?.contentId ?? currentContentId;
  updateDeveloperHUD({ cues: cues.length });

  const response = await sendMessage({ type: 'CUES_BATCH', cues });
  if (response?.type === 'RENDER_STATUS' && response.status === 'error') {
    console.error('[content] Render status error', response.detail);
  }
}

function boot() {
  const attached = attachMarker();
  if (!attached) {
    console.info('[content] Netflix AI Danmaku already initialized; skipping re-attach.');
    return;
  }

  console.info('[content] Netflix AI Danmaku content script booting.');

  sendMessage({ type: 'PING' });

  sendMessage({ type: 'REQUEST_PREFERENCES' }).then((response) => {
    if (response?.type === 'PREFERENCES_RESPONSE') {
      applyPreferences(response.preferences);
    }
  });

  sendMessage({ type: 'REQUEST_LLM_STATUS' }).then((response) => {
    if (response?.type === 'LLM_STATUS_UPDATE') {
      controlPanel.setLLMStatus(response.status as LLMStatus);
    }
  });

  const subtitleObserver = createSubtitleObserver();
  subtitleObserver
    .start((cues) => {
      handleCueBatch(cues).catch((error) => {
        console.error('[content] Failed to send cue batch', error);
      });
    })
    .then((teardown) => {
      window.addEventListener('beforeunload', teardown, { once: true });
    })
    .catch((error) => {
      console.error('[content] Failed to start subtitle observer', error);
    });

  startPlaybackObserver().catch((error) => {
    console.error('[content] Failed to start playback observer', error);
  });
}

chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
  if (message.type === 'COMMENTS_BATCH') {
    renderer.renderBatch(message.comments);
    const totalText = message.comments.reduce((sum, comment) => sum + comment.text.length, 0);
    const avgLength = message.comments.length > 0 ? totalText / message.comments.length : 0;
    updateDeveloperHUD({ comments: message.comments.length, avgCommentLength: avgLength });
    return;
  }

  if (message.type === 'PREFERENCES_RESPONSE') {
    applyPreferences(message.preferences as UserPreferences);
    return;
  }

  if (message.type === 'METRICS_UPDATE') {
    const totalRequests = message.metrics.cacheHits + message.metrics.cacheMisses;
    const cacheHitRate = totalRequests > 0 ? message.metrics.cacheHits / totalRequests : 0;
    updateDeveloperHUD({
      cacheHitRate,
      avgLLMLatencyMs: message.metrics.averageLLMLatencyMs,
      avgGenerationLatencyMs: message.metrics.averageGenerationLatencyMs,
      cacheSizeActiveMb: message.metrics.cacheSizeActiveBytes / (1024 * 1024),
      cacheSizeGlobalMb: message.metrics.cacheSizeGlobalBytes / (1024 * 1024),
      fallbackResponses: message.metrics.fallbackResponses,
      windowCommentTotal: message.metrics.windowCommentTotal ?? 0
    });
    if (currentPreferences?.developerMode) {
      console.debug('[content] Metrics update', message.metrics);
      if (message.metrics.fallbackResponses > 0) {
        console.warn('[content] LLM fallback responses', message.metrics.fallbackResponses);
      }
    }
    return;
  }

  if (message.type === 'LLM_STATUS_UPDATE') {
    controlPanel.setLLMStatus(message.status);
    if (currentPreferences?.developerMode) {
      console.debug('[content] LLM status update', message.status);
    }
    return;
  }

  if (message.type === 'REQUEST_ACTIVE_CONTENT_ID') {
    sendResponse({ type: 'ACTIVE_CONTENT_ID_RESPONSE', contentId: currentContentId });
    return true;
  }

  return undefined;
});

document.addEventListener('danmaku-metrics', (event) => {
  if (!currentPreferences?.developerMode) {
    return;
  }
  const detail = (event as CustomEvent<{
    activeLanes: number;
    segmentsGenerated: number;
    truncated: number;
  }>).detail;
  if (!detail) {
    return;
  }
  updateDeveloperHUD({
    activeLanes: detail.activeLanes,
    segmentsGenerated: detail.segmentsGenerated,
    truncatedComments: detail.truncated
  });
});

boot();
