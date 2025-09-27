import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

vi.mock('../cache-store', () => {
  const get = vi.fn();
  const set = vi.fn();
  const sizeReport = vi.fn().mockResolvedValue({ global: 0, contents: {} });
  const purgeFuture = vi.fn();
  return {
    cacheStore: { get, set, sizeReport, purgeFuture }
  };
});

vi.mock('../llm-client', () => {
  return {
    llmClient: {
      complete: vi.fn(),
      getLastStatus: vi.fn(() => ({ level: 'ok' as const }))
    }
  };
});

import type { SubtitleCue, UserPreferences } from '../../shared/types';
import type { ChatMessage } from '../llm-client';
vi.mock('../scene-analyzer', () => {
  const analyzeScene = vi.fn(() => ({
    summary: 'A tense moment unfolds.',
    keywords: ['miracle'],
    speakers: ['HERO'],
    tone: 'tense',
    toneIntensity: 'high',
    toneConfidence: 0.8,
    energy: 'high',
    hasQuestion: false,
    hasExclamation: true,
    shouldRespond: true
  }));
  return { analyzeScene };
});

import { Orchestrator } from '../orchestrator';
import { getActivePersonas } from '../personas';
import * as personasModule from '../personas';
import { cacheStore } from '../cache-store';
import { llmClient } from '../llm-client';
import { analyzeScene } from '../scene-analyzer';

const basePreferences: UserPreferences = {
  globalEnabled: true,
  density: 'medium',
  personaEnabled: {
    alex: true,
    jordan: false,
    sam: false,
    casey: false
  },
  developerMode: true,
  lastUpdated: Date.now()
};

const cue = (overrides: Partial<SubtitleCue> = {}): SubtitleCue => ({
  contentId: 'content-1',
  cueId: `cue-${Math.random().toString(36).slice(2)}`,
  text: 'We need a miracle!',
  startTime: 1_000,
  endTime: 2_000,
  duration: 1_000,
  source: 'netflix-api',
  ...overrides
});

