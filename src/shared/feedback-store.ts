import type { FeedbackCategory, FeedbackEntry } from './types';

const STORAGE_KEY = 'netflix-ai-danmaku::feedback-log';
const MAX_ENTRIES = 200;

export interface FeedbackRecordInput {
  category: FeedbackCategory;
  note?: string | null;
  createdAt?: number;
}

export class FeedbackStore {
  async record(input: FeedbackRecordInput): Promise<FeedbackEntry> {
    const createdAt = input.createdAt ?? Date.now();
    const entry: FeedbackEntry = {
      id:
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `${createdAt}-${Math.random().toString(36).slice(2, 8)}`,
      category: input.category,
      note: input.note ?? null,
      createdAt
    };

    const stored = await chrome.storage.local.get(STORAGE_KEY);
    const existing: FeedbackEntry[] = Array.isArray(stored?.[STORAGE_KEY])
      ? (stored[STORAGE_KEY] as FeedbackEntry[])
      : [];
    const next = [...existing, entry].slice(-MAX_ENTRIES);
    await chrome.storage.local.set({ [STORAGE_KEY]: next });
    return entry;
  }

  async list(): Promise<FeedbackEntry[]> {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    const entries: FeedbackEntry[] = Array.isArray(stored?.[STORAGE_KEY])
      ? (stored[STORAGE_KEY] as FeedbackEntry[])
      : [];
    return entries;
  }

  async clear() {
    await chrome.storage.local.set({ [STORAGE_KEY]: [] });
  }
}

export const feedbackStore = new FeedbackStore();
