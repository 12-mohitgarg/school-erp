/** Communication: announcements, notifications, parent-teacher chat (PRD section 5.6). */

import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, ok, created, noContent, paginated, pageParams } from '../../core/http/respond.js';
import { validate, idParam, uuidSchema, listQuery, Validated } from '../../core/http/validate.js';
import { requireAuth, requirePermission } from '../../core/auth/middleware.js';
import { scopedRequest } from '../../core/tenancy/scope.js';
import { auditFromRequest } from '../../core/audit/audit.service.js';
import { AppError } from '../../core/errors/AppError.js';
import { prisma } from '../../core/db/prisma.js';
import { notify, resolveAudience } from '../../core/notifications/notification.service.js';
import { emitToConversation, rooms, getIo } from '../../core/realtime/socket.js';
import { WS_EVENTS } from '@erp/shared';

const router = Router();

// --- Announcements ---------------------------------------------------------

router.get('/announcements', requirePermission('communication:view'),
  validate({ query: listQuery.extend({ category: z.string().optional() }) }),
  asyncHandler(async (req, res) => {
    const { auth } = scopedRequest(req);
    const { page, limit, skip, take } = pageParams(req.query);

    const where = {
      tenantId: auth.tenantId,
      isPublished: true,
      ...(req.query['category'] ? { category: req.query['category'] as string } : {}),
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    };

    const [items, total] = await Promise.all([
      prisma.announcement.findMany({
        where, skip, take,
        orderBy: [{ isPinned: 'desc' }, { publishAt: 'desc' }],
        include: { author: { select: { firstName: true, lastName: true, role: true, avatarUrl: true } } },
      }),
      prisma.announcement.count({ where }),
    ]);

    return paginated(res, items, total, page, limit);
  }));

router.post('/announcements',
  // Broadcast, not a direct message — parents and students must not reach this.
  requirePermission('communication:broadcast'),
  validate({ body: z.object({
    title: z.string().trim().min(1).max(200),
    body: z.string().min(1).max(10_000),
    category: z.enum(['GENERAL', 'URGENT', 'ACADEMIC', 'EVENT', 'HOLIDAY', 'EXAM', 'FEE']).default('GENERAL'),
    priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'EMERGENCY']).default('NORMAL'),
    audienceType: z.enum(['INSTITUTION', 'BRANCH', 'CLASS', 'SECTION', 'ROLE', 'INDIVIDUAL']).default('INSTITUTION'),
    audienceIds: z.array(z.string()).default([]),
    channels: z.array(z.enum(['IN_APP', 'PUSH', 'SMS', 'EMAIL', 'WHATSAPP'])).default(['IN_APP']),
    attachmentUrls: z.array(z.string().url()).max(10).default([]),
    publish: z.boolean().default(true),
    isPinned: z.boolean().default(false),
    expiresAt: z.coerce.date().optional(),
  }) }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const { publish, ...fields } = req.body as Record<string, unknown> & { publish: boolean };

    const announcement = await prisma.announcement.create({
      data: {
        tenantId: auth.tenantId, authorId: auth.userId,
        ...(fields as Validated),
        isPublished: publish,
        publishAt: publish ? new Date() : null,
      },
    });

    if (publish) {
      // Fan out over the notification framework so channel preferences,
      // quiet hours and delivery retries all apply uniformly.
      const userIds = await resolveAudience({
        tenantId: auth.tenantId,
        type: announcement.audienceType,
        ids: announcement.audienceIds,
        includeGuardians: true,
      });

      void notify({
        tenantId: auth.tenantId,
        userIds,
        title: announcement.title,
        body: announcement.body.slice(0, 400),
        channels: announcement.channels,
        priority: announcement.priority,
        module: 'communication',
        actionUrl: `/announcements/${announcement.id}`,
      }).catch(() => undefined);
    }

    await auditFromRequest(req, {
      action: publish ? 'PUBLISH' : 'CREATE', module: 'communication',
      entityType: 'Announcement', entityId: announcement.id,
    });

    return created(res, announcement);
  }));

