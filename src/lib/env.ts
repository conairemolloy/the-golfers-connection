import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  // The magic-link redirect target (sendMagicLink, src/lib/auth.ts) must be
  // an absolute URL, and Supabase requires it to match an allow-listed
  // "Redirect URL" in the dashboard. A fixed env var per deploy target is
  // simpler and safer than deriving the origin from request headers
  // (trusting Host/X-Forwarded-Host for an auth redirect is an open-redirect
  // risk) — set to http://localhost:3000 in dev, the real domain later.
  NEXT_PUBLIC_SITE_URL: z.string().url(),
});

export const env = envSchema.parse({
  DATABASE_URL: process.env.DATABASE_URL,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
});
