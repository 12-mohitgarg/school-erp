/**
 * Test environment.
 *
 * `config/env.ts` validates the environment at import time and calls
 * `process.exit(1)` if it is malformed — deliberately, so a misconfigured
 * deployment dies at boot rather than deep inside a request. That means the
 * suite must present a complete, valid environment *before* any module under
 * test is imported, which is why this runs as a `setupFiles` entry.
 *
 * These values are throwaway. Nothing here connects to a real service: the
 * tests in this suite cover pure logic, so the database URL is never dialled.
 */

process.env['NODE_ENV'] = 'test';
process.env['DATABASE_URL'] = 'postgresql://test:test@localhost:5432/test?schema=public';

// Long enough to satisfy the length checks the config enforces.
process.env['JWT_ACCESS_SECRET'] = 'test_access_secret_that_is_at_least_32_chars';
process.env['JWT_REFRESH_SECRET'] = 'test_refresh_secret_that_is_at_least_32_chars';
process.env['ENCRYPTION_KEY'] = '0'.repeat(64);

// A configured cloud, so the storage tests exercise the strict path rather
// than the "not configured yet" fallback.
process.env['CLOUDINARY_CLOUD_NAME'] = 'test-cloud';
process.env['CLOUDINARY_UPLOAD_PRESET'] = 'test-preset';

process.env['LOG_LEVEL'] = 'fatal';
process.env['METRICS_ENABLED'] = 'false';
