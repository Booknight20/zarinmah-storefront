const STAGING_URL = "https://qijahxokldkaqmjinfvy.supabase.co";

export async function onRequest({ env }) {
  const supabaseUrl = String(env.SUPABASE_URL || "").trim().replace(/\/$/, "");
  const publishableKey = String(env.PUBLIC_SUPABASE_PUBLISHABLE_KEY || "").trim();

  if (supabaseUrl !== STAGING_URL || !publishableKey) {
    return new Response("window.ZARINMAH_PUBLIC_CONFIG = null;", {
      status: 503,
      headers: {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "no-store"
      }
    });
  }

  const payload = JSON.stringify({
    supabaseUrl,
    publishableKey
  }).replace(/</g, "\\u003c");

  return new Response("window.ZARINMAH_PUBLIC_CONFIG = " + payload + ";", {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}
