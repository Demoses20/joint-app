import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
import { SignJWT, importPKCS8 } from "npm:jose@5.9.6";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, "Content-Type": "application/json" },
});

let cachedFcmAccessToken: { value: string; expiresAt: number } | null = null;
async function getFcmAccessToken(serviceAccount: Record<string, string>): Promise<string> {
  if (cachedFcmAccessToken && cachedFcmAccessToken.expiresAt > Date.now() + 60_000) return cachedFcmAccessToken.value;
  const key = await importPKCS8(serviceAccount.private_key, "RS256");
  const assertion = await new SignJWT({ scope: "https://www.googleapis.com/auth/firebase.messaging" })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(serviceAccount.client_email)
    .setSubject(serviceAccount.client_email)
    .setAudience("https://oauth2.googleapis.com/token")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(key);
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  const result = await response.json();
  if (!response.ok || !result.access_token) throw new Error(`Firebase OAuth failed: ${JSON.stringify(result)}`);
  cachedFcmAccessToken = { value: result.access_token, expiresAt: Date.now() + Number(result.expires_in || 3600) * 1000 };
  return cachedFcmAccessToken.value;
}

type AnyRecord = Record<string, any>;
function asObject(value: unknown): AnyRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as AnyRecord : {};
}
function firstString(objects: AnyRecord[], keys: string[]): string {
  for (const object of objects) for (const key of keys) {
    const value = object?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}
function safeHttpUrl(raw: unknown, base: string): string {
  if (typeof raw !== "string" || !raw.trim()) return "";
  try {
    const u = new URL(raw.trim(), base);
    return (u.protocol === "https:" || u.protocol === "http:") ? u.href : "";
  } catch { return ""; }
}
function stickerFromBody(body: string): AnyRecord | null {
  const marker = "JOINT_CHAT_STICKER::";
  const index = body.indexOf(marker);
  if (index < 0) return null;
  const raw = body.slice(index + marker.length).trim();
  try { return asObject(JSON.parse(raw)); } catch { return null; }
}
function thumbnailPathFromBody(body: string): string {
  const marker = "JOINT_CHAT_THUMBNAIL::";
  const index = body.lastIndexOf(marker);
  if (index < 0) return "";
  return body.slice(index + marker.length).trim().split(/\s/)[0] || "";
}
function cleanMessageBody(raw: string, isSticker: boolean): string {
  if (/sent (you )?a sticker\s*$/i.test(raw.trim()) && !raw.includes("JOINT_CHAT_STICKER::")) return raw.trim();
  if (isSticker || raw.includes("JOINT_CHAT_STICKER::")) {
    const prefix = raw.split("JOINT_CHAT_STICKER::")[0].trim().replace(/[:\-–—]+$/, "").trim();
    return prefix ? `${prefix}: sent a sticker` : "Sent you a sticker";
  }
  return raw.replace(/^\s*[^:]{1,100}:\s*JOINT_CHAT_STICKER::[\s\S]*$/, "Sent you a sticker")
    .replace(/\s*JOINT_CHAT_THUMBNAIL::[^\s]+/g, "").trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("JOINT_SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const vapidPublicKey = Deno.env.get("JOINT_VAPID_PUBLIC_KEY");
  const vapidPrivateKey = Deno.env.get("JOINT_VAPID_PRIVATE_KEY");
  const vapidSubject = Deno.env.get("JOINT_VAPID_SUBJECT") || "mailto:notifications@myjointapp.com";
  const firebaseServiceAccountRaw = Deno.env.get("JOINT_FIREBASE_SERVICE_ACCOUNT");
  if (!supabaseUrl || !serviceKey) return json({ error: "Missing Supabase URL or service role key." }, 500);
  if (!(vapidPublicKey && vapidPrivateKey) && !firebaseServiceAccountRaw) {
    return json({ error: "Configure VAPID secrets for Web Push and/or JOINT_FIREBASE_SERVICE_ACCOUNT for Android FCM." }, 500);
  }
  const auth = req.headers.get("authorization") || "";
  if (auth !== `Bearer ${serviceKey}`) return json({ error: "Unauthorized" }, 401);

  let payload: AnyRecord;
  try { payload = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const row = payload.record && typeof payload.record === "object" ? payload.record : payload;
  const notificationId = row.id;
  if (!notificationId) return json({ error: "Missing notification record id" }, 400);

  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: notification, error: notificationError } = await db.from("joint_notifications")
    .select("id, created_at, recipient_user_id, recipient_id, actor_user_id, actor_id, title, body, target_url, event_type, notification_type, entity_type, entity_id, metadata")
    .eq("id", notificationId).maybeSingle();
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
  if (subscriptionError) return json({ error: "Could not load Web Push subscriptions", details: subscriptionError.message }, 500);
  const { data: fcmDeviceRows, error: fcmError } = await db.from("joint_fcm_tokens")
    .select("id, token").eq("user_id", recipientId);
  const fcmTableMissing = !!fcmError && (
    fcmError.code === "42P01" || fcmError.code === "PGRST205" ||
    /does not exist|schema cache|could not find the table/i.test(String(fcmError.message || ""))
  );
  if (fcmError && !fcmTableMissing) return json({ error: "Could not load FCM tokens", details: fcmError.message }, 500);
  if (fcmTableMissing) console.error("JOINT FCM token table is missing; Android push cannot be delivered until joint_fcm_tokens is restored.");
  const fcmDevices = fcmTableMissing ? [] : (fcmDeviceRows || []);
  if (!subscriptions?.length && !fcmDevices.length) {
    return json({ ok: true, web_push_sent: 0, fcm_sent: 0, reason: "Recipient has no registered push devices" });
  }

  if (vapidPublicKey && vapidPrivateKey) webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
  const siteUrl = (Deno.env.get("JOINT_SITE_URL") || "https://myjointapp.com").replace(/\/$/, "");
  const target = String(notification.target_url || "/notifications.html");
  const safeTarget = /^https:\/\//i.test(target) ? target : `${siteUrl}/${target.replace(/^\//, "")}`;
  const metadata = asObject(notification.metadata);
  const nestedAttachment = asObject(metadata.attachment || metadata.media || metadata.file);
  const actorId = notification.actor_user_id || notification.actor_id ||
    (typeof metadata.actor_user_id === "string" ? metadata.actor_user_id : null) ||
    (typeof metadata.actor_id === "string" ? metadata.actor_id : null);
  let actorAvatar = firstString([metadata], ["actor_avatar_url", "avatar_url"]);
  if (actorId) {
    const { data: actorProfile, error: actorProfileError } = await db.from("joint_profiles")
      .select("id, avatar_url").eq("id", actorId).maybeSingle();
    if (actorProfileError) console.warn("JOINT push actor profile lookup failed", actorProfileError.message);
    if (actorProfile?.avatar_url) actorAvatar = String(actorProfile.avatar_url);
  }
  if (!/^https?:\/\//i.test(actorAvatar)) actorAvatar = "";

  // Resolve the originating chat message. In JOINT, entity_id may be either
  // a message ID or a conversation ID depending on the notification producer.
  // Try the explicit message ID first, then fall back to the sender/recipient
  // conversation so sticker JSON and private media_path values are still found.
  let message: AnyRecord = {};
  const notificationBodyRaw = String(notification.body || "");
  const eventText = `${notification.event_type || ""} ${notification.notification_type || ""} ${notification.entity_type || ""}`.toLowerCase();
  const bodyLooksLikeAttachment = /\.(png|jpe?g|gif|webp|avif|mp4|webm|mov|m4v)(?:\s|$|[?#])/i.test(notificationBodyRaw);
  const bodyLooksLikeSticker = /sent (?:you )?a sticker|sticker|JOINT_CHAT_STICKER::/i.test(notificationBodyRaw);
  const isChatNotification = eventText.includes("message") || eventText.includes("chat") || bodyLooksLikeAttachment || bodyLooksLikeSticker;
  const explicitMessageId = firstString([metadata], ["message_id", "chat_message_id"]) ||
    (isChatNotification && !String(notification.entity_type || "").toLowerCase().includes("conversation")
      ? String(notification.entity_id || "") : "");
  if (explicitMessageId) {
    const { data, error } = await db.from("joint_messages")
      .select("id, conversation_id, body, message_type, media_path, media_url, sender_id, created_at")
      .eq("id", explicitMessageId).maybeSingle();
    if (error) console.warn("JOINT push message lookup failed", error.message);
    if (data) message = data;
  }

  if (!message.id && isChatNotification) {
    const conversationIds = new Set<string>();
    const explicitConversationId = firstString([metadata], ["conversation_id", "chat_conversation_id"]) ||
      (String(notification.entity_type || "").toLowerCase().includes("conversation") ? String(notification.entity_id || "") : "");
    if (explicitConversationId) conversationIds.add(explicitConversationId);

    // First trust a conversation ID supplied by the notification. Otherwise find
    // the recipient's direct conversations, regardless of participant ordering.
    if (!conversationIds.size) {
      const [forward, reverse] = await Promise.all([
        db.from("joint_conversations").select("id")
          .eq("user1_id", recipientId).limit(100),
        db.from("joint_conversations").select("id")
          .eq("user2_id", recipientId).limit(100),
      ]);
      if (forward.error) console.warn("JOINT push conversation lookup failed", forward.error.message);
      if (reverse.error) console.warn("JOINT push conversation lookup failed", reverse.error.message);
      for (const row of [...(forward.data || []), ...(reverse.data || [])]) {
        if (row?.id) conversationIds.add(String(row.id));
      }
    }

    if (conversationIds.size) {
      let query = db.from("joint_messages")
        .select("id, conversation_id, body, message_type, media_path, media_url, sender_id, created_at")
        .in("conversation_id", [...conversationIds])
        .order("created_at", { ascending: false })
        .limit(100);
      if (actorId) query = query.eq("sender_id", actorId);
      else query = query.neq("sender_id", recipientId);
      if (notification.created_at) query = query.lte("created_at", String(notification.created_at));
      const { data: recentMessages, error } = await query;
      if (error) {
        console.warn("JOINT push recent message lookup failed", error.message);
      } else if (recentMessages?.length) {
        const candidates = recentMessages.filter((candidate: AnyRecord) => {
          const body = String(candidate.body || "");
          return body.includes("JOINT_CHAT_STICKER::") || !!candidate.media_path || !!candidate.media_url ||
            ["image", "video", "audio"].includes(String(candidate.message_type || "").toLowerCase());
        });
        const notificationText = notificationBodyRaw.toLowerCase();
        const fileNames = [...notificationText.matchAll(/([a-z0-9_ .()\-]+\.(?:png|jpe?g|gif|webp|avif|mp4|webm|mov|m4v))/gi)]
          .map((match: RegExpMatchArray) => match[1].trim()).filter(Boolean);
        const bodyFileMatch = candidates.find((candidate: AnyRecord) => {
          const candidateBody = String(candidate.body || "").split("JOINT_CHAT_THUMBNAIL::")[0].trim().toLowerCase();
          return fileNames.some((name: string) => candidateBody.includes(name) || name.includes(candidateBody));
        });
        const stickerMatch = candidates.find((candidate: AnyRecord) => String(candidate.body || "").includes("JOINT_CHAT_STICKER::"));
        // Match the exact attachment filename first. For sticker notifications,
        // never substitute a normal image/video from the conversation.
        message = bodyFileMatch || (bodyLooksLikeSticker ? stickerMatch : null) ||
          (bodyLooksLikeAttachment ? candidates[0] : null) || {};
      }
    }
  }

  const messageBody = String(message.body || notification.body || "");
  const sticker = stickerFromBody(messageBody) || asObject(metadata.sticker);
  const sourceObjects = [nestedAttachment, sticker, metadata];
  let attachmentUrl = firstString(sourceObjects, [
    "attachment_url", "media_url", "file_url", "image_url", "video_url",
    "animation_url", "gif_url", "sticker_url", "url", "src",
  ]);
  const mediaPath = String(message.media_path || firstString(sourceObjects, ["media_path", "storage_path", "file_path"]));
  if (!attachmentUrl && mediaPath) {
    const bucket = String(firstString(sourceObjects, ["bucket", "storage_bucket"]) || "joint-chat-media");
    const { data: signed, error } = await db.storage.from(bucket).createSignedUrl(mediaPath, 60 * 60 * 24 * 3);
    if (error) console.warn("JOINT push attachment signing failed", { bucket, message: error.message });
    else attachmentUrl = signed?.signedUrl || "";
  }
  if (!attachmentUrl && message.media_url) attachmentUrl = String(message.media_url);
  attachmentUrl = safeHttpUrl(attachmentUrl, siteUrl);

  // message_type is "text" for sticker rows, so use the sticker's MIME type
  // before falling back to the database message_type.
  const attachmentType = String(
    firstString(sourceObjects, ["media_type", "attachment_type", "mime_type", "content_type", "type"]) ||
    (/\.(gif)(?:[?#]|$)/i.test(attachmentUrl) ? "image/gif" :
      /\.(png|jpe?g|webp|bmp|avif)(?:[?#]|$)/i.test(attachmentUrl) ? "image" :
      /\.(mp4|webm|mov|m4v)(?:[?#]|$)/i.test(attachmentUrl) ? "video" :
      message.message_type || "")
  ).toLowerCase();
  const isVideo = attachmentType.includes("video") || /\.(mp4|webm|mov|m4v)(?:[?#]|$)/i.test(attachmentUrl);
  const thumbnailPath = firstString(sourceObjects, ["thumbnail_path", "preview_path", "poster_path"]) || thumbnailPathFromBody(messageBody);
  let signedThumbnailUrl = "";
  if (thumbnailPath) {
    const thumbnailBucket = String(firstString(sourceObjects, ["thumbnail_bucket", "preview_bucket"]) || "joint-chat-media");
    const { data: thumbnail, error: thumbnailError } = await db.storage.from(thumbnailBucket).createSignedUrl(thumbnailPath, 60 * 60 * 24 * 3);
    if (thumbnailError) console.warn("JOINT push thumbnail signing failed", { bucket: thumbnailBucket, message: thumbnailError.message });
    else signedThumbnailUrl = thumbnail?.signedUrl || "";
  }
  const explicitPreview = firstString(sourceObjects, ["thumbnail_url", "poster_url", "preview_url", "attachment_thumbnail_url", "media_thumbnail_url"]);
  const previewUrl = safeHttpUrl(explicitPreview, siteUrl) || safeHttpUrl(signedThumbnailUrl, siteUrl) || (!isVideo && attachmentUrl ? attachmentUrl : "");
  const hasSticker = !!sticker.media_url || messageBody.includes("JOINT_CHAT_STICKER::");
  const notificationBody = cleanMessageBody(String(notification.body || messageBody || "You have a new notification on JOINT."), hasSticker);

  const commonData = {
    title: String(notification.title || "JOINT notification"),
    body: notificationBody || "You have a new notification on JOINT.",
    url: safeTarget,
    notification_id: String(notification.id),
    actor_avatar_url: actorAvatar,
    attachment_url: attachmentUrl,
    attachment_type: attachmentType,
    attachment_preview_url: previewUrl,
    attachment_name: firstString(sourceObjects, ["attachment_name", "file_name", "name"]),
  };

  const pushPayload = JSON.stringify({
    ...commonData,
    icon: actorAvatar || `${siteUrl}/icons/icon-192.png`,
    avatar_url: actorAvatar || undefined,
    image: previewUrl || undefined,
    tag: `joint-${String(notification.id)}`,
  });

  let sent = 0, failed = 0;
  if (vapidPublicKey && vapidPrivateKey) for (const item of (subscriptions || [])) {
    try {
      await webpush.sendNotification(item.subscription, pushPayload, { TTL: 60 * 60 * 24 });
      sent++;
    } catch (error) {
      failed++;
      const statusCode = Number((error as any)?.statusCode || 0);
      if (statusCode === 404 || statusCode === 410) await db.from("joint_push_subscriptions").delete().eq("id", item.id);
      console.error("JOINT Web Push send failed", { subscriptionId: item.id, statusCode, message: error instanceof Error ? error.message : String(error) });
    }
  }

  // Keep native Android FCM delivery independent from browser Web Push.
  let fcmSent = 0, fcmFailed = 0;
  if (firebaseServiceAccountRaw && fcmDevices.length) {
    try {
      const account = JSON.parse(firebaseServiceAccountRaw);
      const accessToken = await getFcmAccessToken(account);
      const projectId = account.project_id;
      for (const device of fcmDevices) {
        try {
          const response = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
            method: "POST",
            headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({ message: {
              token: device.token,
              data: Object.fromEntries(Object.entries(commonData).map(([key, value]) => [key, String(value ?? "")])),
              android: { priority: "high" },
            } }),
          });
          if (response.ok) fcmSent++;
          else {
            fcmFailed++;
            const detail = await response.json().catch(() => ({}));
            const errorCode = detail?.error?.details?.find?.((d: any) => d.errorCode)?.errorCode || detail?.error?.status;
            if (errorCode === "UNREGISTERED" || errorCode === "INVALID_ARGUMENT") {
              if (errorCode === "UNREGISTERED") await db.from("joint_fcm_tokens").delete().eq("id", device.id);
            }
            console.error("JOINT FCM send failed", { deviceId: device.id, status: response.status, detail });
          }
        } catch (error) {
          fcmFailed++;
          console.error("JOINT FCM device send failed", { deviceId: device.id, error: error instanceof Error ? error.message : String(error) });
        }
      }
    } catch (error) {
      fcmFailed += fcmDevices.length;
      console.error("JOINT FCM configuration/send failure", error instanceof Error ? error.message : String(error));
    }
  }
  return json({
    ok: true, web_push_sent: sent, web_push_failed: failed,
    fcm_sent: fcmSent, fcm_failed: fcmFailed,
    web_push_total: subscriptions?.length || 0, fcm_total: fcmDevices.length,
    attachment_found: !!attachmentUrl, attachment_type: attachmentType || null,
    attachment_preview_found: !!previewUrl, message_found: !!message.id,
  });
});
