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

type AnyRecord = Record<string, any>;
const URL_KEYS = [
  "attachment_url", "media_url", "file_url", "image_url", "video_url",
  "animation_url", "gif_url", "sticker_url", "url", "src",
];
const IMAGE_KEYS = [
  "image_url", "thumbnail_url", "poster_url", "preview_url",
  "attachment_thumbnail_url", "media_thumbnail_url",
];
const TYPE_KEYS = ["attachment_type", "media_type", "mime_type", "content_type", "type"];

function absoluteHttpUrl(value: unknown, siteUrl: string): string {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const url = new URL(value.trim(), siteUrl);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}
function findString(objects: AnyRecord[], keys: string[]): string {
  for (const object of objects) {
    for (const key of keys) {
      const value = object?.[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }
  return "";
}
function collectAttachmentObjects(value: unknown, output: AnyRecord[] = [], depth = 0): AnyRecord[] {
  if (depth > 5 || value == null) return output;
  if (Array.isArray(value)) {
    for (const item of value) collectAttachmentObjects(item, output, depth + 1);
    return output;
  }
  if (typeof value === "object") {
    const object = value as AnyRecord;
    output.push(object);
    for (const key of ["attachment", "attachments", "media", "file", "preview", "sticker", "metadata"]) {
      if (object[key] && typeof object[key] === "object") {
        collectAttachmentObjects(object[key], output, depth + 1);
      }
    }
  }
  return output;
}
function inferMediaType(url: string, suppliedType: string): string {
  if (suppliedType) return suppliedType.toLowerCase();
  const clean = url.split(/[?#]/)[0].toLowerCase();
  if (/\.(gif|apng|webp)$/.test(clean)) return "image/gif";
  if (/\.(png|jpe?g|bmp|avif|svg)$/.test(clean)) return "image";
  if (/\.(mp4|webm|mov|m4v|3gp|ogv)$/.test(clean)) return "video";
  return "";
}
function isImageType(type: string, url: string): boolean {
  return type.startsWith("image/") || type === "image" ||
    /\.(png|jpe?g|gif|apng|webp|bmp|avif)(?:[?#]|$)/i.test(url);
}
function isVideoType(type: string, url: string): boolean {
  return type.startsWith("video/") || type === "video" ||
    /\.(mp4|webm|mov|m4v|3gp|ogv)(?:[?#]|$)/i.test(url);
}

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
  const auth = req.headers.get("authorization") || "";
  if (auth !== `Bearer ${serviceKey}`) return json({ error: "Unauthorized" }, 401);

  let payload: AnyRecord;
  try { payload = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const row = payload.record && typeof payload.record === "object" ? payload.record : payload;
  const notificationId = row.id;
  if (!notificationId) return json({ error: "Missing notification record id" }, 400);

  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  // Select the full row so attachment columns added by the notification schema are not discarded.
  const { data: notification, error: notificationError } = await db.from("joint_notifications")
    .select("*").eq("id", notificationId).maybeSingle();
  if (notificationError) return json({ error: "Could not read notification", details: notificationError.message }, 500);
  if (!notification) return json({ skipped: true, reason: "Notification not found" });
  const recipientId = notification.recipient_user_id || notification.recipient_id;
  if (!recipientId) return json({ skipped: true, reason: "Notification has no recipient ID" });

  const { data: prefs, error: prefsError } = await db.from("joint_notification_preferences")
    .select("push_enabled, follows, messages, payments, meetings, courses")
    .eq("user_id", recipientId).maybeSingle();
  if (prefsError) return json({ error: "Could not read notification preferences", details: prefsError.message }, 500);
  if (prefs) {
    const type = String(notification.event_type || notification.notification_type || "system").toLowerCase();
    const prefKey = type.includes("follow") || type.includes("live") ? "follows"
      : type.includes("message") || type.includes("chat") ? "messages"
      : type.includes("diamond") || type.includes("payment") || type.includes("transaction") ? "payments"
      : type.includes("meeting") ? "meetings"
      : type.includes("course") || type.includes("lesson") || type.includes("class_start") ? "courses" : null;
    if (prefs.push_enabled === false || (prefKey && prefs[prefKey] === false)) {
      return json({ skipped: true, reason: "Push notifications disabled by recipient preferences" });
    }
  }

  const { data: subscriptions, error: subscriptionError } = await db.from("joint_push_subscriptions")
    .select("id, endpoint, subscription").eq("user_id", recipientId);
  if (subscriptionError) return json({ error: "Could not load push subscriptions", details: subscriptionError.message }, 500);
  if (!subscriptions?.length) return json({ ok: true, sent: 0, reason: "Recipient has no registered push devices" });

  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
  const siteUrl = (Deno.env.get("JOINT_SITE_URL") || "https://myjointapp.com").replace(/\/$/, "");
  const target = String(notification.target_url || "/notifications.html");
  const safeTarget = absoluteHttpUrl(target, siteUrl) || `${siteUrl}/${target.replace(/^\//, "")}`;

  const metadata = notification.metadata && typeof notification.metadata === "object"
    ? notification.metadata as AnyRecord : {};
  const attachmentObjects = collectAttachmentObjects(notification);
  collectAttachmentObjects(metadata, attachmentObjects);
  // Chat stickers are sometimes carried in the notification body as a JSON marker.
  const bodyText = String(notification.body || "");
  const stickerPrefix = "JOINT_CHAT_STICKER::";
  if (bodyText.startsWith(stickerPrefix)) {
    try { collectAttachmentObjects(JSON.parse(bodyText.slice(stickerPrefix.length)), attachmentObjects); }
    catch (_) { /* Ignore malformed sticker payloads and continue with normal notification data. */ }
  }
  // Keep profile avatar separate from the actual attachment.
  const rawMediaUrl = findString(attachmentObjects, URL_KEYS);
  const rawImageUrl = findString(attachmentObjects, IMAGE_KEYS);
  const suppliedType = findString(attachmentObjects, TYPE_KEYS);
  const mediaUrl = absoluteHttpUrl(rawMediaUrl, siteUrl);
  const imageCandidate = absoluteHttpUrl(rawImageUrl, siteUrl);
  const mediaType = inferMediaType(mediaUrl, suppliedType);
  const attachmentImage = imageCandidate || (isImageType(mediaType, mediaUrl) ? mediaUrl : "");
  const videoAttachment = isVideoType(mediaType, mediaUrl) ? mediaUrl : "";

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
  actorAvatar = absoluteHttpUrl(actorAvatar, siteUrl);

  const pushPayload = JSON.stringify({
    title: String(notification.title || "JOINT notification"),
    body: String(notification.body || "You have a new notification on JOINT."),
    url: safeTarget,
    // icon is the sender avatar; image is the actual image/GIF attachment.
    icon: actorAvatar || `${siteUrl}/icons/icon-192.png`,
    image: attachmentImage || undefined,
    media_url: mediaUrl || undefined,
    media_type: mediaType || undefined,
    video_url: videoAttachment || undefined,
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
      if (statusCode === 404 || statusCode === 410) {
        await db.from("joint_push_subscriptions").delete().eq("id", item.id);
      }
      console.error("JOINT push send failed", { subscriptionId: item.id, statusCode, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return json({
    ok: true, sent, failed, total: subscriptions.length,
    attachment: mediaUrl ? { type: mediaType || "unknown", image: !!attachmentImage, video: !!videoAttachment } : null,
  });
});
