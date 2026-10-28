import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status: number, message: string) => new Response(JSON.stringify({ error: message }), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, "POST is required.");

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const processorUrl = Deno.env.get("JOINT_MEDIA_PROCESSOR_URL");
  const processorKey = Deno.env.get("JOINT_MEDIA_PROCESSOR_KEY");
  if (!supabaseUrl || !anonKey || !processorUrl || !processorKey) {
    return json(503, "Branded media processing is not fully configured. Contact the JOINT administrator.");
  }

  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return json(401, "Sign in to download branded media.");
  const supabase = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return json(401, "Your session has expired. Sign in again.");

  let mediaUrl = "";
  let mediaType = "";
  let creator = "JOINT Creator";
  let sourceBlob: Blob;
  let contentType = "";
  try {
    const reqType = req.headers.get("content-type") || "";
    if (reqType.includes("multipart/form-data")) {
      const incoming = await req.formData();
      const file = incoming.get("file");
      mediaType = String(incoming.get("media_type") || "").toLowerCase();
      creator = String(incoming.get("creator") || "JOINT Creator").slice(0, 80);
      if (!(file instanceof File)) return json(400, "A media file is required.");
      if (!(["image", "video"].includes(mediaType))) return json(400, "A valid media type is required.");
      if (!file.size) return json(422, "The original media file is empty.");
      if (file.size > 50 * 1024 * 1024) return json(413, "Media files must be 50 MB or smaller.");
      contentType = file.type || (mediaType === "image" ? "image/jpeg" : "video/mp4");
      if (mediaType === "video" && contentType === "application/octet-stream") contentType = "video/mp4";
      if (mediaType === "image" && !contentType.startsWith("image/")) return json(415, "The selected file is not an image.");
      if (mediaType === "video" && !(contentType.startsWith("video/") || contentType === "application/octet-stream")) return json(415, "The selected file is not a video.");
      sourceBlob = file;
    } else {
      let body: { media_url?: string; media_type?: string; creator?: string };
      try { body = await req.json(); } catch { return json(400, "Invalid request body."); }
      mediaUrl = String(body.media_url || "");
      mediaType = String(body.media_type || "").toLowerCase();
      creator = String(body.creator || "JOINT Creator").slice(0, 80);
      if (!mediaUrl || !["image", "video"].includes(mediaType)) return json(400, "A media URL and valid media type are required.");

      // Accept JOINT Storage and public HTTPS media. Validate every redirect hop before fetching it.
      const expectedHost = new URL(supabaseUrl).host;
      const isPublicHttps = (url: URL) => {
        const hostname = url.hostname.toLowerCase();
        const ipv4 = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
        const blockedIPv4 = ipv4 && (() => {
          const [a,b] = ipv4.slice(1).map(Number);
          return [a,b].some(n => n > 255) || a === 0 || a === 10 || a === 127 ||
            (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
            (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
        })();
        const blockedHost = !hostname || hostname === "localhost" || hostname.endsWith(".localhost") ||
          hostname.endsWith(".local") || hostname.endsWith(".internal") || Boolean(blockedIPv4) ||
          hostname === "::1" || hostname.startsWith("fc") || hostname.startsWith("fd") || hostname.startsWith("fe80:");
        return url.protocol === "https:" && !url.username && !url.password && !blockedHost && hostname.includes(".");
      };
      let current: URL;
      try { current = new URL(mediaUrl); } catch { return json(400, "Invalid media URL."); }
      const allowedStoragePath = current.hostname === expectedHost &&
        (current.pathname.startsWith("/storage/v1/object/public/joint-post-media/") || current.pathname.startsWith("/storage/v1/object/sign/joint-post-media/"));
      if (!isPublicHttps(current) && !allowedStoragePath) return json(400, "Use a public HTTPS image or video URL. Private or local addresses are not allowed.");
      let source: Response | null = null;
      for (let hop = 0; hop <= 4; hop++) {
        if (!isPublicHttps(current) && !(current.hostname === expectedHost && current.pathname.startsWith("/storage/v1/object/"))) return json(400, "The media URL redirected to a blocked address.");
        source = await fetch(current.toString(), { redirect: "manual", signal: AbortSignal.timeout(45_000) });
        if ([301, 302, 303, 307, 308].includes(source.status)) {
          const location = source.headers.get("location");
          if (!location || hop === 4) return json(422, "The media host redirected too many times.");
          try { current = new URL(location, current); } catch { return json(422, "The media host returned an invalid redirect."); }
          continue;
        }
        break;
      }
      if (!source || !source.ok) return json(422, "The original post media could not be accessed by the JOINT processor.");
      const contentLength = Number(source.headers.get("content-length") || 0);
      if (contentLength > 50 * 1024 * 1024) return json(413, "Media files must be 50 MB or smaller.");
      sourceBlob = await source.blob();
      if (!sourceBlob.size) return json(422, "The original media file is empty.");
      if (sourceBlob.size > 50 * 1024 * 1024) return json(413, "Media files must be 50 MB or smaller.");
      contentType = (source.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
      if (mediaType === "image" && !contentType.startsWith("image/")) return json(415, "The selected file is not an image.");
      // Some CDNs use application/octet-stream for playable video files; FFmpeg will probe the content.
      if (mediaType === "video" && !(contentType.startsWith("video/") || contentType === "application/octet-stream" || !contentType)) return json(415, "The selected file is not a video.");
    }

    const form = new FormData();
    const processorBlob = mediaType === "video" && (!contentType || contentType === "application/octet-stream") ? new Blob([sourceBlob], { type: "video/mp4" }) : sourceBlob;
    form.append("file", processorBlob, mediaType === "image" ? "joint-source-image.jpg" : "joint-source-video.mp4");
    form.append("media_type", mediaType);
    form.append("creator", creator);
    const processed = await fetch(`${processorUrl.replace(/\/$/, "")}/process`, {
      method: "POST",
      headers: { "X-Joint-Processor-Key": processorKey },
      body: form,
      signal: AbortSignal.timeout(180_000),
    });
    if (!processed.ok) {
      const details = await processed.text().catch(() => "");
      console.error("Media processor failed", processed.status, details.slice(0, 500));
      return json(502, "The JOINT media processor could not create the branded file. Please try again later.");
    }
    const outputType = processed.headers.get("content-type") || (mediaType === "image" ? "image/png" : "video/mp4");
    const output = await processed.arrayBuffer();
    if (!output.byteLength) return json(502, "The media processor returned an empty file.");
    return new Response(output, {
      status: 200,
      headers: {
        ...cors,
        "Content-Type": outputType,
        "Content-Disposition": `attachment; filename="JOINT-branded.${mediaType === "image" ? "png" : "mp4"}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("JOINT branded media export failed", error);
    return json(502, "Media processing failed or timed out. No unbranded file was downloaded.");
  }
});