router.post('/announcements/:id/read', requirePermission('communication:view'),
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    await prisma.announcementRead.upsert({
      where: { announcementId_userId: { announcementId: req.params['id']!, userId: auth.userId } },
      create: { announcementId: req.params['id']!, userId: auth.userId },
      update: {},
    });
    return noContent(res);
  }));

// --- Notification inbox ----------------------------------------------------

router.get('/notifications', asyncHandler(async (req, res) => {
  const auth = requireAuth(req);
  const { page, limit, skip, take } = pageParams(req.query);
  const unreadOnly = req.query['unread'] === 'true';

  const where = { userId: auth.userId, archivedAt: null, ...(unreadOnly ? { readAt: null } : {}) };

  const [items, total, unread] = await Promise.all([
    prisma.notification.findMany({ where, skip, take, orderBy: { createdAt: 'desc' } }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { userId: auth.userId, readAt: null, archivedAt: null } }),
  ]);

  return paginated(res, items, total, page, limit, { unreadCount: unread });
}));

router.post('/notifications/read', asyncHandler(async (req, res) => {
  const auth = requireAuth(req);
  const ids = (req.body as { ids?: string[] }).ids;

  await prisma.notification.updateMany({
    where: { userId: auth.userId, readAt: null, ...(ids ? { id: { in: ids } } : {}) },
    data: { readAt: new Date() },
  });

  return noContent(res);
}));

router.get('/preferences', asyncHandler(async (req, res) => {
  const auth = requireAuth(req);
  const prefs = await prisma.notificationPreference.findFirst({
    where: { userId: auth.userId, category: null },
  });
  return ok(res, prefs ?? {
    inAppEnabled: true, pushEnabled: true, smsEnabled: true,
    emailEnabled: true, whatsappEnabled: false,
    quietHoursStart: null, quietHoursEnd: null,
  });
}));

router.put('/preferences', validate({ body: z.object({
  inAppEnabled: z.boolean().optional(),
  pushEnabled: z.boolean().optional(),
  smsEnabled: z.boolean().optional(),
  emailEnabled: z.boolean().optional(),
  whatsappEnabled: z.boolean().optional(),
  quietHoursStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
  quietHoursEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
}) }), asyncHandler(async (req, res) => {
  const auth = requireAuth(req);
  const prefs = await prisma.notificationPreference.upsert({
    where: { userId_category: { userId: auth.userId, category: null as never } },
    create: { userId: auth.userId, ...(req.body as Validated) },
    update: req.body as Validated,
  });
  return ok(res, prefs);
}));

// --- Parent-teacher chat ---------------------------------------------------

/**
 * Who may this user start a conversation with?
 *
 * The list is derived from the relationships that already exist, so it is also
 * the authorisation boundary: a parent can only reach the teachers who
 * actually teach their children, and a teacher only the guardians of students
 * in their own sections. Nobody can enumerate the whole directory.
 */
