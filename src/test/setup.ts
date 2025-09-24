import { vi } from 'vitest';

const runtime = {
  sendMessage: vi.fn((_message: unknown, callback?: (response?: unknown) => void) => {
    callback?.(undefined);
  }),
  lastError: undefined,
  onMessage: {
    addListener: vi.fn()
  },
  onInstalled: {
    addListener: vi.fn()
  },
  getPlatformInfo: vi.fn((callback?: (info: unknown) => void) => {
    callback?.({});
  }),
  onConnect: {
    addListener: vi.fn()
  }
};

const tabs = {
  sendMessage: vi.fn(() => Promise.resolve(undefined)),
  onRemoved: {
    addListener: vi.fn()
  }
};

const alarms = {
  create: vi.fn(),
  onAlarm: {
    addListener: vi.fn()
  }
};

const storage = {
  local: {
    get: vi.fn(() => Promise.resolve({})),
    set: vi.fn(() => Promise.resolve()),
    clear: vi.fn(() => Promise.resolve())
  }
};

const chromeGlobal: any = globalThis.chrome ?? {};

chromeGlobal.runtime = runtime;
chromeGlobal.tabs = tabs;
chromeGlobal.alarms = alarms;
chromeGlobal.storage = storage;

globalThis.chrome = chromeGlobal;
