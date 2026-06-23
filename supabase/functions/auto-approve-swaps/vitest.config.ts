// =============================================================================
// Colocated vitest config for the PURE auto-approve-swaps modules.
//
// The project root vitest.config.ts only includes `src/**`, so it will not pick
// up these tests. Run them explicitly with:
//
//     npx vitest run --config supabase/functions/auto-approve-swaps/vitest.config.ts
//
// `root: __dirname` keeps the test glob scoped here and `node` environment +
// no setup files mean we don't drag in jsdom / react / the Supabase test client.
// The modules under test are pure TS (eligibility.ts, decision-matrix.ts) and
// import only `./types.ts`, so this loads with zero Deno/DB globals.
// =============================================================================

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    root: __dirname,
    environment: 'node',
    globals: true,
    include: ['__tests__/**/*.test.ts'],
  },
});
