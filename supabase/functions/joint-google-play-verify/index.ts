import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS = new Set([
  "https://myjointapp.com",
  "https://www.myjointapp.com",
]);
const PRODUCT_DIAMONDS: Record<string, number> = {
  joint_diamonds_5: 5,
  joint_diamonds_10: 10,
  joint_diamonds_25: 25,
  joint_diamonds_50: 50,
  joint_diamonds_100: 100,
  joint_diamonds_250: 250,
  joint_diamonds_500: 500,
  joint_diamonds_750: 750,
  joint_diamonds_1000: 1000,
};
const ANDROID_PUBLISHER_SCOPE = "https://www.googleapis.com/auth/androidpublisher";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API_BASE = "https://androidpublisher.googleapis.com/androidpublisher/v3";

const cors = (origin: string | null, requestedHeaders: string | null = null) => ({
  "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.has(origin)
    ? origin
    : "https://myjointapp.com",
  "Access-Control-Allow-Headers": requestedHeaders ||
    "authorization, x-client-info, apikey, content-type, x-supabase-api-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
  Vary: "Origin, Access-Control-Request-Headers",
});

const json = (body: unknown, status = 200, origin: string | null = null) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(origin), "Content-Type": "application/json" },
  });

const text = (value: unknown, max = 5000) =>
  String(value ?? "").trim().slice(0, max);

