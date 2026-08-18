/**
 * Academic calendar.
 *
 * An agenda, not a month grid. On a phone a month grid gives you twelve tiny
 * dots and no information; an agenda answers the actual question — "what is
 * coming up, and when do the holidays fall".
 *
 * Past events are kept, collapsed below, because "when was the last exam" is
 * asked nearly as often as "when is the next one".
 */

import { useCallback, useMemo } from 'react';
import { SectionList, StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { addMonths, isBefore, startOfMonth, subMonths } from 'date-fns';
import { academicApi } from '@/core/api/endpoints';
import { qk } from '@/core/api/queryClient';
import { formatDate, formatDayLabel, humanise } from '@/core/utils/format';
import { useTheme } from '@/design/ThemeProvider';
import { radii, spacing } from '@/design/tokens';
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  Icon,
  ListSkeleton,
  Screen,
  Text,
  type IconName,
} from '@/design/components';
import type { CalendarEventRow } from '@/core/api/types';

/** Event type → icon and tone. Unknown types stay neutral rather than throwing. */
const EVENT_STYLE: Record<string, { icon: IconName; tone: 'brand' | 'success' | 'warning' | 'info' | 'danger' }> = {
  HOLIDAY: { icon: 'sun', tone: 'success' },
  EXAM: { icon: 'results', tone: 'warning' },
  EVENT: { icon: 'megaphone', tone: 'brand' },
  MEETING: { icon: 'chat', tone: 'info' },
  ACTIVITY: { icon: 'results', tone: 'info' },
  DEADLINE: { icon: 'clock', tone: 'danger' },
};

export function CalendarScreen() {
  const range = useMemo(() => {
    const from = startOfMonth(subMonths(new Date(), 2)).toISOString().slice(0, 10);
    const to = addMonths(new Date(), 6).toISOString().slice(0, 10);
    return { from, to };
  }, []);

  const query = useQuery({
    queryKey: qk.calendar(range.from, range.to),
    queryFn: () => academicApi.calendar(range.from, range.to),
    staleTime: 30 * 60_000,
  });

  const onRefresh = useCallback(() => {
    void query.refetch();
  }, [query]);

  /** Upcoming first (soonest at the top), then past (most recent at the top). */
  const sections = useMemo(() => {
    const events = query.data ?? [];
    const now = new Date();

    const upcoming = events
      .filter((e) => !isBefore(new Date(e.endDate), now))
      .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());

    const past = events
      .filter((e) => isBefore(new Date(e.endDate), now))
      .sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime());

    return [
      ...(upcoming.length > 0 ? [{ title: 'Coming up', data: upcoming }] : []),
      ...(past.length > 0 ? [{ title: 'Earlier this year', data: past.slice(0, 20) }] : []),
    ];
  }, [query.data]);

  if (query.isPending) {
    return (
      <Screen scroll>
        <ListSkeleton rows={6} />
      </Screen>
    );
  }

  if (query.isError) {
    return (
      <Screen scroll>
        <ErrorState error={query.error} onRetry={onRefresh} />
      </Screen>
    );
  }

  return (
    <Screen padded>
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        refreshing={query.isFetching}
        onRefresh={onRefresh}
        showsVerticalScrollIndicator={false}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
        SectionSeparatorComponent={() => <View style={{ height: spacing.md }} />}
        renderSectionHeader={({ section }) => (
          <Text variant="micro" tone="subtle" style={styles.sectionHeader}>
            {section.title.toUpperCase()}
          </Text>
        )}
        renderItem={({ item }) => <CalendarRow event={item} />}
        ListEmptyComponent={
          <EmptyState
            icon="timetable"
            title="Nothing on the calendar"
            message="Holidays, exams and school events will appear here once published."
          />
        }
      />
    </Screen>
  );
}

function CalendarRow({ event }: { event: CalendarEventRow }) {
  const { colors } = useTheme();

  const style = EVENT_STYLE[event.type] ?? { icon: 'timetable' as IconName, tone: 'brand' as const };
  const accent = event.colorHex || undefined;
  const multiDay = event.startDate.slice(0, 10) !== event.endDate.slice(0, 10);

  return (
    <Card elevation="none" accentColor={accent}>
      <View style={styles.row}>
        {/* Date block, so the day is readable without parsing a sentence. */}
        <View style={[styles.dateBlock, { backgroundColor: colors.surfaceSunken }]}>
          <Text variant="micro" tone="subtle">
            {new Date(event.startDate)
              .toLocaleDateString('en-IN', { month: 'short' })
              .toUpperCase()}
          </Text>
          <Text variant="title3" tabular>
            {new Date(event.startDate).getDate()}
          </Text>
        </View>

        <View style={styles.flex}>
          <View style={styles.titleRow}>
            <Icon name={style.icon} size={15} tone={style.tone} />
            <Text variant="bodyStrong" numberOfLines={2} style={styles.flex}>
              {event.title}
            </Text>
          </View>

          <Text variant="caption" tone="muted" style={{ marginTop: 2 }}>
            {multiDay
              ? `${formatDate(event.startDate)} – ${formatDate(event.endDate)}`
              : `${formatDayLabel(event.startDate)}${event.isAllDay ? ' · All day' : ''}`}
          </Text>

          {event.description ? (
            <Text variant="caption" tone="subtle" numberOfLines={2} style={{ marginTop: 2 }}>
              {event.description}
            </Text>
          ) : null}
        </View>

        <Badge label={humanise(event.type)} tone={style.tone} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  list: {
    paddingTop: spacing.lg,
    paddingBottom: spacing['4xl'],
  },
  sectionHeader: {
    marginBottom: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  dateBlock: {
    width: 48,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    alignItems: 'center',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
  },
  flex: {
    flex: 1,
  },
});
