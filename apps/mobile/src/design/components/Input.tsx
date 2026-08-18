/**
 * Text field.
 *
 * The error state is the reason this exists: the API returns field-level
 * messages on a 422, and every form in the app renders them the same way,
 * under the field, in danger tone, with the border matching — never as a
 * disconnected banner at the top of the screen.
 */

import { forwardRef, useState, type ComponentRef } from 'react';
import {
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useTheme } from '@/design/ThemeProvider';
import { MIN_TOUCH, radii, spacing } from '@/design/tokens';
import { Text } from './Text';

/**
 * `TextInput`'s instance type is no longer the component type itself in React
 * Native 0.87, so the ref is derived from the component rather than named
 * directly — otherwise `.focus()` does not exist on it.
 */
export type InputRef = ComponentRef<typeof TextInput>;

export interface InputProps extends Omit<TextInputProps, 'style'> {
  label?: string;
  error?: string | null;
  hint?: string;
  leading?: React.ReactNode;
  /** Rendered inside the field on the right — a "show password" toggle, say. */
  trailing?: React.ReactNode;
  containerStyle?: StyleProp<ViewStyle>;
  /** Applied to the `TextInput` itself — used to grow a multiline field. */
  style?: StyleProp<TextStyle>;
}

export const Input = forwardRef<InputRef, InputProps>(function Input(
  { label, error, hint, leading, trailing, containerStyle, style, onFocus, onBlur, ...rest },
  ref,
) {
  const { colors, typography } = useTheme();
  const [focused, setFocused] = useState(false);

  const borderColor = error
    ? colors.danger
    : focused
      ? colors.brand500
      : colors.hairline;

  return (
    <View style={containerStyle}>
      {label ? (
        <Text variant="callout" weight="600" tone="muted" style={styles.label}>
          {label}
        </Text>
      ) : null}

      <View
        style={[
          styles.field,
          {
            backgroundColor: colors.surface,
            borderColor,
            borderWidth: focused || error ? 1.5 : StyleSheet.hairlineWidth * 2,
          },
        ]}
      >
        {leading ? <View style={styles.adornment}>{leading}</View> : null}

        <TextInput
          ref={ref}
          placeholderTextColor={colors.inkSubtle}
          selectionColor={colors.brand500}
          accessibilityLabel={label}
          accessibilityState={{ disabled: rest.editable === false }}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          style={[styles.input, typography.body, { color: colors.ink }, style]}
          {...rest}
        />

        {trailing ? <View style={styles.adornment}>{trailing}</View> : null}
      </View>

      {error ? (
        <Text variant="caption" tone="danger" style={styles.helper}>
          {error}
        </Text>
      ) : hint ? (
        <Text variant="caption" tone="subtle" style={styles.helper}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
});

/** Inline "show / hide" affordance for password fields. */
export function PasswordToggle({
  visible,
  onToggle,
}: {
  visible: boolean;
  onToggle: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={visible ? 'Hide password' : 'Show password'}
      onPress={onToggle}
      hitSlop={10}
    >
      <Text variant="caption" tone="brand" weight="600">
        {visible ? 'Hide' : 'Show'}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  label: {
    marginBottom: spacing.xs + 2,
  },
  field: {
    minHeight: MIN_TOUCH + 4,
    borderRadius: radii.md,
    borderCurve: 'continuous',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  input: {
    flex: 1,
    paddingVertical: spacing.md,
    // Android adds its own padding that misaligns the text against an icon.
    paddingHorizontal: 0,
  },
  adornment: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  helper: {
    marginTop: spacing.xs + 2,
  },
});
