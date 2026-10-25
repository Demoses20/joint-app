// JOINT currency quote endpoint — display estimates only.
// This function does NOT initialize Paystack payments or grant access.
// Deploy as: supabase functions deploy joint-currency-convert-
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const ALLOWED_ORIGINS = new Set([
  "https://myjointapp.com",
  "https://www.myjointapp.com",
]);
const TARGET_CURRENCIES = new Set(["NGN", "USD"]);
const CURRENCY_RE = /^[A-Z]{3}$/;
const MARGIN_RATE = 0.02;
const CACHE_TTL_MS = 5 * 60 * 1000;

type RateCacheEntry = { rates: Record<string, number>; fetchedAt: number };
const rateCache = new Map<string, RateCacheEntry>();

function corsHeaders(origin: string | null): Record<string, string> {
  const allowedOrigin = origin && ALLOWED_ORIGINS.has(origin)
    ? origin
    : "https://myjointapp.com";
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function jsonResponse(
  body: Record<string, unknown>,
  status: number,
  origin: string | null,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function roundCurrency(value: number, currency: string): number {
  // NGN and USD both use two minor-unit decimal places.
  const decimals = currency === "JPY" || currency === "KRW" ? 0 : 2;
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

async function getRates(baseCurrency: string): Promise<RateCacheEntry> {
  const cached = rateCache.get(baseCurrency);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached;

  const response = await fetch(
    `https://open.er-api.com/v6/latest/${encodeURIComponent(baseCurrency)}`,
    { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8000) },
  );
  if (!response.ok) throw new Error("Exchange-rate service is temporarily unavailable.");
  const data = await response.json();
  if (data?.result !== "success" || !data?.rates || typeof data.rates !== "object") {
    throw new Error("Exchange-rate service did not return a valid rate.");
  }
  const entry: RateCacheEntry = {
    rates: data.rates as Record<string, number>,
    fetchedAt: Date.now(),
  };
  rateCache.set(baseCurrency, entry);
  return entry;
}

serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(origin) });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405, origin);
  }
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return jsonResponse({ error: "Origin not allowed." }, 403, origin);
  }

  try {
    const body = await req.json();
    const amount = Number(body?.amount);
    const sourceCurrency = String(body?.sourceCurrency ?? "").trim().toUpperCase();
    const targetCurrency = String(body?.targetCurrency ?? "").trim().toUpperCase();

    if (!Number.isFinite(amount) || amount <= 0 || amount > 100_000_000) {
      return jsonResponse({ error: "Amount must be greater than zero and within the allowed limit." }, 400, origin);
    }
    if (!CURRENCY_RE.test(sourceCurrency) || !CURRENCY_RE.test(targetCurrency)) {
      return jsonResponse({ error: "Use valid three-letter ISO currency codes." }, 400, origin);
    }
    if (!TARGET_CURRENCIES.has(targetCurrency)) {
      return jsonResponse({ error: "Only NGN and USD display quotes are currently enabled in JOINT settings." }, 400, origin);
    }

    let rate = 1;
    let rateTimestamp = new Date().toISOString();
    let rateProvider = "identity";
    if (sourceCurrency !== targetCurrency) {
      const entry = await getRates(sourceCurrency);
      rate = Number(entry.rates[targetCurrency]);
      rateTimestamp = new Date(entry.fetchedAt).toISOString();
      rateProvider = "open.er-api.com";
      if (!Number.isFinite(rate) || rate <= 0) {
        return jsonResponse({ error: `A rate for ${sourceCurrency} to ${targetCurrency} is unavailable.` }, 422, origin);
      }
    }

    const convertedAmount = roundCurrency(amount * rate, targetCurrency);
    const conversionMargin = roundCurrency(convertedAmount * MARGIN_RATE, targetCurrency);
    const estimatedTotal = roundCurrency(convertedAmount + conversionMargin, targetCurrency);

    return jsonResponse({
      ok: true,
      quoteType: "display_estimate_only",
      sourceCurrency,
      sourceAmount: roundCurrency(amount, sourceCurrency),
      targetCurrency,
      exchangeRate: rate,
      convertedAmount,
      conversionMarginRate: MARGIN_RATE,
      conversionMargin,
      estimatedTotal,
      rateProvider,
      rateTimestamp,
      cacheTtlSeconds: CACHE_TTL_MS / 1000,
      note: "Estimate only. This quote does not confirm Paystack support, lock an exchange rate, charge a customer, or authorize course access. Obtain a fresh server-side quote and validate the actual charge currency before checkout.",
    }, 200, origin);
  } catch (error) {
    console.error("Currency quote error:", error);
    return jsonResponse({
      error: error instanceof Error ? error.message : "Could not calculate a currency quote.",
    }, 502, origin);
  }
});
