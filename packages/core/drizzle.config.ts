import { defineConfig } from 'drizzle-kit';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');

// Generate SQL with `db:generate`, review and commit it, apply with `db:migrate`.
// `drizzle-kit push` is not used in this repo.
export default defineConfig({
  dialect: 'postgresql',
  casing: 'snake_case',
  schema: './src/modules/*/schema.ts',
  out: './migrations',
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
