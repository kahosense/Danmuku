import type {
  GeneratedComment,
  OrchestratorMetrics,
  LLMStatus,
  PlaybackStatus,
  SubtitleCue,
  UserPreferences,
  FeedbackCategory
} from './types';

export type RuntimeMessage =
  | {
      type: 'PING';
    }
  | {
      type: 'PONG';
      timestamp: number;
    }
  | {
      type: 'CUES_BATCH';
      cues: SubtitleCue[];
    }
  | {
      type: 'COMMENTS_BATCH';
      comments: GeneratedComment[];
    }
  | {
      type: 'REQUEST_PREFERENCES';
    }
  | {
      type: 'PREFERENCES_RESPONSE';
      preferences: UserPreferences;
    }
  | {
      type: 'UPDATE_PREFERENCES';
      preferences: Partial<UserPreferences>;
    }
  | {
      type: 'REGENERATE_FROM_TIMESTAMP';
      timestamp: number;
    }
  | {
      type: 'REQUEST_ACTIVE_CONTENT_ID';
    }
  | {
      type: 'ACTIVE_CONTENT_ID_RESPONSE';
      contentId: string | null;
    }
  | {
      type: 'RENDER_STATUS';
      status: 'idle' | 'loading' | 'error';
      detail?: string;
    }
  | {
      type: 'PLAYBACK_STATUS_UPDATE';
      status: PlaybackStatus;
    }
  | {
      type: 'METRICS_UPDATE';
      metrics: OrchestratorMetrics;
    }
  | {
      type: 'LLM_STATUS_UPDATE';
      status: LLMStatus;
    }
  | {
      type: 'REQUEST_LLM_STATUS';
    }
  | {
      type: 'REQUEST_PROMPT_VARIANTS';
    }
  | {
      type: 'PROMPT_VARIANTS_RESPONSE';
      activeId: string;
      variants: Array<{
        id: string;
        label: string;
        promptVersion: string;
        description?: string;
      }>;
    }
  | {
      type: 'SET_PROMPT_VARIANT';
      id: string;
    }
  | {
      type: 'SUBMIT_USER_FEEDBACK';
      feedback: {
        category: FeedbackCategory;
        note?: string | null;
      };
    }
  | {
      type: 'USER_FEEDBACK_RECORDED';
      entryId: string;
    }
;

export function sendMessage<T extends RuntimeMessage>(message: T): Promise<RuntimeMessage | undefined> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        console.warn('[shared/messages] sendMessage error', chrome.runtime.lastError.message);
        resolve(undefined);
        return;
      }
      resolve(response as RuntimeMessage | undefined);
    });
  });
}
