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
  const { data, error } = await db.from("joint_ai_point_settings").select("id,points_per_ai_start,price_per_point_minor,currency,is_enabled").eq("id", true).maybeSingle();
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
        if (pointsPerAction === null || price === null || !CURRENCIES.has(currency) || typeof body.is_enabled !== "boolean") return json({ ok: false, error: "Enter a valid point cost, non-negative point price, supported Paystack currency and AI availability setting." }, 400, origin);
        const { data, error } = await db.from("joint_ai_point_settings").upsert({ id: true, points_per_ai_start: pointsPerAction, price_per_point_minor: price, currency, is_enabled: body.is_enabled, updated_at: new Date().toISOString() }, { onConflict: "id" }).select("id,points_per_ai_start,price_per_point_minor,currency,is_enabled").single();
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
      return json({ ok: true, settings }, 200, origin);
    }

    if (action === "set_active") {
      if (typeof body.is_active !== "boolean") return json({ ok: false, error: "Choose whether AI Points should be active." }, 400, origin);
      await ensureWallet(db, ownerId);
      const { data, error } = await db.from("joint_ai_point_wallets").update({ is_active: body.is_active, updated_at: new Date().toISOString() }).eq("owner_id", ownerId).select("owner_id,balance,is_active").single();
      if (error) throw error;
      return json({ ok: true, wallet: data }, 200, origin);
    }

    if (action === "initialize") {
      const points = safeNum(body.points, 1, 100000);
      if (points === null) return json({ ok: false, error: "Choose a whole-number amount from 1 to 100,000 AI Points." }, 400, origin);
      const settings = await getSettings(db);
      if (!settings.is_enabled) return json({ ok: false, error: "AI Points purchases and AI services are temporarily disabled by the JOINT main administrator." }, 403, origin);
      const price = safeNum(settings.price_per_point_minor, 0, 1000000000);
      const currency = text(settings.currency, 3).toUpperCase();
      if (price === null || price < 1 || !CURRENCIES.has(currency)) return json({ ok: false, error: "AI Points pricing has not been configured. Contact the JOINT main administrator." }, 503, origin);
      const amount = points * price;
      if (!Number.isSafeInteger(amount) || amount < 1 || amount > 1000000000) return json({ ok: false, error: "The purchase amount is outside the permitted limit." }, 400, origin);
      const paystackSecret = Deno.env.get("JOINT_PAYSTACK_SECRET_KEY") || Deno.env.get("PAYSTACK_SECRET_KEY");
      if (!paystackSecret) return json({ ok: false, error: "Paystack is not configured on the server. No payment was taken." }, 503, origin);
      const reference = `JAI_${crypto.randomUUID().replaceAll("-", "")}`;
      const { error: insertError } = await db.from("joint_ai_point_purchases").insert({ owner_id: ownerId, user_id: auth.user.id, school_name: school.school_name || null, reference, points, amount_minor: amount, currency, status: "pending" });
      if (insertError) throw insertError;
      try {
        const result = await paystackRequest("/transaction/initialize", "POST", paystackSecret, {
          email: auth.user.email, amount, currency, reference,
          callback_url: "https://myjointapp.com/school-ai-tools.html?payment_return=1",
          metadata: { purpose: "joint_ai_points", owner_id: ownerId, user_id: auth.user.id, points, school_name: school.school_name || "JOINT school" }
        });
        const authorizationUrl = text(result?.data?.authorization_url, 2000);
        if (!authorizationUrl) throw new Error("Paystack did not return a checkout URL.");
        await db.from("joint_ai_point_purchases").update({ authorization_url: authorizationUrl, updated_at: new Date().toISOString() }).eq("reference", reference);
        return json({ ok: true, reference, authorization_url: authorizationUrl, points, amount_minor: amount, currency }, 200, origin);
      } catch (e) {
        await db.from("joint_ai_point_purchases").update({ status: "failed", updated_at: new Date().toISOString() }).eq("reference", reference);
        throw e;
      }
    }

    if (action === "verify") {
      const reference = text(body.reference, 120);
      if (!reference) return json({ ok: false, error: "Paystack reference is required." }, 400, origin);
      const { data: purchase, error: purchaseError } = await db.from("joint_ai_point_purchases").select("*").eq("reference", reference).eq("owner_id", ownerId).eq("user_id", auth.user.id).maybeSingle();
      if (purchaseError) throw purchaseError;
      if (!purchase) return json({ ok: false, paid: false, error: "This AI Points purchase does not belong to your signed-in workspace." }, 403, origin);
      if (purchase.status === "paid") {
        const wallet = await ensureWallet(db, ownerId);
        return json({ ok: true, paid: true, duplicate: true, balance: wallet.balance, points: purchase.points }, 200, origin);
      }
      const paystackSecret = Deno.env.get("JOINT_PAYSTACK_SECRET_KEY") || Deno.env.get("PAYSTACK_SECRET_KEY");
      if (!paystackSecret) return json({ ok: false, paid: false, error: "Paystack is not configured on the server." }, 503, origin);
      const verified = await paystackRequest(`/transaction/verify/${encodeURIComponent(reference)}`, "GET", paystackSecret);
      const tx = verified?.data || {};
      if (tx.status !== "success") return json({ ok: false, paid: false, error: "Paystack has not confirmed this payment yet." }, 402, origin);
      if (Number(tx.amount) !== Number(purchase.amount_minor) || String(tx.currency || "").toUpperCase() !== String(purchase.currency).toUpperCase() || String(tx.reference) !== reference) {
        return json({ ok: false, paid: false, error: "The verified Paystack amount, currency or reference does not match this purchase." }, 409, origin);
      }
      const metadata = tx.metadata || {};
      if (metadata.owner_id && String(metadata.owner_id) !== ownerId) return json({ ok: false, paid: false, error: "Payment workspace verification failed." }, 403, origin);
      const { data: credited, error: creditError } = await db.rpc("joint_credit_ai_points_purchase", {
        p_owner_id: ownerId, p_actor_user_id: auth.user.id, p_points: purchase.points,
        p_amount_minor: purchase.amount_minor, p_currency: purchase.currency, p_reference: reference,
        p_description: `Paystack AI Points purchase (${purchase.points} points)`
      });
      if (creditError) {
        console.error("AI Points credit RPC failed", JSON.stringify({ code: creditError.code, message: creditError.message, details: creditError.details, hint: creditError.hint }));
        throw new Error(`Payment was confirmed by Paystack, but wallet crediting failed (${creditError.code || "database_error"}). Keep this reference and retry verification; do not pay again.`);
      }
      if (!credited?.ok) throw new Error(`Payment was confirmed by Paystack, but wallet crediting was not completed (${text(credited?.error || "credit_failed", 120)}). Retry verification; do not pay again.`);
      const { error: updateError } = await db.from("joint_ai_point_purchases").update({ status: "paid", paid_at: new Date().toISOString(), paystack_transaction_id: String(tx.id || ""), updated_at: new Date().toISOString() }).eq("reference", reference).eq("owner_id", ownerId);
      if (updateError) {
        console.error("AI Points purchase status update failed", updateError.message);
        // The atomic ledger entry is idempotent by Paystack reference. A retry will
        // detect the ledger credit and safely finish marking the purchase as paid.
        throw new Error("Points credit was recorded, but purchase status could not be refreshed. Reload this page to reconcile the payment.");
      }
      return json({ ok: true, paid: true, duplicate: !!credited.duplicate, balance: credited.balance, points: purchase.points, currency: purchase.currency }, 200, origin);
    }
    return json({ ok: false, error: "Unknown AI Points action." }, 400, origin);
  } catch (e) {
    console.error("joint-ai-points failed", e instanceof Error ? e.message : e);
    return json({ ok: false, error: e instanceof Error ? e.message : "Unexpected AI Points error." }, 500, origin);
  }
});
