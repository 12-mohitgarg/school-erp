/**
 * The in-process store that replaced Redis.
 *
 * Three behaviours matter, because live code depends on each of them being
 * exactly right rather than approximately right:
 *
 *   * TTL expiry — a key past its deadline must read as absent, or a login
 *     lockout would never lift.
 *   * `SET … NX` atomicity — the scheduler's guard against overlapping runs.
 *   * List trimming — the vehicle trail is appended to every twelve seconds
 *     per bus, forever, so an untrimmed list is an unbounded memory leak.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cacheGet, cacheInvalidateTag, cacheSet, cached, keys, store } from './store.js';

afterEach(() => {
  store.clear();
  vi.useRealTimers();
});

describe('strings and TTL', () => {
  it('round-trips a value', async () => {
    await store.set('k', 'v');
    expect(await store.get('k')).toBe('v');
  });

  it('returns null for a key that was never set', async () => {
    expect(await store.get('nope')).toBeNull();
  });

  it('treats a key past its TTL as absent', async () => {
    vi.useFakeTimers();

    await store.setex('k', 60, 'v');
    expect(await store.get('k')).toBe('v');

    vi.advanceTimersByTime(61_000);
    expect(await store.get('k')).toBeNull();
  });

  it('reports remaining TTL, and -2 once gone', async () => {
    vi.useFakeTimers();

    await store.setex('k', 60, 'v');
    expect(await store.ttl('k')).toBeGreaterThan(55);

    vi.advanceTimersByTime(61_000);
    expect(await store.ttl('k')).toBe(-2);
  });

  it('preserves an existing TTL across incr', async () => {
    // Login throttling depends on this: each failed attempt increments the
    // counter but must not push the lockout window further away.
    vi.useFakeTimers();

    await store.setex('attempts', 900, '1');
    await store.incr('attempts');
    await store.incr('attempts');

    expect(await store.get('attempts')).toBe('3');
    expect(await store.ttl('attempts')).toBeGreaterThan(880);
  });

  it('counts from zero when incrementing a missing key', async () => {
    expect(await store.incr('fresh')).toBe(1);
  });
});

describe('SET NX — the job lock', () => {
  it('grants the lock once and refuses it while held', async () => {
    expect(await store.set('job:lock', 'a', 'PX', 60_000, 'NX')).toBe('OK');
    expect(await store.set('job:lock', 'b', 'PX', 60_000, 'NX')).toBeNull();
    // The original holder's value must survive the failed attempt.
    expect(await store.get('job:lock')).toBe('a');
  });

  it('grants it again once the lock expires', async () => {
    vi.useFakeTimers();

    await store.set('job:lock', 'a', 'PX', 1_000, 'NX');
    vi.advanceTimersByTime(1_500);

    expect(await store.set('job:lock', 'b', 'PX', 1_000, 'NX')).toBe('OK');
  });
});

describe('lists — the vehicle trail', () => {
  it('prepends newest-first and trims to the requested length', async () => {
    for (let i = 0; i < 10; i++) await store.lpush('trail', String(i));
    await store.ltrim('trail', 0, 4);

    expect(await store.lrange('trail', 0, -1)).toEqual(['9', '8', '7', '6', '5']);
  });

  it('caps growth even when a writer never trims', async () => {
    // A driver app that pushes without trimming must not be able to exhaust
    // memory; the hard ceiling is the backstop.
    for (let i = 0; i < 1_500; i++) await store.lpush('runaway', String(i));

    const all = await store.lrange('runaway', 0, -1);
    expect(all.length).toBeLessThanOrEqual(1_000);
    expect(all[0]).toBe('1499');
  });
});

describe('JSON cache with tag invalidation', () => {
  it('stores and reads structured values', async () => {
    await cacheSet('obj', { a: 1, nested: { b: [1, 2] } }, 60);
    expect(await cacheGet('obj')).toEqual({ a: 1, nested: { b: [1, 2] } });
  });

  it('drops every key registered under a tag', async () => {
    const tag = keys.tag('tenant-1', 'students');

    await cacheSet('a', 1, 60, [tag]);
    await cacheSet('b', 2, 60, [tag]);
    await cacheSet('untagged', 3, 60);

    await cacheInvalidateTag(tag);

    expect(await cacheGet('a')).toBeNull();
    expect(await cacheGet('b')).toBeNull();
    // An unrelated entry must survive; over-invalidation is a performance bug.
    expect(await cacheGet('untagged')).toBe(3);
  });

  it('computes once, then serves from cache', async () => {
    const loader = vi.fn().mockResolvedValue({ total: 42 });

    expect(await cached('k', 60, loader)).toEqual({ total: 42 });
    expect(await cached('k', 60, loader)).toEqual({ total: 42 });
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('degrades to a miss rather than throwing on corrupt JSON', async () => {
    // A cache read must never break a request.
    await store.set('bad', '{not json');
    expect(await cacheGet('bad')).toBeNull();
  });
});

describe('key namespace', () => {
  it('scopes dashboard keys per tenant, so no entry can cross schools', () => {
    const a = keys.dashboard('tenant-a', 'ADMIN', null);
    const b = keys.dashboard('tenant-b', 'ADMIN', null);

    expect(a).not.toBe(b);
    expect(a.startsWith(keys.tenantPrefix('tenant-a'))).toBe(true);
  });

  it('separates branches within a tenant', () => {
    expect(keys.dashboard('t', 'ADMIN', 'branch-1')).not.toBe(
      keys.dashboard('t', 'ADMIN', 'branch-2'),
    );
  });
});
