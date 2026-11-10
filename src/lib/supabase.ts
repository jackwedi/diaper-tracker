import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

// Client serveur uniquement (clé service_role) — jamais exposé au navigateur.
export function supabase(): SupabaseClient {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY doivent être définis.");
  }
  // Ne garde que "https://xxxx.supabase.co" : une URL copiée avec "/rest/v1/"
  // donnerait "Invalid path specified in request URL".
  let origin: string;
  try {
    origin = new URL(url.trim()).origin;
  } catch {
    throw new Error(`SUPABASE_URL invalide : attendu https://xxxx.supabase.co`);
  }
  client = createClient(origin, key.trim(), { auth: { persistSession: false } });
  return client;
}
