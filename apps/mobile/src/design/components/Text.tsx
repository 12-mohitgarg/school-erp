/**
 * Typography primitive.
 *
 * Every string in the app renders through this so that colour and scale come
 * from tokens rather than from whatever looked right in the moment. `RN.Text`
 * is not used directly anywhere else.
 */

import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from 'react-native';
import { useTheme } from '@/design/ThemeProvider';
import type { TypographyVariant } from '@/design/tokens';

export type TextTone =
  | 'default'
  | 'muted'
  | 'subtle'
  | 'brand'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'onBrand'
  | 'inherit';

export interface TextProps extends RNTextProps {
  variant?: TypographyVariant;
  tone?: TextTone;
  align?: TextStyle['textAlign'];
  /** Tabular figures, so numbers in a column do not jitter as they change. */
  tabular?: boolean;
  weight?: TextStyle['fontWeight'];
}

export function Text({
  variant = 'body',
  tone = 'default',
  align,
  tabular,
  weight,
  style,
  ...rest
}: TextProps) {
  const { colors, typography } = useTheme();

  const toneColor: Record<TextTone, string | undefined> = {
    default: colors.ink,
    muted: colors.inkMuted,
    subtle: colors.inkSubtle,
    brand: colors.brand600,
    success: colors.success,
    warning: colors.warning,
    danger: colors.danger,
    info: colors.info,
    onBrand: colors.onBrand,
    inherit: undefined,
  };

  return (
    <RNText
      // Respect the OS text-size setting, but stop at 1.4× — beyond that the
      // fixed-height rows in the timetable and manifest start clipping, and a
      // clipped row is less accessible than a slightly smaller one.
      maxFontSizeMultiplier={1.4}
      {...rest}
      style={[
        typography[variant] as TextStyle,
        { color: toneColor[tone] },
        tabular && { fontVariant: ['tabular-nums'] },
        align ? { textAlign: align } : null,
        weight ? { fontWeight: weight } : null,
        style,
      ]}
    />
  );
}
