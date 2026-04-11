/**
 * Sanitize an invite token from URL parameters.
 *
 * Prevents open-redirect attacks by ensuring the token matches
 * the expected format (alphanumeric with hyphens/underscores, bounded length).
 * Returns null if the token is missing or does not match.
 */
const INVITE_TOKEN_RE = /^[a-zA-Z0-9_-]{10,40}$/;

export function sanitizeInviteToken(raw: string | null): string | null {
  if (!raw || !INVITE_TOKEN_RE.test(raw)) return null;
  return raw;
}
