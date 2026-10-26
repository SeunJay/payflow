// Refresh sessions (spec 0004, "State transitions"). Every decision is made
// under the session's row lock, in the caller's read committed unit of work.
import { eq, sql } from 'drizzle-orm';
import type { Tx } from '../../infra/tx.ts';
import type { AuthContext } from './auth-context.ts';
import { authSessions, users, type RevokedReason } from './schema.ts';
import {
  formatRefreshToken,
  hashSecret,
  newRefreshSecret,
  parseRefreshToken,
  secretMatches,
  signAccessToken,
} from './tokens.ts';

export type IssuedTokens = {
  readonly user: { readonly id: string; readonly email: string };
  readonly sessionId: string;
  readonly accessToken: string;
  readonly accessExpiresAt: Date;
  readonly refreshToken: string;
  readonly refreshExpiresAt: Date;
};

export type RefreshFailure = 'malformed' | 'unknown' | 'expired' | 'revoked' | 'reuse_detected';

export type RefreshResult =
  | { readonly ok: true; readonly tokens: IssuedTokens }
  | { readonly ok: false; readonly reason: RefreshFailure; readonly userId?: string; readonly sessionId?: string };

export type EndResult =
  | { readonly revoked: false }
  | { readonly revoked: true; readonly sessionId: string; readonly userId: string; readonly reason: RevokedReason };

export async function createSession(tx: Tx, auth: AuthContext, userId: string): Promise<IssuedTokens> {
  const secret = newRefreshSecret();
  const [session] = await tx
    .insert(authSessions)
    .values({
      userId,
      currentTokenHash: hashSecret(secret),
      // The ::int cast: Postgres cannot infer a parameter's type inside make_interval.
      expiresAt: sql`clock_timestamp() + make_interval(secs => ${auth.refreshTtlSeconds}::int)`,
    })
    .returning({ id: authSessions.id, expiresAt: authSessions.expiresAt });
  if (!session) throw new Error('identity: session insert returned no row');
  return issue(tx, auth, userId, session.id, secret, session.expiresAt);
}

/**
 * Rotates a refresh token. Client faults come back as `ok: false` instead of
 * throwing, because a reuse revoke must commit and a throw would roll it back.
 */
export async function refreshSession(
  tx: Tx,
  auth: AuthContext,
  refreshToken: string | undefined,
): Promise<RefreshResult> {
  const parsed = parseRefreshToken(refreshToken);
  if (!parsed) return { ok: false, reason: 'malformed' };

  const session = await lockSession(tx, parsed.sessionId);
  if (!session) return { ok: false, reason: 'unknown' };
  const ids = { userId: session.userId, sessionId: session.id };
  // Expiry before the secret: an expired session presented with a stale secret is already dead.
  if (session.revokedAt) return { ok: false, reason: 'revoked', ...ids };
  if (!session.live) return { ok: false, reason: 'expired', ...ids };

  if (!secretMatches(parsed.secret, session.currentTokenHash)) {
    await revoke(tx, session.id, 'reuse_detected');
    return { ok: false, reason: 'reuse_detected', ...ids };
  }

  const secret = newRefreshSecret();
  const [rotated] = await tx
    .update(authSessions)
    .set({ currentTokenHash: hashSecret(secret), rotatedAt: sql`clock_timestamp()` })
    .where(eq(authSessions.id, session.id))
    .returning({ expiresAt: authSessions.expiresAt });
  if (!rotated) throw new Error(`identity: session ${session.id} vanished under its lock`);
  return { ok: true, tokens: await issue(tx, auth, session.userId, session.id, secret, rotated.expiresAt) };
}

/** Ends the session a refresh token names. Unknown, revoked, and expired sessions are left alone. */
export async function endSession(tx: Tx, refreshToken: string | undefined): Promise<EndResult> {
  const parsed = parseRefreshToken(refreshToken);
  if (!parsed) return { revoked: false };
  const session = await lockSession(tx, parsed.sessionId);
  if (!session || session.revokedAt || !session.live) return { revoked: false };

  const reason: RevokedReason = secretMatches(parsed.secret, session.currentTokenHash) ? 'logout' : 'reuse_detected';
  await revoke(tx, session.id, reason);
  return { revoked: true, sessionId: session.id, userId: session.userId, reason };
}

async function lockSession(tx: Tx, sessionId: string) {
  const [session] = await tx
    .select({
      id: authSessions.id,
      userId: authSessions.userId,
      currentTokenHash: authSessions.currentTokenHash,
      revokedAt: authSessions.revokedAt,
      // The database clock, the same one that set expires_at.
      live: sql<boolean>`${authSessions.expiresAt} > clock_timestamp()`,
    })
    .from(authSessions)
    .where(eq(authSessions.id, sessionId))
    .for('update');
  return session;
}

async function revoke(tx: Tx, sessionId: string, reason: RevokedReason): Promise<void> {
  await tx
    .update(authSessions)
    .set({ revokedAt: sql`clock_timestamp()`, revokedReason: reason })
    .where(eq(authSessions.id, sessionId));
}

async function issue(
  tx: Tx,
  auth: AuthContext,
  userId: string,
  sessionId: string,
  secret: string,
  refreshExpiresAt: Date,
): Promise<IssuedTokens> {
  const [user] = await tx.select({ id: users.id, email: users.email }).from(users).where(eq(users.id, userId));
  if (!user) throw new Error(`identity: user ${userId} of session ${sessionId} is missing`);
  const access = signAccessToken(auth, userId, sessionId);
  return {
    user,
    sessionId,
    accessToken: access.token,
    accessExpiresAt: access.expiresAt,
    refreshToken: formatRefreshToken(sessionId, secret),
    refreshExpiresAt,
  };
}
