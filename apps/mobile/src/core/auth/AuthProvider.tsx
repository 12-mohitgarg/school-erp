/**
 * Session state for the whole app.
 *
 * Holds the signed-in user, the child a guardian is currently looking at, and
 * the bootstrap state that decides whether we show the splash, the login
 * screen or the app.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { AuthUser, LinkedChild, Role } from '@erp/shared';
import { authApi } from '@/core/api/endpoints';
import {
  adoptTokens,
  currentRefreshToken,
  forgetTokens,
  hydrateClient,
  setSignedOutHandler,
} from '@/core/api/client';
import { resetQueryCache } from '@/core/api/queryClient';
import {
  getDeviceId,
  loadActiveChildId,
  saveActiveChildId,
  saveUser,
} from '@/core/auth/session';
import { registerForPush, unregisterPush } from '@/core/push/push';

type Status = 'loading' | 'signedOut' | 'signedIn';

interface AuthState {
  status: Status;
  user: AuthUser | null;
  role: Role | null;

  /** Guardians can have several children; every family screen reads this one. */
  activeChild: LinkedChild | null;
  children: LinkedChild[];
  selectChild: (studentId: string) => void;

  /**
   * The student whose records the current screen should show — the signed-in
   * student for a STUDENT login, the selected child for a PARENT login. Null
   * for a driver, who has no student context.
   */
  subjectStudentId: string | null;

  signIn: (identifier: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children: tree }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [activeChildId, setActiveChildId] = useState<string | null>(null);

  /** Guards against a `me()` response landing after the user signed out. */
  const generation = useRef(0);

  const applyUser = useCallback((next: AuthUser) => {
    setUser(next);
    void saveUser(next);
  }, []);

  // --- Bootstrap -----------------------------------------------------------

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const [{ accessToken, user: cachedUser }, storedChildId] = await Promise.all([
        hydrateClient(),
        loadActiveChildId(),
      ]);

      if (cancelled) return;
      if (storedChildId) setActiveChildId(storedChildId);

      if (!accessToken) {
        setStatus('signedOut');
        return;
      }

      // Paint from the cached profile immediately, then reconcile. A cold
      // start behind a spinner is the difference between an app that feels
      // native and one that feels like a website in a shell.
      if (cachedUser) {
        setUser(cachedUser);
        setStatus('signedIn');
      }

      try {
        const fresh = await authApi.me();
        if (cancelled) return;
        applyUser(fresh);
        setStatus('signedIn');
      } catch {
        // `request()` has already cleared the session if the refresh failed;
        // anything else (offline) leaves the cached profile in place.
        if (cancelled) return;
        setStatus((prev) => (cachedUser ? prev : 'signedOut'));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [applyUser]);

  // --- Forced sign-out from the API layer ----------------------------------

  useEffect(() => {
    setSignedOutHandler(() => {
      generation.current += 1;
      setUser(null);
      setActiveChildId(null);
      setStatus('signedOut');
      resetQueryCache();
    });
    return () => setSignedOutHandler(null);
  }, []);

  // --- Actions -------------------------------------------------------------

  const signIn = useCallback(
    async (identifier: string, password: string) => {
      const deviceId = await getDeviceId();
      const result = await authApi.login(identifier.trim(), password, deviceId);

      await adoptTokens(result.tokens);
      applyUser(result.user);

      const firstChild = result.user.children?.[0]?.studentId ?? null;
      if (firstChild) {
        setActiveChildId(firstChild);
        void saveActiveChildId(firstChild);
      }

      setStatus('signedIn');

      // Best-effort: a device that cannot register for push still gets the
      // in-app inbox and the live socket, so this must never block sign-in.
      void registerForPush();
    },
    [applyUser],
  );

  const signOut = useCallback(async () => {
    generation.current += 1;
    const refreshToken = currentRefreshToken();

    // Retire the push token first — otherwise the school keeps notifying a
    // handset whose owner has signed out, which for a guardian means another
    // family's alerts on their lock screen.
    await unregisterPush().catch(() => undefined);
    await authApi.logout(refreshToken).catch(() => undefined);
    await forgetTokens();

    setUser(null);
    setActiveChildId(null);
    setStatus('signedOut');
    resetQueryCache();
  }, []);

  const refreshUser = useCallback(async () => {
    const fresh = await authApi.me();
    applyUser(fresh);
  }, [applyUser]);

  const selectChild = useCallback((studentId: string) => {
    setActiveChildId(studentId);
    void saveActiveChildId(studentId);
  }, []);

  // --- Derived -------------------------------------------------------------

  const linkedChildren = useMemo(() => user?.children ?? [], [user]);

  const activeChild = useMemo(() => {
    if (linkedChildren.length === 0) return null;
    return (
      linkedChildren.find((c) => c.studentId === activeChildId) ?? linkedChildren[0] ?? null
    );
  }, [linkedChildren, activeChildId]);

  const subjectStudentId = useMemo(() => {
    if (!user) return null;
    if (user.role === 'STUDENT') return user.studentId ?? null;
    if (user.role === 'PARENT') return activeChild?.studentId ?? null;
    return null;
  }, [user, activeChild]);

  const value = useMemo<AuthState>(
    () => ({
      status,
      user,
      role: user?.role ?? null,
      activeChild,
      children: linkedChildren,
      selectChild,
      subjectStudentId,
      signIn,
      signOut,
      refreshUser,
    }),
    [
      status,
      user,
      activeChild,
      linkedChildren,
      selectChild,
      subjectStudentId,
      signIn,
      signOut,
      refreshUser,
    ],
  );

  return <AuthContext.Provider value={value}>{tree}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/**
 * The signed-in user, for screens that only render behind the authenticated
 * navigator and would otherwise null-check on every line.
 */
export function useCurrentUser(): AuthUser {
  const { user } = useAuth();
  if (!user) throw new Error('useCurrentUser used outside an authenticated screen');
  return user;
}
