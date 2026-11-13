import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS = new Set(["https://myjointapp.com", "https://www.myjointapp.com"]);
const cors = (origin: string | null, requestedHeaders: string | null = null) => ({
  "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://myjointapp.com",
  "Access-Control-Allow-Headers": requestedHeaders || "authorization, x-client-info, apikey, content-type, x-supabase-api-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Max-Age": "86400", Vary: "Origin, Access-Control-Request-Headers",
});
const json = (body: unknown, status = 200, origin: string | null = null) => new Response(JSON.stringify(body), { status, headers: { ...cors(origin), "Content-Type": "application/json" } });
const str = (v: unknown, max = 200) => String(v ?? "").trim().slice(0, max);
const ADMIN_EMAIL = "technicaldemoses@gmail.com";

async function paystack(path: string, secret: string, method = "GET", body?: unknown) {
  const response = await fetch(`https://api.paystack.co${path}`, {
    method,
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(25000),
  });
  const payload: any = await response.json().catch(() => ({}));
  if (!response.ok || payload.status === false) throw new Error(payload.message || `Paystack request failed (${response.status}).`);
  return payload.data;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin, req.headers.get("access-control-request-headers")) });
  if (req.method !== "POST") return json({ ok: false, error: "POST required." }, 405, origin);
  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  const service = Deno.env.get("JOINT_SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const secret = Deno.env.get("JOINT_PAYSTACK_SECRET_KEY") || Deno.env.get("PAYSTACK_SECRET_KEY");
  if (!url || !anon || !service || !secret) return json({ ok: false, error: "Diamond payout server configuration is incomplete." }, 503, origin);
  const token = (req.headers.get("Authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return json({ ok: false, error: "Sign in required." }, 401, origin);
  const userDb = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: auth, error: authError } = await userDb.auth.getUser(token);
  if (authError || !auth.user) return json({ ok: false, error: "Session expired. Sign in again." }, 401, origin);
  const db = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, error: "Invalid request body." }, 400, origin); }
  const action = str(body.action, 40);
  const isAdmin = (auth.user.email || "").toLowerCase() === ADMIN_EMAIL;
  try {
    if (action === "banks") {
      const banks = await paystack("/bank?country=nigeria&currency=NGN&perPage=200", secret);
      return json({ ok: true, banks: (banks || []).map((b: any) => ({ name: b.name, code: b.code, active: b.active !== false })).filter((b: any) => b.code && b.active) }, 200, origin);
    }
    if (action === "resolve-account") {
      const account = str(body.account_number, 10);
      const bankCode = str(body.bank_code, 12);
      if (!/^\d{10}$/.test(account) || !/^\d{2,6}$/.test(bankCode)) return json({ ok: false, error: "Enter a valid 10-digit Nigerian account number and select a bank." }, 400, origin);
      const resolved = await paystack(`/bank/resolve?account_number=${encodeURIComponent(account)}&bank_code=${encodeURIComponent(bankCode)}`, secret);
      return json({ ok: true, account_name: str(resolved.account_name, 160), account_number: account, bank_code: bankCode }, 200, origin);
    }
    if (!isAdmin) return json({ ok: false, error: "Administrator permission required." }, 403, origin);
    if (action === "initiate") {
      const requestId = str(body.request_id, 50);
      if (!/^[0-9a-f-]{36}$/i.test(requestId)) return json({ ok: false, error: "Invalid payout request." }, 400, origin);
      const { data: request, error } = await db.from("joint_diamond_payout_requests").select("*").eq("id", requestId).maybeSingle();
      if (error) throw error;
      if (!request) return json({ ok: false, error: "Payout request not found." }, 404, origin);
      if (String(request.currency).toUpperCase() !== "NGN" || String(request.method_label).toLowerCase().indexOf("bank") < 0) return json({ ok: false, error: "Only Nigerian bank-transfer payout requests can use Paystack." }, 400, origin);
      if (["processing", "paid"].includes(request.status) || request.paystack_transfer_code || request.payout_reference) return json({ ok: false, error: "A Paystack transfer has already been initiated or recorded for this request. Verify its status instead of sending again." }, 409, origin);
      if (!(["pending", "approved"].includes(request.status))) return json({ ok: false, error: `This request cannot be paid from status ${request.status}.` }, 409, origin);
      const meta = request.payout_metadata || {};
      const bank = meta.bank || {};
      const recipientCode = str(request.paystack_recipient_code || meta.recipient_code, 80);
      if (!recipientCode) {
        const account = str(bank.account_number, 10), bankCode = str(bank.bank_code, 12), accountName = str(bank.account_name, 160);
        if (!/^\d{10}$/.test(account) || !/^\d{2,6}$/.test(bankCode) || !accountName) return json({ ok: false, error: "This request has no verified Nigerian bank details. The member must update their bank details before payment." }, 400, origin);
        const verified = await paystack(`/bank/resolve?account_number=${encodeURIComponent(account)}&bank_code=${encodeURIComponent(bankCode)}`, secret);
        if (str(verified.account_name, 160).toLowerCase() !== accountName.toLowerCase()) return json({ ok: false, error: "The saved bank account name no longer matches Paystack verification. Ask the member to verify the account again." }, 409, origin);
        const recipient = await paystack("/transferrecipient", secret, "POST", { type: "nuban", name: accountName, account_number: account, bank_code: bankCode, currency: "NGN", description: `JOINT Diamond payout ${request.id}` });
        const { error: saveRecipientError } = await db.from("joint_diamond_payout_requests").update({ paystack_recipient_code: recipient.recipient_code, payout_metadata: { ...meta, recipient_code: recipient.recipient_code, bank: { ...bank, account_number: account, bank_code: bankCode, account_name: accountName } } }).eq("id", request.id).is("paystack_recipient_code", null);
        if (saveRecipientError) throw saveRecipientError;
        // Use the just-created code below; database uniqueness/idempotency is enforced by the request reference.
        bank.recipient_code = recipient.recipient_code;
      }
      const recipient = str(request.paystack_recipient_code || bank.recipient_code || meta.recipient_code, 80);
      if (!recipient) throw new Error("Could not save or retrieve the Paystack recipient code. Refresh and retry after checking the request.");
      const reference = `joint_diamond_${request.id.replaceAll("-", "")}`;
      const gross = Number(request.payout_gross_amount);
      const net = Number(request.payout_net_amount);
      if (!Number.isFinite(gross) || !Number.isFinite(net) || gross <= 0 || net < 50 || Math.round(net * 100) !== net * 100) return json({ ok: false, error: "The saved payout amount is invalid or the net NGN transfer is below Paystack’s ₦50 minimum. Reconcile the request before initiating a transfer." }, 400, origin);
      // Persist a stable reference before calling Paystack. A retry uses the same reference and must be verified, never blindly re-sent.
      const { data: claimed, error: claimError } = await db.from("joint_diamond_payout_requests").update({ status: "processing", payout_provider: "paystack", payout_reference: reference, payout_currency: "NGN", processed_by: auth.user.id, processed_at: new Date().toISOString() }).eq("id", request.id).in("status", ["pending", "approved"]).is("payout_reference", null).select("id").maybeSingle();
      if (claimError) throw claimError;
      if (!claimed) return json({ ok: false, error: "This payout was claimed by another admin action. Refresh and verify its transfer status before retrying." }, 409, origin);
      try {
        const transfer = await paystack("/transfer", secret, "POST", { source: "balance", amount: Math.round(net * 100), recipient, reference, currency: "NGN", reason: `JOINT Diamond withdrawal ${request.id}` });
        const { error: saveError } = await db.from("joint_diamond_payout_requests").update({ paystack_transfer_code: transfer.transfer_code || null, payout_metadata: { ...meta, recipient_code: recipient, transfer_status: transfer.status, transfer_id: transfer.id || null } }).eq("id", request.id).eq("payout_reference", reference);
        if (saveError) throw saveError;
        return json({ ok: true, status: transfer.status, reference, transfer_code: transfer.transfer_code || null, message: transfer.status === "otp" ? "Paystack requires an OTP. Use the admin OTP confirmation action." : "Transfer initiated. Verify the final status before treating this payout as paid." }, 200, origin);
      } catch (e) {
        // Do not automatically reset or refund: a network timeout can occur after Paystack accepted the transfer.
        await db.from("joint_diamond_payout_requests").update({ payout_metadata: { ...meta, transfer_error: str(e instanceof Error ? e.message : e, 300), transfer_needs_reconciliation: true } }).eq("id", request.id).eq("payout_reference", reference);
        throw new Error("Paystack initiation could not be confirmed. The request is locked for reconciliation to prevent a duplicate transfer. Check Paystack using reference " + reference + ".");
      }
    }
    if (action === "finalize") {
      const requestId = str(body.request_id, 50), otp = str(body.otp, 12);
      if (!/^[0-9a-f-]{36}$/i.test(requestId) || !/^\d{4,8}$/.test(otp)) return json({ ok: false, error: "Enter the payout request and valid OTP." }, 400, origin);
      const { data: request, error } = await db.from("joint_diamond_payout_requests").select("paystack_transfer_code,payout_reference,status").eq("id", requestId).maybeSingle();
      if (error) throw error;
      if (!request?.paystack_transfer_code || request.status !== "processing") return json({ ok: false, error: "No OTP-pending transfer was found for this request." }, 409, origin);
      const result = await paystack("/transfer/finalize_transfer", secret, "POST", { transfer_code: request.paystack_transfer_code, otp });
      await db.from("joint_diamond_payout_requests").update({ payout_metadata: { otp_finalize_status: result.status, otp_finalize_message: result.message || null } }).eq("id", requestId);
      return json({ ok: true, status: result.status, reference: request.payout_reference, message: result.message || "OTP submitted. Verify the transfer status before marking it paid." }, 200, origin);
    }
    if (action === "verify") {
      const requestId = str(body.request_id, 50);
      if (!/^[0-9a-f-]{36}$/i.test(requestId)) return json({ ok: false, error: "Invalid payout request." }, 400, origin);
      const { data: request, error } = await db.from("joint_diamond_payout_requests").select("id,status,payout_reference,payout_metadata,payout_net_amount,payout_currency").eq("id", requestId).maybeSingle();
      if (error) throw error;
      if (!request?.payout_reference) return json({ ok: false, error: "No Paystack transfer reference exists for this request." }, 404, origin);
      const transfer = await paystack(`/transfer/verify/${encodeURIComponent(request.payout_reference)}`, secret);
      const status = str(transfer.status, 30).toLowerCase();
      const meta = { ...(request.payout_metadata || {}), transfer_status: status, transfer_id: transfer.id || null, verified_at: new Date().toISOString() };
      if (status === "success" || status === "successful") {
        const { error: paidError } = await db.from("joint_diamond_payout_requests").update({ status: "paid", payout_metadata: meta, receipt_url: request.payout_reference, processed_at: new Date().toISOString(), processed_by: auth.user.id }).eq("id", request.id).eq("status", "processing");
        if (paidError) throw paidError;
      } else if (status === "failed" || status === "reversed") {
        const { error: statusError } = await db.from("joint_diamond_payout_requests").update({ status, payout_metadata: meta }).eq("id", request.id).eq("status", "processing");
        if (statusError) throw statusError;
      } else {
        await db.from("joint_diamond_payout_requests").update({ payout_metadata: meta }).eq("id", request.id);
      }
      return json({ ok: true, status, reference: request.payout_reference, message: `Paystack transfer status: ${status}.` }, 200, origin);
    }
    return json({ ok: false, error: "Unknown Diamond payout action." }, 400, origin);
  } catch (e) {
    console.error("joint-diamond-payout", e instanceof Error ? e.message : e);
    return json({ ok: false, error: e instanceof Error ? e.message : "Unexpected Diamond payout error." }, 500, origin);
  }
});
