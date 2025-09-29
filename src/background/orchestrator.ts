import { cacheStore, type CachedCommentRecord } from './cache-store';
import { llmClient, type ChatMessage } from './llm-client';
import {
  getActivePersonaVariant,
  getActivePersonas,
  subscribePersonaVariant,
  type EnergyState,
  type PersonaDefinition,
  type PersonaLengthProfile,
  type PersonaVirtualUserMeta,
  type PersonaWeightPackage,
  type PersonaFewShotExample,
  type ToneAdjustment
} from './personas';
import { analyzeScene, type SceneAnalysis, type SceneTone } from './scene-analyzer';
import { logger } from '../shared/logger';
import { formatGuidelineList, formatSubtitleWindow } from '../shared/messages';
import type {
  SubtitleCue,
  UserPreferences,
  GeneratedComment,
  PlaybackStatus,
  OrchestratorMetrics,
  OrchestratorResult
} from '../shared/types';

const DENSITY_INTERVALS: Record<UserPreferences['density'], number> = {
  low: 25000,
  medium: 15000,
  high: 8000
};

const MAX_CUE_WINDOW = 3;
const MAX_RECENT_OUTPUTS = 5;
const WINDOW_MS = 8000;
const MAX_COMMENTS_PER_WINDOW = 3;
const MAX_MEMORY_TOPICS = 5;
const MAX_MEMORY_HISTORY = 5;
const MAX_SCENE_TONE_HISTORY = 12;
const MAX_KEYWORD_HISTORY = 40;
const MAX_DYNAMIC_BAN_HISTORY = 5;
const DYNAMIC_BAN_THRESHOLD = 3;
const GLOBAL_KEYWORD_THRESHOLD = 3;
const MAX_DYNAMIC_BAN_TERMS = 3;
const MAX_COMMENT_CHARACTERS = 90;
const MAX_PERSONA_LENGTH_HISTORY = 30;
const MAX_GLOBAL_LENGTH_HISTORY = 120;
const STATE_HISTORY_WINDOW_MS = 120_000;
const COOLDOWN_PERSIST_MS = 20_000;
const FORCED_EMISSION_FACTOR = 1.5;
const DYNAMIC_BAN_TTL_MS = 600_000;
const MAX_TOTAL_DYNAMIC_BANS = 12;
const SPEECH_TIC_WINDOW_MS = 180_000;
const SPEECH_TIC_THRESHOLD = 2;
const FEW_SHOT_TARGET = 4;
const FEW_SHOT_COOLDOWN_MS = 180_000;
const FEW_SHOT_SHAPE_HISTORY = 6;

const ENERGY_STATES: EnergyState[] = ['calm', 'active', 'peak', 'cooldown'];

const DEFAULT_LENGTH_PROFILE: PersonaLengthProfile = {
  mean: 12,
  stdDev: 3,
  min: 6,
  max: 18
};

const DEFAULT_STATE_CADENCE_SECONDS: Record<EnergyState, number> = {
  calm: 24,
  active: 16,
  peak: 8,
  cooldown: 18
};

const DEFAULT_WEIGHT_MULTIPLIERS: Record<EnergyState, PersonaWeightPackage> = {
  calm: {
    length: 1.1,
    novelty: 0.9,
    recency: 0.65,
    energy: 0.75,
    tone: 0.9,
    relevance: 1,
    style: 1
  },
  active: {
    length: 1,
    novelty: 1,
    recency: 1,
    energy: 1,
    tone: 1,
    relevance: 1,
    style: 1
  },
  peak: {
    length: 0.85,
    novelty: 1.2,
    recency: 1.3,
    energy: 1.2,
    tone: 1.05,
    relevance: 1,
    style: 0.95
  },
  cooldown: {
    length: 1.05,
    novelty: 0.95,
    recency: 0.75,
    energy: 0.85,
    tone: 0.9,
    relevance: 1,
    style: 1.05
  }
};

const DEFAULT_SKIP_BIAS: Record<EnergyState, number> = {
  calm: 0.6,
  active: 0.2,
  peak: 0.1,
  cooldown: 0.45
};

const PROMPT_STOP_WORDS = new Set([
  'the',
  'and',
  'you',
  'for',
  'but',
  'that',
  'with',
  'this',
  'have',
  'what',
  'your',
  'from',
  'they',
  'there',
  'will',
  'were',
  'just',
  'about',
  'like',
  'into',
  'when',
  'them',
  'then',
  'than',
  'over',
  'really',
  'gonna'
]);

const DENSITY_TEMPLATES: readonly ((density: UserPreferences['density']) => string)[] = [
  (density) => `Density is ${density}; only speak up when you can add a fresh beat.`,
  (density) => `We're pacing for ${density} chatter—skip the obvious takes.`,
  (density) => `Keep reactions lean; the crowd setting is ${density}, so only jump in with something new.`
];

const KEYWORD_TEMPLATES: readonly ((keywords: string) => string)[] = [
  (keywords) => `Focus on these cues: ${keywords}.`,
  (keywords) => `Anchor your take around ${keywords}; make the detail feel new.`,
  (keywords) => `The scene is signaling ${keywords}—pick a facet we have not echoed.`
];

const KEYWORD_FALLBACK_TEMPLATES: readonly string[] = [
  'No standout cue? Grab a sensory detail—lighting, posture, props, or pacing.',
  'If keywords blur, spotlight body language, sound design, or background business.',
  'When cues repeat, switch to micro-observations: textures, timing, or reactions off-screen.'
];

const SKIP_TEMPLATES: readonly string[] = [
  'If nothing new comes to mind, answer with [skip].',
  'No fresh angle? Respond with [skip] instead of forcing it.',
  'Only speak when you have something distinct—otherwise reply with [skip].'
];

const CASUAL_REPLACEMENTS: ReadonlyArray<{ pattern: RegExp; replacement: string }> = [
  { pattern: /\bhowever\b/gi, replacement: 'but' },
  { pattern: /\btherefore\b/gi, replacement: 'so' },
  { pattern: /\bfurthermore\b/gi, replacement: 'also' },
  { pattern: /\bmoreover\b/gi, replacement: 'also' },
  { pattern: /\bthus\b/gi, replacement: 'so' },
  { pattern: /\bindeed\b/gi, replacement: 'honestly' },
  { pattern: /\bperhaps\b/gi, replacement: 'maybe' },
  { pattern: /\breally\b/gi, replacement: 'super' },
  { pattern: /\bvery\b/gi, replacement: 'super' },
  { pattern: /\babsolutely\b/gi, replacement: 'totally' }
];

const FILLER_WORDS = new Set([
  'really',
  'very',
  'just',
  'like',
  'actually',
  'literally',
  'basically',
  'definitely',
  'totally',
  'maybe',
  'probably',
  'honestly',
  'seriously',
  'kinda',
  'sorta',
  'pretty',
  'quite'
]);

const NGRAM_SIZE = 4;
const NGRAM_WINDOW_MS = 90_000;
const SEMANTIC_WINDOW_MS = 300_000;
const SEMANTIC_DUPLICATE_THRESHOLD = 0.9;
const MIN_RELEVANCE_SCORE = 0.2;
const MIN_STYLE_FIT_SCORE = 0.5;

const TONE_DESCRIPTOR_MAP: Record<SceneTone, string[]> = {
  calm: [
    'The moment feels steady and grounded—spot a detail that keeps it human.',
    'Atmosphere is relaxed and breathable—find a small but telling observation.'
  ],
  tense: [
    'The air is tight with tension—surface something sharper than last time.',
    'Everything is on edge—dig into what raises the stakes right now.',
    'Tension is coiled—focus on a fresh signal (voice, posture, stakes).' 
  ],
  humorous: [
    'Comedy energy is bubbling—lean into wit without repeating the punch line.',
    'The beat stays playful—angle for a different joke or comparison.'
  ],
  sad: [
    'The mood sinks heavy—pull a new emotional thread instead of rehashing.',
    'Emotion is raw—anchor your take in a fresh, specific detail.'
  ],
  romantic: [
    'The moment is soft and intimate—highlight a new spark or gesture.',
    'Romance glows here—choose a different image than your last reaction.'
  ],
  confused: [
    'The vibe feels uncertain—frame a question or hypothesis we have not heard.',
    'Curiosity clouds the scene—probe a fresh clue instead of repeating doubts.'
  ],
  thrilling: [
    'Adrenaline is surging—describe a vivid beat that shows the momentum.',
    'This feels like a chase—pick a sensory detail that keeps it exciting.'
  ],
  bittersweet: [
    'The mood is bittersweet—balance the lift and ache with new wording.',
    'Tender but aching—spot a nuance that keeps it from sounding recycled.'
  ],
  mystery: [
    'The beat is draped in mystery—surface a clue or hunch we have not voiced.',
    'Suspicion hangs here—point to a fresh lead or unanswered question.'
  ]
};

const INTENSITY_GUIDANCE: Record<'low' | 'medium' | 'high', string> = {
  low: 'Keep it nuanced; highlight a precise detail instead of the broad headline.',
  medium: 'Find a new angle or implication so your take adds fresh value.',
  high: 'Go vivid—use new imagery or stakes instead of repeating earlier adjectives.'
};

interface PersonaRuntimeState {
  lastEmittedAt: number;
}

interface PersonaMemory {
  topics: string[];
  lastText: string | null;
  lastAt: number;
  history: Array<{ text: string; at: number; keywords: string[] }>;
}

interface DynamicBanEntry {
  token: string;
  source: 'keyword' | 'speech_tic' | 'global';
  createdAt: number;
  expiresAt: number;
  hits: number;
}

interface MetricsAccumulator {
  cacheHits: number;
  cacheMisses: number;
  llmCalls: number;
  llmLatencyMsTotal: number;
  generationLatencyMsTotal: number;
  generatedCount: number;
  candidateCount: number;
  skippedByThrottle: number;
  skippedByHeuristics: number;
  skippedByLock: number;
  skippedByState: number;
  duplicatesFiltered: number;
  sanitizedDrops: number;
  fallbackResponses: number;
  prunedByReranker: number;
  dynamicBanTermsApplied: number;
  keywordEvaluations: number;
  filteredKeywordDrops: number;
  toneRepetitionWarnings: number;
  personaHotwordReminders: number;
  duplicateHardRejects: number;
  semanticRejects: number;
  lowRelevanceDrops: number;
  styleFitDrops: number;
  stateSoftSkips: number;
  stateForcedEmissions: number;
  stateCounts: Record<EnergyState, number>;
  currentEnergyState: EnergyState;
  lengthObservationCount: number;
  totalWordCount: number;
  totalWordCountSquared: number;
  targetWordCountSum: number;
  speechTicBans: number;
  speechTicViolations: number;
  dynamicBanReleases: number;
  toneAlignmentHits: number;
  toneAlignmentMisses: number;
  fewShotSelections: number;
  fewShotCooldownSkips: number;
}

interface CandidateEntry {
  persona: PersonaDefinition;
  comment: GeneratedComment;
  source: "cache" | "llm";
  cacheKey: string;
  keywords: string[];
  sceneTone: SceneAnalysis['tone'];
  sceneToneIntensity: SceneAnalysis['toneIntensity'];
  sceneEnergy: SceneAnalysis['energy'];
  basePersonaId: string;
  preferenceKey: string;
  toneVariant?: string;
  weight: number;
  virtualUser?: PersonaVirtualUserMeta;
  usedFallback?: boolean;
  promptHash?: string;
  score: number;
  relevance: number;
  styleFit: number;
  finalize: (comment: GeneratedComment) => Promise<void>;
}

