/**
 * Single-process, in-memory stand-in for Redis.
 *
 * Implements only the commands this codebase actually uses. It exists so the
 * API can boot on a machine without Redis (local development, a quick demo, a
 * CI job), rather than failing at startup.
 *
 * It is NOT a substitute for Redis in production:
 *   * state is per-process, so rate limits and geofence edge-state are wrong
 *     the moment you run more than one replica;
 *   * nothing is persisted across a restart;
 *   * Socket.IO cross-replica fan-out is disabled without a real Redis adapter.
 * The boot log says so loudly.
 */

interface Entry {
  value: string;
  /** Epoch ms, or null for no expiry. */
  expiresAt: number | null;
}

export class MemoryRedis {
  private store = new Map<string, Entry>();
  private lists = new Map<string, string[]>();
  private sets = new Map<string, Set<string>>();
  private sweeper: NodeJS.Timeout;

  readonly isMemoryFallback = true;

  constructor() {
    // Lazy expiry alone would let abandoned keys leak, so sweep periodically.
    this.sweeper = setInterval(() => this.sweep(), 30_000);
    this.sweeper.unref();
  }

  private sweep(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (entry.expiresAt !== null && entry.expiresAt <= now) this.store.delete(key);
    }
  }

  /** Read through the expiry check — a key past its TTL must read as absent. */
  private live(key: string): Entry | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry;
  }

  // -- Strings -------------------------------------------------------------

  async get(key: string): Promise<string | null> {
    return this.live(key)?.value ?? null;
  }

  /** Supports the `SET key value PX ms NX` form used by the job lock. */
  async set(key: string, value: string, ...args: unknown[]): Promise<'OK' | null> {
    const flags = args.map((a) => String(a).toUpperCase());
    const nx = flags.includes('NX');

    if (nx && this.live(key)) return null;

    let expiresAt: number | null = null;
    const pxIndex = flags.indexOf('PX');
    const exIndex = flags.indexOf('EX');
    if (pxIndex !== -1) expiresAt = Date.now() + Number(args[pxIndex + 1]);
    else if (exIndex !== -1) expiresAt = Date.now() + Number(args[exIndex + 1]) * 1000;

    this.store.set(key, { value, expiresAt });
    return 'OK';
  }

  async setex(key: string, seconds: number, value: string): Promise<'OK'> {
    this.store.set(key, { value, expiresAt: Date.now() + seconds * 1000 });
    return 'OK';
  }

  async del(...keys: string[]): Promise<number> {
    let removed = 0;
    for (const key of keys) {
      if (this.store.delete(key)) removed++;
      this.lists.delete(key);
      this.sets.delete(key);
    }
    return removed;
  }

  async incr(key: string): Promise<number> {
    const current = Number(this.live(key)?.value ?? 0) + 1;
    // INCR preserves any existing TTL.
    const expiresAt = this.store.get(key)?.expiresAt ?? null;
    this.store.set(key, { value: String(current), expiresAt });
    return current;
  }

  async expire(key: string, seconds: number): Promise<number> {
    const entry = this.live(key);
    if (!entry) return 0;
    entry.expiresAt = Date.now() + seconds * 1000;
    return 1;
  }

  async ttl(key: string): Promise<number> {
    const entry = this.live(key);
    if (!entry) return -2;
    if (entry.expiresAt === null) return -1;
    return Math.max(0, Math.ceil((entry.expiresAt - Date.now()) / 1000));
  }

  // -- Lists (vehicle trails) ---------------------------------------------

  async lpush(key: string, ...values: string[]): Promise<number> {
    const list = this.lists.get(key) ?? [];
    list.unshift(...values);
    this.lists.set(key, list);
    return list.length;
  }

  async ltrim(key: string, start: number, stop: number): Promise<'OK'> {
    const list = this.lists.get(key);
    if (list) {
      // Redis `stop` is inclusive and -1 means "to the end".
      this.lists.set(key, list.slice(start, stop === -1 ? undefined : stop + 1));
    }
    return 'OK';
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    const list = this.lists.get(key) ?? [];
    return list.slice(start, stop === -1 ? undefined : stop + 1);
  }

  // -- Sets (cache tags) ---------------------------------------------------

  async sadd(key: string, ...members: string[]): Promise<number> {
    const set = this.sets.get(key) ?? new Set<string>();
    let added = 0;
    for (const m of members) {
      if (!set.has(m)) { set.add(m); added++; }
    }
    this.sets.set(key, set);
    return added;
  }

  async smembers(key: string): Promise<string[]> {
    return [...(this.sets.get(key) ?? [])];
  }

  // -- Misc ----------------------------------------------------------------

  async ping(): Promise<'PONG'> {
    return 'PONG';
  }

  async connect(): Promise<void> {
    // Nothing to connect to.
  }

  async quit(): Promise<'OK'> {
    clearInterval(this.sweeper);
    this.store.clear();
    this.lists.clear();
    this.sets.clear();
    return 'OK';
  }

  /** Generic dispatch used by `rate-limit-redis`. */
  async call(command: string, ...args: string[]): Promise<unknown> {
    const method = command.toLowerCase() as keyof MemoryRedis;
    const fn = this[method];
    if (typeof fn === 'function') {
      return (fn as (...a: unknown[]) => Promise<unknown>).apply(this, args);
    }
    return null;
  }

  /** No-op event registration so callers can attach handlers unconditionally. */
  on(): this {
    return this;
  }
  off(): this {
    return this;
  }

  /**
   * Minimal pipeline: queues calls and runs them in order on `exec()`.
   * Returns ioredis's `[error, result]` tuple shape.
   */
  pipeline(): MemoryPipeline {
    return new MemoryPipeline(this);
  }
}

class MemoryPipeline {
  private queue: Array<() => Promise<unknown>> = [];

  constructor(private readonly client: MemoryRedis) {}

  set(...args: Parameters<MemoryRedis['set']>): this {
    this.queue.push(() => this.client.set(...args));
    return this;
  }
  setex(...args: Parameters<MemoryRedis['setex']>): this {
    this.queue.push(() => this.client.setex(...args));
    return this;
  }
  del(...args: Parameters<MemoryRedis['del']>): this {
    this.queue.push(() => this.client.del(...args));
    return this;
  }
  expire(...args: Parameters<MemoryRedis['expire']>): this {
    this.queue.push(() => this.client.expire(...args));
    return this;
  }
  sadd(...args: Parameters<MemoryRedis['sadd']>): this {
    this.queue.push(() => this.client.sadd(...args));
    return this;
  }
  lpush(...args: Parameters<MemoryRedis['lpush']>): this {
    this.queue.push(() => this.client.lpush(...args));
    return this;
  }
  ltrim(...args: Parameters<MemoryRedis['ltrim']>): this {
    this.queue.push(() => this.client.ltrim(...args));
    return this;
  }

  async exec(): Promise<Array<[Error | null, unknown]>> {
    const results: Array<[Error | null, unknown]> = [];
    for (const task of this.queue) {
      try {
        results.push([null, await task()]);
      } catch (err) {
        results.push([err as Error, null]);
      }
    }
    this.queue = [];
    return results;
  }
}
