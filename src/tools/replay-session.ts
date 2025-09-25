#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Orchestrator } from '../background/orchestrator.ts';
import { llmClient, type LLMRequestOptions, type LLMResponse } from '../background/llm-client.ts';
import { initializePersonaRegistry } from '../background/personas.ts';
import { DEFAULT_PREFERENCES } from '../shared/settings.ts';
import type { SubtitleCue, UserPreferences } from '../shared/types.ts';

// Minimal chrome polyfill for Node execution
const chromeGlobal: any = globalThis.chrome ?? {};
chromeGlobal.runtime = chromeGlobal.runtime ?? {
  sendMessage: async () => undefined,
  lastError: undefined,
  onMessage: { addListener: () => {} },
  onInstalled: { addListener: () => {} },
  onConnect: { addListener: () => {} }
};
chromeGlobal.tabs = chromeGlobal.tabs ?? {
  sendMessage: async () => undefined,
  onRemoved: { addListener: () => {} }
};
chromeGlobal.alarms = chromeGlobal.alarms ?? {
  create: () => {},
  onAlarm: { addListener: () => {} }
};
chromeGlobal.storage = chromeGlobal.storage ?? {
  local: {
    async get() {
      return {};
    },
    async set() {
      return undefined;
    },
    async clear() {
      return undefined;
    }
  }
};

globalThis.chrome = chromeGlobal;

await initializePersonaRegistry();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const args = process.argv.slice(2);
const outIndex = args.findIndex((arg) => arg === '--out');
const outputPath = outIndex !== -1 && args[outIndex + 1]
  ? path.resolve(process.cwd(), args[outIndex + 1])
  : undefined;
const inputArg = args.find((arg, index) => index !== outIndex && arg !== '--out' && index !== outIndex + 1);
const inputPath = inputArg
  ? path.resolve(process.cwd(), inputArg)
  : path.join(__dirname, 'fixtures', 'sample-cues.json');

const fileContents = fs.readFileSync(inputPath, 'utf-8');
const cueBatches = JSON.parse(fileContents) as SubtitleCue[][];

const orchestrator = new Orchestrator();

const offlineComplete = async (options: LLMRequestOptions): Promise<LLMResponse> => {
  const userLines = options.messages.filter((msg) => msg.role === 'user');
  const latest = userLines[userLines.length - 1]?.content ?? '';
  const subtitleWindowMatch = latest.match(/Subtitle window:\n([\s\S]+?)\nGuidelines:/);
  const subtitleBlock = subtitleWindowMatch ? subtitleWindowMatch[1] : latest;
  const lastSubtitleLine = subtitleBlock
    .split('\n')
    .map((line) => line.replace(/\[[^\]]+\]\s*/, '').trim())
    .filter(Boolean)
    .pop();
  const snippet = (lastSubtitleLine ?? 'Reacting offline').slice(0, 80);
  return {
    personaId: options.personaId,
    text: `${options.personaId}: ${snippet}`,
    usingFallback: false
  };
};

( llmClient as unknown as { complete: typeof offlineComplete } ).complete = offlineComplete;

const preferences: UserPreferences = {
  ...DEFAULT_PREFERENCES,
  developerMode: true
};

const contentId = cueBatches[0]?.[0]?.contentId ?? 'offline-content';

orchestrator.updatePlaybackStatus({
  state: 'playing',
  positionMs: 0,
  contentId,
  updatedAt: Date.now()
});

const transcript: Array<{
  cueIds: string[];
  comments: Array<{ personaId: string; text: string; renderAtMs: number }>;
  metrics: {
    cacheHits: number;
    cacheMisses: number;
    candidatesGenerated: number;
    prunedByReranker: number;
  };
}> = [];

for (const batch of cueBatches) {
  if (!Array.isArray(batch) || batch.length === 0) {
    continue;
  }

  const anchor = batch[batch.length - 1]?.startTime ?? 0;
  orchestrator.updatePlaybackStatus({
    state: 'playing',
    positionMs: anchor,
    contentId,
    updatedAt: Date.now()
  });

  const result = await orchestrator.processCueBatch(batch, preferences);
  if (result.comments.length === 0) {
    continue;
  }

  const cueIds = batch.map((cue) => cue.cueId);
  const comments = result.comments.map((comment) => ({
    personaId: comment.personaId,
    text: comment.text,
    renderAtMs: comment.renderAt
  }));

  transcript.push({
    cueIds,
    comments,
    metrics: {
      cacheHits: result.metrics.cacheHits,
      cacheMisses: result.metrics.cacheMisses,
      candidatesGenerated: result.metrics.candidatesGenerated,
      prunedByReranker: result.metrics.prunedByReranker
    }
  });

  comments.forEach((comment) => {
    const seconds = (comment.renderAtMs / 1000).toFixed(2);
    process.stdout.write(`[+${seconds}s][${comment.personaId}] ${comment.text}\n`);
  });
}

if (outputPath) {
  const payload = {
    generatedAt: new Date().toISOString(),
    input: path.relative(process.cwd(), inputPath),
    transcript
  };
  fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2), 'utf-8');
  process.stdout.write(`\nSaved replay output to ${outputPath}\n`);
}