export class Orchestrator {
  #personas: PersonaDefinition[] = [];
  #personaIndex = new Map<string, PersonaDefinition>();
  #personaState = new Map<string, PersonaRuntimeState>();
  #cueWindow: SubtitleCue[] = [];
  #activeContentId: string | null = null;
  #recentOutputs = new Map<string, string[]>();
  #recentGlobalOutputs: string[] = [];
  #recentNGramIndex = new Map<string, number[]>();
  #recentSemanticHistory: Array<{ timestamp: number; tokens: string[] }> = [];
  #recentCommentLog: Array<{ timestamp: number; personaId: string }> = [];
  #personaLocks = new Map<string, boolean>();
  #lastCueRespondedId = new Map<string, string>();
  #personaMemory = new Map<string, PersonaMemory>();
  #recentToneHistory: string[] = [];
  #sceneToneHistory: SceneAnalysis['tone'][] = [];
  #recentKeywordHistory: string[] = [];
  #personaLengthHistory = new Map<string, number[]>();
  #globalLengthHistory: number[] = [];
  #currentEnergyState: EnergyState = 'calm';
  #stateChangedAt = 0;
  #energyStateHistory: Array<{ state: EnergyState; timestamp: number }> = [];
  #personaDynamicBans = new Map<string, Map<string, DynamicBanEntry>>();
  #globalDynamicBans = new Map<string, DynamicBanEntry>();
  #speechTicUsage = new Map<string, Array<{ token: string; timestamp: number }>>();
  #fewShotCooldowns = new Map<string, Map<string, number>>();
  #fewShotShapeHistory = new Map<string, string[]>();
  #lifecycleCounters = {
    speechTicBans: 0,
    dynamicBanReleases: 0
  };
  #playbackStatus: PlaybackStatus = {
    state: 'paused',
    positionMs: 0,
    contentId: null,
    updatedAt: 0
  };
  #lastPlaybackPositionMs: number | null = null;
  #promptVersion = '';
  #memoryDebug = false;

  constructor() {
    const variant = getActivePersonaVariant();
    this.#promptVersion = variant.promptVersion;
    this.#applyPersonaVariant();

    subscribePersonaVariant((nextVariant) => {
      this.#promptVersion = nextVariant.promptVersion;
      this.#applyPersonaVariant();
    });
  }

  #computeLengthScore(
    wordCount: number,
    persona: PersonaDefinition,
    state: EnergyState,
    toneAdjustment?: ToneAdjustment
  ) {
    const profile = this.#getLengthProfile(persona);
    const targetMean = profile.mean + (toneAdjustment?.lengthShift ?? 0);
    const effectiveMean = Math.max(profile.min, Math.min(profile.max, targetMean));
    const normalizedDelta = Math.abs(wordCount - effectiveMean) / Math.max(1, profile.stdDev);
    const deviationPenalty = normalizedDelta * 0.35;
    let baseScore = Math.max(0, 1 - deviationPenalty);

    if (wordCount < profile.min) {
      const deficit = (profile.min - wordCount) / Math.max(1, profile.min);
      baseScore *= Math.max(0.35, 1 - deficit * 0.6);
    } else if (wordCount > profile.max) {
      const overflow = (wordCount - profile.max) / Math.max(1, profile.max);
      baseScore *= Math.max(0.35, 1 - overflow * 0.7);
    }

    baseScore *= this.#lengthStateBias(state, wordCount, profile, toneAdjustment);
    return Math.max(0, Math.min(1, baseScore));
  }

  #lengthStateBias(
    state: EnergyState,
    wordCount: number,
    profile: PersonaLengthProfile,
    toneAdjustment?: ToneAdjustment
  ) {
    const targetMean = profile.mean + (toneAdjustment?.lengthShift ?? 0);
    const clampedMean = Math.max(profile.min, Math.min(profile.max, targetMean));
    const aboveMean = wordCount > clampedMean;
    const delta = Math.abs(wordCount - clampedMean) / Math.max(1, profile.stdDev);
    let bias = 1;

    switch (state) {
      case 'calm':
        bias = aboveMean ? 0.85 - Math.min(delta * 0.1, 0.25) : 1.05 + Math.min(delta * 0.08, 0.2);
        break;
      case 'active':
        bias = 1;
        break;
      case 'peak':
        bias = aboveMean ? 1.1 + Math.min(delta * 0.1, 0.25) : 0.9 - Math.min(delta * 0.05, 0.2);
        break;
      case 'cooldown':
        bias = aboveMean ? 0.9 - Math.min(delta * 0.05, 0.15) : 1.05 + Math.min(delta * 0.05, 0.15);
        break;
      default:
        bias = 1;
        break;
    }

    return Math.max(0.6, Math.min(1.3, bias));
  }

  #getLengthProfile(persona: PersonaDefinition): PersonaLengthProfile {
    if (persona.lengthProfile) {
      return persona.lengthProfile;
    }
    const fallbackMax = persona.maxWords;
    const mean = Math.min(fallbackMax - 2, Math.max(6, Math.round(fallbackMax * 0.65)));
    const stdDev = Math.max(2, Math.round(fallbackMax * 0.2));
    const min = Math.max(4, mean - stdDev);
    const max = fallbackMax;
    return { mean, stdDev, min, max };
  }

  #getWeightMultipliers(persona: PersonaDefinition, state: EnergyState): PersonaWeightPackage {
    const pack = persona.stateWeightMultipliers?.[state] ?? DEFAULT_WEIGHT_MULTIPLIERS[state];
    return pack ? { ...pack } : {};
  }

  #getSkipBias(persona: PersonaDefinition, state: EnergyState) {
    const bias = persona.skipBias?.[state];
    if (typeof bias === 'number' && Number.isFinite(bias)) {
      return Math.max(0, Math.min(1, bias));
    }
    return DEFAULT_SKIP_BIAS[state] ?? 0;
  }

  #getStateCadenceMs(persona: PersonaDefinition, state: EnergyState) {
    const seconds = persona.stateCadenceSeconds?.[state] ?? DEFAULT_STATE_CADENCE_SECONDS[state];
    const ms = Math.max(2, seconds ?? DEFAULT_STATE_CADENCE_SECONDS.active) * 1000;
    return Math.max(2000, Math.round(ms));
  }

  #evaluatePersonaEmission(
    persona: PersonaDefinition,
    state: EnergyState,
    now: number,
    preferences: UserPreferences
  ) {
    const runtime = this.#personaState.get(persona.id);
    const lastAt = runtime?.lastEmittedAt ?? 0;
    const sinceLast = lastAt === 0 ? Number.MAX_SAFE_INTEGER : now - lastAt;
    const defaultCadenceMs = persona.cadenceSeconds * 1000;
    const stateCadenceMs = this.#getStateCadenceMs(persona, state);
    const densityMs = DENSITY_INTERVALS[preferences.density];
    const minInterval = Math.max(defaultCadenceMs, stateCadenceMs, densityMs);
    const dueForEmission = sinceLast >= minInterval * FORCED_EMISSION_FACTOR;
    const allowEmission = lastAt === 0 || sinceLast >= minInterval || dueForEmission;
    return { allowEmission, dueForEmission, minInterval, sinceLast };
  }

  #noteLengthObservation(candidate: CandidateEntry, metrics: MetricsAccumulator) {
    const words = candidate.comment.text.split(/\s+/).filter(Boolean).length;
    metrics.lengthObservationCount += 1;
    metrics.totalWordCount += words;
    metrics.totalWordCountSquared += words * words;
    const profile = this.#getLengthProfile(candidate.persona);
    metrics.targetWordCountSum += profile.mean;
  }

  #updateEnergyState(scene: SceneAnalysis, timestamp: number) {
    const densityPerSecond = this.#recentCommentLog.length / Math.max(1, WINDOW_MS / 1000);
    const densityScore = Math.min(densityPerSecond / 0.35, 1);
    const sceneEnergyScore = scene.energy === 'high' ? 1 : scene.energy === 'medium' ? 0.6 : 0.25;
    const toneScore = Math.min(this.#getToneStreak(scene.tone) / 4, 1);
    const composite = sceneEnergyScore * 0.55 + densityScore * 0.3 + toneScore * 0.15;

    let nextState: EnergyState;
    if (composite >= 0.82) {
      nextState = 'peak';
    } else if (composite >= 0.58) {
      nextState = 'active';
    } else {
      nextState = 'calm';
    }

    if (this.#currentEnergyState === 'peak' && nextState === 'active') {
      if (timestamp - this.#stateChangedAt <= COOLDOWN_PERSIST_MS) {
        nextState = 'cooldown';
      }
    }

    if (this.#currentEnergyState === 'peak' && nextState === 'calm') {
      nextState = 'cooldown';
    }

    if (this.#currentEnergyState === 'cooldown') {
      if (composite >= 0.65) {
        nextState = 'active';
      } else if (timestamp - this.#stateChangedAt > COOLDOWN_PERSIST_MS && composite < 0.5) {
        nextState = 'calm';
      } else {
        nextState = 'cooldown';
      }
    }

    if (this.#currentEnergyState !== nextState) {
      this.#currentEnergyState = nextState;
      this.#stateChangedAt = timestamp;
      this.#energyStateHistory.push({ state: this.#currentEnergyState, timestamp });
    } else if (this.#energyStateHistory.length === 0) {
      this.#energyStateHistory.push({ state: this.#currentEnergyState, timestamp });
    }

    this.#trimEnergyStateHistory(timestamp);
  }

  #trimEnergyStateHistory(timestamp: number) {
    while (
      this.#energyStateHistory.length > 1 &&
      timestamp - this.#energyStateHistory[0].timestamp > STATE_HISTORY_WINDOW_MS
    ) {
      this.#energyStateHistory.shift();
    }

    const first = this.#energyStateHistory[0];
    if (first && timestamp - first.timestamp > STATE_HISTORY_WINDOW_MS) {
      first.timestamp = timestamp - STATE_HISTORY_WINDOW_MS;
    }
  }

  #summarizeStateOccupancy() {
    const now = Date.now();
    this.#trimEnergyStateHistory(now);
    const durations: Record<EnergyState, number> = {
      calm: 0,
      active: 0,
      peak: 0,
      cooldown: 0
    };

    if (this.#energyStateHistory.length === 0) {
      return durations;
    }

    for (let index = 0; index < this.#energyStateHistory.length; index += 1) {
      const current = this.#energyStateHistory[index];
      const nextTimestamp =
        index < this.#energyStateHistory.length - 1
          ? this.#energyStateHistory[index + 1].timestamp
          : now;
      const span = Math.max(1, nextTimestamp - current.timestamp);
      durations[current.state] += span;
    }

    const total = ENERGY_STATES.reduce((sum, state) => sum + durations[state], 0);
    if (total === 0) {
      return durations;
    }

    const occupancy: Record<EnergyState, number> = {
      calm: 0,
      active: 0,
      peak: 0,
      cooldown: 0
    };

    ENERGY_STATES.forEach((state) => {
      occupancy[state] = durations[state] / total;
    });
    return occupancy;
  }

  #computeRollingLengthStats() {
    if (this.#globalLengthHistory.length === 0) {
      return { mean: 0, stdDev: 0 };
    }
    const total = this.#globalLengthHistory.reduce((sum, value) => sum + value, 0);
    const mean = total / this.#globalLengthHistory.length;
    const variance = this.#globalLengthHistory.reduce((sum, value) => {
      const diff = value - mean;
      return sum + diff * diff;
    }, 0) / this.#globalLengthHistory.length;
    return { mean, stdDev: Math.sqrt(variance) };
  }

  #applyPersonaVariant() {
    this.#personas = getActivePersonas();
    this.#personaIndex = new Map();
    this.#personaState = new Map();
    this.#recentOutputs = new Map();
    this.#personaLocks = new Map();
    this.#personaMemory = new Map();
    this.#lastCueRespondedId = new Map();
    this.#recentToneHistory = [];
    this.#sceneToneHistory = [];
    this.#recentKeywordHistory = [];
    this.#personaDynamicBans = new Map();
    this.#globalDynamicBans = new Map();
    this.#speechTicUsage = new Map();
    this.#fewShotCooldowns = new Map();
    this.#fewShotShapeHistory = new Map();

    this.#personas.forEach((persona) => {
      const preferenceKey = persona.preferenceKey ?? persona.basePersonaId ?? persona.id;
      persona.preferenceKey = preferenceKey;
      persona.basePersonaId = persona.basePersonaId ?? preferenceKey;
      persona.weight = persona.weight ?? 1;
      if (!persona.virtualUser) {
        persona.virtualUser = {
          id: persona.id,
          label: persona.name,
          description: persona.systemPrompt,
          traits: persona.toneVariants ?? [],
          toneVariant: persona.toneVariants?.[0],
          preferenceKey,
          basePersonaId: persona.basePersonaId,
          weight: persona.weight
        } satisfies PersonaVirtualUserMeta;
      }
      this.#personaIndex.set(persona.id, persona);
      this.#personaState.set(persona.id, { lastEmittedAt: 0 });
      this.#recentOutputs.set(persona.id, []);
      this.#personaLocks.set(persona.id, false);
      this.#personaMemory.set(persona.id, {
        topics: [],
        lastText: null,
        lastAt: 0,
        history: []
      });
      this.#personaDynamicBans.set(persona.id, new Map());
      this.#speechTicUsage.set(persona.id, []);
      this.#fewShotCooldowns.set(persona.id, new Map());
      this.#fewShotShapeHistory.set(persona.id, []);
    });

    const maxGlobal = Math.max(1, MAX_RECENT_OUTPUTS * this.#personas.length);
    if (this.#recentGlobalOutputs.length > maxGlobal) {
      this.#recentGlobalOutputs = this.#recentGlobalOutputs.slice(
        this.#recentGlobalOutputs.length - maxGlobal
      );
    }

    this.#resetPersonaMemory({ resetCadence: true });
  }

  updatePlaybackStatus(status: PlaybackStatus) {
    const previousPosition = this.#lastPlaybackPositionMs;

    this.#playbackStatus = status;

    if (status.contentId && status.contentId !== this.#activeContentId) {
      this.#activeContentId = status.contentId;
      this.#cueWindow = [];
      this.#resetPersonaMemory({ resetCadence: true });
      this.#sceneToneHistory = [];
      this.#recentKeywordHistory = [];
    }

    if (status.state !== 'playing') {
      this.#personaLocks.forEach((_locked, personaId) => {
        this.#personaLocks.set(personaId, false);
      });
    }

    if (
      typeof previousPosition === 'number' &&
      status.positionMs < previousPosition - 500
    ) {
      this.#cueWindow = [];
      this.#resetPersonaMemory({ resetCadence: true });
      this.#sceneToneHistory = [];
      this.#recentKeywordHistory = [];
    }

    if (status.state === 'seeking') {
      this.#resetPersonaMemory({ resetCadence: true });
      this.#sceneToneHistory = [];
      this.#recentKeywordHistory = [];
    }

    this.#lastPlaybackPositionMs = status.positionMs;
  }

  async processCueBatch(
    cues: SubtitleCue[],
    preferences: UserPreferences
  ): Promise<OrchestratorResult> {
    this.#memoryDebug = Boolean(preferences.developerMode);
    if (!preferences.globalEnabled) {
      logger.debug('[orchestrator] Global toggle disabled; ignoring cues.');
      return { comments: [], metrics: this.#emptyMetrics() };
    }

    const latestCue = cues[cues.length - 1];
    if (!latestCue) {
      return { comments: [], metrics: this.#emptyMetrics() };
    }

    if (this.#playbackStatus.state !== 'playing' && this.#playbackStatus.updatedAt !== 0) {
      logger.debug('[orchestrator] Playback inactive; skipping generation.', {
        state: this.#playbackStatus.state
      });
      return { comments: [], metrics: this.#emptyMetrics() };
    }

    this.#syncCueWindow(cues);

    const scene = analyzeScene(this.#cueWindow);
    this.#noteSceneKeywords(scene.keywords);
    this.#recordSceneTone(scene);
    this.#updateEnergyState(scene, Date.now());
    const metrics = this.#createMetricsAccumulator();
    metrics.currentEnergyState = this.#currentEnergyState;
    metrics.stateCounts[this.#currentEnergyState] += 1;

    if (!scene.shouldRespond) {
      metrics.skippedByHeuristics += 1;
      return this.#finalizeReturn([], metrics, preferences);
    }

    const windowSnapshot = this.#getWindowStats(latestCue.startTime);
    const existingTotal = windowSnapshot.total;
    const existingPerPersona = windowSnapshot.perPersona;
    const existingPerBasePersona = windowSnapshot.perBasePersona;
    const slotBudget = Math.max(0, MAX_COMMENTS_PER_WINDOW - existingTotal);

    if (slotBudget <= 0) {
      metrics.skippedByHeuristics += 1;
      return this.#finalizeReturn([], metrics, preferences);
    }

    const candidatePool: CandidateEntry[] = [];
    const personaSchedule = this.#buildPersonaSchedule(scene, latestCue.startTime);

    for (const persona of personaSchedule) {
      const preferenceKey = persona.preferenceKey ?? persona.basePersonaId ?? persona.id;
      if (!preferences.personaEnabled[preferenceKey]) {
        continue;
      }

      metrics.stateCounts[this.#currentEnergyState] += 1;

      const baseKey = persona.basePersonaId ?? preferenceKey;
      const basePersonaId = baseKey;
      const toneVariant = persona.virtualUser?.toneVariant ?? persona.toneVariants?.[0];
      const weight = persona.weight ?? 1;

      if ((existingPerPersona.get(persona.id) ?? 0) >= 1) {
        metrics.skippedByHeuristics += 1;
        continue;
      }

      if ((existingPerBasePersona.get(baseKey) ?? 0) >= 1) {
        metrics.skippedByHeuristics += 1;
        continue;
      }

      if (this.#personaLocks.get(persona.id)) {
        metrics.skippedByLock += 1;
        logger.debug('[orchestrator] Persona locked, skipping', { persona: persona.id });
        continue;
      }

      if (this.#shouldSkipCue(persona, latestCue, preferences, scene)) {
        metrics.skippedByHeuristics += 1;
        logger.debug('[orchestrator] Cue skipped by heuristics', {
          persona: persona.id,
          cueId: latestCue.cueId
        });
        continue;
      }

      const personaTimestamp = Date.now();
      const emissionGate = this.#evaluatePersonaEmission(
        persona,
        this.#currentEnergyState,
        personaTimestamp,
        preferences
      );

      if (!emissionGate.allowEmission) {
        metrics.skippedByThrottle += 1;
        metrics.skippedByState += 1;
        logger.debug('[orchestrator] Persona gated by state cadence', {
          persona: persona.id,
          state: this.#currentEnergyState
        });
        continue;
      }

      let forcedEmission = emissionGate.dueForEmission;
      if (!forcedEmission) {
        const skipBias = this.#getSkipBias(persona, this.#currentEnergyState);
        if (skipBias > 0) {
          const skipRoll = this.#seededRandom(`${persona.id}:${latestCue.cueId}:state-skip`);
          if (skipRoll < skipBias) {
            metrics.skippedByState += 1;
            metrics.stateSoftSkips += 1;
            logger.debug('[orchestrator] Persona skipped by state bias', {
              persona: persona.id,
              state: this.#currentEnergyState,
              skipBias
            });
            continue;
          }
        }
      } else {
        metrics.stateForcedEmissions += 1;
      }

      const personaStart = personaTimestamp;

      const cacheKey = this.#buildCacheKey(latestCue.cueId, persona.id);
      const cached = await cacheStore.get(cacheKey);

      if (cached && this.#isCacheCompatible(cached, scene)) {
        logger.debug('[orchestrator] Cache candidate ready', { cacheKey });
        const reuseCreatedAt = Date.now();
        const reused: GeneratedComment = {
          ...cached,
          id: cacheKey,
          personaId: persona.id,
          text: cached.text,
          createdAt: reuseCreatedAt,
          renderAt: latestCue.startTime + 500,
          durationMs: this.#computeDurationMs(cached.text)
        };

        const assessment = this.#evaluateCandidateText({
          persona,
          text: reused.text,
          scene,
          timestamp: reuseCreatedAt,
          metrics
        });
        if (!assessment.accepted) {
          continue;
        }

        candidatePool.push({
          persona,
          comment: reused,
          source: 'cache',
          cacheKey,
          keywords: scene.keywords,
          sceneTone: scene.tone,
          sceneToneIntensity: scene.toneIntensity,
          sceneEnergy: scene.energy,
          basePersonaId,
          preferenceKey,
          toneVariant,
          weight,
          virtualUser: persona.virtualUser,
          score: 0,
          relevance: assessment.relevance,
          styleFit: assessment.styleFit,
          promptHash: cached.promptHash,
          finalize: async (finalComment) => {
            this.#registerComment(finalComment, latestCue.cueId, scene.keywords);
            await cacheStore.set({
              ...finalComment,
              cacheKey,
              contentId: latestCue.contentId,
              personaId: persona.id,
              cueId: latestCue.cueId,
              promptHash: cached.promptHash,
              promptVersion: this.#promptVersion,
              sceneTone: scene.tone,
              sceneToneIntensity: scene.toneIntensity,
              sceneToneConfidence: scene.toneConfidence,
              sceneEnergy: scene.energy
            });
          }
        });
        metrics.candidateCount += 1;
        metrics.generationLatencyMsTotal += Date.now() - personaStart;
        continue;
      }

      let candidate: CandidateEntry | null = null;
      let usedFallback = false;

      this.#personaLocks.set(persona.id, true);
      try {
        const { messages, telemetry } = this.#buildMessages({ persona, preferences, scene });
        metrics.dynamicBanTermsApplied += telemetry.dynamicBanCount;
        metrics.dynamicBanReleases += telemetry.dynamicBanReleased;
        if (telemetry.dynamicBanReleased > 0) {
          this.#lifecycleCounters.dynamicBanReleases = Math.max(
            0,
            this.#lifecycleCounters.dynamicBanReleases - telemetry.dynamicBanReleased
          );
        }
        metrics.keywordEvaluations += telemetry.evaluatedKeywordCount;
        metrics.filteredKeywordDrops += telemetry.filteredKeywordCount;
        if (telemetry.toneRepetitionWarning) {
          metrics.toneRepetitionWarnings += 1;
        }
        if (telemetry.personaHotwordReminder) {
          metrics.personaHotwordReminders += 1;
        }
        if (telemetry.fewShotSelected > 0) {
          metrics.fewShotSelections += telemetry.fewShotSelected;
        }
        if (telemetry.fewShotCooldownSkips > 0) {
          metrics.fewShotCooldownSkips += telemetry.fewShotCooldownSkips;
        }
        const temperature = this.#jitterValue(
          persona.temperature,
          0.12,
          0.4,
          1.1,
          `${persona.id}:${latestCue.cueId}:temp`
        );
        const topP = this.#jitterValue(
          persona.topP,
          0.08,
          0.6,
          0.99,
          `${persona.id}:${latestCue.cueId}:topP`
        );
        const llmStart = Date.now();
        const response = await llmClient.complete({
          personaId: persona.id,
          messages,
          maxTokens: Math.max(64, persona.maxWords * 2),
          temperature,
          topP
        });
        const llmLatency = Date.now() - llmStart;
        metrics.llmCalls += 1;
        metrics.llmLatencyMsTotal += llmLatency;
        usedFallback = Boolean(response.usingFallback);

        const sanitized = this.#sanitizeResponse(response.text, persona);
        if (!sanitized) {
          metrics.sanitizedDrops += 1;
          logger.warn('[orchestrator] Sanitized response empty, skipping', { persona: persona.id });
          continue;
        }

        const processed = this.#applyPostProcessing(sanitized, persona, scene, latestCue.cueId);
        const evaluationTimestamp = Date.now();
        const assessment = this.#evaluateCandidateText({
          persona,
          text: processed,
          scene,
          timestamp: evaluationTimestamp,
          metrics
        });
        if (!assessment.accepted) {
          continue;
        }

        const createdAt = evaluationTimestamp;
        const comment: GeneratedComment = {
          id: cacheKey,
          personaId: persona.id,
          text: processed,
          createdAt,
          renderAt: latestCue.startTime + 500,
          durationMs: this.#computeDurationMs(processed)
        };

        const promptHash = this.#hash(JSON.stringify(messages));
        candidate = {
          persona,
          comment,
          source: 'llm',
          cacheKey,
          keywords: scene.keywords,
          sceneTone: scene.tone,
          sceneToneIntensity: scene.toneIntensity,
          sceneEnergy: scene.energy,
          basePersonaId,
          preferenceKey,
          toneVariant,
          weight,
          virtualUser: persona.virtualUser,
          usedFallback,
          promptHash,
          score: 0,
          relevance: assessment.relevance,
          styleFit: assessment.styleFit,
          finalize: async (finalComment) => {
            this.#registerComment(finalComment, latestCue.cueId, scene.keywords);
            await cacheStore.set({
              ...finalComment,
              cacheKey,
              contentId: latestCue.contentId,
              personaId: persona.id,
              cueId: latestCue.cueId,
              promptHash,
              promptVersion: this.#promptVersion,
              sceneTone: scene.tone,
              sceneToneIntensity: scene.toneIntensity,
              sceneToneConfidence: scene.toneConfidence,
              sceneEnergy: scene.energy
            });
          }
        };
      } finally {
        this.#personaLocks.set(persona.id, false);
      }

      if (candidate) {
        candidatePool.push(candidate);
        metrics.candidateCount += 1;
        metrics.generationLatencyMsTotal += Date.now() - personaStart;
        if (usedFallback) {
          metrics.fallbackResponses += 1;
        }
      }
    }

    if (candidatePool.length === 0) {
      return this.#finalizeReturn([], metrics, preferences);
    }

    const selectedCandidates = this.#selectCandidates(
      candidatePool,
      slotBudget,
      existingPerPersona,
      existingPerBasePersona,
      metrics,
      scene,
      latestCue.startTime
    );

    if (selectedCandidates.length === 0) {
      return this.#finalizeReturn([], metrics, preferences);
    }

    const results: GeneratedComment[] = [];
    let selectionIndex = 0;

    for (const candidate of selectedCandidates) {
      const finalized: GeneratedComment = {
        ...candidate.comment,
        renderAt: this.#computeRenderTimestamp(
          latestCue.startTime,
          selectionIndex,
          scene,
          candidate.persona.id
        ),
        durationMs: this.#computeDurationMs(candidate.comment.text)
      };

      await candidate.finalize(finalized);

      if (candidate.source === 'cache') {
        metrics.cacheHits += 1;
      } else {
        metrics.cacheMisses += 1;
      }

      metrics.generatedCount += 1;
      results.push(finalized);
      this.#noteLengthObservation(candidate, metrics);
      selectionIndex += 1;
    }

    return this.#finalizeReturn(results, metrics, preferences);
  }

  #buildCacheKey(cueId: string, personaId: string) {
    return `${cueId}::${personaId}`;
  }

  #resetPersonaMemory({ resetCadence = false }: { resetCadence?: boolean } = {}) {
    this.#recentOutputs.forEach((_outputs, personaId) => {
      this.#recentOutputs.set(personaId, []);
    });
    this.#personaMemory.forEach((_memory, personaId) => {
      this.#personaMemory.set(personaId, {
        topics: [],
        lastText: null,
        lastAt: 0,
        history: []
      });
    });
    this.#personaLocks.forEach((_locked, personaId) => {
      this.#personaLocks.set(personaId, false);
    });
    this.#lastCueRespondedId.clear();
    this.#recentGlobalOutputs = [];
    this.#recentCommentLog = [];
    this.#recentToneHistory = [];
    this.#recentNGramIndex.clear();
    this.#recentSemanticHistory = [];
    this.#personaLengthHistory.clear();
    this.#globalLengthHistory = [];
    this.#energyStateHistory = [];
    this.#currentEnergyState = 'calm';
    this.#stateChangedAt = Date.now();
    this.#personaDynamicBans.forEach((ledger) => ledger.clear());
    this.#globalDynamicBans.clear();
    this.#speechTicUsage.forEach((usage) => usage.splice(0, usage.length));
    this.#fewShotCooldowns.forEach((cooldowns) => cooldowns.clear());
    this.#fewShotShapeHistory.forEach((shapes) => shapes.splice(0, shapes.length));
    this.#lifecycleCounters.speechTicBans = 0;
    this.#lifecycleCounters.dynamicBanReleases = 0;
    if (resetCadence) {
      this.#personaState.forEach((state, personaId) => {
        this.#personaState.set(personaId, { ...state, lastEmittedAt: 0 });
      });
    }
    this.#logMemoryEvent('reset', {
      resetCadence,
      personaCount: this.#personas.length,
      activeContentId: this.#activeContentId
    });
  }

  #logMemoryEvent(
    event: 'register' | 'remember' | 'reset',
    details: Record<string, unknown>
  ) {
    if (!this.#memoryDebug) {
      return;
    }
    logger.debug('[orchestrator] memory:' + event, {
      ...details,
      timestamp: Date.now()
    });
  }

  #createMetricsAccumulator(): MetricsAccumulator {
    const accumulator: MetricsAccumulator = {
      cacheHits: 0,
      cacheMisses: 0,
      llmCalls: 0,
      llmLatencyMsTotal: 0,
      generationLatencyMsTotal: 0,
      generatedCount: 0,
      candidateCount: 0,
      skippedByThrottle: 0,
      skippedByHeuristics: 0,
      skippedByLock: 0,
      skippedByState: 0,
      duplicatesFiltered: 0,
      sanitizedDrops: 0,
      fallbackResponses: 0,
      prunedByReranker: 0,
      dynamicBanTermsApplied: 0,
      keywordEvaluations: 0,
      filteredKeywordDrops: 0,
      toneRepetitionWarnings: 0,
      personaHotwordReminders: 0,
      duplicateHardRejects: 0,
      semanticRejects: 0,
      lowRelevanceDrops: 0,
      styleFitDrops: 0,
      stateSoftSkips: 0,
      stateForcedEmissions: 0,
      stateCounts: {
        calm: 0,
        active: 0,
        peak: 0,
        cooldown: 0
      },
      currentEnergyState: this.#currentEnergyState,
      lengthObservationCount: 0,
      totalWordCount: 0,
      totalWordCountSquared: 0,
      targetWordCountSum: 0,
      speechTicBans: this.#lifecycleCounters.speechTicBans,
      speechTicViolations: 0,
      dynamicBanReleases: this.#lifecycleCounters.dynamicBanReleases,
      toneAlignmentHits: 0,
      toneAlignmentMisses: 0,
      fewShotSelections: 0,
      fewShotCooldownSkips: 0
    };
    this.#lifecycleCounters.speechTicBans = 0;
    this.#lifecycleCounters.dynamicBanReleases = 0;
    return accumulator;
  }

  #finalizeMetrics(acc: MetricsAccumulator): OrchestratorMetrics {
    acc.currentEnergyState = this.#currentEnergyState;
    const lengthObservationCount = acc.lengthObservationCount;
    const batchMean =
      lengthObservationCount > 0 ? acc.totalWordCount / lengthObservationCount : 0;
    const batchVariance =
      lengthObservationCount > 0
        ? Math.max(
            0,
            acc.totalWordCountSquared / lengthObservationCount - batchMean * batchMean
          )
        : 0;
    const batchStdDev = Math.sqrt(batchVariance);
    const targetMean =
      lengthObservationCount > 0 ? acc.targetWordCountSum / lengthObservationCount : 0;
    const lengthDeviation = batchMean - targetMean;
    const rollingStats = this.#computeRollingLengthStats();
    const stateOccupancy = this.#summarizeStateOccupancy();

    return {
      timestamp: Date.now(),
      cacheHits: acc.cacheHits,
      cacheMisses: acc.cacheMisses,
      llmCalls: acc.llmCalls,
      averageLLMLatencyMs: acc.llmCalls > 0 ? acc.llmLatencyMsTotal / acc.llmCalls : 0,
      averageGenerationLatencyMs:
        acc.candidateCount > 0 ? acc.generationLatencyMsTotal / acc.candidateCount : 0,
      skippedByThrottle: acc.skippedByThrottle,
      skippedByHeuristics: acc.skippedByHeuristics,
      skippedByLock: acc.skippedByLock,
      skippedByState: acc.skippedByState,
      duplicatesFiltered: acc.duplicatesFiltered,
      sanitizedDrops: acc.sanitizedDrops,
      fallbackResponses: acc.fallbackResponses,
      candidatesGenerated: acc.candidateCount,
      prunedByReranker: acc.prunedByReranker,
      cacheSizeGlobalBytes: 0,
      cacheSizeActiveBytes: 0,
      activeContentId: this.#activeContentId,
      windowCommentTotal: this.#recentCommentLog.length,
      dynamicBanTermsApplied: acc.dynamicBanTermsApplied,
      keywordEvaluations: acc.keywordEvaluations,
      filteredKeywordDrops: acc.filteredKeywordDrops,
      toneRepetitionWarnings: acc.toneRepetitionWarnings,
      personaHotwordReminders: acc.personaHotwordReminders,
      duplicateHardRejects: acc.duplicateHardRejects,
      semanticRejects: acc.semanticRejects,
      lowRelevanceDrops: acc.lowRelevanceDrops,
      styleFitDrops: acc.styleFitDrops,
      stateSoftSkips: acc.stateSoftSkips,
      stateForcedEmissions: acc.stateForcedEmissions,
      energyState: acc.currentEnergyState,
      stateOccupancy,
      lengthMean: batchMean,
      lengthStdDev: batchStdDev,
      lengthDeviation,
      lengthSampleSize: lengthObservationCount,
      lengthRollingMean: rollingStats.mean,
      lengthRollingStdDev: rollingStats.stdDev,
      speechTicBans: acc.speechTicBans,
      speechTicViolations: acc.speechTicViolations,
      dynamicBanReleases: acc.dynamicBanReleases,
      toneAlignmentHits: acc.toneAlignmentHits,
      toneAlignmentMisses: acc.toneAlignmentMisses,
      fewShotSelections: acc.fewShotSelections,
      fewShotCooldownSkips: acc.fewShotCooldownSkips
    };
  }

  #emptyMetrics() {
    return this.#finalizeMetrics(this.#createMetricsAccumulator());
  }

  async #finalizeReturn(
    comments: GeneratedComment[],
    metrics: MetricsAccumulator,
    preferences: UserPreferences
  ): Promise<OrchestratorResult> {
    const metricsResult = this.#finalizeMetrics(metrics);
    if (preferences.developerMode) {
      try {
        const report = await cacheStore.sizeReport();
        metricsResult.cacheSizeGlobalBytes = report.global;
        metricsResult.cacheSizeActiveBytes = this.#activeContentId
          ? report.contents[this.#activeContentId] ?? 0
          : 0;
      } catch (error) {
        logger.warn('[orchestrator] Failed to gather cache metrics', error);
      }
      logger.debug('[orchestrator] Metrics snapshot', metricsResult);
    }

    return { comments, metrics: metricsResult };
  }

  #shouldSkipCue(
    persona: PersonaDefinition,
    cue: SubtitleCue,
    preferences: UserPreferences,
    scene: SceneAnalysis
  ) {
    const text = cue.text.trim();
    if (!text) {
      return true;
    }

    if (!/[a-zA-Z]/.test(text)) {
      return true;
    }

    const lastCueId = this.#lastCueRespondedId.get(persona.id);
    if (lastCueId === cue.cueId && this.#playbackStatus.state === 'playing') {
      return true;
    }

    const energy = scene.energy;
    if (preferences.density === 'low') {
      const interesting = /[!?]/.test(text) || text.length >= 18 || scene.hasQuestion;
      if (!interesting || energy === 'low') {
        return true;
      }
    } else if (preferences.density === 'medium' && energy === 'low') {
      if (text.length < 10 && !/[!?]/.test(text)) {
        return true;
      }
    }

    const memory = this.#personaMemory.get(persona.id);
    if (memory && Date.now() - memory.lastAt < 5000) {
      const overlap = scene.keywords.filter((keyword) => memory.topics.includes(keyword));
      if (overlap.length >= Math.min(2, scene.keywords.length)) {
        return true;
      }
    }

    return false;
  }

  #syncCueWindow(cues: SubtitleCue[]) {
    const latest = cues[cues.length - 1];
    if (!latest) {
      return;
    }
    if (this.#activeContentId !== latest.contentId) {
      this.#activeContentId = latest.contentId;
      this.#cueWindow = [];
      this.#resetPersonaMemory({ resetCadence: true });
    }

    for (const cue of cues) {
      if (!this.#cueWindow.some((existing) => existing.cueId === cue.cueId)) {
        this.#cueWindow.push(cue);
      }
    }

    if (this.#cueWindow.length > MAX_CUE_WINDOW) {
      this.#cueWindow = this.#cueWindow.slice(this.#cueWindow.length - MAX_CUE_WINDOW);
    }
  }

  #trimRecentCommentLog(anchor: number) {
    this.#recentCommentLog = this.#recentCommentLog.filter(
      (entry) => anchor - entry.timestamp <= WINDOW_MS
    );
  }

  #getWindowStats(anchor: number) {
    this.#trimRecentCommentLog(anchor);
    const perPersona = new Map<string, number>();
    const perBasePersona = new Map<string, number>();
    for (const entry of this.#recentCommentLog) {
      perPersona.set(entry.personaId, (perPersona.get(entry.personaId) ?? 0) + 1);
      const persona = this.#personaIndex.get(entry.personaId);
      const baseKey = persona?.basePersonaId ?? persona?.preferenceKey ?? entry.personaId;
      if (baseKey) {
        perBasePersona.set(baseKey, (perBasePersona.get(baseKey) ?? 0) + 1);
      }
    }
    return { total: this.#recentCommentLog.length, perPersona, perBasePersona };
  }

  #registerComment(comment: GeneratedComment, cueId: string, keywords: string[]) {
    this.#recentCommentLog.push({ timestamp: comment.renderAt, personaId: comment.personaId });
    this.#trimRecentCommentLog(comment.renderAt);
    this.#rememberOutput(comment.personaId, comment.text, keywords);
    this.#lastCueRespondedId.set(comment.personaId, cueId);
    this.#updatePersonaState(comment.personaId);
    this.#logMemoryEvent('register', {
      personaId: comment.personaId,
      cueId,
      text: comment.text,
      keywords
    });
  }

  #selectCandidates(
    pool: CandidateEntry[],
    slotBudget: number,
    existingPerPersona: Map<string, number>,
    existingPerBasePersona: Map<string, number>,
    metrics: MetricsAccumulator,
    scene: SceneAnalysis,
    anchorTime: number
  ) {
    if (slotBudget <= 0) {
      return [];
    }

    const energyState = this.#currentEnergyState;
    pool.forEach((candidate) => {
      candidate.score = this.#scoreCandidate(candidate, scene, anchorTime, energyState);
    });

    const sorted = [...pool].sort((a, b) => b.score - a.score);
    const selectedCounts = new Map(existingPerPersona);
    const selectedBaseCounts = new Map(existingPerBasePersona);
    const selected: CandidateEntry[] = [];
    let pruned = 0;

    for (const candidate of sorted) {
      if (selected.length >= slotBudget) {
        pruned += 1;
        continue;
      }
      const current = selectedCounts.get(candidate.persona.id) ?? 0;
      if (current >= 1) {
        pruned += 1;
        continue;
      }
      const baseCurrent = selectedBaseCounts.get(candidate.basePersonaId) ?? 0;
      if (baseCurrent >= 1) {
        pruned += 1;
        continue;
      }
      selected.push(candidate);
      selectedCounts.set(candidate.persona.id, current + 1);
      selectedBaseCounts.set(candidate.basePersonaId, baseCurrent + 1);
    }

    metrics.prunedByReranker += pruned;
    return selected;
  }

  #evaluateCandidateText({
    persona,
    text,
    scene,
    timestamp,
    metrics
  }: {
    persona: PersonaDefinition;
    text: string;
    scene: SceneAnalysis;
    timestamp: number;
    metrics: MetricsAccumulator;
  }): { accepted: boolean; relevance: number; styleFit: number } {
    const duplication = this.#detectDuplicationSignals(text, timestamp);
    if (duplication.hardDuplicate) {
      metrics.duplicatesFiltered += 1;
      metrics.duplicateHardRejects += 1;
      return { accepted: false, relevance: 0, styleFit: 0 };
    }
    if (duplication.semanticDuplicate) {
      metrics.duplicatesFiltered += 1;
      metrics.semanticRejects += 1;
      return { accepted: false, relevance: 0, styleFit: 0 };
    }

    const relevance = this.#computeRelevanceScore(text, scene);
    if (relevance < MIN_RELEVANCE_SCORE) {
      metrics.lowRelevanceDrops += 1;
      return { accepted: false, relevance, styleFit: 0 };
    }

    let styleFit = this.#computeStyleFitScore(text, persona);
    const banHit = this.#detectActiveBanHit(persona.id, text);
    if (banHit) {
      if (banHit.source === 'speech_tic') {
        metrics.speechTicViolations += 1;
        styleFit = Math.min(styleFit, 0.2);
      } else {
        styleFit = Math.min(styleFit, 0.35);
      }
    }

    const toneAlignment = this.#computeToneAlignment(text, persona, scene, metrics);
    styleFit *= toneAlignment.multiplier;
    styleFit = Math.max(0, Math.min(1, styleFit));

    if (styleFit < MIN_STYLE_FIT_SCORE) {
      metrics.styleFitDrops += 1;
      return { accepted: false, relevance, styleFit };
    }

    return { accepted: true, relevance, styleFit };
  }

  #scoreCandidate(
    candidate: CandidateEntry,
    scene: SceneAnalysis,
    anchorTime: number,
    state: EnergyState
  ) {
    const wordCount = candidate.comment.text.split(/\s+/).filter(Boolean).length;
    const toneAdjustment = this.#getToneAdjustmentForTone(candidate.persona, candidate.sceneTone);
    const lengthScore = this.#computeLengthScore(
      wordCount,
      candidate.persona,
      state,
      toneAdjustment
    );
    const noveltyScore = this.#keywordNoveltyScore(candidate.persona.id, candidate.keywords);
    const runtime = this.#personaState.get(candidate.persona.id);
    const cadenceMs = candidate.persona.cadenceSeconds * 1000;
    const timeSinceLast = runtime ? Date.now() - runtime.lastEmittedAt : Number.MAX_SAFE_INTEGER;
    const recencyScore = Math.min(timeSinceLast / Math.max(1, cadenceMs), 1);
    const energyBias = this.#personaEnergyBias(candidate.persona, candidate.sceneEnergy);
    const toneScore = this.#toneNoveltyScore(candidate.toneVariant);
    const weightBias = this.#weightBias(candidate.weight);
    const sourceBias = candidate.source === 'llm' ? 0.05 : 0;
    const jitter = this.#seededRandom(
      `${candidate.persona.id}:${anchorTime}:${candidate.comment.text}`
    );

    const relevanceScore = candidate.relevance;
    const styleFitScore = candidate.styleFit;
    const weights = this.#getWeightMultipliers(candidate.persona, state);
    const lengthWeight = 0.18 * (weights.length ?? 1);
    const noveltyWeight = 0.18 * (weights.novelty ?? 1);
    const recencyWeight = 0.14 * (weights.recency ?? 1);
    const energyWeight = 0.12 * (weights.energy ?? 1);
    const toneWeight = 0.12 * (weights.tone ?? 1);
    const relevanceWeight = 0.16 * (weights.relevance ?? 1);
    const styleWeight = 0.1 * (weights.style ?? 1) * (toneAdjustment?.styleBias ?? 1);

    return (
      lengthScore * lengthWeight +
      noveltyScore * noveltyWeight +
      recencyScore * recencyWeight +
      energyBias * energyWeight +
      toneScore * toneWeight +
      relevanceScore * relevanceWeight +
      styleFitScore * styleWeight +
      weightBias * 0.04 +
      sourceBias +
      jitter * 0.06
    );
  }

  #buildPersonaSchedule(scene: SceneAnalysis, anchorTime: number) {
    const entries = this.#personas.map((persona) => {
      const runtime = this.#personaState.get(persona.id);
      const cadenceMs = persona.cadenceSeconds * 1000;
      const timeSinceLast = runtime ? Date.now() - runtime.lastEmittedAt : Number.MAX_SAFE_INTEGER;
      const recencyScore = Math.min(timeSinceLast / Math.max(1, cadenceMs), 1);
      const energyBias = this.#personaEnergyBias(persona, scene.energy);
      const jitter = this.#seededRandom(`${anchorTime}:${persona.id}`);
      const weightBias = this.#weightBias(persona.weight ?? 1);
      const score = recencyScore * 0.45 + energyBias * 0.25 + weightBias * 0.2 + jitter * 0.1;
      return { persona, score };
    });

    entries.sort((a, b) => b.score - a.score);
    return entries.map((entry) => entry.persona);
  }

  #personaEnergyBias(persona: PersonaDefinition, energy: SceneAnalysis['energy']) {
    const tones = persona.toneVariants ?? [];
    const has = (tone: string) => tones.includes(tone);

    if (energy === 'high') {
      if (has('snark') || has('hype')) {
        return 1;
      }
      if (has('precise')) {
        return 0.85;
      }
      return 0.7;
    }

    if (energy === 'medium') {
      if (has('precise') || has('warm')) {
        return 0.9;
      }
      return 0.75;
    }

    if (has('warm') || has('wistful')) {
      return 1;
    }
    if (has('precise')) {
      return 0.8;
    }
    return 0.6;
  }

  #keywordNoveltyScore(personaId: string, keywords: string[]) {
    if (keywords.length === 0) {
      return 0.5;
    }
    const memory = this.#personaMemory.get(personaId);
    if (!memory) {
      return 1;
    }
    const seen = new Set(memory.topics.map((topic) => topic.toLowerCase()));
    const unique = keywords
      .map((keyword) => keyword.toLowerCase())
      .filter((keyword) => !seen.has(keyword));
    return unique.length / keywords.length;
  }

  #toneNoveltyScore(toneVariant?: string) {
    if (!toneVariant) {
      return 0.6;
    }
    if (this.#recentToneHistory.length === 0) {
      return 1;
    }
    const lastIndex = this.#recentToneHistory.lastIndexOf(toneVariant);
    if (lastIndex === -1) {
      return 1;
    }
    const distance = this.#recentToneHistory.length - lastIndex;
    const normalized = Math.min(distance / 4, 1);
    return 0.4 + normalized * 0.6;
  }

  #weightBias(weight: number) {
    const clamped = Math.max(0.3, Math.min(weight, 2));
    return clamped / 2;
  }

  #getToneAdjustmentForTone(persona: PersonaDefinition, tone: SceneAnalysis['tone']) {
    return persona.toneAdjustments?.[tone];
  }

  #computeToneAlignment(
    text: string,
    persona: PersonaDefinition,
    scene: SceneAnalysis,
    metrics: MetricsAccumulator
  ) {
    const adjustment = this.#getToneAdjustmentForTone(persona, scene.tone);
    if (!adjustment) {
      metrics.toneAlignmentHits += 1;
      return { multiplier: 1, alignment: 1, styleBias: 1 };
    }
    const lower = text.toLowerCase();
    let alignmentScore = 1;
    let multiplier = 1;
    if (adjustment.preferLexical && adjustment.preferLexical.length > 0) {
      const hasPreferred = adjustment.preferLexical.some((lex) =>
        lower.includes(lex.toLowerCase())
      );
      if (!hasPreferred) {
        alignmentScore -= 0.2;
        multiplier *= 0.9;
      }
    }
    if (adjustment.avoidLexical && adjustment.avoidLexical.length > 0) {
      const triggered = adjustment.avoidLexical.some((lex) =>
        lower.includes(lex.toLowerCase())
      );
      if (triggered) {
        alignmentScore -= 0.4;
        multiplier *= 0.6;
      }
    }
    if (adjustment.punctuation && adjustment.punctuation !== 'none') {
      const trimmed = text.trim();
      const ending = trimmed.charAt(trimmed.length - 1);
      let matches = false;
      if (adjustment.punctuation === 'exclaim') {
        matches = ending === '!';
      } else if (adjustment.punctuation === 'question') {
        matches = ending === '?';
      } else if (adjustment.punctuation === 'ellipsis') {
        matches = /\.\.\.$/.test(trimmed);
      } else if (adjustment.punctuation === 'period') {
        matches = ending === '.';
      }
      if (!matches) {
        alignmentScore -= 0.2;
        multiplier *= 0.9;
      }
    }
    alignmentScore = Math.max(0, Math.min(1, alignmentScore));
    if (alignmentScore >= 0.75) {
      metrics.toneAlignmentHits += 1;
    } else {
      metrics.toneAlignmentMisses += 1;
    }
    return {
      multiplier,
      alignment: alignmentScore,
      styleBias: adjustment.styleBias ?? 1
    };
  }

  #computeRenderTimestamp(
    baseTime: number,
    rank: number,
    scene: SceneAnalysis,
    personaId: string
  ) {
    const energyBase = scene.energy === 'high' ? 350 : scene.energy === 'medium' ? 550 : 800;
    const jitter = Math.floor(this.#seededRandom(`${personaId}:${baseTime}:${rank}`) * 400);
    const stagger = rank * 260;
    return baseTime + energyBase + jitter + stagger;
  }

  #computeDurationMs(text: string) {
    const words = text.split(/\s+/).filter(Boolean).length;
    const base = 5200;
    const perWord = 220;
    const duration = base + (words - 10) * perWord;
    return Math.max(4000, Math.min(9000, duration));
  }

  #applyPostProcessing(
    text: string,
    persona: PersonaDefinition,
    scene: SceneAnalysis,
    cueId: string
  ) {
    let output = text.replace(/\s+/g, ' ').trim();

    if (persona.speechTics && persona.speechTics.length > 0) {
      const ticChance = this.#seededRandom(`${persona.id}:${cueId}:tic`);
      if (ticChance > 0.68) {
        const pick = Math.floor(
          this.#seededRandom(`${cueId}:${persona.id}:pick`) * persona.speechTics.length
        );
        const tic = persona.speechTics[pick % persona.speechTics.length]?.trim();
        if (tic) {
          output = ticChance > 0.84 ? `${output}, ${tic}` : `${tic} ${output}`;
        }
      }
    }

    if (!/[.!?…]$/.test(output)) {
      const punctuationRoll = this.#seededRandom(`${persona.id}:${cueId}:punct`);
      if (scene.energy === 'high' && punctuationRoll > 0.35) {
        output = `${output}!`;
      } else if (punctuationRoll > 0.7) {
        output = `${output}...`;
      } else {
        output = `${output}.`;
      }
    }

    if (this.#seededRandom(`${persona.id}:${cueId}:trim`) > 0.85) {
      output = output.replace(/[.]+$/, '');
    }

    output = this.#casualizeText(output);

    output = output.replace(/\s+/g, ' ').trim();

    const words = output.split(/\s+/).filter(Boolean);
    if (words.length > persona.maxWords) {
      const compressed = this.#shrinkToWordLimit(words, persona.maxWords);
      if (!compressed) {
        return '';
      }
      output = compressed.trim();
    }

    if (output.length > MAX_COMMENT_CHARACTERS) {
      const sizeConstrained = this.#shrinkToCharacterLimit(output.split(/\s+/).filter(Boolean), MAX_COMMENT_CHARACTERS);
      if (!sizeConstrained) {
        return '';
      }
      output = sizeConstrained.trim();
    }

    return output;
  }

  #isCacheCompatible(record: CachedCommentRecord, scene: SceneAnalysis) {
    if (!record) {
      return false;
    }
    if (!record.promptVersion || record.promptVersion !== this.#promptVersion) {
      return false;
    }
    if (!record.sceneTone || record.sceneTone !== scene.tone) {
      return false;
    }
    if (
      record.sceneToneIntensity &&
      record.sceneToneIntensity !== scene.toneIntensity
    ) {
      return false;
    }
    if (!record.sceneEnergy || record.sceneEnergy !== scene.energy) {
      return false;
    }
    return true;
  }

  #seededRandom(seed: string) {
    let hash = 0;
    for (let index = 0; index < seed.length; index += 1) {
      hash = Math.imul(31, hash) + seed.charCodeAt(index);
    }
    const x = Math.sin(hash) * 10000;
    return x - Math.floor(x);
  }

  #noteSceneKeywords(keywords: string[]) {
    if (!keywords || keywords.length === 0) {
      return;
    }
    keywords.forEach((keyword) => {
      const normalized = keyword.toLowerCase();
      if (!normalized || PROMPT_STOP_WORDS.has(normalized)) {
        return;
      }
      this.#recentKeywordHistory.push(normalized);
    });
    while (this.#recentKeywordHistory.length > MAX_KEYWORD_HISTORY) {
      this.#recentKeywordHistory.shift();
    }
    this.#updateGlobalKeywordBans(Date.now());
  }

  #collectGlobalKeywordBans() {
    return this.#getActiveGlobalDynamicBans();
  }

  #recordSceneTone(scene: SceneAnalysis) {
    this.#sceneToneHistory.push(scene.tone);
    while (this.#sceneToneHistory.length > MAX_SCENE_TONE_HISTORY) {
      this.#sceneToneHistory.shift();
    }
  }

  #getToneStreak(tone: SceneAnalysis['tone']) {
    let streak = 0;
    for (let index = this.#sceneToneHistory.length - 1; index >= 0; index -= 1) {
      if (this.#sceneToneHistory[index] === tone) {
        streak += 1;
      } else {
        break;
      }
    }
    return streak;
  }

  #tokenizeForBans(text: string) {
    if (!text) {
      return [] as string[];
    }
    const matches = text
      .toLowerCase()
      .match(/[a-z0-9']+/g);
    if (!matches) {
      return [];
    }
    return matches.filter((token) => token.length > 3 && !PROMPT_STOP_WORDS.has(token));
  }

  #updateDynamicBanState(personaId: string, text: string, keywords: string[]) {
    const now = Date.now();
    this.#trackSpeechTicUsage(personaId, text, now);
    this.#refreshKeywordBanLedger(personaId, now);
  }

  #trackSpeechTicUsage(personaId: string, text: string, timestamp: number) {
    const persona = this.#personaIndex.get(personaId);
    if (!persona || !persona.speechTics || persona.speechTics.length === 0) {
      return;
    }
    const usage = this.#speechTicUsage.get(personaId) ?? [];
    const lower = text.toLowerCase();
    persona.speechTics.forEach((tic) => {
      const normalized = tic.toLowerCase().trim();
      if (!normalized) {
        return;
      }
      const pattern = new RegExp(`\\b${this.#escapeRegExp(normalized)}\\b`, 'i');
      if (pattern.test(lower)) {
        usage.push({ token: normalized, timestamp });
      }
    });
    const pruned = usage.filter((entry) => timestamp - entry.timestamp <= SPEECH_TIC_WINDOW_MS);
    this.#speechTicUsage.set(personaId, pruned);
    const counts = new Map<string, number>();
    pruned.forEach((entry) => {
      counts.set(entry.token, (counts.get(entry.token) ?? 0) + 1);
    });
    counts.forEach((total, token) => {
      if (total > SPEECH_TIC_THRESHOLD) {
        const added = this.#ensurePersonaDynamicBan(personaId, token, 'speech_tic', timestamp);
        if (added) {
          this.#lifecycleCounters.speechTicBans += 1;
        }
      }
    });
  }

  #refreshKeywordBanLedger(personaId: string, now: number) {
    const memory = this.#personaMemory.get(personaId);
    if (!memory) {
      return;
    }
    const history = memory.history.slice(-MAX_DYNAMIC_BAN_HISTORY);
    if (history.length === 0) {
      return;
    }
    const counts = new Map<string, number>();
    history.forEach((entry) => {
      const tokens = this.#tokenizeForBans(entry.text ?? '');
      tokens.forEach((token) => {
        counts.set(token, (counts.get(token) ?? 0) + 1);
      });
      for (let index = 0; index < tokens.length - 1; index += 1) {
        const first = tokens[index];
        const second = tokens[index + 1];
        if (!first || !second) {
          continue;
        }
        const phrase = `${first} ${second}`;
        counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
      }
      (entry.keywords ?? []).forEach((keyword) => {
        const normalized = keyword.toLowerCase();
        if (!normalized || normalized.length <= 3 || PROMPT_STOP_WORDS.has(normalized)) {
          return;
        }
        counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
      });
    });

    counts.forEach((total, token) => {
      if (total >= DYNAMIC_BAN_THRESHOLD) {
        this.#ensurePersonaDynamicBan(personaId, token, 'keyword', now);
      }
    });
  }

  #ensurePersonaDynamicBan(
    personaId: string,
    token: string,
    source: 'keyword' | 'speech_tic',
    now: number
  ) {
    const ledger = this.#personaDynamicBans.get(personaId);
    if (!ledger) {
      return false;
    }
    const normalized = token.toLowerCase();
    const existing = ledger.get(normalized);
    if (existing && existing.expiresAt > now) {
      existing.expiresAt = now + DYNAMIC_BAN_TTL_MS;
      existing.hits += 1;
      return false;
    }
    const entry: DynamicBanEntry = {
      token: normalized,
      source,
      createdAt: now,
      expiresAt: now + DYNAMIC_BAN_TTL_MS,
      hits: existing ? existing.hits + 1 : 1
    };
    ledger.set(normalized, entry);
    this.#enforcePersonaDynamicBanCap(personaId, ledger);
    return !existing;
  }

  #enforcePersonaDynamicBanCap(
    personaId: string,
    ledger: Map<string, DynamicBanEntry>
  ) {
    while (ledger.size > MAX_DYNAMIC_BAN_TERMS) {
      const oldest = Array.from(ledger.entries()).sort(
        (a, b) => a[1].createdAt - b[1].createdAt
      )[0];
      if (!oldest) {
        break;
      }
      ledger.delete(oldest[0]);
      this.#lifecycleCounters.dynamicBanReleases += 1;
    }
    this.#pruneDynamicBans(personaId);
  }

  #pruneDynamicBans(personaId: string) {
    const ledger = this.#personaDynamicBans.get(personaId);
    if (!ledger || ledger.size === 0) {
      return;
    }
    const now = Date.now();
    Array.from(ledger.entries()).forEach(([token, entry]) => {
      if (entry.expiresAt <= now) {
        ledger.delete(token);
      }
    });
  }

  #ensureGlobalDynamicBan(token: string, now: number) {
    const normalized = token.toLowerCase();
    const existing = this.#globalDynamicBans.get(normalized);
    if (existing && existing.expiresAt > now) {
      existing.expiresAt = now + DYNAMIC_BAN_TTL_MS;
      existing.hits += 1;
      return;
    }
    this.#globalDynamicBans.set(normalized, {
      token: normalized,
      source: 'global',
      createdAt: now,
      expiresAt: now + DYNAMIC_BAN_TTL_MS,
      hits: existing ? existing.hits + 1 : 1
    });
    this.#enforceGlobalDynamicBanCap();
  }

  #enforceGlobalDynamicBanCap() {
    while (this.#globalDynamicBans.size > MAX_TOTAL_DYNAMIC_BANS) {
      const oldest = Array.from(this.#globalDynamicBans.entries()).sort(
        (a, b) => a[1].createdAt - b[1].createdAt
      )[0];
      if (!oldest) {
        break;
      }
      this.#globalDynamicBans.delete(oldest[0]);
      this.#lifecycleCounters.dynamicBanReleases += 1;
    }
    this.#pruneGlobalDynamicBans();
  }

  #pruneGlobalDynamicBans(now: number = Date.now()) {
    if (this.#globalDynamicBans.size === 0) {
      return;
    }
    Array.from(this.#globalDynamicBans.entries()).forEach(([token, entry]) => {
      if (entry.expiresAt <= now) {
        this.#globalDynamicBans.delete(token);
      }
    });
  }

  #updateGlobalKeywordBans(now: number) {
    if (this.#recentKeywordHistory.length === 0) {
      return;
    }
    const counts = new Map<string, number>();
    this.#recentKeywordHistory.forEach((keyword) => {
      counts.set(keyword, (counts.get(keyword) ?? 0) + 1);
    });
    counts.forEach((total, token) => {
      if (total >= GLOBAL_KEYWORD_THRESHOLD) {
        this.#ensureGlobalDynamicBan(token, now);
      }
    });
    this.#pruneGlobalDynamicBans(now);
  }

  #getActivePersonaDynamicBans(personaId: string) {
    this.#pruneDynamicBans(personaId);
    const ledger = this.#personaDynamicBans.get(personaId);
    if (!ledger) {
      return [] as string[];
    }
    return Array.from(ledger.keys());
  }

  #getActiveGlobalDynamicBans() {
    this.#pruneGlobalDynamicBans();
    return Array.from(this.#globalDynamicBans.keys());
  }

  #getPersonaDynamicBanEntries(personaId: string) {
    this.#pruneDynamicBans(personaId);
    const ledger = this.#personaDynamicBans.get(personaId);
    if (!ledger) {
      return [] as DynamicBanEntry[];
    }
    return Array.from(ledger.values());
  }

  #getActiveSpeechTicBans(personaId: string) {
    return this.#getPersonaDynamicBanEntries(personaId)
      .filter((entry) => entry.source === 'speech_tic')
      .map((entry) => entry.token);
  }

  #releaseOldestDynamicBan(personaId: string) {
    const ledger = this.#personaDynamicBans.get(personaId);
    if (!ledger || ledger.size === 0) {
      return null;
    }
    const oldest = Array.from(ledger.entries()).sort(
      (a, b) => a[1].createdAt - b[1].createdAt
    )[0];
    if (!oldest) {
      return null;
    }
    ledger.delete(oldest[0]);
    this.#lifecycleCounters.dynamicBanReleases += 1;
    return oldest[1].token;
  }

  #releaseOldestGlobalDynamicBan() {
    if (this.#globalDynamicBans.size === 0) {
      return null;
    }
    const oldest = Array.from(this.#globalDynamicBans.entries()).sort(
      (a, b) => a[1].createdAt - b[1].createdAt
    )[0];
    if (!oldest) {
      return null;
    }
    this.#globalDynamicBans.delete(oldest[0]);
    this.#lifecycleCounters.dynamicBanReleases += 1;
    return oldest[1].token;
  }

  #detectActiveBanHit(personaId: string, text: string): DynamicBanEntry | null {
    const normalized = text.toLowerCase();
    const personaLedger = this.#personaDynamicBans.get(personaId);
    if (personaLedger) {
      for (const [token, entry] of personaLedger.entries()) {
        if (normalized.includes(token)) {
          entry.hits += 1;
          return entry;
        }
      }
    }
    for (const [token, entry] of this.#globalDynamicBans.entries()) {
      if (normalized.includes(token)) {
        entry.hits += 1;
        return entry;
      }
    }
    return null;
  }

  #escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  #collectPersonaHotWords(personaId: string) {
    return this.#getActivePersonaDynamicBans(personaId);
  }

  #buildKeywordGuards(personaId: string, keywords: string[]) {
    this.#pruneDynamicBans(personaId);
    this.#pruneGlobalDynamicBans();

    let personaHotWords = this.#getActivePersonaDynamicBans(personaId);
    let globalHotWords = this.#getActiveGlobalDynamicBans();
    let dynamicBanSet = new Set<string>([...personaHotWords, ...globalHotWords]);
    let filteredKeywords = keywords.filter((keyword) => {
      const normalized = keyword.toLowerCase();
      return !dynamicBanSet.has(normalized);
    });
    const releasedTokens: string[] = [];

    if (filteredKeywords.length === 0 && keywords.length > 0 && dynamicBanSet.size > 0) {
      const releasedPersona = this.#releaseOldestDynamicBan(personaId);
      if (releasedPersona) {
        releasedTokens.push(releasedPersona);
      } else {
        const releasedGlobal = this.#releaseOldestGlobalDynamicBan();
        if (releasedGlobal) {
          releasedTokens.push(releasedGlobal);
        }
      }
      personaHotWords = this.#getActivePersonaDynamicBans(personaId);
      globalHotWords = this.#getActiveGlobalDynamicBans();
      dynamicBanSet = new Set<string>([...personaHotWords, ...globalHotWords]);
      filteredKeywords = keywords.filter((keyword) => {
        const normalized = keyword.toLowerCase();
        return !dynamicBanSet.has(normalized);
      });
    }

    if (filteredKeywords.length === 0 && keywords.length > 0) {
      const fallbackKeyword = keywords.find((keyword) => {
        const normalized = keyword.toLowerCase();
        return normalized && !PROMPT_STOP_WORDS.has(normalized);
      });
      if (fallbackKeyword) {
        filteredKeywords.push(fallbackKeyword);
        dynamicBanSet.delete(fallbackKeyword.toLowerCase());
        personaHotWords = this.#getActivePersonaDynamicBans(personaId);
        globalHotWords = this.#getActiveGlobalDynamicBans();
      }
    }

    return {
      filteredKeywords,
      personaHotWords,
      globalHotWords,
      dynamicBans: Array.from(dynamicBanSet),
      releasedTokens
    };
  }

  #selectFewShotExamples(persona: PersonaDefinition, scene: SceneAnalysis) {
    const examples = persona.fewShotExamples ?? [];
    if (examples.length === 0) {
      return { examples: [] as PersonaFewShotExample[], cooled: 0 };
    }
    const now = Date.now();
    const cooldowns = this.#fewShotCooldowns.get(persona.id) ?? new Map<string, number>();
    const shapeHistory = this.#fewShotShapeHistory.get(persona.id) ?? [];
    const scored = examples.map((example) => {
      let score = 0;
      if (example.sceneTag && example.sceneTag === scene.tone) {
        score += 1.5;
      }
      if (example.energy && example.energy === scene.energy) {
        score += 1;
      }
      if (example.tags && example.tags.length > 0) {
        const keywordSet = new Set(scene.keywords.map((keyword) => keyword.toLowerCase()));
        if (example.tags.some((tag) => keywordSet.has(tag.toLowerCase()))) {
          score += 0.4;
        }
      }
      if (example.lexicalShape && shapeHistory.includes(example.lexicalShape.toLowerCase())) {
        score -= 0.35;
      }
      const lastUsed = cooldowns.get(example.id) ?? 0;
      const since = now - lastUsed;
      if (since < FEW_SHOT_COOLDOWN_MS) {
        const penalty = 0.7 * (1 - since / FEW_SHOT_COOLDOWN_MS);
        score -= penalty;
      }
      return {
        example,
        score,
        lastUsed
      };
    });

    scored.sort((a, b) => b.score - a.score);
    const selected: PersonaFewShotExample[] = [];
    const usedShapes = new Set<string>();
    let cooled = 0;

    for (const candidate of scored) {
      if (selected.length >= Math.min(FEW_SHOT_TARGET, examples.length)) {
        break;
      }
      const shape = candidate.example.lexicalShape?.toLowerCase();
      if (shape && usedShapes.has(shape)) {
        cooled += 1;
        continue;
      }
      selected.push(candidate.example);
      if (shape) {
        usedShapes.add(shape);
      }
    }

    selected.forEach((example) => {
      cooldowns.set(example.id, now);
    });
    this.#fewShotCooldowns.set(persona.id, cooldowns);

    const history = this.#fewShotShapeHistory.get(persona.id) ?? [];
    selected.forEach((example) => {
      if (example.lexicalShape) {
        history.push(example.lexicalShape.toLowerCase());
      }
    });
    while (history.length > FEW_SHOT_SHAPE_HISTORY) {
      history.shift();
    }
    this.#fewShotShapeHistory.set(persona.id, history);

    return { examples: selected, cooled };
  }

  #composeToneInstruction(persona: PersonaDefinition, scene: SceneAnalysis) {
    const templates = TONE_DESCRIPTOR_MAP[scene.tone] ?? [
      `The scene leans ${scene.tone}—call out a detail that keeps it fresh.`
    ];
    const cueSeed = this.#cueWindow.map((cue) => cue.cueId).join('|');
    const pickIndex = Math.floor(this.#seededRandom(`${scene.tone}:${cueSeed}`) * templates.length);
    const descriptor = templates[pickIndex % templates.length];
    const intensityNote = INTENSITY_GUIDANCE[scene.toneIntensity];
    const confidenceNote = scene.toneConfidence < 0.5
      ? 'Tone signal feels tentative—anchor the take in concrete observations.'
      : '';
    const energyNote = scene.energy !== 'medium' ? ` Energy: ${scene.energy}.` : '';
    const adjustment = this.#getToneAdjustmentForTone(persona, scene.tone);
    const lexicalCue = adjustment?.preferLexical?.length
      ? ` Lean on expressions like ${adjustment.preferLexical.join(', ')} when natural.`
      : '';
    const avoidCue = adjustment?.avoidLexical?.length
      ? ` Avoid leaning on phrases such as ${adjustment.avoidLexical.join(', ')}.`
      : '';
    const punctuationCue = adjustment?.punctuation && adjustment.punctuation !== 'none'
      ? ` End with ${
          adjustment.punctuation === 'exclaim'
            ? 'an exclamation'
            : adjustment.punctuation === 'question'
            ? 'a question mark'
            : adjustment.punctuation === 'ellipsis'
            ? 'an ellipsis'
            : 'a period'
        } if it fits.`
      : '';
    return `${descriptor} Intensity: ${scene.toneIntensity}. ${intensityNote}${confidenceNote ? ` ${confidenceNote}` : ''}${energyNote}${lexicalCue}${avoidCue}${punctuationCue}`.trim();
  }

  #buildToneRepetitionInstruction(scene: SceneAnalysis) {
    const streak = this.#getToneStreak(scene.tone);
    if (streak <= 1) {
      return null;
    }
    if (streak >= 3) {
      return `We have stayed in this ${scene.tone} pocket for ${streak} beats—ban your previous adjectives and spotlight a different facet (sensory cues, stakes, body language).`;
    }
    return `This ${scene.tone} vibe just repeated—pivot to a new angle or micro-detail instead of echoing earlier wording.`;
  }

  #buildMessages({
    persona,
    preferences,
    scene
  }: {
    persona: PersonaDefinition;
    preferences: UserPreferences;
    scene: SceneAnalysis;
  }): {
    messages: ChatMessage[];
    telemetry: {
      dynamicBanCount: number;
      dynamicBanReleased: number;
      evaluatedKeywordCount: number;
      filteredKeywordCount: number;
      toneRepetitionWarning: boolean;
      personaHotwordReminder: boolean;
      speechTicReminder: boolean;
      fewShotSelected: number;
      fewShotCooldownSkips: number;
    };
  } {
    const now = Date.now();
    const contextLines = formatSubtitleWindow(this.#cueWindow);
    const cueSeed = this.#cueWindow.map((cue) => cue.cueId).join('|') || 'no-cue';

    const guidelines = formatGuidelineList(persona.styleGuidelines);

    const densityTemplate = this.#pickFromList(
      `density:${preferences.density}:${cueSeed}`,
      DENSITY_TEMPLATES
    );
    const densityInstruction = densityTemplate(preferences.density);

    const keywordGuards = this.#buildKeywordGuards(persona.id, scene.keywords);
    const filteredKeywords = keywordGuards.filteredKeywords;
    const dynamicBanList = keywordGuards.dynamicBans;
    const keywordSeed = `keywords:${cueSeed}:${filteredKeywords.join('|')}`;
    const keywordsInstruction = filteredKeywords.length
      ? this.#pickFromList(keywordSeed, KEYWORD_TEMPLATES)(filteredKeywords.join(', '))
      : this.#pickFromList(`keywords:fallback:${cueSeed}`, KEYWORD_FALLBACK_TEMPLATES);
    const speechTicBans = this.#getActiveSpeechTicBans(persona.id);
    const fewShotPlan = this.#selectFewShotExamples(persona, scene);

    const combinedBanSet = new Set<string>();
    const combinedBanList: string[] = [];
    persona.disallowedPhrases.forEach((phrase) => {
      const key = phrase.toLowerCase();
      if (combinedBanSet.has(key)) {
        return;
      }
      combinedBanSet.add(key);
      combinedBanList.push(phrase);
    });
    dynamicBanList.forEach((term) => {
      const key = term.toLowerCase();
      if (combinedBanSet.has(key)) {
        return;
      }
      combinedBanSet.add(key);
      combinedBanList.push(term);
    });

    const reuseGuardInstruction = combinedBanList.length
      ? `尽量避免重复使用这些词: ${combinedBanList.join(', ')}，若必须提及请换个角度或同义表达。`
      : null;
    const speechTicInstruction = speechTicBans.length
      ? `你的口头禅「${speechTicBans.join('、')}」最近出现太多，本轮请不要再使用。`
      : null;

    const toneDescriptor = this.#composeToneInstruction(persona, scene);
    const toneRepetitionInstruction = this.#buildToneRepetitionInstruction(scene);

    const speakerInstruction = scene.speakers.length
      ? `Speakers in focus: ${scene.speakers.join(', ')}.`
      : 'Speaker unknown—react as an engaged viewer.';
    const skipInstruction = this.#pickFromList(
      `skip:${persona.id}:${cueSeed}`,
      SKIP_TEMPLATES
    );

    const memory = this.#personaMemory.get(persona.id);
    const memoryLine = memory?.lastText
      ? `Previously you reacted with "${memory.lastText}" about ${Math.max(1, Math.round((now - memory.lastAt) / 1000))} seconds ago. Refer back only if it deepens your point.`
      : 'You have not reacted recently in this scene.';
    const memoryTopicsLine = memory?.topics?.length
      ? `Topics you touched recently: ${memory.topics.join(', ')}.`
      : '';
    const memoryHistoryLines = memory?.history?.length
      ? memory.history
          .slice(-MAX_MEMORY_HISTORY)
          .map((entry) => {
            const delta = Math.max(1, Math.round((now - entry.at) / 1000));
            return `- ${delta}s ago you said "${entry.text}"`;
          })
          .join('\n')
      : '';
    const memoryFrequencyLine = keywordGuards.personaHotWords.length
      ? `Words you've leaned on lately: ${keywordGuards.personaHotWords.join(', ')}. Switch up your wording this time.`
      : '';

    const virtualUser = persona.virtualUser;
    const personaDescriptor = virtualUser
      ? `You are speaking as ${virtualUser.label}${virtualUser.description ? ` (${virtualUser.description})` : ''}.`
      : `You are speaking as ${persona.name}.`;
    const traitInstruction = virtualUser?.traits?.length
      ? `Traits to convey: ${virtualUser.traits.join(', ')}.`
      : '';
    const toneVariantInstruction = virtualUser?.toneVariant
      ? `Maintain a ${virtualUser.toneVariant} vibe unless the scene demands a softer touch.`
      : '';
    const speechHint = persona.speechTics?.length
      ? `Expressions you sometimes use: ${persona.speechTics.join(', ')}. Drop at most one when it fits naturally.`
      : '';
    const crowdInstruction =
      'You are part of a lively virtual crowd; only jump in when your perspective adds something human and fresh.';
    const personaVoiceInstruction = virtualUser
      ? `Keep the voice consistent with ${virtualUser.label}.`
      : '';

    const systemContent = [
      persona.systemPrompt,
      personaDescriptor,
      traitInstruction,
      toneVariantInstruction,
      speechHint,
      crowdInstruction,
      `Keep it under ${persona.maxWords} words.`,
      'Speak like a human watcher, not a narrator. Use everyday spoken English with natural contractions and occasional slang only when it fits.',
      'Avoid quoting the subtitles verbatim; focus on your reaction or insight.',
      densityInstruction,
      toneDescriptor,
      toneRepetitionInstruction,
      speakerInstruction,
      keywordsInstruction,
      speechTicInstruction,
      reuseGuardInstruction,
      skipInstruction
    ]
      .filter(Boolean)
      .join(' ');

    const sceneSummary = scene.summary || contextLines;
    const memorySection = [
      memoryLine,
      memoryTopicsLine,
      memoryHistoryLines ? `Recent remarks:\n${memoryHistoryLines}` : '',
      memoryFrequencyLine
    ]
      .filter(Boolean)
      .join('\n');

    const userContent = [
      `Scene summary: ${sceneSummary}`,
      `Subtitle window:\n${contextLines}`,
      `Guidelines:\n${guidelines}`,
      memorySection,
      personaVoiceInstruction,
      'Instruction: Respond in one short spoken-style sentence. Keep it natural, as if chatting with friends.'
    ]
      .filter(Boolean)
      .join('\n');

    const messages: ChatMessage[] = [
      { role: 'system', content: systemContent }
    ];

    fewShotPlan.examples.forEach((example) => {
      messages.push({ role: 'user', content: example.user });
      messages.push({ role: 'assistant', content: example.assistant });
    });

    messages.push({ role: 'user', content: userContent });

    return {
      messages,
      telemetry: {
        dynamicBanCount: dynamicBanList.length,
        dynamicBanReleased: keywordGuards.releasedTokens.length,
        evaluatedKeywordCount: scene.keywords.length,
        filteredKeywordCount: scene.keywords.length - filteredKeywords.length,
        toneRepetitionWarning: Boolean(toneRepetitionInstruction),
        personaHotwordReminder: keywordGuards.personaHotWords.length > 0,
        speechTicReminder: speechTicBans.length > 0,
        fewShotSelected: fewShotPlan.examples.length,
        fewShotCooldownSkips: fewShotPlan.cooled
      }
    };
  }

  #casualizeText(text: string) {
    if (!text) {
      return text;
    }
    let output = text;
    CASUAL_REPLACEMENTS.forEach(({ pattern, replacement }) => {
      output = output.replace(pattern, (match) =>
        this.#matchReplacementCase(match, replacement)
      );
    });
    return output;
  }

  #matchReplacementCase(source: string, replacement: string) {
    if (!source) {
      return replacement;
    }
    if (source === source.toUpperCase()) {
      return replacement.toUpperCase();
    }
    if (source[0] === source[0].toUpperCase()) {
      return replacement.charAt(0).toUpperCase() + replacement.slice(1);
    }
    return replacement;
  }

  #detectDuplicationSignals(text: string, timestamp: number) {
    const normalized = text.toLowerCase();
    const exactDuplicate = this.#recentGlobalOutputs.includes(normalized);
    const tokens = this.#tokenizeWords(text);

    let ngramDuplicate = false;
    if (tokens.length >= NGRAM_SIZE) {
      const ngrams = this.#generateNGrams(tokens, NGRAM_SIZE);
      for (const ngram of ngrams) {
        const times = this.#recentNGramIndex.get(ngram);
        if (!times || times.length === 0) {
          continue;
        }
        while (times.length > 0 && timestamp - times[0] > NGRAM_WINDOW_MS) {
          times.shift();
        }
        if (times.length === 0) {
          this.#recentNGramIndex.delete(ngram);
          continue;
        }
        if (timestamp - times[times.length - 1] <= NGRAM_WINDOW_MS) {
          ngramDuplicate = true;
          break;
        }
      }
    }

    let semanticDuplicate = false;
    if (!ngramDuplicate) {
      for (const entry of this.#recentSemanticHistory) {
        if (timestamp - entry.timestamp > SEMANTIC_WINDOW_MS) {
          continue;
        }
        const similarity = this.#jaccardSimilarity(tokens, entry.tokens);
        if (similarity >= SEMANTIC_DUPLICATE_THRESHOLD) {
          semanticDuplicate = true;
          break;
        }
      }
    }

    return {
      hardDuplicate: exactDuplicate || ngramDuplicate,
      semanticDuplicate
    };
  }

  #computeRelevanceScore(text: string, scene: SceneAnalysis) {
    const tokens = this.#tokenizeWords(text);
    if (tokens.length === 0) {
      return 0;
    }
    const tokenSet = new Set(tokens);

    let keywordScore = 0;
    if (scene.keywords.length > 0) {
      const hits = scene.keywords.filter((keyword) => tokenSet.has(keyword.toLowerCase())).length;
      keywordScore = hits / scene.keywords.length;
    }

    let speakerScore = 0;
    if (scene.speakers.length > 0) {
      const lowerText = text.toLowerCase();
      const speakerHits = scene.speakers.filter((speaker) =>
        lowerText.includes(speaker.toLowerCase())
      ).length;
      speakerScore = speakerHits / scene.speakers.length;
    }

    const questionScore = scene.hasQuestion && /\?/u.test(text) ? 1 : 0;
    const exclamationScore = scene.hasExclamation && /!/u.test(text) ? 1 : 0;

    let summaryScore = 0;
    if (scene.summary) {
      const summaryTokens = this.#tokenizeWords(scene.summary);
      if (summaryTokens.length > 0) {
        const summarySet = new Set(summaryTokens);
        let overlap = 0;
        tokens.forEach((token) => {
          if (summarySet.has(token)) {
            overlap += 1;
          }
        });
        summaryScore = Math.min(overlap / Math.max(4, summaryTokens.length), 1);
      }
    }

    const coverageScore = Math.min(tokens.length / 14, 1);

    const composite =
      keywordScore * 0.4 +
      speakerScore * 0.15 +
      questionScore * 0.1 +
      exclamationScore * 0.05 +
      summaryScore * 0.2 +
      coverageScore * 0.1;

    return Math.max(0.15, Math.min(1, composite));
  }

  #computeStyleFitScore(text: string, persona: PersonaDefinition) {
    const trimmed = text.trim();
    if (!trimmed) {
      return 0;
    }
    const tokens = this.#tokenizeWords(trimmed);
    const wordCount = tokens.length;
    if (wordCount === 0 || wordCount > persona.maxWords) {
      return 0;
    }
    const target = persona.maxWords;
    const lengthScore = 1 - Math.min(Math.abs(wordCount - target) / Math.max(1, target), 1);
    const punctuationScore = /[.!?…]$/u.test(trimmed) ? 1 : 0.4;
    const casingScore = /^[A-Z]/u.test(trimmed) ? 1 : 0.6;
    const lower = trimmed.toLowerCase();
    const disallowedHit = persona.disallowedPhrases.some((phrase) =>
      lower.includes(phrase.toLowerCase())
    );
    if (disallowedHit) {
      return 0;
    }
    const style = lengthScore * 0.5 + punctuationScore * 0.3 + casingScore * 0.2;
    return Math.max(0, Math.min(1, style));
  }

  #tokenizeWords(text: string) {
    const matches = text.toLowerCase().match(/[a-z0-9']+/g);
    return matches ? matches.filter(Boolean) : [];
  }

  #generateNGrams(tokens: string[], size: number) {
    const grams: string[] = [];
    for (let index = 0; index <= tokens.length - size; index += 1) {
      grams.push(tokens.slice(index, index + size).join(' '));
    }
    return grams;
  }

  #indexNGrams(tokens: string[], timestamp: number) {
    if (tokens.length < NGRAM_SIZE) {
      this.#trimNGramIndex(timestamp);
      return;
    }
    const ngrams = this.#generateNGrams(tokens, NGRAM_SIZE);
    for (const ngram of ngrams) {
      const list = this.#recentNGramIndex.get(ngram) ?? [];
      list.push(timestamp);
      while (list.length > 0 && timestamp - list[0] > NGRAM_WINDOW_MS) {
        list.shift();
      }
      this.#recentNGramIndex.set(ngram, list);
    }
    this.#trimNGramIndex(timestamp);
  }

  #trimNGramIndex(timestamp: number) {
    for (const [ngram, entries] of this.#recentNGramIndex.entries()) {
      while (entries.length > 0 && timestamp - entries[0] > NGRAM_WINDOW_MS) {
        entries.shift();
      }
      if (entries.length === 0) {
        this.#recentNGramIndex.delete(ngram);
      }
    }
  }

  #trimSemanticHistory(timestamp: number) {
    while (
      this.#recentSemanticHistory.length > 0 &&
      timestamp - this.#recentSemanticHistory[0].timestamp > SEMANTIC_WINDOW_MS
    ) {
      this.#recentSemanticHistory.shift();
    }
  }

  #jaccardSimilarity(a: string[], b: string[]) {
    if (a.length === 0 || b.length === 0) {
      return 0;
    }
    const setA = new Set(a);
    const setB = new Set(b);
    let intersection = 0;
    for (const token of setA) {
      if (setB.has(token)) {
        intersection += 1;
      }
    }
    const union = setA.size + setB.size - intersection;
    if (union === 0) {
      return 0;
    }
    return intersection / union;
  }

  #jitterValue(base: number, spread: number, min: number, max: number, seed: string) {
    const offset = (this.#seededRandom(seed) - 0.5) * spread;
    const value = base + offset;
    return Math.max(min, Math.min(max, value));
  }

  #shrinkToWordLimit(words: string[], limit: number) {
    const result = [...words];
    while (result.length > limit && this.#tryTrimWord(result)) {
      // continue trimming until within limit or no more removable words
    }
    if (result.length > limit) {
      return '';
    }
    return result.join(' ');
  }

  #shrinkToCharacterLimit(words: string[], limit: number) {
    const result = [...words];
    let joined = result.join(' ');
    while (joined.length > limit && this.#tryTrimWord(result)) {
      joined = result.join(' ');
    }
    if (joined.length > limit) {
      return '';
    }
    return joined;
  }

  #tryTrimWord(words: string[]) {
    for (let index = words.length - 2; index > 0; index -= 1) {
      const normalized = this.#normalizeWord(words[index]);
      if (FILLER_WORDS.has(normalized)) {
        words.splice(index, 1);
        return true;
      }
    }
    if (words.length > 2) {
      words.splice(words.length - 2, 1);
      return true;
    }
    return false;
  }

  #normalizeWord(word: string) {
    return word.replace(/[.,!?;:]+$/g, '').toLowerCase();
  }

  #pickFromList<T>(seed: string, items: readonly T[]): T {
    if (items.length === 0) {
      throw new Error('[orchestrator] Attempted to pick from empty list');
    }
    const index = Math.floor(this.#seededRandom(seed) * items.length);
    return items[index % items.length];
  }

  #updatePersonaState(personaId: string) {
    const runtime = this.#personaState.get(personaId) ?? { lastEmittedAt: 0 };
    runtime.lastEmittedAt = Date.now();
    this.#personaState.set(personaId, runtime);
  }

  getActiveContentId() {
    return this.#activeContentId;
  }

  resetAfterRegeneration() {
    this.#cueWindow = [];
    this.#resetPersonaMemory({ resetCadence: true });
    this.#sceneToneHistory = [];
    this.#recentKeywordHistory = [];
  }

  #hash(value: string) {
    let hash = 0;
    for (let i = 0; i < value.length; i += 1) {
      hash = (hash << 5) - hash + value.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash).toString(36);
  }

  #sanitizeResponse(text: string, persona: PersonaDefinition) {
    if (!text) {
      return '';
    }

    let output = text.trim();
    if (/^\[skip\]$/i.test(output)) {
      return '';
    }
    const originalLength = output.length;

    output = output.replace(/^"+|"+$/g, '');
    output = output.replace(/^[\[\(].*?[\]\)]\s*/g, '');
    output = output.replace(/\s+/g, ' ').trim();

    for (const phrase of persona.disallowedPhrases) {
      const regex = new RegExp(phrase, 'i');
      if (regex.test(output)) {
        output = output.replace(regex, '').trim();
      }
    }

    if (output.length === 0) {
      return '';
    }

    if (originalLength !== output.length) {
      logger.debug('[orchestrator] Sanitized LLM response', {
        persona: persona.id,
        originalLength,
        sanitizedLength: output.length
      });
    }

    return output;
  }

  #rememberOutput(personaId: string, text: string, keywords: string[]) {
    const normalized = text.toLowerCase();
    const history = this.#recentOutputs.get(personaId) ?? [];
    history.push(normalized);
    while (history.length > MAX_RECENT_OUTPUTS) {
      history.shift();
    }
    this.#recentOutputs.set(personaId, history);

    this.#recentGlobalOutputs.push(normalized);
    while (this.#recentGlobalOutputs.length > MAX_RECENT_OUTPUTS * this.#personas.length) {
      this.#recentGlobalOutputs.shift();
    }

    const now = Date.now();
    const tokens = this.#tokenizeWords(text);
    this.#indexNGrams(tokens, now);
    this.#recentSemanticHistory.push({ timestamp: now, tokens });
    this.#trimSemanticHistory(now);
    const lengthHistory = this.#personaLengthHistory.get(personaId) ?? [];
    lengthHistory.push(tokens.length);
    while (lengthHistory.length > MAX_PERSONA_LENGTH_HISTORY) {
      lengthHistory.shift();
    }
    this.#personaLengthHistory.set(personaId, lengthHistory);
    this.#globalLengthHistory.push(tokens.length);
    while (this.#globalLengthHistory.length > MAX_GLOBAL_LENGTH_HISTORY) {
      this.#globalLengthHistory.shift();
    }
    const memory = this.#personaMemory.get(personaId) ?? {
      topics: [],
      lastText: null,
      lastAt: 0,
      history: []
    };
    const mergedTopics = [...memory.topics, ...keywords]
      .filter(Boolean)
      .map((topic) => topic.toLowerCase());
    const uniqueTopics = Array.from(new Set(mergedTopics)).slice(-MAX_MEMORY_TOPICS);
    const extendedHistory = [...(memory.history ?? []), { text, at: now, keywords }];
    while (extendedHistory.length > MAX_MEMORY_HISTORY) {
      extendedHistory.shift();
    }
    this.#personaMemory.set(personaId, {
      topics: uniqueTopics,
      lastText: text,
      lastAt: now,
      history: extendedHistory
    });

    const persona = this.#personaIndex.get(personaId);
    const toneVariant = persona?.virtualUser?.toneVariant ?? persona?.toneVariants?.[0];
    if (toneVariant) {
      this.#recentToneHistory.push(toneVariant);
      while (this.#recentToneHistory.length > 8) {
        this.#recentToneHistory.shift();
      }
    }
    this.#updateDynamicBanState(personaId, text, keywords);
    this.#logMemoryEvent('remember', {
      personaId,
      text,
      keywords,
      topics: uniqueTopics,
      historySize: extendedHistory.length
    });
  }
}

export const orchestrator = new Orchestrator();
