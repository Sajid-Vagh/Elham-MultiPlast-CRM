import nodemailer from "nodemailer";
import { logger } from "./logger";

/**
 * Email utility — uses real SMTP when SMTP_HOST is configured,
 * falls back to console logging for local development.
 *
 * Required env vars for real email sending:
 *   SMTP_HOST, SMTP_PORT (default 587), SMTP_USER, SMTP_PASS, SMTP_FROM
 */

interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

// Lazy-initialized transporter — created once, reused across sends
let _transporter: nodemailer.Transporter | null = null;

function getSmtpConfig() {
  const host = (process.env.SMTP_HOST || process.env.EMAIL_HOST || process.env.MAIL_HOST || "").trim();
  const rawPort = (process.env.SMTP_PORT || process.env.EMAIL_PORT || process.env.MAIL_PORT || "587").trim();
  const port = Number(rawPort) || 587;
  const user = (process.env.SMTP_USER || process.env.SMTP_USERNAME || process.env.EMAIL_USER || process.env.MAIL_USER || process.env.MAIL_USERNAME || "").trim();
  const pass = (process.env.SMTP_PASS || process.env.SMTP_PASSWORD || process.env.EMAIL_PASS || process.env.EMAIL_PASSWORD || process.env.MAIL_PASSWORD || "").trim();
  const explicitSecure = process.env.SMTP_SECURE || process.env.EMAIL_SECURE;
  const secure = explicitSecure !== undefined ? explicitSecure === "true" : port === 465;

  return { host, port, user, pass, secure };
}

function getTransporter(): nodemailer.Transporter | null {
  if (_transporter) return _transporter;

  const { host, port, user, pass, secure } = getSmtpConfig();
  if (!host) return null;

  try {
    _transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: user ? { user, pass } : undefined,
      tls: {
        rejectUnauthorized: process.env.SMTP_IGNORE_TLS_ERRORS === "true" ? false : undefined,
        minVersion: "TLSv1.2",
      },
      connectionTimeout: 15_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });

    logger.info({ host, port, secure, auth: !!user }, "SMTP transporter initialized");
    return _transporter;
  } catch (err: any) {
    logger.error({ err: err?.message, host, port }, "Failed to create SMTP transporter");
    _transporter = null;
    return null;
  }
}

function getFromAddress(): string {
  const rawFrom = process.env.SMTP_FROM || process.env.EMAIL_FROM || process.env.MAIL_FROM || process.env.DEFAULT_FROM_EMAIL;
  const { user } = getSmtpConfig();

  if (rawFrom && rawFrom.trim()) {
    const trimmed = rawFrom.trim();
    if (trimmed.includes("<") && trimmed.includes(">")) {
      return trimmed;
    }
    return `"Elham MultiPlast CRM" <${trimmed}>`;
  }

  if (user && user.includes("@")) {
    return `"Elham MultiPlast CRM" <${user}>`;
  }

  return `"Elham MultiPlast CRM" <sales@elhammultiplast.com>`;
}

export async function verifySmtpConnection(): Promise<{ ok: boolean; error?: string }> {
  const transporter = getTransporter();
  if (!transporter) {
    return { ok: false, error: "SMTP_HOST not configured" };
  }
  try {
    await transporter.verify();
    return { ok: true };
  } catch (err: any) {
    _transporter = null;
    return { ok: false, error: err?.message || "SMTP verification failed" };
  }
}

export async function sendEmail(options: SendEmailOptions): Promise<boolean> {
  const { to, subject, html, text } = options;
  const from = getFromAddress();

  const transporter = getTransporter();

  if (!transporter) {
    // No SMTP configured — log only (development mode)
    logger.warn({ to, subject, from }, "Email logged only — SMTP_HOST not configured. Set SMTP_* env vars for real delivery.");
    if (process.env.NODE_ENV !== "production") {
      logger.debug({ to, subject, html, text }, "Email content (dev mode only)");
    }
    return true;
  }

  try {
    const info = await transporter.sendMail({ from, to, subject, html, text });
    logger.info({ to, subject, from, messageId: info.messageId, response: info.response }, "Email sent successfully");
    return true;
  } catch (err: any) {
    // Invalidate cached transporter on failure so subsequent calls re-initialize cleanly
    _transporter = null;
    logger.error(
      {
        errorMessage: err?.message,
        errorCode: err?.code,
        errorCommand: err?.command,
        errorResponse: err?.response,
        errorResponseCode: err?.responseCode,
        from,
        to,
        subject,
      },
      "Failed to send email via SMTP"
    );
    return false;
  }
}

/**
 * Build the full URL for email links (password reset, verification, invitation).
 */
