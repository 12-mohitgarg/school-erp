/**
 * Password hashing and the credential-vault cipher.
 *
 * bcrypt is used for passwords (PRD 9.2 names it explicitly) and AES-256-GCM
 * for integration credentials at rest.
 */

import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { env } from '../../config/env.js';

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, env.BCRYPT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

/**
 * Constant-time comparison of two secrets of arbitrary length.
 * Hashing first keeps `timingSafeEqual` from throwing on length mismatch,
 * which would itself leak length information.
 */
export function safeCompare(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// ---------------------------------------------------------------------------
// Random tokens
// ---------------------------------------------------------------------------

/** URL-safe random token for invites and password resets. */
export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

/** Numeric OTP for guardian phone verification. */
export function randomOtp(digits = 6): string {
  const max = 10 ** digits;
  return String(crypto.randomInt(0, max)).padStart(digits, '0');
}

/** Store only the hash of a token/OTP, never the value itself. */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// ---------------------------------------------------------------------------
// AES-256-GCM credential vault
// ---------------------------------------------------------------------------

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function vaultKey(): Buffer {
  return Buffer.from(env.ENCRYPTION_KEY, 'hex');
}

/**
 * Encrypt a secret for storage. Output is `iv:authTag:ciphertext`, all hex —
 * self-describing so rotation can detect the format later.
 */
export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, vaultKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptSecret(payload: string): string {
  const parts = payload.split(':');
  if (parts.length !== 3) {
    throw new Error('Malformed encrypted payload');
  }
  const [ivHex, tagHex, dataHex] = parts as [string, string, string];

  const authTag = Buffer.from(tagHex, 'hex');
  if (authTag.length !== AUTH_TAG_LENGTH) {
    throw new Error('Malformed authentication tag');
  }

  const decipher = crypto.createDecipheriv(ALGORITHM, vaultKey(), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(authTag);
  // `final()` throws if the ciphertext was tampered with — that is the point.
  return Buffer.concat([
    decipher.update(Buffer.from(dataHex, 'hex')),
    decipher.final(),
  ]).toString('utf8');
}

// ---------------------------------------------------------------------------
// Strength feedback
// ---------------------------------------------------------------------------

export interface PasswordStrength {
  score: 0 | 1 | 2 | 3 | 4;
  label: 'Very weak' | 'Weak' | 'Fair' | 'Strong' | 'Very strong';
  suggestions: string[];
}

/** Mirrors the meter shown on the sign-in screen so both agree. */
export function scorePassword(password: string): PasswordStrength {
  const suggestions: string[] = [];
  let score = 0;

  if (password.length >= 8) score++;
  else suggestions.push('Use at least 8 characters');

  if (password.length >= 12) score++;
  else if (password.length >= 8) suggestions.push('12+ characters is stronger');

  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  else suggestions.push('Mix uppercase and lowercase letters');

  if (/\d/.test(password)) score++;
  else suggestions.push('Add a number');

  if (/[^A-Za-z0-9]/.test(password)) score++;
  else suggestions.push('Add a symbol');

  // Obvious sequences and repeats defeat length alone.
  if (/(.)\1{2,}/.test(password) || /(?:abc|123|qwe|password|admin)/i.test(password)) {
    score = Math.max(0, score - 2);
    suggestions.push('Avoid repeated characters and common words');
  }

  const clamped = Math.min(4, Math.max(0, score)) as 0 | 1 | 2 | 3 | 4;
  const labels = ['Very weak', 'Weak', 'Fair', 'Strong', 'Very strong'] as const;

  return { score: clamped, label: labels[clamped], suggestions };
}
