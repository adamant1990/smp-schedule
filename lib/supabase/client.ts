import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    throw new Error("Не заданы NEXT_PUBLIC_SUPABASE_URL и NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  }

  return createBrowserClient(url, key);
}
