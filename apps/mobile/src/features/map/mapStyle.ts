/**
 * Map style.
 *
 * OpenStreetMap raster tiles, matching the deliberate choice the web app made
 * with Leaflet: no API key, no billing account, nothing to provision before
 * the map renders. Routes are already stored as Google-encoded polylines and
 * the API still carries `GOOGLE_MAPS_API_KEY`, so moving to the Google SDK is
 * a swap of this file and the `LiveMap` component — nothing above them changes.
 *
 * ⚠️ Production: openstreetmap.org's tile servers are a volunteer resource with
 * a usage policy that forbids heavy apps. Before go-live, point `TILE_SOURCES`
 * at your own tile server or a commercial provider. The rest of the app is
 * unaffected — this is the only file that names a tile URL.
 */

import type { StyleSpecification } from '@maplibre/maplibre-react-native';

const OSM_TILES = ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'];

const ATTRIBUTION = '© OpenStreetMap contributors';

/**
 * Light and dark are the same tiles with a different background and a raster
 * `brightness`/`saturation` adjustment. A genuinely dark vector basemap would
 * need a vector tile source, which needs a key — this keeps the night map
 * legible without one, and a bright white map at 6am on a winter route is
 * actively unpleasant to look at.
 */
export function osmStyle(isDark: boolean): StyleSpecification {
  return {
    version: 8,
    name: isDark ? 'EduSphere Night' : 'EduSphere Day',
    sources: {
      osm: {
        type: 'raster',
        tiles: OSM_TILES,
        tileSize: 256,
        minzoom: 0,
        maxzoom: 19,
        attribution: ATTRIBUTION,
      },
    },
    layers: [
      {
        id: 'background',
        type: 'background',
        paint: { 'background-color': isDark ? '#0D111F' : '#EEF1F7' },
      },
      {
        id: 'osm',
        type: 'raster',
        source: 'osm',
        paint: isDark
          ? {
              'raster-brightness-min': 0.02,
              'raster-brightness-max': 0.55,
              'raster-saturation': -0.45,
              'raster-contrast': 0.12,
              'raster-opacity': 0.85,
            }
          : {
              'raster-saturation': -0.18,
              'raster-contrast': -0.04,
              'raster-opacity': 1,
            },
      },
    ],
  };
}

export const MAP_ATTRIBUTION = ATTRIBUTION;
