import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

export type Theme = 'light' | 'dark' | 'system';

interface UiState {
  theme: Theme;
  sidebarCollapsed: boolean;
  /** Mobile drawer — separate from `sidebarCollapsed`, which is the desktop rail. */
  mobileNavOpen: boolean;
  commandPaletteOpen: boolean;
  /** Live SOS banner, pushed over the socket. */
  activeSos: {
    alertId: string;
    raisedByName: string;
    message: string | null;
    latitude: number;
    longitude: number;
  } | null;
}

const STORAGE_KEY = 'erp-theme';
const SIDEBAR_KEY = 'erp-sidebar-collapsed';

function readTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  } catch {
    // Private browsing can throw on localStorage access.
  }
  return 'system';
}

function readSidebar(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === 'true';
  } catch {
    return false;
  }
}

/** Apply the theme to the document root, resolving `system` against the OS. */
export function applyTheme(theme: Theme): void {
  const dark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  document.documentElement.classList.toggle('dark', dark);

  try {
    // `system` is stored as absent so the pre-paint script re-resolves it.
    if (theme === 'system') localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Ignore storage failures — the theme still applies for this session.
  }
}

const initialState: UiState = {
  theme: readTheme(),
  sidebarCollapsed: readSidebar(),
  mobileNavOpen: false,
  commandPaletteOpen: false,
  activeSos: null,
};

const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    themeSet(state, action: PayloadAction<Theme>) {
      state.theme = action.payload;
      applyTheme(action.payload);
    },
    sidebarToggled(state) {
      state.sidebarCollapsed = !state.sidebarCollapsed;
      try {
        localStorage.setItem(SIDEBAR_KEY, String(state.sidebarCollapsed));
      } catch {
        // Non-fatal.
      }
    },
    mobileNavToggled(state, action: PayloadAction<boolean | undefined>) {
      state.mobileNavOpen = action.payload ?? !state.mobileNavOpen;
    },
    commandPaletteToggled(state, action: PayloadAction<boolean | undefined>) {
      state.commandPaletteOpen = action.payload ?? !state.commandPaletteOpen;
    },
    sosRaised(state, action: PayloadAction<UiState['activeSos']>) {
      state.activeSos = action.payload;
    },
    sosDismissed(state) {
      state.activeSos = null;
    },
  },
});

export const {
  themeSet,
  sidebarToggled,
  mobileNavToggled,
  commandPaletteToggled,
  sosRaised,
  sosDismissed,
} = uiSlice.actions;

export default uiSlice.reducer;
