import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";

// Metro statically replaces process.env.EXPO_PUBLIC_* references at bundle time.
// Always read them with direct dot-notation (never process.env[dynamicKey]).
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY in .env"
  );
}

// Guard against Node SSR execution (e.g. Expo Router getServerManifest during Release bundling)
// where global `window` is undefined and AsyncStorage's web implementation throws.
const isNodeSsr = typeof window === "undefined";

// Unlike web browsers, React Native has no window.localStorage or URL bar,
// so we wire AsyncStorage for persistence and disable URL session detection.
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: isNodeSsr ? undefined : AsyncStorage,
    autoRefreshToken: !isNodeSsr,
    persistSession: !isNodeSsr,
    detectSessionInUrl: false,
  },
});
