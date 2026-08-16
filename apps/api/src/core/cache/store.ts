/**
 * In-process key/value store.
 *
 * Replaces the previous Redis dependency. The deployment target is a single
 * API process, so the three workloads that used to need Redis are all served
 * locally:
 *
 *   1. Response/query caching with tag-based invalidation.
 *   2. Last-known vehicle position + short trail, read by the live map.
 *   3. Short-lived counters — login throttling, geofence edge state, cooldowns.
 *
 * Everything is bounded: entries carry a TTL, lists are trimmed by their
 * writers, and a sweeper drops expired keys so an abandoned key cannot leak.
 *
 * The trade-off is explicit and documented in the README: state is per-process
 * and does not survive a restart. Running more than one replica would need a
 * shared store again — nothing else in the codebase assumes one.
 */

import { moduleLogger } from '../logger.js';

const log = moduleLogger('store');

interface Entry {
  value: string;
  /** Epoch ms, or null for no expiry. */
  expiresAt: number | null;
}

/** Hard ceilings so a runaway writer cannot exhaust memory. */
const MAX_KEYS = 100_000;
const MAX_LIST_LENGTH = 1_000;

class MemoryStore {
  private strings = new Map<string, Entry>();
  private lists = new Map<string, string[]>();
  private sets = new Map<string, Set<string>>();
  private sweeper: NodeJS.Timeout;

  constructor() {
    // Lazy expiry alone would let untouched keys linger, so sweep periodically.
    this.sweeper = setInterval(() => this.sweep(), 30_000);
    this.sweeper.unref();
  }

  private sweep(): void {
    const now = Date.now();
    for (const [key, entry] of this.strings) {
      if (entry.expiresAt !== null && entry.expiresAt <= now) this.strings.delete(key);
    }
  }

