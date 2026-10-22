import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const paystackSecret = Deno.env.get("PAYSTACK_SECRET_KEY");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  if (!paystackSecret) return json({ error: "PAYSTACK_SECRET_KEY is not configured in Supabase Edge Function secrets." }, 503);
  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Sign in is required." }, 401);
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } });
    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData.user) return json({ error: "Your session is invalid or expired." }, 401);
    const user = authData.user;
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const body = await req.json();

    if (body.action === "initialize") {
      if (body.purpose !== "course_enrollment" || !body.course_id) return json({ error: "This phase supports paid course enrolment checkout only." }, 400);
      const { data: course, error: courseError } = await admin.from("joint_courses").select("id,title,price,currency,owner_id").eq("id", body.course_id).maybeSingle();
      if (courseError) throw courseError;
      if (!course) return json({ error: "Course not found." }, 404);
      const price = Number(course.price);
      const currency = String(course.currency || "USD").toUpperCase();
      if (!Number.isFinite(price) || price <= 0) return json({ error: "This course does not have a valid paid price." }, 400);
      if (!/^[A-Z]{3}$/.test(currency)) return json({ error: "Course currency is invalid." }, 400);
      const existing = await admin.from("joint_course_enrollments").select("id,status").eq("user_id", user.id).eq("course_id", course.id).maybeSingle();
      if (existing.error) throw existing.error;
      if (existing.data && ["enrolled", "completed", "joined"].includes(String(existing.data.status).toLowerCase())) return json({ error: "You already have access to this course." }, 409);
      const callbackUrl = new URL(String(body.callback_url || ""));
      const allowedHosts = (Deno.env.get("PAYSTACK_CALLBACK_HOSTS") || "myjointapp.com,www.myjointapp.com").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
      if (callbackUrl.protocol !== "https:" || !allowedHosts.includes(callbackUrl.hostname.toLowerCase())) return json({ error: "Checkout callback URL is not an approved JOINT domain." }, 400);
      const reference = `joint_${crypto.randomUUID().replaceAll("-", "")}`;
      const amount = Math.round(price * 100);
      const { error: pendingError } = await admin.from("joint_paystack_transactions").insert({ reference, user_id: user.id, purpose: "course_enrollment", course_id: course.id, course_owner_id: course.owner_id || null, amount_minor: amount, currency, status: "pending" });
      if (pendingError) throw pendingError;
      const initResponse = await fetch("https://api.paystack.co/transaction/initialize", {
        method: "POST", headers: { Authorization: `Bearer ${paystackSecret}`, "Content-Type": "application/json" },
        body: JSON.stringify({ email: user.email, amount, currency, reference, callback_url: callbackUrl.toString(), metadata: { joint_user_id: user.id, purpose: "course_enrollment", course_id: course.id, course_title: course.title } }),
      });
      const result = await initResponse.json();
      if (!initResponse.ok || !result.status || !result.data?.authorization_url) {
        await admin.from("joint_paystack_transactions").update({ status: "initialization_failed", gateway_response: result }).eq("reference", reference);
        return json({ error: result.message || "Paystack could not initialize checkout. Confirm currency and account eligibility." }, 502);
      }
      await admin.from("joint_paystack_transactions").update({ access_code: result.data.access_code }).eq("reference", reference);
      return json({ authorization_url: result.data.authorization_url, reference, amount_minor: amount, currency });
    }

    if (body.action === "verify") {
      const reference = String(body.reference || "");
      if (!/^joint_[a-f0-9]{32}$/.test(reference)) return json({ error: "Invalid transaction reference." }, 400);
      const { data: tx, error: txError } = await admin.from("joint_paystack_transactions").select("*").eq("reference", reference).eq("user_id", user.id).maybeSingle();
      if (txError) throw txError;
      if (!tx) return json({ error: "Transaction not found for this account." }, 404);
      if (tx.status === "paid") return json({ paid: true, reference, message: "Payment was already verified." });
      const verifyResponse = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, { headers: { Authorization: `Bearer ${paystackSecret}` } });
      const verified = await verifyResponse.json();
      if (!verifyResponse.ok || !verified.status || verified.data?.status !== "success") {
        await admin.from("joint_paystack_transactions").update({ status: "verification_pending", gateway_response: verified }).eq("reference", reference).eq("user_id", user.id);
        return json({ paid: false, message: "Paystack has not confirmed a successful payment. Course access remains locked." }, 200);
      }
      const paid = verified.data;
      if (Number(paid.amount) !== Number(tx.amount_minor) || String(paid.currency).toUpperCase() !== String(tx.currency).toUpperCase()) return json({ error: "Verified payment amount or currency does not match the transaction. Access was not granted." }, 409);
      const { error: paidError } = await admin.from("joint_paystack_transactions").update({ status: "paid", paid_at: new Date().toISOString(), gateway_transaction_id: String(paid.id), gateway_response: { status: paid.status, channel: paid.channel, paid_at: paid.paid_at } }).eq("reference", reference).eq("user_id", user.id).neq("status", "paid");
      if (paidError) throw paidError;
      const { error: enrollmentError } = await admin.from("joint_course_enrollments").upsert({ user_id: user.id, course_id: tx.course_id, status: "enrolled" }, { onConflict: "user_id,course_id" });
      if (enrollmentError) {
        await admin.from("joint_paystack_transactions").update({ status: "paid_fulfillment_pending" }).eq("reference", reference).eq("user_id", user.id);
        throw new Error("Payment is verified, but course access could not be updated. Contact JOINT support with reference " + reference + ". Details: " + enrollmentError.message);
      }
      await admin.from("joint_user_notifications").insert({ user_id: user.id, title: "Course payment confirmed", body: "Your payment for " + String(paid.metadata?.course_title || "the course") + " was verified. You can now access the course.", category: "payment", is_read: false, action_url: "classes.html?course=" + encodeURIComponent(String(tx.course_id)) });
      return json({ paid: true, reference, course_id: tx.course_id, message: "Payment verified and course access granted." });
    }
    return json({ error: "Unsupported action." }, 400);
  } catch (error) {
    console.error("joint-paystack-checkout error", error);
    return json({ error: error instanceof Error ? error.message : "Unexpected payment service error." }, 500);
  }
});