function base64Url(value: string | Uint8Array): string {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function pemToBytes(pem: string): Uint8Array {
  const clean = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

let cachedGoogleToken: { value: string; expiresAt: number } | null = null;

async function googleAccessToken(serviceAccountJson: string): Promise<string> {
  if (cachedGoogleToken && cachedGoogleToken.expiresAt > Date.now() + 60_000) {
    return cachedGoogleToken.value;
  }

  const account = JSON.parse(serviceAccountJson);
  const clientEmail = text(account.client_email, 320);
  const privateKeyPem = text(account.private_key, 12000);
  const tokenUri = text(account.token_uri, 500) || TOKEN_URL;
  if (!clientEmail || !privateKeyPem || !tokenUri.startsWith("https://oauth2.googleapis.com/")) {
    throw new Error("Google Play service-account configuration is invalid.");
  }

  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64Url(JSON.stringify({
    iss: clientEmail,
    scope: ANDROID_PUBLISHER_SCOPE,
    aud: tokenUri,
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = `${header}.${claim}`;
  const signingKey = await crypto.subtle.importKey(
    "pkcs8",
    pemToBytes(privateKeyPem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    signingKey,
    new TextEncoder().encode(unsigned),
  );
  const assertion = `${unsigned}.${base64Url(new Uint8Array(signature))}`;
  const response = await fetch(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
    signal: AbortSignal.timeout(20000),
  });
  const payload: any = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    console.error("Google OAuth token exchange failed", response.status, payload.error || "unknown_error");
    throw new Error("Could not authenticate with Google Play. Check the service-account setup.");
  }
  const expiresIn = Math.max(60, Number(payload.expires_in) || 3600);
  cachedGoogleToken = {
    value: String(payload.access_token),
    expiresAt: Date.now() + expiresIn * 1000,
  };
  return cachedGoogleToken.value;
}

async function googleApi(
  path: string,
  accessToken: string,
  method = "GET",
): Promise<{ ok: boolean; status: number; data: any }> {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    signal: AbortSignal.timeout(25000),
  });
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, data };
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: cors(origin, req.headers.get("access-control-request-headers")),
    });
  }
  if (req.method !== "POST") return json({ ok: false, error: "POST required." }, 405, origin);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  const serviceKey = Deno.env.get("JOINT_SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const serviceAccountJson = Deno.env.get("GOOGLE_PLAY_SERVICE_ACCOUNT_JSON");
  const packageName = Deno.env.get("GOOGLE_PLAY_PACKAGE_NAME");
  if (!supabaseUrl || !anonKey || !serviceKey || !serviceAccountJson || !packageName) {
    console.error("Google Play verification configuration missing", {
      url: !!supabaseUrl,
      anon: !!anonKey,
      service: !!serviceKey,
      googleAccount: !!serviceAccountJson,
      packageName: !!packageName,
    });
    return json({ ok: false, error: "Google Play billing is not fully configured on the server." }, 503, origin);
  }

  const bearer = (req.headers.get("Authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1];
  if (!bearer) return json({ ok: false, error: "Sign in to continue." }, 401, origin);

  const userDb = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${bearer}` } },
  });
  const { data: auth, error: authError } = await userDb.auth.getUser(bearer);
  if (authError || !auth.user) return json({ ok: false, error: "Your JOINT session expired. Sign in again." }, 401, origin);

  const db = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Invalid request body." }, 400, origin);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ ok: false, error: "Invalid request body." }, 400, origin);
  }
  const action = text(body.action, 40);

  try {
    if (action === "pricing_preview") {
      const { data: base, error: baseError } = await db
        .from("joint_diamond_pricing_settings")
        .select("diamonds_per_ngn,diamonds_per_usd,enabled")
        .eq("id", "global")
        .maybeSingle();
      if (baseError) throw baseError;
      const { data: fee, error: feeError } = await db
        .from("joint_google_play_pricing_settings")
        .select("service_fee_percent,enabled")
        .eq("id", "global")
        .maybeSingle();
      if (feeError) throw feeError;
      if (!base?.enabled || !fee?.enabled) {
        return json({
          ok: false,
          configured: false,
          error: "Enable JOINT Diamond pricing and configure the Google Play service-fee rate before generating catalogue price recommendations.",
        }, 409, origin);
      }
      const feePercent = Number(fee.service_fee_percent);
      if (!Number.isFinite(feePercent) || feePercent < 0 || feePercent >= 100) {
        return json({ ok: false, error: "The Google Play service-fee percentage is invalid." }, 409, origin);
      }
      const bundles = Object.entries(PRODUCT_DIAMONDS).map(([productId, diamonds]) => ({ productId, diamonds }));
      const currencies = [
        { currency: "NGN", rate: Number(base.diamonds_per_ngn), minorUnit: 100 },
        { currency: "USD", rate: Number(base.diamonds_per_usd), minorUnit: 100 },
      ];
      const recommendations: any[] = [];
      for (const item of bundles) {
        for (const currency of currencies) {
          if (!Number.isFinite(currency.rate) || currency.rate <= 0) {
            throw new Error(`The ${currency.currency} Diamond conversion rate is invalid.`);
          }
          const netMinor = Math.ceil((item.diamonds / currency.rate) * currency.minorUnit - Number.EPSILON);
          const grossMinor = Math.ceil(netMinor / (1 - feePercent / 100) - Number.EPSILON);
          recommendations.push({
            product_id: item.productId,
            diamonds: item.diamonds,
            currency: currency.currency,
            net_target_minor: netMinor,
            recommended_gross_minor: grossMinor,
            recommended_gross_major: grossMinor / currency.minorUnit,
            fee_percent: feePercent,
          });
        }
      }
      return json({
        ok: true,
        configured: true,
        fee_percent: feePercent,
        note: "Recommendations are planning targets. Configure the final prices in Google Play Console; the Android app must display the localized price returned by Google Play Billing.",
        recommendations,
      }, 200, origin);
    }

    if (action !== "verify_purchase") {
      return json({ ok: false, error: "Unknown Google Play billing action." }, 400, origin);
    }

    const productId = text(body.productId, 100);
    const purchaseToken = text(body.purchaseToken, 5000);
    if (!Object.hasOwn(PRODUCT_DIAMONDS, productId)) {
      return json({ ok: false, error: "Unrecognized Diamond product." }, 400, origin);
    }
    if (!purchaseToken || purchaseToken.length < 20) {
      return json({ ok: false, error: "Invalid Google Play purchase token." }, 400, origin);
    }

    const accessToken = await googleAccessToken(serviceAccountJson);

    // ProductPurchaseV2 is the current Google API for one-time product verification.
    // Unlike the legacy endpoint, it does not require productId in the URL.
    const encodedPackage = encodeURIComponent(packageName);
    const encodedPurchaseToken = encodeURIComponent(purchaseToken);
    const v2Path = `/applications/${encodedPackage}/purchases/productsv2/tokens/${encodedPurchaseToken}`;
    const verified = await googleApi(v2Path, accessToken);
    if (!verified.ok) {
      console.error("Google ProductPurchaseV2 lookup failed", verified.status, verified.data?.error?.status || "unknown");
      return json({ ok: false, error: "Google Play could not verify this purchase. No Diamonds were credited." }, 409, origin);
    }

    const purchase = verified.data || {};
    const lineItems = Array.isArray(purchase.productLineItem) ? purchase.productLineItem : [];
    const matchingItems = lineItems.filter((item: any) => item?.productId === productId);
    const purchaseState = text(purchase.purchaseStateContext?.purchaseState, 80);
    const totalQuantity = matchingItems.reduce(
      (sum: number, item: any) => {
        const rawQuantity = item?.productOfferDetails?.quantity;
        // Google treats an omitted quantity as the default single-item purchase.
        const quantity = rawQuantity == null ? 1 : Number(rawQuantity);
        return sum + (Number.isFinite(quantity) && quantity > 0 ? quantity : 0);
      },
      0,
    );

    if (purchaseState !== "PURCHASED" || matchingItems.length !== 1 || totalQuantity !== 1) {
      const pending = purchaseState === "PENDING";
      return json({
        ok: false,
        pending,
        error: pending
          ? "Google Play reports that this payment is still pending. Diamonds will be credited only after payment completes."
          : "Google Play does not report one completed purchase for this Diamond bundle. No Diamonds were credited.",
      }, pending ? 202 : 409, origin);
    }

    const expectedAccountId = await sha256Hex(auth.user.id);
    if (!purchase.obfuscatedExternalAccountId || purchase.obfuscatedExternalAccountId !== expectedAccountId) {
      return json({ ok: false, error: "This Google Play purchase is not linked to the currently signed-in JOINT account. No Diamonds were credited." }, 403, origin);
    }

    const purchaseTime = purchase.purchaseCompletionTime
      ? new Date(purchase.purchaseCompletionTime).toISOString()
      : null;
    const orderId = text(purchase.orderId, 200) || null;

    const { data: credited, error: creditError } = await db.rpc(
      "joint_diamond_credit_google_play_purchase",
      {
        p_user_id: auth.user.id,
        p_product_id: productId,
        p_purchase_token: purchaseToken,
        p_order_id: orderId,
        p_purchase_time: purchaseTime,
      },
    );
    if (creditError) {
      console.error("Google Play wallet credit failed", creditError.message);
      throw new Error("Google Play verified the payment, but JOINT could not complete the wallet credit. Please retry verification or contact support.");
    }
    if (!credited?.ok) throw new Error("Google Play verified the payment, but the Diamond credit was not confirmed.");

    // ProductPurchaseV2 reports consumption under productOfferDetails.
    // If that state is absent or not consumed, safely retry the existing consume API.
    const offerDetails = matchingItems[0]?.productOfferDetails || {};
    let consumed = offerDetails.consumptionState === "CONSUMPTION_STATE_CONSUMED";
    let consumePending = false;
    if (!consumed) {
      // The consume endpoint still uses the product-specific legacy URL.
      const consumePath =
        `/applications/${encodedPackage}/purchases/products/${encodeURIComponent(productId)}/tokens/${encodedPurchaseToken}:consume`;
      const consumeResult = await googleApi(consumePath, accessToken, "POST");
      consumed = consumeResult.ok;
      consumePending = !consumeResult.ok;
      if (!consumed) {
        console.error("Google Play consume request pending", consumeResult.status, consumeResult.data?.error?.status || "unknown");
      }
    }

    if (consumed) {
      const now = new Date().toISOString();
      const { error: updateError } = await db
        .from("joint_diamond_google_play_purchases")
        .update({ consumed_at: now, updated_at: now })
        .eq("purchase_token", purchaseToken)
        .eq("user_id", auth.user.id);
      if (updateError) console.error("Could not record Google Play consumption timestamp", updateError.message);
    }

    return json({
      ok: true,
      paid: true,
      already_credited: !!credited.already_credited,
      diamonds: credited.diamonds,
      balance: credited.balance,
      purchase_balance: credited.purchase_balance,
      earnings_balance: credited.earnings_balance,
      purchase_id: credited.purchase_id,
      consumed,
      consume_pending: consumePending,
    }, 200, origin);
  } catch (error) {
    console.error("joint-google-play-verify", error instanceof Error ? error.message : "unknown error");
    return json({ ok: false, error: error instanceof Error ? error.message : "Unexpected Google Play billing error." }, 500, origin);
  }
});
