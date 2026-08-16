import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { AuthUser } from '@erp/shared';

interface AuthState {
  user: AuthUser | null;
  /**
   * Held in memory only. The refresh token lives in an httpOnly cookie the
   * browser manages, so a stolen XSS payload cannot exfiltrate a long-lived
   * credential.
   */
  accessToken: string | null;
  /** True until the initial `/auth/me` probe settles, to avoid a login flash. */
  initialising: boolean;
}

const initialState: AuthState = {
  user: null,
  accessToken: null,
  initialising: true,
};

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    signedIn(state, action: PayloadAction<{ user: AuthUser; accessToken: string }>) {
      state.user = action.payload.user;
      state.accessToken = action.payload.accessToken;
      state.initialising = false;
    },
    credentialsUpdated(state, action: PayloadAction<{ accessToken: string }>) {
      state.accessToken = action.payload.accessToken;
    },
    userRefreshed(state, action: PayloadAction<AuthUser>) {
      state.user = action.payload;
      state.initialising = false;
    },
    signedOut(state) {
      state.user = null;
      state.accessToken = null;
      state.initialising = false;
    },
    initialisationFinished(state) {
      state.initialising = false;
    },
  },
});

export const {
  signedIn,
  credentialsUpdated,
  userRefreshed,
  signedOut,
  initialisationFinished,
} = authSlice.actions;

export default authSlice.reducer;
