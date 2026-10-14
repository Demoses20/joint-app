// ========================================
// JOINT — SUPABASE CONNECTION
// ========================================

const JOINT_SUPABASE_URL = "https://pkadxjsadopktlnlxnhc.supabase.co";

const JOINT_SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_giX0L5ZYqHypU89hq269hw_1uP1KrlC";

// Load the official Supabase browser library.
const jointSupabaseReady = new Promise((resolve, reject) => {
  if (window.supabase?.createClient) {
    resolve(window.supabase);
    return;
  }

  const script = document.createElement("script");

  script.src =
    "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js";

  script.onload = () => {
    if (window.supabase?.createClient) {
      resolve(window.supabase);
    } else {
      reject(new Error("Supabase library loaded incorrectly."));
    }
  };

  script.onerror = () => {
    reject(new Error("Could not load the Supabase library."));
  };

  document.head.appendChild(script);
});

window.jointSupabase = null;

window.jointSupabaseConnection = jointSupabaseReady
  .then((library) => {
    if (
      !JOINT_SUPABASE_URL.startsWith("https://") ||
      JOINT_SUPABASE_URL.includes("PASTE_") ||
      JOINT_SUPABASE_PUBLISHABLE_KEY.includes("PASTE_")
    ) {
      throw new Error(
        "Add your JOINT Project URL and publishable key to supabase.js."
      );
    }

    window.jointSupabase = library.createClient(
      JOINT_SUPABASE_URL,
      JOINT_SUPABASE_PUBLISHABLE_KEY
    );

    console.log("JOINT Supabase client initialized.");

    return window.jointSupabase;
  })
  .catch((error) => {
    console.error("JOINT Supabase connection setup failed:", error);
    throw error;
  });
