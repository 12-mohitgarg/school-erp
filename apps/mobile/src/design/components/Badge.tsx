/**
 * Status badges.
 *
 * `statusTone` is the important part: it maps the API's domain enums —
 * attendance status, invoice status, loan status, alert severity, trip status —
 * onto one semantic vocabulary, so PAID and PRESENT and RESOLVED are all the
 * same green everywhere in the app without each screen deciding for itself.
 */

import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '@/design/ThemeProvider';
import { radii, spacing } from '@/design/tokens';
import { humanise } from '@/core/utils/format';
import { Text } from './Text';

export type Tone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info';

export interface BadgeProps {
  label: string;
  tone?: Tone;
  /** `solid` for one focal badge; `soft` for badges inside a list. */
  variant?: 'soft' | 'solid' | 'outline';
  size?: 'sm' | 'md';
  /** Leading dot — reads faster than colour alone, and survives colourblindness. */
  dot?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function useToneColors(tone: Tone) {
  const { colors, isDark } = useTheme();

  const map: Record<Tone, { fg: string; soft: string; solid: string }> = {
    neutral: {
      fg: colors.inkMuted,
      soft: colors.surfaceSunken,
      solid: colors.inkMuted,
    },
    brand: { fg: colors.brand600, soft: colors.brand50, solid: colors.brand600 },
    success: { fg: colors.success, soft: colors.successSoft, solid: colors.success },
    warning: { fg: colors.warning, soft: colors.warningSoft, solid: colors.warning },
    danger: { fg: colors.danger, soft: colors.dangerSoft, solid: colors.danger },
    info: { fg: colors.info, soft: colors.infoSoft, solid: colors.info },
  };

  return { ...map[tone], onSolid: isDark ? colors.onBrand : '#FFFFFF' };
}

export function Badge({
  label,
  tone = 'neutral',
  variant = 'soft',
  size = 'sm',
  dot = false,
  style,
}: BadgeProps) {
  const { fg, soft, solid, onSolid } = useToneColors(tone);

  const background =
    variant === 'solid' ? solid : variant === 'soft' ? soft : 'transparent';
  const foreground = variant === 'solid' ? onSolid : fg;

  return (
    <View
      accessibilityRole="text"
      style={[
        styles.badge,
        {
          backgroundColor: background,
          borderColor: variant === 'outline' ? fg : 'transparent',
          borderWidth: variant === 'outline' ? StyleSheet.hairlineWidth * 2 : 0,
          paddingVertical: size === 'sm' ? 3 : 5,
          paddingHorizontal: size === 'sm' ? spacing.sm : spacing.md,
        },
        style,
      ]}
    >
      {dot ? <View style={[styles.dot, { backgroundColor: foreground }]} /> : null}
      <Text variant="micro" tone="inherit" style={{ color: foreground }} numberOfLines={1}>
        {label.toUpperCase()}
      </Text>
    </View>
  );
}

/**
 * The one place a domain enum becomes a colour.
 *
 * Unknown values fall through to neutral rather than throwing — the server can
 * add a status before the app ships an update, and an unstyled badge is a much
 * better outcome than a crash.
 */
export function statusTone(status: string | null | undefined): Tone {
  switch (status) {
    // Good
    case 'PRESENT':
    case 'PAID':
    case 'SUCCESS':
    case 'RETURNED':
    case 'APPROVED':
    case 'RESOLVED':
    case 'COMPLETED':
    case 'GRADED':
    case 'ACTIVE':
    case 'BOARDED':
    case 'ALIGHTED':
    case 'VERIFIED':
      return 'success';

    // Needs attention but not wrong
    case 'LATE':
    case 'HALF_DAY':
    case 'PARTIALLY_PAID':
    case 'PENDING':
    case 'ISSUED':
    case 'SUBMITTED':
    case 'SCHEDULED':
    case 'ACKNOWLEDGED':
    case 'WARNING':
    case 'EVALUATION':
      return 'warning';

    // Wrong
    case 'ABSENT':
    case 'OVERDUE':
    case 'FAILED':
    case 'REJECTED':
    case 'LOST':
    case 'CANCELLED':
    case 'CRITICAL':
    case 'SUSPENDED':
      return 'danger';

    // In flight
    case 'IN_PROGRESS':
    case 'ONGOING':
    case 'PROCESSING':
    case 'PUBLISHED':
      return 'brand';

    case 'EXCUSED':
    case 'HOLIDAY':
    case 'INFO':
    case 'RESERVED':
      return 'info';

    default:
      return 'neutral';
  }
}

/** `<StatusBadge status="PARTIALLY_PAID" />` → soft amber "PARTIALLY PAID". */
export function StatusBadge({
  status,
  variant = 'soft',
  size = 'sm',
}: {
  status: string | null | undefined;
  variant?: BadgeProps['variant'];
  size?: BadgeProps['size'];
}) {
  if (!status) return null;
  return (
    <Badge label={humanise(status)} tone={statusTone(status)} variant={variant} size={size} dot />
  );
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: radii.pill,
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 5,
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
});
