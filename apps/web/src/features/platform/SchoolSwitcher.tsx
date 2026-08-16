/**
 * School switcher — visible only to platform operators.
 *
 * Sits in the header and names the school the session is currently working in.
 * Switching reissues the access token against the chosen school and drops the
 * RTK cache, so no data from the previous school can render under the new
 * school's name even for a frame.
 */

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, Check, ChevronDown, Home, Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { useSchoolsQuery, useOpenSchoolMutation } from '@/features/api/endpoints';
import { useAuth, useRefreshUser } from '@/features/auth/useAuth';
import { useAppDispatch } from '@/store';
import { credentialsUpdated } from '@/store/authSlice';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';

export function SchoolSwitcher() {
  const { user } = useAuth();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const refreshUser = useRefreshUser();

  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Only fetch the school list once the menu is opened — a platform admin
  // working inside one school all day should not pay for this on every page.
  const { data, isLoading } = useSchoolsQuery({ limit: 50 }, { skip: !open });
  const [openSchool] = useOpenSchoolMutation();

  // Click-outside and Escape both close the menu.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (!user?.isPlatformAdmin) return null;

  async function switchTo(id: string, name: string) {
    setSwitching(id);
    try {
      const result = await openSchool(id).unwrap();

      dispatch(credentialsUpdated({ accessToken: result.tokens.accessToken }));
      dispatch(api.util.resetApiState());
      await refreshUser();

      setOpen(false);
      toast.success(`Now working in ${result.school.name}`);
      navigate('/');
    } catch (err) {
      toast.error(`Could not open ${name}`, { description: errorMessage(err) });
    } finally {
      setSwitching(null);
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          'flex max-w-[190px] items-center gap-1.5 rounded-lg border border-hairline px-2 py-1.5',
          'text-xs font-medium text-ink transition-colors hover:bg-surface-sunken',
          user.impersonatingTenant && 'border-warning/50 bg-warning/5',
        )}
      >
        <Building2 className="h-3.5 w-3.5 shrink-0 text-ink-subtle" aria-hidden="true" />
        <span className="truncate">{user.tenantName}</span>
        <ChevronDown
          className={cn('h-3 w-3 shrink-0 text-ink-subtle transition-transform', open && 'rotate-180')}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-1.5 w-72 overflow-hidden rounded-xl border border-hairline bg-surface shadow-xl animate-slide-up"
        >
          <div className="border-b border-hairline px-3 py-2">
            <p className="text-2xs font-semibold uppercase tracking-wider text-ink-subtle">
              Switch school
            </p>
          </div>

          <div className="max-h-80 overflow-y-auto py-1">
            {isLoading ? (
              <p className="flex items-center gap-2 px-3 py-3 text-xs text-ink-muted">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                Loading schools…
              </p>
            ) : (data?.items.length ?? 0) === 0 ? (
              <p className="px-3 py-3 text-xs text-ink-muted">No schools yet.</p>
            ) : (
              data?.items.map((school) => {
                const current = school.id === user.tenantId;

                return (
                  <button
                    key={school.id}
                    type="button"
                    role="menuitem"
                    disabled={!school.isActive || switching !== null}
                    onClick={() => void switchTo(school.id, school.name)}
                    className={cn(
                      'flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors',
                      current ? 'bg-brand-500/[0.07]' : 'hover:bg-surface-sunken',
                      !school.isActive && 'cursor-not-allowed opacity-50',
                    )}
                  >
                    <span
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-2xs font-semibold text-white"
                      style={{ backgroundColor: school.primaryColor }}
                      aria-hidden="true"
                    >
                      {school.code.slice(0, 2).toUpperCase()}
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium text-ink">
                        {school.name}
                      </span>
                      <span className="block truncate text-2xs text-ink-subtle">
                        {school.counts.students} students
                        {!school.isActive ? ' · suspended' : ''}
                      </span>
                    </span>

                    {switching === school.id ? (
                      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-brand-600" aria-hidden="true" />
                    ) : current ? (
                      <Check className="h-3.5 w-3.5 shrink-0 text-brand-600" aria-hidden="true" />
                    ) : null}
                  </button>
                );
              })
            )}
          </div>

          <div className="border-t border-hairline">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                navigate('/platform/schools');
              }}
              className="flex w-full items-center gap-2 px-3 py-2.5 text-xs font-medium text-brand-600 transition-colors hover:bg-surface-sunken"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Manage schools
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Banner shown while an operator is inside a school that is not their own.
 *
 * Working in someone else's data without a constant reminder is how a support
 * session turns into an accidental edit on the wrong school.
 */
export function ImpersonationBanner() {
  const { user } = useAuth();
  const navigate = useNavigate();

  if (!user?.impersonatingTenant) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-warning/30 bg-warning/10 px-3 py-2 sm:px-4">
      <Building2 className="h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
      <p className="min-w-0 flex-1 truncate text-xs font-medium text-warning">
        You are working inside <span className="font-semibold">{user.tenantName}</span> as a
        platform administrator. Changes affect this school's live data.
      </p>
      <button
        type="button"
        onClick={() => navigate('/platform/schools')}
        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-warning underline-offset-2 hover:underline"
      >
        <Home className="h-3 w-3" aria-hidden="true" />
        Back to schools
      </button>
    </div>
  );
}
