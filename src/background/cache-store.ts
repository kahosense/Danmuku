import { openDB, type IDBPDatabase, type IDBPTransaction } from 'idb';
import type { GeneratedComment } from '../shared/types';

interface CommentRecord extends GeneratedComment {
  cacheKey: string;
  contentId: string;
  personaId: string;
  cueId: string;
  promptHash?: string;
  promptVersion?: string;
  sceneTone?: string;
  sceneToneIntensity?: string;
  sceneToneConfidence?: number;
  sceneEnergy?: string;
  size: number;
  lastAccessed: number;
}

interface ContentMeta {
  contentId: string;
  size: number;
  updatedAt: number;
}

type CacheDB = IDBPDatabase<unknown>;

const DEFAULT_DB_NAME = 'netflix-ai-danmaku-cache';
const DB_VERSION = 1;
const COMMENT_STORE = 'comments';
const CONTENT_STORE = 'content';

const DEFAULT_MAX_CONTENT_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_GLOBAL_BYTES = 20 * 1024 * 1024;

const cloneValue = <T>(value: T): T =>
  typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));

function createMemoryOpenDb() {
  const dbRegistry = new Map<
    string,
    {
      comments: Map<string, CommentRecord>;
      contents: Map<string, ContentMeta>;
    }
  >();

  const ensureDb = (name: string) => {
    if (!dbRegistry.has(name)) {
      dbRegistry.set(name, {
        comments: new Map(),
        contents: new Map()
      });
    }
    return dbRegistry.get(name)!;
  };

  const makeCursor = (records: CommentRecord[], index: number, store: Map<string, CommentRecord>) => {
    if (index >= records.length) {
      return null;
    }
    const current = records[index];
    return {
      value: cloneValue(current),
      async delete() {
        store.delete(current.cacheKey);
      },
      async continue() {
        return makeCursor(records, index + 1, store);
      }
    };
  };

  return async (
    name: string,
    _version?: number,
    options?: Parameters<typeof openDB>[2]
  ) => {
    const db = ensureDb(name);
    if (options?.upgrade) {
      options.upgrade(
        {
          objectStoreNames: {
            contains: (storeName: string) => storeName === COMMENT_STORE || storeName === CONTENT_STORE
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
            if (storeName === COMMENT_STORE) {
              return {
                async get(key: string) {
                  const value = db.comments.get(key);
                  return value ? cloneValue(value) : undefined;
                },
                async put(value: CommentRecord) {
                  db.comments.set(value.cacheKey, cloneValue(value));
                },
                async clear() {
                  db.comments.clear();
                },
                async delete(key: string) {
                  db.comments.delete(key);
                },
                async getAll() {
                  return Array.from(db.comments.values()).map((entry) => cloneValue(entry));
                },
                index(indexName: string) {
                  if (indexName !== 'contentId') {
                    throw new Error(`Unsupported index ${indexName}`);
                  }
                  return {
                    async openCursor(contentId: string) {
                      const matches = Array.from(db.comments.values()).filter(
                        (entry) => entry.contentId === contentId
                      );
                      return makeCursor(matches.map((entry) => cloneValue(entry)), 0, db.comments);
                    }
                  };
                }
              };
            }

            if (storeName === CONTENT_STORE) {
              return {
                async get(key: string) {
                  const value = db.contents.get(key);
                  return value ? cloneValue(value) : undefined;
                },
                async put(value: ContentMeta) {
                  db.contents.set(value.contentId, cloneValue(value));
                },
                async delete(key: string) {
                  db.contents.delete(key);
                },
                async clear() {
                  db.contents.clear();
                },
                async getAll() {
                  return Array.from(db.contents.values()).map((entry) => cloneValue(entry));
                }
              };
            }

            throw new Error(`Unknown store ${storeName}`);
          },
          done: Promise.resolve()
        };
      }
    } as unknown as IDBPDatabase<unknown>;
  };
}

