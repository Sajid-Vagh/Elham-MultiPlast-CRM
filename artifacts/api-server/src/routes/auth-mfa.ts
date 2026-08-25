import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { db, usersTable, sessionsTable } from "@workspace/db";
import { eq, and, gt, sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { rateLimit, resetRateLimit } from "../lib/rate-limiter";
import {
  createTOTP,
  verifyTOTP,
  generateTOTPUri,
  generateQRCode,
  generateOTP,
  hashOTP,
  verifyOTP,
  generateRecoveryCodes,
  hashRecoveryCodes,
  verifyRecoveryCode,
  parseRecoveryCodesHash,
  serializeRecoveryCodesHash,
} from "../lib/mfa";
import { encryptSecret, decryptSecret } from "../lib/crypto";
import { logSecurityEvent } from "../lib/security-audit";
import { sendOtpEmail } from "../lib/email";

const router: IRouter = Router();

// ─── Constants ──────────────────────────────────────────────
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
const OTP_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes
const OTP_MAX_ATTEMPTS = 5;
const MFA_SETUP_TOKEN_EXPIRY_MS = 15 * 60 * 1000; // 15 minutes
const MFA_LOGIN_TOKEN_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes
const OTP_RATE_LIMIT_MAX = 5;
const OTP_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MFA_VERIFY_RATE_LIMIT_MAX = 10;
const MFA_VERIFY_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

// ─── Helpers ────────────────────────────────────────────────
function generateToken(): string {
  const crypto = require("node:crypto");
  return crypto.randomBytes(32).toString("hex");
}

function getClientIp(req: any): string {
  return (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket?.remoteAddress || "unknown";
}

async function getUserFromRequest(req: any): Promise<typeof usersTable.$inferSelect | null> {
  const auth = req.headers["authorization"];
  if (!auth || !auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7);
  try {
    const now = new Date();
    const [session] = await db.select().from(sessionsTable).where(
      and(eq(sessionsTable.token, token), gt(sessionsTable.expiresAt, now))
    );
    if (!session) return null;
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, session.userId));
    if (!user || !user.isActive) return null;
    return user;
  } catch {
    return null;
  }
}

