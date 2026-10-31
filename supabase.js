// ========================================
// JOINT — SUPABASE CONNECTION
// ========================================

const JOINT_SUPABASE_URL = "https://pkadxjsadopktlnlxnhc.supabase.co";

const JOINT_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_giX0L5ZYqHypU89hq269hw_1uP1KrlC";

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

    // Account-status gate: suspended members may access only the appeal page;
    // permanently deleted accounts are signed out. Keep this in the shared
    // Supabase bootstrap so an already-open session is checked on every page.
    const pageName = (window.location.pathname.split("/").pop() || "index.html").toLowerCase();
    const statusGateExempt = pageName === "auth.html" ||
      pageName === "account-appeal.html" || pageName === "reset-password.html" ||
      pageName.startsWith("admin-") || pageName === "admin.html";
    if (!statusGateExempt) {
      let statusCheckInFlight = false;
      const enforceAccountStatus = async (sessionUser) => {
        if (!sessionUser || statusCheckInFlight) return;
        statusCheckInFlight = true;
        try {
          const { data: profile, error } = await window.jointSupabase
            .from("joint_profiles").select("account_status")
            .eq("id", sessionUser.id).maybeSingle();
          if (error) {
            console.error("JOINT account-status check failed:", error);
            return;
          }
          if (profile?.account_status === "suspended") {
            window.location.replace("account-appeal.html");
          } else if (profile?.account_status === "permanently_deleted") {
            await window.jointSupabase.auth.signOut();
            window.location.replace("auth.html");
          }
        } finally {
          statusCheckInFlight = false;
        }
      };
      window.jointSupabase.auth.onAuthStateChange((event, session) => {
        if (event === "INITIAL_SESSION" || event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
          window.setTimeout(() => { enforceAccountStatus(session?.user || null); }, 0);
        }
      });
      window.jointSupabase.auth.getUser().then(({ data, error }) => {
        if (!error && data?.user) enforceAccountStatus(data.user);
      }).catch(error => console.error("JOINT account-status check failed:", error));
    }

    return window.jointSupabase;
  })
  .catch((error) => {
    console.error("JOINT Supabase connection setup failed:", error);
    throw error;
  });
