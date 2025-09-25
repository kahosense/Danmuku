import { beforeEach, describe, expect, it, vi } from 'vitest';

import { feedbackStore } from '../feedback-store';
import type { FeedbackEntry } from '../types';

const STORAGE_KEY = 'netflix-ai-danmaku::feedback-log';

describe('feedbackStore', () => {
  const storageData: Record<string, FeedbackEntry[]> = {};

  beforeEach(() => {
    storageData[STORAGE_KEY] = [];
    const storage = chrome.storage.local as unknown as {
      get: ReturnType<typeof vi.fn>;
      set: ReturnType<typeof vi.fn>;
      clear: ReturnType<typeof vi.fn>;
    };
    storage.get = vi.fn(async (key?: string) => {
      if (typeof key === 'string') {
        return { [key]: storageData[key] };
      }
      return { ...storageData };
    });
    storage.set = vi.fn(async (value: Record<string, unknown>) => {
      Object.assign(storageData, value);
    });
    storage.clear = vi.fn(async () => {
      Object.keys(storageData).forEach((key) => {
        delete storageData[key];
      });
    });
  });

  it('records feedback entries and preserves history', async () => {
    const first = await feedbackStore.record({ category: 'too_noisy' });
    const second = await feedbackStore.record({ category: 'great', note: 'Warm and varied' });

    expect(first.id).not.toEqual(second.id);
    expect(storageData[STORAGE_KEY]).toHaveLength(2);
    expect(storageData[STORAGE_KEY][1].note).toBe('Warm and varied');
  });

  it('lists existing feedback entries', async () => {
    await feedbackStore.record({ category: 'too_robotic' });

    const entries = await feedbackStore.list();
    expect(entries).toHaveLength(1);
    expect(entries[0].category).toBe('too_robotic');
  });
});
