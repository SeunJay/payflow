import bcrypt from 'bcryptjs';

export type AuthConfig = {
  readonly jwtSecret: string;
  readonly accessTtlSeconds: number;
  readonly refreshTtlSeconds: number;
  readonly bcryptCost: number;
};

export type AuthContext = AuthConfig & {
  /** Compared against on log in with an unknown email, so both failure paths cost one hash. */
  readonly dummyHash: string;
};

export async function createAuthContext(config: AuthConfig): Promise<AuthContext> {
  const dummyHash = await bcrypt.hash('payflow-dummy-password', config.bcryptCost);
  return Object.freeze({ ...config, dummyHash });
}
