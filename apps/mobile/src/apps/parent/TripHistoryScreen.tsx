/**
 * Trip history.
 *
 * PRD §6.1: *30-day travel history accessible to parents and transport admin*,
 * with the window configurable per school. The server caps it at the school's
 * own retention setting, so asking for 90 days simply returns whatever survives
 * the purge job — and the screen says so rather than implying data was lost.
 *
 * Each row is one trip with the boarding and alighting times, because that is
 * the record a parent actually wants: *did they get on, and did they get off.*
 */

import { useCallback, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { DEFAULT_LOCATION_RETENTION_DAYS } from '@erp/shared';
import { trackingApi } from '@/core/api/endpoints';
import { qk } from '@/core/api/queryClient';
import { useAuth } from '@/core/auth/AuthProvider';
import { formatDayLabel, formatTime } from '@/core/utils/format';
import { useTheme } from '@/design/ThemeProvider';
import { radii, spacing } from '@/design/tokens';
import {
  Badge,
  Banner,
  Card,
  EmptyState,
  ErrorState,
  Icon,
  ListSkeleton,
  Screen,
  SegmentedControl,
  Text,
} from '@/design/components';
import type { TripHistoryEntry } from '@/core/api/types';

type Window = '7' | '30' | '90';

export function TripHistoryScreen() {
  const { subjectStudentId, activeChild } = useAuth();
  const [window, setWindow] = useState<Window>('30');

  const days = Number(window);

  const query = useQuery({
    queryKey: qk.tripHistory(subjectStudentId ?? 'none', days),
    queryFn: () => trackingApi.studentHistory(subjectStudentId!, days),
    enabled: Boolean(subjectStudentId) && (activeChild?.canViewLocation ?? false),
  });

  const onRefresh = useCallback(() => {
    void query.refetch();
  }, [query]);

  if (activeChild && !activeChild.canViewLocation) {
    return (
      <Screen scroll>
        <EmptyState
          icon="lock"
          title="Not available for this account"
          message="Travel history is part of location access, which is not shared with this account."
        />
      </Screen>
    );
  }

  if (query.isPending) {
    return (
      <Screen scroll>
        <ListSkeleton rows={5} />
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

  const trips = [...(query.data ?? [])].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );

  return (
    <Screen padded>
      <View style={styles.toolbar}>
        <SegmentedControl<Window>
          segments={[
            { value: '7', label: '7 days' },
            { value: '30', label: '30 days' },
            { value: '90', label: '90 days' },
          ]}
          value={window}
          onChange={setWindow}
        />
      </View>

      <FlatList
        data={trips}
        keyExtractor={(item) => item.tripId}
        refreshing={query.isFetching}
        onRefresh={onRefresh}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
        ListHeaderComponent={
          days > DEFAULT_LOCATION_RETENTION_DAYS ? (
            <View style={{ marginBottom: spacing.lg }}>
              <Banner
                tone="info"
                icon="shield"
                title="Older records are deleted, not hidden"
                message={`Location history is purged automatically after your school's retention window — ${DEFAULT_LOCATION_RETENTION_DAYS} days by default. Anything beyond that no longer exists.`}
              />
            </View>
          ) : undefined
        }
        ListEmptyComponent={
          <EmptyState
            icon="trip"
            title="No trips recorded"
            message={`No bus journeys in the last ${days} days. Journeys appear here once the driver records boarding.`}
          />
        }
        renderItem={({ item }) => <TripCard trip={item} />}
      />
    </Screen>
  );
}

function TripCard({ trip }: { trip: TripHistoryEntry }) {
  const { colors } = useTheme();

  const pickup = trip.direction === 'PICKUP';
  /** Boarded but never marked off: worth flagging rather than showing a dash. */
  const incomplete = Boolean(trip.boardedAt) && !trip.alightedAt;

  return (
    <Card elevation="sm">
      <View style={styles.header}>
        <View style={styles.flex}>
          <Text variant="bodyStrong">{formatDayLabel(trip.date)}</Text>
          <Text variant="caption" tone="muted" numberOfLines={1} style={{ marginTop: 1 }}>
            {trip.routeName} · {trip.vehicleNo}
          </Text>
        </View>

        <Badge
          label={pickup ? 'To school' : 'To home'}
          tone={pickup ? 'brand' : 'info'}
        />
      </View>

      <View style={[styles.legs, { borderTopColor: colors.hairline }]}>
        <Leg
          icon="boarding"
          label="Boarded"
          time={trip.boardedAt}
          tone={trip.boardedAt ? 'success' : 'subtle'}
        />

        <View style={[styles.legConnector, { backgroundColor: colors.hairline }]} />

        <Leg
          icon="alighting"
          label="Got off"
          time={trip.alightedAt}
          tone={trip.alightedAt ? 'success' : incomplete ? 'warning' : 'subtle'}
        />
      </View>

      {incomplete ? (
        <View style={[styles.note, { backgroundColor: colors.warningSoft }]}>
          <Icon name="info" size={13} tone="warning" />
          <Text variant="caption" tone="warning" style={styles.flex}>
            No de-boarding scan was recorded for this trip.
          </Text>
        </View>
      ) : null}
    </Card>
  );
}

function Leg({
  icon,
  label,
  time,
  tone,
}: {
  icon: 'boarding' | 'alighting';
  label: string;
  time: string | null;
  tone: 'success' | 'warning' | 'subtle';
}) {
  return (
    <View style={styles.leg}>
      <Icon name={icon} size={17} tone={tone} />
      <View>
        <Text variant="micro" tone="subtle">
          {label.toUpperCase()}
        </Text>
        <Text variant="bodyStrong" tabular tone={tone === 'subtle' ? 'subtle' : 'default'}>
          {time ? formatTime(time) : 'Not recorded'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  toolbar: {
    paddingTop: spacing.md,
  },
  list: {
    paddingTop: spacing.lg,
    paddingBottom: spacing['4xl'],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  flex: {
    flex: 1,
  },
  legs: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  leg: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  legConnector: {
    flex: 1,
    height: 1,
  },
  note: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm + 2,
    borderRadius: radii.sm,
    marginTop: spacing.md,
  },
});
