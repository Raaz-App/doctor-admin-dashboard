/**
 * Password hashing for doctor dashboard logins (stored in the Doctors module's Password_Hash field).
 *
 * scrypt with a random per-record salt — the stored form is `saltHex:hashHex`. The plaintext is never
 * stored or logged; an admin can only RESET a password, not read it back. Server-only (node:crypto).
 * MUST match the verify logic in the doctor dashboard so a password set here works there.
 */
import crypto from "node:crypto";

const KEYLEN = 32;
const PARAMS = { N: 16384, r: 8, p: 1 } as const;

/** Hash a plaintext password into the `saltHex:hashHex` form stored in Zoho. */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, KEYLEN, PARAMS);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}
