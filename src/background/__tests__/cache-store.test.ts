import { describe, expect, it } from 'vitest';

import { CacheStore } from '../cache-store';

const createMemoryOpenDb = () => {
  const commentStore = new Map<string, any>();
  const contentStore = new Map<string, any>();

  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

  const makeCursor = (records: any[], index: number): any => {
    if (index >= records.length) {
      return null;
    }
    const current = records[index];
    return {
      value: clone(current),
      async delete() {
        commentStore.delete(current.cacheKey);
      },
      async continue() {
        return makeCursor(records, index + 1);
      }
    };
  };

  const commentInterface = {
    async get(key: string) {
      const value = commentStore.get(key);
      return value ? clone(value) : undefined;
    },
    async put(value: any) {
      commentStore.set(value.cacheKey, clone(value));
    },
    async clear() {
      commentStore.clear();
    },
    async delete(key: string) {
      commentStore.delete(key);
    },
    async getAll() {
      return Array.from(commentStore.values()).map((entry) => clone(entry));
    },
    index(name: string) {
      if (name !== 'contentId') {
        throw new Error(`Unsupported index ${name}`);
      }
      return {
        async openCursor(contentId: string) {
          const matches = Array.from(commentStore.values()).filter(
            (record) => record.contentId === contentId
          );
          return makeCursor(matches, 0);
        }
      };
    }
  };

  const contentInterface = {
    async get(key: string) {
      const value = contentStore.get(key);
      return value ? clone(value) : undefined;
    },
    async put(value: any) {
      contentStore.set(value.contentId, clone(value));
    },
    async delete(key: string) {
      contentStore.delete(key);
    },
    async clear() {
      contentStore.clear();
    },
    async getAll() {
      return Array.from(contentStore.values()).map((entry) => clone(entry));
    }
  };

  const openDb: any = async (_name: string, _version?: number, options?: any) => {
    if (options?.upgrade) {
      options.upgrade(
        {
          objectStoreNames: {
            contains: (storeName: string) => storeName === 'comments' || storeName === 'content'
          },
          createObjectStore: () => ({
            createIndex: () => {}
          })
        } as any,
        0,
        _version ?? null,
        {} as any,
        {} as any
      );
    }

    return {
      transaction() {
        return {
          objectStore(storeName: string) {
            if (storeName === 'comments') {
              return commentInterface;
            }
            if (storeName === 'content') {
              return contentInterface;
            }
            throw new Error(`Unknown store ${storeName}`);
          },
          done: Promise.resolve()
        };
      }
    } as any;
  };

  return openDb;
};

const createStore = (
  dbName: string,
  options: { maxContentBytes: number; maxGlobalBytes: number }
) => new CacheStore({ dbName, ...options }, createMemoryOpenDb());

const baseRecord = (cacheKey: string, text: string) => ({
  cacheKey,
  contentId: 'content-1',
  personaId: 'alex',
  cueId: `${cacheKey}-cue`,
  promptHash: `${cacheKey}-hash`,
  id: cacheKey,
  text,
  createdAt: 0,
  renderAt: 0,
  durationMs: 6_000
});

describe('CacheStore', () => {
  it('stores and retrieves records', async () => {
    const store = createStore(`cache-test-${Math.random()}`, {
      maxContentBytes: Number.MAX_SAFE_INTEGER,
      maxGlobalBytes: Number.MAX_SAFE_INTEGER
    });
    const payload = baseRecord('first', 'hello world');
    await store.set(payload);

    const found = await store.get('first');

    expect(found).toBeDefined();
    expect(found?.text).toBe('hello world');
  });

  it('purges future entries by timestamp', async () => {
    const store = createStore(`cache-test-${Math.random()}` , {
      maxContentBytes: Number.MAX_SAFE_INTEGER,
      maxGlobalBytes: Number.MAX_SAFE_INTEGER
    });
    await store.set(baseRecord('past', 'earlier text'));
    await store.set({ ...baseRecord('future', 'later text'), renderAt: 10_000 });

    await store.purgeFuture('content-1', 5_000);

    expect(await store.get('past')).toBeDefined();
    expect(await store.get('future')).toBeUndefined();
  });

  it('evicts least-recently-used entries when limits exceeded', async () => {
    const large = 'x'.repeat(200);
    const approxSize = new TextEncoder().encode(
      JSON.stringify(baseRecord('probe', large))
    ).byteLength;
    const store = createStore(`cache-test-${Math.random()}`, {
      maxContentBytes: approxSize * 10,
      maxGlobalBytes: approxSize * 2
    });

    await store.set(baseRecord('one', large));
    await store.set(baseRecord('two', large));
    await store.set(baseRecord('three', large));

    const first = await store.get('one');
    const second = await store.get('two');
    const third = await store.get('three');

    expect(first).toBeUndefined();
    expect(second).toBeDefined();
    expect(third).toBeDefined();
  });
});
