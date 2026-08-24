import { logger } from "./logger";

/**
 * Email utility — currently logs emails to console.
 * Replace with a real SMTP/SendGrid/Resend integration when ready.
 *
 * To activate real email sending, set these env vars:
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
 * or use a transactional email service (SendGrid, Resend, Postmark).
 */

interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export async function sendEmail(options: SendEmailOptions): Promise<boolean> {
  const { to, subject, html, text } = options;

  // Log for development — in production, integrate with your email provider
  logger.info({ to, subject }, "Email sent (logged only — configure SMTP for real delivery)");

  // In development, log the email content for testing
  if (process.env.NODE_ENV !== "production") {
    logger.debug({ to, subject, html, text }, "Email content");
  }

  // TODO: Replace with real email sending when SMTP is configured
  // Example with nodemailer:
  //
  // import nodemailer from "nodemailer";
  // const transporter = nodemailer.createTransport({
  //   host: process.env.SMTP_HOST,
  //   port: Number(process.env.SMTP_PORT || 587),
  //   auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  // });
  // await transporter.sendMail({ from: process.env.SMTP_FROM, to, subject, html, text });

  return true;
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
