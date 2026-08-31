import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { usersTable } from "@workspace/db";
import { logger } from "./logger";
import { rateLimit } from "./rate-limiter";
import { sendExportOtpEmail } from "./email";
import { logSecurityEvent } from "./security-audit";

// ─── Constants ──────────────────────────────────────────────
const EXPORT_OTP_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes
const EXPORT_TOKEN_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes
const EXPORT_OTP_MAX_ATTEMPTS = 5;
const EXPORT_OTP_SEND_RATE_LIMIT_MAX = 5;
const EXPORT_OTP_SEND_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const EXPORT_OTP_VERIFY_RATE_LIMIT_MAX = 10;
const EXPORT_OTP_VERIFY_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

interface StoredExportOtp {
  otpHash: string;
  expiresAt: number;
  attempts: number;
  email: string;
}

interface StoredExportToken {
  userId: number;
  userEmail: string;
  expiresAt: number;
  createdAt: number;
}

// In-memory bounded stores
const exportOtpStore = new Map<number, StoredExportOtp>();
const exportTokenStore = new Map<string, StoredExportToken>();

// Cleanup stale entries every 60 seconds
setInterval(() => {
  const now = Date.now();
  for (const [userId, entry] of exportOtpStore) {
    if (entry.expiresAt <= now) {
      exportOtpStore.delete(userId);
    }
  }
  for (const [token, entry] of exportTokenStore) {
    if (entry.expiresAt <= now) {
      exportTokenStore.delete(token);
    }
  }
}, 60 * 1000);

/**
 * Masks an email for safe UI display (e.g. s***2@gmail.com or a***n@example.com).
 */
export function maskEmail(email: string): string {
  if (!email || !email.includes("@")) return "registered email";
  const [localPart, domain] = email.split("@");
  if (!localPart || !domain) return "registered email";

  if (localPart.length <= 2) {
    return `${localPart[0]}*@${domain}`;
  }
  const first = localPart[0];
  const last = localPart[localPart.length - 1];
  return `${first}${"*".repeat(Math.min(localPart.length - 2, 5))}${last}@${domain}`;
}

/**
 * Generate a 6-digit cryptographically secure OTP.
 */
function generate6DigitOTP(): string {
  return crypto.randomInt(100000, 1000000).toString();
}

/**
 * Request an export OTP for an authenticated Admin user.
 */
export async function requestExportOtp(
  user: typeof usersTable.$inferSelect,
  ip: string
): Promise<{
  success: boolean;
  message: string;
  emailMasked?: string;
  expiresInSeconds?: number;
  error?: string;
  status?: number;
}> {
  if (user.role !== "admin") {
    return {
      success: false,
      status: 403,
      error: "Export OTP verification is only applicable for Admin users.",
      message: "Forbidden",
    };
  }

  if (!user.email) {
    return {
      success: false,
      status: 400,
      error: "Admin user has no registered email address configured.",
      message: "No email address found",
    };
  }

  const normalizedEmail = user.email.trim().toLowerCase();

  // Rate limit OTP requests per user and IP
  const rateLimitKey = `export-otp-send:${user.id}`;
  if (!rateLimit(rateLimitKey, EXPORT_OTP_SEND_RATE_LIMIT_MAX, EXPORT_OTP_SEND_RATE_LIMIT_WINDOW_MS)) {
    await logSecurityEvent({
      entityType: "user",
      entityId: user.id,
      action: "export_verification_blocked",
      newValue: { reason: "rate_limit_exceeded_send" },
      changedBy: user.id,
      ipAddress: ip,
    });
    return {
      success: false,
      status: 429,
      error: "Too many OTP requests. Please try again later.",
      message: "Rate limit exceeded",
    };
  }

  // Generate OTP and hash it with bcrypt
  const otp = generate6DigitOTP();
  const otpHash = await bcrypt.hash(otp, 10);
  const expiresAt = Date.now() + EXPORT_OTP_EXPIRY_MS;

  // Invalidate any previous OTP by overwriting
  exportOtpStore.set(user.id, {
    otpHash,
    expiresAt,
    attempts: 0,
    email: normalizedEmail,
  });

  // ── DEV OTP LOG ──────────────────────────────────────────
  // Print to console when in dev mode without real SMTP for guaranteed visibility
  if (!process.env.SMTP_HOST && process.env.NODE_ENV !== "production") {
    console.log("");
    console.log("========================================================");
    console.log("  [DEV EXPORT OTP] Excel Export Verification Code");
    console.log("========================================================");
    console.log("  Admin:   " + user.username + " (" + normalizedEmail + ")");
    console.log("  OTP:     " + otp);
    console.log("  Expires: 5 minutes");
    console.log("========================================================");
    console.log("");
  }

  // Send OTP email
  await sendExportOtpEmail(normalizedEmail, otp);

  await logSecurityEvent({
    entityType: "user",
    entityId: user.id,
    action: "export_otp_requested",
    newValue: { email: maskEmail(normalizedEmail) },
    changedBy: user.id,
    ipAddress: ip,
  });

  logger.info({ userId: user.id, email: maskEmail(normalizedEmail) }, "Excel export OTP generated and sent");

  return {
    success: true,
    message: "Verification code sent to registered email.",
    emailMasked: maskEmail(normalizedEmail),
    expiresInSeconds: Math.floor(EXPORT_OTP_EXPIRY_MS / 1000),
  };
}

