import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { db, usersTable, sessionsTable, invitationsTable } from "@workspace/db";
import { eq, and, gt, sql, or, ilike } from "drizzle-orm";
import { logger } from "../lib/logger";
import { normalizeProfilePhotoUrl } from "../lib/storage";
import { rateLimit, resetRateLimit } from "../lib/rate-limiter";
import {
  sendPasswordResetEmail,
  sendVerificationEmail,
  sendInvitationEmail,
} from "../lib/email";

const router: IRouter = Router();

// ─── Constants ──────────────────────────────────────────────
const GENERIC_LOGIN_ERROR = "Invalid email or password";
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 30 * 60 * 1000; // 30 minutes
const RESET_TOKEN_EXPIRY_MS = 60 * 60 * 1000; // 1 hour
const VERIFICATION_TOKEN_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours
const INVITATION_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const LOGIN_RATE_LIMIT_MAX = 10;
const LOGIN_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const FORGOT_RATE_LIMIT_MAX = 3;
const FORGOT_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

// ─── Helpers ────────────────────────────────────────────────
function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

function generateSecureToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

function validatePasswordStrength(password: string): string | null {
  if (password.length < 8) return "Password must be at least 8 characters long";
  if (!/[a-z]/.test(password)) return "Password must contain at least one lowercase letter";
  if (!/[A-Z]/.test(password)) return "Password must contain at least one uppercase letter";
  if (!/[0-9]/.test(password)) return "Password must contain at least one number";
  if (!/[^a-zA-Z0-9]/.test(password)) return "Password must contain at least one special character";
  return null;
}

function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function serializeUser(user: typeof usersTable.$inferSelect) {
  const { passwordHash: _, ...safeUser } = user;
  if (safeUser.profilePhoto) safeUser.profilePhoto = normalizeProfilePhotoUrl(safeUser.profilePhoto);
  return safeUser;
}

function getClientIp(req: any): string {
  return (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket?.remoteAddress || "unknown";
}

function getUserAgent(req: any): string {
  return (req.headers["user-agent"] as string) || "unknown";
}

// ─── Core Auth Functions (imported by other routes) ─────────
export async function getUserIdFromToken(token: string): Promise<number | null> {
  try {
    const now = new Date();
    const [session] = await db
      .select()
      .from(sessionsTable)
      .where(and(
        eq(sessionsTable.token, token),
        gt(sessionsTable.expiresAt, now),
      ));
    if (!session) return null;

    // Update lastUsedAt (fire and forget)
    db.update(sessionsTable)
      .set({ lastUsedAt: now })
      .where(eq(sessionsTable.id, session.id))
      .catch(() => {});

    return session.userId;
  } catch {
    return null;
  }
}

export async function getUserFromRequest(
  req: any,
): Promise<typeof usersTable.$inferSelect | null> {
  try {
    const auth = req.headers["authorization"];

    if (!auth || !auth.startsWith("Bearer ")) {
      return null;
    }

    const token = auth.slice(7);
    const userId = await getUserIdFromToken(token);

    if (!userId) {
      return null;
    }

    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, userId));

    if (!user || !user.isActive) {
      return null;
    }

    return user;
  } catch {
    return null;
  }
}

