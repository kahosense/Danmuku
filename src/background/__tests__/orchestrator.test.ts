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
vi.mock('../scene-analyzer', () => {
  const analyzeScene = vi.fn(() => ({
    summary: 'A tense moment unfolds.',
    keywords: ['miracle'],
    speakers: ['HERO'],
    tone: 'tense',
    energy: 'high',
    hasQuestion: false,
    hasExclamation: true,
    shouldRespond: true
  }));
  return { analyzeScene };
});

import { Orchestrator } from '../orchestrator';
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
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('generates comments via LLM when playback is active', async () => {
    const orchestrator = new Orchestrator();
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
