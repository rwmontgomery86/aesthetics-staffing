import "server-only";
import { createHash, randomBytes } from "node:crypto";

/**
 * Org-invite link tokens. Only the SHA-256 hash is stored
 * (organization_invites.token_hash) — the plaintext token exists once, in the
 * link shown to the inviter right after creation (and in the invite email,
 * Phase 6). The link alone can't be abused: RLS only lets the invited email
 * accept, so the token is transport, not the credential.
 */

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newInviteToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashInviteToken(token) };
}
