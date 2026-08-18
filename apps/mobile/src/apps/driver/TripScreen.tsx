/**
 * Driver — trip control.
 *
 * The whole app in one screen: start a trip, see the route ahead, know whether
 * the bus is actually reporting, and raise an SOS. A driver uses this in a
 * cradle while working, so every control is large, the state is legible at a
 * glance, and nothing important is more than one tap deep.
 *
 * The design rule throughout: **never imply the bus is being tracked when it
 * is not.** A grey "not reporting" banner is a driver who checks their phone;
 * a green one that is lying is a parent watching a map that has frozen.
 */

import { useCallback, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { WS_EVENTS, type SafetyAlertPayload } from '@erp/shared';
import { ApiError } from '@/core/api/client';
import { transportApi } from '@/core/api/endpoints';
import { qk } from '@/core/api/queryClient';
import { useNetwork } from '@/core/offline/NetworkProvider';
import { useSocket, useSocketEvent } from '@/core/realtime/SocketProvider';
import { formatClock, formatDuration, formatRelative, formatTime } from '@/core/utils/format';
import { LiveMap } from '@/features/map/LiveMap';
import { SosButton } from '@/features/sos/SosButton';
import { useTheme } from '@/design/ThemeProvider';
import { radii, spacing } from '@/design/tokens';
import {
  Badge,
  Banner,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Icon,
  ListSkeleton,
  Screen,
  SectionHeader,
  Sheet,
  Text,
} from '@/design/components';
import { useLocationBroadcast } from './useLocationBroadcast';
import type { MyTrip, RouteStopRow } from '@/core/api/types';

export function TripScreen({ onOpenManifest }: { onOpenManifest: () => void }) {
  const queryClient = useQueryClient();
  const { connection } = useSocket();
  const { isOnline, pending, flushing, syncNow } = useNetwork();

  const [startSheetOpen, setStartSheetOpen] = useState(false);

  const tripQuery = useQuery({
    queryKey: qk.myTrip(),
    queryFn: () => transportApi.myTrip(),
    // The trip is the app's central state; keep it fresh without a manual pull.
    refetchInterval: 60_000,
  });

  const trip = tripQuery.data ?? null;
  const running = trip?.status === 'IN_PROGRESS';

  /**
   * Route-deviation and over-speed warnings (PRD §2.8).
   *
   * These arrive over the socket only — `raiseSafetyAlert` emits
   * `safety:alert` but does not write a notification row, so there is nothing
   * in the inbox to poll for and the driver would otherwise never see them.
   *
   * The server broadcasts to the whole tenant as well as to the vehicle room,
   * so this filters to *this* bus. Without that filter a driver would be
   * warned about every other bus in the school and would learn to ignore it.
   */
  const [liveAlert, setLiveAlert] = useState<SafetyAlertPayload | null>(null);

  useSocketEvent<SafetyAlertPayload>(
    WS_EVENTS.SAFETY_ALERT,
    (alert) => {
      if (!trip || alert.vehicleId !== trip.vehicle.id) return;
      setLiveAlert(alert);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    },
    running,
  );

  const broadcast = useLocationBroadcast(running);

  const endTrip = useMutation({
    mutationFn: (tripId: string) => transportApi.endTrip(tripId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.myTrip() });
      void queryClient.invalidateQueries({ queryKey: qk.dashboard() });
    },
    onError: (err) => {
      Alert.alert(
        'Could not end the trip',
        err instanceof ApiError ? err.message : 'Try again in a moment.',
      );
    },
  });

  const onRefresh = useCallback(() => {
    void tripQuery.refetch();
  }, [tripQuery]);

  const confirmEnd = () => {
    if (!trip) return;

    Alert.alert(
      'End this trip?',
      pending > 0
        ? `${pending} update${pending === 1 ? '' : 's'} are still waiting to send. ` +
          'They will be delivered once you have signal — ending the trip is safe.'
        : 'Location sharing stops immediately and parents will no longer see the bus.',
      [
        { text: 'Keep going', style: 'cancel' },
        { text: 'End trip', style: 'destructive', onPress: () => endTrip.mutate(trip.id) },
      ],
    );
  };

  if (tripQuery.isPending) {
    return (
      <Screen scroll>
        <ListSkeleton rows={4} />
      </Screen>
    );
  }

  if (tripQuery.isError) {
    return (
      <Screen scroll>
        <ErrorState error={tripQuery.error} onRetry={onRefresh} />
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* Reporting status. The most important thing on the screen when a trip
            is running, so it is the first thing, in full width, colour-coded. */}
        {/* A live warning outranks the reporting status: it is the only thing
            on this screen that asks the driver to change what they are doing. */}
        {liveAlert ? (
          <View style={styles.body}>
            <Banner
              tone={liveAlert.severity === 'CRITICAL' ? 'danger' : 'warning'}
              icon={liveAlert.type === 'OVERSPEED' ? 'speed' : 'alert'}
              title={alertTitle(liveAlert)}
              message={liveAlert.message}
              action={
                <Button
                  label="Dismiss"
                  variant="secondary"
                  size="sm"
                  onPress={() => setLiveAlert(null)}
                />
              }
            />
          </View>
        ) : null}

        {running ? (
          <ReportingBanner
            broadcasting={broadcast.broadcasting}
            permission={broadcast.permission}
            lastSentAt={broadcast.lastSentAt}
            isOnline={isOnline}
            pending={pending}
            flushing={flushing}
            socketLive={connection === 'live'}
            onRequestPermission={() => void requestAndExplain(broadcast.requestPermissions)}
            onSyncNow={() => void syncNow()}
          />
        ) : null}

        {trip ? (
          <ActiveTrip
            trip={trip}
            running={running}
            ending={endTrip.isPending}
            onEnd={confirmEnd}
            onOpenManifest={onOpenManifest}
          />
        ) : (
          <View style={styles.body}>
            <EmptyState
              icon="trip"
              title="No trip running"
              message="Start your assigned route to begin sharing the bus position with parents and the school office."
              actionLabel="Start a trip"
              onAction={() => setStartSheetOpen(true)}
            />
          </View>
        )}

        {running && trip ? (
          <View style={styles.body}>
            <SectionHeader
              title="Route"
              subtitle={`${trip.route.stops.length} stops · ${trip.direction === 'PICKUP' ? 'Pickup' : 'Drop'}`}
            />

            <LiveMap
              routePolyline={trip.route.polyline}
              stops={trip.route.stops.map(toStopEta)}
              followVehicle={false}
              height={220}
            />

            <Card elevation="sm" style={styles.stopsCard}>
              {trip.route.stops.map((stop, index) => (
                <StopLine
                  key={stop.id}
                  stop={stop}
                  direction={trip.direction}
                  isLast={index === trip.route.stops.length - 1}
                />
              ))}
            </Card>

            <View style={styles.section}>
              <SosButton vehicleId={trip.vehicle.id} tripId={trip.id} />
              <Text variant="caption" tone="subtle" align="center" style={{ marginTop: spacing.sm }}>
                Alerts the school office and every parent with a child on board,
                with your live position. For a life-threatening emergency, call 112 first.
              </Text>
            </View>
          </View>
        ) : null}
      </ScrollView>

      <StartTripSheet
        visible={startSheetOpen}
        onClose={() => setStartSheetOpen(false)}
        onStarted={() => {
          setStartSheetOpen(false);
          void queryClient.invalidateQueries({ queryKey: qk.myTrip() });
        }}
        ensurePermission={broadcast.requestPermissions}
      />
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Reporting status
// ---------------------------------------------------------------------------

function ReportingBanner({
  broadcasting,
  permission,
  lastSentAt,
  isOnline,
  pending,
  flushing,
  socketLive,
  onRequestPermission,
  onSyncNow,
}: {
  broadcasting: boolean;
  permission: 'unknown' | 'granted' | 'foregroundOnly' | 'denied';
  lastSentAt: string | null;
  isOnline: boolean;
  pending: number;
  flushing: boolean;
  socketLive: boolean;
  onRequestPermission: () => void;
  onSyncNow: () => void;
}) {
  const { colors } = useTheme();

  if (permission === 'denied') {
    return (
      <View style={styles.body}>
        <Banner
          tone="danger"
          icon="alert"
          title="Location permission is off"
          message="Parents cannot see this bus. The trip is running but nothing is being reported."
          action={<Button label="Allow" size="sm" onPress={onRequestPermission} />}
        />
      </View>
    );
  }

  const healthy = broadcasting && isOnline;

  return (
    <View style={styles.body}>
      <View
        style={[
          styles.statusStrip,
          {
            backgroundColor: healthy ? colors.successSoft : colors.warningSoft,
            borderColor: healthy ? colors.success : colors.warning,
          },
        ]}
      >
        <View style={styles.statusHeader}>
          <View
            style={[
              styles.statusDot,
              { backgroundColor: healthy ? colors.success : colors.warning },
            ]}
          />
          <Text
            variant="bodyStrong"
            tone="inherit"
            style={{ color: healthy ? colors.success : colors.warning }}
          >
            {healthy
              ? 'Sharing position'
              : !isOnline
                ? 'Offline — saving positions'
                : 'Starting…'}
          </Text>

          <View style={styles.flex} />

          <Badge
            label={socketLive ? 'Connected' : 'Reconnecting'}
            tone={socketLive ? 'success' : 'neutral'}
          />
        </View>

        <Text variant="caption" tone="muted" style={{ marginTop: spacing.xs }}>
          {lastSentAt
            ? `Last position sent ${formatRelative(lastSentAt)}.`
            : 'Waiting for the first GPS fix…'}
          {' Every 12 seconds while the trip is running.'}
        </Text>

        {/* Foreground-only is the trap: it works perfectly while the driver is
            looking at the screen and stops the moment the phone locks. */}
        {permission === 'foregroundOnly' ? (
          <View style={styles.statusAction}>
            <Text variant="caption" tone="warning" style={styles.flex}>
              Background location is off, so tracking stops when the screen
              locks. Allow "Always" to keep the bus visible.
            </Text>
            <Button label="Fix" variant="secondary" size="sm" onPress={onRequestPermission} />
          </View>
        ) : null}

        {pending > 0 ? (
          <View style={styles.statusAction}>
            <Icon name="refresh" size={14} tone="warning" />
            <Text variant="caption" tone="muted" style={styles.flex}>
              {`${pending} update${pending === 1 ? '' : 's'} saved on this phone, waiting for signal.`}
            </Text>
            <Button
              label={flushing ? 'Sending…' : 'Sync now'}
              variant="secondary"
              size="sm"
              loading={flushing}
              disabled={!isOnline}
              onPress={onSyncNow}
            />
          </View>
        ) : null}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Trip card
// ---------------------------------------------------------------------------

function ActiveTrip({
  trip,
  running,
  ending,
  onEnd,
  onOpenManifest,
}: {
  trip: MyTrip;
  running: boolean;
  ending: boolean;
  onEnd: () => void;
  onOpenManifest: () => void;
}) {
  const { colors } = useTheme();

  const onBoard = trip.studentsBoarded - trip.studentsAlighted;
  const elapsed = trip.startedAt
    ? (Date.now() - new Date(trip.startedAt).getTime()) / 60_000
    : null;

  return (
    <View style={styles.body}>
      <Card elevation="md" accentColor={running ? colors.success : colors.inkMuted}>
        <View style={styles.tripHeader}>
          <View style={styles.flex}>
            <Text variant="micro" tone="subtle">
              {trip.direction === 'PICKUP' ? 'PICKUP RUN' : 'DROP RUN'}
            </Text>
            <Text variant="title2" numberOfLines={1} style={{ marginTop: 2 }}>
              {trip.route.name}
            </Text>
            <Text variant="caption" tone="muted">
              {trip.vehicle.registrationNo} · {trip.vehicle.capacity} seats
            </Text>
          </View>

          <Badge
            label={running ? 'In progress' : trip.status}
            tone={running ? 'success' : 'neutral'}
            variant="solid"
          />
        </View>

        <View style={[styles.tripStats, { borderTopColor: colors.hairline }]}>
          <TripStat label="On board" value={String(Math.max(0, onBoard))} tone="brand" />
          <TripStat label="Boarded" value={String(trip.studentsBoarded)} />
          <TripStat label="Dropped" value={String(trip.studentsAlighted)} />
          <TripStat
            label="Running"
            value={elapsed !== null ? formatDuration(elapsed) : '—'}
          />
        </View>

        <Text variant="caption" tone="subtle" style={{ marginTop: spacing.md }}>
          {trip.startedAt ? `Started at ${formatTime(trip.startedAt)}` : 'Not started'}
        </Text>

        <Button
          label="Boarding list"
          size="lg"
          fullWidth
          leading={<Icon name="manifest" size={17} tone="onBrand" />}
          onPress={onOpenManifest}
          style={{ marginTop: spacing.lg }}
        />

        {running ? (
          <Button
            label="End trip"
            variant="secondary"
            fullWidth
            loading={ending}
            onPress={onEnd}
            style={{ marginTop: spacing.sm }}
          />
        ) : null}
      </Card>
    </View>
  );
}

function TripStat({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  tone?: 'neutral' | 'brand';
}) {
  return (
    <View style={styles.tripStat}>
      <Text variant="micro" tone="subtle" numberOfLines={1}>
        {label.toUpperCase()}
      </Text>
      <Text variant="title3" tabular tone={tone === 'brand' ? 'brand' : 'default'}>
        {value}
      </Text>
    </View>
  );
}

function StopLine({
  stop,
  direction,
  isLast,
}: {
  stop: RouteStopRow;
  direction: 'PICKUP' | 'DROP';
  isLast: boolean;
}) {
  const { colors } = useTheme();
  const scheduled = direction === 'PICKUP' ? stop.pickupTime : stop.dropTime;

  return (
    <View style={styles.stopLine}>
      <View style={styles.stopRail}>
        <View style={[styles.stopDot, { borderColor: colors.brand400 }]} />
        {!isLast ? <View style={[styles.stopRailLine, { backgroundColor: colors.hairline }]} /> : null}
      </View>

      <View style={[styles.flex, isLast ? null : { paddingBottom: spacing.md }]}>
        <Text variant="body" numberOfLines={1}>
          {stop.sequence}. {stop.name}
        </Text>
        <Text variant="caption" tone="subtle">
          {scheduled ? `Scheduled ${formatClock(scheduled)}` : 'No scheduled time'}
          {stop.haltSeconds ? ` · ${Math.round(stop.haltSeconds / 60)} min halt` : ''}
        </Text>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Start trip
// ---------------------------------------------------------------------------

function StartTripSheet({
  visible,
  onClose,
  onStarted,
  ensurePermission,
}: {
  visible: boolean;
  onClose: () => void;
  onStarted: () => void;
  ensurePermission: () => Promise<'unknown' | 'granted' | 'foregroundOnly' | 'denied'>;
}) {
  const [direction, setDirection] = useState<'PICKUP' | 'DROP'>(() =>
    new Date().getHours() < 12 ? 'PICKUP' : 'DROP',
  );

  const routes = useQuery({
    queryKey: qk.routes(),
    queryFn: () => transportApi.routes(),
    enabled: visible,
  });

  const start = useMutation({
    mutationFn: (routeId: string) => transportApi.startTrip({ routeId, direction }),
    onSuccess: onStarted,
    onError: (err) => {
      Alert.alert(
        'Could not start the trip',
        err instanceof ApiError ? err.message : 'Check your connection and try again.',
      );
    },
  });

  /**
   * A route with no vehicle assigned cannot carry a trip — the server rejects
   * it with a 400. Filtering here means the driver is not offered a choice
   * that is guaranteed to fail.
   */
  const startable = useMemo(
    () => (routes.data ?? []).filter((route) => route.vehicleId !== null),
    [routes.data],
  );

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Start a trip"
      subtitle="Choose the run you are about to drive"
    >
      <View style={styles.directionRow}>
        <Button
          label="Pickup (to school)"
          variant={direction === 'PICKUP' ? 'primary' : 'secondary'}
          onPress={() => setDirection('PICKUP')}
          style={styles.flex}
        />
        <Button
          label="Drop (to home)"
          variant={direction === 'DROP' ? 'primary' : 'secondary'}
          onPress={() => setDirection('DROP')}
          style={styles.flex}
        />
      </View>

      <Banner
        tone="info"
        icon="shield"
        title="Location sharing starts now"
        message="The bus position is shared with the school and with the parents of children on board, and stops the moment you end the trip."
      />

      {routes.isPending ? (
        <ListSkeleton rows={3} />
      ) : routes.isError ? (
        <ErrorState error={routes.error} onRetry={() => void routes.refetch()} compact />
      ) : startable.length === 0 ? (
        <EmptyState
          icon="trip"
          title="No routes available"
          message="No route with a vehicle is assigned to you. Contact the transport office."
          compact
        />
      ) : (
        startable.map((route) => (
          <Card
            key={route.id}
            elevation="none"
            onPress={async () => {
              const permission = await ensurePermission();
              if (permission === 'denied') {
                Alert.alert(
                  'Location is required',
                  'A trip cannot start without location permission — parents would see nothing.',
                );
                return;
              }
              start.mutate(route.id);
            }}
          >
            <View style={styles.routeRow}>
              <Icon name="trip" size={20} tone="brand" />
              <Text variant="bodyStrong" numberOfLines={1} style={styles.flex}>
                {route.name}
              </Text>
              {start.isPending && start.variables === route.id ? (
                <Text variant="caption" tone="brand">
                  Starting…
                </Text>
              ) : (
                <Icon name="forward" size={16} tone="subtle" />
              )}
            </View>
          </Card>
        ))
      )}
    </Sheet>
  );
}

async function requestAndExplain(
  request: () => Promise<'unknown' | 'granted' | 'foregroundOnly' | 'denied'>,
): Promise<void> {
  const result = await request();

  if (result === 'denied') {
    Alert.alert(
      'Location is off',
      'Open Settings → EduSphere Driver → Location and choose "Always" so the bus stays visible when the screen locks.',
    );
  }
}

/**
 * A heading a driver can act on at a glance. The server's `message` carries the
 * detail (the speed, the distance off route) and is shown underneath.
 */
function alertTitle(alert: SafetyAlertPayload): string {
  switch (alert.type) {
    case 'OVERSPEED':
      return 'Slow down';
    case 'ROUTE_DEVIATION':
      return 'Off the planned route';
    case 'HARSH_BRAKING':
      return 'Harsh braking detected';
    case 'GEOFENCE_ENTRY':
      return 'Entered a marked area';
    case 'GEOFENCE_EXIT':
      return 'Left a marked area';
    default:
      return 'Safety alert';
  }
}

/** Route stops carry no ETA of their own; the map only needs their positions. */
function toStopEta(stop: RouteStopRow) {
  return {
    stopId: stop.id,
    stopName: stop.name,
    sequence: stop.sequence,
    location: { latitude: stop.latitude, longitude: stop.longitude },
    etaAt: null,
    etaMinutes: null,
    distanceMeters: null,
    reached: false,
    reachedAt: null,
  };
}

const styles = StyleSheet.create({
  scroll: {
    paddingTop: spacing.md,
    paddingBottom: spacing['4xl'],
    gap: spacing.md,
  },
  body: {
    paddingHorizontal: spacing.lg,
  },
  section: {
    marginTop: spacing.xl,
  },
  flex: {
    flex: 1,
  },
  statusStrip: {
    padding: spacing.md,
    borderRadius: radii.md,
    borderCurve: 'continuous',
    borderLeftWidth: 3,
  },
  statusHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  tripHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  tripStats: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginTop: spacing.lg,
    paddingTop: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  tripStat: {
    flex: 1,
  },
  stopsCard: {
    marginTop: spacing.md,
  },
  stopLine: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  stopRail: {
    width: 12,
    alignItems: 'center',
  },
  stopDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
    marginTop: 5,
  },
  stopRailLine: {
    flex: 1,
    width: 2,
    marginVertical: 2,
  },
  directionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  routeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
});
