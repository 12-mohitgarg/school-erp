import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { Permission } from '@erp/shared';
import { AppShell } from '@/components/layout/AppShell';
import { AuthBootScreen, LoginPage } from '@/features/auth/LoginPage';
import { useAuth } from '@/features/auth/useAuth';
import { EmptyState } from '@/components/ui';
import { PageSkeleton, DetailSkeleton } from '@/components/ui/Skeletons';

// Route-level code splitting keeps the initial bundle small; a librarian never
// downloads the payroll screens.
const DashboardPage = lazy(() => import('@/features/dashboard/DashboardPage'));
const StudentsPage = lazy(() => import('@/features/students/StudentsPage'));
const StudentDetailPage = lazy(() => import('@/features/students/StudentDetailPage'));
const AdmissionsPage = lazy(() => import('@/features/students/AdmissionsPage'));
const ClassesPage = lazy(() => import('@/features/academic/ClassesPage'));
const SubjectsPage = lazy(() => import('@/features/academic/SubjectsPage'));
const TimetablePage = lazy(() => import('@/features/academic/TimetablePage'));
const CalendarPage = lazy(() => import('@/features/academic/CalendarPage'));
const AttendancePage = lazy(() => import('@/features/attendance/AttendancePage'));
const ExaminationPage = lazy(() => import('@/features/examination/ExaminationPage'));
const AssignmentsPage = lazy(() => import('@/features/examination/AssignmentsPage'));
const FeesPage = lazy(() => import('@/features/fees/FeesPage'));
const PaymentsPage = lazy(() => import('@/features/fees/PaymentsPage'));
const EmployeesPage = lazy(() => import('@/features/hr/EmployeesPage'));
const LeavePage = lazy(() => import('@/features/hr/LeavePage'));
const PayrollPage = lazy(() => import('@/features/hr/PayrollPage'));
const LibraryPage = lazy(() => import('@/features/library/LibraryPage'));
const TransportPage = lazy(() => import('@/features/transport/TransportPage'));
const TrackingPage = lazy(() => import('@/features/tracking/TrackingPage'));
const InventoryPage = lazy(() => import('@/features/inventory/InventoryPage'));
const AnnouncementsPage = lazy(() => import('@/features/communication/AnnouncementsPage'));
const MessagesPage = lazy(() => import('@/features/communication/MessagesPage'));
const ReportsPage = lazy(() => import('@/features/reports/ReportsPage'));
const UsersPage = lazy(() => import('@/features/settings/UsersPage'));
const SettingsPage = lazy(() => import('@/features/settings/SettingsPage'));
const SchedulerPage = lazy(() => import('@/features/settings/SchedulerPage'));
const SchoolsPage = lazy(() => import('@/features/platform/SchoolsPage'));

/**
 * Chunk-loading fallback.
 *
 * A skeleton in the shape of the page, not a spinner: on a slow connection the
 * lazy chunk fetch is the longest wait in the app, and a spinner there makes
 * the whole product feel sluggish even when the data behind it is fast.
 */
function PageFallback() {
  return <PageSkeleton />;
}

/** Redirects to sign-in, remembering where the user was headed. */
function RequireAuth({ children }: { children: ReactNode }) {
  const { isAuthenticated, initialising } = useAuth();
  const location = useLocation();

  if (initialising) return <AuthBootScreen />;
  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  return <>{children}</>;
}

/**
 * Platform-operator gate.
 *
 * Checked on a flag rather than a permission: a school's own Super Admin holds
 * every permission in the matrix and must still never reach the control plane
 * above the schools. The API enforces the same rule on every platform route.
 */
function RequirePlatformAdmin({ children }: { children: ReactNode }) {
  const { user } = useAuth();

  if (!user?.isPlatformAdmin) {
    return (
      <EmptyState
        title="Platform administrators only"
        description="Managing schools is restricted to the platform operator. Your account administers a single school."
      />
    );
  }
  return <>{children}</>;
}