// ─── Login ──────────────────────────────────────────────────
router.post("/auth/login", async (req, res) => {
  const { username, password, email } = req.body as {
    username?: string;
    email?: string;
    password?: string;
  };

  // Validate input
  if (!password || (!username && !email)) {
    return res.status(400).json({ error: "Email/username and password are required" });
  }

  const identifier = email || username;
  if (!identifier) {
    return res.status(400).json({ error: "Email/username and password are required" });
  }

  // Rate limiting
  const rateLimitKey = `login:${identifier.toLowerCase()}`;
  if (!rateLimit(rateLimitKey, LOGIN_RATE_LIMIT_MAX, LOGIN_RATE_LIMIT_WINDOW_MS)) {
    return res.status(429).json({
      error: "Too many login attempts. Please try again later.",
    });
  }

  try {
    // Look up user by email OR username
    const [user] = await db
      .select()
      .from(usersTable)
      .where(
        email
          ? or(eq(usersTable.email, identifier), eq(usersTable.username, identifier))
          : eq(usersTable.username, identifier)
      );

    if (!user) {
      return res.status(401).json({ error: GENERIC_LOGIN_ERROR });
    }

    // Check if account is active
    if (!user.isActive) {
      return res.status(403).json({ error: "Account has been deactivated. Contact your administrator." });
    }

    // Check if account is locked
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const minutesLeft = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
      return res.status(423).json({
        error: `Account is locked. Try again in ${minutesLeft} minute${minutesLeft === 1 ? "" : "s"}.`,
      });
    }

    // Verify password
    const valid = await bcrypt.compare(password, user.passwordHash);

    if (!valid) {
      // Increment failed attempts
      const attempts = user.failedLoginAttempts + 1;
      const updateData: Record<string, any> = { failedLoginAttempts: attempts };

      if (attempts >= MAX_LOGIN_ATTEMPTS) {
        updateData.lockedUntil = new Date(Date.now() + LOCKOUT_DURATION_MS);
        logger.warn({ userId: user.id, username: user.username }, "Account locked after too many failed attempts");
      }

      await db.update(usersTable).set(updateData).where(eq(usersTable.id, user.id));

      return res.status(401).json({ error: GENERIC_LOGIN_ERROR });
    }

    // Login successful — reset failed attempts and lockout
    if (user.failedLoginAttempts > 0 || user.lockedUntil) {
      await db.update(usersTable)
        .set({ failedLoginAttempts: 0, lockedUntil: null })
        .where(eq(usersTable.id, user.id));
    }

    // Clear rate limit on success
    resetRateLimit(rateLimitKey);

    // Create session
    const token = generateToken();
    const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);

    await db.insert(sessionsTable).values({
      token,
      userId: user.id,
      expiresAt,
      ipAddress: getClientIp(req),
      userAgent: getUserAgent(req),
    });

    return res.json({
      user: serializeUser(user),
      token,
    });
  } catch (err) {
    logger.error({ err }, "Login error");
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

// ─── Admin Setup (first-time) ──────────────────────────────
router.get("/auth/setup-status", async (_req, res) => {
  try {
    const [result] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(usersTable)
      .where(eq(usersTable.role, "admin"));

    return res.json({ adminExists: (result?.count ?? 0) > 0 });
  } catch (err) {
    logger.error({ err }, "Setup status check error");
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post("/auth/admin/setup", async (req, res) => {
  // Rate limit bootstrap attempts per IP (endpoint is reachable without a
  // session on truly fresh installs, so abuse resistance matters here).
  const setupRateLimitKey = `setup:${getClientIp(req)}`;
  if (!rateLimit(setupRateLimitKey, LOGIN_RATE_LIMIT_MAX, LOGIN_RATE_LIMIT_WINDOW_MS)) {
    return res.status(429).json({ error: "Too many requests. Please try again later." });
  }

  try {
    // Check if admin already exists
    const [result] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(usersTable)
      .where(eq(usersTable.role, "admin"));

    if ((result?.count ?? 0) > 0) {
      return res.status(403).json({ error: "Admin account already exists. Use the login page." });
    }

    // Secure bootstrap condition:
    // - Zero users at all (virgin install): anonymous setup allowed — there is
    //   no one who could authenticate yet.
    // - Users exist but no Admin (this deployment): only an AUTHENTICATED,
    //   active CRM user (any role, e.g. an existing Sales user) may create the
    //   first Admin. Arbitrary internet users are rejected with a generic 401.
    const [userCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(usersTable);

    if ((userCount?.count ?? 0) > 0) {
      const bootstrapUser = await getUserFromRequest(req);
      if (!bootstrapUser || !bootstrapUser.isActive) {
        return res.status(401).json({ error: "Unauthorized" });
      }
    }

    const { name, email, password, confirmPassword } = req.body as {
      name?: string;
      email?: string;
      password?: string;
      confirmPassword?: string;
    };

    if (!name || !email || !password || !confirmPassword) {
      return res.status(400).json({ error: "All fields are required" });
    }

    if (!validateEmail(email)) {
      return res.status(400).json({ error: "Invalid email address" });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ error: "Passwords do not match" });
    }

    const passwordError = validatePasswordStrength(password);
    if (passwordError) {
      return res.status(400).json({ error: passwordError });
    }

    // Check email uniqueness
    const [existingEmail] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.email, email))
      .limit(1);

    if (existingEmail) {
      return res.status(409).json({ error: "An account with this email already exists" });
    }

    const passwordHash = await hashPassword(password);

    // Create the admin user — username is "admin" for backward compat
    let admin: typeof usersTable.$inferSelect;
    try {
      [admin] = await db
        .insert(usersTable)
        .values({
          name,
          username: "admin",
          email,
          passwordHash,
          role: "admin",
          unit: "All",
          canViewAllReports: true,
          canAssignLeads: true,
          emailVerified: true, // Setup counts as verification
          isActive: true,
        })
        .returning();
    } catch (insertErr: any) {
      // Unique violation (Postgres 23505): username "admin" already taken by a
      // legacy user, or a concurrent setup won the race — never a 500.
      if (insertErr?.code === "23505") {
        return res.status(409).json({ error: "Unable to create Admin account: a conflicting account already exists" });
      }
      throw insertErr;
    }

    // Create session
    const token = generateToken();
    const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);

    await db.insert(sessionsTable).values({
      token,
      userId: admin!.id,
      expiresAt,
      ipAddress: getClientIp(req),
      userAgent: getUserAgent(req),
    });

    logger.info({ userId: admin!.id, email }, "Admin account created via first-time setup");

    return res.status(201).json({
      user: serializeUser(admin!),
      token,
    });
  } catch (err) {
    logger.error({ err }, "Admin setup error");
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

// ─── Forgot Password ────────────────────────────────────────
router.post("/auth/forgot-password", async (req, res) => {
  const { email } = req.body as { email?: string };

  // Always return the same message regardless of whether email exists
  const GENERIC_MSG = "If your email is registered, a password reset link has been sent.";

  if (!email || !validateEmail(email)) {
    return res.json({ message: GENERIC_MSG });
  }

  // Rate limit
  const rateLimitKey = `forgot:${email.toLowerCase()}`;
  if (!rateLimit(rateLimitKey, FORGOT_RATE_LIMIT_MAX, FORGOT_RATE_LIMIT_WINDOW_MS)) {
    return res.status(429).json({ error: "Too many requests. Please try again later." });
  }

  try {
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, email));

    if (user && user.isActive) {
      const resetToken = generateSecureToken();
      const resetExpiresAt = new Date(Date.now() + RESET_TOKEN_EXPIRY_MS);

      await db
        .update(usersTable)
        .set({
          resetToken: await hashPassword(resetToken), // Hash the token like a password for DB security
          resetExpiresAt,
        })
        .where(eq(usersTable.id, user.id));

      await sendPasswordResetEmail(email, resetToken);
    }

    return res.json({ message: GENERIC_MSG });
  } catch (err) {
    logger.error({ err }, "Forgot password error");
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

// ─── Reset Password ─────────────────────────────────────────
router.post("/auth/reset-password", async (req, res) => {
  const { token, password, confirmPassword } = req.body as {
    token?: string;
    password?: string;
    confirmPassword?: string;
  };

  if (!token || !password || !confirmPassword) {
    return res.status(400).json({ error: "Token and new password are required" });
  }

  if (password !== confirmPassword) {
    return res.status(400).json({ error: "Passwords do not match" });
  }

  const passwordError = validatePasswordStrength(password);
  if (passwordError) {
    return res.status(400).json({ error: passwordError });
  }

  try {
    // Find user by checking reset tokens (we stored hashed version)
    // Since we can't reverse the hash, we check all users with active reset tokens
    const usersWithReset = await db
      .select()
      .from(usersTable)
      .where(and(
        sql`${usersTable.resetToken} IS NOT NULL`,
        gt(usersTable.resetExpiresAt, new Date()),
      ));

    let matchedUser: typeof usersTable.$inferSelect | null = null;
    for (const u of usersWithReset) {
      if (u.resetToken && await bcrypt.compare(token, u.resetToken)) {
        matchedUser = u;
        break;
      }
    }

    if (!matchedUser) {
      return res.status(400).json({ error: "Invalid or expired reset token" });
    }

    const passwordHash = await hashPassword(password);

    await db
      .update(usersTable)
      .set({
        passwordHash,
        resetToken: null,
        resetExpiresAt: null,
        failedLoginAttempts: 0,
        lockedUntil: null,
      })
      .where(eq(usersTable.id, matchedUser.id));

    // Optionally revoke all existing sessions
    await db
      .delete(sessionsTable)
      .where(eq(sessionsTable.userId, matchedUser.id));

    logger.info({ userId: matchedUser.id }, "Password reset completed");

    return res.json({ message: "Password has been reset. Please log in with your new password." });
  } catch (err) {
    logger.error({ err }, "Reset password error");
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

// ─── Email Verification ─────────────────────────────────────
router.post("/auth/verify-email", async (req, res) => {
  const { token } = req.body as { token?: string };

  if (!token) {
    return res.status(400).json({ error: "Verification token is required" });
  }

  try {
    const [user] = await db
      .select()
      .from(usersTable)
      .where(and(
        eq(usersTable.verificationToken, token),
        sql`${usersTable.verificationExpiresAt} > NOW()`,
      ));

    if (!user) {
      return res.status(400).json({ error: "Invalid or expired verification token" });
    }

    await db
      .update(usersTable)
      .set({
        emailVerified: true,
        verificationToken: null,
        verificationExpiresAt: null,
      })
      .where(eq(usersTable.id, user.id));

    return res.json({ message: "Email verified successfully" });
  } catch (err) {
    logger.error({ err }, "Email verification error");
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post("/auth/resend-verification", async (req, res) => {
  const { email } = req.body as { email?: string };

  const GENERIC_MSG = "If your email is registered and unverified, a verification link has been sent.";

  if (!email || !validateEmail(email)) {
    return res.json({ message: GENERIC_MSG });
  }

  try {
    const [user] = await db
      .select()
      .from(usersTable)
      .where(and(
        eq(usersTable.email, email),
        eq(usersTable.emailVerified, false),
      ));

    if (user) {
      const verificationToken = generateSecureToken();
      const verificationExpiresAt = new Date(Date.now() + VERIFICATION_TOKEN_EXPIRY_MS);

      await db
        .update(usersTable)
        .set({ verificationToken, verificationExpiresAt })
        .where(eq(usersTable.id, user.id));

      await sendVerificationEmail(email, verificationToken);
    }

    return res.json({ message: GENERIC_MSG });
  } catch (err) {
    logger.error({ err }, "Resend verification error");
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

// ─── Google OAuth ───────────────────────────────────────────
router.post("/auth/google", async (req, res) => {
  const { idToken, clientId } = req.body as { idToken?: string; clientId?: string };

  if (!idToken) {
    return res.status(400).json({ error: "Google ID token is required" });
  }

  try {
    // Verify the Google ID token
    const googleClientId = clientId || process.env.GOOGLE_CLIENT_ID;
    if (!googleClientId) {
      return res.status(500).json({ error: "Google OAuth not configured" });
    }

    // Verify with Google's tokeninfo endpoint
    const response = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`
    );

    if (!response.ok) {
      return res.status(401).json({ error: "Invalid Google token" });
    }

    const googleData = (await response.json()) as {
      email: string;
      sub: string;
      name?: string;
      email_verified?: string;
    };

    if (!googleData.email || googleData.email_verified === "false") {
      return res.status(401).json({ error: "Google email not verified" });
    }

    // Find existing CRM user by email
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, googleData.email));

    if (!user) {
      return res.status(403).json({
        error: "Account not authorized. Please contact your administrator.",
      });
    }

    if (!user.isActive) {
      return res.status(403).json({ error: "Account has been deactivated. Contact your administrator." });
    }

    // Link Google ID if not already linked
    if (!user.googleId) {
      await db
        .update(usersTable)
        .set({
          googleId: googleData.sub,
          emailVerified: true,
        })
        .where(eq(usersTable.id, user.id));
    }

    // Create session
    const token = generateToken();
    const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);

    await db.insert(sessionsTable).values({
      token,
      userId: user.id,
      expiresAt,
      ipAddress: getClientIp(req),
      userAgent: getUserAgent(req),
    });

    logger.info({ userId: user.id, email: googleData.email }, "Google login successful");

    return res.json({
      user: serializeUser(user),
      token,
    });
  } catch (err) {
    logger.error({ err }, "Google auth error");
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

// ─── User Invitation ────────────────────────────────────────
router.post("/auth/invitations", async (req, res) => {
  const me = await getUserFromRequest(req);
  if (!me || me.role !== "admin") {
    return res.status(403).json({ error: "Admin only" });
  }

  const { email, role, unit } = req.body as {
    email?: string;
    role?: string;
    unit?: string;
  };

  if (!email || !validateEmail(email)) {
    return res.status(400).json({ error: "Valid email is required" });
  }

  if (!role || !["sales", "production", "production_and_support", "support", "inventory"].includes(role)) {
    return res.status(400).json({ error: "Valid role is required (sales, production, production_and_support, support, inventory)" });
  }

  try {
    // Check if user already exists with this email
    const [existingUser] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.email, email))
      .limit(1);

    if (existingUser) {
      return res.status(409).json({ error: "A user with this email already exists" });
    }

    // Check for existing pending invitation
    const [existingInvite] = await db
      .select({ id: invitationsTable.id })
      .from(invitationsTable)
      .where(and(
        eq(invitationsTable.email, email),
        sql`${invitationsTable.acceptedAt} IS NULL`,
        gt(invitationsTable.expiresAt, new Date()),
      ))
      .limit(1);

    if (existingInvite) {
      return res.status(409).json({ error: "A pending invitation already exists for this email" });
    }

    const inviteToken = generateSecureToken();
    const expiresAt = new Date(Date.now() + INVITATION_EXPIRY_MS);

    await db.insert(invitationsTable).values({
      email,
      token: inviteToken,
      role,
      unit: unit || "All",
      createdBy: me.id,
      expiresAt,
    });

    await sendInvitationEmail(email, inviteToken, role, me.name);

    logger.info({ email, role, invitedBy: me.id }, "User invitation sent");

    return res.status(201).json({ message: "Invitation sent successfully" });
  } catch (err) {
    logger.error({ err }, "Invitation error");
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post("/auth/invitations/accept", async (req, res) => {
  const { token, name, password, confirmPassword } = req.body as {
    token?: string;
    name?: string;
    password?: string;
    confirmPassword?: string;
  };

  if (!token || !name || !password || !confirmPassword) {
    return res.status(400).json({ error: "All fields are required" });
  }

  if (password !== confirmPassword) {
    return res.status(400).json({ error: "Passwords do not match" });
  }

  const passwordError = validatePasswordStrength(password);
  if (passwordError) {
    return res.status(400).json({ error: passwordError });
  }

  try {
    // Find valid invitation
    const [invitation] = await db
      .select()
      .from(invitationsTable)
      .where(and(
        eq(invitationsTable.token, token),
        sql`${invitationsTable.acceptedAt} IS NULL`,
        gt(invitationsTable.expiresAt, new Date()),
      ));

    if (!invitation) {
      return res.status(400).json({ error: "Invalid or expired invitation" });
    }

    // Check email not taken
    const [existingUser] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.email, invitation.email))
      .limit(1);

    if (existingUser) {
      return res.status(409).json({ error: "An account with this email already exists" });
    }

    // Generate username from email
    const baseUsername = invitation.email.split("@")[0].toLowerCase().replace(/[^a-z0-9]/g, "");
    let username = baseUsername;
    let suffix = 1;
    while (true) {
      const [taken] = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.username, username))
        .limit(1);
      if (!taken) break;
      username = `${baseUsername}${suffix}`;
      suffix++;
    }

    const passwordHash = await hashPassword(password);

    // Create user
    const [user] = await db
      .insert(usersTable)
      .values({
        name,
        username,
        email: invitation.email,
        passwordHash,
        role: invitation.role,
        unit: invitation.unit,
        emailVerified: true,
        isActive: true,
      })
      .returning();

    // Mark invitation as accepted
    await db
      .update(invitationsTable)
      .set({ acceptedAt: new Date() })
      .where(eq(invitationsTable.id, invitation.id));

    // Create session
    const sessionToken = generateToken();
    const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);

    await db.insert(sessionsTable).values({
      token: sessionToken,
      userId: user!.id,
      expiresAt,
      ipAddress: getClientIp(req),
      userAgent: getUserAgent(req),
    });

    logger.info({ userId: user!.id, email: invitation.email, role: invitation.role }, "Invitation accepted, user created");

    return res.status(201).json({
      user: serializeUser(user!),
      token: sessionToken,
    });
  } catch (err) {
    logger.error({ err }, "Accept invitation error");
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

// ─── Logout (single session) ───────────────────────────────
router.post("/auth/logout", async (req, res) => {
  try {
    const auth = req.headers["authorization"];

    if (auth?.startsWith("Bearer ")) {
      const token = auth.slice(7);
      await db.delete(sessionsTable).where(eq(sessionsTable.token, token));
    }

    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Logout error");
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// ─── Logout All Sessions ────────────────────────────────────
router.post("/auth/logout-all", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    await db.delete(sessionsTable).where(eq(sessionsTable.userId, user.id));

    return res.json({ ok: true, message: "All sessions have been terminated" });
  } catch (err) {
    logger.error({ err }, "Logout all error");
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

// ─── Auth Me ────────────────────────────────────────────────
router.get("/auth/me", async (req, res) => {
  try {
    const auth = req.headers["authorization"];

    if (!auth) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const user = await getUserFromRequest(req);

    if (!user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    return res.json(serializeUser(user));
  } catch (err) {
    logger.error({ err }, "Auth/me error");
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

export default router;
