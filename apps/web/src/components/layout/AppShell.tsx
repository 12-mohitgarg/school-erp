import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  Bell, ChevronLeft, GraduationCap, LogOut, Menu, Moon, Search,
  Sun, Monitor, X, AlertTriangle, MapPin,
} from 'lucide-react';
import { ROLE_LABELS } from '@erp/shared';
import { useAppDispatch, useAppSelector } from '@/store';
import { mobileNavToggled, sidebarToggled, themeSet, sosDismissed, type Theme } from '@/store/uiSlice';
import { navigationFor } from '@/lib/navigation';
import { cn } from '@/lib/utils';
import { Avatar, Badge, Button } from '@/components/ui';
import { SignOutDialog } from '@/components/ui/ConfirmDialog';
import { useAuth } from '@/features/auth/useAuth';
import { useUnreadCountQuery } from '@/features/communication/communicationApi';
import { useStorageConfigQuery } from '@/features/api/endpoints';
import { setStorageConfig } from '@/lib/cloudinary';
import { SchoolSwitcher, ImpersonationBanner } from '@/features/platform/SchoolSwitcher';

export function AppShell() {
  const dispatch = useAppDispatch();
  const location = useLocation();
  const { user, signOut } = useAuth();
  const { sidebarCollapsed, mobileNavOpen, theme, activeSos } = useAppSelector((s) => s.ui);
  // Signing out discards in-flight work, so it asks first.
  const [signOutOpen, setSignOutOpen] = useState(false);

  const sections = navigationFor(user?.permissions ?? [], {
    isPlatformAdmin: Boolean(user?.isPlatformAdmin),
  });
  const { data: unread } = useUnreadCountQuery(undefined, { pollingInterval: 180_000 });

  /*
    Upload settings come from the API rather than the bundle, so storage can be
    re-pointed without a front-end rebuild. Fetched once here and handed to the
    upload helper, which every file control reads from.
  */
  const { data: storage } = useStorageConfigQuery();
  useEffect(() => setStorageConfig(storage), [storage]);

  // Close the mobile drawer on navigation, or it covers the page you just opened.
  useEffect(() => {
    dispatch(mobileNavToggled(false));
  }, [location.pathname, dispatch]);

  if (!user) return null;

  const badgeFor = (key?: string): number | undefined => {
    if (key === 'notifications') return unread?.unreadCount || undefined;
    return undefined;
  };

  return (
    <div className="flex h-full bg-canvas">
      {/* Mobile scrim */}
      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-950/50 backdrop-blur-sm lg:hidden animate-fade-in"
          onClick={() => dispatch(mobileNavToggled(false))}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          // Off-canvas below lg, in normal flow from lg up. `shrink-0` stops
          // wide page content from squeezing it and pushing the layout sideways.
          'fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-hairline bg-surface',
          'transition-[width,transform] duration-200 lg:static lg:translate-x-0 lg:shrink-0',
          sidebarCollapsed ? 'lg:w-[4.25rem]' : 'lg:w-64',
          mobileNavOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        {/* Brand */}
        <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-hairline px-4">
          <div className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-400 via-brand-500 to-brand-700 shadow-brand-glow ring-1 ring-white/20">
            <GraduationCap className="relative text-white" style={{ width: 18, height: 18 }} aria-hidden="true" />
          </div>
          {!sidebarCollapsed && (
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-ink">EduSphere</p>
              <p className="truncate text-2xs text-ink-subtle">{user.tenantName}</p>
            </div>
          )}
          <button
            type="button"
            onClick={() => dispatch(mobileNavToggled(false))}
            className="-mr-1 rounded-lg p-1.5 text-ink-subtle hover:bg-surface-sunken lg:hidden"
            aria-label="Close navigation"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {/* Links */}
        <nav className="flex-1 space-y-4 overflow-y-auto px-3 py-4" aria-label="Main">
          {sections.map((section) => (
            <div key={section.label}>
              {!sidebarCollapsed && (
                <p className="mb-1 px-2 text-2xs font-semibold uppercase tracking-wider text-ink-subtle">
                  {section.label}
                </p>
              )}
              <ul className="space-y-0.5">
                {section.items.map((item) => {
                  const count = badgeFor(item.badgeKey);
                  return (
                    <li key={item.to}>
                      <NavLink
                        to={item.to}
                        end={item.end}
                        title={sidebarCollapsed ? item.label : undefined}
                        className={({ isActive }) =>
                          cn(
                            'group relative flex items-center gap-2.5 rounded-lg px-2 py-2 text-sm font-medium transition-colors',
                            isActive
                              ? 'bg-brand-500/10 text-brand-600'
                              : 'text-ink-muted hover:bg-surface-sunken hover:text-ink',
                            sidebarCollapsed && 'justify-center',
                          )
                        }
                      >
                        {({ isActive }) => (
                          <>
                            {isActive && (
                              <span className="absolute inset-y-1 left-0 w-0.5 rounded-r-full bg-brand-600" />
                            )}
                            <item.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                            {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
                            {!sidebarCollapsed && count ? (
                              <span className="ml-auto rounded-full bg-brand-600 px-1.5 py-0.5 text-2xs font-semibold text-white nums">
                                {count > 99 ? '99+' : count}
                              </span>
                            ) : null}
                          </>
                        )}
                      </NavLink>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        {/* User */}
        <div className="shrink-0 border-t border-hairline p-3">
          <div className={cn('flex items-center gap-2.5', sidebarCollapsed && 'justify-center')}>
            <Avatar name={user.fullName} src={user.avatarUrl} size="sm" />
            {!sidebarCollapsed && (
              <>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{user.fullName}</p>
                  <p className="truncate text-2xs text-ink-subtle">{ROLE_LABELS[user.role]}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setSignOutOpen(true)}
                  aria-label="Sign out"
                  title="Sign out"
                  className="rounded-lg p-1.5 text-ink-subtle transition-colors hover:bg-danger/10 hover:text-danger"
                >
                  <LogOut className="h-4 w-4" aria-hidden="true" />
                </button>
              </>
            )}
          </div>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="glass sticky top-0 z-30 flex h-14 min-w-0 shrink-0 items-center gap-1.5 border-b border-hairline px-3 sm:gap-2 sm:px-4">
          <button
            type="button"
            onClick={() => dispatch(mobileNavToggled())}
            className="rounded-lg p-2 text-ink-muted hover:bg-surface-sunken lg:hidden"
            aria-label="Open navigation"
          >
            <Menu className="h-4.5 w-4.5" style={{ width: 18, height: 18 }} aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={() => dispatch(sidebarToggled())}
            className="hidden rounded-lg p-2 text-ink-muted transition-colors hover:bg-surface-sunken lg:block"
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <ChevronLeft
              className={cn('h-4 w-4 transition-transform', sidebarCollapsed && 'rotate-180')}
              aria-hidden="true"
            />
          </button>

          {/* Search hides below sm, where the header has no room for it. */}
          <div className="relative hidden min-w-0 max-w-sm flex-1 sm:block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-subtle" aria-hidden="true" />
            <input
              type="search"
              placeholder="Search students, staff, invoices…"
              className="h-9 w-full rounded-lg border border-hairline bg-surface-sunken/60 pl-9 pr-3 text-sm text-ink placeholder:text-ink-subtle focus:border-brand-500 focus:bg-surface"
            />
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-0.5 sm:gap-1">
            {/* Which school am I in? Only a platform operator can change it. */}
            <SchoolSwitcher />

            {user.branchName && (
              <Badge tone="neutral" className="hidden lg:inline-flex">
                {user.branchName}
              </Badge>
            )}

            <ThemeToggle theme={theme} onChange={(t) => dispatch(themeSet(t))} />

            <NavLink
              to="/communication/messages"
              className="relative rounded-lg p-2 text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink"
              aria-label="Notifications"
            >
              <Bell className="h-4 w-4" aria-hidden="true" />
              {unread?.unreadCount ? (
                <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-danger ring-2 ring-surface" />
              ) : null}
            </NavLink>
          </div>
        </header>

        <ImpersonationBanner />

        {/* SOS banner — the one thing that should interrupt any screen. */}
        {activeSos && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-danger/30 bg-danger/10 px-3 py-2.5 sm:flex-nowrap sm:px-4">
            <span className="relative flex h-2.5 w-2.5 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-pulse-ring rounded-full bg-danger opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-danger" />
            </span>
            <AlertTriangle className="h-4 w-4 shrink-0 text-danger" aria-hidden="true" />
            <p className="min-w-0 flex-1 truncate text-sm font-medium text-danger">
              Emergency SOS from {activeSos.raisedByName}
              {activeSos.message ? ` — ${activeSos.message}` : ''}
            </p>
            <NavLink to="/tracking">
              <Button size="xs" variant="danger" leftIcon={<MapPin className="h-3 w-3" />}>
                View live
              </Button>
            </NavLink>
            <button
              type="button"
              onClick={() => dispatch(sosDismissed())}
              aria-label="Dismiss"
              className="rounded p-1 text-danger/70 hover:text-danger"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        )}

        {/* `min-w-0` lets this column shrink below its content's intrinsic
            width; without it a wide table would widen the whole layout. */}
        <main className="min-w-0 flex-1 overflow-y-auto">
          {/*
            Keyed on the path so React remounts the subtree on navigation,
            replaying the entry animation. Without the key the content would
            swap instantly and the app would feel abrupt.
          */}
          <div
            key={location.pathname}
            className="mx-auto w-full min-w-0 max-w-[1600px] animate-fade-in px-4 py-5 sm:px-6 sm:py-6"
          >
            <Outlet />
          </div>
        </main>
      </div>

      <SignOutDialog
        open={signOutOpen}
        onClose={() => setSignOutOpen(false)}
        onConfirm={signOut}
      />
    </div>
  );
}

function ThemeToggle({ theme, onChange }: { theme: Theme; onChange: (t: Theme) => void }) {
  const order: Theme[] = ['light', 'dark', 'system'];
  const Icon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor;

  return (
    <button
      type="button"
      onClick={() => onChange(order[(order.indexOf(theme) + 1) % order.length]!)}
      className="rounded-lg p-2 text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink"
      aria-label={`Theme: ${theme}. Click to change.`}
      title={`Theme: ${theme}`}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
    </button>
  );
}

