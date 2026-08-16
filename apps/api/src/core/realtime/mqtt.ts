/**
 * MQTT ingestion for hardware GPS trackers.
 *
 * The driver mobile app pushes over WebSocket, but dedicated trackers bolted
 * into buses speak MQTT (PRD 8.1). Both paths converge on the same
 * `ingestLocationPing` service, so the geofence/SOS logic exists once.
 *
 * Topics:
 *   {prefix}/{imei}/location   -> position report
 *   {prefix}/{imei}/sos        -> panic button
 *   {prefix}/{imei}/status     -> heartbeat, battery, ignition
 */

import mqtt, { type MqttClient } from 'mqtt';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { moduleLogger } from '../logger.js';
import { gpsPingsReceived } from '../observability/metrics.js';

const log = moduleLogger('mqtt');

let client: MqttClient | null = null;

/**
 * Device payloads come from third-party firmware, so every field is validated
 * before it reaches the domain layer. Coercion is deliberate — many trackers
 * send numbers as strings.
 */
const locationPayloadSchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  speed: z.coerce.number().min(0).max(300).default(0),
  heading: z.coerce.number().min(0).max(360).default(0),
  accuracy: z.coerce.number().min(0).optional(),
  altitude: z.coerce.number().optional(),
  ignition: z.coerce.boolean().optional(),
  battery: z.coerce.number().min(0).max(100).optional(),
  ts: z.coerce.number().optional(),
});

const sosPayloadSchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  message: z.string().max(500).optional(),
});

export async function connectMqtt(): Promise<void> {
  return new Promise((resolve, reject) => {
    client = mqtt.connect(env.MQTT_URL, {
      username: env.MQTT_USERNAME || undefined,
      password: env.MQTT_PASSWORD || undefined,
      clientId: `erp-api-${process.pid}-${Date.now()}`,
      clean: true,
      reconnectPeriod: 5000,
      connectTimeout: 30_000,
    });

    const onError = (err: Error): void => {
      log.error({ err }, 'MQTT connection error');
      reject(err);
    };

    client.once('error', onError);

    client.on('connect', () => {
      client?.off('error', onError);
      log.info({ url: env.MQTT_URL }, 'MQTT connected');

      const topics = [
        `${env.MQTT_TOPIC_PREFIX}/+/location`,
        `${env.MQTT_TOPIC_PREFIX}/+/sos`,
        `${env.MQTT_TOPIC_PREFIX}/+/status`,
      ];

      // QoS 1: a duplicated ping is harmless, a dropped one is not.
      client?.subscribe(topics, { qos: 1 }, (err) => {
        if (err) {
          log.error({ err }, 'MQTT subscription failed');
          reject(err);
          return;
        }
        log.info({ topics }, 'MQTT subscriptions active');
        resolve();
      });
    });

    client.on('message', (topic, payload) => {
      void handleMessage(topic, payload);
    });

    client.on('reconnect', () => log.warn('MQTT reconnecting'));
    client.on('offline', () => log.warn('MQTT offline'));
  });
}

async function handleMessage(topic: string, payload: Buffer): Promise<void> {
  try {
    const parts = topic.split('/');
    const kind = parts.pop();
    const imei = parts.pop();

    if (!imei || !kind) return;

    const raw: unknown = JSON.parse(payload.toString('utf8'));

    // Imported lazily to avoid a cycle: the tracking service emits over the
    // socket layer, which this module is a sibling of.
    const tracking = await import('../../modules/tracking/tracking.service.js');

    switch (kind) {
      case 'location': {
        const data = locationPayloadSchema.parse(raw);
        gpsPingsReceived.inc({ transport: 'mqtt' });
        await tracking.ingestDeviceLocation(imei, {
          latitude: data.lat,
          longitude: data.lng,
          speedKmph: data.speed,
          heading: data.heading,
          accuracyMeters: data.accuracy ?? null,
          altitude: data.altitude ?? null,
          ignitionOn: data.ignition ?? null,
          batteryLevel: data.battery ?? null,
          recordedAt: data.ts ? new Date(data.ts) : new Date(),
        });
        break;
      }

      case 'sos': {
        const data = sosPayloadSchema.parse(raw);
        await tracking.ingestDeviceSos(imei, {
          latitude: data.lat,
          longitude: data.lng,
          message: data.message ?? null,
        });
        break;
      }

      case 'status': {
        await tracking.updateDeviceStatus(imei, raw as Record<string, unknown>);
        break;
      }

      default:
        log.debug({ topic }, 'Ignoring unknown MQTT topic');
    }
  } catch (err) {
    // A malformed device payload must not take down the subscriber.
    log.warn({ err, topic }, 'Failed to process MQTT message');
  }
}

/** Publish a command back to a device (e.g. request an immediate position). */
export function publishToDevice(imei: string, command: string, payload: unknown): void {
  if (!client?.connected) {
    log.warn({ imei, command }, 'MQTT not connected — command dropped');
    return;
  }
  client.publish(
    `${env.MQTT_TOPIC_PREFIX}/${imei}/${command}`,
    JSON.stringify(payload),
    { qos: 1 },
  );
}

export async function disconnectMqtt(): Promise<void> {
  if (!client) return;
  await new Promise<void>((resolve) => client?.end(false, {}, () => resolve()));
  client = null;
  log.info('MQTT disconnected');
}

export function isMqttConnected(): boolean {
  return client?.connected ?? false;
}
