/**
 * Shared sessionStorage + localStorage cache used by the dashboard/analytics caches.
 *
 * - sessionStorage entries are trusted at any age (same tab, same session).
 * - localStorage entries are only returned while younger than the caller's max age,
 *   so other tabs/users get instant paint without serving stale financial numbers.
 * - Each store keeps only the newest `maxEntries` keys.
 * - Storage failures (quota, private mode, corrupt JSON) are swallowed.
 */

type CacheStore<T> = Record<string, { at: number; data: T }>;

function readCacheStore<T>(storage: Storage, storageKey: string): CacheStore<T> | null {
  try {
    const raw = storage.getItem(storageKey);
    if (!raw) return null;
    return JSON.parse(raw) as CacheStore<T>;
  } catch {
    return null;
  }
}

function pruneCacheStore<T>(store: CacheStore<T>, maxEntries: number): CacheStore<T> {
  const keys = Object.entries(store)
    .sort(([, a], [, b]) => b.at - a.at)
    .map(([k]) => k);
  for (const k of keys.slice(maxEntries)) {
    delete store[k];
  }
  return store;
}

export type TwoTierCache<T> = {
  /**
   * Session entry if present and accepted, else local entry no older than
   * `maxLocalAgeMs` (and accepted). A rejected session entry falls through to local.
   */
  read(key: string, maxLocalAgeMs: number, accept?: (data: T) => boolean): T | null;
  /** Age of the entry in ms (session first, then local), or null if missing. */
  ageMs(key: string): number | null;
  write(key: string, data: T): void;
};

export function createTwoTierCache<T>(options: {
  sessionKey: string;
  localKey: string;
  maxEntries: number;
}): TwoTierCache<T> {
  const { sessionKey, localKey, maxEntries } = options;
  // Storage is resolved lazily: merely touching sessionStorage can throw in sandboxed contexts.
  const tiers: [() => Storage, string][] = [
    [() => sessionStorage, sessionKey],
    [() => localStorage, localKey],
  ];

  return {
    read(key, maxLocalAgeMs, accept = () => true) {
      try {
        const sessionEntry = readCacheStore<T>(sessionStorage, sessionKey)?.[key];
        if (sessionEntry?.data != null && accept(sessionEntry.data)) {
          return sessionEntry.data;
        }
      } catch {
        // sessionStorage unavailable — fall through to localStorage
      }

      try {
        const localEntry = readCacheStore<T>(localStorage, localKey)?.[key];
        if (localEntry?.data == null) return null;
        if (Date.now() - localEntry.at > maxLocalAgeMs) return null;
        return accept(localEntry.data) ? localEntry.data : null;
      } catch {
        return null;
      }
    },

    ageMs(key) {
      const now = Date.now();
      for (const [getStorage, storageKey] of tiers) {
        try {
          const entry = readCacheStore<T>(getStorage(), storageKey)?.[key];
          if (entry?.data != null && typeof entry.at === 'number') {
            return Math.max(0, now - entry.at);
          }
        } catch {
          // ignore
        }
      }
      return null;
    },

    write(key, data) {
      const entry = { at: Date.now(), data };
      for (const [getStorage, storageKey] of tiers) {
        try {
          const storage = getStorage();
          const store = readCacheStore<T>(storage, storageKey) ?? {};
          store[key] = entry;
          storage.setItem(storageKey, JSON.stringify(pruneCacheStore(store, maxEntries)));
        } catch {
          // storage full or unavailable — ignore
        }
      }
    },
  };
}
