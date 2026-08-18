/**
 * Live tracking — the Parent App's reason to exist.
 *
 * PRD §6: *every parent can view their child's live location on a map, from
 * the moment they board the school bus until arrival, with ETA to their stop.*
 *
 * Three things this screen is careful about:
 *
 * 1. **It says whether it is actually live.** A map that has silently stopped
 *    updating looks identical to a bus that has stopped moving. The connection
 *    state and the age of the last ping are both on screen, always.
 *
 * 2. **It degrades rather than lies.** The socket is the fast path; a 30-second
 *    REST poll runs underneath it as a fallback (the same belt-and-braces the
 *    web app uses). If the tracker has gone quiet, it says so with the number
 *    of seconds, instead of showing a stale position as current.
 *
 * 3. **It respects the privacy boundary.** A guardian may only join the room
 *    for the vehicle currently carrying their child, and a non-custodial
 *    guardian never sees this screen at all — both enforced server-side, and
 *    explained here rather than failing silently.
 */

import { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, ScrollView, StyleSheet, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { WS_EVENTS, type LiveVehicleState, type StopEta } from '@erp/shared';
import { LIVE_POLL_INTERVAL_MS } from '@/config/env';
import { trackingApi } from '@/core/api/endpoints';
import { qk } from '@/core/api/queryClient';
import { useAuth } from '@/core/auth/AuthProvider';
import {
  useSocket,
  useSocketEvent,
  useVehicleSubscription,
} from '@/core/realtime/SocketProvider';
import {
  formatDistance,
  formatDuration,
  formatSpeed,
  formatTime,
} from '@/core/utils/format';
import { LiveMap, MapLegend } from '@/features/map/LiveMap';
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
  MapSkeleton,
  Screen,
  SectionHeader,
  Text,
} from '@/design/components';
import { isTracked, type StudentLiveTracked } from '@/core/api/types';

/** Beyond this the tracker is treated as offline rather than merely slow. */
const STALE_THRESHOLD_SECONDS = 90;

