/**
 * Environment configuration.
 *
 * Parsed and validated once at boot. A malformed environment should crash the
 * process immediately rather than surfacing as a confusing runtime error deep
 * inside a request handler.
 */

import 'dotenv/config';
import { z } from 'zod';

const bool = (defaultValue: boolean) =>
  z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((v) => (v === undefined ? defaultValue : v === 'true' || v === '1'));

const int = (defaultValue: number) =>
  z.coerce.number().int().optional().default(defaultValue);

const csv = (defaultValue: string[] = []) =>
  z
    .string()
    .optional()
    .transform((v) =>
      v
        ? v
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : defaultValue,
    );

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: int(4000),
  API_PREFIX: z.string().default('/api/v1'),
  CORS_ORIGINS: csv(['http://localhost:5173']),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  // Secrets must be long enough to be meaningful; refuse to boot otherwise.
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be >= 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be >= 32 characters'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('7d'),
  ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'ENCRYPTION_KEY must be 64 hex characters (32 bytes)'),
  BCRYPT_ROUNDS: int(12),
  MAX_LOGIN_ATTEMPTS: int(5),
  LOCKOUT_MINUTES: int(15),

  WS_PATH: z.string().default('/socket.io'),
  MQTT_ENABLED: bool(false),
  MQTT_URL: z.string().default('mqtt://localhost:1883'),
  MQTT_USERNAME: z.string().optional(),
  MQTT_PASSWORD: z.string().optional(),
  MQTT_TOPIC_PREFIX: z.string().default('erp/tracking'),

  GPS_PING_INTERVAL_SECONDS: int(12),
  LOCATION_RETENTION_DAYS: int(30),
  DEFAULT_SPEED_LIMIT_KMPH: int(40),
  ROUTE_DEVIATION_METERS: int(150),
  DEVICE_OFFLINE_SECONDS: int(90),

  GOOGLE_MAPS_API_KEY: z.string().optional(),

  /*
    Cloud storage — Cloudinary.

    The browser uploads directly to Cloudinary with an *unsigned* preset, so
    no file ever transits the API. The cloud name and preset are therefore
    public by design; the API keeps them so it can hand them to the client and,
    more importantly, so it can reject any stored URL that does not belong to
    this cloud (see core/storage/cloudinary.ts).

    API key/secret are optional and only needed to delete an asset, which is a
    signed, server-only operation.
  */
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_UPLOAD_PRESET: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),
  CLOUDINARY_FOLDER: z.string().default('school-erp'),
  /** Refuse uploads above this size, mirrored in the browser before sending. */
  UPLOAD_MAX_MB: int(10),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: int(587),
  SMTP_SECURE: bool(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  MAIL_FROM_NAME: z.string().default('EduSphere School ERP'),
  MAIL_FROM_ADDRESS: z.string().default('no-reply@edusphere.local'),

  SMS_PROVIDER: z.string().default('msg91'),
  SMS_API_KEY: z.string().optional(),
  SMS_SENDER_ID: z.string().optional(),

  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),

  FCM_SERVER_KEY: z.string().optional(),
  EXPO_ACCESS_TOKEN: z.string().optional(),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  SENTRY_DSN: z.string().optional(),
  METRICS_ENABLED: bool(true),

  RATE_LIMIT_WINDOW_MS: int(15 * 60 * 1000),
  RATE_LIMIT_MAX: int(1000),
  AUTH_RATE_LIMIT_MAX: int(20),

  SEED_ADMIN_EMAIL: z.string().default('admin@edusphere.local'),
  SEED_ADMIN_PASSWORD: z.string().default('Admin@12345'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
    .join('\n');
  // eslint-disable-next-line no-console
  console.error(`\n Invalid environment configuration:\n${issues}\n`);
  process.exit(1);
}

export const env = parsed.data;

export const isProduction = env.NODE_ENV === 'production';
export const isDevelopment = env.NODE_ENV === 'development';
export const isTest = env.NODE_ENV === 'test';

export type Env = typeof env;
