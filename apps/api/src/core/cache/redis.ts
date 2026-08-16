/**
 * Redis connection and cache helpers.
 *
 * Redis carries three distinct workloads here (PRD 8.1: "Cache & Streams —
 * also buffers live location events"):
 *   1. Response/query caching with tag-based invalidation.
 *   2. Last-known vehicle position, read by the live map on every subscribe.
 *   3. Socket.IO fan-out across API replicas.
 */

import { Redis } from 'ioredis';
import { env } from '../../config/env.js';
import { moduleLogger } from '../logger.js';
import { MemoryRedis } from './memoryRedis.js';

const log = moduleLogger('redis');

/**
 * The subset of Redis this codebase uses, declared structurally rather than as
 * `Pick<Redis, …>` — ioredis's overloaded signatures (notably `SET … NX`,
 * which can return null) do not narrow cleanly through `Pick`.
 *
 * Both the real client and the in-memory fallback satisfy this, so call sites
 * never branch on which one is active.
 */
export interface RedisLike {
  get(key: string): Promise<string | null>;
  /** Trailing args carry option flags, e.g. `('k', 'v', 'PX', 30000, 'NX')`. */
  set(key: string, value: string, ...args: Array<string | number>): Promise<'OK' | null>;
  setex(key: string, seconds: number, value: string): Promise<'OK'>;
  del(...keys: string[]): Promise<number>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  ttl(key: string): Promise<number>;
  ping(): Promise<string>;
  lpush(key: string, ...values: string[]): Promise<number>;
  ltrim(key: string, start: number, stop: number): Promise<'OK'>;
  lrange(key: string, start: number, stop: number): Promise<string[]>;
  sadd(key: string, ...members: string[]): Promise<number>;
  smembers(key: string): Promise<string[]>;
  pipeline(): RedisPipelineLike;
  call(command: string, ...args: string[]): Promise<unknown>;
  quit(): Promise<string>;
}

/** Chainable command queue, executed together by `exec()`. */
export interface RedisPipelineLike {
  set(key: string, value: string, ...args: Array<string | number>): RedisPipelineLike;
  setex(key: string, seconds: number, value: string): RedisPipelineLike;
  del(...keys: string[]): RedisPipelineLike;
  expire(key: string, seconds: number): RedisPipelineLike;
  sadd(key: string, ...members: string[]): RedisPipelineLike;
  lpush(key: string, ...values: string[]): RedisPipelineLike;
  ltrim(key: string, start: number, stop: number): RedisPipelineLike;
  exec(): Promise<unknown>;
}

function createClient(label: string): Redis {
  const client = new Redis(env.REDIS_URL, {
    keyPrefix: env.REDIS_KEY_PREFIX,
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    // Exponential-ish backoff, capped so a long outage does not hot-loop.
    retryStrategy: (times) => Math.min(times * 200, 5000),
    lazyConnect: true,
  });

  client.on('error', (err) => log.debug({ err: err.message, label }, 'Redis error'));
  client.on('connect', () => log.info({ label }, 'Redis connected'));
  client.on('reconnecting', () => log.warn({ label }, 'Redis reconnecting'));

  return client;
}

/**
 * `let` rather than `const`: ESM live bindings mean reassigning these inside
 * `connectRedis` is visible to every module that imported them, which is how
 * the fallback swaps in without every call site knowing.
 */
export let redis: RedisLike = new MemoryRedis();

/**
 * Socket.IO's Redis adapter needs its own pub/sub pair — a client in
 * subscriber mode cannot run normal commands.
 */
export let redisPub: Redis | null = null;
export let redisSub: Redis | null = null;

/** True when running on the in-memory shim rather than a real Redis. */
export let usingMemoryFallback = true;

export async function connectRedis(): Promise<void> {
  const main = createClient('main');
  const pub = createClient('pub');
  const sub = createClient('sub');

  try {
    // Fail fast: a missing Redis should degrade in seconds, not hang startup.
    await Promise.all([
      withTimeout(main.connect(), 5000),
      withTimeout(pub.connect(), 5000),
      withTimeout(sub.connect(), 5000),
    ]);

    // ioredis's heavily overloaded signatures (optional trailing callbacks)
    // do not structurally match RedisLike, though every command we call
    // behaves identically. The cast is confined to this one line.
    redis = main as unknown as RedisLike;
    redisPub = pub;
    redisSub = sub;
    usingMemoryFallback = false;
  } catch (err) {
    // Tear down the half-open clients so they stop retrying in the background.
    for (const client of [main, pub, sub]) {
      client.removeAllListeners();
      client.disconnect();
    }

    redis = new MemoryRedis();
    redisPub = null;
    redisSub = null;
    usingMemoryFallback = true;

    log.warn(
      { url: env.REDIS_URL, reason: err instanceof Error ? err.message : String(err) },
      'Redis unavailable — falling back to in-memory cache. Single process only: ' +
        'rate limits, geofence state and live positions will NOT be shared across replicas.',
    );
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms).unref(),
    ),
  ]);
}

export async function disconnectRedis(): Promise<void> {
  await Promise.all([
    redis.quit().catch(() => undefined),
    redisPub?.quit().catch(() => undefined),
    redisSub?.quit().catch(() => undefined),
  ]);
  log.info('Redis disconnected');
}

export async function redisHealthy(): Promise<boolean> {
  try {
    return (await redis.ping()) === 'PONG';
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Key namespace
// ---------------------------------------------------------------------------

/**
 * Centralised key builders. Every key is tenant-scoped so a cache entry can
 * never bleed across institutions.
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
  dashboard: (tenantId: string, role: string, branchId: string | null) =>
    `dash:${tenantId}:${role}:${branchId ?? 'all'}`,
  tag: (tenantId: string, tag: string) => `tag:${tenantId}:${tag}`,
  idempotency: (key: string) => `idem:${key}`,
} as const;

// ---------------------------------------------------------------------------
// JSON cache with tag invalidation
// ---------------------------------------------------------------------------

export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const raw = await redis.get(key);
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
      await redis.setex(key, ttlSeconds, payload);
      return;
    }

    // Register the key against each tag so a later `cacheInvalidateTag` can
    // find and drop it without scanning the whole keyspace.
    const pipeline = redis.pipeline();
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
    const members = await redis.smembers(tag);
    if (members.length === 0) return;

    // `keyPrefix` is applied automatically on write but the members we stored
    // are already unprefixed keys, so deleting them round-trips correctly.
    const pipeline = redis.pipeline();
    for (const key of members) pipeline.del(key);
    pipeline.del(tag);
    await pipeline.exec();
  } catch (err) {
    log.warn({ err, tag }, 'Cache invalidation failed');
  }
}

/** Read-through helper: return the cached value or compute, store and return. */
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
