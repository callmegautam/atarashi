import { defineConfig } from 'drizzle-kit';
import env from './src/config/env';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',

  dbCredentials: {
    url: env.DB_URL,
  },

  migrations: {
    table: '__migrations',
  },
});
