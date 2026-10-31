import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200, origin = "https://myjointapp.com") => new Response(JSON.stringify(body), {
  status, headers: { ...cors, "Access-Control-Allow-Origin": origin, "Content-Type": "application/json" },
});
const ADMIN_EMAIL = "technicaldemoses@gmail.com";

async function collectFiles(db: ReturnType<typeof createClient>, bucket: string, prefix: string): Promise<string[]> {
  const found: string[] = [];
  async function walk(folder: string) {
    const { data, error } = await db.storage.from(bucket).list(folder, { limit: 1000 });
    if (error) throw new Error(`Storage listing failed for ${bucket}/${folder}: ${error.message}`);
    for (const item of data || []) {
      const path = `${folder}/${item.name}`;
      if (item.id || item.metadata) found.push(path);
      else await walk(path);
    }
  }
  await walk(prefix.replace(/\/$/, ""));
  return found;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin") || "";
  const allowedOrigin = ["https://myjointapp.com", "https://www.myjointapp.com"].includes(origin) ? origin : "https://myjointapp.com";
  if (req.method === "OPTIONS") return new Response("ok", { headers: { ...cors, "Access-Control-Allow-Origin": allowedOrigin } });
  if (req.method !== "POST") return json({ error: "POST required." }, 405, allowedOrigin);
  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const service = Deno.env.get("JOINT_SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !service) return json({ error: "Server-side Supabase configuration is incomplete." }, 500);
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Admin sign-in required." }, 401);
  const caller = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: authData, error: authError } = await caller.auth.getUser(token);
  if (authError || authData.user?.email?.toLowerCase() !== ADMIN_EMAIL) return json({ error: "Admin access required." }, 403);
  let userId = "";
  try { userId = String((await req.json()).user_id || ""); } catch { return json({ error: "Invalid JSON body." }, 400); }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) return json({ error: "A valid account ID is required." }, 400);

  const db = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: profile, error: profileError } = await db.from("joint_profiles").select("id,account_status").eq("id", userId).maybeSingle();
  if (profileError) return json({ error: "Could not verify target account.", details: profileError.message }, 500);
  if (!profile || profile.account_status !== "suspended") return json({ error: "Only a currently suspended account can be permanently deleted." }, 409);

  // Remove only user-owned storage prefixes. Shared conversation and meeting-room folders are deliberately excluded.
  const prefixes: Array<[string, string]> = [
    ["joint-avatars", userId], ["joint-post-media", userId],
    ["joint-host-verification", userId], ["joint-learning-media", userId],
    ["joint-meeting-media", `meetings/${userId}`],
  ];
  try {
    for (const [bucket, prefix] of prefixes) {
      const paths = await collectFiles(db, bucket, prefix);
      for (let i = 0; i < paths.length; i += 100) {
        const { error } = await db.storage.from(bucket).remove(paths.slice(i, i + 100));
        if (error) throw new Error(`Could not remove ${bucket} account files: ${error.message}`);
      }
    }
  } catch (error) {
    return json({ error: "Account files could not all be removed. The account has not been deleted; retry after resolving the storage issue.", details: error instanceof Error ? error.message : String(error) }, 502);
  }

  const { error: cleanupError } = await db.rpc("joint_admin_prepare_permanent_deletion", { p_user_id: userId });
  if (cleanupError) return json({ error: "Database cleanup failed. Auth account was not deleted.", details: cleanupError.message }, 500);
  const { error: deleteError } = await db.auth.admin.deleteUser(userId);
  if (deleteError) return json({ error: "JOINT data was cleaned, but Auth account deletion failed. Retry this operation to finish.", details: deleteError.message }, 502);
  return json({ ok: true, message: "The account and its user-owned JOINT content have been permanently deleted. Shared conversation history and financial audit records were retained." });
});
