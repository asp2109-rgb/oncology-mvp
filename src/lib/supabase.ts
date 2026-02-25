import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

type ResolvedValue = {
  value: string;
  source: string | null;
};

function firstPresent(candidates: Array<{ source: string; value: string | undefined }>): ResolvedValue {
  for (const candidate of candidates) {
    const trimmed = candidate.value?.trim() ?? "";
    if (trimmed) {
      return {
        value: trimmed,
        source: candidate.source,
      };
    }
  }

  return {
    value: "",
    source: null,
  };
}

function resolveSupabaseUrlRaw(): ResolvedValue {
  const direct = firstPresent([
    { source: "SUPABASE_URL", value: process.env.SUPABASE_URL },
    { source: "NEXT_PUBLIC_SUPABASE_URL", value: process.env.NEXT_PUBLIC_SUPABASE_URL },
    { source: "SUPABASE_PROJECT_URL", value: process.env.SUPABASE_PROJECT_URL },
    { source: "NEXT_PUBLIC_SUPABASE_PROJECT_URL", value: process.env.NEXT_PUBLIC_SUPABASE_PROJECT_URL },
  ]);
  if (direct.value) {
    return direct;
  }

  const ref = firstPresent([
    { source: "SUPABASE_PROJECT_REF", value: process.env.SUPABASE_PROJECT_REF },
    { source: "NEXT_PUBLIC_SUPABASE_PROJECT_REF", value: process.env.NEXT_PUBLIC_SUPABASE_PROJECT_REF },
  ]);

  if (!ref.value) {
    return {
      value: "",
      source: null,
    };
  }

  return {
    value: `https://${ref.value}.supabase.co`,
    source: ref.source,
  };
}

function resolveSupabaseUrl(): string {
  return resolveSupabaseUrlRaw().value;
}

function resolveSupabaseKeyRaw(): ResolvedValue {
  return firstPresent([
    { source: "SUPABASE_SERVICE_ROLE_KEY", value: process.env.SUPABASE_SERVICE_ROLE_KEY },
    { source: "SUPABASE_ANON_KEY", value: process.env.SUPABASE_ANON_KEY },
    { source: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", value: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY },
    { source: "NEXT_PUBLIC_SUPABASE_ANON_KEY", value: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY },
  ]);
}

function resolveSupabaseKey(): string {
  return resolveSupabaseKeyRaw().value;
}

export function getSupabaseConfigState(): {
  url_present: boolean;
  key_present: boolean;
  url_source: string | null;
  key_source: string | null;
} {
  const url = resolveSupabaseUrlRaw();
  const key = resolveSupabaseKeyRaw();

  return {
    url_present: Boolean(url.value),
    key_present: Boolean(key.value),
    url_source: url.source,
    key_source: key.source,
  };
}

export function getSupabaseClient(): SupabaseClient {
  if (cached) {
    return cached;
  }

  const url = resolveSupabaseUrl();
  const key = resolveSupabaseKey();

  if (!url || !key) {
    throw new Error(
      "Supabase не настроен: укажите SUPABASE_URL (или NEXT_PUBLIC_SUPABASE_URL) и SUPABASE_SERVICE_ROLE_KEY/ANON ключ.",
    );
  }

  cached = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    db: {
      schema: "public",
    },
    global: {
      headers: {
        "X-Client-Info": "oncology-mvp-supabase/1",
      },
    },
  });

  return cached;
}

export function isSupabaseConfigured(): boolean {
  try {
    const state = getSupabaseConfigState();
    return state.url_present && state.key_present;
  } catch {
    return false;
  }
}
