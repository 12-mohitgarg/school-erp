/**
 * List row.
 *
 * The workhorse: an attendance day, a fee invoice, a library loan, a chat
 * thread, a settings toggle. Keeping them one component is what makes the
 * whole app feel consistent as you move between tabs — the same rhythm of
 * leading element, two lines of text, trailing status.
 */

import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Switch, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '@/design/ThemeProvider';
import { MIN_TOUCH, radii, spacing } from '@/design/tokens';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';
import { useToneColors, type Tone } from './Badge';

export interface ListRowProps {
  title: string;
  subtitle?: string | null;
  /** Third line, for the detail that is useful but never the reason you looked. */
  meta?: string | null;
  leading?: ReactNode;
  /** Shorthand for a tinted icon puck on the left. */
  leadingIcon?: IconName;
  leadingTone?: Tone;
  trailing?: ReactNode;
  /** Right-hand value, e.g. an amount. Rendered tabular so columns align. */
  value?: string;
  valueTone?: Tone;
  onPress?: () => void;
  showChevron?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function ListRow({
  title,
  subtitle,
  meta,
  leading,
  leadingIcon,
  leadingTone = 'neutral',
  trailing,
  value,
  valueTone = 'neutral',
  onPress,
  showChevron,
  disabled = false,
  style,
}: ListRowProps) {
  const { colors } = useTheme();
  const leadTone = useToneColors(leadingTone);
  const valTone = useToneColors(valueTone);

  const chevron = showChevron ?? Boolean(onPress);

  const content = (
    <View style={[styles.row, style]}>
      {leading ??
        (leadingIcon ? (
          <View style={[styles.puck, { backgroundColor: leadTone.soft }]}>
            <Icon name={leadingIcon} size={18} color={leadTone.fg} />
          </View>
        ) : null)}

      <View style={styles.body}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" tone="muted" numberOfLines={2} style={styles.subtitle}>
            {subtitle}
          </Text>
        ) : null}
        {meta ? (
          <Text variant="caption" tone="subtle" numberOfLines={1} style={styles.subtitle}>
            {meta}
          </Text>
        ) : null}
      </View>

      <View style={styles.trailing}>
        {value ? (
          <Text
            variant="bodyStrong"
            tabular
            tone={valueTone === 'neutral' ? 'default' : 'inherit'}
            style={valueTone === 'neutral' ? undefined : { color: valTone.fg }}
          >
            {value}
          </Text>
        ) : null}
        {trailing}
        {chevron ? <Icon name="forward" size={16} tone="subtle" /> : null}
      </View>
    </View>
  );

  if (!onPress) return content;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[title, subtitle, value].filter(Boolean).join(', ')}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        pressed ? { backgroundColor: colors.surfaceSunken, borderRadius: radii.md } : null,
        disabled ? { opacity: 0.5 } : null,
      ]}
    >
      {content}
    </Pressable>
  );
}

/** A row whose trailing element is a switch — used throughout settings. */
export function ToggleRow({
  title,
  subtitle,
  value,
  onValueChange,
  leadingIcon,
  disabled = false,
}: {
  title: string;
  subtitle?: string;
  value: boolean;
  onValueChange: (next: boolean) => void;
  leadingIcon?: IconName;
  disabled?: boolean;
}) {
  const { colors } = useTheme();

  return (
    <ListRow
      title={title}
      subtitle={subtitle}
      leadingIcon={leadingIcon}
      showChevron={false}
      trailing={
        <Switch
          value={value}
          onValueChange={onValueChange}
          disabled={disabled}
          trackColor={{ false: colors.hairline, true: colors.brand500 }}
          thumbColor={colors.surface}
          ios_backgroundColor={colors.hairline}
          accessibilityLabel={title}
        />
      }
    />
  );
}

/** Hairline between rows inside one card. */
export function RowDivider({ inset = 0 }: { inset?: number }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        height: StyleSheet.hairlineWidth,
        backgroundColor: colors.hairline,
        marginLeft: inset,
        marginVertical: spacing.md,
      }}
    />
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: MIN_TOUCH,
  },
  puck: {
    width: 38,
    height: 38,
    borderRadius: radii.md,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
  },
  subtitle: {
    marginTop: 2,
  },
  trailing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
});
