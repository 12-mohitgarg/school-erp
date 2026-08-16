/**
 * SMS delivery.
 *
 * Defaults to MSG91 (the common choice for Indian schools, which need
 * DLT-registered sender ids). When no API key is configured the provider is
 * stubbed to a log line so the whole notification pipeline still works end to
 * end in development.
 */

import { env } from '../../../config/env.js';
import { moduleLogger } from '../../logger.js';
import { maskTail } from '@erp/shared';

const log = moduleLogger('sms');

/**
 * Is a real SMS provider configured?
 *
 * Callers use this to tell the user "logged only, no provider configured"
 * rather than reporting a delivery that never left the building.
 */
export function isSmsConfigured(): boolean {
  return Boolean(env.SMS_API_KEY);
}

export async function sendSms(to: string, message: string): Promise<string> {
  if (!env.SMS_API_KEY) {
    log.info({ to: maskTail(to), preview: message.slice(0, 60) }, '[stub] SMS not sent — SMS_API_KEY unset');
    return `stub-${Date.now()}`;
  }

  switch (env.SMS_PROVIDER) {
    case 'msg91':
      return sendViaMsg91(to, message);
    default:
      throw new Error(`Unsupported SMS provider: ${env.SMS_PROVIDER}`);
  }
}

async function sendViaMsg91(to: string, message: string): Promise<string> {
  // MSG91 expects the number without a leading '+'.
  const recipient = to.replace(/^\+/, '');

  const response = await fetch('https://control.msg91.com/api/v5/flow/', {
    method: 'POST',
    headers: {
      authkey: env.SMS_API_KEY!,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sender: env.SMS_SENDER_ID,
      short_url: '0',
      recipients: [{ mobiles: recipient, message }],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`MSG91 responded ${response.status}: ${text.slice(0, 200)}`);
  }

  const result = (await response.json()) as { request_id?: string; type?: string };
  if (result.type === 'error') {
    throw new Error(`MSG91 rejected the message: ${JSON.stringify(result).slice(0, 200)}`);
  }

  return result.request_id ?? `msg91-${Date.now()}`;
}
