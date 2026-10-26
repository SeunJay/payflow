// Access JWTs and refresh tokens (spec 0004, "Tokens").
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import type { AuthContext } from './auth-context.ts';
import { tokenExpired, unauthenticated } from './errors.ts';

const ISSUER = 'payflow-api';
const AUDIENCE = 'payflow-api';

/** Who the caller is, from a verified access token. */
export type AuthContextOfRequest = { readonly userId: string; readonly sessionId: string };

const payloadSchema = z.object({
  sub: z.uuid(),
  sid: z.uuid(),
  iat: z.number().int(),
  exp: z.number().int(),
});

export function signAccessToken(
  auth: AuthContext,
  userId: string,
  sessionId: string,
): { token: string; expiresAt: Date } {
  // `exp` is computed here rather than with `expiresIn`, so the same value gives `accessExpiresAt`.
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + auth.accessTtlSeconds;
  const token = jwt.sign({ sid: sessionId, iat, exp }, auth.jwtSecret, {
    algorithm: 'HS256',
    issuer: ISSUER,
    audience: AUDIENCE,
    subject: userId,
  });
  return { token, expiresAt: new Date(exp * 1000) };
}

export function authenticate(auth: AuthContext, accessToken: string | undefined): AuthContextOfRequest {
  if (!accessToken) throw unauthenticated();
  let decoded: unknown;
  try {
    // The `algorithms` list is what blocks `none` and algorithm swap tokens. Never drop it.
    decoded = jwt.verify(accessToken, auth.jwtSecret, { algorithms: ['HS256'], issuer: ISSUER, audience: AUDIENCE });
  } catch (err) {
    // Thrown only once the signature checks out.
    if (err instanceof jwt.TokenExpiredError) throw tokenExpired();
    throw unauthenticated();
  }
  const payload = payloadSchema.safeParse(decoded);
  if (!payload.success) throw unauthenticated();
  return { userId: payload.data.sub, sessionId: payload.data.sid };
}

const sessionIdSchema = z.uuid();
const SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export const newRefreshSecret = () => randomBytes(32).toString('base64url');

export const hashSecret = (secret: string) => createHash('sha256').update(secret).digest('hex');

export const formatRefreshToken = (sessionId: string, secret: string) => `${sessionId}.${secret}`;

/** `<session id>.<secret>`, or null when malformed or missing. */
export function parseRefreshToken(token: string | undefined): { sessionId: string; secret: string } | null {
  if (!token) return null;
  const dot = token.indexOf('.');
  if (dot < 0) return null;
  const sessionId = token.slice(0, dot);
  const secret = token.slice(dot + 1);
  if (!sessionIdSchema.safeParse(sessionId).success || !SECRET_PATTERN.test(secret)) return null;
  return { sessionId: sessionId.toLowerCase(), secret };
}

/** Constant time check of a presented secret against the stored hex hash. */
export function secretMatches(secret: string, storedHash: string): boolean {
  return timingSafeEqual(Buffer.from(hashSecret(secret), 'hex'), Buffer.from(storedHash, 'hex'));
}
