export interface SubtitleCue {
  contentId: string;
  cueId: string;
  text: string;
  startTime: number;
  endTime: number;
  duration: number;
  source: 'netflix-api' | 'dom-fallback';
}

export type DensitySetting = 'low' | 'medium' | 'high';

export interface PersonaToggleState {
  [personaId: string]: boolean;
}

export interface UserPreferences {
  globalEnabled: boolean;
  density: DensitySetting;
  personaEnabled: PersonaToggleState;
  developerMode: boolean;
  lastUpdated: number;
}

export interface GeneratedComment {
  id: string;
  personaId: string;
  text: string;
  createdAt: number;
  renderAt: number;
  durationMs: number;
}

export interface OrchestratorTask {
  personaId: string;
  cue: SubtitleCue;
  cacheKey: string;
}

export type PlaybackState = 'playing' | 'paused' | 'seeking';

export interface PlaybackStatus {
  state: PlaybackState;
  positionMs: number;
  contentId: string | null;
  updatedAt: number;
}

export interface OrchestratorMetrics {
  timestamp: number;
  cacheHits: number;
  cacheMisses: number;
  llmCalls: number;
  averageLLMLatencyMs: number;
  averageGenerationLatencyMs: number;
  skippedByThrottle: number;
  skippedByHeuristics: number;
  skippedByLock: number;
  duplicatesFiltered: number;
  sanitizedDrops: number;
  fallbackResponses: number;
  cacheSizeGlobalBytes: number;
  cacheSizeActiveBytes: number;
  activeContentId: string | null;
  windowCommentTotal?: number;
}

export interface OrchestratorResult {
  comments: GeneratedComment[];
  metrics: OrchestratorMetrics;
}

export type LLMStatusLevel = 'ok' | 'degraded' | 'error';

export interface LLMStatus {
  level: LLMStatusLevel;
  detail?: string;
}
