import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Fail-fast: Crash immediately if required env vars are missing
if (!SUPABASE_URL || SUPABASE_URL.trim() === '') {
  throw new Error(
    '[FATAL] Missing required environment variable: VITE_SUPABASE_URL\n' +
    'Please check your .env file. See .env.example for required variables.'
  );
}

if (!SUPABASE_PUBLISHABLE_KEY || SUPABASE_PUBLISHABLE_KEY.trim() === '') {
  throw new Error(
    '[FATAL] Missing required environment variable: VITE_SUPABASE_ANON_KEY\n' +
    'Please check your .env file. See .env.example for required variables.'
  );
}

export const supabase = createClient<Database>(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      storageKey: 'icc-workforce-auth-token',
    },
    global: {
      // Fixes the spread argument error by using explicit parameters
      fetch: (url, options) => {
        return fetch(url, options).catch((err) => {
          throw err;
        });
      },
    },
  }
);
