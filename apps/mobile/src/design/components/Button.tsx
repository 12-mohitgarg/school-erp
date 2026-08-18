/**
 * Button.
 *
 * Five variants, and the distinction that matters is `danger` vs the rest:
 * ending a trip and raising an SOS are not undoable, so they never look like
 * an ordinary action.
 *
 * Press feedback is a scale + opacity animation rather than the platform
 * default, because the default `TouchableOpacity` fade alone is too subtle to
 * confirm a tap on a phone mounted on a dashboard in daylight.
 */

import { useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  StyleSheet,
  View,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '@/design/ThemeProvider';
import { MIN_TOUCH, motion, radii, spacing } from '@/design/tokens';
import { Text } from './Text';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends Omit<PressableProps, 'style' | 'children'> {
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  fullWidth?: boolean;
  /** Rendered before the label — pass an icon element. */
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  /** Fires a haptic on press. Default on for primary/danger, off elsewhere. */
  haptic?: boolean;
  style?: StyleProp<ViewStyle>;
}

const SIZES: Record<ButtonSize, { height: number; paddingH: number; gap: number }> = {
  sm: { height: 36, paddingH: spacing.md, gap: spacing.xs },
  md: { height: MIN_TOUCH, paddingH: spacing.lg, gap: spacing.sm },
  lg: { height: 54, paddingH: spacing.xl, gap: spacing.sm },
};

export function Button({
  label,
  variant = 'primary',
  size = 'md',
  loading = false,
  fullWidth = false,
  leading,
  trailing,
  haptic,
  disabled,
  onPress,
  style,
  ...rest
}: ButtonProps) {
  const { colors, isDark } = useTheme();
  const scale = useRef(new Animated.Value(1)).current;

  const isDisabled = Boolean(disabled) || loading;
  const shouldHaptic = haptic ?? (variant === 'primary' || variant === 'danger');

  const palette: Record<ButtonVariant, { bg: string; fg: string; border: string }> = {
    primary: { bg: colors.brand600, fg: colors.onBrand, border: 'transparent' },
    secondary: {
      bg: isDark ? colors.surfaceRaised : colors.surface,
      fg: colors.ink,
      border: colors.hairline,
    },
    ghost: { bg: 'transparent', fg: colors.brand600, border: 'transparent' },
    danger: { bg: colors.danger, fg: '#FFFFFF', border: 'transparent' },
    success: { bg: colors.success, fg: '#FFFFFF', border: 'transparent' },
  };

  const { bg, fg, border } = palette[variant];
  const dims = SIZES[size];

  const animate = (to: number) =>
    Animated.timing(scale, {
      toValue: to,
      duration: motion.fast,
      useNativeDriver: true,
    }).start();

  return (
    <Animated.View
      style={[
        { transform: [{ scale }] },
        fullWidth ? styles.fullWidth : null,
        style,
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: isDisabled, busy: loading }}
        accessibilityLabel={label}
        disabled={isDisabled}
        onPressIn={() => animate(0.97)}
        onPressOut={() => animate(1)}
        onPress={(event) => {
          if (shouldHaptic) {
            void Haptics.impactAsync(
              variant === 'danger'
                ? Haptics.ImpactFeedbackStyle.Heavy
                : Haptics.ImpactFeedbackStyle.Light,
            );
          }
          onPress?.(event);
        }}
        style={[
          styles.base,
          {
            height: dims.height,
            paddingHorizontal: dims.paddingH,
            backgroundColor: bg,
            borderColor: border,
            borderWidth: variant === 'secondary' ? StyleSheet.hairlineWidth * 2 : 0,
            opacity: isDisabled ? 0.5 : 1,
          },
        ]}
        {...rest}
      >
        {loading ? (
          <ActivityIndicator size="small" color={fg} />
        ) : (
          <View style={[styles.content, { gap: dims.gap }]}>
            {leading}
            <Text
              variant={size === 'lg' ? 'title3' : 'bodyStrong'}
              tone="inherit"
              style={{ color: fg }}
              numberOfLines={1}
            >
              {label}
            </Text>
            {trailing}
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullWidth: {
    alignSelf: 'stretch',
  },
});
