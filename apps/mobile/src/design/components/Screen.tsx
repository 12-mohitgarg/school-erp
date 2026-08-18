/**
 * Screen scaffold.
 *
 * Owns the three things every screen would otherwise get subtly wrong: safe
 * areas, the status-bar style for the current theme, and pull-to-refresh
 * wiring that matches the app's colours instead of the OS default grey.
 */

import type { ReactNode } from 'react';
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  type ScrollViewProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/design/ThemeProvider';
import { spacing } from '@/design/tokens';

export interface ScreenProps {
  children: ReactNode;
  /** Wraps children in a ScrollView. Off for screens that own a FlatList/map. */
  scroll?: boolean;
  onRefresh?: () => void;
  refreshing?: boolean;
  /** Horizontal gutter. Off for full-bleed content such as the live map. */
  padded?: boolean;
  /** Extra bottom room so a fixed CTA does not cover the last row. */
  bottomInset?: number;
  backgroundColor?: string;
  contentContainerStyle?: StyleProp<ViewStyle>;
  style?: StyleProp<ViewStyle>;
  scrollProps?: Omit<ScrollViewProps, 'children' | 'refreshControl'>;
}

export function Screen({
  children,
  scroll = false,
  onRefresh,
  refreshing = false,
  padded = true,
  bottomInset = 0,
  backgroundColor,
  contentContainerStyle,
  style,
  scrollProps,
}: ScreenProps) {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();

  const background = backgroundColor ?? colors.canvas;

  const body = (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      {children}
    </>
  );

  if (!scroll) {
    return (
      <View
        style={[
          styles.fill,
          { backgroundColor: background },
          padded ? { paddingHorizontal: spacing.lg } : null,
          style,
        ]}
      >
        {body}
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.fill, { backgroundColor: background }, style]}
      contentContainerStyle={[
        padded ? { paddingHorizontal: spacing.lg } : null,
        {
          paddingTop: spacing.md,
          // The tab bar already reserves its own height; this is for a screen's
          // own fixed footer plus the home indicator.
          paddingBottom: spacing['3xl'] + bottomInset + insets.bottom,
        },
        contentContainerStyle,
      ]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.brand500}
            colors={[colors.brand500]}
            progressBackgroundColor={colors.surface}
          />
        ) : undefined
      }
      {...scrollProps}
    >
      {body}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
