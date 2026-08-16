/**
 * Central notification service (PRD gap: "Notification framework
 * under-specified").
 *
 * One entry point — `notify()` — handles audience resolution, per-user channel
 * preferences, quiet hours, template rendering, delivery-record creation and
 * retry scheduling. Modules never talk to SMS/email/push providers directly.
 *
 * EMERGENCY priority (SOS) bypasses both preferences and quiet hours, as the
 * PRD requires.
 */

import type {
  NotificationChannel,
  NotificationPriority,
  ModuleKey,
} from '@erp/shared';
import { prisma } from '../db/prisma.js';
import { moduleLogger } from '../logger.js';
import { emitToUsers } from '../realtime/socket.js';
import { notificationsDispatched } from '../observability/metrics.js';
import { WS_EVENTS } from '@erp/shared';
import { sendSms } from './channels/sms.channel.js';
import { sendEmail } from './channels/email.channel.js';
import { sendPush } from './channels/push.channel.js';

const log = moduleLogger('notifications');

export interface NotifyInput {
  tenantId: string;
  /** Explicit recipients. Use `resolveAudience` first for group sends. */
  userIds: string[];
  title: string;
  body: string;
  channels?: NotificationChannel[];
  priority?: NotificationPriority;
  module?: ModuleKey;
  actionUrl?: string;
  data?: Record<string, unknown>;
  imageUrl?: string;
  /** Template key — when set, `title`/`body` act as fallbacks. */
  templateKey?: string;
  templateVars?: Record<string, string | number>;
}

/** Substitute `{{name}}` placeholders in a template body. */
function render(template: string, vars: Record<string, string | number> = {}): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key: string) =>
    key in vars ? String(vars[key]) : match,
  );
}

/** Is `now` inside the user's configured quiet window? Handles overnight ranges. */
function inQuietHours(start: string | null, end: string | null, now = new Date()): boolean {
  if (!start || !end) return false;

  const minutes = now.getHours() * 60 + now.getMinutes();
  const [sh = 0, sm = 0] = start.split(':').map(Number);
  const [eh = 0, em = 0] = end.split(':').map(Number);
  const from = sh * 60 + sm;
  const to = eh * 60 + em;

  // A window like 22:00-07:00 wraps past midnight.
  return from <= to ? minutes >= from && minutes < to : minutes >= from || minutes < to;
}

/**
 * Send a notification to a set of users.
 *
 * Returns the created notification ids. Delivery happens asynchronously; a
 * provider failure is recorded on the delivery row and retried by the job
 * runner rather than failing the caller's request.
 */
export async function notify(input: NotifyInput): Promise<string[]> {
  const {
    tenantId,
    userIds,
    priority = 'NORMAL',
    channels = ['IN_APP'],
    module,
    actionUrl,
    data,
    imageUrl,
  } = input;

  if (userIds.length === 0) return [];

  const isEmergency = priority === 'EMERGENCY';

  const recipients = await prisma.user.findMany({
    where: { id: { in: userIds }, status: 'ACTIVE', deletedAt: null },
    select: {
      id: true,
      email: true,
      phone: true,
      locale: true,
      notificationPrefs: {
        where: { category: null },
        take: 1,
      },
      pushTokens: { where: { isActive: true }, select: { token: true } },
    },
  });

  const createdIds: string[] = [];

  for (const user of recipients) {
    const prefs = user.notificationPrefs[0];

    // Emergency alerts ignore quiet hours entirely.
    const quiet =
      !isEmergency && inQuietHours(prefs?.quietHoursStart ?? null, prefs?.quietHoursEnd ?? null);

    const title = input.templateKey
      ? render(input.title, input.templateVars)
      : input.title;
    const body = input.templateKey ? render(input.body, input.templateVars) : input.body;

    const notification = await prisma.notification.create({
      data: {
        tenantId,
        userId: user.id,
        title,
        body,
        channel: 'IN_APP',
        priority,
        module: module ?? null,
        actionUrl: actionUrl ?? null,
        data: (data as never) ?? undefined,
        imageUrl: imageUrl ?? null,
      },
      select: { id: true },
    });
    createdIds.push(notification.id);

    // In-app is always delivered — it is the user's inbox, not a push.
    emitToUsers([user.id], WS_EVENTS.NOTIFICATION, {
      id: notification.id,
      title,
      body,
      priority,
      module: module ?? null,
      actionUrl: actionUrl ?? null,
      createdAt: new Date().toISOString(),
    });
    notificationsDispatched.inc({ channel: 'IN_APP', status: 'sent' });

    for (const channel of channels) {
      if (channel === 'IN_APP') continue;

      const enabled = isEmergency || channelEnabled(channel, prefs);
      if (!enabled || quiet) continue;

      const recipient = channelRecipient(channel, user);
      if (!recipient) continue;

      const delivery = await prisma.notificationDelivery.create({
        data: {
          notificationId: notification.id,
          channel,
          recipient,
          status: 'QUEUED',
        },
        select: { id: true },
      });

      // Dispatch out of band so a slow provider never blocks the caller.
      void dispatchDelivery(delivery.id);
    }
  }

  return createdIds;
}

type Prefs = { pushEnabled: boolean; smsEnabled: boolean; emailEnabled: boolean; whatsappEnabled: boolean } | undefined;

function channelEnabled(channel: NotificationChannel, prefs: Prefs): boolean {
  // No stored preference means opted in by default, except WhatsApp.
  if (!prefs) return channel !== 'WHATSAPP';

  switch (channel) {
    case 'PUSH':
      return prefs.pushEnabled;
    case 'SMS':
      return prefs.smsEnabled;
    case 'EMAIL':
      return prefs.emailEnabled;
    case 'WHATSAPP':
      return prefs.whatsappEnabled;
    default:
      return true;
  }
}

