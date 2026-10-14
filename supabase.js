// JOINT — Supabase connection
// This file uses the official Supabase browser client.

const JOINT_SUPABASE_URL = "PASTE_YOUR_JOINT_PROJECT_URL_HERE";
const JOINT_SUPABASE_PUBLISHABLE_KEY =
  "PASTE_YOUR_JOINT_PUBLISHABLE_KEY_HERE";

if (
  !JOINT_SUPABASE_URL.startsWith("https://") ||
  JOINT_SUPABASE_URL.includes("PASTE_") ||
  JOINT_SUPABASE_PUBLISHABLE_KEY.includes("PASTE_")
) {
  console.error("JOINT Supabase configuration is incomplete.");
} else {
  console.log("JOINT Supabase configuration is present.");
}
