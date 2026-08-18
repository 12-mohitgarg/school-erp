/**
 * Stat tile and the grid it lives in.
 *
 * Renders the `stats[]` array the role-aware `/dashboard` endpoint returns, so
 * the server decides *what* a role sees and the client only decides how it
 * looks. Adding a KPI to the parent dashboard is a server change alone.
 */

import { StyleSheet, View } from 'react-native';
import { radii, spacing } from '@/design/tokens';
import { formatStat } from '@/core/utils/format';
import type { DashboardStat } from '@/core/api/types';
import { Card } from './Card';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';
import { useToneColors, type Tone } from './Badge';

export interface StatTileProps {
  label: string;
  value: string;
  hint?: string;
  tone?: Tone;
  icon?: IconName;
  onPress?: () => void;
  /** Full-width tile for the one number that matters most on a screen. */
  wide?: boolean;
}

export function StatTile({
  label,
  value,
  hint,
  tone = 'neutral',
  icon,
  onPress,
  wide = false,
}: StatTileProps) {
  const { soft, fg } = useToneColors(tone);

  return (
    <Card
      elevation="sm"
      onPress={onPress}
      style={[styles.tile, wide ? styles.tileWide : null]}
      accessibilityLabel={`${label}: ${value}${hint ? `. ${hint}` : ''}`}
    >
      <View style={styles.tileHeader}>
        <Text variant="micro" tone="subtle" numberOfLines={1} style={styles.tileLabel}>
          {label.toUpperCase()}
        </Text>
        {icon ? (
          <View style={[styles.iconChip, { backgroundColor: soft }]}>
            <Icon name={icon} size={14} color={fg} />
          </View>
        ) : null}
      </View>

      <Text
        variant="numeric"
        tabular
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.7}
        tone={tone === 'neutral' ? 'default' : 'inherit'}
        style={tone === 'neutral' ? undefined : { color: fg }}
      >
        {value}
      </Text>

      {hint ? (
        <Text variant="caption" tone="muted" numberOfLines={2} style={styles.tileHint}>
          {hint}
        </Text>
      ) : null}
    </Card>
  );
}

/**
 * Maps a dashboard stat's `key` onto an icon and a tone.
 *
 * Keyed on the server's own stat keys (`dashboard.routes.ts`), and everything
 * unrecognised renders neutral rather than throwing — a new KPI shipped by the
 * API should appear immediately, just without a bespoke colour.
 */
const STAT_STYLES: Record<string, { icon: IconName; tone: Tone }> = {
  attendance: { icon: 'attendance', tone: 'brand' },
  dues: { icon: 'fees', tone: 'warning' },
  homework: { icon: 'homework', tone: 'info' },
  unread: { icon: 'bell', tone: 'neutral' },
  activeTrip: { icon: 'trip', tone: 'brand' },
  onBoard: { icon: 'manifest', tone: 'success' },
  stops: { icon: 'pin', tone: 'neutral' },
  completed: { icon: 'success', tone: 'success' },
};

export function StatGrid({
  stats,
  onSelect,
}: {
  stats: DashboardStat[];
  onSelect?: (stat: DashboardStat) => void;
}) {
  return (
    <View style={styles.grid}>
      {stats.map((stat) => {
        const style = STAT_STYLES[stat.key];
        return (
          <StatTile
            key={stat.key}
            label={stat.label}
            value={formatStat(stat.value, stat.format)}
            hint={stat.hint}
            icon={style?.icon}
            tone={style?.tone ?? 'neutral'}
            onPress={onSelect ? () => onSelect(stat) : undefined}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  tile: {
    flexGrow: 1,
    flexBasis: '46%',
    minWidth: 150,
    paddingVertical: spacing.lg,
  },
  tileWide: {
    flexBasis: '100%',
  },
  tileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  tileLabel: {
    flex: 1,
  },
  iconChip: {
    width: 26,
    height: 26,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileHint: {
    marginTop: spacing.xs,
  },
});