// ─── OTP: Send Verification Email ──────────────────────────
router.post("/auth/otp/send", async (req, res) => {
  const { email, purpose } = req.body as { email?: string; purpose?: string };

  if (!email) {
    return res.status(400).json({ error: "Email is required" });
  }

  const normalizedEmail = email.trim().toLowerCase();

  // Rate limit OTP sends
  const rlKey = `otp-send:${normalizedEmail}`;
  if (!rateLimit(rlKey, OTP_RATE_LIMIT_MAX, OTP_RATE_LIMIT_WINDOW_MS)) {
    return res.status(429).json({ error: "Too many OTP requests. Please try again later." });
  }

  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.email, normalizedEmail));

    // Always return generic response — never reveal whether email exists
    const GENERIC_MSG = "If your email is registered, a verification code has been sent.";

    if (!user || user.emailVerified) {
      return res.json({ message: GENERIC_MSG });
    }

    // Generate 6-digit OTP
    const otp = generateOTP();
    const otpHash = await hashOTP(otp);
    const otpExpiresAt = new Date(Date.now() + OTP_EXPIRY_MS);

    await db.update(usersTable).set({
      otpHash,
      otpExpiresAt,
      otpAttempts: 0,
    }).where(eq(usersTable.id, user.id));

    // Send OTP via email
    await sendOtpEmail(normalizedEmail, otp);

    if (!process.env.SMTP_HOST) {
      logger.warn({ userId: user.id }, "SMTP_HOST not configured — OTP email cannot be delivered");
      // In development, log the OTP for testing
      if (process.env.NODE_ENV !== "production") {
        logger.info({ otp, email: normalizedEmail }, "DEV MODE: OTP code (not sent via email)");
      }
    }

    logger.info({ userId: user.id }, "OTP sent for email verification");

    return res.json({ message: GENERIC_MSG });
  } catch (err) {
    logger.error({ err }, "OTP send error");
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

// ─── OTP: Verify Code ─────────────────────────────────────
router.post("/auth/otp/verify", async (req, res) => {
  const { email, code, purpose } = req.body as { email?: string; code?: string; purpose?: string };

  if (!email || !code) {
    return res.status(400).json({ error: "Email and verification code are required" });
  }

  const normalizedEmail = email.trim().toLowerCase();

  // Rate limit OTP verify attempts
  const rlKey = `otp-verify:${normalizedEmail}`;
  if (!rateLimit(rlKey, MFA_VERIFY_RATE_LIMIT_MAX, MFA_VERIFY_RATE_LIMIT_WINDOW_MS)) {
    return res.status(429).json({ error: "Too many verification attempts. Please try again later." });
  }

  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.email, normalizedEmail));

    if (!user) {
      return res.status(400).json({ error: "Invalid or expired verification code" });
    }

    if (user.emailVerified) {
      return res.json({ message: "Email already verified" });
    }

    // Check OTP exists and hasn't expired
    if (!user.otpHash || !user.otpExpiresAt || user.otpExpiresAt < new Date()) {
      return res.status(400).json({ error: "Invalid or expired verification code" });
    }

    // Check attempts
    if (user.otpAttempts >= OTP_MAX_ATTEMPTS) {
      return res.status(429).json({ error: "Too many failed attempts. Please request a new code." });
    }

    // Verify OTP
    const valid = await verifyOTP(code, user.otpHash);

    if (!valid) {
      await db.update(usersTable).set({
        otpAttempts: user.otpAttempts + 1,
      }).where(eq(usersTable.id, user.id));

      await logSecurityEvent({
        entityType: "user",
        entityId: user.id,
        action: "otp_verification_failed",
        newValue: { attempts: user.otpAttempts + 1 },
        ipAddress: getClientIp(req),
      });

      return res.status(400).json({ error: "Invalid or expired verification code" });
    }

    // OTP verified — clear OTP fields and mark email as verified
    await db.update(usersTable).set({
      emailVerified: true,
      otpHash: null,
      otpExpiresAt: null,
      otpAttempts: 0,
    }).where(eq(usersTable.id, user.id));

    await logSecurityEvent({
      entityType: "user",
      entityId: user.id,
      action: "otp_verification_success",
      changedBy: user.id,
      ipAddress: getClientIp(req),
    });

    // For first-admin (inactive admin), return mfaSetupRequired
    if (user.role === "admin" && !user.isActive) {
      // Generate a short-lived MFA setup token
      const mfaSetupToken = generateToken();
      await db.update(usersTable).set({
        mfaSetupToken,
      }).where(eq(usersTable.id, user.id));

      // Set expiry via setTimeout (clean up after 15 minutes)
      setTimeout(async () => {
        try {
          await db.update(usersTable).set({ mfaSetupToken: null })
            .where(and(eq(usersTable.id, user.id), eq(usersTable.mfaSetupToken, mfaSetupToken)));
        } catch { /* ignore */ }
      }, MFA_SETUP_TOKEN_EXPIRY_MS);

      return res.json({
        message: "Email verified successfully",
        mfaSetupRequired: true,
        mfaSetupToken,
      });
    }

    return res.json({ message: "Email verified successfully" });
  } catch (err) {
    logger.error({ err }, "OTP verify error");
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

// ─── MFA: Setup TOTP (generates QR code + secret) ─────────
router.post("/auth/mfa/setup", async (req, res) => {
  const { mfaSetupToken } = req.body as { mfaSetupToken?: string };

  if (!mfaSetupToken) {
    return res.status(400).json({ error: "MFA setup token is required" });
  }

  try {
    // Find user by MFA setup token
    const [user] = await db.select().from(usersTable).where(
      eq(usersTable.mfaSetupToken, mfaSetupToken)
    );

    if (!user) {
      return res.status(400).json({ error: "Invalid or expired MFA setup session" });
    }

    // Only admin users in inactive state (first-admin flow) can use setup token
    if (user.role !== "admin" || user.isActive) {
      return res.status(403).json({ error: "MFA setup is not available for this account" });
    }

    // Generate TOTP
    const totp = createTOTP(user.email || user.username, "Elham MultiPlast CRM");
    const uri = generateTOTPUri(totp);
    const qrCodeDataUrl = await generateQRCode(uri);
    const manualKey = totp.secret.base32;

    // Store encrypted secret temporarily (will be finalized on verify-setup)
    const encryptedSecret = encryptSecret(totp.secret.base32);
    await db.update(usersTable).set({
      mfaSecretEncrypted: encryptedSecret,
    }).where(eq(usersTable.id, user.id));

    return res.json({
      qrCode: qrCodeDataUrl,
      manualKey,
      message: "Scan the QR code with your authenticator app, then enter the 6-digit code to verify",
    });
  } catch (err) {
    logger.error({ err }, "MFA setup error");
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

// ─── MFA: Verify Setup (completes first-admin activation) ──
router.post("/auth/mfa/verify-setup", async (req, res) => {
  const { mfaSetupToken, code } = req.body as { mfaSetupToken?: string; code?: string };

  if (!mfaSetupToken || !code) {
    return res.status(400).json({ error: "MFA setup token and verification code are required" });
  }

  // Rate limit MFA verify
  const rlKey = `mfa-setup-verify:${mfaSetupToken.slice(0, 16)}`;
  if (!rateLimit(rlKey, MFA_VERIFY_RATE_LIMIT_MAX, MFA_VERIFY_RATE_LIMIT_WINDOW_MS)) {
    return res.status(429).json({ error: "Too many verification attempts. Please try again later." });
  }

  try {
    const [user] = await db.select().from(usersTable).where(
      eq(usersTable.mfaSetupToken, mfaSetupToken)
    );

    if (!user) {
      return res.status(400).json({ error: "Invalid or expired MFA setup session" });
    }

    if (!user.mfaSecretEncrypted) {
      return res.status(400).json({ error: "MFA secret not found. Please restart MFA setup." });
    }

    // Decrypt secret and verify TOTP
    const secretBase32 = decryptSecret(user.mfaSecretEncrypted);
    const { TOTP, Secret } = await import("otpauth");
    const totp = new TOTP({
      issuer: "Elham MultiPlast CRM",
      label: user.email || user.username,
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: Secret.fromBase32(secretBase32),
    });

    const delta = totp.validate({ token: code, window: 1 });
    if (delta === null) {
      await logSecurityEvent({
        entityType: "user",
        entityId: user.id,
        action: "mfa_setup_verification_failed",
        changedBy: user.id,
        ipAddress: getClientIp(req),
      });
      return res.status(400).json({ error: "Invalid verification code. Please try again." });
    }

    // Generate recovery codes
    const rawCodes = generateRecoveryCodes(10);
    const hashedCodes = await hashRecoveryCodes(rawCodes);
    const recoveryCodesHash = serializeRecoveryCodesHash(hashedCodes.map(h => h.hash));

    // Now activate the first admin account
    const [updatedUser] = await db.update(usersTable).set({
      isActive: true,
      mfaEnabled: true,
      mfaVerifiedAt: new Date(),
      recoveryCodesHash,
      mfaSetupToken: null,
      verificationToken: null,
      verificationExpiresAt: null,
    }).where(eq(usersTable.id, user.id)).returning();

    // Check race condition: another active admin must not exist
    const [adminCount] = await db.select({ count: sql<number>`count(*)::int` })
      .from(usersTable)
      .where(and(eq(usersTable.role, "admin"), eq(usersTable.isActive, true)));

    if ((adminCount?.count ?? 0) > 1) {
      // Race condition: deactivate this one
      await db.update(usersTable).set({ isActive: false, mfaEnabled: false })
        .where(eq(usersTable.id, user.id));
      logger.warn({ userId: user.id }, "First-admin race condition detected — deactivated late account");
      return res.status(403).json({ error: "Admin account already exists. Use the login page." });
    }

    // Create session
    const sessionToken = generateToken();
    const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);
    await db.insert(sessionsTable).values({
      token: sessionToken,
      userId: user.id,
      expiresAt,
      ipAddress: getClientIp(req),
      userAgent: req.headers["user-agent"] || "unknown",
    });

    await logSecurityEvent({
      entityType: "user",
      entityId: user.id,
      action: "first_admin_activated",
      changedBy: user.id,
      newValue: { mfaEnabled: true, emailVerified: true },
      ipAddress: getClientIp(req),
    });

    const { passwordHash: _, mfaSecretEncrypted: __, recoveryCodesHash: ___, ...safeUser } = updatedUser!;

    logger.info({ userId: user.id }, "First-admin account fully activated with MFA");

    return res.json({
      message: "Admin account activated successfully",
      user: safeUser,
      token: sessionToken,
      recoveryCodes: rawCodes.map(r => r.code),
    });
  } catch (err) {
    logger.error({ err }, "MFA verify-setup error");
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

// ─── MFA: Verify during login ──────────────────────────────
router.post("/auth/mfa/verify-login", async (req, res) => {
  const { mfaToken, code, recoveryCode } = req.body as {
    mfaToken?: string;
    code?: string;
    recoveryCode?: string;
  };

  if (!mfaToken) {
    return res.status(400).json({ error: "MFA token is required" });
  }

  if (!code && !recoveryCode) {
    return res.status(400).json({ error: "Verification code or recovery code is required" });
  }

  // Rate limit
  const rlKey = `mfa-login:${mfaToken.slice(0, 16)}`;
  if (!rateLimit(rlKey, MFA_VERIFY_RATE_LIMIT_MAX, MFA_VERIFY_RATE_LIMIT_WINDOW_MS)) {
    return res.status(429).json({ error: "Too many verification attempts. Please try again later." });
  }

  try {
    // Find user by mfaSetupToken (reused for login MFA challenge)
    const [user] = await db.select().from(usersTable).where(
      eq(usersTable.mfaSetupToken, mfaToken)
    );

    if (!user) {
      return res.status(400).json({ error: "Invalid or expired verification session" });
    }

    if (!user.mfaEnabled || !user.mfaSecretEncrypted) {
      return res.status(400).json({ error: "MFA is not enabled for this account" });
    }

    let verified = false;

    if (recoveryCode) {
      // Verify recovery code
      const storedHashes = parseRecoveryCodesHash(user.recoveryCodesHash);
      const result = await verifyRecoveryCode(recoveryCode, storedHashes);

      if (result.valid) {
        // Remove used recovery code
        storedHashes.splice(result.index, 1);
        await db.update(usersTable).set({
          recoveryCodesHash: serializeRecoveryCodesHash(storedHashes),
        }).where(eq(usersTable.id, user.id));

        await logSecurityEvent({
          entityType: "user",
          entityId: user.id,
          action: "recovery_code_used",
          changedBy: user.id,
          newValue: { remaining: storedHashes.length },
          ipAddress: getClientIp(req),
        });

        verified = true;
      }
    } else if (code) {
      // Verify TOTP code
      const secretBase32 = decryptSecret(user.mfaSecretEncrypted);
      const { TOTP, Secret } = await import("otpauth");
      const totp = new TOTP({
        issuer: "Elham MultiPlast CRM",
        label: user.email || user.username,
        algorithm: "SHA1",
        digits: 6,
        period: 30,
        secret: Secret.fromBase32(secretBase32),
      });

      const delta = totp.validate({ token: code, window: 1 });
      verified = delta !== null;

      if (!verified) {
        await logSecurityEvent({
          entityType: "user",
          entityId: user.id,
          action: "mfa_login_verification_failed",
          changedBy: user.id,
          ipAddress: getClientIp(req),
        });
      }
    }

    if (!verified) {
      return res.status(400).json({ error: "Invalid verification code" });
    }

    // Clear the MFA challenge token
    await db.update(usersTable).set({ mfaSetupToken: null })
      .where(eq(usersTable.id, user.id));

    // Create session
    const sessionToken = generateToken();
    const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);
    await db.insert(sessionsTable).values({
      token: sessionToken,
      userId: user.id,
      expiresAt,
      ipAddress: getClientIp(req),
      userAgent: req.headers["user-agent"] || "unknown",
    });

    await logSecurityEvent({
      entityType: "user",
      entityId: user.id,
      action: "login_mfa_verified",
      changedBy: user.id,
      ipAddress: getClientIp(req),
    });

    resetRateLimit(`login:${user.email || user.username}`);
    resetRateLimit(`login:${user.username}`);

    const { passwordHash: _, mfaSecretEncrypted: __, recoveryCodesHash: ___, ...safeUser } = user;

    return res.json({
      user: safeUser,
      token: sessionToken,
    });
  } catch (err) {
    logger.error({ err }, "MFA verify-login error");
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

// ─── MFA: Disable (admin only, requires password + MFA) ────
router.post("/auth/mfa/disable", async (req, res) => {
  const me = await getUserFromRequest(req);
  if (!me) return res.status(401).json({ error: "Unauthorized" });

  const { password, code } = req.body as { password?: string; code?: string };

  if (!password) {
    return res.status(400).json({ error: "Password is required to disable MFA" });
  }

  if (!code) {
    return res.status(400).json({ error: "MFA verification code is required" });
  }

  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, me.id));
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    if (!user.mfaEnabled) {
      return res.status(400).json({ error: "MFA is not enabled" });
    }

    // Verify password
    const validPw = await bcrypt.compare(password, user.passwordHash);
    if (!validPw) {
      return res.status(401).json({ error: "Invalid password" });
    }

    // Verify MFA code
    if (!user.mfaSecretEncrypted) {
      return res.status(400).json({ error: "MFA secret not found" });
    }

    const secretBase32 = decryptSecret(user.mfaSecretEncrypted);
    const { TOTP, Secret } = await import("otpauth");
    const totp = new TOTP({
      issuer: "Elham MultiPlast CRM",
      label: user.email || user.username,
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: Secret.fromBase32(secretBase32),
    });

    const delta = totp.validate({ token: code, window: 1 });
    if (delta === null) {
      return res.status(400).json({ error: "Invalid MFA code" });
    }

    // Disable MFA
    await db.update(usersTable).set({
      mfaEnabled: false,
      mfaSecretEncrypted: null,
      mfaVerifiedAt: null,
      recoveryCodesHash: null,
    }).where(eq(usersTable.id, me.id));

    await logSecurityEvent({
      entityType: "user",
      entityId: me.id,
      action: "mfa_disabled",
      changedBy: me.id,
      ipAddress: getClientIp(req),
    });

    return res.json({ message: "MFA has been disabled" });
  } catch (err) {
    logger.error({ err }, "MFA disable error");
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

// ─── MFA: Get recovery codes ───────────────────────────────
router.get("/auth/mfa/recovery-codes", async (req, res) => {
  const me = await getUserFromRequest(req);
  if (!me) return res.status(401).json({ error: "Unauthorized" });

  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, me.id));
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    if (!user.mfaEnabled) {
      return res.status(400).json({ error: "MFA is not enabled" });
    }

    const hashes = parseRecoveryCodesHash(user.recoveryCodesHash);

    return res.json({ remaining: hashes.length });
  } catch (err) {
    logger.error({ err }, "Get recovery codes error");
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

// ─── MFA: Regenerate recovery codes ────────────────────────
router.post("/auth/mfa/recovery-codes/regenerate", async (req, res) => {
  const me = await getUserFromRequest(req);
  if (!me) return res.status(401).json({ error: "Unauthorized" });

  const { password } = req.body as { password?: string };
  if (!password) {
    return res.status(400).json({ error: "Password is required" });
  }

  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, me.id));
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    if (!user.mfaEnabled) {
      return res.status(400).json({ error: "MFA is not enabled" });
    }

    // Verify password
    const validPw = await bcrypt.compare(password, user.passwordHash);
    if (!validPw) {
      return res.status(401).json({ error: "Invalid password" });
    }

    // Generate new codes
    const rawCodes = generateRecoveryCodes(10);
    const hashedCodes = await hashRecoveryCodes(rawCodes);
    const recoveryCodesHash = serializeRecoveryCodesHash(hashedCodes.map(h => h.hash));

    await db.update(usersTable).set({ recoveryCodesHash }).where(eq(usersTable.id, me.id));

    await logSecurityEvent({
      entityType: "user",
      entityId: me.id,
      action: "recovery_codes_regenerated",
      changedBy: me.id,
      ipAddress: getClientIp(req),
    });

    return res.json({
      recoveryCodes: rawCodes.map(r => r.code),
      message: "New recovery codes generated. Save these — they won't be shown again.",
    });
  } catch (err) {
    logger.error({ err }, "Regenerate recovery codes error");
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

// ─── Change Password ────────────────────────────────────────
router.post("/auth/change-password", async (req, res) => {
  const me = await getUserFromRequest(req);
  if (!me) return res.status(401).json({ error: "Unauthorized" });

  const { currentPassword, newPassword, confirmPassword, mfaCode } = req.body as {
    currentPassword?: string;
    newPassword?: string;
    confirmPassword?: string;
    mfaCode?: string;
  };

  if (!currentPassword || !newPassword || !confirmPassword) {
    return res.status(400).json({ error: "Current password and new password are required" });
  }

  if (newPassword !== confirmPassword) {
    return res.status(400).json({ error: "New passwords do not match" });
  }

  // Password strength validation
  if (newPassword.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });
  if (!/[a-z]/.test(newPassword)) return res.status(400).json({ error: "Password must contain a lowercase letter" });
  if (!/[A-Z]/.test(newPassword)) return res.status(400).json({ error: "Password must contain an uppercase letter" });
  if (!/[0-9]/.test(newPassword)) return res.status(400).json({ error: "Password must contain a number" });
  if (!/[^a-zA-Z0-9]/.test(newPassword)) return res.status(400).json({ error: "Password must contain a special character" });

  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, me.id));
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    // Verify current password
    const validPw = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!validPw) {
      return res.status(401).json({ error: "Current password is incorrect" });
    }

    // If MFA is enabled, require MFA code
    if (user.mfaEnabled && user.mfaSecretEncrypted) {
      if (!mfaCode) {
        return res.status(400).json({ error: "MFA code is required", mfaRequired: true });
      }
      const secretBase32 = decryptSecret(user.mfaSecretEncrypted);
      const { TOTP, Secret } = await import("otpauth");
      const totp = new TOTP({
        issuer: "Elham MultiPlast CRM",
        label: user.email || user.username,
        algorithm: "SHA1",
        digits: 6,
        period: 30,
        secret: Secret.fromBase32(secretBase32),
      });
      const delta = totp.validate({ token: mfaCode, window: 1 });
      if (delta === null) {
        return res.status(400).json({ error: "Invalid MFA code" });
      }
    }

    // Update password
    const passwordHash = await bcrypt.hash(newPassword, 12);
    await db.update(usersTable).set({
      passwordHash,
      failedLoginAttempts: 0,
      lockedUntil: null,
    }).where(eq(usersTable.id, me.id));

    // Revoke all other sessions (keep current one)
    const auth = req.headers["authorization"];
    const currentToken = auth?.slice(7);
    if (currentToken) {
      await db.delete(sessionsTable).where(
        and(eq(sessionsTable.userId, me.id), sql`${sessionsTable.token} != ${currentToken}`)
      );
    }

    await logSecurityEvent({
      entityType: "user",
      entityId: me.id,
      action: "password_changed",
      changedBy: me.id,
      ipAddress: getClientIp(req),
    });

    return res.json({ message: "Password changed successfully. Other sessions have been logged out." });
  } catch (err) {
    logger.error({ err }, "Change password error");
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

// ─── Sessions: List active sessions ────────────────────────
router.get("/auth/sessions", async (req, res) => {
  const me = await getUserFromRequest(req);
  if (!me) return res.status(401).json({ error: "Unauthorized" });

  try {
    const sessions = await db.select().from(sessionsTable)
      .where(eq(sessionsTable.userId, me.id));

    const currentToken = req.headers["authorization"]?.slice(7);

    const enriched = sessions.map(s => ({
      id: s.id,
      ipAddress: s.ipAddress || "Unknown",
      userAgent: s.userAgent || "Unknown",
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
      lastUsedAt: s.lastUsedAt,
      isCurrent: s.token === currentToken,
      // Parse user agent for display
      device: parseUserAgent(s.userAgent || ""),
    }));

    return res.json({ sessions: enriched });
  } catch (err) {
    logger.error({ err }, "List sessions error");
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

// ─── Sessions: Revoke a session ────────────────────────────
router.delete("/auth/sessions/:id", async (req, res) => {
  const me = await getUserFromRequest(req);
  if (!me) return res.status(401).json({ error: "Unauthorized" });

  const sessionId = parseInt(req.params.id);
  if (isNaN(sessionId)) {
    return res.status(400).json({ error: "Invalid session ID" });
  }

  try {
    const [session] = await db.select().from(sessionsTable)
      .where(and(eq(sessionsTable.id, sessionId), eq(sessionsTable.userId, me.id)));

    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    await db.delete(sessionsTable).where(eq(sessionsTable.id, sessionId));

    await logSecurityEvent({
      entityType: "user",
      entityId: me.id,
      action: "session_revoked",
      changedBy: me.id,
      newValue: { sessionId },
      ipAddress: getClientIp(req),
    });

    return res.json({ message: "Session revoked" });
  } catch (err) {
    logger.error({ err }, "Revoke session error");
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

// ─── Sessions: Revoke all except current ───────────────────
router.post("/auth/sessions/revoke-others", async (req, res) => {
  const me = await getUserFromRequest(req);
  if (!me) return res.status(401).json({ error: "Unauthorized" });

  try {
    const currentToken = req.headers["authorization"]?.slice(7);

    if (currentToken) {
      const [currentSession] = await db.select().from(sessionsTable)
        .where(eq(sessionsTable.token, currentToken));

      if (currentSession) {
        await db.delete(sessionsTable).where(
          and(
            eq(sessionsTable.userId, me.id),
            sql`${sessionsTable.id} != ${currentSession.id}`
          )
        );
      }
    }

    await logSecurityEvent({
      entityType: "user",
      entityId: me.id,
      action: "all_other_sessions_revoked",
      changedBy: me.id,
      ipAddress: getClientIp(req),
    });

    return res.json({ message: "All other sessions have been revoked" });
  } catch (err) {
    logger.error({ err }, "Revoke other sessions error");
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

// ─── Security: Get MFA status ──────────────────────────────
router.get("/auth/mfa/status", async (req, res) => {
  const me = await getUserFromRequest(req);
  if (!me) return res.status(401).json({ error: "Unauthorized" });

  try {
    const [user] = await db.select({
      mfaEnabled: usersTable.mfaEnabled,
      mfaVerifiedAt: usersTable.mfaVerifiedAt,
      email: usersTable.email,
    }).from(usersTable).where(eq(usersTable.id, me.id));

    if (!user) return res.status(401).json({ error: "Unauthorized" });

    const recoveryCount = user.mfaEnabled ? parseRecoveryCodesHash(null).length : 0;

    return res.json({
      mfaEnabled: user.mfaEnabled,
      mfaVerifiedAt: user.mfaVerifiedAt,
      email: user.email,
    });
  } catch (err) {
    logger.error({ err }, "MFA status error");
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

// ─── Security: Get MFA setup QR (for enabling MFA on existing account) ──
router.post("/auth/mfa/enable", async (req, res) => {
  const me = await getUserFromRequest(req);
  if (!me) return res.status(401).json({ error: "Unauthorized" });

  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, me.id));
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    if (user.mfaEnabled) {
      return res.status(400).json({ error: "MFA is already enabled" });
    }

    // Generate TOTP
    const totp = createTOTP(user.email || user.username, "Elham MultiPlast CRM");
    const uri = generateTOTPUri(totp);
    const qrCodeDataUrl = await generateQRCode(uri);
    const manualKey = totp.secret.base32;

    // Store encrypted secret and setup token
    const encryptedSecret = encryptSecret(totp.secret.base32);
    const setupToken = generateToken();

    await db.update(usersTable).set({
      mfaSecretEncrypted: encryptedSecret,
      mfaSetupToken: setupToken,
    }).where(eq(usersTable.id, user.id));

    return res.json({
      qrCode: qrCodeDataUrl,
      manualKey,
      setupToken,
    });
  } catch (err) {
    logger.error({ err }, "MFA enable error");
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

// ─── Security: Verify MFA enable (for existing account) ────
router.post("/auth/mfa/enable-verify", async (req, res) => {
  const me = await getUserFromRequest(req);
  if (!me) return res.status(401).json({ error: "Unauthorized" });

  const { setupToken, code } = req.body as { setupToken?: string; code?: string };

  if (!setupToken || !code) {
    return res.status(400).json({ error: "Setup token and verification code are required" });
  }

  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, me.id));
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    if (user.mfaEnabled) {
      return res.status(400).json({ error: "MFA is already enabled" });
    }

    if (user.mfaSetupToken !== setupToken) {
      return res.status(400).json({ error: "Invalid setup session" });
    }

    if (!user.mfaSecretEncrypted) {
      return res.status(400).json({ error: "MFA secret not found. Please restart." });
    }

    // Verify TOTP
    const secretBase32 = decryptSecret(user.mfaSecretEncrypted);
    const { TOTP, Secret } = await import("otpauth");
    const totp = new TOTP({
      issuer: "Elham MultiPlast CRM",
      label: user.email || user.username,
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: Secret.fromBase32(secretBase32),
    });

    const delta = totp.validate({ token: code, window: 1 });
    if (delta === null) {
      return res.status(400).json({ error: "Invalid verification code" });
    }

    // Generate recovery codes
    const rawCodes = generateRecoveryCodes(10);
    const hashedCodes = await hashRecoveryCodes(rawCodes);
    const recoveryCodesHash = serializeRecoveryCodesHash(hashedCodes.map(h => h.hash));

    await db.update(usersTable).set({
      mfaEnabled: true,
      mfaVerifiedAt: new Date(),
      recoveryCodesHash,
      mfaSetupToken: null,
    }).where(eq(usersTable.id, me.id));

    await logSecurityEvent({
      entityType: "user",
      entityId: me.id,
      action: "mfa_enabled",
      changedBy: me.id,
      ipAddress: getClientIp(req),
    });

    return res.json({
      message: "MFA has been enabled",
      recoveryCodes: rawCodes.map(r => r.code),
    });
  } catch (err) {
    logger.error({ err }, "MFA enable-verify error");
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

// ─── Security: Audit log ────────────────────────────────────
router.get("/security/activity", async (req, res) => {
  const me = await getUserFromRequest(req);
  if (!me) return res.status(401).json({ error: "Unauthorized" });

  try {
    const { auditLogsTable } = await import("@workspace/db");

    const events = await db.select().from(auditLogsTable)
      .where(eq(auditLogsTable.changedBy, me.id))
      .orderBy(sql`${auditLogsTable.createdAt} DESC`)
      .limit(50);

    return res.json({ events });
  } catch (err) {
    logger.error({ err }, "Security activity error");
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

// ─── Helper: Parse User Agent ──────────────────────────────
function parseUserAgent(ua: string): string {
  if (!ua || ua === "unknown") return "Unknown Device";

  // Basic parsing
  if (ua.includes("Firefox")) return `Firefox (${ua.includes("Windows") ? "Windows" : ua.includes("Mac") ? "Mac" : ua.includes("Linux") ? "Linux" : "Other"})`;
  if (ua.includes("Edg/")) return `Edge (${ua.includes("Windows") ? "Windows" : ua.includes("Mac") ? "Mac" : "Other"})`;
  if (ua.includes("Chrome") && !ua.includes("Edg/")) return `Chrome (${ua.includes("Windows") ? "Windows" : ua.includes("Mac") ? "Mac" : ua.includes("Linux") ? "Linux" : "Other"})`;
  if (ua.includes("Safari") && !ua.includes("Chrome")) return `Safari (${ua.includes("Mac") ? "Mac" : "Other"})`;

  if (ua.includes("Mobile") || ua.includes("Android")) return "Mobile Browser";

  return "Web Browser";
}

export default router;
