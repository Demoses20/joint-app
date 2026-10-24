import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, "Content-Type": "application/json" },
});
const esc = (value: unknown) => String(value ?? "").replace(/[&<>\"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
}[c] ?? c));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const resendKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("JOINT_NOTIFICATION_FROM") || Deno.env.get("RESEND_FROM_EMAIL");
  if (!supabaseUrl || !serviceKey || !resendKey || !from) {
    return json({ error: "Missing server configuration: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY and JOINT_NOTIFICATION_FROM (or RESEND_FROM_EMAIL) are required." }, 500);
  }

  // This endpoint is intended for a Supabase Database Webhook. Do not expose the service role key to clients.
  const auth = req.headers.get("authorization") || "";
  if (auth !== `Bearer ${serviceKey}`) return json({ error: "Unauthorized" }, 401);

  let payload: Record<string, any>;
  try { payload = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const row = payload.record && typeof payload.record === "object" ? payload.record : payload;
  const notificationId = row.id;
  if (!notificationId) return json({ error: "Missing notification record id" }, 400);

  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  // Read by ID and claim only pending/failed rows. The conditional update prevents most duplicate sends.
  const { data: notification, error: readError } = await db.from("joint_notifications")
    .select("id, recipient_user_id, recipient_id, actor_user_id, actor_id, title, body, target_url, event_type, notification_type, email_status")
    .eq("id", notificationId).maybeSingle();
  if (readError) return json({ error: "Could not read notification", details: readError.message }, 500);
  if (!notification) return json({ skipped: true, reason: "Notification not found" });
  if (notification.email_status === "sent" || notification.email_status === "sending") {
    return json({ skipped: true, reason: `Email status is ${notification.email_status}` });
  }

  const recipientId = notification.recipient_user_id || notification.recipient_id;
  if (!recipientId) return json({ error: "Notification has no recipient user ID" }, 422);

  // Respect email opt-outs and event-specific preferences when the preferences row exists.
  const { data: prefs, error: prefsError } = await db.from("joint_notification_preferences")
    .select("email_enabled, follows, messages, reactions, mentions_tags, account_logins, payments, meetings, followed_posts, interested_posts")
    .eq("user_id", recipientId).maybeSingle();
  if (!prefsError && prefs) {
    const type = String(notification.event_type || notification.notification_type || "system").toLowerCase();
    const prefKey = type.includes("follow") ? "follows"
      : type.includes("message") ? "messages"
      : type.includes("react") || type.includes("like") || type.includes("comment") || type.includes("share") ? "reactions"
      : type.includes("mention") || type.includes("tag") ? "mentions_tags"
      : type.includes("login") || type.includes("sign_in") ? "account_logins"
      : type.includes("payment") || type.includes("course_paid") ? "payments"
      : type.includes("meeting") ? "meetings"
      : type.includes("interest") ? "interested_posts"
      : type.includes("followed_post") || type.includes("new_post") ? "followed_posts" : null;
    if (prefs.email_enabled === false || (prefKey && prefs[prefKey] === false)) {
      return json({ skipped: true, reason: "Email notifications disabled by recipient preferences" });
    }
  }

  const { data: claimed, error: claimError } = await db.from("joint_notifications")
    .update({ email_status: "sending", email_error: null })
    .eq("id", notificationId).neq("email_status", "sent").neq("email_status", "sending")
    .select("id").maybeSingle();
  if (claimError) return json({ error: "Could not claim notification", details: claimError.message }, 500);
  if (!claimed) return json({ skipped: true, reason: "Already being processed or sent" });

  try {
    const { data: userData, error: userError } = await db.auth.admin.getUserById(recipientId);
    const email = userData?.user?.email;
    if (userError || !email) throw new Error(userError?.message || "Recipient has no email address");

    const title = String(notification.title || "New JOINT notification");
    const body = String(notification.body || "You have a new notification on JOINT.");
    const target = String(notification.target_url || "notifications.html");
    const siteUrl = (Deno.env.get("JOINT_SITE_URL") || "https://myjointapp.com").replace(/\/$/, "");
    const safeTarget = /^https:\/\//i.test(target) ? target : `${siteUrl}/${target.replace(/^\//, "")}`;
    const html = `<!doctype html><html><body style="margin:0;background:#f7f4fc;font-family:Arial,sans-serif;color:#211a2e"><div style="max-width:600px;margin:24px auto;padding:24px;background:#fff;border-radius:16px"><h1 style="color:#6938d1;margin-top:0">JOINT notification</h1><h2>${esc(title)}</h2><p style="font-size:16px;line-height:1.6">${esc(body)}</p><p><a href="${esc(safeTarget)}" style="display:inline-block;background:#6938d1;color:white;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:bold">Open JOINT</a></p><p style="color:#777;font-size:12px">You received this email because email notifications are enabled for your JOINT account.</p></div></body></html>`;
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [email], subject: title, html, tags: [
        { name: "category", value: "joint-notification" },
        { name: "notification_id", value: String(notificationId).slice(0, 256) },
      ] }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result?.message || result?.name || `Resend returned HTTP ${response.status}`);

    const { error: updateError } = await db.from("joint_notifications").update({
      email_status: "sent", email_error: null, email_sent_at: new Date().toISOString(),
    }).eq("id", notificationId);
    if (updateError) return json({ ok: true, warning: "Email was sent, but notification status could not be updated", details: updateError.message, resend_id: result?.id });
    return json({ ok: true, email_status: "sent", resend_id: result?.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.from("joint_notifications").update({ email_status: "failed", email_error: message.slice(0, 1000) }).eq("id", notificationId);
    return json({ error: "Email delivery failed", details: message }, 502);
  }
});