export function LiveTrackingScreen({ onOpenHistory }: { onOpenHistory: () => void }) {
  const { colors } = useTheme();
  const { activeChild, subjectStudentId } = useAuth();
  const { connection } = useSocket();
  const queryClient = useQueryClient();

  /** Position pushed over the socket, which supersedes the polled snapshot. */
  const [livePosition, setLivePosition] = useState<LiveVehicleState | null>(null);
  const [followBus, setFollowBus] = useState(true);

  const query = useQuery({
    queryKey: qk.live(subjectStudentId ?? 'none'),
    queryFn: () => trackingApi.studentLive(subjectStudentId!),
    enabled: Boolean(subjectStudentId) && (activeChild?.canViewLocation ?? false),
    // The REST fallback. Cheap, and the only thing that keeps the screen
    // truthful if the socket drops without the client noticing.
    refetchInterval: LIVE_POLL_INTERVAL_MS,
    staleTime: 0,
  });

  const snapshot = query.data;
  const tracked: StudentLiveTracked | null = isTracked(snapshot) ? snapshot : null;
  const vehicleId = tracked?.vehicle?.vehicleId ?? null;

  useVehicleSubscription(vehicleId);

  /** A ping for our bus replaces the polled position immediately. */
  useSocketEvent<LiveVehicleState>(
    WS_EVENTS.LOCATION_UPDATE,
    (update) => {
      if (!vehicleId || update.vehicleId !== vehicleId) return;
      setLivePosition(update);
    },
    Boolean(vehicleId),
  );

  /** ETA and trip changes are recomputed server-side; refetch the snapshot. */
  useSocketEvent(
    WS_EVENTS.ETA_UPDATE,
    () => void queryClient.invalidateQueries({ queryKey: qk.live(subjectStudentId ?? 'none') }),
    Boolean(vehicleId),
  );

  useSocketEvent(
    WS_EVENTS.TRIP_UPDATE,
    () => void queryClient.invalidateQueries({ queryKey: qk.live(subjectStudentId ?? 'none') }),
    Boolean(subjectStudentId),
  );

  /** A different child means a different bus; drop the previous one's position. */
  useEffect(() => {
    setLivePosition(null);
  }, [subjectStudentId]);

  const vehicle = livePosition ?? tracked?.vehicle ?? null;

  const onRefresh = useCallback(() => {
    void query.refetch();
  }, [query]);

  // --- Guards --------------------------------------------------------------

  if (!subjectStudentId) {
    return (
      <Screen scroll>
        <EmptyState
          icon="map"
          title="No child selected"
          message="Choose a child from the home screen to see their bus."
        />
      </Screen>
    );
  }

  /**
   * PRD gap analysis: "restricted-access mode for non-custodial guardians".
   * The API would refuse the request anyway; saying why is kinder than an
   * unexplained 403.
   */
  if (activeChild && !activeChild.canViewLocation) {
    return (
      <Screen scroll>
        <EmptyState
          icon="lock"
          title="Location not shared with this account"
          message={
            `Your access to ${activeChild.fullName}'s records does not include live location. ` +
            'The school office can change this if it should.'
          }
        />
      </Screen>
    );
  }

  if (query.isPending) {
    return (
      <Screen scroll>
        <MapSkeleton height={300} />
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

  if (!tracked) {
    return (
      <Screen scroll onRefresh={onRefresh} refreshing={query.isFetching}>
        <EmptyState
          icon="trip"
          title="No bus assigned"
          message={
            (isTracked(snapshot) ? undefined : snapshot?.reason) ??
            'This child is not allocated to a school bus route. Contact the transport office if that is wrong.'
          }
          actionLabel="View trip history"
          onAction={onOpenHistory}
        />
      </Screen>
    );
  }

  // --- Live ----------------------------------------------------------------

  const staleSeconds = vehicle?.staleSeconds ?? Number.POSITIVE_INFINITY;
  const isStale = staleSeconds > STALE_THRESHOLD_SECONDS;
  const onTrip = Boolean(tracked.trip);

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.mapWrap}>
          <LiveMap
            vehicle={
              vehicle
                ? {
                    latitude: vehicle.latitude,
                    longitude: vehicle.longitude,
                    heading: vehicle.heading,
                    isMoving: vehicle.isMoving && !isStale,
                  }
                : null
            }
            routePolyline={tracked.routePolyline}
            travelledPath={tracked.travelledPath}
            stops={tracked.stops}
            highlightStopId={tracked.myStop?.id ?? null}
            followVehicle={followBus}
            height={320}
          />

          {/* Live badge, overlaid. The single most important piece of state on
              the screen, so it sits on the map rather than below it. */}
          <View style={styles.mapOverlay} pointerEvents="box-none">
            <LiveIndicator
              connection={connection}
              staleSeconds={vehicle?.staleSeconds ?? null}
              onTrip={onTrip}
            />

            <Button
              label={followBus ? 'Following bus' : 'Fit route'}
              variant="secondary"
              size="sm"
              leading={<Icon name={followBus ? 'pin' : 'map'} size={14} tone="brand" />}
              onPress={() => setFollowBus((v) => !v)}
            />
          </View>
        </View>

        <View style={styles.body}>
          {isStale && onTrip ? (
            <Banner
              tone="warning"
              icon="offline"
              title="The tracker has gone quiet"
              message={`Last position ${formatDuration(staleSeconds / 60)} ago. The bus may be in an area with no signal — the map will catch up automatically.`}
            />
          ) : null}

          {!onTrip ? (
            <Banner
              tone="info"
              icon="clock"
              title="No trip running right now"
              message="This shows the route and the last known position. Live updates resume when the driver starts the next trip."
            />
          ) : null}

          <MyStopCard tracked={tracked} />

          {vehicle ? <VehicleCard vehicle={vehicle} isStale={isStale} /> : null}

          {tracked.stops.length > 0 ? (
            <View style={styles.section}>
              <SectionHeader
                title="Stops on this route"
                subtitle={`${tracked.stops.filter((s) => s.reached).length} of ${tracked.stops.length} reached`}
              />
              <Card elevation="sm" padded={false} style={styles.stopsCard}>
                {tracked.stops.map((stop, index) => (
                  <StopRow
                    key={stop.stopId}
                    stop={stop}
                    isMine={stop.stopId === tracked.myStop?.id}
                    isLast={index === tracked.stops.length - 1}
                  />
                ))}
              </Card>
            </View>
          ) : null}

          <MapLegend />

          <Button
            label="Trip history"
            variant="secondary"
            fullWidth
            leading={<Icon name="clock" size={16} tone="brand" />}
            onPress={onOpenHistory}
            style={{ marginTop: spacing.md }}
          />

          {/* A guardian's SOS is for an emergency involving their own child,
              and is attached to the trip so the office knows which bus. */}
          <View style={styles.section}>
            <SosButton
              vehicleId={vehicleId}
              tripId={tracked.trip?.tripId ?? null}
              studentId={subjectStudentId}
            />
            <Text variant="caption" tone="subtle" align="center" style={{ marginTop: spacing.sm }}>
              Raises an alert with the school office and shares your location.
              For a life-threatening emergency, call 112 first.
            </Text>
          </View>

          <Card elevation="none" style={[styles.privacy, { backgroundColor: colors.surfaceSunken }]}>
            <Icon name="shield" size={16} tone="brand" />
            <Text variant="caption" tone="muted" style={styles.flex}>
              Only you and authorised school staff can see this. Every view is
              recorded in an audit log, and location history is deleted
              automatically after the school's retention window.
            </Text>
          </Card>
        </View>
      </ScrollView>
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function LiveIndicator({
  connection,
  staleSeconds,
  onTrip,
}: {
  connection: 'connecting' | 'live' | 'offline';
  staleSeconds: number | null;
  onTrip: boolean;
}) {
  const { colors } = useTheme();

  const live = connection === 'live' && onTrip && (staleSeconds ?? 999) <= STALE_THRESHOLD_SECONDS;

  const label = live
    ? 'LIVE'
    : connection === 'connecting'
      ? 'CONNECTING'
      : connection === 'offline'
        ? 'OFFLINE'
        : 'NOT LIVE';

  const background = live
    ? colors.success
    : connection === 'offline'
      ? colors.danger
      : colors.inkMuted;

  return (
    <View style={[styles.liveBadge, { backgroundColor: background }]}>
      <View style={styles.liveDot} />
      <Text variant="micro" tone="inherit" style={{ color: '#FFFFFF' }}>
        {label}
        {staleSeconds !== null && Number.isFinite(staleSeconds) && staleSeconds > 20
          ? ` · ${Math.round(staleSeconds)}s ago`
          : ''}
      </Text>
    </View>
  );
}

/** The one card a parent looks at: when does the bus reach *my* stop. */
function MyStopCard({ tracked }: { tracked: StudentLiveTracked }) {
  const { colors } = useTheme();

  const myStop = tracked.stops.find((s) => s.stopId === tracked.myStop?.id);

  if (!myStop) {
    return (
      <Card elevation="sm">
        <Text variant="micro" tone="subtle">
          PICKUP STOP
        </Text>
        <Text variant="title3" style={{ marginTop: spacing.xs }}>
          {tracked.myStop?.name ?? 'Not assigned'}
        </Text>
        <Text variant="caption" tone="muted" style={{ marginTop: spacing.xs }}>
          No arrival estimate is available for this stop yet.
        </Text>
      </Card>
    );
  }

  const reached = myStop.reached;

  return (
    <Card elevation="md" accentColor={reached ? colors.success : colors.brand500}>
      <View style={styles.stopHeader}>
        <View style={styles.flex}>
          <Text variant="micro" tone="subtle">
            {tracked.trip?.direction === 'DROP' ? 'DROP-OFF STOP' : 'PICKUP STOP'}
          </Text>
          <Text variant="title2" numberOfLines={1} style={{ marginTop: 2 }}>
            {myStop.stopName}
          </Text>
        </View>

        {reached ? (
          <Badge label="Reached" tone="success" variant="solid" />
        ) : (
          <Badge label={`Stop ${myStop.sequence}`} tone="brand" />
        )}
      </View>

      <View style={[styles.etaRow, { borderTopColor: colors.hairline }]}>
        <EtaFigure
          label="Arriving"
          value={
            reached
              ? formatTime(myStop.reachedAt)
              : myStop.etaMinutes !== null
                ? formatDuration(myStop.etaMinutes)
                : '—'
          }
          hint={
            reached
              ? 'Bus has been here'
              : myStop.etaAt
                ? `About ${formatTime(myStop.etaAt)}`
                : 'No estimate yet'
          }
          emphasis
        />

        <EtaFigure
          label="Distance"
          value={formatDistance(myStop.distanceMeters)}
          hint="Straight line to the bus"
        />
      </View>
    </Card>
  );
}

function EtaFigure({
  label,
  value,
  hint,
  emphasis = false,
}: {
  label: string;
  value: string;
  hint?: string;
  emphasis?: boolean;
}) {
  return (
    <View style={styles.flex}>
      <Text variant="micro" tone="subtle">
        {label.toUpperCase()}
      </Text>
      <Text
        variant={emphasis ? 'title1' : 'title3'}
        tabular
        tone={emphasis ? 'brand' : 'default'}
        numberOfLines={1}
        style={{ marginTop: 2 }}
      >
        {value}
      </Text>
      {hint ? (
        <Text variant="caption" tone="subtle" numberOfLines={1}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

function VehicleCard({ vehicle, isStale }: { vehicle: LiveVehicleState; isStale: boolean }) {
  return (
    <Card elevation="sm" style={styles.section}>
      <View style={styles.vehicleHeader}>
        <View style={styles.flex}>
          <Text variant="micro" tone="subtle">
            VEHICLE
          </Text>
          <Text variant="title3" style={{ marginTop: 2 }}>
            {vehicle.registrationNo}
          </Text>
          {vehicle.routeName ? (
            <Text variant="caption" tone="muted">
              {vehicle.routeName}
            </Text>
          ) : null}
        </View>

        <Badge
          label={isStale ? 'No signal' : vehicle.isMoving ? 'Moving' : 'Stopped'}
          tone={isStale ? 'danger' : vehicle.isMoving ? 'success' : 'neutral'}
        />
      </View>

      <View style={styles.vehicleStats}>
        <VehicleStat icon="speed" label="Speed" value={isStale ? '—' : formatSpeed(vehicle.speed)} />
        <VehicleStat icon="manifest" label="On board" value={String(vehicle.occupancy)} />
        <VehicleStat icon="clock" label="Last ping" value={formatTime(vehicle.timestamp)} />
      </View>

      {vehicle.driverName ? (
        <Button
          label={
            vehicle.driverPhone
              ? `Call ${vehicle.driverName}`
              : `Driver: ${vehicle.driverName}`
          }
          variant="secondary"
          size="sm"
          fullWidth
          leading={<Icon name="call" size={15} tone="brand" />}
          disabled={!vehicle.driverPhone}
          onPress={() => callDriver(vehicle.driverPhone)}
          style={{ marginTop: spacing.lg }}
        />
      ) : null}
    </Card>
  );
}

function VehicleStat({
  icon,
  label,
  value,
}: {
  icon: 'speed' | 'manifest' | 'clock';
  label: string;
  value: string;
}) {
  return (
    <View style={styles.vehicleStat}>
      <Icon name={icon} size={15} tone="subtle" />
      <View>
        <Text variant="micro" tone="subtle">
          {label.toUpperCase()}
        </Text>
        <Text variant="callout" weight="600" tabular>
          {value}
        </Text>
      </View>
    </View>
  );
}

function StopRow({
  stop,
  isMine,
  isLast,
}: {
  stop: StopEta;
  isMine: boolean;
  isLast: boolean;
}) {
  const { colors } = useTheme();

  return (
    <View style={styles.stopRow}>
      {/* Timeline rail. The connector is drawn per row rather than as one
          absolute line so it stretches correctly with variable row heights. */}
      <View style={styles.rail}>
        <View
          style={[
            styles.railDot,
            {
              backgroundColor: stop.reached
                ? colors.success
                : isMine
                  ? colors.brand600
                  : colors.surface,
              borderColor: stop.reached ? colors.success : colors.brand400,
              width: isMine ? 14 : 10,
              height: isMine ? 14 : 10,
            },
          ]}
        />
        {!isLast ? (
          <View
            style={[
              styles.railLine,
              { backgroundColor: stop.reached ? colors.success : colors.hairline },
            ]}
          />
        ) : null}
      </View>

      <View style={[styles.stopBody, isLast ? null : { paddingBottom: spacing.lg }]}>
        <View style={styles.stopTitleRow}>
          <Text
            variant={isMine ? 'bodyStrong' : 'body'}
            tone={stop.reached ? 'muted' : 'default'}
            numberOfLines={1}
            style={styles.flex}
          >
            {stop.stopName}
          </Text>

          {isMine ? <Badge label="Your stop" tone="brand" /> : null}
        </View>

        <Text variant="caption" tone="subtle" style={{ marginTop: 1 }}>
          {stop.reached
            ? `Reached ${formatTime(stop.reachedAt)}`
            : stop.etaMinutes !== null
              ? `About ${formatDuration(stop.etaMinutes)} · ${formatTime(stop.etaAt)}`
              : `Stop ${stop.sequence}`}
        </Text>
      </View>
    </View>
  );
}

function callDriver(phone: string | null): void {
  if (!phone) return;

  Alert.alert(
    'Call the driver?',
    'Please avoid calling while the bus is moving unless it is urgent.',
    [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Call', onPress: () => void Linking.openURL(`tel:${phone}`) },
    ],
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingBottom: spacing['4xl'],
  },
  mapWrap: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  mapOverlay: {
    position: 'absolute',
    top: spacing.lg + spacing.md,
    left: spacing.lg + spacing.md,
    right: spacing.lg + spacing.md,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radii.pill,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#FFFFFF',
  },
  body: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    gap: spacing.md,
  },
  section: {
    marginTop: spacing.md,
  },
  flex: {
    flex: 1,
  },
  stopHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  etaRow: {
    flexDirection: 'row',
    gap: spacing.lg,
    marginTop: spacing.lg,
    paddingTop: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  vehicleHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  vehicleStats: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  vehicleStat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  stopsCard: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  stopRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  rail: {
    width: 16,
    alignItems: 'center',
  },
  railDot: {
    borderRadius: 8,
    borderWidth: 2,
    marginTop: 4,
  },
  railLine: {
    flex: 1,
    width: 2,
    marginVertical: 2,
  },
  stopBody: {
    flex: 1,
  },
  stopTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  privacy: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
});