export interface CacheStoreOptions {
  dbName?: string;
  maxContentBytes?: number;
  maxGlobalBytes?: number;
}

export class CacheStore {
  #dbPromise: Promise<CacheDB>;
  #maxContentBytes: number;
  #maxGlobalBytes: number;
  #openDb: typeof openDB;

  constructor(options: CacheStoreOptions = {}, openDb: typeof openDB = openDB) {
    this.#maxContentBytes = options.maxContentBytes ?? DEFAULT_MAX_CONTENT_BYTES;
    this.#maxGlobalBytes = options.maxGlobalBytes ?? DEFAULT_MAX_GLOBAL_BYTES;
    this.#openDb =
      openDb === openDB && typeof indexedDB === 'undefined'
        ? (createMemoryOpenDb() as unknown as typeof openDB)
        : openDb;

    const dbName = options.dbName ?? DEFAULT_DB_NAME;
    this.#dbPromise = this.#openDb(dbName, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(COMMENT_STORE)) {
          const commentStore = db.createObjectStore(COMMENT_STORE, {
            keyPath: 'cacheKey'
          });
          commentStore.createIndex('contentId', 'contentId', { unique: false });
          commentStore.createIndex('personaId', 'personaId', { unique: false });
          commentStore.createIndex('renderAt', 'renderAt', { unique: false });
        }
        if (!db.objectStoreNames.contains(CONTENT_STORE)) {
          db.createObjectStore(CONTENT_STORE, {
            keyPath: 'contentId'
          });
        }
      }
    });
  }

  async get(cacheKey: string): Promise<CommentRecord | undefined> {
    const db = await this.#dbPromise;
    const tx = db.transaction([COMMENT_STORE, CONTENT_STORE], 'readwrite');
    const store = tx.objectStore(COMMENT_STORE);
    const record = (await store.get(cacheKey)) as CommentRecord | undefined;
    if (record) {
      record.lastAccessed = Date.now();
      await store.put(record);
      await this.#touchContentMeta(tx, record.contentId);
    }
    await tx.done;
    return record;
  }

  async set(record: Omit<CommentRecord, 'size' | 'lastAccessed'>) {
    const payload: CommentRecord = {
      ...record,
      size: this.#estimateSize(record),
      lastAccessed: Date.now()
    };

    const db = await this.#dbPromise;
    const tx = db.transaction([COMMENT_STORE, CONTENT_STORE], 'readwrite');
    const store = tx.objectStore(COMMENT_STORE);
    const existing = (await store.get(payload.cacheKey)) as CommentRecord | undefined;
    await store.put(payload);
    const delta = payload.size - (existing?.size ?? 0);
    await this.#adjustContentMeta(tx, payload.contentId, delta);
    await tx.done;

    await this.#enforceLimits();
  }

  async purgeFuture(contentId: string, timestamp: number) {
    const db = await this.#dbPromise;
    const tx = db.transaction([COMMENT_STORE, CONTENT_STORE], 'readwrite');
    const index = tx.objectStore(COMMENT_STORE).index('contentId');
    let cursor = await index.openCursor(contentId);

    let bytesRemoved = 0;
    while (cursor) {
      const record = cursor.value as CommentRecord;
      if (record.renderAt >= timestamp) {
        bytesRemoved += record.size;
        await cursor.delete();
      }
      cursor = await cursor.continue();
    }

    if (bytesRemoved > 0) {
      await this.#adjustContentMeta(tx, contentId, -bytesRemoved);
    }

    await tx.done;
  }

  async clearContent(contentId: string) {
    const db = await this.#dbPromise;
    const tx = db.transaction([COMMENT_STORE, CONTENT_STORE], 'readwrite');
    const index = tx.objectStore(COMMENT_STORE).index('contentId');
    let cursor = await index.openCursor(contentId);

    while (cursor) {
      await cursor.delete();
      cursor = await cursor.continue();
    }

    await tx.objectStore(CONTENT_STORE).delete(contentId);
    await tx.done;
  }

  async clearAll() {
    const db = await this.#dbPromise;
    const tx = db.transaction([COMMENT_STORE, CONTENT_STORE], 'readwrite');
    await tx.objectStore(COMMENT_STORE).clear();
    await tx.objectStore(CONTENT_STORE).clear();
    await tx.done;
  }

  async sizeReport(): Promise<{ global: number; contents: Record<string, number> }> {
    const db = await this.#dbPromise;
    const tx = db.transaction(CONTENT_STORE, 'readonly');
    const metaStore = tx.objectStore(CONTENT_STORE);
    const all = (await metaStore.getAll()) as ContentMeta[];
    const contents = all.reduce<Record<string, number>>((acc, meta) => {
      acc[meta.contentId] = meta.size;
      return acc;
    }, {});
    const global = all.reduce((sum, meta) => sum + meta.size, 0);
    await tx.done;
    return { global, contents };
  }

  #estimateSize(record: Omit<CommentRecord, 'size' | 'lastAccessed'>) {
    return new TextEncoder().encode(JSON.stringify(record)).byteLength;
  }

  async #adjustContentMeta(
    tx: IDBPTransaction<unknown, string[], 'readwrite'>,
    contentId: string,
    delta: number
  ) {
    const store = tx.objectStore(CONTENT_STORE);
    const current = ((await store.get(contentId)) as ContentMeta | undefined) ?? {
      contentId,
      size: 0,
      updatedAt: Date.now()
    };
    current.size = Math.max(0, current.size + delta);
    current.updatedAt = Date.now();
    if (current.size === 0) {
      await store.delete(contentId);
    } else {
      await store.put(current);
    }
  }

  async #touchContentMeta(
    tx: IDBPTransaction<unknown, string[], 'readwrite'>,
    contentId: string
  ) {
    const store = tx.objectStore(CONTENT_STORE);
    const current = (await store.get(contentId)) as ContentMeta | undefined;
    if (current) {
      current.updatedAt = Date.now();
      await store.put(current);
    }
  }

  async #enforceLimits() {
    const report = await this.sizeReport();

    if (report.global <= this.#maxGlobalBytes && this.#withinPerContent(report.contents)) {
      return;
    }

    const db = await this.#dbPromise;
    const tx = db.transaction([COMMENT_STORE, CONTENT_STORE], 'readwrite');
    const store = tx.objectStore(COMMENT_STORE);
    const all = (await store.getAll()) as CommentRecord[];
    const sorted = all.sort((a, b) => a.lastAccessed - b.lastAccessed);

    let globalSize = report.global;
    const contentSizes = { ...report.contents };

    for (const record of sorted) {
      if (
        globalSize <= this.#maxGlobalBytes &&
        Object.values(contentSizes).every((size) => size <= this.#maxContentBytes)
      ) {
        break;
      }

      await store.delete(record.cacheKey);
      globalSize -= record.size;
      contentSizes[record.contentId] = Math.max(0, (contentSizes[record.contentId] ?? 0) - record.size);
      if (contentSizes[record.contentId] === 0) {
        delete contentSizes[record.contentId];
      }
    }

    const metaStore = tx.objectStore(CONTENT_STORE);
    for (const [contentId, size] of Object.entries(contentSizes)) {
      if (size === 0) {
        await metaStore.delete(contentId);
      } else {
        await metaStore.put({ contentId, size, updatedAt: Date.now() });
      }
    }

    await tx.done;
  }

  #withinPerContent(entries: Record<string, number>) {
    return Object.values(entries).every((size) => size <= this.#maxContentBytes);
  }
}

const defaultOpenDb =
  typeof indexedDB === 'undefined'
    ? (createMemoryOpenDb() as unknown as typeof openDB)
    : openDB;

export const cacheStore = new CacheStore({}, defaultOpenDb);

export type { CommentRecord as CachedCommentRecord };
