import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import path from 'path';
import { componentTagger } from 'lovable-tagger';
import { visualizer } from 'rollup-plugin-visualizer';
import viteCompression from 'vite-plugin-compression';
import webfontDl from 'vite-plugin-webfont-dl';
import { sentryVitePlugin } from '@sentry/vite-plugin';

export default defineConfig(({ mode }) => ({
  server: {
    host: '::',
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    react(),
    mode === 'development' && componentTagger(),
    mode !== 'production' && visualizer({
      filename: './dist/stats.html',
      open: false,
      gzipSize: true,
      brotliSize: true,
    }),
    viteCompression({
      algorithm: 'gzip',
      ext: '.gz',
    }),
    viteCompression({
      algorithm: 'brotliCompress',
      ext: '.br',
    }),
    webfontDl(),
    // Source-map upload runs only when SENTRY_AUTH_TOKEN is present (i.e. in CI
    // for prod builds). Local prod builds without the token still produce
    // source maps but skip the upload, so they never fail the build.
    mode === 'production' && process.env.SENTRY_AUTH_TOKEN && sentryVitePlugin({
      authToken: process.env.SENTRY_AUTH_TOKEN,
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      release: { name: process.env.VITE_SENTRY_RELEASE },
      sourcemaps: { filesToDeleteAfterUpload: ['./dist/**/*.map'] },
    }),
  ].filter(Boolean),
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@modules': path.resolve(__dirname, './src/modules'),
      '@platform': path.resolve(__dirname, './src/platform'),
      '@design-system': path.resolve(__dirname, './src/design-system'),
    },
  },
  optimizeDeps: {
    include: ['framer-motion', 'lucide-react', '@radix-ui/react-dialog', 'dompurify'],
  },
  ...(mode === 'production' && {
    esbuild: {
      drop: ['console', 'debugger'],
    },
  }),
  build: {
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-data': ['@tanstack/react-query', 'zustand'],
          'vendor-dnd': ['react-dnd', 'react-dnd-html5-backend'],
          'vendor-ui': [
            '@radix-ui/react-accordion',
            '@radix-ui/react-alert-dialog',
            '@radix-ui/react-avatar',
            '@radix-ui/react-checkbox',
            '@radix-ui/react-dialog',
            '@radix-ui/react-dropdown-menu',
            '@radix-ui/react-popover',
            '@radix-ui/react-select',
            '@radix-ui/react-tabs',
            '@radix-ui/react-tooltip',
          ],
          'vendor-charts': ['recharts'],
          'vendor-animations': ['framer-motion'],
          'vendor-utils': ['date-fns', 'lucide-react', 'clsx', 'tailwind-merge'],
          'vendor-supabase': ['@supabase/supabase-js'],
        },
      },
    },
    commonjsOptions: {
      transformMixedEsModules: true,
    },
  },
}));