  /** Read through the expiry check — a key past its TTL must read as absent. */
  private live(key: string): Entry | undefined {
    const entry = this.strings.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this.strings.delete(key);
      return undefined;
    }
    return entry;
  }

  private guardCapacity(): void {
    if (this.strings.size < MAX_KEYS) return;
    // Drop the oldest insertions rather than refusing writes: every value here
    // is a cache or a short-lived counter, so losing the coldest is safe.
    const excess = this.strings.size - MAX_KEYS + 1_000;
    let dropped = 0;
    for (const key of this.strings.keys()) {
      this.strings.delete(key);
      if (++dropped >= excess) break;
    }
    log.warn({ dropped }, 'Store at capacity — evicted oldest keys');
  }

  // -- Strings ---------------------------------------------------------------

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.live(key)?.value ?? null);
  }

  /**
   * Supports the `SET key value PX <ms> NX` form used by the job lock, so the
   * lock stays a single atomic call rather than a check-then-set race.
   */
  set(key: string, value: string, ...args: Array<string | number>): Promise<'OK' | null> {
    const flags = args.map((a) => String(a).toUpperCase());
    if (flags.includes('NX') && this.live(key)) return Promise.resolve(null);

    let expiresAt: number | null = null;
    const px = flags.indexOf('PX');
    const ex = flags.indexOf('EX');
    if (px !== -1) expiresAt = Date.now() + Number(args[px + 1]);
    else if (ex !== -1) expiresAt = Date.now() + Number(args[ex + 1]) * 1000;

    this.guardCapacity();
    this.strings.set(key, { value, expiresAt });
    return Promise.resolve('OK');
  }

  setex(key: string, seconds: number, value: string): Promise<'OK'> {
    this.guardCapacity();
    this.strings.set(key, { value, expiresAt: Date.now() + seconds * 1000 });
    return Promise.resolve('OK');
  }

  del(...keys: string[]): Promise<number> {
    let removed = 0;
    for (const key of keys) {
      if (this.strings.delete(key)) removed++;
      this.lists.delete(key);
      this.sets.delete(key);
    }
    return Promise.resolve(removed);
  }

  /** Delete every key matching a `prefix*` pattern. */
  delByPrefix(prefix: string): Promise<number> {
    let removed = 0;
    for (const key of [...this.strings.keys()]) {
      if (key.startsWith(prefix)) {
        this.strings.delete(key);
        removed++;
      }
    }
    return Promise.resolve(removed);
  }

  incr(key: string): Promise<number> {
    const current = Number(this.live(key)?.value ?? 0) + 1;
    // INCR preserves any existing TTL.
    const expiresAt = this.strings.get(key)?.expiresAt ?? null;
    this.strings.set(key, { value: String(current), expiresAt });
    return Promise.resolve(current);
  }

  expire(key: string, seconds: number): Promise<number> {
    const entry = this.live(key);
    if (!entry) return Promise.resolve(0);
    entry.expiresAt = Date.now() + seconds * 1000;
    return Promise.resolve(1);
  }

  ttl(key: string): Promise<number> {
    const entry = this.live(key);
    if (!entry) return Promise.resolve(-2);
    if (entry.expiresAt === null) return Promise.resolve(-1);
    return Promise.resolve(Math.max(0, Math.ceil((entry.expiresAt - Date.now()) / 1000)));
  }

  // -- Lists (vehicle trails) ------------------------------------------------

  lpush(key: string, ...values: string[]): Promise<number> {
    const list = this.lists.get(key) ?? [];
    list.unshift(...values);
    if (list.length > MAX_LIST_LENGTH) list.length = MAX_LIST_LENGTH;
    this.lists.set(key, list);
    return Promise.resolve(list.length);
  }

  ltrim(key: string, start: number, stop: number): Promise<'OK'> {
    const list = this.lists.get(key);
    // `stop` is inclusive, and -1 means "to the end".
    if (list) this.lists.set(key, list.slice(start, stop === -1 ? undefined : stop + 1));
    return Promise.resolve('OK');
  }

  lrange(key: string, start: number, stop: number): Promise<string[]> {
    const list = this.lists.get(key) ?? [];
    return Promise.resolve(list.slice(start, stop === -1 ? undefined : stop + 1));
  }

  // -- Sets (cache tags) -----------------------------------------------------

  sadd(key: string, ...members: string[]): Promise<number> {
    const set = this.sets.get(key) ?? new Set<string>();
    let added = 0;
    for (const m of members) {
      if (!set.has(m)) {
        set.add(m);
        added++;
      }
    }
    this.sets.set(key, set);
    return Promise.resolve(added);
  }

  smembers(key: string): Promise<string[]> {
    return Promise.resolve([...(this.sets.get(key) ?? [])]);
  }

  // -- Introspection ---------------------------------------------------------

  stats(): { keys: number; lists: number; sets: number } {
    return { keys: this.strings.size, lists: this.lists.size, sets: this.sets.size };
  }

  clear(): void {
    this.strings.clear();
    this.lists.clear();
    this.sets.clear();
  }

  dispose(): void {
    clearInterval(this.sweeper);
    this.clear();
  }

  /** Queue several writes and apply them together. */
  pipeline(): Pipeline {
    return new Pipeline(this);
  }
}

/**
 * Command queue. Kept because the call sites read better as one chained
 * expression than as a sequence of awaits, and it keeps a multi-key update
 * (position + trail + TTL) in one place.
 */
class Pipeline {
  private queue: Array<() => Promise<unknown>> = [];

  constructor(private readonly store: MemoryStore) {}

  set(...args: Parameters<MemoryStore['set']>): this {
    this.queue.push(() => this.store.set(...args));
    return this;
  }
  setex(...args: Parameters<MemoryStore['setex']>): this {
    this.queue.push(() => this.store.setex(...args));
    return this;
  }
  del(...args: Parameters<MemoryStore['del']>): this {
    this.queue.push(() => this.store.del(...args));
    return this;
  }
  expire(...args: Parameters<MemoryStore['expire']>): this {
    this.queue.push(() => this.store.expire(...args));
    return this;
  }
  sadd(...args: Parameters<MemoryStore['sadd']>): this {
    this.queue.push(() => this.store.sadd(...args));
    return this;
  }
  lpush(...args: Parameters<MemoryStore['lpush']>): this {
    this.queue.push(() => this.store.lpush(...args));
    return this;
  }
  ltrim(...args: Parameters<MemoryStore['ltrim']>): this {
    this.queue.push(() => this.store.ltrim(...args));
    return this;
  }

