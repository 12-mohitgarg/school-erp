/**
 * Card — the surface almost everything sits on.
 *
 * `interactive` swaps the plain view for a pressable with the same press
 * animation the buttons use, so a tappable card and a static one are told
 * apart by feel as well as by an affordance.
 */

import { useRef } from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewProps,
  type ViewStyle,
} from 'react-native';
import { useTheme } from '@/design/ThemeProvider';
import { motion, radii, spacing } from '@/design/tokens';
import { Text } from './Text';

export interface CardProps extends ViewProps {
  padded?: boolean;
  /** `flat` for lists of cards; `raised` for a single focal card. */
  elevation?: 'none' | 'sm' | 'md';
  onPress?: () => void;
  /** Left edge accent — used to colour-code a subject or an alert severity. */
  accentColor?: string;
  style?: StyleProp<ViewStyle>;
}

export function Card({
  padded = true,
  elevation: level = 'sm',
  onPress,
  accentColor,
  children,
  style,
  ...rest
}: CardProps) {
  const theme = useTheme();
  const scale = useRef(new Animated.Value(1)).current;

  const surfaceStyle: ViewStyle = {
    backgroundColor: theme.colors.surface,
    borderRadius: radii.lg,
    borderCurve: 'continuous',
    padding: padded ? spacing.lg : 0,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.hairline,
    shadowColor: theme.colors.shadow,
    ...theme.elevation[level],
    // Shadows over a dark canvas add nothing and cost a render pass.
    ...(theme.isDark ? { shadowOpacity: 0, elevation: 0 } : null),
    ...(accentColor
      ? { borderLeftWidth: 3, borderLeftColor: accentColor, overflow: 'hidden' }
      : null),
  };

  if (!onPress) {
    return (
      <View {...rest} style={[surfaceStyle, style]}>
        {children}
      </View>
    );
  }

  const animate = (to: number) =>
    Animated.timing(scale, {
      toValue: to,
      duration: motion.fast,
      useNativeDriver: true,
    }).start();

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        accessibilityRole="button"
        onPress={onPress}
        onPressIn={() => animate(0.985)}
        onPressOut={() => animate(1)}
        style={({ pressed }) => [
          surfaceStyle,
          pressed ? { backgroundColor: theme.colors.surfaceSunken } : null,
          style,
        ]}
        {...rest}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}

/**
 * Section heading above a group of cards.
 *
 * Takes an optional action so "Recent results · See all" is one component
 * rather than a hand-rolled row on every screen.
 */
export function SectionHeader({
  title,
  subtitle,
  actionLabel,
  onAction,
}: {
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionHeaderText}>
        <Text variant="title3">{title}</Text>
        {subtitle ? (
          <Text variant="caption" tone="muted" style={{ marginTop: 2 }}>
            {subtitle}
          </Text>
        ) : null}
      </View>

      {actionLabel && onAction ? (
        <Pressable
          accessibilityRole="button"
          onPress={onAction}
          hitSlop={8}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        >
          <Text variant="callout" tone="brand" weight="600">
            {actionLabel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
    gap: spacing.md,
  },
  sectionHeaderText: {
    flex: 1,
  },
});