/**
 * Verify an export OTP code entered by the Admin user.
 */
export async function verifyExportOtp(
  user: typeof usersTable.$inferSelect,
  code: string,
  ip: string
): Promise<{
  success: boolean;
  exportToken?: string;
  expiresInSeconds?: number;
  error?: string;
  status?: number;
  attemptsRemaining?: number;
}> {
  if (user.role !== "admin") {
    return {
      success: false,
      status: 403,
      error: "Export verification is only applicable for Admin users.",
    };
  }

  if (!code || typeof code !== "string" || code.trim().length !== 6) {
    return {
      success: false,
      status: 400,
      error: "Valid 6-digit verification code is required.",
    };
  }

  const cleanCode = code.trim();

  // Rate limit OTP verification attempts
  const rateLimitKey = `export-otp-verify:${user.id}`;
  if (!rateLimit(rateLimitKey, EXPORT_OTP_VERIFY_RATE_LIMIT_MAX, EXPORT_OTP_VERIFY_RATE_LIMIT_WINDOW_MS)) {
    await logSecurityEvent({
      entityType: "user",
      entityId: user.id,
      action: "export_verification_blocked",
      newValue: { reason: "rate_limit_exceeded_verify" },
      changedBy: user.id,
      ipAddress: ip,
    });
    return {
      success: false,
      status: 429,
      error: "Too many verification attempts. Please try again later.",
    };
  }

  const stored = exportOtpStore.get(user.id);

  if (!stored) {
    return {
      success: false,
      status: 400,
      error: "No active verification code found. Please request a new code.",
    };
  }

  // Check expiration (5 minutes)
  if (Date.now() > stored.expiresAt) {
    exportOtpStore.delete(user.id);
    return {
      success: false,
      status: 410,
      error: "Verification code expired. Please request a new code.",
    };
  }

  // Check attempt threshold (max 5)
  if (stored.attempts >= EXPORT_OTP_MAX_ATTEMPTS) {
    exportOtpStore.delete(user.id);
    await logSecurityEvent({
      entityType: "user",
      entityId: user.id,
      action: "export_verification_blocked",
      newValue: { reason: "max_attempts_exceeded" },
      changedBy: user.id,
      ipAddress: ip,
    });
    return {
      success: false,
      status: 429,
      error: "Too many failed attempts. Please request a new code.",
    };
  }

  // Compare bcrypt hash
  const isValid = await bcrypt.compare(cleanCode, stored.otpHash);

  if (!isValid) {
    stored.attempts += 1;
    const remaining = Math.max(0, EXPORT_OTP_MAX_ATTEMPTS - stored.attempts);

    await logSecurityEvent({
      entityType: "user",
      entityId: user.id,
      action: "export_otp_verification_failed",
      newValue: { attempts: stored.attempts, remaining },
      changedBy: user.id,
      ipAddress: ip,
    });

    if (remaining === 0) {
      exportOtpStore.delete(user.id);
      return {
        success: false,
        status: 429,
        error: "Too many failed attempts. Please request a new code.",
        attemptsRemaining: 0,
      };
    }

    return {
      success: false,
      status: 400,
      error: "Invalid verification code.",
      attemptsRemaining: remaining,
    };
  }

  // Successfully verified! Consume/delete the single-use OTP
  exportOtpStore.delete(user.id);

  // Generate cryptographically random export authorization token
  const exportToken = `exp_auth_${crypto.randomBytes(32).toString("hex")}`;
  const tokenExpiresAt = Date.now() + EXPORT_TOKEN_EXPIRY_MS;

  exportTokenStore.set(exportToken, {
    userId: user.id,
    userEmail: user.email || "",
    expiresAt: tokenExpiresAt,
    createdAt: Date.now(),
  });

  await logSecurityEvent({
    entityType: "user",
    entityId: user.id,
    action: "export_otp_verification_success",
    changedBy: user.id,
    ipAddress: ip,
  });

  logger.info({ userId: user.id }, "Excel export OTP successfully verified; authorization token issued");

  return {
    success: true,
    exportToken,
    expiresInSeconds: Math.floor(EXPORT_TOKEN_EXPIRY_MS / 1000),
  };
}

