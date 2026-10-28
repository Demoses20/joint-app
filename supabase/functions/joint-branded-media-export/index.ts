import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status: number, message: string) => new Response(JSON.stringify({ error: message }), { status, headers: { ...cors, "Content-Type": "application/json" } });
const MAX_BYTES = 50 * 1024 * 1024;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, "POST is required.");

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const processorUrl = Deno.env.get("JOINT_MEDIA_PROCESSOR_URL");
  const processorKey = Deno.env.get("JOINT_MEDIA_PROCESSOR_KEY");
  if (!supabaseUrl || !anonKey || !processorUrl || !processorKey) return json(503, "Branded media processing is not fully configured. Contact the JOINT administrator.");

  const token = (req.headers.get("Authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return json(401, "Sign in to download branded media.");
  const supabase = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return json(401, "Your session has expired. Sign in again.");

  let mediaType = "";
  let creator = "JOINT Creator";
  let sourceBlob: Blob;
  let fileName = "joint-source-video.mp4";
  try {
    const contentType = (req.headers.get("content-type") || "").toLowerCase();
    if (contentType.includes("multipart/form-data")) {
      // Browser-created blob: media cannot be fetched by the server; accept the authenticated upload.
      const form = await req.formData();
      const file = form.get("file");
      mediaType = String(form.get("media_type") || "").toLowerCase();
      creator = String(form.get("creator") || creator).slice(0, 80);
      if (!(file instanceof File)) return json(400, "Media file required.");
      sourceBlob = file;
      fileName = file.name || fileName;
    } else {
      let body: { media_url?: string; media_type?: string; creator?: string };
      try { body = await req.json(); } catch { return json(400, "Invalid request body."); }
      const mediaUrl = String(body.media_url || "");
      mediaType = String(body.media_type || "").toLowerCase();
      creator = String(body.creator || creator).slice(0, 80);
      if (!mediaUrl || !["image", "video"].includes(mediaType)) return json(400, "A media URL and valid media type are required.");
      let parsed: URL;
      try { parsed = new URL(mediaUrl); } catch { return json(400, "Invalid media URL."); }
      const expectedHost = new URL(supabaseUrl).host;
      const allowedStoragePath = parsed.pathname.startsWith("/storage/v1/object/public/joint-post-media/") || parsed.pathname.startsWith("/storage/v1/object/sign/joint-post-media/");
      if (parsed.protocol !== "https:" || parsed.host !== expectedHost || !allowedStoragePath) return json(400, "Only media stored in JOINT's post-media bucket can be branded.");
      const source = await fetch(parsed.toString(), { redirect: "error" });
      if (!source.ok) return json(422, "The original post media could not be accessed.");
      const contentLength = Number(source.headers.get("content-length") || 0);
      if (contentLength > MAX_BYTES) return json(413, "Media files must be 50 MB or smaller.");
      sourceBlob = await source.blob();
      const pathPart = parsed.pathname.split("/").pop() || "";
      fileName = pathPart || fileName;
    }
  } catch (error) {
    console.error("Could not read source media", error);
    return json(400, "The selected media could not be read. Please try again.");
  }

  if (!["image", "video"].includes(mediaType)) return json(400, "A valid image or video type is required.");
  if (!sourceBlob.size) return json(422, "The original media file is empty.");
  if (sourceBlob.size > MAX_BYTES) return json(413, "Media files must be 50 MB or smaller.");
  const inputType = (sourceBlob.type || "").toLowerCase();
  if (mediaType === "image" && !inputType.startsWith("image/")) return json(415, "The selected file is not an image.");
  // Some storage providers label valid videos as application/octet-stream. FFmpeg validates their content.
  if (mediaType === "video" && inputType && !inputType.startsWith("video/") && inputType !== "application/octet-stream" && !/\.(mp4|m4v|mov|webm|mkv|avi|3gp|mpeg|mpg)$/i.test(fileName)) return json(415, "The selected file does not appear to be a supported video.");

  try {
    const form = new FormData();
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100) || (mediaType === "image" ? "joint-source-image.jpg" : "joint-source-video.mp4");
    form.append("file", sourceBlob, safeName);
    form.append("media_type", mediaType);
    form.append("creator", creator.replace(/[\r\n\0]/g, " ").slice(0, 80));
    const processed = await fetch(`${processorUrl.replace(/\/$/, "")}/process`, {
      method: "POST",
      headers: { "X-Joint-Processor-Key": processorKey },
      body: form,
      signal: AbortSignal.timeout(180_000),
    });
    if (!processed.ok) {
      const details = await processed.text().catch(() => "");
      console.error("Media processor failed", processed.status, details.slice(0, 1000));
      let reason = "The JOINT media processor could not create the branded file. Please try again later.";
      try { const parsed = JSON.parse(details); if (parsed?.error) reason = String(parsed.error); } catch { /* keep safe message */ }
      return json(502, reason);
    }
    const outputType = processed.headers.get("content-type") || (mediaType === "image" ? "image/png" : "video/mp4");
    const output = await processed.arrayBuffer();
    if (!output.byteLength) return json(502, "The media processor returned an empty file.");
    return new Response(output, { status: 200, headers: {
      ...cors,
      "Content-Type": outputType,
      "Content-Disposition": `attachment; filename="JOINT-branded.${mediaType === "image" ? "png" : "mp4"}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    }});
  } catch (error) {
    console.error("JOINT branded media export failed", error);
    return json(502, "Media processing failed or timed out. No unbranded file was downloaded.");
  }
});
