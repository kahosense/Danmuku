import { cacheStore } from './cache-store';
import { llmClient, type ChatMessage } from './llm-client';
import { PERSONAS } from './personas';
import type { PersonaDefinition } from './personas';
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

interface PersonaRuntimeState {
  lastEmittedAt: number;
}

interface PersonaMemory {
  topics: string[];
  lastText: string | null;
  lastAt: number;
}

interface MetricsAccumulator {
  cacheHits: number;
  cacheMisses: number;
  llmCalls: number;
  llmLatencyMsTotal: number;
  generationLatencyMsTotal: number;
  generatedCount: number;
  skippedByThrottle: number;
  skippedByHeuristics: number;
  skippedByLock: number;
  duplicatesFiltered: number;
  sanitizedDrops: number;
  fallbackResponses: number;
}

export class Orchestrator {
  #personaState = new Map<string, PersonaRuntimeState>();
  #cueWindow: SubtitleCue[] = [];
  #activeContentId: string | null = null;
  #recentOutputs = new Map<string, string[]>();
  #recentGlobalOutputs: string[] = [];
  #recentCommentLog: Array<{ timestamp: number; personaId: string }> = [];
  #personaLocks = new Map<string, boolean>();
  #lastCueRespondedId = new Map<string, string>();
  #personaMemory = new Map<string, PersonaMemory>();
  #playbackStatus: PlaybackStatus = {
    state: 'paused',
    positionMs: 0,
    contentId: null,
    updatedAt: 0
  };
  #lastPlaybackPositionMs: number | null = null;

  constructor() {
    PERSONAS.forEach((persona) => {
      this.#personaState.set(persona.id, { lastEmittedAt: 0 });
      this.#recentOutputs.set(persona.id, []);
      this.#personaLocks.set(persona.id, false);
      this.#personaMemory.set(persona.id, { topics: [], lastText: null, lastAt: 0 });
    });
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
    const pendingPersonaCounts = new Map<string, number>();
    const results: GeneratedComment[] = [];
    let totalAdded = 0;

    for (const persona of PERSONAS) {
      if (!preferences.personaEnabled[persona.id]) {
        continue;
      }

      if (existingTotal + totalAdded >= MAX_COMMENTS_PER_WINDOW) {
        break;
      }

      const personaWindowCount =
        (existingPerPersona.get(persona.id) ?? 0) + (pendingPersonaCounts.get(persona.id) ?? 0);
      if (personaWindowCount >= 1) {
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

      const cacheKey = `${latestCue.cueId}::${persona.id}`;
      const cached = await cacheStore.get(cacheKey);
      if (cached) {
        logger.debug('[orchestrator] Cache hit', { cacheKey });
        const reused: GeneratedComment = {
          ...cached,
          id: cacheKey,
          createdAt: Date.now(),
          renderAt: latestCue.startTime + 500
        };

        this.#registerComment(reused, latestCue.cueId, scene.keywords);
        results.push(reused);
        pendingPersonaCounts.set(persona.id, personaWindowCount + 1);
        totalAdded += 1;
        const generationDuration = Date.now() - personaStart;
        metrics.cacheHits += 1;
        metrics.generatedCount += 1;
        metrics.generationLatencyMsTotal += generationDuration;
        continue;
      }

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
        const cleaned = this.#sanitizeResponse(response.text, persona);
        if (!cleaned) {
          metrics.sanitizedDrops += 1;
          logger.warn('[orchestrator] Sanitized response empty, skipping', { persona: persona.id });
          continue;
        }
        if (this.#isDuplicate(persona.id, cleaned)) {
          metrics.duplicatesFiltered += 1;
          logger.debug('[orchestrator] Skipping duplicate output', {
            persona: persona.id,
            cleaned
          });
          continue;
        }

        const createdAt = Date.now();
        const comment: GeneratedComment = {
          id: cacheKey,
          personaId: persona.id,
          text: cleaned,
          createdAt,
          renderAt: latestCue.startTime + 500,
          durationMs: 6000
        };

        await cacheStore.set({
          ...comment,
          cacheKey,
          contentId: latestCue.contentId,
          personaId: persona.id,
          cueId: latestCue.cueId,
          promptHash: this.#hash(JSON.stringify(messages))
        });

        if (response.usingFallback) {
          metrics.fallbackResponses += 1;
        }

        this.#registerComment(comment, latestCue.cueId, scene.keywords);
        results.push(comment);
        pendingPersonaCounts.set(persona.id, personaWindowCount + 1);
        totalAdded += 1;
        const generationDuration = Date.now() - personaStart;
        metrics.cacheMisses += 1;
        metrics.generatedCount += 1;
        metrics.generationLatencyMsTotal += generationDuration;
      } finally {
        this.#personaLocks.set(persona.id, false);
      }
    }
    return this.#finalizeReturn(results, metrics, preferences);
  }

  #resetPersonaMemory({ resetCadence = false }: { resetCadence?: boolean } = {}) {
    this.#recentOutputs.forEach((_outputs, personaId) => {
      this.#recentOutputs.set(personaId, []);
    });
    this.#personaMemory.forEach((_memory, personaId) => {
      this.#personaMemory.set(personaId, { topics: [], lastText: null, lastAt: 0 });
    });
    this.#personaLocks.forEach((_locked, personaId) => {
      this.#personaLocks.set(personaId, false);
    });
    this.#lastCueRespondedId.clear();
    this.#recentGlobalOutputs = [];
    this.#recentCommentLog = [];
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
      skippedByThrottle: 0,
      skippedByHeuristics: 0,
      skippedByLock: 0,
      duplicatesFiltered: 0,
      sanitizedDrops: 0,
      fallbackResponses: 0
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
        acc.generatedCount > 0 ? acc.generationLatencyMsTotal / acc.generatedCount : 0,
      skippedByThrottle: acc.skippedByThrottle,
      skippedByHeuristics: acc.skippedByHeuristics,
      skippedByLock: acc.skippedByLock,
      duplicatesFiltered: acc.duplicatesFiltered,
      sanitizedDrops: acc.sanitizedDrops,
      fallbackResponses: acc.fallbackResponses,
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
    for (const entry of this.#recentCommentLog) {
      perPersona.set(entry.personaId, (perPersona.get(entry.personaId) ?? 0) + 1);
    }
    return { total: this.#recentCommentLog.length, perPersona };
  }

  #registerComment(comment: GeneratedComment, cueId: string, keywords: string[]) {
    this.#recentCommentLog.push({ timestamp: comment.renderAt, personaId: comment.personaId });
    this.#trimRecentCommentLog(comment.renderAt);
    this.#rememberOutput(comment.personaId, comment.text, keywords);
    this.#lastCueRespondedId.set(comment.personaId, cueId);
    this.#updatePersonaState(comment.personaId);
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
      ? `Previously you reacted with "${memory.lastText}" about ${Math.max(1, Math.round((Date.now() - memory.lastAt) / 1000))} seconds ago. Refer back only if it deepens your point.`
      : 'You have not reacted recently in this scene.';
    const memoryTopicsLine = memory?.topics?.length
      ? `Topics you touched recently: ${memory.topics.join(', ')}.`
      : '';

    const toneInstruction = `Scene tone: ${scene.tone}. Energy: ${scene.energy}.`;
    const speakerInstruction = scene.speakers.length
      ? `Speakers in focus: ${scene.speakers.join(', ')}.`
      : 'Speaker unknown—react as an engaged viewer.';
    const keywordsInstruction = scene.keywords.length
      ? `Notable keywords: ${scene.keywords.join(', ')}.`
      : '';
    const skipInstruction = 'If you truly have nothing new or meaningful to add, respond with [skip].';

    const systemContent = [
      persona.systemPrompt,
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
    const memorySection = [memoryLine, memoryTopicsLine].filter(Boolean).join('\n');

    const userContent = [`Scene summary: ${sceneSummary}`, `Subtitle window:\n${contextLines}`, `Guidelines:\n${guidelines}`, memorySection, 'Instruction: Respond in one short spoken-style sentence. Keep it natural, as if chatting with friends.'].filter(Boolean).join('\n');

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
    while (this.#recentGlobalOutputs.length > MAX_RECENT_OUTPUTS * PERSONAS.length) {
      this.#recentGlobalOutputs.shift();
    }

    const memory = this.#personaMemory.get(personaId) ?? {
      topics: [],
      lastText: null,
      lastAt: 0
    };
    const mergedTopics = [...memory.topics, ...keywords]
      .filter(Boolean)
      .map((topic) => topic.toLowerCase());
    const uniqueTopics = Array.from(new Set(mergedTopics)).slice(-MAX_MEMORY_TOPICS);
    this.#personaMemory.set(personaId, {
      topics: uniqueTopics,
      lastText: text,
      lastAt: Date.now()
    });
  }
}

export const orchestrator = new Orchestrator();
