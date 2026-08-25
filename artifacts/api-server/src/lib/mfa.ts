import { TOTP, Secret } from "otpauth";
import QRCode from "qrcode";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";

// ─── TOTP ──────────────────────────────────────────────────

export function createTOTP(label: string, issuer: string = "Elham MultiPlast CRM"): TOTP {
  const secret = new Secret({ size: 20 });
  return new TOTP({
    issuer,
    label,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret,
  });
}

export function verifyTOTP(totp: TOTP, token: string): boolean {
  const delta = totp.validate({ token, window: 1 }); // 1 window = 30s tolerance
  return delta !== null;
}

export function generateTOTPUri(totp: TOTP): string {
  return totp.toString(); // otpauth:// URI
}

export async function generateQRCode(uri: string): Promise<string> {
  return QRCode.toDataURL(uri, { width: 256, margin: 2 });
}

// ─── OTP (Email verification) ──────────────────────────────

export function generateOTP(): string {
  return crypto.randomInt(100000, 999999).toString();
}

export async function hashOTP(otp: string): Promise<string> {
  return bcrypt.hash(otp, 10);
}

export async function verifyOTP(otp: string, hash: string): Promise<boolean> {
  return bcrypt.compare(otp, hash);
}

// ─── Recovery Codes ────────────────────────────────────────

export interface RecoveryCode {
  code: string;
  hash: string;
}

export function generateRecoveryCodes(count: number = 10): RecoveryCode[] {
  const codes: RecoveryCode[] = [];
  for (let i = 0; i < count; i++) {
    const code = crypto.randomBytes(4).toString("hex").toUpperCase().replace(/(.{4})/g, "$1-").slice(0, -1);
    codes.push({ code, hash: "" }); // hashes computed async below
  }
  return codes;
}

export async function hashRecoveryCodes(codes: RecoveryCode[]): Promise<RecoveryCode[]> {
  const hashed: RecoveryCode[] = [];
  for (const rc of codes) {
    const hash = await bcrypt.hash(rc.code, 10);
    hashed.push({ code: rc.code, hash });
  }
  return hashed;
}

export async function verifyRecoveryCode(code: string, storedHashes: string[]): Promise<{ valid: boolean; index: number }> {
  for (let i = 0; i < storedHashes.length; i++) {
    if (await bcrypt.compare(code, storedHashes[i])) {
      return { valid: true, index: i };
    }
  }
  return { valid: false, index: -1 };
}

export function parseRecoveryCodesHash(hashStr: string | null): string[] {
  if (!hashStr) return [];
  try {
    const parsed = JSON.parse(hashStr);
    if (Array.isArray(parsed)) return parsed.filter((h): h is string => typeof h === "string");
    return [];
  } catch {
    return [];
  }
}

export function serializeRecoveryCodesHash(hashes: string[]): string {
  return JSON.stringify(hashes);
}
