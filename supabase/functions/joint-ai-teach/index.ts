import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "https://myjointapp.com",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors, "Content-Type": "application/json" },
});

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const allowedOrigins = new Set(["https://myjointapp.com", "https://www.myjointapp.com"]);
  const headers = { ...cors, "Access-Control-Allow-Origin": origin && allowedOrigins.has(origin) ? origin : "https://myjointapp.com" };
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return json({ error: "POST required." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const paystackSecret = Deno.env.get("JOINT_PAYSTACK_SECRET_KEY");
  if (!supabaseUrl || !anonKey || !serviceKey || !paystackSecret) {
    return json({ error: "Checkout is not configured. Confirm Supabase defaults and JOINT_PAYSTACK_SECRET_KEY." }, 500);
  }

  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return json({ error: "Sign in to continue." }, 401);

  const userClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: authData, error: authError } = await userClient.auth.getUser(token);
  const user = authData?.user;
  if (authError || !user) return json({ error: "Your session is invalid or expired. Sign in again." }, 401);
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON body." }, 400); }

  if (body.action === "initialize") {
    if (body.purpose !== "course_enrollment") return json({ error: "Only paid course checkout is supported by this function." }, 400);
    const courseId = String(body.course_id || "").trim();
    if (!courseId) return json({ error: "course_id is required." }, 400);

    const { data: course, error: courseError } = await admin
      .from("joint_courses")
      .select("id,title,price,currency,owner_id,status")
      .eq("id", courseId)
      .maybeSingle();
    if (courseError) return json({ error: "Could not load course details." }, 500);
    if (!course || String(course.status || "").toLowerCase() !== "published") return json({ error: "This course is not available for enrolment." }, 404);
    if (!course.owner_id) return json({ error: "This course is missing its host/owner. Contact JOINT support." }, 409);

    const price = Number(course.price);
    const currency = String(course.currency || "NGN").toUpperCase();
    if (!Number.isFinite(price) || price <= 0) return json({ error: "This checkout is only for paid courses." }, 400);
    if (!/^[A-Z]{3}$/.test(currency)) return json({ error: "The course currency is invalid." }, 400);
    const amountMinor = Math.round(price * 100);
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) return json({ error: "The course price is invalid." }, 400);

    const { data: existing, error: existingError } = await admin.from("joint_course_enrollments")
      .select("id,status").eq("user_id", user.id).eq("course_id", course.id).maybeSingle();
    if (existingError) return json({ error: "Could not check your existing enrolment." }, 500);
    if (existing && ["joined", "enrolled", "completed"].includes(String(existing.status || "").toLowerCase())) {
      return json({ error: "You already have access to this course." }, 409);
    }

    let callbackUrl: URL;
    try {
      callbackUrl = new URL(String(body.callback_url || ""));
      if (callbackUrl.protocol !== "https:" || !["myjointapp.com", "www.myjointapp.com"].includes(callbackUrl.hostname.toLowerCase()) || callbackUrl.pathname !== "/classes.html") throw new Error("Invalid callback URL");
    } catch { return json({ error: "Use the official JOINT classes page as the secure callback URL." }, 400); }

    const reference = `joint_${crypto.randomUUID().replaceAll("-", "")}`;
    const { error: insertError } = await admin.from("joint_paystack_transactions").insert({
      reference,
      user_id: user.id,
      purpose: "course_enrollment",
      course_id: String(course.id),
      course_owner_id: course.owner_id,
      amount_minor: amountMinor,
      currency,
      status: "pending",
    });
    if (insertError) {
      console.error("JOINT transaction insert failed", insertError.message);
      return json({ error: "Could not create a payment record. No payment was started." }, 500);
    }

    let gatewayResponse: Response;
    let gatewayData: Record<string, any>;
    try {
      gatewayResponse = await fetch("https://api.paystack.co/transaction/initialize", {
        method: "POST",
        headers: { Authorization: `Bearer ${paystackSecret}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          email: user.email,
          amount: amountMinor,
          currency,
          reference,
          callback_url: callbackUrl.toString(),
          metadata: { app: "JOINT", user_id: user.id, course_id: String(course.id), course_title: course.title || "Course", purpose: "course_enrollment" },
        }),
      });
      gatewayData = await gatewayResponse.json();
    } catch {
      await admin.from("joint_paystack_transactions").update({ status: "initialization_failed", gateway_response: { message: "Could not reach Paystack." } }).eq("reference", reference);
      return json({ error: "Could not reach Paystack. No checkout link was created." }, 502);
    }
    if (!gatewayResponse.ok || gatewayData.status !== true || !gatewayData.data?.authorization_url) {
      await admin.from("joint_paystack_transactions").update({ status: "initialization_failed", gateway_response: gatewayData }).eq("reference", reference);
      return json({ error: gatewayData.message || "Paystack could not initialize checkout. Confirm merchant activation and supported currency." }, 502);
    }
    await admin.from("joint_paystack_transactions").update({ access_code: gatewayData.data.access_code || null, gateway_response: { status: gatewayData.status, message: gatewayData.message } }).eq("reference", reference);
    return json({ authorization_url: gatewayData.data.authorization_url, reference, amount_minor: amountMinor, currency });
  }

  if (body.action === "verify") {
    const reference = String(body.reference || "").trim();
    if (!/^joint_[a-f0-9]{32}$/.test(reference)) return json({ error: "Invalid JOINT payment reference." }, 400);
    const { data: tx, error: txError } = await admin.from("joint_paystack_transactions")
      .select("*").eq("reference", reference).eq("user_id", user.id).maybeSingle();
    if (txError) return json({ error: "Could not load the payment record." }, 500);
    if (!tx) return json({ error: "Payment reference not found for this account." }, 404);

    // If a prior verification succeeded but enrolment fulfillment failed, retry the access update safely.
    if (tx.status === "paid") return json({ paid: true, reference, course_id: tx.course_id, message: "Payment was already verified." });
    const verifyResponse = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${paystackSecret}` },
    });
    const verified = await verifyResponse.json().catch(() => ({}));
    const paid = verifyResponse.ok && verified.status === true && verified.data?.status === "success" &&
      String(verified.data?.reference) === reference && Number(verified.data?.amount) === Number(tx.amount_minor) &&
      String(verified.data?.currency || "").toUpperCase() === String(tx.currency || "").toUpperCase();
    if (!paid) {
      const status = verified.data?.status === "failed" ? "failed" : "verification_pending";
      await admin.from("joint_paystack_transactions").update({ status, gateway_response: verified }).eq("reference", reference).eq("user_id", user.id);
      return json({ paid: false, message: "Paystack has not confirmed a matching successful payment. Course access remains locked." });
    }

    // Verify first, then grant access. Never trust the browser callback alone.
    const paymentData = verified.data;
    const { error: paidError } = await admin.from("joint_paystack_transactions").update({
      status: "paid",
      paid_at: paymentData.paid_at || new Date().toISOString(),
      gateway_transaction_id: String(paymentData.id || ""),
      gateway_response: { status: paymentData.status, channel: paymentData.channel, paid_at: paymentData.paid_at, reference },
    }).eq("reference", reference).eq("user_id", user.id);
    if (paidError) return json({ error: "Payment was verified, but the transaction record could not be updated. Contact JOINT support with reference " + reference }, 500);

    const { error: enrollmentError } = await admin.from("joint_course_enrollments")
      .upsert({ user_id: user.id, course_id: tx.course_id, status: "enrolled" }, { onConflict: "user_id,course_id" });
    if (enrollmentError) {
      await admin.from("joint_paystack_transactions").update({ status: "paid_fulfillment_pending" }).eq("reference", reference).eq("user_id", user.id);
      return json({ error: "Payment is verified, but course access could not yet be updated. Contact JOINT support with reference " + reference }, 500);
    }
    return json({ paid: true, reference, course_id: tx.course_id, message: "Payment verified and course access granted." });
  }

  return json({ error: "Unsupported action." }, 400);
});