describe('Orchestrator', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    (cacheStore.get as unknown as Mock).mockResolvedValue(undefined);
    (cacheStore.set as unknown as Mock).mockResolvedValue(undefined);
    (cacheStore.sizeReport as unknown as Mock).mockResolvedValue({
      global: 0,
      contents: {}
    });
    (cacheStore.purgeFuture as unknown as Mock).mockResolvedValue(undefined);

    (llmClient.complete as unknown as Mock).mockResolvedValue({
      personaId: 'alex',
      text: 'Default output',
      usingFallback: false
    });
    (llmClient.getLastStatus as unknown as Mock).mockReturnValue({ level: 'ok' });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('generates comments via LLM when playback is active', async () => {
    const roster = getActivePersonas();
    const singlePersona = roster.find((persona) => persona.id.startsWith('alex_'));
    if (!singlePersona) {
      throw new Error('Expected alex persona to exist in roster');
    }
    const personasSpy = vi.spyOn(personasModule, 'getActivePersonas').mockReturnValue([singlePersona]);

    const orchestrator = new Orchestrator();
    personasSpy.mockRestore();
    orchestrator.updatePlaybackStatus({
      state: 'playing',
      positionMs: 1_500,
      contentId: 'content-1',
      updatedAt: Date.now()
    });

    (cacheStore.get as unknown as Mock).mockResolvedValue(undefined);
    (llmClient.complete as unknown as Mock).mockResolvedValue({
      personaId: 'alex',
      text: 'Let us cheer them on!',
      usingFallback: false
    });

    const { comments, metrics } = await orchestrator.processCueBatch(
      [cue({ cueId: 'cue-1' })],
      basePreferences
    );

    expect(comments).toHaveLength(1);
    expect(metrics.cacheMisses).toBe(1);
    expect(metrics.llmCalls).toBeGreaterThan(0);
    expect(metrics.fallbackResponses).toBe(0);
    expect(cacheStore.set).toHaveBeenCalledTimes(1);
  });

  it('skips cues based on density heuristics', async () => {
    const orchestrator = new Orchestrator();
    orchestrator.updatePlaybackStatus({
      state: 'playing',
      positionMs: 2_000,
      contentId: 'content-1',
      updatedAt: Date.now()
    });

    const prefs: UserPreferences = {
      ...basePreferences,
      density: 'low'
    };

    const shortCue = cue({ cueId: 'cue-short', text: 'ok' });
    (cacheStore.get as unknown as Mock).mockResolvedValue(undefined);
    (analyzeScene as unknown as Mock).mockReturnValueOnce({
      summary: 'Calm moment',
      keywords: [],
      speakers: [],
      tone: 'calm',
      toneIntensity: 'low',
      toneConfidence: 0.6,
      energy: 'low',
      hasQuestion: false,
      hasExclamation: false,
      shouldRespond: false
    });

    const { comments, metrics } = await orchestrator.processCueBatch([shortCue], prefs);

    expect(comments).toHaveLength(0);
    expect(metrics.skippedByHeuristics).toBeGreaterThan(0);
    expect(llmClient.complete).not.toHaveBeenCalled();
  });

  it('records fallback usage when LLM falls back', async () => {
    const orchestrator = new Orchestrator();
    orchestrator.updatePlaybackStatus({
      state: 'playing',
      positionMs: 3_000,
      contentId: 'content-1',
      updatedAt: Date.now()
    });

    (cacheStore.get as unknown as Mock).mockResolvedValue(undefined);
    (analyzeScene as unknown as Mock).mockReturnValueOnce({
      summary: 'Needs a miracle',
      keywords: ['miracle'],
      speakers: [],
      tone: 'tense',
      toneIntensity: 'high',
      toneConfidence: 0.9,
      energy: 'high',
      hasQuestion: false,
      hasExclamation: true,
      shouldRespond: true
    });
    (llmClient.complete as unknown as Mock).mockResolvedValue({
      personaId: 'alex',
      text: 'Still here with a stub.',
      usingFallback: true,
      fallbackReason: 'request_failed'
    });

    const { metrics } = await orchestrator.processCueBatch(
      [cue({ cueId: 'cue-fallback' })],
      basePreferences
    );

    expect(metrics.fallbackResponses).toBeGreaterThan(0);
  });

  it('builds enriched prompt template with persona metadata', async () => {
    const orchestrator = new Orchestrator();
    orchestrator.updatePlaybackStatus({
      state: 'playing',
      positionMs: 3_200,
      contentId: 'content-1',
      updatedAt: Date.now()
    });

    (cacheStore.get as unknown as Mock).mockResolvedValue(undefined);
    let capturedMessages: ChatMessage[] = [];
    (llmClient.complete as unknown as Mock).mockImplementationOnce(
      async (payload: { messages: ChatMessage[] }) => {
        capturedMessages = payload.messages;
        return {
          personaId: 'alex',
          text: 'Prompt check',
          usingFallback: false
        };
      }
    );

    await orchestrator.processCueBatch(
      [cue({ cueId: 'cue-prompt', startTime: 1_000 })],
      basePreferences
    );

    expect(capturedMessages.length).toBeGreaterThan(0);
    const systemMessage = capturedMessages[0];
    const userMessage = capturedMessages[capturedMessages.length - 1];

    expect(systemMessage.role).toBe('system');
    expect(systemMessage.content).toContain('You are Alex, a relaxed movie buff');
    expect(systemMessage.content).toContain('Notable scene cues: miracle');
    expect(systemMessage.content).toContain('Never reuse:');
    expect(systemMessage.content).toContain('Intensity:');
    expect(systemMessage.content).toContain('Reach for synonyms or a fresh detail.');

    expect(userMessage.role).toBe('user');
    expect(userMessage.content).toContain('Scene summary: A tense moment unfolds.');
    expect(userMessage.content).toContain('[16:40] We need a miracle!');
    expect(userMessage.content).toContain('You have not reacted recently in this scene.');
    expect(userMessage.content).toContain('Instruction: Respond in one short spoken-style sentence.');
  });

  it('reranker prefers diverse base personas', async () => {
    const orchestrator = new Orchestrator();
    orchestrator.updatePlaybackStatus({
      state: 'playing',
      positionMs: 3_400,
      contentId: 'content-1',
      updatedAt: Date.now()
    });

    (cacheStore.get as unknown as Mock).mockResolvedValue(undefined);
    const personaCallCount = new Map<string, number>();
    (llmClient.complete as unknown as Mock).mockImplementation(
      async ({ personaId }: { personaId: string }) => {
        const nextCount = (personaCallCount.get(personaId) ?? 0) + 1;
        personaCallCount.set(personaId, nextCount);
        return {
          personaId,
          text: `${personaId} response ${nextCount}`,
          usingFallback: false
        };
      }
    );

    const preferences: UserPreferences = {
      ...basePreferences,
      personaEnabled: {
        alex: true,
        jordan: true,
        sam: true,
        casey: true
      }
    };

    const { comments, metrics } = await orchestrator.processCueBatch(
      [cue({ cueId: 'cue-rerank', startTime: 1_200 })],
      preferences
    );

    expect(comments.length).toBeGreaterThan(0);
    const personaBaseMap = new Map(
      getActivePersonas().map((persona) => [
        persona.id,
        persona.basePersonaId ?? persona.preferenceKey ?? persona.id
      ])
    );
    const baseIds = comments.map(
      (comment) => personaBaseMap.get(comment.personaId) ?? comment.personaId
    );
    expect(new Set(baseIds).size).toBe(comments.length);
    expect(metrics.prunedByReranker).toBeGreaterThan(0);
  });

  it('handles a burst of cue batches with sustained diversity', async () => {
    const orchestrator = new Orchestrator();
    orchestrator.updatePlaybackStatus({
      state: 'playing',
      positionMs: 5_000,
      contentId: 'content-1',
      updatedAt: Date.now()
    });

    (cacheStore.get as unknown as Mock).mockResolvedValue(undefined);
    let counter = 0;
    (llmClient.complete as unknown as Mock).mockImplementation(
      async ({ personaId }: { personaId: string }) => {
        counter += 1;
        return {
          personaId,
          text: `${personaId} burst ${counter}`,
          usingFallback: false
        };
      }
    );

    const preferences: UserPreferences = {
      ...basePreferences,
      personaEnabled: {
        alex: true,
        jordan: true,
        sam: true,
        casey: true
      }
    };

    const personaBaseMap = new Map(
      getActivePersonas().map((persona) => [
        persona.id,
        persona.basePersonaId ?? persona.preferenceKey ?? persona.id
      ])
    );

    for (let index = 0; index < 6; index += 1) {
      const cueId = `cue-load-${index}`;
      const { comments, metrics } = await orchestrator.processCueBatch(
        [cue({ cueId, startTime: 1_000 + index * 2_000 })],
        preferences
      );
      const baseIds = comments.map(
        (comment) => personaBaseMap.get(comment.personaId) ?? comment.personaId
      );
      expect(new Set(baseIds).size).toBe(comments.length);
    }

    expect(counter).toBeGreaterThan(6);
  });

  it('threads persona memory into subsequent prompts', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));

    const roster = getActivePersonas();
    const singlePersona = roster.find((persona) => persona.id.startsWith('alex_'));
    if (!singlePersona) {
      throw new Error('Expected alex persona to exist in roster');
    }
    const personasSpy = vi.spyOn(personasModule, 'getActivePersonas').mockReturnValue([singlePersona]);

    const orchestrator = new Orchestrator();

    try {
      orchestrator.updatePlaybackStatus({
        state: 'playing',
        positionMs: 3_500,
        contentId: 'content-1',
        updatedAt: Date.now()
      });

      const cacheGet = cacheStore.get as unknown as Mock;
      cacheGet.mockResolvedValue(undefined);

      const completeMock = llmClient.complete as unknown as Mock;
      let secondMessages: ChatMessage[] | null = null;

      completeMock.mockImplementationOnce(async () => ({
        personaId: 'alex',
        text: 'Miracle miracle',
        usingFallback: false
      }));

      const firstBatch = await orchestrator.processCueBatch(
        [cue({ cueId: 'cue-memory-1', startTime: 1_000 })],
        basePreferences
      );

      expect(firstBatch.comments).toHaveLength(1);
      const firstCommentText = firstBatch.comments[0]?.text;
      expect(firstCommentText).toBeTruthy();

      vi.advanceTimersByTime(16_000);

      completeMock.mockImplementationOnce(async ({ messages }: { messages: ChatMessage[] }) => {
        secondMessages = messages;
        return {
          personaId: 'alex',
          text: 'Second take',
          usingFallback: false
        };
      });

      const secondBatch = await orchestrator.processCueBatch(
        [cue({ cueId: 'cue-memory-2', startTime: 12_000 })],
        basePreferences
      );

      expect(secondBatch.comments).toHaveLength(1);
      expect(secondMessages).not.toBeNull();

      const secondSystem = secondMessages![0];
      expect(secondSystem.role).toBe('system');
      expect(secondSystem.content).toContain('Never reuse:');
      expect(secondSystem.content).toContain('miracle');
      expect(secondSystem.content).toContain('Notable scene cues: describe sensory detail');

      const secondComment = secondBatch.comments[0];
      const userPrompt = secondMessages![secondMessages!.length - 1];
      expect(userPrompt.role).toBe('user');
      expect(secondComment?.personaId).toBe(firstBatch.comments[0]?.personaId);
      expect(userPrompt.content).toContain('Previously you reacted with');
      expect(userPrompt.content).toContain(firstCommentText!);
      expect(userPrompt.content).toContain('Topics you touched recently: miracle');
      expect(userPrompt.content).toContain('Words you\'ve leaned on lately: miracle');
    } finally {
      personasSpy.mockRestore();
    }
  });

  it('clears persona memory when session content changes', async () => {
    const orchestrator = new Orchestrator();
    orchestrator.updatePlaybackStatus({
      state: 'playing',
      positionMs: 4_500,
      contentId: 'content-1',
      updatedAt: Date.now()
    });

    const cacheGet = cacheStore.get as unknown as Mock;
    cacheGet.mockResolvedValue(undefined);

    const completeMock = llmClient.complete as unknown as Mock;

    completeMock.mockImplementationOnce(async () => ({
      personaId: 'alex',
      text: 'Memory primed',
      usingFallback: false
    }));

    await orchestrator.processCueBatch(
      [cue({ cueId: 'cue-reset-1', startTime: 1_000 })],
      basePreferences
    );

    orchestrator.updatePlaybackStatus({
      state: 'playing',
      positionMs: 6_000,
      contentId: 'content-2',
      updatedAt: Date.now()
    });

    let capturedMessages: ChatMessage[] | null = null;
    completeMock.mockImplementationOnce(async (payload: { messages: ChatMessage[] }) => {
      capturedMessages = payload.messages;
      return {
        personaId: 'alex',
        text: 'Fresh start',
        usingFallback: false
      };
    });

    await orchestrator.processCueBatch(
      [
        cue({
          cueId: 'cue-reset-2',
          contentId: 'content-2',
          startTime: 1_500
        })
      ],
      basePreferences
    );

    expect(capturedMessages).not.toBeNull();
    const userPrompt = capturedMessages![capturedMessages!.length - 1];
    expect(userPrompt.role).toBe('user');
    expect(userPrompt.content).toContain('You have not reacted recently in this scene.');
    expect(userPrompt.content).not.toContain('Previously you reacted with');
  });

  it('throttles persona output within cadence window', async () => {
    const orchestrator = new Orchestrator();
    orchestrator.updatePlaybackStatus({
      state: 'playing',
      positionMs: 4_000,
      contentId: 'content-1',
      updatedAt: Date.now()
    });

    (cacheStore.get as unknown as Mock).mockResolvedValue(undefined);
    (llmClient.complete as unknown as Mock).mockResolvedValue({
      personaId: 'alex',
      text: 'First comment!',
      usingFallback: false
    });

    await orchestrator.processCueBatch([cue({ cueId: 'cue-primed' })], basePreferences);
    const firstCallCount = (llmClient.complete as unknown as Mock).mock.calls.length;
    expect(firstCallCount).toBeGreaterThan(0);

    (cacheStore.get as unknown as Mock).mockResolvedValue(undefined);

    const secondCue = cue({ cueId: 'cue-second', text: 'Another line.' });
    const { metrics } = await orchestrator.processCueBatch([secondCue], basePreferences);

    expect(metrics.skippedByThrottle + metrics.skippedByHeuristics).toBeGreaterThan(0);
    const secondCallCount = (llmClient.complete as unknown as Mock).mock.calls.length;
    expect(secondCallCount).toBe(firstCallCount);
  });
});
