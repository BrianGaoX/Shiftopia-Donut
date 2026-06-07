import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react-swc';
import path from 'path';

export default defineConfig({
    plugins: [react()],
    test: {
        environment: 'jsdom',
        globals:     true,
        setupFiles:  ['./src/test/setup.ts'],
        // Dummy Supabase creds so modules that import the realtime client
        // (which fail-fast on missing env vars) load under test/CI without
        // a real .env. Vitest exposes these on both process.env and
        // import.meta.env. No network calls are made — the client is mocked.
        env: {
            VITE_SUPABASE_URL:      'http://localhost:54321',
            VITE_SUPABASE_ANON_KEY: 'test-anon-key',
        },
        include:     ['src/**/*.{test,spec}.{ts,tsx}'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'lcov'],
            include:  ['src/**/*.{ts,tsx}'],
            exclude:  ['src/test/**', 'src/**/*.d.ts', 'src/main.tsx'],
        },
    },
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
});
