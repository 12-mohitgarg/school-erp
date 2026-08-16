/**
 * Request validation middleware.
 *
 * Handlers should never read `req.body` without it having passed through here:
 * validation both rejects malformed input and *strips unknown keys*, which is
 * what stops a client from mass-assigning fields like `tenantId` or `role`.
 */

import type { RequestHandler } from 'express';
import { z, type ZodTypeAny } from 'zod';

export interface ValidationSchemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

export function validate(schemas: ValidationSchemas): RequestHandler {
  return (req, _res, next) => {
    try {
      if (schemas.params) req.params = schemas.params.parse(req.params);
      // Express 4 exposes `query` as a getter on some setups; assign defensively.
      if (schemas.query) {
        const parsedQuery = schemas.query.parse(req.query);
        Object.defineProperty(req, 'query', {
          value: parsedQuery,
          writable: true,
          configurable: true,
        });
      }
      if (schemas.body) req.body = schemas.body.parse(req.body);
      next();
    } catch (err) {
      // ZodError is normalised into a 422 by the central error handler.
      next(err);
    }
  };
}

/**
 * A payload that has already passed `validate()`.
 *
 * Zod has proven the shape and stripped unknown keys, but Prisma's generated
 * input types cannot see that proof, and restating every field at each call
 * site would duplicate the schema and drift from it. Spreading a `Validated`
 * into a Prisma `data` object defers to the Zod schema as the contract.
 *
 * Only ever apply this to `req.body` / `req.query` *after* `validate()` has
 * run — on raw input it would erase the only thing standing between a client
 * and mass-assignment.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Validated = any;

// ---------------------------------------------------------------------------
// Reusable primitives
// ---------------------------------------------------------------------------

export const uuidSchema = z.string().uuid('Must be a valid identifier');

export const idParam = z.object({ id: uuidSchema });

/** ISO date (`YYYY-MM-DD`) coerced to a Date at midnight UTC. */
export const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected format YYYY-MM-DD')
  .transform((s) => new Date(`${s}T00:00:00.000Z`));

/** 24-hour clock time, `HH:mm`. */
export const timeOfDay = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected format HH:mm');

export const emailSchema = z
  .string()
  .email('Enter a valid email address')
  .toLowerCase()
  .trim();

/** E.164, or a bare 10-digit Indian mobile number. */
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^(\+?[1-9]\d{9,14})$/, 'Enter a valid phone number');

/**
 * Password policy: at least 8 characters with upper, lower, digit and symbol.
 * Matches the strength meter shown on the web sign-in screen.
 */
export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password is too long')
  .regex(/[a-z]/, 'Include at least one lowercase letter')
  .regex(/[A-Z]/, 'Include at least one uppercase letter')
  .regex(/\d/, 'Include at least one number')
  .regex(/[^A-Za-z0-9]/, 'Include at least one special character');

export const latitude = z.coerce.number().min(-90).max(90);
export const longitude = z.coerce.number().min(-180).max(180);

export const geoPoint = z.object({ latitude, longitude });

/** Non-negative money value with at most two decimal places. */
export const money = z.coerce
  .number()
  .nonnegative('Amount cannot be negative')
  .max(99_999_999.99, 'Amount is too large')
  .refine((n) => Number.isInteger(Math.round(n * 100)), 'At most 2 decimal places');

export const listQuery = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  search: z.string().trim().max(120).optional(),
  sortBy: z.string().max(60).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
});

/** `?from=&to=` date-range filter shared by every report endpoint. */
export const dateRangeQuery = z.object({
  from: dateOnly.optional(),
  to: dateOnly.optional(),
});