router.get('/contacts', requirePermission('communication:create'), asyncHandler(async (req, res) => {
  const auth = requireAuth(req);

  interface Contact {
    userId: string;
    name: string;
    role: string;
    detail: string;
  }

  const contacts = new Map<string, Contact>();

  if (auth.scope === 'CHILDREN') {
    // Parent: the class teachers and subject teachers of their children.
    const enrollments = await prisma.enrollment.findMany({
      where: { studentId: { in: auth.childStudentIds ?? [] }, isCurrent: true },
      select: {
        section: {
          select: {
            name: true,
            class: { select: { name: true } },
            classTeacher: {
              select: { firstName: true, lastName: true, userId: true },
            },
            classSubjects: {
              select: {
                subject: { select: { name: true } },
                teacher: { select: { firstName: true, lastName: true, userId: true } },
              },
            },
          },
        },
      },
    });

    for (const enrollment of enrollments) {
      const label = `${enrollment.section.class.name}-${enrollment.section.name}`;
      const homeroom = enrollment.section.classTeacher;

      if (homeroom?.userId) {
        contacts.set(homeroom.userId, {
          userId: homeroom.userId,
          name: `${homeroom.firstName} ${homeroom.lastName}`,
          role: 'TEACHER',
          detail: `Class teacher · ${label}`,
        });
      }

      for (const cs of enrollment.section.classSubjects) {
        if (!cs.teacher?.userId || contacts.has(cs.teacher.userId)) continue;
        contacts.set(cs.teacher.userId, {
          userId: cs.teacher.userId,
          name: `${cs.teacher.firstName} ${cs.teacher.lastName}`,
          role: 'TEACHER',
          detail: `${cs.subject.name} · ${label}`,
        });
      }
    }
  } else if (auth.scope === 'ASSIGNED') {
    // Teacher: guardians of the students in their sections.
    const links = await prisma.studentGuardian.findMany({
      where: {
        student: {
          tenantId: auth.tenantId,
          enrollments: {
            some: { isCurrent: true, sectionId: { in: auth.assignedSectionIds ?? [] } },
          },
        },
        guardian: { userId: { not: null } },
      },
      select: {
        relation: true,
        student: { select: { firstName: true, lastName: true, admissionNo: true } },
        guardian: { select: { userId: true, firstName: true, lastName: true } },
      },
      take: 500,
    });

    for (const link of links) {
      const userId = link.guardian.userId;
      if (!userId || contacts.has(userId)) continue;
      contacts.set(userId, {
        userId,
        name: `${link.guardian.firstName} ${link.guardian.lastName}`,
        role: 'PARENT',
        detail: `${link.relation.toLowerCase()} of ${link.student.firstName} ${link.student.lastName}`,
      });
    }
  } else {
    // Staff with a wider scope may message any active colleague.
    const staff = await prisma.user.findMany({
      where: {
        tenantId: auth.tenantId,
        status: 'ACTIVE',
        deletedAt: null,
        id: { not: auth.userId },
        role: { in: ['ADMIN', 'ADMINISTRATION', 'TEACHER', 'ACCOUNTANT', 'LIBRARIAN', 'HR'] },
      },
      select: { id: true, firstName: true, lastName: true, role: true },
      take: 500,
      orderBy: { firstName: 'asc' },
    });

    for (const person of staff) {
      contacts.set(person.id, {
        userId: person.id,
        name: `${person.firstName} ${person.lastName}`,
        role: person.role,
        detail: person.role.replace('_', ' ').toLowerCase(),
      });
    }
  }

  return ok(res, [...contacts.values()].sort((a, b) => a.name.localeCompare(b.name)));
}));

router.get('/conversations', requirePermission('communication:view'), asyncHandler(async (req, res) => {
  const auth = requireAuth(req);

  const memberships = await prisma.conversationMember.findMany({
    where: { userId: auth.userId },
    orderBy: { conversation: { lastMessageAt: 'desc' } },
    select: {
      unreadCount: true, lastReadAt: true, isMuted: true,
      conversation: {
        select: {
          id: true, type: true, title: true, studentId: true,
          lastMessageAt: true, lastMessagePreview: true, isLocked: true,
          members: { select: { user: { select: { id: true, firstName: true, lastName: true, role: true, avatarUrl: true } } } },
        },
      },
    },
  });

  return ok(res, memberships.map((m) => ({
    ...m.conversation,
    unreadCount: m.unreadCount,
    isMuted: m.isMuted,
    // Show the counterpart, not the signed-in user, in the thread list.
    participants: m.conversation.members.map((mm) => mm.user).filter((u) => u.id !== auth.userId),
  })));
}));

router.post('/conversations', requirePermission('communication:create'),
  validate({ body: z.object({
    participantUserIds: z.array(uuidSchema).min(1).max(20),
    studentId: uuidSchema.optional(),
    title: z.string().max(160).optional(),
    type: z.enum(['DIRECT', 'GROUP', 'SUPPORT']).default('DIRECT'),
  }) }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const body = req.body as { participantUserIds: string[]; studentId?: string; title?: string; type: string };

    const memberIds = [...new Set([auth.userId, ...body.participantUserIds])];

    // Reuse an existing 1:1 thread rather than creating duplicates.
    if (body.type === 'DIRECT' && memberIds.length === 2) {
      const existing = await prisma.conversation.findFirst({
        where: {
          tenantId: auth.tenantId, type: 'DIRECT',
          ...(body.studentId ? { studentId: body.studentId } : {}),
          AND: memberIds.map((id) => ({ members: { some: { userId: id } } })),
        },
        select: { id: true },
      });
      if (existing) return ok(res, existing);
    }

    const conversation = await prisma.conversation.create({
      data: {
        tenantId: auth.tenantId,
        type: body.type,
        title: body.title ?? null,
        studentId: body.studentId ?? null,
        members: { create: memberIds.map((userId) => ({ userId })) },
      },
    });

    return created(res, conversation);
  }));

