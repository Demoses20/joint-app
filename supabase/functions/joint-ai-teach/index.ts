import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const paystackKey = Deno.env.get("JOINT_PAYSTACK_SECRET_KEY");
  if (!supabaseUrl || !anonKey || !serviceKey || !paystackKey) {
    return json({ error: "Server configuration incomplete. Check Supabase defaults and JOINT_PAYSTACK_SECRET_KEY." }, 500);
  }

  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ error: "Sign in to continue." }, 401);
  const authClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: authData, error: authError } = await authClient.auth.getUser(token);
  const user = authData?.user;
  if (authError || !user) return json({ error: "Your session is invalid or expired. Sign in again." }, 401);

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON body." }, 400); }
  const action = String(body.action || "");

  if (action === "initialize") {
    if (body.purpose !== "course_enrollment") return json({ error: "Unsupported payment purpose." }, 400);
    const courseId = String(body.course_id || "").trim();
    if (!courseId) return json({ error: "course_id is required." }, 400);
    const { data: course, error: courseError } = await admin.from("joint_courses").select("id,title,price,currency,status").eq("id", courseId).maybeSingle();
    if (courseError) return json({ error: "Could not load course details." }, 500);
    if (!course || String(course.status || "").toLowerCase() !== "published") return json({ error: "This course is not available for enrolment." }, 404);
    const price = Number(course.price);
    if (!Number.isFinite(price) || price <= 0) return json({ error: "This checkout is only for paid courses." }, 400);
    const currency = String(course.currency || "NGN").toUpperCase();
    // Paystack amount uses the currency's minor unit. Currency availability depends on the merchant's country and activation.
    const amount = Math.round(price * 100);
    if (!Number.isSafeInteger(amount) || amount <= 0) return json({ error: "Invalid course price." }, 400);
    const suppliedCallback = String(body.callback_url || "");
    let callbackUrl: string;
    try {
      const parsed = new URL(suppliedCallback);
      const allowedHosts = new Set(["myjointapp.com", "www.myjointapp.com"]);
      if (parsed.protocol !== "https:" || !allowedHosts.has(parsed.hostname) || parsed.pathname !== "/classes.html") throw new Error("invalid callback");
      callbackUrl = parsed.href;
    } catch { return json({ error: "Invalid callback URL. Use the official JOINT classes page over HTTPS." }, 400); }

    const reference = `joint_${crypto.randomUUID().replaceAll("-", "")}`;
    const txInsert = await admin.from("joint_paystack_transactions").insert({
      reference, user_id: user.id, purpose: "course_enrollment", course_id: course.id,
      amount_minor: amount, currency, status: "initializing", course_title: course.title || "Course"
    });
    if (txInsert.error) return json({ error: "Could not create payment record. Apply the included SQL migration and retry." }, 500);

    const response = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: { Authorization: `Bearer ${paystackKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ email: user.email, amount, currency, reference, callback_url: callbackUrl, metadata: { app: "JOINT", user_id: user.id, course_id: course.id, purpose: "course_enrollment" } })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.status || !result.data?.authorization_url) {
      await admin.from("joint_paystack_transactions").update({ status: "initialization_failed", provider_message: String(result.message || "Paystack initialization failed").slice(0, 500) }).eq("reference", reference);
      return json({ error: result.message || "Paystack could not initialize this payment. Confirm currency and merchant activation." }, 400);
    }
    await admin.from("joint_paystack_transactions").update({ status: "pending", access_code: result.data.access_code || null }).eq("reference", reference);
    return json({ authorization_url: result.data.authorization_url, reference });
  }

  if (action === "verify") {
    const reference = String(body.reference || "").trim();
    if (!reference || !/^joint_[a-f0-9]{32}$/.test(reference)) return json({ error: "Invalid JOINT payment reference." }, 400);
    const { data: tx, error: txError } = await admin.from("joint_paystack_transactions").select("*").eq("reference", reference).maybeSingle();
    if (txError || !tx) return json({ error: "Payment reference was not found." }, 404);
    if (tx.user_id !== user.id) return json({ error: "This payment does not belong to your account." }, 403);
    if (tx.status === "success") return json({ paid: true, reference, course_id: tx.course_id, message: "Payment was already verified." });

    const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, { headers: { Authorization: `Bearer ${paystackKey}` } });
    const result = await response.json().catch(() => ({}));
    const paid = response.ok && result.status === true && result.data?.status === "success" && Number(result.data?.amount) === Number(tx.amount_minor) && String(result.data?.currency || "").toUpperCase() === String(tx.currency).toUpperCase() && String(result.data?.reference) === reference;
    if (!paid) {
      await admin.from("joint_paystack_transactions").update({ status: result.data?.status === "failed" ? "failed" : "pending", provider_message: String(result.message || result.data?.gateway_response || "Payment not verified").slice(0, 500) }).eq("reference", reference);
      return json({ paid: false, message: "Paystack has not confirmed a successful payment. Course access remains locked." }, 200);
    }

    // Grant access only after the provider's server-side verification succeeds.
    const { data: existing, error: enrollmentLookupError } = await admin.from("joint_course_enrollments").select("id,status").eq("user_id", user.id).eq("course_id", tx.course_id).maybeSingle();
    if (enrollmentLookupError) return json({ error: "Payment verified, but enrolment could not be updated. Contact JOINT support with reference " + reference }, 500);
    let enrollmentError: { message: string } | null = null;
    if (existing?.id) {
      const updated = await admin.from("joint_course_enrollments").update({ status: "enrolled" }).eq("id", existing.id);
      enrollmentError = updated.error;
    } else {
      const inserted = await admin.from("joint_course_enrollments").insert({ user_id: user.id, course_id: tx.course_id, status: "enrolled" });
      enrollmentError = inserted.error;
    }
    if (enrollmentError) return json({ error: "Payment verified, but enrolment could not be updated. Contact JOINT support with reference " + reference }, 500);
    const updateTx = await admin.from("joint_paystack_transactions").update({ status: "success", paid_at: new Date().toISOString(), provider_transaction_id: String(result.data.id || "") }).eq("reference", reference);
    if (updateTx.error) return json({ error: "Payment verified and access granted, but the payment log needs reconciliation. Reference: " + reference }, 500);
    return json({ paid: true, reference, course_id: tx.course_id, message: "Payment verified and course access granted." });
  }
  return json({ error: "Unsupported action." }, 400);
});
