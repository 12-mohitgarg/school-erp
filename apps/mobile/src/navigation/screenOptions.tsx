/**
 * Navigation chrome.
 *
 * One place decides how headers and tab bars look, so the three apps share a
 * silhouette even though their contents differ completely. React Navigation's
 * defaults are platform-native but theme-blind — they would render a white
 * header over the dark canvas.
 */

import { Platform, StyleSheet } from 'react-native';
import type {
  BottomTabNavigationOptions,
} from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationOptions } from '@react-navigation/native-stack';
import type { Theme as NavigationTheme } from '@react-navigation/native';
import type { Theme } from '@/design/ThemeProvider';
import { Icon, type IconName } from '@/design/components';

/** Maps our tokens onto React Navigation's own theme object. */
export function navigationTheme(theme: Theme): NavigationTheme {
  return {
    dark: theme.isDark,
    colors: {
      primary: theme.colors.brand600,
      background: theme.colors.canvas,
      card: theme.colors.surface,
      text: theme.colors.ink,
      border: theme.colors.hairline,
      notification: theme.colors.danger,
    },
    fonts: {
      regular: { fontFamily: Platform.select({ ios: 'System', default: 'sans-serif' })!, fontWeight: '400' },
      medium: { fontFamily: Platform.select({ ios: 'System', default: 'sans-serif-medium' })!, fontWeight: '500' },
      bold: { fontFamily: Platform.select({ ios: 'System', default: 'sans-serif' })!, fontWeight: '700' },
      heavy: { fontFamily: Platform.select({ ios: 'System', default: 'sans-serif' })!, fontWeight: '800' },
    },
  };
}

export function stackOptions(theme: Theme): NativeStackNavigationOptions {
  return {
    headerStyle: { backgroundColor: theme.colors.surface },
    headerTitleStyle: {
      color: theme.colors.ink,
      fontSize: 17,
      fontWeight: '600',
    },
    headerTintColor: theme.colors.brand600,
    headerShadowVisible: false,
    // A hairline instead of a shadow: the cards below already carry elevation,
    // and a shadowed header stacked on them reads as two competing surfaces.
    contentStyle: { backgroundColor: theme.colors.canvas },
    headerBackButtonDisplayMode: 'minimal',
    animation: Platform.OS === 'android' ? 'slide_from_right' : 'default',
  };
}

export function tabOptions(theme: Theme): BottomTabNavigationOptions {
  return {
    headerShown: false,
    tabBarActiveTintColor: theme.colors.brand600,
    tabBarInactiveTintColor: theme.colors.inkSubtle,
    tabBarStyle: {
      backgroundColor: theme.colors.surface,
      borderTopColor: theme.colors.hairline,
      borderTopWidth: StyleSheet.hairlineWidth,
      // Let the safe-area inset do the bottom spacing rather than a fixed
      // height, which clips on devices with a home indicator.
      paddingTop: 6,
      height: Platform.OS === 'ios' ? 84 : 62,
    },
    tabBarLabelStyle: {
      fontSize: 11,
      fontWeight: '600',
      marginTop: 2,
    },
    tabBarHideOnKeyboard: true,
  };
}

/** Tab icon factory — keeps every navigator's screen list to one line each. */
export function tabIcon(name: IconName) {
  return function TabIcon({ color, size }: { color: string; size: number }) {
    return <Icon name={name} size={size - 2} color={color} />;
  };
}
