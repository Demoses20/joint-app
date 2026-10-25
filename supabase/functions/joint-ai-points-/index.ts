import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const ADMIN_EMAIL = "technicaldemoses@gmail.com";
const ALLOWED_ORIGINS = new Set(["https://myjointapp.com", "https://www.myjointapp.com"]);
const CURRENCIES = new Set(["NGN", "GHS", "ZAR", "KES", "USD"]);
const cors = (origin: string | null, requestedHeaders: string | null = null) => ({
  "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://myjointapp.com",
  // Supabase JS versions can add client/version headers. Reflect the browser's
  // preflight request header list so valid requests are not blocked by CORS.
  "Access-Control-Allow-Headers": requestedHeaders || "authorization, x-client-info, apikey, content-type, x-supabase-api-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
  Vary: "Origin, Access-Control-Request-Headers",
});
const json = (body: unknown, status = 200, origin: string | null = null) => new Response(JSON.stringify(body), { status, headers: { ...cors(origin), "Content-Type": "application/json" } });
const text = (v: unknown, max = 200) => String(v ?? "").trim().slice(0, max);
const safeNum = (v: unknown, min: number, max: number) => Number.isSafeInteger(Number(v)) && Number(v) >= min && Number(v) <= max ? Number(v) : null;
const getSettings = async (db: any) => {
  const { data, error } = await db.from("joint_ai_point_settings").select("id,points_per_ai_start,price_per_point_minor,currency,is_enabled,text_words_per_point,points_per_image,voice_seconds_per_point,video_frames_per_point,voice_note_seconds_per_point").eq("id", true).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("AI Points pricing is not configured. Ask the JOINT main administrator to save the pricing settings.");
  return data;
};
const ensureWallet = async (db: any, ownerId: string) => {
  const { data: existing, error } = await db.from("joint_ai_point_wallets").select("owner_id,balance,lifetime_purchased,lifetime_spent,is_active").eq("owner_id", ownerId).maybeSingle();
  if (error) throw error;
  if (existing) return existing;
  const { data, error: insertError } = await db.from("joint_ai_point_wallets").insert({ owner_id: ownerId, balance: 0, lifetime_purchased: 0, lifetime_spent: 0, auto_renew_points: 1, auto_renew_threshold: 0, is_active: true }).select("owner_id,balance,lifetime_purchased,lifetime_spent,is_active").single();
  if (!insertError) return data;
  const { data: retry, error: retryError } = await db.from("joint_ai_point_wallets").select("owner_id,balance,lifetime_purchased,lifetime_spent,is_active").eq("owner_id", ownerId).maybeSingle();
  if (retryError || !retry) throw insertError;
  return retry;
};
const paystackRequest = async (path: string, method: string, secret: string, body?: unknown) => {
  const res = await fetch(`https://api.paystack.co${path}`, { method, headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(25000) });
  const payload: any = await res.json().catch(() => ({}));
  if (!res.ok || payload.status === false) throw new Error(payload.message || `Paystack request failed (${res.status}).`);
  return payload;
};
Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin, req.headers.get("access-control-request-headers")) });
  if (req.method !== "POST") return json({ ok: false, error: "POST required." }, 405, origin);
  const url = Deno.env.get("SUPABASE_URL"), anon = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY"), service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !service) return json({ ok: false, error: "AI Points service is not configured." }, 500, origin);
  const token = (req.headers.get("Authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return json({ ok: false, error: "Sign in to manage AI Points." }, 401, origin);
  const userDb = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: auth, error: authError } = await userDb.auth.getUser(token);
  if (authError || !auth.user) return json({ ok: false, error: "Your session expired. Sign in again." }, 401, origin);
  const db = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, error: "Invalid request body." }, 400, origin); }
  const action = text(body.action, 40);
  const isMainAdmin = String(auth.user.email || "").toLowerCase() === ADMIN_EMAIL;
  try {
    if (action.startsWith("admin_")) {
      if (!isMainAdmin) return json({ ok: false, error: "Only the JOINT main administrator can manage AI Points pricing." }, 403, origin);
      if (action === "admin_get") {
        const settings = await getSettings(db);
        const { data: purchases, error: purchaseError } = await db.from("joint_ai_point_purchases").select("owner_id,user_id,school_name,reference,points,amount_minor,currency,status,created_at,paid_at").order("created_at", { ascending: false }).limit(100);
        if (purchaseError) throw purchaseError;
        const { data: wallets, error: walletError } = await db.from("joint_ai_point_wallets").select("owner_id,balance,lifetime_purchased,lifetime_spent,is_active,updated_at").order("updated_at", { ascending: false }).limit(100);
        if (walletError) throw walletError;
        return json({ ok: true, settings, purchases: purchases || [], wallets: wallets || [] }, 200, origin);
      }
      if (action === "admin_save") {
        const pointsPerAction = safeNum(body.points_per_ai_start, 1, 10000);
        const price = safeNum(body.price_per_point_minor, 0, 1000000000);
        const currency = text(body.currency, 3).toUpperCase();
        const wordsPerPoint = safeNum(body.text_words_per_point, 1, 1000000);
        const pointsPerImage = safeNum(body.points_per_image, 0, 1000000);
        const voiceSecondsPerPoint = safeNum(body.voice_seconds_per_point, 1, 86400);
        const videoFramesPerPoint = safeNum(body.video_frames_per_point, 1, 1000000);
        const voiceNoteSecondsPerPoint = safeNum(body.voice_note_seconds_per_point, 1, 86400);
        if (pointsPerAction === null || price === null || !CURRENCIES.has(currency) || typeof body.is_enabled !== "boolean" || wordsPerPoint === null || pointsPerImage === null || voiceSecondsPerPoint === null || videoFramesPerPoint === null || voiceNoteSecondsPerPoint === null) return json({ ok: false, error: "Enter valid AI point rates, a non-negative point price, a supported Paystack currency and an AI availability setting." }, 400, origin);
        const { data, error } = await db.from("joint_ai_point_settings").upsert({ id: true, points_per_ai_start: pointsPerAction, price_per_point_minor: price, currency, is_enabled: body.is_enabled, text_words_per_point: wordsPerPoint, points_per_image: pointsPerImage, voice_seconds_per_point: voiceSecondsPerPoint, video_frames_per_point: videoFramesPerPoint, voice_note_seconds_per_point: voiceNoteSecondsPerPoint, updated_at: new Date().toISOString() }, { onConflict: "id" }).select("id,points_per_ai_start,price_per_point_minor,currency,is_enabled,text_words_per_point,points_per_image,voice_seconds_per_point,video_frames_per_point,voice_note_seconds_per_point").single();
        if (error) throw error;
        return json({ ok: true, settings: data }, 200, origin);
      }
      return json({ ok: false, error: "Unknown administrator action." }, 400, origin);
    }

    const { data: school, error: schoolError } = await db.from("joint_school_host_applications")
      .select("owner_id,school_name,status").eq("owner_id", auth.user.id).eq("status", "approved").order("updated_at", { ascending: false }).limit(1).maybeSingle();
    if (schoolError) throw schoolError;
    if (!school) return json({ ok: false, error: "An approved school/institute workspace is required to manage its AI Points wallet." }, 403, origin);
    const ownerId = String(school.owner_id);

    if (action === "wallet_get") {
      const wallet = await ensureWallet(db, ownerId);
      return json({ ok: true, wallet }, 200, origin);
    }
    if (action === "settings_get") {
      const settings = await getSettings(db);
      const { data: diamondPricing, error: diamondPricingError } = await db.from("joint_diamond_pricing_settings").select("diamonds_per_ngn,diamonds_per_usd,enabled").eq("id", "global").maybeSingle();
      if (diamondPricingError) throw diamondPricingError;
      return json({ ok: true, settings: { ...settings, diamondPricing: diamondPricing || { diamonds_per_ngn: 0, diamonds_per_usd: 0, enabled: false } } }, 200, origin);
    }

    if (action === "set_active") {
      if (typeof body.is_active !== "boolean") return json({ ok: false, error: "Choose whether AI Points should be active." }, 400, origin);
      await ensureWallet(db, ownerId);
      const { data, error } = await db.from("joint_ai_point_wallets").update({ is_active: body.is_active, updated_at: new Date().toISOString() }).eq("owner_id", ownerId).select("owner_id,balance,is_active").single();
      if (error) throw error;
      return json({ ok: true, wallet: data }, 200, origin);
    }

    if (action === "purchase_diamonds") {
      const points = safeNum(body.points, 1, 100000);
      const pin = text(body.pin, 6);
      const idempotencyKey = text(body.idempotency_key, 100);
      if (points === null) return json({ ok: false, error: "Choose a whole-number amount from 1 to 100,000 AI Points." }, 400, origin);
      if (!/^[0-9]{6}$/.test(pin)) return json({ ok: false, error: "Enter your six-digit Diamond Wallet PIN." }, 400, origin);
      if (!/^[0-9a-f-]{36}$/i.test(idempotencyKey)) return json({ ok: false, error: "Invalid purchase request. Please try again." }, 400, origin);
      const settings = await getSettings(db);
      if (!settings.is_enabled) return json({ ok: false, error: "AI Points purchases are temporarily disabled by the JOINT main administrator." }, 403, origin);
      const pointPriceMinor = safeNum(settings.price_per_point_minor, 1, 1000000000);
      const currency = text(settings.currency, 3).toUpperCase();
      if (pointPriceMinor === null) return json({ ok: false, error: "AI Points pricing has not been configured. Contact the JOINT main administrator." }, 503, origin);
      if (currency !== "NGN" && currency !== "USD") return json({ ok: false, error: "Diamond-funded AI Points purchases currently support NGN and USD pricing only. Ask the JOINT administrator to set a supported currency." }, 400, origin);
      const { data: pricing, error: pricingError } = await db.from("joint_diamond_pricing_settings").select("diamonds_per_ngn,diamonds_per_usd,enabled").eq("id", "global").maybeSingle();
      if (pricingError) throw pricingError;
      const rate = Number(currency === "USD" ? pricing?.diamonds_per_usd : pricing?.diamonds_per_ngn);
      if (!pricing?.enabled || !Number.isFinite(rate) || rate <= 0) return json({ ok: false, error: "Diamond payments are not enabled or the conversion rate is missing. Ask the JOINT main administrator to configure Diamond pricing." }, 503, origin);
      const amountMinor = points * pointPriceMinor;
      if (!Number.isSafeInteger(amountMinor) || amountMinor < 1 || amountMinor > 100000000000) return json({ ok: false, error: "The AI Points purchase amount is outside the permitted limit." }, 400, origin);
      const diamonds = Math.ceil((amountMinor / 100) * rate);
      if (!Number.isSafeInteger(diamonds) || diamonds < 1 || diamonds > 9007199254740991) return json({ ok: false, error: "The Diamond cost is outside the permitted limit." }, 400, origin);
      const { data: result, error: purchaseError } = await db.rpc("joint_diamond_purchase_ai_points", {
        p_user_id: auth.user.id, p_owner_id: ownerId, p_school_name: school.school_name || null,
        p_points: points, p_amount_minor: amountMinor, p_currency: currency, p_diamonds: diamonds,
        p_pin: pin, p_idempotency_key: idempotencyKey
      });
      if (purchaseError) throw new Error(purchaseError.message || "Could not complete the Diamond AI Points purchase.");
      if (!result?.ok) throw new Error(text(result?.error || "AI Points purchase was not completed.", 200));
      return json({ ok: true, points: result.points || points, diamonds: result.diamonds || diamonds, balance: result.balance, reference: result.reference, ai_points_balance: result.ai_points_balance }, 200, origin);
    }

    if (action === "initialize" || action === "verify") {
      return json({ ok: false, error: "AI Points purchases must use the JOINT Diamond Wallet. Paystack is reserved for purchasing Diamonds in your wallet." }, 410, origin);
    }



    return json({ ok: false, error: "Unknown AI Points action." }, 400, origin);
  } catch (e) {
    console.error("joint-ai-points failed", e instanceof Error ? e.message : e);
    return json({ ok: false, error: e instanceof Error ? e.message : "Unexpected AI Points error." }, 500, origin);
  }
});
