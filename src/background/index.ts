import { orchestrator } from './orchestrator';
import { cacheStore } from './cache-store';
import { llmClient } from './llm-client';
import { PERSONAS } from './personas';
import { logger } from '../shared/logger';
import { preferenceStore, DEFAULT_PREFERENCES } from '../shared/settings';
import type { RuntimeMessage } from '../shared/messages';
import type { LLMStatus, OrchestratorMetrics, UserPreferences } from '../shared/types';

chrome.runtime.onInstalled.addListener(() => {
  logger.info('Netflix AI Danmaku extension installed.');
});

let cachedPreferences: UserPreferences | null = null;
const llmStatusByTab = new Map<number, LLMStatus>();

async function getPreferences(): Promise<UserPreferences> {
  if (!cachedPreferences) {
    cachedPreferences = await preferenceStore.get();
  }
  return cachedPreferences;
}

preferenceStore.subscribe((prefs) => {
  cachedPreferences = prefs;
  logger.setLevel(prefs.developerMode ? 'debug' : 'info');
});

chrome.runtime.onMessage.addListener((message: RuntimeMessage, sender, sendResponse) => {
  (async () => {
    switch (message.type) {
      case 'PING': {
        sendResponse({ type: 'PONG', timestamp: Date.now() });
        return;
      }
      case 'REQUEST_PREFERENCES': {
        const preferences = await getPreferences();
        sendResponse({ type: 'PREFERENCES_RESPONSE', preferences });
        return;
      }
      case 'UPDATE_PREFERENCES': {
        const current = await getPreferences();
        const merged = {
          ...current,
          ...message.preferences,
          personaEnabled: {
            ...current.personaEnabled,
            ...message.preferences.personaEnabled
          },
          lastUpdated: Date.now()
        };
        await preferenceStore.set(merged);
        await chrome.runtime.sendMessage({
          type: 'PREFERENCES_RESPONSE',
          preferences: merged
        });
        sendResponse({ type: 'PREFERENCES_RESPONSE', preferences: merged });
        return;
      }
      case 'CUES_BATCH': {
        if (!sender.tab?.id) {
          logger.warn('[background] Received cues without tab context.');
          return;
        }
        const preferences = await getPreferences();
        const { comments, metrics } = await orchestrator.processCueBatch(
          message.cues,
          preferences
        );
        if (comments.length > 0) {
          await chrome.tabs.sendMessage(sender.tab.id, {
            type: 'COMMENTS_BATCH',
            comments
          });
        }
        if (preferences.developerMode) {
          await chrome.tabs.sendMessage(sender.tab.id, {
            type: 'METRICS_UPDATE',
            metrics
          });
        }
        if (sender.tab?.id !== undefined) {
          await broadcastLlmStatus(sender.tab.id, metrics);
        }
        sendResponse({ type: 'RENDER_STATUS', status: 'idle' });
        return;
      }
      case 'PLAYBACK_STATUS_UPDATE': {
        orchestrator.updatePlaybackStatus(message.status);
        if (
          message.status.state === 'seeking' &&
          message.status.contentId &&
          Number.isFinite(message.status.positionMs) &&
          message.status.positionMs >= 0
        ) {
          await cacheStore.purgeFuture(message.status.contentId, message.status.positionMs);
        }
        sendResponse({ type: 'RENDER_STATUS', status: 'idle' });
        return;
      }
      case 'REQUEST_LLM_STATUS': {
        const tabId = sender.tab?.id;
        const fallbackStatus = tabId !== undefined ? llmStatusByTab.get(tabId) : null;
        const status = fallbackStatus ?? llmClient.getLastStatus();
        if (tabId !== undefined) {
          llmStatusByTab.set(tabId, status);
        }
        sendResponse({ type: 'LLM_STATUS_UPDATE', status });
        return;
      }
      case 'REGENERATE_FROM_TIMESTAMP': {
        const prefs = await getPreferences();
        if (!prefs.globalEnabled) {
          sendResponse({ type: 'RENDER_STATUS', status: 'idle' });
          return;
        }
        if (cachedPreferences?.lastUpdated) {
          // noop for now; regeneration handled via cache purge below.
        }
        let targetContentId = orchestrator.getActiveContentId();
        if (!targetContentId && sender.tab?.id !== undefined) {
          targetContentId = await getActiveContentId(sender.tab.id);
        }
        if (
          targetContentId &&
          Number.isFinite(message.timestamp) &&
          message.timestamp >= 0
        ) {
          await cacheStore.purgeFuture(targetContentId, message.timestamp);
          orchestrator.resetAfterRegeneration();
        }
        sendResponse({ type: 'RENDER_STATUS', status: 'idle' });
        return;
      }
      default: {
        logger.warn('[background] Unknown message type', message);
      }
    }
  })().catch((error) => {
    logger.error('[background] Message handler error', error);
    sendResponse({ type: 'RENDER_STATUS', status: 'error', detail: String(error) });
  });

  return true;
});

chrome.alarms.create('keepalive', { periodInMinutes: 4 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepalive') {
    chrome.runtime.getPlatformInfo(() => {
      logger.debug('[background] keepalive ping');
    });
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  llmStatusByTab.delete(tabId);
});

async function getActiveContentId(tabId: number): Promise<string | null> {
  try {
    const result = (await chrome.tabs.sendMessage(tabId, {
      type: 'REQUEST_ACTIVE_CONTENT_ID'
    })) as RuntimeMessage | undefined;
    if (result && result.type === 'ACTIVE_CONTENT_ID_RESPONSE') {
      return result.contentId;
    }
  } catch (error) {
    logger.warn('[background] Failed to obtain active content id', error);
  }
  return null;
}

async function broadcastLlmStatus(tabId: number, metrics: OrchestratorMetrics) {
  const clientStatus = llmClient.getLastStatus();
  const status: LLMStatus = {
    level: clientStatus.level,
    detail: clientStatus.detail
  };

  if (status.level !== 'error' && metrics.fallbackResponses > 0) {
    const fallbackDetail = `使用占位响应 ${metrics.fallbackResponses} 条`;
    status.level = 'degraded';
    status.detail = status.detail ? `${status.detail}; ${fallbackDetail}` : fallbackDetail;
  }

  const previous = llmStatusByTab.get(tabId);
  if (previous && previous.level === status.level && previous.detail === status.detail) {
    return;
  }

  llmStatusByTab.set(tabId, status);

  try {
    await chrome.tabs.sendMessage(tabId, {
      type: 'LLM_STATUS_UPDATE',
      status
    });
  } catch (error) {
    logger.debug('[background] Failed to broadcast LLM status', error);
  }
}

// Configure LLM client (falls back to stub if missing). Ensure secrets are injected at build time only.
const LLM_ENDPOINT = import.meta.env.VITE_LLM_ENDPOINT as string | undefined;
const LLM_API_KEY = import.meta.env.VITE_LLM_API_KEY as string | undefined;

if (LLM_ENDPOINT && LLM_API_KEY) {
  llmClient.configure({ endpoint: LLM_ENDPOINT, apiKey: LLM_API_KEY });
} else {
  logger.warn('[background] LLM credentials missing; using stub responses');
  llmClient.configure({});
}

// Expose personas for popup via chrome.runtime API (optional)
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'persona-stream') {
    port.postMessage({ personas: PERSONAS });
  }
});

// Provide default preferences if storage empty on startup
(async () => {
  const preferences = await preferenceStore.get();
  cachedPreferences = preferences ?? DEFAULT_PREFERENCES;
  logger.setLevel(cachedPreferences.developerMode ? 'debug' : 'info');
})();