router.get('/conversations/:id/messages', requirePermission('communication:view'),
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const conversationId = req.params['id']!;
    const { page, limit, skip, take } = pageParams(req.query);

    const member = await prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId, userId: auth.userId } },
      select: { id: true },
    });
    if (!member) throw AppError.forbidden('You are not a member of this conversation');

    const [items, total] = await Promise.all([
      prisma.message.findMany({
        where: { conversationId, deletedAt: null },
        skip, take, orderBy: { createdAt: 'desc' },
        include: { sender: { select: { id: true, firstName: true, lastName: true, role: true, avatarUrl: true } } },
      }),
      prisma.message.count({ where: { conversationId, deletedAt: null } }),
    ]);

    // Opening a thread clears its unread badge.
    await prisma.conversationMember.update({
      where: { id: member.id },
      data: { lastReadAt: new Date(), unreadCount: 0 },
    });

    return paginated(res, items.reverse(), total, page, limit);
  }));

router.post('/conversations/:id/messages', requirePermission('communication:create'),
  validate({ params: idParam, body: z.object({
    body: z.string().min(1).max(5000),
    messageType: z.enum(['TEXT', 'IMAGE', 'FILE']).default('TEXT'),
    attachmentUrls: z.array(z.string().url()).max(5).default([]),
    replyToId: uuidSchema.optional(),
  }) }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const conversationId = req.params['id']!;
    const body = req.body as Record<string, unknown>;

    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, tenantId: auth.tenantId },
      select: { id: true, isLocked: true, members: { select: { id: true, userId: true } } },
    });
    if (!conversation) throw AppError.notFound('Conversation');
    if (conversation.isLocked) throw AppError.conflict('This conversation has been closed by a moderator');

    const isMember = conversation.members.some((m) => m.userId === auth.userId);
    if (!isMember) throw AppError.forbidden('You are not a member of this conversation');

    const message = await prisma.message.create({
      data: { conversationId, senderId: auth.userId, ...(body as Validated) },
      include: { sender: { select: { id: true, firstName: true, lastName: true, role: true, avatarUrl: true } } },
    });

    const preview = String(body['body']).slice(0, 120);

    await prisma.$transaction([
      prisma.conversation.update({
        where: { id: conversationId },
        data: { lastMessageAt: new Date(), lastMessagePreview: preview },
      }),
      // Bump unread for everyone except the sender.
      prisma.conversationMember.updateMany({
        where: { conversationId, userId: { not: auth.userId } },
        data: { unreadCount: { increment: 1 } },
      }),
    ]);

    emitToConversation(conversationId, WS_EVENTS.CHAT_MESSAGE, message);

    const others = conversation.members.filter((m) => m.userId !== auth.userId).map((m) => m.userId);
    void notify({
      tenantId: auth.tenantId,
      userIds: others,
      title: `New message from ${auth.fullName}`,
      body: preview,
      channels: ['PUSH'],
      module: 'communication',
      actionUrl: `/messages/${conversationId}`,
    }).catch(() => undefined);

    return created(res, message);
  }));

/** Join the socket room for live delivery of a thread. */
router.post('/conversations/:id/subscribe', requirePermission('communication:view'),
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const conversationId = req.params['id']!;

    const member = await prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId, userId: auth.userId } },
      select: { id: true },
    });
    if (!member) throw AppError.forbidden('You are not a member of this conversation');

    // Server-side join keeps room membership an authorisation decision.
    const sockets = await getIo().in(rooms.user(auth.userId)).fetchSockets();
    for (const socket of sockets) await socket.join(rooms.conversation(conversationId));

    return ok(res, { subscribed: true });
  }));

export default router;

