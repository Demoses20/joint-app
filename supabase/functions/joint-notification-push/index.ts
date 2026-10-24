import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, "Content-Type": "application/json" },
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("JOINT_SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const vapidPublicKey = Deno.env.get("JOINT_VAPID_PUBLIC_KEY");
  const vapidPrivateKey = Deno.env.get("JOINT_VAPID_PRIVATE_KEY");
  const vapidSubject = Deno.env.get("JOINT_VAPID_SUBJECT") || "mailto:notifications@myjointapp.com";
  if (!supabaseUrl || !serviceKey || !vapidPublicKey || !vapidPrivateKey) {
    return json({ error: "Missing server configuration: Supabase service key and JOINT_VAPID_PUBLIC_KEY / JOINT_VAPID_PRIVATE_KEY are required." }, 500);
  }
  // Configure the Database Webhook Authorization header as: Bearer <same service key>.
  const auth = req.headers.get("authorization") || "";
  if (auth !== `Bearer ${serviceKey}`) return json({ error: "Unauthorized" }, 401);

  let payload: Record<string, any>;
  try { payload = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const row = payload.record && typeof payload.record === "object" ? payload.record : payload;
  const notificationId = row.id;
  if (!notificationId) return json({ error: "Missing notification record id" }, 400);

  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: notification, error: notificationError } = await db.from("joint_notifications")
    .select("id, recipient_user_id, recipient_id, actor_user_id, actor_id, title, body, target_url, event_type, notification_type, entity_type, entity_id, metadata")
    .eq("id", notificationId).maybeSingle();
  if (notificationError) return json({ error: "Could not read notification", details: notificationError.message }, 500);
  if (!notification) return json({ skipped: true, reason: "Notification not found" });
  const recipientId = notification.recipient_user_id || notification.recipient_id;
  if (!recipientId) return json({ skipped: true, reason: "Notification has no recipient ID" });

  const { data: subscriptions, error: subscriptionError } = await db.from("joint_push_subscriptions")
    .select("id, endpoint, subscription").eq("user_id", recipientId);
  if (subscriptionError) return json({ error: "Could not load push subscriptions", details: subscriptionError.message }, 500);
  if (!subscriptions?.length) return json({ ok: true, sent: 0, reason: "Recipient has no registered push devices" });

  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
  const siteUrl = (Deno.env.get("JOINT_SITE_URL") || "https://myjointapp.com").replace(/\/$/, "");
  const target = String(notification.target_url || "/notifications.html");
  const safeTarget = /^https:\/\//i.test(target) ? target : `${siteUrl}/${target.replace(/^\//, "")}`;
  // Resolve the actor's actual profile image server-side. Notification metadata is
  // often empty for follow events, so use the actor IDs stored on the notification.
  const metadata = notification.metadata && typeof notification.metadata === "object"
    ? notification.metadata as Record<string, unknown> : {};
  const actorId = notification.actor_user_id || notification.actor_id ||
    (typeof metadata.actor_user_id === "string" ? metadata.actor_user_id : null) ||
    (typeof metadata.actor_id === "string" ? metadata.actor_id : null);
  let actorAvatar = typeof metadata.actor_avatar_url === "string" ? metadata.actor_avatar_url :
    typeof metadata.avatar_url === "string" ? metadata.avatar_url : "";
  if (actorId) {
    const { data: actorProfile, error: actorProfileError } = await db.from("joint_profiles")
      .select("id, avatar_url").eq("id", actorId).maybeSingle();
    if (actorProfileError) console.warn("JOINT push actor profile lookup failed", actorProfileError.message);
    if (actorProfile?.avatar_url) actorAvatar = String(actorProfile.avatar_url);
  }
  // Only pass absolute HTTP(S) URLs to the browser notification API.
  if (!/^https?:\/\//i.test(actorAvatar)) actorAvatar = "";

  const pushPayload = JSON.stringify({
    title: String(notification.title || "JOINT notification"),
    body: String(notification.body || "You have a new notification on JOINT."),
    url: safeTarget,
    icon: actorAvatar || `${siteUrl}/icons/icon-192.png`,
    image: actorAvatar || undefined,
    avatar_url: actorAvatar || undefined,
    actor_id: actorId || undefined,
    notification_id: String(notification.id),
    tag: `joint-${String(notification.id)}`,
  });

  let sent = 0;
  let failed = 0;
  for (const item of subscriptions) {
    try {
      await webpush.sendNotification(item.subscription, pushPayload, { TTL: 60 * 60 * 24 });
      sent++;
    } catch (error) {
      failed++;
      const statusCode = Number((error as any)?.statusCode || 0);
      // Remove expired/unsubscribed endpoints; retain temporary failures for retry.
      if (statusCode === 404 || statusCode === 410) {
        await db.from("joint_push_subscriptions").delete().eq("id", item.id);
      }
      console.error("JOINT push send failed", { subscriptionId: item.id, statusCode, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return json({ ok: true, sent, failed, total: subscriptions.length });
});
