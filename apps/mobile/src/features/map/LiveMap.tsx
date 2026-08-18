/**
 * The live map.
 *
 * One component serves all three apps — the parent watching their child's bus,
 * the driver seeing their own route ahead — because they are the same picture
 * with different emphasis, and two implementations would drift.
 *
 * What it draws, back to front: the planned route, the path actually travelled
 * so far, the stops (reached ones filled, upcoming ones hollow), the child's
 * own stop picked out, and the vehicle itself rotated to its heading.
 *
 * Written against `@maplibre/maplibre-react-native` v11, whose API is
 * `Map` / `GeoJSONSource` / `Layer` with MapLibre Style Spec `paint` objects —
 * not the older `MapView` / `ShapeSource` / `LineLayer` shape.
 */

import { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import {
  Camera,
  GeoJSONSource,
  Layer,
  Map,
  Marker,
  type CameraRef,
  type LngLatBounds,
} from '@maplibre/maplibre-react-native';
import type { GeoPoint, StopEta } from '@erp/shared';
import { useTheme } from '@/design/ThemeProvider';
import { radii, spacing } from '@/design/tokens';
import { Icon, Text } from '@/design/components';
import {
  boundsOf,
  decodePolyline,
  isRealCoordinate,
  toFeatureCollection,
  toLineString,
  toPointFeature,
} from '@/core/utils/geo';
import { osmStyle } from './mapStyle';

export interface LiveMapProps {
  /** Current vehicle position. Null while the bus has never reported. */
  vehicle?: (GeoPoint & { heading?: number; isMoving?: boolean }) | null;
  /** Google-encoded polyline of the planned route. */
  routePolyline?: string | null;
  /** Where the bus has actually been on this trip. */
  travelledPath?: GeoPoint[];
  stops?: StopEta[];
  /** The stop belonging to the child being watched — drawn larger, in brand. */
  highlightStopId?: string | null;
  height?: number;
  /** Keeps the camera centred on the bus rather than fitting the whole route. */
  followVehicle?: boolean;
  style?: StyleProp<ViewStyle>;
  onStopPress?: (stop: StopEta) => void;
}

export function LiveMap({
  vehicle,
  routePolyline,
  travelledPath = [],
  stops = [],
  highlightStopId,
  height = 300,
  followVehicle = true,
  style,
  onStopPress,
}: LiveMapProps) {
  const { colors, isDark } = useTheme();
  const cameraRef = useRef<CameraRef>(null);

  const mapStyle = useMemo(() => osmStyle(isDark), [isDark]);

  const routePoints = useMemo(
    () => (routePolyline ? decodePolyline(routePolyline) : []),
    [routePolyline],
  );

  const validStops = useMemo(() => stops.filter((s) => isRealCoordinate(s.location)), [stops]);

  /**
   * Camera framing.
   *
   * Following the vehicle is right *while it is moving* — that is the whole
   * point of the screen. When it is not, fitting the route gives the parent
   * the context of where it is along the journey, which a tight zoom hides.
   */
  useEffect(() => {
    const camera = cameraRef.current;
    if (!camera) return;

    if (followVehicle && isRealCoordinate(vehicle)) {
      camera.easeTo({
        center: [vehicle.longitude, vehicle.latitude],
        zoom: 15,
        duration: 900,
      });
      return;
    }

    const bounds = boundsOf([
      ...routePoints,
      ...validStops.map((s) => s.location),
      ...(isRealCoordinate(vehicle) ? [vehicle] : []),
    ]);

    if (bounds) {
      camera.fitBounds(bounds as LngLatBounds, {
        padding: { top: 48, right: 40, bottom: 48, left: 40 },
        duration: 900,
      });
    }
  }, [followVehicle, vehicle, routePoints, validStops]);

  const routeShape = useMemo(
    () => (routePoints.length > 1 ? toLineString(routePoints) : null),
    [routePoints],
  );

  const travelledShape = useMemo(
    () => (travelledPath.length > 1 ? toLineString(travelledPath) : null),
    [travelledPath],
  );

  const stopShape = useMemo(
    () =>
      toFeatureCollection(
        validStops.map((stop) =>
          toPointFeature(stop.location, {
            id: stop.stopId,
            name: stop.stopName,
            sequence: stop.sequence,
            reached: stop.reached ? 1 : 0,
            highlighted: stop.stopId === highlightStopId ? 1 : 0,
          }),
        ),
      ),
    [validStops, highlightStopId],
  );

  return (
    <View style={[styles.container, { height, backgroundColor: colors.surfaceSunken }, style]}>
      <Map
        style={StyleSheet.absoluteFill}
        mapStyle={mapStyle}
        logo={false}
        attribution
        attributionPosition={{ bottom: 6, right: 6 }}
        compass={false}
        touchRotate={false}
        touchPitch={false}
      >
        <Camera ref={cameraRef} />

        {/* Planned route: a wide soft casing under a dashed line, which is what
            keeps it legible over both pale roads and dark parkland. */}
        {routeShape ? (
          <GeoJSONSource id="route" data={routeShape}>
            <Layer
              id="route-casing"
              type="line"
              layout={{ 'line-cap': 'round', 'line-join': 'round' }}
              paint={{
                'line-color': colors.brand200,
                'line-width': 9,
                'line-opacity': isDark ? 0.35 : 0.6,
              }}
            />
            <Layer
              id="route-line"
              type="line"
              layout={{ 'line-cap': 'round', 'line-join': 'round' }}
              paint={{
                'line-color': colors.brand500,
                'line-width': 4,
                'line-dasharray': [2.5, 1.5],
              }}
            />
          </GeoJSONSource>
        ) : null}

        {/* Distance actually covered, drawn solid over the dashed plan so
            progress along the route is readable at a glance. */}
        {travelledShape ? (
          <GeoJSONSource id="travelled" data={travelledShape}>
            <Layer
              id="travelled-line"
              type="line"
              layout={{ 'line-cap': 'round', 'line-join': 'round' }}
              paint={{ 'line-color': colors.success, 'line-width': 5 }}
            />
          </GeoJSONSource>
        ) : null}

        <GeoJSONSource
          id="stops"
          data={stopShape}
          onPress={
            onStopPress
              ? (event) => {
                  const id = event.nativeEvent.features[0]?.properties?.['id'] as
                    | string
                    | undefined;
                  const stop = validStops.find((s) => s.stopId === id);
                  if (stop) onStopPress(stop);
                }
              : undefined
          }
        >
          <Layer
            id="stop-circles"
            type="circle"
            paint={{
              'circle-radius': ['case', ['==', ['get', 'highlighted'], 1], 9, 6],
              'circle-color': [
                'case',
                ['==', ['get', 'highlighted'], 1],
                colors.brand600,
                ['==', ['get', 'reached'], 1],
                colors.success,
                colors.surface,
              ],
              'circle-stroke-width': 2.5,
              'circle-stroke-color': [
                'case',
                ['==', ['get', 'reached'], 1],
                colors.success,
                colors.brand500,
              ],
            }}
          />
          <Layer
            id="stop-labels"
            type="symbol"
            layout={{
              'text-field': ['get', 'name'],
              'text-size': 11,
              'text-offset': [0, 1.4],
              'text-anchor': 'top',
              // Without this the labels overlap into an unreadable smear.
              'text-allow-overlap': false,
              'text-optional': true,
            }}
            paint={{
              'text-color': colors.ink,
              'text-halo-color': colors.surface,
              'text-halo-width': 1.6,
            }}
          />
        </GeoJSONSource>

        {/* The bus. A React view rather than a symbol layer so it can carry the
            live "moving / stopped" treatment without uploading a sprite. */}
        {isRealCoordinate(vehicle) ? (
          <Marker lngLat={[vehicle.longitude, vehicle.latitude]} anchor="center">
            <VehicleMarker heading={vehicle.heading ?? 0} moving={vehicle.isMoving ?? false} />
          </Marker>
        ) : null}
      </Map>
    </View>
  );
}

/**
 * Vehicle marker.
 *
 * The heading arrow is a separate element from the puck so it rotates without
 * spinning the bus glyph, which would be unreadable. A stopped bus loses the
 * arrow entirely — a stationary vehicle has no meaningful heading, and showing
 * a stale one implies movement that is not happening.
 */
function VehicleMarker({ heading, moving }: { heading: number; moving: boolean }) {
  const { colors } = useTheme();

  return (
    <View style={styles.markerRoot}>
      {moving ? (
        <View
          style={[
            styles.headingArrow,
            {
              borderBottomColor: colors.brand600,
              transform: [{ rotate: `${heading}deg` }, { translateY: -22 }],
            },
          ]}
        />
      ) : null}

      <View
        style={[
          styles.markerPuck,
          {
            backgroundColor: moving ? colors.brand600 : colors.inkMuted,
            borderColor: colors.surface,
          },
        ]}
      >
        <Icon name="trip" size={17} color="#FFFFFF" />
      </View>
    </View>
  );
}

/**
 * Legend, so the colours are self-explanatory. The web app's Live GPS screen
 * carries a "How this works" panel for the same reason: a map whose symbols
 * need a manual is a map nobody trusts.
 */
export function MapLegend({ compact = false }: { compact?: boolean }) {
  const { colors } = useTheme();

  const items = [
    { color: colors.brand500, label: 'Planned route' },
    { color: colors.success, label: 'Travelled' },
    { color: colors.brand600, label: "Child's stop" },
  ];

  return (
    <View style={[styles.legend, compact ? { paddingVertical: spacing.xs } : null]}>
      {items.map((item) => (
        <View key={item.label} style={styles.legendItem}>
          <View style={[styles.legendSwatch, { backgroundColor: item.color }]} />
          <Text variant="micro" tone="subtle">
            {item.label.toUpperCase()}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: radii.lg,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  markerRoot: {
    width: 54,
    height: 54,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markerPuck: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headingArrow: {
    position: 'absolute',
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderBottomWidth: 10,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.lg,
    paddingVertical: spacing.sm,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
  },
  legendSwatch: {
    width: 12,
    height: 4,
    borderRadius: 2,
  },
});
