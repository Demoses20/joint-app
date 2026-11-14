import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS = new Set(["https://myjointapp.com", "https://www.myjointapp.com"]);
const ADMIN_EMAIL = "technicaldemoses@gmail.com";
const cors = (origin: string | null, requestedHeaders: string | null = null) => ({
  "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://myjointapp.com",
  "Access-Control-Allow-Headers": requestedHeaders || "authorization, x-client-info, apikey, content-type, x-supabase-api-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
  Vary: "Origin, Access-Control-Request-Headers",
});
const json = (body: unknown, status = 200, origin: string | null = null) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(origin), "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin, req.headers.get("access-control-request-headers")) });
  if (req.method !== "POST") return json({ ok: false, error: "POST required." }, 405, origin);

  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  const secret = Deno.env.get("JOINT_PAYSTACK_SECRET_KEY") || Deno.env.get("PAYSTACK_SECRET_KEY");
  if (!url || !anon || !secret) return json({ ok: false, error: "Paystack balance-check configuration is incomplete." }, 503, origin);

  const token = (req.headers.get("Authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return json({ ok: false, error: "Sign in required." }, 401, origin);
  const userDb = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: auth, error: authError } = await userDb.auth.getUser(token);
  if (authError || !auth.user) return json({ ok: false, error: "Session expired. Sign in again." }, 401, origin);
  if ((auth.user.email || "").toLowerCase() !== ADMIN_EMAIL) return json({ ok: false, error: "Administrator permission required." }, 403, origin);

  try {
    const response = await fetch("https://api.paystack.co/balance", {
      method: "GET",
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(20000),
    });
    const payload: any = await response.json().catch(() => ({}));
    if (!response.ok || payload.status !== true) {
      const message = String(payload.message || `Paystack balance request failed (${response.status}).`).slice(0, 220);
      return json({ ok: false, error: message }, 502, origin);
    }
    const balances = Array.isArray(payload.data) ? payload.data
      .filter((item: any) => item && typeof item.currency === "string" && Number.isFinite(Number(item.balance)))
      .map((item: any) => ({ currency: String(item.currency).toUpperCase(), balance_subunits: Number(item.balance) })) : [];
    return json({ ok: true, balances, checked_at: new Date().toISOString(), message: "Paystack balance retrieved. This check does not initiate a transfer." }, 200, origin);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected Paystack balance-check error.";
    return json({ ok: false, error: message.slice(0, 220) }, 502, origin);
  }
});
