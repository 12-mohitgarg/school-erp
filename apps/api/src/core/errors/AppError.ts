/**
 * Application error taxonomy.
 *
 * Every error thrown deliberately by application code is an `AppError`, which
 * carries an HTTP status and a stable machine-readable `code`. Anything else
 * that reaches the error handler is treated as an unexpected 500 and its
 * message is never echoed to the client.
 */

export type ErrorCode =
  | 'BAD_REQUEST'
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'INVALID_CREDENTIALS'
  | 'TOKEN_EXPIRED'
  | 'TOKEN_INVALID'
  | 'ACCOUNT_LOCKED'
  | 'ACCOUNT_INACTIVE'
  | 'FORBIDDEN'
  | 'INSUFFICIENT_PERMISSIONS'
  | 'OUT_OF_SCOPE'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'DUPLICATE_ENTRY'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'RATE_LIMITED'
  | 'DEPENDENCY_FAILURE'
  | 'NOT_IMPLEMENTED'
  | 'INTERNAL_ERROR';

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;
  readonly details?: Record<string, string[]>;
  /** Distinguishes deliberate errors from genuine crashes in the handler. */
  readonly isOperational = true;

  constructor(
    statusCode: number,
    code: ErrorCode,
    message: string,
    details?: Record<string, string[]>,
  ) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    if (details) this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }

  // -- Constructors for the common cases -------------------------------------

  static badRequest(message = 'Bad request', details?: Record<string, string[]>) {
    return new AppError(400, 'BAD_REQUEST', message, details);
  }

  static validation(details: Record<string, string[]>, message = 'Validation failed') {
    return new AppError(422, 'VALIDATION_ERROR', message, details);
  }

  static unauthenticated(message = 'Authentication required') {
    return new AppError(401, 'UNAUTHENTICATED', message);
  }

  static invalidCredentials(message = 'Invalid email or password') {
    return new AppError(401, 'INVALID_CREDENTIALS', message);
  }

  static tokenExpired(message = 'Session expired, please sign in again') {
    return new AppError(401, 'TOKEN_EXPIRED', message);
  }

  static tokenInvalid(message = 'Invalid or malformed token') {
    return new AppError(401, 'TOKEN_INVALID', message);
  }

  static accountLocked(minutes: number) {
    return new AppError(
      423,
      'ACCOUNT_LOCKED',
      `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
    );
  }

  static accountInactive(message = 'This account is not active. Contact your administrator.') {
    return new AppError(403, 'ACCOUNT_INACTIVE', message);
  }

  static forbidden(message = 'You do not have access to this resource') {
    return new AppError(403, 'FORBIDDEN', message);
  }

  static insufficientPermissions(required: string | string[]) {
    const list = Array.isArray(required) ? required.join(', ') : required;
    return new AppError(
      403,
      'INSUFFICIENT_PERMISSIONS',
      `Missing required permission: ${list}`,
    );
  }

  /** The record exists but lies outside the caller's tenant/branch/assignment. */
  static outOfScope(message = 'This record is outside your access scope') {
    return new AppError(403, 'OUT_OF_SCOPE', message);
  }

  static notFound(resource = 'Resource') {
    return new AppError(404, 'NOT_FOUND', `${resource} not found`);
  }

  static conflict(message = 'Request conflicts with the current state') {
    return new AppError(409, 'CONFLICT', message);
  }

  static duplicate(field: string) {
    return new AppError(409, 'DUPLICATE_ENTRY', `${field} already exists`);
  }

  static payloadTooLarge(maxBytes: number) {
    const mb = Math.round(maxBytes / (1024 * 1024));
    return new AppError(413, 'PAYLOAD_TOO_LARGE', `File exceeds the ${mb}MB limit`);
  }

  static unsupportedMediaType(allowed: string[]) {
    return new AppError(
      415,
      'UNSUPPORTED_MEDIA_TYPE',
      `Unsupported file type. Allowed: ${allowed.join(', ')}`,
    );
  }

  static rateLimited(message = 'Too many requests, please slow down') {
    return new AppError(429, 'RATE_LIMITED', message);
  }

  /** An upstream provider (SMS, payment gateway, maps) failed. */
  static dependencyFailure(service: string, message?: string) {
    return new AppError(
      502,
      'DEPENDENCY_FAILURE',
      message ?? `${service} is currently unavailable`,
    );
  }

  static notImplemented(feature = 'This feature') {
    return new AppError(501, 'NOT_IMPLEMENTED', `${feature} is not available yet`);
  }

  static internal(message = 'An unexpected error occurred') {
    return new AppError(500, 'INTERNAL_ERROR', message);
  }
}
