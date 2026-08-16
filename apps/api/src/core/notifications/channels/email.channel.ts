/** Email delivery over SMTP, with a branded HTML wrapper. */

import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../../../config/env.js';
import { moduleLogger } from '../../logger.js';

const log = moduleLogger('email');

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (!env.SMTP_HOST) return null;

  transporter ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
    pool: true,
    maxConnections: 5,
    maxMessages: 100,
  });

  return transporter;
}

export interface EmailInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  attachments?: Array<{ filename: string; path?: string; content?: Buffer }>;
}

export async function sendEmail(input: EmailInput): Promise<string> {
  const tx = getTransporter();

  if (!tx) {
    log.info({ to: input.to, subject: input.subject }, '[stub] Email not sent — SMTP_HOST unset');
    return `stub-${Date.now()}`;
  }

  const info = await tx.sendMail({
    from: `"${env.MAIL_FROM_NAME}" <${env.MAIL_FROM_ADDRESS}>`,
    to: input.to,
    subject: input.subject,
    html: wrapHtml(input.subject, input.html),
    // A plain-text alternative keeps the message out of spam filters.
    text: input.text ?? stripHtml(input.html),
    replyTo: input.replyTo,
    attachments: input.attachments,
  });

  return info.messageId;
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Minimal responsive shell. Inline styles only — email clients strip <style>. */
function wrapHtml(title: string, body: string): string {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,0.1);">
            <tr>
              <td style="background:linear-gradient(135deg,#4F46E5,#7C3AED);padding:24px 32px;">
                <h1 style="margin:0;color:#ffffff;font-size:18px;font-weight:600;">${escapeHtml(env.MAIL_FROM_NAME)}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;color:#0f172a;font-size:15px;line-height:1.6;">
                <h2 style="margin:0 0 16px;font-size:20px;font-weight:600;color:#0f172a;">${escapeHtml(title)}</h2>
                ${body}
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;color:#64748b;font-size:12px;">
                This is an automated message from your school's ERP system. Please do not reply.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function verifyEmailTransport(): Promise<boolean> {
  const tx = getTransporter();
  if (!tx) return false;
  try {
    await tx.verify();
    return true;
  } catch (err) {
    log.error({ err }, 'SMTP verification failed');
    return false;
  }
}