/**
 * Client-side permission gate. A convenience for the user, not a security
 * boundary — the API re-checks every request regardless.
 */
function RequirePermission({ permission, children }: { permission: Permission; children: ReactNode }) {
  const { can } = useAuth();

  if (!can(permission)) {
    return (
      <EmptyState
        title="You don't have access to this"
        description="Your role does not include permission for this area. Contact your administrator if you think this is a mistake."
      />
    );
  }
  return <>{children}</>;
}

/** Wrap a lazy page in its suspense boundary and permission gate. */
function page(
  element: ReactNode,
  permission?: Permission,
  options: { fallback?: ReactNode; platformOnly?: boolean } = {},
) {
  let content: ReactNode = (
    <Suspense fallback={options.fallback ?? <PageFallback />}>{element}</Suspense>
  );

  if (permission) {
    content = <RequirePermission permission={permission}>{content}</RequirePermission>;
  }
  if (options.platformOnly) {
    content = <RequirePlatformAdmin>{content}</RequirePlatformAdmin>;
  }
  return content;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route index element={page(<DashboardPage />)} />

        {/* The control plane above the schools. */}
        <Route
          path="platform/schools"
          element={page(<SchoolsPage />, undefined, { platformOnly: true })}
        />

        <Route path="students">
          <Route index element={page(<StudentsPage />, 'student:view')} />
          <Route path="admissions" element={page(<AdmissionsPage />, 'student:view')} />
          <Route
            path=":id"
            element={page(<StudentDetailPage />, 'student:view', {
              fallback: <DetailSkeleton />,
            })}
          />
        </Route>

        <Route path="academic">
          <Route path="classes" element={page(<ClassesPage />, 'academic:view')} />
          <Route path="subjects" element={page(<SubjectsPage />, 'academic:view')} />
          <Route path="timetable" element={page(<TimetablePage />, 'academic:view')} />
          <Route path="calendar" element={page(<CalendarPage />, 'academic:view')} />
        </Route>

        <Route path="attendance" element={page(<AttendancePage />, 'attendance:view')} />

        <Route path="examination">
          <Route index element={page(<ExaminationPage />, 'examination:view')} />
          <Route path="assignments" element={page(<AssignmentsPage />, 'examination:view')} />
        </Route>

        <Route path="fees">
          <Route index element={page(<FeesPage />, 'fees:view')} />
          <Route path="payments" element={page(<PaymentsPage />, 'fees:view')} />
        </Route>

        <Route path="hr">
          <Route path="employees" element={page(<EmployeesPage />, 'hr:view')} />
          <Route path="leave" element={page(<LeavePage />, 'hr:view')} />
          <Route path="payroll" element={page(<PayrollPage />, 'hr:view')} />
        </Route>

        <Route path="library" element={page(<LibraryPage />, 'library:view')} />
        <Route path="transport" element={page(<TransportPage />, 'transport:view')} />
        <Route path="tracking" element={page(<TrackingPage />, 'tracking:view')} />
        <Route path="inventory" element={page(<InventoryPage />, 'inventory:view')} />

        <Route path="communication">
          <Route path="announcements" element={page(<AnnouncementsPage />, 'communication:view')} />
          <Route path="messages" element={page(<MessagesPage />, 'communication:view')} />
        </Route>

        <Route path="reports" element={page(<ReportsPage />, 'reports:view')} />

        <Route path="settings">
          <Route index element={page(<SettingsPage />, 'settings:view')} />
          <Route path="users" element={page(<UsersPage />, 'settings:view')} />
          <Route path="scheduler" element={page(<SchedulerPage />, 'settings:view')} />
        </Route>

        <Route
          path="*"
          element={
            <EmptyState
              title="Page not found"
              description="The page you were looking for does not exist or has moved."
            />
          }
        />
      </Route>
    </Routes>
  );
}
