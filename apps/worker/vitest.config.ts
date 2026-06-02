// Worker test harness — @cloudflare/vitest-pool-workers v0.16 (Vitest 4 API).
//
// NOTE (version): v0.16 dropped the old `defineWorkersConfig`/`@.../config`
// subpath. The current API is `cloudflareTest()` used as a top-level Vite
// PLUGIN (not `test.poolOptions`). Confirmed via the package's own
// vitest-v3-to-v4 codemod, which rewrites `poolOptions.workers` →
// `plugins:[cloudflareTest(...)]`.
import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';

export default defineConfig(async () => {
  // Read the SQL migrations at config time and hand them to the worker via a
  // binding so the setup file can apply them to the per-test D1 instance.
  const migrations = await readD1Migrations('./migrations');
  return {
    plugins: [
      cloudflareTest({
        main: './src/index.ts',
        wrangler: { configPath: './wrangler.toml' },
        miniflare: {
          // Secrets normally come from .dev.vars (gitignored) — inject test
          // values here so ensureSeed/login/JWT have what they need.
          bindings: {
            JWT_SECRET: 'test-jwt-secret-do-not-use-in-prod',
            SEED_ORGANIZER_EMAIL: 'seed@example.com',
            SEED_ORGANIZER_PASSWORD: 'seed-password-123',
            // Force the AI path to its deterministic FALLBACK in tests (overrides
            // any OPENROUTER_API_KEY that wrangler loads from .dev.vars). Keeps the
            // route tests fast + flake-free; the live AI path is verified manually.
            OPENROUTER_API_KEY: '',
            TEST_MIGRATIONS: migrations,
          },
        },
      }),
    ],
    test: {
      setupFiles: ['./test/apply-migrations.ts'],
    },
  };
});
