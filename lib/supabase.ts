import { createClient } from '@supabase/supabase-js';

// EXPO_PUBLIC_* vars are inlined at build time. The fallbacks cover production
// builds where the host (e.g. Vercel) hasn't set the env vars explicitly —
// these are anon/public keys, so hardcoding is safe.
const SUPABASE_URL =
  process.env.EXPO_PUBLIC_SUPABASE_URL ??
  'https://gmfjnzwmfcufgolptaoi.supabase.co';
const SUPABASE_ANON_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdtZmpuendtZmN1ZmdvbHB0YW9pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM5NTQwODUsImV4cCI6MjA4OTUzMDA4NX0.gX7Z_zH5nSkNW7WXeL6D9_g48cYvYwVZQYtWeR3MViI';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
