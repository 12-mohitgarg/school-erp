/**
 * Offline write queue.
 *
 * PRD gap analysis, "Offline mode for Driver & Teacher apps": *rural routes and
 * classrooms often lose connectivity — local queue for attendance and location
 * events, auto-sync on reconnect with conflict resolution.*
 *
 * Two kinds of work are queued, and they are queued for different reasons:
 *
 *  * **Position pings** are high volume and individually worthless — what
 *    matters is the shape of the journey. They are batched to
 *    `/tracking/location/batch`, which replays them in chronological order so
 *    geofence transitions still fire in the right sequence.
 *  * **Boarding events** are low volume and each one matters: "did my child
 *    get on the bus" is the question the whole feature exists to answer. They
 *    are replayed one at a time, and the server upsert on
 *    `(tripId, studentId, event)` makes a retry idempotent — so a flush that
 *    dies halfway can safely run again.
 *
 * The queue survives a force-quit because it is written to disk on every
 * change, not on an interval. A driver whose phone dies at the far end of a
 * route still delivers the trip once it charges.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { trackingApi, transportApi } from '@/core/api/endpoints';
import { ApiError } from '@/core/api/client';
import type { BoardingEvent } from '@/core/api/types';

const STORAGE_KEY = 'edusphere.offlineQueue.v1';

/**
 * Cap on stored pings. At one ping every 12s a full school day is ~2,400, so
 * 3,000 covers a whole day offline. Beyond that the *oldest* are dropped: a
 * recent position is worth more than an ancient one, and an unbounded queue on
 * a low-end handset eventually fails to write at all.
 */
const MAX_PINGS = 3_000;
const MAX_ACTIONS = 500;
const BATCH_SIZE = 400;

export interface QueuedPing {
  latitude: number;
  longitude: number;
  speed: number;
  heading: number;
  accuracy?: number;
  recordedAt: string;
}

export type QueuedAction = {
  id: string;
  queuedAt: string;
  attempts: number;
  kind: 'boarding';
  tripId: string;
  payload: {
    studentId: string;
    event: BoardingEvent;
    stopId?: string;
    latitude?: number;
    longitude?: number;
    method?: 'MANUAL' | 'RFID' | 'QR' | 'FACE';
  };
};

interface QueueShape {
  pings: QueuedPing[];
  actions: QueuedAction[];
}

const EMPTY: QueueShape = { pings: [], actions: [] };

let memory: QueueShape = { ...EMPTY };
let hydrated = false;
/** Serialises disk writes so two rapid enqueues cannot interleave. */
let writeChain: Promise<void> = Promise.resolve();

type Listener = (snapshot: QueueSnapshot) => void;
const listeners = new Set<Listener>();

export interface QueueSnapshot {
  pending: number;
  pendingPings: number;
  pendingActions: number;
  flushing: boolean;
  lastFlushAt: string | null;
  lastError: string | null;
}

let flushing = false;
let lastFlushAt: string | null = null;
let lastError: string | null = null;

function snapshot(): QueueSnapshot {
  return {
    pending: memory.pings.length + memory.actions.length,
    pendingPings: memory.pings.length,
    pendingActions: memory.actions.length,
    flushing,
    lastFlushAt,
    lastError,
  };
}

function emit(): void {
  const current = snapshot();
  for (const listener of listeners) listener(current);
}

export function subscribeToQueue(listener: Listener): () => void {
  listeners.add(listener);
  listener(snapshot());
  return () => listeners.delete(listener);
}

export function queueSnapshot(): QueueSnapshot {
  return snapshot();
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

async function persist(): Promise<void> {
  writeChain = writeChain
    .then(() => AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(memory)))
    .catch(() => undefined);
  return writeChain;
}

export async function hydrateQueue(): Promise<void> {
  if (hydrated) return;
  hydrated = true;

  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<QueueShape>;
      memory = {
        pings: Array.isArray(parsed.pings) ? parsed.pings : [],
        actions: Array.isArray(parsed.actions) ? parsed.actions : [],
      };
    }
  } catch {
    memory = { ...EMPTY };
  }

  emit();
}

// ---------------------------------------------------------------------------
// Enqueue
// ---------------------------------------------------------------------------

export async function enqueuePing(ping: QueuedPing): Promise<void> {
  memory.pings.push(ping);
  if (memory.pings.length > MAX_PINGS) {
    memory.pings.splice(0, memory.pings.length - MAX_PINGS);
  }
  await persist();
  emit();
}

export async function enqueueBoarding(
  tripId: string,
  payload: QueuedAction['payload'],
): Promise<void> {
  memory.actions.push({
    id: `${tripId}:${payload.studentId}:${payload.event}`,
    queuedAt: new Date().toISOString(),
    attempts: 0,
    kind: 'boarding',
    tripId,
    payload,
  });

  // Same student, same event, queued twice = the same server upsert. Keep the
  // newest so a corrected entry wins.
  const seen = new Set<string>();
  memory.actions = memory.actions
    .slice()
    .reverse()
    .filter((a) => (seen.has(a.id) ? false : (seen.add(a.id), true)))
    .reverse()
    .slice(-MAX_ACTIONS);

  await persist();
  emit();
}

export async function clearQueue(): Promise<void> {
  memory = { ...EMPTY, pings: [], actions: [] };
  await persist();
  emit();
}

// ---------------------------------------------------------------------------
// Flush
// ---------------------------------------------------------------------------

/**
 * Push everything that is queued.
 *
 * Returns `true` when the queue is empty afterwards. Safe to call often — a
 * second call while a flush is running is a no-op rather than a double send.
 */
export async function flushQueue(): Promise<boolean> {
  if (flushing) return false;
  if (memory.pings.length === 0 && memory.actions.length === 0) return true;

  flushing = true;
  lastError = null;
  emit();

  try {
    // Boarding events first: they are what a waiting parent is owed, and there
    // are few enough that they never delay the position batch meaningfully.
    while (memory.actions.length > 0) {
      const action = memory.actions[0];
      if (!action) break;

      try {
        await transportApi.recordBoarding(action.tripId, action.payload);
        memory.actions.shift();
        await persist();
        emit();
      } catch (err) {
        // A rejected event is a *permanently* rejected event — the trip ended,
        // or the student was unallocated. Retrying forever would wedge the
        // queue behind one bad row, so drop it and keep the rest moving.
        if (err instanceof ApiError && !err.isTransient) {
          memory.actions.shift();
          await persist();
          emit();
          continue;
        }
        throw err;
      }
    }

    while (memory.pings.length > 0) {
      const batch = memory.pings.slice(0, BATCH_SIZE);
      await trackingApi.pushLocationBatch(batch);
      memory.pings.splice(0, batch.length);
      await persist();
      emit();
    }

    lastFlushAt = new Date().toISOString();
    return true;
  } catch (err) {
    lastError =
      err instanceof ApiError
        ? err.message
        : 'Could not reach the server. Queued events will be sent automatically.';
    return false;
  } finally {
    flushing = false;
    emit();
  }
}
