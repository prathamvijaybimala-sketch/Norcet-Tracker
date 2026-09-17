/**
 * IndexedDB persistence (section 7).
 *
 * IndexedDB (via `idb`) rather than localStorage: progress for ~1000 lectures
 * plus the full curriculum tree can get big enough that synchronous
 * localStorage writes start to hurt. Writes are debounced (400ms) so rapid
 * checkbox clicking doesn't thrash the database, and are flushed on tab hide so
 * a closed tab never loses the last few changes.
 */

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { PlanConfig, ProgressStore, RevisionStore, Subject } from '../types';

const DB_NAME = 'norcet-tracker';
const DB_VERSION = 1;
const STORE = 'kv';

/** Namespaced keys (section 7). */
export const KEYS = {
  curriculum: 'curriculum',
  planConfig: 'planConfig',
  progress: 'progress',
  revision: 'revision',
  settings: 'settings',
} as const;

export type StorageKey = (typeof KEYS)[keyof typeof KEYS];

interface NorcetDB extends DBSchema {
  kv: {
    key: StorageKey;
    value: unknown;
  };
}

/** Small per-device preferences that are not part of the export payload. */
export type AppSettings = {
  theme: 'dark' | 'light';
  /** SHA-256 hash of the plan-screen password (see lib/lock.ts), or null. */
  planLockHash: string | null;
  /** Streak milestones (5, 10, 15, ...) whose congratulations box was already shown. */
  streakMilestonesSeen: number[];
};

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  planLockHash: null,
  streakMilestonesSeen: [],
};

export function normalizeSettings(value: unknown): AppSettings {
  if (typeof value !== 'object' || value === null) return { ...DEFAULT_SETTINGS };
  const v = value as Record<string, unknown>;
  return {
    theme: v.theme === 'light' ? 'light' : 'dark',
    planLockHash: typeof v.planLockHash === 'string' && v.planLockHash.length > 0 ? v.planLockHash : null,
    streakMilestonesSeen: Array.isArray(v.streakMilestonesSeen)
      ? v.streakMilestonesSeen.filter(
          (n): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 5,
        )
      : [],
  };
}

let dbPromise: Promise<IDBPDatabase<NorcetDB>> | null = null;
let warnedAboutFallback = false;

function getDB(): Promise<IDBPDatabase<NorcetDB>> {
  if (!dbPromise) {
    dbPromise = openDB<NorcetDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      },
    });
  }
  return dbPromise;
}

/* --------------------------- localStorage fallback ---------------------------
 * IndexedDB is the primary store, but it can be unavailable (private browsing,
 * blocked storage, non-browser test environments). Rather than losing data
 * silently on write, fall back to localStorage for the handful of keys we keep.
 */

const LOCAL_PREFIX = 'norcet:';

function readLocal<T>(key: StorageKey): T | undefined {
  try {
    const raw = localStorage.getItem(LOCAL_PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}

function writeLocal<T>(key: StorageKey, value: T): void {
  try {
    localStorage.setItem(LOCAL_PREFIX + key, JSON.stringify(value));
  } catch (err) {
    console.error('[storage] localStorage write failed', key, err);
  }
}

/**
 * Reads go to IndexedDB when it is available and to the localStorage
 * fallback when it is not - the SAME backend is used for every key, so a
 * key can never be split across the two stores. (The remaining trade-off:
 * writes made while IndexedDB is DOWN land in localStorage and are not
 * merged back if IndexedDB recovers later; that outage mode is rare on the
 * Capacitor WebView and acceptable for this app.)
 */
export async function readKey<T>(key: StorageKey): Promise<T | undefined> {
  try {
    const db = await getDB();
    return (await db.get(STORE, key)) as T | undefined;
  } catch (err) {
    if (!warnedAboutFallback) {
      warnedAboutFallback = true;
      console.warn('[storage] IndexedDB unavailable; falling back to localStorage', err);
    }
    return readLocal<T>(key);
  }
}

export type PersistedState = {
  curriculum?: Subject[];
  planConfig?: PlanConfig;
  progress?: ProgressStore;
  revision?: RevisionStore;
  settings?: AppSettings;
};

export async function loadAll(): Promise<PersistedState> {
  const [curriculum, planConfig, progress, revision, settings] = await Promise.all([
    readKey<Subject[]>(KEYS.curriculum),
    readKey<PlanConfig>(KEYS.planConfig),
    readKey<ProgressStore>(KEYS.progress),
    readKey<RevisionStore>(KEYS.revision),
    readKey<AppSettings>(KEYS.settings),
  ]);
  return { curriculum, planConfig, progress, revision, settings: normalizeSettings(settings) };
}

/* --------------------------- debounced writes --------------------------- */

const WRITE_DEBOUNCE_MS = 400;
const pending = new Map<StorageKey, unknown>();
let timer: ReturnType<typeof setTimeout> | null = null;
let flushPromise: Promise<void> = Promise.resolve();

async function performFlush(): Promise<void> {
  if (pending.size === 0) return;
  const batch = Array.from(pending.entries());
  pending.clear();
  try {
    const db = await getDB();
    const tx = db.transaction(STORE, 'readwrite');
    for (const [key, value] of batch) tx.store.put(value, key);
    await tx.done;
  } catch (err) {
    if (!warnedAboutFallback) {
      warnedAboutFallback = true;
      console.warn('[storage] IndexedDB unavailable; falling back to localStorage', err);
    }
    for (const [key, value] of batch) writeLocal(key, value);
  }
}

function scheduleFlush(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    // CHAIN onto any in-flight flush: on a slow IndexedDB a later batch must
    // never commit before an earlier one (stale value would win).
    flushPromise = flushPromise.then(performFlush);
  }, WRITE_DEBOUNCE_MS);
}

/** Queue a debounced write. Safe to call on every state change. */
export function saveKeyDebounced<T>(key: StorageKey, value: T): void {
  pending.set(key, value);
  scheduleFlush();
}

/** Write everything queued right now (used on tab hide / before export). */
export function flushWrites(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  flushPromise = flushPromise.then(performFlush);
  return flushPromise;
}

export async function clearAll(): Promise<void> {
  pending.clear();
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  try {
    localStorage.removeItem(LOCAL_PREFIX + KEYS.curriculum);
    localStorage.removeItem(LOCAL_PREFIX + KEYS.planConfig);
    localStorage.removeItem(LOCAL_PREFIX + KEYS.progress);
    localStorage.removeItem(LOCAL_PREFIX + KEYS.revision);
    localStorage.removeItem(LOCAL_PREFIX + KEYS.settings);
  } catch {
    /* ignore */
  }
  try {
    const db = await getDB();
    await db.clear(STORE);
  } catch (err) {
    console.warn('[storage] IndexedDB clear failed', err);
  }
}

if (typeof window !== 'undefined') {
  // Never lose the last few checkbox ticks when the tab goes away.
  window.addEventListener('pagehide', () => void flushWrites());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flushWrites();
  });
}
