import { cacheStore, type CachedCommentRecord } from './cache-store';
import { llmClient, type ChatMessage } from './llm-client';
import {
  getActivePersonaVariant,
  getActivePersonas,
  subscribePersonaVariant,
  type PersonaDefinition,
  type PersonaVirtualUserMeta
} from './personas';
import { analyzeScene, type SceneAnalysis } from './scene-analyzer';
import { logger } from '../shared/logger';
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
const MAX_MEMORY_HISTORY = 3;

interface PersonaRuntimeState {
  lastEmittedAt: number;
}

interface PersonaMemory {
  topics: string[];
  lastText: string | null;
  lastAt: number;
  history: Array<{ text: string; at: number; keywords: string[] }>;
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
  duplicatesFiltered: number;
  sanitizedDrops: number;
  fallbackResponses: number;
  prunedByReranker: number;
}

interface CandidateEntry {
  persona: PersonaDefinition;
  comment: GeneratedComment;
  source: "cache" | "llm";
  cacheKey: string;
  keywords: string[];
  sceneTone: SceneAnalysis['tone'];
  sceneEnergy: SceneAnalysis['energy'];
  basePersonaId: string;
  preferenceKey: string;
  toneVariant?: string;
  weight: number;
  virtualUser?: PersonaVirtualUserMeta;
  usedFallback?: boolean;
  promptHash?: string;
  score: number;
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
  #recentCommentLog: Array<{ timestamp: number; personaId: string }> = [];
  #personaLocks = new Map<string, boolean>();
  #lastCueRespondedId = new Map<string, string>();
  #personaMemory = new Map<string, PersonaMemory>();
  #recentToneHistory: string[] = [];
  #playbackStatus: PlaybackStatus = {
    state: 'paused',
    positionMs: 0,
    contentId: null,
    updatedAt: 0
  };
  #lastPlaybackPositionMs: number | null = null;
  #promptVersion = '';

  constructor() {
    const variant = getActivePersonaVariant();
    this.#promptVersion = variant.promptVersion;
    this.#applyPersonaVariant();

    subscribePersonaVariant((nextVariant) => {
      this.#promptVersion = nextVariant.promptVersion;
      this.#applyPersonaVariant();
    });
  }

  #applyPersonaVariant() {
    this.#personas = getActivePersonas();
    this.#personaIndex = new Map();
    this.#personaState = new Map();
    this.#recentOutputs = new Map();
    this.#personaLocks = new Map();
    this.#personaMemory = new Map();
    this.#lastCueRespondedId = new Map();

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
    }

    if (status.state === 'seeking') {
      this.#resetPersonaMemory({ resetCadence: true });
    }

    this.#lastPlaybackPositionMs = status.positionMs;
  }

  async processCueBatch(
    cues: SubtitleCue[],
    preferences: UserPreferences
  ): Promise<OrchestratorResult> {
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
    const metrics = this.#createMetricsAccumulator();

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

      const personaStart = Date.now();
      const runtime = this.#personaState.get(persona.id);
      const cadenceMs = persona.cadenceSeconds * 1000;
      const densityMs = DENSITY_INTERVALS[preferences.density];
      const minInterval = Math.max(cadenceMs, densityMs);

      if (runtime && personaStart - runtime.lastEmittedAt < minInterval) {
        metrics.skippedByThrottle += 1;
        logger.debug('[orchestrator] Persona throttled', { persona: persona.id });
        continue;
      }

      const cacheKey = this.#buildCacheKey(latestCue.cueId, persona.id);
      const cached = await cacheStore.get(cacheKey);

      if (cached && this.#isCacheCompatible(cached, scene)) {
        logger.debug('[orchestrator] Cache candidate ready', { cacheKey });
        const reused: GeneratedComment = {
          ...cached,
          id: cacheKey,
          personaId: persona.id,
          text: cached.text,
          createdAt: Date.now(),
          renderAt: latestCue.startTime + 500,
          durationMs: this.#computeDurationMs(cached.text)
        };

        candidatePool.push({
          persona,
          comment: reused,
          source: 'cache',
          cacheKey,
          keywords: scene.keywords,
          sceneTone: scene.tone,
          sceneEnergy: scene.energy,
          basePersonaId,
          preferenceKey,
          toneVariant,
          weight,
          virtualUser: persona.virtualUser,
          score: 0,
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
        const messages = this.#buildMessages({ persona, preferences, scene });
        const llmStart = Date.now();
        const response = await llmClient.complete({
          personaId: persona.id,
          messages,
          maxTokens: Math.max(64, persona.maxWords * 2),
          temperature: persona.temperature,
          topP: persona.topP
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
        if (this.#isDuplicate(persona.id, processed)) {
          metrics.duplicatesFiltered += 1;
          logger.debug('[orchestrator] Skipping duplicate output', {
            persona: persona.id,
            processed
          });
          continue;
        }

        const createdAt = Date.now();
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
          sceneEnergy: scene.energy,
          basePersonaId,
          preferenceKey,
          toneVariant,
          weight,
          virtualUser: persona.virtualUser,
          usedFallback,
          promptHash,
          score: 0,
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
    if (resetCadence) {
      this.#personaState.forEach((state, personaId) => {
        this.#personaState.set(personaId, { ...state, lastEmittedAt: 0 });
      });
    }
  }

  #createMetricsAccumulator(): MetricsAccumulator {
    return {
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
      duplicatesFiltered: 0,
      sanitizedDrops: 0,
      fallbackResponses: 0,
      prunedByReranker: 0
    };
  }

  #finalizeMetrics(acc: MetricsAccumulator): OrchestratorMetrics {
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
      duplicatesFiltered: acc.duplicatesFiltered,
      sanitizedDrops: acc.sanitizedDrops,
      fallbackResponses: acc.fallbackResponses,
      candidatesGenerated: acc.candidateCount,
      prunedByReranker: acc.prunedByReranker,
      cacheSizeGlobalBytes: 0,
      cacheSizeActiveBytes: 0,
      activeContentId: this.#activeContentId,
      windowCommentTotal: this.#recentCommentLog.length
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

    pool.forEach((candidate) => {
      candidate.score = this.#scoreCandidate(candidate, scene, anchorTime);
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

  #scoreCandidate(candidate: CandidateEntry, scene: SceneAnalysis, anchorTime: number) {
    const wordCount = candidate.comment.text.split(/\s+/).filter(Boolean).length;
    const target = Math.min(candidate.persona.maxWords, 18);
    const lengthScore = 1 - Math.min(Math.abs(wordCount - target) / Math.max(1, target), 1);
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

    return (
      lengthScore * 0.22 +
      noveltyScore * 0.22 +
      recencyScore * 0.16 +
      energyBias * 0.16 +
      toneScore * 0.14 +
      weightBias * 0.05 +
      sourceBias +
      jitter * 0.05
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

    output = output.replace(/\s+/g, ' ').trim();

    const words = output.split(/\s+/).filter(Boolean);
    if (words.length > persona.maxWords) {
      output = words.slice(0, persona.maxWords).join(' ');
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

  #buildMessages({
    persona,
    preferences,
    scene
  }: {
    persona: PersonaDefinition;
    preferences: UserPreferences;
    scene: SceneAnalysis;
  }) {
    const now = Date.now();
    const contextLines = this.#cueWindow
      .map((cue) => {
        const ms = cue.startTime > 1000 ? cue.startTime : cue.startTime * 1000;
        const timestampSeconds = Math.max(0, Math.floor(ms / 1000));
        const minutes = String(Math.floor(timestampSeconds / 60)).padStart(2, '0');
        const seconds = String(timestampSeconds % 60).padStart(2, '0');
        return `[${minutes}:${seconds}] ${cue.text}`;
      })
      .join('\n');

    const guidelines = persona.styleGuidelines
      .map((line, index) => `${index + 1}. ${line}`)
      .join('\n');

    const densityInstruction = `Comment only if you have a fresh take; avoid repetition. Current density preference: ${preferences.density}.`;

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

    const toneInstruction = `Scene tone: ${scene.tone}. Energy: ${scene.energy}.`;
    const speakerInstruction = scene.speakers.length
      ? `Speakers in focus: ${scene.speakers.join(', ')}.`
      : 'Speaker unknown—react as an engaged viewer.';
    const keywordsInstruction = scene.keywords.length
      ? `Notable keywords: ${scene.keywords.join(', ')}.`
      : '';
    const skipInstruction = 'If you truly have nothing new or meaningful to add, respond with [skip].';

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
      toneInstruction,
      speakerInstruction,
      keywordsInstruction,
      persona.disallowedPhrases.length > 0
        ? `Never use these phrases: ${persona.disallowedPhrases.join(', ')}.`
        : null,
      skipInstruction
    ]
      .filter(Boolean)
      .join(' ');

    const sceneSummary = scene.summary || contextLines;
    const memorySection = [
      memoryLine,
      memoryTopicsLine,
      memoryHistoryLines ? `Recent remarks:\n${memoryHistoryLines}` : ''
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

    persona.fewShotExamples.forEach((example) => {
      messages.push({ role: 'user', content: example.user });
      messages.push({ role: 'assistant', content: example.assistant });
    });

    messages.push({ role: 'user', content: userContent });

    return messages;
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

  #isDuplicate(personaId: string, text: string) {
    const normalized = text.toLowerCase();
    if (this.#recentGlobalOutputs.includes(normalized)) {
      return true;
    }
    const history = this.#recentOutputs.get(personaId) ?? [];
    return history.includes(normalized);
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
  }
}

export const orchestrator = new Orchestrator();