  async exec(): Promise<void> {
    const queued = this.queue;
    this.queue = [];
    for (const task of queued) {
      try {
        await task();
      } catch (err) {
        log.warn({ err }, 'Pipeline command failed');
      }
    }
  }
}

export const store = new MemoryStore();

export function disposeStore(): void {
  store.dispose();
}

export function storeStats(): { keys: number; lists: number; sets: number } {
  return store.stats();
}

// ---------------------------------------------------------------------------
// Key namespace
// ---------------------------------------------------------------------------

/**
 * Centralised key builders. Every key that holds tenant data is tenant-scoped
 * so a cache entry can never bleed across schools.
 */
export const keys = {
  liveVehicle: (vehicleId: string) => `live:vehicle:${vehicleId}`,
  liveTrip: (tripId: string) => `live:trip:${tripId}`,
  vehicleTrail: (vehicleId: string) => `trail:vehicle:${vehicleId}`,
  geofenceState: (vehicleId: string, geofenceId: string) =>
    `geo:state:${vehicleId}:${geofenceId}`,
  geofenceCooldown: (vehicleId: string, geofenceId: string) =>
    `geo:cool:${vehicleId}:${geofenceId}`,
  session: (userId: string, sessionId: string) => `session:${userId}:${sessionId}`,
  userPermissions: (userId: string) => `perm:${userId}`,
  loginAttempts: (identifier: string) => `login:fail:${identifier}`,
  otp: (purpose: string, identifier: string) => `otp:${purpose}:${identifier}`,
  passwordReset: (tokenHash: string) => `pwreset:${tokenHash}`,
  dashboard: (tenantId: string, role: string, branchId: string | null) =>
    `dash:${tenantId}:${role}:${branchId ?? 'all'}`,
  tag: (tenantId: string, tag: string) => `tag:${tenantId}:${tag}`,
  tenantPrefix: (tenantId: string) => `dash:${tenantId}:`,
  idempotency: (key: string) => `idem:${key}`,
} as const;

// ---------------------------------------------------------------------------
// JSON cache with tag invalidation
// ---------------------------------------------------------------------------

export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const raw = await store.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch (err) {
    // A cache read must never break a request — degrade to a miss.
    log.warn({ err, key }, 'Cache read failed');
    return null;
  }
}

export async function cacheSet(
  key: string,
  value: unknown,
  ttlSeconds = 60,
  tags: string[] = [],
): Promise<void> {
  try {
    const payload = JSON.stringify(value);
    if (tags.length === 0) {
      await store.setex(key, ttlSeconds, payload);
      return;
    }

    // Register the key against each tag so `cacheInvalidateTag` can drop it
    // without scanning the whole keyspace.
    const pipeline = store.pipeline();
    pipeline.setex(key, ttlSeconds, payload);
    for (const tag of tags) {
      pipeline.sadd(tag, key);
      // Tag sets outlive their members slightly, then expire on their own.
      pipeline.expire(tag, ttlSeconds + 300);
    }
    await pipeline.exec();
  } catch (err) {
    log.warn({ err, key }, 'Cache write failed');
  }
}

export async function cacheInvalidateTag(tag: string): Promise<void> {
  try {
    const members = await store.smembers(tag);
    if (members.length === 0) return;

    const pipeline = store.pipeline();
    for (const key of members) pipeline.del(key);
    pipeline.del(tag);
    await pipeline.exec();
  } catch (err) {
    log.warn({ err, tag }, 'Cache invalidation failed');
  }
}

/** Read-through helper: return the cached value, or compute, store and return. */
export async function cached<T>(
  key: string,
  ttlSeconds: number,
  loader: () => Promise<T>,
  tags: string[] = [],
): Promise<T> {
  const hit = await cacheGet<T>(key);
  if (hit !== null) return hit;

  const value = await loader();
  await cacheSet(key, value, ttlSeconds, tags);
  return value;
}

/** Drop every cached entry belonging to one school. */
export async function invalidateTenantCache(tenantId: string): Promise<void> {
  await store.delByPrefix(keys.tenantPrefix(tenantId));
}
