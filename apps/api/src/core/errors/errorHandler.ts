/** Terminal Express error handler plus the 404 fallback. */

import type { ErrorRequestHandler, RequestHandler } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { JsonWebTokenError, TokenExpiredError } from 'jsonwebtoken';
import { AppError, type ErrorCode } from './AppError.js';
import { logger } from '../logger.js';
import { isProduction } from '../../config/env.js';

interface NormalisedError {
  statusCode: number;
  code: ErrorCode;
  message: string;
  details?: Record<string, string[]>;
  /** True when the error is a genuine crash worth alerting on. */
  unexpected: boolean;
}

/** Flatten a Zod error into `{ fieldPath: [messages] }`. */
function zodToDetails(error: ZodError): Record<string, string[]> {
  const details: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_root';
    (details[key] ??= []).push(issue.message);
  }
  return details;
}

/**
 * Map anything thrown during a request onto a client-safe response shape.
 * Prisma's error codes are translated here so callers never see raw DB text.
 */
function normalise(err: unknown): NormalisedError {
  if (err instanceof AppError) {
    return {
      statusCode: err.statusCode,
      code: err.code,
      message: err.message,
      ...(err.details ? { details: err.details } : {}),
      unexpected: false,
    };
  }

  if (err instanceof ZodError) {
    return {
      statusCode: 422,
      code: 'VALIDATION_ERROR',
      message: 'Validation failed',
      details: zodToDetails(err),
      unexpected: false,
    };
  }

  if (err instanceof TokenExpiredError) {
    return {
      statusCode: 401,
      code: 'TOKEN_EXPIRED',
      message: 'Session expired, please sign in again',
      unexpected: false,
    };
  }

  if (err instanceof JsonWebTokenError) {
    return {
      statusCode: 401,
      code: 'TOKEN_INVALID',
      message: 'Invalid or malformed token',
      unexpected: false,
    };
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    switch (err.code) {
      case 'P2002': {
        // Unique constraint. `target` names the offending column(s).
        const target = err.meta?.['target'];
        const fields = Array.isArray(target) ? target.join(', ') : String(target ?? 'field');
        return {
          statusCode: 409,
          code: 'DUPLICATE_ENTRY',
          message: `A record with this ${fields} already exists`,
          details: { [fields]: ['Must be unique'] },
          unexpected: false,
        };
      }
      case 'P2003':
        return {
          statusCode: 409,
          code: 'CONFLICT',
          message: 'Related record is missing or still in use',
          unexpected: false,
        };
      case 'P2025':
        return {
          statusCode: 404,
          code: 'NOT_FOUND',
          message: 'Record not found',
          unexpected: false,
        };
      case 'P2014':
        return {
          statusCode: 409,
          code: 'CONFLICT',
          message: 'This change would break a required relation',
          unexpected: false,
        };
      default:
        return {
          statusCode: 500,
          code: 'INTERNAL_ERROR',
          message: 'A database error occurred',
          unexpected: true,
        };
    }
  }

  if (err instanceof Prisma.PrismaClientValidationError) {
    return {
      statusCode: 400,
      code: 'BAD_REQUEST',
      message: 'Malformed database query',
      unexpected: true,
    };
  }

  if (err instanceof Prisma.PrismaClientInitializationError) {
    return {
      statusCode: 503,
      code: 'DEPENDENCY_FAILURE',
      message: 'Database is unavailable',
      unexpected: true,
    };
  }

  // Body-parser surfaces malformed JSON as a SyntaxError carrying `body`.
  if (err instanceof SyntaxError && 'body' in err) {
    return {
      statusCode: 400,
      code: 'BAD_REQUEST',
      message: 'Request body is not valid JSON',
      unexpected: false,
    };
  }

  return {
    statusCode: 500,
    code: 'INTERNAL_ERROR',
    message: 'An unexpected error occurred',
    unexpected: true,
  };
}

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(AppError.notFound(`Route ${req.method} ${req.originalUrl}`));
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const normalised = normalise(err);
  const requestId = res.locals['requestId'] as string | undefined;

  const logPayload = {
    requestId,
    method: req.method,
    url: req.originalUrl,
    statusCode: normalised.statusCode,
    code: normalised.code,
    userId: req.auth?.userId,
    tenantId: req.auth?.tenantId,
  };

  if (normalised.unexpected) {
    logger.error({ ...logPayload, err }, 'Unhandled error');
  } else if (normalised.statusCode >= 500) {
    logger.error(logPayload, normalised.message);
  } else {
    logger.warn(logPayload, normalised.message);
  }

  // Never leak internal messages or stacks to clients in production.
  const body = {
    success: false as const,
    error: {
      code: normalised.code,
      message: normalised.message,
      ...(normalised.details ? { details: normalised.details } : {}),
      ...(requestId ? { requestId } : {}),
      ...(!isProduction && normalised.unexpected && err instanceof Error
        ? { stack: err.stack }
        : {}),
    },
  };

  res.status(normalised.statusCode).json(body);
};
