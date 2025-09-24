import type { UserPreferences } from './types';

export const DEFAULT_PERSONA_STATE = {
  alex: true,
  jordan: true,
  sam: true,
  casey: true
} as const;

export const DEFAULT_PREFERENCES: UserPreferences = {
  globalEnabled: true,
  density: 'medium',
  personaEnabled: { ...DEFAULT_PERSONA_STATE },
  developerMode: false,
  lastUpdated: Date.now()
};

const STORAGE_KEY = 'netflix-ai-danmaku::preferences';

type PreferencesChangeCallback = (prefs: UserPreferences) => void;

class PreferenceStore {
  #cache: UserPreferences | null = null;
  #listeners = new Set<PreferencesChangeCallback>();

  async get(): Promise<UserPreferences> {
    if (this.#cache) {
      return this.#cache;
    }

    const stored = await chrome.storage.local.get(STORAGE_KEY);
    if (stored?.[STORAGE_KEY]) {
      this.#cache = stored[STORAGE_KEY] as UserPreferences;
      return this.#cache;
    }

    this.#cache = DEFAULT_PREFERENCES;
    await this.set(DEFAULT_PREFERENCES);
    return this.#cache;
  }

  async set(preferences: UserPreferences) {
    this.#cache = { ...preferences, lastUpdated: Date.now() };
    await chrome.storage.local.set({ [STORAGE_KEY]: this.#cache });
    this.#notify();
  }

  async update(partial: Partial<UserPreferences>) {
    const current = await this.get();
    const merged: UserPreferences = {
      ...current,
      ...partial,
      personaEnabled: {
        ...current.personaEnabled,
        ...partial.personaEnabled
      },
      lastUpdated: Date.now()
    };
    await this.set(merged);
  }

  subscribe(callback: PreferencesChangeCallback) {
    this.#listeners.add(callback);
    return () => this.#listeners.delete(callback);
  }

  #notify() {
    if (!this.#cache) {
      return;
    }
    this.#listeners.forEach((listener) => listener(this.#cache!));
  }
}

export const preferenceStore = new PreferenceStore();
