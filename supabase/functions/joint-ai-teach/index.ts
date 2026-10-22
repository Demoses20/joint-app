import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const allowed = new Set(["https://myjointapp.com", "https://www.myjointapp.com"]);
const cors = (origin: string | null) => ({ "Access-Control-Allow-Origin": origin && allowed.has(origin) ? origin : "https://myjointapp.com", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", Vary: "Origin" });
const json = (body: unknown, status = 200, origin: string | null = null) => new Response(JSON.stringify(body), { status, headers: { ...cors(origin), "Content-Type": "application/json" } });
Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return json({ error: "POST required." }, 405, origin);
  const url = Deno.env.get("SUPABASE_URL"), anon = Deno.env.get("SUPABASE_ANON_KEY"), service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), key = Deno.env.get("OPENAI_API_KEY");
  if (!url || !anon || !service || !key) return json({ error: "AI service is not configured on the server." }, 500, origin);
  const token = (req.headers.get("Authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return json({ error: "Sign in to use AI tools." }, 401, origin);
  const userDb = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: auth, error: authError } = await userDb.auth.getUser(token);
  if (authError || !auth.user) return json({ error: "Your session expired. Sign in again." }, 401, origin);
  const db = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Invalid request body." }, 400, origin); }
  // Learning Studio teaching requests use action=start|answer and must remain
  // compatible with classes-learning-backend.js. Keep this endpoint name unchanged.
  if (body.action === "start" || body.action === "answer") {
    const action = body.action;
    const courseId = String(body.courseId || "").slice(0, 100);
    const lessonId = String(body.lessonId || "").slice(0, 100);
    const studentResponse = String(body.studentResponse || "").slice(0, 8000);
    const studentImage = typeof body.studentImageDataUrl === "string" ? body.studentImageDataUrl : "";
    if (!courseId || !lessonId) return json({ ok: false, error: "Course and lesson identifiers are required." }, 400, origin);
    if (studentImage && (!/^data:image\/(png|jpeg|jpg|webp|gif);base64,/i.test(studentImage) || studentImage.length > 11500000)) {
      return json({ ok: false, error: "Unsupported image or photo too large. Use PNG, JPEG, WEBP or GIF under 8 MB." }, 400, origin);
    }
    const { data: course, error: courseError } = await userDb.from("joint_courses")
      .select("id,owner_id,title,status,content").eq("id", courseId).maybeSingle();
    if (courseError || !course) return json({ ok: false, error: "Course unavailable. Check course access and Supabase row-level security policies." }, 403, origin);
    const isOwner = String(course.owner_id) === String(auth.user.id);
    if (!isOwner) {
      if (String(course.status || "").toLowerCase() !== "published") return json({ ok: false, error: "This course is not published." }, 403, origin);
      const { data: enrollment, error: enrollmentError } = await userDb.from("joint_course_enrollments")
        .select("status").eq("course_id", courseId).eq("user_id", auth.user.id).maybeSingle();
      if (enrollmentError || !enrollment || !["joined","enrolled","completed","paid","received"].includes(String(enrollment.status || "").toLowerCase())) {
        return json({ ok: false, error: "Join or enroll in this course before using its AI tutor." }, 403, origin);
      }
    }
    // Enforce JOINT-wide AI availability. For approved school/institute-hosted courses,
    // require an active wallet with sufficient points and record every successful turn.
    const { data: lessonPointSettings, error: lessonSettingsError } = await db.from("joint_ai_point_settings")
      .select("points_per_ai_start,is_enabled").eq("id", true).maybeSingle();
    if (lessonSettingsError || !lessonPointSettings) return json({ ok: false, error: "AI Points settings are unavailable. Contact the JOINT main administrator." }, 503, origin);
    if (lessonPointSettings.is_enabled === false) return json({ ok: false, error: "AI teaching is temporarily disabled by the JOINT main administrator. Please use human-mode lessons." }, 403, origin);
    let lessonPointOwnerId: string | null = null;
    let lessonPointCost = Math.max(1, Number(lessonPointSettings.points_per_ai_start) || 1);
    const { data: pointSchool, error: pointSchoolError } = await db.from("joint_school_host_applications")
      .select("owner_id,status").eq("owner_id", course.owner_id).eq("status", "approved").order("updated_at", { ascending: false }).limit(1).maybeSingle();
    if (pointSchoolError) return json({ ok: false, error: "Could not verify the AI Points workspace for this course." }, 500, origin);
    if (pointSchool) {
      lessonPointOwnerId = String(pointSchool.owner_id);
      const { data: pointWallet, error: pointWalletError } = await db.from("joint_ai_point_wallets")
        .select("owner_id,balance,is_active").eq("owner_id", lessonPointOwnerId).maybeSingle();
      if (pointWalletError) return json({ ok: false, error: "Could not load the AI Points wallet." }, 500, origin);
      if (!pointWallet || pointWallet.is_active === false) return json({ ok: false, error: "AI Points are deactivated for this school/institute. Ask the host to activate AI Points or continue in human mode." }, 403, origin);
      if (Number(pointWallet.balance || 0) < lessonPointCost) return json({ ok: false, error: `Insufficient AI Points. This lesson request requires ${lessonPointCost} point(s). Please ask the host to purchase points or use human mode.` }, 402, origin);
    }
    const modules = Array.isArray(course.content?.modules) ? course.content.modules : [];
    let found: any = null;
    for (const mod of modules) {
      for (const item of (Array.isArray(mod?.lessons) ? mod.lessons : [])) {
        if (String(item?.id) === lessonId) { found = { lesson: item, module: mod }; break; }
      }
      if (found) break;
    }
    if (!found) return json({ ok: false, error: "This lesson could not be found in the saved course. Save and publish the latest course first." }, 404, origin);
    const lesson = found.lesson, aiSettings = lesson.aiSettings || {};
    if (lesson.teachingMode !== "ai") return json({ ok: false, error: "This chapter is set to Human mode." }, 400, origin);
    const now = Date.now();
    if (lesson.releaseAt && new Date(lesson.releaseAt).getTime() > now) return json({ ok: false, error: "This lesson has not opened yet." }, 403, origin);
    if (lesson.availableUntil && new Date(lesson.availableUntil).getTime() < now) return json({ ok: false, error: "This lesson has closed." }, 403, origin);
    const blocks = Array.isArray(lesson.contentBlocks) ? lesson.contentBlocks : [];
    const lessonText = blocks.filter((b: any) => b?.type === "text" && b?.text).map((b: any) => String(b.text).slice(0, 12000)).join("\n\n").slice(0, 24000);
    const material = {
      course: String(course.title || "").slice(0, 200), path: String(found.module?.title || "").slice(0, 200),
      lesson: String(lesson.title || "").slice(0, 200), lessonNotes: String(lesson.content || "").slice(0, 16000),
      contentBlocks: lessonText, hostInstructions: String(aiSettings.instructions || "").slice(0, 8000),
      reviewNotes: String(aiSettings.reviewNotes || "").slice(0, 4000),
      language: String(course.content?.course?.language || "English").slice(0, 60),
      questionCount: Math.min(20, Math.max(0, Number(aiSettings.questionCount) || 5)),
      questionStyle: String(aiSettings.questionStyle || "mixed").slice(0, 60),
      assignmentType: String(aiSettings.assignmentType || "written").slice(0, 60),
      passScore: Number(lesson.progression?.passScore ?? 70)
    };
    const history = Array.isArray(body.history) ? body.history.slice(-12).map((m: any) => ({
      role: m?.role === "assistant" ? "assistant" : "user", content: String(m?.content || "").slice(0, 3000)
    })) : [];
    const teachingInstructions = `You are JOINT's patient, age-appropriate AI teacher. Teach based on the saved lesson material and host instructions; follow their language, teaching style and pace. The student may send text or a photo of a handwritten answer, question, worksheet, or diagram. Read the image carefully, explain what you can identify, and if unclear ask for a clearer photo. Evaluate a submitted answer kindly and accurately, provide a score from 0-100 only when the student has answered a question or submitted work, and give actionable feedback. Do not invent course facts beyond the provided lesson. Return ONLY valid JSON with keys: message (string), question (null or {type:"multiple_choice"|"short_answer",prompt:string,options?:string[]}), assignment (null or {title:string,instructions:string}), score (number 0-100 or null), activityType ("quiz"|"assignment"|"question_answer" or null), feedback (string or null), finished (boolean), media (array, normally empty). For action=start, begin teaching with a concise introduction, one learning step, and a learner question unless questionCount is 0. For action=answer, respond to the student's answer/question/photo and continue the lesson. Never expose an answer key in a question. Never claim an assignment was submitted to the teacher. Saved course material: ${JSON.stringify(material)}`;
    const userText = JSON.stringify({ action, studentResponse, conversation: history, memory: String(body.memory || "").slice(0, 1200) });
    const content: any[] = [{ type: "input_text", text: userText }];
    if (studentImage) content.push({ type: "input_image", image_url: studentImage });
    let aiResponse: Response;
    try {
      aiResponse = await fetch("https://api.openai.com/v1/responses", {
        method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: Deno.env.get("JOINT_AI_MODEL") || Deno.env.get("OPENAI_MODEL") || "gpt-4o-mini",
          instructions: teachingInstructions, input: [{ role: "user", content }], max_output_tokens: 3000 })
      });
    } catch {
      return json({ ok: false, error: "Could not connect to the AI teacher. No answer was sent." }, 502, origin);
    }
    const aiData: any = await aiResponse.json().catch(() => ({}));
    if (!aiResponse.ok) {
      console.error("JOINT AI teaching provider error", aiData?.error?.code || aiResponse.status);
      return json({ ok: false, error: aiData?.error?.message || "The AI teacher could not complete this request." }, 502, origin);
    }
    const raw = Array.isArray(aiData.output) ? aiData.output.flatMap((item: any) => Array.isArray(item.content) ? item.content.filter((c: any) => c.type === "output_text").map((c: any) => c.text) : []).join("\n").trim() : "";
    let teaching: any;
    try { teaching = JSON.parse(raw); } catch { return json({ ok: false, error: "The AI teacher returned an unreadable response. Please try again." }, 502, origin); }
    let pointsCharged = 0, pointBalance: number | null = null;
    if (lessonPointOwnerId) {
      const requestId = String(body.requestId || crypto.randomUUID()).slice(0, 120);
      const { data: debit, error: debitError } = await db.rpc("joint_spend_ai_points", {
        p_owner_id: lessonPointOwnerId, p_actor_user_id: auth.user.id, p_points: lessonPointCost,
        p_source: "learning_studio", p_source_id: `${courseId}:${lessonId}:${requestId}`,
        p_idempotency_key: `lesson:${auth.user.id}:${requestId}`, p_description: `AI lesson ${action}: ${String(lesson.title || lessonId).slice(0, 160)}`
      });
      if (debitError || !debit?.ok) {
        console.error("AI lesson points debit failed", debitError?.message || debit?.error);
        return json({ ok: false, error: debit?.error === "insufficient_balance" ? "Your AI Points balance changed during this request. Please try again." : "The AI response was generated, but the AI Points transaction could not be confirmed. Contact JOINT support before retrying." }, debit?.error === "insufficient_balance" ? 402 : 500, origin);
      }
      pointsCharged = lessonPointCost; pointBalance = Number(debit.balance);
    }
    return json({ ok: true, message: String(teaching.message || "Let's continue with the lesson.").slice(0, 12000),
      question: teaching.question || null, assignment: teaching.assignment || null,
      score: typeof teaching.score === "number" ? Math.max(0, Math.min(100, teaching.score)) : null,
      activityType: ["quiz","assignment","question_answer"].includes(teaching.activityType) ? teaching.activityType : null,
      feedback: String(teaching.feedback || "").slice(0, 3000), finished: !!teaching.finished, media: [],
      points_charged: pointsCharged, balance: pointBalance,
      audioBase64: null, audioMime: null, model: Deno.env.get("JOINT_AI_MODEL") || Deno.env.get("OPENAI_MODEL") || "gpt-4o-mini"
    }, 200, origin);
  }
  const task = String(body.task || ""), prompt = String(body.prompt || "").trim(), imageDataUrl = typeof body.image_data_url === "string" ? body.image_data_url : "";
  if (!["teacher", "lesson", "quiz", "mark"].includes(task)) return json({ error: "Choose a supported AI task." }, 400, origin);
  if ((!prompt && !imageDataUrl) || prompt.length > 20000) return json({ error: "Enter a question or attach an image. Text must be 20,000 characters or fewer." }, 400, origin);
  if (imageDataUrl && (!/^data:image\/(png|jpeg|jpg|webp|gif);base64,/i.test(imageDataUrl) || imageDataUrl.length > 11500000)) return json({ error: "Unsupported image or image too large. Use PNG, JPEG, WEBP or GIF under 8 MB." }, 400, origin);
  const { data: school, error: schoolError } = await db.from("joint_school_host_applications").select("id,owner_id,school_name,status").eq("owner_id", auth.user.id).eq("status", "approved").order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (schoolError) return json({ error: "Could not verify your school workspace." }, 500, origin);
  if (!school) return json({ error: "An approved school/institute workspace is required to use these tools." }, 403, origin);
  const { data: settings, error: settingsError } = await db.from("joint_ai_point_settings").select("points_per_ai_start,is_enabled").eq("id", true).maybeSingle();
  if (settingsError || !settings) return json({ error: "AI Points settings are unavailable. Contact the administrator." }, 500, origin);
  if (settings.is_enabled === false) return json({ error: "AI services are temporarily disabled by the JOINT main administrator." }, 403, origin);
  const cost = Math.max(1, Number(settings.points_per_ai_start) || 1);
  const { data: wallet, error: walletError } = await db.from("joint_ai_point_wallets").select("owner_id,balance,lifetime_spent,is_active").eq("owner_id", school.owner_id).maybeSingle();
  if (walletError) return json({ error: "Could not load the AI Points wallet." }, 500, origin);
  if (!wallet || wallet.is_active === false) return json({ error: "AI Points are deactivated for this school/institute. Activate AI Points or use human mode." }, 403, origin);
  if (Number(wallet.balance) < cost) return json({ error: `Insufficient AI Points. This action requires ${cost} point(s).` }, 402, origin);
  const instructions: Record<string, string> = {
    teacher: "You are JOINT AI Teacher. Explain clearly and accurately for a student, using examples and a helpful follow-up question when appropriate.",
    lesson: "Create a structured, classroom-ready lesson with learning objectives, prerequisite knowledge, explanation, examples, activities, and a short recap.",
    quiz: "Create 8 quiz questions from the supplied content. Give four options for each, the correct answer, and a short explanation. Clearly label the teacher answer key.",
    mark: "Assess the student's work against the assignment or rubric. Suggest a score out of 100, explain strengths and corrections, and provide constructive feedback. State that the teacher makes the final decision."
  };
  let response: Response;
  try { response = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: Deno.env.get("OPENAI_MODEL") || "gpt-4.1-mini", instructions: instructions[task], input: [{ role: "user", content: [{ type: "input_text", text: prompt || "Read the attached image and help the learner." }, ...(imageDataUrl ? [{ type: "input_image", image_url: imageDataUrl }] : [])] }], max_output_tokens: 2200 }) }); }
  catch { return json({ error: "Could not connect to AI. No points were deducted." }, 502, origin); }
  const data: any = await response.json().catch(() => ({}));
  if (!response.ok) { console.error("OpenAI request failed", data?.error?.code || response.status); return json({ error: "AI could not complete the request. No points were deducted." }, 502, origin); }
  const output = Array.isArray(data.output) ? data.output.flatMap((item: any) => Array.isArray(item.content) ? item.content.filter((c: any) => c.type === "output_text").map((c: any) => c.text) : []).join("\n").trim() : "";
  if (!output) return json({ error: "AI returned an empty response. No points were deducted." }, 502, origin);
  const requestId = String(body.request_id || crypto.randomUUID()).slice(0, 120);
  const { data: debit, error: debitError } = await db.rpc("joint_spend_ai_points", { p_owner_id: school.owner_id, p_actor_user_id: auth.user.id, p_points: cost, p_source: task, p_source_id: String(data.id || requestId), p_idempotency_key: `ai:${auth.user.id}:${requestId}`, p_description: `OpenAI ${task} request` });
  if (debitError || !debit?.ok) { console.error("AI Points debit failed", debitError?.message || debit?.error); return json({ error: debit?.error === "insufficient_balance" ? "Your AI Points balance changed during this request. Please try again." : "AI response was generated, but its wallet transaction could not be confirmed. Contact support before retrying." }, debit?.error === "insufficient_balance" ? 402 : 500, origin); }
  return json({ ok: true, task, text: output, points_charged: cost, balance: debit.balance, school_name: school.school_name }, 200, origin);
});
