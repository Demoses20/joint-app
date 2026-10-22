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
  const task = String(body.task || ""), prompt = String(body.prompt || "").trim();
  if (!["teacher", "lesson", "quiz", "mark"].includes(task)) return json({ error: "Choose a supported AI task." }, 400, origin);
  if (!prompt || prompt.length > 20000) return json({ error: "Enter content between 1 and 20,000 characters." }, 400, origin);
  const { data: school, error: schoolError } = await db.from("joint_school_host_applications").select("id,owner_id,school_name,status").eq("owner_id", auth.user.id).eq("status", "approved").order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (schoolError) return json({ error: "Could not verify your school workspace." }, 500, origin);
  if (!school) return json({ error: "An approved school/institute workspace is required to use these tools." }, 403, origin);
  const { data: settings, error: settingsError } = await db.from("joint_ai_point_settings").select("points_per_ai_start").eq("id", true).maybeSingle();
  if (settingsError || !settings) return json({ error: "AI Points settings are unavailable. Contact the administrator." }, 500, origin);
  const cost = Math.max(1, Number(settings.points_per_ai_start) || 1);
  const { data: wallet, error: walletError } = await db.from("joint_ai_point_wallets").select("owner_id,balance,lifetime_spent").eq("owner_id", school.owner_id).maybeSingle();
  if (walletError) return json({ error: "Could not load the AI Points wallet." }, 500, origin);
  if (!wallet || Number(wallet.balance) < cost) return json({ error: `Insufficient AI Points. This action requires ${cost} point(s).` }, 402, origin);
  const instructions: Record<string, string> = {
    teacher: "You are JOINT AI Teacher. Explain clearly and accurately for a student, using examples and a helpful follow-up question when appropriate.",
    lesson: "Create a structured, classroom-ready lesson with learning objectives, prerequisite knowledge, explanation, examples, activities, and a short recap.",
    quiz: "Create 8 quiz questions from the supplied content. Give four options for each, the correct answer, and a short explanation. Clearly label the teacher answer key.",
    mark: "Assess the student's work against the assignment or rubric. Suggest a score out of 100, explain strengths and corrections, and provide constructive feedback. State that the teacher makes the final decision."
  };
  let response: Response;
  try { response = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: Deno.env.get("OPENAI_MODEL") || "gpt-4.1-mini", instructions: instructions[task], input: prompt, max_output_tokens: 2200 }) }); }
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
