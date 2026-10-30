import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ADMIN_EMAIL = "technicaldemoses@gmail.com";
const ALLOWED_ORIGINS = new Set(["https://myjointapp.com", "https://www.myjointapp.com"]);
const cors = (origin: string | null, requestedHeaders: string | null = null) => ({
  "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://myjointapp.com",
  "Access-Control-Allow-Headers": requestedHeaders || "authorization, x-client-info, apikey, content-type, x-supabase-api-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
  Vary: "Origin, Access-Control-Request-Headers",
});
const json = (body: unknown, status = 200, origin: string | null = null) => new Response(JSON.stringify(body), { status, headers: { ...cors(origin), "Content-Type": "application/json" } });
const text = (v: unknown, max = 4000) => String(v ?? "").trim().slice(0, max);
const words = (v: unknown) => (String(v ?? "").trim().match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) || []).length;
const ceilDiv = (n: number, d: number) => n > 0 ? Math.ceil(n / Math.max(1, d)) : 0;
const safeImageData = (v: unknown) => typeof v === "string" && /^data:image\/(jpeg|jpg|png|webp|gif);base64,[A-Za-z0-9+/=\r\n]+$/i.test(v) && v.length <= 17_000_000;
const safeHttps = (v: unknown) => { try { const u = new URL(String(v)); return u.protocol === "https:" ? u.toString() : ""; } catch { return ""; } };
const contentText = (lesson: any) => {
  const parts = [lesson?.title, lesson?.content, lesson?.aiSettings?.instructions, lesson?.aiSettings?.reviewNotes];
  for (const b of Array.isArray(lesson?.contentBlocks) ? lesson.contentBlocks : []) if (b?.type === "text") parts.push(b.text);
  return parts.map(x => text(x, 100000)).filter(Boolean).join("\n\n").slice(0, 24000);
};
const lessonImages = (lesson: any) => {
  const out: string[] = [];
  for (const b of Array.isArray(lesson?.contentBlocks) ? lesson.contentBlocks : []) {
    if (["image", "image-upload"].includes(String(b?.type || ""))) { const u = safeHttps(b?.url); if (u) out.push(u); }
  }
  return [...new Set(out)].slice(0, 8);
};
const flattenLessons = (content: any) => (Array.isArray(content?.modules) ? content.modules : []).flatMap((m: any) => Array.isArray(m?.lessons) ? m.lessons : []);

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin, req.headers.get("access-control-request-headers")) });
  if (req.method !== "POST") return json({ ok: false, error: "POST required." }, 405, origin);

  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!url || !anon || !service) return json({ ok: false, error: "Supabase AI teaching service is not configured." }, 500, origin);
  if (!openaiKey) return json({ ok: false, error: "OPENAI_API_KEY is missing from Supabase Edge Function secrets." }, 503, origin);

  const token = (req.headers.get("Authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return json({ ok: false, error: "Sign in before starting an AI lesson." }, 401, origin);
  const userDb = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: auth, error: authError } = await userDb.auth.getUser(token);
  if (authError || !auth.user) return json({ ok: false, error: "Your session expired. Sign in again." }, 401, origin);
  const db = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });

  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, error: "Invalid AI lesson request." }, 400, origin); }
  const action = text(body.action, 20);
  const courseId = text(body.courseId, 100);
  const lessonId = text(body.lessonId, 100);
  const requestId = text(body.requestId, 100);
  if (!new Set(["start", "answer"]).has(action) || !courseId || !lessonId || !requestId) return json({ ok: false, error: "A valid action, course, lesson and request ID are required." }, 400, origin);

  try {
    const { data: course, error: courseError } = await db.from("joint_courses").select("id,owner_id,application_id,title,description,content,status").eq("id", courseId).maybeSingle();
    if (courseError) throw courseError;
    if (!course || course.status !== "published") return json({ ok: false, error: "This published course could not be found." }, 404, origin);

    const isAdmin = String(auth.user.email || "").toLowerCase() === ADMIN_EMAIL;
    let ownerId = String(course.owner_id || "");
    if (!ownerId && course.application_id) {
      const { data: app, error: appError } = await db.from("joint_school_host_applications").select("owner_id,status").eq("id", course.application_id).maybeSingle();
      if (appError) throw appError;
      if (app?.status === "approved") ownerId = String(app.owner_id || "");
    }
    if (!ownerId) return json({ ok: false, error: "This course is not connected to an AI Points wallet." }, 409, origin);

    const { data: enrollment, error: enrollmentError } = await db.from("joint_course_enrollments").select("course_id,status").eq("course_id", courseId).eq("user_id", auth.user.id).in("status", ["joined", "enrolled", "completed"]).maybeSingle();
    if (enrollmentError) throw enrollmentError;
    if (!isAdmin && auth.user.id !== ownerId && !enrollment) return json({ ok: false, error: "Join this course before using its AI tutor." }, 403, origin);

    const { data: settings, error: settingsError } = await db.from("joint_ai_point_settings").select("points_per_ai_start,is_enabled,text_words_per_point,points_per_image,voice_seconds_per_point,video_frames_per_point,voice_note_seconds_per_point").eq("id", true).maybeSingle();
    if (settingsError) throw settingsError;
    if (!settings || !settings.is_enabled) return json({ ok: false, error: "AI services are currently disabled by the JOINT main administrator." }, 403, origin);
    const { data: wallet, error: walletError } = await db.from("joint_ai_point_wallets").select("owner_id,balance,is_active").eq("owner_id", ownerId).maybeSingle();
    if (walletError) throw walletError;
    if (!wallet || !wallet.is_active) return json({ ok: false, error: "The course host's AI Points wallet is not active." }, 403, origin);

    const lesson = flattenLessons(course.content).find((x: any) => String(x?.id) === lessonId);
    if (!lesson || lesson.teachingMode !== "ai") return json({ ok: false, error: "This AI lesson could not be found in the published course." }, 404, origin);

    const idempotencyKey = `${ownerId}:${auth.user.id}:${requestId}`.slice(0, 240);
    const { data: cached, error: cacheError } = await db.from("joint_ai_request_cache").select("response").eq("idempotency_key", idempotencyKey).maybeSingle();
    if (cacheError && !String(cacheError.message || "").toLowerCase().includes("does not exist")) throw cacheError;
    if (cached?.response) return json(cached.response, 200, origin);

    const lessonText = contentText(lesson);
    const lessonImageUrls = action === "start" ? lessonImages(lesson) : [];
    const studentResponse = text(body.studentResponse, 8000);
    const studentImage = safeImageData(body.studentImageDataUrl) ? body.studentImageDataUrl : "";
    const suppliedVideoFrames = Array.isArray(body.videoFrames) ? body.videoFrames.filter(safeImageData).slice(0, 12) : [];
    const videoFrameCount = suppliedVideoFrames.length;
    const voiceNoteSeconds = action === "answer" ? Math.max(0, Math.min(3600, Number(body.voiceNoteSeconds) || 0)) : 0;
    const history = Array.isArray(body.history) ? body.history.slice(-12).map((m: any) => ({ role: m?.role === "user" ? "user" : "assistant", content: text(m?.content, 3000) })).filter((m: any) => m.content) : [];
    const memory = text(body.memory, 1200);
    const voiceRequested = Boolean(body.voice);

    // Check the minimum request cost before contacting the AI provider. This
    // prevents a zero/insufficient-balance wallet from receiving AI teaching.
    // The final debit below still uses the exact generated response/media cost.
    const minimumInputWords = (action === "start" ? words(lessonText) : 0) + words(studentResponse);
    const minimumImageCount = lessonImageUrls.length + (studentImage ? 1 : 0);
    const minimumPoints = Math.max(1,
      (action === "start" ? Number(settings.points_per_ai_start || 1) : 0) +
      ceilDiv(minimumInputWords, Number(settings.text_words_per_point || 500)) +
      minimumImageCount * Number(settings.points_per_image ?? 2) +
      ceilDiv(videoFrameCount, Number(settings.video_frames_per_point || 10)) +
      ceilDiv(voiceNoteSeconds, Number(settings.voice_note_seconds_per_point || 30))
    );
    if (Number(wallet.balance || 0) < minimumPoints) {
      return json({ ok: false, error: `Not enough AI Points to start this teaching request. At least ${minimumPoints} point(s) are required; your school wallet has ${Number(wallet.balance || 0)}. Please top up before continuing.` }, 402, origin);
    }

    const systemPrompt = `You are JOINT's patient interactive AI tutor. Teach the supplied lesson accurately, using the host's instructions and course material as the primary source. Do not claim you watched or analyzed media unless its image frames were supplied. On action=start, introduce the lesson in clear steps and ask a useful question when appropriate. On action=answer, respond to the learner, correct misunderstandings kindly, and continue the lesson. Follow lesson question count/style and assignment type when available. Return ONLY valid JSON with keys: message (string), question (object or null; when present use type, prompt, options), assignment (object or null; use title,instructions), score (number or null), activityType (string), finished (boolean), progressSummary (string), media (array). Do not include markdown fences.`;
    const userText = `ACTION: ${action}\nCOURSE: ${text(course.title, 300)}\nCOURSE DESCRIPTION: ${text(course.description, 1500)}\nLESSON MATERIAL:\n${lessonText}\nHOST AI INSTRUCTIONS: ${text(lesson.aiSettings?.instructions, 5000)}\nQUESTION COUNT: ${Number(lesson.aiSettings?.questionCount ?? 5)}\nQUESTION STYLE: ${text(lesson.aiSettings?.questionStyle, 50)}\nASSIGNMENT TYPE: ${text(lesson.aiSettings?.assignmentType, 50)}\nREFERENCE POLICY: ${text(lesson.aiSettings?.referencePolicy, 50)}\nLEARNER PROGRESS MEMORY: ${memory}\nLEARNER RESPONSE: ${studentResponse || "(No written response supplied; begin the lesson.)"}\nUse only information supported by the lesson and clearly label uncertainty.`;
    const userContent: any[] = [{ type: "text", text: userText }];
    for (const u of lessonImageUrls) userContent.push({ type: "image_url", image_url: { url: u, detail: "low" } });
    if (studentImage) userContent.push({ type: "image_url", image_url: { url: studentImage, detail: "high" } });
    for (const frame of suppliedVideoFrames) userContent.push({ type: "image_url", image_url: { url: frame, detail: "low" } });

    const model = Deno.env.get("OPENAI_MODEL") || "gpt-4o-mini";
    const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST", headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, temperature: 0.4, response_format: { type: "json_object" }, messages: [{ role: "system", content: systemPrompt }, ...history, { role: "user", content: userContent }] }),
      signal: AbortSignal.timeout(55000),
    });
    const aiPayload: any = await aiRes.json().catch(() => ({}));
    if (!aiRes.ok) {
      console.error("OpenAI lesson request failed", aiRes.status, text(aiPayload?.error?.message, 500));
      return json({ ok: false, error: aiRes.status === 429 ? "The AI service is busy. Please wait and try again." : "The AI tutor could not complete this request. Please try again." }, 502, origin);
    }
    let parsed: any;
    try { parsed = JSON.parse(aiPayload?.choices?.[0]?.message?.content || "{}"); } catch { return json({ ok: false, error: "The AI tutor returned an unreadable response. Please try again." }, 502, origin); }
    const reply = text(parsed.message, 12000);
    if (!reply) return json({ ok: false, error: "The AI tutor returned an empty response. Please try again." }, 502, origin);

    let audioBase64 = ""; let audioMime = "audio/mpeg"; let generatedVoiceSeconds = 0;
    if (voiceRequested) {
      try {
        const tts = await fetch("https://api.openai.com/v1/audio/speech", { method: "POST", headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: Deno.env.get("OPENAI_TTS_MODEL") || "gpt-4o-mini-tts", voice: Deno.env.get("OPENAI_TTS_VOICE") || "alloy", input: reply.slice(0, 3500), response_format: "mp3" }), signal: AbortSignal.timeout(30000) });
        if (tts.ok) {
          const bytes = new Uint8Array(await tts.arrayBuffer());
          if (bytes.length <= 5_000_000) { let binary = ""; for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); audioBase64 = btoa(binary); generatedVoiceSeconds = Math.max(1, Math.ceil(words(reply) / 2.5)); }
        } else console.warn("AI voice generation unavailable", tts.status);
      } catch (e) { console.warn("AI voice generation failed", e instanceof Error ? e.message : e); }
    }

    const textWords = (action === "start" ? words(lessonText) : 0) + words(studentResponse) + words(reply);
    const imageCount = lessonImageUrls.length + (studentImage ? 1 : 0);
    const basePoints = action === "start" ? Number(settings.points_per_ai_start || 1) : 0;
    const points = Math.max(1, basePoints + ceilDiv(textWords, Number(settings.text_words_per_point || 500)) + imageCount * Number(settings.points_per_image ?? 2) + ceilDiv(generatedVoiceSeconds, Number(settings.voice_seconds_per_point || 30)) + ceilDiv(videoFrameCount, Number(settings.video_frames_per_point || 10)) + ceilDiv(voiceNoteSeconds, Number(settings.voice_note_seconds_per_point || 30)));
    const description = `AI lesson ${action}: ${textWords} words, ${imageCount} images, ${videoFrameCount} analyzed video frames, ${generatedVoiceSeconds}s generated voice, ${voiceNoteSeconds}s voice input`;
    const { data: spend, error: spendError } = await db.rpc("joint_spend_ai_points", { p_owner_id: ownerId, p_actor_user_id: auth.user.id, p_points: points, p_source: "ai_lesson", p_source_id: `${courseId}:${lessonId}`, p_idempotency_key: idempotencyKey, p_description: description });
    if (spendError) {
      console.error("AI Points debit failed", spendError.message);
      return json({ ok: false, error: "AI response was prepared but point billing could not be completed. No lesson response was delivered. Please contact JOINT support before retrying." }, 402, origin);
    }
    if (!spend?.ok) {
      const msg = spend?.error === "insufficient_balance" ? "The course host does not have enough AI Points for this lesson request. Please ask the host to top up." : spend?.error === "wallet_not_found" ? "The course host's AI Points wallet could not be found." : "AI Points billing could not be completed. Please try again later.";
      return json({ ok: false, error: msg }, spend?.error === "insufficient_balance" ? 402 : 409, origin);
    }

    const response = { ok: true, message: reply, question: parsed.question || null, assignment: parsed.assignment || null, score: typeof parsed.score === "number" ? Math.max(0, Math.min(100, parsed.score)) : null, activityType: text(parsed.activityType, 50), finished: Boolean(parsed.finished), progressSummary: text(parsed.progressSummary || reply, 1200), media: Array.isArray(parsed.media) ? parsed.media.filter((m: any) => m && ["image", "video", "audio"].includes(m.type) && safeHttps(m.url)).slice(0, 8) : [], audioBase64: audioBase64 || undefined, audioMime: audioBase64 ? audioMime : undefined, pointsCharged: points, balance: spend.balance };
    try { await db.from("joint_ai_request_cache").insert({ owner_id: ownerId, actor_user_id: auth.user.id, idempotency_key: idempotencyKey, response, created_at: new Date().toISOString() }); } catch (e) { console.warn("AI response cache insert failed", e instanceof Error ? e.message : e); }
    return json(response, 200, origin);
  } catch (e) {
    console.error("JOINT AI teaching failed", e instanceof Error ? e.message : e);
    return json({ ok: false, error: "The AI tutor could not complete this request. Please try again." }, 500, origin);
  }
});
