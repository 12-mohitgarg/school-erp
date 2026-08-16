import type { AuthUser } from '@erp/shared';
import { api, unwrap, type Envelope } from '@/lib/api';

interface LoginResponse {
  user: AuthUser;
  tokens: { accessToken: string; refreshToken: string; expiresIn: number };
  homeRoute: string;
}

export const authApi = api.injectEndpoints({
  endpoints: (build) => ({
    login: build.mutation<LoginResponse, { identifier: string; password: string }>({
      query: (body) => ({ url: '/auth/login', method: 'POST', body }),
      transformResponse: unwrap<LoginResponse>,
      // A new session invalidates every cached query from the previous one.
      invalidatesTags: (_r, _e) => ['Auth', 'Dashboard'],
    }),

    me: build.query<AuthUser, void>({
      query: () => '/auth/me',
      transformResponse: unwrap<AuthUser>,
      providesTags: ['Auth'],
    }),

    logout: build.mutation<void, void>({
      query: () => ({ url: '/auth/logout', method: 'POST' }),
    }),

    changePassword: build.mutation<
      { message: string },
      { currentPassword: string; newPassword: string; confirmPassword: string }
    >({
      query: (body) => ({ url: '/auth/change-password', method: 'POST', body }),
      transformResponse: unwrap<{ message: string }>,
    }),

    forgotPassword: build.mutation<{ message: string }, { identifier: string }>({
      query: (body) => ({ url: '/auth/forgot-password', method: 'POST', body }),
      transformResponse: unwrap<{ message: string }>,
    }),

    sessions: build.query<
      Array<{
        sessionId: string;
        userAgent: string | null;
        ipAddress: string | null;
        signedInAt: string;
        isCurrent: boolean;
      }>,
      void
    >({
      query: () => '/auth/sessions',
      transformResponse: (r: Envelope<never>) => r.data,
      providesTags: ['Auth'],
    }),

    revokeSession: build.mutation<void, { sessionId: string }>({
      query: (body) => ({ url: '/auth/sessions/revoke', method: 'POST', body }),
      invalidatesTags: ['Auth'],
    }),
  }),
});

export const {
  useLoginMutation,
  useMeQuery,
  useLazyMeQuery,
  useLogoutMutation,
  useChangePasswordMutation,
  useForgotPasswordMutation,
  useSessionsQuery,
  useRevokeSessionMutation,
} = authApi;
