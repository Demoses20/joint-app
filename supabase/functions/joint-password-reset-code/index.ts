import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://myjointapp.com",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};
const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const resendKey = Deno.env.get("RESEND_API_KEY");
  const fromEmail = Deno.env.get("JOINT_NOTIFICATION_FROM") || Deno.env.get("RESEND_FROM_EMAIL");
  const pepper = Deno.env.get("JOINT_PASSWORD_RESET_PEPPER");
  if (!supabaseUrl || !serviceKey || !resendKey || !fromEmail || !pepper) {
    console.error("Missing password reset function environment configuration.");
    return json({ error: "Password reset is temporarily unavailable. Please try again later." }, 500);
  }

  let payload: { action?: string; email?: string; code?: string; password?: string };
  try { payload = await req.json(); } catch { return json({ error: "Invalid request." }, 400); }
  const action = payload.action;
  const email = String(payload.email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return json({ error: "Enter a valid email address." }, 400);
  }

  const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: existing, error: readError } = await admin.from("joint_password_reset_codes")
    .select("email,code_hash,expires_at,attempts,sent_at,used_at").eq("email", email).maybeSingle();
  if (readError) {
    console.error("Could not read password reset state:", readError.message);
    return json({ error: "Password reset is temporarily unavailable. Please try again later." }, 500);
  }

  if (action === "request") {
    if (existing?.sent_at && Date.now() - new Date(existing.sent_at).getTime() < 60_000) {
      return json({ ok: true, message: "If an account exists for that email, a verification code has been sent." });
    }

    // Avoid exposing whether an email belongs to a JOINT account.
    let userId: string | null = null;
    for (let page = 1; page <= 20; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) {
        console.error("Admin user lookup failed:", error.message);
        return json({ error: "Password reset is temporarily unavailable. Please try again later." }, 500);
      }
      const found = data.users.find((user) => user.email?.toLowerCase() === email);
      if (found) { userId = found.id; break; }
      if (data.users.length < 1000) break;
    }

    if (userId) {
      const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0");
      const codeHash = await sha256(`${email}:${code}:${pepper}`);
      const now = new Date();
      const row = { email, code_hash: codeHash, expires_at: new Date(now.getTime() + 10 * 60_000).toISOString(), attempts: 0, sent_at: now.toISOString(), used_at: null };
      const { error: upsertError } = await admin.from("joint_password_reset_codes").upsert(row, { onConflict: "email" });
      if (upsertError) {
        console.error("Could not save password reset code:", upsertError.message);
        return json({ error: "Password reset is temporarily unavailable. Please try again later." }, 500);
      }
      const mail = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: fromEmail,
          to: [email],
          subject: "Your JOINT password reset code",
          text: `Your JOINT password reset code is ${code}.\n\nIt expires in 10 minutes. If you did not request this, you can ignore this email. Never share this code with anyone.`,
          html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#222"><h2 style="color:#6d35d4">JOINT password reset</h2><p>Use this six-digit code to reset your JOINT password:</p><p style="font-size:32px;font-weight:bold;letter-spacing:8px">${code}</p><p>This code expires in 10 minutes. If you did not request it, ignore this email. Never share this code with anyone.</p></div>`,
        }),
      });
      if (!mail.ok) {
        console.error("Resend send failed:", await mail.text());
        return json({ error: "We could not send the verification code. Please try again later." }, 502);
      }
    }
    return json({ ok: true, message: "If an account exists for that email, a verification code has been sent." });
  }

  if (action === "verify_update") {
    const code = String(payload.code || "").trim();
    const password = String(payload.password || "");
    if (!/^\d{6}$/.test(code)) return json({ error: "Enter the six-digit verification code." }, 400);
    if (password.length < 8 || password.length > 128) return json({ error: "Password must be between 8 and 128 characters." }, 400);
    if (!existing || existing.used_at || !existing.code_hash || new Date(existing.expires_at).getTime() <= Date.now()) {
      return json({ error: "That code is invalid or expired. Request a new code." }, 400);
    }
    if (existing.attempts >= 5) return json({ error: "Too many incorrect attempts. Request a new code." }, 429);
    const submittedHash = await sha256(`${email}:${code}:${pepper}`);
    if (submittedHash !== existing.code_hash) {
      await admin.from("joint_password_reset_codes").update({ attempts: existing.attempts + 1 }).eq("email", email);
      return json({ error: "That code is incorrect. Check the email and try again." }, 400);
    }

    let user: { id: string } | null = null;
    for (let page = 1; page <= 20; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) return json({ error: "Password reset is temporarily unavailable. Please try again later." }, 500);
      const found = data.users.find((item) => item.email?.toLowerCase() === email);
      if (found) { user = { id: found.id }; break; }
      if (data.users.length < 1000) break;
    }
    if (!user) return json({ error: "That code is invalid or expired. Request a new code." }, 400);

    // Mark the code used before changing the password, preventing concurrent reuse.
    const { data: consumed, error: consumeError } = await admin.from("joint_password_reset_codes")
      .update({ used_at: new Date().toISOString(), code_hash: null }).eq("email", email)
      .eq("code_hash", existing.code_hash).is("used_at", null).gt("expires_at", new Date().toISOString()).select("email").maybeSingle();
    if (consumeError || !consumed) return json({ error: "That code has already been used or expired. Request a new code." }, 400);

    const { error: updateError } = await admin.auth.admin.updateUserById(user.id, { password });
    if (updateError) {
      console.error("Password update failed:", updateError.message);
      return json({ error: "We could not update your password. Request a new code and try again." }, 500);
    }
    return json({ ok: true, message: "Password updated successfully." });
  }

  return json({ error: "Unsupported action." }, 400);
});
