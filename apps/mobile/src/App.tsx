/**
 * App root.
 *
 * Provider order is not arbitrary:
 *
 *   SafeArea → Theme → QueryClient → Auth → Socket → Network → Navigation
 *
 * Auth must sit above Socket because the socket handshake presents the access
 * token; Network sits inside Auth so the offline queue only flushes for a
 * signed-in session; and Navigation is innermost so its theme comes from ours
 * rather than React Navigation's defaults.
 *
 * No `GestureHandlerRootView`: React Navigation 7 does not require
 * react-native-gesture-handler (only `react-native-screens` and
 * `react-native-safe-area-context`), and nothing here uses a gesture API. It
 * was a defensive dependency whose native code failed to link against NDK 27
 * with a wall of `undefined symbol: operator delete` errors — so it is gone
 * rather than worked around. Add it back only alongside an actual gesture.
 */

import { useCallback, useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer, type NavigationContainerRef } from '@react-navigation/native';
import { QueryClientProvider } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import * as SplashScreen from 'expo-splash-screen';
import { queryClient } from '@/core/api/queryClient';
import { AuthProvider, useAuth } from '@/core/auth/AuthProvider';
import { NetworkProvider } from '@/core/offline/NetworkProvider';
import { SocketProvider } from '@/core/realtime/SocketProvider';
import { ThemeProvider, useTheme } from '@/design/ThemeProvider';
import { navigationTheme } from '@/navigation/screenOptions';
import { RootNavigator } from '@/navigation/RootNavigator';
import { DEEP_LINK_MAP } from '@/navigation/types';
import { ErrorBoundary } from '@/features/shared/ErrorBoundary';

// Hold the native splash until the session has been read from the keystore.
void SplashScreen.preventAutoHideAsync().catch(() => undefined);

export default function App() {
  return (
    <View style={styles.root}>
      <SafeAreaProvider>
        <ThemeProvider>
          <ErrorBoundary>
            <QueryClientProvider client={queryClient}>
              <AuthProvider>
                <SocketProvider>
                  <NetworkProvider>
                    <NavigationShell />
                  </NetworkProvider>
                </SocketProvider>
              </AuthProvider>
            </QueryClientProvider>
          </ErrorBoundary>
        </ThemeProvider>
      </SafeAreaProvider>
    </View>
  );
}

function NavigationShell() {
  const theme = useTheme();
  const { status } = useAuth();
  const navigationRef = useRef<NavigationContainerRef<Record<string, object | undefined>>>(null);

  /**
   * Reveal the app only once we know whether the user is signed in. Hiding the
   * splash earlier means a flash of the login screen for a user who is
   * already signed in — the single most common "cheap-looking" mobile bug.
   */
  useEffect(() => {
    if (status === 'loading') return;
    void SplashScreen.hideAsync().catch(() => undefined);
  }, [status]);

  /**
   * Deep links from a push notification.
   *
   * The API writes web paths into `actionUrl` because one notification serves
   * both surfaces, so the mapping lives on the client. An unrecognised path
   * simply opens the app — better than navigating somewhere wrong.
   */
  const handleNotificationTap = useCallback(
    (response: Notifications.NotificationResponse) => {
      const data = response.notification.request.content.data as
        | { actionUrl?: string }
        | undefined;

      const target = data?.actionUrl ? DEEP_LINK_MAP[data.actionUrl] : undefined;
      if (!target || !navigationRef.current?.isReady()) return;

      const screen = target.screen ?? target.tab;
      if (screen) navigationRef.current.navigate(screen as never);
    },
    [],
  );

  useEffect(() => {
    const subscription =
      Notifications.addNotificationResponseReceivedListener(handleNotificationTap);

    // A notification tapped while the app was killed is delivered here rather
    // than through the listener.
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) handleNotificationTap(response);
    });

    return () => subscription.remove();
  }, [handleNotificationTap]);

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.canvas }]}>
      <NavigationContainer ref={navigationRef} theme={navigationTheme(theme)}>
        <RootNavigator />
      </NavigationContainer>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
