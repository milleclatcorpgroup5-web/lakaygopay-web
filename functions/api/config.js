import { json } from "../_shared/superbase.js";

export async function onRequestGet({ env }) {
  const url = String(env.SUPABASE_URL || "").replace(/\/$/, "");
  const publishableKey = env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY || "";
  if (!url || !publishableKey) {
    return json({ configured: false, error: "SUPABASE_PUBLIC_CONFIG_MISSING" }, 503);
  }
  // Only publishable client configuration is exposed. SUPABASE_SECRET_KEY is
  // never returned by this endpoint.
  return json({ configured: true, supabaseUrl: url, publishableKey });
}