export function buildFrontendUrl(path: string, params: Record<string, string>): string {
  const base = process.env.FRONTEND_URL || "http://localhost:5173";
  const url = new URL(path, base);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

/**
 * Send a password reset email.
 */
export async function sendPasswordResetEmail(email: string, token: string): Promise<boolean> {
  const resetUrl = buildFrontendUrl("/reset-password", { token });
  return sendEmail({
    to: email,
    subject: "Reset Your Password — Elham MultiPlast CRM",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2>Password Reset Request</h2>
        <p>We received a request to reset your password. Click the link below to set a new password:</p>
        <p style="margin: 20px 0;">
          <a href="${resetUrl}" style="background-color: #4f46e5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
            Reset Password
          </a>
        </p>
        <p style="color: #666; font-size: 14px;">This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
        <p style="color: #999; font-size: 12px;">Elham MultiPlast LLP — CRM System</p>
      </div>
    `,
    text: `Reset your password: ${resetUrl}\n\nThis link expires in 1 hour.`,
  });
}

/**
 * Send an email verification email.
 */
export async function sendVerificationEmail(email: string, token: string): Promise<boolean> {
  const verifyUrl = buildFrontendUrl("/verify-email", { token });
  return sendEmail({
    to: email,
    subject: "Verify Your Email — Elham MultiPlast CRM",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2>Verify Your Email Address</h2>
        <p>Thank you for registering. Please verify your email address by clicking the link below:</p>
        <p style="margin: 20px 0;">
          <a href="${verifyUrl}" style="background-color: #4f46e5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
            Verify Email
          </a>
        </p>
        <p style="color: #666; font-size: 14px;">This link expires in 24 hours.</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
        <p style="color: #999; font-size: 12px;">Elham MultiPlast LLP — CRM System</p>
      </div>
    `,
    text: `Verify your email: ${verifyUrl}\n\nThis link expires in 24 hours.`,
  });
}

/**
 * Send a 6-digit OTP email for verification.
 */
export async function sendOtpEmail(email: string, otp: string): Promise<boolean> {
  return sendEmail({
    to: email,
    subject: "Your Verification Code — Elham MultiPlast CRM",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2>Email Verification Code</h2>
        <p>Use the following 6-digit code to verify your email address:</p>
        <div style="margin: 30px 0; text-align: center;">
          <span style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #4f46e5; background: #f3f4f6; padding: 16px 32px; border-radius: 8px; display: inline-block; font-family: monospace;">${otp}</span>
        </div>
        <p style="color: #666; font-size: 14px;">This code expires in 10 minutes. If you didn't request this, you can safely ignore this email.</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
        <p style="color: #999; font-size: 12px;">Elham MultiPlast LLP — CRM System</p>
      </div>
    `,
    text: `Your verification code: ${otp}\n\nThis code expires in 10 minutes.`,
  });
}

/**
 * Send an Excel export verification OTP email to Admin.
 */
export async function sendExportOtpEmail(email: string, otp: string): Promise<boolean> {
  return sendEmail({
    to: email,
    subject: "Excel Export Verification Code — Elham MultiPlast CRM",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2>Excel Export Verification</h2>
        <p>A request was made to export CRM data to Excel from your Admin account.</p>
        <p>Use the following 6-digit verification code to authorize the export:</p>
        <div style="margin: 30px 0; text-align: center;">
          <span style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #4f46e5; background: #f3f4f6; padding: 16px 32px; border-radius: 8px; display: inline-block; font-family: monospace;">${otp}</span>
        </div>
        <p style="color: #666; font-size: 14px;">This code expires in 5 minutes. If you did not request this export, please secure your account.</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
        <p style="color: #999; font-size: 12px;">Elham MultiPlast LLP — CRM System</p>
      </div>
    `,
    text: `Your Excel export verification code is: ${otp}\n\nThis code expires in 5 minutes.\n\nIf you did not request this export, please secure your account.`,
  });
}

/**
 * Send a user invitation email.
 */
export async function sendInvitationEmail(
  email: string,
  token: string,
  role: string,
  invitedByName: string,
): Promise<boolean> {
  const inviteUrl = buildFrontendUrl("/accept-invitation", { token });
  return sendEmail({
    to: email,
    subject: `You've Been Invited to Elham MultiPlast CRM (${role})`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2>You've Been Invited!</h2>
        <p><strong>${invitedByName}</strong> has invited you to join the Elham MultiPlast CRM as a <strong>${role}</strong>.</p>
        <p>Click the link below to set your password and activate your account:</p>
        <p style="margin: 20px 0;">
          <a href="${inviteUrl}" style="background-color: #4f46e5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
            Accept Invitation
          </a>
        </p>
        <p style="color: #666; font-size: 14px;">This invitation expires in 7 days.</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
        <p style="color: #999; font-size: 12px;">Elham MultiPlast LLP — CRM System</p>
      </div>
    `,
    text: `You've been invited by ${invitedByName} to join the CRM as ${role}. Accept here: ${inviteUrl}\n\nThis invitation expires in 7 days.`,
  });
}
