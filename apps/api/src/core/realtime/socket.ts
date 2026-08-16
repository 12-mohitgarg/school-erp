/**
 * WebSocket layer (Socket.IO).
 *
 * Rooms are the isolation boundary. A socket is placed in `tenant:{id}` on
 * connect and may only join `vehicle:{id}` / `student:{id}` rooms after an
 * explicit server-side authorisation check — a client cannot join a room by
 * naming it.
 *
 * The Redis adapter lets several API replicas fan out to the same rooms, which
 * is what makes the WebSocket tier horizontally scalable (PRD gap: NFRs).
 */

import type { Server as HttpServer } from 'node:http';
import { Server as SocketServer, type Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { WS_EVENTS, type Role, type DataScope } from '@erp/shared';
import { env } from '../../config/env.js';
import { moduleLogger } from '../logger.js';
import { verifyAccessToken } from '../auth/tokens.js';
import { loadUserContext } from '../auth/context.js';
import { redisPub, redisSub } from '../cache/redis.js';
import { prisma } from '../db/prisma.js';

const log = moduleLogger('socket');

/** Context attached to each authenticated socket. */
interface SocketAuth {
  userId: string;
  role: Role;
  scope: DataScope;
  tenantId: string;
  branchId: string | null;
  permissions: string[];
  childStudentIds: string[];
  employeeId?: string | undefined;
  fullName: string;
}

declare module 'socket.io' {
  interface Socket {
    auth?: SocketAuth;
  }
}

let io: SocketServer | null = null;

// ---------------------------------------------------------------------------
// Room naming
// ---------------------------------------------------------------------------

export const rooms = {
  tenant: (tenantId: string) => `tenant:${tenantId}`,
  branch: (branchId: string) => `branch:${branchId}`,
  user: (userId: string) => `user:${userId}`,
  role: (tenantId: string, role: Role) => `role:${tenantId}:${role}`,
  vehicle: (vehicleId: string) => `vehicle:${vehicleId}`,
  trip: (tripId: string) => `trip:${tripId}`,
  student: (studentId: string) => `student:${studentId}`,
  conversation: (conversationId: string) => `conversation:${conversationId}`,
} as const;

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

export function initSocketServer(httpServer: HttpServer): SocketServer {
  io = new SocketServer(httpServer, {
    path: env.WS_PATH,
    cors: { origin: env.CORS_ORIGINS, credentials: true },
    // Drivers on mobile data lose packets; a slightly generous timeout avoids
    // churning trips on brief signal drops.
    pingTimeout: 30_000,
    pingInterval: 25_000,
    transports: ['websocket', 'polling'],
    maxHttpBufferSize: 1e6,
  });

  // Without a real Redis the default in-memory adapter is used, which confines
  // fan-out to this process. Fine for one replica, wrong for several.
  if (redisPub && redisSub) {
    io.adapter(createAdapter(redisPub, redisSub));
  } else {
    log.warn('No Redis adapter — WebSocket fan-out is limited to this process');
  }

  io.use(authenticateSocket);
  io.on('connection', handleConnection);

  log.info({ path: env.WS_PATH }, 'WebSocket server ready');
  return io;
}

export function getIo(): SocketServer {
  if (!io) throw new Error('Socket server not initialised');
  return io;
}

// ---------------------------------------------------------------------------
// Handshake
// ---------------------------------------------------------------------------

async function authenticateSocket(
  socket: Socket,
  next: (err?: Error) => void,
): Promise<void> {
  try {
    const token =
      (socket.handshake.auth?.['token'] as string | undefined) ??
      socket.handshake.headers.authorization?.replace('Bearer ', '');

    if (!token) return next(new Error('UNAUTHENTICATED'));

    const payload = verifyAccessToken(token);
    const context = await loadUserContext(payload.sub);

    socket.auth = {
      userId: context.userId,
      role: context.role,
      scope: context.scope,
      tenantId: context.tenantId,
      branchId: context.branchId,
      permissions: context.permissions,
      childStudentIds: context.childStudentIds ?? [],
      employeeId: context.employeeId,
      fullName: context.fullName,
    };
    next();
  } catch (err) {
    log.warn({ err }, 'Socket authentication failed');
    next(new Error('UNAUTHENTICATED'));
  }
}

function handleConnection(socket: Socket): void {
  const auth = socket.auth;
  if (!auth) {
    socket.disconnect(true);
    return;
  }

  // Baseline rooms every socket gets for free — these carry no cross-user data.
  void socket.join(rooms.tenant(auth.tenantId));
  void socket.join(rooms.user(auth.userId));
  void socket.join(rooms.role(auth.tenantId, auth.role));
  if (auth.branchId) void socket.join(rooms.branch(auth.branchId));

  // Guardians subscribe to their children automatically; the link itself is
  // the authorisation, so no further check is needed here.
  for (const studentId of auth.childStudentIds) {
    void socket.join(rooms.student(studentId));
  }

  log.debug({ userId: auth.userId, role: auth.role }, 'Socket connected');

  socket.on(WS_EVENTS.SUBSCRIBE_VEHICLE, (vehicleId: unknown) => {
    void subscribeVehicle(socket, String(vehicleId));
  });

  socket.on(WS_EVENTS.SUBSCRIBE_STUDENT, (studentId: unknown) => {
    void subscribeStudent(socket, String(studentId));
  });

  socket.on(WS_EVENTS.UNSUBSCRIBE, (room: unknown) => {
    void socket.leave(String(room));
  });

  socket.on('disconnect', (reason) => {
    log.debug({ userId: auth.userId, reason }, 'Socket disconnected');
  });
}

// ---------------------------------------------------------------------------
// Authorised subscriptions
// ---------------------------------------------------------------------------

async function subscribeVehicle(socket: Socket, vehicleId: string): Promise<void> {
  const auth = socket.auth;
  if (!auth) return;

  // The vehicle must belong to the caller's tenant. Without this check, a
  // valid token from tenant A could stream tenant B's buses.
  const vehicle = await prisma.vehicle.findFirst({
    where: { id: vehicleId, tenantId: auth.tenantId },
    select: { id: true },
  });

  if (!vehicle) {
    socket.emit(WS_EVENTS.ERROR, { message: 'Vehicle not found' });
    return;
  }

  // Staff may watch any vehicle in their tenant; guardians only the vehicle
  // currently carrying one of their children.
  if (auth.scope === 'CHILDREN') {
    const allowed = await guardianMayWatchVehicle(auth.childStudentIds, vehicleId);
    if (!allowed) {
      socket.emit(WS_EVENTS.ERROR, { message: 'Not authorised for this vehicle' });
      return;
    }
  } else if (auth.scope === 'SELF') {
    socket.emit(WS_EVENTS.ERROR, { message: 'Not authorised for vehicle tracking' });
    return;
  }

  void socket.join(rooms.vehicle(vehicleId));
  log.debug({ userId: auth.userId, vehicleId }, 'Subscribed to vehicle');
}

/** True when any of the guardian's children is allocated to this vehicle's route. */
async function guardianMayWatchVehicle(
  childIds: string[],
  vehicleId: string,
): Promise<boolean> {
  if (childIds.length === 0) return false;

  const allocation = await prisma.transportAllocation.findFirst({
    where: {
      studentId: { in: childIds },
      isActive: true,
      route: { vehicleId },
    },
    select: { id: true },
  });
  return allocation !== null;
}

async function subscribeStudent(socket: Socket, studentId: string): Promise<void> {
  const auth = socket.auth;
  if (!auth) return;

  const permitted =
    auth.scope === 'TENANT' ||
    auth.scope === 'BRANCH' ||
    auth.childStudentIds.includes(studentId);

  if (!permitted) {
    socket.emit(WS_EVENTS.ERROR, { message: 'Not authorised for this student' });
    return;
  }

  void socket.join(rooms.student(studentId));
}

// ---------------------------------------------------------------------------
// Server -> client emitters
// ---------------------------------------------------------------------------

export function emitToRoom(room: string, event: string, payload: unknown): void {
  io?.to(room).emit(event, payload);
}

export function emitToUser(userId: string, event: string, payload: unknown): void {
  io?.to(rooms.user(userId)).emit(event, payload);
}

export function emitToUsers(userIds: string[], event: string, payload: unknown): void {
  if (userIds.length === 0) return;
  io?.to(userIds.map(rooms.user)).emit(event, payload);
}

export function emitToTenant(tenantId: string, event: string, payload: unknown): void {
  io?.to(rooms.tenant(tenantId)).emit(event, payload);
}

export function emitToVehicle(vehicleId: string, event: string, payload: unknown): void {
  io?.to(rooms.vehicle(vehicleId)).emit(event, payload);
}

export function emitToStudent(studentId: string, event: string, payload: unknown): void {
  io?.to(rooms.student(studentId)).emit(event, payload);
}

/** Broadcast to every holder of a role inside one tenant — used for SOS fan-out. */
export function emitToRole(tenantId: string, role: Role, event: string, payload: unknown): void {
  io?.to(rooms.role(tenantId, role)).emit(event, payload);
}

export function emitToConversation(
  conversationId: string,
  event: string,
  payload: unknown,
): void {
  io?.to(rooms.conversation(conversationId)).emit(event, payload);
}

export async function closeSocketServer(): Promise<void> {
  if (!io) return;
  await io.close();
  io = null;
  log.info('WebSocket server closed');
}
