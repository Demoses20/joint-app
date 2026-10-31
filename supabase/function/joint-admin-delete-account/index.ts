import { createClient } from "npm:@supabase/supabase-js@2";

const ALLOWED_ORIGINS = ["https://myjointapp.com", "https://www.myjointapp.com"];
const ADMIN_EMAIL = "technicaldemoses@gmail.com";
const headers = (origin: string) => ({
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
});
const reply = (origin: string, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: headers(origin) });
const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error);

async function collectFiles(db: ReturnType<typeof createClient>, bucket: string, prefix: string): Promise<string[]> {
  const found: string[] = [];
  async function walk(folder: string) {
    const { data, error } = await db.storage.from(bucket).list(folder, { limit: 1000 });
    if (error) throw new Error(`Storage list ${bucket}/${folder}: ${error.message}`);
    for (const item of data || []) {
      const path = `${folder}/${item.name}`;
      if (item.id || item.metadata) found.push(path);
      else await walk(path);
    }
  }
  await walk(prefix.replace(/^\/+|\/+$/g, ""));
  return found;
}

Deno.serve(async (req) => {
  const originHeader = req.headers.get("origin") || "";
  const origin = ALLOWED_ORIGINS.includes(originHeader) ? originHeader : ALLOWED_ORIGINS[0];
  if (req.method === "OPTIONS") return new Response("ok", { headers: headers(origin) });
  if (req.method !== "POST") return reply(origin, { error: "POST required.", stage: "request" }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  const service = Deno.env.get("JOINT_SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !service) {
    console.error("[joint-admin-delete-account] configuration missing", { hasUrl: !!url, hasAnon: !!anon, hasService: !!service });
    return reply(origin, { error: "Server-side Supabase configuration is incomplete.", stage: "configuration" }, 500);
  }

  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return reply(origin, { error: "Admin sign-in required.", stage: "authentication" }, 401);
  const caller = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: authData, error: authError } = await caller.auth.getUser(token);
  if (authError || authData.user?.email?.toLowerCase() !== ADMIN_EMAIL) {
    console.warn("[joint-admin-delete-account] admin authorization rejected", { authError: authError?.message, emailPresent: !!authData.user?.email });
    return reply(origin, { error: "Admin access required.", stage: "authentication" }, 403);
  }

  let userId = "";
  try { userId = String((await req.json()).user_id || ""); }
  catch { return reply(origin, { error: "Invalid JSON body.", stage: "request" }, 400); }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
    return reply(origin, { error: "A valid account ID is required.", stage: "request" }, 400);
  }

  const db = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  let stage = "profile_check";
  try {
    const { data: profile, error: profileError } = await db.from("joint_profiles")
      .select("id,account_status").eq("id", userId).maybeSingle();
    if (profileError) throw new Error(`Could not verify target account: ${profileError.message}`);
    if (!profile || !["suspended", "permanently_deleted"].includes(profile.account_status)) {
      return reply(origin, { error: "Only a suspended account can be permanently deleted.", stage }, 409);
    }

    // Retry-safe: a previous attempt may have completed database cleanup but failed at Auth deletion.
    if (profile.account_status === "suspended") {
      stage = "storage_cleanup";
      const prefixes: Array<[string, string]> = [
        ["joint-avatars", userId], ["joint-post-media", userId],
        ["joint-host-verification", userId], ["joint-learning-media", userId],
        ["joint-meeting-media", `meetings/${userId}`],
      ];
      for (const [bucket, prefix] of prefixes) {
        const paths = await collectFiles(db, bucket, prefix);
        for (let i = 0; i < paths.length; i += 100) {
          const { error } = await db.storage.from(bucket).remove(paths.slice(i, i + 100));
          if (error) throw new Error(`Storage remove ${bucket}: ${error.message}`);
        }
      }

      stage = "database_cleanup";
      const { error: cleanupError } = await db.rpc("joint_admin_prepare_permanent_deletion", { p_user_id: userId });
      if (cleanupError) throw new Error(`Database cleanup RPC failed: ${cleanupError.message} (code ${cleanupError.code || "unknown"})`);
    }

    stage = "auth_delete";
    const { error: deleteError } = await db.auth.admin.deleteUser(userId);
    if (deleteError) throw new Error(`Supabase Auth deletion failed: ${deleteError.message}`);

    console.info("[joint-admin-delete-account] deletion completed", { userId, admin: authData.user.id });
    return reply(origin, { ok: true, message: "The account and its user-owned JOINT content have been permanently deleted. Shared conversation history and financial audit records were retained." });
  } catch (error) {
    const details = messageOf(error);
    console.error("[joint-admin-delete-account] deletion failed", { stage, userId, details });
    return reply(origin, {
      error: "Permanent deletion failed.",
      stage,
      details,
      retryable: stage === "auth_delete" || stage === "storage_cleanup",
    }, 500);
  }
});
