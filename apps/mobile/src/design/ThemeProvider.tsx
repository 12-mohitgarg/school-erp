/**
 * Theme.
 *
 * Follows the OS by default and can be pinned to light or dark. The choice is
 * persisted, because a user who forces light mode has usually done so for a
 * reason (glare on a bus windscreen, or a screen-reader contrast setting) and
 * being asked again every launch is the app forgetting something it was told.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  darkPalette,
  elevation,
  lightPalette,
  motion,
  radii,
  spacing,
  typography,
  type Palette,
} from './tokens';

const STORAGE_KEY = 'edusphere.themePreference';

export type ThemePreference = 'system' | 'light' | 'dark';

export interface Theme {
  colors: Palette;
  spacing: typeof spacing;
  radii: typeof radii;
  typography: typeof typography;
  elevation: typeof elevation;
  motion: typeof motion;
  isDark: boolean;
}

interface ThemeState extends Theme {
  preference: ThemePreference;
  setPreference: (next: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeState | null>(null);

function buildTheme(isDark: boolean): Theme {
  return {
    colors: isDark ? darkPalette : lightPalette,
    spacing,
    radii,
    typography,
    elevation,
    motion,
    isDark,
  };
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>('system');

  useEffect(() => {
    void AsyncStorage.getItem(STORAGE_KEY).then((stored) => {
      if (stored === 'light' || stored === 'dark' || stored === 'system') {
        setPreferenceState(stored);
      }
    });
  }, []);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    void AsyncStorage.setItem(STORAGE_KEY, next);
  }, []);

  const isDark = preference === 'system' ? systemScheme === 'dark' : preference === 'dark';

  const value = useMemo<ThemeState>(
    () => ({ ...buildTheme(isDark), preference, setPreference }),
    [isDark, preference, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeState {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}