/**
 * Validate export authorization for an export request.
 * - If user is NOT admin: always valid (bypasses export verification).
 * - If user IS admin: requires valid, unexpired exportToken tied to this admin.
 */
export async function validateExportAuth(
  req: any,
  user: typeof usersTable.$inferSelect,
  exportType: string = "excel"
): Promise<{
  valid: boolean;
  status?: number;
  error?: string;
  verificationRequired?: boolean;
}> {
  // Non-admin roles (sales, production, support, etc.) are never gated by export OTP
  if (user.role !== "admin") {
    return { valid: true };
  }

  // Extract export token from header or query param
  const headerToken = req.headers["x-export-token"];
  const queryToken = req.query.exportToken;
  const rawToken = (typeof headerToken === "string" ? headerToken : typeof queryToken === "string" ? queryToken : "")?.trim();

  if (!rawToken) {
    await logSecurityEvent({
      entityType: "export",
      entityId: user.id,
      action: "export_verification_blocked",
      newValue: { reason: "missing_export_token", exportType },
      changedBy: user.id,
      ipAddress: (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket?.remoteAddress || "unknown",
    });

    return {
      valid: false,
      status: 403,
      error: "Additional verification required before downloading Excel data.",
      verificationRequired: true,
    };
  }

  const storedToken = exportTokenStore.get(rawToken);

  if (!storedToken || storedToken.userId !== user.id || storedToken.expiresAt <= Date.now()) {
    if (storedToken && storedToken.expiresAt <= Date.now()) {
      exportTokenStore.delete(rawToken);
    }

    await logSecurityEvent({
      entityType: "export",
      entityId: user.id,
      action: "export_verification_blocked",
      newValue: { reason: "invalid_or_expired_token", exportType },
      changedBy: user.id,
      ipAddress: (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket?.remoteAddress || "unknown",
    });

    return {
      valid: false,
      status: 403,
      error: "Export authorization has expired or is invalid. Please verify again.",
      verificationRequired: true,
    };
  }

  // Token is valid! Record successful export in audit log
  await logSecurityEvent({
    entityType: "export",
    entityId: user.id,
    action: "excel_export_performed",
    newValue: { exportType },
    changedBy: user.id,
    ipAddress: (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket?.remoteAddress || "unknown",
  });

  return { valid: true };
}
