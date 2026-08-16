import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { env } from '../../config/env.js';
import { validate } from '../../core/http/validate.js';
import { authenticate } from '../../core/auth/middleware.js';
import * as controller from './auth.controller.js';
import * as schemas from './auth.schemas.js';

const router = Router();

/**
 * Credential endpoints get a much tighter budget than the global limiter,
 * keyed by IP — a distributed guessing attack should exhaust this long before
 * it exhausts an account lockout.
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: env.AUTH_RATE_LIMIT_MAX,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => req.ip ?? 'unknown',
  message: {
    success: false,
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many attempts. Please try again in a few minutes.',
    },
  },
});

// --- Public ----------------------------------------------------------------

router.post('/login', authLimiter, validate({ body: schemas.loginSchema }), controller.login);
router.post('/refresh', validate({ body: schemas.refreshSchema }), controller.refresh);
router.post('/logout', controller.logout);

router.post(
  '/forgot-password',
  authLimiter,
  validate({ body: schemas.forgotPasswordSchema }),
  controller.forgotPassword,
);

router.post(
  '/reset-password',
  authLimiter,
  validate({ body: schemas.resetPasswordSchema }),
  controller.resetPassword,
);

/** Static role/permission catalogue — drives the RBAC editor and login copy. */
router.get('/roles', controller.roleCatalogue);

// --- Authenticated ---------------------------------------------------------

router.use(authenticate);

router.get('/me', controller.me);

router.post(
  '/change-password',
  validate({ body: schemas.changePasswordSchema }),
  controller.changePassword,
);

router.get('/sessions', controller.listSessions);
router.post(
  '/sessions/revoke',
  validate({ body: schemas.revokeSessionSchema }),
  controller.revokeSession,
);

router.post(
  '/push-tokens',
  validate({ body: schemas.registerPushTokenSchema }),
  controller.registerPushToken,
);
router.delete('/push-tokens', controller.removePushToken);

router.post('/consent', validate({ body: schemas.consentSchema }), controller.recordConsent);

export default router;
