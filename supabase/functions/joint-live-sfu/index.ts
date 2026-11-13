import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// JOINT Live only. This function does not call or modify JOINT Meetings.
const ALLOWED_ORIGINS = new Set(["https://myjointapp.com", "https://www.myjointapp.com"]);
const cors = (origin: string | null, requestedHeaders: string | null = null) => ({
  "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://myjointapp.com",
  "Access-Control-Allow-Headers": requestedHeaders || "authorization, x-client-info, apikey, content-type, x-supabase-api-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Max-Age": "86400", Vary: "Origin, Access-Control-Request-Headers",
});
const json = (body: unknown, status = 200, origin: string | null = null) => new Response(JSON.stringify(body), { status, headers: { ...cors(origin), "Content-Type": "application/json" } });
const clean = (v: unknown, max = 200) => String(v ?? "").trim().slice(0, max);

async function sfuRequest(appId: string, secret: string, path: string, method = "POST", body?: unknown) {
  const response = await fetch(`https://rtc.live.cloudflare.com/v1/apps/${encodeURIComponent(appId)}${path}`, {
    method,
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(25000),
  });
  const payload: any = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.errorDescription || payload.error || `Cloudflare Realtime request failed (${response.status}).`);
  return payload;
}

async function createTurnIceServers(turnKeyId: string, turnApiToken: string) {
  const response = await fetch(
    `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(turnKeyId)}/credentials/generate-ice-servers`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${turnApiToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ttl: 86400 }),
      signal: AbortSignal.timeout(15000),
    },
  );
  const payload: any = await response.json().catch(() => ({}));
  if (!response.ok || !Array.isArray(payload.iceServers) || payload.iceServers.length === 0) {
    console.error("Cloudflare TURN credential generation failed", response.status, payload);
    throw new Error(payload.errorDescription || payload.error || `Cloudflare TURN credential generation failed (${response.status}).`);
  }
  // Avoid the browser-incompatible alternate DNS port listed by Cloudflare.
  return payload.iceServers.map((server: any) => {
    const urls = (Array.isArray(server.urls) ? server.urls : [server.urls]).filter(Boolean)
      .filter((url: string) => !String(url).includes(":53?"));
    return { ...server, urls };
  }).filter((server: any) => Array.isArray(server.urls) && server.urls.length > 0);
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin, req.headers.get("access-control-request-headers")) });
  if (req.method !== "POST") return json({ ok: false, error: "POST required." }, 405, origin);
  if (origin && !ALLOWED_ORIGINS.has(origin)) return json({ ok: false, error: "Origin not allowed." }, 403, origin);

  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  const service = Deno.env.get("JOINT_SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const appId = Deno.env.get("CLOUDFLARE_REALTIME_APP_ID");
  const appSecret = Deno.env.get("CLOUDFLARE_REALTIME_APP_SECRET");
  if (!url || !anon || !service || !appId || !appSecret) {
    console.error("joint-live-sfu missing configuration", { url: !!url, anon: !!anon, service: !!service, appId: !!appId, appSecret: !!appSecret });
    return json({ ok: false, error: "JOINT Live SFU backend secrets are incomplete. Check the function's server-side environment variables." }, 503, origin);
  }

  const token = (req.headers.get("Authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return json({ ok: false, error: "Sign in to JOINT before connecting to Live." }, 401, origin);
  const userDb = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: auth, error: authError } = await userDb.auth.getUser(token);
  if (authError || !auth.user) return json({ ok: false, error: "Your JOINT session expired. Sign in again." }, 401, origin);
  const db = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });

  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, error: "Invalid JSON request." }, 400, origin); }
  const action = clean(body.action, 30);
  const liveId = clean(body.live_session_id, 80);
  if (!liveId || !/^[0-9a-f-]{36}$/i.test(liveId)) return json({ ok: false, error: "A valid JOINT Live session ID is required." }, 400, origin);

  try {
    const { data: live, error: liveError } = await db.from("joint_live_sessions")
      .select("id,host_user_id,audience,room_code,status")
      .eq("id", liveId).maybeSingle();
    if (liveError) throw liveError;
    if (!live || live.status !== "live") return json({ ok: false, error: "This JOINT Live session is not active." }, 404, origin);

    const { data: participant, error: participantError } = await db.from("joint_live_participants")
      .select("id,role,status,user_id").eq("session_id", liveId).eq("user_id", auth.user.id).limit(1).maybeSingle();
    if (participantError) throw participantError;
    const isHost = live.host_user_id === auth.user.id;
    const isConnectedParticipant = participant?.status === "connected" && (participant.role === "host" || participant.role === "guest");
    const isPublisher = isHost || isConnectedParticipant;

    // Enforce audience access before issuing or using any Cloudflare session.
    // joint_follows uses follower_id -> followed_user_id.
    const suppliedRoomCode = clean(body.room_code, 8).toUpperCase();
    if (live.audience === "invite" && !isHost && !isConnectedParticipant && suppliedRoomCode !== live.room_code) {
      return json({ ok: false, error: "This is a private live. Enter the correct invitation code." }, 403, origin);
    }
    if (live.audience === "followers" && !isHost && !isConnectedParticipant) {
      const { data: follow, error: followError } = await db.from("joint_follows")
        .select("follower_id")
        .eq("follower_id", auth.user.id)
        .eq("followed_user_id", live.host_user_id)
        .maybeSingle();
      if (followError) {
        console.error("JOINT Live follower authorization lookup failed", followError.message);
        return json({ ok: false, error: "Could not verify follower access. Please try again later." }, 503, origin);
      }
      if (!follow) return json({ ok: false, error: "Only followers of this host can watch this live." }, 403, origin);
    }
    if (action === "create-session") {
      if (!isPublisher && live.audience !== "public" && live.audience !== "followers") return json({ ok: false, error: "You are not allowed to connect to this live session." }, 403, origin);
      // Accept the existing JOINT/Supabase secret names as well as the
      // alternate names used in earlier setup instructions. Values remain
      // server-side and are never returned to the browser.
      const turnKeyId = Deno.env.get("CLOUDFLARE_TURN_TOKEN_ID") || Deno.env.get("CLOUDFLARE_TURN_KEY_ID");
      const turnApiToken = Deno.env.get("CLOUDFLARE_TURN_API_TOKEN") || Deno.env.get("CLOUDFLARE_TURN_KEY_API_TOKEN");
      if (!turnKeyId || !turnApiToken) {
        return json({ ok: false, error: "JOINT Live TURN relay secrets are missing. Expected CLOUDFLARE_TURN_TOKEN_ID and CLOUDFLARE_TURN_API_TOKEN (or the equivalent CLOUDFLARE_TURN_KEY_ID and CLOUDFLARE_TURN_KEY_API_TOKEN)." }, 503, origin);
      }
      const iceServers = await createTurnIceServers(turnKeyId, turnApiToken);
      // Read the previous per-user SFU connection before replacing it. Android
      // tab suspension/reload can leave an old Cloudflare session behind.
      const { data: previous, error: previousError } = await db.from("joint_live_sfu_connections")
        .select("cloudflare_session_id,track_names")
        .eq("live_session_id", liveId).eq("user_id", auth.user.id).maybeSingle();
      if (previousError) throw previousError;
      const sfu = await sfuRequest(appId, appSecret, "/sessions/new", "POST");
      if (!sfu.sessionId) throw new Error("Cloudflare did not return a new live connection ID.");
      const row = { live_session_id: liveId, user_id: auth.user.id, role: isPublisher ? (isHost ? "host" : participant?.role || "guest") : "viewer", cloudflare_session_id: sfu.sessionId, track_names: [], updated_at: new Date().toISOString() };
      const { error: saveError } = await db.from("joint_live_sfu_connections").upsert(row, { onConflict: "live_session_id,user_id" });
      if (saveError) {
        try { await sfuRequest(appId, appSecret, `/sessions/${encodeURIComponent(sfu.sessionId)}/tracks/close`, "PUT", { tracks: [] }); } catch (_) {}
        throw saveError;
      }
      // Close the old Cloudflare media tracks only after the new connection
      // has been persisted successfully, so a failed replacement cannot strand
      // the user's existing publication.
      if (previous?.cloudflare_session_id && previous.cloudflare_session_id !== sfu.sessionId) {
        try {
          const oldTracks = Array.isArray(previous.track_names) ? previous.track_names.map((trackName: string) => ({ trackName })) : [];
          await sfuRequest(appId, appSecret, `/sessions/${encodeURIComponent(previous.cloudflare_session_id)}/tracks/close`, "PUT", { tracks: oldTracks });
        } catch (cleanupError) {
          console.warn("Could not close previous JOINT Live SFU connection", cleanupError instanceof Error ? cleanupError.message : cleanupError);
        }
      }
      return json({ ok: true, session_id: sfu.sessionId, role: row.role, iceServers }, 200, origin);
    }

    const { data: connection, error: connectionError } = await db.from("joint_live_sfu_connections")
      .select("id,live_session_id,user_id,role,cloudflare_session_id,track_names")
      .eq("live_session_id", liveId).eq("user_id", auth.user.id).maybeSingle();
    if (connectionError) throw connectionError;
    if (!connection) return json({ ok: false, error: "Create your Cloudflare Live connection first." }, 409, origin);
    const cloudSession = encodeURIComponent(connection.cloudflare_session_id);

    if (action === "publish") {
      if (!isPublisher || !["host", "guest"].includes(connection.role)) return json({ ok: false, error: "Only the host and accepted on-screen guest can publish media." }, 403, origin);
      const description = body.session_description;
      const tracks = Array.isArray(body.tracks) ? body.tracks : [];
      if (!description || description.type !== "offer" || typeof description.sdp !== "string" || !tracks.length || tracks.length > 4) return json({ ok: false, error: "A valid WebRTC offer and one to four local track descriptors are required." }, 400, origin);
      for (const track of tracks) if (track.location !== "local" || !/^[0-9]{1,3}$/.test(String(track.mid)) || !["camera", "microphone", "screen"].includes(String(track.trackName))) return json({ ok: false, error: "Invalid local track descriptor." }, 400, origin);
      const result = await sfuRequest(appId, appSecret, `/sessions/${cloudSession}/tracks/new`, "POST", { sessionDescription: description, tracks });
      const successfulNames = (result.tracks || []).filter((t: any) => !t.errorCode && !t.error).map((t: any) => t.trackName).filter(Boolean);
      const names = [...new Set([...(connection.track_names || []), ...successfulNames])];
      const { error: updateError } = await db.from("joint_live_sfu_connections").update({ track_names: names, updated_at: new Date().toISOString() }).eq("id", connection.id);
      if (updateError) throw updateError;
      return json({ ok: true, ...result }, 200, origin);
    }

    if (action === "subscribe") {
      const publisherUserId = clean(body.publisher_user_id, 80);
      if (!publisherUserId || !/^[0-9a-f-]{36}$/i.test(publisherUserId)) return json({ ok: false, error: "A valid publisher user ID is required." }, 400, origin);
      if (publisherUserId === auth.user.id) return json({ ok: false, error: "You cannot subscribe to your own publication." }, 400, origin);
      const { data: publisher, error: publisherError } = await db.from("joint_live_sfu_connections")
        .select("user_id,role,cloudflare_session_id,track_names")
        .eq("live_session_id", liveId).eq("user_id", publisherUserId).maybeSingle();
      if (publisherError) throw publisherError;
      if (!publisher || !["host", "guest"].includes(publisher.role) || !Array.isArray(publisher.track_names) || publisher.track_names.length === 0) return json({ ok: false, error: "The host or guest has not published media yet." }, 409, origin);
      const tracks = publisher.track_names.map((trackName: string) => ({ location: "remote", sessionId: publisher.cloudflare_session_id, trackName }));
      const result = await sfuRequest(appId, appSecret, `/sessions/${cloudSession}/tracks/new`, "POST", { tracks });
      return json({ ok: true, ...result }, 200, origin);
    }

    if (action === "renegotiate") {
      const description = body.session_description;
      if (!description || description.type !== "answer" || typeof description.sdp !== "string") return json({ ok: false, error: "A valid WebRTC answer is required." }, 400, origin);
      const result = await sfuRequest(appId, appSecret, `/sessions/${cloudSession}/renegotiate`, "PUT", { sessionDescription: description });
      return json({ ok: true, ...result }, 200, origin);
    }

    if (action === "close") {
      const result = await sfuRequest(appId, appSecret, `/sessions/${cloudSession}/tracks/close`, "PUT", { tracks: (connection.track_names || []).map((trackName: string) => ({ trackName })) });
      await db.from("joint_live_sfu_connections").delete().eq("id", connection.id);
      return json({ ok: true, result }, 200, origin);
    }

    return json({ ok: false, error: "Unknown JOINT Live SFU action." }, 400, origin);
  } catch (error) {
    console.error("joint-live-sfu", error instanceof Error ? error.message : error);
    return json({ ok: false, error: error instanceof Error ? error.message : "Unexpected JOINT Live SFU error." }, 500, origin);
  }
});
