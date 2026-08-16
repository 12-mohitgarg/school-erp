import { useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { hasPermission, type AuthUser, type Permission } from '@erp/shared';
import { useAppDispatch, useAppSelector } from '@/store';
import { signedIn, signedOut, userRefreshed, initialisationFinished } from '@/store/authSlice';
import { api } from '@/lib/api';
import { authApi, useLogoutMutation } from './authApi';

export function useAuth() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { user, accessToken, initialising } = useAppSelector((s) => s.auth);
  const [logoutMutation] = useLogoutMutation();

  const signOut = useCallback(async () => {
    try {
      await logoutMutation().unwrap();
    } catch {
      // Even if the server call fails, clear local state — the user asked to leave.
    }
    dispatch(signedOut());
    // Purge every cached query so the next user never sees the previous one's data.
    dispatch(api.util.resetApiState());
    navigate('/login', { replace: true });
  }, [dispatch, logoutMutation, navigate]);

  const can = useCallback(
    (permission: Permission | Permission[]) => hasPermission(user?.permissions ?? [], permission),
    [user],
  );

  return {
    user,
    accessToken,
    initialising,
    isAuthenticated: Boolean(user && accessToken),
    signOut,
    can,
  };
}

/**
 * Restore a session on a cold load.
 *
 * The access token lives only in memory, so after a refresh we hold just the
 * httpOnly refresh cookie. Calling `/auth/refresh` exchanges it for a new
 * access token; if that fails the user is genuinely signed out.
 */
export function useSessionRestore(): void {
  const dispatch = useAppDispatch();
  const accessToken = useAppSelector((s) => s.auth.accessToken);
  // StrictMode double-invokes effects in development; this makes restore run once.
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current || accessToken) {
      if (accessToken) dispatch(initialisationFinished());
      return;
    }
    attempted.current = true;

    void (async () => {
      try {
        const refreshed = await fetch('/api/v1/auth/refresh', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        });

        if (!refreshed.ok) {
          dispatch(signedOut());
          return;
        }

        const body = (await refreshed.json()) as {
          data?: { tokens?: { accessToken?: string }; user?: AuthUser };
        };
        const token = body.data?.tokens?.accessToken;

        if (!token) {
          dispatch(signedOut());
          return;
        }

        // The refresh response carries the user, so the session is restored in
        // a single round trip. The fallback covers an older API build.
        if (body.data?.user) {
          dispatch(signedIn({ user: body.data.user, accessToken: token }));
          return;
        }

        const me = await dispatch(authApi.endpoints.me.initiate(undefined, { forceRefetch: true }));

        if ('data' in me && me.data) {
          dispatch(signedIn({ user: me.data, accessToken: token }));
        } else {
          dispatch(signedOut());
        }
      } catch {
        dispatch(signedOut());
      }
    })();
  }, [accessToken, dispatch]);
}

/** Keep the cached user in step after profile or permission changes. */
export function useRefreshUser() {
  const dispatch = useAppDispatch();

  return useCallback(async () => {
    const result = await dispatch(
      authApi.endpoints.me.initiate(undefined, { forceRefetch: true }),
    );
    if ('data' in result && result.data) dispatch(userRefreshed(result.data));
  }, [dispatch]);
}
