// Public API of the identity module (spec 0004). Writers take `tx: Tx` first;
// readers take `db: Db | Tx`.

/** Freezes the auth settings and computes the dummy hash once at boot. */
export { createAuthContext, type AuthConfig, type AuthContext } from './auth-context.ts';

/** Validates a sign up body (422 `validation_failed`) and hashes the password outside any unit of work. */
export { prepareSignUp, type PreparedSignUp } from './users.ts';

/** Inserts the user, or 409 `email_taken` when the email exists in any case. */
export { registerUser, type User } from './users.ts';

/** Checks an email and password: 422 `validation_failed` or 401 `invalid_credentials`, one hash either way. */
export { verifyCredentials } from './users.ts';

/** A user by id, or null when there is none (the caller answers 401). */
export { getUser } from './users.ts';

/** Starts a refresh session for a user and issues both tokens. */
export { createSession, type IssuedTokens } from './sessions.ts';

/** Rotates a refresh token, or reports why not; a reused token revokes its session. Never throws for client faults. */
export { refreshSession, type RefreshFailure, type RefreshResult } from './sessions.ts';

/** Revokes the session a refresh token names (log out), reporting what it did. */
export { endSession, type EndResult } from './sessions.ts';

/** Verifies an access JWT: 401 `unauthenticated` or `token_expired`. */
export { authenticate, type AuthContextOfRequest } from './tokens.ts';

/** 401 `invalid_refresh`, thrown by the route once a failed refresh has committed. */
export { invalidRefresh } from './errors.ts';

/** 401 `unauthenticated`, for a valid token whose user or wallet no longer exists. */
export { unauthenticated } from './errors.ts';
