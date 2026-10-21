import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { argon2id, hash, verify } from "argon2";

const PARAMETERS = { type: argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1, hashLength: 32 } as const;
export function hashPassword(password: string): Promise<string> { return hash(password, PARAMETERS); }
let dummyHash: Promise<string> | undefined;
export async function verifyPassword(encoded: string | undefined, password: string): Promise<boolean> {
  // A randomly initialized dummy takes the same verifier path for unknown/inactive accounts.
  if (!encoded) dummyHash ??= hashPassword(randomBytes(32).toString("base64url"));
  return verify(encoded ?? await dummyHash!, password);
}
export function newSecret(): string { return randomBytes(32).toString("base64url"); }
export function principalBucket(operation: string, login: string): string {
  return `${operation}:${createHash("sha256").update(login, "utf8").digest("hex")}`;
}
export function secretVerifier(secret: string): string { return createHash("sha256").update(Buffer.from(secret, "base64url")).digest("hex"); }
export function canonicalSecret(secret: unknown): secret is string {
  return typeof secret === "string" && /^[A-Za-z0-9_-]{43}$/.test(secret) && Buffer.from(secret, "base64url").toString("base64url") === secret;
}
export function verifySecret(secret: string, expected?: string): boolean {
  const actual = Buffer.from(secretVerifier(secret), "hex");
  const comparison = expected && /^[a-f0-9]{64}$/.test(expected) ? Buffer.from(expected, "hex") : Buffer.alloc(32);
  return timingSafeEqual(actual, comparison) && expected !== undefined;
}
