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

export type EnergyState = 'calm' | 'active' | 'peak' | 'cooldown';

export type FeedbackCategory = 'too_noisy' | 'too_robotic' | 'great' | 'other';

export interface FeedbackEntry {
  id: string;
  category: FeedbackCategory;
  note: string | null;
  createdAt: number;
}


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
  candidatesGenerated: number;
  skippedByThrottle: number;
  skippedByHeuristics: number;
  skippedByLock: number;
  skippedByState?: number;
  duplicatesFiltered: number;
  sanitizedDrops: number;
  fallbackResponses: number;
  prunedByReranker: number;
  cacheSizeGlobalBytes: number;
  cacheSizeActiveBytes: number;
  activeContentId: string | null;
  windowCommentTotal?: number;
  dynamicBanTermsApplied?: number;
  keywordEvaluations?: number;
  filteredKeywordDrops?: number;
  toneRepetitionWarnings?: number;
  personaHotwordReminders?: number;
  duplicateHardRejects?: number;
  semanticRejects?: number;
  lowRelevanceDrops?: number;
  styleFitDrops?: number;
  stateSoftSkips?: number;
  stateForcedEmissions?: number;
  energyState?: EnergyState;
  stateOccupancy?: Partial<Record<EnergyState, number>>;
  lengthMean?: number;
  lengthStdDev?: number;
  lengthDeviation?: number;
  lengthSampleSize?: number;
  lengthRollingMean?: number;
  lengthRollingStdDev?: number;
  speechTicBans?: number;
  speechTicViolations?: number;
  dynamicBanReleases?: number;
  toneAlignmentHits?: number;
  toneAlignmentMisses?: number;
  fewShotSelections?: number;
  fewShotCooldownSkips?: number;
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
