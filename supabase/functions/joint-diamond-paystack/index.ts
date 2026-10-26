import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const ALLOWED_ORIGINS = new Set(["https://myjointapp.com", "https://www.myjointapp.com"]);
const cors = (origin: string | null, requestedHeaders: string | null = null) => ({
  "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://myjointapp.com",
  "Access-Control-Allow-Headers": requestedHeaders || "authorization, x-client-info, apikey, content-type, x-supabase-api-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Max-Age": "86400", Vary: "Origin, Access-Control-Request-Headers",
});
const json = (body: unknown, status = 200, origin: string | null = null) => new Response(JSON.stringify(body), { status, headers: { ...cors(origin), "Content-Type": "application/json" } });
const text = (v: unknown, max = 200) => String(v ?? "").trim().slice(0, max);
const paystack = async (path: string, secret: string, method = "GET", body?: unknown) => {
  const response = await fetch(`https://api.paystack.co${path}`, { method, headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(25000) });
  const payload: any = await response.json().catch(() => ({}));
  if (!response.ok || payload.status === false) throw new Error(payload.message || `Paystack request failed (${response.status}).`);
  return payload;
};
Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin, req.headers.get("access-control-request-headers")) });
  if (req.method !== "POST") return json({ ok: false, error: "POST required." }, 405, origin);

  // Use the existing JOINT-prefixed custom secrets. Supabase reserves the SUPABASE_ prefix
  // for its own managed secrets, so do not try to create SUPABASE_SERVICE_ROLE_KEY manually.
  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  const service = Deno.env.get("JOINT_SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const secret = Deno.env.get("JOINT_PAYSTACK_SECRET_KEY") || Deno.env.get("PAYSTACK_SECRET_KEY");
  if (!url || !anon || !service || !secret) {
    console.error("joint-diamond-paystack configuration missing", { url: !!url, anon: !!anon, service: !!service, paystack: !!secret });
    return json({ ok: false, error: "Diamond Paystack checkout is not configured. Ask the JOINT administrator to check the server-side secret names and Supabase defaults." }, 503, origin);
  }

  const token = (req.headers.get("Authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return json({ ok: false, error: "Sign in to purchase Diamonds." }, 401, origin);
  const userDb = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: auth, error: authError } = await userDb.auth.getUser(token);
  if (authError || !auth.user) return json({ ok: false, error: "Your session expired. Sign in again." }, 401, origin);
  if (!auth.user.email) return json({ ok: false, error: "Add and verify an email address on your JOINT account before purchasing Diamonds." }, 400, origin);
  const db = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, error: "Invalid request body." }, 400, origin); }
  const action = text(body.action, 30);
  try {
    if (action === "initialize") {
      const amountMinor = Number(body.amount_minor);
      const currency = text(body.currency, 3).toUpperCase();
      if (!Number.isSafeInteger(amountMinor) || amountMinor < 10000 || amountMinor > 100000000000) return json({ ok: false, error: "Enter a purchase amount of at least 100 currency units and within the allowed limit." }, 400, origin);
      if (currency !== "NGN" && currency !== "USD") return json({ ok: false, error: "Choose NGN or USD." }, 400, origin);
      const { data: pricing, error: pricingError } = await db.from("joint_diamond_pricing_settings").select("diamonds_per_ngn,diamonds_per_usd,enabled").eq("id", "global").maybeSingle();
      if (pricingError) throw pricingError;
      const rate = Number(currency === "USD" ? pricing?.diamonds_per_usd : pricing?.diamonds_per_ngn);
      if (!pricing?.enabled || !Number.isFinite(rate) || rate <= 0) return json({ ok: false, error: "Diamond pricing is not enabled or its conversion rate is missing. Ask the JOINT administrator to configure Diamond pricing." }, 503, origin);
      const rawDiamonds = (amountMinor / 100) * rate;
      const diamonds = Math.floor((rawDiamonds + Number.EPSILON) * 10000) / 10000;
      if (!Number.isFinite(diamonds) || diamonds < 0.0001 || diamonds > 9999999999999999) return json({ ok: false, error: "This amount purchases less than 0.0001 Diamond at the current conversion rate. Increase the payment amount." }, 400, origin);
      const reference = `jwd_${crypto.randomUUID().replaceAll("-", "")}`;
      const { error: insertError } = await db.from("joint_diamond_paystack_purchases").insert({ user_id: auth.user.id, reference, amount_minor: amountMinor, currency, diamond_amount: diamonds, status: "pending" });
      if (insertError) throw insertError;
      try {
        const checkout = await paystack("/transaction/initialize", secret, "POST", {
          email: auth.user.email, amount: amountMinor, currency, reference,
          callback_url: `https://myjointapp.com/diamond-wallet.html?diamond_payment=1`,
          metadata: { purpose: "joint_diamond_wallet_topup", user_id: auth.user.id, diamonds, currency },
        });
        const { error: updateError } = await db.from("joint_diamond_paystack_purchases").update({ authorization_url: checkout.data.authorization_url, updated_at: new Date().toISOString() }).eq("reference", reference).eq("user_id", auth.user.id);
        if (updateError) throw updateError;
        return json({ ok: true, reference, authorization_url: checkout.data.authorization_url, amount_minor: amountMinor, currency, diamonds }, 200, origin);
      } catch (e) {
        await db.from("joint_diamond_paystack_purchases").update({ status: "failed", updated_at: new Date().toISOString() }).eq("reference", reference).eq("user_id", auth.user.id);
        throw e;
      }
    }
    if (action === "verify") {
      const reference = text(body.reference, 100);
      if (!/^jwd_[0-9a-f]{32}$/i.test(reference)) return json({ ok: false, error: "Invalid Diamond purchase reference." }, 400, origin);
      const { data: purchase, error: purchaseError } = await db.from("joint_diamond_paystack_purchases").select("user_id,reference,amount_minor,currency,diamond_amount,status,paystack_transaction_id").eq("reference", reference).eq("user_id", auth.user.id).maybeSingle();
      if (purchaseError) throw purchaseError;
      if (!purchase) return json({ ok: false, error: "This purchase reference does not belong to your account." }, 404, origin);
      if (purchase.status === "successful") {
        const { data: wallet } = await db.from("joint_diamond_wallets").select("balance").eq("user_id", auth.user.id).maybeSingle();
        return json({ ok: true, paid: true, already_credited: true, diamonds: purchase.diamond_amount, balance: wallet?.balance ?? null, reference }, 200, origin);
      }
      if (purchase.status !== "pending") return json({ ok: false, paid: false, error: "This purchase is not pending. If money was deducted, contact JOINT support with reference " + reference }, 409, origin);
      const verified = await paystack(`/transaction/verify/${encodeURIComponent(reference)}`, secret);
      const transaction = verified.data;
      if (transaction?.status !== "success") return json({ ok: false, paid: false, error: "Paystack has not confirmed a successful payment yet. Wait briefly and retry verification." }, 409, origin);
      if (Number(transaction.amount) !== Number(purchase.amount_minor) || String(transaction.currency).toUpperCase() !== purchase.currency || String(transaction.reference) !== reference) {
        await db.from("joint_diamond_paystack_purchases").update({ status: "failed", updated_at: new Date().toISOString() }).eq("reference", reference).eq("user_id", auth.user.id).eq("status", "pending");
        return json({ ok: false, paid: false, error: "The verified Paystack amount or currency did not match this purchase. Diamonds were not credited; contact JOINT support." }, 400, origin);
      }
      const { data: credited, error: creditError } = await db.rpc("joint_diamond_credit_paystack_purchase", { p_reference: reference, p_paystack_transaction_id: String(transaction.id ?? "") });
      if (creditError) throw creditError;
      if (!credited?.ok) throw new Error(credited?.error || "Payment verified but wallet credit could not be completed.");
      return json({ ok: true, paid: true, already_credited: !!credited.already_credited, diamonds: credited.diamonds, balance: credited.balance, reference }, 200, origin);
    }
    return json({ ok: false, error: "Unknown Diamond Paystack action." }, 400, origin);
  } catch (e) {
    console.error("joint-diamond-paystack", e instanceof Error ? e.message : e);
    return json({ ok: false, error: e instanceof Error ? e.message : "Unexpected Diamond purchase error." }, 500, origin);
  }
});
