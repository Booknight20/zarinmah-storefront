module.exports = function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
  res.setHeader("Content-Type", "application/javascript; charset=utf-8");

  const supabaseUrl = String(process.env.PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "").trim().replace(/\/$/, "");
  const publishableKey = String(process.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY || "").trim();

  if (!supabaseUrl || !publishableKey) {
    res.statusCode = 503;
    return res.end("window.ZARINMAH_PUBLIC_CONFIG = null;");
  }

  const payload = JSON.stringify({
    supabaseUrl,
    publishableKey
  }).replace(/</g, "\\u003c");

  return res.end("window.ZARINMAH_PUBLIC_CONFIG = " + payload + ";");
};
