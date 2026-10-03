import { createClient } from "@supabase/supabase-js";
import { createDemoClient } from "./demoSupabase";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// With keys in .env the real Supabase project is used. Without them the app
// runs on a built-in demo backend so it still opens on localhost.
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseKey);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseKey)
  : createDemoClient();
