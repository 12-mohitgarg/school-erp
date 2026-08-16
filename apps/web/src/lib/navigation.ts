/**
 * Navigation model.
 *
 * Every item declares the permission it needs. The sidebar filters against the
 * signed-in user's effective permissions, so a role never sees a link it cannot
 * open. This is a *usability* filter — the API enforces the same rules again,
 * because hiding a link is not access control.
 */

import {
  BadgeIndianRupee,
  BookOpen,
  Bus,
  CalendarDays,
  ClipboardCheck,
  FileBarChart,
  GraduationCap,
  LayoutDashboard,
  Library,
  MapPin,
  Megaphone,
  MessageSquare,
  Package,
  Settings,
  ShieldCheck,
  Users,
  UserCog,
  Wallet,
  FileText,
  CalendarRange,
  Building2,
  Timer,
  type LucideIcon,
} from 'lucide-react';
import { hasAnyPermission, type Permission } from '@erp/shared';

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  /** Visible when the user holds at least one of these. */
  permissions: Permission[];
  /** Rendered as a live count badge, resolved by the shell. */
  badgeKey?: 'notifications' | 'sos' | 'pendingLeave';
  end?: boolean;
  /**
   * Visible only to a platform operator. Distinct from `permissions`: the
   * control plane above the schools is not a module permission, and a school's
   * own Super Admin holds every permission yet must never see it.
   */
  platformOnly?: boolean;
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

const NAV: NavSection[] = [
  {
    label: 'Platform',
    items: [
      {
        label: 'Schools',
        to: '/platform/schools',
        icon: Building2,
        permissions: [],
        platformOnly: true,
      },
    ],
  },
  {
    label: 'Overview',
    items: [
      { label: 'Dashboard', to: '/', icon: LayoutDashboard, permissions: [], end: true },
    ],
  },
  {
    label: 'Academics',
    items: [
      { label: 'Classes & Sections', to: '/academic/classes', icon: GraduationCap, permissions: ['academic:view'] },
      { label: 'Subjects', to: '/academic/subjects', icon: BookOpen, permissions: ['academic:view'] },
      { label: 'Timetable', to: '/academic/timetable', icon: CalendarRange, permissions: ['academic:view'] },
      { label: 'Calendar', to: '/academic/calendar', icon: CalendarDays, permissions: ['academic:view'] },
    ],
  },
  {
    label: 'People',
    items: [
      { label: 'Students', to: '/students', icon: Users, permissions: ['student:view'] },
      { label: 'Admissions', to: '/students/admissions', icon: FileText, permissions: ['student:create'] },
      { label: 'Staff', to: '/hr/employees', icon: UserCog, permissions: ['hr:view'] },
    ],
  },
  {
    label: 'Daily operations',
    items: [
      { label: 'Attendance', to: '/attendance', icon: ClipboardCheck, permissions: ['attendance:view'] },
      { label: 'Examinations', to: '/examination', icon: FileBarChart, permissions: ['examination:view'] },
      { label: 'Assignments', to: '/examination/assignments', icon: BookOpen, permissions: ['examination:view'] },
    ],
  },
  {
    label: 'Finance',
    items: [
      { label: 'Fees & Invoices', to: '/fees', icon: BadgeIndianRupee, permissions: ['fees:view'] },
      { label: 'Payments', to: '/fees/payments', icon: Wallet, permissions: ['fees:view'] },
    ],
  },
  {
    label: 'Operations',
    items: [
      { label: 'Library', to: '/library', icon: Library, permissions: ['library:view'] },
      { label: 'Transport', to: '/transport', icon: Bus, permissions: ['transport:view'] },
      { label: 'Live Tracking', to: '/tracking', icon: MapPin, permissions: ['tracking:view'], badgeKey: 'sos' },
      { label: 'Inventory', to: '/inventory', icon: Package, permissions: ['inventory:view'] },
    ],
  },
  {
    label: 'People operations',
    items: [
      { label: 'Leave', to: '/hr/leave', icon: CalendarDays, permissions: ['hr:view'], badgeKey: 'pendingLeave' },
      { label: 'Payroll', to: '/hr/payroll', icon: Wallet, permissions: ['hr:view'] },
    ],
  },
  {
    label: 'Communication',
    items: [
      { label: 'Announcements', to: '/communication/announcements', icon: Megaphone, permissions: ['communication:view'] },
      { label: 'Messages', to: '/communication/messages', icon: MessageSquare, permissions: ['communication:view'], badgeKey: 'notifications' },
    ],
  },
  {
    label: 'Insight',
    items: [
      { label: 'Reports', to: '/reports', icon: FileBarChart, permissions: ['reports:view'] },
    ],
  },
  {
    label: 'Administration',
    items: [
      { label: 'Users & Roles', to: '/settings/users', icon: ShieldCheck, permissions: ['settings:view'] },
      { label: 'Scheduler', to: '/settings/scheduler', icon: Timer, permissions: ['settings:view'] },
      { label: 'Settings', to: '/settings', icon: Settings, permissions: ['settings:view'], end: true },
    ],
  },
];

/**
 * Sections the user can actually use, with empty sections dropped so the
 * sidebar never shows a bare heading.
 */
export interface NavContext {
  isPlatformAdmin?: boolean;
}

export function navigationFor(
  permissions: readonly string[],
  context: NavContext = {},
): NavSection[] {
  return NAV.map((section) => ({
    ...section,
    items: section.items.filter((item) => {
      if (item.platformOnly && !context.isPlatformAdmin) return false;
      return item.permissions.length === 0 || hasAnyPermission(permissions, item.permissions);
    }),
  })).filter((section) => section.items.length > 0);
}

/** Flat list, for the command palette and breadcrumb lookups. */
export function allNavItems(
  permissions: readonly string[],
  context: NavContext = {},
): NavItem[] {
  return navigationFor(permissions, context).flatMap((s) => s.items);
}

/**
 * Where to send someone after they sign in.
 *
 * Honours a deep link only when the role can actually open it. Without this
 * check a student whose browser still pointed at `/settings/users` from a
 * previous session landed on a permission-denied screen — technically correct,
 * but a terrible first impression.
 */
export function landingRoute(
  permissions: readonly string[],
  intended?: string | null,
  context: NavContext = {},
): string {
  if (!intended || intended === '/login') return '/';

  const path = intended.split('?')[0] ?? '/';
  if (path === '/') return '/';

  const allowed = allNavItems(permissions, context).some(
    (item) => item.to !== '/' && path.startsWith(item.to),
  );

  return allowed ? intended : '/';
}
