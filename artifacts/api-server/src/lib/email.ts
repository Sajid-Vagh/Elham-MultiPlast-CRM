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

function getTransporter(): nodemailer.Transporter | null {
  if (_transporter) return _transporter;

  const host = process.env.SMTP_HOST;
  if (!host) return null;

  const port = Number(process.env.SMTP_PORT || 587);
  const secure = port === 465; // true for 465 (TLS), false for 587 (STARTTLS)

  _transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 5_000,
  });

  logger.info({ host, port, secure, auth: !!process.env.SMTP_USER }, "SMTP transporter initialized");
  return _transporter;
}

export async function sendEmail(options: SendEmailOptions): Promise<boolean> {
  const { to, subject, html, text } = options;
  const from = process.env.SMTP_FROM || "noreply@elham.com";

  const transporter = getTransporter();

  if (!transporter) {
    // No SMTP configured — log only (development mode)
    logger.warn({ to, subject }, "Email logged only — SMTP_HOST not configured. Set SMTP_* env vars for real delivery.");
    if (process.env.NODE_ENV !== "production") {
      logger.debug({ to, subject, html, text }, "Email content (dev mode only)");
    }
    return true;
  }

  try {
    const info = await transporter.sendMail({ from, to, subject, html, text });
    logger.info({ to, subject, messageId: info.messageId }, "Email sent successfully");
    return true;
  } catch (err) {
    logger.error({ err, to, subject }, "Failed to send email");
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
