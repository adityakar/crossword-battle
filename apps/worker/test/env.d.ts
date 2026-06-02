/// <reference types="@cloudflare/vitest-pool-workers/types" />

import type { D1Migration } from '@cloudflare/vitest-pool-workers';
import type { Env } from '../src/index';

// `cloudflare:test` exposes `env` typed as `Cloudflare.Env`. Augment that global
// namespace so `env.DB` etc. resolve to our worker Env, plus the test-only
// migrations binding injected by vitest.config.ts.
declare global {
  namespace Cloudflare {
    interface Env extends EnvShape {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

// Indirection so the imported `Env` is referenced (verbatimModuleSyntax-friendly).
type EnvShape = Env;