function channelRecipient(
  channel: NotificationChannel,
  user: { email: string | null; phone: string | null; pushTokens: Array<{ token: string }> },
): string | null {
  switch (channel) {
    case 'EMAIL':
      return user.email;
    case 'SMS':
    case 'WHATSAPP':
      return user.phone;
    case 'PUSH':
      return user.pushTokens[0]?.token ?? null;
    default:
      return null;
  }
}

/**
 * Hand one delivery to its provider and record the outcome.
 * Exported so the retry job can re-drive a failed delivery.
 */
export async function dispatchDelivery(deliveryId: string): Promise<void> {
  const delivery = await prisma.notificationDelivery.findUnique({
    where: { id: deliveryId },
    include: { notification: { select: { title: true, body: true, imageUrl: true, data: true } } },
  });

  if (!delivery) return;

  const attempt = delivery.attemptCount + 1;

  try {
    let providerMessageId: string | null = null;

    switch (delivery.channel) {
      case 'SMS':
        providerMessageId = await sendSms(delivery.recipient, delivery.notification.body);
        break;
      case 'EMAIL':
        providerMessageId = await sendEmail({
          to: delivery.recipient,
          subject: delivery.notification.title,
          html: delivery.notification.body,
        });
        break;
      case 'PUSH':
        providerMessageId = await sendPush({
          token: delivery.recipient,
          title: delivery.notification.title,
          body: delivery.notification.body,
          data: (delivery.notification.data as Record<string, unknown>) ?? {},
        });
        break;
      default:
        throw new Error(`Channel ${delivery.channel} has no provider configured`);
    }

    await prisma.notificationDelivery.update({
      where: { id: deliveryId },
      data: {
        status: 'SENT',
        attemptCount: attempt,
        sentAt: new Date(),
        providerMessageId,
        errorMessage: null,
        nextRetryAt: null,
      },
    });
    notificationsDispatched.inc({ channel: delivery.channel, status: 'sent' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    // Exponential backoff: 1m, 5m, 25m — then give up after 3 attempts.
    const giveUp = attempt >= 3;
    const backoffMs = 60_000 * 5 ** (attempt - 1);

    await prisma.notificationDelivery.update({
      where: { id: deliveryId },
      data: {
        status: 'FAILED',
        attemptCount: attempt,
        failedAt: new Date(),
        errorMessage: message.slice(0, 500),
        nextRetryAt: giveUp ? null : new Date(Date.now() + backoffMs),
      },
    });

    notificationsDispatched.inc({ channel: delivery.channel, status: 'failed' });
    log.warn({ deliveryId, channel: delivery.channel, attempt, err: message }, 'Delivery failed');
  }
}

// ---------------------------------------------------------------------------
// Audience resolution
// ---------------------------------------------------------------------------

export interface AudienceSpec {
  tenantId: string;
  type: 'INSTITUTION' | 'BRANCH' | 'CLASS' | 'SECTION' | 'ROLE' | 'INDIVIDUAL';
  ids?: string[];
  /** Also notify the guardians of matched students. */
  includeGuardians?: boolean;
}

/** Expand an audience specification into concrete user ids. */
export async function resolveAudience(spec: AudienceSpec): Promise<string[]> {
  const { tenantId, type, ids = [], includeGuardians = false } = spec;

  const userIds = new Set<string>();

  switch (type) {
    case 'INSTITUTION': {
      const users = await prisma.user.findMany({
        where: { tenantId, status: 'ACTIVE', deletedAt: null },
        select: { id: true },
      });
      users.forEach((u) => userIds.add(u.id));
      break;
    }

    case 'BRANCH': {
      const users = await prisma.user.findMany({
        where: { tenantId, branchId: { in: ids }, status: 'ACTIVE', deletedAt: null },
        select: { id: true },
      });
      users.forEach((u) => userIds.add(u.id));
      break;
    }

    case 'ROLE': {
      const users = await prisma.user.findMany({
        where: { tenantId, role: { in: ids as never[] }, status: 'ACTIVE', deletedAt: null },
        select: { id: true },
      });
      users.forEach((u) => userIds.add(u.id));
      break;
    }

    case 'CLASS':
    case 'SECTION': {
      const students = await prisma.student.findMany({
        where: {
          tenantId,
          status: 'ACTIVE',
          enrollments: {
            some: type === 'CLASS' ? { classId: { in: ids }, isCurrent: true } : { sectionId: { in: ids }, isCurrent: true },
          },
        },
        select: {
          userId: true,
          guardianLinks: { select: { guardian: { select: { userId: true } } } },
        },
      });

      for (const student of students) {
        if (student.userId) userIds.add(student.userId);
        if (includeGuardians) {
          for (const link of student.guardianLinks) {
            if (link.guardian.userId) userIds.add(link.guardian.userId);
          }
        }
      }
      break;
    }

    case 'INDIVIDUAL':
      ids.forEach((id) => userIds.add(id));
      break;
  }

  return [...userIds];
}

/** Guardian user ids for a set of students — the most common fan-out. */
export async function guardianUserIds(
  studentIds: string[],
  options: { locationCapableOnly?: boolean } = {},
): Promise<string[]> {
  if (studentIds.length === 0) return [];

  const links = await prisma.studentGuardian.findMany({
    where: {
      studentId: { in: studentIds },
      ...(options.locationCapableOnly ? { canViewLocation: true } : {}),
    },
    select: { guardian: { select: { userId: true } } },
  });

  return [
    ...new Set(
      links
        .map((l) => l.guardian.userId)
        .filter((id): id is string => id !== null),
    ),
  ];
}
